/**
 * @file orderActions.controller.js
 * @description The owner's decisions on an order, invoices as PDF, plans and
 * module switches per organisation, and the buyer's own invoice download.
 *
 *   POST /api/orders/:id/approve      { note? }                  owner
 *   POST /api/orders/:id/reject       { reason }                 owner
 *   POST /api/orders/:id/discount/remove  { reason? }            owner (a claimed discount, before approval)
 *   POST /api/orders/:id/payment      { method, reference?, paidAt? }  owner
 *   POST /api/orders/:id/setup-link                              owner
 *   POST /api/customers/:id/setup-link                           owner (latest approved order)
 *   POST /api/me/organisations/:id/setup-link                    an owner of the organisation, to themselves
 *   GET  /api/orders/:id/invoice.pdf                             owner
 *   GET  /api/customers/:id/plan                                 owner
 *   PUT  /api/customers/:id/modules/:key  { enabled: true|false|null, note? }  owner
 *   PUT  /api/customers/:id/plan-exempt   { exempt }             owner
 *   POST /api/customers/:id/community     { note? }              owner (grant the free Community plan)
 *   GET  /api/me/orders/:id/invoice.pdf                          a member of the order's organisation
 *   GET  /api/me/organisations/:id/plan                          a member of the organisation
 *   GET  /api/events/:eventId/modules                            anyone who may see the event
 *
 * E-mails are awaited so the response can say whether the buyer was told;
 * a mail failure never undoes the decision. The approval answer carries the
 * setup link itself, for the owner to pass on when e-mail is not set up yet.
 */

const db = require('../config/db');
const lifecycle = require('../services/orderLifecycle.service');
const orderService = require('../services/order.service');
const customerService = require('../services/customer.service');
const entitlementService = require('../services/entitlement.service');
const setupService = require('../services/setup.service');
const emailService = require('../services/email.service');
const billingService = require('../services/billing.service');
const { renderInvoicePdf } = require('../services/invoice.service');
const audit = require('../services/audit.service');
const { resolveFrontendBaseUrl, resolveAppBaseUrl } = require('../utils/frontendUrl');
const { successResponse, errorResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');
const { PLANS } = require('../constants/plans');

const asId = (raw) => {
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const planName = (order) => (PLANS[order.plan] ? PLANS[order.plan].name : order.plan);
const setupUrlFor = (token) => `${resolveAppBaseUrl()}/setup/${encodeURIComponent(token)}`;

/** Errors thrown by the services carry statusCode; old ones carry status. */
function fail(res, next, error) {
  if (error && !error.statusCode && Number.isInteger(error.status)) {
    return errorResponse(res, error.status, error.message, null, error.code);
  }
  return errorFromException(res, next, error);
}

const approve = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid order id');
    const out = await lifecycle.approve(id, req.user.id, { note: req.body && req.body.note });
    if (!out) return errorResponse(res, HTTP.NOT_FOUND, 'Order not found');

    const setupUrl = out.setup ? setupUrlFor(out.setup.token) : null;
    let mail = null;
    if (out.buyer) {
      // The approval always reaches the buyer: the invoice and where to pay
      // it, and the setup link only when the organisation still needs one.
      mail = await emailService.sendOrderApprovedEmail({
        to: out.buyer.email,
        fullName: out.buyer.fullName,
        orderCode: out.order.order_code,
        planName: planName(out.order),
        organisation: out.order.customer_name,
        setupUrl,
        expiresHours: setupService.SETUP_TTL_HOURS,
        lang: out.order.locale,
        frontendUrl: resolveFrontendBaseUrl(),
        invoiceNumber: out.order.invoice_number,
        invoiceDueAt: out.order.invoice_due_at,
        amountMinor: out.order.amount_minor,
        taxMinor: out.order.tax_minor,
        currency: out.order.currency,
        paid: Boolean(out.order.paid_at),
        paymentMethod: out.order.payment_method,
        seller: billingService.payTo(await billingService.getBilling()),
      });
    }
    audit.record(req, 'order.approve', {
      customerId: out.order.customer_id, targetType: 'order', targetId: id,
      meta: {
        entitlementId: out.entitlement.id, mailSent: Boolean(mail && mail.ok), setupSent: Boolean(setupUrl),
        ...(out.order.discount_status === 'approved' ? { discountAccepted: out.order.discount_label } : {}),
      },
    });
    return successResponse(res, HTTP.OK, `Order ${out.order.order_code} approved`, {
      order: out.order,
      entitlement: out.entitlement,
      setupUrl,
      // True when the organisation was set up already, so no link was issued.
      setupSkipped: Boolean(out.buyer) && !out.setup,
      setupExpiresAt: out.setup ? out.setup.expiresAt : null,
      mailSent: Boolean(mail && mail.ok),
      mailMessage: mail && !mail.ok ? mail.message || 'E-mail could not be sent' : null,
    });
  } catch (error) { return fail(res, next, error); }
};

const reject = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid order id');
    const reason = req.body && req.body.reason;
    const out = await lifecycle.reject(id, req.user.id, { reason });
    if (!out) return errorResponse(res, HTTP.NOT_FOUND, 'Order not found');
    const mail = out.buyer
      ? await emailService.sendOrderRejectedEmail({
        to: out.buyer.email,
        fullName: out.buyer.fullName,
        orderCode: out.order.order_code,
        reason: out.order.status_reason,
        frontendUrl: resolveFrontendBaseUrl(),
        lang: out.order.locale,
      })
      : null;
    audit.record(req, 'order.reject', { customerId: out.order.customer_id, targetType: 'order', targetId: id });
    return successResponse(res, HTTP.OK, `Order ${out.order.order_code} refused`, {
      order: out.order,
      mailSent: Boolean(mail && mail.ok),
    });
  } catch (error) { return fail(res, next, error); }
};

/**
 * Take a claimed discount off an order the owner has not approved yet. The
 * buyer is not e-mailed here: the approval e-mail and the invoice carry the
 * amount they are asked to pay.
 */
const removeDiscount = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid order id');
    const out = await lifecycle.removeClaim(id, req.user.id, { reason: req.body && req.body.reason });
    if (!out) return errorResponse(res, HTTP.NOT_FOUND, 'Order not found');
    audit.record(req, 'order.discount.remove', {
      customerId: out.order.customer_id, targetType: 'order', targetId: id,
      meta: { discount: out.removed, couponId: out.order.coupon_id, amountMinor: Number(out.order.amount_minor) },
    });
    return successResponse(res, HTTP.OK, 'Discount removed', { order: out.order });
  } catch (error) { return fail(res, next, error); }
};

const recordPayment = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid order id');
    const { method, reference, paidAt } = req.body || {};
    const out = await lifecycle.recordPayment(id, req.user.id, { method, reference, paidAt });
    if (!out) return errorResponse(res, HTTP.NOT_FOUND, 'Order not found');
    const mail = out.buyer
      ? await emailService.sendPaymentReceivedEmail({
        to: out.buyer.email,
        fullName: out.buyer.fullName,
        orderCode: out.order.order_code,
        amountMinor: Number(out.order.amount_minor || 0) + Number(out.order.tax_minor || 0),
        currency: out.order.currency,
        frontendUrl: resolveFrontendBaseUrl(),
        lang: out.order.locale,
      })
      : null;
    audit.record(req, 'order.payment', {
      customerId: out.order.customer_id, targetType: 'order', targetId: id, meta: { method: out.order.payment_method },
    });
    return successResponse(res, HTTP.OK, 'Payment recorded', { order: out.order, mailSent: Boolean(mail && mail.ok) });
  } catch (error) { return fail(res, next, error); }
};

/** E-mail a fresh setup link and answer with it (the owner may pass it on by hand). */
async function sendFreshLink(res, out) {
  const setupUrl = setupUrlFor(out.setup.token);
  const customer = (await customerService.getCustomerById(out.order.customer_id)) || {};
  const mail = await emailService.sendSetupLinkEmail({
    to: out.buyer.email,
    organisation: customer.name || 'your organisation',
    setupUrl,
    expiresHours: setupService.SETUP_TTL_HOURS,
    lang: out.order.locale,
  });
  return successResponse(res, HTTP.OK, 'A new setup link was sent', {
    setupUrl,
    setupExpiresAt: out.setup.expiresAt,
    sentTo: out.buyer.email,
    mailSent: Boolean(mail && mail.ok),
    mailMessage: mail && !mail.ok ? mail.message || 'E-mail could not be sent' : null,
  });
}

const resendSetupLink = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid order id');
    const out = await lifecycle.reissueSetupLink(id, req.user.id);
    if (!out) return errorResponse(res, HTTP.NOT_FOUND, 'Order not found');
    audit.record(req, 'order.setup_link', { customerId: out.order.customer_id, targetType: 'order', targetId: id });
    return await sendFreshLink(res, out);
  } catch (error) { return fail(res, next, error); }
};

/** The console's organisation page: the same, for its latest approved order. */
const resendCustomerSetupLink = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid customer id');
    const out = await lifecycle.reissueForCustomer(id, req.user.id);
    if (!out) return errorResponse(res, HTTP.NOT_FOUND, 'Customer not found');
    audit.record(req, 'order.setup_link', { customerId: id, targetType: 'order', targetId: out.order.id });
    return await sendFreshLink(res, out);
  } catch (error) { return fail(res, next, error); }
};

/** The buyer's account: a new link to their own address. The link is not in the answer. */
const mySetupLink = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    const out = id ? await setupService.issueForMember(id, req.user) : null;
    if (!out) return errorResponse(res, HTTP.NOT_FOUND, 'Organisation not found');
    const mail = await emailService.sendSetupLinkEmail({
      to: out.email,
      organisation: out.organisation,
      setupUrl: setupUrlFor(out.token),
      expiresHours: setupService.SETUP_TTL_HOURS,
      lang: out.locale,
    });
    audit.record(req, 'customer.setup_link', { customerId: id, targetType: 'customer', targetId: id });
    return successResponse(res, HTTP.OK, 'A new setup link was sent', {
      email: setupService.maskEmail(out.email),
      mailSent: Boolean(mail && mail.ok),
    });
  } catch (error) { return fail(res, next, error); }
};

async function sendInvoice(res, order) {
  const customer = (await customerService.getCustomerById(order.customer_id)) || {};
  const pdf = await renderInvoicePdf(order, customer);
  // An order without an invoice number downloads as its confirmation, not as an invoice.
  const name = (order.invoice_number ? `HackOS-${order.invoice_number}.pdf` : `HackOS-${order.order_code}-confirmation.pdf`)
    .replace(/[^A-Za-z0-9._-]/g, '');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).send(Buffer.from(pdf));
}

const ownerInvoicePdf = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid order id');
    const order = await orderService.getOrderById(id);
    if (!order) return errorResponse(res, HTTP.NOT_FOUND, 'Order not found');
    return await sendInvoice(res, order);
  } catch (error) { return fail(res, next, error); }
};

/** Whether this account belongs to the organisation (any member role, or the contact e-mail). */
async function isMember(user, customerId) {
  const r = await db.query(
    `SELECT 1 FROM customer_contacts
      WHERE customer_id = $1 AND (user_id = $2 OR ($3 <> '' AND LOWER(email) = LOWER($3)))
      LIMIT 1`,
    [customerId, user.id, String(user.email || '').trim()],
  );
  return r.rows.length > 0;
}

const myInvoicePdf = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid order id');
    const order = await orderService.getOrderById(id);
    // Someone else's order answers exactly like a missing one.
    if (!order || !(await isMember(req.user, order.customer_id))) {
      return errorResponse(res, HTTP.NOT_FOUND, 'Order not found');
    }
    return await sendInvoice(res, order);
  } catch (error) { return fail(res, next, error); }
};

const customerPlan = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid customer id');
    const summary = await entitlementService.summaryForCustomer(id);
    if (!summary) return errorResponse(res, HTTP.NOT_FOUND, 'Customer not found');
    return successResponse(res, HTTP.OK, 'OK', summary);
  } catch (error) { return fail(res, next, error); }
};

const myOrganisationPlan = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id || !(await isMember(req.user, id))) return errorResponse(res, HTTP.NOT_FOUND, 'Organisation not found');
    const summary = await entitlementService.summaryForCustomer(id);
    if (!summary) return errorResponse(res, HTTP.NOT_FOUND, 'Organisation not found');
    // Members see their plan; the owner's notes on the switches stay internal.
    const { overrides, ...rest } = summary;
    return successResponse(res, HTTP.OK, 'OK', rest);
  } catch (error) { return fail(res, next, error); }
};

const setCustomerModule = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid customer id');
    const { enabled, note } = req.body || {};
    if (!(enabled === true || enabled === false || enabled === null)) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'enabled must be true, false or null (back to the plan)');
    }
    await entitlementService.setOverride(id, req.params.key, enabled, req.user.id, note);
    audit.record(req, 'customer.module', { customerId: id, targetType: 'customer', targetId: id, meta: { module: req.params.key, enabled } });
    return successResponse(res, HTTP.OK, 'Saved', await entitlementService.summaryForCustomer(id));
  } catch (error) { return fail(res, next, error); }
};

const setPlanExempt = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid customer id');
    const exempt = req.body && req.body.exempt;
    if (typeof exempt !== 'boolean') return errorResponse(res, HTTP.BAD_REQUEST, 'exempt must be true or false');
    const r = await db.query('UPDATE customers SET plan_exempt = $1, updated_at = now() WHERE id = $2 RETURNING id', [exempt, id]);
    if (!r.rows[0]) return errorResponse(res, HTTP.NOT_FOUND, 'Customer not found');
    audit.record(req, 'customer.plan_exempt', { customerId: id, targetType: 'customer', targetId: id, meta: { exempt } });
    return successResponse(res, HTTP.OK, 'Saved', await entitlementService.summaryForCustomer(id));
  } catch (error) { return fail(res, next, error); }
};

/**
 * Grant Community: a ₼0 order, approved at once (lifecycle.grantCommunity).
 * The setup link goes to the organisation's billing address when it is not
 * set up yet, as for any approval; it is in the answer too.
 */
const grantCommunity = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid customer id');
    const out = await lifecycle.grantCommunity(id, req.user.id, { note: req.body && req.body.note });
    if (!out) return errorResponse(res, HTTP.NOT_FOUND, 'Customer not found');
    audit.record(req, 'customer.community.grant', {
      customerId: id, targetType: 'customer', targetId: id, meta: { orderId: out.order.id, entitlementId: out.entitlement.id },
    });
    return successResponse(res, HTTP.CREATED, 'Community plan granted', {
      order: out.order,
      entitlement: out.entitlement,
      setupUrl: out.setup ? setupUrlFor(out.setup.token) : null,
      plan: await entitlementService.summaryForCustomer(id),
    });
  } catch (error) { return fail(res, next, error); }
};

const eventModules = async (req, res, next) => {
  try {
    const scope = await entitlementService.forEvent(req.params.eventId);
    if (!scope) return errorResponse(res, HTTP.NOT_FOUND, 'Event not found');
    return successResponse(res, HTTP.OK, 'OK', {
      eventId: scope.eventId,
      plan: scope.plan,
      modules: [...scope.modules].sort(),
      limits: scope.limits,
    });
  } catch (error) { return fail(res, next, error); }
};

module.exports = {
  removeDiscount,
  grantCommunity,
  approve,
  reject,
  recordPayment,
  resendSetupLink,
  resendCustomerSetupLink,
  mySetupLink,
  ownerInvoicePdf,
  myInvoicePdf,
  customerPlan,
  myOrganisationPlan,
  setCustomerModule,
  setPlanExempt,
  eventModules,
};
