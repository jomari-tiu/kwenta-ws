import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';

type TRequestPart = 'body' | 'query' | 'params';

/**
 * Replace a request part with its parsed, typed value. A ZodError thrown here
 * is mapped to a 400 by the error handler.
 */
function validate(part: TRequestPart, schema: ZodType): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) return next(result.error);
    // Express 5 makes req.query a getter, so assign through defineProperty.
    Object.defineProperty(req, part, {
      value: result.data,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    next();
  };
}

export const validateBody = (schema: ZodType) => validate('body', schema);
export const validateQuery = (schema: ZodType) => validate('query', schema);
export const validateParams = (schema: ZodType) => validate('params', schema);

/**
 * Read the `:id` route param, already validated as a UUID by
 * `validateParams(idParamSchema)`. Express 5 types params as
 * `string | string[]`, so this narrows in one place rather than at every
 * controller call site.
 */
export function paramId(req: Request): string {
  const { id } = req.params as { id: string };
  return id;
}

/**
 * Read the request body, already parsed and narrowed by `validateBody`.
 * Express types it as `any`, so this centralises the assertion.
 */
export function bodyOf<T>(req: Request): T {
  return req.body as T;
}

/**
 * Read the query string, already parsed by `validateQuery` (which replaced
 * req.query with the Zod output, defaults applied). Express still types it as
 * ParsedQs, so the double assertion happens here once rather than at every
 * controller.
 */
export function queryOf<T>(req: Request): T {
  return req.query as unknown as T;
}
