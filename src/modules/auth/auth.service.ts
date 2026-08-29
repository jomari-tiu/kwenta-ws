import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { unauthorized } from '../../common/errors.js';
import * as repo from './auth.repository.js';

export type TJwtPayload = {
  sub: string;
  tokenVersion: number;
};

export type TAuthUser = {
  id: string;
  email: string;
  name: string;
  lastLoginAt: string | null;
};

/**
 * A pre-computed hash to verify against when no user exists, so a missing user
 * and a wrong password take the same amount of time.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$Ry5vQVzWkVwSFHFqXKKr0F8oL8qYqXqEbGZZ8vJqYqE';

function sign(payload: TJwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_TTL });
}

export function verifyToken(token: string): TJwtPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      typeof decoded.sub !== 'string' ||
      typeof (decoded as { tokenVersion?: unknown }).tokenVersion !== 'number'
    ) {
      throw unauthorized('Malformed token');
    }
    return {
      sub: decoded.sub,
      tokenVersion: (decoded as { tokenVersion: number }).tokenVersion,
    };
  } catch {
    throw unauthorized('Invalid or expired token');
  }
}

export async function login(
  password: string,
): Promise<{ accessToken: string; expiresIn: number; user: TAuthUser }> {
  const owner = await repo.findOwner();

  if (!owner) {
    // Burn the same time as a real verify so timing doesn't leak existence.
    await argon2.verify(DUMMY_HASH, password).catch(() => false);
    throw unauthorized();
  }

  const ok = await argon2
    .verify(owner.passwordHash, password)
    .catch(() => false);
  if (!ok) throw unauthorized();

  await repo.touchLastLogin(owner.id);

  return {
    accessToken: sign({ sub: owner.id, tokenVersion: owner.tokenVersion }),
    expiresIn: env.JWT_TTL,
    user: toAuthUser(owner),
  };
}

export async function me(userId: string): Promise<TAuthUser> {
  const user = await repo.findUserById(userId);
  if (!user) throw unauthorized();
  return toAuthUser(user);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await repo.findUserById(userId);
  if (!user) throw unauthorized();

  const ok = await argon2
    .verify(user.passwordHash, currentPassword)
    .catch(() => false);
  if (!ok) throw unauthorized('Current password is incorrect');

  const hash = await argon2.hash(newPassword, { type: argon2.argon2id });
  await repo.updatePasswordAndRevoke(userId, hash);
}

export async function logoutAll(userId: string): Promise<void> {
  await repo.bumpTokenVersion(userId);
}

/**
 * Verifies the token's tokenVersion still matches the DB, with a short cache so
 * the guard doesn't hit the DB on every request.
 */
const versionCache = new Map<string, { version: number; expiresAt: number }>();
const VERSION_CACHE_MS = 60_000;

export async function assertTokenCurrent(
  payload: TJwtPayload,
  now = Date.now(),
): Promise<void> {
  const cached = versionCache.get(payload.sub);
  if (cached && cached.expiresAt > now) {
    if (cached.version !== payload.tokenVersion) {
      throw unauthorized('Session has been revoked');
    }
    return;
  }

  const user = await repo.findUserById(payload.sub);
  if (!user) throw unauthorized();

  versionCache.set(payload.sub, {
    version: user.tokenVersion,
    expiresAt: now + VERSION_CACHE_MS,
  });

  if (user.tokenVersion !== payload.tokenVersion) {
    throw unauthorized('Session has been revoked');
  }
}

/** Test seam — the cache would otherwise leak between cases. */
export function clearTokenVersionCache(): void {
  versionCache.clear();
}

function toAuthUser(row: repo.TUserRow): TAuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
  };
}
