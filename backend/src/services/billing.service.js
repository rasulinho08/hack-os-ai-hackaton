/**
 * @file billing.service.js
 * @description Who bills, and where the money goes: the seller's legal
 * details, bank account and VAT status.
 *
 * The owner sets them in the console (Settings → Billing and invoices,
 * `GET|PUT /api/owner/settings/billing`), stored in `platform_settings` under
 * the key `billing`. They print on every invoice and in the bank-transfer
 * instructions (approval e-mail, the buyer's account). The `INVOICE_*`
 * environment settings still work as a fallback for a field the owner has not
 * filled in, so an installation configured that way keeps its invoices.
 *
 * While the details an accounts department needs to pay (legal name, VÖEN,
 * address, bank, IBAN, SWIFT) are incomplete, `ready` is false: the owner's
 * overview warns, and the invoice says the bank details follow by e-mail.
 *
 * VAT: one setting decides the one VAT line everywhere. Not registered → no
 * VAT is charged and every page says so; registered at a rate → checkout adds
 * that rate on top of the plan price (prices are then "excl. VAT").
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');

const KEY = 'billing';

const TEXT_FIELDS = {
  legalName: { max: 200, env: 'INVOICE_SELLER_NAME' },
  taxId: { max: 20, env: 'INVOICE_SELLER_TAX_ID' },
  address: { max: 400, env: 'INVOICE_SELLER_ADDRESS' },
  email: { max: 255, env: 'INVOICE_SELLER_EMAIL' },
  bankName: { max: 200, env: 'INVOICE_BANK_NAME' },
  accountHolder: { max: 200, env: 'INVOICE_BANK_ACCOUNT_HOLDER' },
  iban: { max: 34, env: 'INVOICE_BANK_IBAN' },
  swift: { max: 11, env: 'INVOICE_BANK_SWIFT' },
};

/** What an invoice needs before somebody can pay it. */
const REQUIRED = ['legalName', 'taxId', 'address', 'bankName', 'iban', 'swift'];

const env = (key) => String(process.env[key] || '').trim();
const compact = (v) => String(v || '').replace(/\s+/g, '').toUpperCase();

/** ISO 13616: move the country and check digits to the end, letters to numbers, mod 97 = 1. */
function ibanValid(raw) {
  const iban = compact(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const digits = `${iban.slice(4)}${iban.slice(0, 4)}`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}

const swiftValid = (raw) => /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(compact(raw));

/** "AZ21NABZ0000…" → "AZ21 NABZ 0000 …", the way it is read and typed. */
const groupIban = (iban) => compact(iban).replace(/(.{4})(?=.)/g, '$1 ');

async function readStored() {
  const r = await db.query('SELECT value, updated_at FROM platform_settings WHERE key = $1', [KEY]);
  return { value: (r.rows[0] && r.rows[0].value) || {}, updatedAt: r.rows[0] ? r.rows[0].updated_at : null };
}

/**
 * The settings as they apply: the owner's value, else the environment's.
 * `stored` is what the owner saved, without the fallback, for the form.
 */
function view(stored = {}, updatedAt = null) {
  const out = {};
  for (const [field, spec] of Object.entries(TEXT_FIELDS)) {
    const own = typeof stored[field] === 'string' ? stored[field].trim() : '';
    let value = own || env(spec.env);
    if (field === 'address' && !own) value = value.split('|').map((s) => s.trim()).filter(Boolean).join('\n');
    if (field === 'iban' || field === 'swift') value = compact(value);
    out[field] = value;
  }
  if (!out.email) out.email = env('SALES_NOTIFY_EMAIL');
  const vatRegistered = stored.vatRegistered === true;
  const rate = Number(stored.vatRatePercent);
  const vatRatePercent = vatRegistered && Number.isFinite(rate) && rate > 0 ? rate : null;
  const missing = REQUIRED.filter((f) => !out[f]);
  return {
    ...out,
    addressLines: out.address ? out.address.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [],
    ibanGrouped: out.iban ? groupIban(out.iban) : '',
    vatRegistered: Boolean(vatRegistered && vatRatePercent),
    vatRatePercent,
    ready: missing.length === 0,
    missing,
    bankReady: Boolean(out.iban && out.bankName),
    updatedAt,
    stored: Object.fromEntries(Object.entries(stored).filter(([k]) => k in TEXT_FIELDS || k === 'vatRegistered' || k === 'vatRatePercent')),
  };
}

/** The seller's details as they apply now. */
async function getBilling() {
  const { value, updatedAt } = await readStored();
  return view(value, updatedAt);
}

/**
 * PUT /api/owner/settings/billing — any of the fields; one left out keeps its
 * value, an empty string clears it. IBAN and SWIFT are checked and kept
 * without spaces; the VÖEN is ten digits.
 */
async function setBilling(body = {}, actorId = null) {
  const { value: current } = await readStored();
  const next = { ...current };
  const errors = [];
  for (const [field, spec] of Object.entries(TEXT_FIELDS)) {
    if (body[field] === undefined) continue;
    if (body[field] !== null && typeof body[field] !== 'string') { errors.push({ field, message: 'Text, please.' }); continue; }
    let v = String(body[field] || '').trim();
    if (field === 'iban' || field === 'swift') v = compact(v);
    if (v.length > spec.max) { errors.push({ field, message: `At most ${spec.max} characters.` }); continue; }
    if (v && field === 'iban' && !ibanValid(v)) errors.push({ field, message: 'This IBAN does not check out. It looks like AZ21 NABZ 0000 0000 1370 1000 1944.' });
    if (v && field === 'swift' && !swiftValid(v)) errors.push({ field, message: 'A SWIFT/BIC code is 8 or 11 letters and digits, like NABZAZ2X.' });
    if (v && field === 'taxId' && !/^\d{10}$/.test(v)) errors.push({ field, message: 'A VÖEN is ten digits.' });
    if (v && field === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors.push({ field, message: 'Not an e-mail address.' });
    next[field] = v;
  }
  if (body.vatRegistered !== undefined) {
    if (typeof body.vatRegistered !== 'boolean') errors.push({ field: 'vatRegistered', message: 'true or false.' });
    else next.vatRegistered = body.vatRegistered;
  }
  if (body.vatRatePercent !== undefined) {
    const rate = body.vatRatePercent === null || body.vatRatePercent === '' ? null : Number(body.vatRatePercent);
    if (rate !== null && (!Number.isFinite(rate) || rate <= 0 || rate > 50)) errors.push({ field: 'vatRatePercent', message: 'A rate between 0 and 50 per cent.' });
    else next.vatRatePercent = rate;
  }
  if (next.vatRegistered === true && !(Number(next.vatRatePercent) > 0)) {
    errors.push({ field: 'vatRatePercent', message: 'Give the VAT rate (18 in Azerbaijan).' });
  }
  if (errors.length) throw httpError(400, 'Some fields need attention.', 'VALIDATION_ERROR', { errors });
  await db.query(
    `INSERT INTO platform_settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [KEY, JSON.stringify(next), actorId],
  );
  return getBilling();
}

/** VAT on an amount, in minor units, under these settings (0 when not registered). */
function taxFor(amountMinor, billing) {
  if (amountMinor == null || !billing || !billing.vatRegistered) return 0;
  return Math.round((Number(amountMinor) * Number(billing.vatRatePercent)) / 100);
}

/** What the public price list says about VAT. */
const vatPolicy = (billing) => ({
  registered: Boolean(billing && billing.vatRegistered),
  ratePercent: billing && billing.vatRegistered ? billing.vatRatePercent : null,
});

/**
 * The one VAT line, bilingual for the invoice: the rate when VAT is charged,
 * otherwise that the seller is not VAT-registered.
 */
function vatLine(billing) {
  return billing && billing.vatRegistered
    ? `ƏDV ${billing.vatRatePercent}% · VAT ${billing.vatRatePercent}%`
    : 'ƏDV ödəyicisi deyil · Not VAT-registered, no VAT charged';
}

/** What a buyer may see to pay: the account, never the owner's form. */
function payTo(billing) {
  return {
    ready: billing.ready,
    legalName: billing.legalName || null,
    taxId: billing.taxId || null,
    bankName: billing.bankName || null,
    accountHolder: billing.accountHolder || billing.legalName || null,
    iban: billing.iban || null,
    ibanGrouped: billing.ibanGrouped || null,
    swift: billing.swift || null,
    vat: vatPolicy(billing),
  };
}

module.exports = {
  getBilling, setBilling, view, taxFor, vatPolicy, vatLine, payTo, ibanValid, swiftValid, groupIban, REQUIRED,
};
