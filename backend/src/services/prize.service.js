/**
 * @file prize.service.js
 * @description Business logic for hackathon prizes and awards management.
 */

const db = require('../config/db');

const getPrizes = async (eventId) => {
  const result = await db.query(
    'SELECT * FROM prizes WHERE event_id = $1 ORDER BY position',
    [eventId]
  );
  return result.rows;
};

const createPrize = async (eventId, data) => {
  const { track_id, name, description, value, position } = data;
  const result = await db.query(
    `INSERT INTO prizes (event_id, track_id, name, description, value, position)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [eventId, track_id || null, name, description, value, position]
  );
  return result.rows[0];
};

const updatePrize = async (id, data) => {
  const { track_id, name, description, value, position } = data;
  const result = await db.query(
    `UPDATE prizes SET track_id = $1, name = $2, description = $3, value = $4, position = $5
     WHERE id = $6 RETURNING *`,
    [track_id || null, name, description, value, position, id]
  );
  return result.rows[0];
};

const deletePrize = async (id) => {
  await db.query('DELETE FROM prizes WHERE id = $1', [id]);
};

module.exports = {
  getPrizes,
  createPrize,
  updatePrize,
  deletePrize,
};
