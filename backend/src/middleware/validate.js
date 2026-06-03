import { ApiError } from '../utils/ApiError.js';

/**
 * Validates and replaces request segments with parsed/typed values.
 * @param {{ body?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny }} schemas
 */
export const validate = (schemas) => (req, _res, next) => {
  try {
    if (schemas.body) req.body = schemas.body.parse(req.body);
    if (schemas.params) req.params = schemas.params.parse(req.params);
    if (schemas.query) Object.assign(req.query, schemas.query.parse(req.query));
    next();
  } catch (err) {
    if (err?.issues) {
      const details = err.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      return next(ApiError.badRequest('Validation failed', details));
    }
    next(err);
  }
};
