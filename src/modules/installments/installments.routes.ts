import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../common/validate.js';
import * as controller from './installments.controller.js';
import {
  createPlanSchema,
  deletePlanQuerySchema,
  idParamSchema,
  listPlansQuerySchema,
  payPaymentSchema,
  planPaymentParamsSchema,
  previewScheduleSchema,
  updatePlanSchema,
} from './installments.schema.js';

export const installmentsRoutes = Router();

// Static segments MUST come before /:id, or Express matches "summary" and
// "preview" as the id param and z.uuid() rejects them with a 400.
installmentsRoutes.get('/summary', asyncHandler(controller.getSummary));
installmentsRoutes.post(
  '/preview',
  validateBody(previewScheduleSchema),
  controller.postPreview,
);

installmentsRoutes.get(
  '/',
  validateQuery(listPlansQuerySchema),
  asyncHandler(controller.getPlans),
);
installmentsRoutes.post(
  '/',
  validateBody(createPlanSchema),
  asyncHandler(controller.postPlan),
);
installmentsRoutes.get(
  '/:id',
  validateParams(idParamSchema),
  asyncHandler(controller.getPlan),
);
installmentsRoutes.patch(
  '/:id',
  validateParams(idParamSchema),
  validateBody(updatePlanSchema),
  asyncHandler(controller.patchPlan),
);
installmentsRoutes.delete(
  '/:id',
  validateParams(idParamSchema),
  validateQuery(deletePlanQuerySchema),
  asyncHandler(controller.deletePlan),
);

installmentsRoutes.post(
  '/:id/payments/:paymentId/pay',
  validateParams(planPaymentParamsSchema),
  validateBody(payPaymentSchema),
  asyncHandler(controller.postPay),
);
installmentsRoutes.post(
  '/:id/payments/:paymentId/unpay',
  validateParams(planPaymentParamsSchema),
  asyncHandler(controller.postUnpay),
);
