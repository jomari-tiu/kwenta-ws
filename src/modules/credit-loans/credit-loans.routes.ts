import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../common/validate.js';
import * as controller from './credit-loans.controller.js';
import {
  createCreditLoanSchema,
  repaymentParamsSchema,
  idParamSchema,
  listCreditLoansQuerySchema,
  repayCreditLoanSchema,
  updateCreditLoanSchema,
} from './credit-loans.schema.js';

export const creditLoansRoutes = Router();

// Static segment before /:id.
creditLoansRoutes.get('/summary', asyncHandler(controller.getSummary));

creditLoansRoutes.get(
  '/',
  validateQuery(listCreditLoansQuerySchema),
  asyncHandler(controller.getLoans),
);
creditLoansRoutes.post(
  '/',
  validateBody(createCreditLoanSchema),
  asyncHandler(controller.postLoan),
);
creditLoansRoutes.get(
  '/:id',
  validateParams(idParamSchema),
  asyncHandler(controller.getLoan),
);
creditLoansRoutes.patch(
  '/:id',
  validateParams(idParamSchema),
  validateBody(updateCreditLoanSchema),
  asyncHandler(controller.patchLoan),
);
creditLoansRoutes.delete(
  '/:id',
  validateParams(idParamSchema),
  asyncHandler(controller.deleteLoan),
);
creditLoansRoutes.delete(
  '/:id/repayments/:transactionId',
  validateParams(repaymentParamsSchema),
  asyncHandler(controller.deleteRepayment),
);
creditLoansRoutes.post(
  '/:id/repay',
  validateParams(idParamSchema),
  validateBody(repayCreditLoanSchema),
  asyncHandler(controller.postRepay),
);
