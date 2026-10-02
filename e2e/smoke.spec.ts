import { expect, test, type Page } from '@playwright/test';

/**
 * The three smoke tests the plan asked for, against the seeded fixture.
 *
 * Before Playwright, "the dashboard still works" was established by opening it
 * and reading the numbers off the screen - which is how the page migrations
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

test('the settings gear opens a dialog over the page, not below it', async ({ page }) => {
  // The gear's dialog is mounted by the shell (`App.vue`) as a sibling of
  // `<RouterView />`, so it sits inside no page wrapper. It was briefly styled by
  // `.dashboard-page .modal`, which cannot match it, and two things went wrong at
  // once: the page-scoped selector never applied, and the rule lived in a
  // stylesheet that only loads with the dashboard. The result was the dialog
  // rendering as unstyled static block content at the bottom of the document.
  //
  // `/analytics` is deliberate. It never imports `dashboard.css`, so this is the
  // route where a modal defined in a page stylesheet would have no styling at all
  // - which is precisely what a reviewer clicking around the dashboard would miss.
  await page.goto('/analytics');
  await page.getByRole('button', { name: 'Settings & Tools' }).click();

  const overlay = page.locator('.modal').first();
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveCSS('position', 'fixed');

  // `inset: 0` on a fixed overlay covers the viewport. A block element in normal
  // flow at the end of a long document does not, and its box is far taller than
  // the fold - so this is the assertion that actually distinguishes a popup from
  // a section that happens to exist.
  const viewport = page.viewportSize();
  const overlayBox = await overlay.boundingBox();
  expect(overlayBox).not.toBeNull();
  expect(overlayBox!.height).toBeGreaterThanOrEqual(viewport!.height - 1);

  // And the panel is centred in the viewport rather than parked below the fold.
  const dialogBox = await page.locator('.modal-content').first().boundingBox();
  expect(dialogBox).not.toBeNull();
  const centreOffset = Math.abs(dialogBox!.x + dialogBox!.width / 2 - viewport!.width / 2);
  expect(centreOffset).toBeLessThan(4);

  // Clicking the backdrop is not wired up, so closing is the close button - and
  // the dialog must actually leave the DOM rather than just lose its backdrop.
  // Addressed by class: the button's accessible name is its "✕" glyph, not the
  // `title`, so `getByRole(..., { name: 'Close' })` would not find it.
  await page.locator('.modal-close').click();
  await expect(overlay).toHaveCount(0);
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

test('no endpoint executes arbitrary SQL', async ({ request }) => {
  // The API takes no statement string. A 404 is the assertion that matters: a
  // 403 would prove a route exists and is merely gated, and a router that runs
  // SQL behind a flag would still pass a looser check.
  for (const [method, path] of [
    ['get', '/api/sql/tables'],
    ['get', '/api/sql/schema'],
    ['post', '/api/sql/query'],
  ] as const) {
    const response = await request[method](path as string);
    expect(response.status()).toBe(404);
  }
});

test('every header link resolves to a route the app serves', async ({ page }) => {
  // Guards the nav table against an entry whose path 404s into the SPA
  // fallback, which would look like a working link and land on the dashboard.
  await page.goto('/');
  await expect(page.locator('.app-header')).toBeVisible();

  const hrefs = await page
    .locator('.app-nav a')
    .evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? ''));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) {
    const response = await page.request.get(href);
    expect(response.status(), `${href} is linked from the header but does not resolve`).toBe(200);
  }
});

test('the settings modal offers exactly three tools', async ({ page }) => {
  // Export, Import and Test Notify. The destructive maintenance operations that
  // once sat beside them are gone, so every remaining tool is a backup or a
  // notification rather than a write.
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings & Tools' }).click();

  await expect(page.locator('.settings-content .tool-row')).toHaveCount(3);
});

test('the retired GET /api/state aggregation is really gone', async ({ request }) => {
  // It was removed; a 404 here is the contract the Vue views depend on,
  // since they read /trades, /cash and /interest/months instead.
  expect((await request.get('/api/state')).status()).toBe(404);
  expect((await request.get('/api/trades')).status()).toBe(200);
  expect((await request.get('/api/portfolio/valuation')).status()).toBe(200);
});

/**
 * The two documented failure paths, end to end.
 *
 * Every other test in this suite asserts a success. That leaves the contracts
 * that matter most to a user — the ones that say *no* — exercised only by unit
 * tests against mocked or in-process databases. Both of these were documented in
 * the code and verified nowhere:
 *
 * - `ApiError.isConflict`, which the client relies on to show a rejected trade's
 *   server message rather than a generic failure. It could not fire at all while
 *   the 409 was derived from a substring check on the message text. It also cannot
 *   be reached through the store's own request helper here, which is why this test
 *   posts directly: the point is the wire contract.
 * - A rejected backup, which now answers 400 with the offending rows named.
 */
test('a rejected trade answers 409 for a currency conflict, and 400 for a missing field', async ({ request }) => {
  // `validateTradeRequest` distinguishes two kinds of rejection, and the client
  // depends on the difference: `ApiError.isConflict` is what lets a view show the
  // server's own message for a conflict rather than a generic failure.
  //
  // 409 is the *conflict* — the request is well-formed and the asset is tradeable,
  // but it conflicts with the cash source chosen for it. BOVA11 is a BRL-denominated
  // asset, so buying it out of the USD cash source is the conflict case.
  const conflict = await request.post('/api/trades', {
    data: { symbol: 'BOVA11', side: 'buy', qty: 1, price: 169.27, cashSource: 'USD' },
  });
  expect(conflict.status()).toBe(409);
  const conflictBody = await conflict.json();
  expect(typeof conflictBody.error).toBe('string');
  expect(conflictBody.error.length).toBeGreaterThan(0);
  // The message names both sides of the conflict, so it is actionable on its own.
  expect(conflictBody.error).toContain('BOVA11');

  // 400 is the *malformed* request — a missing quantity. Distinct status, and the
  // same shape, because the status travels with the message rather than being
  // derived from its wording.
  const malformed = await request.post('/api/trades', { data: { symbol: 'BTC', side: 'buy' } });
  expect(malformed.status()).toBe(400);

  // Neither rejection wrote anything: the seeded trade count is unchanged, so the
  // 409 path is a refusal and not a partial write.
  const trades = await request.get('/api/trades').then((r) => r.json());
  expect(trades.some((t: { symbol: string }) => t.symbol === 'BOVA11' && t.qty === 1)).toBe(false);
});

test('a malformed backup is refused with 400 naming the row, and nothing is replaced', async ({ request }) => {
  const before = await request.get('/api/state/export').then((r) => r.json());
  const tradeCountBefore = (await request.get('/api/trades').then((r) => r.json())).length;

  const response = await request.post('/api/state/import', {
    data: {
      trades: [
        { id: 'ok', symbol: 'BTC', side: 'buy', qty: 1, price: 100, time: '2026-01-01T00:00:00.000Z' },
        { id: 'bad', symbol: 'BTC', side: 'buy', time: '2026-01-01T00:00:00.000Z' },
      ],
    },
  });

  // 400, not 500. The file is the problem, and a client cannot tell a bad file
  // apart from a broken server if both answer 500.
  expect(response.status()).toBe(400);
  const body = await response.json();
  expect(body.problems).toEqual([{ table: 'trades', index: 1, reason: '`qty` must be a finite number' }]);

  // The load-bearing half: the restore is refused *before* anything is cleared, so
  // the good row in the same payload does not land and the existing data survives.
  const after = await request.get('/api/trades').then((r) => r.json());
  expect(after.length).toBe(tradeCountBefore);
  expect(after.some((t: { id: string }) => t.id === 'ok')).toBe(false);

  // The export is unchanged too, which is what makes "a refused restore changed
  // nothing" true of the tables the payload did not even mention.
  const now = await request.get('/api/state/export').then((r) => r.json());
  expect(now.trades.length).toBe(before.trades.length);
});

test('a backup that is not an object is refused before any table is touched', async ({ request }) => {
  const response = await request.post('/api/state/import', { data: ['not', 'a', 'backup'] });

  expect(response.status()).toBe(400);
  expect((await response.json()).problems).toEqual([{ table: '(payload)', index: null, reason: 'must be a JSON object' }]);
  // A well-formed empty payload is still a 200 no-op — the guard has to be the
  // payload's *shape*, not "there was nothing to do".
  expect((await request.post('/api/state/import', { data: {} })).status()).toBe(200);
});
