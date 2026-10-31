/**
 * @file pricing.controller.js
 * @description The owner console's Prices & discounts.
 *
 *   GET    /api/owner/pricing                  → the catalogue, its recent history, the campaigns running
 *   PUT    /api/owner/pricing/:plan            → change a plan's prices, "was" prices, limits, on-sale switch
 *   GET    /api/owner/pricing/history?plan=&limit=  → every save, newest first
 *   GET    /api/owner/coupons?q=&state=&kind=  → codes and campaigns, with uses, revenue and discount given
 *   POST   /api/owner/coupons                  → create a code or a campaign
 *   GET    /api/owner/coupons/:id              → one, with the orders that used it
 *   PATCH  /api/owner/coupons/:id              → edit
 *   POST   /api/owner/coupons/:id/pause        → stop it applying
 *   POST   /api/owner/coupons/:id/resume       → start again
 *   DELETE /api/owner/coupons/:id              → delete one nobody used
 *
 * Every change is in the audit trail: owner.price.update with the fields as
 * [old, new], owner.coupon.create / update / pause / resume / delete.
 */

const catalogue = require('../services/priceCatalogue.service');
const discounts = require('../services/discount.service');
const audit = require('../services/audit.service');
const { successResponse, errorResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const asId = (raw) => {
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const getPricing = async (req, res, next) => {
  try {
    const [plans, history, campaigns] = await Promise.all([
      catalogue.getCatalogue(),
      catalogue.history({ limit: 30 }),
      discounts.publicCampaigns(),
    ]);
    res.set('Cache-Control', 'no-store');
    return successResponse(res, HTTP.OK, 'OK', { plans, history, campaigns });
  } catch (error) { next(error); }
};

const updatePlan = async (req, res, next) => {
  try {
    const planId = String(req.params.plan || '').toLowerCase();
    const { plan, changes } = await catalogue.updatePlan(planId, req.body || {}, req.user.id);
    if (Object.keys(changes).length) {
      await audit.record(req, 'owner.price.update', {
        targetType: 'plan', targetId: planId, meta: { plan: planId, changes, note: req.body && req.body.note ? String(req.body.note).slice(0, 200) : undefined },
      });
    }
    return successResponse(res, HTTP.OK, Object.keys(changes).length ? 'Saved' : 'Nothing changed', { plan, changes });
  } catch (error) { return errorFromException(res, next, error); }
};

const priceHistory = async (req, res, next) => {
  try {
    const plan = req.query.plan ? String(req.query.plan).toLowerCase() : null;
    return successResponse(res, HTTP.OK, 'OK', await catalogue.history({ planId: plan, limit: req.query.limit }));
  } catch (error) { next(error); }
};

const listCoupons = async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    return successResponse(res, HTTP.OK, 'OK', await discounts.list(req.query || {}));
  } catch (error) { next(error); }
};

const getCoupon = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    const coupon = id ? await discounts.get(id) : null;
    if (!coupon) return errorResponse(res, HTTP.NOT_FOUND, 'No such discount', null, 'COUPON_NOT_FOUND');
    return successResponse(res, HTTP.OK, 'OK', coupon);
  } catch (error) { next(error); }
};

/** What the audit row says about a coupon: enough to read it later without the row. */
const auditMeta = (c) => ({
  kind: c.kind, code: c.code, name: c.name, label: c.label, state: c.state,
});

const createCoupon = async (req, res, next) => {
  try {
    const coupon = await discounts.create(req.body || {}, req.user.id);
    await audit.record(req, 'owner.coupon.create', { targetType: 'coupon', targetId: coupon.id, meta: auditMeta(coupon) });
    return successResponse(res, HTTP.CREATED, 'Created', coupon);
  } catch (error) { return errorFromException(res, next, error); }
};

const updateCoupon = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    const out = id ? await discounts.update(id, req.body || {}, req.user.id) : null;
    if (!out) return errorResponse(res, HTTP.NOT_FOUND, 'No such discount', null, 'COUPON_NOT_FOUND');
    if (out.changed.length) {
      await audit.record(req, 'owner.coupon.update', { targetType: 'coupon', targetId: id, meta: { ...auditMeta(out.coupon), fields: out.changed } });
    }
    return successResponse(res, HTTP.OK, out.changed.length ? 'Saved' : 'Nothing changed', out.coupon);
  } catch (error) { return errorFromException(res, next, error); }
};

const setActive = (active) => async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    const coupon = id ? await discounts.setActive(id, active, req.user.id) : null;
    if (!coupon) return errorResponse(res, HTTP.NOT_FOUND, 'No such discount', null, 'COUPON_NOT_FOUND');
    await audit.record(req, active ? 'owner.coupon.resume' : 'owner.coupon.pause', { targetType: 'coupon', targetId: id, meta: auditMeta(coupon) });
    return successResponse(res, HTTP.OK, active ? 'Resumed' : 'Paused', coupon);
  } catch (error) { return errorFromException(res, next, error); }
};

const deleteCoupon = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    const gone = id ? await discounts.remove(id) : null;
    if (!gone) return errorResponse(res, HTTP.NOT_FOUND, 'No such discount', null, 'COUPON_NOT_FOUND');
    await audit.record(req, 'owner.coupon.delete', { targetType: 'coupon', targetId: id, meta: { code: gone.code, name: gone.name } });
    return successResponse(res, HTTP.OK, 'Deleted', { id });
  } catch (error) { return errorFromException(res, next, error); }
};

module.exports = {
  getPricing, updatePlan, priceHistory, listCoupons, getCoupon, createCoupon, updateCoupon,
  pauseCoupon: setActive(false), resumeCoupon: setActive(true), deleteCoupon,
};
