import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../common/validate.js';
import * as controller from './accounts.controller.js';
import {
  createAccountSchema,
  idParamSchema,
  listAccountsQuerySchema,
  updateAccountSchema,
} from './accounts.schema.js';

export const accountsRoutes = Router();

// Static segments MUST precede /:id. Unlike Next's file routing this is an
// ordering concern you have to remember, and z.uuid() would 400 on "balances".
accountsRoutes.get('/balances', asyncHandler(controller.getBalances));

accountsRoutes.get(
  '/',
  validateQuery(listAccountsQuerySchema),
  asyncHandler(controller.getAccounts),
);
accountsRoutes.post(
  '/',
  validateBody(createAccountSchema),
  asyncHandler(controller.postAccount),
);
accountsRoutes.get(
  '/:id',
  validateParams(idParamSchema),
  asyncHandler(controller.getAccount),
);
accountsRoutes.patch(
  '/:id',
  validateParams(idParamSchema),
  validateBody(updateAccountSchema),
  asyncHandler(controller.patchAccount),
);
accountsRoutes.delete(
  '/:id',
  validateParams(idParamSchema),
  asyncHandler(controller.deleteAccount),
);
accountsRoutes.post(
  '/:id/restore',
  validateParams(idParamSchema),
  asyncHandler(controller.postRestoreAccount),
);
