/**
 * @file ownerEvents.service.js
 * @description The platform owner's hand on any customer's event: the public
 * page's core fields, who can find it, its place in the directory, and its
 * lifecycle (publish, unpublish, archive, unarchive, mark as a test).
 *
 * Every edit goes through the builder's own save (eventBuilder.patchEvent)
 * with the owner's rights, so the owner cannot store anything an organiser
 * could not: the same field checks, the same timeline rules, the same unique
 * address. Only the fields of the public page are accepted here; the rest of
 * an event (judging, forms, mentors…) stays the organiser's.
 *
 * Nothing is ever deleted: an event the owner wants gone is archived.
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const builder = require('./eventBuilder.service');
const eventArchive = require('./eventArchive.service');
const entitlementService = require('./entitlement.service');
const directory = require('./directory.service');
const publicStats = require('./publicStats.service');
const { oldSlugs } = require('./eventIdentity');
const { fileUrl } = require('./file.service');
const { isReady } = require('./eventChecklist');

/** The fields of the public page the owner may change, as the builder names them. */
const EDITABLE = Object.freeze([
  'name', 'slug', 'tagline', 'description',
  'start_date', 'end_date', 'timezone',
  'format', 'venue_name', 'venue_address', 'city', 'country', 'map_url',
  'logo_file_id', 'banner_file_id',
  'registration_start', 'registration_end', 'max_participants', 'waitlist_enabled',
  'visibility', 'directory_listed',
]);
const DATE_FIELDS = new Set(['start_date', 'end_date', 'registration_start', 'registration_end']);
const MAX_RANK = 999;

const PHASE_SQL = `CASE
    WHEN LOWER(COALESCE(e.status::text, '')) = 'archived' OR e.archived_at IS NOT NULL THEN 'archived'
    WHEN NOT e.is_published THEN 'draft'
    WHEN e.start_date > now() THEN 'upcoming'
    WHEN e.end_date >= now() THEN 'running'
    ELSE 'finished'
  END`;

const iso = (v) => (v ? new Date(v).toISOString() : null);
const toId = (v) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

async function loadRow(id) {
  const n = toId(id);
  if (!n) return null;
  return (await db.query(
    `SELECT e.*, ${PHASE_SQL} AS phase,
            c.name AS customer_name, c.status AS customer_status, c.archived_at AS customer_archived_at,
            en.plan,
            (SELECT COUNT(*)::int FROM participants p WHERE p.event_id = e.id) AS participants
       FROM events e
       LEFT JOIN customers c ON c.id = e.customer_id
       LEFT JOIN entitlements en ON en.id = e.entitlement_id
      WHERE e.id = $1`,
    [n],
  )).rows[0] || null;
}

async function requireRow(id) {
  const row = await loadRow(id);
  if (!row) throw httpError(404, 'Event not found', 'NOT_FOUND');
  return row;
}

/**
 * Why the event is (not) in the public directory: an empty list means it is
 * listed. Same rules as directory.service's LISTED_SQL, in words.
 */
function directoryBlockers(row) {
  const out = [];
  if (!row.is_published) out.push('not_published');
  if (row.visibility !== 'public') out.push('not_public');
  if (!row.directory_listed) out.push('organiser_unlisted');
  if (row.archived_at || String(row.status || '').toLowerCase() === 'archived') out.push('archived');
  if (row.is_test) out.push('test');
  if (!row.slug) out.push('no_address');
  if (row.customer_id && (row.customer_archived_at || !entitlementService.LIVE_STATUSES.includes(row.customer_status))) {
    out.push('organisation_inactive');
  }
  return out;
}

/** The editor's view of one event. */
async function getEditable(id) {
  const row = await requireRow(id);
  const [scope, history, checklist] = await Promise.all([
    entitlementService.forEvent(row.id),
    oldSlugs(row.id),
    builder.checklistFor(row),
  ]);
  const blockers = directoryBlockers(row);
  return {
    id: row.id,
    event_code: row.event_code,
    name: row.name,
    slug: row.slug,
    tagline: row.tagline,
    description: row.description,
    start_date: iso(row.start_date),
    end_date: iso(row.end_date),
    timezone: row.timezone,
    format: row.format,
    venue_name: row.venue_name,
    venue_address: row.venue_address,
    city: row.city,
    country: row.country,
    map_url: row.map_url,
    logo_file_id: row.logo_file_id,
    logo_url: fileUrl(row.logo_file_id),
    banner_file_id: row.banner_file_id,
    banner_url: fileUrl(row.banner_file_id),
    registration_start: iso(row.registration_start),
    registration_end: iso(row.registration_end),
    max_participants: row.max_participants,
    waitlist_enabled: row.waitlist_enabled,
    visibility: row.visibility,
    directory_listed: row.directory_listed,
    directory_featured: row.directory_featured,
    directory_featured_rank: row.directory_featured_rank,
    is_test: row.is_test,
    is_published: row.is_published,
    archived: Boolean(row.archived_at) || String(row.status || '').toLowerCase() === 'archived',
    archived_at: iso(row.archived_at),
    published_at: iso(row.published_at),
    updated_at: iso(row.updated_at),
    phase: row.phase,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    plan: row.plan,
    participants: row.participants,
    // The page wears the event's own logo and cover only on a plan with branding.
    branded: !scope || scope.modules.has('branding'),
    directory: { listed: blockers.length === 0, blockers },
    old_slugs: history.map((h) => ({ slug: h.slug, since: iso(h.created_at) })),
    checklist: { ready: isReady(checklist.items), errors: checklist.items.filter((i) => i.severity === 'error') },
  };
}

const comparable = (key, v) => {
  if (v == null || v === '') return null;
  if (DATE_FIELDS.has(key)) return new Date(v).toISOString();
  return String(v);
};

/**
 * Save some of the public page's fields. Unknown or out-of-scope fields are
 * refused, not ignored, so the console never believes it saved something
 * that was dropped. Answers the new view and the fields that changed.
 */
async function update(id, body, { actorId = null } = {}) {
  const before = await requireRow(id);
  const src = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const foreign = Object.keys(src).filter((k) => !EDITABLE.includes(k));
  if (foreign.length) {
    throw httpError(400, 'Some of these fields cannot be changed here.', 'VALIDATION_ERROR', {
      errors: foreign.map((field) => ({ field, message: 'Not editable from the owner console.' })),
    });
  }
  if (!Object.keys(src).length) return { event: await getEditable(before.id), changed: [] };
  if (before.archived_at || String(before.status || '').toLowerCase() === 'archived') {
    throw httpError(409, 'Bring the event back from the archive before changing it.', 'EVENT_ARCHIVED');
  }
  await builder.patchEvent(before.id, src, { isOwner: true, actorId });
  const after = await requireRow(before.id);
  const changed = EDITABLE.filter((k) => comparable(k, before[k]) !== comparable(k, after[k]));
  if (changed.length) directory.invalidate();
  return {
    event: await getEditable(before.id),
    changed,
    slug: changed.includes('slug') ? { from: before.slug, to: after.slug } : null,
    before,
  };
}

function readFlags(body) {
  const b = body && typeof body === 'object' ? body : {};
  const errors = [];
  const out = {};
  const bool = (key, col) => {
    if (b[key] === undefined) return;
    if (typeof b[key] !== 'boolean') errors.push({ field: key, message: 'Must be true or false.' });
    else out[col] = b[key];
  };
  bool('featured', 'directory_featured');
  bool('isTest', 'is_test');
  if (b.featuredRank !== undefined) {
    if (b.featuredRank === null || b.featuredRank === '') out.directory_featured_rank = null;
    else {
      const n = Number(b.featuredRank);
      if (!Number.isInteger(n) || n < 1 || n > MAX_RANK) errors.push({ field: 'featuredRank', message: `A whole number from 1 to ${MAX_RANK}.` });
      else out.directory_featured_rank = n;
    }
  }
  if (errors.length) throw httpError(400, errors[0].message, 'VALIDATION_ERROR', { errors });
  return out;
}

/**
 * The owner's own switches: pinned to the top of the directory (and where),
 * and "this is a test". A test event is taken off the directory's pins too.
 */
async function setFlags(id, body) {
  const before = await requireRow(id);
  const sets = readFlags(body);
  if (sets.is_test === true) sets.directory_featured = false;
  if (sets.directory_featured === false && sets.directory_featured_rank === undefined) sets.directory_featured_rank = null;
  const cols = Object.keys(sets);
  if (cols.length) {
    await db.query(
      `UPDATE events SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
      [before.id, ...cols.map((c) => sets[c])],
    );
    directory.invalidate();
    publicStats.invalidate();
  }
  const after = await requireRow(before.id);
  const changes = {};
  for (const c of ['directory_featured', 'directory_featured_rank', 'is_test']) {
    if (before[c] !== after[c]) changes[c] = { from: before[c], to: after[c] };
  }
  return { event: await getEditable(before.id), changes, row: after };
}

async function publish(id) {
  const row = await requireRow(id);
  await builder.publish(row.id);
  directory.invalidate();
  return { event: await getEditable(row.id), row };
}

async function unpublish(id) {
  const row = await requireRow(id);
  await builder.unpublish(row.id);
  directory.invalidate();
  return { event: await getEditable(row.id), row };
}

async function archive(id, actorId) {
  const row = await requireRow(id);
  await eventArchive.archive(row.id, actorId);
  directory.invalidate();
  return { event: await getEditable(row.id), row };
}

async function unarchive(id) {
  const row = await requireRow(id);
  await eventArchive.unarchive(row.id);
  directory.invalidate();
  return { event: await getEditable(row.id), row };
}

module.exports = {
  EDITABLE,
  MAX_RANK,
  getEditable,
  update,
  setFlags,
  publish,
  unpublish,
  archive,
  unarchive,
  directoryBlockers,
};
