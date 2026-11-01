/**
 * @file webhook.service.js
 * @description Outgoing webhooks: an organisation's endpoints, and the
 * signed deliveries of what happened in its events (plan module `webhooks`).
 *
 * How a delivery comes about:
 *   1. A participant registers (or is approved, a team forms, …). A trigger
 *      writes a row to webhook_outbox in the same transaction — only when
 *      the organisation has an active endpoint for that kind (0028).
 *   2. On each worker pass `processOutbox` turns new rows into one delivery
 *      per subscribed endpoint, with the payload built then, and queues a
 *      `webhook.deliver` job for each.
 *   3. `attempt` posts the JSON, signed, with a 10 s limit. 2xx is
 *      delivered. Anything else is tried again after 1 min, 5 min, 30 min,
 *      2 h and 12 h (six attempts); then the delivery has failed.
 *   4. An endpoint whose deliveries fail every attempt five times in a row is
 *      switched off, and the organisation's owner and admins are told in the
 *      notification centre. A test ping and a manual redelivery are tried
 *      once and never count toward that.
 *
 * Signature: X-HackOS-Signature = "sha256=" + hex(HMAC-SHA256(secret,
 * `${X-HackOS-Timestamp}.${raw body}`)). The secret is shown once, when the
 * endpoint is created or its secret rotated; the URL and the secret are kept
 * sealed (secretBox). Where a webhook may go: webhookUrl.js.
 */

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const net = require('net');
const db = require('../config/db');
const jobs = require('./jobs.service');
const secretBox = require('../utils/secretBox');
const notifications = require('./notification.service');
const { summaryForCustomer } = require('./entitlement.service');
const { parseTargetUrl, resolveTarget, safeLookup, allowPrivateTargets } = require('./webhookUrl');
const { resolveFrontendBaseUrl } = require('../utils/frontendUrl');
const { httpError } = require('../utils/responseFormat');
const { isOwnerUser } = require('../utils/authz');

/** What an endpoint can ask to hear about. '*' means all of them. */
const EVENT_TYPES = Object.freeze([
  'registration.created',
  'participant.approved',
  'participant.rejected',
  'team.created',
  'submission.created',
  'results.published',
  'certificate.issued',
  'event.published',
]);

const MAX_ENDPOINTS = 10;
const MAX_ATTEMPTS = 6;
/** Seconds before attempt 2, 3, 4, 5 and 6. */
const RETRY_DELAYS = Object.freeze([60, 5 * 60, 30 * 60, 2 * 3600, 12 * 3600]);
/** Deliveries in a row that failed every attempt before an endpoint is switched off. */
const DISABLE_AFTER = 5;
const TIMEOUT_MS = 10_000;
const KEEP_DAYS = 30;
const ADMIN_ROLES = ['owner', 'admin'];
const MODULE = 'webhooks';
const USER_AGENT = 'HackOS-Webhooks/1.0 (+https://www.hack-os.app)';
/** The most certificates one certificate.issued delivery lists. */
const CERTIFICATES_PER_DELIVERY = 200;
/** Attempts under way at once in one API process, and how long the job queue waits for one. */
const MAX_IN_FLIGHT = 8;
const HANDOFF_MS = 2000;
/** An attempt holds its delivery this long at most (it takes TIMEOUT_MS and a few queries). */
const LOCK_MINUTES = 2;

const clip = (v, n) => (v == null ? null : String(v).slice(0, n));
const toInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** `fn(client)` inside one transaction. */
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

// ── Signing ─────────────────────────────────────────────────────────────────

function newSecret() {
  return `whsec_${crypto.randomBytes(24).toString('base64url')}`;
}

/** "sha256=<hex>" over `${timestamp}.${body}` — what receivers recompute. */
function sign(secret, timestamp, body) {
  return `sha256=${crypto.createHmac('sha256', String(secret)).update(`${timestamp}.${body}`).digest('hex')}`;
}

// ── Who may manage an organisation's webhooks ───────────────────────────────

/**
 * The organisation the request acts on, after checking the person is its
 * owner or an administrator. The platform owner names any organisation with
 * customerId. A member with several organisations picks one with customerId;
 * without it, their primary one.
 */
async function organisationFor(user, requestedId = null) {
  const asked = requestedId == null || String(requestedId).trim() === '' ? null : Number(requestedId);
  if (asked != null && !(Number.isInteger(asked) && asked > 0)) {
    throw httpError(400, 'customerId must be a number', 'VALIDATION_ERROR');
  }
  if (isOwnerUser(user) && asked != null) {
    const c = (await db.query('SELECT id, name FROM customers WHERE id = $1', [asked])).rows[0];
    if (!c) throw httpError(404, 'Organisation not found', 'NOT_FOUND');
    return { id: c.id, name: c.name };
  }
  const rows = await managedOrganisations(user);
  const pick = asked != null ? rows.find((r) => r.id === asked) : rows[0];
  if (!pick) {
    if (isOwnerUser(user)) throw httpError(400, 'Choose the organisation (customerId).', 'VALIDATION_ERROR');
    throw httpError(403, 'Only the owner or an administrator of an organisation manages its webhooks.', 'NOT_ORG_ADMIN');
  }
  return { id: pick.id, name: pick.name };
}

async function moduleOn(customerId) {
  const summary = await summaryForCustomer(customerId);
  return Boolean(summary && summary.modules.includes(MODULE));
}

async function requireModule(customerId) {
  if (!(await moduleOn(customerId))) {
    throw httpError(403, 'Webhooks are not part of your organisation\'s plan.', 'MODULE_DISABLED', { module: MODULE });
  }
}

// ── Endpoints ───────────────────────────────────────────────────────────────

function presentEndpoint(row) {
  return {
    id: row.id,
    url: secretBox.open(row.url),
    urlHost: row.url_host,
    description: row.description,
    events: row.events,
    active: row.active,
    disabledReason: row.disabled_reason,
    disabledAt: row.disabled_at,
    consecutiveFailures: row.consecutive_failures,
    lastDeliveryAt: row.last_delivery_at,
    lastDeliveryStatus: row.last_delivery_status,
    secretRotatedAt: row.secret_rotated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** A 400 naming the field, with a `code` the app shows in the reader's language. */
function validationError(field, message, code, extra = {}) {
  return httpError(400, message, 'VALIDATION_ERROR', { errors: [{ field, message, code, ...extra }] });
}

/**
 * The URL, checked in form and where it points (DNS). Returns { url, host }.
 * Refusals carry URL_<REASON> (webhookUrl.js lists the reasons).
 */
async function checkedUrl(raw) {
  const allowPrivate = allowPrivateTargets();
  const parsed = parseTargetUrl(raw, { allowPrivate });
  if (parsed.error) throw validationError('url', parsed.error, `URL_${parsed.reason.toUpperCase()}`);
  try {
    await resolveTarget(parsed.url.hostname, { allowPrivate });
  } catch (err) {
    throw validationError('url', err.message, `URL_${String(err.reason || 'invalid').toUpperCase()}`);
  }
  return { url: parsed.url.toString(), host: parsed.url.host.slice(0, 255) };
}

function checkedEvents(raw) {
  if (!Array.isArray(raw)) throw validationError('events', 'Choose the things this endpoint should receive.', 'EVENTS_REQUIRED');
  const list = [...new Set(raw.map((v) => String(v).trim()))];
  if (!list.length) throw validationError('events', 'Choose at least one thing this endpoint should receive.', 'EVENTS_REQUIRED');
  if (list.includes('*')) return ['*'];
  const unknown = list.filter((v) => !EVENT_TYPES.includes(v));
  if (unknown.length) throw validationError('events', `Unknown event type: ${unknown.join(', ')}`, 'EVENTS_UNKNOWN');
  return list.sort((a, b) => EVENT_TYPES.indexOf(a) - EVENT_TYPES.indexOf(b));
}

function checkedDescription(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s.length > 200) throw validationError('description', 'At most 200 characters.', 'TOO_LONG', { max: 200 });
  return s || null;
}

async function endpointRow(customerId, endpointId) {
  const id = toInt(endpointId);
  if (!id) throw httpError(404, 'Webhook endpoint not found', 'NOT_FOUND');
  const row = (await db.query(
    'SELECT * FROM webhook_endpoints WHERE id = $1 AND customer_id = $2',
    [id, customerId],
  )).rows[0];
  if (!row) throw httpError(404, 'Webhook endpoint not found', 'NOT_FOUND');
  return row;
}

/** The organisations this person manages webhooks for (owner or administrator), primary first. */
async function managedOrganisations(user) {
  return (await db.query(
    `SELECT c.id, c.name
       FROM customer_contacts cc
       JOIN customers c ON c.id = cc.customer_id
      WHERE cc.user_id = $1 AND c.archived_at IS NULL AND cc.member_role = ANY($2::text[])
      ORDER BY cc.is_primary DESC, cc.id ASC`,
    [user.id, ADMIN_ROLES],
  )).rows.map((r) => ({ id: r.id, name: r.name }));
}

/**
 * GET: the organisation's endpoints, whether its plan has webhooks, the
 * kinds on offer, and the other organisations this person could pick.
 */
async function list(user, requestedId) {
  const org = await organisationFor(user, requestedId);
  const rows = (await db.query(
    'SELECT * FROM webhook_endpoints WHERE customer_id = $1 ORDER BY created_at ASC, id ASC',
    [org.id],
  )).rows;
  return {
    organisation: org,
    organisations: await managedOrganisations(user),
    enabled: await moduleOn(org.id),
    eventTypes: EVENT_TYPES,
    maxEndpoints: MAX_ENDPOINTS,
    endpoints: rows.map(presentEndpoint),
  };
}

async function create(user, requestedId, body = {}) {
  const org = await organisationFor(user, requestedId);
  await requireModule(org.id);
  const { url, host } = await checkedUrl(body.url);
  const events = checkedEvents(body.events);
  const description = checkedDescription(body.description);
  const count = (await db.query('SELECT COUNT(*)::int AS n FROM webhook_endpoints WHERE customer_id = $1', [org.id])).rows[0].n;
  if (count >= MAX_ENDPOINTS) {
    throw httpError(409, `An organisation can have at most ${MAX_ENDPOINTS} webhook endpoints.`, 'TOO_MANY_ENDPOINTS');
  }
  const secret = newSecret();
  const row = (await db.query(
    `INSERT INTO webhook_endpoints (customer_id, url, url_host, description, events, secret, created_by)
     VALUES ($1, $2, $3, $4, $5::text[], $6, $7)
     RETURNING *`,
    [org.id, secretBox.seal(url), host, description, events, secretBox.seal(secret), user.id],
  )).rows[0];
  return { organisation: org, endpoint: presentEndpoint(row), secret };
}

/** PATCH: changes only what differs from what is stored; `changed` names those fields. */
async function update(user, requestedId, endpointId, body = {}) {
  const org = await organisationFor(user, requestedId);
  await requireModule(org.id);
  const row = await endpointRow(org.id, endpointId);
  const sets = [];
  const params = [row.id];
  const changed = [];
  const set = (sql, value) => { params.push(value); sets.push(sql.replace('?', `$${params.length}`)); };
  if (body.url !== undefined) {
    const { url, host } = await checkedUrl(body.url);
    if (url !== secretBox.open(row.url)) {
      set('url = ?', secretBox.seal(url));
      set('url_host = ?', host);
      changed.push('url');
    }
  }
  if (body.events !== undefined) {
    const events = checkedEvents(body.events);
    if (events.join(',') !== [...row.events].join(',')) {
      set('events = ?::text[]', events);
      changed.push('events');
    }
  }
  if (body.description !== undefined) {
    const description = checkedDescription(body.description);
    if (description !== row.description) {
      set('description = ?', description);
      changed.push('description');
    }
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') throw validationError('active', 'Must be true or false.', 'INVALID');
    if (body.active !== row.active) {
      set('active = ?', body.active);
      // Switched back on: a fresh start. Switched off by hand: say so.
      if (body.active) sets.push('consecutive_failures = 0', 'disabled_reason = NULL', 'disabled_at = NULL');
      else sets.push("disabled_reason = 'manual'", 'disabled_at = now()');
      changed.push('active');
    }
  }
  if (!sets.length) return { organisation: org, endpoint: presentEndpoint(row), changed };
  sets.push('updated_at = now()');
  const out = (await db.query(`UPDATE webhook_endpoints SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params)).rows[0];
  return { organisation: org, endpoint: presentEndpoint(out), changed };
}

async function remove(user, requestedId, endpointId) {
  const org = await organisationFor(user, requestedId);
  const row = await endpointRow(org.id, endpointId);
  await db.query('DELETE FROM webhook_endpoints WHERE id = $1', [row.id]);
  return { organisation: org, id: row.id, urlHost: row.url_host };
}

async function rotateSecret(user, requestedId, endpointId) {
  const org = await organisationFor(user, requestedId);
  await requireModule(org.id);
  const row = await endpointRow(org.id, endpointId);
  const secret = newSecret();
  const out = (await db.query(
    `UPDATE webhook_endpoints SET secret = $2, secret_rotated_at = now(), updated_at = now()
      WHERE id = $1 RETURNING *`,
    [row.id, secretBox.seal(secret)],
  )).rows[0];
  return { organisation: org, endpoint: presentEndpoint(out), secret };
}

// ── Deliveries ──────────────────────────────────────────────────────────────

function presentDelivery(row) {
  return {
    id: Number(row.id),
    deliveryId: row.uid,
    endpointId: row.endpoint_id,
    eventId: row.event_id,
    type: row.type,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastStatusCode: row.last_status_code,
    lastError: row.last_error,
    lastResponse: row.last_response,
    lastDurationMs: row.last_duration_ms,
    nextAttemptAt: row.status === 'pending' ? row.next_attempt_at : null,
    redeliveryOf: row.redelivery_of != null ? Number(row.redelivery_of) : null,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
    payload: row.payload,
  };
}

async function queueAttempt(exec, deliveryId, runAt, attemptNo, suffix = '') {
  return jobs.enqueue('webhook.deliver', { deliveryId: Number(deliveryId), attempt: attemptNo }, {
    runAt, maxAttempts: 1, exec, dedupeKey: `webhook:${deliveryId}:${attemptNo}${suffix}`,
  });
}

async function insertDelivery(exec, { endpointId, customerId, eventId, type, payload, maxAttempts = MAX_ATTEMPTS, redeliveryOf = null }) {
  const row = (await exec.query(
    `INSERT INTO webhook_deliveries (endpoint_id, customer_id, event_id, type, payload, max_attempts, next_attempt_at, redelivery_of)
     VALUES ($1, $2, $3, $4, $5::json, $6, now(), $7)
     RETURNING *`,
    [endpointId, customerId, eventId, type, JSON.stringify(payload), maxAttempts, redeliveryOf],
  )).rows[0];
  await queueAttempt(exec, row.id, null, 1);
  return row;
}

/** POST …/:id/test — a `ping` for this endpoint, tried once. */
async function sendTest(user, requestedId, endpointId) {
  const org = await organisationFor(user, requestedId);
  await requireModule(org.id);
  const row = await endpointRow(org.id, endpointId);
  const payload = {
    id: crypto.randomUUID(),
    type: 'ping',
    created_at: new Date().toISOString(),
    organisation_id: org.id,
    event: null,
    data: { message: 'A test from HackOS: this endpoint is set up.', endpoint_id: row.id },
  };
  const out = await inTransaction((client) => insertDelivery(client, {
    endpointId: row.id, customerId: org.id, eventId: null, type: 'ping', payload, maxAttempts: 1,
  }));
  return { organisation: org, delivery: presentDelivery(out) };
}

/** GET …/:id/deliveries?limit=&before= — newest first. */
async function listDeliveries(user, requestedId, endpointId, { limit = 20, before = null } = {}) {
  const org = await organisationFor(user, requestedId);
  const row = await endpointRow(org.id, endpointId);
  const n = Math.min(Math.max(Number.parseInt(String(limit), 10) || 20, 1), 50);
  const params = [row.id];
  let where = 'endpoint_id = $1';
  const beforeId = toInt(before);
  if (beforeId) {
    params.push(beforeId);
    where += ` AND id < $${params.length}`;
  }
  params.push(n + 1);
  const rows = (await db.query(
    `SELECT * FROM webhook_deliveries WHERE ${where} ORDER BY id DESC LIMIT $${params.length}`,
    params,
  )).rows;
  const page = rows.slice(0, n);
  return {
    items: page.map(presentDelivery),
    nextBefore: rows.length > n ? Number(page[page.length - 1].id) : null,
  };
}

/** POST …/:id/deliveries/:deliveryId/redeliver — the same payload again, tried once. */
async function redeliver(user, requestedId, endpointId, deliveryId) {
  const org = await organisationFor(user, requestedId);
  await requireModule(org.id);
  const endpoint = await endpointRow(org.id, endpointId);
  const id = toInt(deliveryId);
  const original = id
    ? (await db.query('SELECT * FROM webhook_deliveries WHERE id = $1 AND endpoint_id = $2', [id, endpoint.id])).rows[0]
    : null;
  if (!original) throw httpError(404, 'Delivery not found', 'NOT_FOUND');
  if (original.status === 'pending') {
    throw httpError(409, 'This delivery is still being tried.', 'DELIVERY_PENDING');
  }
  const out = await inTransaction((client) => insertDelivery(client, {
    endpointId: endpoint.id,
    customerId: org.id,
    eventId: original.event_id,
    type: original.type,
    payload: original.payload,
    maxAttempts: 1,
    redeliveryOf: original.id,
  }));
  return { organisation: org, delivery: presentDelivery(out) };
}

// ── Building payloads from the outbox ───────────────────────────────────────

const iso = (v) => (v ? new Date(v).toISOString() : null);

async function participantData(exec, data) {
  const r = (await exec.query(
    `SELECT p.id, p.registered_at, p.team_id, u.id AS user_id, u.full_name, u.email, t.name AS team_name
       FROM participants p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN teams t ON t.id = p.team_id
      WHERE p.id = $1`,
    [data.participant_id],
  )).rows[0];
  return {
    participant: {
      id: data.participant_id,
      // The status when it happened, not whatever it became since.
      status: data.status || null,
      registered_at: r ? iso(r.registered_at) : null,
      user: r ? { id: r.user_id, name: r.full_name, email: r.email } : { id: data.user_id ?? null },
      team: r && r.team_id ? { id: r.team_id, name: r.team_name } : null,
    },
    ...(data.previous_status ? { previous_status: data.previous_status } : {}),
  };
}

async function teamData(exec, data) {
  const r = (await exec.query(
    `SELECT t.id, t.name, t.created_at, t.track_id, tr.name AS track_name, t.leader_id, u.full_name AS leader_name,
            (SELECT COUNT(*)::int FROM team_members tm WHERE tm.team_id = t.id) AS members
       FROM teams t
       LEFT JOIN tracks tr ON tr.id = t.track_id
       LEFT JOIN users u ON u.id = t.leader_id
      WHERE t.id = $1`,
    [data.team_id],
  )).rows[0];
  if (!r) return { team: { id: data.team_id } };
  return {
    team: {
      id: r.id,
      name: r.name,
      created_at: iso(r.created_at),
      track: r.track_id ? { id: r.track_id, name: r.track_name } : null,
      leader: r.leader_id ? { id: r.leader_id, name: r.leader_name } : null,
      members: r.members,
    },
  };
}

async function submissionData(exec, data) {
  const r = (await exec.query(
    `SELECT s.id, s.project_name, s.description, s.repo_link, s.demo_link, s.presentation_link, s.video_link,
            s.tech_stack, s.submitted_at, s.team_id, t.name AS team_name
       FROM submissions s
       LEFT JOIN teams t ON t.id = s.team_id
      WHERE s.id = $1`,
    [data.submission_id],
  )).rows[0];
  if (!r) return { submission: { id: data.submission_id }, team: data.team_id ? { id: data.team_id } : null };
  return {
    submission: {
      id: r.id,
      project_name: r.project_name,
      description: clip(r.description, 4000),
      repo_url: r.repo_link || null,
      demo_url: r.demo_link || null,
      presentation_url: r.presentation_link || null,
      video_url: r.video_link || null,
      tech_stack: r.tech_stack || null,
      submitted_at: iso(r.submitted_at),
    },
    team: r.team_id ? { id: r.team_id, name: r.team_name } : null,
  };
}

async function resultsData(exec, eventRow, data) {
  // eslint-disable-next-line global-require
  const cfg = require('./judging.service').config(eventRow);
  const showScores = Boolean(cfg.showScores);
  const rows = (await exec.query(
    `SELECT er.place, er.score, er.team_id, t.name AS team_name, s.project_name,
            COALESCE(s.track_id, t.track_id) AS track_id, tr.name AS track_name
       FROM event_results er
       JOIN teams t ON t.id = er.team_id
       LEFT JOIN submissions s ON s.id = er.submission_id
       LEFT JOIN tracks tr ON tr.id = COALESCE(s.track_id, t.track_id)
      WHERE er.event_id = $1
      ORDER BY er.place ASC, er.score DESC NULLS LAST, er.team_id ASC
      LIMIT 500`,
    [eventRow.id],
  )).rows;
  return {
    first: Boolean(data.first),
    published_at: iso(eventRow.results_published_at),
    visibility: cfg.resultsVisibility || null,
    show_scores: showScores,
    results: rows.map((r) => ({
      place: Number(r.place),
      team: { id: r.team_id, name: r.team_name },
      project_name: r.project_name || null,
      track: r.track_id ? { id: r.track_id, name: r.track_name } : null,
      ...(showScores ? { score: r.score == null ? null : Number(r.score) } : {}),
    })),
  };
}

async function certificatesData(exec, ids) {
  const rows = (await exec.query(
    `SELECT c.id, c.code, c.kind, c.title, c.place, c.user_id, c.recipient_name, c.team_id, c.issued_at,
            t.name AS team_name
       FROM certificates c
       LEFT JOIN teams t ON t.id = c.team_id
      WHERE c.id = ANY($1::int[])
      ORDER BY c.id ASC`,
    [ids],
  )).rows;
  // eslint-disable-next-line global-require
  const { verifyUrl } = require('./certificate.service');
  return {
    certificates: rows.map((c) => ({
      id: c.id,
      code: c.code,
      kind: c.kind,
      title: c.title,
      place: c.place,
      recipient: { user_id: c.user_id, name: c.recipient_name },
      team: c.team_id ? { id: c.team_id, name: c.team_name } : null,
      issued_at: iso(c.issued_at),
      verify_url: verifyUrl(c.code),
    })),
  };
}

function eventData(eventRow) {
  const base = resolveFrontendBaseUrl().replace(/\/+$/, '');
  return {
    event: {
      id: eventRow.id,
      slug: eventRow.slug,
      name: eventRow.name,
      tagline: eventRow.tagline || null,
      start_date: iso(eventRow.start_date),
      end_date: iso(eventRow.end_date),
      timezone: eventRow.timezone || null,
      format: eventRow.format || null,
      city: eventRow.city || null,
      country: eventRow.country ? String(eventRow.country).trim() : null,
      public_url: eventRow.slug ? `${base}/e/${encodeURIComponent(eventRow.slug)}` : null,
    },
  };
}

async function buildData(exec, type, eventRow, rows) {
  const data = rows[0].data || {};
  switch (type) {
    case 'registration.created':
    case 'participant.approved':
    case 'participant.rejected':
      return participantData(exec, data);
    case 'team.created':
      return teamData(exec, data);
    case 'submission.created':
      return submissionData(exec, data);
    case 'results.published':
      return resultsData(exec, eventRow, data);
    case 'certificate.issued':
      return certificatesData(exec, rows.map((r) => Number(r.data.certificate_id)).filter(Boolean));
    case 'event.published':
      return eventData(eventRow);
    default:
      return {};
  }
}

/**
 * Turn new outbox rows into deliveries (a planner, on each worker pass).
 * Certificates of one event issued together become one delivery (up to
 * CERTIFICATES_PER_DELIVERY each). Returns how many outbox rows were read
 * and how many deliveries queued.
 */
async function processOutbox({ limit = 200 } = {}) {
  return inTransaction(async (client) => {
    const rows = (await client.query(
      `SELECT * FROM webhook_outbox WHERE processed_at IS NULL ORDER BY id ASC LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    )).rows;
    if (!rows.length) return { processed: 0, queued: 0 };

    // Group: one group per row, except certificates of the same event.
    const groups = [];
    const certGroups = new Map();
    for (const row of rows) {
      if (row.type === 'certificate.issued') {
        const key = `${row.customer_id}:${row.event_id}`;
        let g = certGroups.get(key);
        if (!g || g.rows.length >= CERTIFICATES_PER_DELIVERY) {
          g = { type: row.type, customerId: row.customer_id, eventId: row.event_id, rows: [] };
          certGroups.set(key, g);
          groups.push(g);
        }
        g.rows.push(row);
      } else {
        groups.push({ type: row.type, customerId: row.customer_id, eventId: row.event_id, rows: [row] });
      }
    }

    let queued = 0;
    const failed = new Map();
    const moduleCache = new Map();
    const endpointCache = new Map();
    const eventCache = new Map();
    for (const g of groups) {
      if (!moduleCache.has(g.customerId)) moduleCache.set(g.customerId, await moduleOn(g.customerId));
      if (!moduleCache.get(g.customerId)) continue;
      if (!endpointCache.has(g.customerId)) {
        endpointCache.set(g.customerId, (await client.query(
          'SELECT id, events FROM webhook_endpoints WHERE customer_id = $1 AND active',
          [g.customerId],
        )).rows);
      }
      const targets = endpointCache.get(g.customerId)
        .filter((e) => e.events.includes('*') || e.events.includes(g.type));
      if (!targets.length) continue;
      if (g.eventId != null && !eventCache.has(g.eventId)) {
        eventCache.set(g.eventId, (await client.query('SELECT * FROM events WHERE id = $1', [g.eventId])).rows[0] || null);
      }
      const eventRow = g.eventId != null ? eventCache.get(g.eventId) : null;
      if (!eventRow) continue;
      const first = g.rows[0];
      // One row that cannot be built is set aside; the others still go.
      await client.query('SAVEPOINT webhook_group');
      try {
        const payload = {
          id: first.uid,
          type: g.type,
          created_at: iso(first.created_at),
          organisation_id: g.customerId,
          event: { id: eventRow.id, slug: eventRow.slug, name: eventRow.name },
          data: await buildData(client, g.type, eventRow, g.rows),
        };
        for (const t of targets) {
          await insertDelivery(client, {
            endpointId: t.id, customerId: g.customerId, eventId: eventRow.id, type: g.type, payload,
          });
        }
        await client.query('RELEASE SAVEPOINT webhook_group');
        queued += targets.length;
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT webhook_group');
        console.error(`[webhooks] ${g.type} of event ${g.eventId} set aside:`, err.message);
        for (const r of g.rows) failed.set(String(r.id), clip(err.message, 500));
      }
    }

    await client.query(
      'UPDATE webhook_outbox SET processed_at = now() WHERE id = ANY($1::bigint[])',
      [rows.map((r) => r.id).filter((id) => !failed.has(String(id)))],
    );
    for (const [id, message] of failed) {
      await client.query('UPDATE webhook_outbox SET processed_at = now(), error = $2 WHERE id = $1', [id, message]);
    }
    return { processed: rows.length, queued };
  });
}

// ── Sending ─────────────────────────────────────────────────────────────────

/**
 * One POST, never following redirects, refusing addresses that are not
 * allowed (checked when connecting). Resolves with what happened; never rejects.
 */
function post(urlString, body, headers, { timeoutMs = TIMEOUT_MS } = {}) {
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const done = (out) => {
      if (settled) return;
      settled = true;
      resolve({ ...out, ms: Date.now() - started });
    };
    let url;
    try {
      url = new URL(urlString);
    } catch {
      done({ error: 'The endpoint URL is not valid.' });
      return;
    }
    const allowPrivate = allowPrivateTargets();
    const checked = parseTargetUrl(url.toString(), { allowPrivate });
    if (checked.error) {
      done({ error: checked.error });
      return;
    }
    const send = () => {
      const mod = url.protocol === 'https:' ? https : http;
      const req = mod.request(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        lookup: safeLookup({ allowPrivate }),
        agent: false,
      }, (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          if (size < 2048) chunks.push(chunk);
          size += chunk.length;
          if (size > 64 * 1024) res.destroy();
        });
        const finish = () => done({ status: res.statusCode, response: Buffer.concat(chunks).toString('utf8').slice(0, 1000) });
        res.on('end', finish);
        res.on('close', finish);
        res.on('error', finish);
      });
      const timer = setTimeout(() => req.destroy(new Error(`No answer within ${Math.round(timeoutMs / 1000)} s.`)), timeoutMs);
      req.on('close', () => clearTimeout(timer));
      req.on('error', (err) => {
        clearTimeout(timer);
        done({ error: err && err.message ? err.message : String(err) });
      });
      req.end(body);
    };
    // A host written as an address is not looked up, so it is checked here.
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host)) {
      resolveTarget(host, { allowPrivate }).then(send, (err) => done({ error: err.message }));
    } else {
      send();
    }
  });
}

async function adminUserIds(customerId) {
  return (await db.query(
    `SELECT DISTINCT user_id FROM customer_contacts
      WHERE customer_id = $1 AND user_id IS NOT NULL AND member_role = ANY($2::text[])`,
    [customerId, ADMIN_ROLES],
  )).rows.map((r) => r.user_id);
}

/** The endpoint after a delivery finally failed: counted, and switched off at the limit. */
async function countFailure(endpoint) {
  // `before` is the row as it was, so exactly one failure is the one that switched it off.
  const r = (await db.query(
    `WITH before AS (SELECT id, active FROM webhook_endpoints WHERE id = $1 FOR UPDATE)
     UPDATE webhook_endpoints w
        SET consecutive_failures = w.consecutive_failures + 1,
            last_delivery_at = now(), last_delivery_status = 'failed', updated_at = now(),
            active = CASE WHEN w.active AND w.consecutive_failures + 1 >= $2 THEN false ELSE w.active END,
            disabled_reason = CASE WHEN w.active AND w.consecutive_failures + 1 >= $2 THEN 'failing' ELSE w.disabled_reason END,
            disabled_at = CASE WHEN w.active AND w.consecutive_failures + 1 >= $2 THEN now() ELSE w.disabled_at END
       FROM before
      WHERE w.id = before.id
      RETURNING w.id, w.customer_id, w.url_host, w.consecutive_failures, w.disabled_at,
                (before.active AND NOT w.active) AS just_disabled`,
    [endpoint.id, DISABLE_AFTER],
  )).rows[0];
  if (r && r.just_disabled) {
    await notifications.notify(await adminUserIds(r.customer_id), {
      kind: 'webhook.disabled',
      target: 'webhooks',
      title: 'A webhook endpoint was switched off',
      body: `Deliveries to ${r.url_host} failed ${r.consecutive_failures} times in a row. Fix the endpoint, then switch it back on.`,
      data: { endpointId: r.id, host: r.url_host, failures: r.consecutive_failures, customerId: r.customer_id },
      dedupeKey: `webhook.disabled:${r.id}:${new Date(r.disabled_at).getTime()}`,
    });
  }
  return r;
}

/**
 * One attempt at one delivery (`expected`: the attempt the job was queued
 * for; a job that is no longer current does nothing). Never throws for what
 * the receiver does — that is written on the delivery, and a retry is a new
 * job at its time.
 */
async function attempt(deliveryId, expected = null) {
  const row = (await db.query(
    `UPDATE webhook_deliveries SET locked_at = now()
      WHERE id = $1 AND status = 'pending'
        AND ($2::int IS NULL OR attempts + 1 = $2::int)
        AND (locked_at IS NULL OR locked_at < now() - ($3 || ' minutes')::interval)
      RETURNING *`,
    [deliveryId, expected == null ? null : Number(expected), String(LOCK_MINUTES)],
  )).rows[0];
  if (!row) return null;
  const endpoint = (await db.query(
    'SELECT id, url, secret, active FROM webhook_endpoints WHERE id = $1',
    [row.endpoint_id],
  )).rows[0];
  const manual = row.type === 'ping' || row.redelivery_of != null;
  const attemptNo = row.attempts + 1;

  const stop = async (message) => {
    await db.query(
      `UPDATE webhook_deliveries
          SET status = 'failed', attempts = $2, last_error = $3, next_attempt_at = NULL, locked_at = NULL, updated_at = now()
        WHERE id = $1`,
      [row.id, attemptNo, clip(message, 500)],
    );
    return { status: 'failed', error: message };
  };
  if (!endpoint) return stop('The endpoint was deleted.');
  if (!endpoint.active && !manual) return stop('The endpoint was switched off before this delivery was sent.');
  if (!(await moduleOn(row.customer_id))) return stop('Webhooks are no longer part of the organisation\'s plan.');

  const secret = secretBox.open(endpoint.secret);
  const url = secretBox.open(endpoint.url);
  if (!secret || !url) return stop('The endpoint\'s URL or secret cannot be read (the encryption key changed).');

  const body = JSON.stringify(row.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const result = await post(url, body, {
    'Content-Type': 'application/json',
    'User-Agent': USER_AGENT,
    'X-HackOS-Event': row.type,
    'X-HackOS-Delivery': row.uid,
    'X-HackOS-Timestamp': String(timestamp),
    'X-HackOS-Signature': sign(secret, timestamp, body),
  });
  const ok = Number.isInteger(result.status) && result.status >= 200 && result.status < 300;
  let error = result.error || null;
  if (!ok && !error && Number.isInteger(result.status)) {
    error = result.status >= 300 && result.status < 400
      ? `HTTP ${result.status}: redirects are not followed.`
      : `HTTP ${result.status}`;
  }

  if (ok) {
    await db.query(
      `UPDATE webhook_deliveries
          SET status = 'delivered', attempts = $2, last_status_code = $3, last_error = NULL, last_response = $4,
              last_duration_ms = $5, next_attempt_at = NULL, locked_at = NULL, delivered_at = now(), updated_at = now()
        WHERE id = $1`,
      [row.id, attemptNo, result.status, clip(result.response, 1000), result.ms],
    );
    await db.query(
      `UPDATE webhook_endpoints
          SET consecutive_failures = 0, last_delivery_at = now(), last_delivery_status = 'delivered', updated_at = now()
        WHERE id = $1`,
      [row.endpoint_id],
    );
    return { status: 'delivered', code: result.status };
  }

  const last = attemptNo >= row.max_attempts;
  const nextAt = last ? null : new Date(Date.now() + RETRY_DELAYS[Math.min(attemptNo - 1, RETRY_DELAYS.length - 1)] * 1000);
  // The failure and the next attempt's job go in together.
  await inTransaction(async (client) => {
    await client.query(
      `UPDATE webhook_deliveries
          SET status = $2, attempts = $3, last_status_code = $4, last_error = $5, last_response = $6,
              last_duration_ms = $7, next_attempt_at = $8, locked_at = NULL, updated_at = now()
        WHERE id = $1`,
      [row.id, last ? 'failed' : 'pending', attemptNo, Number.isInteger(result.status) ? result.status : null,
        clip(error, 500), clip(result.response, 1000), result.ms, nextAt],
    );
    if (!last) await queueAttempt(client, row.id, nextAt, attemptNo + 1);
  });
  if (!last) {
    await db.query(
      `UPDATE webhook_endpoints SET last_delivery_at = now(), last_delivery_status = 'retrying', updated_at = now() WHERE id = $1`,
      [row.endpoint_id],
    );
    return { status: 'retrying', error, nextAt };
  }
  if (!manual) await countFailure({ id: row.endpoint_id });
  else {
    await db.query(
      `UPDATE webhook_endpoints SET last_delivery_at = now(), last_delivery_status = 'failed', updated_at = now() WHERE id = $1`,
      [row.endpoint_id],
    );
  }
  return { status: 'failed', error };
}

const inFlight = new Set();

/**
 * The `webhook.deliver` job. The queue runs its jobs one after another, so
 * a receiver that takes its full 10 s would hold up every other job: an
 * attempt still going after HANDOFF_MS carries on in the background (at
 * most MAX_IN_FLIGHT at once) and the queue moves on. One cut short by a
 * restart is picked up again by `recover`.
 */
async function deliverJob({ deliveryId, attempt: attemptNo = null } = {}) {
  while (inFlight.size >= MAX_IN_FLIGHT) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.race(inFlight);
  }
  const run = attempt(Number(deliveryId), attemptNo)
    .catch((err) => console.error(`[webhooks] delivery ${deliveryId} attempt failed:`, err.message))
    .finally(() => inFlight.delete(run));
  inFlight.add(run);
  let timer;
  await Promise.race([run, new Promise((resolve) => { timer = setTimeout(resolve, HANDOFF_MS); })]);
  clearTimeout(timer);
}

/**
 * Deliveries whose attempt was lost (the process stopped half-way, a
 * database error): queued once more; still stuck two hours later, failed,
 * so the organisation can send them again.
 */
async function recover() {
  const failed = await db.query(
    `UPDATE webhook_deliveries
        SET status = 'failed', locked_at = NULL, next_attempt_at = NULL, updated_at = now(),
            last_error = 'This delivery was interrupted. Send it again with Redeliver.'
      WHERE status = 'pending' AND next_attempt_at < now() - interval '2 hours'
        AND (locked_at IS NULL OR locked_at < now() - interval '10 minutes')`,
  );
  const stuck = (await db.query(
    `SELECT id, attempts FROM webhook_deliveries
      WHERE status = 'pending' AND next_attempt_at < now() - interval '10 minutes'
        AND (locked_at IS NULL OR locked_at < now() - interval '10 minutes')
      ORDER BY id ASC LIMIT 500`,
  )).rows;
  let requeued = 0;
  for (const d of stuck) {
    // eslint-disable-next-line no-await-in-loop
    if (await queueAttempt(db, d.id, null, d.attempts + 1, ':again')) requeued += 1;
  }
  return { failed: failed.rowCount, requeued };
}

/** Housekeeping: deliveries older than KEEP_DAYS, outbox rows handled a week ago. */
async function prune() {
  const d = await db.query(
    `DELETE FROM webhook_deliveries WHERE created_at < now() - ($1 || ' days')::interval AND status <> 'pending'`,
    [String(KEEP_DAYS)],
  );
  const o = await db.query(
    `DELETE FROM webhook_outbox WHERE processed_at IS NOT NULL AND processed_at < now() - interval '7 days'`,
  );
  return { deliveries: d.rowCount, outbox: o.rowCount };
}

module.exports = {
  EVENT_TYPES,
  MAX_ENDPOINTS,
  MAX_ATTEMPTS,
  RETRY_DELAYS,
  DISABLE_AFTER,
  sign,
  organisationFor,
  list,
  create,
  update,
  remove,
  rotateSecret,
  sendTest,
  listDeliveries,
  redeliver,
  processOutbox,
  attempt,
  deliverJob,
  recover,
  prune,
};
