import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { computeRealizedFromSales } from '@portfolio-dashboard/shared';
import { all, runSync, getSync, transaction } from '../db';
import { computeAndInsertHistoryPoint } from '../services/historyManager';
import { SYMBOLS } from '../config/symbols';

export const tradesRouter = Router();

/** A `trades` row, as the FIFO walk needs it. */
interface TradeRow {
  id: string;
  symbol: string;
  side: string;
  qty: number;
  price?: number | null;
}

function getAssetCurrency(symbol: string): 'USD' | 'BRL' {
  const asset = SYMBOLS[symbol];
  if (!asset) return 'USD';
  return asset.denominatedInBRL ? 'BRL' : 'USD';
}

/**
 * A rejected request, with the status to answer it with.
 *
 * The status travels with the message rather than being derived from it. It used
 * to be `error.includes('currency') ? 409 : 400`, and neither message contains
 * the word "currency" - so the 409 was unreachable, and with it the 409 handling
 * on the client (`ApiError.isConflict`) that is documented as covering exactly
 * this case. A status that depends on message wording breaks the moment someone
 * rewords the message.
 */
interface TradeValidationError {
  status: number;
  message: string;
}

function validateTradeRequest(
  symbol: string,
  side: string,
  qty: number,
  price: number | null,
  cashSource?: string,
): TradeValidationError | null {
  if (!symbol || !side || !qty) {
    return { status: 400, message: 'Missing required fields' };
  }

  if (side === 'sell' && (price === undefined || price === null)) {
    return { status: 400, message: 'Price required for sell trades' };
  }

  const assetCurrency = getAssetCurrency(symbol);
  if (cashSource && cashSource !== assetCurrency) {
    // 409: the request is well-formed and the asset is tradeable, it conflicts
    // with the cash source chosen for it.
    return {
      status: 409,
      message: `Asset ${symbol} uses ${assetCurrency}, but ${cashSource} selected as cash source`,
    };
  }

  return null;
}

/**
 * Writes the cash movement a trade implies.
 *
 * Synchronous on purpose: it runs inside `transaction()`, which cannot await.
 */
function createAutoCashEntry(symbol: string, side: string, qty: number, price: number | null, time: string) {
  const assetCurrency = getAssetCurrency(symbol);
  const amount = side === 'buy' ? -(qty * (price || 0)) : qty * (price || 0);
  const desc = `Trade: ${side.toUpperCase()} ${qty} ${symbol} @ ${price}`;
  const cashEntryId = randomUUID();
  const tradeTs = new Date(time).getTime();

  runSync('INSERT INTO cash (id, currency, amount, description, ts) VALUES (?, ?, ?, ?, ?)', [
    cashEntryId,
    assetCurrency,
    amount,
    desc,
    tradeTs,
  ]);
  return getSync('SELECT * FROM cash WHERE id = ?', [cashEntryId]);
}

tradesRouter.get('/', async (req: Request, res: Response) => {
  try {
    // Time-ordered because the FIFO walk that fills in `profit` is only correct
    // in the order the trades happened.
    const rows = await all('SELECT * FROM trades ORDER BY time ASC');
    const priceRows = await all<{ symbol: string; price: number }>('SELECT symbol, price FROM price_cache');
    const prices: Record<string, number> = {};
    for (const row of priceRows) prices[row.symbol] = row.price;

    // The `profit` column was dropped in migration 0003, so the trade history's
    // Profit column showed `-` on every sell. It is derived here rather than
    // stored, because a stored copy would need writing on every sell and would
    // be wrong anyway if a trade were ever edited. Per trade it is the gain in
    // the symbol's own currency, which is what the old column held and what the
    // view renders; the USD total is `computeRealizedFromSales(...).totalUsd`,
    // used by the valuation and the snapshot writer.
    const { nativeByTradeId } = computeRealizedFromSales(rows as TradeRow[], SYMBOLS, prices['BRLUSD'] ?? 1, prices);
    res.json(rows.map((row) => (row.side === 'sell' ? { ...row, profit: nativeByTradeId[(row as TradeRow).id] ?? 0 } : row)));
  } catch (err) {
    console.error('Error fetching trades', err);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

tradesRouter.post('/', async (req, res) => {
  try {
    const { symbol, side, qty, price, time, cashSource } = req.body;

    const validationError = validateTradeRequest(symbol, side, qty, price, cashSource);
    if (validationError) {
      return res.status(validationError.status).json({ error: validationError.message });
    }

    const id = randomUUID();
    const t = time || new Date().toISOString();

    // One transaction for both writes. The cash entry is created first so its id
    // can go into the trade's INSERT — the other order leaves a window where the
    // trade exists with no link, which is what this link exists to close.
    //
    // The transaction is the other half of that fix, and this handler had none.
    // `id`, `symbol`, `side`, `qty` and `time` are all NOT NULL, so the trades
    // INSERT can throw; without a rollback the cash row it had already written
    // was stranded permanently — the same defect class as the deleted-trade leak
    // that `cash_entry_id` was added for, and the reason DELETE wraps its two
    // statements.
    //
    // The read-back is inside the transaction so the response cannot describe a
    // state the commit did not produce.
    const { trade: row, cashEntry } = transaction(() => {
      const cashEntry = createAutoCashEntry(symbol, side, qty, price, t);

      runSync('INSERT INTO trades (id, symbol, side, qty, price, time, cash_entry_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        id,
        symbol,
        side,
        qty,
        price ?? null,
        t,
        cashEntry?.id ?? null,
      ]);
      return { trade: getSync('SELECT * FROM trades WHERE id = ?', [id]), cashEntry };
    });

    res.status(201).json({ trade: row, cashEntry });

    computeAndInsertHistoryPoint({ note: 'post-trade' }).catch((err) =>
      console.error('History snapshot after trade insert failed', err),
    );
  } catch (err) {
    console.error('Error adding trade', err);
    res.status(500).json({ error: 'Failed to add trade' });
  }
});

tradesRouter.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    // Reverse the cash movement the trade created, in the same transaction as
    // removing the trade. Before `trades.cash_entry_id` existed this deleted
    // only the trade, so every deleted trade left its proceeds in the balance
    // permanently: cash, `invested` and `total` were each inflated by the sale
    // amount and never came back down.
    //
    // A null link means the trade created no cash row of ours — a fixture import,
    // or a restore from a backup predating the column — and there is then
    // nothing to reverse. Hand-entered cash adjustments are never touched,
    // because no trade points at them.
    //
    // The link is read inside the transaction too: reading it outside would leave
    // a window where another request could delete the trade first, and this
    // transaction would then delete a cash entry belonging to a different id.
    transaction(() => {
      const trade = getSync<{ cash_entry_id: string | null }>('SELECT cash_entry_id FROM trades WHERE id = ?', [id]);
      runSync('DELETE FROM trades WHERE id = ?', [id]);
      if (trade?.cash_entry_id) {
        runSync('DELETE FROM cash WHERE id = ?', [trade.cash_entry_id]);
      }
    });

    res.status(204).send();
    computeAndInsertHistoryPoint({ note: 'post-trade-delete' }).catch((err) =>
      console.error('History snapshot after trade delete failed', err),
    );
  } catch (err) {
    console.error('Error deleting trade', err);
    res.status(500).json({ error: 'Failed to delete trade' });
  }
});
