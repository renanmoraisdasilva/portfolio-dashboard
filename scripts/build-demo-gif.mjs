import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import Database from 'better-sqlite3';
import gifenc from 'gifenc';

const { GIFEncoder, applyPalette, quantize } = gifenc;

const STILLS = process.argv.includes('--stills');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, 'docs');
const imgDir = path.join(outDir, 'images');
const frameDir = mkdtempSync(path.join(tmpdir(), 'demo-frames-'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'demo-data-'));

const WIDTH = 1120;
const HEIGHT = 860;
const PORT = 3211;

const FPS = 6;
const GIF_WIDTH = 680;
const GIF_HEIGHT = 522;

const env = { ...process.env, PORTFOLIO_DATA_DIR: dataDir, PORT: String(PORT) };

console.log('[demo] seeding and starting the server');
const seed = spawnSync(
  process.execPath,
  [path.join(repoRoot, 'apps/api/dist/seed.js'), path.join(repoRoot, 'fixtures/portfolio_data.json')],
  {
    stdio: 'inherit',
    env,
  },
);
if (seed.status !== 0) {
  throw new Error('seeding failed; the demo would capture an empty portfolio');
}

function seedPrices() {
  const fixture = JSON.parse(readFileSync(path.join(repoRoot, 'fixtures/portfolio_data.json'), 'utf8'));
  const lastBuy = {};
  for (const t of fixture.trades ?? []) {
    if (t.side === 'buy' && typeof t.price === 'number') lastBuy[t.symbol] = t.price;
  }
  const drift = [1.08, 0.97, 1.14, 0.94, 1.05, 1.11, 0.98, 1.06];
  const now = Date.now();
  const db = new Database(path.join(dataDir, 'portfolio.db'));
  const insert = db.prepare('INSERT OR REPLACE INTO price_cache (symbol, price, ts, meta) VALUES (?, ?, ?, ?)');
  const symbols = Object.keys(lastBuy);
  symbols.forEach((symbol, i) => {
    const price = +(lastBuy[symbol] * drift[i % drift.length]).toFixed(2);
    insert.run(symbol, price, now, null);
  });
  insert.run('BRLUSD', 0.18, now, null);
  insert.run('SPY', 512.4, now, null);
  db.close();
  console.log(`[demo] synthesised prices for ${symbols.length + 2} symbols`);
}
seedPrices();

const analytics = spawnSync(
  process.execPath,
  [
    '-e',
    "require('./apps/api/dist/services/analyticsService.js').refreshAllPeriods().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); })",
  ],
  { stdio: 'inherit', env, cwd: repoRoot },
);
if (analytics.status !== 0) console.warn('[demo] analytics refresh failed; the analytics page will show its empty state');

const server = spawn(process.execPath, [path.join(repoRoot, 'apps/api/dist/web.js')], { stdio: 'inherit', env });

const stop = async () => {
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill();
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  for (const dir of [frameDir, dataDir]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (err) {
      console.warn(`[demo] could not remove ${dir}: ${err.message}`);
    }
  }
};

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not start');
}

async function shootStill(page, name, anchor) {
  if (!STILLS) return;
  if (anchor) {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 16 });
    }, anchor);
    await page.waitForTimeout(400);
  }
  mkdirSync(imgDir, { recursive: true });
  const file = path.join(imgDir, `${name}.webp`);
  const png = await page.screenshot();
  await sharp(png).webp({ lossless: true, effort: 6 }).toFile(file);
  console.log(`[demo] still ${path.relative(repoRoot, file)}`);
}

const frames = [];
let index = 0;

async function waitForContent(page, selector) {
  await page.locator(selector).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200);
}

async function hold(page, ms = 900, anchor) {
  if (anchor) {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 16 });
    }, anchor);
    await page.waitForTimeout(250);
  }
  const shots = Math.max(1, Math.round((ms / 1000) * FPS));
  for (let i = 0; i < shots; i++) {
    const file = path.join(frameDir, `frame-${String(index++).padStart(3, '0')}.png`);
    await page.screenshot({ path: file });
    frames.push(file);
  }
}

try {
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });

  console.log('[demo] dashboard');
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await waitForContent(page, '.alloc-row');
  await hold(page, 3400, '.metrics-grid');
  await shootStill(page, 'dashboard', '.metrics-grid');

  const investments = page.locator('.alloc-seg button', { hasText: 'Investments' });
  if (await investments.count()) {
    await investments.first().click();
    await page.waitForTimeout(900);
    await hold(page, 1800, '.metrics-grid');
    await shootStill(page, 'allocation-investments', '.alloc-wrap');
    await page.locator('.alloc-seg button', { hasText: 'With Cash' }).first().click();
    await page.waitForTimeout(600);
  }

  console.log('[demo] simulator');
  await page.goto(`http://127.0.0.1:${PORT}/simulation`);
  await waitForContent(page, '.alloc-row');
  await hold(page, 2600, '.metrics-grid');
  await shootStill(page, 'simulator', '.metrics-grid');

  console.log('[demo] analytics');
  await page.goto(`http://127.0.0.1:${PORT}/analytics`);
  await waitForContent(page, '.metrics-grid .metric-card .metric-value');
  await hold(page, 2800);
  await shootStill(page, 'analytics', '.metrics-grid');

  await browser.close();

  if (STILLS) {
    console.log(`[demo] wrote stills to ${path.relative(repoRoot, imgDir)} (no GIF in --stills mode)`);
  } else {
    await stitchGif();
  }
} finally {
  await stop();
}

async function stitchGif() {
  console.log(`[demo] stitching ${frames.length} frames at ${FPS}fps`);
  const rgba = (buffer) =>
    sharp(buffer).resize(GIF_WIDTH, GIF_HEIGHT, { fit: 'cover', position: 'top' }).ensureAlpha().raw().toBuffer();

  const encoder = GIFEncoder();
  const first = await rgba(frames[0]);
  const palette = quantize(first, 128, { format: 'rgb565' });
  for (const [i, frame] of frames.entries()) {
    const pixels = i === 0 ? first : await rgba(frame);
    encoder.writeFrame(applyPalette(pixels, palette), GIF_WIDTH, GIF_HEIGHT, {
      ...(i === 0 ? { palette } : {}),
      delay: 1000 / FPS,
    });
  }
  encoder.finish();
  const animated = Buffer.from(encoder.bytes());

  mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, 'dashboard-demo.gif');
  writeFileSync(target, animated);
  console.log(
    `[demo] wrote ${path.relative(repoRoot, target)} (${(animated.length / 1024).toFixed(0)} kB, ` +
      `${frames.length} frames, ${(frames.length / FPS).toFixed(1)}s)`,
  );
}
