import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../common/errors.js';
import type { TApiErrorBody } from '../common/types.js';
import { logger } from './request-logger.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  const body: TApiErrorBody = {
    error: {
      code: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.path}`,
      details: [],
    },
  };
  res.status(404).json(body);
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    const body: TApiErrorBody = {
      error: { code: err.code, message: err.message, details: err.details },
    };
    res.status(err.status).json(body);
    return;
  }

  if (err instanceof ZodError) {
    const body: TApiErrorBody = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues,
      },
    };
    res.status(400).json(body);
    return;
  }

  if (err instanceof Error && err.message === 'Not allowed by CORS') {
    const body: TApiErrorBody = {
      error: { code: 'CORS_REJECTED', message: err.message, details: [] },
    };
    res.status(403).json(body);
    return;
  }

  // Log the real error, tell the client nothing.
  logger.error({ err }, 'Unhandled error');
  const body: TApiErrorBody = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong',
      details: [],
    },
  };
  res.status(500).json(body);
};
