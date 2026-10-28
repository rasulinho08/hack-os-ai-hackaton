/**
 * @file eventBuilder.service.js
 * @description The event builder: a draft made from a template, saved one
 * field at a time while the organiser works through twenty sections, checked
 * against a publish checklist, and published — which is when it takes one
 * event from the organisation's plan.
 *
 *   createDraft   template → draft event (status 'draft', not public)
 *   getBuilder    everything the builder shows, in one answer
 *   patchEvent    save some fields (autosave); answers the new checklist
 *   publish       checklist must have no errors; takes the plan credit
 *   unpublish     hides the page; the credit stays with the event
 *   publicEvent   what /e/<slug> shows to anyone
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const eventService = require('./event.service');
const { openEvent } = require('../utils/secretBox');
const entitlementService = require('./entitlement.service');
const registrationForm = require('./registrationForm.service');
const eventLists = require('./eventLists.service');
const { readBuilderFields, reconcileTimeline, withDefaults, isTimeZone } = require('./eventBuilderInput');
const { buildChecklist, isReady } = require('./eventChecklist');
const { buildTemplate, TEMPLATE_KEYS } = require('./eventTemplates');
const { uniqueSlug, slugTaken, uniqueCode, rememberSlugChange, eventIdFromOldSlug } = require('./eventIdentity');
const { capacity, registrationState, teamFormationInfo } = require('./eventRegistration.service');
const { fileUrl } = require('./file.service');
const { CONFIG_DEFAULTS, LANGUAGES } = require('../constants/eventBuilder');

const JSON_COLUMNS = new Set([
  'eligibility', 'faq', 'submission_config', 'judging_config', 'mentor_config', 'presentation_config',
  'comms_config', 'certificate_config', 'builder_state',
]);

/** Columns the builder writes through normalizeEventInput (dates, sizes, name…). */
const CORE_KEYS = [
  'name', 'eventName', 'description', 'start_date', 'startDate', 'end_date', 'endDate',
  'registration_start', 'registrationStart', 'registration_end', 'registrationEnd',
  'submission_deadline', 'submissionDeadline', 'demo_day', 'demoDay',
  'team_size_limit', 'teamSizeLimit', 'maxTeamSize', 'min_team_size', 'minTeamSize',
  'allow_team_formation', 'allowTeamFormation', 'require_submission', 'requireSubmission',
  'allow_late_submissions', 'allowLateSubmissions',
];
const CORE_COLUMNS = [
  'name', 'description', 'start_date', 'end_date', 'registration_start', 'registration_end',
  'submission_deadline', 'demo_day', 'team_size_limit', 'min_team_size',
  'allow_team_formation', 'require_submission', 'allow_late_submissions',
];
/** Never set through the builder's save: each has its own route or is the server's. */
const PROTECTED_KEYS = [
  'is_published', 'isPublished', 'status', 'event_code', 'eventCode', 'customer_id', 'customerId',
  'entitlement_id', 'entitlementId', 'created_by', 'createdBy', 'published_at', 'publishedAt', 'template', 'id',
];

/** Builder columns that need a module of the plan. */
const MODULE_OF = {
  brand_color: 'branding',
  logo_file_id: 'branding',
  banner_file_id: 'branding',
  judging_config: 'judging',
  mentor_config: 'mentors',
  presentation_config: 'presentations',
  certificate_config: 'certificates',
  submission_config: 'submissions',
};

// ── Shapes ──────────────────────────────────────────────────────────────────

/** The event as the builder sees it: settings merged over their defaults. */
function presentEvent(e) {
  if (!e) return null;
  const out = { ...openEvent(e) };
  for (const key of Object.keys(CONFIG_DEFAULTS)) out[key] = withDefaults(key, e[key]);
  out.faq = Array.isArray(e.faq) ? e.faq : [];
  out.builder_state = e.builder_state && typeof e.builder_state === 'object' ? e.builder_state : {};
  out.logo_url = fileUrl(e.logo_file_id);
  out.banner_url = fileUrl(e.banner_file_id);
  // Where the event is now, in the same words as the home and the header.
  // eslint-disable-next-line global-require
  out.phase = require('./eventOverview.service').phaseOf(e).key;
  return out;
}

const withLogo = (s) => ({ ...s, logo_url: s.logo_file_id ? fileUrl(s.logo_file_id) : s.logo || null });

async function staffFor(eventId) {
  const [judges, mentors, volunteers, invites] = await Promise.all([
    db.query(
      `SELECT j.id, j.user_id, u.full_name, u.email, j.assigned_at
         FROM judges j JOIN users u ON u.id = j.user_id WHERE j.event_id = $1 ORDER BY j.assigned_at`,
      [eventId],
    ),
    db.query(
      `SELECT m.id, m.user_id, u.full_name, u.email, m.expertise, m.availability, m.assigned_at
         FROM mentor_assignments m JOIN users u ON u.id = m.user_id WHERE m.event_id = $1 ORDER BY m.assigned_at`,
      [eventId],
    ),
    db.query(
      `SELECT v.id, v.user_id, u.full_name, u.email, v.assigned_tasks, v.created_at
         FROM volunteers v JOIN users u ON u.id = v.user_id WHERE v.event_id = $1 ORDER BY v.created_at`,
      [eventId],
    ),
    // awaiting_verification: an account with this address exists but has not
    // confirmed it, so the invitation waits for that (emailVerification.service).
    db.query(
      `SELECT i.id, i.email, i.role, i.meta, i.created_at, i.sent_at,
              EXISTS (SELECT 1 FROM users u WHERE LOWER(TRIM(u.email)) = LOWER(TRIM(i.email))
                       AND u.email_verified_at IS NULL) AS awaiting_verification
         FROM event_invites i
        WHERE i.event_id = $1 AND i.used_at IS NULL AND i.role IN ('judge', 'mentor', 'volunteer')
        ORDER BY i.created_at`,
      [eventId],
    ),
  ]);
  return { judges: judges.rows, mentors: mentors.rows, volunteers: volunteers.rows, invites: invites.rows };
}

/** The counts the checklist needs. */
async function checklistContext(eventId, fieldsRows = null) {
  const [scope, fields, counts] = await Promise.all([
    entitlementService.forEvent(eventId),
    fieldsRows ? Promise.resolve(fieldsRows) : registrationForm.listFields(eventId),
    db.query(
      `SELECT (SELECT COUNT(*)::int FROM scoring_criteria WHERE event_id = $1) AS criteria,
              (SELECT COUNT(*)::int FROM prizes WHERE event_id = $1) AS prizes,
              (SELECT COUNT(*)::int FROM judges WHERE event_id = $1)
                + (SELECT COUNT(*)::int FROM event_invites WHERE event_id = $1 AND role = 'judge' AND used_at IS NULL) AS judges`,
      [eventId],
    ),
  ]);
  const byKey = Object.fromEntries(fields.map((f) => [f.field_key, f]));
  const fieldState = (k) => (byKey[k] ? { enabled: byKey[k].enabled, required: byKey[k].required } : null);
  return {
    scope,
    ctx: {
      modules: scope ? scope.modules : null,
      participantLimit: scope ? scope.limits.participants : null,
      counts: {
        ...counts.rows[0],
        fields: { university: fieldState('university'), age: fieldState('age'), country: fieldState('country') },
        emptySelects: fields
          .filter((f) => f.kind === 'custom' && f.enabled && ['select', 'multiselect'].includes(f.type)
            && (!Array.isArray(f.options) || f.options.length === 0))
          .map((f) => f.label || f.field_key),
      },
    },
  };
}

async function checklistFor(eventRow, fieldsRows = null) {
  const { scope, ctx } = await checklistContext(eventRow.id, fieldsRows);
  return { items: buildChecklist(eventRow, ctx), scope };
}

// ── Read ────────────────────────────────────────────────────────────────────

async function getBuilder(eventId) {
  const e = await eventService.getEventById(eventId);
  if (!e) return null;
  const [fields, tracks, prizes, sponsors, criteria, staff, resources, refs] = await Promise.all([
    registrationForm.listFields(eventId),
    eventLists.listTracks(eventId),
    eventLists.listPrizes(eventId),
    eventLists.listSponsors(eventId),
    eventLists.listCriteria(eventId),
    staffFor(eventId),
    db.query('SELECT * FROM event_resources WHERE event_id = $1 ORDER BY sort_order, id', [eventId]),
    db.query(
      `SELECT COALESCE(ref_source, 'direct') AS source, COUNT(*)::int AS registrations
         FROM participants WHERE event_id = $1 GROUP BY 1 ORDER BY 2 DESC`,
      [eventId],
    ),
  ]);
  const { items, scope } = await checklistFor(e, fields);
  return {
    event: presentEvent(e),
    fields,
    tracks,
    prizes,
    sponsors: sponsors.map(withLogo),
    criteria,
    staff,
    resources: resources.rows,
    plan: scope ? scope.plan : null,
    modules: scope ? [...scope.modules].sort() : [],
    limits: scope ? scope.limits : { participants: null, storageGb: null },
    checklist: items,
    ready: isReady(items),
    capacity: await capacity(e),
    refs: refs.rows,
  };
}

// ── Create ──────────────────────────────────────────────────────────────────

/**
 * A new draft from a template.
 * @param {object} user  req.user
 * @param {{ name: string, template?: string, timezone?: string, language?: string }} body
 * @param {object|null} org organisation the event belongs to (null: owner / legacy)
 */
async function createDraft(user, body, org) {
  const src = body && typeof body === 'object' ? body : {};
  const name = String(src.name ?? '').trim().replace(/\s+/g, ' ');
  const errors = [];
  if (name.length < 3 || name.length > 255) errors.push({ field: 'name', message: 'Give the event a name of 3 to 255 characters.' });
  const template = TEMPLATE_KEYS.includes(src.template) ? src.template : 'blank';
  const timeZone = src.timezone && isTimeZone(String(src.timezone)) ? String(src.timezone) : 'Asia/Baku';
  const language = LANGUAGES.includes(src.language) ? src.language : 'az';
  if (errors.length) throw httpError(400, errors[0].message, 'VALIDATION_ERROR', { errors });

  const tpl = buildTemplate(template, { timeZone, language });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const slug = await uniqueSlug(name, { exec: client });
    const code = await uniqueCode(name, client);
    const e = tpl.event;
    const cols = {
      event_code: code,
      name,
      slug,
      status: 'draft',
      is_published: false,
      created_by: user.id,
      customer_id: org ? org.id : null,
      ...e,
    };
    const keys = Object.keys(cols);
    const result = await client.query(
      `INSERT INTO events (${keys.join(', ')})
       VALUES (${keys.map((k, i) => (JSON_COLUMNS.has(k) ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(', ')})
       RETURNING id`,
      keys.map((k) => (JSON_COLUMNS.has(k) ? JSON.stringify(cols[k]) : cols[k])),
    );
    const eventId = result.rows[0].id;
    await registrationForm.insertFields(client, eventId, tpl.fields);
    await eventLists.seed(client, eventId, tpl);
    await client.query('COMMIT');
    return eventId;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── Save ────────────────────────────────────────────────────────────────────

async function assertFileRefs(eventId, values, errors) {
  const refs = [
    ['logo_file_id', values.logo_file_id, 'event_logo'],
    ['banner_file_id', values.banner_file_id, 'event_banner'],
    ['certificate_config.signatureFileId', values.certificate_config?.signatureFileId, 'signature'],
  ].filter(([, id]) => id);
  for (const [field, id, purpose] of refs) {
    const r = await db.query('SELECT 1 FROM files WHERE id = $1 AND event_id = $2 AND purpose = $3', [id, eventId, purpose]);
    if (!r.rows.length) errors.push({ field, message: 'Upload the file again.' });
  }
}

/**
 * Save the fields present in `body`. Returns the event and its checklist.
 * @param {number} eventId
 * @param {object} body
 * @param {{ isOwner?: boolean, actorId?: number|null }} [opts]
 */
async function patchEvent(eventId, body, { isOwner = false, actorId = null } = {}) {
  const existing = await eventService.getEventById(eventId);
  if (!existing) throw httpError(404, 'Event not found', 'NOT_FOUND');
  if (String(existing.status || '').toLowerCase() === 'archived') {
    throw httpError(409, 'An archived event can no longer be changed.', 'EVENT_ARCHIVED');
  }
  const src = Object.fromEntries(
    Object.entries(body && typeof body === 'object' ? body : {}).filter(([k]) => !PROTECTED_KEYS.includes(k)),
  );

  const errors = [];
  let core = {};
  if (CORE_KEYS.some((k) => Object.prototype.hasOwnProperty.call(src, k))) {
    try {
      const v = eventService.normalizeEventInput(src, existing);
      core = Object.fromEntries(CORE_COLUMNS.map((c) => [c, v[c]]));
    } catch (err) {
      if (err.statusCode === 400) errors.push(...(err.errors || [{ field: 'event', message: err.message }]));
      else throw err;
    }
  }
  const { values, errors: fieldErrors } = readBuilderFields(src, existing);
  errors.push(...fieldErrors);

  const scope = await entitlementService.forEvent(eventId);
  if (!isOwner && scope) {
    for (const col of Object.keys(values)) {
      const m = MODULE_OF[col];
      if (m && !scope.modules.has(m)) {
        throw httpError(403, 'This feature is not part of the plan this event runs on.', 'MODULE_DISABLED', { module: m });
      }
    }
    if (values.comms_config && !scope.modules.has('automations')) {
      const before = withDefaults('comms_config', existing.comms_config).auto;
      const changed = Object.keys(values.comms_config.auto).some((k) => values.comms_config.auto[k] !== before[k]);
      if (changed) throw httpError(403, 'Automatic announcements are part of the Professional plan and above.', 'MODULE_DISABLED', { module: 'automations' });
    }
  }
  await assertFileRefs(eventId, values, errors);
  if (values.slug && values.slug !== existing.slug && (await slugTaken(values.slug, eventId))) {
    errors.push({ field: 'slug', message: 'This link is taken by another event.' });
  }
  const merged = { ...existing, ...core, ...values };
  const supplied = new Set([
    ...Object.keys(values),
    ...CORE_COLUMNS.filter((c) => {
      const aliases = { start_date: ['startDate'], end_date: ['endDate'], registration_start: ['registrationStart'], registration_end: ['registrationEnd'], submission_deadline: ['submissionDeadline'], demo_day: ['demoDay'] }[c] || [];
      return [c, ...aliases].some((k) => Object.prototype.hasOwnProperty.call(src, k));
    }),
  ]);
  const timeline = reconcileTimeline(merged, supplied);
  errors.push(...timeline.errors);
  Object.assign(values, timeline.pulled);
  if (errors.length) {
    // One message per field, the first one found.
    const seen = new Set();
    const unique = errors.filter((e) => (seen.has(e.field) ? false : seen.add(e.field)));
    throw httpError(400, unique[0].message, 'VALIDATION_ERROR', { errors: unique });
  }

  const sets = { ...core, ...values };
  const keys = Object.keys(sets);
  let row = existing;
  if (keys.length) {
    const r = await db.query(
      `UPDATE events SET ${keys.map((k, i) => `${k} = ${JSON_COLUMNS.has(k) ? `$${i + 2}::jsonb` : `$${i + 2}`}`).join(', ')},
              updated_at = now()
        WHERE id = $1 RETURNING *`,
      [eventId, ...keys.map((k) => (JSON_COLUMNS.has(k) ? JSON.stringify(sets[k]) : sets[k]))],
    );
    row = (await eventService.getEventById(r.rows[0].id)) || r.rows[0];
    // The old address keeps leading here (/e/<old> redirects to the new one).
    if (sets.slug && existing.slug && sets.slug !== existing.slug) {
      await rememberSlugChange(eventId, existing.slug, sets.slug, { actorId });
    }
  }
  const { items } = await checklistFor(row);
  return { event: presentEvent(row), checklist: items, ready: isReady(items) };
}

// ── Publish ─────────────────────────────────────────────────────────────────

async function publish(eventId) {
  const e = await eventService.getEventById(eventId);
  if (!e) throw httpError(404, 'Event not found', 'NOT_FOUND');
  if (String(e.status || '').toLowerCase() === 'archived') {
    throw httpError(409, 'An archived event cannot be published.', 'EVENT_ARCHIVED');
  }
  const { items } = await checklistFor(e);
  if (!isReady(items)) {
    throw httpError(422, 'Some sections still need attention before the event can go public.', 'NOT_READY', {
      errors: items.filter((i) => i.severity === 'error'),
    });
  }

  let reserved = null;
  if (!e.entitlement_id && e.customer_id) {
    const org = (await db.query(
      'SELECT id, name, status, plan_exempt, archived_at FROM customers WHERE id = $1',
      [e.customer_id],
    )).rows[0];
    if (!org || org.archived_at || !entitlementService.LIVE_STATUSES.includes(org.status)) {
      throw httpError(403, 'Your organisation is not active, so its events cannot be published. Contact HackOS support.', 'ORG_INACTIVE');
    }
    reserved = await entitlementService.reserveEventCredit(org, { startDate: e.start_date });
  }
  try {
    await db.query(
      `UPDATE events
          SET is_published = true,
              status = CASE WHEN status IN ('draft', 'archived') THEN 'upcoming' ELSE status END,
              published_at = COALESCE(published_at, now()),
              entitlement_id = COALESCE(entitlement_id, $2),
              updated_at = now()
        WHERE id = $1`,
      [eventId, reserved],
    );
  } catch (err) {
    if (reserved) await entitlementService.releaseEventCredit(reserved).catch(() => {});
    throw err;
  }
  return getBuilder(eventId);
}

async function unpublish(eventId) {
  const r = await db.query(
    'UPDATE events SET is_published = false, updated_at = now() WHERE id = $1 RETURNING id',
    [eventId],
  );
  if (!r.rows[0]) throw httpError(404, 'Event not found', 'NOT_FOUND');
  return getBuilder(eventId);
}

// ── Public page ─────────────────────────────────────────────────────────────

/**
 * A published event by slug (or code), with everything its public page shows.
 * An address the event used to have finds it too; the answer then carries
 * `moved_from` (the address asked for) so the page can redirect to `slug`.
 */
async function publicEvent(slugOrCode) {
  const key = String(slugOrCode || '').trim();
  if (!key || key.length > 100) return null;
  let movedFrom = null;
  let r = await db.query(
    `SELECT e.id FROM events e
      WHERE (e.slug = LOWER($1) OR LOWER(e.event_code) = LOWER($1))
        AND e.is_published = true
        AND LOWER(TRIM(COALESCE(e.status::text, ''))) <> 'archived'
      ORDER BY (e.slug = LOWER($1)) DESC
      LIMIT 1`,
    [key],
  );
  if (!r.rows[0]) {
    const oldId = await eventIdFromOldSlug(key);
    if (!oldId) return null;
    r = await db.query(
      `SELECT e.id FROM events e
        WHERE e.id = $1 AND e.is_published = true AND e.slug IS NOT NULL
          AND LOWER(TRIM(COALESCE(e.status::text, ''))) <> 'archived'`,
      [oldId],
    );
    if (!r.rows[0]) return null;
    movedFrom = key.toLowerCase();
  }
  const eventId = r.rows[0].id;
  const e = await eventService.getPublicEventByIdentifier(String(eventId));
  if (!e) return null;
  const [tracks, prizes, sponsors, org, criteria, cap, fields] = await Promise.all([
    eventLists.listTracks(eventId),
    eventLists.listPrizes(eventId),
    eventLists.listSponsors(eventId),
    db.query(
      `SELECT c.name, c.logo_url FROM events ev JOIN customers c ON c.id = ev.customer_id WHERE ev.id = $1`,
      [eventId],
    ),
    eventLists.listCriteria(eventId),
    capacity({ ...e, max_participants: e.max_participants, waitlist_enabled: e.waitlist_enabled }),
    registrationForm.listFields(eventId),
  ]);
  const full = await eventService.getEventById(eventId);
  // The event's own look is a plan feature: without it the page wears the
  // platform's, as the builder's preview shows.
  const scope = await entitlementService.forEvent(eventId);
  const branded = Boolean(scope && scope.modules.has('branding'));
  return {
    ...e,
    ...(movedFrom ? { moved_from: movedFrom } : {}),
    brand_color: branded ? e.brand_color : null,
    eligibility: withDefaults('eligibility', e.eligibility),
    faq: Array.isArray(e.faq) ? e.faq : [],
    logo_url: branded ? fileUrl(e.logo_file_id) : null,
    banner_url: branded ? fileUrl(e.banner_file_id) : null,
    organiser: org.rows[0] ? { name: org.rows[0].name, logo_url: org.rows[0].logo_url || null } : null,
    tracks: tracks.map((t) => ({ id: t.id, name: t.name, description: t.description, sponsor_id: t.sponsor_id })),
    prizes: prizes.map((p) => ({ id: p.id, kind: p.kind, position: p.position, track_id: p.track_id, name: p.name, value: p.value, description: p.description })),
    sponsors: sponsors.map((s) => ({ id: s.id, name: s.name, tier: s.tier, website: s.website, description: s.description, logo_url: withLogo(s).logo_url })),
    criteria: criteria.map((c) => ({ name: c.name, description: c.description, weight: Number(c.weight), max_score: c.max_score })),
    submission: withDefaults('submission_config', full.submission_config),
    presentation: withDefaults('presentation_config', full.presentation_config),
    registration: {
      state: registrationState(e),
      ...cap,
      mode: e.registration_mode,
      approval: full.approval_mode,
      // Whether the form may still offer "create a team" / "join a team".
      teamFormation: teamFormationInfo(full),
    },
    form: fields.filter((f) => f.enabled).map(registrationForm.publicField),
    // What the page may offer beyond reading: "add to calendar" and the
    // photo gallery (for the event's people) are plan features; the projects
    // page is the organiser's choice.
    features: {
      calendar: !scope || scope.modules.has('calendar'),
      gallery: !scope || scope.modules.has('gallery'),
      // The projects page, once the organiser opened it and the results are out.
      // eslint-disable-next-line global-require
      projects: await require('./publicProjects.service').isOpen(eventId),
    },
  };
}

module.exports = {
  createDraft,
  getBuilder,
  patchEvent,
  publish,
  unpublish,
  publicEvent,
  presentEvent,
  checklistFor,
};
