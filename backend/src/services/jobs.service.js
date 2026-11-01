/**
 * @file jobs.service.js
 * @description Background work: scheduled announcements, Telegram and e-mail
 * deliveries, the automatic announcement planner.
 *
 * Jobs live in Postgres (`jobs`), so nothing extra has to run. Every API
 * instance polls for due jobs and claims a batch with FOR UPDATE SKIP LOCKED:
 * two instances never take the same job, and a crash mid-job leaves it
 * locked only until the stale-lock sweep puts it back. A failed job is tried
 * again with growing delays; after its last attempt it stays `failed` with
 * the error, for the owner console.
 *
 * A server that sleeps (free hosting) runs overdue jobs when it wakes; the
 * callers decide whether something late is still worth sending.
 */

const db = require('../config/db');

const handlers = new Map();
const STALE_LOCK_MINUTES = 10;

/** Register the function that runs jobs of `type`. */
function register(type, handler) {
  handlers.set(type, handler);
}

/** A failure that is not worth retrying (bad address, deleted record). */
class PermanentJobError extends Error {
  constructor(message) {
    super(message);
    this.permanent = true;
  }
}

/**
 * Queue a job.
 * @param {string} type
 * @param {object} [payload]
 * @param {object} [opts]
 * @param {Date|string} [opts.runAt]       not before this time (default now)
 * @param {string} [opts.dedupeKey]        a second job with the same key is not queued
 * @param {number} [opts.maxAttempts]
 * @param {object} [opts.exec]             a client inside a transaction
 * @returns {Promise<number|null>} the job id, or null when deduplicated
 */
async function enqueue(type, payload = {}, { runAt = null, dedupeKey = null, maxAttempts = 5, exec = db } = {}) {
  const r = await exec.query(
    `INSERT INTO jobs (type, payload, run_at, dedupe_key, max_attempts)
     VALUES ($1, $2::jsonb, COALESCE($3::timestamptz, now()), $4, $5)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [type, JSON.stringify(payload || {}), runAt ? new Date(runAt).toISOString() : null, dedupeKey, maxAttempts],
  );
  return r.rows[0] ? Number(r.rows[0].id) : null;
}

/** Cancel queued jobs whose dedupe key starts with `prefix` (a rescheduled announcement). */
async function cancelByPrefix(prefix, exec = db) {
  const r = await exec.query(
    `UPDATE jobs SET status = 'cancelled', finished_at = now()
      WHERE status IN ('queued', 'retry') AND dedupe_key LIKE $1`,
    [`${String(prefix).replace(/[%_\\]/g, '\\$&')}%`],
  );
  return r.rowCount;
}

/** Seconds to wait before attempt n+1: 30s, 2m, 8m, 32m, 2h… capped at 6h. */
function backoffSeconds(attempts) {
  return Math.min(6 * 3600, 30 * 4 ** Math.max(0, attempts - 1));
}

async function finish(job, status, error = null, retryAt = null) {
  await db.query(
    `UPDATE jobs
        SET status = $2, last_error = $3, locked_at = NULL,
            finished_at = CASE WHEN $5 THEN now() ELSE NULL END,
            run_at = COALESCE($4::timestamptz, run_at)
      WHERE id = $1`,
    [job.id, status, error ? String(error).slice(0, 2000) : null, retryAt, status === 'done' || status === 'failed'],
  );
}

/**
 * Run the jobs that are due now (at most `limit`). Returns how many ran.
 * Jobs of a type nobody registered fail permanently rather than loop.
 */
async function runDue({ limit = 20 } = {}) {
  // Work a crashed instance left half-done goes back in the queue.
  await db.query(
    `UPDATE jobs SET status = 'retry', locked_at = NULL
      WHERE status = 'running' AND locked_at < now() - ($1 || ' minutes')::interval`,
    [String(STALE_LOCK_MINUTES)],
  );
  const claimed = (await db.query(
    `UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM jobs
         WHERE status IN ('queued', 'retry') AND run_at <= now()
         ORDER BY run_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT $1)
      RETURNING *`,
    [limit],
  )).rows;

  for (const job of claimed) {
    const handler = handlers.get(job.type);
    if (!handler) {
      await finish(job, 'failed', `No handler for job type "${job.type}"`);
      continue;
    }
    try {
      await handler(job.payload || {}, job);
      await finish(job, 'done');
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      if (err && err.permanent) {
        await finish(job, 'failed', message);
      } else if (job.attempts >= job.max_attempts) {
        await finish(job, 'failed', message);
        console.error(`[jobs] ${job.type} #${job.id} failed for good: ${message}`);
      } else {
        const retryAt = new Date(Date.now() + backoffSeconds(job.attempts) * 1000).toISOString();
        await finish(job, 'retry', message, retryAt);
      }
    }
  }
  return claimed.length;
}

/**
 * Poll for due jobs every `intervalMs` (JOBS_INTERVAL_MS, default 15 s).
 * One pass at a time; returns a function that stops the loop.
 */
function start({ intervalMs = Number(process.env.JOBS_INTERVAL_MS) || 15000, onTick = null } = {}) {
  let busy = false;
  let stopped = false;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      if (onTick) await onTick();
      // Keep going while full batches come back, so a backlog drains quickly.
      // eslint-disable-next-line no-await-in-loop
      while (!stopped && (await runDue()) >= 20);
    } catch (err) {
      console.error('[jobs] pass failed:', err.message);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  setTimeout(tick, Math.min(5000, intervalMs)).unref();
  return () => { stopped = true; clearInterval(timer); };
}

/** Counts by status, and the most recent failures, for the owner console. */
async function stats() {
  const [counts, failures] = await Promise.all([
    db.query(`SELECT status, COUNT(*)::int AS n FROM jobs WHERE created_at > now() - interval '7 days' GROUP BY status`),
    db.query(`SELECT id, type, attempts, last_error, finished_at FROM jobs WHERE status = 'failed' ORDER BY finished_at DESC NULLS LAST LIMIT 10`),
  ]);
  return {
    counts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])),
    recentFailures: failures.rows,
  };
}

/** Finished jobs older than two weeks are deleted (housekeeping). */
async function prune() {
  const r = await db.query(
    `DELETE FROM jobs WHERE status IN ('done', 'cancelled') AND finished_at < now() - interval '14 days'`,
  );
  return r.rowCount;
}

module.exports = { register, enqueue, cancelByPrefix, runDue, start, stats, prune, backoffSeconds, PermanentJobError };
