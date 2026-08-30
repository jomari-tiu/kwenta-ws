import type { Request, Response } from 'express';
import { bodyOf, paramId, queryOf } from '../../common/validate.js';
import * as service from './investments.service.js';
import type {
  TContributeBody,
  TCreateInvestmentBody,
  TListInvestmentsQuery,
  TUpdateInvestmentBody,
  TWithdrawBody,
} from './investments.schema.js';

export async function getInvestments(
  req: Request,
  res: Response,
): Promise<void> {
  res.json(await service.list(queryOf<TListInvestmentsQuery>(req)));
}

export async function getSummary(_req: Request, res: Response): Promise<void> {
  res.json(await service.summary());
}

export async function getInvestment(
  req: Request,
  res: Response,
): Promise<void> {
  res.json(await service.getById(paramId(req)));
}

export async function postInvestment(
  req: Request,
  res: Response,
): Promise<void> {
  res
    .status(201)
    .json(await service.create(bodyOf<TCreateInvestmentBody>(req)));
}

export async function patchInvestment(
  req: Request,
  res: Response,
): Promise<void> {
  res.json(
    await service.update(paramId(req), bodyOf<TUpdateInvestmentBody>(req)),
  );
}

export async function deleteInvestment(
  req: Request,
  res: Response,
): Promise<void> {
  res.json(await service.remove(paramId(req)));
}

export async function deleteFlow(req: Request, res: Response): Promise<void> {
  const { id, transactionId } = req.params as {
    id: string;
    transactionId: string;
  };
  res.json(await service.removeFlow(id, transactionId));
}

export async function postContribute(
  req: Request,
  res: Response,
): Promise<void> {
  res.json(
    await service.contribute(paramId(req), bodyOf<TContributeBody>(req)),
  );
}

export async function postWithdraw(req: Request, res: Response): Promise<void> {
  res.json(await service.withdraw(paramId(req), bodyOf<TWithdrawBody>(req)));
}
