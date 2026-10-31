/**
 * @file cardPayments.js
 * @description Whether checkout may take a card, and who would charge it.
 *
 * No card provider is connected today, so the answer is no: the checkout
 * offers bank transfer against an invoice only, and `POST /api/checkout`
 * refuses a card (400 CARD_UNAVAILABLE). A card form that cannot take the
 * money is worse than none — the buyer thinks they have paid.
 *
 * The card path is kept behind one setting so a real provider can be plugged
 * in later (docs/COMMERCE.md, "Taking cards"):
 *
 *   PAYMENT_CARD_PROVIDER=<name>   the provider to use; unset = no card
 *
 * The name must also be registered here with `registerProvider(name, adapter)`
 * by the module that talks to that provider. A name nobody registered fails
 * closed — card stays off — so a typo in the setting cannot put a card form in
 * front of buyers with nothing behind it.
 */

const providers = new Map();

/** The configured provider name, or null. */
function configuredName() {
  const v = String(process.env.PAYMENT_CARD_PROVIDER || '').trim().toLowerCase();
  return v || null;
}

/**
 * Make a provider available. `adapter` is what checkout will call once the
 * integration exists (for instance `startPayment(order)` returning the
 * provider's payment page); today only its presence is used.
 */
function registerProvider(name, adapter) {
  providers.set(String(name).trim().toLowerCase(), adapter || {});
}

/** The adapter for the configured provider, or null when card is off. */
function cardProvider() {
  const name = configuredName();
  if (!name || !providers.has(name)) return null;
  return { name, adapter: providers.get(name) };
}

const isCardEnabled = () => cardProvider() !== null;

/** The payment methods checkout offers, in the order it shows them. */
function paymentMethods() {
  return isCardEnabled() ? ['bank_transfer', 'card'] : ['bank_transfer'];
}

/** For the owner's health page: a provider named but not registered. */
function cardProblem() {
  const name = configuredName();
  if (name && !providers.has(name)) return `PAYMENT_CARD_PROVIDER is "${name}", but no such provider is installed; card payment is off.`;
  return null;
}

module.exports = { registerProvider, cardProvider, isCardEnabled, paymentMethods, cardProblem };
