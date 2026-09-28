# End-to-end smoke tests

Six Playwright tests that drive the **built** app in Chromium, the same way a
person used to: open the page, look at the numbers. Until these existed, "the
dashboard still works" was a manual step — which is how the Phase 5 and 6
migrations were verified, and which nobody could repeat or review.

## Running them

```bash
npm run build      # required: the suite runs dist/, not ts-node
npm run test:e2e   # or: npm run test:e2e:ui for the interactive runner
```

First run only: `npx playwright install chromium`.

## What they check

| Test                                        | Asserts                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `the dashboard shows a formatted total`     | the first metric card is formatted currency, not a raw number or a zero                                                      |
| `the dashboard loads the seeded portfolio`  | five populated cards, the seeded 14-row ledger, the fixture's R$ 95.000,00 / $ 12.500,00 balances, and **no console errors** |
| `adding a trade…`                           | buying 0.01 BTC at $1,000 grows the ledger to 15 rows, creates the position, and takes exactly $10 off the USD balance       |
| `the simulation and analytics pages render` | both pages render their metrics and the allocation legend, with no console error                                             |
| `the SQL Explorer stays closed`             | `/api/sql/tables` is 403 without `ENABLE_SQL_EXPLORER=true`                                                                  |
| `the retired aggregation is really gone`    | `GET /api/state` is 404 while `/trades` and `/portfolio/valuation` answer                                                    |

## Two things to know before adding a test

**The database is a temporary one.** `e2e/start-server.mjs` sets
`PORTFOLIO_DATA_DIR` to a fresh temp directory, seeds it from
`fixtures/portfolio_data.json`, and deletes it afterwards. A run can never open
the real `apps/api/data/portfolio.db`, which is why the trade test can afford to
add a trade. `PORTFOLIO_DATA_DIR` is a new opt-in variable; unset, the server
behaves exactly as before.

**Do not assert market prices.** The worker is not running, so `price_cache` is
empty and every price is zero. A test that pinned today's BTC price would fail on
a Tuesday. The trade test therefore asserts the _cash_ arithmetic — the buy
creates a matching cash entry server-side, and $10 leaves the balance — which is
exact without a price feed. If you need real prices, that is a different kind of
test and it belongs in the k6 job, which runs against a live stack.

## The form has no labels

`AddTradeForm.vue` carries over the vanilla page's markup, where `<label>`s are
decorative and not associated with their inputs. The tests address the fields by
placeholder, scoped to `.trade-grid`. If you improve the form's accessibility,
these locators can be simplified to `getByLabel` — worth doing, and the tests
will tell you if you get it wrong.
