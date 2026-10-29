/**
 * @file presentation.service.js
 * @description Business logic for managing presentation schedules.
 *
 * Presentations link teams/submissions to presentation slots.
 * Supports reordering (drag-and-drop), drive_link uploads, and status tracking.
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const { withDefaults } = require('./eventBuilderInput');

/**
 * The organiser's presentation settings (event builder → Presentation day):
 * talk and Q&A minutes, the warning before time is up, and how the running
 * order is decided — plus the demo day the schedule starts from.
 */
async function settingsFor(eventId, exec = db) {
  const r = await exec.query('SELECT demo_day, presentation_config FROM events WHERE id = $1', [eventId]);
  const cfg = withDefaults('presentation_config', r.rows[0]?.presentation_config);
  return {
    order: cfg.order,
    slotMinutes: Number(cfg.slotMinutes),
    qaMinutes: Number(cfg.qaMinutes),
    warnSeconds: Number(cfg.warnSeconds),
    demoDay: r.rows[0]?.demo_day || null,
  };
}

/**
 * Times follow the running order: with a demo day set, each slot starts when
 * the one before it ends (its own length, so a slot the organiser lengthened
 * pushes the rest back). Without a demo day there is nothing to count from.
 */
async function reschedule(exec, eventId) {
  await exec.query(
    `WITH ordered AS (
       SELECT p.id,
              COALESCE(SUM(COALESCE(p.duration, 0)) OVER (
                ORDER BY p.presentation_order ASC, p.created_at ASC, p.id ASC
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS offset_min
         FROM presentations p
        WHERE p.event_id = $1
     )
     UPDATE presentations p
        SET scheduled_at = e.demo_day + (o.offset_min * interval '1 minute')
       FROM ordered o, events e
      WHERE p.id = o.id AND e.id = $1 AND e.demo_day IS NOT NULL`,
    [eventId],
  );
}

/**
 * List all presentations for an event, sorted by presentation_order.
 *
 * @param {number|string} eventId
 * @returns {Promise<object[]>}
 */
const getPresentations = async (eventId) => {
  const result = await db.query(
    `SELECT p.id, t.name AS team, s.project_name AS project,
            COALESCE(p.drive_link, s.presentation_link) AS "driveLink",
            p.presentation_order AS "order",
            p.status, p.duration,
            s.presentation_link AS "presentationLink",
            s.repo_link AS "repoLink",
            s.demo_link AS "demoLink",
            p.submission_id, p.event_id, p.team_id,
            p.scheduled_at, p.created_at
     FROM presentations p
     LEFT JOIN teams t ON p.team_id = t.id
     LEFT JOIN submissions s ON p.submission_id = s.id
     WHERE p.event_id = $1
     ORDER BY p.presentation_order ASC, p.created_at ASC`,
    [eventId]
  );
  return result.rows;
};

/**
 * Auto-generate presentation slots from submissions that don't have one yet,
 * after the slots that already exist. Each slot is as long as the organiser's
 * talk + Q&A; the order is by submission time, or shuffled when the organiser
 * chose random (manual starts from submission time and is then dragged).
 */
const generateFromSubmissions = async (eventId) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // One generator at a time per event, so two clicks cannot number twice.
    await client.query('SELECT id FROM events WHERE id = $1 FOR UPDATE', [eventId]);
    const cfg = await settingsFor(eventId, client);
    const length = Math.max(1, cfg.slotMinutes + cfg.qaMinutes);
    const orderBy = cfg.order === 'random' ? 'random()' : 's.submitted_at ASC, s.id ASC';
    const result = await client.query(
      `INSERT INTO presentations (submission_id, event_id, team_id, presentation_order, status, duration)
       SELECT s.id, s.event_id, s.team_id,
              (SELECT COALESCE(MAX(presentation_order), 0) FROM presentations WHERE event_id = $1)
                + ROW_NUMBER() OVER (ORDER BY ${orderBy}),
              'waiting', $2
         FROM submissions s
         JOIN teams t ON t.id = s.team_id
        WHERE s.event_id = $1
          AND LOWER(COALESCE(t.status, 'active')) <> 'eliminated'
          AND NOT EXISTS (
            SELECT 1 FROM presentations p
             WHERE p.submission_id = s.id AND p.event_id = s.event_id
          )
       RETURNING *`,
      [eventId, length],
    );
    await reschedule(client, eventId);
    await client.query('COMMIT');
    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Create a new presentation slot for a team's submission.
 *
 * @param {{ submission_id: number, event_id: number, team_id: number,
 *           scheduled_at?: string, duration?: number, presentation_order?: number }} data
 * @returns {Promise<object>}
 */
const createPresentation = async (data) => {
  const submission_id = data.submission_id || data.submissionId;
  const event_id = data.event_id || data.eventId;
  const team_id = data.team_id || data.teamId;
  const scheduled_at = data.scheduled_at || data.scheduledAt;
  const cfg = await settingsFor(event_id);
  const duration = data.duration || Math.max(1, cfg.slotMinutes + cfg.qaMinutes);
  const presentation_order = data.presentation_order || data.presentationOrder;
  // The project and the team must be this event's: a slot used to accept any
  // ids, and GET then showed another organisation's team and links.
  const own = await db.query(
    'SELECT team_id FROM submissions WHERE id = $1 AND event_id = $2',
    [submission_id, event_id],
  );
  if (!own.rows[0] || (team_id && Number(own.rows[0].team_id) !== Number(team_id))) {
    throw httpError(400, 'The project is not part of this event.', 'VALIDATION_ERROR');
  }
  const result = await db.query(
    `INSERT INTO presentations (submission_id, event_id, team_id, scheduled_at, duration, presentation_order)
     VALUES ($1, $2, $3, $4, $5,
             COALESCE($6, (SELECT COALESCE(MAX(presentation_order), 0) + 1 FROM presentations WHERE event_id = $2)))
     RETURNING *`,
    [submission_id, event_id, own.rows[0].team_id, scheduled_at, duration, presentation_order]
  );
  // Without a time of its own, the new slot takes its place in the schedule.
  if (!scheduled_at && cfg.demoDay) {
    await reschedule(db, event_id);
    return (await db.query('SELECT * FROM presentations WHERE id = $1', [result.rows[0].id])).rows[0];
  }
  return result.rows[0];
};

/**
 * Update fields on an existing presentation (PATCH semantics).
 * Returns null if no valid fields are provided.
 *
 * @param {number|string} id
 * @param {object}        data - Accepts both camelCase and snake_case field names
 * @returns {Promise<object|null>}
 */
const updatePresentation = async (id, data) => {
  const fieldMap = {
    scheduled_at: 'scheduled_at',
    duration: 'duration',
    status: 'status',
    presentation_order: 'presentation_order',
    drive_link: 'drive_link',
    driveLink: 'drive_link',
  };

  const sets = [];
  const params = [];
  let idx = 1;

  for (const [bodyKey, dbCol] of Object.entries(fieldMap)) {
    if (data[bodyKey] !== undefined) {
      sets.push(`${dbCol} = $${idx++}`);
      params.push(data[bodyKey]);
    }
  }

  if (sets.length === 0) return null;

  params.push(id);
  const result = await db.query(
    `UPDATE presentations SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  );
  const row = result.rows[0];
  // A longer or moved slot moves the ones after it.
  if (row && (data.duration !== undefined || data.presentation_order !== undefined)) {
    await reschedule(db, row.event_id);
    return (await db.query('SELECT * FROM presentations WHERE id = $1', [row.id])).rows[0];
  }
  return row;
};

/**
 * Permanently delete a presentation slot.
 *
 * @param {number|string} id
 * @returns {Promise<void>}
 */
const deletePresentation = async (id) => {
  await db.query('DELETE FROM presentations WHERE id = $1', [id]);
};

/**
 * Batch reorder presentations for an event.
 *
 * @param {number|string} eventId
 * @param {number[]|Array<{id:number,order:number}>} orderArray
 *   - If array of numbers → treated as ordered list of presentation IDs (index = order)
 *   - If array of objects → each must have { id, order }
 * @returns {Promise<void>}
 * @throws {Error} 400 if orderArray is empty or not an array
 */
const reorderPresentations = async (eventId, orderArray) => {
  if (!Array.isArray(orderArray) || orderArray.length === 0) {
    const err = new Error('order must be a non-empty array');
    err.statusCode = 400;
    throw err;
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    if (orderArray.length > 0 && typeof orderArray[0] === 'number') {
      for (let i = 0; i < orderArray.length; i++) {
        await client.query(
          'UPDATE presentations SET presentation_order = $1 WHERE id = $2 AND event_id = $3',
          [i + 1, orderArray[i], eventId]
        );
      }
    } else {
      for (const item of orderArray) {
        await client.query(
          'UPDATE presentations SET presentation_order = $1 WHERE id = $2 AND event_id = $3',
          [item.order, item.id, eventId]
        );
      }
    }

    await reschedule(client, eventId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  settingsFor,
  reschedule,
  getPresentations,
  generateFromSubmissions,
  createPresentation,
  updatePresentation,
  deletePresentation,
  reorderPresentations,
};
