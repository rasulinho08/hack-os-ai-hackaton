/**
 * @file resource.service.js
 * @description Business logic for event resources (links, API keys, docs, datasets).
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');

/**
 * Resources of an event. A resource with `visible_from` in the future is the
 * organiser's until then (a dataset opened when coding starts, say), so only
 * callers that pass includeHidden see it early.
 */
const getResources = async (eventId, { includeHidden = true } = {}) => {
  const result = await db.query(
    `SELECT id, event_id, section, label, description, url, sort_order, visible_from, created_at, updated_at
     FROM event_resources
     WHERE event_id = $1
       AND ($2::boolean OR visible_from IS NULL OR visible_from <= now())
     ORDER BY section, sort_order, id`,
    [eventId, includeHidden === true],
  );
  return result.rows;
};

/**
 * '' / null → null (no embargo); anything else must be a date. A date that
 * does not parse is refused rather than read as "no embargo", which would
 * open a dataset meant to wait.
 */
const visibleFrom = (v) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw httpError(400, 'visible_from must be a date and time', 'INVALID_DATE');
  return d;
};

const getResourceById = async (eventId, id) => {
  const result = await db.query(
    `SELECT * FROM event_resources WHERE id = $1 AND event_id = $2`,
    [id, eventId],
  );
  return result.rows[0] || null;
};

const addResource = async (eventId, { section, label, description, url, sort_order, visible_from }) => {
  const result = await db.query(
    `INSERT INTO event_resources (event_id, section, label, description, url, sort_order, visible_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      eventId,
      (section || 'General').trim(),
      (label || '').trim(),
      (description || '').trim() || null,
      (url || '').trim() || null,
      sort_order ?? 0,
      visibleFrom(visible_from) ?? null,
    ],
  );
  return result.rows[0];
};

const updateResource = async (eventId, id, fields) => {
  const setClauses = [];
  const values = [];
  let idx = 1;

  for (const key of ['section', 'label', 'description', 'url', 'sort_order', 'visible_from']) {
    if (fields[key] !== undefined) {
      setClauses.push(`${key} = $${idx}`);
      if (key === 'sort_order') values.push(Number(fields[key]));
      else if (key === 'visible_from') values.push(visibleFrom(fields[key]));
      else values.push(String(fields[key] ?? '').trim() || null);
      idx++;
    }
  }

  if (setClauses.length === 0) return getResourceById(eventId, id);

  setClauses.push(`updated_at = NOW()`);
  values.push(id, eventId);

  const result = await db.query(
    `UPDATE event_resources
     SET ${setClauses.join(', ')}
     WHERE id = $${idx} AND event_id = $${idx + 1}
     RETURNING *`,
    values,
  );
  return result.rows[0] || null;
};

const deleteResource = async (eventId, id) => {
  await db.query(
    `DELETE FROM event_resources WHERE id = $1 AND event_id = $2`,
    [id, eventId],
  );
};

/**
 * Bulk replace: wipe existing resources for an event and insert new ones, in
 * one transaction, so an item that fails leaves the old list in place.
 */
const bulkReplace = async (eventId, items) => {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM event_resources WHERE event_id = $1', [eventId]);

    const inserted = [];
    for (let i = 0; i < items.length; i++) {
      const r = items[i];
      const result = await client.query(
        `INSERT INTO event_resources (event_id, section, label, description, url, sort_order, visible_from)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          eventId,
          (r.section || 'General').trim(),
          (r.label || '').trim(),
          (r.description || '').trim() || null,
          (r.url || '').trim() || null,
          r.sort_order ?? i,
          visibleFrom(r.visible_from) ?? null,
        ],
      );
      inserted.push(result.rows[0]);
    }

    await client.query('COMMIT');
    return inserted;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  getResources,
  getResourceById,
  addResource,
  updateResource,
  deleteResource,
  bulkReplace,
};
