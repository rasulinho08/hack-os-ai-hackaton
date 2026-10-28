/**
 * @file track.service.js
 * @description Business logic for hackathon tracks (themed competition categories).
 * Tracks group submissions and can be linked to specific prizes.
 */

const db = require('../config/db');

const getTracks = async (eventId) => {
  const result = await db.query(
    'SELECT * FROM tracks WHERE event_id = $1 ORDER BY id',
    [eventId]
  );
  return result.rows;
};

const createTrack = async (eventId, data) => {
  const { name, description, color } = data;
  const result = await db.query(
    `INSERT INTO tracks (event_id, name, description, color)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [eventId, name, description, color]
  );
  return result.rows[0];
};

const updateTrack = async (id, data) => {
  const { name, description, color } = data;
  const result = await db.query(
    `UPDATE tracks SET name = $1, description = $2, color = $3
     WHERE id = $4 RETURNING *`,
    [name, description, color, id]
  );
  return result.rows[0];
};

const deleteTrack = async (id) => {
  await db.query('DELETE FROM tracks WHERE id = $1', [id]);
};

module.exports = {
  getTracks,
  createTrack,
  updateTrack,
  deleteTrack,
};
