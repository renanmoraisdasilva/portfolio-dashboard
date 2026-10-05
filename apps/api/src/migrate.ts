import { migrateFromJson } from './services/migration';

const args = process.argv.slice(2);
const init = args.includes('--init');

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
