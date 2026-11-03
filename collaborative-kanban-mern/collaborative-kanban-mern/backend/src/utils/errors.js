class AppError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const badRequest = (msg = 'Invalid request', extra) => new AppError(400, msg, extra);
const unauthorized = (msg = 'Authentication required') => new AppError(401, msg);
const forbidden = (msg = 'You do not have permission to perform this action') => new AppError(403, msg);
const notFound = (msg = 'Resource not found') => new AppError(404, msg);
const conflict = (msg = 'Conflict', extra) => new AppError(409, msg, extra);

// Wrap async route handlers so rejected promises reach the error middleware.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, asyncHandler };
