/**
 * Price freshness policy — the numbers, in one place.
 *
 * These used to live in `services/priceFetcher.ts`, which is the *worker's*
 * module: it imports `homeAssistantService` and everything else that module pulls
 * in at load time. `routes/prices.ts` needed `STALE_AFTER_MS` for the wire
 * contract and reached for it with `await import('../services/priceFetcher')` —
 * a web request handler dynamically importing the worker's fetcher to read one
 * number, inside a `try`/`catch` that silently substituted a hardcoded fallback.
 *
 * Two things were wrong with it, and it is worth being precise about which:
 *
 * - The dynamic import bought nothing. `priceFetcher` was already in the bundle's
 *   graph by way of `priceRefresh` and `routes/asset`, so the `await` was work
 *   with no effect, in a request handler.
 * - `pf.STALE_AFTER_MS || 1_440_000` put a *second* copy of the number in the
 *   source, in a `catch` that could not fail usefully.
 *
 * **The second copy was not a live bug, and the review said it was.** It claimed
 * the threshold "can differ between deployments with nothing logged", on the
 * grounds that the fallback would win if the import failed. But `STALE_AFTER_MS` is
 * `3 * (8 * 60 * 1000)` = `1_440_000` — exactly the hardcoded fallback. So the
 * `catch` branch sent the same number the happy path did, and no deployment could
 * have shipped a different threshold. Verified, not assumed.
 *
 * What the duplication *did* risk is the ordinary one: someone changes
 * `CACHE_TTL`, `STALE_AFTER_MS` moves, and the literal in `routes/prices.ts` does
 * not. Nothing would have caught that — the route had no test at all. That is the
 * real cost, and it is why the constant now lives in a module with no side
 * effects, imported statically by both callers, with a route test that pins the
 * wire value to the constant rather than to a number.
 */

/**
 * How long a fetched price is served from cache before we refetch it.
 *
 * This is a *fetching* decision, not a freshness promise, and it is deliberately
 * shorter than the interval at which the banner below trips. They used to be the
 * same constant, which meant a perfectly healthy worker tripped the "prices may be
 * stale" warning at the end of every single cycle — the one moment the data is
 * exactly as fresh as it is ever going to be.
 */
export const CACHE_TTL = 8 * 60 * 1000;

/**
 * How old a price has to be before the UI warns about it. Three refresh cycles,
 * so one missed or slow run does not light up the dashboard.
 */
export const STALE_AFTER_MS = 3 * CACHE_TTL;

/**
 * Skip refetching a symbol only if it was written moments ago.
 *
 * This used to equal `CACHE_TTL`, and that is the same mistake as above in the
 * other direction: the worker refreshes every 8 minutes, so a guard at 8 minutes
 * raced the schedule. Any drift — the loop firing a second late, the previous
 * fetch taking time — made `now - prev.ts` land just under the guard and the
 * symbol was skipped, which pushed equities and BRLUSD to 16 minutes while
 * crypto (unguarded) sat at 8. The guard exists to avoid two fetches of one
 * symbol in quick succession; half a minute covers that without vetoing the next
 * scheduled run.
 */
export const MIN_INTERVAL = 30 * 1000;

/**
 * Per-interval TTL for the asset chart cache.
 *
 * **The key names the candle interval, not the TTL.** `1d` means "the daily
 * candle series", and its cache lasts an hour — so that `1h` (fifteen minutes)
 * refetches more often than `1d` (one hour) despite the key suggesting the
 * opposite order. This is deliberate: a daily series changes slowly, so caching
 * it longer loses nothing, and a chart is fetched far more often for the intraday
 * view.
 *
 * Recorded here because `60 * 60 * 1000` sitting under a key called `1d` reads as
 * an off-by-a-factor-of-24 bug to anyone who has not been told otherwise, and
 * "fixing" it would silently quadruple the Yahoo request rate. Do not.
 */
export const ASSET_HISTORY_CACHE_TTL_MS = {
  '1h': 15 * 60 * 1000,
  '1d': 60 * 60 * 1000,
} as const;
