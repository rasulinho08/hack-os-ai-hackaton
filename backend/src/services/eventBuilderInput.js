/**
 * @file eventBuilderInput.js
 * @description Reads the builder's fields out of a request body.
 *
 * Pure functions, no database: every field is checked for shape and range
 * and comes back either as a value ready for the events row or as a
 * { field, message } error the web app shows next to that field. Only the
 * keys present in the body are read, so the wizard can save one field at a
 * time. Whether the event is complete enough to publish is a different
 * question, answered by eventChecklist.js.
 */

const {
  CATEGORIES, LANGUAGES, FORMATS, REGISTRATION_MODES, APPROVAL_MODES, VISIBILITIES,
  SUBMISSION_FIELDS, SUBMISSION_FIELD_STATES, SUBMISSION_FILE_TYPES, AUTO_ANNOUNCEMENTS,
  CERTIFICATE_TYPES, RESULTS_VISIBILITY, JUDGE_ASSIGNMENT, PRESENTATION_ORDER, CONFIG_DEFAULTS, SECTIONS,
} = require('../constants/eventBuilder');
const { seal } = require('../utils/secretBox');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** camelCase spelling of each column the web app may send. */
const ALIASES = {
  tagline: ['tagline', 'shortDescription'],
  category: ['category'],
  language: ['language'],
  brand_color: ['brand_color', 'brandColor'],
  logo_file_id: ['logo_file_id', 'logoFileId'],
  banner_file_id: ['banner_file_id', 'bannerFileId'],
  format: ['format'],
  venue_name: ['venue_name', 'venueName'],
  venue_address: ['venue_address', 'venueAddress'],
  city: ['city'],
  country: ['country'],
  map_url: ['map_url', 'mapUrl'],
  online_url: ['online_url', 'onlineUrl'],
  timezone: ['timezone'],
  team_deadline: ['team_deadline', 'teamDeadline'],
  judging_start: ['judging_start', 'judgingStart'],
  judging_end: ['judging_end', 'judgingEnd'],
  results_at: ['results_at', 'resultsAt'],
  registration_mode: ['registration_mode', 'registrationMode'],
  max_participants: ['max_participants', 'maxParticipants'],
  waitlist_enabled: ['waitlist_enabled', 'waitlistEnabled'],
  approval_mode: ['approval_mode', 'approvalMode'],
  eligibility: ['eligibility'],
  rules: ['rules'],
  faq: ['faq'],
  submission_config: ['submission_config', 'submissionConfig'],
  judging_config: ['judging_config', 'judgingConfig'],
  mentor_config: ['mentor_config', 'mentorConfig'],
  presentation_config: ['presentation_config', 'presentationConfig'],
  comms_config: ['comms_config', 'commsConfig'],
  certificate_config: ['certificate_config', 'certificateConfig'],
  slug: ['slug'],
  visibility: ['visibility'],
  directory_listed: ['directory_listed', 'directoryListed'],
  builder_state: ['builder_state', 'builderState'],
};

function present(src, col) {
  for (const k of ALIASES[col] || [col]) {
    if (Object.prototype.hasOwnProperty.call(src, k)) return { has: true, value: src[k] };
  }
  return { has: false, value: undefined };
}

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** Trimmed text, '' → null; refuses anything that is not a string or too long. */
function text(value, max, field, errors) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    errors.push({ field, message: 'Must be text.' });
    return undefined;
  }
  const s = String(value).trim();
  if (s.length > max) {
    errors.push({ field, message: `Must be ${max} characters or fewer.` });
    return undefined;
  }
  return s === '' ? null : s;
}

function oneOf(value, allowed, field, errors) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!allowed.includes(s)) {
    errors.push({ field, message: `Must be one of: ${allowed.join(', ')}.` });
    return undefined;
  }
  return s;
}

function bool(value, field, errors) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  errors.push({ field, message: 'Must be true or false.' });
  return undefined;
}

function int(value, { min, max, nullable = true }, field, errors) {
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    errors.push({ field, message: 'Required.' });
    return undefined;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    errors.push({ field, message: `Must be a whole number from ${min} to ${max}.` });
    return undefined;
  }
  return n;
}

function date(value, field, errors) {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    errors.push({ field, message: 'Not a valid date.' });
    return undefined;
  }
  return d;
}

/** http(s) links only: a javascript: link on a public page is an attack. */
function url(value, field, errors) {
  const s = text(value, 2000, field, errors);
  if (s == null) return s;
  let parsed;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
  } catch {
    errors.push({ field, message: 'Not a valid link.' });
    return undefined;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) {
    errors.push({ field, message: 'Links must start with http:// or https://.' });
    return undefined;
  }
  return parsed.toString();
}

let ZONES = null;
function isTimeZone(tz) {
  if (!ZONES) {
    try {
      ZONES = new Set(Intl.supportedValuesOf('timeZone'));
      ZONES.add('UTC');
    } catch {
      ZONES = new Set();
    }
  }
  if (ZONES.size) return ZONES.has(tz);
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

function uuidOrNull(value, field, errors) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    errors.push({ field, message: 'Not a valid file reference.' });
    return undefined;
  }
  return value.toLowerCase();
}

/** Merge a stored setting over its defaults so readers never meet a gap. */
function withDefaults(key, stored) {
  const def = CONFIG_DEFAULTS[key];
  const s = isPlainObject(stored) ? stored : {};
  const out = { ...def, ...s };
  for (const [k, v] of Object.entries(def)) {
    if (isPlainObject(v)) out[k] = { ...v, ...(isPlainObject(s[k]) ? s[k] : {}) };
  }
  return out;
}

// ── Nested settings ─────────────────────────────────────────────────────────

function readEligibility(v, existing, errors) {
  if (!isPlainObject(v)) { errors.push({ field: 'eligibility', message: 'Must be an object.' }); return undefined; }
  const base = withDefaults('eligibility', existing);
  const out = { ...base };
  const f = (k) => `eligibility.${k}`;
  if ('minAge' in v) out.minAge = int(v.minAge, { min: 10, max: 99 }, f('minAge'), errors);
  if ('maxAge' in v) out.maxAge = int(v.maxAge, { min: 10, max: 120 }, f('maxAge'), errors);
  if (out.minAge != null && out.maxAge != null && out.maxAge < out.minAge) {
    errors.push({ field: f('maxAge'), message: 'The maximum age must not be below the minimum.' });
  }
  if ('countries' in v) {
    if (!Array.isArray(v.countries) || v.countries.length > 60
        || !v.countries.every((c) => typeof c === 'string' && /^[A-Za-z]{2}$/.test(c))) {
      errors.push({ field: f('countries'), message: 'Use two-letter country codes, at most 60.' });
    } else out.countries = [...new Set(v.countries.map((c) => c.toUpperCase()))];
  }
  if ('cities' in v) {
    if (!Array.isArray(v.cities) || v.cities.length > 60
        || !v.cities.every((c) => typeof c === 'string' && c.trim() && c.trim().length <= 100)) {
      errors.push({ field: f('cities'), message: 'At most 60 cities, 100 characters each.' });
    } else out.cities = [...new Set(v.cities.map((c) => c.trim()))];
  }
  for (const k of ['studentsOnly', 'requireRules', 'requireCoc']) {
    if (k in v) out[k] = bool(v[k], f(k), errors);
  }
  return out;
}

function readFaq(v, errors) {
  if (!Array.isArray(v)) { errors.push({ field: 'faq', message: 'Must be a list.' }); return undefined; }
  if (v.length > 40) { errors.push({ field: 'faq', message: 'At most 40 questions.' }); return undefined; }
  const out = [];
  v.forEach((item, i) => {
    if (!isPlainObject(item)) { errors.push({ field: `faq.${i}`, message: 'Must have a question and an answer.' }); return; }
    const q = text(item.q ?? item.question, 300, `faq.${i}.q`, errors);
    const a = text(item.a ?? item.answer, 4000, `faq.${i}.a`, errors);
    if (q === undefined || a === undefined) return;
    if (!q && !a) return; // an empty row the organiser has not filled yet
    out.push({ q: q || '', a: a || '' });
  });
  return out;
}

function readSubmission(v, existing, errors) {
  if (!isPlainObject(v)) { errors.push({ field: 'submission_config', message: 'Must be an object.' }); return undefined; }
  const out = withDefaults('submission_config', existing);
  if ('fields' in v) {
    if (!isPlainObject(v.fields)) errors.push({ field: 'submission_config.fields', message: 'Must be an object.' });
    else {
      for (const [k, state] of Object.entries(v.fields)) {
        if (!SUBMISSION_FIELDS.includes(k)) { errors.push({ field: `submission_config.fields.${k}`, message: 'Unknown field.' }); continue; }
        const s = oneOf(state, SUBMISSION_FIELD_STATES, `submission_config.fields.${k}`, errors);
        if (s) out.fields[k] = s;
      }
    }
  }
  if ('files' in v) {
    const files = v.files;
    if (!isPlainObject(files)) errors.push({ field: 'submission_config.files', message: 'Must be an object.' });
    else {
      if ('enabled' in files) out.files.enabled = bool(files.enabled, 'submission_config.files.enabled', errors);
      // Files live in the database for now (file.service.js), so one file stays small.
      if ('maxMb' in files) out.files.maxMb = int(files.maxMb, { min: 1, max: 10, nullable: false }, 'submission_config.files.maxMb', errors);
      if ('types' in files) {
        if (!Array.isArray(files.types) || !files.types.every((t) => SUBMISSION_FILE_TYPES.includes(t))) {
          errors.push({ field: 'submission_config.files.types', message: `Allowed: ${SUBMISSION_FILE_TYPES.join(', ')}.` });
        } else out.files.types = [...new Set(files.types)];
      }
    }
  }
  if ('githubCheck' in v) out.githubCheck = bool(v.githubCheck, 'submission_config.githubCheck', errors);
  const linkAsked = SUBMISSION_FIELDS.some((k) => out.fields[k] !== 'off');
  if (!linkAsked && !out.files.enabled) {
    errors.push({ field: 'submission_config', message: 'Ask for at least one link or allow file uploads.' });
  }
  return out;
}

function readJudging(v, existing, errors) {
  if (!isPlainObject(v)) { errors.push({ field: 'judging_config', message: 'Must be an object.' }); return undefined; }
  const out = withDefaults('judging_config', existing);
  if ('blind' in v) out.blind = bool(v.blind, 'judging_config.blind', errors);
  if ('assignment' in v) out.assignment = oneOf(v.assignment, JUDGE_ASSIGNMENT, 'judging_config.assignment', errors);
  if ('judgesPerTeam' in v) out.judgesPerTeam = int(v.judgesPerTeam, { min: 1, max: 20, nullable: false }, 'judging_config.judgesPerTeam', errors);
  if ('resultsVisibility' in v) out.resultsVisibility = oneOf(v.resultsVisibility, RESULTS_VISIBILITY, 'judging_config.resultsVisibility', errors);
  if ('coiRequired' in v) out.coiRequired = bool(v.coiRequired, 'judging_config.coiRequired', errors);
  if ('showScores' in v) out.showScores = bool(v.showScores, 'judging_config.showScores', errors);
  if ('peopleChoice' in v) out.peopleChoice = bool(v.peopleChoice, 'judging_config.peopleChoice', errors);
  // People's choice opens here; null: when submissions close (voting.service).
  if ('votingStart' in v) {
    const d = date(v.votingStart, 'judging_config.votingStart', errors);
    if (d !== undefined) out.votingStart = d ? d.toISOString() : null;
  }
  return out;
}

function readMentor(v, existing, errors) {
  if (!isPlainObject(v)) { errors.push({ field: 'mentor_config', message: 'Must be an object.' }); return undefined; }
  const out = withDefaults('mentor_config', existing);
  if ('ticketsEnabled' in v) out.ticketsEnabled = bool(v.ticketsEnabled, 'mentor_config.ticketsEnabled', errors);
  if ('maxOpenTicketsPerTeam' in v) out.maxOpenTicketsPerTeam = int(v.maxOpenTicketsPerTeam, { min: 1, max: 10, nullable: false }, 'mentor_config.maxOpenTicketsPerTeam', errors);
  if ('showOnlineStatus' in v) out.showOnlineStatus = bool(v.showOnlineStatus, 'mentor_config.showOnlineStatus', errors);
  return out;
}

function readPresentation(v, existing, errors) {
  if (!isPlainObject(v)) { errors.push({ field: 'presentation_config', message: 'Must be an object.' }); return undefined; }
  const out = withDefaults('presentation_config', existing);
  if ('order' in v) out.order = oneOf(v.order, PRESENTATION_ORDER, 'presentation_config.order', errors);
  if ('slotMinutes' in v) out.slotMinutes = int(v.slotMinutes, { min: 1, max: 60, nullable: false }, 'presentation_config.slotMinutes', errors);
  if ('qaMinutes' in v) out.qaMinutes = int(v.qaMinutes, { min: 0, max: 30, nullable: false }, 'presentation_config.qaMinutes', errors);
  if ('warnSeconds' in v) out.warnSeconds = int(v.warnSeconds, { min: 0, max: 600, nullable: false }, 'presentation_config.warnSeconds', errors);
  return out;
}

function readComms(v, existing, errors) {
  if (!isPlainObject(v)) { errors.push({ field: 'comms_config', message: 'Must be an object.' }); return undefined; }
  const out = withDefaults('comms_config', existing);
  if ('senderName' in v) out.senderName = text(v.senderName, 80, 'comms_config.senderName', errors) || '';
  if ('replyTo' in v) {
    const r = text(v.replyTo, 255, 'comms_config.replyTo', errors);
    if (r && !EMAIL_RE.test(r)) errors.push({ field: 'comms_config.replyTo', message: 'Not a valid e-mail address.' });
    else out.replyTo = r || '';
  }
  if ('auto' in v) {
    if (!isPlainObject(v.auto)) errors.push({ field: 'comms_config.auto', message: 'Must be an object.' });
    else {
      for (const [k, on] of Object.entries(v.auto)) {
        if (!AUTO_ANNOUNCEMENTS.includes(k)) { errors.push({ field: `comms_config.auto.${k}`, message: 'Unknown announcement.' }); continue; }
        out.auto[k] = bool(on, `comms_config.auto.${k}`, errors);
      }
    }
  }
  if ('chat' in v) {
    if (!isPlainObject(v.chat)) errors.push({ field: 'comms_config.chat', message: 'Must be an object.' });
    else {
      for (const [k, on] of Object.entries(v.chat)) {
        if (!['general', 'team', 'support'].includes(k)) { errors.push({ field: `comms_config.chat.${k}`, message: 'Unknown chat setting.' }); continue; }
        out.chat[k] = bool(on, `comms_config.chat.${k}`, errors);
      }
    }
  }
  return out;
}

function readCertificates(v, existing, errors) {
  if (!isPlainObject(v)) { errors.push({ field: 'certificate_config', message: 'Must be an object.' }); return undefined; }
  const out = withDefaults('certificate_config', existing);
  if ('types' in v) {
    if (!Array.isArray(v.types) || !v.types.every((t) => CERTIFICATE_TYPES.includes(t))) {
      errors.push({ field: 'certificate_config.types', message: `Allowed: ${CERTIFICATE_TYPES.join(', ')}.` });
    } else out.types = [...new Set(v.types)];
  }
  if ('signerName' in v) out.signerName = text(v.signerName, 100, 'certificate_config.signerName', errors) || '';
  if ('signerTitle' in v) out.signerTitle = text(v.signerTitle, 100, 'certificate_config.signerTitle', errors) || '';
  if ('signatureFileId' in v) out.signatureFileId = uuidOrNull(v.signatureFileId, 'certificate_config.signatureFileId', errors);
  if ('issueAfterResults' in v) out.issueAfterResults = bool(v.issueAfterResults, 'certificate_config.issueAfterResults', errors);
  return out;
}

function readBuilderState(v, existing, errors) {
  if (!isPlainObject(v)) { errors.push({ field: 'builder_state', message: 'Must be an object.' }); return undefined; }
  const keys = SECTIONS.map((s) => s.key);
  const out = { ...(isPlainObject(existing) ? existing : {}) };
  if ('visited' in v) {
    if (!Array.isArray(v.visited)) errors.push({ field: 'builder_state.visited', message: 'Must be a list.' });
    else out.visited = [...new Set(v.visited.filter((k) => keys.includes(k)))];
  }
  if ('last' in v) out.last = keys.includes(v.last) ? v.last : out.last || null;
  return out;
}

/**
 * Read every builder field present in `src`.
 * @param {object} src      request body
 * @param {object} existing the stored event row (for merging nested settings)
 * @returns {{ values: object, errors: Array<{field: string, message: string}> }}
 */
function readBuilderFields(src, existing = {}) {
  const values = {};
  const errors = [];
  const body = isPlainObject(src) ? src : {};
  const take = (col, fn) => {
    const p = present(body, col);
    if (!p.has) return;
    const v = fn(p.value);
    if (v !== undefined) values[col] = v;
  };

  take('tagline', (v) => text(v, 200, 'tagline', errors));
  take('category', (v) => oneOf(v, CATEGORIES, 'category', errors));
  take('language', (v) => oneOf(v, LANGUAGES, 'language', errors));
  take('brand_color', (v) => {
    if (v === null || v === '') return null;
    const s = String(v).trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(s)) { errors.push({ field: 'brand_color', message: 'Use a colour like #1f6feb.' }); return undefined; }
    return s;
  });
  take('logo_file_id', (v) => uuidOrNull(v, 'logo_file_id', errors));
  take('banner_file_id', (v) => uuidOrNull(v, 'banner_file_id', errors));
  take('format', (v) => oneOf(v, FORMATS, 'format', errors));
  take('venue_name', (v) => text(v, 200, 'venue_name', errors));
  take('venue_address', (v) => text(v, 300, 'venue_address', errors));
  take('city', (v) => text(v, 100, 'city', errors));
  take('country', (v) => {
    if (v === null || v === '') return null;
    const s = String(v).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(s)) { errors.push({ field: 'country', message: 'Use a two-letter country code.' }); return undefined; }
    return s;
  });
  take('map_url', (v) => url(v, 'map_url', errors));
  // The room link often carries its passcode: sealed when a key is set (secretBox).
  take('online_url', (v) => {
    const checked = url(v, 'online_url', errors);
    return checked === undefined ? undefined : seal(checked);
  });
  take('timezone', (v) => {
    const s = String(v ?? '').trim();
    if (!isTimeZone(s)) { errors.push({ field: 'timezone', message: 'Unknown time zone.' }); return undefined; }
    return s;
  });
  for (const col of ['team_deadline', 'judging_start', 'judging_end', 'results_at']) {
    take(col, (v) => date(v, col, errors));
  }
  take('registration_mode', (v) => oneOf(v, REGISTRATION_MODES, 'registration_mode', errors));
  take('max_participants', (v) => int(v, { min: 1, max: 100000 }, 'max_participants', errors));
  take('waitlist_enabled', (v) => bool(v, 'waitlist_enabled', errors));
  take('approval_mode', (v) => oneOf(v, APPROVAL_MODES, 'approval_mode', errors));
  take('eligibility', (v) => readEligibility(v, existing.eligibility, errors));
  take('rules', (v) => text(v, 30000, 'rules', errors));
  take('faq', (v) => readFaq(v, errors));
  take('submission_config', (v) => readSubmission(v, existing.submission_config, errors));
  take('judging_config', (v) => readJudging(v, existing.judging_config, errors));
  take('mentor_config', (v) => readMentor(v, existing.mentor_config, errors));
  take('presentation_config', (v) => readPresentation(v, existing.presentation_config, errors));
  take('comms_config', (v) => readComms(v, existing.comms_config, errors));
  take('certificate_config', (v) => readCertificates(v, existing.certificate_config, errors));
  take('slug', (v) => {
    const s = String(v ?? '').trim().toLowerCase();
    if (!SLUG_RE.test(s)) {
      errors.push({ field: 'slug', message: 'Use 1–80 lowercase letters, digits and dashes; no dash at either end.' });
      return undefined;
    }
    return s;
  });
  take('visibility', (v) => oneOf(v, VISIBILITIES, 'visibility', errors));
  take('directory_listed', (v) => bool(v, 'directory_listed', errors));
  take('builder_state', (v) => readBuilderState(v, existing.builder_state, errors));

  return { values, errors };
}

/*
 * The timeline has to read in order. Each rule is (earlier, later, the one
 * that follows, message). The core pairs (registration vs event, deadline vs
 * end) are enforced by normalizeEventInput; these are the builder's.
 *
 * Who caused a conflict decides what happens, as in normalizeEventInput:
 *   - the organiser set the date that has to follow → refused, the message
 *     goes on that date;
 *   - they moved only the other one (pulled the event's end earlier, past a
 *     team deadline they never touched) → the following date is pulled
 *     along to the boundary, so moving the event never turns into a list of
 *     errors about dates the organiser did not change;
 *   - neither was in this save (dates that were already out of order) →
 *     left alone; the publish checklist still points at them.
 */
/*
 * Pairs of dates that must come in this order: [earlier, later, the one that
 * moves, message]. The one that moves is the dependent date: it is refused
 * when the organiser typed it, and pulled along when they only moved the
 * date it depends on. Submissions close at the deadline, or at the end of the
 * event when there is none (submissionRules.closesAt), so the dates that must
 * wait for projects compare against that (judging may start earlier: rolling
 * judging).
 */
const CLOSE = 'submission_close';
const TIMELINE_RULES = [
  ['start_date', 'end_date', 'end_date', 'The event must end after it starts.'],
  ['registration_start', 'registration_end', 'registration_end', 'Registration must close after it opens.'],
  ['registration_end', 'end_date', 'registration_end', 'Registration cannot close after the event ends.'],
  ['registration_start', 'team_deadline', 'team_deadline', 'Team formation cannot end before registration opens.'],
  ['team_deadline', 'end_date', 'team_deadline', 'Team formation must end before the event ends.'],
  ['start_date', 'submission_deadline', 'submission_deadline', 'The submission deadline cannot be before the event starts.'],
  ['submission_deadline', 'end_date', 'submission_deadline', 'The submission deadline cannot be after the event ends.'],
  ['start_date', 'judging_start', 'judging_start', 'Judging cannot start before the event starts.'],
  // A judging start before submissions close is allowed on purpose: rolling
  // judging. Judges see "changed since your review" when a team changes its
  // project afterwards, and publishing the results asks about such reviews.
  // Without a judging start, judging opens when submissions close.
  ['judging_start', 'judging_end', 'judging_end', 'Judging must end after it starts.'],
  ['start_date', 'demo_day', 'demo_day', 'Demo day cannot be before the event starts.'],
  [CLOSE, 'demo_day', 'demo_day', 'Demo day cannot be before submissions close.'],
  ['start_date', 'results_at', 'results_at', 'Results cannot be announced before the event starts.'],
  [CLOSE, 'results_at', 'results_at', 'Results cannot be announced before submissions close.'],
  ['judging_end', 'results_at', 'results_at', 'Results cannot be announced before judging ends.'],
];

const ts = (v) => (v ? new Date(v).getTime() : null);

/** The column a rule's side reads: submissions close at the deadline, else the end. */
const sideOf = (r, key) => (key === CLOSE ? (r.submission_deadline ? 'submission_deadline' : 'end_date') : key);

/**
 * Put the dates in order.
 *
 * Each error names the date that is out of place (`field`), the date it
 * clashes with (`other`), and which way: `before` when it is earlier than
 * `other` and must not be, `after` when it is later. The checklist turns
 * these into a sentence in the organiser's language and a link to the field.
 *
 * @param {object} row       the event as it would be after the save
 * @param {Set<string>|null} supplied columns the save set; null = check all (checklist)
 * @returns {{ pulled: object, errors: Array<{field, message, code, other, rel}> }}
 */
function reconcileTimeline(row, supplied = null) {
  const r = { ...row };
  const pulled = {};
  const errors = [];
  const seen = new Set();
  const report = (field, other, rel, message) => {
    if (seen.has(field)) return;
    seen.add(field);
    errors.push({ field, message, code: rel === 'before' ? 'TIMELINE_BEFORE' : 'TIMELINE_AFTER', other, rel });
  };
  // Three passes: pulling one date can create the next conflict down the chain.
  for (let pass = 0; pass < 3; pass += 1) {
    for (const [ka, kb, followerKey, message] of TIMELINE_RULES) {
      const a = sideOf(r, ka);
      const b = sideOf(r, kb);
      const follower = sideOf(r, followerKey);
      const da = ts(r[a]);
      const db = ts(r[b]);
      if (da == null || db == null || db >= da) continue;
      const leader = follower === a ? b : a;
      const rel = follower === b ? 'before' : 'after';
      if (supplied == null) {
        report(follower, leader, rel, message);
        continue;
      }
      if (supplied.has(follower)) {
        report(follower, leader, rel, message);
      } else if (supplied.has(leader) || pulled[leader] !== undefined) {
        r[follower] = r[leader];
        pulled[follower] = r[leader];
      }
    }
  }
  return { pulled, errors };
}

/** Every out-of-order pair, for the checklist. */
function checkTimeline(row) {
  return reconcileTimeline(row, null).errors;
}

module.exports = {
  readBuilderFields,
  checkTimeline,
  reconcileTimeline,
  withDefaults,
  isTimeZone,
  SLUG_RE,
  UUID_RE,
  BUILDER_COLUMNS: Object.keys(ALIASES),
};
