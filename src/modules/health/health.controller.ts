import type { Request, Response } from 'express';
import { sql } from '../../db/client.js';

const startedAt = Date.now();

export async function getHealth(_req: Request, res: Response): Promise<void> {
  let database: 'up' | 'down';
  try {
    await sql`select 1`;
    database = 'up';
  } catch {
    database = 'down';
  }

  res.status(database === 'up' ? 200 : 503).json({
    status: database === 'up' ? 'ok' : 'degraded',
    database,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    version: process.env.npm_package_version ?? '0.1.0',
  });
}
