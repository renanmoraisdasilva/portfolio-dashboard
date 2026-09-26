import { Router, Request, Response } from 'express';
import {
  initFinanceDB,
  importFinanceJSON,
  exportFinanceJSON,
  // Income
  addIncome,
  updateIncome,
  deleteIncome,
  // Fixed expenses
  getFixedExpenses,
  addFixedExpense,
  updateFixedExpense,
  deleteFixedExpense,
  // Eventual expenses
  getEventualExpenses,
  addEventualExpense,
  updateEventualExpense,
  deleteEventualExpense,
  // Credit card expenses
  getCreditExpenses,
  addCreditExpense,
  updateCreditExpense,
  deleteCreditExpense,
  // Year management
  getAvailableYears,
  createFinanceYear,
  resetFinanceYear,
} from '../services/financeService';

export const financeRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse an optional numeric query/body param, returning undefined if invalid. */
function optionalNumber(val: any): number | undefined {
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

// ---------------------------------------------------------------------------
// Full state: GET (export) / POST import
// ---------------------------------------------------------------------------

financeRouter.get('/', async (req: Request, res: Response) => {
  try {
    const year = optionalNumber(req.query.year);
    res.json(await exportFinanceJSON(year));
  } catch (err) {
    console.error('Error exporting finance state', err);
    res.status(500).json({ error: 'Failed to export finance state' });
  }
});

financeRouter.post('/import', async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'Invalid payload' });
    // Allow ?year= override when payload.year is absent
    if (!Number.isFinite(payload.year)) {
      const qy = optionalNumber(req.query.year);
      if (qy !== undefined) payload.year = qy;
    }
    await importFinanceJSON(payload);
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('Error importing finance JSON', err);
    res.status(500).json({ error: 'Failed to import finance JSON' });
  }
});

// ---------------------------------------------------------------------------
// Incomes
// ---------------------------------------------------------------------------

financeRouter.post('/incomes', async (req: Request, res: Response) => {
  try {
    const { month, source, value, description, year } = req.body;
    if (typeof month !== 'number' || !source || typeof value !== 'number')
      return res.status(400).json({ error: 'month, source and value required' });
    const row = await addIncome(month, source, value, description, optionalNumber(year));
    res.status(201).json({ income: row });
  } catch (err) {
    console.error('Error adding income', err);
    res.status(500).json({ error: 'Failed to add income' });
  }
});

financeRouter.put('/incomes/:id', async (req: Request, res: Response) => {
  try {
    const { source, value, description } = req.body;
    if (!source || typeof value !== 'number')
      return res.status(400).json({ error: 'source and value required' });
    const row = await updateIncome(req.params.id, source, value, description);
    res.json({ income: row });
  } catch (err) {
    console.error('Error updating income', err);
    res.status(500).json({ error: 'Failed to update income' });
  }
});

financeRouter.delete('/incomes/:id', async (req: Request, res: Response) => {
  try {
    await deleteIncome(req.params.id);
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting income', err);
    res.status(500).json({ error: 'Failed to delete income' });
  }
});

// ---------------------------------------------------------------------------
// Fixed expenses
// ---------------------------------------------------------------------------

financeRouter.get('/fixed', async (req: Request, res: Response) => {
  try {
    const month = optionalNumber(req.query.month);
    if (month === undefined) return res.status(400).json({ error: 'month query param required' });
    res.json(await getFixedExpenses(month, optionalNumber(req.query.year)));
  } catch (err) {
    console.error('Error fetching fixed expenses', err);
    res.status(500).json({ error: 'Failed to fetch fixed expenses' });
  }
});

financeRouter.post('/fixed', async (req: Request, res: Response) => {
  try {
    const { month, name, category, value, paymentMethod, normallyDueDay, paidOnDate, year } = req.body;
    if (typeof month !== 'number' || !name || !category || typeof value !== 'number')
      return res.status(400).json({ error: 'month, name, category, value required' });
    const row = await addFixedExpense(month, name, category, value, paymentMethod, optionalNumber(year), optionalNumber(normallyDueDay), paidOnDate);
    res.status(201).json({ fixed: row });
  } catch (err) {
    console.error('Error adding fixed expense', err);
    res.status(500).json({ error: 'Failed to add fixed expense' });
  }
});

financeRouter.put('/fixed/:id', async (req: Request, res: Response) => {
  try {
    const { name, category, value, paymentMethod, normallyDueDay, paidOnDate } = req.body;
    const row = await updateFixedExpense(req.params.id, { name, category, value, paymentMethod, normallyDueDay, paidOnDate });
    res.json({ fixed: row });
  } catch (err) {
    console.error('Error updating fixed expense', err);
    res.status(500).json({ error: 'Failed to update fixed expense' });
  }
});

financeRouter.delete('/fixed/:id', async (req: Request, res: Response) => {
  try {
    await deleteFixedExpense(req.params.id);
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting fixed expense', err);
    res.status(500).json({ error: 'Failed to delete fixed expense' });
  }
});

// ---------------------------------------------------------------------------
// Eventual expenses
// ---------------------------------------------------------------------------

financeRouter.get('/eventual', async (req: Request, res: Response) => {
  try {
    const month = optionalNumber(req.query.month);
    if (month === undefined) return res.status(400).json({ error: 'month query param required' });
    res.json(await getEventualExpenses(month, optionalNumber(req.query.year)));
  } catch (err) {
    console.error('Error fetching eventual expenses', err);
    res.status(500).json({ error: 'Failed to fetch eventual expenses' });
  }
});

financeRouter.post('/eventual', async (req: Request, res: Response) => {
  try {
    const { month, category, value, description, paymentMethod, year } = req.body;
    if (typeof month !== 'number' || !category || typeof value !== 'number')
      return res.status(400).json({ error: 'month, category, value required' });
    const row = await addEventualExpense(month, category, value, description, paymentMethod, optionalNumber(year));
    res.status(201).json({ eventual: row });
  } catch (err) {
    console.error('Error adding eventual expense', err);
    res.status(500).json({ error: 'Failed to add eventual expense' });
  }
});

financeRouter.put('/eventual/:id', async (req: Request, res: Response) => {
  try {
    const { category, value, description, paymentMethod } = req.body;
    const row = await updateEventualExpense(req.params.id, { category, value, description, paymentMethod });
    res.json({ eventual: row });
  } catch (err) {
    console.error('Error updating eventual expense', err);
    res.status(500).json({ error: 'Failed to update eventual expense' });
  }
});

financeRouter.delete('/eventual/:id', async (req: Request, res: Response) => {
  try {
    await deleteEventualExpense(req.params.id);
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting eventual expense', err);
    res.status(500).json({ error: 'Failed to delete eventual expense' });
  }
});

// ---------------------------------------------------------------------------
// Credit card expenses
// ---------------------------------------------------------------------------

financeRouter.get('/credit', async (req: Request, res: Response) => {
  try {
    const card = req.query.card as string;
    const month = optionalNumber(req.query.month);
    if (!card) return res.status(400).json({ error: 'card query param required' });
    if (month === undefined) return res.status(400).json({ error: 'month query param required' });
    res.json(await getCreditExpenses(card, month, optionalNumber(req.query.year)));
  } catch (err) {
    console.error('Error fetching credit expenses', err);
    res.status(500).json({ error: 'Failed to fetch credit expenses' });
  }
});

financeRouter.post('/credit', async (req: Request, res: Response) => {
  try {
    const { card, month, category, value, paymentMethod, description, year } = req.body;
    if (!card || typeof month !== 'number' || !category || typeof value !== 'number')
      return res.status(400).json({ error: 'card, month, category, value required' });
    const row = await addCreditExpense(card, month, category, value, paymentMethod, description, optionalNumber(year));
    res.status(201).json({ credit: row });
  } catch (err) {
    console.error('Error adding credit expense', err);
    res.status(500).json({ error: 'Failed to add credit expense' });
  }
});

financeRouter.put('/credit/:id', async (req: Request, res: Response) => {
  try {
    const { category, value, paymentMethod, description, paidOnDate } = req.body;
    const row = await updateCreditExpense(req.params.id, { category, value, paymentMethod, description, paidOnDate });
    res.json({ credit: row });
  } catch (err) {
    console.error('Error updating credit expense', err);
    res.status(500).json({ error: 'Failed to update credit expense' });
  }
});

financeRouter.delete('/credit/:id', async (req: Request, res: Response) => {
  try {
    await deleteCreditExpense(req.params.id);
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting credit expense', err);
    res.status(500).json({ error: 'Failed to delete credit expense' });
  }
});

// ---------------------------------------------------------------------------
// Years
// ---------------------------------------------------------------------------

financeRouter.get('/years', async (_req: Request, res: Response) => {
  try {
    res.json(await getAvailableYears());
  } catch (err) {
    console.error('Error fetching available years', err);
    res.status(500).json({ error: 'Failed to fetch years' });
  }
});

financeRouter.post('/years', async (req: Request, res: Response) => {
  try {
    const year = optionalNumber(req.body?.year);
    if (year === undefined) return res.status(400).json({ error: 'year required' });
    await createFinanceYear(year);
    res.status(201).json({ ok: true, year });
  } catch (err) {
    console.error('Error creating year', err);
    res.status(500).json({ error: 'Failed to create year' });
  }
});

financeRouter.post('/years/:year/reset', async (req: Request, res: Response) => {
  try {
    const year = optionalNumber(req.params.year);
    if (year === undefined) return res.status(400).json({ error: 'invalid year' });
    await resetFinanceYear(year);
    res.json({ ok: true, year });
  } catch (err) {
    console.error('Error resetting year', err);
    res.status(500).json({ error: 'Failed to reset year' });
  }
});

// ---------------------------------------------------------------------------
// DB init endpoint (used by server startup)
// ---------------------------------------------------------------------------

financeRouter.post('/init', async (_req: Request, res: Response) => {
  try {
    await initFinanceDB();
    res.json({ ok: true });
  } catch (err) {
    console.error('Error initializing finance DB', err);
    res.status(500).json({ error: 'Failed to init finance DB' });
  }
});
