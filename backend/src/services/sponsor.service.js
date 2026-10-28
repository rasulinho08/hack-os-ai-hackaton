/**
 * @file sponsor.service.js
 * @description Business logic for event sponsor management (logo, tier, website).
 */

const db = require('../config/db');

const getSponsors = async (eventId) => {
  const result = await db.query(
    'SELECT * FROM sponsors WHERE event_id = $1 ORDER BY tier, name',
    [eventId]
  );
  return result.rows;
};

const createSponsor = async (eventId, data) => {
  const { name, logo, tier, website } = data;
  const result = await db.query(
    `INSERT INTO sponsors (event_id, name, logo, tier, website)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [eventId, name, logo, tier, website]
  );
  return result.rows[0];
};

const updateSponsor = async (id, data) => {
  const { name, logo, tier, website } = data;
  const result = await db.query(
    `UPDATE sponsors SET name = $1, logo = $2, tier = $3, website = $4
     WHERE id = $5 RETURNING *`,
    [name, logo, tier, website, id]
  );
  return result.rows[0];
};

const deleteSponsor = async (id) => {
  await db.query('DELETE FROM sponsors WHERE id = $1', [id]);
};

module.exports = {
  getSponsors,
  createSponsor,
  updateSponsor,
  deleteSponsor,
};
