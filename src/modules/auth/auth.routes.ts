import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler.js';
import { validateBody } from '../../common/validate.js';
import { loginLimiter } from '../../middleware/rate-limit.js';
import { requireAuth } from '../../middleware/require-auth.js';
import * as controller from './auth.controller.js';
import { changePasswordSchema, loginSchema } from './auth.schema.js';

/** Public — mounted before requireAuth. Login only. */
export const authPublicRoutes = Router();
authPublicRoutes.post(
  '/login',
  loginLimiter,
  validateBody(loginSchema),
  asyncHandler(controller.postLogin),
);

/** Guarded. */
export const authRoutes = Router();
authRoutes.get('/me', asyncHandler(controller.getMe));
authRoutes.post(
  '/change-password',
  requireAuth,
  validateBody(changePasswordSchema),
  asyncHandler(controller.postChangePassword),
);
authRoutes.post('/logout-all', asyncHandler(controller.postLogoutAll));
