/**
 * @file webhook.controller.js
 * @description An organisation's outgoing webhooks (see webhook.service and
 * docs/WEBHOOKS.md). For the organisation's owner and administrators; the
 * platform owner names the organisation with customerId.
 *
 *   GET    /api/account/webhooks                                  endpoints, event types, whether the plan has them
 *   POST   /api/account/webhooks                                  { url, events, description? } → endpoint + secret (once)
 *   PATCH  /api/account/webhooks/:id                              { url?, events?, description?, active? }
 *   DELETE /api/account/webhooks/:id
 *   POST   /api/account/webhooks/:id/rotate                       a new secret (once); the old one stops at once
 *   POST   /api/account/webhooks/:id/test                         send a `ping`
 *   GET    /api/account/webhooks/:id/deliveries?limit=&before=    newest first
 *   POST   /api/account/webhooks/:id/deliveries/:deliveryId/redeliver
 *
 * Every route takes ?customerId= (or customerId in the body) to pick one of
 * several organisations. Responses are never cached: two of them carry a
 * secret. The audit log records the host, never the URL or the secret.
 */

const webhooks = require('../services/webhook.service');
const audit = require('../services/audit.service');
const { successResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

/** A test or a redelivery is queued, not yet sent. */
const ACCEPTED = 202;

const orgOf = (req) => req.query.customerId ?? req.body?.customerId ?? null;
const wrap = (fn) => async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    return await fn(req, res);
  } catch (err) {
    if (err && err.code === 'MODULE_DISABLED') {
      // The same answer as the requireModule middleware, so the app shows its lock.
      return res.status(403).json({ success: false, message: err.message, code: err.code, module: err.module });
    }
    return errorFromException(res, next, err);
  }
};
const ok = (res, data, message = 'OK') => successResponse(res, HTTP.OK, message, data);
const record = (req, action, organisation, endpointId, meta) => audit.record(req, action, {
  customerId: organisation.id, targetType: 'webhook_endpoint', targetId: endpointId, meta,
});

const list = wrap(async (req, res) => ok(res, await webhooks.list(req.user, orgOf(req))));

const create = wrap(async (req, res) => {
  const out = await webhooks.create(req.user, orgOf(req), req.body || {});
  await record(req, 'webhook.create', out.organisation, out.endpoint.id, { host: out.endpoint.urlHost, events: out.endpoint.events });
  return successResponse(res, HTTP.CREATED, 'Created', out);
});

const update = wrap(async (req, res) => {
  const out = await webhooks.update(req.user, orgOf(req), req.params.id, req.body || {});
  if (out.changed.length) {
    await record(req, 'webhook.update', out.organisation, out.endpoint.id, {
      host: out.endpoint.urlHost, changed: out.changed, events: out.endpoint.events, active: out.endpoint.active,
    });
  }
  return ok(res, out, 'Saved');
});

const remove = wrap(async (req, res) => {
  const out = await webhooks.remove(req.user, orgOf(req), req.params.id);
  await record(req, 'webhook.delete', out.organisation, out.id, { host: out.urlHost });
  return ok(res, out, 'Deleted');
});

const rotate = wrap(async (req, res) => {
  const out = await webhooks.rotateSecret(req.user, orgOf(req), req.params.id);
  await record(req, 'webhook.rotate_secret', out.organisation, out.endpoint.id, { host: out.endpoint.urlHost });
  return ok(res, out, 'Rotated');
});

const test = wrap(async (req, res) => {
  const out = await webhooks.sendTest(req.user, orgOf(req), req.params.id);
  return successResponse(res, ACCEPTED, 'Queued', out);
});

const deliveries = wrap(async (req, res) => ok(res, await webhooks.listDeliveries(
  req.user, orgOf(req), req.params.id, { limit: req.query.limit, before: req.query.before },
)));

const redeliver = wrap(async (req, res) => {
  const out = await webhooks.redeliver(req.user, orgOf(req), req.params.id, req.params.deliveryId);
  return successResponse(res, ACCEPTED, 'Queued', out);
});

module.exports = { list, create, update, remove, rotate, test, deliveries, redeliver };
