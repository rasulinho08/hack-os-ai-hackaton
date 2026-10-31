/**
 * @file publicStats.service.js
 * @description The figures on the home page: the events run on the platform
 * and the people, teams and projects in them, counted from the database.
 *
 * An event counts once it is published (drafts and unpublished events do
 * not; archived ones do, they were run). Events the owner marked as tests
 * never count. The answer is kept for ten minutes
 * per process: the page is public and the numbers move slowly.
 */

const db = require('../config/db');

const TTL_MS = 10 * 60 * 1000;
let cached = null;

async function count() {
  const r = await db.query(
    `WITH ev AS (
       SELECT id FROM events
        WHERE is_published = true AND is_test = false AND LOWER(TRIM(COALESCE(status::text, ''))) <> 'draft'
     )
     SELECT (SELECT COUNT(*) FROM ev)::int AS events,
            (SELECT COUNT(*) FROM participants p JOIN ev ON ev.id = p.event_id)::int AS participants,
            (SELECT COUNT(*) FROM teams t JOIN ev ON ev.id = t.event_id)::int AS teams,
            (SELECT COUNT(*) FROM submissions s JOIN ev ON ev.id = s.event_id)::int AS projects`,
  );
  const row = r.rows[0];
  return {
    events: row.events,
    participants: row.participants,
    teams: row.teams,
    projects: row.projects,
    countedAt: new Date().toISOString(),
  };
}

/** GET /api/public/stats: { events, participants, teams, projects, countedAt }. */
async function stats() {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;
  const data = await count();
  cached = { at: Date.now(), data };
  return data;
}

/** Forget the kept figures: the owner just changed what counts (a test mark). */
function invalidate() {
  cached = null;
}

module.exports = { TTL_MS, stats, count, invalidate };
