import type { NextFunction, Request, Response } from 'express';
import { unauthorized } from '../common/errors.js';
import {
  assertTokenCurrent,
  verifyToken,
} from '../modules/auth/auth.service.js';

declare module 'express-serve-static-core' {
  // Declaration merging is the entire mechanism here, so this MUST be an
  // interface — a `type` alias replaces Express's Request instead of
  // extending it, silently making req.userId untyped.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Request {
    userId?: string;
  }
}

export function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(unauthorized('Missing bearer token'));
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    next(unauthorized('Missing bearer token'));
    return;
  }

  try {
    const payload = verifyToken(token);
    assertTokenCurrent(payload)
      .then(() => {
        req.userId = payload.sub;
        next();
      })
      .catch(next);
  } catch (err) {
    next(err);
  }
}

/** Reads the authenticated user id, throwing if the guard somehow didn't run. */
export function currentUserId(req: Request): string {
  if (!req.userId) throw unauthorized();
  return req.userId;
}
