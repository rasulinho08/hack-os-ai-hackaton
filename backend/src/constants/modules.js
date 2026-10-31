/**
 * @file modules.js
 * @description What each plan switches on.
 *
 * One row per module; `plans` lists the plans that include it as letters:
 * C community, S starter, P professional, B business, E enterprise. The
 * split is the one agreed with the owner (plan decision D1), revised in
 * October 2026: certificates came down to Starter, and the sponsor report,
 * branding and advanced analytics to Professional; webhooks stay Business
 * and up. Community has what Starter has.
 *
 * A module only ever moves down a tier. An organisation's modules are worked
 * out from its entitlements' plans each time they are asked for
 * (entitlement.service), so a move down adds access to the plans below and
 * takes nothing from anyone; moving one up would take it away from
 * customers who bought it, and needs a decision first.
 *
 * The platform owner can switch a
 * module on or off for a single organisation on top of this
 * (org_module_overrides), and organisations from before plans existed have
 * everything (customers.plan_exempt).
 *
 * The keys are the contract with the web app, which draws the lock icons
 * from them; the labels live there, in three languages.
 */

const MODULES = Object.freeze([
  { key: 'events', plans: 'CSPBE' },
  { key: 'registration', plans: 'CSPBE' },
  { key: 'participants', plans: 'CSPBE' },
  { key: 'teams', plans: 'CSPBE' },
  { key: 'submissions', plans: 'CSPBE' },
  { key: 'judging', plans: 'CSPBE' },
  { key: 'results', plans: 'CSPBE' },
  { key: 'announcements', plans: 'CSPBE' },
  { key: 'telegram', plans: 'CSPBE' },
  { key: 'analytics', plans: 'CSPBE' },
  { key: 'export', plans: 'CSPBE' },
  { key: 'mentors', plans: 'PBE' },
  { key: 'volunteers', plans: 'PBE' },
  { key: 'presentations', plans: 'PBE' },
  { key: 'resources', plans: 'PBE' },
  { key: 'certificates', plans: 'CSPBE' },
  { key: 'elimination', plans: 'PBE' },
  { key: 'forms', plans: 'PBE' },
  { key: 'automations', plans: 'PBE' },
  { key: 'bigscreen', plans: 'PBE' },
  // The post-event report (PDF) for the organiser and their sponsors.
  { key: 'reports', plans: 'PBE' },
  { key: 'analytics_adv', plans: 'PBE' },
  { key: 'branding', plans: 'PBE' },
  { key: 'calendar', plans: 'BE' },
  { key: 'chat', plans: 'BE' },
  { key: 'checkin', plans: 'BE' },
  { key: 'gallery', plans: 'BE' },
  { key: 'webhooks', plans: 'BE' },
  { key: 'support', plans: 'E' },
  { key: 'onprem', plans: 'E' },
]);

const MODULE_KEYS = MODULES.map((m) => m.key);
const PLAN_LETTER = Object.freeze({ community: 'C', starter: 'S', professional: 'P', business: 'B', enterprise: 'E' });

/** The modules a plan includes, before any per-organisation switch. */
function modulesForPlan(planId) {
  const letter = PLAN_LETTER[planId];
  return new Set(letter ? MODULES.filter((m) => m.plans.includes(letter)).map((m) => m.key) : []);
}

module.exports = { MODULES, MODULE_KEYS, PLAN_LETTER, modulesForPlan };
