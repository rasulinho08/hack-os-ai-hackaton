# Orders, plans and modules

How somebody becomes a customer, and what they get.

## The flow

One vocabulary for an order, the same in checkout, e-mails, the buyer's
account and the console (AZ/EN/RU): **received → under review → approved ·
active → paid**, or **refused** / **cancelled** (and refunded). Payment is a
separate chip beside the status: *awaiting payment* once invoiced, *paid*
once recorded.

One payment rule: **bank transfer against an invoice. The invoice is issued
when the order is approved and is due 14 days later**, paid with the order
code as the reference. Before approval the buyer can download an *order
confirmation* (not an invoice — it says "do not pay yet"); a refused order
never takes an invoice number.

1. **Checkout** (`POST /api/checkout`, signed in). The buyer picks a plan and
   a period, the organisation (one of theirs, or a new one) and accepts the
   Terms of use and Refund policy.

   ```
   { plan, billingPeriod, organisation | customerId, vatId?, country?, city?,
     eventName?, payment: { method: 'bank_transfer' }, acceptTerms: true,
     termsVersion?, idempotencyKey?, lang? }
   ```

   - **Terms** — `acceptTerms: true` is required (400 `TERMS_REQUIRED`). The
     order keeps `terms_accepted_at` and `terms_version` (the date the legal
     pages last changed, `src/constants/legal.js`, the same value as
     `LEGAL_UPDATED` in the web app). A page showing older terms is told to
     reload (409 `TERMS_CHANGED`).
   - **One attempt, one order** — the web app sends an `idempotencyKey` per
     checkout attempt (or the `Idempotency-Key` header). The same key again
     answers 200 with the order it made (`replayed: true`) and sends no
     e-mail; the same key with a different plan, period or method is 409
     `IDEMPOTENCY_MISMATCH`. A buyer's checkouts run one at a time, so a
     double click makes one organisation and one order.
   - **The organisation** — a returning buyer sends `customerId`, one of the
     organisations they are a contact of (anything else is 404). Typing the
     name of one of their own organisations is that organisation. VÖEN, city
     and country typed for an existing organisation are saved on it (owners
     only; a colleague gets 403 `BILLING_OWNER_ONLY`). A new name that another
     customer already uses is 409 `ORGANISATION_NAME_TAKEN`: the buyer is
     asked to get an invitation from its owner or to give the full registered
     name. Nothing is ever renamed for them.
   - **Price and VAT** — the price comes from `src/constants/plans.js`; VAT
     (`tax_minor`) from the seller's VAT setting (below).
   - **Payment** — bank transfer. A card is refused (400 `CARD_UNAVAILABLE`)
     while no card provider is configured; see *Taking cards*.

   A new organisation is created with status `pending_review`. The buyer gets
   no new role yet and cannot create events. The receipt (in the buyer's
   language, `orders.locale`) and a sales alert go out by e-mail.
2. **Review** — the owner console lists the order. Three decisions:
   - **Approve** (`POST /api/orders/:id/approve`): order → active
     (`delivered`), organisation → `active`, buyer → organiser of it, seats
     raised to the plan's, the plan's **entitlement** granted, the **invoice**
     issued (`INV-YYYY-NNNN`, due in 14 days) and — only for an organisation
     that is not set up yet — a **setup link** (72 hours, one use). The
     approval e-mail carries the invoice, the bank details and the link. A
     renewal or second order of an organisation that is already set up gets
     no setup link (`setupSkipped: true`). The response also carries the
     link, so the owner can pass it on if e-mail is not configured.
   - **Refuse** (`POST /api/orders/:id/reject {reason}`): order → cancelled,
     the reason is shown to the buyer and e-mailed; an organisation that only
     existed for this order is closed (and reviewed again if the buyer orders
     for it once more).
   - **Record payment** (`POST /api/orders/:id/payment {method, reference?,
     paidAt?}`): placed → paid, or on an active order just the payment.
     Activation and payment are independent.
   - **Issue invoice** (`POST /api/orders/:id/invoice`) stays available for
     an accounts department that needs the invoice before approval.
3. **Setup** (`/setup/<token>` in the web app, `GET|POST /api/setup/:token`):
   the buyer signs in with the address the link was sent to and sets the
   organisation's name, time zone, language, colour, logo and website.
   A new link:
   - the owner: `POST /api/orders/:id/setup-link` (order page) or
     `POST /api/customers/:id/setup-link` (organisation page, latest approved
     order);
   - the buyer, from an expired or replaced link: `POST /api/setup/:token/renew`
     sends a new one to the address the old one went to;
   - the buyer, from their account: `POST /api/me/organisations/:id/setup-link`
     (an owner of the organisation, to their own address).

   The buyer's two ways are limited to one link per organisation every five
   minutes (429 `SETUP_RECENT`) and end once the organisation is set up
   (409 `SETUP_DONE`). A link replaced by a newer one reads `revoked`, and the
   page says so instead of "expired".

`PATCH /api/orders/:id/status` still works and routes `delivered`, `paid`
and refusing a placed order through the actions above, so no request can
skip their side effects. Cancelling or refunding an active order revokes its
entitlement.

## Prices

`src/constants/plans.js` is the price; the pricing page and checkout render
`GET /api/checkout/plans`, which also says which payment methods are on
(`payment.methods`), whether VAT is added (`vat`) and the terms version.

An annual plan never costs more than its events bought one by one:
`annual ≈ eventsPerYear × per_event × 0.8`, rounded to a clean price —
Starter ₼790 (2 × ₼490), Professional ₼7,150 (6 × ₼1,490), Business
₼39,000 (20 × ₼3,900 would be ₼78,000). `tests/commerce.test.js` fails if an
annual price ends up above its events. Change the web app's
`src/app/(site)/_plans.ts` with it; it is only the fallback while the page
loads.

## Seller details, bank account and VAT

Owner console → **Settings → Billing and invoices** (`GET|PUT
/api/owner/settings/billing`, stored in `platform_settings` under `billing`):

| Field | On the invoice and in the payment instructions |
| --- | --- |
| `legalName`, `taxId` (VÖEN, 10 digits), `address` (one line per row), `email` | the seller block |
| `bankName`, `accountHolder`, `iban` (checked, mod 97), `swift` | the payment details |
| `vatRegistered`, `vatRatePercent` | the one VAT line |

Until legal name, VÖEN, address, bank, IBAN and SWIFT are all filled in, the
owner overview shows a warning and the invoice says the bank details follow
by e-mail. The `INVOICE_*` environment settings (`.env.example`) still fill
any field left empty.

VAT: **not registered** (the default) — no VAT is charged and every page says
"VAT not charged (the seller is not VAT-registered)"; **registered at a rate**
— checkout adds that rate to the plan price (`tax_minor`), and prices read
"excl. VAT". Changing the setting never rewrites an order already placed.

The buyer's account (`GET /api/me/orders`) carries `seller`: the account to
pay into, as the invoice prints it.

## Contact and legal signals (web app)

- `NEXT_PUBLIC_CONTACT_EMAIL` — the public contact address (footer, /contact,
  legal pages). Unset, the address the site has always shown stands.
- `NEXT_PUBLIC_LEGAL_NAME`, `NEXT_PUBLIC_LEGAL_TAX_ID` — once set, the footer of
  every marketing page shows the legal name and VÖEN, as the legal pages do.
- Enterprise and "talk to us" buttons open `/contact?topic=enterprise`, which
  marks the enquiry as an Enterprise one; there are no `mailto:` sales buttons.

## Taking cards

There is no card provider today, so checkout offers bank transfer only and
the API refuses a card. Card orders placed before this keep working in the
console: they show "card not charged — collect by invoice", approval invoices
them like any other order and the approval e-mail asks for a bank transfer.

To plug a provider in:

1. Write the adapter, e.g. `src/services/payments/<provider>.js`, and register
   it at start-up: `require('./cardPayments').registerProvider('<provider>',
   { startPayment(order) { … } })`. It creates the provider's payment for the
   order (hosted page or token from the provider's own card field — the card
   number must still never reach this API).
2. Set `PAYMENT_CARD_PROVIDER=<provider>`. A name nobody registered keeps card
   off (fail closed).
3. In `checkout.service.placeOrder`, after the order is created, call the
   adapter and return what the web app needs to complete the payment; on the
   provider's webhook, call `orderLifecycle.recordPayment(id, null,
   { method: 'card', reference })`.
4. The web app shows the card option as soon as `payment.methods` includes
   `card` (`/api/checkout/plans`); replace `checkout/_card-form.tsx` with the
   provider's field and drop the brand/last-four summary.

## Entitlements

| | Per event | Annual |
| --- | --- | --- |
| Events | 1 | Starter 2, Professional 6, Business 20, Enterprise unlimited |
| Valid | the event must start within 12 months | 12 months |

Each new event takes one event from the entitlement that runs out soonest
(`events.entitlement_id`). With nothing left the API answers
`402 NO_EVENT_CREDIT`; an event starting after the plan ends gets
`422 EVENT_OUTSIDE_PLAN`. Deleting an event that was never published gives
the event back.

Limits copied from the plan at approval (`src/constants/plans.js`):

| | Starter | Professional | Business | Enterprise |
| --- | --- | --- | --- | --- |
| Participants per event | 150 | 500 | 2 000 | unlimited |
| Organisation seats | 3 | 10 | 25 | unlimited |
| Storage | 1 GB | 5 GB | 20 GB | agreed |

**Plan-exempt organisations** — every organisation that existed when plans
arrived — have unlimited events and every module until the owner turns the
exemption off (`PUT /api/customers/:id/plan-exempt`). The owner's own events
and events from before plans are unlimited too.

## Modules

`src/constants/modules.js` lists which plans include which module (S, P, B,
E). An event has the modules of the plan it was created under; the owner can
switch a module on or off for one organisation
(`PUT /api/customers/:id/modules/:key {enabled: true|false|null}`, `null`
returns to the plan). The API refuses a disabled module with
`403 MODULE_DISABLED` (`requireModule`); today that guards mentors and help
tickets, volunteers, presentations, resources and certificates. On routes
without `:eventId` the guard checks the event named in the body (else
`?eventId=`); a request naming two different events is refused with
`400 EVENT_MISMATCH`. The web app reads `GET /api/events/:eventId/modules`
to draw the locks.

## Invoices

`GET /api/me/orders/:id/invoice.pdf` (members of the order's organisation)
and `GET /api/orders/:id/invoice.pdf` (owner). Bilingual AZ/EN, generated on
request from the order, so it always shows the current payment state:

- with an invoice number: **HESAB-FAKTURA / INVOICE**, issued and due dates,
  the seller and bank details from the billing settings (or "details follow
  by e-mail" while they are missing), the VAT line, PAID once recorded;
- before approval: **SİFARİŞ TƏSDİQİ / ORDER CONFIRMATION · NOT AN INVOICE**,
  "do not pay yet";
- refused, cancelled or refunded: says so, nothing to pay.

An issued invoice does not change. When the invoice number is issued (on
approval, or by "Issue invoice") the order keeps `invoice_snapshot`: the
buyer's billing details, the seller block (legal name, VÖEN, address, bank,
account holder, IBAN, SWIFT, VAT status), the amounts and the VAT line. The
PDF of an invoiced order is drawn from it, so a later change to the
organisation or the billing settings never rewrites an invoice already sent.
The order confirmation, and invoices issued before snapshots existed
(migration 0037), read the live data.
