import { refreshPrices } from '../services/priceFetcher';
import { schedule } from './scheduler';

const PRICE_REFRESH_INTERVAL_MS = 8 * 60 * 1000;

export async function startPriceRefreshJob(): Promise<void> {
  await refreshPrices();
  schedule('price refresh', PRICE_REFRESH_INTERVAL_MS, () => {
    refreshPrices().catch((err) => console.error('Price refresh error', err));
  });
}
