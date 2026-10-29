/**
 * @file eventOverview.service.js
 * @description What an organiser needs to see first when they open an event.
 *
 *   phase       where the event is now (draft, registration, hacking,
 *               judging…), from its own timeline in the builder
 *   milestones  the dates the organiser set, in order, done or still ahead
 *   kpis        people, teams, projects, help, mentors, volunteers and
 *               announcements, counted in the database rather than by
 *               downloading every list into the browser
 *   alerts      the few things that need someone now, each with a count and
 *               the page that deals with it
 *   activity    the latest things that happened: registrations, teams,
 *               projects, help, announcements and what organisers did
 *
 * Counts that say "recent" mean the last 24 hours, so they read the same in
 * every time zone. Only the event's organisers reach this (see the route).
 */

const db = require('../config/db');
const participantAdmin = require('./participantAdmin.service');
const { ONLINE_WINDOW_MS } = require('./mentor.service');
const judging_ = require('./judging.service');
const entitlementService = require('./entitlement.service');
const { withDefaults } = require('./eventBuilderInput');

const HOUR = 3600e3;
const ms = (v) => (v ? new Date(v).getTime() : null);
const iso = (v) => (v == null ? null : new Date(v).toISOString());

/** A request nobody has taken for this long is waiting too long. */
const HELP_WAIT_MIN = 15;
/** Warn about teams without a project this close to the deadline. */
const SUBMISSION_WARN_MS = 3 * HOUR;
/** Warn about people without a team this close to team formation closing. */
const TEAM_WARN_MS = 24 * HOUR;
const ACTIVITY_LIMIT = 30;

/**
 * What organisers did that belongs in the feed. Teams come from the teams
 * themselves and staff who accepted an invite from the invites, so neither
 * is listed twice.
 */
const AUDIT_ACTIONS = {
  'participant.status': 'status_changed',
  'participant.bulk_status': 'bulk_status',
  'participant.team_status': 'team_status',
  'participant.removed': 'removed',
  'participant.promoted': 'promoted',
  'participant.imported': 'imported',
  'team.member_added': 'member_added',
  'team.member_moved': 'member_moved',
  'mentor.assigned': 'mentor_added',
  'volunteer.added': 'volunteer_added',
  'event.publish': 'published',
  'event.unpublish': 'unpublished',
};

/**
 * Where the event is now.
 *
 * Drafts and archived events are what the organiser made them. Otherwise the
 * dates decide: before the start it is "upcoming" until registration opens,
 * then "registration" until it closes, then "before_start"; "hacking" until
 * projects are due; then "judging" until judging ends (or, with a results
 * date, until the results are published), "results" once the organiser
 * published them, and "ended" when nothing is left.
 *
 * @returns {{ key: string, until: string|null }}
 */
function phaseOf(e, now = Date.now()) {
  const status = String(e.status || '').trim().toLowerCase();
  if (status === 'archived') return { key: 'archived', until: null };
  if (status === 'draft' || e.is_published === false) return { key: 'draft', until: null };

  const regStart = ms(e.registration_start);
  const regEnd = ms(e.registration_end);
  const start = ms(e.start_date);
  const end = ms(e.end_date);
  const subClose = ms(e.submission_deadline) ?? end;
  const results = ms(e.results_at);
  const judgingStart = ms(e.judging_start);
  const judgingEnd = ms(e.judging_end) ?? results ?? (judgingStart != null ? judgingStart + 6 * HOUR : null);

  if (start == null || now < start) {
    if (regStart != null && now < regStart) return { key: 'upcoming', until: iso(regStart) };
    if (regEnd == null || now < regEnd) return { key: 'registration', until: iso(regEnd ?? start) };
    return { key: 'before_start', until: iso(start) };
  }
  if (subClose == null || now <= subClose) return { key: 'hacking', until: iso(subClose) };
  // Results are out when the organiser published them, not when the date says.
  if (e.results_published_at) return { key: 'results', until: null };
  if (judgingEnd != null && now < judgingEnd) return { key: 'judging', until: iso(judgingEnd) };
  // The results date passed without them: still judging, and the home says so.
  if (results != null) return { key: 'judging', until: null };
  return { key: 'ended', until: null };
}

const MILESTONES = [
  ['registration_opens', 'registration_start'],
  ['registration_closes', 'registration_end'],
  ['team_deadline', 'team_deadline'],
  ['start', 'start_date'],
  ['submission_deadline', 'submission_deadline'],
  ['judging_start', 'judging_start'],
  ['judging_end', 'judging_end'],
  ['demo_day', 'demo_day'],
  ['results', 'results_at'],
  ['end', 'end_date'],
];

/**
 * The dates the organiser set, earliest first: each one done, the next one
 * ahead, or upcoming after that.
 *
 * @returns {{ milestones: Array<{ key, at, state }>, next: { key, at } | null }}
 */
function milestonesOf(e, now = Date.now()) {
  const list = MILESTONES
    .map(([key, col]) => ({ key, t: ms(e[col]) }))
    .filter((m) => m.t != null && Number.isFinite(m.t))
    .sort((a, b) => a.t - b.t);
  let next = null;
  const milestones = list.map((m) => {
    let state = 'done';
    if (m.t > now) {
      state = next ? 'upcoming' : 'next';
      if (!next) next = { key: m.key, at: iso(m.t) };
    }
    return { key: m.key, at: iso(m.t), state };
  });
  return { milestones, next };
}

/** Whether teams can still change (same rule as event.service teamFormationState, at `now`). */
function formationOf(e, now = Date.now()) {
  if (e.allow_team_formation === false || e.registration_mode === 'solo') return { open: false, closesAt: null };
  const closes = ms(e.team_deadline) ?? ms(e.start_date);
  return { open: closes == null || now < closes, closesAt: iso(closes) };
}

const SEVERITY = { danger: 0, warn: 1, info: 2 };

/**
 * After projects are in: judges who have not finished, reviews a team's
 * later change made outdated, results not published, and once they are,
 * certificates held back or not issued.
 *
 * `k.judging` is { closed, started, judges: [{ id, name, assigned, done, partial }],
 * submissions }, `k.results` { published }, `k.certificates` { enabled,
 * kinds, signer, issued, issuing } (see overview).
 */
function lateAlerts(e, k, now) {
  const out = [];
  const j = k.judging;
  const resultsAt = ms(e.results_at);
  const late = resultsAt != null && now >= resultsAt;
  if (j && j.closed && !k.results?.published) {
    const open = (j.judges || [])
      .map((x) => ({ id: x.id, name: x.name, todo: Math.max(0, x.assigned - x.done - x.partial), partial: x.partial, of: x.assigned }))
      .filter((x) => x.todo + x.partial > 0);
    const judgingEnd = ms(e.judging_end);
    if (j.started && open.length) {
      out.push({
        code: 'judging_unfinished',
        severity: late || (judgingEnd != null && now >= judgingEnd) ? 'danger' : 'warn',
        count: open.length,
        href: '/judges',
        judges: open,
      });
    }
    if (j.submissions > 0 && !(j.judges || []).length) {
      out.push({ code: 'no_judges', severity: 'warn', count: j.submissions, href: '/judges' });
    }
    if (j.submissions > 0) {
      out.push({
        code: 'results_not_published',
        severity: late ? 'danger' : open.length ? 'info' : 'warn',
        count: j.submissions,
        href: '/results',
        ...(resultsAt != null ? { at: iso(resultsAt) } : {}),
      });
    }
  }
  // Reviews older than their project's last change: publishing asks first.
  if (!k.results?.published && j && j.outdated > 0) {
    out.push({ code: 'reviews_outdated', severity: 'warn', count: j.outdated, href: '/judges?tab=progress', judgesCount: j.outdatedJudges || 0 });
  }
  const c = k.certificates;
  if (k.results?.published && c && c.enabled && c.kinds > 0) {
    if (!c.signer) out.push({ code: 'certificate_signer_missing', severity: 'danger', count: 1, href: `/create-event/${e.id}?section=certificates` });
    else if (!c.issued && !c.issuing) out.push({ code: 'certificates_not_issued', severity: 'warn', count: 1, href: '/certificates' });
  }
  return out;
}

/**
 * The few things that need someone now. Each carries a count and the
 * organiser page that deals with it.
 *
 * @param {object} e        the event row
 * @param {object} k        the kpis (see overview)
 * @param {{ key: string }} phase
 */
function alertsFor(e, k, phase, now = Date.now()) {
  const out = [];
  const add = (code, severity, count, href, extra = {}) => {
    if (count > 0) out.push({ code, severity, count, href, ...extra });
  };
  const over = ['archived', 'ended', 'results', 'judging'].includes(phase.key);

  if (phase.key === 'draft') add('not_published', 'info', 1, `/create-event/${e.id}`);

  add('help_flagged', 'danger', k.help.flagged, '/help-queue');
  add('help_waiting', 'danger', k.help.waitingLong, '/help-queue', { since: k.help.oldestOpenAt });
  if (k.help.open > 0 && k.mentors.online === 0) add('no_mentor_online', 'warn', k.help.open, '/mentors');

  if (!over) {
    add('pending_old', 'warn', k.participants.pendingOld, '/participants?status=pending');
    if (k.participants.capacity?.full) {
      add('full_waitlist', 'info', k.participants.byStatus.waitlisted, '/participants?status=waitlisted');
    }
  }

  const subClose = ms(e.submission_deadline) ?? ms(e.end_date);
  if (phase.key === 'hacking' && subClose != null && subClose - now <= SUBMISSION_WARN_MS) {
    add('teams_without_submission', 'warn', k.teams.withoutSubmission, '/submissions', { at: iso(subClose) });
  }

  const formation = formationOf(e, now);
  const closes = ms(formation.closesAt);
  if (formation.open && closes != null && closes - now <= TEAM_WARN_MS) {
    add('teamless_near_deadline', 'warn', k.teams.teamlessApproved, '/teams', { at: formation.closesAt });
  }

  add('tasks_overdue', 'warn', k.volunteers.tasksOverdue, '/volunteers');
  add('delivery_failures', 'warn', k.announcements.failed24h, '/announcements');
  add('chat_reports', 'warn', k.chat?.openReports || 0, '/chat?tab=reports');

  // The late phases: judging, results, certificates.
  for (const a of lateAlerts(e, k, now)) out.push(a);

  return out.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]);
}

/** Help status in the queue's three words, whatever older rows say. */
const TICKET_STATE = `CASE
    WHEN LOWER(REPLACE(COALESCE(status, ''), '_', '-')) IN ('', 'open', 'pending', 'new', 'queued') THEN 'open'
    WHEN LOWER(REPLACE(COALESCE(status, ''), '_', '-')) IN ('in-progress', 'claimed') THEN 'in-progress'
    ELSE 'resolved' END`;

async function counts(eventId) {
  const [people, teams, subs, help, mentors, volunteers, ann, failed] = await Promise.all([
    db.query(
      `SELECT COUNT(*) FILTER (WHERE registered_at > now() - interval '24 hours')::int AS new24h,
              COUNT(*) FILTER (WHERE LOWER(TRIM(status)) = 'pending'
                                 AND registered_at < now() - interval '24 hours')::int AS pending_old
         FROM participants WHERE event_id = $1`,
      [eventId],
    ),
    db.query(
      `SELECT COUNT(*) FILTER (WHERE NOT gone)::int AS active,
              COUNT(*) FILTER (WHERE gone)::int AS eliminated,
              COUNT(*) FILTER (WHERE NOT gone AND members > 0 AND NOT has_project)::int AS without_submission
         FROM (SELECT LOWER(COALESCE(t.status, 'active')) = 'eliminated' AS gone,
                      (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) AS members,
                      EXISTS (SELECT 1 FROM submissions s WHERE s.team_id = t.id AND s.event_id = t.event_id) AS has_project
                 FROM teams t WHERE t.event_id = $1) x`,
      [eventId],
    ),
    db.query('SELECT COUNT(*)::int AS n FROM submissions WHERE event_id = $1', [eventId]),
    db.query(
      `SELECT COUNT(*) FILTER (WHERE st = 'open')::int AS open,
              COUNT(*) FILTER (WHERE st = 'in-progress')::int AS in_progress,
              COUNT(*) FILTER (WHERE st <> 'resolved' AND escalated_to_admin IS TRUE)::int AS flagged,
              COUNT(*) FILTER (WHERE st = 'open' AND created_at < now() - make_interval(mins => $2))::int AS waiting_long,
              MIN(created_at) FILTER (WHERE st = 'open') AS oldest_open,
              COUNT(*) FILTER (WHERE st = 'resolved' AND resolved_at > now() - interval '24 hours'
                                 AND COALESCE(closed_reason, 'resolved') = 'resolved')::int AS resolved24h,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (claimed_at - created_at)))
                FILTER (WHERE claimed_at IS NOT NULL AND claimed_at > now() - interval '24 hours') AS median_wait_s
         FROM (SELECT *, ${TICKET_STATE} AS st FROM help_tickets WHERE event_id = $1) h`,
      [eventId, HELP_WAIT_MIN],
    ),
    db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE COALESCE(presence, 'available') <> 'away'
                                 AND last_seen_at > now() - make_interval(secs => $2))::int AS online
         FROM mentor_assignments WHERE event_id = $1`,
      [eventId, ONLINE_WINDOW_MS / 1000],
    ),
    db.query(
      `SELECT (SELECT COUNT(*)::int FROM volunteers WHERE event_id = $1) AS total,
              COUNT(*) FILTER (WHERE status <> 'done')::int AS open,
              COUNT(*) FILTER (WHERE status <> 'done' AND due_at < now())::int AS overdue,
              COUNT(*) FILTER (WHERE status <> 'done' AND assignee_id IS NULL)::int AS unassigned
         FROM volunteer_tasks WHERE event_id = $1`,
      [eventId],
    ),
    db.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
              COUNT(*) FILTER (WHERE status = 'scheduled')::int AS scheduled,
              MIN(scheduled_at) FILTER (WHERE status = 'scheduled') AS next_scheduled
         FROM announcements WHERE event_id = $1`,
      [eventId],
    ),
    db.query(
      `SELECT COUNT(*)::int AS n
         FROM announcement_deliveries d JOIN announcements a ON a.id = d.announcement_id
        WHERE a.event_id = $1 AND d.status = 'failed' AND d.created_at > now() - interval '24 hours'`,
      [eventId],
    ),
  ]);
  return { people: people.rows[0], teams: teams.rows[0], subs: subs.rows[0], help: help.rows[0], mentors: mentors.rows[0], volunteers: volunteers.rows[0], ann: ann.rows[0], failed: failed.rows[0] };
}

/**
 * What the late phases need: each judge's progress once projects are in,
 * the certificates once results are out, and reported chat messages nobody
 * has dealt with. Only asked when it can matter, so the home stays quick
 * while the event is still registering.
 */
async function lateCounts(e, now = Date.now()) {
  const eventId = e.id;
  const subClose = ms(e.submission_deadline) ?? ms(e.end_date);
  const closed = subClose != null && now > subClose;
  const judgingStart = ms(e.judging_start);
  const scope = await entitlementService.forEvent(eventId).catch(() => null);
  const has = (m) => !scope || !scope.modules || scope.modules.has(m);

  const reports = has('chat')
    ? db.query('SELECT COUNT(DISTINCT message_id)::int AS n FROM chat_reports WHERE event_id = $1 AND resolved_at IS NULL', [eventId])
      .then((r) => r.rows[0].n).catch(() => 0)
    : Promise.resolve(0);

  let judging = { closed, started: false, judges: [], submissions: 0, outdated: 0, outdatedJudges: 0 };
  if (closed && !e.results_published_at) {
    const p = await judging_.progress(eventId);
    judging = {
      ...judging,
      closed,
      started: judgingStart == null || now >= judgingStart,
      judges: p.judges.map((x) => ({ id: x.id, name: x.name, assigned: x.assigned, done: x.done, partial: x.partial })),
      submissions: p.teams.filter((t) => !t.eliminated).length,
    };
  }
  // Judging has opened (at its own start, or when submissions closed) and
  // the results are not out: reviews a team's later change made outdated.
  const opens = judgingStart ?? subClose;
  if (!e.results_published_at && opens != null && now >= opens) {
    try {
      // eslint-disable-next-line global-require
      const o = await require('./results.service').outdatedReviews(eventId);
      judging.outdated = o.count;
      judging.outdatedJudges = o.judges.length;
    } catch { /* the home still loads without it */ }
  }

  let certificates = null;
  if (e.results_published_at && has('certificates')) {
    const cfg = withDefaults('certificate_config', e.certificate_config);
    const r = await db.query(
      `SELECT (SELECT COUNT(*)::int FROM certificates WHERE event_id = $1 AND revoked_at IS NULL) AS issued,
              (SELECT COUNT(*)::int FROM jobs WHERE type = 'certificates.issue'
                  AND (payload->>'eventId')::int = $1 AND finished_at IS NULL) AS issuing`,
      [eventId],
    );
    certificates = {
      enabled: true,
      kinds: (cfg.types || []).length,
      signer: Boolean(cfg.signerName && String(cfg.signerName).trim()),
      issued: r.rows[0].issued,
      issuing: r.rows[0].issuing > 0,
    };
  }
  return { openReports: await reports, judging, certificates };
}

/**
 * The latest things that happened, newest first. Names are the ones the
 * organiser already sees on their own pages; the audit log itself keeps ids.
 */
async function activity(eventId, limit = ACTIVITY_LIMIT) {
  const actions = Object.keys(AUDIT_ACTIONS);
  const [reg, teams, subs, asked, resolved, ann, audit, staff] = await Promise.all([
    db.query(
      `SELECT p.id, p.registered_at AS at, u.full_name AS subject, LOWER(TRIM(p.status)) AS status
         FROM participants p JOIN users u ON u.id = p.user_id
        WHERE p.event_id = $1 ORDER BY p.registered_at DESC LIMIT $2`,
      [eventId, limit],
    ),
    db.query(
      'SELECT id, created_at AS at, name AS subject FROM teams WHERE event_id = $1 ORDER BY created_at DESC LIMIT $2',
      [eventId, limit],
    ),
    db.query(
      `SELECT s.id, s.submitted_at AS at, t.name AS subject, s.project_name
         FROM submissions s JOIN teams t ON t.id = s.team_id
        WHERE s.event_id = $1 ORDER BY 2 DESC LIMIT $2`,
      [eventId, limit],
    ),
    db.query(
      `SELECT h.id, h.created_at AS at, COALESCE(t.name, u.full_name) AS subject, h.topic
         FROM help_tickets h
         LEFT JOIN teams t ON t.id = h.team_id
         LEFT JOIN users u ON u.id = h.requester_id
        WHERE h.event_id = $1 ORDER BY h.created_at DESC LIMIT $2`,
      [eventId, limit],
    ),
    db.query(
      `SELECT h.id, h.resolved_at AS at, COALESCE(t.name, u.full_name) AS subject, h.topic,
              m.full_name AS actor, h.closed_reason
         FROM help_tickets h
         LEFT JOIN teams t ON t.id = h.team_id
         LEFT JOIN users u ON u.id = h.requester_id
         LEFT JOIN users m ON m.id = h.mentor_id
        WHERE h.event_id = $1 AND h.resolved_at IS NOT NULL
        ORDER BY h.resolved_at DESC LIMIT $2`,
      [eventId, limit],
    ),
    db.query(
      `SELECT a.id, a.sent_at AS at, a.title AS subject, u.full_name AS actor, a.auto_key
         FROM announcements a LEFT JOIN users u ON u.id = a.author_id
        WHERE a.event_id = $1 AND a.status = 'sent' AND a.sent_at IS NOT NULL
        ORDER BY a.sent_at DESC LIMIT $2`,
      [eventId, limit],
    ),
    db.query(
      `SELECT l.id, l.created_at AS at, l.action, l.meta, actor.full_name AS actor,
              COALESCE(pu.full_name, tu.full_name, tm.name) AS subject, mu.full_name AS member
         FROM audit_log l
         LEFT JOIN users actor ON actor.id = l.actor_user_id
         LEFT JOIN users mu ON mu.id = CASE WHEN l.meta->>'userId' ~ '^[0-9]{1,9}$' THEN (l.meta->>'userId')::int END
         LEFT JOIN participants tp ON l.target_type = 'participant' AND tp.id::text = l.target_id
         LEFT JOIN users pu ON pu.id = tp.user_id
         LEFT JOIN users tu ON l.target_type = 'user' AND tu.id::text = l.target_id
         LEFT JOIN teams tm ON l.target_type = 'team' AND tm.id::text = l.target_id
        WHERE l.event_id = $1 AND l.action = ANY($3::text[])
        ORDER BY l.created_at DESC LIMIT $2`,
      [eventId, limit, actions],
    ),
    db.query(
      `SELECT i.id, i.used_at AS at, u.full_name AS subject, i.role
         FROM event_invites i JOIN users u ON u.id = i.user_id
        WHERE i.event_id = $1 AND i.used_at IS NOT NULL AND i.role IN ('mentor', 'judge', 'volunteer')
        ORDER BY i.used_at DESC LIMIT $2`,
      [eventId, limit],
    ),
  ]);

  const item = (type, id, row, extra = {}) => ({
    id: `${type}:${id}`,
    type,
    at: iso(row.at),
    actor: row.actor || null,
    subject: row.subject || null,
    meta: extra,
  });
  const auditMeta = (meta) => {
    const m = meta && typeof meta === 'object' ? meta : {};
    const pick = {};
    for (const key of ['from', 'to', 'count', 'created', 'skipped', 'promoted', 'team']) {
      if (m[key] != null) pick[key] = m[key];
    }
    return pick;
  };

  const all = [
    ...reg.rows.map((r) => item('registered', r.id, r, { status: r.status })),
    ...teams.rows.map((r) => item('team_created', r.id, r)),
    ...subs.rows.map((r) => item('submitted', r.id, r, { project: r.project_name || null })),
    ...asked.rows.map((r) => item('help_asked', r.id, r, { topic: r.topic || null })),
    ...resolved.rows.map((r) => item(r.closed_reason && r.closed_reason !== 'resolved' ? 'help_closed' : 'help_resolved', r.id, r, {
      topic: r.topic || null,
      reason: r.closed_reason || 'resolved',
    })),
    ...ann.rows.map((r) => item('announced', r.id, r, { auto: Boolean(r.auto_key) })),
    ...audit.rows.map((r) => item(AUDIT_ACTIONS[r.action], `a${r.id}`, r, { ...auditMeta(r.meta), ...(r.member ? { member: r.member } : {}) })),
    ...staff.rows.map((r) => item('staff_joined', r.id, r, { role: r.role })),
  ].filter((x) => x.at);

  return all.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}

/**
 * Everything the organiser's home shows for one event.
 * @param {number} eventId
 * @param {number} [now]
 */
async function overview(eventId, now = Date.now()) {
  const er = await db.query(
    `SELECT id, name, slug, status, is_published, timezone, registration_mode, allow_team_formation,
            registration_start, registration_end, team_deadline, start_date, end_date,
            submission_deadline, judging_start, judging_end, demo_day, results_at, published_at,
            results_published_at, certificate_config
       FROM events WHERE id = $1`,
    [eventId],
  );
  const e = er.rows[0];
  if (!e) return null;

  const [summary, c, feed, late] = await Promise.all([
    participantAdmin.summary(eventId), counts(eventId), activity(eventId), lateCounts(e, now),
  ]);

  const kpis = {
    participants: {
      total: summary.total,
      byStatus: summary.byStatus,
      capacity: summary.capacity,
      new24h: c.people.new24h,
      pendingOld: c.people.pending_old,
    },
    teams: {
      active: c.teams.active,
      eliminated: c.teams.eliminated,
      withoutSubmission: c.teams.without_submission,
      teamlessApproved: summary.teamlessApproved,
      looking: summary.lookingForTeam,
      size: summary.teamSize,
    },
    submissions: { total: c.subs.n },
    help: {
      open: c.help.open,
      inProgress: c.help.in_progress,
      flagged: c.help.flagged,
      waitingLong: c.help.waiting_long,
      oldestOpenAt: iso(c.help.oldest_open),
      resolved24h: c.help.resolved24h,
      medianWaitMin: c.help.median_wait_s == null ? null : Math.round(Number(c.help.median_wait_s) / 60),
    },
    mentors: { total: c.mentors.total, online: c.mentors.online },
    volunteers: {
      total: c.volunteers.total,
      tasksOpen: c.volunteers.open,
      tasksOverdue: c.volunteers.overdue,
      tasksUnassigned: c.volunteers.unassigned,
    },
    announcements: {
      sent: c.ann.sent,
      scheduled: c.ann.scheduled,
      nextScheduledAt: iso(c.ann.next_scheduled),
      failed24h: c.failed.n,
    },
    chat: { openReports: late.openReports },
    judging: late.judging,
    results: { published: Boolean(e.results_published_at), publishedAt: iso(e.results_published_at) },
    certificates: late.certificates,
  };

  const phase = phaseOf(e, now);
  const { milestones, next } = milestonesOf(e, now);
  return {
    event: { id: e.id, name: e.name, slug: e.slug || null, timezone: e.timezone || null, publishedAt: iso(e.published_at) },
    phase,
    next,
    milestones,
    formation: formationOf(e, now),
    kpis,
    alerts: alertsFor(e, kpis, phase, now),
    activity: feed,
    generatedAt: new Date(now).toISOString(),
  };
}

module.exports = { overview, phaseOf, milestonesOf, alertsFor, formationOf, AUDIT_ACTIONS, HELP_WAIT_MIN };
