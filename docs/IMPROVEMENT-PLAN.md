# Improvement Plan

A working document. Not documentation of the product — see `AGENTS.md` for that
distinction. This file records defects found in a senior-level code review, the
reasoning behind each, and the order they should be fixed in. Delete each item
as it lands, or strike it with a note explaining why it was dropped.

Every item was verified against the code at commit `0ae1c91`. Where a defect
was confirmed by executing it rather than by reading it, the item says so, and
the reproduction is included.

## Status legend

| Marker        | Meaning                                       |
| ------------- | --------------------------------------------- |
| **CONFIRMED** | Reproduced by running the code                |
| **VERIFIED**  | Traced to a specific line by reading the code |
| **DECISION**  | Needs a judgement call, not just a patch      |

---

# Phase 0 — User-visible regression (fix first)

## 0.1 The settings gear renders its content at the bottom of the page instead of as a popup

**Status: CONFIRMED. Regression, introduced 2026-10-01 in `dee40ef`.**

### Symptom

Clicking the ⚙ gear in the header puts the "Settings & Tools" dialog — and the
delete-trade confirmation — at the **bottom of the document**, as unstyled static
block content, instead of overlaying the page in a centred popup. There is no
overlay backdrop, no centring, and the dialog scrolls with the document.

### Root cause

The modal is rendered by the **shell**, not by a page:

```
apps/web/src/App.vue:44-46
    <RouterView />          <-- renders .dashboard-page / .analytics-page / .simulation-page
    <SettingsModal />       <-- sibling of RouterView, never inside a page root
```

So the elements carrying `.modal` / `.modal-content` are **not descendants of
`.dashboard-page`** — on any route, ever.

The rules that style them are nevertheless scoped to a page:

```
static/css/dashboard.css:871   .dashboard-page .modal {
static/css/dashboard.css:880   .dashboard-page .modal-content {
static/css/dashboard.css:889   .dashboard-page .modal-content button {
static/css/simulation.css:363  .simulation-page .modal {
static/css/simulation.css:372  .simulation-page .modal-content {
static/css/simulation.css:380  .simulation-page .modal-content h2 {
static/css/simulation.css:384  .simulation-page .modal .row {
static/css/simulation.css:390  .simulation-page .modal .actions {
static/css/simulation.css:395  .simulation-page .modal table {
static/css/simulation.css:400  .simulation-page .modal th,
static/css/simulation.css:401  .simulation-page .modal td {
static/css/simulation.css:405  .simulation-page .modal .small {
```

Every one of those selectors has a descendant combinator against a page root the
element is not inside. **All of them are dead code.** The gear is broken
unconditionally, not intermittently.

### How it happened

`79b2e09` scoped the page stylesheets and hit exactly this problem, then
deliberately exempted the modal. `dashboard.css` carried this comment at the
time:

```css
/* `.modal` and `.modal-content` are deliberately NOT scoped to
  `.dashboard-page`. The settings modal is mounted by the shell (`App.vue`), so
  it sits inside no page wrapper - scoping these two left it rendering as
  unstyled static block content the moment the gear was clicked. Anything used
  only by this page can be scoped; anything the shell renders cannot. */
.modal { ... }
```

`dee40ef` ("scope each selector once, which the first pass did not") then
**re-scoped them anyway and deleted that comment**:

```diff
-/* `.modal` and `.modal-content` are deliberately NOT scoped to
-.modal {
+.dashboard-page .modal {
-.modal-content {
+.dashboard-page .modal-content {
-.modal-content button {
+.dashboard-page .modal-content button {
```

The same commit did fix a genuine adjacent bug — `.simulation-page .modal
.simulation-page .row` had a double page-root prefix — so the change was not
careless. It over-applied a rule whose one documented exception it also removed.
`AGENTS.md:396-400` still states the exception; the code now contradicts it.

### The second, independent failure

`.modal` lives in `dashboard.css`, which reaches the browser only as a **side
effect of `DashboardView.vue:19`**:

```ts
import '../../../../static/css/dashboard.css';
```

`apps/web/index.html` links only `base.css`, `components.css` and `layout.css`
globally. So on a direct load or client-side navigation to `/analytics` or
`/simulation`, `dashboard.css` is never fetched and the dialog has **no styling
whatsoever** — not even from a correctly-scoped rule.

This is the same class of bug as the one `AGENTS.md:384-403` documents: a
stylesheet owned by a view, injected as a side effect, never removed. The scoping
work fixed the _collision_ half of that problem and left the _availability_
half.

### Fix

1. **Move** `.modal`, `.modal-content` and `.modal-content button` out of
   `dashboard.css` into `static/css/components.css`, **unscoped**.
   `components.css` is linked in `index.html`, so it is present on every route
   regardless of which view chunk has loaded. It is a shell-level concern and
   that is where shell-level styles already live.
2. **Delete** the ten dead `.simulation-page .modal*` rules in
   `static/css/simulation.css:363-407`. They are superseded by the move in (1)
   and can never match.
3. **Restore** the explanatory comment at the new location, in the same words as
   the one `dee40ef` removed, so the next scoping pass inherits the exception
   rather than rediscovering it. Add a line to `AGENTS.md` naming `.modal` and
   `.modal-content` as permanent members of that list.
4. **Add a test that fails if this recurs.** See 5.1 below — the CSS-side
   regression is only catchable by asserting the selector, not the pixels.

### Verify

- Load `/analytics` directly (no prior navigation). Click the gear. It must
  overlay with a backdrop and be centred.
- Load `/` then `/simulation`. Click the gear. Same.
- Trigger the delete-trade confirmation from the trade history. Same.
- `grep -n '\.modal' static/css/*.css` — no modal rule may be scoped to a page
  root.

---

# Phase 1 — Data integrity

## 1.1 `asset_chart_cache` has no primary key, so `INSERT OR REPLACE` appends duplicates

**Status: CONFIRMED by execution.**

`apps/api/src/schema.ts:55-67` documents a constraint that does not exist:

```ts
export const assetChartCache = sqliteTable(
  'asset_chart_cache',
  {
    symbol: text('symbol').notNull(),
    days: integer('days').notNull(),
    interval: text('interval').notNull(),
    ts: integer('ts'),
    data: text('data'),
  },
  () => [
    // Composite PK expressed as a unique index (Drizzle handles composite PKs via primaryKey() helper)
  ],
);
```

The callback returns `[]`. Migration `0000_aspiring_virginia_dare.sql:32-38`
confirms it — four columns, no `PRIMARY KEY`, no `UNIQUE`. Reproduction against
real SQLite, running the exact statements from `priceFetcher.ts`:

```
rows in table: 2          <-- after two INSERT OR REPLACE of the same key
cache read returns ts: 1000  <-- the OLD row, not the new one
```

With no conflict target, `OR REPLACE` degrades to a plain `INSERT`. The read at
`priceFetcher.ts:225` has no `ORDER BY`, so it scans in rowid order and returns
the **oldest** matching row, forever.

Consequences, all of them compounding:

- The cache never refreshes. It serves the first row ever written.
- Once that row ages past its TTL, **every** request refetches from Yahoo and
  appends another row that the read will never look at.
- The table grows without bound.
- Every asset chart request hits Yahoo's API — a self-inflicted rate limit.

This contradicts `AGENTS.md:307` ("rows are overwritten in place") and the
`schema.ts` comment.

### Fix

```ts
import { primaryKey } from 'drizzle-orm/sqlite-core';

export const assetChartCache = sqliteTable(
  'asset_chart_cache',
  {
    symbol: text('symbol').notNull(),
    days: integer('days').notNull(),
    interval: text('interval').notNull(),
    ts: integer('ts'),
    data: text('data'),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.days, t.interval] })],
);
```

Then `npm run db:generate`, review the emitted SQL (it must dedupe existing
duplicates before creating the constraint — handle that explicitly rather than
letting the migration fail), and commit the `.sql`.

`priceFetcher.ts:261` and `:305` need no change once the constraint exists;
verify `INSERT OR REPLACE` now actually replaces.

### Verify

Integration test: call `fetchAndCacheAssetHistory` twice with a faked Yahoo
response and assert `SELECT COUNT(*) FROM asset_chart_cache` is `1`, and that
the second call returns the newer `ts`. The current test
(`priceFetcher.test.ts:50`) fakes the database and therefore cannot see this.

## 1.2 `priceFetcher.ts` caches a fetch failure as if it were data

**Status: VERIFIED.**

`priceFetcher.ts:301-311`:

```ts
if (!success) {
  console.warn(`Yahoo history: no valid data for ${symbol} after trying candidates: ...`);
}
await run('INSERT OR REPLACE INTO asset_chart_cache ...', [
  symbol,
  days,
  interval,
  now,
  JSON.stringify({ labels: result.labels, prices: result.prices }),
]);
```

When every candidate ticker fails — network blip, HTTP 429, malformed response —
the function writes `{labels: [], prices: []}` with a **fresh** timestamp. The
TTL check at `:230` then treats it as a valid cache hit for the next 15 minutes
(`1h` interval) or 1 hour (`1d`). One transient failure yields an empty chart
that persists, with no error surfaced to the client.

### Fix

Return early without writing when `!success`. Serve the empty result to the
caller (so the response shape is unchanged) but leave the existing cache row
untouched, so the next request retries.

### Verify

Test with all candidates failing: assert the response is empty **and** that no
row was written.

## 1.3 `POST /api/trades` is not transactional — the same defect `DELETE` was fixed for

**Status: VERIFIED.**

`trades.ts:125-135` writes the cash row, then the trade row, with no `BEGIN`:

```ts
const cashEntry = await createAutoCashEntry(symbol, side, qty, price, t);
await run('INSERT INTO trades (id, symbol, side, qty, price, time, cash_entry_id) VALUES (...)', [...]);
```

The comment justifies the ordering but conflates _same INSERT_ with _same
transaction_. If the `trades` INSERT throws — `id`, `symbol`, `side`, `qty` and
`time` are all `NOT NULL` (`schema.ts:6-15`) — the cash row is stranded
permanently.

That is precisely the defect `trades.cash_entry_id` was added to close, and
precisely what the `DELETE` handler at `trades.ts:163-173` wraps in a
transaction to prevent. `trades.test.ts` covers the DELETE transaction
(`'the whole reversal is one transaction, so a failure cannot half-apply it'`)
and has no equivalent for POST. The asymmetry survived because POST was written
first and never revisited.

### Fix

Wrap the cash insert and the trade insert in one transaction, using the same
`BEGIN` / `COMMIT` / `ROLLBACK` shape as `DELETE` — or, better, see 3.1, use
`sqlite.transaction()` and delete both hand-rolled blocks.

### Verify

Test that a failing `trades` INSERT leaves no cash row. Force the failure with a
duplicate `id` (insert the same trade twice through a fixed id, or stub
`randomUUID`) rather than by mocking the database.

## 1.4 `invalidateResponseCaches()` races with in-flight loads

**Status: VERIFIED.**

`apps/api/src/services/responseCache.ts`:

```ts
export function invalidateResponseCaches(): void {
  cache.clear(); // does not touch `inFlight`
}
```

Sequence:

1. `GET /api/analytics` misses, starts `loader()`, sets `inFlight`.
2. A trade commits; `app.ts:31-38` fires `invalidateResponseCaches()` on any
   successful write → `cache.clear()`.
3. The loader resolves with **pre-trade** data and calls `cache.set(key, data)`.
4. Every subsequent read is stale for the full TTL.

**There is no test file for `responseCache.ts` at all.**

Secondary defect, same file, line 13: `cacheHitsTotal.inc({ cache: key })` fires
for a coalesced in-flight _miss_. Request coalescing is counted as a cache hit,
so the `cache_hits_total` metric — the one number an operator would use to judge
this cache — is inflated and meaningless.

### Fix

- Track a generation counter, bumped by `invalidateResponseCaches()`. Capture it
  before `loader()` and only `cache.set` if it has not changed.
- Alternatively, have `invalidateResponseCaches()` clear `inFlight` as well, and
  have `getOrSetResponse` skip `cache.set` when its `inFlight` entry was
  evicted mid-flight.
- Split the metric: `cacheHitsTotal` for real hits, a separate
  `cacheCoalescedTotal` for in-flight dedup.

### Verify

New `responseCache.test.ts`: start a load that resolves after an invalidation;
assert the cache does not serve the stale value.

## 1.5 `alerts.is_dismissed` is nullable and compared with `=== 0`

**Status: VERIFIED.**

`priceFetcher.ts:343`:

```ts
const alreadyTriggered = alert.triggered_at !== null && alert.triggered_at !== undefined && alert.is_dismissed === 0;
```

`schema.ts:137` declares `is_dismissed: integer('is_dismissed').default(0)` —
nullable, no `NOT NULL`. A row restored from a backup, or any insert that omits
the column, holds `NULL`. `null === 0` is `false`, so `alreadyTriggered` is
`false` and **the alert re-notifies on every 8-minute cycle, forever**.

This is the same root cause as the `history_points.brlusd_rate` NULL pitfall
documented at `AGENTS.md:312` — the pattern has recurred.

### Fix

Migration to `NOT NULL DEFAULT 0`, plus a defensive read
(`alert.is_dismissed ?? 0`). Apply the same treatment to `is_active` on the same
table while the migration is open.

### Verify

Insert an alert omitting `is_dismissed`, run `checkAndTriggerAlerts` twice,
assert the notification fires once.

---

# Phase 2 — Contract and robustness

## 2.1 `POST /api/state/import` has no input validation

**Status: VERIFIED.**

`state.ts:96-297` writes rows straight from `req.body`. `trades.id` is
`text PRIMARY KEY NOT NULL` (migration `0000`) and `:125` writes `t.id ?? null`,
so a payload row missing an id inserts `NULL` into a `NOT NULL` primary key. The
statement throws, the outer `ROLLBACK` fires, and the response is a bare
`500 {error: 'Failed to import state'}` — with no indication of which of ~10,000
rows was bad, because no row index is carried.

`state.test.ts` has twelve import tests. **None sends a malformed payload**;
all are well-formed round-trips.

### Fix

- Validate the payload shape at the top of the handler: reject a non-object,
  reject non-array values for keys the tables require, and reject rows missing
  required columns — each with a message naming the table and the row index.
- Wrap the per-row insert so one bad row reports `{ table, index, reason }`
  rather than a generic 500.
- Consider a `400` for a structurally invalid payload versus `500` for a genuine
  database failure, so a client can distinguish "your file is wrong" from "the
  server broke".

### Verify

Three tests: a trade with no `id`; a `trades` value that is not an array; a row
with a non-numeric `qty`. Each asserts a specific message, not just a 4xx/5xx.

### What was done

`statePayload.ts` holds the rules; `state.ts` calls it before the transaction
opens and answers `400` with `{ error, problems, omitted }`. 61 tests across
`statePayload.test.ts` (53) and `state.test.ts` (8 new).

- **Every problem is reported, not the first.** The validator runs to completion
  before any write, so one pass tells the user everything. A validator that throws
  on the first problem makes a user fix one row per attempt on a file they may not
  be able to edit.
- **The report is capped at 20 and the overflow is counted.** The cap applies to
  the _report_, never to the checking — a truncated list that omitted the checking
  would let rows through unvalidated, which is the opposite of the point. `omitted`
  is sent so a short list never reads as complete.
- **Uniqueness is checked, because the database cannot catch it.**
  `idx_interest_month_currency` and `idx_analytics_snapshots_period` are unique,
  and both writes are `INSERT OR REPLACE` — so a duplicate in the payload is not a
  constraint violation, it is the second row silently replacing the first. A month
  of income disappears with no error. That is now a 400 naming the index.
- **The client's own shape check contradicted the endpoint.** `importData` required
  `trades` _and_ `history` to be arrays before sending, so a partial backup — which
  the endpoint deliberately supports and `state.test.ts` tests — was rejected in the
  browser and never reached the server that would have handled it. Only "is this an
  object" is checked client-side now; the rules live in one place.

### The client half, which is where the value actually lands

A 400 carrying a list of rows achieves nothing if the client still reports
`POST /api/state/import failed with 400: Import payload is not a valid backup`.
`importErrorMessage` in `dashboard.ts` renders one problem per line, and the toast
needed two changes to make that legible: `white-space: pre-line` on `.toast`
(without it the newlines collapse into one run-on sentence) and a timeout that
scales with the message length, because the default 4s is not enough to read a list
— and a user cannot act on a list they did not see.

### Two claims in the review were wrong, and the corrections matter

**"`trades.id` is `NOT NULL`, so a missing id throws."** The conclusion was right
but the _significance_ was not, and the first draft of the validator reasoned from
it backwards. Migration `0000` does declare `id text PRIMARY KEY NOT NULL`, and a
NULL id is rejected — but the reason to check it here is not integrity. The
database's error names no table, row or field, so the whole restore rolls back and
the response is a bare 500. The check moves that information from _unavailable_ to
_in the response_, and nothing more.

**"A numeric string in `asset_chart_cache.days` would never match the reader."**
Measured against the real DDL: `"30"` **is** converted by INTEGER affinity and **is**
found by `WHERE days = 30`. The claim was wrong, and the test built on it would have
pinned a false rationale. What is actually true is sharper:

| inserted                    | stored as | `WHERE days = 30` finds it |
| --------------------------- | --------- | -------------------------- |
| `5`                         | real 5    | n/a                        |
| `"5"`                       | real 5    | **yes** — affinity repairs |
| `"abc"` / `"thirty"` / `""` | TEXT      | **never**                  |

A `REAL`/`INTEGER` column does not reject a bad value — it converts what it can and
keeps the rest as TEXT, and `SUM` skips TEXT outright. So one non-numeric
`interest.amount` lowers recorded income with nothing anywhere reporting it. That
is the real silent-corruption path, and it is what the numeric rules now rest on.

**Method note:** two of the three "this would restore silently wrong" cases
survived checking, and one did not. Every such claim is now stated as a measurement
against the real column definitions rather than as a deduction from the schema.

## 2.2 `interest` is replaced per currency, not wholesale

**Status: VERIFIED.**

`state.ts:161` and `:172`:

```ts
await run('DELETE FROM interest WHERE currency = ?', ['BRL']);
await run('DELETE FROM interest WHERE currency = ?', ['USD']);
```

Only two currencies are ever cleared. A row in a third currency survives every
restore, indefinitely. This contradicts the "import **replaces** every table the
payload carries" contract asserted in the `AGENTS.md` route table, and the same
file's own comment at `state.ts:99-103`.

It also connects to the fragile conversion `AGENTS.md:302-306` already flags:
`analyticsService` books any non-BRL row as USD at 1:1.

### Fix

**DECISION.** Either `DELETE FROM interest` unconditionally when the payload
carries either months key, or document the per-currency semantics honestly in
`AGENTS.md` and in the route's own docstring. The current behaviour is
undocumented and almost certainly not intended.

## 2.3 No graceful shutdown anywhere

**Status: VERIFIED.** No `SIGTERM`/`SIGINT` handler, no `server.close()`, no
`sqlite.close()` — the only `.close()` calls in the tree are in test files.

`web.ts:14` discards the `app.listen` return value, so graceful shutdown is not
even possible without changing that line.

This matters specifically because `AGENTS.md:223-231` documents a real incident
caused by relying on clean-close WAL checkpoints — copying `portfolio.db` alone
captured a 7-week-old state — and states that "a checkpoint happens when the last
connection closes cleanly". **There is currently no code path in which the
database is ever closed cleanly.**

On `docker stop` the process takes the default SIGTERM action: no request drain
(so the reverse proxy can return 502 mid-deploy) and no WAL checkpoint.

### Fix

- Keep the `http.Server` handle from `app.listen`.
- On `SIGTERM`/`SIGINT`: `server.close()`, await in-flight requests, then
  `sqlite.close()`, then `process.exit(0)` with a hard timeout fallback.
- `telemetry.ts` should also flush — `NodeSDK` exposes `shutdown()`.

### Verify

`docker stop` the CI image with a request in flight; assert a clean shutdown log
and that `portfolio.db-wal` is checkpointed afterwards.

## 2.4 Prometheus label cardinality is unbounded

**Status: VERIFIED.**

`metrics.ts:39`:

```ts
function routeLabel(req: Request): string {
  return req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
}
```

When no route matches, the label falls back to the raw request path. Every
unmatched `GET /api/<anything>` therefore creates a new time series. On a public
host with `/metrics` unauthenticated (`app.ts:39`), a scanner or a curious user
can grow the registry without limit until the process is OOM-killed.

### Fix

Fall back to a constant (`'unmatched'`) rather than `req.path`. Also add
`helmet`, and put `/metrics` behind the same auth or network policy as the rest
of the deployment.

## 2.5 Unrestricted CORS and an unauthenticated `/metrics`

**Status: VERIFIED.** `app.ts:28` applies `cors()` with no origin allowlist;
`app.ts:39` exposes `/metrics` on the same public port.

Acceptable for a single-user dashboard on a private network, and defensible as a
deliberate trade — but it is currently a decision with no comment recording that
it is one. Either constrain it or document why it is open.

## 2.6 `prices.ts` reaches into the worker's module, dynamically, for one constant

**Status: VERIFIED.**

```ts
const pf = await import('../services/priceFetcher');
obj.cacheTTLms = pf.STALE_AFTER_MS || 1_440_000;
```

A web request handler dynamically imports the **worker's** fetcher module — which
pulls in `homeAssistantService` and all its top-level configuration — solely to
read `STALE_AFTER_MS`, then wraps it in a `try/catch` that silently substitutes
a hardcoded fallback.

Two clients of one constant should be a shared config module or a static import.
As written, the wire format's staleness threshold can differ between deployments
with nothing logged.

### Fix

Move `CACHE_TTL` and `STALE_AFTER_MS` to `apps/api/src/config/` and import them
statically in both `priceFetcher.ts` and `routes/prices.ts`.

### Done — and the review's stated consequence was wrong

`apps/api/src/config/priceFreshness.ts` now holds all four numbers, imported
statically by both callers. The dynamic `import()` is gone.

**The claim that "the wire format's staleness threshold can differ between
deployments with nothing logged" is false.** It rests on the fallback winning when
the import failed, and the fallback is `1_440_000` — which is exactly
`3 * (8 * 60 * 1000)` = `STALE_AFTER_MS`. Both branches sent the same number, so no
deployment could have shipped a different threshold. Verified in node, not assumed.

What the duplication actually risked is the ordinary thing: someone tunes
`CACHE_TTL`, `STALE_AFTER_MS` moves, and the literal does not. **Nothing would have
caught that**, because `prices.ts` had no test at all — which is the real finding
here, and it is not in the original review.

So `prices.test.ts` is new (6 tests) and pins the wire value to the constant. The
honest limit of that: a literal equal to _today's_ constant is indistinguishable
from correct behaviour at runtime, so no runtime assertion can catch it. Removing
the possibility structurally is the fix; the test is the secondary guard. The
constant's _value_ is pinned separately in `priceFetcher.freshness.test.ts` — the
mutation `CACHE_TTL` 8min → 10min was confirmed to fail there and _pass_ here,
which is the division of labour the two suites now have.

### One thing deliberately not "fixed"

`ASSET_HISTORY_CACHE_TTL_MS['1d']` is `60 * 60 * 1000` — one hour, under a key
reading `1d`. It moved here too, and it is tempting to read as an
off-by-a-factor-of-24 bug. It is not: the key names the **candle interval**, and
`AGENTS.md` records the daily series as cached for an hour. "Correcting" it to 24h
would have silently quadrupled the Yahoo request rate. The comment now says so at
the constant, because that is the reading a future maintainer needs.

## 2.7 The SQL Explorer's read-only guard is not a permission check

**Status: VERIFIED — checked, and it holds, but for the wrong reason.**

`sqlExplorer.ts:14-15`:

```ts
export function isSelectQuery(sql: string): boolean {
  return /^\s*(SELECT|EXPLAIN|PRAGMA|WITH)\b/i.test(sql.trim());
}
```

The obvious bypass is a write hidden behind a CTE — `WITH x AS (...) INSERT INTO
...`. I tested it: `better-sqlite3`'s `.all()` throws
`"This statement does not return data. Use run() instead"`, so the driver closes
the hole, not this function. `stmt.prepare()` also rejects multi-statement
strings. The guard is not load-bearing.

It still reads like a security boundary, which is the problem: a future
refactor that swaps the driver, or someone reading only this function, will
reasonably assume the app is enforcing read-only.

The genuine exposure is the one the code already admits at `app.ts:81-83` — with
`ENABLE_SQL_EXPLORER=true`, `DELETE FROM cash` reaches the `run()` branch at
`sqlExplorer.ts:87` and executes, unauthenticated, over HTTP.

### Fix

Rename to `returnsRows()` so it advertises what it decides, and add a comment
recording that `better-sqlite3` is the actual enforcement. Consider a second
gate on the write branch (a distinct env var, or requiring a
`X-Confirm-Arbitrary-Writes` header) so enabling read-only SQL does not
implicitly enable writes.

## 2.8 The e2e suite does not cover the failure paths that matter

**Status: VERIFIED.** The Playwright suite is genuinely good — it asserts
server-side invariants, tests the SQL gate, and tests that retired endpoints are
really gone. It has no coverage of: a rejected trade (the 409 path), a failed
import, a stale-price warning, or an error state in any view.

Add at least the rejected-trade flow, since that is the one place the
documented `ApiError.isConflict` contract is exercised end to end.

---

# Phase 3 — Architecture and structure

## 3.1 The promisified database helpers are the root architectural problem

**Status: VERIFIED.**

`db.ts:28-40` wraps a **synchronous** driver in promises:

```ts
export function run(sql: string, params: any[] = []): Promise<void> {
  return Promise.resolve().then(() => {
    sqlite.prepare(sql).run(...params);
  });
}
```

This buys no parallelism — none is possible — and costs three things:

1. **No statement cache.** `sqlite.prepare(sql)` re-parses and re-compiles on
   every call. `state.ts` inserts in a loop, so a full restore is O(rows)
   statement preparations.
2. **Hand-rolled transactions.** `BEGIN`/`COMMIT` are issued as prepared
   statements and awaited individually. If the `ROLLBACK` at `state.ts:299`
   itself throws, it replaces `innerErr` and destroys the diagnostic the operator
   needs.
3. **Transaction scope spans `await` boundaries.** Here it is benign —
   microtask draining prevents a new I/O handler from interleaving — but the
   code depends on that invariant without stating it. `sqlite.transaction()` makes
   it structural instead of incidental.

### Fix

Adopt `sqlite.transaction()` and reuse prepared statements. Keep the `run/get/all`
signatures as a thin compatibility layer during the migration, then delete the
layer. This retires 1.3, and half of 3.2, at the same time.

## 3.2 `db.ts` reimplements migration logic by hand

**Status: VERIFIED.**

`db.ts:46-93` (`ensureLegacyTablesExist`) hand-writes `CREATE TABLE` and
`ALTER TABLE ... RENAME` for four tables. `db.ts:101-136`
(`seedDrizzleMigrationsIfNeeded`) reads `_journal.json`, hashes the last SQL file
with SHA-256, and inserts a synthetic `__drizzle_migrations` row.

This is a second migration engine living beside Drizzle's. `AGENTS.md:220-222`
documents the exact failure mode it can cause: a hand-created index leaves the
database and the Drizzle journal disagreeing, and boot then fails.

It is guarded and commented, and it only runs on a legacy database — but a
legacy database is a one-time condition, and this is permanent code.

### Fix

Write a one-shot script that upgrades any legacy database, verify it against a
copy of a real pre-Drizzle database, then delete both functions.

## 3.3 The trade POST and the state import duplicate transaction code

**Status: VERIFIED.** Three hand-rolled `BEGIN`/`try`/`COMMIT`/`ROLLBACK` blocks
across `trades.ts` and `state.ts`, each slightly different. 3.1 collapses them
into one helper.

## 3.4 Currency formatting is duplicated in both stores, in files that already import the shared version

**Status: VERIFIED.**

`money.ts:54` exports `formatMoney`, backed by `Intl`. Both stores import it —
`dashboard.ts:4`, `simulation.ts:8` — and both immediately re-implement it:

```ts
// dashboard.ts:70-71 AND simulation.ts:48-49 — byte-identical
const usd = (n: number): string => `$${n.toLocaleString('en-US', {...})}`;
const brl = (n: number): string => `R$ ${n.toLocaleString('pt-BR', {...})}`;
```

Then `simulation.ts:236` chooses between them _in the same expression_:

```ts
const money = (amount: number): string => (brl ? formatMoney(amount, 'BRL') : usd(amount));
```

BRL goes through `Intl`; USD goes through hand-rolled template literals. They
agree today by coincidence. `dashboard.ts:623-624` adds a third inline variant.

This is exactly the drift `packages/shared` was created to eliminate —
`valuation.ts:1-9` documents two stores growing subtly different copies of the
valuation rules. The fix did not reach the formatters.

Separately, `money.ts:61-63` constructs a **new `Intl.NumberFormat` on every
call**. These run inside computed properties re-evaluated on every reactive
tick, so a table of a few hundred rows builds a few hundred formatters per
render.

### Fix

- Delete `usd`/`brl`/`signedUsd`/`signedBrl` from both stores; use `formatMoney`
  everywhere. Add the sign at the call site.
- Memoise the `Intl.NumberFormat` instances per (locale, options) in `money.ts`.
- Add a test asserting one formatter per locale option set, so the memoisation
  cannot be silently dropped.

### What was actually done, and the two corrections

**The four were not dead, and one grep said they were.** An initial
`Select-String -Path 'apps/web/src/**/*.vue'` reported zero call sites for
`store.usd(`, so `dashboard.ts`'s copy looked dead. PowerShell's `-Path` does not
recurse through `**`, so the pattern matched nothing rather than matching none.
A `Get-ChildItem -Recurse` found **20 call sites** across `AddTradeForm.vue`,
`MetricCards.vue` and `SimulationMetrics.vue`. They were deleted, the build failed,
and they went back as **one-line delegates** to `formatMoney`/`formatSigned`. That
is a deviation from the fix above, and it is the right one: the defect being closed
is a second _implementation_ of the rule, not the presence of a convenient name.
Migrating 20 template call sites would have changed no behaviour and made the
diff harder to review. `signedBrl` had zero call sites and was deleted outright.

**`dashboard.test.ts` had pinned a bug.** Line 119 of that file explained the
positions table's missing thousands separator as a deliberate legacy-fidelity
choice, with the exact string `$3200.10` asserted. That is a product decision,
not a defect, and the review above did not know about it. Changing the table to
`formatMoney` would have overridden a documented choice, so the table keeps its
own format — now named `legacyAmount`/`legacySigned` rather than spelled inline at
five call sites — and the comment explaining why sits on the function.

The two store rows _did_ have a genuine sign defect, which is separate from the
separator question and which the same pinned test never caught because it only
ever asserted a **positive** `pl`:

```ts
// position rows, USD branch
pl: `${row.pl >= 0 ? '+' : ''}${pl}`          // pl was `$${row.pl.toFixed(2)}`
// cash row, both branches
pl: `${row.pl >= 0 ? '+' : ''}${… `$${row.pl.toFixed(2)}`}`
```

Prepending a sign to an already-interpolated magnitude put the currency symbol
**ahead of the minus**: `$-1234.56` and `R$-19943.92`. The BRL branch of the
position table went through `formatMoney` and was already right, so the same
column disagreed with itself by currency. `legacySigned` fixes it and
`dashboard.test.ts` now stubs a losing valuation to pin `-$1234.56`. Mutating
`legacySigned` back to the old shape reproduces `$-1234.56` and fails that test.

**`formatSigned` fixes negative zero, which is a narrower bug than it looks.**
`${n >= 0 ? '+' : ''}${usd(n)}` looks like it double-signs a negative, so that is
what the first draft of `money.ts` claimed. Checked in node, it does not: an
ordinary negative renders `-$5.00` correctly. The one failing input is `-0`, where
`-0 >= 0` is `true` and `Intl` renders the value as `-$0.00`, giving `+$-0.00`.
`formatSigned` takes `Math.abs` first, so `-0` collapses to zero and the whole
class of defect is unreachable rather than merely absent from the tests.

## 3.5 `valuation.ts` clamps losses to zero without saying so

**Status: DONE.** The clamp existed in **three** places, not one:

| Site                                          | Note                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/shared/src/domain/valuation.ts:255` | `computeValuation` — the current implementation                                         |
| `packages/shared/src/domain/portfolio.ts:156` | `computePortfolioValue` — a second implementation, since merged into `computeValuation` |
| `apps/web/src/stores/simulation.ts:219`       | recomputed client-side, sell-only `realized`                                            |

All three now report `invested - realized` unchanged.

```ts
const investedNet = Math.max(0, invested - realized);
```

If realized exceeds invested, `investedNet` reported `0` rather than a loss - a
number that is wrong in the user's favour, with no log and no signal.

**Decision taken: remove the clamp.** Nothing depended on the floor. No consumer
divides by `investedNet`; the one ratio that exists, `investedShareOfTotal`, uses
gross `invested`. `brlInvested` divides by the BRL rate, which is positive, so a
negative reads correctly. So removing it changes one reported figure and no
invariant.

### The clamp was also hiding a test

`historyManager.test.ts` had `test('interest amounts are summed (BRL) and reduce
investedNet')` asserting `expect(withInterest.i).toBe(0)`. Its fixture had no
trades and no cash, so `invested` was `0` — and `Math.max(0, 0 - x)` is `0` for
any `x`. **The assertion passed whether or not interest was summed at all.** It
would have survived removing the BRL conversion, swapping the two currency
queries, or dropping the sum entirely; the old stub answered both currency queries
with the same rows, so it could not have detected a currency mix-up either.

With the clamp gone the test asserts the real figure
(`-(1500 × 0.2 + 200)`), and mutating `historyManager` to stop passing interest
at all now fails it. Verified.

That is the argument for removing the clamp beyond its own merits: **a clamp that
truncates the value a test measures turns the test into an assertion about the
clamp.** Tests now pin the unclamped figure at both signs in `valuation.test.ts`,
which is the only implementation left: `computePortfolioValue` was merged into
`computeValuation`, so there is no second copy whose clamp could drift back.

## 3.6 Closed positions never leave the table

**Status: DONE.** `valuation.ts:231-234` builds `positions` from
`Object.keys(lots)`, so a fully-closed symbol remains a key with `qty: 0`. That
produces a permanent zero row in the positions table and a zero-value allocation
slice.

The comment at `:238-239` calls this "safe without a guard" - true for the
arithmetic, not for presentation. Filter `qty === 0` when building `rows` and
`allocation`, keeping the zero out of `positions` so the math is unchanged.

### What was done, and the part that was not obvious

`positions` is **untouched** - the filter is a separate `openSymbols` at the
boundary between the arithmetic and everything rendered. `symbols_` still sums
over every symbol ever traded, so `invested`, `total` and the BRL conversions are
bit-identical.

That separation is why the bug survived so long: **nothing was wrong, only shown.**
A closed position contributes `0` to every total either way, so no arithmetic
invariant was violated and no test could fail. The observable damage is a row
reading `0` quantity and `$0.00`, and - the part that actually matters - a zero
allocation slice diluting every real percentage, because those are computed over
`allocationTotal`. One closed position moved a correct `85.71%` to `85.71% of
something larger`.

`openSymbols` filters `qty !== 0`, which also feeds `plByAsset` - a `0` entry there
is the same lie in a different chart. Three consumers: `rows`, `allocation`,
`plByAsset`.

### Three existing tests asserted the old behaviour

`valuation.test.ts` had `test.each` over a USD symbol, a BRL non-bond and a bond,
named _"a closed-out %s reports zero averages rather than NaN"_, each asserting
`expect(row).toBeDefined()` and `row.qty === 0`. So the zero row was pinned by
tests written to guard something real: every per-row division has a zero
denominator there, and the alternative is `NaN` in a table cell.

Reframed rather than deleted, at the level the invariant actually holds — **no row
the caller receives carries a NaN**, asserted across every numeric field of every
row rather than the four the old tests looked at.

**And the guards are still load-bearing.** The filter is `qty !== 0`, and
`NaN !== 0` is `true`, so a trade carrying a non-finite quantity passes straight
through it and reaches `avgCost: qty > 0 ? cost / qty : 0`. A new test drives
exactly that: `qty: Number.NaN` yields a row with `avgCost: 0` and `plPct: 0`,
not a NaN and not a vanished row. Without it, "the guards are dead code now" would
have been a safe-sounding and wrong conclusion.

9 new tests. Mutating `openSymbols` back to `symbols_` fails 6 of them.

## 3.7 Money is IEEE-754 doubles with no rounding discipline

**Status: DONE.** Every monetary column is `real` (`schema.ts:9-10,38,85,95`)
and `valuation.ts:129-131` sums with a bare `reduce`. No rounding at any defined
boundary - display, persistence, or aggregation.

**Decision taken: document as display-only, no code change.** The policy is now
written at the top of `packages/shared/src/domain/money.ts` — the module that owns
money, where the next person to touch a rounding question will read it — with a
summary in `docs/BACKEND.md` under "Money and rounding".

The policy has four parts:

1. **The domain computes in full precision.** Rounding mid-calculation compounds,
   and the direction depends on row order.
2. **Persistence stores what was computed.** Rounding on write would make the
   stored and computed figures disagree, and the stored one is what a restore
   brings back — so the error becomes permanent rather than cosmetic.
3. **Display rounds, and only display.** `formatMoney`/`formatSigned` are the
   single rounding boundary.
4. **Never compare money for equality.**

Plus the part that makes it a _policy_ rather than a description: **when to
revisit.** Settlement or accounting against a broker makes doubles a correctness
problem rather than a rounding one, and a currency with other than two decimal
places needs its exponent carried rather than assumed at the edge.

### The one code change: a named tolerance

`valuation.ts:409` had `Math.abs(unrealized) < 0.01` — a magic number standing in
for rule 4, which is why rule 4 was invisible. It is now `Math.abs(unrealized) <
CENT`, with `CENT` exported from `money.ts` next to the policy that sanctions it
and a comment explaining why _half a cent_ is the right threshold for
"is this portfolio at break-even" (a sub-cent residual is noise from summing lots
and converting currencies; half a cent is tighter than that noise floor, and a
whole dollar would hide a real move).

A new test drives it by nudging a price by a fraction of a cent and by half a
dollar, so it fails if the comparison goes back to `=== 0` **or** if the threshold
moves. Verified by mutation.

### What was deliberately not done

Integer minor units. It is the correct answer for a system of record and the wrong
answer here: it reaches every calculation, every fixture and every migration, and
buys insurance against a class of error this application does not have. The
policy says so explicitly rather than leaving the absence unexplained.

---

# Phase 4 — Frontend

## 4.1 `stores/dashboard.ts` is a 1212-line God store

**Status: VERIFIED.**

| Metric                        | Value |
| ----------------------------- | ----- |
| Lines                         | 1212  |
| `ref(` declarations           | 46    |
| `computed(` declarations      | 19    |
| `async function`              | 22    |
| Direct `request(api.*)` calls | 18    |

One reactive object holds 18 server-backed collections, the entire trade form,
the settings modal, alerts, cash pagination and chart selection, with 19
interlinked computeds. It cannot be reasoned about in one sitting and every
consumer can reach every field.

The decomposition is already visible in the file's own section comments —
server data, UI preferences, transient UI state, trade form — each of which is a
cohesive unit. Split along those lines into stores and composables; keep the
`refresh()` orchestration in one place so the load order stays explicit.

`stores/simulation.ts` is 810 lines with **no test file at all** and is the larger
exposure.

### Verify

`dashboard.test.ts` already exists (203 lines) and must keep passing unchanged
in its assertions. That is the safety net for the refactor.

## 4.2 There are no component tests, and no way to write them

**Status: VERIFIED.** ~25 `.vue` components; `@vue/test-utils` is not a
dependency. `vitest.config.ts:17-19` names the absence of component tests as the
gap that motivated the Vitest migration — the store got tests, the components
did not.

Untested by anything below the Playwright smoke layer: `CashPanel.vue` (310
lines), `AddTradeForm.vue` (178), `TradeForm.vue` (214), `SimulationView.vue`,
`AnalyticsView.vue`, `ValueChart.vue`, `ChartCanvas.vue`, `AllocationTable.vue`,
and the whole `analysis/` and `simulation/` component directories.

### Fix

Add `@vue/test-utils` as a dev dependency. Cover, in order of value:

- `ChartCanvas.vue` — create on mount, destroy on unmount, update on config
  change. The `AGENTS.md:118` note says a chart leaking "when the period changes"
  was a real bug; that is exactly what a component test should lock down.
- `ValueChart.vue` — the `ResizeObserver` applies **width and height**
  (`AGENTS.md:366-374`). A test that asserts both are set would prevent the
  regression that commit `0ae1c91` fixed.
- `SettingsModal.vue` — see 5.1. Assert `.modal` resolves to a rule that is not
  scoped to a page root.
- `AddTradeForm.vue` / `TradeForm.vue` — the form does currency parsing and
  cash-source selection that the stores depend on.

## 4.3 CSS selectors that collide between page stylesheets are a documented hazard with no guard

**Status: VERIFIED.** `AGENTS.md:384-403` explains that each view imports its
stylesheet as a module side effect, so Vite injects all of them into `<head>` on
first visit and **never removes one**; any class name two files define is a
collision whose winner depends on load order. It instructs the reader to "intersect
the class names the page stylesheets define; do not eyeball it."

There is no script that does this. It is a manual, undocumented-to-run check, and
0.1 is the proof that it can be got wrong.

### Fix

Add `scripts/check-css-collisions.mjs` that intersects the class selectors in
`static/css/{dashboard,analytics,simulation}.css`, reports any name defined by
more than one, and fails if a shell-level class (one rendered by `App.vue`) is
scoped to a page root. Wire it into `npm run lint`. That converts the single most
expensive class of bug in this codebase from "remember to check" into "cannot
merge".

---

# Phase 5 — Tooling, config and consistency

## 5.1 Add a test that fails when shell-owned markup is styled by a page stylesheet

**Status: VERIFIED.** This is the direct guard against 0.1 recurring, and it is
the one test that would have caught it.

The class list of what `App.vue` renders outside every page root is small and
stable: `.modal`, `.modal-content`, `.app-header`, `.app-nav`, `.app-brand`,
`.app-logo`, `.shell`, `.toast`. Assert that no selector for any of them appears
under a `.dashboard-page` / `.analytics-page` / `.simulation-page` prefix in any
page stylesheet.

Cheaper and equally effective: the CSS-collision script in 4.3 can carry this
assertion, and 5.1 then needs no separate test file.

## 5.2 The linter overstates what it catches

**Status: VERIFIED.** `eslint.config.mjs:3-6` claims the config catches "unused
code, **floating promises**, `any` creeping in".

It does not catch floating promises. `tseslint.configs.recommended` is not
`recommended-type-checked`, so `no-floating-promises`, `await-thenable` and
`no-misused-promises` are all absent. And `no-explicit-any` is `'warn'`
(`:189`), so the 34 `any`s in `src/` never fail `npm run lint`.

Floating-promise detection is especially relevant: several paths deliberately
fire-and-forget with `.catch()` (`trades.ts:140`, `:175`), and nothing enforces
that discipline.

### Fix

- Add `tseslint.configs.recommendedTypeChecked` with
  `projectService: true`.
- Promote `no-explicit-any` to `error`, with a scoped override for
  `routes/prices.ts` (which the comment at `:186-189` already justifies) and
  `db.ts`'s `any[]` params.
- Fix what it finds. Expect the return-type of `refreshPrices` (see 5.6) to
  surface immediately.

### Done, with a different outcome than the plan assumed

`recommendedTypeChecked` is in and `npm run lint` is **0 errors** (44 warnings,
the pre-existing `any`s). The first run reported **565 errors**, and the shape of
them is the real finding:

| Rule                            | Count | What they were                                 |
| ------------------------------- | ----- | ---------------------------------------------- |
| `no-unsafe-*`                   | 462   | one root cause: 41 `any`s, from every use      |
| `no-explicit-any`               | 41    | the root cause itself                          |
| `no-misused-promises`           | 37    | every Express handler, all correct             |
| `no-unnecessary-type-assertion` | 15    | 15 **wrong** - see below                       |
| `unbound-method`                | 6     | real in shape, fixed at the source             |
| `require-await`                 | 5     | handlers that answer synchronously on a branch |
| `no-base-to-string`             | 3     | **real** - see below                           |
| `no-floating-promises`          | 1     | **real** - see below                           |

**Four real problems, found by rules that were not running:**

- **`migrate.ts:6` had a floating promise** - a top-level IIFE whose rejection
  was unhandled. It was safe only because the `catch` calls `process.exit(1)`;
  delete that line and a failed migration exits 0. Now `void`, and removing the
  `void` fails the lint.
- **Both `pieLabelPlugin.ts` files rendered labels with `String(...)`.** Chart.js
  types `data.labels` as an array of arbitrary values, so a structured label draws
  `[object Object]` onto the canvas. Replaced with a shared `labelText` - the two
  plugins each had their own copy, which is the 3.4 pattern again - with 5 tests
  whose mutation reproduces `[object Object]`.
- **`PortfolioCalculator` and `SymbolClassifier` re-export detached methods.**
  `portfolioCalculator.ts` does `export const replayFIFOLots =
calculator.replayFIFOLots`, which works only because none of them read `this`.
  Fixed by declaring `this: void` on both interfaces: the rule's own suggestion,
  and it states the invariant rather than restructuring the module.
- **`periodStartMs(period: Period | string)`** collapsed to `string`, so the
  annotation advertised a closed set while the switch enumerated five of them.
  The fall-through to `0` is deliberate and tested (`'6M'` and `''` both answer
  `0`, because the value comes from an unvalidated query parameter), so the type
  now says `string` and documents why.

### What was deliberately _not_ done, and why

**`no-unnecessary-type-assertion` is disabled because its autofix is wrong.** It
called `t.symbol as string` in `stores/dashboard.ts` "unnecessary - does not change
the type of the expression"; `Trade.symbol` is `symbol?: string` in both
`packages/shared/src/generated/api.ts` and the built `dist/generated/api.d.ts`, so
`t.symbol` is `string | undefined` and the assertion narrows it. `--fix` removed
all three assertions in `normalizeTrade` and `npm run build` failed with `TS2322`.
Two type checkers, two answers, and ESLint's is the wrong one: its program
resolves the type through the workspace `.d.ts` chain where `vue-tsc` uses the
generated source. Fifteen dead casts is a real but small cleanup; a fixer that
breaks the build is a bad trade. **All 15 removals were reverted.**

**The `no-unsafe-*` family is deferred, not fixed.** 462 findings from 41 `any`s
is one problem reported 462 times, and burying four real bugs under it helps
nobody. `no-explicit-any` stays `warn` rather than becoming `error`, because
promoting it first means either 41 suppressions or an unrelated diff. The lever
is recorded: `db.ts`'s helpers are already generic but default `T = any`, so
`await all(...)` infers `any[]` and callers annotate to match. Defaulting `T` to
`unknown` makes each caller state its row shape - that is the change to make when
these rules come back.

**`no-misused-promises` and `require-await` are false positives on Express 4.**
`router.get('/x', async (req, res) => ...)` "misuses" the signature by
construction, and `async` is exactly how these handlers do error handling, because
Express 4 does not await a handler's promise. Removing `async` would delete the
`try/catch` that answers a failed query. That trade is real - a handler added
without `try/catch` fails silently - and it is now written into AGENTS.md along
with the note that Express 5 would fix it properly.

### One thing this needed beyond the plan

`projectService` could not resolve the `apps/api` suites, because
`apps/api/tsconfig.json` excludes `*.test.ts` - load-bearing, since that is what
stopped `tsc` compiling suites into `dist/` and breaking `test:docker`. ESLint
reports an unresolvable file as a **parsing error**, not a lint failure, so the
type-aware rules were silently not applying to 35 files while the lint looked
green on everything it _could_ see.

Fixed with `tsconfig.eslint.json` (lint-only, nothing builds from it) plus
`allowDefaultProject`. That option **rejects `**`**, so the four test directories
are listed one glob each, and a new test directory produces a visible parse error
rather than a silent loss of checking. Recorded in AGENTS.md so the next person
adding a test knows to update the list.

- **The regression this shipped, and why it was invisible locally**

Turning on type-aware linting made `npm run lint` depend on a build artifact. The
`lint` CI job is `npm ci` -> `npm run lint` with no build step — the only job of the
five without one — so on a fresh runner `packages/shared/dist/index.d.ts` does not
exist, `import type { components } from '@portfolio-dashboard/shared'` resolves to
a TypeScript **error type**, and an error type behaves like `any`. Every union built
from it then trips `no-redundant-type-constituents`: nine errors across six files.

Nine errors in CI, **zero locally**, every time — because a developer's tree already
has `dist/` from the previous build. Not a code defect at all: a missing artifact.

Worth recording because it is the purest "works on my machine" in this repository's
history. The local run _cannot_ detect it, because the thing masking it is the build
you just ran. The check that finds it is to delete the artifact, not to re-read the
code.

Fixed in two places: the `lint` script now builds `packages/shared` first so a fresh
clone is correct whoever runs it, and the CI job has an explicit step so the
dependency is visible in the log rather than buried in a script.

**Verified the way the bug appeared.** `packages/shared/dist` was moved aside to
simulate a fresh runner. Before the fix `eslint .` reproduced all nine errors
exactly; after it, `npm run lint` reports 0 errors with no `dist/` present.

## 5.3 `vitest.config.ts` references a deleted file

**Status: DONE.** Line 71 included `apps/api/src/services/cashBackfill.ts` in
`coverage.include`. That file does not exist — `AGENTS.md` states it was deleted
along with both backfill endpoints.

Deleted. **And a guard added**, because deleting the line fixes this instance and
not the class: `include` is a filter, so a pattern matching nothing is a valid
pattern and the coverage run did not fail. `scripts/config-integrity.test.ts` now
asserts that every non-glob entry in `include` exists on disk, that no entry
points into `dist/`, and that no entry is itself a test file. Putting
`cashBackfill.ts` back makes it fail.

## 5.4 `eslint.config.mjs` describes the legacy suites as CommonJS/Jest

**Status: DONE.** Both claims were still there and both were wrong. Verified
before changing anything: the two `static/js/__tests__` suites contain **zero**
occurrences of `require(` or `module.exports` — their only matches for the word
`require` are the comments recording why they were converted — and both open with
`import … from '@portfolio-dashboard/shared'`.

The `no-require-imports: off` override for that directory is deleted rather than
narrowed: nothing there uses `require` now, so if something started to, the rule
should say so. The two other stale comments ("`apps/api` and `packages/shared` are
CommonJS") now say they are _authored_ as ESM and compiled to CommonJS, which is
what the `sourceType: module` above them actually means.

## 5.5 `package.json` declares a field npm does not read

**Status: DONE.** `package.json:42-46`:

```json
"allowScripts": { "esbuild@0.18.20": true, "esbuild@0.25.12": true, "esbuild@0.28.2": true }
```

`allowScripts` is not an npm field. The real control is `.npmrc`'s
`ignore-scripts=true`, which is a genuinely good decision and well documented.
The dead field is worse than nothing: it implies scripts are selectively permitted
when the truth is a blanket block.

Deleted, and it was the only non-standard top-level key in the file (checked
against the set of fields npm reads, so the next one is findable the same way).
`npm install --dry-run` exits 0 and `npm install` rewrites nothing in the
lockfile — the apparent `package-lock.json` modification was line-endings only,
which is why it is worth confirming a lockfile change with a content diff rather
than `git status`.

Delete it.

## 5.6 `tsc` compiles test files into `dist/`

**Status: CONFIRMED.** `apps/api/tsconfig.json` has `"include": ["src/**/*"]` with
no `exclude` for `*.test.ts`, so 14 test files land in `dist/`. The Dockerfile
compensates:

```dockerfile
RUN rm -rf static/js/__tests__ && find apps/api/src apps/api/dist -type f -name '*.test.*' -exec rm -f {} +
```

A build exclude is the correct fix; the `find` is a band-aid that also has to run
in the image. The stale `dist/` on disk still holds `cashBackfill.test.js`,
`financeDb.test.js` and `financeService.test.js` from the pre-split era — the
last two have no `src/` counterpart after the finance extraction.

Add `"exclude": ["src/**/*.test.ts"]` and drop the `dist` half of the `find`.

## 5.7 The coverage gate measures a hand-picked subset

**Status: VERIFIED.** `vitest.config.ts:66-74` lists six narrow globs, and the
80% thresholds are global across them. The headline number therefore says nothing
about the roughly 90% of source with no tests, and `AGENTS.md:445` is honest that
this is "narrow by design".

Honesty is not the same as a useful gate. Either widen the list as tests land, or
state the real project-wide figure in `README.md` next to the gated one.

**DECISION.** Keeping a narrow gate is legitimate, provided the untracked number
is published. Right now it is not.

**Done.** `npm run test:coverage:full` reports all of `src/` with every threshold
set to zero, alongside the existing gated run. Both numbers, measured:

| Command                 | Scope                   | Stmts | Branch | Lines |
| ----------------------- | ----------------------- | ----- | ------ | ----- |
| `test:coverage` (gated) | the `include` list only | 99.8% | 90.6%  | 100%  |
| `test:coverage:full`    | all of `src/`           | 31.5% | 22.2%  | 32.2% |

**The 31% is honest, and it is not a verdict on the tested code.**
`packages/shared/src/domain` is at ~99.7% and `useApi.ts` at 100%. The gap is
almost entirely Vue single-file components reading 0% — no test mounts one, so
`MetricCards.vue`, `PositionsTable.vue` and every view are uncovered. Those are
genuinely uncovered rather than unmeasurable (the report lists their uncovered
line ranges), and they are the largest remaining block in the project: 4.2.

So the number says something specific and useful: **the next meaningful coverage
increase comes from component tests, not from more domain tests.** The domain is
not where the risk is, and a figure that hid that would have been worse than a
lower one.

Both `vitest.config.ts` and `AGENTS.md` now state the pair explicitly, so the
gated number cannot be quoted alone and read as the whole.

## 5.8 Eight route files have no test file

**Status: CONFIRMED.** `alerts.ts`, `analytics.ts`, `asset.ts`, `cash.ts`,
`config.ts`, `interest.ts`, `prices.ts`, `scenarios.ts`.

`prices.ts` is the notable one, given 2.6. `cash.ts` and `interest.ts` are the
ones a reviewer will ask about first, since both write financial records.

## 5.9 `priceFetcher` reproduces the bug pattern the codebase already documents

**Status: VERIFIED.** `trades.ts:28-33` is an excellent post-mortem:

> _"A status that depends on message wording breaks the moment someone rewords the
> message."_

Then `priceFetcher.ts:93-97`:

```ts
const is429 = (e instanceof Error && e.message && e.message.includes('429')) || (typeof e === 'string' && e.includes('429'));
const delay = is429 ? baseDelay * 5 * Math.pow(2, i) : baseDelay * Math.pow(2, i);
```

Rate-limit classification by message substring — the same anti-pattern, in the
same codebase, unremarked.

### Fix

Have `fetchWithTimeout` return the status (`{ ok, status, body }`) instead of
throwing on `!r.ok`, and branch on `res.status === 429`. Honour `Retry-After`
when present.

### Done, and the plan understated it by half

`HttpError` now carries `status`, `source` and a parsed `Retry-After`. Messages are
unchanged (`Yahoo 429`), so logs read the same; only the classification moved.

**There were three instances, not one.** Alongside the 429 in `retry`, both
`fetchYahooClose` and `fetchAndCacheAssetHistory` decided whether to advance to the
next Yahoo ticker with `/YF 404/.test(e.message)`. Same anti-pattern, same file,
also unremarked. That one was not merely a latent risk — renaming the source from
`YF` to `Yahoo` during this change would have **silently broken the candidate
fallback**: a 404 would stop advancing to the next ticker and a bogus symbol would
fail the entire history fetch, with the 404 being logged as a warning instead. Both
now branch on `e instanceof HttpError && e.status === 404`.

### The mutation that caught the missing test

Mutating `backoffMs` back to `e.message.includes('429')` left **all 31 tests
green**. The reason is worth recording, because it is the trap in this whole item:
`HttpError`'s message is `"<source> <status>"`, so it _contains_ "429" — any test
that only feeds real `HttpError`s passes equally well under the old check. Tests
that distinguish it carry the status while the message says something else:

- a 429 whose message is `"rate limited, slow down"` — must still get 5× back-off;
- a 503 whose message merely _mentions_ 429 — must **not**, which is the other
  direction of the original bug (a proxy error page stalling the worker).

Both fail the mutated version.

### `Retry-After` had to be capped, and the cap is not arbitrary

Honouring the header faithfully turned out to be a **denial-of-service risk against
this worker**. The first test using `Retry-After: 7` timed out at 5s: three
attempts × three fallback tickers × 7s is 63 seconds inside one
`fetchAndCacheAssetHistory` call, and the worker's symbol loop is serial, so every
other asset waits behind it. `Retry-After: 3600` is nine hours.

`MAX_RETRY_AFTER_MS = 10_000`, chosen so the invariant is checkable rather than
taste: it is exactly the exponential schedule's own value for the final attempt
(`baseDelay * 5 * 2 ** 2` at the production `baseDelay` of 500ms). **Honouring
`Retry-After` can therefore never make a request slower than the rate-limit back-off
already did** — it only replaces a guess with the server's answer, inside a budget
already being spent. A short `Retry-After` never _shortens_ the wait either, or a
server sending `Retry-After: 0` would defeat the back-off.

The back-off is a pure exported function because the delay is otherwise
unobservable: `DEFAULT_RETRY_DELAY` is 1ms under `NODE_ENV=test`, so every branch
finishes at the same wall-clock time and only the arithmetic can be checked. 23 new
tests, 31 in the file.

Also: the loop sleeps after the **final** failed attempt before rethrowing,
wasting the delay for nothing.

## 5.10 The price fetcher serialises Yahoo and batches nothing

**Status: VERIFIED.** `priceFetcher.ts:177-188` fetches stock symbols one at a
time with `await sleep(YAHOO_SLEEP_DELAY)` (800 ms) between each. CoinGecko is
batched into one request at `:163-165`; Yahoo is not, despite its chart API
supporting multiple symbols per request.

With six equities that is ~5 seconds of pure sleeping per 8-minute cycle, and a
whole extra failure domain. Batch Yahoo the way CoinGecko is batched, and keep a
delay only where a rate limit requires one.

## 5.11 `refreshPrices` uses a module-global boolean as a mutex

**Status: VERIFIED.** `priceFetcher.ts:51`, `:155`:

```ts
let running = false;
export async function refreshPrices(force = false) {
  if (running) return;      // a second caller silently receives `undefined`
  running = true;
```

The guard works (Node is single-threaded and the flag is set before any `await`),
but a skipped refresh is indistinguishable from a completed one to the caller.
Return a discriminated result — `{ skipped: true }` — or hold the in-flight
promise so a second caller awaits the first.

## 5.12 Smaller items worth a pass

**Status: VERIFIED.**

| Where                                             | Issue                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `priceFetcher.ts:324`                             | N+1: one `price_cache` query per alert. One query, one map.                                                                                                                                                                                                                                  |
| `priceFetcher.ts:250-257`                         | `toLocaleDateString()` bakes the **server's** locale into cached label strings. Use an explicit locale, or store timestamps and format client-side.                                                                                                                                          |
| `app.ts:67-95`                                    | The SPA catch-all `app.get('*')` is registered **before** the `/api/*` routers, so every API request pays a fruitless `express.static` lookup. It works only via the `startsWith('/api/')` bail-out at `:68`. Move the routers above the fallback and the ordering stops being load-bearing. |
| `index.ts`, `web.ts`, `worker.ts`, `telemetry.ts` | `dotenv.config()` is called four times and `import './telemetry'` appears in two. Harmless — `telemetry.ts:12` correctly loads dotenv itself before reading `process.env` — but the duplication invites a future ordering mistake. Load it once in one place.                                |
| `telemetry.ts:16-19`                              | OTLP endpoints default to `http://host.docker.internal:4318/...`. That is a developer-machine default that happens to work on the production host. No config validation, and a silent failure anywhere else. Fail loudly if the exporter is enabled with no endpoint configured.             |
| `telemetry.ts:48-60`                              | `console.log` is monkey-patched to emit OTLP logs. If the exporter itself logs, that recurses. Guard with a re-entrancy flag.                                                                                                                                                                |

---

# Cross-cutting: the test strategy

The single most important observation from the review is that **the suite tests
the code as written, not the system as configured.** Every defect in Phases 1
and 2 lives in a layer the tests replace:

| Defect                     | Why the current suite cannot see it               |
| -------------------------- | ------------------------------------------------- |
| 1.1 duplicate cache rows   | Real constraint semantics; the DB is faked        |
| 1.2 empty-result caching   | Failure path; no test where all candidates fail   |
| 1.3 POST not transactional | Happy path only; no failing-INSERT test           |
| 1.4 invalidation race      | Needs two interleaved operations; untested module |
| 1.5 `is_dismissed` NULL    | No test inserting a row that omits the column     |
| 2.1 malformed import       | 12 tests, all well-formed round-trips             |

The tell is `state.test.ts:46`:

```ts
if (/^INSERT OR REPLACE INTO asset_chart_cache/.test(sql)) { ... }
```

It asserts **that a statement was issued**, not **what the statement does to the
data**. Given that `asset_chart_cache` has no unique constraint, `INSERT OR
REPLACE` and `INSERT` are the same statement, and a faked database cannot tell
them apart.

### What to add

1. **A real SQLite integration tier.** A handful of tests against a temporary
   file database — no fakes — covering schema constraints, transactions and
   `INSERT OR REPLACE` semantics. This is the tier that would have caught 1.1,
   1.3 and 1.5. `PORTFOLIO_DATA_DIR` already exists (`db.ts:12-15`) and
   `e2e/start-server.mjs` already uses it, so the mechanism is there.
2. **Failure-path tests as a category**, not an afterthought. Every `try/catch`
   that ends in `console.warn` and a default value is an untested branch:
   `priceFetcher.ts:238`, `:312`, `:363`, `sqlExplorer.ts:96`, `prices.ts:27`.
3. **A property test on the FIFO walk.** `computeRealizedFromSales` depends on
   input being time-ordered and, on unsorted input, produces a plausible wrong
   number rather than an error (`valuation.ts:180-183`). A randomised
   order-permutation test that asserts "sorted result is invariant under
   re-ordering the input rows" would pin the one invariant the function cannot
   enforce for itself.

---

# Verification commands

Run after each phase. `npm run check` is `lint → format:check → build → test`.

```bash
npm run check                 # the gate CI runs
npm run test:e2e              # needs a build first
npm run test:docker           # suite from the builder image
npm run test:coverage         # the narrow gate (see 5.7)
npm run db:generate           # after any schema.ts change
node scripts/scan-secrets.cjs # full history, needs fetch-depth: 0
```

For the container work in 2.3 and 5.10:

```bash
docker build -f apps/api/Dockerfile -t portfolio-dashboard:local .
docker run -d --name pd -p 3300:3000 portfolio-dashboard:local
curl -fsS http://127.0.0.1:3300/api/health
docker stop pd   # watch for the clean-shutdown log from 2.3
```

---

# Suggested order

| Phase                              | Why here                                                            |
| ---------------------------------- | ------------------------------------------------------------------- |
| **0** gear regression              | User-visible; ship alone with a regression test                     |
| **1** data integrity               | Real corruption, low blast radius per fix                           |
| **2** contract and robustness      | Hardening; 2.3 and 2.4 matter for the public host                   |
| **5.2**, **5.3**, **5.4**, **5.5** | Cheap, and 5.2 makes the rest safer to land                         |
| **3.1** DB layer                   | Retires 1.3 and 3.3 as a side effect; do it before more schema work |
| **5** config drift                 | Batch these into one commit                                         |
| **3.4**, **3.6**                   | Small, well-understood cleanups                                     |
| **4** frontend restructure         | Highest effort, needs the 2.x fixes landed first                    |
| **3.2**, **3.7**                   | 3.2 is legacy-database cleanup; 3.7 needs a decision first          |

---

# Progress

26 of 33 done, 1 moot, 1 partial. **Phase 4 (the frontend) is untouched** and is
the largest remaining block — and the coverage number now says so quantitatively:
all of `src/` measures 31% statements, and the gap is almost entirely Vue
single-file components. Every backend item is either done or deliberately
deferred with the reasoning recorded.

| Item                                   | Status   | Commit                       |
| -------------------------------------- | -------- | ---------------------------- |
| 0.1 gear renders at page bottom        | done     | `c539d9d`                    |
| 1.1 `asset_chart_cache` no PK          | done     | `412c174` (migration `0006`) |
| 1.2 fetch failure cached as data       | done     | `412c174`                    |
| 1.3 POST /api/trades not transactional | done     | `412c174`                    |
| 1.4 cache invalidation race            | done     | `412c174`                    |
| 1.5 `is_dismissed` NULL re-notifies    | done     | `412c174` (migration `0007`) |
| 2.1 import has no validation           | done     | `7e42851`                    |
| 2.2 `interest` partial replace         | done     | `107df76`                    |
| 2.3 no graceful shutdown               | done     | `107df76`                    |
| 2.4 metrics label cardinality          | done     | `107df76`                    |
| 2.5 open CORS / `/metrics`             | done     | `107df76` (see note)         |
| 2.6 dynamic import for a constant      | done     | `d5626f9`                    |
| 2.7 SQL Explorer guard                 | moot     | `cb0e0c6`                    |
| 2.8 e2e failure paths                  | done     | `7e42851`                    |
| 3.1 fake-async DB layer                | done     | `ea4292c`                    |
| 3.2 hand-rolled legacy migrations      | **open** | —                            |
| 3.3 duplicated transaction blocks      | done     | `ea4292c`                    |
| 3.4 duplicated currency formatters     | done     | `bfad54a`                    |
| 3.5 `investedNet` clamp                | done     | `dda573b`                    |
| 3.6 closed positions in table          | done     | `02b8eab`                    |
| 3.7 float money / rounding policy      | done     | `7818f01`                    |
| 4.1 God store                          | **open** | —                            |
| 4.2 no component tests                 | **open** | —                            |
| 4.3 no CSS collision guard             | partial  | `c539d9d` (shell half only)  |
| 5.1 shell-stylesheet regression test   | done     | `c539d9d`                    |
| 5.2 linter overstates coverage         | done     | `34080a8`                    |
| 5.3 coverage config dead reference     | done     | `3a2ac5e`                    |
| 5.4 eslint CommonJS comments           | done     | `34080a8`                    |
| 5.5 `allowScripts` dead field          | done     | `34080a8`                    |
| 5.6 tests compiled into `dist/`        | done     | `107df76`                    |
| 5.7 coverage gate measures a subset    | done     | `3a2ac5e`                    |
| 5.8 eight untested routes              | **open** | —                            |
| 5.9 429 by message substring           | done     | `fbf6fbf`                    |
| 5.10 Yahoo serialised                  | **open** | —                            |
| 5.11 global boolean mutex              | **open** | —                            |
| 5.12 smaller items                     | **open** | —                            |

## Work that was not in the plan

Four items came out of doing the planned ones, and each is a real fix rather
than a chore:

| What                                                                               | Commit    | Why                                                                     |
| ---------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------- |
| The SQL Explorer deleted outright, with `pages/`, `/legacy/` and `LegacyHandoff`   | `cb0e0c6` | 2.7 below; the guard was never the boundary it looked like              |
| `/metrics` and `prom-client` removed; metrics now OTel-only                        | `107df76` | Two metrics systems were running and nothing scraped the Prometheus one |
| `npm run test:docker` repaired (tsconfig exclude + config copied into the builder) | `107df76` | It was failing on 32 of 36 files before this work                       |
| CI smoke step: invalid `docker stop -w` flag                                       | `658d953` | Exit 125, so the container was never signalled                          |

## Corrections to this plan

Two things the review asserted turned out to be wrong when checked, and are
recorded so the reasoning is not repeated:

- **1.4's tests did not test the rollback.** The route suites mock `../db`, so
  the rollback lived in the fake. Mutating the real `transaction()` to a no-op
  left all of them green; `db.transaction.test.ts` is the tier that closes that,
  and it is the only test in the repo that opens a real database.
- **The CSS guard catches the shell half only.** 4.3 is listed as partial for
  that reason: it will catch a shell class being page-scoped, not a collision
  between two page stylesheets.

And one method mistake, which cost more time than the item it affected: **a
`Select-String -Path 'src/**/*'` reports zero matches, not "no matches".** That is
how `dashboard.ts`'s formatters read as dead code. It was not a claim about the
codebase, it was a broken glob — the same class of error as the `-Include` mistake
earlier in this work. Anything concluded from a PowerShell search over a
subdirectory needs `Get-ChildItem -Recurse` behind it, or it is not evidence.

## Remaining, roughly in order of value

1. **5.8–5.11** the remaining backend items, one commit each — they are small and
   independent, so batching them hides more than it saves.
2. **5.12** the small ones, batched.
3. **Phase 4** — 4.1 first, with 4.2 alongside it. Highest effort and the highest
   regression risk, so it wants the backend stable. The published coverage number
   points straight at 4.2: the Vue components are the untested majority, and 4.1 is
   what makes them testable one at a time.
4. ~~**3.2** legacy-database cleanup — two parallel implementations of the same
   valuation rules, which is the underlying duplication behind most of Phase 3.~~
   **DONE.** `computePortfolioValue` and `PortfolioInput`/`PortfolioResult` were
   deleted; `historyManager` now calls `computeValuation` for both the scheduled
   snapshot and `recomputeHistoryAt`, so the route, the simulator and the history
   writer share one implementation. The only behaviour the snapshot writer needed
   that the dashboard does not — refuse to record a point when an open position
   has no price — moved across as `ValuationInput.requirePrices`, keeping the old
   `Missing price for <symbol>; skipping history point` error and the old
   lot-fallback rules (`prices` for a live snapshot, `{}` when recomputing a
   historical one). Guarded by a new `computeValuation requirePrices` suite.

**Blocked on decisions:** 3.7 (float money and where rounding happens). 3.5
(clamping a loss to zero) and 5.7 (publishing the ungated coverage number) were
both decided and landed: `investedNet` is `invested - realized` with no floor,
and `npm run test:coverage:full` is the published number.
