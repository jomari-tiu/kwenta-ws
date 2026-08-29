import type { Request, Response } from 'express';
import { bodyOf, paramId, queryOf } from '../../common/validate.js';
import { buildCsv } from './transactions.csv.js';
import * as service from './transactions.service.js';
import type {
  TCreateTransactionBody,
  TListTransactionsQuery,
  TUpdateTransactionBody,
} from './transactions.schema.js';

export async function getTransactions(
  req: Request,
  res: Response,
): Promise<void> {
  res.json(await service.list(queryOf<TListTransactionsQuery>(req)));
}

export async function getTransactionsCsv(
  req: Request,
  res: Response,
): Promise<void> {
  const { filename, body, truncated } = await buildCsv(
    queryOf<TListTransactionsQuery>(req),
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  if (truncated) res.setHeader('X-Export-Truncated', 'true');
  res.send(body);
}

export async function getTransaction(
  req: Request,
  res: Response,
): Promise<void> {
  res.json(await service.getById(paramId(req)));
}

export async function postTransaction(
  req: Request,
  res: Response,
): Promise<void> {
  res
    .status(201)
    .json(await service.create(bodyOf<TCreateTransactionBody>(req)));
}

export async function patchTransaction(
  req: Request,
  res: Response,
): Promise<void> {
  res.json(
    await service.update(paramId(req), bodyOf<TUpdateTransactionBody>(req)),
  );
}

export async function deleteTransaction(
  req: Request,
  res: Response,
): Promise<void> {
  await service.remove(paramId(req));
  res.status(204).send();
}
