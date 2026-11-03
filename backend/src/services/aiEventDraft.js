/**
 * @file aiEventDraft.js
 * @description An event draft from a sentence: the organiser describes the
 * event, Meta's model answers a plan as JSON, and the plan is written through
 * the builder's own services, so every value passes the same checks as one
 * typed into the builder.
 *
 *   normalizePlan    the model's JSON → only known fields, in range (pure)
 *   createFromPrompt prompt → plan → draft (never published, costs nothing)
 *
 * What the model gets wrong is left out rather than refused: the draft keeps
 * the template's value there, and the answer lists what was skipped so the
 * organiser knows where to look.
 */

const metaAi = require('./metaAi');
const builder = require('./eventBuilder.service');
const eventLists = require('./eventLists.service');
const entitlementService = require('./entitlement.service');
const { TEMPLATE_KEYS, zonedTime } = require('./eventTemplates');
const { isTimeZone } = require('./eventBuilderInput');
const { CATEGORIES, FORMATS, LANGUAGES } = require('../constants/eventBuilder');
const { isOwnerUser } = require('../utils/authz');
const { httpError } = require('../utils/responseFormat');

const PROMPT_MIN = 10;
const PROMPT_MAX = 2000;
const MAX = { tracks: 8, prizes: 10, criteria: 8, faq: 10 };
const DATE_FIELDS = ['start_date', 'end_date', 'registration_end', 'submission_deadline'];
const DAY = 24 * 3600 * 1000;

const LANGUAGE_NAMES = { az: 'Azerbaijani', en: 'English', ru: 'Russian' };

// ── The model's answer, checked ─────────────────────────────────────────────

const clip = (v, max) => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};
/** Like clip, but keeps line breaks (descriptions, rules). */
const clipText = (v, max) => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return s ? s.slice(0, max) : null;
};
const intIn = (v, min, max) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const oneOf = (v, list) => {
  const s = String(v ?? '').trim().toLowerCase();
  return list.includes(s) ? s : null;
};
const listOf = (v, max) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object').slice(0, max) : []);

/**
 * "2026-11-20T10:00" (or "2026-11-20", taken as 10:00) read as a wall-clock
 * time in `timeZone`. Null for anything else, the past, or more than two
 * years ahead.
 */
function localDate(v, timeZone, now) {
  const m = String(v ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [y, mo, d, hh = '10', mm = '00'] = m.slice(1);
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31 || Number(hh) > 23 || Number(mm) > 59) return null;
  const date = zonedTime(Number(y), Number(mo), Number(d), Number(hh), Number(mm), timeZone);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getTime() < now.getTime() || date.getTime() > now.getTime() + 730 * DAY) return null;
  return date;
}

function uniqueByName(items) {
  const seen = new Set();
  return items.filter((it) => {
    const k = it.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * The model's plan reduced to what the builder accepts.
 * @param {object} raw the model's JSON
 * @param {{ timeZone: string, language: string, now?: Date }} ctx
 */
function normalizePlan(raw, { timeZone, language, now = new Date() }) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const name = clip(src.name, 120);
  const category = oneOf(src.category, CATEGORIES);
  let template = oneOf(src.template, TEMPLATE_KEYS);
  if (!template) template = category === 'ideathon' ? 'ideathon' : 'hackathon24';

  const fields = {};
  const set = (k, v) => { if (v !== null && v !== undefined) fields[k] = v; };
  set('tagline', clip(src.tagline, 200));
  set('description', clipText(src.description, 5000));
  set('category', category);
  set('format', oneOf(src.format, FORMATS));
  set('city', clip(src.city, 100));
  set('max_participants', intIn(src.max_participants ?? src.maxParticipants, 1, 100000));
  set('rules', clipText(src.rules, 8000));

  const maxTeam = intIn(src.team_size_limit ?? src.max_team_size, 1, 50);
  const minTeam = intIn(src.min_team_size, 1, 50);
  if (maxTeam) set('team_size_limit', maxTeam);
  if (minTeam) set('min_team_size', maxTeam ? Math.min(minTeam, maxTeam) : minTeam);

  const dates = Object.fromEntries(DATE_FIELDS.map((k) => [k, localDate(src[k], timeZone, now)]));
  // The dates go in together or not at all: half a timeline from the model
  // next to half from the template would be worse than the template's.
  if (dates.start_date && dates.end_date && dates.end_date > dates.start_date) {
    for (const k of DATE_FIELDS) if (dates[k]) fields[k] = dates[k].toISOString();
  }

  const faq = listOf(src.faq, MAX.faq)
    .map((f) => ({ q: clip(f.q ?? f.question, 300), a: clipText(f.a ?? f.answer, 2000) }))
    .filter((f) => f.q && f.a);
  if (faq.length) fields.faq = faq;

  const tracks = uniqueByName(listOf(src.tracks, MAX.tracks)
    .map((t) => ({ name: clip(t.name, 120), description: clipText(t.description, 2000) }))
    .filter((t) => t.name));

  // Track prizes need ids the draft does not have yet: only places and specials.
  let place = 0;
  const prizes = listOf(src.prizes, MAX.prizes)
    .map((p) => {
      const kind = oneOf(p.kind, ['place', 'special']) || 'place';
      return {
        kind,
        position: kind === 'place' ? (place += 1) : null,
        name: clip(p.name, 120),
        value: clip(p.value, 120),
        description: clipText(p.description, 1000),
      };
    })
    .filter((p) => p.name && (p.kind !== 'place' || p.position <= 20));

  const criteria = uniqueByName(listOf(src.criteria, MAX.criteria)
    .map((c) => {
      const w = Number(c.weight);
      return {
        name: clip(c.name, 120),
        description: clipText(c.description, 1000),
        max_score: intIn(c.max_score ?? c.maxScore, 1, 100) || 10,
        weight: Number.isFinite(w) && w >= 0.1 && w <= 10 ? Math.round(w * 100) / 100 : 1,
      };
    })
    .filter((c) => c.name));

  return {
    draft: { name, template, timezone: timeZone, language },
    fields,
    tracks,
    prizes,
    criteria,
  };
}

// ── The prompt ──────────────────────────────────────────────────────────────

function systemPrompt({ language, timeZone, today }) {
  return [
    'You plan events for HackOS, a platform for running hackathons. An organiser describes an event;',
    'you answer ONE JSON object and nothing else (no prose, no code fence).',
    `Write every text in ${LANGUAGE_NAMES[language]}. Today is ${today} in ${timeZone}.`,
    'Fill what the organiser said; for what they did not say, choose sensible values for that kind of event.',
    'Never invent sponsors, people, e-mail addresses or links.',
    '',
    'Keys (all optional except name):',
    '  name: string, 3-120 chars',
    '  tagline: string, at most 200 chars',
    '  description: string, 2-4 short paragraphs for the public page',
    `  category: one of ${CATEGORIES.join(', ')}`,
    `  template: one of ${TEMPLATE_KEYS.join(', ')} (hackathon24 for a hackathon, university for a student event)`,
    `  format: one of ${FORMATS.join(', ')}`,
    '  city: string (only for offline or hybrid)',
    '  max_participants: integer',
    '  min_team_size, team_size_limit: integers 1-10',
    `  start_date, end_date, registration_end, submission_deadline: local times in ${timeZone}, "YYYY-MM-DDTHH:mm", in the future;`,
    '    registration_end before start_date; submission_deadline between start_date and end_date',
    `  tracks: up to ${MAX.tracks} of { name, description }`,
    `  prizes: up to ${MAX.prizes} of { kind: "place" | "special", name, value, description }, places in order (1st first)`,
    `  criteria: up to ${MAX.criteria} judging criteria of { name, description, weight (0.1-10), max_score (1-100, usually 10) }`,
    `  faq: up to ${MAX.faq} of { q, a }`,
    '  rules: string, short house rules',
  ].join('\n');
}

function todayIn(timeZone, now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// ── Create ──────────────────────────────────────────────────────────────────

/** Top-level field of a builder error ('faq.2.q' → 'faq'). */
const fieldOf = (e) => String(e?.field || '').split('.')[0];

/** Save the plan's fields, leaving out (and naming) those the builder refuses. */
async function saveFields(eventId, fields, opts, skipped) {
  let pending = { ...fields };
  for (let attempt = 0; attempt < 3 && Object.keys(pending).length; attempt += 1) {
    try {
      await builder.patchEvent(eventId, pending, opts);
      return;
    } catch (err) {
      if (err.statusCode !== 400 && err.statusCode !== 403) throw err;
      const bad = new Set((err.errors || []).map(fieldOf).filter((f) => f in pending));
      if ([...bad].some((f) => DATE_FIELDS.includes(f)) || !bad.size) {
        for (const f of DATE_FIELDS) if (f in pending) bad.add(f);
      }
      if (err.statusCode === 403 || !bad.size) {
        // Nothing to single out: keep the template for all of it.
        skipped.push(...Object.keys(pending));
        return;
      }
      skipped.push(...bad);
      pending = Object.fromEntries(Object.entries(pending).filter(([k]) => !bad.has(k)));
    }
  }
}

/**
 * The organiser's description → a new draft event.
 * @param {object} user req.user (an organiser)
 * @param {{ prompt: string, language?: string, timezone?: string }} body
 * @param {object|null} org the organisation the event belongs to
 * @returns {Promise<{ eventId: number, skipped: string[], model: string }>}
 */
async function createFromPrompt(user, body, org) {
  const src = body && typeof body === 'object' ? body : {};
  const prompt = typeof src.prompt === 'string' ? src.prompt.trim() : '';
  if (prompt.length < PROMPT_MIN || prompt.length > PROMPT_MAX) {
    throw httpError(400, `Describe the event in ${PROMPT_MIN} to ${PROMPT_MAX} characters.`, 'VALIDATION_ERROR', {
      errors: [{ field: 'prompt', message: `${PROMPT_MIN} to ${PROMPT_MAX} characters.` }],
    });
  }
  const language = LANGUAGES.includes(src.language) ? src.language : 'az';
  const timeZone = src.timezone && isTimeZone(String(src.timezone)) ? String(src.timezone) : 'Asia/Baku';
  const now = new Date();

  const { data, model } = await metaAi.chatJson({
    system: systemPrompt({ language, timeZone, today: todayIn(timeZone, now) }),
    user: prompt,
  });
  const plan = normalizePlan(data, { timeZone, language, now });
  if (!plan.draft.name || plan.draft.name.length < 3) {
    throw httpError(502, 'The AI did not suggest a usable event name. Try describing the event again.', 'AI_BAD_OUTPUT');
  }

  const eventId = await builder.createDraft(user, plan.draft, org);
  const isOwner = isOwnerUser(user);
  const skipped = [];
  await saveFields(eventId, plan.fields, { isOwner, actorId: user.id }, skipped);

  const scope = isOwner ? null : await entitlementService.forEvent(eventId);
  const lists = [
    ['tracks', plan.tracks, eventLists.syncTracks],
    ['prizes', plan.prizes, eventLists.syncPrizes],
    // Criteria are the judging module's, as on the builder's own route.
    ['criteria', scope && !scope.modules.has('judging') ? [] : plan.criteria, eventLists.syncCriteria],
  ];
  for (const [kind, items, sync] of lists) {
    if (!items.length) continue;
    try {
      await sync(eventId, items);
    } catch (err) {
      if (err.statusCode !== 400) throw err;
      skipped.push(kind);
    }
  }
  return { eventId, skipped: [...new Set(skipped)], model };
}

module.exports = { normalizePlan, createFromPrompt, systemPrompt, PROMPT_MIN, PROMPT_MAX };
