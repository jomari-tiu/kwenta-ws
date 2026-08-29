import type { Request, Response } from 'express';
import { bodyOf, paramId, queryOf } from '../../common/validate.js';
import * as service from './credit-loans.service.js';
import type {
  TCreateCreditLoanBody,
  TListCreditLoansQuery,
  TRepayCreditLoanBody,
  TUpdateCreditLoanBody,
} from './credit-loans.schema.js';

export async function getLoans(req: Request, res: Response): Promise<void> {
  res.json(await service.list(queryOf<TListCreditLoansQuery>(req)));
}

export async function getSummary(_req: Request, res: Response): Promise<void> {
  res.json(await service.summary());
}

export async function getLoan(req: Request, res: Response): Promise<void> {
  res.json(await service.getById(paramId(req)));
}

export async function postLoan(req: Request, res: Response): Promise<void> {
  res
    .status(201)
    .json(await service.create(bodyOf<TCreateCreditLoanBody>(req)));
}

export async function patchLoan(req: Request, res: Response): Promise<void> {
  res.json(
    await service.update(paramId(req), bodyOf<TUpdateCreditLoanBody>(req)),
  );
}

export async function deleteLoan(req: Request, res: Response): Promise<void> {
  res.json(await service.remove(paramId(req)));
}

export async function postRepay(req: Request, res: Response): Promise<void> {
  res.json(
    await service.repay(paramId(req), bodyOf<TRepayCreditLoanBody>(req)),
  );
}
