/**
 * @file status.service.js
 * @description The platform's public status, for the /status page and for
 * anyone watching from outside: does the API answer, does the database,
 * do background jobs keep up (announcements, e-mails, reminders), is e-mail
 * delivery set up.
 *
 * Nothing in it is secret — states, a latency, a lag in seconds, the version —
 * and it is kept 30 seconds, so a busy status page costs one database round
 * trip every half minute. The owner console's Health page has the detail.
 */

const db = require('../config/db');
const { getReadiness } = require('./mailer');

const TTL_MS = 30 * 1000;
/* Jobs run every 15 s; minutes of lag mean the worker is behind or stopped. */
const JOB_LAG_DEGRADED_S = 5 * 60;
const JOB_LAG_DOWN_S = 30 * 60;
const SLOW_DB_MS = 1000;

let cache = null;

async function compute() {
  const t0 = process.hrtime.bigint();
  let dbOk = true;
  try {
    await db.query('SELECT 1');
  } catch {
    dbOk = false;
  }
  const latencyMs = Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10;

  const checks = {
    api: { state: 'ok' },
    database: dbOk ? { state: latencyMs > SLOW_DB_MS ? 'degraded' : 'ok', latencyMs } : { state: 'down' },
    jobs: { state: 'unknown' },
    mail: { state: getReadiness().configured ? 'ok' : 'off' },
  };
  if (dbOk) {
    try {
      const r = await db.query(
        `SELECT EXTRACT(EPOCH FROM (now() - MIN(run_at)))::int AS lag_s
           FROM jobs WHERE status IN ('queued', 'retry') AND run_at <= now()`,
      );
      const lagSeconds = Math.max(0, Number(r.rows[0]?.lag_s) || 0);
      const disabled = String(process.env.JOBS_DISABLED || '').toLowerCase() === 'true';
      let state = 'ok';
      if (lagSeconds > JOB_LAG_DOWN_S) state = 'down';
      else if (disabled || lagSeconds > JOB_LAG_DEGRADED_S) state = 'degraded';
      checks.jobs = { state, lagSeconds };
    } catch {
      checks.jobs = { state: 'unknown' };
    }
  }
  // Down only when nothing can be read or saved; anything else not right is "degraded".
  const others = [checks.database, checks.jobs, checks.mail].map((c) => c.state);
  let status = 'ok';
  if (checks.database.state === 'down') status = 'down';
  else if (others.some((s) => s !== 'ok')) status = 'degraded';

  const commit = String(process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || '').trim();
  return {
    status,
    checks,
    time: new Date().toISOString(),
    version: /^[0-9a-f]{7,40}$/i.test(commit) ? commit.slice(0, 7) : null,
  };
}

/** The status, at most 30 seconds old. */
async function status({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = await compute();
  cache = { at: Date.now(), value };
  return value;
}

module.exports = { status, TTL_MS, JOB_LAG_DEGRADED_S, JOB_LAG_DOWN_S };
