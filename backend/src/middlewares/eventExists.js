/**
 * @file eventExists.js
 * @description Middleware that validates the `:eventId` route parameter.
 *
 * Queries the database to ensure the event exists before the request
 * reaches event-scoped controllers (participants, judges, mentors, etc.).
 *
 * Usage (in app.js):
 *   app.use('/api/events/:eventId/participants', eventExists, participantRoutes);
 */

const db = require('../config/db');

/**
 * Validates that the `:eventId` param references an existing event.
 * Attaches nothing to `req` — downstream handlers use `req.params.eventId`.
 *
 * @param {import('express').Request}  req  - Express request (expects `req.params.eventId`)
 * @param {import('express').Response} res  - Express response
 * @param {import('express').NextFunction} next - Express next function
 * @returns {Promise<void>}
 */
const eventExists = async (req, res, next) => {
  try {
    const { eventId } = req.params;

    // If no eventId in params (unusual), pass through
    if (!eventId) return next();

    const result = await db.query(
      'SELECT id FROM events WHERE id = $1',
      [eventId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        success: false,
        message: `Event with id '${eventId}' not found.`,
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = eventExists;
