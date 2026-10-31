/**
 * @file invoice.service.js
 * @description The invoice for an order, as a PDF.
 *
 * Bilingual (Azerbaijani first, English under it), A4, drawn with pdf-lib and
 * the Inter typeface embedded so ə, ğ, ı and ş print correctly. The fonts
 * are embedded whole: pdf-lib's subsetting drops glyphs from Inter (the text
 * extracts but does not render), which costs about 350 KB per invoice. Everything
 * on it comes from the order row and the seller settings below; nothing is
 * stored, so a regenerated invoice always matches the order as it stands
 * (paid or not).
 *
 * Seller details — legal name, VÖEN, address, bank, IBAN, SWIFT, VAT status —
 * are the owner's billing settings (billing.service.js; the `INVOICE_*`
 * environment settings fill any field left empty). While the bank details are
 * missing, the payment block says they follow by e-mail.
 *
 * Two documents, by whether the order has an invoice number:
 *
 *   - **Invoice** (HESAB-FAKTURA / INVOICE): issued when the order is
 *     approved, due 14 days later, with the account to pay into.
 *   - **Order confirmation** (SİFARİŞ TƏSDİQİ / ORDER CONFIRMATION): what a
 *     placed order has before then. It is not an invoice and says so — "do
 *     not pay yet; the invoice follows approval" — so nobody books or pays it.
 *
 * A discount is a line of its own under the plan (its code or campaign, and
 * the amount taken off); the subtotal is the price after it.
 *
 * Refused or cancelled orders carry that word across the payment block.
 */

const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { PLANS } = require('../constants/plans');
const { fonts } = require('../utils/pdfFonts');
const billingService = require('./billing.service');

/** The seller as the invoice prints it, from the billing settings. */
function sellerSettings(billing) {
  return {
    name: billing.legalName || 'HackOS',
    address: billing.addressLines || [],
    taxId: billing.taxId,
    email: billing.email,
    bank: {
      name: billing.bankName,
      holder: billing.accountHolder,
      iban: billing.ibanGrouped,
      swift: billing.swift,
    },
    vatNote: billingService.vatLine(billing),
  };
}

/** 149000 → "1 490.00 AZN". */
function money(minor, currency = 'AZN') {
  const n = Number(minor || 0) / 100;
  const [whole, frac] = n.toFixed(2).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${frac} ${currency}`;
}

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

const INK = rgb(0.08, 0.09, 0.11);
const INK2 = rgb(0.3, 0.32, 0.37);
const INK3 = rgb(0.45, 0.47, 0.52);
const LINE = rgb(0.88, 0.88, 0.9);
const BRAND = rgb(200 / 255, 16 / 255, 46 / 255);
const OK = rgb(15 / 255, 123 / 255, 72 / 255);

/**
 * @param {object} order   a row from order.service (with customer_* columns)
 * @param {object} customer the customers row (name, legal_name, vat_id, country, city, billing_email)
 * @returns {Promise<Uint8Array>}
 */
async function renderInvoicePdf(liveOrder, liveCustomer, billing = null) {
  const snap = liveOrder.invoice_number && liveOrder.invoice_snapshot ? liveOrder.invoice_snapshot : null;
  const order = snap
    ? {
      ...liveOrder,
      amount_minor: snap.amounts.amountMinor,
      tax_minor: snap.amounts.taxMinor,
      currency: snap.amounts.currency,
      // Snapshots from before discounts (version 1) have none.
      list_amount_minor: snap.amounts.listMinor,
      discount_minor: snap.amounts.discountMinor || 0,
      discount_label: snap.amounts.discountLabel || null,
      discount_status: snap.amounts.discountMinor ? 'applied' : null,
    }
    : liveOrder;
  const customer = snap ? snap.buyer : liveCustomer;
  const seller = sellerSettings(snap ? snap.seller : billing || await billingService.getBilling());
  const isInvoice = Boolean(order.invoice_number);
  const closed = ['cancelled', 'refunded'].includes(order.status);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const { regular: regularBytes, bold: boldBytes } = fonts();
  const regular = await doc.embedFont(regularBytes, { subset: false });
  const bold = await doc.embedFont(boldBytes, { subset: false });

  const number = order.invoice_number || order.order_code;
  doc.setTitle(`HackOS ${number}`);
  doc.setAuthor(seller.name);
  doc.setCreator('HackOS');
  doc.setProducer('HackOS');
  doc.setCreationDate(order.invoice_issued_at ? new Date(order.invoice_issued_at) : new Date());

  const W = 595.28;
  const H = 841.89;
  const M = 48;
  const page = doc.addPage([W, H]);
  let y = H - M;

  const text = (s, x, yy, { size = 9.5, font = regular, color = INK } = {}) =>
    page.drawText(String(s ?? ''), { x, y: yy, size, font, color });
  const right = (s, xRight, yy, opts = {}) => {
    const size = opts.size || 9.5;
    const font = opts.font || regular;
    text(s, xRight - font.widthOfTextAtSize(String(s ?? ''), size), yy, opts);
  };
  const rule = (yy, color = LINE) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: W - M, y: yy }, thickness: 0.8, color });

  // ── Header ───────────────────────────────────────────────────────────
  page.drawRectangle({ x: M, y: y - 22, width: 22, height: 22, color: BRAND });
  text('H', M + 6.2, y - 16.5, { size: 14, font: bold, color: rgb(1, 1, 1) });
  text('HackOS', M + 30, y - 16, { size: 15, font: bold });
  right(isInvoice ? 'HESAB-FAKTURA' : 'SİFARİŞ TƏSDİQİ', W - M, y - 10, { size: 15, font: bold });
  right(isInvoice ? 'INVOICE' : 'ORDER CONFIRMATION · NOT AN INVOICE', W - M, y - 24, { size: 9, color: INK3 });
  y -= 52;

  const paid = Boolean(order.paid_at);
  const meta = isInvoice
    ? [
      ['Faktura № · Invoice no.', number],
      ['Tarix · Issued', day(order.invoice_issued_at)],
      ['Son ödəniş tarixi · Due', day(order.invoice_due_at)],
      ['Sifariş · Order', order.order_code],
    ]
    : [
      ['Sifariş · Order', order.order_code],
      ['Tarix · Placed', day(order.placed_at || order.created_at)],
    ];
  let my = y;
  for (const [label, value] of meta) {
    text(label, W - M - 230, my, { size: 8.5, color: INK3 });
    right(value, W - M, my, { size: 9.5, font: bold });
    my -= 15;
  }

  // ── Parties ──────────────────────────────────────────────────────────
  text('SATICI · FROM', M, y, { size: 8, font: bold, color: INK3 });
  let sy = y - 15;
  text(seller.name, M, sy, { size: 10.5, font: bold });
  sy -= 14;
  for (const line of seller.address) { text(line, M, sy, { color: INK2 }); sy -= 12.5; }
  if (seller.taxId) { text(`VÖEN: ${seller.taxId}`, M, sy, { color: INK2 }); sy -= 12.5; }
  if (seller.email) { text(seller.email, M, sy, { color: INK2 }); sy -= 12.5; }

  y = Math.min(sy, my) - 18;
  text('ALICI · BILL TO', M, y, { size: 8, font: bold, color: INK3 });
  let by = y - 15;
  text(customer.legal_name || customer.name || order.customer_name || '', M, by, { size: 10.5, font: bold });
  by -= 14;
  if (customer.legal_name && customer.name && customer.legal_name !== customer.name) {
    text(customer.name, M, by, { color: INK2 }); by -= 12.5;
  }
  const place = [customer.city, customer.country].filter(Boolean).join(', ');
  if (place) { text(place, M, by, { color: INK2 }); by -= 12.5; }
  if (customer.vat_id) { text(`VÖEN / VAT: ${customer.vat_id}`, M, by, { color: INK2 }); by -= 12.5; }
  if (customer.billing_email) { text(customer.billing_email, M, by, { color: INK2 }); by -= 12.5; }

  // ── Line items ───────────────────────────────────────────────────────
  y = by - 22;
  page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 22, color: rgb(0.965, 0.965, 0.97) });
  text('Təsvir · Description', M + 10, y + 1.5, { size: 8.5, font: bold, color: INK2 });
  right('Say · Qty', W - M - 190, y + 1.5, { size: 8.5, font: bold, color: INK2 });
  right('Qiymət · Price', W - M - 95, y + 1.5, { size: 8.5, font: bold, color: INK2 });
  right('Məbləğ · Amount', W - M - 10, y + 1.5, { size: 8.5, font: bold, color: INK2 });
  y -= 26;

  const plan = PLANS[order.plan] || { name: order.plan };
  const annual = order.billing_period === 'annual';
  const amount = order.amount_minor == null ? 0 : Number(order.amount_minor);
  // The plan at its price, then the discount as its own line: the buyer's
  // accounts see what was taken off and why. A removed claim is not a line.
  const discount = Number(order.discount_minor) > 0 && order.discount_status !== 'removed' ? Number(order.discount_minor) : 0;
  const listAmount = discount && order.list_amount_minor != null ? Number(order.list_amount_minor) : amount;
  text(`HackOS ${plan.name} — ${annual ? 'illik abunə' : 'bir tədbir'}`, M + 10, y, { size: 10, font: bold });
  text(annual ? 'Annual subscription, 12 months' : 'One event, to be held within 12 months', M + 10, y - 13, { size: 8.5, color: INK3 });
  if (order.event_name) text(`Tədbir · Event: ${order.event_name}`, M + 10, y - 25, { size: 8.5, color: INK3 });
  right('1', W - M - 190, y, { size: 10 });
  right(money(listAmount, order.currency), W - M - 95, y, { size: 10 });
  right(money(listAmount, order.currency), W - M - 10, y, { size: 10, font: bold });
  y -= order.event_name ? 40 : 30;
  if (discount) {
    rule(y + 10);
    text('Endirim · Discount', M + 10, y - 4, { size: 10, font: bold });
    text(order.discount_label || '', M + 10, y - 17, { size: 8.5, color: INK3 });
    right(`−${money(discount, order.currency)}`, W - M - 10, y - 4, { size: 10, font: bold, color: OK });
    y -= 30;
  }
  rule(y);

  // ── Totals ───────────────────────────────────────────────────────────
  const tax = order.tax_minor == null ? null : Number(order.tax_minor);
  y -= 18;
  const totalsX = W - M - 230;
  text('Cəmi · Subtotal', totalsX, y, { color: INK2 });
  right(money(amount, order.currency), W - M - 10, y);
  y -= 15;
  if (tax != null && tax > 0) {
    const rate = amount > 0 ? Math.round((tax / amount) * 1000) / 10 : null;
    text(rate ? `ƏDV ${rate}% · VAT ${rate}%` : 'ƏDV · VAT', totalsX, y, { color: INK2 });
    right(money(tax, order.currency), W - M - 10, y);
  } else {
    // Azerbaijani and English on two lines when they do not fit beside the totals.
    if (regular.widthOfTextAtSize(seller.vatNote, 8.5) <= W - M - totalsX) {
      text(seller.vatNote, totalsX, y, { size: 8.5, color: INK3 });
    } else {
      const [az, en] = seller.vatNote.split(' · ');
      text(az, totalsX, y, { size: 8.5, color: INK3 });
      y -= 11;
      text(en || '', totalsX, y, { size: 8.5, color: INK3 });
    }
  }
  y -= 12;
  page.drawLine({ start: { x: totalsX, y }, end: { x: W - M, y }, thickness: 0.8, color: LINE });
  y -= 18;
  text('Yekun · Total', totalsX, y, { size: 11, font: bold });
  right(money(amount + (tax || 0), order.currency), W - M - 10, y, { size: 13, font: bold });

  // ── Payment ──────────────────────────────────────────────────────────
  y -= 40;
  if (closed && !paid) {
    page.drawRectangle({ x: M, y: y - 30, width: W - 2 * M, height: 44, color: rgb(0.965, 0.965, 0.97) });
    text(order.status === 'refunded' ? 'GERİ QAYTARILIB · REFUNDED' : (order.delivered_at ? 'LƏĞV EDİLİB · CANCELLED' : 'RƏDD EDİLİB · REFUSED'), M + 14, y - 4, { size: 12, font: bold, color: INK2 });
    text('Bu sifariş üzrə ödəniş tələb olunmur. · Nothing is to be paid for this order.', M + 14, y - 20, { size: 9, color: INK2 });
    y -= 50;
  } else if (!isInvoice && !paid) {
    text('ÖDƏNİŞ · PAYMENT', M, y, { size: 8, font: bold, color: INK3 });
    y -= 16;
    text('Hələ ödəməyin: sifariş təsdiqlənəndə hesab-faktura göndəriləcək, 14 gün ərzində ödənilir.', M, y, { size: 9.5 });
    y -= 13;
    text('Do not pay yet: the invoice follows when we approve the order, payable within 14 days of the invoice.', M, y, { size: 9, color: INK3 });
    y -= 14;
    if (order.payment_method === 'card') {
      text('Kartdan pul tutulmayıb; ödəniş hesab-faktura ilə bank köçürməsidir. · The card was not charged; payment is by bank transfer against the invoice.', M, y, { size: 8.5, color: INK3 });
      y -= 13;
    }
  } else if (paid) {
    page.drawRectangle({ x: M, y: y - 30, width: W - 2 * M, height: 44, color: rgb(0.93, 0.97, 0.95) });
    text('ÖDƏNİLİB · PAID', M + 14, y - 4, { size: 12, font: bold, color: OK });
    const how = { bank_transfer: 'bank köçürməsi · bank transfer', card: 'kart · card', cash: 'nağd · cash', other: 'digər · other' }[order.payment_method] || '';
    text(`${day(order.paid_at)}${how ? ` · ${how}` : ''}${order.payment_reference ? ` · ${order.payment_reference}` : ''}`, M + 14, y - 20, { size: 9, color: INK2 });
    y -= 50;
  } else {
    text('ÖDƏNİŞ MƏLUMATLARI · PAYMENT DETAILS', M, y, { size: 8, font: bold, color: INK3 });
    if (order.payment_method === 'card') {
      y -= 13;
      text('Kartdan pul tutulmayıb · The card was not charged: please pay by bank transfer.', M, y, { size: 8.5, color: INK3 });
    }
    y -= 16;
    const b = seller.bank;
    if (b.iban) {
      const rows = [
        ['Bank', b.name],
        ['Alan · Beneficiary', b.holder || seller.name],
        ['IBAN', b.iban],
        ['SWIFT', b.swift],
        ['Təyinat · Reference', order.order_code],
      ].filter(([, v]) => v);
      for (const [label, value] of rows) {
        text(label, M, y, { size: 9, color: INK3 });
        text(value, M + 130, y, { size: 9.5, font: bold });
        y -= 14;
      }
    } else {
      text('Bank rekvizitləri sizə ayrıca e-poçtla göndəriləcək.', M, y, { size: 9.5 });
      y -= 13;
      text('Bank details will be sent to you by e-mail.', M, y, { size: 9, color: INK3 });
      y -= 14;
      text(`Təyinat · Reference: ${order.order_code}`, M, y, { size: 9.5, font: bold });
      y -= 14;
    }
  }

  // ── Footer ───────────────────────────────────────────────────────────
  page.drawLine({ start: { x: M, y: M + 26 }, end: { x: W - M, y: M + 26 }, thickness: 0.6, color: LINE });
  text(seller.email ? `Suallar · Questions: ${seller.email}` : 'HackOS', M, M + 12, { size: 8, color: INK3 });
  right('hack-os.app', W - M, M + 12, { size: 8, color: INK3 });

  return doc.save();
}

module.exports = { renderInvoicePdf, sellerSettings, money };
