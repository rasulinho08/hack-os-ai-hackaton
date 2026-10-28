/**
 * @file eventIdentity.js
 * @description The two public handles of an event: the slug of its page
 * (/e/<slug>) and the registration code people type (/join/<CODE>).
 * Both are made from the name and kept unique here.
 */

const crypto = require('crypto');
const db = require('../config/db');
const { slugify, codeFrom } = require('./eventTemplates');

/**
 * "baki-ai-hackathon", or "baki-ai-hackathon-2", "-3", … when taken. An
 * address another event used to have counts as taken: its old links must
 * keep leading to that event (event_slug_history).
 */
async function uniqueSlug(nameOrSlug, { exceptId = null, exec = db } = {}) {
  const base = slugify(nameOrSlug).slice(0, 72).replace(/-+$/g, '') || 'event';
  const r = await exec.query(
    `SELECT slug FROM events WHERE (slug = $1 OR slug LIKE $2) AND ($3::int IS NULL OR id <> $3)
     UNION
     SELECT slug FROM event_slug_history WHERE (slug = $1 OR slug LIKE $2) AND ($3::int IS NULL OR event_id <> $3)`,
    [base, `${base}-%`, exceptId],
  );
  const taken = new Set(r.rows.map((x) => x.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const cand = `${base}-${n}`;
    if (!taken.has(cand)) return cand;
  }
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

/** In use by another event, or remembered as another event's old address. */
async function slugTaken(slug, exceptId, exec = db) {
  const r = await exec.query(
    `SELECT 1 FROM events WHERE slug = $1 AND id <> $2
     UNION ALL
     SELECT 1 FROM event_slug_history WHERE slug = $1 AND event_id <> $2
     LIMIT 1`,
    [slug, exceptId],
  );
  return r.rows.length > 0;
}

/**
 * After an event's address changed from `from` to `to`: the old one is
 * remembered for this event (so /e/<from> still finds it), and the new one
 * is no longer an old address of anything.
 */
async function rememberSlugChange(eventId, from, to, { actorId = null, exec = db } = {}) {
  if (!from || from === to) return;
  await exec.query('DELETE FROM event_slug_history WHERE slug = $1', [to]);
  await exec.query(
    `INSERT INTO event_slug_history (slug, event_id, created_by) VALUES ($1, $2, $3)
     ON CONFLICT (slug) DO UPDATE SET event_id = EXCLUDED.event_id, created_by = EXCLUDED.created_by, created_at = now()`,
    [from, eventId, actorId],
  );
}

/** The event an old address belongs to, or null. */
async function eventIdFromOldSlug(slug, exec = db) {
  const s = String(slug || '').trim().toLowerCase();
  if (!s || s.length > 80) return null;
  const r = await exec.query('SELECT event_id FROM event_slug_history WHERE slug = $1', [s]);
  return r.rows[0] ? r.rows[0].event_id : null;
}

/** The addresses an event used to have, newest first. */
async function oldSlugs(eventId, exec = db) {
  const r = await exec.query(
    'SELECT slug, created_at FROM event_slug_history WHERE event_id = $1 ORDER BY created_at DESC LIMIT 20',
    [eventId],
  );
  return r.rows;
}

/** A free registration code from the name: "BAKIAIHACKAT", else a short random tail. */
async function uniqueCode(name, exec = db) {
  const base = codeFrom(name);
  const exists = async (code) => (await exec.query('SELECT 1 FROM events WHERE UPPER(event_code) = $1', [code])).rows.length > 0;
  if (!(await exists(base))) return base;
  for (let i = 0; i < 20; i += 1) {
    const cand = `${base.slice(0, 8)}${crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4)}`;
    if (!(await exists(cand))) return cand;
  }
  return `EV${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
}

module.exports = { uniqueSlug, slugTaken, uniqueCode, rememberSlugChange, eventIdFromOldSlug, oldSlugs };
