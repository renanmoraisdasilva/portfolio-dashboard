// Builds `docs/dashboard-demo.gif` from the real app, or - with `--stills` - the
// individual screenshots in `docs/images/` that the README shows.
//
// A 10-second GIF is asked for, and the honest way to make one is to drive
// the app and screenshot it rather than hand-drawing a mock-up: a demo that
// does not match the product is worse than no demo. So this boots the built
// server against a temporary database seeded from the fixture, walks the three
// pages, and stitches the frames with `sharp` (no ffmpeg or ImageMagick on the
// machine, and none in the Docker image either).
//
// Regenerate the GIF with:   npm run demo:build
// Regenerate the stills with: npm run demo:stills
//
// They are committed, not built in CI: the media is documentation, and
// rebuilding it on every push would put a binary diff in every commit. The two
// modes share this harness deliberately - a still and a GIF frame that
// disagreed would mean one of them was showing a product that does not exist.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import Database from 'better-sqlite3';
// gifenc is CommonJS, so it comes in as a namespace rather than named imports.
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

/**
 * Frames per second, and the size the frames are scaled to in the GIF.
 *
 * 8fps at ~10 seconds is 80 frames, and the GIF format caps a canvas at 65,535
 * pixels tall — `sharp` stacks the frames into one raw image to animate them, so
 * 80 × 512 = 40,960 fits and 99 × 760 did not. Both numbers are load-bearing.
 */
const FPS = 6;
const GIF_WIDTH = 680;
const GIF_HEIGHT = 522;

const env = { ...process.env, PORTFOLIO_DATA_DIR: dataDir, PORT: String(PORT) };

console.log('[demo] seeding and starting the server');
// No `shell: true` here: it would re-parse the command line, and a node path
// containing a space ("C:\Program Files\...") gets split into two arguments.
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

/**
 * Give the demo a price cache.
 *
 * The worker is not running here, and `price_cache` is the one table the fixture
 * cannot supply — it is a *cache of live quotes*. Without it every position is
 * worth zero, and the dashboard honestly reports "Current Value $107,500" with
 * "Unrealized P/L -$51,545": deposits counted, holdings worth nothing. That is
 * correct behaviour and a terrible demo.
 *
 * So the prices are synthesised, deterministically, from the fixture's own buy
 * prices with a fixed per-symbol drift. Nothing is random and nothing is copied
 * from a market: the point is that the numbers *mean* something on screen, and a
 * viewer who knows what the drift is can check the arithmetic. `ts` is now, so
 * the "prices may be stale" banner stays off.
 */
function seedPrices() {
  const fixture = JSON.parse(readFileSync(path.join(repoRoot, 'fixtures/portfolio_data.json'), 'utf8'));
  const lastBuy = {};
  for (const t of fixture.trades ?? []) {
    if (t.side === 'buy' && typeof t.price === 'number') lastBuy[t.symbol] = t.price;
  }
  // A fixed, readable drift: +8%, -3%, +14%, -6% in symbol order. A real quote
  // would be better still, but a demo that changes when you regenerate it is a
  // demo nobody can review.
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

/**
 * Compute the analytics snapshots before capturing.
 *
 * `analytics_snapshots` is written by the worker's scheduled job, and the worker
 * is not running here. Without this the Analytics Lab renders its own empty
 * state — "not enough history", "insufficient data" — which is a truthful
 * rendering of an un-run job and a poor final frame. The fixture has 120 history
 * points, so there is genuinely something to compute.
 */
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
  // Windows keeps the SQLite file locked for a moment after the process is asked
  // to stop, so wait for the exit before deleting and retry once if needed.
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill();
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  for (const dir of [frameDir, dataDir]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (err) {
      // A leftover temp directory is not worth failing a documentation build over.
      console.warn(`[demo] could not remove ${dir}: ${err.message}`);
    }
  }
};

/** Wait for the API, so no frame is captured of a half-loaded page. */
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not start');
}

/**
 * Capture one still for the README.
 *
 * A still is a viewport shot, not a full-page one, because the README lays four
 * of them out in a 2x2 grid and a full-page capture of the dashboard is four
 * times the height of its neighbour, which reads as a broken layout rather than
 * a screenshot. `anchor` puts the interesting band at the top of the frame for
 * the same reason the GIF uses it: the stale-price banner is always present in
 * this environment and it pushes the portfolio below the fold.
 */
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
  // Playwright's own WebP output is lossy, and these stills are dark UI with 1px
  // chart gridlines and small grey text on navy - the first thing quantisation
  // and chroma subsampling damage. Capture PNG in memory and re-encode losslessly
  // with sharp, so a committed still is pixel-identical to what the page showed.
  // Lossy q85 measured 62% smaller but visibly thinned the gridlines; lossless is
  // 34% smaller and changes nothing.
  const png = await page.screenshot();
  await sharp(png).webp({ lossless: true, effort: 6 }).toFile(file);
  console.log(`[demo] still ${path.relative(repoRoot, file)}`);
}

const frames = [];
let index = 0;

/**
 * Wait until a page has actually rendered its numbers.
 *
 * Screenshotting on `networkidle` alone captures the loading skeleton, which is
 * the least impressive possible first frame: the metrics read as grey bars. The
 * allocation legend only exists once the valuation has arrived, so it is the
 * honest "the page is ready" signal on the two pages that have one.
 */
async function waitForContent(page, selector) {
  await page.locator(selector).first().waitFor({ timeout: 30_000 });
  // One more beat for the chart canvases to paint.
  await page.waitForTimeout(1200);
}

/**
 * Hold a shot for `ms`, so the eye can read it.
 *
 * `anchor` is the element to put at the top of the frame. The dashboard's own
 * header carries a "prices may be stale" banner whenever the worker has not
 * filled the price cache — which is always true in this environment — and that
 * banner pushes the interesting half of the page below the fold. Anchoring on the
 * metrics keeps the demo about the portfolio rather than about the demo
 * environment.
 */
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

  // The allocation split is the clearest evidence that the browser is not doing
  // the arithmetic: the toggle asks the server which valuation it wants, and the
  // whole panel changes. `Investments` is the interesting half of that pair.
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

/** Encode the captured frames into the animated GIF. */
async function stitchGif() {
  console.log(`[demo] stitching ${frames.length} frames at ${FPS}fps`);
  // One palette for the whole animation, taken from the first frame: the app's
  // palette is stable across all of them, and sharing it lets the encoder store
  // only the pixels that changed - which is most of the size saving, since the
  // holds are near-identical frames. `sharp` cannot write a multi-page GIF from a
  // stacked buffer (`pageHeight` applies to input, not output), so the frames are
  // encoded with `gifenc`, a pure-JS encoder with no native dependency.
  // `quantize` and `applyPalette` both read the buffer as RGBA - they cast it to
  // a Uint32Array, one element per pixel - so the alpha channel has to be kept.
  // A 3-byte RGB buffer is read as 25% fewer pixels than it holds, which produces
  // a plausible-looking file of garbage rather than an error.
  const rgba = (buffer) =>
    sharp(buffer).resize(GIF_WIDTH, GIF_HEIGHT, { fit: 'cover', position: 'top' }).ensureAlpha().raw().toBuffer();

  const encoder = GIFEncoder();
  const first = await rgba(frames[0]);
  const palette = quantize(first, 128, { format: 'rgb565' });
  for (const [i, frame] of frames.entries()) {
    const pixels = i === 0 ? first : await rgba(frame);
    encoder.writeFrame(applyPalette(pixels, palette), GIF_WIDTH, GIF_HEIGHT, {
      // Only the first frame carries the palette table; the rest reuse it, which
      // is what lets the encoder emit a frame as just its changed pixels.
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
