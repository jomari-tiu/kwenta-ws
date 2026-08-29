export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown[];

  constructor(
    status: number,
    code: string,
    message: string,
    details: unknown[] = [],
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details: unknown[] = []) =>
  new HttpError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = 'Invalid credentials') =>
  new HttpError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'Forbidden') =>
  new HttpError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Not found') =>
  new HttpError(404, 'NOT_FOUND', message);

export const conflict = (message: string, details: unknown[] = []) =>
  new HttpError(409, 'CONFLICT', message, details);
