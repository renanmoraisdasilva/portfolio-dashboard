import { Router } from 'express';
import { SYMBOLS, getCryptoSymbols, getStockSymbols, getCurrencySymbols } from '../config/symbols';

export const configRouter = Router();

// GET all available symbols
configRouter.get('/symbols', (req, res) => {
  res.json({
    all: Object.keys(SYMBOLS),
    crypto: getCryptoSymbols(),
    stocks: getStockSymbols(),
    currencies: getCurrencySymbols(),
    detailed: SYMBOLS,
  });
});

// GET a specific symbol's config
configRouter.get('/symbols/:symbol', (req, res) => {
  const config = SYMBOLS[req.params.symbol.toUpperCase()];
  if (!config) {
    return res.status(404).json({ error: 'Symbol not found' });
  }
  res.json(config);
});
