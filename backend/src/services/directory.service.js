/**
 * @file directory.service.js
 * @description The public directory of hackathons on the marketing site
 * (GET /api/public/directory): every published event whose organiser left
 * it listed, with registration open first, then the ones still to come,
 * then the ones running, then the ones that finished.
 *
 * Listed means all of it at once: published, visibility 'public', the
 * organiser's "Show in the HackOS directory" switch on, not archived (its
 * page is gone then), a page address, and an organisation that is not
 * suspended, cancelled or archived. A draft, a private or an invite-only
 * event never appears, whatever the switch says.
 *
 * The owner pins events to the top (directory_featured, ordered by
 * directory_featured_rank, then the rest of the order below) while they have
 * not finished; a pinned event that is over falls back among the past ones.
 * An event the owner marked as a test (is_test) is never listed.
 *
 * What a card shows is the event page's own public facts — names, dates,
 * format and place, team size, the organisation — and nothing about people:
 * no participant, judge or organiser names, no e-mail, no counts per person.
 *
 * Answers are kept for a minute per query (the page is read by crawlers and
 * the web server on every visit), and dropped as soon as any event changes.
 */

const db = require('../config/db');
const { fileUrl } = require('./file.service');
const entitlementService = require('./entitlement.service');
const { FORMATS } = require('../constants/eventBuilder');

const TTL_MS = 60 * 1000;
const MAX_ENTRIES = 300;
const PHASES = Object.freeze(['open', 'upcoming', 'running', 'past']);
/** Filters: 'upcoming' is everything not started yet (registration open or not). */
const STATUS_FILTERS = Object.freeze(['open', 'upcoming', 'running', 'past']);
const LIMITS = Object.freeze({ defaultLimit: 12, maxLimit: 48, maxPage: 500, q: 80, city: 100, cities: 40 });

const cache = new Map();

/** Clears every kept answer: an event was listed, unlisted, published or changed. */
function invalidate() {
  cache.clear();
}

const LISTED_SQL = `
  e.is_published = true
  AND e.visibility = 'public'
  AND e.directory_listed = true
  AND e.is_test = false
  AND e.archived_at IS NULL
  AND LOWER(TRIM(COALESCE(e.status::text, ''))) NOT IN ('archived', 'draft')
  AND e.slug IS NOT NULL
  AND (c.id IS NULL OR (c.archived_at IS NULL AND c.status = ANY($1::text[])))`;

/* Where an event stands now; the same rules as the event page's registration state. */
const PHASE_SQL = `
  CASE
    WHEN e.end_date <= now() THEN 'past'
    WHEN e.start_date <= now() THEN 'running'
    WHEN (e.registration_start IS NULL OR e.registration_start <= now())
     AND (e.registration_end IS NULL OR e.registration_end >= now()) THEN 'open'
    ELSE 'upcoming'
  END`;

const RANK_SQL = "CASE phase WHEN 'open' THEN 0 WHEN 'upcoming' THEN 1 WHEN 'running' THEN 2 ELSE 3 END";

/** One text query parameter, trimmed and capped; '' when absent. */
function textParam(v, max) {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function intParam(v, { min, max, fallback }) {
  const n = Number.parseInt(Array.isArray(v) ? v[0] : v, 10);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * The query the directory understands, from a request's query string.
 * Unknown values are dropped rather than refused: a shared link with an old
 * filter still opens the directory.
 */
function parseQuery(query = {}) {
  const status = textParam(query.status, 20).toLowerCase();
  const format = textParam(query.format, 20).toLowerCase();
  return {
    status: STATUS_FILTERS.includes(status) ? status : null,
    format: FORMATS.includes(format) ? format : null,
    city: textParam(query.city, LIMITS.city) || null,
    q: textParam(query.q, LIMITS.q) || null,
    page: intParam(query.page, { min: 1, max: LIMITS.maxPage, fallback: 1 }),
    limit: intParam(query.limit, { min: 1, max: LIMITS.maxLimit, fallback: LIMITS.defaultLimit }),
  };
}

/** `%`, `_` and `\` typed by a visitor match themselves, not anything. */
const likeEscape = (s) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);

const iso = (d) => (d ? new Date(d).toISOString() : null);

/** Whether the event's look (its banner) is part of its plan, as on its page. */
async function brandedIds(ids) {
  const out = new Set();
  await Promise.all(ids.map(async (id) => {
    const scope = await entitlementService.forEvent(id);
    if (scope && scope.modules.has('branding')) out.add(id);
  }));
  return out;
}

function card(row, branded) {
  return {
    slug: row.slug,
    url: `/e/${row.slug}`,
    name: row.name,
    tagline: row.tagline || null,
    category: row.category,
    language: row.language,
    organiser: row.organiser_name ? { name: row.organiser_name, logoUrl: row.organiser_logo || null } : null,
    startDate: iso(row.start_date),
    endDate: iso(row.end_date),
    timezone: row.timezone,
    phase: row.phase,
    registration: {
      opensAt: iso(row.registration_start),
      closesAt: iso(row.registration_end),
      open: row.phase === 'open',
    },
    format: row.format,
    city: row.city || null,
    country: row.country ? String(row.country).trim() : null,
    venue: row.format === 'online' ? null : row.venue_name || null,
    teamSize: { min: Number(row.min_team_size) || 1, max: row.team_size_limit != null ? Number(row.team_size_limit) : null },
    mode: row.registration_mode,
    featured: Boolean(row.featured),
    cover: branded && row.banner_file_id ? fileUrl(row.banner_file_id) : null,
  };
}

async function load(p) {
  const params = [entitlementService.LIVE_STATUSES];
  const where = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (p.status === 'upcoming') where.push("phase IN ('open', 'upcoming')");
  else if (p.status) add('phase = ?', p.status);
  if (p.format) add('format = ?', p.format);
  if (p.city) add('LOWER(TRIM(city)) = LOWER(?)', p.city);
  if (p.q) {
    params.push(`%${likeEscape(p.q)}%`);
    const n = `$${params.length}`;
    const cols = ['name', "COALESCE(tagline, '')", "COALESCE(city, '')", "COALESCE(organiser_name, '')"];
    where.push(`(${cols.map((col) => `${col} ILIKE ${n} ESCAPE '\\'`).join(' OR ')})`);
  }
  const listed = `
    WITH listed AS (
      SELECT e.id, e.slug, e.name, e.tagline, e.category, e.language, e.format, e.city, e.country, e.venue_name,
             e.start_date, e.end_date, e.registration_start, e.registration_end, e.timezone,
             e.team_size_limit, e.min_team_size, e.registration_mode, e.banner_file_id,
             c.name AS organiser_name, c.logo_url AS organiser_logo,
             ${PHASE_SQL} AS phase,
             (e.directory_featured AND e.end_date > now()) AS featured,
             e.directory_featured_rank AS featured_rank
        FROM events e
        LEFT JOIN customers c ON c.id = e.customer_id
       WHERE ${LISTED_SQL}
    )`;
  const offset = (p.page - 1) * p.limit;
  const [rows, facets] = await Promise.all([
    db.query(
      `${listed}
       SELECT *, COUNT(*) OVER ()::int AS total FROM listed
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY CASE WHEN featured THEN 0 ELSE 1 END,
                 CASE WHEN featured THEN COALESCE(featured_rank, 1000) END ASC,
                 ${RANK_SQL},
                 CASE WHEN phase = 'open' THEN COALESCE(registration_end, start_date) END ASC,
                 CASE WHEN phase = 'upcoming' THEN start_date END ASC,
                 CASE WHEN phase = 'running' THEN end_date END ASC,
                 CASE WHEN phase = 'past' THEN end_date END DESC,
                 id DESC
        LIMIT ${p.limit} OFFSET ${offset}`,
      params,
    ),
    db.query(
      `${listed}
       SELECT 'phase' AS kind, phase AS value, COUNT(*)::int AS n FROM listed GROUP BY phase
       UNION ALL
       SELECT 'format', format, COUNT(*)::int FROM listed GROUP BY format
       UNION ALL
       SELECT 'city', MIN(TRIM(city)), COUNT(*)::int FROM listed
        WHERE NULLIF(TRIM(city), '') IS NOT NULL GROUP BY LOWER(TRIM(city))`,
      [entitlementService.LIVE_STATUSES],
    ),
  ]);

  const total = rows.rows[0]?.total || 0;
  const branded = await brandedIds(rows.rows.filter((r) => r.banner_file_id).map((r) => r.id));
  const phases = Object.fromEntries(PHASES.map((k) => [k, 0]));
  const formats = Object.fromEntries(FORMATS.map((k) => [k, 0]));
  const cities = [];
  for (const f of facets.rows) {
    if (f.kind === 'phase') phases[f.value] = f.n;
    else if (f.kind === 'format') formats[f.value] = f.n;
    else cities.push({ name: f.value, count: f.n });
  }
  cities.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    items: rows.rows.map((r) => card(r, branded.has(r.id))),
    page: p.page,
    limit: p.limit,
    total,
    pages: Math.max(1, Math.ceil(total / p.limit)),
    query: { status: p.status, format: p.format, city: p.city, q: p.q },
    facets: { phases, formats, cities: cities.slice(0, LIMITS.cities), total: Object.values(phases).reduce((a, b) => a + b, 0) },
  };
}

/*
 * A kept answer is used only while no event changed since: every update of an
 * event row moves its updated_at (a trigger), and a deleted one lowers the
 * count. So an organiser who unlists or unpublishes an event takes it off the
 * directory at once, not a minute later.
 */
async function stamp() {
  const r = await db.query('SELECT COUNT(*)::int AS n, MAX(updated_at) AS at FROM events');
  return `${r.rows[0].n}:${r.rows[0].at ? new Date(r.rows[0].at).getTime() : 0}`;
}

/** GET /api/public/directory — one page of listed events, with the facets. */
async function list(query) {
  const p = parseQuery(query);
  const key = JSON.stringify(p);
  const now = await stamp();
  const hit = cache.get(key);
  if (hit && hit.stamp === now && Date.now() - hit.at < TTL_MS) return hit.data;
  const data = await load(p);
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), stamp: now, data });
  return data;
}

/** The addresses of every listed event, for the sitemap (newest first, capped). */
async function slugs(max = 1000) {
  const r = await db.query(
    `SELECT e.slug, e.updated_at FROM events e LEFT JOIN customers c ON c.id = e.customer_id
      WHERE ${LISTED_SQL}
      ORDER BY e.start_date DESC LIMIT ${Math.max(1, Math.min(5000, Number(max) || 1000))}`,
    [entitlementService.LIVE_STATUSES],
  );
  return r.rows.map((row) => ({ slug: row.slug, updatedAt: iso(row.updated_at) }));
}

module.exports = { list, slugs, invalidate, parseQuery, TTL_MS, LIMITS, PHASES, STATUS_FILTERS };
