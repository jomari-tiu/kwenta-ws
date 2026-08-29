import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../common/validate.js';
import { recurringCatchup } from '../../middleware/recurring-catchup.js';
import * as controller from './transactions.controller.js';
import {
  createTransactionSchema,
  idParamSchema,
  listTransactionsQuerySchema,
  updateTransactionSchema,
} from './transactions.schema.js';

export const transactionsRoutes = Router();

// Static segment before /:id.
transactionsRoutes.get(
  '/export.csv',
  recurringCatchup,
  validateQuery(listTransactionsQuerySchema),
  asyncHandler(controller.getTransactionsCsv),
);

transactionsRoutes.get(
  '/',
  recurringCatchup,
  validateQuery(listTransactionsQuerySchema),
  asyncHandler(controller.getTransactions),
);
transactionsRoutes.post(
  '/',
  validateBody(createTransactionSchema),
  asyncHandler(controller.postTransaction),
);
transactionsRoutes.get(
  '/:id',
  validateParams(idParamSchema),
  asyncHandler(controller.getTransaction),
);
transactionsRoutes.patch(
  '/:id',
  validateParams(idParamSchema),
  validateBody(updateTransactionSchema),
  asyncHandler(controller.patchTransaction),
);
transactionsRoutes.delete(
  '/:id',
  validateParams(idParamSchema),
  asyncHandler(controller.deleteTransaction),
);
