import type { Request, Response } from 'express';
import { bodyOf, paramId, queryOf } from '../../common/validate.js';
import * as service from './accounts.service.js';
import type {
  TCreateAccountBody,
  TListAccountsQuery,
  TUpdateAccountBody,
} from './accounts.schema.js';

export async function getAccounts(req: Request, res: Response): Promise<void> {
  res.json(await service.list(queryOf<TListAccountsQuery>(req)));
}

export async function getBalances(_req: Request, res: Response): Promise<void> {
  res.json(await service.balances());
}

export async function getAccount(req: Request, res: Response): Promise<void> {
  res.json(await service.getById(paramId(req)));
}

export async function postAccount(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.create(bodyOf<TCreateAccountBody>(req)));
}

export async function patchAccount(req: Request, res: Response): Promise<void> {
  res.json(await service.update(paramId(req), bodyOf<TUpdateAccountBody>(req)));
}

export async function deleteAccount(
  req: Request,
  res: Response,
): Promise<void> {
  res.json(await service.remove(paramId(req)));
}

export async function postRestoreAccount(
  req: Request,
  res: Response,
): Promise<void> {
  res.json(await service.restore(paramId(req)));
}
