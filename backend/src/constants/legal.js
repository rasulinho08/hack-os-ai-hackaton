/**
 * @file legal.js
 * @description The version of the terms a buyer accepts at checkout.
 *
 * It is the date the legal pages (terms of use, refund policy) were last
 * changed, the same value as `LEGAL_UPDATED` in the web app's
 * `src/lib/legal.ts`. Change both when the pages change: an order records the
 * version its buyer accepted, and a checkout that still shows the old pages is
 * asked to reload (409 TERMS_CHANGED) rather than recording the new version
 * against words the buyer never saw.
 */

const TERMS_VERSION = '2026-10-23';

module.exports = { TERMS_VERSION };
