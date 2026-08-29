import type { Request, Response } from 'express';
import { bodyOf, queryOf } from '../../common/validate.js';
import * as service from './budgets.service.js';
import type {
  TBudgetsQuery,
  TClearOverrideQuery,
  TSetDefaultCapBody,
  TSetOverrideBody,
} from './budgets.schema.js';

export async function getBudgets(req: Request, res: Response): Promise<void> {
  res.json(await service.forMonth(queryOf<TBudgetsQuery>(req).month));
}

export async function putDefaultCap(
  req: Request,
  res: Response,
): Promise<void> {
  const { categoryId } = req.params as unknown as { categoryId: string };
  res.json(
    await service.setDefault(
      categoryId,
      bodyOf<TSetDefaultCapBody>(req).capCentavos,
    ),
  );
}

export async function putOverride(req: Request, res: Response): Promise<void> {
  const body = bodyOf<TSetOverrideBody>(req);
  res.json(
    await service.setOverride(body.categoryId, body.month, body.capCentavos),
  );
}

export async function deleteOverride(
  req: Request,
  res: Response,
): Promise<void> {
  const q = queryOf<TClearOverrideQuery>(req);
  res.json(await service.clearOverride(q.categoryId, q.month));
}
