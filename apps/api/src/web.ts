import './telemetry';
import dotenv from 'dotenv';
dotenv.config();
import { init } from './db';
import { createApp, mountWebRoutes } from './app';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

export async function startWeb(): Promise<void> {
  await init();

  const app = createApp();
  mountWebRoutes(app);

  app.listen(PORT, () => {
    console.log(`Portfolio web server listening on port ${PORT}`);
  });
}

if (require.main === module) {
  startWeb().catch((err) => {
    console.error('Failed to initialize web server', err);
    process.exit(1);
  });
}
