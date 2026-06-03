/**
 * Wraps an async route handler so rejected promises are forwarded to the
 * central error middleware instead of crashing the process.
 * @param {(req, res, next) => Promise<any>} fn
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
