import { createApp } from './app.js';
import { env } from './config/env.js';
import { sql } from './db/client.js';
import { logger } from './middleware/request-logger.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV, tz: env.APP_TIMEZONE },
    `API listening on http://localhost:${env.PORT}`,
  );
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'Shutting down');
  server.close(() => {
    void sql.end({ timeout: 5 }).then(() => process.exit(0));
  });
  // Don't hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
