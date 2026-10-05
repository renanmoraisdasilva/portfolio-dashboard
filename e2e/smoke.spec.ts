import { expect, test, type Page } from '@playwright/test';

async function currentValue(page: Page): Promise<string> {
  return (await page.locator('.metric-card').first().locator('.metric-value').innerText()).split('\n')[0].trim();
}

test('the dashboard shows a formatted total, not a zero', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.metric-card').first()).toBeVisible();
  expect(await currentValue(page)).toMatch(/^\$[\d,]*\.\d{2}$/);
});

test('the settings gear opens a dialog over the page, not below it', async ({ page }) => {
  await page.goto('/analytics');
  await page.getByRole('button', { name: 'Settings & Tools' }).click();

  const overlay = page.locator('.modal').first();
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveCSS('position', 'fixed');

  const viewport = page.viewportSize();
  const overlayBox = await overlay.boundingBox();
  expect(overlayBox).not.toBeNull();
  expect(overlayBox!.height).toBeGreaterThanOrEqual(viewport!.height - 1);

  const dialogBox = await page.locator('.modal-content').first().boundingBox();
  expect(dialogBox).not.toBeNull();
  const centreOffset = Math.abs(dialogBox!.x + dialogBox!.width / 2 - viewport!.width / 2);
  expect(centreOffset).toBeLessThan(4);

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

    const cards = page.locator('.metrics-grid .metric-card');
    await expect(cards).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      await expect(cards.nth(i).locator('.metric-value')).not.toBeEmpty();
    }

    await expect(page.locator('.card', { hasText: 'Trade History' }).locator('tbody tr')).toHaveCount(14);

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

    await page.locator('.trade-grid select').selectOption('BTC');
    await page.locator('.trade-grid input[placeholder="0.0000"]').fill('0.01');
    await page.locator('.trade-grid .stepper input[placeholder="0.00"]').fill('1000');
    await page.getByRole('button', { name: 'Add Trade' }).click();

    await expect(tradeRows).toHaveCount(15);
    await expect(tradeRows.last()).toContainText('BTC');
    await expect(tradeRows.last()).toContainText('0.01');

    await expect(page.locator('.card', { hasText: 'Current Positions' }).locator('tbody tr', { hasText: 'BTC' })).toBeVisible();

    await expect(page.locator('.balance-value').filter({ hasText: '$12,490.00' })).toBeVisible();
  });

  test('the simulation and analytics pages render without a console error', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/simulation');
    await expect(page.locator('.metric-card').first()).toBeVisible();
    await expect(page.locator('.metrics-grid .metric-card')).toHaveCount(5);
    await expect(page.locator('.alloc-row').first()).toBeVisible();

    await page.goto('/analytics');
    await expect(page.locator('.metric-card').first()).toBeVisible();
    await expect(page.locator('.metrics-grid .metric-card')).toHaveCount(3);

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });
});

test('no endpoint executes arbitrary SQL', async ({ request }) => {
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
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings & Tools' }).click();

  await expect(page.locator('.settings-content .tool-row')).toHaveCount(3);
});

test('the retired GET /api/state aggregation is really gone', async ({ request }) => {
  expect((await request.get('/api/state')).status()).toBe(404);
  expect((await request.get('/api/trades')).status()).toBe(200);
  expect((await request.get('/api/portfolio/valuation')).status()).toBe(200);
});

test('a rejected trade answers 409 for a currency conflict, and 400 for a missing field', async ({ request }) => {
  const conflict = await request.post('/api/trades', {
    data: { symbol: 'BOVA11', side: 'buy', qty: 1, price: 169.27, cashSource: 'USD' },
  });
  expect(conflict.status()).toBe(409);
  const conflictBody = await conflict.json();
  expect(typeof conflictBody.error).toBe('string');
  expect(conflictBody.error.length).toBeGreaterThan(0);
  expect(conflictBody.error).toContain('BOVA11');

  const malformed = await request.post('/api/trades', { data: { symbol: 'BTC', side: 'buy' } });
  expect(malformed.status()).toBe(400);

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

  expect(response.status()).toBe(400);
  const body = await response.json();
  expect(body.problems).toEqual([{ table: 'trades', index: 1, reason: '`qty` must be a finite number' }]);

  const after = await request.get('/api/trades').then((r) => r.json());
  expect(after.length).toBe(tradeCountBefore);
  expect(after.some((t: { id: string }) => t.id === 'ok')).toBe(false);

  const now = await request.get('/api/state/export').then((r) => r.json());
  expect(now.trades.length).toBe(before.trades.length);
});

test('a backup that is not an object is refused before any table is touched', async ({ request }) => {
  const response = await request.post('/api/state/import', { data: ['not', 'a', 'backup'] });

  expect(response.status()).toBe(400);
  expect((await response.json()).problems).toEqual([{ table: '(payload)', index: null, reason: 'must be a JSON object' }]);
  expect((await request.post('/api/state/import', { data: {} })).status()).toBe(200);
});
