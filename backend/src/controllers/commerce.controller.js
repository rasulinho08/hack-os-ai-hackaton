/**
 * @file commerce.controller.js
 * @description HTTP handlers for customers and orders.
 *
 * Two audiences share these services and they are kept apart deliberately.
 * `/api/customers` and `/api/orders` are the owner's view and require an admin
 * role. `/api/me/orders` and `/api/me/entitlement` are the buyer's view: no
 * admin, scoped to whatever the signed-in account is a contact for, and unable
 * to name a customer id at all. A customer must never be able to widen their
 * own scope by passing one.
 */

const customerService = require('../services/customer.service');
const orderService = require('../services/order.service');
const billingService = require('../services/billing.service');
const audit = require('../services/audit.service');
const orderActions = require('./orderActions.controller');
const {
  createCustomerSchema,
  updateCustomerSchema,
  contactSchema,
  createOrderSchema,
  updateOrderSchema,
  orderStatusSchema,
  issueInvoiceSchema,
} = require('../validations/commerce.schema');
const { successResponse, errorResponse } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

/** Turns a Zod failure into the field-level shape the frontend already reads. */
const sendValidationError = (res, parsed) =>
  errorResponse(
    res,
    HTTP.BAD_REQUEST,
    'Validation failed',
    parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    'VALIDATION_FAILED',
  );

const asId = (raw) => {
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/* ─── Customers (owner) ──────────────────────────────────────────────── */

const listCustomers = async (req, res, next) => {
  try {
    const includeArchived = String(req.query.includeArchived) === 'true';
    return successResponse(res, HTTP.OK, 'OK',
      await customerService.listCustomers({ includeArchived }));
  } catch (error) { next(error); }
};

const getCustomer = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid customer id');
    const customer = await customerService.getCustomerById(id);
    if (!customer) return errorResponse(res, HTTP.NOT_FOUND, 'Customer not found');
    const contacts = await customerService.listContacts(id);
    return successResponse(res, HTTP.OK, 'OK', { ...customer, contacts });
  } catch (error) { next(error); }
};

const createCustomer = async (req, res, next) => {
  try {
    const parsed = createCustomerSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed);
    return successResponse(res, HTTP.CREATED, 'Customer created',
      await customerService.createCustomer(parsed.data));
  } catch (error) {
    // The unique index on lower(name) is the only thing that can collide here.
    if (error && error.code === '23505') {
      return errorResponse(res, HTTP.CONFLICT,
        'A customer with that name already exists', null, 'CUSTOMER_EXISTS');
    }
    next(error);
  }
};

const updateCustomer = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid customer id');
    const parsed = updateCustomerSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed);
    const updated = await customerService.updateCustomer(id, parsed.data);
    if (!updated) return errorResponse(res, HTTP.NOT_FOUND, 'Customer not found');
    // Which fields changed, not their values: notes and contact details stay out of the trail.
    await audit.record(req, 'customer.update', { customerId: id, targetType: 'customer', targetId: id, meta: { fields: Object.keys(parsed.data) } });
    return successResponse(res, HTTP.OK, 'Customer updated', updated);
  } catch (error) { next(error); }
};

/** Archive, never delete — orders reference the row. */
const archiveCustomer = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid customer id');
    const archived = await customerService.archiveCustomer(id);
    if (!archived) return errorResponse(res, HTTP.NOT_FOUND, 'Customer not found or already archived');
    await audit.record(req, 'customer.archive', { customerId: id, targetType: 'customer', targetId: id });
    return successResponse(res, HTTP.OK, 'Customer archived', archived);
  } catch (error) { next(error); }
};

const restoreCustomer = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid customer id');
    const restored = await customerService.restoreCustomer(id);
    if (!restored) return errorResponse(res, HTTP.NOT_FOUND, 'Customer not found');
    await audit.record(req, 'customer.restore', { customerId: id, targetType: 'customer', targetId: id });
    return successResponse(res, HTTP.OK, 'Customer restored', restored);
  } catch (error) { next(error); }
};

const upsertContact = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid customer id');
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed);
    return successResponse(res, HTTP.OK, 'Contact saved',
      await customerService.upsertContact(id, parsed.data));
  } catch (error) { next(error); }
};

const removeContact = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    const contactId = asId(req.params.contactId);
    if (!id || !contactId) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid id');
    const removed = await customerService.removeContact(id, contactId);
    if (!removed) return errorResponse(res, HTTP.NOT_FOUND, 'Contact not found');
    return successResponse(res, HTTP.OK, 'Contact removed');
  } catch (error) { next(error); }
};

/* ─── Orders (owner) ─────────────────────────────────────────────────── */

const listOrders = async (req, res, next) => {
  try {
    return successResponse(res, HTTP.OK, 'OK', await orderService.listOrders({
      status: req.query.status || undefined,
      customerId: asId(req.query.customerId) || undefined,
      eventId: asId(req.query.eventId) || undefined,
    }));
  } catch (error) { next(error); }
};

const getOrder = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid order id');
    const order = await orderService.getOrderById(id);
    if (!order) return errorResponse(res, HTTP.NOT_FOUND, 'Order not found');
    const history = await orderService.getOrderHistory(id);
    return successResponse(res, HTTP.OK, 'OK', { ...order, history });
  } catch (error) { next(error); }
};

const createOrder = async (req, res, next) => {
  try {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed);
    const order = await orderService.createOrder(parsed.data, req.user && req.user.id);
    return successResponse(res, HTTP.CREATED, 'Order created', order);
  } catch (error) {
    if (error && error.code === '23503') {
      return errorResponse(res, HTTP.BAD_REQUEST,
        'That customer or event does not exist', null, 'FK_VIOLATION');
    }
    if (error && error.code === '23505') {
      return errorResponse(res, HTTP.CONFLICT,
        'That event already has an order', null, 'EVENT_ALREADY_ORDERED');
    }
    next(error);
  }
};

const updateOrder = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid order id');
    const parsed = updateOrderSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed);
    const updated = await orderService.updateOrder(id, parsed.data);
    if (!updated) return errorResponse(res, HTTP.NOT_FOUND, 'Order not found');
    return successResponse(res, HTTP.OK, 'Order updated', updated);
  } catch (error) {
    if (error && error.code === '23505') {
      return errorResponse(res, HTTP.CONFLICT,
        'That event already has an order', null, 'EVENT_ALREADY_ORDERED');
    }
    next(error);
  }
};

const setOrderStatus = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid order id');
    const parsed = orderStatusSchema.safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, parsed);

    /*
     * Three moves have side effects of their own and go through the actions
     * that perform them, so no request can activate an order without its
     * entitlement, record a payment without its receipt, or refuse a placed
     * order without telling the buyer why.
     */
    const { status, note, paymentMethod, paymentReference } = parsed.data;
    if (status === 'delivered') {
      req.body = { note };
      return orderActions.approve(req, res, next);
    }
    if (status === 'paid') {
      req.body = { method: paymentMethod || 'other', reference: paymentReference };
      return orderActions.recordPayment(req, res, next);
    }
    if (status === 'cancelled') {
      const current = await orderService.getOrderById(id);
      if (current && ['draft', 'pending'].includes(current.status)) {
        req.body = { reason: note };
        return orderActions.reject(req, res, next);
      }
    }

    const updated = await orderService.setOrderStatus(
      id, parsed.data.status, req.user && req.user.id, parsed.data.note,
      { method: parsed.data.paymentMethod, reference: parsed.data.paymentReference },
    );
    if (!updated) return errorResponse(res, HTTP.NOT_FOUND, 'Order not found');
    audit.record(req, 'order.status', { customerId: updated.customer_id, targetType: 'order', targetId: id, meta: { status: parsed.data.status } });
    return successResponse(res, HTTP.OK, 'Order updated', updated);
  } catch (error) {
    // The service refuses moves the flow does not allow; that is a 409, not a bug.
    if (error && error.status) {
      return errorResponse(res, error.status, error.message, null, error.code);
    }
    next(error);
  }
};

/**
 * Issue the invoice for an order.
 *
 * A POST rather than a PATCH: it allocates a number that did not exist before
 * and can only happen once, so it is not idempotent and must not look like it.
 */
const issueInvoice = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid order id');
    const parsed = issueInvoiceSchema.safeParse(req.body || {});
    if (!parsed.success) return sendValidationError(res, parsed);

    const updated = await orderService.issueInvoice(
      id, { dueInDays: parsed.data.dueInDays }, req.user && req.user.id,
    );
    if (!updated) return errorResponse(res, HTTP.NOT_FOUND, 'Order not found');
    return successResponse(res, HTTP.CREATED, `Invoice ${updated.invoice_number} issued`, updated);
  } catch (error) {
    // Already invoiced, or not priced — both are refusals, not faults.
    if (error && error.status) {
      return errorResponse(res, error.status, error.message, null, error.code);
    }
    next(error);
  }
};

/* ─── The buyer's own view ───────────────────────────────────────────── */

const myOrders = async (req, res, next) => {
  try {
    const { id, email } = req.user || {};
    const [orders, customers] = await Promise.all([
      orderService.listOrdersForUser(id, email),
      customerService.customersForUser(id, email),
    ]);
    // `notes` is the owner's own text about orders and customers (merges,
    // follow-ups); the buyer's view leaves it out.
    const visible = orders.map(({ notes, idempotency_key: _key, invoice_snapshot: _snap, ...order }) => order);
    const orgs = customers.map(({ notes, ...customer }) => customer);
    // Where to pay an invoice: the seller's account, as the invoice prints it.
    const seller = billingService.payTo(await billingService.getBilling());
    return successResponse(res, HTTP.OK, 'OK', { orders: visible, customers: orgs, seller });
  } catch (error) { next(error); }
};

/**
 * Whether this account has anything paid for.
 *
 * Deliberately a plain boolean and nothing else: it is read by the gate in
 * front of the workspace, and a gate should not be handed the order rows it
 * does not need.
 */
const myEntitlement = async (req, res, next) => {
  try {
    const { id, email } = req.user || {};
    const entitled = await orderService.hasActiveEntitlement(id, email);
    return successResponse(res, HTTP.OK, 'OK', { entitled });
  } catch (error) { next(error); }
};

module.exports = {
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  archiveCustomer,
  restoreCustomer,
  upsertContact,
  removeContact,
  listOrders,
  getOrder,
  createOrder,
  updateOrder,
  setOrderStatus,
  issueInvoice,
  myOrders,
  myEntitlement,
};
