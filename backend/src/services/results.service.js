/**
 * @file results.service.js
 * @description The ranking, publishing it, the winners, and what each
 * participant sees.
 *
 * Ranking. Only a judge's complete review of a team counts: one that scores
 * every criterion (judging.reviewState). Each such judge is measured on their
 * own terms first: the weighted points they gave over the most they could
 * have given. A team's score is the average of those fractions, out of 100.
 * A review still missing criteria is left out and reported as partial, so a
 * judge interrupted after one criterion cannot rank a team first. Scores are
 * also left out when the judge belongs to the team or declared a conflict
 * with it. Eliminated teams, and teams without a participant the organiser
 * approved, are not ranked. Equal scores (to two decimals) share a place:
 * 1, 1, 3.
 *
 * Publishing waits for the hackathon to be over: never while submissions are
 * still open, not while assigned reviews are unfinished, and not over
 * outdated reviews (a team changed its project after a judge's review),
 * unless the organiser confirms each. The outdated ones are said by judge
 * and project, and the organiser can ask those judges to look again
 * (requestRecheck); a confirmation stays with the publication. It freezes the ranking (event_results), so later
 * score edits do not move published places, fires the "results"
 * announcement, and issues the certificates when they are ready to go out
 * (see certificate.service). Unpublishing revokes those. Participants
 * then see what the organiser chose (decision E8): their own place (and
 * scores, if shown) and the winners — the default — or only the winners, or
 * the full leaderboard. Before publishing they see nothing.
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const judging = require('./judging.service');
const { closesAt } = require('./submissionRules');

const round2 = (n) => Math.round(n * 100) / 100;

/** The live ranking, from the scores as they are now. */
async function ranking(eventId) {
  const [criteria, teams, ineligibleRows, rows, conflicts, own] = await Promise.all([
    judging.criteriaOf(eventId),
    judging.eligibleTeams(eventId),
    judging.ineligibleTeams(eventId),
    db.query(
      `SELECT sc.judge_id, s.team_id, sc.criterion_id, sc.score
         FROM scores sc
         JOIN judges j ON j.id = sc.judge_id AND j.event_id = $1
         JOIN submissions s ON s.id = sc.submission_id AND s.event_id = $1`,
      [eventId],
    ),
    db.query('SELECT judge_id, team_id FROM judge_conflicts WHERE event_id = $1', [eventId]),
    db.query(
      `SELECT j.id AS judge_id, tm.team_id FROM judges j
         JOIN team_members tm ON tm.user_id = j.user_id
         JOIN teams t ON t.id = tm.team_id AND t.event_id = j.event_id
        WHERE j.event_id = $1`,
      [eventId],
    ),
  ]);
  const crit = new Map(criteria.map((c) => [Number(c.id), { ...c, max: Number(c.max_score) || 10, w: Number(c.weight) || 1 }]));
  const skip = new Set([...conflicts.rows, ...own.rows].map((r) => `${r.judge_id}:${r.team_id}`));

  // team → judge → { points, max, scores: criterion → score }
  const perJudge = new Map();
  for (const r of rows.rows) {
    const c = crit.get(Number(r.criterion_id));
    if (!c || skip.has(`${r.judge_id}:${r.team_id}`)) continue;
    const t = Number(r.team_id);
    if (!perJudge.has(t)) perJudge.set(t, new Map());
    const j = perJudge.get(t);
    const acc = j.get(Number(r.judge_id)) || { points: 0, max: 0, scores: new Map() };
    acc.points += Number(r.score) * c.w;
    acc.max += c.max * c.w;
    acc.scores.set(Number(c.id), Number(r.score));
    j.set(Number(r.judge_id), acc);
  }

  const ranked = [];
  const unscored = [];
  const eliminated = [];
  const incomplete = [];
  for (const t of teams) {
    const teamId = Number(t.team_id);
    const base = {
      teamId,
      teamName: t.team_name,
      projectName: t.project_name || null,
      submissionId: Number(t.submission_id),
      trackId: t.track_id ? Number(t.track_id) : null,
      track: t.track_name || null,
    };
    if (t.team_status === 'eliminated') { eliminated.push(base); continue; }
    const judges = [...(perJudge.get(teamId) || new Map()).entries()];
    const complete = judges.filter(([, a]) => judging.reviewState(a.scores.size, criteria.length) === 'done').map(([, a]) => a);
    const partial = judges.filter(([, a]) => judging.reviewState(a.scores.size, criteria.length) === 'partial');
    for (const [judgeId, a] of partial) incomplete.push({ teamId, judgeId, filled: a.scores.size, of: criteria.length });
    if (!complete.length) { unscored.push({ ...base, partialReviews: partial.length }); continue; }
    const fractions = complete.map((a) => a.points / a.max);
    ranked.push({
      ...base,
      score: round2((fractions.reduce((s, f) => s + f, 0) / fractions.length) * 100),
      judgesCount: fractions.length,
      partialReviews: partial.length,
      breakdown: criteria.map((c) => {
        const list = complete.map((a) => a.scores.get(Number(c.id))).filter((v) => v != null);
        return {
          criterionId: Number(c.id),
          name: c.name,
          max: Number(c.max_score) || 10,
          weight: Number(c.weight) || 1,
          avg: list.length ? round2(list.reduce((s, v) => s + v, 0) / list.length) : null,
        };
      }),
    });
  }
  ranked.sort((a, b) => b.score - a.score || b.judgesCount - a.judgesCount || a.submissionId - b.submissionId);
  let place = 0;
  ranked.forEach((r, i) => {
    if (i === 0 || r.score !== ranked[i - 1].score) place = i + 1;
    r.place = place;
  });
  for (const r of ranked) r.tie = ranked.some((o) => o !== r && o.place === r.place);
  // Projects of teams nobody accepted to the event: not ranked, shown apart.
  const ineligible = ineligibleRows.map((t) => ({
    teamId: Number(t.team_id),
    teamName: t.team_name,
    projectName: t.project_name || null,
    submissionId: Number(t.submission_id),
    trackId: t.track_id ? Number(t.track_id) : null,
    track: t.track_name || null,
  }));
  return { criteria: criteria.map((c) => ({ id: Number(c.id), name: c.name, max: Number(c.max_score) || 10, weight: Number(c.weight) || 1 })), ranked, unscored, eliminated, ineligible, incomplete };
}

/** The published ranking (frozen at publishing), with names as they are now. */
async function snapshot(eventId) {
  const r = await db.query(
    `SELECT er.team_id, er.submission_id, er.place, er.score, er.judges_count, er.breakdown, er.published_at,
            t.name AS team_name, s.project_name, COALESCE(s.track_id, t.track_id) AS track_id, tr.name AS track_name
       FROM event_results er
       JOIN teams t ON t.id = er.team_id
       LEFT JOIN submissions s ON s.id = er.submission_id
       LEFT JOIN tracks tr ON tr.id = COALESCE(s.track_id, t.track_id)
      WHERE er.event_id = $1
      ORDER BY er.place, er.score DESC NULLS LAST, er.team_id`,
    [eventId],
  );
  return r.rows.map((x) => ({
    teamId: Number(x.team_id),
    submissionId: x.submission_id ? Number(x.submission_id) : null,
    teamName: x.team_name,
    projectName: x.project_name || null,
    trackId: x.track_id ? Number(x.track_id) : null,
    track: x.track_name || null,
    place: Number(x.place),
    score: x.score == null ? null : Number(x.score),
    judgesCount: Number(x.judges_count),
    breakdown: Array.isArray(x.breakdown) ? x.breakdown : [],
  }));
}

/**
 * Who won each prize: place prizes from the places (ties share), special
 * prizes as the organiser set them, track prizes as set or else the best
 * ranked team of the track.
 */
async function winners(eventId, rows) {
  const prizes = await db.query(
    `SELECT id, name, description, value, kind, position, track_id, winner_team_id
       FROM prizes WHERE event_id = $1 ORDER BY CASE kind WHEN 'place' THEN 0 WHEN 'track' THEN 1 ELSE 2 END, position NULLS LAST, sort_order, id`,
    [eventId],
  );
  const byTeam = new Map(rows.map((r) => [r.teamId, r]));
  const names = new Map();
  const ids = prizes.rows.map((p) => p.winner_team_id).filter(Boolean);
  if (ids.length) {
    const t = await db.query(
      `SELECT t.id, t.name, s.project_name FROM teams t
         LEFT JOIN submissions s ON s.team_id = t.id AND s.event_id = t.event_id
        WHERE t.event_id = $1 AND t.id = ANY($2::int[])`,
      [eventId, ids],
    );
    for (const x of t.rows) names.set(Number(x.id), { teamName: x.name, projectName: x.project_name || null });
  }
  const view = (teamId) => {
    const r = byTeam.get(teamId);
    if (r) return { teamId, teamName: r.teamName, projectName: r.projectName, place: r.place };
    const n = names.get(teamId);
    return n ? { teamId, ...n, place: null } : null;
  };
  return prizes.rows.map((p) => {
    let teams = [];
    if (p.kind === 'place' && p.position) {
      teams = rows.filter((r) => r.place === Number(p.position)).map((r) => view(r.teamId));
    } else if (p.winner_team_id) {
      teams = [view(Number(p.winner_team_id))].filter(Boolean);
    } else if (p.kind === 'track' && p.track_id) {
      const best = rows.filter((r) => r.trackId === Number(p.track_id)).sort((a, b) => a.place - b.place)[0];
      if (best) teams = [view(best.teamId)];
    }
    return {
      prize: { id: Number(p.id), name: p.name, description: p.description, value: p.value, kind: p.kind, position: p.position, trackId: p.track_id, manual: Boolean(p.winner_team_id) },
      teams,
    };
  });
}

function publishedState(event) {
  if (!event.results_published_at) return null;
  const cfg = judging.config(event);
  const outdated = event.results_outdated_confirmation;
  return {
    at: event.results_published_at,
    visibility: cfg.resultsVisibility,
    showScores: Boolean(cfg.showScores),
    // Published over outdated reviews the organiser confirmed: how many, and when.
    outdatedConfirmed: outdated && Number(outdated.count) > 0
      ? { count: Number(outdated.count), at: outdated.confirmedAt || null }
      : null,
  };
}

/**
 * Judging opened before submissions closed: the organiser set a judging
 * start earlier than the deadline (rolling judging), so judges may score a
 * project its team is still changing.
 */
function isRolling(event) {
  const opens = judging.opensAt(event);
  const closes = closesAt(event);
  return Boolean(event.judging_start && opens && closes && opens.getTime() < closes.getTime());
}

/**
 * Reviews older than the team's last change to its project, among the
 * reviews the ranking counts (not a judge's own team, not a declared
 * conflict, not an eliminated or not-yet-accepted team):
 *
 *   - every review flagged "changed since your review" in the judging
 *     progress (the judge's teams under the event's settings);
 *   - with rolling judging, also the scores of a judge who no longer has the
 *     team (the assignment changed after they scored): they still count.
 *
 * A review saved again after the change is not outdated any more.
 *
 * @returns {Promise<{ count, rolling, window, reviews, judges, projects }>}
 */
async function outdatedReviews(eventId, event = null) {
  const ev = event || (await judging.loadEvent(eventId));
  const rolling = isRolling(ev);
  const [progress, times, scored] = await Promise.all([
    judging.progress(eventId),
    judging.reviewTimes(eventId),
    db.query(
      `SELECT sc.judge_id, sc.submission_id FROM scores sc
         JOIN judges j ON j.id = sc.judge_id AND j.event_id = $1
        GROUP BY sc.judge_id, sc.submission_id`,
      [eventId],
    ),
  ]);
  const teams = new Map(progress.teams.map((t) => [t.id, t]));
  const judges = new Map(progress.judges.map((j) => [j.id, j]));
  const hasScores = new Set(scored.rows.map((r) => `${r.judge_id}:${r.submission_id}`));
  const reviews = [];
  for (const c of progress.cells) {
    const team = teams.get(c.teamId);
    if (!team || team.eliminated) continue;
    const key = `${c.judgeId}:${team.submissionId}`;
    const outOfScope = rolling && c.state === 'na' && hasScores.has(key) && Boolean(times.get(key)?.changed);
    if (!c.changedSinceReview && !outOfScope) continue;
    const t = times.get(key);
    reviews.push({
      judgeId: c.judgeId,
      judgeName: judges.get(c.judgeId)?.name || null,
      teamId: c.teamId,
      teamName: team.name,
      projectName: team.projectName || null,
      submissionId: team.submissionId,
      reviewedAt: t?.reviewedAt ? new Date(t.reviewedAt).toISOString() : null,
      changedAt: t?.changedAt ? new Date(t.changedAt).toISOString() : null,
    });
  }
  const group = (keyOf, make) => {
    const out = new Map();
    for (const r of reviews) {
      const k = keyOf(r);
      if (!out.has(k)) out.set(k, { ...make(r), count: 0 });
      out.get(k).count += 1;
    }
    return [...out.values()];
  };
  return {
    count: reviews.length,
    rolling,
    // Judges can only look again while the judging window is open.
    window: progress.window,
    reviews,
    judges: group((r) => r.judgeId, (r) => ({ judgeId: r.judgeId, name: r.judgeName })).sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name))),
    projects: group((r) => r.teamId, (r) => ({ teamId: r.teamId, teamName: r.teamName, projectName: r.projectName })).sort((a, b) => b.count - a.count || String(a.teamName).localeCompare(String(b.teamName))),
  };
}

/** Everything the organiser's results page shows. */
async function organiserResults(eventId) {
  const event = await judging.loadEvent(eventId);
  const live = await ranking(eventId);
  const published = publishedState(event);
  const frozen = published ? await snapshot(eventId) : null;
  return {
    published,
    settings: { visibility: judging.config(event).resultsVisibility, showScores: Boolean(judging.config(event).showScores) },
    criteria: live.criteria,
    ranking: live.ranked,
    unscored: live.unscored,
    eliminated: live.eliminated,
    ineligible: live.ineligible,
    // Reviews a judge started but did not finish: not counted until complete.
    incomplete: live.incomplete,
    snapshot: frozen,
    prizes: await winners(eventId, frozen || live.ranked),
    // Per-judge detail for the organiser: who gave what, with their review.
    reviews: await reviewsOf(eventId),
    // Reviews older than the project's last change (publishing asks first).
    outdated: published ? null : await outdatedReviews(eventId, event),
  };
}

async function reviewsOf(eventId) {
  const [scores, reviews, changes] = await Promise.all([
    db.query(
      // Only the scores the ranking counts: not a judge's own team, not a declared conflict.
      `SELECT sc.judge_id, u.full_name AS judge_name, s.team_id, sc.criterion_id, sc.score
         FROM scores sc JOIN judges j ON j.id = sc.judge_id AND j.event_id = $1
         JOIN users u ON u.id = j.user_id
         JOIN submissions s ON s.id = sc.submission_id AND s.event_id = $1
        WHERE NOT EXISTS (SELECT 1 FROM judge_conflicts jc WHERE jc.judge_id = sc.judge_id AND jc.team_id = s.team_id)
          AND NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = s.team_id AND tm.user_id = j.user_id)`,
      [eventId],
    ),
    db.query(
      `SELECT jr.judge_id, s.team_id, jr.feedback FROM judge_reviews jr
         JOIN judges j ON j.id = jr.judge_id AND j.event_id = $1
         JOIN submissions s ON s.id = jr.submission_id`,
      [eventId],
    ),
    // The judge audit: how often a judge changed a score already given.
    db.query(
      `SELECT h.judge_id, s.team_id, COUNT(*)::int AS n
         FROM score_history h JOIN submissions s ON s.id = h.submission_id
        WHERE h.event_id = $1 AND h.old_score IS NOT NULL
        GROUP BY h.judge_id, s.team_id`,
      [eventId],
    ),
  ]);
  const out = new Map();
  const key = (t, j) => `${t}:${j}`;
  for (const r of scores.rows) {
    const k = key(r.team_id, r.judge_id);
    if (!out.has(k)) out.set(k, { teamId: Number(r.team_id), judgeId: Number(r.judge_id), judgeName: r.judge_name, scores: {}, feedback: null, changed: 0 });
    out.get(k).scores[Number(r.criterion_id)] = Number(r.score);
  }
  for (const r of reviews.rows) {
    const k = key(r.team_id, r.judge_id);
    if (out.has(k)) out.get(k).feedback = r.feedback;
  }
  for (const r of changes.rows) {
    const k = key(r.team_id, r.judge_id);
    if (out.has(k)) out.get(k).changed = r.n;
  }
  return [...out.values()];
}

/**
 * The reviews still owed under the event's settings: each judge's teams
 * (assignment, track, conflicts applied) not scored on every criterion.
 */
async function openReviews(eventId) {
  const p = await judging.progress(eventId);
  const open = p.cells.filter((c) => c.state === 'todo' || c.state === 'partial');
  return { todo: open.filter((c) => c.state === 'todo').length, partial: open.filter((c) => c.state === 'partial').length };
}

/**
 * Publish: freeze the ranking, remember how participants see it, announce.
 * Publishing again refreshes the frozen ranking. Refused while submissions
 * are open (SUBMISSIONS_OPEN), while assigned reviews are unfinished
 * (JUDGING_INCOMPLETE) unless `confirmIncomplete`, and while reviews are
 * older than their project's last change (REVIEWS_OUTDATED) unless
 * `confirmOutdated`. That confirmation is kept with the publication.
 */
async function publish(eventId, actorId, { visibility, showScores, confirmIncomplete = false, confirmOutdated = false } = {}) {
  const event = await judging.loadEvent(eventId);
  if (judging.isArchived(event)) throw httpError(409, 'The event is archived.', 'EVENT_ARCHIVED');
  const allowed = ['full', 'own_and_winners', 'winners'];
  if (visibility != null && !allowed.includes(visibility)) throw httpError(400, 'Unknown visibility.', 'VALIDATION_ERROR');
  const closes = closesAt(event);
  if (closes && closes.getTime() > Date.now()) {
    throw httpError(
      409,
      `Submissions are open until ${closes.toISOString().slice(0, 16).replace('T', ' ')} UTC. Publish the results once they have closed.`,
      'SUBMISSIONS_OPEN',
      { errors: { closesAt: closes.toISOString() } },
    );
  }
  const live = await ranking(eventId);
  if (!live.ranked.length) throw httpError(409, 'No team has been scored yet.', 'NO_SCORES');
  const owed = await openReviews(eventId);
  if (owed.todo + owed.partial > 0 && confirmIncomplete !== true) {
    const parts = [owed.todo && `${owed.todo} not started`, owed.partial && `${owed.partial} not finished`].filter(Boolean).join(', ');
    throw httpError(
      409,
      `Judging is not complete: ${owed.todo + owed.partial} assigned ${owed.todo + owed.partial === 1 ? 'review is' : 'reviews are'} missing (${parts}). Unfinished reviews do not count in the ranking. Confirm to publish anyway.`,
      'JUDGING_INCOMPLETE',
      { errors: { todo: owed.todo, partial: owed.partial } },
    );
  }

  const outdated = await outdatedReviews(eventId, event);
  if (outdated.count > 0 && confirmOutdated !== true) {
    const n = outdated.count;
    throw httpError(
      409,
      `${n} ${n === 1 ? 'review is' : 'reviews are'} older than the latest change to ${outdated.projects.length === 1 ? 'its project' : 'their projects'} (${outdated.judges.length} ${outdated.judges.length === 1 ? 'judge' : 'judges'}, ${outdated.projects.length} ${outdated.projects.length === 1 ? 'project' : 'projects'}). Ask the judges to look again, or confirm to publish anyway.`,
      'REVIEWS_OUTDATED',
      {
        errors: [
          { field: 'count', message: String(n) },
          ...outdated.judges.map((j) => ({ field: 'judge', message: j.name || `#${j.judgeId}`, id: j.judgeId, count: j.count })),
          ...outdated.projects.map((p) => ({ field: 'project', message: p.projectName || p.teamName, id: p.teamId, count: p.count })),
        ],
      },
    );
  }
  const confirmation = outdated.count > 0
    ? {
      count: outdated.count,
      rolling: outdated.rolling,
      judges: outdated.judges.map((j) => j.judgeId),
      teams: outdated.projects.map((p) => p.teamId),
      confirmedBy: actorId || null,
      confirmedAt: new Date().toISOString(),
    }
    : null;

  const cfgPatch = {};
  if (visibility != null) cfgPatch.resultsVisibility = visibility;
  if (showScores != null) cfgPatch.showScores = Boolean(showScores);
  const first = !event.results_published_at;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM event_results WHERE event_id = $1', [eventId]);
    for (const r of live.ranked) {
      // eslint-disable-next-line no-await-in-loop
      await client.query(
        `INSERT INTO event_results (event_id, team_id, submission_id, place, score, judges_count, breakdown)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [eventId, r.teamId, r.submissionId, r.place, r.score, r.judgesCount, JSON.stringify(r.breakdown)],
      );
    }
    await client.query(
      `UPDATE events SET results_published_at = now(), results_published_by = $2,
              judging_config = COALESCE(judging_config, '{}'::jsonb) || $3::jsonb,
              results_outdated_confirmation = $4::jsonb
        WHERE id = $1`,
      [eventId, actorId || null, JSON.stringify(cfgPatch), confirmation ? JSON.stringify(confirmation) : null],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (first) {
    try {
      // eslint-disable-next-line global-require
      await require('./autoAnnouncementPlanner').trigger(eventId, 'results');
    } catch (err) {
      console.warn('[results] announcement not queued:', err.message);
    }
    // The bell of every accepted participant: the first publication only,
    // not each correction after it.
    // eslint-disable-next-line global-require
    await require('./notification.service').notifyAudience(
      `SELECT p.user_id FROM participants p WHERE p.event_id = $1 AND LOWER(p.status::text) = 'approved'`,
      [eventId],
      { eventId: Number(eventId), kind: 'results.published', target: 'results', data: {}, dedupeKey: `results:${eventId}` },
    );
  }
  // Certificates follow the results when the organiser chose so and the
  // certificate is ready (a signer named); issuing is idempotent, so a second
  // publish only adds what is new. The answer says when they do not.
  // eslint-disable-next-line global-require
  const certificates = require('./certificate.service');
  const cert = await db.query('SELECT certificate_config FROM events WHERE id = $1', [eventId]);
  const blocked = certificates.autoIssueBlocker(certificates.configOf(cert.rows[0]));
  if (!blocked) {
    // eslint-disable-next-line global-require
    await require('./jobs.service').enqueue('certificates.issue', { eventId: Number(eventId), source: 'results' });
  }
  const after = await judging.loadEvent(eventId);
  return {
    published: publishedState(after),
    teams: live.ranked.length,
    first,
    judgingIncomplete: owed.todo + owed.partial,
    outdated: confirmation,
    certificates: blocked
      ? { issuing: false, reason: blocked, message: CERTIFICATES_HELD[blocked] }
      : { issuing: true, reason: null, message: 'Certificates are being issued and e-mailed now.' },
  };
}

const CERTIFICATES_HELD = {
  ISSUE_BY_HAND: 'Certificates are issued by hand for this event (Certificates page).',
  NO_KINDS: 'No certificate kinds are chosen for this event, so none were issued.',
  SIGNER_MISSING: 'Certificates were not issued: name the signer in the builder (Certificates), then issue them from the Certificates page.',
};

/** Unpublish: participants see nothing again, and the certificates the results issued are revoked. */
async function unpublish(eventId) {
  const event = await judging.loadEvent(eventId);
  if (judging.isArchived(event)) throw httpError(409, 'The event is archived.', 'EVENT_ARCHIVED');
  const client = await db.pool.connect();
  let revoked = 0;
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM event_results WHERE event_id = $1', [eventId]);
    await client.query('UPDATE events SET results_published_at = NULL, results_published_by = NULL, results_outdated_confirmation = NULL WHERE id = $1', [eventId]);
    // eslint-disable-next-line global-require
    revoked = await require('./certificate.service').revokeForUnpublish(eventId, client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { published: null, certificatesRevoked: revoked };
}

/** How long a judge who was just asked to look again is not asked again. */
const RECHECK_COOLDOWN_MIN = 15;

/**
 * "Ask the judges to look again": each judge with an outdated review gets a
 * notification in the bell and an e-mail naming the projects that changed,
 * in the event's language. `judgeIds` narrows it to some of them. A judge
 * asked less than RECHECK_COOLDOWN_MIN minutes ago is skipped, so pressing
 * the button twice does not send two e-mails.
 *
 * @returns {Promise<{ judges: number, notified: number, emailed: number, skipped: number, outdated: number }>}
 */
async function requestRecheck(eventId, { judgeIds = null } = {}) {
  const event = await judging.loadEvent(eventId);
  if (judging.isArchived(event)) throw httpError(409, 'The event is archived.', 'EVENT_ARCHIVED');
  if (event.results_published_at) throw httpError(409, 'Results are published. Unpublish them before asking judges to change their reviews.', 'RESULTS_PUBLISHED');
  const outdated = await outdatedReviews(eventId, event);
  const only = Array.isArray(judgeIds) && judgeIds.length ? new Set(judgeIds.map(Number)) : null;
  const byJudge = new Map();
  for (const r of outdated.reviews) {
    if (only && !only.has(r.judgeId)) continue;
    if (!byJudge.has(r.judgeId)) byJudge.set(r.judgeId, []);
    byJudge.get(r.judgeId).push(r);
  }
  if (!byJudge.size) throw httpError(409, 'No review is outdated: nothing to ask the judges.', 'NOTHING_OUTDATED');

  const people = await db.query(
    `SELECT j.id, j.user_id, u.full_name, u.email,
            (SELECT n.created_at FROM notifications n
              WHERE n.user_id = j.user_id AND n.dedupe_key = $3) AS asked_at
       FROM judges j JOIN users u ON u.id = j.user_id
      WHERE j.event_id = $1 AND j.id = ANY($2::int[])`,
    [eventId, [...byJudge.keys()], `recheck:${eventId}`],
  );
  const ev = (await db.query('SELECT name, language FROM events WHERE id = $1', [eventId])).rows[0] || {};
  // eslint-disable-next-line global-require
  const notifications = require('./notification.service');
  // eslint-disable-next-line global-require
  const email = require('./email.service');
  // eslint-disable-next-line global-require
  const { eventSender } = require('./eventSender');
  // eslint-disable-next-line global-require
  const { resolveFrontendBaseUrl } = require('../utils/frontendUrl');
  const sender = await eventSender(eventId);
  const closed = outdated.window?.state !== 'open';
  let notified = 0;
  let emailed = 0;
  let skipped = 0;
  const cooldownMs = RECHECK_COOLDOWN_MIN * 60e3;
  for (const p of people.rows) {
    if (p.asked_at && Date.now() - new Date(p.asked_at).getTime() < cooldownMs) { skipped += 1; continue; }
    const list = byJudge.get(Number(p.id)) || [];
    const projects = [...new Set(list.map((r) => r.projectName || r.teamName).filter(Boolean))];
    // eslint-disable-next-line no-await-in-loop
    notified += await notifications.notify([p.user_id], {
      eventId: Number(eventId),
      kind: 'judging.recheck',
      target: 'home',
      data: { count: list.length, projects: projects.slice(0, 5) },
      dedupeKey: `recheck:${eventId}`,
      collapse: 'replace',
    });
    if (p.email) {
      // eslint-disable-next-line no-await-in-loop
      const out = await email.sendRecheckRequestEmail({
        to: p.email,
        fullName: p.full_name,
        eventName: ev.name,
        projects,
        frontendUrl: resolveFrontendBaseUrl(),
        lang: ev.language,
        sender,
        judgingClosed: closed,
      });
      if (out.ok) emailed += 1;
    }
  }
  return { judges: people.rows.length, notified, emailed, skipped, outdated: outdated.count, judgingClosed: closed };
}

/** The winner of a special or track prize, chosen by the organiser (null clears it). */
async function setPrizeWinner(eventId, prizeId, teamId) {
  const p = await db.query('SELECT id, kind FROM prizes WHERE id = $1 AND event_id = $2', [prizeId, eventId]);
  if (!p.rows[0]) throw httpError(404, 'Prize not found', 'NOT_FOUND');
  if (p.rows[0].kind === 'place') throw httpError(409, 'Place prizes follow the ranking.', 'PRIZE_BY_PLACE');
  if (teamId != null) {
    const t = await db.query('SELECT id FROM teams WHERE id = $1 AND event_id = $2', [teamId, eventId]);
    if (!t.rows[0]) throw httpError(400, 'Team not found in this event', 'VALIDATION_ERROR');
  }
  await db.query('UPDATE prizes SET winner_team_id = $3 WHERE id = $1 AND event_id = $2', [prizeId, eventId, teamId == null ? null : Number(teamId)]);
  return { prizeId: Number(prizeId), teamId: teamId == null ? null : Number(teamId) };
}

/**
 * What one participant sees, by the organiser's choice. Nothing before
 * publishing; only admitted (or eliminated) participants of the event.
 */
async function participantResults(userId, eventId) {
  const event = await judging.loadEvent(eventId);
  const p = await db.query(
    "SELECT LOWER(TRIM(status)) AS status FROM participants WHERE event_id = $1 AND user_id = $2",
    [eventId, userId],
  );
  if (!p.rows[0] || !['approved', 'eliminated'].includes(p.rows[0].status)) {
    throw httpError(403, 'Results are for the event\'s participants.', 'NOT_PARTICIPANT');
  }
  const published = publishedState(event);
  if (!published) return { published: null };
  const rows = await snapshot(eventId);
  const team = await db.query(
    `SELECT t.id, t.name, s.id AS submission_id FROM team_members tm
       JOIN teams t ON t.id = tm.team_id AND t.event_id = $1
       LEFT JOIN submissions s ON s.team_id = t.id AND s.event_id = t.event_id
      WHERE tm.user_id = $2 LIMIT 1`,
    [eventId, userId],
  );
  const myTeam = team.rows[0] || null;
  // "Winners only" shows nobody their own place or scores.
  const ownVisible = published.visibility !== 'winners';
  const show = published.showScores && ownVisible;
  let mine = null;
  if (myTeam) {
    const row = ownVisible ? rows.find((r) => r.teamId === Number(myTeam.id)) || null : null;
    let feedback = null;
    if (show && myTeam.submission_id) {
      const fb = await db.query(
        "SELECT feedback FROM judge_reviews WHERE submission_id = $1 AND NULLIF(TRIM(feedback), '') IS NOT NULL ORDER BY updated_at",
        [myTeam.submission_id],
      );
      feedback = fb.rows.map((r) => r.feedback);
    }
    mine = {
      teamId: Number(myTeam.id),
      teamName: myTeam.name,
      place: row ? row.place : null,
      of: ownVisible ? rows.length : null,
      score: show && row ? row.score : null,
      breakdown: show && row ? row.breakdown : null,
      feedback,
    };
  }
  const prizes = await winners(eventId, rows);
  if (mine) mine.won = prizes.filter((x) => x.teams.some((t) => t.teamId === mine.teamId)).map((x) => x.prize);
  return {
    published,
    mine,
    winners: prizes.filter((x) => x.teams.length),
    leaderboard: published.visibility === 'full'
      ? rows.map((r) => ({ place: r.place, teamId: r.teamId, teamName: r.teamName, projectName: r.projectName, score: show ? r.score : null }))
      : null,
  };
}

/**
 * Published results are what participants saw, what the prizes and the
 * certificates were made from. Deleting a team in them, deleting its project
 * or eliminating it would change or contradict that without a word, so it is
 * refused, as removing a judge whose scores were counted is: the organiser
 * unpublishes first, makes the change, and publishes again.
 *
 * A team is in the published results when it has a published place, or the
 * organiser named it the winner of a prize.
 *
 * @param {number} eventId
 * @param {number[]} teamIds
 * @param {'delete'|'eliminate'|'delete_submission'} action  what is being refused, for the sentence
 * @throws 409 RESULTS_PUBLISHED, with the teams concerned in `errors`
 */
async function assertNotInPublishedResults(eventId, teamIds, action = 'delete') {
  const ids = [...new Set((teamIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return;
  const r = await db.query(
    `SELECT t.id, t.name FROM teams t
       JOIN events e ON e.id = t.event_id AND e.results_published_at IS NOT NULL
      WHERE t.event_id = $1 AND t.id = ANY($2::int[])
        AND (EXISTS (SELECT 1 FROM event_results er WHERE er.event_id = t.event_id AND er.team_id = t.id)
             OR EXISTS (SELECT 1 FROM prizes p WHERE p.event_id = t.event_id AND p.winner_team_id = t.id))
      ORDER BY t.id`,
    [eventId, ids],
  );
  if (!r.rows.length) return;
  const names = r.rows.map((x) => x.name).join(', ');
  const message = {
    delete: `The published results include ${names}. Unpublish the results first, then delete the team.`,
    eliminate: `The published results include ${names}. Unpublish the results first, then eliminate the team.`,
    delete_submission: `The published results were counted with this project (${names}). Unpublish the results first.`,
  }[action];
  throw httpError(409, message, 'RESULTS_PUBLISHED', {
    errors: r.rows.map((x) => ({ field: 'teamId', message: String(x.id), name: x.name })),
  });
}

module.exports = {
  ranking, snapshot, winners, organiserResults, publish, unpublish, setPrizeWinner, participantResults, publishedState, assertNotInPublishedResults,
  outdatedReviews, requestRecheck, isRolling, RECHECK_COOLDOWN_MIN,
};
