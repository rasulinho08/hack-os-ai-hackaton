/**
 * @file profile.service.js
 * @description A participant's own record across events ("My hackathons")
 * and the public profile they may choose to share at /u/<handle>.
 *
 *   myHackathons(userId)      every event they took part in: role, team,
 *                             project, place and prizes (as far as the
 *                             organiser let them see), and their certificates
 *   settings(user)            the public profile's switches (all off at first)
 *   saveSettings(user, body)  turn it on or off, pick the handle and the parts
 *   publicProfile(handle)     what /u/<handle> shows, or null
 *   sitemapEntries()          the profiles their owners let search engines find
 *
 * The public profile is off until the person switches it on, and then shows
 * only the parts they ticked: the name, the hackathons, the projects, the
 * certificates. It never carries an e-mail address, a phone number or an
 * account id. Of the events, only those with a public page appear (a private
 * or invite-only event, a draft or an unpublished one never does), and only
 * where the person actually took part (not a registration still pending or
 * refused). Places and prizes are the public ones: those the event's own
 * projects page and certificates already show.
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const results = require('./results.service');
const publicProjects = require('./publicProjects.service');
const certificates = require('./certificate.service');

const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
const HEADLINE_MAX = 120;
const RESERVED = new Set([
  'admin', 'administrator', 'api', 'app', 'hackos', 'help', 'me', 'my', 'new', 'null', 'owner', 'root',
  'settings', 'support', 'system', 'undefined', 'user', 'users', 'www', 'staff', 'team', 'official',
  // GET /api/public/profiles/sitemap is the list for search engines.
  'sitemap',
]);
const TOOK_PART = ['approved', 'eliminated'];

const iso = (d) => (d ? new Date(d).toISOString() : null);
const isArchived = (e) => Boolean(e.archived_at) || String(e.status || '').toLowerCase() === 'archived';
/** The event has a public page to link to. */
const hasPage = (e) => e.is_published && e.visibility === 'public' && !isArchived(e) && Boolean(e.slug);
/** The event may be named on a public profile at all. */
const showable = (e) => e.is_published && e.visibility === 'public' && String(e.status || '').toLowerCase() !== 'draft';

/* ── The person's own record ─────────────────────────────────────────────── */

/** Every role the person had, one row per event (a participant row wins over staff ones). */
async function involvement(userId) {
  const r = await db.query(
    `WITH roles AS (
       SELECT p.event_id, CASE WHEN p.is_team_lead THEN 'lead' WHEN p.team_id IS NULL THEN 'solo' ELSE 'member' END AS role,
              LOWER(TRIM(COALESCE(p.status::text, 'pending'))) AS status, 0 AS rank
         FROM participants p WHERE p.user_id = $1
       UNION ALL SELECT event_id, 'judge', 'approved', 1 FROM judges WHERE user_id = $1
       UNION ALL SELECT DISTINCT event_id, 'mentor', 'approved', 2 FROM mentor_assignments WHERE user_id = $1
       UNION ALL SELECT event_id, 'volunteer', 'approved', 3 FROM volunteers WHERE user_id = $1
     ), one AS (
       SELECT DISTINCT ON (event_id) * FROM roles ORDER BY event_id, rank
     )
     SELECT one.role, one.status,
            e.id AS event_id, e.name, e.slug, e.tagline, e.is_published, e.visibility, e.status AS event_status, e.archived_at,
            e.start_date, e.end_date, e.city, e.country, e.format, e.timezone, e.results_published_at, e.projects_public, e.judging_config,
            c.name AS organiser_name,
            t.id AS team_id, t.name AS team_name, t.projects_hidden,
            s.project_name, s.tech_stack
       FROM one
       JOIN events e ON e.id = one.event_id
       LEFT JOIN customers c ON c.id = e.customer_id
       LEFT JOIN LATERAL (
         SELECT tt.id, tt.name, tt.projects_hidden FROM team_members tm
           JOIN teams tt ON tt.id = tm.team_id AND tt.event_id = e.id
          WHERE tm.user_id = $1 LIMIT 1
       ) t ON one.rank = 0
       LEFT JOIN submissions s ON s.team_id = t.id AND s.event_id = e.id
      WHERE one.status <> 'rejected'
      ORDER BY e.start_date DESC NULLS LAST, e.id DESC`,
    [userId],
  );
  return r.rows;
}

function eventOf(row) {
  return {
    id: Number(row.event_id),
    name: row.name,
    slug: hasPage({ ...row, status: row.event_status }) ? row.slug : null,
    startDate: iso(row.start_date),
    endDate: iso(row.end_date),
    city: row.city || null,
    format: row.format,
    timezone: row.timezone,
    organiser: row.organiser_name || null,
  };
}

/** The place and prizes the person may see for their team, or nulls. */
async function ownStanding(userId, row) {
  if (!['lead', 'member', 'solo'].includes(row.role) || !row.results_published_at || !TOOK_PART.includes(row.status)) {
    return { place: null, of: null, prizes: [] };
  }
  try {
    const r = await results.participantResults(userId, row.event_id);
    if (!r.mine) return { place: null, of: null, prizes: [] };
    return {
      place: r.mine.place ?? null,
      of: r.mine.of ?? null,
      prizes: (r.mine.won || []).map((p) => ({ name: p.name, kind: p.kind, value: p.value || null })),
    };
  } catch {
    return { place: null, of: null, prizes: [] };
  }
}

/** GET /api/me/hackathons */
async function myHackathons(userId) {
  const rows = await involvement(userId);
  const events = await Promise.all(rows.map(async (row) => {
    const standing = await ownStanding(userId, row);
    const projectsOpen = Boolean(row.projects_public && row.results_published_at && row.is_published && !row.projects_hidden);
    return {
      event: eventOf(row),
      role: row.role,
      status: row.status,
      team: row.team_name ? { name: row.team_name } : null,
      project: row.project_name ? {
        name: row.project_name,
        tech: row.tech_stack ? String(row.tech_stack).slice(0, 200) : null,
        publicUrl: projectsOpen && row.slug ? `/e/${row.slug}/projects` : null,
      } : null,
      result: { published: Boolean(row.results_published_at), ...standing },
      // Whether this event can appear on the public profile at all.
      shareable: showable({ ...row, status: row.event_status }) && TOOK_PART.includes(row.status),
    };
  }));
  const certs = (await certificates.mine(userId)).map((c) => ({
    code: c.code,
    kind: c.kind,
    place: c.place,
    title: c.title,
    issuedAt: iso(c.issued_at),
    event: { id: Number(c.event_id), name: c.event_name },
    teamName: c.team_name || null,
    verifyUrl: certificates.verifyUrl(c.code),
    pdfUrl: `/api/public/certificates/${encodeURIComponent(c.code)}/pdf`,
  }));
  return { events, certificates: certs };
}

/* ── The public profile's switches ───────────────────────────────────────── */

const TRANSLIT = {
  ə: 'e', ı: 'i', ğ: 'g', ş: 's', ç: 'c', ö: 'o', ü: 'u', а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e',
  ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
  ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** "Aysel Məmmədova" → "aysel-memmedova" (3–30 characters), or "" when nothing is left. */
function handleFrom(name) {
  const latin = [...String(name || '').toLowerCase()].map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch)).join('');
  const s = latin.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)
    .replace(/-+$/g, '');
  return s.length >= 3 ? s : '';
}

function checkHandle(raw) {
  const h = String(raw ?? '').trim().toLowerCase();
  if (!HANDLE_RE.test(h) || /--/.test(h)) {
    return { error: 'Use 3–30 lowercase letters, digits and single dashes; no dash at either end.' };
  }
  if (RESERVED.has(h)) return { error: 'This handle is reserved.' };
  return { handle: h };
}

async function handleTaken(handle, userId) {
  const r = await db.query('SELECT 1 FROM public_profiles WHERE LOWER(handle) = LOWER($1) AND user_id <> $2', [handle, userId]);
  return r.rows.length > 0;
}

/** A free handle built from the person's name (aysel-memmedova, aysel-memmedova-2 …). */
async function suggestHandle(user) {
  const base = handleFrom(user.full_name) || 'hacker';
  for (let i = 1; i < 50; i += 1) {
    const candidate = i === 1 ? base : `${base.slice(0, 27)}-${i}`;
    // eslint-disable-next-line no-await-in-loop
    if (!RESERVED.has(candidate) && !(await handleTaken(candidate, user.id))) return candidate;
  }
  return `${base.slice(0, 20)}-${Date.now().toString(36).slice(-6)}`;
}

function present(row) {
  return {
    enabled: Boolean(row?.enabled),
    handle: row?.handle || null,
    showName: Boolean(row?.show_name),
    showEvents: Boolean(row?.show_events),
    showProjects: Boolean(row?.show_projects),
    showCertificates: Boolean(row?.show_certificates),
    headline: row?.headline || null,
    hiddenEventIds: (row?.hidden_event_ids || []).map(Number),
    // Search engines may index the page and find it in the sitemap: a
    // separate choice, and only while the page itself is on.
    indexable: Boolean(row?.enabled && row?.indexable),
    path: row?.enabled && row?.handle ? `/u/${row.handle}` : null,
  };
}

/** GET /api/me/public-profile */
async function settings(user) {
  const r = await db.query('SELECT * FROM public_profiles WHERE user_id = $1', [user.id]);
  const row = r.rows[0] || null;
  return { ...present(row), suggestedHandle: row?.handle || (await suggestHandle(user)) };
}

const bool = (v, field, errors) => {
  if (v === undefined) return undefined;
  if (typeof v === 'boolean') return v;
  errors.push({ field, message: 'Must be true or false.' });
  return undefined;
};

/** PUT /api/me/public-profile — only the keys present change. */
async function saveSettings(user, body = {}) {
  const src = body && typeof body === 'object' ? body : {};
  const errors = [];
  const current = (await db.query('SELECT * FROM public_profiles WHERE user_id = $1', [user.id])).rows[0] || null;
  const next = {
    handle: current?.handle || null,
    enabled: current?.enabled || false,
    show_name: current?.show_name || false,
    show_events: current?.show_events || false,
    show_projects: current?.show_projects || false,
    show_certificates: current?.show_certificates || false,
    headline: current?.headline || null,
    hidden_event_ids: (current?.hidden_event_ids || []).map(Number),
    indexable: Boolean(current?.enabled && current?.indexable),
  };
  if (src.handle !== undefined) {
    const h = checkHandle(src.handle);
    if (h.error) errors.push({ field: 'handle', message: h.error });
    else next.handle = h.handle;
  }
  const map = { enabled: 'enabled', showName: 'show_name', showEvents: 'show_events', showProjects: 'show_projects', showCertificates: 'show_certificates' };
  for (const [key, col] of Object.entries(map)) {
    const v = bool(src[key], key, errors);
    if (v !== undefined) next[col] = v;
  }
  const indexable = bool(src.indexable, 'indexable', errors);
  if (indexable !== undefined) {
    if (indexable && !next.enabled) errors.push({ field: 'indexable', message: 'Switch your public profile on first: only a public page can be found by search engines.' });
    else next.indexable = indexable;
  }
  // A page switched off is not indexable either: switching it back on later
  // does not bring it back to search engines without asking.
  if (!next.enabled) next.indexable = false;
  if (src.headline !== undefined) {
    if (src.headline !== null && typeof src.headline !== 'string') errors.push({ field: 'headline', message: 'Must be text.' });
    else {
      const s = String(src.headline || '').replace(/\s+/g, ' ').trim();
      if (s.length > HEADLINE_MAX) errors.push({ field: 'headline', message: `Must be ${HEADLINE_MAX} characters or fewer.` });
      else next.headline = s || null;
    }
  }
  if (src.hiddenEventIds !== undefined) {
    const list = Array.isArray(src.hiddenEventIds) ? src.hiddenEventIds.map(Number) : null;
    if (!list || list.length > 500 || !list.every((n) => Number.isInteger(n) && n > 0)) {
      errors.push({ field: 'hiddenEventIds', message: 'Must be a list of event ids.' });
    } else next.hidden_event_ids = [...new Set(list)];
  }
  if (!next.handle) {
    if (next.enabled) errors.push({ field: 'handle', message: 'Choose a handle for the address of your page.' });
    else next.handle = await suggestHandle(user);
  }
  if (errors.length) throw httpError(400, errors[0].message, 'VALIDATION_ERROR', { errors });
  if (await handleTaken(next.handle, user.id)) {
    throw httpError(409, 'This handle is taken.', 'HANDLE_TAKEN', { errors: [{ field: 'handle', message: 'This handle is taken.' }] });
  }
  try {
    const r = await db.query(
      `INSERT INTO public_profiles (user_id, handle, enabled, show_name, show_events, show_projects, show_certificates, headline, hidden_event_ids,
                                    indexable, indexable_changed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::int[], $10, CASE WHEN $10 THEN now() END)
       ON CONFLICT (user_id) DO UPDATE SET
         handle = EXCLUDED.handle, enabled = EXCLUDED.enabled, show_name = EXCLUDED.show_name,
         show_events = EXCLUDED.show_events, show_projects = EXCLUDED.show_projects,
         show_certificates = EXCLUDED.show_certificates, headline = EXCLUDED.headline,
         hidden_event_ids = EXCLUDED.hidden_event_ids,
         indexable_changed_at = CASE WHEN public_profiles.indexable IS DISTINCT FROM EXCLUDED.indexable
                                     THEN now() ELSE public_profiles.indexable_changed_at END,
         indexable = EXCLUDED.indexable, updated_at = now()
       RETURNING *`,
      [user.id, next.handle, next.enabled, next.show_name, next.show_events, next.show_projects, next.show_certificates, next.headline, next.hidden_event_ids, next.indexable],
    );
    return { ...present(r.rows[0]), suggestedHandle: r.rows[0].handle };
  } catch (err) {
    // Two people taking the same handle at the same moment: the index decides.
    if (err.code === '23505') {
      throw httpError(409, 'This handle is taken.', 'HANDLE_TAKEN', { errors: [{ field: 'handle', message: 'This handle is taken.' }] });
    }
    throw err;
  }
}

/* ── The public page ─────────────────────────────────────────────────────── */

/**
 * GET /api/public/profiles/:handle — null unless the person switched the
 * page on. Every part is present only when ticked; an unticked part is
 * absent, not empty, so nothing about it can be read from the answer.
 */
async function publicProfile(rawHandle) {
  const handle = String(rawHandle || '').trim().toLowerCase();
  if (!HANDLE_RE.test(handle)) return null;
  const r = await db.query(
    `SELECT pp.*, u.full_name FROM public_profiles pp JOIN users u ON u.id = pp.user_id
      WHERE LOWER(pp.handle) = $1 AND pp.enabled = true`,
    [handle],
  );
  const p = r.rows[0];
  if (!p) return null;
  const hidden = new Set((p.hidden_event_ids || []).map(Number));
  const out = {
    handle: p.handle,
    name: p.show_name ? p.full_name : null,
    headline: p.headline || null,
    // Whether the page may be indexed (its owner's choice) and when it last changed.
    indexable: Boolean(p.indexable),
    updatedAt: iso(p.updated_at),
  };
  if (!p.show_events && !p.show_projects && !p.show_certificates) return out;

  const rows = (await involvement(p.user_id))
    .filter((row) => TOOK_PART.includes(row.status) && showable({ ...row, status: row.event_status }) && !hidden.has(Number(row.event_id)));
  const shownIds = new Set(rows.map((row) => Number(row.event_id)));

  // Places and prizes as public as the event made them (its projects page's rule).
  const standingsOf = new Map();
  await Promise.all(rows.filter((row) => row.results_published_at && row.team_id).map(async (row) => {
    try {
      const s = await publicProjects.standings({ id: row.event_id, judging_config: row.judging_config });
      standingsOf.set(Number(row.event_id), {
        place: s.placeOf.get(Number(row.team_id)) ?? null,
        prizes: s.awardsOf.get(Number(row.team_id)) || [],
      });
    } catch { /* no standings: nothing shown */ }
  }));
  const publicEvent = (row) => {
    const e = eventOf(row);
    return { name: e.name, slug: e.slug, startDate: e.startDate, endDate: e.endDate, city: e.city, format: e.format, organiser: e.organiser };
  };

  if (p.show_events) {
    out.events = rows.map((row) => ({
      event: publicEvent(row),
      role: row.role,
      team: row.team_name || null,
    }));
  }
  if (p.show_projects) {
    out.projects = rows.filter((row) => row.project_name).map((row) => {
      const s = standingsOf.get(Number(row.event_id)) || { place: null, prizes: [] };
      const open = Boolean(row.projects_public && row.results_published_at && !row.projects_hidden && row.slug);
      return {
        name: row.project_name,
        team: row.team_name || null,
        event: publicEvent(row),
        tech: row.tech_stack ? String(row.tech_stack).slice(0, 200) : null,
        place: s.place,
        prizes: s.prizes,
        url: open ? `/e/${row.slug}/projects` : null,
      };
    });
  }
  if (p.show_certificates) {
    out.certificates = (await certificates.mine(p.user_id))
      .filter((c) => shownIds.has(Number(c.event_id)))
      .map((c) => ({
        code: c.code,
        kind: c.kind,
        place: c.place,
        title: c.title,
        issuedAt: iso(c.issued_at),
        eventName: c.event_name,
        verifyUrl: certificates.verifyUrl(c.code),
      }));
  }
  return out;
}

/**
 * GET /api/public/profiles/sitemap — the profiles their owners let search
 * engines find: on, and indexable. Only the handle and when it changed.
 */
async function sitemapEntries(max = 5000) {
  const r = await db.query(
    `SELECT handle, updated_at FROM public_profiles
      WHERE enabled AND indexable
      ORDER BY updated_at DESC
      LIMIT ${Math.max(1, Math.min(50000, Number(max) || 5000))}`,
  );
  return r.rows.filter((x) => HANDLE_RE.test(String(x.handle).toLowerCase())).map((x) => ({ handle: x.handle, updatedAt: iso(x.updated_at) }));
}

module.exports = { myHackathons, settings, saveSettings, publicProfile, sitemapEntries, handleFrom, checkHandle, HANDLE_RE };
