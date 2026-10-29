/**
 * @file repoCheck.service.js
 * @description The GitHub check (plan, Phase 5; J1 "github"): was a
 * project's repository made, or worked on, before the event started — a
 * sign a team came with a finished project? It is a warning for the
 * organiser, never a verdict: a README or a template committed the evening
 * before is normal.
 *
 * Public repositories only, through the GitHub REST API (GITHUB_TOKEN raises
 * the 60 requests an hour GitHub allows without one; GITHUB_API_BASE points
 * the tests at a fake). Each check replaces the project's row in
 * submission_repo_checks.
 *
 * Flags: CREATED_BEFORE_START, COMMITS_BEFORE_START, NO_COMMITS_DURING,
 * NOT_FOUND (missing or private). Status: ok, warn, skipped (not GitHub),
 * error (GitHub did not answer; the job tries again).
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');

const API = () => (process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/+$/, '');
const PAGE = 100;

/** owner/repo from a github.com link, or null. */
function parseGithub(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch (_) { return null; }
  if (!/^(www\.)?github\.com$/i.test(u.hostname) || !/^https?:$/.test(u.protocol)) return null;
  const [owner, repo] = u.pathname.split('/').filter(Boolean);
  if (!owner || !repo) return null;
  const clean = repo.replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(clean)) return null;
  return { owner, repo: clean };
}

class RetryLater extends Error {}

async function gh(path) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'HackOS', 'X-GitHub-Api-Version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let res;
  try {
    res = await fetch(`${API()}${path}`, { headers, signal: AbortSignal.timeout(10000) });
  } catch (err) {
    throw new RetryLater(`GitHub did not answer: ${err.message}`);
  }
  if (res.status === 403 || res.status === 429) throw new RetryLater(`GitHub refused (${res.status}), probably the rate limit`);
  if (res.status >= 500) throw new RetryLater(`GitHub error ${res.status}`);
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
}

/** Commits in a window, counted up to one page ("100" means "100 or more"). */
async function commits(o, r, { since = null, until = null } = {}) {
  const q = new URLSearchParams({ per_page: String(PAGE) });
  if (since) q.set('since', new Date(since).toISOString());
  if (until) q.set('until', new Date(until).toISOString());
  const out = await gh(`/repos/${o}/${r}/commits?${q}`);
  if (out.status === 409) return 0; // an empty repository
  if (out.status !== 200 || !Array.isArray(out.body)) return null;
  return out.body.length;
}

async function save(submissionId, row) {
  await db.query(
    `INSERT INTO submission_repo_checks (submission_id, repo, status, flags, repo_created_at, pushed_at, commits_before, commits_during, error, checked_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     ON CONFLICT (submission_id) DO UPDATE SET repo = EXCLUDED.repo, status = EXCLUDED.status, flags = EXCLUDED.flags,
       repo_created_at = EXCLUDED.repo_created_at, pushed_at = EXCLUDED.pushed_at, commits_before = EXCLUDED.commits_before,
       commits_during = EXCLUDED.commits_during, error = EXCLUDED.error, checked_at = now()`,
    [submissionId, row.repo || null, row.status, row.flags || [], row.createdAt || null, row.pushedAt || null,
      row.commitsBefore ?? null, row.commitsDuring ?? null, row.error || null],
  );
}

/**
 * Check one project now. Throws RetryLater when GitHub cannot be asked
 * (the job retries); everything else is stored as the result.
 */
async function checkSubmission(submissionId) {
  const r = await db.query(
    `SELECT s.id, s.repo_link, e.start_date, e.end_date
       FROM submissions s JOIN events e ON e.id = s.event_id WHERE s.id = $1`,
    [submissionId],
  );
  const s = r.rows[0];
  if (!s) return null;
  const parsed = parseGithub(s.repo_link);
  if (!parsed) {
    const row = { status: 'skipped', flags: [], repo: s.repo_link ? String(s.repo_link).slice(0, 200) : null };
    await save(s.id, row);
    return row;
  }
  const repo = `${parsed.owner}/${parsed.repo}`;
  const info = await gh(`/repos/${parsed.owner}/${parsed.repo}`);
  if (info.status === 404) {
    const row = { status: 'warn', flags: ['NOT_FOUND'], repo };
    await save(s.id, row);
    return row;
  }
  if (info.status !== 200 || !info.body) throw new RetryLater(`GitHub answered ${info.status}`);
  const start = s.start_date ? new Date(s.start_date) : null;
  const end = s.end_date ? new Date(Math.min(new Date(s.end_date).getTime(), Date.now())) : new Date();
  const flags = [];
  const createdAt = info.body.created_at || null;
  let before = null;
  let during = null;
  if (start) {
    if (createdAt && new Date(createdAt) < start) flags.push('CREATED_BEFORE_START');
    before = await commits(parsed.owner, parsed.repo, { until: start });
    if (before > 0) flags.push('COMMITS_BEFORE_START');
    during = await commits(parsed.owner, parsed.repo, { since: start, until: end });
    if (during === 0) flags.push('NO_COMMITS_DURING');
  }
  const row = {
    status: flags.length ? 'warn' : 'ok', flags, repo, createdAt, pushedAt: info.body.pushed_at || null, commitsBefore: before, commitsDuring: during,
  };
  await save(s.id, row);
  return row;
}

/** Every project of the event with its last check (or none yet). */
async function listForEvent(eventId) {
  const r = await db.query(
    `SELECT s.id AS submission_id, s.repo_link, s.project_name, t.name AS team_name,
            c.repo, c.status, c.flags, c.repo_created_at, c.pushed_at, c.commits_before, c.commits_during, c.error, c.checked_at
       FROM submissions s JOIN teams t ON t.id = s.team_id
       LEFT JOIN submission_repo_checks c ON c.submission_id = s.id
      WHERE s.event_id = $1
      ORDER BY (c.status = 'warn') DESC NULLS LAST, LOWER(t.name)`,
    [eventId],
  );
  return r.rows.map((x) => ({
    submissionId: Number(x.submission_id),
    teamName: x.team_name,
    projectName: x.project_name || null,
    repoLink: x.repo_link || null,
    github: Boolean(parseGithub(x.repo_link)),
    check: x.status ? {
      status: x.status,
      flags: x.flags || [],
      repo: x.repo,
      createdAt: x.repo_created_at,
      pushedAt: x.pushed_at,
      commitsBefore: x.commits_before,
      commitsDuring: x.commits_during,
      commitsCapped: PAGE,
      error: x.error,
      checkedAt: x.checked_at,
    } : null,
  }));
}

/** Queue checks for some projects of the event, or all of them with a GitHub link. */
async function queueForEvent(eventId, submissionIds, jobs) {
  const ids = Array.isArray(submissionIds) ? submissionIds.map(Number).filter((n) => Number.isInteger(n) && n > 0) : null;
  const r = ids && ids.length
    ? await db.query('SELECT id, repo_link FROM submissions WHERE event_id = $1 AND id = ANY($2::int[])', [eventId, ids])
    : await db.query('SELECT id, repo_link FROM submissions WHERE event_id = $1', [eventId]);
  const list = r.rows.filter((x) => parseGithub(x.repo_link));
  if (ids && ids.length && !r.rows.length) throw httpError(404, 'Project not found', 'NOT_FOUND');
  const stamp = Date.now();
  for (const x of list) {
    // eslint-disable-next-line no-await-in-loop
    await jobs.enqueue('repo.check', { submissionId: Number(x.id) }, { dedupeKey: `repo-check:${x.id}:${stamp}`, maxAttempts: 4 });
  }
  return { queued: list.length, notGithub: r.rows.length - list.length };
}

/**
 * Events with the check switched on whose projects are in (the deadline or
 * the end has passed, within the last two weeks) and projects not checked
 * since they last changed.
 */
async function dueChecks() {
  const r = await db.query(
    `SELECT s.id
       FROM submissions s
       JOIN events e ON e.id = s.event_id
       LEFT JOIN submission_repo_checks c ON c.submission_id = s.id
      WHERE e.submission_config->>'githubCheck' = 'true'
        AND e.archived_at IS NULL
        AND COALESCE(e.submission_deadline, e.end_date) < now()
        AND COALESCE(e.submission_deadline, e.end_date) > now() - interval '14 days'
        AND s.repo_link ILIKE '%github.com/%'
        AND (c.submission_id IS NULL OR c.checked_at < COALESCE(s.updated_at, s.submitted_at)
             OR c.checked_at < COALESCE(e.submission_deadline, e.end_date))
      LIMIT 200`,
  );
  return r.rows.map((x) => Number(x.id));
}

module.exports = { parseGithub, checkSubmission, listForEvent, queueForEvent, dueChecks, RetryLater };
