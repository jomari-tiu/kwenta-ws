import type { Request, Response } from 'express';
import { bodyOf, paramId, queryOf } from '../../common/validate.js';
import * as service from './installments.service.js';
import type {
  TCreatePlanBody,
  TDeletePlanQuery,
  TListPlansQuery,
  TPayPaymentBody,
  TPreviewScheduleBody,
  TUpdatePlanBody,
} from './installments.schema.js';

function planPaymentIds(req: Request): { id: string; paymentId: string } {
  return req.params as unknown as { id: string; paymentId: string };
}

export async function getPlans(req: Request, res: Response): Promise<void> {
  res.json(await service.list(queryOf<TListPlansQuery>(req)));
}

export async function getSummary(_req: Request, res: Response): Promise<void> {
  res.json(await service.summary());
}

export function postPreview(req: Request, res: Response): void {
  res.json({ payments: service.preview(bodyOf<TPreviewScheduleBody>(req)) });
}

export async function getPlan(req: Request, res: Response): Promise<void> {
  res.json(await service.getById(paramId(req)));
}

export async function postPlan(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.create(bodyOf<TCreatePlanBody>(req)));
}

export async function patchPlan(req: Request, res: Response): Promise<void> {
  res.json(await service.update(paramId(req), bodyOf<TUpdatePlanBody>(req)));
}

export async function deletePlan(req: Request, res: Response): Promise<void> {
  res.json(await service.remove(paramId(req), queryOf<TDeletePlanQuery>(req)));
}

export async function postPay(req: Request, res: Response): Promise<void> {
  const { id, paymentId } = planPaymentIds(req);
  res.json(await service.pay(id, paymentId, bodyOf<TPayPaymentBody>(req)));
}

export async function postUnpay(req: Request, res: Response): Promise<void> {
  const { id, paymentId } = planPaymentIds(req);
  res.json(await service.unpay(id, paymentId));
}
