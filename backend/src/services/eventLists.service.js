/**
 * @file eventLists.service.js
 * @description Tracks, prizes, sponsors and judging criteria, saved as a
 * whole list the way the builder edits them.
 *
 * Rows sent with an `id` are updated in place, rows without one are added,
 * rows left out are removed — so ids survive every save and what refers to
 * them (a prize's track, a team's track, a judge's scores) keeps pointing at
 * the same thing. New rows may carry a client key `cid`; the answer maps
 * each to the id it received. Removing something still in use is refused
 * with a message saying what uses it, rather than silently breaking it:
 * a track with prizes, a criterion judges have already scored.
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const { SPONSOR_TIERS, PRIZE_KINDS } = require('../constants/eventBuilder');
const { UUID_RE } = require('./eventBuilderInput');

const LIMITS = { tracks: 30, prizes: 60, sponsors: 60, criteria: 20 };

function str(v, max, field, errors, { required = false } = {}) {
  const s = v == null ? '' : String(v).trim();
  if (!s) {
    if (required) errors.push({ field, message: 'Required.' });
    return null;
  }
  if (s.length > max) { errors.push({ field, message: `Must be ${max} characters or fewer.` }); return null; }
  return s;
}

function link(v, field, errors) {
  const s = str(v, 2000, field, errors);
  if (!s) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    if (!['http:', 'https:'].includes(u.protocol) || !u.hostname.includes('.')) throw new Error('bad');
    return u.toString();
  } catch {
    errors.push({ field, message: 'Not a valid link.' });
    return null;
  }
}

function prepare(kind, eventId, items, current) {
  if (!Array.isArray(items)) throw httpError(400, 'items must be a list', 'VALIDATION_ERROR');
  if (items.length > LIMITS[kind]) {
    throw httpError(400, `At most ${LIMITS[kind]} items.`, 'VALIDATION_ERROR', { errors: [{ field: 'items', message: `At most ${LIMITS[kind]} items.` }] });
  }
  const byId = new Map(current.map((r) => [Number(r.id), r]));
  const errors = [];
  items.forEach((it, i) => {
    if (it && it.id != null && !byId.has(Number(it.id))) errors.push({ field: `items.${i}.id`, message: 'Unknown item.' });
  });
  return { byId, errors };
}

async function inTransaction(fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function fail(errors) {
  if (errors.length) throw httpError(400, 'Some items need attention.', 'VALIDATION_ERROR', { errors });
}

// ── Sponsors ────────────────────────────────────────────────────────────────

async function listSponsors(eventId, exec = db) {
  const r = await exec.query('SELECT * FROM sponsors WHERE event_id = $1 ORDER BY sort_order, id', [eventId]);
  return r.rows;
}

async function syncSponsors(eventId, items) {
  const current = await listSponsors(eventId);
  const { errors } = prepare('sponsors', eventId, items, current);
  const fileIds = items.map((it) => it?.logoFileId ?? it?.logo_file_id).filter(Boolean);
  const files = fileIds.length
    ? (await db.query(
      "SELECT id FROM files WHERE id = ANY($1::uuid[]) AND event_id = $2 AND purpose = 'sponsor_logo'",
      [fileIds.filter((f) => UUID_RE.test(String(f))), eventId],
    )).rows.map((r) => r.id)
    : [];
  const rows = items.map((it, i) => {
    const f = (k) => `items.${i}.${k}`;
    const tier = it.tier == null || it.tier === '' ? null : String(it.tier).toLowerCase();
    if (tier && !SPONSOR_TIERS.includes(tier)) errors.push({ field: f('tier'), message: `Tier must be one of: ${SPONSOR_TIERS.join(', ')}.` });
    const logo = it.logoFileId ?? it.logo_file_id ?? null;
    if (logo && !files.includes(String(logo).toLowerCase())) errors.push({ field: f('logoFileId'), message: 'Upload the logo again.' });
    return {
      id: it.id != null ? Number(it.id) : null,
      cid: it.cid ?? null,
      name: str(it.name, 120, f('name'), errors, { required: true }),
      tier,
      website: link(it.website, f('website'), errors),
      description: str(it.description, 1000, f('description'), errors),
      logo_file_id: logo ? String(logo).toLowerCase() : null,
      sort_order: i,
    };
  });
  fail(errors);

  return inTransaction(async (client) => {
    const keep = new Set(rows.filter((r) => r.id).map((r) => r.id));
    for (const c of current) if (!keep.has(Number(c.id))) await client.query('DELETE FROM sponsors WHERE id = $1', [c.id]);
    const idsByCid = {};
    for (const r of rows) {
      if (r.id) {
        await client.query(
          `UPDATE sponsors SET name = $2, tier = $3, website = $4, description = $5, logo_file_id = $6, sort_order = $7,
                  logo = CASE WHEN $6::uuid IS NULL THEN logo ELSE NULL END
            WHERE id = $1`,
          [r.id, r.name, r.tier, r.website, r.description, r.logo_file_id, r.sort_order],
        );
      } else {
        const ins = await client.query(
          `INSERT INTO sponsors (event_id, name, tier, website, description, logo_file_id, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [eventId, r.name, r.tier, r.website, r.description, r.logo_file_id, r.sort_order],
        );
        if (r.cid != null) idsByCid[r.cid] = ins.rows[0].id;
      }
    }
    return { items: await listSponsors(eventId, client), idsByCid };
  });
}

// ── Tracks ──────────────────────────────────────────────────────────────────

async function listTracks(eventId, exec = db) {
  const r = await exec.query('SELECT * FROM tracks WHERE event_id = $1 ORDER BY sort_order, id', [eventId]);
  return r.rows;
}

async function syncTracks(eventId, items) {
  const current = await listTracks(eventId);
  const { errors } = prepare('tracks', eventId, items, current);
  const sponsorIds = new Set((await listSponsors(eventId)).map((s) => Number(s.id)));
  const rows = items.map((it, i) => {
    const f = (k) => `items.${i}.${k}`;
    const sponsorId = it.sponsorId ?? it.sponsor_id ?? null;
    if (sponsorId != null && sponsorId !== '' && !sponsorIds.has(Number(sponsorId))) {
      errors.push({ field: f('sponsorId'), message: 'Choose one of this event\'s sponsors.' });
    }
    return {
      id: it.id != null ? Number(it.id) : null,
      cid: it.cid ?? null,
      name: str(it.name, 120, f('name'), errors, { required: true }),
      description: str(it.description, 2000, f('description'), errors),
      sponsor_id: sponsorId != null && sponsorId !== '' ? Number(sponsorId) : null,
      sort_order: i,
    };
  });
  const names = rows.map((r) => (r.name || '').toLowerCase()).filter(Boolean);
  if (new Set(names).size !== names.length) errors.push({ field: 'items', message: 'Two tracks have the same name.' });

  const keep = new Set(rows.filter((r) => r.id).map((r) => r.id));
  const removed = current.filter((c) => !keep.has(Number(c.id)));
  if (removed.length) {
    const used = await db.query(
      'SELECT DISTINCT t.name FROM prizes p JOIN tracks t ON t.id = p.track_id WHERE p.track_id = ANY($1::int[])',
      [removed.map((r) => r.id)],
    );
    for (const u of used.rows) {
      errors.push({ field: 'items', message: `The track "${u.name}" has prizes. Remove or move its prizes first.`, code: 'TRACK_IN_USE' });
    }
  }
  fail(errors);

  return inTransaction(async (client) => {
    for (const c of removed) await client.query('DELETE FROM tracks WHERE id = $1', [c.id]);
    const idsByCid = {};
    for (const r of rows) {
      if (r.id) {
        await client.query(
          'UPDATE tracks SET name = $2, description = $3, sponsor_id = $4, sort_order = $5 WHERE id = $1',
          [r.id, r.name, r.description, r.sponsor_id, r.sort_order],
        );
      } else {
        const ins = await client.query(
          'INSERT INTO tracks (event_id, name, description, sponsor_id, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [eventId, r.name, r.description, r.sponsor_id, r.sort_order],
        );
        if (r.cid != null) idsByCid[r.cid] = ins.rows[0].id;
      }
    }
    return { items: await listTracks(eventId, client), idsByCid };
  });
}

// ── Prizes ──────────────────────────────────────────────────────────────────

async function listPrizes(eventId, exec = db) {
  const r = await exec.query(
    'SELECT * FROM prizes WHERE event_id = $1 ORDER BY sort_order, position NULLS LAST, id',
    [eventId],
  );
  return r.rows;
}

async function syncPrizes(eventId, items) {
  const current = await listPrizes(eventId);
  const { errors } = prepare('prizes', eventId, items, current);
  const trackIds = new Set((await listTracks(eventId)).map((t) => Number(t.id)));
  const rows = items.map((it, i) => {
    const f = (k) => `items.${i}.${k}`;
    const kind = String(it.kind || 'place').toLowerCase();
    if (!PRIZE_KINDS.includes(kind)) errors.push({ field: f('kind'), message: `Kind must be one of: ${PRIZE_KINDS.join(', ')}.` });
    let position = null;
    if (kind === 'place') {
      const n = Number(it.position);
      if (!Number.isInteger(n) || n < 1 || n > 20) errors.push({ field: f('position'), message: 'Place must be a number from 1 to 20.' });
      else position = n;
    }
    let trackId = null;
    if (kind === 'track') {
      const t = it.trackId ?? it.track_id;
      if (t == null || t === '' || !trackIds.has(Number(t))) errors.push({ field: f('trackId'), message: 'Choose the track this prize is for.' });
      else trackId = Number(t);
    }
    return {
      id: it.id != null ? Number(it.id) : null,
      cid: it.cid ?? null,
      kind,
      position,
      track_id: trackId,
      name: str(it.name, 120, f('name'), errors, { required: true }),
      value: str(it.value, 120, f('value'), errors),
      description: str(it.description, 1000, f('description'), errors),
      sort_order: i,
    };
  });
  const places = rows.filter((r) => r.kind === 'place' && r.position != null).map((r) => r.position);
  if (new Set(places).size !== places.length) errors.push({ field: 'items', message: 'Two prizes are for the same place.' });
  fail(errors);

  return inTransaction(async (client) => {
    const keep = new Set(rows.filter((r) => r.id).map((r) => r.id));
    for (const c of current) if (!keep.has(Number(c.id))) await client.query('DELETE FROM prizes WHERE id = $1', [c.id]);
    const idsByCid = {};
    for (const r of rows) {
      if (r.id) {
        await client.query(
          `UPDATE prizes SET kind = $2, position = $3, track_id = $4, name = $5, value = $6, description = $7, sort_order = $8
            WHERE id = $1`,
          [r.id, r.kind, r.position, r.track_id, r.name, r.value, r.description, r.sort_order],
        );
      } else {
        const ins = await client.query(
          `INSERT INTO prizes (event_id, kind, position, track_id, name, value, description, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [eventId, r.kind, r.position, r.track_id, r.name, r.value, r.description, r.sort_order],
        );
        if (r.cid != null) idsByCid[r.cid] = ins.rows[0].id;
      }
    }
    return { items: await listPrizes(eventId, client), idsByCid };
  });
}

// ── Judging criteria ────────────────────────────────────────────────────────

async function listCriteria(eventId, exec = db) {
  const r = await exec.query(
    `SELECT c.*, (SELECT COUNT(*)::int FROM scores s WHERE s.criterion_id = c.id) AS score_count
       FROM scoring_criteria c WHERE c.event_id = $1 ORDER BY c.sort_order, c.id`,
    [eventId],
  );
  return r.rows;
}

const normName = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

async function syncCriteria(eventId, items) {
  const current = await listCriteria(eventId);
  const { errors } = prepare('criteria', eventId, items, current);
  const rows = items.map((it, i) => {
    const f = (k) => `items.${i}.${k}`;
    const max = Number(it.maxScore ?? it.max_score ?? 10);
    if (!Number.isInteger(max) || max < 1 || max > 100) errors.push({ field: f('maxScore'), message: 'Maximum score: a whole number from 1 to 100.' });
    const weight = Number(it.weight ?? 1);
    if (!Number.isFinite(weight) || weight < 0.1 || weight > 10) errors.push({ field: f('weight'), message: 'Weight: from 0.1 to 10.' });
    return {
      id: it.id != null ? Number(it.id) : null,
      cid: it.cid ?? null,
      name: str(it.name, 120, f('name'), errors, { required: true }),
      description: str(it.description, 1000, f('description'), errors),
      max_score: max,
      weight: Math.round(weight * 100) / 100,
      sort_order: i,
    };
  });
  const names = rows.map((r) => normName(r.name)).filter(Boolean);
  if (new Set(names).size !== names.length) errors.push({ field: 'items', message: 'Two criteria have the same name.' });

  const keep = new Set(rows.filter((r) => r.id).map((r) => r.id));
  const removed = current.filter((c) => !keep.has(Number(c.id)));
  for (const c of removed) {
    if (c.score_count > 0) {
      errors.push({ field: 'items', message: `Judges have already scored "${c.name}"; it cannot be removed.`, code: 'CRITERION_SCORED' });
    }
  }
  for (const r of rows) {
    const old = r.id ? current.find((c) => Number(c.id) === r.id) : null;
    if (old && old.score_count > 0 && Number(old.max_score) !== r.max_score) {
      errors.push({ field: 'items', message: `Judges have already scored "${old.name}"; its maximum can no longer change.`, code: 'CRITERION_SCORED' });
    }
  }
  fail(errors);

  return inTransaction(async (client) => {
    for (const c of removed) await client.query('DELETE FROM scoring_criteria WHERE id = $1', [c.id]);
    // Renames that swap two names would collide mid-save; park them first.
    for (const r of rows) {
      if (r.id) await client.query('UPDATE scoring_criteria SET name = $2 WHERE id = $1', [r.id, `__saving_${r.id}`]);
    }
    const idsByCid = {};
    for (const r of rows) {
      if (r.id) {
        await client.query(
          `UPDATE scoring_criteria SET name = $2, description = $3, max_score = $4, weight = $5, sort_order = $6
            WHERE id = $1`,
          [r.id, r.name, r.description, r.max_score, r.weight, r.sort_order],
        );
      } else {
        const ins = await client.query(
          `INSERT INTO scoring_criteria (event_id, name, description, max_score, weight, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [eventId, r.name, r.description, r.max_score, r.weight, r.sort_order],
        );
        if (r.cid != null) idsByCid[r.cid] = ins.rows[0].id;
      }
    }
    return { items: await listCriteria(eventId, client), idsByCid };
  });
}

/** Seed criteria and prizes from a template inside the creating transaction. */
async function seed(client, eventId, { criteria = [], prizes = [] }) {
  for (const c of criteria) {
    await client.query(
      'INSERT INTO scoring_criteria (event_id, name, description, max_score, weight, sort_order) VALUES ($1, $2, $3, $4, $5, $6)',
      [eventId, c.name, c.description || null, c.max_score, c.weight, c.sort_order],
    );
  }
  for (const p of prizes) {
    await client.query(
      'INSERT INTO prizes (event_id, kind, position, name, value, sort_order) VALUES ($1, $2, $3, $4, $5, $6)',
      [eventId, p.kind, p.position, p.name, p.value, p.sort_order],
    );
  }
}

module.exports = {
  listSponsors,
  syncSponsors,
  listTracks,
  syncTracks,
  listPrizes,
  syncPrizes,
  listCriteria,
  syncCriteria,
  seed,
};
