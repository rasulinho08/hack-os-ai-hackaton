/**
 * @file setting.service.js
 * @description Business logic for event-scoped key-value settings.
 *
 * Settings are stored in `event_settings` as (event_id, key, value) rows.
 * Some keys (eventName, eventCode, maxTeamSize) are synced to the `events` table as well.
 */

const db = require('../config/db');

/**
 * Fetch all settings for an event as a flat key-value object.
 * Boolean strings ('true'/'false') are automatically cast.
 * Fallback values are read from the events table if not overridden.
 *
 * @param {number|string} eventId
 * @returns {Promise<object>} Key-value settings map
 */
const getSettings = async (eventId) => {
  const result = await db.query(
    'SELECT key, value FROM event_settings WHERE event_id = $1',
    [eventId]
  );

  const settings = {};
  for (const row of result.rows) {
    let val = row.value;
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    settings[row.key] = val;
  }

  const event = await db.query(
    'SELECT name, event_code, team_size_limit FROM events WHERE id = $1',
    [eventId]
  );
  if (event.rows[0]) {
    if (!settings.eventName) settings.eventName = event.rows[0].name;
    if (!settings.eventCode) settings.eventCode = event.rows[0].event_code;
    if (!settings.maxTeamSize) settings.maxTeamSize = String(event.rows[0].team_size_limit || 5);
  }

  return settings;
};

/**
 * Upsert multiple settings at once.
 * Also syncs eventName, eventCode, maxTeamSize to the events table if provided.
 *
 * @param {number|string} eventId
 * @param {object}        settingsObj - Key-value map of settings to save
 * @returns {Promise<void>}
 */
const upsertSettings = async (eventId, settingsObj) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    for (const [key, value] of Object.entries(settingsObj)) {
      const strVal = String(value);
      await client.query(
        `INSERT INTO event_settings (event_id, key, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id, key) DO UPDATE SET value = $3`,
        [eventId, key, strVal]
      );
    }

    if (settingsObj.eventName || settingsObj.eventCode || settingsObj.maxTeamSize) {
      const updates = [];
      const params = [];
      let idx = 1;

      if (settingsObj.eventName) {
        updates.push(`name = $${idx++}`);
        params.push(settingsObj.eventName);
      }
      if (settingsObj.eventCode) {
        updates.push(`event_code = $${idx++}`);
        params.push(settingsObj.eventCode);
      }
      if (settingsObj.maxTeamSize) {
        updates.push(`team_size_limit = $${idx++}`);
        params.push(parseInt(settingsObj.maxTeamSize, 10));
      }

      if (updates.length > 0) {
        params.push(eventId);
        await client.query(
          `UPDATE events SET ${updates.join(', ')} WHERE id = $${idx}`,
          params
        );
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Delete a single setting by its primary key.
 *
 * @param {number|string} id - event_settings.id
 * @returns {Promise<void>}
 */
const deleteSetting = async (id) => {
  await db.query('DELETE FROM event_settings WHERE id = $1', [id]);
};

module.exports = {
  getSettings,
  upsertSettings,
  deleteSetting,
};
