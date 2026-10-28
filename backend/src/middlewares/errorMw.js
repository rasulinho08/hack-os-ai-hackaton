/**
 * @file errorMw.js
 * @description Global error-handling middleware. Must be the LAST middleware
 * registered in app.js (`app.use(errorMw)`).
 *
 * Handles:
 *   - Zod validation errors        → 400 with field-level messages
 *   - Custom errors with statusCode → uses err.statusCode (+ err.code)
 *   - PostgreSQL constraint errors → 400 / 409 with a readable message
 *   - Generic errors               → 500 (message hidden in production)
 */

const { appCode } = require('../utils/responseFormat');
const { isDevLike } = require('../utils/runtimeEnv');

/** Human messages for unique-constraint violations, keyed by constraint name fragments. */
const UNIQUE_MESSAGES = [
  ['event_code',            'An event with this code already exists.'],
  ['users_email',           'This email is already registered.'],
  ['event_invites',         'This email is already invited to this event.'],
  ['scoring_criteria',      'A criterion with this name already exists for this event.'],
  ['participants_user_id',  'This user is already registered for this event.'],
  ['judges_event_id',       'This user is already a judge for this event.'],
  ['mentor_assignments',    'This user is already a mentor for this event.'],
  ['volunteers_event_id',   'This user is already a volunteer for this event.'],
  ['team_members',          'This user is already on this team.'],
  ['submissions_team_id',   'This team already has a submission for this event.'],
  ['teams_join_code',       'Join code collision — please retry.'],
  ['event_settings',        'Duplicate setting key.'],
];

function uniqueViolationMessage(constraint) {
  const c = String(constraint || '');
  for (const [fragment, message] of UNIQUE_MESSAGES) {
    if (c.includes(fragment)) return message;
  }
  return 'Duplicate entry — this value already exists.';
}

// eslint-disable-next-line no-unused-vars
const errorMw = (err, req, res, next) => {
  let statusCode = Number.isInteger(err.statusCode) ? err.statusCode : 500;
  let message    = err.message || 'Internal Server Error';
  let errors     = err.errors ?? null;
  let code       = appCode(err);

  // ── Zod validation error ──────────────────────────────────────────────────
  if (err.name === 'ZodError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    const issues = Array.isArray(err.errors) ? err.errors : Array.isArray(err.issues) ? err.issues : [];
    errors = issues.map((e) => ({
      field:   e.path && e.path.length ? e.path.join('.') : '(root)',
      message: e.message,
    }));
    message =
      errors.length === 0
        ? 'Validation failed'
        : `Validation failed — ${errors.map((x) => `${x.field}: ${x.message}`).join('; ')}`;
  }

  // ── Malformed JSON body (body-parser) ─────────────────────────────────────
  if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'Malformed JSON body.';
    code = 'BAD_JSON';
  }
  if (err.type === 'entity.too.large') {
    statusCode = 413;
    message = 'Request body too large.';
    code = 'PAYLOAD_TOO_LARGE';
  }

  // ── PostgreSQL errors ─────────────────────────────────────────────────────
  switch (err.code) {
    case '23505': // unique_violation
      statusCode = 409;
      message = uniqueViolationMessage(err.constraint);
      code = 'DUPLICATE';
      break;
    case '23503': // foreign_key_violation
      statusCode = 400;
      message = 'Invalid reference — related record not found.';
      code = 'INVALID_REFERENCE';
      break;
    case '23514': // check_violation
      statusCode = 400;
      message = `Invalid value (${err.constraint || 'constraint violated'}).`;
      code = 'INVALID_VALUE';
      break;
    case '23502': // not_null_violation
      statusCode = 400;
      message = `Missing required field${err.column ? `: ${err.column}` : ''}.`;
      code = 'MISSING_FIELD';
      break;
    case '22P02': // invalid_text_representation (e.g. "abc" where an integer id is expected)
    case '22007': // invalid datetime format
    case '22008': // datetime field overflow
      statusCode = 400;
      message = 'Invalid input format.';
      code = 'INVALID_INPUT';
      break;
    default:
      break;
  }

  // ── Logging ───────────────────────────────────────────────────────────────
  if (statusCode >= 500) {
    console.error(`[ERROR] ${req.method} ${req.originalUrl} →`, err.stack || err.message);
  } else if (isDevLike()) {
    console.warn(`[${statusCode}] ${req.method} ${req.originalUrl} → ${message}`);
  }

  // ── Hide internal details in production ───────────────────────────────────
  if (statusCode >= 500 && !isDevLike()) {
    message = 'Internal Server Error';
    errors  = null;
    code    = null;
  }

  const body = { success: false, message };
  if (errors) body.errors = errors;
  if (code) body.code = code;

  res.status(statusCode).json(body);
};

module.exports = errorMw;
