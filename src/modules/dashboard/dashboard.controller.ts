import type { Request, Response } from 'express';
import { queryOf } from '../../common/validate.js';
import * as service from './dashboard.service.js';
import type { TByCategoryQuery, TSummaryQuery } from './dashboard.schema.js';

export async function getSummary(req: Request, res: Response): Promise<void> {
  const q = queryOf<TSummaryQuery>(req);
  res.json(await service.summary(q.period, q.anchor));
}

export async function getByCategory(
  req: Request,
  res: Response,
): Promise<void> {
  const q = queryOf<TByCategoryQuery>(req);
  res.json(await service.byCategory(q.dateFrom, q.dateTo, q.type));
}
