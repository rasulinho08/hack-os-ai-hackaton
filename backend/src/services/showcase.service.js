/**
 * @file showcase.service.js
 * @description Stories from past hackathons run on HackOS, for the public
 * site: written by the platform owner in the console, in Azerbaijani,
 * English or Russian (any of them), with the dates, the place, who
 * organised it, a few figures and photos.
 *
 * Words are text, never HTML. A story's body is either 'plain' (paragraphs
 * split by blank lines, the original format) or 'rich': the same text plus a
 * small markup the editor writes — ## / ### headings, - and 1. lists, >
 * quotes, ![caption](photo) images, [text](link) links, **bold**, *italic*
 * and --- — which the site turns into elements, never into HTML. Links may
 * only go to http(s), mailto or a path on the site; images only to story
 * photos.
 *
 * A story is a draft, scheduled (goes public at publish_at: a job publishes
 * it, and the public reads count it as published from that moment even if
 * the job is late) or published. Photos are 'showcase' files (public by link,
 * belonging to no event), uploaded through POST /api/owner/showcase/files
 * and listed on the story with an optional caption; the cover is one such
 * file too. A draft is the owner's alone; publishing needs a title. The
 * address (slug) follows the title while the story is a draft and stays put
 * once it has been published, unless the owner changes it.
 */

const db = require('../config/db');
const { fileUrl } = require('./file.service');
const { httpError } = require('../utils/responseFormat');
const jobs = require('./jobs.service');

const LANGS = Object.freeze(['az', 'en', 'ru']);
const LIMITS = Object.freeze({
  title: 160, summary: 400, body: 20000, location: 160, organisers: 240, caption: 200, photos: 60, slug: 80,
  tags: 12, tag: 40, author: 120, seoTitle: 90, seoDescription: 220,
});
const BODY_FORMATS = Object.freeze(['plain', 'rich']);
/** How far ahead a story may be scheduled. */
const MAX_SCHEDULE_MS = 366 * 24 * 3600 * 1000;
const JOB_TYPE = 'showcase.publish';
const FIGURES = Object.freeze(['participants', 'teams', 'projects', 'hours']);
const MAX_FIGURE = 10_000_000;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/* ── Addresses ──────────────────────────────────────────────────────────── */

const TRANSLIT = Object.freeze({
  // Azerbaijani letters that do not fall apart into a Latin letter and a mark.
  ə: 'e', ı: 'i',
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
});

/** "Bakı Süni İntellekt Hakatonu" → "baki-suni-intellekt-hakatonu"; "" when nothing is left. */
function slugify(text) {
  const lower = String(text || '').toLowerCase();
  const latin = [...lower].map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch)).join('');
  return latin
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)
    .replace(/-+$/g, '');
}

/** The first free address built on `base` (base, base-2, base-3 …). */
async function uniqueSlug(base, exceptId = null) {
  const root = slugify(base) || 'story';
  const taken = new Set((await db.query(
    `SELECT slug FROM showcase_posts
      WHERE (slug = $1 OR slug LIKE $1 || '-%') AND ($2::int IS NULL OR id <> $2)`,
    [root, exceptId],
  )).rows.map((r) => r.slug));
  if (!taken.has(root)) return root;
  for (let n = 2; ; n += 1) {
    const candidate = `${root}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The title to name the address after: English, else Azerbaijani, else Russian. */
const titleForSlug = (title) => (title && (title.en || title.az || title.ru)) || '';

/* ── Reading what the owner sent ────────────────────────────────────────── */

/** Plain text: no control characters but new lines and tabs, Unix line ends, trimmed. */
function plain(raw, { multiline = false } = {}) {
  let s = String(raw ?? '').replace(/\r\n?/g, '\n');
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (!multiline) s = s.replace(/\s*\n\s*/g, ' ');
  else s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function readWords(raw, field, max, errors, { multiline = false } = {}) {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push({ field, message: 'Expected the text per language: { az, en, ru }.' });
    return {};
  }
  const out = {};
  for (const lang of LANGS) {
    if (raw[lang] == null) continue;
    if (typeof raw[lang] !== 'string') {
      errors.push({ field: `${field}.${lang}`, message: 'Must be text.' });
      continue;
    }
    const text = plain(raw[lang], { multiline });
    if (text.length > max) errors.push({ field: `${field}.${lang}`, message: `At most ${max} characters.` });
    else if (text) out[lang] = text;
  }
  return out;
}

function readLine(raw, field, max, errors) {
  if (raw == null) return null;
  if (typeof raw !== 'string') {
    errors.push({ field, message: 'Must be text.' });
    return null;
  }
  const text = plain(raw);
  if (text.length > max) {
    errors.push({ field, message: `At most ${max} characters.` });
    return null;
  }
  return text || null;
}

function readDate(raw, field, errors) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!d || d.toISOString().slice(0, 10) !== s) {
    errors.push({ field, message: 'A date as YYYY-MM-DD.' });
    return null;
  }
  return s;
}

function readFigures(raw, errors) {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push({ field: 'figures', message: 'Expected { participants, teams, projects, hours }.' });
    return {};
  }
  const out = {};
  for (const key of FIGURES) {
    const v = raw[key];
    if (v == null || v === '') continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > MAX_FIGURE) errors.push({ field: `figures.${key}`, message: 'A whole number, 0 or more.' });
    else out[key] = n;
  }
  return out;
}

const asUuid = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return UUID_RE.test(s) ? s : null;
};

function readPhotos(raw, errors) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    errors.push({ field: 'photos', message: 'Expected a list of photos.' });
    return [];
  }
  if (raw.length > LIMITS.photos) {
    errors.push({ field: 'photos', message: `At most ${LIMITS.photos} photos.` });
    return [];
  }
  const seen = new Set();
  const out = [];
  raw.forEach((p, i) => {
    const fileId = asUuid(p && typeof p === 'object' ? p.fileId : p);
    if (!fileId) {
      errors.push({ field: `photos.${i}.fileId`, message: 'Not a photo of this story.' });
      return;
    }
    if (seen.has(fileId)) return;
    seen.add(fileId);
    const caption = readLine(p && typeof p === 'object' ? p.caption : null, `photos.${i}.caption`, LIMITS.caption, errors);
    out.push(caption ? { fileId, caption } : { fileId });
  });
  return out;
}

function readFocus(raw, errors) {
  if (raw == null) return { x: 50, y: 50 };
  const o = typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  const x = Number(o?.x);
  const y = Number(o?.y);
  if (!o || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) {
    errors.push({ field: 'coverFocus', message: 'A point { x, y } in percent, 0 to 100.' });
    return { x: 50, y: 50 };
  }
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

/** Up to 12 short labels, trimmed, lower-cased for matching, without repeats. */
function readTags(raw, errors) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    errors.push({ field: 'tags', message: 'Expected a list of tags.' });
    return [];
  }
  const out = [];
  const seen = new Set();
  raw.forEach((t, i) => {
    if (typeof t !== 'string') { errors.push({ field: `tags.${i}`, message: 'Must be text.' }); return; }
    const tag = plain(t).replace(/^#+/, '').replace(/\s+/g, ' ').trim();
    if (!tag) return;
    if (tag.length > LIMITS.tag) { errors.push({ field: `tags.${i}`, message: `At most ${LIMITS.tag} characters.` }); return; }
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(tag);
  });
  if (out.length > LIMITS.tags) errors.push({ field: 'tags', message: `At most ${LIMITS.tags} tags.` });
  return out.slice(0, LIMITS.tags);
}

/** Where a link in a story may go: the web, an e-mail address, or a page of the site. */
function safeHref(href) {
  const h = String(href || '').trim();
  if (/^\/(?!\/)/.test(h) || h.startsWith('#')) return true;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(h)) return true;
  try {
    const u = new URL(h);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.');
  } catch {
    return false;
  }
}

/** The story photo an image in the text points at (a file id or its /api/files address). */
function imageRef(target) {
  const t = String(target || '').trim();
  const m = /^(?:\/api\/files\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(t);
  return m ? m[1].toLowerCase() : null;
}

/** The images and the problems in a rich body: links that go nowhere safe, images that are not photos. */
function scanRich(text) {
  const images = [];
  const problems = [];
  for (const m of text.matchAll(/!\[[^\]\n]*\]\(([^)\s]*)\)/g)) {
    const id = imageRef(m[1]);
    if (id) images.push(id);
    else problems.push('Images in the text must be photos uploaded to this story.');
  }
  const withoutImages = text.replace(/!\[[^\]\n]*\]\([^)\s]*\)/g, '');
  for (const m of withoutImages.matchAll(/\[[^\]\n]+\]\(([^)\s]*)\)/g)) {
    if (!safeHref(m[1])) problems.push(`Links must start with https://, http://, mailto: or / (not "${m[1].slice(0, 40)}").`);
  }
  return { images, problems: [...new Set(problems)] };
}

/**
 * The fields of a story from a request body. `partial` (an update) reads
 * only what is there; columns are named as in the table.
 */
async function readInput(body, { partial = false } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const has = (k) => b[k] !== undefined;
  const errors = [];
  const out = {};
  if (!partial || has('title')) out.title = readWords(b.title, 'title', LIMITS.title, errors);
  if (!partial || has('summary')) out.summary = readWords(b.summary, 'summary', LIMITS.summary, errors);
  if (!partial || has('body')) out.body = readWords(b.body, 'body', LIMITS.body, errors, { multiline: true });
  if (!partial || has('heldFrom')) out.held_from = readDate(b.heldFrom, 'heldFrom', errors);
  if (!partial || has('heldTo')) out.held_to = readDate(b.heldTo, 'heldTo', errors);
  if (!partial || has('location')) out.location = readLine(b.location, 'location', LIMITS.location, errors);
  if (!partial || has('organisers')) out.organisers = readLine(b.organisers, 'organisers', LIMITS.organisers, errors);
  if (!partial || has('figures')) out.figures = readFigures(b.figures, errors);
  if (!partial || has('photos')) out.photos = readPhotos(b.photos, errors);
  if (!partial || has('coverFileId')) {
    if (b.coverFileId == null || b.coverFileId === '') out.cover_file_id = null;
    else {
      out.cover_file_id = asUuid(b.coverFileId);
      if (!out.cover_file_id) errors.push({ field: 'coverFileId', message: 'Not a photo of this story.' });
    }
  }
  if (!partial || has('eventId')) {
    if (b.eventId == null || b.eventId === '') out.event_id = null;
    else {
      const n = Number(b.eventId);
      if (!Number.isInteger(n) || n <= 0) errors.push({ field: 'eventId', message: 'Not an event.' });
      else if (!(await db.query('SELECT 1 FROM events WHERE id = $1', [n])).rows[0]) errors.push({ field: 'eventId', message: 'No such event.' });
      else out.event_id = n;
    }
  }
  if (!partial || has('bodyFormat')) {
    const f = b.bodyFormat == null || b.bodyFormat === '' ? 'plain' : String(b.bodyFormat);
    if (!BODY_FORMATS.includes(f)) errors.push({ field: 'bodyFormat', message: 'plain or rich.' });
    else out.body_format = f;
  }
  if (!partial || has('coverFocus')) out.cover_focus = readFocus(b.coverFocus, errors);
  if (!partial || has('tags')) out.tags = readTags(b.tags, errors);
  if (!partial || has('authorName')) out.author_name = readLine(b.authorName, 'authorName', LIMITS.author, errors);
  if (!partial || has('seoTitle')) out.seo_title = readWords(b.seoTitle, 'seoTitle', LIMITS.seoTitle, errors);
  if (!partial || has('seoDescription')) out.seo_description = readWords(b.seoDescription, 'seoDescription', LIMITS.seoDescription, errors);
  if (partial && has('slug')) {
    const slug = String(b.slug ?? '').trim().toLowerCase();
    if (!SLUG_RE.test(slug) || slug.length > LIMITS.slug) {
      errors.push({ field: 'slug', message: 'Small Latin letters, digits and single dashes, at most 80.' });
    } else out.slug = slug;
  }

  if (out.held_from && out.held_to && out.held_to < out.held_from) errors.push({ field: 'heldTo', message: 'Ends before it starts.' });

  // A rich body's links and images (checked whenever the body or its format is sent).
  const bodyImages = [];
  if (out.body && (out.body_format || 'rich') === 'rich') {
    for (const lang of LANGS) {
      if (!out.body[lang]) continue;
      const { images, problems } = scanRich(out.body[lang]);
      problems.forEach((m) => errors.push({ field: `body.${lang}`, message: m }));
      images.forEach((id) => bodyImages.push({ id, lang }));
    }
  }

  // The photos and the cover must be story photos that exist.
  const ids = [...(out.photos || []).map((p) => p.fileId), ...(out.cover_file_id ? [out.cover_file_id] : []), ...bodyImages.map((x) => x.id)];
  if (ids.length) {
    const found = new Set((await db.query(
      "SELECT id::text AS id FROM files WHERE id = ANY($1::uuid[]) AND purpose = 'showcase'",
      [ids],
    )).rows.map((r) => r.id));
    (out.photos || []).forEach((p, i) => {
      if (!found.has(p.fileId)) errors.push({ field: `photos.${i}.fileId`, message: 'Not a photo of this story.' });
    });
    if (out.cover_file_id && !found.has(out.cover_file_id)) errors.push({ field: 'coverFileId', message: 'Not a photo of this story.' });
    bodyImages.forEach((x) => {
      if (!found.has(x.id)) errors.push({ field: `body.${x.lang}`, message: 'An image in the text is not a photo of this story.' });
    });
  }
  if (errors.length) throw httpError(400, 'Check the story and try again.', 'VALIDATION_ERROR', { errors });
  return out;
}

/* ── Views ──────────────────────────────────────────────────────────────── */

const SELECT = `SELECT p.*, to_char(p.held_from, 'YYYY-MM-DD') AS held_from_s, to_char(p.held_to, 'YYYY-MM-DD') AS held_to_s,
                       ev.name AS ev_name, ev.slug AS ev_slug,
                       (ev.is_published AND ev.visibility = 'public' AND ev.archived_at IS NULL
                        AND LOWER(COALESCE(ev.status::text, '')) <> 'archived') AS ev_public
                  FROM showcase_posts p
                  LEFT JOIN events ev ON ev.id = p.event_id`;

const ref = (id) => (id ? { id, url: fileUrl(id) } : null);
const iso = (t) => (t ? new Date(t).toISOString() : null);

/** Published, or scheduled and its time has come: what the public sees. */
const VISIBLE_SQL = "(p.status = 'published' OR (p.status = 'scheduled' AND p.publish_at <= now()))";
const isLive = (row) => row.status === 'published' || (row.status === 'scheduled' && row.publish_at && new Date(row.publish_at) <= new Date());
const focus = (f) => (f && Number.isFinite(Number(f.x)) && Number.isFinite(Number(f.y)) ? { x: Number(f.x), y: Number(f.y) } : { x: 50, y: 50 });

function common(row) {
  return {
    slug: row.slug,
    title: row.title || {},
    summary: row.summary || {},
    heldFrom: row.held_from_s || null,
    heldTo: row.held_to_s || null,
    location: row.location || null,
    organisers: row.organisers || null,
    figures: row.figures || {},
    cover: ref(row.cover_file_id),
    coverFocus: focus(row.cover_focus),
    tags: Array.isArray(row.tags) ? row.tags : [],
    authorName: row.author_name || null,
  };
}

const publishedAt = (row) => iso(row.published_at || (row.status === 'scheduled' ? row.publish_at : null));

function listItem(row) {
  return { ...common(row), photoCount: Array.isArray(row.photos) ? row.photos.length : 0, publishedAt: publishedAt(row) };
}

/** The linked event, when its page is public: its name and address. */
function linkedEvent(row) {
  if (!row.ev_slug || !row.ev_public) return null;
  return { name: row.ev_name, slug: row.ev_slug };
}

function detail(row) {
  return {
    ...common(row),
    body: row.body || {},
    bodyFormat: row.body_format === 'rich' ? 'rich' : 'plain',
    seoTitle: row.seo_title || {},
    seoDescription: row.seo_description || {},
    photos: (Array.isArray(row.photos) ? row.photos : []).map((p) => ({ ...ref(p.fileId), caption: p.caption || null })),
    event: linkedEvent(row),
    publishedAt: publishedAt(row),
    updatedAt: iso(row.updated_at),
  };
}

function ownerView(row) {
  return {
    id: row.id,
    status: row.status,
    live: isLive(row),
    publishAt: iso(row.publish_at),
    eventId: row.event_id ?? null,
    createdAt: iso(row.created_at),
    ...detail(row),
  };
}

/* ── Owner ──────────────────────────────────────────────────────────────── */

async function getRow(id) {
  const n = Number.parseInt(String(id), 10);
  if (!Number.isInteger(n) || n <= 0) return null;
  return (await db.query(`${SELECT} WHERE p.id = $1`, [n])).rows[0] || null;
}

async function requireRow(id) {
  const row = await getRow(id);
  if (!row) throw httpError(404, 'Story not found', 'NOT_FOUND');
  return row;
}

async function ownerList() {
  const r = await db.query(`${SELECT} ORDER BY (p.status = 'draft') DESC, p.updated_at DESC, p.id DESC`);
  return r.rows.map(ownerView);
}

const ownerGet = async (id) => ownerView(await requireRow(id));

/** Writes a row, retrying once when two stories reach for the same address at once. */
async function withSlugRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err && err.code === '23505' && String(err.constraint || '').includes('slug')) return fn();
    throw err;
  }
}

async function create(body, userId) {
  const input = await readInput(body);
  const row = await withSlugRetry(async () => {
    const slug = await uniqueSlug(titleForSlug(input.title));
    return (await db.query(
      `INSERT INTO showcase_posts (slug, title, summary, body, held_from, held_to, location, organisers,
                                   figures, cover_file_id, photos, event_id, created_by,
                                   body_format, cover_focus, tags, author_name, seo_title, seo_description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
      [slug, input.title, input.summary, input.body, input.held_from, input.held_to, input.location, input.organisers,
        input.figures, input.cover_file_id, JSON.stringify(input.photos), input.event_id, userId,
        input.body_format, input.cover_focus, JSON.stringify(input.tags), input.author_name, input.seo_title, input.seo_description],
    )).rows[0];
  });
  return ownerGet(row.id);
}

async function update(id, body) {
  const current = await requireRow(id);
  const src = body && typeof body === 'object' ? { ...body } : {};
  // A body sent without its format keeps the story's format.
  if (src.body !== undefined && src.bodyFormat === undefined) src.bodyFormat = current.body_format;
  const input = await readInput(src, { partial: true });
  const heldFrom = input.held_from !== undefined ? input.held_from : current.held_from_s;
  const heldTo = input.held_to !== undefined ? input.held_to : current.held_to_s;
  if (heldFrom && heldTo && heldTo < heldFrom) {
    throw httpError(400, 'Check the story and try again.', 'VALIDATION_ERROR', { errors: [{ field: 'heldTo', message: 'Ends before it starts.' }] });
  }
  if (input.slug !== undefined && input.slug !== current.slug) {
    const clash = (await db.query('SELECT 1 FROM showcase_posts WHERE slug = $1 AND id <> $2', [input.slug, current.id])).rows[0];
    if (clash) throw httpError(409, 'Another story already has this address.', 'SLUG_TAKEN', { errors: [{ field: 'slug', message: 'Taken.' }] });
  } else if (input.title !== undefined && current.status === 'draft' && input.slug === undefined) {
    // A draft's address follows its title; a published one keeps its links.
    const wanted = slugify(titleForSlug(input.title)) || 'story';
    if (wanted !== current.slug && !current.slug.startsWith(`${wanted}-`)) input.slug = await uniqueSlug(wanted, current.id);
  }
  const cols = Object.keys(input);
  if (!cols.length) return ownerView(current);
  const values = cols.map((c) => (c === 'photos' || c === 'tags' ? JSON.stringify(input[c]) : input[c]));
  await withSlugRetry(() => db.query(
    `UPDATE showcase_posts SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
    [current.id, ...values],
  ));
  return ownerGet(current.id);
}

/** Why a story cannot go public yet (no title, dates out of order), as an error. */
function assertPublishable(row) {
  const title = row.title || {};
  if (!LANGS.some((l) => String(title[l] || '').trim())) {
    throw httpError(400, 'Give the story a title before publishing it.', 'TITLE_REQUIRED', { errors: [{ field: 'title', message: 'Required to publish.' }] });
  }
  if (row.held_from_s && row.held_to_s && row.held_to_s < row.held_from_s) {
    throw httpError(400, 'Check the story and try again.', 'VALIDATION_ERROR', { errors: [{ field: 'heldTo', message: 'Ends before it starts.' }] });
  }
}

const jobKey = (id) => `${JOB_TYPE}:${id}:`;

async function publish(id) {
  const row = await requireRow(id);
  assertPublishable(row);
  await db.query(
    `UPDATE showcase_posts SET status = 'published', published_at = COALESCE(published_at, publish_at, now()),
            publish_at = NULL, updated_at = now()
      WHERE id = $1`,
    [row.id],
  );
  await jobs.cancelByPrefix(jobKey(row.id));
  return ownerGet(row.id);
}

/**
 * Publish at a time (ISO string). A time already past publishes now. The
 * job queue publishes it then; moving or cancelling the time cancels the job.
 */
async function schedule(id, at) {
  const row = await requireRow(id);
  assertPublishable(row);
  const when = at ? new Date(at) : null;
  if (!when || Number.isNaN(when.getTime())) {
    throw httpError(400, 'Choose the date and time to publish at.', 'VALIDATION_ERROR', { errors: [{ field: 'publishAt', message: 'A date and time.' }] });
  }
  if (when.getTime() - Date.now() > MAX_SCHEDULE_MS) {
    throw httpError(400, 'A story can be scheduled at most a year ahead.', 'VALIDATION_ERROR', { errors: [{ field: 'publishAt', message: 'At most a year ahead.' }] });
  }
  if (when.getTime() <= Date.now()) return publish(row.id);
  if (row.status === 'published') {
    throw httpError(409, 'This story is already published. Unpublish it first to schedule it.', 'ALREADY_PUBLISHED');
  }
  await jobs.cancelByPrefix(jobKey(row.id));
  await db.query(
    "UPDATE showcase_posts SET status = 'scheduled', publish_at = $2, updated_at = now() WHERE id = $1",
    [row.id, when.toISOString()],
  );
  await jobs.enqueue(JOB_TYPE, { id: row.id, at: when.toISOString() }, {
    runAt: when,
    dedupeKey: `${jobKey(row.id)}${when.toISOString()}`,
  });
  return ownerGet(row.id);
}

/** Back to a draft: off the site, and any scheduled publication cancelled. */
async function unpublish(id) {
  const row = await requireRow(id);
  await db.query("UPDATE showcase_posts SET status = 'draft', publish_at = NULL, updated_at = now() WHERE id = $1", [row.id]);
  await jobs.cancelByPrefix(jobKey(row.id));
  return ownerGet(row.id);
}

/**
 * The job: publish a scheduled story whose time has come. Answers the story
 * when it was published now, null when there was nothing to do (rescheduled,
 * unpublished or deleted in the meantime).
 */
async function publishDue(id, at = null) {
  const r = await db.query(
    `UPDATE showcase_posts
        SET status = 'published', published_at = COALESCE(published_at, publish_at), publish_at = NULL, updated_at = now()
      WHERE id = $1 AND status = 'scheduled' AND publish_at <= now()
        AND ($2::timestamptz IS NULL OR publish_at = $2::timestamptz)
      RETURNING id, slug`,
    [Number(id) || 0, at],
  );
  return r.rows[0] || null;
}

/** Removes the story and the story photos nothing else uses. */
async function remove(id) {
  const row = await requireRow(id);
  const fileIds = [...new Set([
    ...(Array.isArray(row.photos) ? row.photos.map((p) => p.fileId) : []),
    ...(row.cover_file_id ? [row.cover_file_id] : []),
  ].filter(Boolean))];
  const client = await db.pool.connect();
  let removedFiles = 0;
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM showcase_posts WHERE id = $1', [row.id]);
    if (fileIds.length) {
      removedFiles = (await client.query(
        `DELETE FROM files f
          WHERE f.id = ANY($1::uuid[]) AND f.purpose = 'showcase'
            AND NOT EXISTS (SELECT 1 FROM showcase_posts p
                             WHERE p.cover_file_id = f.id
                                OR p.photos @> jsonb_build_array(jsonb_build_object('fileId', f.id::text)))`,
        [fileIds],
      )).rowCount;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { id: row.id, slug: row.slug, removedFiles };
}

/* ── Public ─────────────────────────────────────────────────────────────── */

async function publicList({ limit, tag } = {}) {
  const n = Math.min(24, Math.max(1, Number.parseInt(String(limit ?? 12), 10) || 12));
  const t = typeof tag === 'string' ? tag.trim().slice(0, LIMITS.tag) : '';
  const r = await db.query(
    `${SELECT} WHERE ${VISIBLE_SQL}
        AND ($2::text = '' OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.tags) x WHERE LOWER(x) = LOWER($2)))
      ORDER BY p.held_from DESC NULLS LAST, COALESCE(p.published_at, p.publish_at) DESC, p.id DESC
      LIMIT $1`,
    [n, t],
  );
  return { items: r.rows.map(listItem), tag: t || null };
}

async function publicDetail(slug) {
  const s = String(slug || '').trim().toLowerCase();
  if (!SLUG_RE.test(s) || s.length > LIMITS.slug) return null;
  const row = (await db.query(`${SELECT} WHERE p.slug = $1 AND ${VISIBLE_SQL}`, [s])).rows[0];
  return row ? detail(row) : null;
}

module.exports = {
  LANGS,
  LIMITS,
  JOB_TYPE,
  scanRich,
  schedule,
  publishDue,
  slugify,
  uniqueSlug,
  ownerList,
  ownerGet,
  create,
  update,
  publish,
  unpublish,
  remove,
  publicList,
  publicDetail,
};
