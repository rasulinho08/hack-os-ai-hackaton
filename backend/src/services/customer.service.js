/**
 * @file customer.service.js
 * @description The organisations that buy hackathons from us, and the people
 * we deal with at each one.
 *
 * A customer is deliberately separate from a user. The person who signs the
 * order is often not the person who runs the event, and neither is necessarily
 * the address the invoice goes to — collapsing all three into the `users` table
 * is what makes billing impossible to reason about later.
 */

const db = require('../config/db');

const COLUMNS = [
  'id', 'name', 'legal_name', 'sector', 'country', 'city', 'website',
  'vat_id', 'billing_email', 'notes', 'archived_at', 'created_at', 'updated_at',
  // How many organiser accounts the deal includes. NULL means no limit was
  // agreed, so a reader that omits this column cannot tell a capped plan from
  // an uncapped one — it sees `undefined` and shows "no limit" for both.
  'seat_limit',
  // The workspace: lifecycle, plan exemption, setup and branding (0010, 0011).
  'status', 'slug', 'plan_exempt', 'onboarded_at', 'timezone', 'locale', 'logo_url', 'brand_color',
];
const PUBLIC_COLUMNS = COLUMNS.join(', ');
/** The same list qualified by a table alias, for queries that join. */
const PREFIXED = (alias) => COLUMNS.map((c) => `${alias}.${c}`).join(', ');

/**
 * Every customer, newest first. Archived ones are excluded unless asked for —
 * they are kept rather than deleted so their orders keep a parent.
 */
const listCustomers = async ({ includeArchived = false } = {}) => {
  const result = await db.query(
    `SELECT ${PUBLIC_COLUMNS}
       FROM customers
      ${includeArchived ? '' : 'WHERE archived_at IS NULL'}
      ORDER BY name ASC`,
  );
  return result.rows;
};

const getCustomerById = async (id) => {
  const result = await db.query(
    `SELECT ${PUBLIC_COLUMNS} FROM customers WHERE id = $1`,
    [id],
  );
  return result.rows[0] || null;
};

const listContacts = async (customerId) => {
  const result = await db.query(
    `SELECT c.id, c.customer_id, c.user_id, c.full_name, c.email,
            c.role_title, c.is_primary, c.created_at,
            u.full_name AS user_full_name, u.role AS user_role
       FROM customer_contacts c
       LEFT JOIN users u ON u.id = c.user_id
      WHERE c.customer_id = $1
      ORDER BY c.is_primary DESC, c.created_at ASC`,
    [customerId],
  );
  return result.rows;
};

const createCustomer = async (data) => {
  const {
    name, legal_name, sector, country, city, website, vat_id, billing_email, notes,
  } = data;
  const result = await db.query(
    `INSERT INTO customers
       (name, legal_name, sector, country, city, website, vat_id, billing_email, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING ${PUBLIC_COLUMNS}`,
    [name, legal_name || null, sector || null, country || null, city || null,
     website || null, vat_id || null, billing_email || null, notes || null],
  );
  return result.rows[0];
};

/**
 * Patch semantics: only the keys present in `data` are touched, so a caller
 * updating one field cannot blank the rest by omitting them.
 */
const updateCustomer = async (id, data) => {
  const allowed = [
    'name', 'legal_name', 'sector', 'country', 'city',
    'website', 'vat_id', 'billing_email', 'notes',
  ];
  const sets = [];
  const values = [];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      values.push(data[key] === '' ? null : data[key]);
      sets.push(`${key} = $${values.length}`);
    }
  }
  if (sets.length === 0) return getCustomerById(id);
  values.push(id);
  const result = await db.query(
    `UPDATE customers SET ${sets.join(', ')}
      WHERE id = $${values.length}
      RETURNING ${PUBLIC_COLUMNS}`,
    values,
  );
  return result.rows[0] || null;
};

/** Archive rather than delete: orders reference this row. */
const archiveCustomer = async (id) => {
  const result = await db.query(
    `UPDATE customers SET archived_at = now()
      WHERE id = $1 AND archived_at IS NULL
      RETURNING ${PUBLIC_COLUMNS}`,
    [id],
  );
  return result.rows[0] || null;
};

const restoreCustomer = async (id) => {
  const result = await db.query(
    `UPDATE customers SET archived_at = NULL
      WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
    [id],
  );
  return result.rows[0] || null;
};

/**
 * Add a contact, or update the one already recorded for that address.
 *
 * The unique index is on (customer_id, lower(email)), so re-adding somebody
 * with a new job title corrects the row instead of failing.
 */
const upsertContact = async (customerId, data) => {
  const { user_id, full_name, email, role_title, is_primary } = data;
  const result = await db.query(
    `INSERT INTO customer_contacts
       (customer_id, user_id, full_name, email, role_title, is_primary)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (customer_id, LOWER(email)) DO UPDATE SET
       user_id    = COALESCE(EXCLUDED.user_id, customer_contacts.user_id),
       full_name  = COALESCE(EXCLUDED.full_name, customer_contacts.full_name),
       role_title = COALESCE(EXCLUDED.role_title, customer_contacts.role_title),
       is_primary = EXCLUDED.is_primary
     RETURNING *`,
    [customerId, user_id || null, full_name || null, String(email).trim(),
     role_title || null, Boolean(is_primary)],
  );
  return result.rows[0];
};

const removeContact = async (customerId, contactId) => {
  const result = await db.query(
    `DELETE FROM customer_contacts WHERE id = $1 AND customer_id = $2 RETURNING id`,
    [contactId, customerId],
  );
  return result.rows.length > 0;
};

/**
 * The customers a signed-in account belongs to.
 *
 * Matched on the contact's user_id first, then on e-mail, so somebody invited
 * by address before they had an account is recognised the moment they make one.
 */
const customersForUser = async (userId, email) => {
  const result = await db.query(
    `SELECT DISTINCT ON (cu.id) ${PREFIXED('cu')}, cc.member_role AS my_role
       FROM customers cu
       JOIN customer_contacts cc ON cc.customer_id = cu.id
      WHERE cu.archived_at IS NULL
        AND (cc.user_id = $1 OR ($2 <> '' AND LOWER(cc.email) = LOWER($2)))
      ORDER BY cu.id, (cc.member_role = 'owner') DESC, cu.name`,
    [userId || null, String(email || '').trim()],
  );
  return result.rows;
};

module.exports = {
  listCustomers,
  getCustomerById,
  listContacts,
  createCustomer,
  updateCustomer,
  archiveCustomer,
  restoreCustomer,
  upsertContact,
  removeContact,
  customersForUser,
};
