import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 5 already forwards rejected promises to the error middleware. This
 * wrapper is kept for explicitness at call sites.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
}
