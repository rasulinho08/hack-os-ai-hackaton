/**
 * @file judging.service.js
 * @description Who judges what, and the rules a score has to pass.
 *
 * The organiser's judging settings (builder → Judging) decide which teams a
 * judge sees and may score:
 *
 *   all       every judge, every team (the default, decision E7)
 *   track     a judge with a track judges that track's teams; a judge
 *             without one judges every team
 *   per_team  each team gets N judges, assigned evenly (generateAssignments)
 *             or by hand
 *
 * Never: a team the judge belongs to, a team they declared a conflict of
 * interest with, an eliminated team, a team without a single participant the
 * organiser accepted (it is not judged, voted for or ranked until one of its
 * members is approved). With "blind" on, judges see a project
 * number instead of the team's name and never its members. A score also has
 * to fall in the judging window (from the judging start, else from the moment
 * submissions close), before results are published, while the
 * event is not archived, after the judge confirmed the conflict-of-interest
 * declaration when the organiser asks for one, and within the criterion's
 * range. One review (all criteria plus written feedback) is saved in one
 * transaction.
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const { CONFIG_DEFAULTS } = require('../constants/eventBuilder');
const submissionService = require('./submission.service');

const config = (event) => ({ ...CONFIG_DEFAULTS.judging_config, ...(event?.judging_config || {}) });

async function loadEvent(eventId, exec = db) {
  const r = await exec.query(
    `SELECT id, name, status, archived_at, judging_config, judging_start, judging_end,
            results_published_at, results_outdated_confirmation, start_date, end_date, submission_deadline
       FROM events WHERE id = $1`,
    [eventId],
  );
  if (!r.rows[0]) throw httpError(404, 'Event not found', 'NOT_FOUND');
  return r.rows[0];
}

const isArchived = (e) => Boolean(e.archived_at) || String(e.status || '').toLowerCase() === 'archived';

/**
 * When judging opens: the organiser's judging start, else the moment
 * submissions close (the submission deadline, else the end of the event), so
 * judges score finished projects. Null when the event has none of these.
 */
function opensAt(event) {
  if (event.judging_start) return new Date(event.judging_start);
  const close = event.submission_deadline || event.end_date;
  return close ? new Date(close) : null;
}

/** Where the judging window stands: open, not yet open, closed, published or archived. */
function windowState(event, now = Date.now()) {
  if (isArchived(event)) return 'archived';
  if (event.results_published_at) return 'published';
  const start = opensAt(event);
  if (start && now < start.getTime()) return 'not_open';
  if (event.judging_end && now > new Date(event.judging_end).getTime()) return 'closed';
  return 'open';
}

/** The judging window for the pages: its state and when it opens and closes. */
function windowInfo(event) {
  const start = opensAt(event);
  return {
    state: windowState(event),
    start: start ? start.toISOString() : null,
    end: event.judging_end || null,
    // Without a judging start of its own, judging opens when submissions close.
    startsAtDeadline: !event.judging_start && Boolean(start),
  };
}

/**
 * Per judge and project: when the judge last saved their review (a score or
 * the written feedback) and whether the team changed its project after that.
 * A changed review still counts; it is flagged until the judge saves it again.
 * @returns {Promise<Map<string, { reviewedAt: Date, changed: boolean, changedAt: Date|null }>>} keyed "judgeId:submissionId"
 */
async function reviewTimes(eventId, judgeId = null, exec = db) {
  const r = await exec.query(
    `SELECT x.judge_id, x.submission_id, MAX(x.at) AS reviewed_at, s.content_changed_at
       FROM (
         SELECT sc.judge_id, sc.submission_id, sc.updated_at AS at FROM scores sc
         UNION ALL
         SELECT jr.judge_id, jr.submission_id, jr.updated_at FROM judge_reviews jr
       ) x
       JOIN submissions s ON s.id = x.submission_id AND s.event_id = $1
       JOIN judges j ON j.id = x.judge_id AND j.event_id = $1
      WHERE ($2::int IS NULL OR x.judge_id = $2::int)
      GROUP BY x.judge_id, x.submission_id, s.content_changed_at`,
    [eventId, judgeId],
  );
  return new Map(r.rows.map((row) => [`${row.judge_id}:${row.submission_id}`, {
    reviewedAt: row.reviewed_at,
    changedAt: row.content_changed_at || null,
    changed: Boolean(row.content_changed_at && new Date(row.content_changed_at) > new Date(row.reviewed_at)),
  }]));
}

const WINDOW_ERRORS = {
  archived: [409, 'The event is archived. Nothing can change any more.', 'EVENT_ARCHIVED'],
  published: [409, 'Results are published. Unpublish them to change scores.', 'RESULTS_PUBLISHED'],
  not_open: [403, 'Judging has not opened yet.', 'JUDGING_NOT_OPEN'],
  closed: [403, 'Judging has closed.', 'JUDGING_CLOSED'],
};

function assertWindow(event) {
  const state = windowState(event);
  if (state !== 'open') throw httpError(...WINDOW_ERRORS[state]);
}

async function judgeFor(userId, eventId, exec = db) {
  const r = await exec.query('SELECT * FROM judges WHERE event_id = $1 AND user_id = $2', [eventId, userId]);
  return r.rows[0] || null;
}

/**
 * SQL: team `t` has at least one member the organiser approved for its
 * event. Without one a team is not judged, voted for or ranked.
 */
const HAS_APPROVED_MEMBER = (t = 't') => `EXISTS (
  SELECT 1 FROM team_members tm_ok
    JOIN participants p_ok ON p_ok.user_id = tm_ok.user_id AND p_ok.event_id = ${t}.event_id
   WHERE tm_ok.team_id = ${t}.id AND LOWER(TRIM(p_ok.status::text)) = 'approved')`;

/**
 * Teams that can be judged: with a project handed in and an approved member.
 * Eliminated teams stay on the list (marked) so the pages can show them.
 */
async function eligibleTeams(eventId, exec = db) {
  const r = await exec.query(
    `SELECT t.id AS team_id, t.name AS team_name, LOWER(COALESCE(t.status, 'active')) AS team_status,
            COALESCE(s.track_id, t.track_id) AS track_id, tr.name AS track_name,
            s.id AS submission_id, s.project_name, s.description, s.repo_link, s.demo_link,
            s.presentation_link, s.video_link, s.tech_stack, s.submitted_at
       FROM teams t
       JOIN submissions s ON s.team_id = t.id AND s.event_id = t.event_id
       LEFT JOIN tracks tr ON tr.id = COALESCE(s.track_id, t.track_id)
      WHERE t.event_id = $1
        AND (LOWER(COALESCE(t.status, 'active')) = 'eliminated' OR ${HAS_APPROVED_MEMBER('t')})
      ORDER BY s.id`,
    [eventId],
  );
  return r.rows;
}

/** Teams with a project but no approved member: not judged, voted for or ranked. */
async function ineligibleTeams(eventId, exec = db) {
  const r = await exec.query(
    `SELECT t.id AS team_id, t.name AS team_name, s.id AS submission_id, s.project_name,
            COALESCE(s.track_id, t.track_id) AS track_id, tr.name AS track_name
       FROM teams t
       JOIN submissions s ON s.team_id = t.id AND s.event_id = t.event_id
       LEFT JOIN tracks tr ON tr.id = COALESCE(s.track_id, t.track_id)
      WHERE t.event_id = $1
        AND LOWER(COALESCE(t.status, 'active')) <> 'eliminated' AND NOT ${HAS_APPROVED_MEMBER('t')}
      ORDER BY s.id`,
    [eventId],
  );
  return r.rows;
}

/** Teams this judge's account belongs to in the event: always a conflict. */
async function ownTeamIds(eventId, userId, exec = db) {
  const r = await exec.query(
    `SELECT tm.team_id FROM team_members tm JOIN teams t ON t.id = tm.team_id
      WHERE t.event_id = $1 AND tm.user_id = $2`,
    [eventId, userId],
  );
  return new Set(r.rows.map((x) => Number(x.team_id)));
}

/**
 * What this judge may judge.
 * @returns {Promise<{ cfg, teams, allowed: Set<number>, conflicts: Map<number,string|null>, own: Set<number>, labels: Map<number,number> }>}
 */
async function scopeFor(event, judge, exec = db) {
  const cfg = config(event);
  const teams = await eligibleTeams(event.id, exec);
  const [conf, own, assigned] = await Promise.all([
    exec.query('SELECT team_id, reason FROM judge_conflicts WHERE judge_id = $1', [judge.id]),
    ownTeamIds(event.id, judge.user_id, exec),
    cfg.assignment === 'per_team'
      ? exec.query('SELECT team_id FROM judge_assignments WHERE judge_id = $1', [judge.id])
      : Promise.resolve({ rows: [] }),
  ]);
  const conflicts = new Map(conf.rows.map((x) => [Number(x.team_id), x.reason || null]));
  const active = teams.filter((t) => t.team_status !== 'eliminated');
  let pool;
  if (cfg.assignment === 'per_team') {
    const ids = new Set(assigned.rows.map((x) => Number(x.team_id)));
    pool = active.filter((t) => ids.has(Number(t.team_id)));
  } else if (cfg.assignment === 'track' && judge.track_id) {
    pool = active.filter((t) => Number(t.track_id) === Number(judge.track_id));
  } else {
    pool = active;
  }
  const allowed = new Set(pool
    .map((t) => Number(t.team_id))
    .filter((id) => !conflicts.has(id) && !own.has(id)));
  // A stable number per project for blind judging (by hand-in order).
  const labels = new Map(teams.map((t, i) => [Number(t.team_id), i + 1]));
  return { cfg, teams, allowed, conflicts, own, labels };
}

/** Why this judge may not score this team, or null when they may. */
function refusal(scope, teamId, team) {
  if (!team) return [404, 'Submission not found for this event', 'NOT_FOUND'];
  if (team.team_status === 'eliminated') return [409, 'This team is eliminated.', 'TEAM_ELIMINATED'];
  if (scope.own.has(teamId)) return [403, 'You cannot judge your own team.', 'CONFLICT_OF_INTEREST'];
  if (scope.conflicts.has(teamId)) return [403, 'You declared a conflict of interest with this team.', 'CONFLICT_OF_INTEREST'];
  if (!scope.allowed.has(teamId)) return [403, 'This team is not assigned to you.', 'NOT_ASSIGNED'];
  return null;
}

/**
 * Where one judge's review of one team stands: todo (nothing scored), partial
 * (some criteria) or done (every criterion). Only a done review counts in the
 * ranking; the judge portal, the progress matrix, the submission status and
 * the publish check all read reviews through this one rule.
 */
function reviewState(filled, total) {
  if (!filled) return 'todo';
  return total > 0 && filled >= total ? 'done' : 'partial';
}

async function criteriaOf(eventId, exec = db) {
  const r = await exec.query(
    'SELECT id, name, description, max_score, weight, sort_order FROM scoring_criteria WHERE event_id = $1 ORDER BY sort_order NULLS LAST, id',
    [eventId],
  );
  return r.rows;
}

/** Recompute submissions.status from how many judges reviewed it (best effort). */
/**
 * The judges meant to judge a team under the event's settings: not its own
 * members, not those who declared a conflict, and — by the assignment mode —
 * only those assigned to it (per team) or on its track (by track; a judge
 * without a track judges every track).
 */
async function expectedJudgeIds(event, teamId, trackId, exec = db) {
  const cfg = config(event);
  const [judges, conflicts, members, assigned] = await Promise.all([
    exec.query('SELECT id, user_id, track_id FROM judges WHERE event_id = $1', [event.id]),
    exec.query('SELECT judge_id FROM judge_conflicts WHERE team_id = $1', [teamId]),
    exec.query('SELECT user_id FROM team_members WHERE team_id = $1', [teamId]),
    cfg.assignment === 'per_team'
      ? exec.query('SELECT judge_id FROM judge_assignments WHERE team_id = $1', [teamId])
      : Promise.resolve({ rows: [] }),
  ]);
  const conflicted = new Set(conflicts.rows.map((x) => Number(x.judge_id)));
  const own = new Set(members.rows.map((x) => Number(x.user_id)));
  const mine = new Set(assigned.rows.map((x) => Number(x.judge_id)));
  return judges.rows
    .filter((j) => !conflicted.has(Number(j.id)) && !own.has(Number(j.user_id)))
    .filter((j) => {
      if (cfg.assignment === 'per_team') return mine.has(Number(j.id));
      if (cfg.assignment === 'track' && j.track_id) return Number(j.track_id) === Number(trackId);
      return true;
    })
    .map((j) => Number(j.id));
}

/**
 * submitted → reviewing (someone scored) → graded (every judge meant to
 * judge the team scored every criterion).
 */
async function refreshSubmissionStatus(eventId, submissionId, exec = db) {
  try {
    const sub = (await exec.query(
      `SELECT s.id, s.team_id, COALESCE(s.track_id, t.track_id) AS track_id
         FROM submissions s JOIN teams t ON t.id = s.team_id WHERE s.id = $1 AND s.event_id = $2`,
      [submissionId, eventId],
    )).rows[0];
    if (!sub) return;
    const event = await loadEvent(eventId, exec);
    const [expected, crit, scored] = await Promise.all([
      expectedJudgeIds(event, Number(sub.team_id), sub.track_id, exec),
      exec.query('SELECT COUNT(*)::int AS n FROM scoring_criteria WHERE event_id = $1', [eventId]),
      exec.query(
        `SELECT sc.judge_id, COUNT(DISTINCT sc.criterion_id)::int AS n
           FROM scores sc JOIN judges j ON j.id = sc.judge_id AND j.event_id = $1
          WHERE sc.submission_id = $2 GROUP BY sc.judge_id`,
        [eventId, submissionId],
      ),
    ]);
    const criteria = crit.rows[0].n;
    const byJudge = new Map(scored.rows.map((x) => [Number(x.judge_id), x.n]));
    const done = expected.length > 0 && expected.every((id) => reviewState(byJudge.get(id) || 0, criteria) === 'done');
    const next = done ? 'graded' : byJudge.size > 0 ? 'reviewing' : 'submitted';
    await exec.query('UPDATE submissions SET status = $1 WHERE id = $2 AND status <> $1', [next, submissionId]);
  } catch (err) {
    console.warn('[judging] submission status not refreshed:', err.message);
  }
}

/**
 * Check one score the way every scoring route must (old single-criterion
 * routes included): the judge, the window, the team, the criterion, the range.
 */
async function assertCanScore(userId, eventId, submissionId) {
  const event = await loadEvent(eventId);
  const judge = await judgeFor(userId, eventId);
  if (!judge) throw httpError(403, 'You are not a judge for this event', 'NOT_EVENT_JUDGE');
  assertWindow(event);
  const scope = await scopeFor(event, judge);
  if (scope.cfg.coiRequired && !judge.coi_confirmed_at) {
    throw httpError(403, 'Confirm the conflict-of-interest declaration first.', 'COI_NOT_CONFIRMED');
  }
  const team = scope.teams.find((t) => Number(t.submission_id) === Number(submissionId));
  if (!team && (await ineligibleTeams(eventId)).some((t) => Number(t.submission_id) === Number(submissionId))) {
    throw httpError(409, 'No member of this team has been accepted to the event, so it is not judged.', 'TEAM_NOT_ELIGIBLE');
  }
  const why = refusal(scope, team ? Number(team.team_id) : -1, team);
  if (why) throw httpError(...why);
  return { event, judge, scope, team };
}

const num = (raw) => {
  const n = typeof raw === 'string' ? Number(raw.trim().replace(',', '.')) : Number(raw);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Save one judge's review of one project: every criterion they filled in and
 * the written feedback, all or nothing.
 *
 * @param {{ submissionId: number, scores: Array<{ criterionId: number, score: number }>, feedback?: string|null }} body
 */
async function saveReview(userId, eventId, body) {
  const submissionId = Number(body?.submissionId);
  if (!Number.isInteger(submissionId) || submissionId <= 0) {
    throw httpError(400, 'submissionId is required', 'VALIDATION_ERROR');
  }
  const { judge } = await assertCanScore(userId, eventId, submissionId);
  const criteria = await criteriaOf(eventId);
  const byId = new Map(criteria.map((c) => [Number(c.id), c]));
  const list = Array.isArray(body.scores) ? body.scores : [];
  const errors = [];
  const clean = [];
  const seen = new Set();
  for (const s of list) {
    const c = byId.get(Number(s?.criterionId));
    if (!c) { errors.push({ field: `scores.${s?.criterionId}`, code: 'UNKNOWN_CRITERION', message: 'Not a criterion of this event.' }); continue; }
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const v = num(s.score);
    const max = Number(c.max_score) || 10;
    if (!Number.isFinite(v) || v < 0 || v > max) {
      errors.push({ field: `scores.${c.id}`, code: 'SCORE_OUT_OF_RANGE', message: `Between 0 and ${max}.` });
      continue;
    }
    clean.push({ criterionId: c.id, score: Math.round(v * 100) / 100 });
  }
  const hasFeedback = typeof body.feedback === 'string';
  const feedback = hasFeedback ? body.feedback.trim().slice(0, 4000) : null;
  if (errors.length) throw httpError(400, 'Some scores are not valid.', 'VALIDATION_ERROR', { errors });
  if (!clean.length && !hasFeedback) throw httpError(400, 'Nothing to save.', 'VALIDATION_ERROR');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const s of clean) {
      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `INSERT INTO scores (judge_id, submission_id, criterion_id, score)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (judge_id, submission_id, criterion_id) DO UPDATE SET score = EXCLUDED.score`,
        [judge.id, submissionId, s.criterionId, s.score],
      );
    }
    if (hasFeedback) {
      await client.query(
        `INSERT INTO judge_reviews (judge_id, submission_id, feedback) VALUES ($1, $2, $3)
         ON CONFLICT (judge_id, submission_id) DO UPDATE SET feedback = EXCLUDED.feedback, updated_at = now()`,
        [judge.id, submissionId, feedback || null],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await refreshSubmissionStatus(eventId, submissionId);
  return reviewOf(judge.id, submissionId, criteria);
}

async function reviewOf(judgeId, submissionId, criteria) {
  const [sc, rv] = await Promise.all([
    db.query('SELECT criterion_id, score FROM scores WHERE judge_id = $1 AND submission_id = $2', [judgeId, submissionId]),
    db.query('SELECT feedback FROM judge_reviews WHERE judge_id = $1 AND submission_id = $2', [judgeId, submissionId]),
  ]);
  const scores = Object.fromEntries(sc.rows.map((r) => [Number(r.criterion_id), Number(r.score)]));
  const filled = criteria.filter((c) => scores[Number(c.id)] != null).length;
  return {
    submissionId,
    scores,
    feedback: rv.rows[0]?.feedback ?? null,
    state: reviewState(filled, criteria.length),
  };
}

/**
 * Everything the judge portal needs for one event, with blind judging and
 * assignment applied here rather than in the browser.
 */
async function myJudging(userId, eventId) {
  const event = await loadEvent(eventId);
  const judge = await judgeFor(userId, eventId);
  if (!judge) throw httpError(403, 'You are not a judge for this event', 'NOT_EVENT_JUDGE');
  const scope = await scopeFor(event, judge);
  const criteria = await criteriaOf(eventId);
  const blind = Boolean(scope.cfg.blind);

  const ids = scope.teams.map((t) => Number(t.submission_id));
  const [scores, reviews, files, order, times] = await Promise.all([
    db.query('SELECT submission_id, criterion_id, score FROM scores WHERE judge_id = $1', [judge.id]),
    db.query('SELECT submission_id, feedback FROM judge_reviews WHERE judge_id = $1', [judge.id]),
    submissionService.filesFor(ids),
    db.query('SELECT submission_id, presentation_order, scheduled_at FROM presentations WHERE event_id = $1', [eventId]),
    reviewTimes(eventId, judge.id),
  ]);
  const mine = {};
  for (const r of scores.rows) (mine[r.submission_id] ||= {})[Number(r.criterion_id)] = Number(r.score);
  const fb = new Map(reviews.rows.map((r) => [Number(r.submission_id), r.feedback]));
  const pres = new Map(order.rows.map((r) => [Number(r.submission_id), r]));

  const view = (t) => {
    const sid = Number(t.submission_id);
    const my = mine[sid] || {};
    const filled = criteria.filter((c) => my[Number(c.id)] != null).length;
    return {
      teamId: Number(t.team_id),
      submissionId: sid,
      number: scope.labels.get(Number(t.team_id)),
      teamName: blind ? null : t.team_name,
      projectName: t.project_name || null,
      description: t.description || null,
      repoLink: t.repo_link || null,
      demoLink: t.demo_link || null,
      slidesLink: t.presentation_link || null,
      videoLink: t.video_link || null,
      techStack: t.tech_stack || null,
      track: t.track_name || null,
      files: files[sid] || [],
      presentationOrder: pres.get(sid)?.presentation_order ?? null,
      presentationAt: pres.get(sid)?.scheduled_at ?? null,
      scores: my,
      feedback: fb.get(sid) ?? null,
      state: reviewState(filled, criteria.length),
      reviewedAt: times.get(`${judge.id}:${sid}`)?.reviewedAt ?? null,
      // The team changed its project after this judge's review: look again.
      changedSinceReview: Boolean(times.get(`${judge.id}:${sid}`)?.changed),
      changedAt: times.get(`${judge.id}:${sid}`)?.changed ? times.get(`${judge.id}:${sid}`).changedAt : null,
    };
  };

  const teams = scope.teams.filter((t) => scope.allowed.has(Number(t.team_id))).map(view);
  teams.sort((a, b) => (a.presentationOrder ?? 1e9) - (b.presentationOrder ?? 1e9) || a.number - b.number);
  const declared = scope.teams
    .filter((t) => scope.conflicts.has(Number(t.team_id)))
    .map((t) => ({
      teamId: Number(t.team_id),
      number: scope.labels.get(Number(t.team_id)),
      teamName: blind ? null : t.team_name,
      projectName: t.project_name || null,
      reason: scope.conflicts.get(Number(t.team_id)),
    }));
  // Teams the judge could still declare a conflict with (the ones they see).
  return {
    event: { id: event.id, name: event.name },
    judge: { id: judge.id, trackId: judge.track_id, coiConfirmedAt: judge.coi_confirmed_at },
    config: { blind, assignment: scope.cfg.assignment, coiRequired: Boolean(scope.cfg.coiRequired) },
    window: windowInfo(event),
    criteria: criteria.map((c) => ({
      id: Number(c.id), name: c.name, description: c.description, maxScore: Number(c.max_score), weight: Number(c.weight),
    })),
    teams,
    conflicts: declared,
    progress: {
      total: teams.length,
      done: teams.filter((t) => t.state === 'done').length,
      partial: teams.filter((t) => t.state === 'partial').length,
      changed: teams.filter((t) => t.changedSinceReview).length,
    },
  };
}

async function confirmCoi(userId, eventId) {
  const judge = await judgeFor(userId, eventId);
  if (!judge) throw httpError(403, 'You are not a judge for this event', 'NOT_EVENT_JUDGE');
  const r = await db.query(
    'UPDATE judges SET coi_confirmed_at = COALESCE(coi_confirmed_at, now()) WHERE id = $1 RETURNING coi_confirmed_at',
    [judge.id],
  );
  return { coiConfirmedAt: r.rows[0].coi_confirmed_at };
}

/** A judge (or the organiser for them) records a conflict with a team. */
async function declareConflict(eventId, judgeId, teamId, reason, actorId) {
  const t = await db.query('SELECT id FROM teams WHERE id = $1 AND event_id = $2', [teamId, eventId]);
  if (!t.rows[0]) throw httpError(404, 'Team not found', 'TEAM_NOT_FOUND');
  const j = await db.query('SELECT id FROM judges WHERE id = $1 AND event_id = $2', [judgeId, eventId]);
  if (!j.rows[0]) throw httpError(404, 'Judge not found', 'NOT_FOUND');
  const r = await db.query(
    `INSERT INTO judge_conflicts (event_id, judge_id, team_id, reason, declared_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (judge_id, team_id) DO UPDATE SET reason = EXCLUDED.reason
     RETURNING *`,
    [eventId, judgeId, teamId, reason ? String(reason).trim().slice(0, 300) : null, actorId || null],
  );
  // The judge no longer reviews that team: drop the assignment, keep any scores
  // (results leave them out while the conflict stands).
  await db.query('DELETE FROM judge_assignments WHERE judge_id = $1 AND team_id = $2', [judgeId, teamId]);
  return r.rows[0];
}

async function clearConflict(eventId, judgeId, teamId) {
  const r = await db.query(
    'DELETE FROM judge_conflicts WHERE event_id = $1 AND judge_id = $2 AND team_id = $3 RETURNING id',
    [eventId, judgeId, teamId],
  );
  return Boolean(r.rows[0]);
}

async function listConflicts(eventId) {
  const r = await db.query(
    `SELECT c.id, c.judge_id, c.team_id, c.reason, c.created_at, u.full_name AS judge_name, t.name AS team_name,
            (c.declared_by = j.user_id) AS by_judge
       FROM judge_conflicts c
       JOIN judges j ON j.id = c.judge_id
       JOIN users u ON u.id = j.user_id
       JOIN teams t ON t.id = c.team_id
      WHERE c.event_id = $1
      ORDER BY c.created_at DESC`,
    [eventId],
  );
  return r.rows;
}

async function setJudgeTrack(eventId, judgeId, trackId) {
  if (trackId != null) {
    const tr = await db.query('SELECT id FROM tracks WHERE id = $1 AND event_id = $2', [trackId, eventId]);
    if (!tr.rows[0]) throw httpError(400, 'Track not found in this event', 'VALIDATION_ERROR');
  }
  const r = await db.query(
    'UPDATE judges SET track_id = $3 WHERE id = $1 AND event_id = $2 RETURNING *',
    [judgeId, eventId, trackId == null ? null : Number(trackId)],
  );
  if (!r.rows[0]) throw httpError(404, 'Judge not found', 'NOT_FOUND');
  return r.rows[0];
}

/** { [judgeId]: [teamId, …] } */
async function listAssignments(eventId) {
  const r = await db.query('SELECT judge_id, team_id FROM judge_assignments WHERE event_id = $1 ORDER BY team_id', [eventId]);
  const out = {};
  for (const row of r.rows) (out[row.judge_id] ||= []).push(Number(row.team_id));
  return out;
}

/**
 * Give every judgeable team N judges, spreading the work evenly. Judges who
 * already scored a team keep it; with `replace` the rest is drawn again,
 * otherwise existing assignments stay and only the gaps are filled. Never a
 * judge's own team or a declared conflict.
 *
 * @returns {Promise<{ assigned: number, shortfall: Array<{ teamId, missing }> }>}
 */
async function generateAssignments(eventId, { replace = false } = {}) {
  const event = await loadEvent(eventId);
  if (isArchived(event)) throw httpError(...WINDOW_ERRORS.archived);
  const cfg = config(event);
  const per = Math.max(1, Number(cfg.judgesPerTeam) || 1);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM events WHERE id = $1 FOR UPDATE', [eventId]);
    const teams = (await eligibleTeams(eventId, client)).filter((t) => t.team_status !== 'eliminated');
    const judges = (await client.query('SELECT id, user_id FROM judges WHERE event_id = $1 ORDER BY id', [eventId])).rows;
    const blocked = new Set((await client.query(
      `SELECT judge_id || ':' || team_id AS k FROM judge_conflicts WHERE event_id = $1
       UNION
       SELECT j.id || ':' || tm.team_id FROM judges j
         JOIN team_members tm ON tm.user_id = j.user_id
         JOIN teams t ON t.id = tm.team_id AND t.event_id = j.event_id
        WHERE j.event_id = $1`,
      [eventId],
    )).rows.map((r) => r.k));
    const scored = new Set((await client.query(
      `SELECT DISTINCT sc.judge_id || ':' || s.team_id AS k
         FROM scores sc JOIN submissions s ON s.id = sc.submission_id WHERE s.event_id = $1`,
      [eventId],
    )).rows.map((r) => r.k));

    let current = (await client.query('SELECT judge_id, team_id FROM judge_assignments WHERE event_id = $1', [eventId])).rows;
    if (replace) {
      const keep = current.filter((a) => scored.has(`${a.judge_id}:${a.team_id}`));
      await client.query('DELETE FROM judge_assignments WHERE event_id = $1', [eventId]);
      for (const a of keep) {
        // eslint-disable-next-line no-await-in-loop
        await client.query('INSERT INTO judge_assignments (event_id, judge_id, team_id) VALUES ($1, $2, $3)', [eventId, a.judge_id, a.team_id]);
      }
      current = keep;
    }
    // A judge who already scored a team keeps it, assigned or not.
    const assignedKeys = new Set(current.map((a) => `${a.judge_id}:${a.team_id}`));
    const eligibleIds = new Set(teams.map((t) => Number(t.team_id)));
    for (const k of scored) {
      if (assignedKeys.has(k) || blocked.has(k)) continue;
      const [jid, tid] = k.split(':').map(Number);
      if (!eligibleIds.has(tid)) continue;
      // eslint-disable-next-line no-await-in-loop
      await client.query('INSERT INTO judge_assignments (event_id, judge_id, team_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [eventId, jid, tid]);
      current.push({ judge_id: jid, team_id: tid });
    }
    const load = new Map(judges.map((j) => [Number(j.id), 0]));
    const byTeam = new Map();
    for (const a of current) {
      load.set(Number(a.judge_id), (load.get(Number(a.judge_id)) || 0) + 1);
      if (!byTeam.has(Number(a.team_id))) byTeam.set(Number(a.team_id), new Set());
      byTeam.get(Number(a.team_id)).add(Number(a.judge_id));
    }
    let assigned = 0;
    const shortfall = [];
    for (const t of teams) {
      const teamId = Number(t.team_id);
      const have = byTeam.get(teamId) || new Set();
      const need = per - have.size;
      if (need <= 0) continue;
      const candidates = judges
        .map((j) => Number(j.id))
        .filter((jid) => !have.has(jid) && !blocked.has(`${jid}:${teamId}`))
        .sort((a, b) => (load.get(a) - load.get(b)) || (a - b));
      const take = candidates.slice(0, need);
      for (const jid of take) {
        // eslint-disable-next-line no-await-in-loop
        await client.query(
          'INSERT INTO judge_assignments (event_id, judge_id, team_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [eventId, jid, teamId],
        );
        load.set(jid, load.get(jid) + 1);
        assigned += 1;
      }
      if (take.length < need) shortfall.push({ teamId, missing: need - take.length });
    }
    await client.query('COMMIT');
    return { assigned, shortfall };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Set exactly which teams one judge reviews (per-team mode, by hand). */
async function setAssignments(eventId, judgeId, teamIds) {
  const j = await db.query('SELECT id, user_id FROM judges WHERE id = $1 AND event_id = $2', [judgeId, eventId]);
  if (!j.rows[0]) throw httpError(404, 'Judge not found', 'NOT_FOUND');
  const ids = [...new Set((Array.isArray(teamIds) ? teamIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length) {
    const ok = await db.query('SELECT id FROM teams WHERE event_id = $1 AND id = ANY($2::int[])', [eventId, ids]);
    if (ok.rows.length !== ids.length) throw httpError(400, 'Some teams are not in this event', 'VALIDATION_ERROR');
    const own = await ownTeamIds(eventId, j.rows[0].user_id);
    const conf = await db.query('SELECT team_id FROM judge_conflicts WHERE judge_id = $1 AND team_id = ANY($2::int[])', [judgeId, ids]);
    const clash = ids.filter((id) => own.has(id) || conf.rows.some((r) => Number(r.team_id) === id));
    if (clash.length) throw httpError(409, 'The judge has a conflict of interest with some of these teams', 'CONFLICT_OF_INTEREST', { teamIds: clash });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM judge_assignments WHERE judge_id = $1', [judgeId]);
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      await client.query('INSERT INTO judge_assignments (event_id, judge_id, team_id) VALUES ($1, $2, $3)', [eventId, judgeId, id]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return ids;
}

/**
 * Who has judged what, for the organiser: one cell per judge and team —
 * done, partial, to do, conflict, or not theirs to judge.
 */
async function progress(eventId) {
  const event = await loadEvent(eventId);
  const cfg = config(event);
  const [judges, criteria, teams, scores, times] = await Promise.all([
    db.query(
      `SELECT j.id, j.user_id, j.track_id, j.coi_confirmed_at, u.full_name
         FROM judges j JOIN users u ON u.id = j.user_id WHERE j.event_id = $1 ORDER BY u.full_name, j.id`,
      [eventId],
    ),
    criteriaOf(eventId),
    eligibleTeams(eventId),
    db.query(
      `SELECT sc.judge_id, s.team_id, COUNT(*)::int AS n
         FROM scores sc JOIN submissions s ON s.id = sc.submission_id
        WHERE s.event_id = $1 GROUP BY sc.judge_id, s.team_id`,
      [eventId],
    ),
    reviewTimes(eventId),
  ]);
  const filled = new Map(scores.rows.map((r) => [`${r.judge_id}:${r.team_id}`, r.n]));
  const total = criteria.length;
  const cells = [];
  const judgeRows = [];
  const teamStats = new Map(teams.map((t) => [Number(t.team_id), { done: 0, partial: 0, assigned: 0, changed: 0 }]));
  for (const j of judges.rows) {
    // eslint-disable-next-line no-await-in-loop
    const scope = await scopeFor(event, j);
    let done = 0;
    let partial = 0;
    let assigned = 0;
    let changed = 0;
    for (const t of teams) {
      const teamId = Number(t.team_id);
      let state;
      let stale = false;
      if (scope.own.has(teamId) || scope.conflicts.has(teamId)) state = 'conflict';
      else if (t.team_status === 'eliminated') state = 'eliminated';
      else if (!scope.allowed.has(teamId)) state = 'na';
      else {
        const n = filled.get(`${j.id}:${teamId}`) || 0;
        state = reviewState(n, total);
        assigned += 1;
        const ts = teamStats.get(teamId);
        ts.assigned += 1;
        if (state === 'done') { done += 1; ts.done += 1; }
        if (state === 'partial') { partial += 1; ts.partial += 1; }
        stale = state !== 'todo' && Boolean(times.get(`${j.id}:${t.submission_id}`)?.changed);
        if (stale) { changed += 1; ts.changed += 1; }
      }
      cells.push({ judgeId: Number(j.id), teamId, state, changedSinceReview: stale });
    }
    judgeRows.push({
      id: Number(j.id), userId: Number(j.user_id), name: j.full_name, trackId: j.track_id,
      coiConfirmedAt: j.coi_confirmed_at, assigned, done, partial, changed,
    });
  }
  return {
    config: { assignment: cfg.assignment, judgesPerTeam: cfg.judgesPerTeam, blind: Boolean(cfg.blind), coiRequired: Boolean(cfg.coiRequired) },
    window: windowInfo(event),
    criteria: total,
    // Reviews older than the team's last change to its project.
    changedSinceReview: cells.filter((c) => c.changedSinceReview).length,
    judges: judgeRows,
    teams: teams.map((t) => ({
      id: Number(t.team_id), name: t.team_name, projectName: t.project_name, submissionId: Number(t.submission_id),
      eliminated: t.team_status === 'eliminated', track: t.track_name || null, ...teamStats.get(Number(t.team_id)),
    })),
    cells,
  };
}

module.exports = {
  config,
  loadEvent,
  windowState,
  windowInfo,
  opensAt,
  reviewTimes,
  assertWindow,
  isArchived,
  judgeFor,
  HAS_APPROVED_MEMBER,
  eligibleTeams,
  ineligibleTeams,
  scopeFor,
  criteriaOf,
  reviewState,
  assertCanScore,
  saveReview,
  myJudging,
  confirmCoi,
  declareConflict,
  clearConflict,
  listConflicts,
  setJudgeTrack,
  listAssignments,
  generateAssignments,
  setAssignments,
  progress,
  refreshSubmissionStatus,
  expectedJudgeIds,
};
