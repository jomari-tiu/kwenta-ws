import type { IncomingMessage } from 'node:http';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import { env, isProduction } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  ...(isProduction ? {} : { transport: { target: 'pino-pretty' } }),
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.body.password',
    'req.body.currentPassword',
    'req.body.newPassword',
  ],
});

export const requestLogger = pinoHttp({
  logger,
  autoLogging: {
    // The health endpoint is polled; logging it drowns everything else.
    ignore: (req: IncomingMessage) => req.url === '/health',
  },
});
