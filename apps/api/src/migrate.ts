import { migrateFromJson } from './services/migration';

const args = process.argv.slice(2);
const init = args.includes('--init');

// `void` because this IIFE's promise is deliberately not awaited — there is
// nothing to await it *from*, it is the top of the program. Without it the
// rejection is unhandled: the `catch` below handles the migration failure, so
// nothing throws today, and that is exactly the shape of bug where removing the
// `process.exit(1)` line later silently turns a failed migration into a
// successful-looking one. `no-floating-promises` exists to catch that, and it did.
void (async () => {
  try {
    if (init) {
      console.log('Running migration from portfolio_data.json...');
      const res = await migrateFromJson();
      console.log('Migration completed:', res);
    } else {
      console.log('To migrate data into SQLite run with --init');
    }
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
})();
