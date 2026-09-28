import { refreshPrices } from '../services/priceFetcher';

const PRICE_REFRESH_INTERVAL_MS = 8 * 60 * 1000;

export async function startPriceRefreshJob(): Promise<void> {
  await refreshPrices();
  setInterval(() => {
    refreshPrices().catch((err) => console.error('Price refresh error', err));
  }, PRICE_REFRESH_INTERVAL_MS);
}
