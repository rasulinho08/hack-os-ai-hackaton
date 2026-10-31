/**
 * @file publicProjects.service.js
 * @description The public page of an event's projects (/e/<slug>/projects):
 * closed until the organiser opens it, shown only once the results are
 * published, and without the projects whose team lead kept them off it.
 *
 * The page never shows more than the organiser already made public: every
 * place when the results are fully public ("full"), otherwise only the places
 * that won a place prize; special and track prizes by name. Never scores,
 * never people (no names, no e-mail addresses), never files; links only when
 * they are http(s).
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const judging = require('./judging.service');
const results = require('./results.service');
const entitlementService = require('./entitlement.service');
const { fileUrl } = require('./file.service');

const DESCRIPTION_MAX = 600;
const STACK_MAX = 200;
const LINK_MAX = 500;

/** A link the page may show: http(s) only; a bare "github.com/x" gets https. */
function httpLink(value) {
  let s = String(value || '').trim();
  if (!s || s.length > LINK_MAX || /\s/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(s)) return null;
    s = `https://${s}`;
  }
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? s : null;
  } catch {
    return null;
  }
}

/** Plain text cut at a word, with an ellipsis; null when empty. */
function shorten(text, max) {
  const s = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!s) return null;
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

const isLive = (e) => Boolean(e.projects_public) && Boolean(e.results_published_at);

/** The events row the public page reads, by slug (published events only). */
async function eventBySlug(slug) {
  const key = String(slug || '').trim().toLowerCase();
  if (!key || key.length > 100) return null;
  const r = await db.query(
    `SELECT e.id, e.name, e.slug, e.tagline, e.language, e.start_date, e.end_date, e.timezone, e.format,
            e.city, e.country, e.brand_color, e.logo_file_id, e.banner_file_id, e.projects_public,
            e.results_published_at, e.judging_config, e.archived_at, e.status, c.name AS organiser_name
       FROM events e LEFT JOIN customers c ON c.id = e.customer_id
      WHERE e.slug = $1 AND e.is_published = true
      LIMIT 1`,
    [key],
  );
  return r.rows[0] || null;
}

/** The projects of an event that may be shown: not eliminated, not kept off by their team. */
async function listedProjects(eventId) {
  const r = await db.query(
    `SELECT s.id AS submission_id, s.project_name, s.description, s.tech_stack, s.repo_link, s.demo_link, s.video_link,
            COALESCE(s.track_id, t.track_id) AS track_id, tr.name AS track_name, t.id AS team_id, t.name AS team_name
       FROM submissions s
       JOIN teams t ON t.id = s.team_id AND t.event_id = s.event_id
       LEFT JOIN tracks tr ON tr.id = COALESCE(s.track_id, t.track_id)
      WHERE s.event_id = $1
        AND LOWER(COALESCE(t.status, 'active')) <> 'eliminated'
        AND t.projects_hidden = false
        AND NULLIF(TRIM(s.project_name), '') IS NOT NULL
      ORDER BY LOWER(s.project_name), s.id`,
    [eventId],
  );
  return r.rows;
}

/**
 * Places and prizes per team, as far as the organiser made them public:
 * all places under "full", else only the places that won a place prize.
 */
async function standings(event) {
  const rows = await results.snapshot(event.id);
  const prizes = await results.winners(event.id, rows);
  const visibility = judging.config(event).resultsVisibility;
  const placeOf = new Map();
  if (visibility === 'full') {
    for (const r of rows) placeOf.set(r.teamId, r.place);
  } else {
    for (const p of prizes) {
      if (p.prize.kind !== 'place') continue;
      for (const t of p.teams) if (t && t.place != null) placeOf.set(t.teamId, t.place);
    }
  }
  const awardsOf = new Map();
  for (const p of prizes) {
    for (const t of p.teams) {
      if (!t) continue;
      if (!awardsOf.has(t.teamId)) awardsOf.set(t.teamId, []);
      awardsOf.get(t.teamId).push({ name: p.prize.name, kind: p.prize.kind, value: p.prize.value || null });
    }
  }
  return { placeOf, awardsOf, places: visibility === 'full' ? 'all' : 'winners' };
}

/**
 * GET /api/public/events/:slug/projects — null when the page is not open
 * (no such published event, the organiser has not opened it, or the results
 * are not published). An archived event's page stays readable.
 */
async function publicProjects(slug) {
  const event = await eventBySlug(slug);
  if (!event || !isLive(event)) return null;
  const [projects, { placeOf, awardsOf, places }, scope] = await Promise.all([
    listedProjects(event.id),
    standings(event),
    entitlementService.forEvent(event.id),
  ]);
  const branded = Boolean(scope && scope.modules.has('branding'));
  const items = projects.map((p) => {
    const teamId = Number(p.team_id);
    return {
      id: Number(p.submission_id),
      title: p.project_name.trim(),
      teamName: p.team_name,
      description: shorten(p.description, DESCRIPTION_MAX),
      techStack: shorten(p.tech_stack, STACK_MAX),
      trackId: p.track_id ? Number(p.track_id) : null,
      track: p.track_name || null,
      links: { repo: httpLink(p.repo_link), demo: httpLink(p.demo_link), video: httpLink(p.video_link) },
      place: placeOf.has(teamId) ? placeOf.get(teamId) : null,
      awards: awardsOf.get(teamId) || [],
    };
  });
  // Placed projects first, by place; then the ones with a prize; then by title.
  items.sort((a, b) => {
    if ((a.place == null) !== (b.place == null)) return a.place == null ? 1 : -1;
    if (a.place != null && a.place !== b.place) return a.place - b.place;
    if (Boolean(a.awards.length) !== Boolean(b.awards.length)) return a.awards.length ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
  const tracks = [...new Map(items.filter((p) => p.trackId).map((p) => [p.trackId, { id: p.trackId, name: p.track }])).values()]
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return {
    event: {
      name: event.name,
      slug: event.slug,
      tagline: event.tagline || null,
      language: event.language || 'az',
      startDate: event.start_date,
      endDate: event.end_date,
      timezone: event.timezone || null,
      format: event.format || null,
      city: event.city || null,
      country: event.country || null,
      organiser: event.organiser_name || null,
      archived: judging.isArchived(event),
      brandColor: branded ? event.brand_color || null : null,
      logoUrl: branded ? fileUrl(event.logo_file_id) : null,
      bannerUrl: branded ? fileUrl(event.banner_file_id) : null,
    },
    resultsPublishedAt: event.results_published_at,
    places,
    tracks,
    projects: items,
  };
}

/** The flags of one event (organiser and participant views). */
async function eventFlags(eventId) {
  const r = await db.query(
    `SELECT id, slug, projects_public, projects_public_at, results_published_at, is_published, archived_at, status
       FROM events WHERE id = $1`,
    [eventId],
  );
  if (!r.rows[0]) throw httpError(404, 'Event not found', 'NOT_FOUND');
  return r.rows[0];
}

/** GET /api/events/:eventId/results/projects — the organiser's switch and what it would show. */
async function organiserState(eventId) {
  const e = await eventFlags(eventId);
  const counts = await db.query(
    `SELECT COUNT(*) FILTER (WHERE LOWER(COALESCE(t.status, 'active')) <> 'eliminated' AND t.projects_hidden = false
                               AND NULLIF(TRIM(s.project_name), '') IS NOT NULL)::int AS listed,
            COUNT(*) FILTER (WHERE t.projects_hidden = true)::int AS hidden,
            COUNT(*) FILTER (WHERE LOWER(COALESCE(t.status, 'active')) = 'eliminated')::int AS eliminated
       FROM submissions s JOIN teams t ON t.id = s.team_id AND t.event_id = s.event_id
      WHERE s.event_id = $1`,
    [eventId],
  );
  return {
    public: Boolean(e.projects_public),
    publicSince: e.projects_public_at,
    resultsPublished: Boolean(e.results_published_at),
    eventPublished: Boolean(e.is_published),
    live: isLive(e) && Boolean(e.is_published),
    slug: e.slug || null,
    projects: counts.rows[0],
  };
}

/** PUT /api/events/:eventId/results/projects { public } */
async function setPublic(eventId, on) {
  if (typeof on !== 'boolean') throw httpError(400, '"public" must be true or false.', 'VALIDATION_ERROR');
  const e = await eventFlags(eventId);
  if (judging.isArchived(e)) throw httpError(409, 'The event is archived.', 'EVENT_ARCHIVED');
  await db.query(
    `UPDATE events SET projects_public = $2,
            projects_public_at = CASE WHEN $2 THEN COALESCE(projects_public_at, now()) ELSE NULL END
      WHERE id = $1`,
    [eventId, on],
  );
  return organiserState(eventId);
}

/** The caller's team in the event, with whether they lead it. */
async function myTeam(userId, eventId) {
  const r = await db.query(
    `SELECT t.id, t.name, t.leader_id, t.projects_hidden, t.status,
            EXISTS (SELECT 1 FROM submissions s WHERE s.team_id = t.id AND s.event_id = t.event_id) AS has_project
       FROM team_members tm JOIN teams t ON t.id = tm.team_id AND t.event_id = $1
      WHERE tm.user_id = $2
      LIMIT 1`,
    [eventId, userId],
  );
  return r.rows[0] || null;
}

/** GET /api/events/:eventId/results/projects/mine */
async function mine(userId, eventId) {
  const [e, team] = await Promise.all([eventFlags(eventId), myTeam(userId, eventId)]);
  return {
    public: Boolean(e.projects_public),
    live: isLive(e) && Boolean(e.is_published),
    slug: e.slug || null,
    team: team ? {
      id: Number(team.id),
      name: team.name,
      isLead: Number(team.leader_id) === Number(userId),
      hidden: Boolean(team.projects_hidden),
      hasProject: Boolean(team.has_project),
      eliminated: String(team.status || '').toLowerCase() === 'eliminated',
    } : null,
  };
}

/** PUT /api/events/:eventId/results/projects/mine { hidden } — the team lead only. */
async function setHidden(userId, eventId, hidden) {
  if (typeof hidden !== 'boolean') throw httpError(400, '"hidden" must be true or false.', 'VALIDATION_ERROR');
  const e = await eventFlags(eventId);
  if (judging.isArchived(e)) throw httpError(409, 'The event is archived.', 'EVENT_ARCHIVED');
  const team = await myTeam(userId, eventId);
  if (!team) throw httpError(409, 'You are not in a team in this event.', 'NO_TEAM');
  if (Number(team.leader_id) !== Number(userId)) {
    throw httpError(403, 'Only the team lead decides whether the project is shown.', 'NOT_TEAM_LEAD');
  }
  await db.query('UPDATE teams SET projects_hidden = $2 WHERE id = $1 AND event_id = $3', [team.id, hidden, eventId]);
  return { teamId: Number(team.id), ...(await mine(userId, eventId)) };
}

/** Whether the event page may link to the projects page. */
async function isOpen(eventId) {
  const r = await db.query('SELECT projects_public, results_published_at FROM events WHERE id = $1', [eventId]);
  return Boolean(r.rows[0] && isLive(r.rows[0]));
}

module.exports = { publicProjects, organiserState, setPublic, mine, setHidden, isOpen, standings, httpLink, shorten };
