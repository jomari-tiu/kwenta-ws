import type { Request, Response } from 'express';
import { bodyOf } from '../../common/validate.js';
import { currentUserId } from '../../middleware/require-auth.js';
import type { TChangePasswordBody, TLoginBody } from './auth.schema.js';
import * as service from './auth.service.js';

export async function postLogin(req: Request, res: Response): Promise<void> {
  const { password } = bodyOf<TLoginBody>(req);
  res.json(await service.login(password));
}

export async function getMe(req: Request, res: Response): Promise<void> {
  res.json(await service.me(currentUserId(req)));
}

export async function postChangePassword(
  req: Request,
  res: Response,
): Promise<void> {
  const { currentPassword, newPassword } = bodyOf<TChangePasswordBody>(req);
  await service.changePassword(
    currentUserId(req),
    currentPassword,
    newPassword,
  );
  res.status(204).send();
}

export async function postLogoutAll(
  req: Request,
  res: Response,
): Promise<void> {
  await service.logoutAll(currentUserId(req));
  res.status(204).send();
}
