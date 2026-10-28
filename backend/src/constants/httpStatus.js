/**
 * @file httpStatus.js
 * @description Centralized HTTP status code constants.
 *
 * Usage:
 *   const { HTTP } = require('../constants/httpStatus');
 *   res.status(HTTP.OK).json({ ... });
 *   res.status(HTTP.NOT_FOUND).json({ ... });
 */

/**
 * Standard HTTP status codes used across the application.
 * @readonly
 * @enum {number}
 */
const HTTP = Object.freeze({
  // ─── 2xx Success ─────────────────────────────────────────────────────────
  /** Request succeeded */
  OK: 200,
  /** Resource created successfully */
  CREATED: 201,
  /** Request accepted, no content to return */
  NO_CONTENT: 204,

  // ─── 4xx Client Errors ───────────────────────────────────────────────────
  /** Malformed request / validation failure */
  BAD_REQUEST: 400,
  /** Authentication required or token invalid */
  UNAUTHORIZED: 401,
  /** Authenticated but insufficient permissions */
  FORBIDDEN: 403,
  /** Resource not found */
  NOT_FOUND: 404,
  /** Method not allowed */
  METHOD_NOT_ALLOWED: 405,
  /** Resource conflict (e.g., duplicate email) */
  CONFLICT: 409,
  /** Request payload too large */
  PAYLOAD_TOO_LARGE: 413,
  /** Too many requests (rate limit) */
  TOO_MANY_REQUESTS: 429,

  // ─── 5xx Server Errors ───────────────────────────────────────────────────
  /** Unexpected server error */
  INTERNAL_ERROR: 500,
  /** External service unavailable */
  SERVICE_UNAVAILABLE: 503,
});

module.exports = { HTTP };
