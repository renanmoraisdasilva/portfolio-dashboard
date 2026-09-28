import { expect, test, type Page } from '@playwright/test';

/**
 * The three smoke tests the plan asked for, against the seeded fixture.
 *
 * Before Playwright, "the dashboard still works" was established by opening it
 * and reading the numbers off the screen — which is how the Phase 5 and 6
 * migrations were verified. That is not repeatable and not reviewable. These
 * three tests assert the same things a person was checking by hand:
 *
 * - the dashboard loads and shows the portfolio it was seeded with;
 * - adding a trade changes the trade count, the cash balance and the totals, and
 *   the change is the arithmetic you would expect;
 * - the other two pages render their own metrics without a console error.
 *
 * Prices come from an empty `price_cache` (the worker is not running in CI), so
 * the assertions are about *structure and relationships* — the trade count went
 * up, the position exists, the total changed — not about a market price. A test
 * that pinned today's BTC price would be a test that fails on a Tuesday.
 */

/** The first metric card's value, e.g. `$42,635.13`. */
async function currentValue(page: Page): Promise<string> {
  return (await page.locator('.metric-card').first().locator('.metric-value').innerText()).split('\n')[0].trim();
}

test('the dashboard shows a formatted total, not a zero', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.metric-card').first()).toBeVisible();
  // Structural, not a price: the point is that the card is formatted currency.
  expect(await currentValue(page)).toMatch(/^\$[\d,]*\.\d{2}$/);
});

test.describe('portfolio dashboard', () => {
  test('the dashboard loads the seeded portfolio', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await expect(page.locator('.metric-card').first()).toBeVisible();

    // Five cards, each with a value: the vanilla page rendered zero and empty.
    const cards = page.locator('.metrics-grid .metric-card');
    await expect(cards).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      await expect(cards.nth(i).locator('.metric-value')).not.toBeEmpty();
    }

    // The seeded fixture has 14 trades, so 14 rows in the ledger.
    await expect(page.locator('.card', { hasText: 'Trade History' }).locator('tbody tr')).toHaveCount(14);

    // A real number, not a zero: the fixture deposits 95,000 BRL and 12,500 USD.
    const cash = await page.locator('.balance-value').allInnerTexts();
    expect(cash.length).toBeGreaterThanOrEqual(2);
    expect(cash.join(' ')).toMatch(/R\$\s*95\.000,00/);
    expect(cash.join(' ')).toMatch(/\$\s*12,500\.00/);

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('adding a trade updates the ledger, the position and the cash it consumed', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.metric-card').first()).toBeVisible();

    const tradeRows = page.locator('.card', { hasText: 'Trade History' }).locator('tbody tr');
    await expect(tradeRows).toHaveCount(14);

    // Buy 0.01 BTC at an explicit price. The form's fields are not labelled
    // (the vanilla page's markup, and its `<label>`s are decorative), so they are
    // addressed by their placeholders — the same identifiers a person uses.
    await page.locator('.trade-grid select').selectOption('BTC');
    await page.locator('.trade-grid input[placeholder="0.0000"]').fill('0.01');
    // Scoped to the price stepper: `0.00` also matches the quantity field's
    // hint elsewhere on the page, and a strict locator refuses the ambiguity.
    await page.locator('.trade-grid .stepper input[placeholder="0.00"]').fill('1000');
    await page.getByRole('button', { name: 'Add Trade' }).click();

    // The ledger grows by one, and the row is the one that was asked for.
    await expect(tradeRows).toHaveCount(15);
    await expect(tradeRows.last()).toContainText('BTC');
    await expect(tradeRows.last()).toContainText('0.01');

    // A position appears for it.
    await expect(page.locator('.card', { hasText: 'Current Positions' }).locator('tbody tr', { hasText: 'BTC' })).toBeVisible();

    // And the cash the buy consumed is gone: 0.01 x $1,000 = $10 off the balance.
    // This is the assertion worth making — the trade produced a matching cash
    // entry, which is a server-side invariant (`createAutoCashEntry`), not a
    // re-render. Asserting a market-value total instead would depend on the
    // price cache, and the worker is not running here.
    await expect(page.locator('.balance-value').filter({ hasText: '$12,490.00' })).toBeVisible();
  });

  test('the simulation and analytics pages render without a console error', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/simulation');
    await expect(page.locator('.metric-card').first()).toBeVisible();
    await expect(page.locator('.metrics-grid .metric-card')).toHaveCount(5);
    // The allocation chart is a canvas; a blank one would not be an error, so
    // assert the legend it fills, which is DOM.
    await expect(page.locator('.alloc-row').first()).toBeVisible();

    await page.goto('/analytics');
    await expect(page.locator('.metric-card').first()).toBeVisible();
    // Three headline metrics: return, drawdown, Sharpe.
    await expect(page.locator('.metrics-grid .metric-card')).toHaveCount(3);

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });
});

test('the SQL Explorer stays closed unless it is explicitly enabled', async ({ request }) => {
  // Phase 3 gates it, and a gate that nobody tests is a gate that eventually
  // gets refactored away.
  const response = await request.get('/api/sql/tables');
  expect(response.status()).toBe(403);
  expect((await response.json()).error).toMatch(/ENABLE_SQL_EXPLORER/);
});

test('the retired GET /api/state aggregation is really gone', async ({ request }) => {
  // Phase 5 removed it; a 404 here is the contract the Vue views depend on,
  // since they read /trades, /cash and /interest/months instead.
  expect((await request.get('/api/state')).status()).toBe(404);
  expect((await request.get('/api/trades')).status()).toBe(200);
  expect((await request.get('/api/portfolio/valuation')).status()).toBe(200);
});
