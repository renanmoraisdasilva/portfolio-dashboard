// Phase 8 secret / data scan.
//
// A public showcase repo has to be provably free of the real financial data
// that used to live here. This checks the working tree, every commit reachable
// from every ref, and the contents of the tracked files for the shapes that
// leaked before.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

// `git` is invoked with an argv array and no shell. It used to go through
// `execSync` with `shell: 'powershell.exe'`, which worked on the author's
// Windows machine and died on the ubuntu-latest CI runner with
// `spawnSync powershell.exe ENOENT` - a security gate that could not run where
// it mattered most. Dropping the shell also drops two quoting hazards: the
// `%(refname)` format would have been mangled by cmd.exe's `%` expansion, and
// the forbidden-path globs were being re-parsed by a shell that had no business
// seeing them.
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
let failures = 0;
const ok = (label, detail = '') => console.log(`  PASS  ${label}${detail ? ` - ${detail}` : ''}`);
const bad = (label, detail) => {
  failures++;
  console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
};

console.log('refs:');
const refs = git('for-each-ref', '--format=%(refname)').trim();
console.log(
  refs
    .split('\n')
    .map((r) => `        ${r}`)
    .join('\n'),
);

console.log('\npaths that must never appear in any commit:');
const forbidden = [
  '*.db',
  '*.db-journal',
  '*.db-wal',
  '*.sqlite',
  '*.sqlite3',
  'backup-data/*',
  'portfolio_data.json',
  'hist.json',
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  'id_rsa*',
  '*.pfx',
];
for (const pattern of forbidden) {
  const found = git('log', '--all', '--name-only', '--pretty=format:', '--', pattern).split('\n').filter(Boolean);
  const unique = [...new Set(found)];
  if (unique.length === 0) ok(pattern, 'never committed');
  else bad(pattern, unique.slice(0, 5).join(', '));
}

console.log('\ncredential-shaped assignments in tracked files:');
const tracked = git('ls-files').split('\n').filter(Boolean);
// No `g` flag, deliberately. This is a global regex run with `.exec` once per
// line, so a match on one line advanced `lastIndex` and the *next* line's search
// began partway through it - any secret whose match sat earlier in its line than
// the previous line's match was silently skipped. A secret scan that can miss a
// secret is worse than no scan, because it reports CLEAN.
const secretish = /((?:password|passwd|secret|api[_-]?key|access[_-]?token|bearer)\s*[:=]\s*)(['"])([^'"\n]{6,})\2/i;
const placeholders =
  /^(x{3,}|\*{3,}|<.*>|\$\{.*\}|process\.env|your|changeme|placeholder|example|redacted|dummy|test|fake|abc123)/i;
let inspected = 0;
for (const file of tracked) {
  if (!/\.(ts|js|vue|mjs|cjs|json|yml|yaml|md|sh|example)$/i.test(file)) continue;
  if (file.includes('node_modules')) continue;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  inspected++;
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue;
    const m = secretish.exec(line);
    if (!m) continue;
    if (placeholders.test(m[3])) continue;
    // An allowlist entry is a place the literal is obviously not a real secret.
    if (/(allowlist|placeholder|example|sample|dummy|redact|never commit|do not)/i.test(line)) continue;
    bad(`${file}`, line.trim().slice(0, 90));
  }
}
if (failures === 0) ok('no unredacted secrets', `${inspected} files inspected`);

console.log('\nfixture looks synthetic:');
const fixture = JSON.parse(fs.readFileSync('fixtures/portfolio_data.json', 'utf8'));
const trades = fixture.trades || [];
const prices = trades.map((t) => t.price).filter((p) => typeof p === 'number');
console.log(`        ${trades.length} trades, ${prices.length} with a price`);
const ids = trades.map((t) => t.id);
const uuidShape = ids.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
if (uuidShape.length === ids.length) ok('every trade id is a UUID', `${ids.length}/${ids.length}`);
else bad('trade ids', `${ids.length - uuidShape.length} are not UUIDs`);
const years = [...new Set(trades.map((t) => String(t.time).slice(0, 4)))].sort();
const snapshots = fixture.history || [];
const snapYears = [...new Set(snapshots.map((s) => new Date(s.ts).getUTCFullYear()))].sort();
console.log(`        trade years ${years.join(', ')}; snapshot years ${snapYears.join(', ')}`);

// The strongest evidence that the fixture is not a dump of the real database is
// that the two disagree. Skip the check when there is no local database, which is
// the case in CI.
const realDb = 'apps/api/data/portfolio.db';
if (fs.existsSync(realDb)) {
  const Database = require('better-sqlite3');
  const db = new Database(realDb, { readonly: true });
  const realTrades = db.prepare('SELECT COUNT(*) c FROM trades').get().c;
  const realCash = db.prepare("SELECT ROUND(COALESCE(SUM(amount),0),2) s FROM cash WHERE currency='USD'").get().s;
  const fixtureCash = (fixture.cashEntries || []).filter((e) => e.currency === 'USD').reduce((sum, e) => sum + e.amount, 0);
  db.close();
  if (realTrades === trades.length && Math.abs(realCash - fixtureCash) < 0.01) {
    bad('fixture matches the local database', 'it looks like an export, not synthetic data');
  } else {
    ok('fixture differs from the local database', `${trades.length} trades vs ${realTrades}, $${fixtureCash} vs $${realCash}`);
  }
} else {
  console.log('        (no local database to compare against)');
}

console.log(`\n${failures === 0 ? 'CLEAN' : `${failures} PROBLEM(S)`}`);
process.exit(failures === 0 ? 0 : 1);
