/**
 * Operational error with an HTTP status. Thrown anywhere in the request
 * lifecycle and translated to a JSON response by the error middleware.
 */
export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, message: string, code = 'ERROR', details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static badRequest(msg: string, details?: unknown) {
    return new AppError(400, msg, 'BAD_REQUEST', details);
  }
  static unauthorized(msg = 'Authentication required') {
    return new AppError(401, msg, 'UNAUTHORIZED');
  }
  static forbidden(msg = 'Forbidden') {
    return new AppError(403, msg, 'FORBIDDEN');
  }
  static notFound(msg = 'Not found') {
    return new AppError(404, msg, 'NOT_FOUND');
  }
  static conflict(msg: string, details?: unknown) {
    return new AppError(409, msg, 'CONFLICT', details);
  }
  static tooManyRequests(msg = 'Too many requests') {
    return new AppError(429, msg, 'RATE_LIMITED');
  }
}
