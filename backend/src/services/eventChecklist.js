/**
 * @file eventChecklist.js
 * @description What an event still lacks before it can go public.
 *
 * Pure: takes the event row and a few counts, returns a list. `error` items
 * block publishing (the publish endpoint refuses while any remain);
 * `warning` items are shown but do not block. Each item names the builder
 * section it belongs to, so the wizard can mark that section and take the
 * organiser straight to it, and carries a stable `code` the web app turns
 * into text in the organiser's language.
 */

const { checkTimeline, withDefaults } = require('./eventBuilderInput');

/**
 * @param {object} e        events row
 * @param {object} ctx
 * @param {Set<string>} ctx.modules         modules of the event's plan
 * @param {number|null} ctx.participantLimit the plan's participant limit (null = none)
 * @param {object} ctx.counts { criteria, prizes, judges, fields: { university: {enabled, required} }, emptySelects: [labels] }
 * @param {Date} [ctx.now]
 */
function buildChecklist(e, ctx) {
  const items = [];
  const add = (severity, section, code, params) => items.push({ severity, section, code, ...(params ? { params } : {}) });
  const now = (ctx.now || new Date()).getTime();
  const has = (m) => !ctx.modules || ctx.modules.has(m);
  const counts = ctx.counts || {};

  // basics
  if (!e.name || String(e.name).trim().length < 3) add('error', 'basics', 'name_missing');
  if (!e.tagline) add('error', 'basics', 'tagline_missing');
  if (!e.description || String(e.description).trim().length < 40) add('warning', 'basics', 'description_short');

  // brand
  if (has('branding')) {
    if (!e.logo_file_id) add('warning', 'brand', 'logo_missing');
    if (!e.banner_file_id) add('warning', 'brand', 'banner_missing');
  }

  // place
  if (e.format === 'offline' || e.format === 'hybrid') {
    if (!e.venue_name && !e.venue_address) add('error', 'place', 'venue_missing');
    if (!e.city) add('error', 'place', 'city_missing');
  }
  if ((e.format === 'online' || e.format === 'hybrid') && !e.online_url) add('warning', 'place', 'online_url_missing');

  // schedule
  if (!e.start_date || !e.end_date) add('error', 'schedule', 'dates_missing');
  if (!e.registration_start || !e.registration_end) add('error', 'schedule', 'registration_window_missing');
  // Each date out of order, with the date it clashes with: the builder links to the field.
  for (const err of checkTimeline(e)) add('error', 'schedule', 'timeline_order', { field: err.field, other: err.other, rel: err.rel });
  if (e.start_date && new Date(e.start_date).getTime() < now) add('warning', 'schedule', 'starts_in_past');
  else if (e.registration_end && new Date(e.registration_end).getTime() < now) add('warning', 'schedule', 'registration_closed');
  if (!e.submission_deadline && e.require_submission !== false) add('warning', 'schedule', 'submission_deadline_missing');

  // registration
  if ((e.registration_mode === 'team' || e.registration_mode === 'both') && Number(e.team_size_limit) < 2) {
    add('error', 'registration', 'team_size_too_small');
  }
  if (ctx.participantLimit != null && (e.max_participants == null || e.max_participants > ctx.participantLimit)) {
    add('warning', 'registration', 'capacity_capped_by_plan', { limit: ctx.participantLimit });
  }

  // eligibility ↔ form
  const elig = withDefaults('eligibility', e.eligibility);
  const uni = counts.fields?.university;
  if (elig.studentsOnly && !(uni && uni.enabled && uni.required)) add('error', 'eligibility', 'students_need_university');
  if ((elig.minAge != null || elig.maxAge != null) && !(counts.fields?.age?.enabled && counts.fields.age.required)) {
    add('error', 'eligibility', 'age_limit_needs_age');
  }
  if (elig.countries.length && !(counts.fields?.country?.enabled && counts.fields.country.required)) {
    add('error', 'eligibility', 'country_limit_needs_country');
  }
  if ((elig.requireRules) && !e.rules) add('error', 'share', 'rules_missing');

  // form
  for (const label of counts.emptySelects || []) add('error', 'form', 'field_options_missing', { label });

  // prizes
  if (!counts.prizes) add('warning', 'prizes', 'prizes_missing');

  // judging
  if (has('judging')) {
    if (!counts.criteria) add('warning', 'judging', 'criteria_missing');
    if (!counts.judges) add('warning', 'judges', 'judges_missing');
  }

  // certificates
  if (has('certificates')) {
    const cert = withDefaults('certificate_config', e.certificate_config);
    if (cert.types.length && !cert.signerName) add('warning', 'certificates', 'signer_missing');
  }

  // share
  if (!Array.isArray(e.faq) || e.faq.length === 0) add('warning', 'share', 'faq_missing');

  return items;
}

const isReady = (items) => !items.some((i) => i.severity === 'error');

module.exports = { buildChecklist, isReady };
