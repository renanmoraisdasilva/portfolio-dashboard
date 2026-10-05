import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'portfolio-e2e-'));

const env = { ...process.env, PORTFOLIO_DATA_DIR: dataDir, PORT: '3199' };
console.log(`[e2e] data directory: ${dataDir}`);

const seed = spawnSync(
  process.execPath,
  [path.join(repoRoot, 'apps/api/dist/seed.js'), path.join(repoRoot, 'fixtures/portfolio_data.json')],
  {
    stdio: 'inherit',
    env,
  },
);
if (seed.status !== 0) {
  console.error('[e2e] seeding failed');
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(1);
}

const server = spawn(process.execPath, [path.join(repoRoot, 'apps/api/dist/web.js')], { stdio: 'inherit', env });

const cleanUp = (code) => {
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(code);
};
server.on('exit', (code) => {
  console.error(`[e2e] server exited with code ${code}`);
  cleanUp(code ?? 1);
});
process.on('SIGINT', () => {
  server.kill();
  cleanUp(0);
});
process.on('SIGTERM', () => {
  server.kill();
  cleanUp(0);
});
