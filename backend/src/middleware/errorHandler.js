import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export const notFound = (req, _res, next) => {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, _next) => {
  let error = err;

  // Normalise common non-ApiError failures.
  if (!(error instanceof ApiError)) {
    if (error?.name === 'ValidationError') {
      error = ApiError.badRequest('Validation failed', Object.values(error.errors).map((e) => e.message));
    } else if (error?.name === 'CastError') {
      error = ApiError.badRequest(`Invalid ${error.path}`);
    } else if (error?.code === 11000) {
      const field = Object.keys(error.keyValue ?? {})[0] ?? 'field';
      error = ApiError.conflict(`A record with that ${field} already exists`);
    } else {
      logger.error('Unhandled error', { message: error?.message, stack: error?.stack });
      error = ApiError.internal();
    }
  }

  // If the response has already started streaming, just terminate it.
  if (res.headersSent) {
    return res.end();
  }

  const payload = {
    success: false,
    message: error.message,
  };
  if (error.details) payload.details = error.details;
  if (!env.isProd && !error.isOperational) payload.stack = err?.stack;

  res.status(error.statusCode).json(payload);
};
