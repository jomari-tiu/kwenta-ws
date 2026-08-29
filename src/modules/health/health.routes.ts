import { Router } from 'express';
import { asyncHandler } from '../../common/async-handler.js';
import { getHealth } from './health.controller.js';

export const healthRoutes = Router();

healthRoutes.get('/', asyncHandler(getHealth));
