/**
 * @file feedback.service.js
 * @description What participants say after the event: written feedback with
 * a 1–5 rating, and the "would you recommend it" question (NPS, 0–10).
 *
 * NPS opens when the event ends, for admitted participants (approved or
 * eliminated), one answer each that they may change; the organiser sees the
 * score, the spread and the comments without names. The general list leaves
 * NPS answers out.
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');

const NPS = 'nps';

const invalid = (field, code, message) => httpError(400, message, 'VALIDATION_ERROR', { errors: [{ field, code, message }] });

const getFeedback = async (eventId) => {
  const result = await db.query(
    `SELECT f.*, u.full_name
     FROM feedback f
     JOIN users u ON f.user_id = u.id
     WHERE f.event_id = $1 AND COALESCE(f.type, '') <> 'nps'
     ORDER BY f.created_at DESC`,
    [eventId]
  );
  return result.rows;
};

const getMyFeedback = async (eventId, userId) => {
  const result = await db.query(
    `SELECT id, rating, type, comment, created_at
     FROM feedback
     WHERE event_id = $1 AND user_id = $2 AND COALESCE(type, '') <> 'nps'
     ORDER BY created_at DESC`,
    [eventId, userId],
  );
  return result.rows;
};

const createFeedback = async (eventId, userId, data = {}) => {
  const rating = Number(data.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw invalid('rating', 'OUT_OF_RANGE', 'Give a rating from 1 to 5.');
  const comment = String(data.comment ?? '').trim();
  if (comment.length > 4000) throw invalid('comment', 'TOO_LONG', '4000 characters at most.');
  const type = String(data.type ?? '').trim().slice(0, 50) || 'general';
  if (type.toLowerCase() === NPS) throw invalid('type', 'RESERVED', 'Use the recommendation question for this.');
  const result = await db.query(
    `INSERT INTO feedback (event_id, user_id, rating, comment, type)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [eventId, userId, rating, comment || null, type],
  );
  return result.rows[0];
};

const deleteFeedback = async (id) => {
  await db.query('DELETE FROM feedback WHERE id = $1', [id]);
};

/* ── NPS ─────────────────────────────────────────────────────────────────── */

/** Whether this person can answer now, and what they answered. */
async function npsState(eventId, userId, now = Date.now()) {
  const r = await db.query(
    `SELECT e.end_date, e.archived_at, LOWER(TRIM(e.status::text)) AS event_status,
            LOWER(TRIM(p.status)) AS status,
            f.nps, f.comment, f.created_at
       FROM events e
       LEFT JOIN participants p ON p.event_id = e.id AND p.user_id = $2
       LEFT JOIN feedback f ON f.event_id = e.id AND f.user_id = $2 AND f.type = 'nps'
      WHERE e.id = $1`,
    [eventId, userId],
  );
  const x = r.rows[0];
  if (!x) throw httpError(404, 'Event not found', 'NOT_FOUND');
  const eligible = ['approved', 'eliminated'].includes(x.status);
  const archived = Boolean(x.archived_at) || x.event_status === 'archived';
  const ended = Boolean(x.end_date) && now >= new Date(x.end_date).getTime();
  return {
    eligible,
    open: eligible && ended && !archived,
    opensAt: x.end_date,
    closed: archived,
    answer: x.nps == null ? null : { score: Number(x.nps), comment: x.comment || null, at: x.created_at },
  };
}

async function saveNps(eventId, userId, { score, comment } = {}) {
  const n = Number(score);
  if (score === null || score === undefined || score === '' || !Number.isInteger(n) || n < 0 || n > 10) {
    throw invalid('score', 'OUT_OF_RANGE', 'Choose a number from 0 to 10.');
  }
  const text = String(comment ?? '').trim();
  if (text.length > 1000) throw invalid('comment', 'TOO_LONG', '1000 characters at most.');
  const state = await npsState(eventId, userId);
  if (!state.eligible) throw httpError(403, 'Only participants of the event can answer.', 'NOT_PARTICIPANT');
  if (state.closed) throw httpError(409, 'The event is archived.', 'EVENT_ARCHIVED');
  if (!state.open) throw httpError(409, 'The question opens when the event ends.', 'NPS_NOT_OPEN', { opensAt: state.opensAt });
  const r = await db.query(
    `INSERT INTO feedback (event_id, user_id, type, nps, comment)
     VALUES ($1, $2, 'nps', $3, $4)
     ON CONFLICT (event_id, user_id) WHERE type = 'nps'
     DO UPDATE SET nps = EXCLUDED.nps, comment = EXCLUDED.comment, created_at = now()
     RETURNING nps, comment, created_at`,
    [eventId, userId, n, text || null],
  );
  const row = r.rows[0];
  return { score: Number(row.nps), comment: row.comment, at: row.created_at };
}

/**
 * The organiser's view: NPS = % promoters (9–10) − % detractors (0–6),
 * from −100 to 100; null with no answers.
 */
async function npsSummary(eventId) {
  const [answers, eligible] = await Promise.all([
    db.query("SELECT nps, comment, created_at FROM feedback WHERE event_id = $1 AND type = 'nps' ORDER BY created_at DESC", [eventId]),
    db.query("SELECT COUNT(*)::int AS n FROM participants WHERE event_id = $1 AND LOWER(TRIM(status)) IN ('approved', 'eliminated')", [eventId]),
  ]);
  const scores = answers.rows.map((a) => Number(a.nps));
  const n = scores.length;
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  const distribution = Array.from({ length: 11 }, (_, i) => scores.filter((s) => s === i).length);
  const people = eligible.rows[0].n;
  return {
    responses: n,
    eligible: people,
    responseRate: people ? Math.round((n / people) * 100) : null,
    promoters,
    passives: n - promoters - detractors,
    detractors,
    score: n ? Math.round(((promoters - detractors) / n) * 100) : null,
    average: n ? Math.round((scores.reduce((s, v) => s + v, 0) / n) * 10) / 10 : null,
    distribution,
    comments: answers.rows.filter((a) => a.comment).map((a) => ({ score: Number(a.nps), comment: a.comment, at: a.created_at })),
  };
}

module.exports = {
  getFeedback,
  getMyFeedback,
  createFeedback,
  deleteFeedback,
  npsState,
  saveNps,
  npsSummary,
};
