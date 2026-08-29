import type { Request, Response } from 'express';
import { queryOf } from '../../common/validate.js';
import * as service from './calendar.service.js';
import type { TDayQuery, TMonthQuery } from './calendar.schema.js';

export async function getCalendarMonth(
  req: Request,
  res: Response,
): Promise<void> {
  res.json(await service.getMonth(queryOf<TMonthQuery>(req).month));
}

export async function getCalendarDay(
  req: Request,
  res: Response,
): Promise<void> {
  res.json(await service.getDay(queryOf<TDayQuery>(req).date));
}
