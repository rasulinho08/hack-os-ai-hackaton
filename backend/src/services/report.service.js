/**
 * @file report.service.js
 * @description The post-event report: an event's figures for its organiser
 * and sponsors, as data (GET /api/events/:eventId/report) and as a PDF
 * (GET /api/events/:eventId/report.pdf, drawn by reportPdf.js).
 *
 * Aggregates only. The report counts people, it never names them: no
 * participant, judge or mentor names, no e-mail addresses, no phone numbers,
 * no free-text feedback. Teams, projects, prizes, sponsors and the
 * organisation appear by name: they are what the results and the event page
 * already show. Demographics are the event's own registration answers, and
 * a group smaller than MIN_GROUP people is folded into "Other" so that a
 * single person cannot be picked out ("the one participant from X").
 *
 * Available once the event is over: it has ended, its results are out, or
 * it was archived.
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const entitlementService = require('./entitlement.service');
const results = require('./results.service');
const fileService = require('./file.service');
const { LANGUAGES } = require('../constants/eventBuilder');

/** Smallest group a breakdown shows by name; smaller ones become "Other". */
const MIN_GROUP = 3;
/** Fewer answers than this and a breakdown is not shown at all. */
const MIN_ANSWERS = 5;
const TOP = 8;
const DEMOGRAPHIC_KEYS = ['university', 'experience', 'city', 'country', 'major', 'gender', 'source'];

const iso = (d) => (d ? new Date(d).toISOString() : null);
const n = (v) => Number(v) || 0;

function isOver(e, now = Date.now()) {
  return Boolean(e.results_published_at)
    || Boolean(e.archived_at)
    || String(e.status || '').toLowerCase() === 'archived'
    || (e.end_date && new Date(e.end_date).getTime() <= now);
}

/** The text of one registration answer, for counting; null when empty. */
function answerText(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ') || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object' && !Array.isArray(value)) {
    const v = value.name ?? value.label ?? value.value ?? null;
    return v == null ? null : answerText(v);
  }
  return null;
}

/**
 * Counts per answer with the small groups folded away. Answers that differ
 * only in case or spacing count together; the most common spelling names it.
 * @returns {{ total: number, items: {label: string, key: string|null, n: number}[], other: number, hidden: boolean }}
 */
function breakdown(values, { top = TOP, minGroup = MIN_GROUP, minAnswers = MIN_ANSWERS } = {}) {
  const groups = new Map();
  for (const raw of values) {
    const text = answerText(raw);
    if (!text) continue;
    const key = text.toLocaleLowerCase('az');
    const g = groups.get(key) || { n: 0, spellings: new Map() };
    g.n += 1;
    g.spellings.set(text, (g.spellings.get(text) || 0) + 1);
    groups.set(key, g);
  }
  const total = [...groups.values()].reduce((s, g) => s + g.n, 0);
  if (total < minAnswers) return { total, items: [], other: 0, hidden: total > 0 };
  const sorted = [...groups.entries()]
    .map(([key, g]) => ({ key, label: [...g.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0], n: g.n }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  const shown = sorted.filter((g) => g.n >= minGroup).slice(0, top);
  const other = total - shown.reduce((s, g) => s + g.n, 0);
  return { total, items: shown.map((g) => ({ label: g.label, key: g.key, n: g.n })), other, hidden: false };
}

async function loadEvent(eventId) {
  const r = await db.query(
    `SELECT e.*, c.name AS organiser_name FROM events e LEFT JOIN customers c ON c.id = e.customer_id WHERE e.id = $1`,
    [eventId],
  );
  if (!r.rows[0]) throw httpError(404, 'Event not found', 'NOT_FOUND');
  return r.rows[0];
}

async function funnel(eventId) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS registrations,
            COUNT(*) FILTER (WHERE LOWER(p.status) IN ('approved', 'eliminated'))::int AS approved,
            COUNT(*) FILTER (WHERE LOWER(p.status) = 'waitlisted')::int AS waitlisted,
            COUNT(*) FILTER (WHERE LOWER(p.status) = 'rejected')::int AS rejected,
            COUNT(*) FILTER (WHERE LOWER(p.status) = 'pending')::int AS pending,
            COUNT(c.id)::int AS checked_in,
            COUNT(*) FILTER (WHERE LOWER(p.status) IN ('approved', 'eliminated')
                               AND EXISTS (SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm.team_id
                                            WHERE tm.user_id = p.user_id AND t.event_id = p.event_id))::int AS in_teams
       FROM participants p
       LEFT JOIN event_checkins c ON c.participant_id = p.id AND c.event_id = p.event_id
      WHERE p.event_id = $1`,
    [eventId],
  );
  const t = await db.query(
    `SELECT (SELECT COUNT(*)::int FROM teams WHERE event_id = $1) AS teams,
            (SELECT COUNT(*)::int FROM submissions s JOIN teams t ON t.id = s.team_id
              WHERE s.event_id = $1 AND NULLIF(TRIM(s.project_name), '') IS NOT NULL) AS projects`,
    [eventId],
  );
  return { ...r.rows[0], ...t.rows[0] };
}

async function registrationsByDay(event) {
  const tz = event.timezone || 'Asia/Baku';
  const r = await db.query(
    `SELECT to_char(registered_at AT TIME ZONE $2, 'YYYY-MM-DD') AS day, COUNT(*)::int AS n
       FROM participants WHERE event_id = $1 GROUP BY 1 ORDER BY 1`,
    [event.id, tz],
  );
  return r.rows;
}

/** Days without a registration count as zero, so the chart's time axis is even. */
function everyDay(rows, maxDays = 180) {
  if (!rows.length) return [];
  const out = [];
  const byDay = new Map(rows.map((r) => [r.day, r.n]));
  const first = Date.parse(`${rows[0].day}T00:00:00Z`);
  const last = Date.parse(`${rows[rows.length - 1].day}T00:00:00Z`);
  if ((last - first) / 864e5 > maxDays) return rows.map((r) => ({ day: r.day, n: r.n }));
  for (let t = first; t <= last; t += 864e5) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push({ day, n: byDay.get(day) || 0 });
  }
  return out;
}

async function demographics(eventId) {
  const r = await db.query(
    `SELECT f.field_key, a.value
       FROM registration_answers a
       JOIN registration_fields f ON f.id = a.field_id AND f.event_id = a.event_id
       JOIN participants p ON p.id = a.participant_id
      WHERE a.event_id = $1 AND f.kind = 'standard' AND f.field_key = ANY($2::text[])
        AND LOWER(p.status) <> 'rejected'`,
    [eventId, DEMOGRAPHIC_KEYS],
  );
  const by = new Map();
  for (const row of r.rows) {
    if (!by.has(row.field_key)) by.set(row.field_key, []);
    by.get(row.field_key).push(row.value);
  }
  const out = {};
  for (const key of DEMOGRAPHIC_KEYS) {
    if (by.has(key)) out[key] = breakdown(by.get(key));
  }
  return out;
}

async function judgingSummary(eventId) {
  const [judges, criteria, reviews, projects] = await Promise.all([
    db.query('SELECT COUNT(*)::int AS n FROM judges WHERE event_id = $1', [eventId]),
    db.query('SELECT name, weight, max_score FROM scoring_criteria WHERE event_id = $1 ORDER BY sort_order, id', [eventId]),
    // A review counts when the judge scored every criterion (as the ranking counts it).
    db.query(
      `SELECT COUNT(*)::int AS reviews, COUNT(DISTINCT x.submission_id)::int AS reviewed
         FROM (SELECT sc.judge_id, sc.submission_id, COUNT(DISTINCT sc.criterion_id) AS k
                 FROM scores sc JOIN submissions s ON s.id = sc.submission_id AND s.event_id = $1
                 JOIN scoring_criteria cr ON cr.id = sc.criterion_id AND cr.event_id = $1
                GROUP BY 1, 2) x
        WHERE x.k >= (SELECT COUNT(*) FROM scoring_criteria WHERE event_id = $1)`,
      [eventId],
    ),
    db.query("SELECT COUNT(*)::int AS n FROM submissions WHERE event_id = $1 AND NULLIF(TRIM(project_name), '') IS NOT NULL", [eventId]),
  ]);
  const crit = criteria.rows;
  return {
    judges: judges.rows[0].n,
    criteria: crit.map((c) => ({ name: c.name, weight: Number(c.weight), maxScore: Number(c.max_score) })),
    reviews: crit.length ? reviews.rows[0].reviews : 0,
    projectsReviewed: crit.length ? reviews.rows[0].reviewed : 0,
    projects: projects.rows[0].n,
    reviewsPerProject: crit.length && reviews.rows[0].reviewed
      ? Math.round((reviews.rows[0].reviews / reviews.rows[0].reviewed) * 10) / 10 : null,
  };
}

/** Prize winners as the published results name them (teams and projects, never people). */
async function winnerList(event) {
  if (!event.results_published_at) return { published: false, items: [] };
  const rows = await results.snapshot(event.id);
  const prizes = await results.winners(event.id, rows);
  const projectOf = new Map(rows.map((r) => [r.teamId, r.projectName || null]));
  const items = [];
  for (const p of prizes) {
    for (const t of p.teams) {
      if (!t) continue;
      items.push({
        prize: p.prize.name,
        kind: p.prize.kind,
        position: p.prize.position ?? null,
        value: p.prize.value || null,
        place: t.place ?? null,
        team: t.teamName || null,
        project: t.projectName || projectOf.get(t.teamId) || null,
      });
    }
  }
  return { published: true, at: iso(event.results_published_at), teamsRanked: rows.length, items };
}

async function feedbackSummary(eventId) {
  const r = await db.query(
    `SELECT COUNT(*) FILTER (WHERE type = 'nps' AND nps IS NOT NULL)::int AS nps_n,
            COUNT(*) FILTER (WHERE type = 'nps' AND nps >= 9)::int AS promoters,
            COUNT(*) FILTER (WHERE type = 'nps' AND nps BETWEEN 7 AND 8)::int AS passives,
            COUNT(*) FILTER (WHERE type = 'nps' AND nps <= 6)::int AS detractors,
            COUNT(*) FILTER (WHERE COALESCE(type, '') <> 'nps' AND rating IS NOT NULL)::int AS rating_n,
            AVG(rating) FILTER (WHERE COALESCE(type, '') <> 'nps' AND rating IS NOT NULL) AS rating_avg
       FROM feedback WHERE event_id = $1`,
    [eventId],
  );
  const f = r.rows[0];
  return {
    nps: {
      responses: f.nps_n,
      score: f.nps_n ? Math.round(((f.promoters - f.detractors) / f.nps_n) * 100) : null,
      promoters: f.promoters,
      passives: f.passives,
      detractors: f.detractors,
    },
    rating: { responses: f.rating_n, average: f.rating_n ? Math.round(Number(f.rating_avg) * 10) / 10 : null },
  };
}

async function sponsorList(eventId) {
  const r = await db.query('SELECT name, tier FROM sponsors WHERE event_id = $1 ORDER BY sort_order, id', [eventId]);
  return r.rows.map((s) => ({ name: s.name, tier: s.tier || null }));
}

async function trackList(eventId) {
  const r = await db.query(
    `SELECT tr.name, COUNT(DISTINCT t.id)::int AS teams
       FROM tracks tr LEFT JOIN teams t ON t.track_id = tr.id AND t.event_id = tr.event_id
      WHERE tr.event_id = $1 GROUP BY tr.id, tr.name ORDER BY tr.id`,
    [eventId],
  );
  return r.rows;
}

function timelineOf(e) {
  const marks = [
    ['registration_start', e.registration_start],
    ['registration_end', e.registration_end],
    ['team_deadline', e.team_deadline],
    ['start', e.start_date],
    ['submission_deadline', e.submission_deadline],
    ['judging_start', e.judging_start],
    ['judging_end', e.judging_end],
    ['end', e.end_date],
    ['results', e.results_published_at || e.results_at],
  ];
  return marks.filter(([, at]) => at).map(([key, at]) => ({ key, at: iso(at) }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Everything the report shows, as data.
 * @param {number} eventId
 * @param {{ lang?: string }} [opts]
 */
async function build(eventId, { lang } = {}) {
  const e = await loadEvent(eventId);
  if (!isOver(e)) {
    throw httpError(409, 'The report is ready once the event is over.', 'EVENT_NOT_OVER', { endsAt: iso(e.end_date) });
  }
  const scope = await entitlementService.forEvent(eventId);
  const branded = Boolean(!scope || scope.modules.has('branding'));
  const checkinTracked = !scope || scope.modules.has('checkin');
  const [f, byDay, demo, judging, winners, feedback, sponsors, tracks] = await Promise.all([
    funnel(eventId), registrationsByDay(e), demographics(eventId), judgingSummary(eventId),
    winnerList(e), feedbackSummary(eventId), sponsorList(eventId), trackList(eventId),
  ]);
  const language = LANGUAGES.includes(lang) ? lang : (LANGUAGES.includes(e.language) ? e.language : 'az');
  return {
    language,
    generatedAt: new Date().toISOString(),
    event: {
      name: e.name,
      tagline: e.tagline || null,
      category: e.category,
      format: e.format,
      city: e.city || null,
      country: e.country ? String(e.country).trim() : null,
      venue: e.format === 'online' ? null : e.venue_name || null,
      startDate: iso(e.start_date),
      endDate: iso(e.end_date),
      timezone: e.timezone || 'Asia/Baku',
      organiser: e.organiser_name || null,
      language: e.language,
    },
    branding: { branded, colour: branded ? e.brand_color || null : null, hasLogo: Boolean(branded && e.logo_file_id) },
    funnel: {
      registrations: n(f.registrations),
      approved: n(f.approved),
      waitlisted: n(f.waitlisted),
      pending: n(f.pending),
      rejected: n(f.rejected),
      checkedIn: checkinTracked || n(f.checked_in) ? n(f.checked_in) : null,
      inTeams: n(f.in_teams),
      teams: n(f.teams),
      projects: n(f.projects),
    },
    registrationsByDay: everyDay(byDay),
    timeline: timelineOf(e),
    demographics: demo,
    judging,
    winners,
    feedback,
    sponsors,
    tracks: tracks.map((t) => ({ name: t.name, teams: t.teams })),
    privacy: { minGroup: MIN_GROUP, minAnswers: MIN_ANSWERS },
    _logoFileId: branded ? e.logo_file_id || null : null,
    _eventId: Number(e.id),
    _slug: e.slug || null,
  };
}

/** The report without the internal fields, for the JSON answer. */
function publicShape(data) {
  const out = { ...data };
  delete out._logoFileId;
  delete out._eventId;
  delete out._slug;
  return out;
}

/** The organiser's logo for the PDF: an image file of this event, PNG or JPEG. */
async function logoOf(data) {
  if (!data._logoFileId) return null;
  const meta = await fileService.getMeta(data._logoFileId);
  if (!meta || Number(meta.event_id) !== data._eventId) return null;
  const mime = String(meta.mime || '').toLowerCase();
  if (!/png|jpe?g/.test(mime)) return null;
  const bytes = await fileService.readBytes(meta.id);
  return bytes ? { bytes, mime } : null;
}

async function pdf(eventId, { lang } = {}) {
  const data = await build(eventId, { lang });
  // eslint-disable-next-line global-require
  const { renderReportPdf } = require('./reportPdf');
  const bytes = await renderReportPdf({ ...publicShape(data), logo: await logoOf(data) });
  return { bytes, filename: `report-${data._slug || data._eventId}-${data.language}.pdf` };
}

module.exports = { build, pdf, publicShape, breakdown, everyDay, isOver, MIN_GROUP, MIN_ANSWERS };
