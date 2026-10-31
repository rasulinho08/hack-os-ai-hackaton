/**
 * @file commerce.schema.js
 * @description Zod schemas for customers and orders.
 *
 * Money arrives as an integer of minor units and is validated as one. A client
 * that sends 149.9 gets rejected rather than silently rounded, because a
 * rounding decision made in the wrong layer is how an invoice ends up a qəpik
 * out with nobody able to say where.
 */

const { z } = require('zod');

const trimmed = (max) => z.string().trim().min(1).max(max);
const optionalText = (max) =>
  z.union([z.string().trim().max(max), z.literal('')]).optional().nullable();

const minorUnits = z
  .union([z.number().int().nonnegative(), z.null()])
  .optional()
  .describe('Money in minor units — qəpik for AZN. Never a decimal.');

const createCustomerSchema = z.object({
  name: trimmed(255),
  legal_name: optionalText(255),
  sector: optionalText(100),
  country: optionalText(100),
  city: optionalText(120),
  website: optionalText(500),
  vat_id: optionalText(60),
  billing_email: z.union([z.string().trim().email().max(255), z.literal('')]).optional().nullable(),
  notes: optionalText(4000),
});

/** Every field optional, but at least one present — a patch, not a replace. */
const updateCustomerSchema = createCustomerSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'Nothing to update' },
);

const contactSchema = z.object({
  user_id: z.union([z.number().int().positive(), z.null()]).optional(),
  full_name: optionalText(200),
  email: z.string().trim().email().max(255),
  role_title: optionalText(120),
  is_primary: z.boolean().optional(),
});

const createOrderSchema = z.object({
  customer_id: z.number().int().positive(),
  event_id: z.union([z.number().int().positive(), z.null()]).optional(),
  purchaser_user_id: z.union([z.number().int().positive(), z.null()]).optional(),
  plan: z.enum(['starter', 'professional', 'business', 'enterprise']),
  billing_period: z.enum(['per_event', 'annual']).optional(),
  currency: z.string().trim().length(3).optional(),
  amount_minor: minorUnits,
  tax_minor: minorUnits,
  notes: optionalText(4000),
});

const updateOrderSchema = createOrderSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'Nothing to update' },
);

const orderStatusSchema = z.object({
  status: z.enum(['draft', 'pending', 'paid', 'delivered', 'cancelled', 'refunded']),
  note: optionalText(1000),
  // Only meaningful on the move to `paid`; the service ignores it elsewhere.
  paymentMethod: z.enum(['bank_transfer', 'card', 'cash', 'other']).optional(),
  paymentReference: optionalText(120),
});

/** Issuing an invoice takes only its terms; the number is ours to allocate. */
const issueInvoiceSchema = z.object({
  dueInDays: z.coerce.number().int().min(0).max(365).optional(),
});

module.exports = {
  createCustomerSchema,
  updateCustomerSchema,
  contactSchema,
  createOrderSchema,
  updateOrderSchema,
  orderStatusSchema,
  issueInvoiceSchema,
};
