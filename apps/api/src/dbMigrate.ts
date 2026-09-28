import dotenv from 'dotenv';
dotenv.config();
import { init } from './db';

init()
  .then(() => {
    console.log('[db:migrate] schema is up to date');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[db:migrate] failed:', err);
    process.exit(1);
  });
