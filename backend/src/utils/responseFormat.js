/**
 * @file responseFormat.js
 * @description Standardized JSON response helpers for all controllers.
 *
 * Every API response has the same envelope:
 *   { success: boolean, message: string, data?: any, errors?: any, code?: string }
 *
 * `code` is a stable, machine-readable identifier (e.g. TEAM_FORMATION_CLOSED)
 * the frontend can switch on without parsing the human-readable message.
 */

/** App-level error codes look like TEAM_FORMATION_CLOSED; pg codes like 23505 do not. */
const appCode = (err) => {
  const c = err && err.code;
  return typeof c === 'string' && /^[A-Z][A-Z0-9_]{3,}$/.test(c) ? c : null;
};

/**
 * `data` is omitted only when the caller passes nothing at all. An explicit
 * `null` is sent as `data: null`, because "this user has no team" and "this
 * response carries no data field" are different answers and callers read
 * `data` directly — dropping the key turned the first into `undefined`.
 */
const successResponse = (res, statusCode, message, data) => {
  const body = { success: true, message };
  if (data !== undefined) body.data = data;
  return res.status(statusCode).json(body);
};

const errorResponse = (res, statusCode, message, errors = null, code = null) => {
  const body = { success: false, message };
  if (errors !== null && errors !== undefined) body.errors = errors;
  if (code) body.code = code;
  return res.status(statusCode).json(body);
};

/**
 * Controller catch-block helper: errors thrown by services carry
 * `statusCode` (+ optional `code`) and are sent as-is; anything else is an
 * unexpected failure and goes to the global error middleware.
 */
const errorFromException = (res, next, error) => {
  if (error && Number.isInteger(error.statusCode)) {
    return errorResponse(
      res,
      error.statusCode,
      error.message || 'Request failed',
      error.errors ?? null,
      appCode(error),
    );
  }
  return next(error);
};

/** Build an error that errorFromException / errorMw understand. */
const httpError = (statusCode, message, code = null, extra = {}) =>
  Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}), ...extra });

const paginatedResponse = (res, data, total, page, limit) => {
  return res.status(200).json({
    success: true,
    message: 'OK',
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  });
};

module.exports = {
  successResponse,
  errorResponse,
  errorFromException,
  httpError,
  appCode,
  paginatedResponse,
};
