/**
 * @file validateRequest.js
 * @description Zod schema validation middleware factory.
 *
 * Validates `req.body` against a Zod schema before the request
 * reaches the controller. On failure, returns a 400 with field-level errors.
 *
 * Usage:
 *   const { registerSchema } = require('../validations/auth.schema');
 *   router.post('/register', validateRequest(registerSchema), handler);
 *
 * Note: Controllers using this middleware can safely call `schema.parse(req.body)`
 * but they may also rely solely on this middleware and skip re-parsing.
 */

const { errorResponse } = require('../utils/responseFormat');

/**
 * Middleware factory that validates the request body with a Zod schema.
 *
 * @param {import('zod').ZodSchema} schema - A Zod schema to validate `req.body` against
 * @returns {import('express').RequestHandler}
 */
const validateRequest = (schema) => async (req, res, next) => {
  try {
    // parseAsync supports async refinements (e.g., DB uniqueness checks via superRefine)
    req.body = await schema.parseAsync(req.body);
    next();
  } catch (error) {
    // Format Zod errors into a user-friendly array
    const errors = error.errors?.map((e) => ({
      field:   e.path.join('.'),
      message: e.message,
    })) ?? [{ field: 'unknown', message: error.message }];

    return errorResponse(res, 400, 'Validation failed', errors);
  }
};

module.exports = validateRequest;
