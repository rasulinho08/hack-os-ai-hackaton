/**
 * @file registrationForm.service.js
 * @description The registration form of one event: which standard fields
 * are on, the organiser's own questions, and checking a registrant's
 * answers against them.
 *
 * Standard fields are rows like any other (kind 'standard'), created for an
 * event the first time its form is read, so an event made before forms
 * existed gets the default set rather than an empty form. Custom questions
 * someone already answered are archived instead of deleted, which keeps
 * their answers readable and exportable.
 */

const crypto = require('crypto');
const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const { STANDARD_FIELDS, CUSTOM_FIELD_TYPES } = require('../constants/eventBuilder');
const { transliterate } = require('./eventTemplates');
const fileService = require('./file.service');

const STANDARD = Object.fromEntries(STANDARD_FIELDS.map((f) => [f.key, f]));
const MAX_CUSTOM = 40;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Create the default standard rows for an event that has none yet. */
async function ensureFields(eventId, exec = db) {
  const existing = await exec.query('SELECT 1 FROM registration_fields WHERE event_id = $1 LIMIT 1', [eventId]);
  if (existing.rows.length) return;
  const values = [];
  const params = [];
  STANDARD_FIELDS.forEach((f, i) => {
    const o = params.length;
    values.push(`($${o + 1}, $${o + 2}, 'standard', $${o + 3}, $${o + 4}::jsonb, false, $${o + 5}, $${o + 6}, $${o + 7})`);
    params.push(eventId, f.key, f.type, JSON.stringify(f.options || []), f.defaultOn, Boolean(f.sensitive), i);
  });
  await exec.query(
    `INSERT INTO registration_fields (event_id, field_key, kind, type, options, required, enabled, sensitive, sort_order)
     VALUES ${values.join(', ')}
     ON CONFLICT (event_id, field_key) DO NOTHING`,
    params,
  );
}

/** Seed explicit rows (from a template) inside a transaction. */
async function insertFields(client, eventId, rows) {
  for (const r of rows) {
    await client.query(
      `INSERT INTO registration_fields
         (event_id, field_key, kind, type, label, help, options, required, enabled, sensitive, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
       ON CONFLICT (event_id, field_key) DO NOTHING`,
      [eventId, r.field_key, r.kind, r.type, r.label || null, r.help || null, JSON.stringify(r.options || []),
        Boolean(r.required), r.enabled !== false, Boolean(r.sensitive), r.sort_order ?? 0],
    );
  }
}

/** Every field of an event, in form order. Archived ones only when asked. */
async function listFields(eventId, { includeArchived = false, exec = db } = {}) {
  await ensureFields(eventId, exec);
  const r = await exec.query(
    `SELECT f.*, (SELECT COUNT(*)::int FROM registration_answers a WHERE a.field_id = f.id) AS answer_count
       FROM registration_fields f
      WHERE f.event_id = $1 ${includeArchived ? '' : 'AND f.archived_at IS NULL'}
      ORDER BY f.sort_order, f.id`,
    [eventId],
  );
  return r.rows;
}

/** What a registrant needs to draw one field. */
function publicField(row) {
  return {
    id: row.id,
    key: row.field_key,
    kind: row.kind,
    type: row.type,
    label: row.label,
    help: row.help,
    options: Array.isArray(row.options) ? row.options : [],
    required: row.required,
    ...(row.kind === 'standard' && STANDARD[row.field_key]?.min != null
      ? { min: STANDARD[row.field_key].min, max: STANDARD[row.field_key].max }
      : {}),
  };
}

// ── Organiser: replace the form ─────────────────────────────────────────────

function cleanOptions(raw, field, errors) {
  if (!Array.isArray(raw)) { errors.push({ field, message: 'Options must be a list.' }); return null; }
  const out = [];
  for (const o of raw) {
    const s = String(o ?? '').trim();
    if (!s) continue;
    if (s.length > 100) { errors.push({ field, message: 'Each option must be 100 characters or fewer.' }); return null; }
    if (!out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  if (out.length > 50) { errors.push({ field, message: 'At most 50 options.' }); return null; }
  return out;
}

/**
 * Save the whole form as sent: rows with an `id` are updated, rows without
 * one are added, rows left out are removed (archived when answered).
 * Standard rows are never removed, only switched off.
 *
 * @param {number} eventId
 * @param {Array<object>} items
 * @param {{ customAllowed: boolean }} opts customAllowed: the plan has 'forms'
 */
async function syncFields(eventId, items, { customAllowed }) {
  if (!Array.isArray(items)) throw httpError(400, 'items must be a list', 'VALIDATION_ERROR');
  const current = await listFields(eventId, { includeArchived: true });
  const byId = new Map(current.map((f) => [f.id, f]));
  const errors = [];
  const plan = [];
  let customCount = 0;

  items.forEach((it, i) => {
    const at = (k) => `items.${i}.${k}`;
    if (!it || typeof it !== 'object') { errors.push({ field: `items.${i}`, message: 'Must be an object.' }); return; }
    const id = it.id != null ? Number(it.id) : null;
    const row = id != null ? byId.get(id) : null;
    if (id != null && !row) { errors.push({ field: at('id'), message: 'Unknown field.' }); return; }

    const kind = row ? row.kind : (STANDARD[it.key] ? 'standard' : 'custom');
    const entry = {
      id: row ? row.id : null,
      cid: it.cid ?? null,
      kind,
      sort_order: i,
      required: Boolean(it.required),
      enabled: it.enabled !== false,
      sensitive: Boolean(it.sensitive),
      help: null,
      label: null,
    };
    const help = it.help == null ? '' : String(it.help).trim();
    if (help.length > 300) errors.push({ field: at('help'), message: 'Help text must be 300 characters or fewer.' });
    else entry.help = help || null;

    if (kind === 'standard') {
      const key = row ? row.field_key : it.key;
      const def = STANDARD[key];
      if (!def) { errors.push({ field: at('key'), message: 'Unknown standard field.' }); return; }
      Object.assign(entry, { field_key: key, type: def.type, options: def.options || [] });
      if (!entry.enabled) entry.required = false;
    } else {
      if (!customAllowed) {
        if (!row || row.archived_at) { errors.push({ field: at('type'), message: 'Your own questions are part of the Professional plan and above.', code: 'MODULE_DISABLED' }); return; }
      }
      customCount += 1;
      const type = String(it.type || row?.type || '').trim();
      if (!CUSTOM_FIELD_TYPES.includes(type)) { errors.push({ field: at('type'), message: `Type must be one of: ${CUSTOM_FIELD_TYPES.join(', ')}.` }); return; }
      const label = String(it.label ?? '').trim();
      if (!label) { errors.push({ field: at('label'), message: 'Write the question.' }); return; }
      if (label.length > 200) { errors.push({ field: at('label'), message: 'The question must be 200 characters or fewer.' }); return; }
      let options = [];
      if (type === 'select' || type === 'multiselect') {
        options = cleanOptions(it.options || [], at('options'), errors);
        if (options === null) return;
      }
      Object.assign(entry, {
        field_key: row ? row.field_key : `q_${crypto.randomBytes(4).toString('hex')}`,
        type,
        label,
        options,
      });
      // Changing what an answered question asks would make old answers lie.
      if (row && row.answer_count > 0 && row.type !== type) {
        errors.push({ field: at('type'), message: 'People already answered this question; its type can no longer change.' });
        return;
      }
    }
    plan.push(entry);
  });

  if (customCount > MAX_CUSTOM) errors.push({ field: 'items', message: `At most ${MAX_CUSTOM} questions of your own.` });
  if (errors.length) throw httpError(400, 'Some fields need attention.', 'VALIDATION_ERROR', { errors });

  const keep = new Set(plan.filter((p) => p.id).map((p) => p.id));
  const client = await db.pool.connect();
  const idsByCid = {};
  try {
    await client.query('BEGIN');
    for (const f of current) {
      if (keep.has(f.id) || f.kind === 'standard' || f.archived_at) continue;
      if (f.answer_count > 0) {
        await client.query('UPDATE registration_fields SET archived_at = now(), enabled = false WHERE id = $1', [f.id]);
      } else {
        await client.query('DELETE FROM registration_fields WHERE id = $1', [f.id]);
      }
    }
    // Standard rows the client did not send keep their row but go last.
    const sentStandard = new Set(plan.filter((p) => p.kind === 'standard').map((p) => p.field_key));
    let tail = plan.length;
    for (const f of current) {
      if (f.kind === 'standard' && !sentStandard.has(f.field_key)) {
        await client.query('UPDATE registration_fields SET sort_order = $2 WHERE id = $1', [f.id, tail]);
        tail += 1;
      }
    }
    for (const p of plan) {
      if (p.id) {
        await client.query(
          `UPDATE registration_fields
              SET label = $2, help = $3, options = $4::jsonb, required = $5, enabled = $6, sensitive = $7,
                  sort_order = $8, type = $9, archived_at = NULL
            WHERE id = $1`,
          [p.id, p.label, p.help, JSON.stringify(p.options), p.required, p.enabled, p.sensitive, p.sort_order, p.type],
        );
      } else {
        const r = await client.query(
          `INSERT INTO registration_fields
             (event_id, field_key, kind, type, label, help, options, required, enabled, sensitive, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
           ON CONFLICT (event_id, field_key) DO UPDATE SET
             label = EXCLUDED.label, help = EXCLUDED.help, options = EXCLUDED.options, required = EXCLUDED.required,
             enabled = EXCLUDED.enabled, sensitive = EXCLUDED.sensitive, sort_order = EXCLUDED.sort_order,
             archived_at = NULL
           RETURNING id`,
          [eventId, p.field_key, p.kind, p.type, p.label, p.help, JSON.stringify(p.options), p.required, p.enabled,
            p.sensitive, p.sort_order],
        );
        if (p.cid != null) idsByCid[p.cid] = r.rows[0].id;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  const rows = await listFields(eventId);
  return { items: rows, idsByCid };
}

// ── Registrant: check answers ───────────────────────────────────────────────

const norm = (s) => transliterate(String(s || '')).replace(/[^a-z0-9]+/g, ' ').trim();

function normaliseUrl(value, key) {
  let s = String(value || '').trim();
  if (!s) return null;
  if (key === 'github' && !/[./]/.test(s.replace(/^@/, ''))) s = `https://github.com/${s.replace(/^@/, '')}`;
  if (key === 'linkedin' && !/[./]/.test(s)) s = `https://www.linkedin.com/in/${s}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { return undefined; }
  if (!['http:', 'https:'].includes(u.protocol) || !u.hostname.includes('.')) return undefined;
  return u.toString().slice(0, 500);
}

/**
 * Check every answer against the form and the event's eligibility rules.
 *
 * @param {Array<object>} fields   enabled, non-archived rows
 * @param {object} answers         { [field_key]: value }
 * @param {object} eligibility     merged eligibility settings
 * @returns {{ values: Array<{ field: object, value: any, file?: object }>, profile: object, errors: Array }}
 */
function checkAnswers(fields, answers, eligibility) {
  const src = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
  const errors = [];
  const values = [];
  const profile = {};
  const byKey = {};

  for (const f of fields) {
    if (!f.enabled || f.archived_at) continue;
    const field = `answers.${f.field_key}`;
    const raw = src[f.field_key];
    const empty = raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0)
      || (f.type === 'checkbox' && raw !== true);
    if (empty) {
      if (f.required) errors.push({ field, message: f.type === 'checkbox' ? 'Please confirm.' : 'This field is required.' });
      continue;
    }
    const def = f.kind === 'standard' ? STANDARD[f.field_key] : null;
    let value;
    switch (f.type) {
      case 'text':
      case 'textarea': {
        const s = String(raw).trim();
        const max = f.type === 'textarea' ? 5000 : 500;
        if (s.length > max) { errors.push({ field, message: `At most ${max} characters.` }); continue; }
        value = s;
        break;
      }
      case 'number': {
        const n = Number(raw);
        const min = def?.min ?? -1e9;
        const max = def?.max ?? 1e9;
        if (!Number.isFinite(n) || n < min || n > max || (def && !Number.isInteger(n))) {
          errors.push({ field, message: `Enter a number from ${min} to ${max}.` }); continue;
        }
        value = n;
        break;
      }
      case 'phone': {
        const s = String(raw).trim();
        const digits = s.replace(/\D/g, '');
        if (!/^\+?[0-9 ()-]{7,24}$/.test(s) || digits.length < 7 || digits.length > 15) {
          errors.push({ field, message: 'Enter a phone number with its country code, e.g. +994 50 123 45 67.' }); continue;
        }
        value = `${s.startsWith('+') ? '+' : ''}${digits}`;
        break;
      }
      case 'email': {
        const s = String(raw).trim().toLowerCase();
        if (!EMAIL_RE.test(s) || s.length > 255) { errors.push({ field, message: 'Not a valid e-mail address.' }); continue; }
        value = s;
        break;
      }
      case 'url': {
        const u = normaliseUrl(raw, f.field_key);
        if (u === undefined) { errors.push({ field, message: 'Not a valid link.' }); continue; }
        value = u;
        break;
      }
      case 'select': {
        const opts = Array.isArray(f.options) ? f.options : [];
        const s = String(raw);
        if (!opts.includes(s)) { errors.push({ field, message: 'Choose one of the options.' }); continue; }
        value = s;
        break;
      }
      case 'multiselect': {
        const opts = Array.isArray(f.options) ? f.options : [];
        const list = Array.isArray(raw) ? raw.map(String) : [];
        if (!list.length || list.some((x) => !opts.includes(x))) { errors.push({ field, message: 'Choose from the options.' }); continue; }
        value = [...new Set(list)];
        break;
      }
      case 'checkbox':
        value = true;
        break;
      case 'date': {
        const s = String(raw).trim();
        const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null;
        if (!d || Number.isNaN(d.getTime())) { errors.push({ field, message: 'Enter a date.' }); continue; }
        value = s;
        break;
      }
      case 'country': {
        const s = String(raw).trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(s)) { errors.push({ field, message: 'Choose a country.' }); continue; }
        value = s;
        break;
      }
      case 'university': {
        const name = typeof raw === 'object' ? raw.name : raw;
        const s = String(name || '').trim();
        if (!s || s.length > 200) { errors.push({ field, message: 'Choose or type your university.' }); continue; }
        value = s;
        break;
      }
      case 'skills': {
        const list = (Array.isArray(raw) ? raw : String(raw).split(','))
          .map((x) => String(x).trim()).filter(Boolean);
        if (list.length > 30 || list.some((x) => x.length > 40)) { errors.push({ field, message: 'At most 30 skills, 40 characters each.' }); continue; }
        if (!list.length) { if (f.required) errors.push({ field, message: 'This field is required.' }); continue; }
        value = [...new Set(list)];
        break;
      }
      case 'file': {
        if (!raw || typeof raw !== 'object' || !raw.fileId || !raw.claimToken) {
          errors.push({ field, message: 'Upload the file again.' }); continue;
        }
        value = { fileId: String(raw.fileId), claimToken: String(raw.claimToken) };
        break;
      }
      default:
        continue;
    }
    values.push({ field: f, value });
    byKey[f.field_key] = value;
    if (def?.profile) {
      profile[def.profile] = def.type === 'skills' ? JSON.stringify(value) : value;
    }
  }

  // Eligibility, judged on the answers just checked.
  const e = eligibility || {};
  if (e.minAge != null || e.maxAge != null) {
    const age = byKey.age;
    if (age == null) errors.push({ field: 'answers.age', message: 'This field is required.' });
    else if ((e.minAge != null && age < e.minAge) || (e.maxAge != null && age > e.maxAge)) {
      const range = e.minAge != null && e.maxAge != null ? `${e.minAge}–${e.maxAge}` : e.minAge != null ? `${e.minAge}+` : `up to ${e.maxAge}`;
      errors.push({ field: 'answers.age', message: `This event is for participants aged ${range}.`, code: 'NOT_ELIGIBLE' });
    }
  }
  if (Array.isArray(e.countries) && e.countries.length) {
    const c = byKey.country;
    if (!c) errors.push({ field: 'answers.country', message: 'This field is required.' });
    else if (!e.countries.includes(c)) errors.push({ field: 'answers.country', message: 'This event is not open to participants from your country.', code: 'NOT_ELIGIBLE' });
  }
  if (Array.isArray(e.cities) && e.cities.length && byKey.city !== undefined) {
    const allowed = e.cities.map(norm);
    if (!allowed.includes(norm(byKey.city))) {
      errors.push({ field: 'answers.city', message: `This event is open to participants from: ${e.cities.join(', ')}.`, code: 'NOT_ELIGIBLE' });
    }
  }
  if (e.studentsOnly && !byKey.university) {
    errors.push({ field: 'answers.university', message: 'This event is for students; tell us your university.', code: 'NOT_ELIGIBLE' });
  }
  return { values, profile, errors };
}

/** Write checked answers for a participant (claims uploaded files). */
async function saveAnswers(client, { participantId, eventId, userId, values }) {
  for (const { field, value } of values) {
    let stored = value;
    let fileId = null;
    if (field.type === 'file') {
      fileId = await fileService.claimForRegistration(client, {
        fileId: value.fileId, claimToken: value.claimToken, eventId, userId,
      });
      const meta = await client.query('SELECT filename FROM files WHERE id = $1', [fileId]);
      stored = { fileId, name: meta.rows[0]?.filename || 'file' };
    }
    await client.query(
      `INSERT INTO registration_answers (participant_id, event_id, field_id, value, file_id)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (participant_id, field_id) DO UPDATE SET value = EXCLUDED.value, file_id = EXCLUDED.file_id, updated_at = now()`,
      [participantId, eventId, field.id, JSON.stringify(stored), fileId],
    );
  }
}

/** Answers of the participants of an event, keyed by participant id. */
async function answersForEvent(eventId, { hideSensitive = false } = {}) {
  const r = await db.query(
    `SELECT a.participant_id, f.field_key, f.kind, f.type, f.label, f.sensitive, a.value, a.file_id
       FROM registration_answers a
       JOIN registration_fields f ON f.id = a.field_id
      WHERE a.event_id = $1
      ORDER BY f.sort_order, f.id`,
    [eventId],
  );
  const out = {};
  for (const row of r.rows) {
    if (hideSensitive && row.sensitive) continue;
    (out[row.participant_id] ||= {})[row.field_key] = row.value;
  }
  return out;
}

module.exports = {
  ensureFields,
  insertFields,
  listFields,
  publicField,
  syncFields,
  checkAnswers,
  saveAnswers,
  answersForEvent,
};
