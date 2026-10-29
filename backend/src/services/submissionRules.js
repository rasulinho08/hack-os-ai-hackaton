/**
 * @file submissionRules.js
 * @description What a project submission must contain and when it may be
 * handed in, from the organiser's settings (event builder → Submissions).
 *
 * Each link or text the builder lists is required, optional or off. Off
 * means the form does not ask and the API does not keep it; required means
 * a submission without it is refused. Files are optional when the organiser
 * allows them, within their size and types. Events without settings keep
 * the original rules: repository and description required, the rest
 * optional, no files.
 */

const { withDefaults } = require('./eventBuilderInput');
const { SUBMISSION_KINDS } = require('./file.service');
const { validateDisplayName, validateText } = require('../validations/common');

const MB = 1024 * 1024;
const MAX_FILES = 5;
const CODE_HOSTS = new Set([
  'github.com', 'www.github.com', 'gitlab.com', 'www.gitlab.com', 'bitbucket.org', 'www.bitbucket.org', 'codeberg.org',
]);

/** Builder field → column, the label used in messages, and the API's field name. */
const LINKS = Object.freeze([
  { key: 'repo', column: 'repo_link', field: 'repoLink', label: 'Code repository' },
  { key: 'demo', column: 'demo_link', field: 'demoLink', label: 'Demo link' },
  { key: 'slides', column: 'presentation_link', field: 'presentationLink', label: 'Slides link' },
  { key: 'video', column: 'video_link', field: 'videoLink', label: 'Video link' },
]);

function configFor(event) {
  return withDefaults('submission_config', event?.submission_config);
}

/** The upload rules for this event's project files, for file.service.store. */
function fileLimits(cfg) {
  return {
    maxBytes: Number(cfg.files.maxMb) * MB,
    kinds: [...new Set((cfg.files.types || []).flatMap((t) => SUBMISSION_KINDS[t] || []))],
  };
}

/** When submissions close: the submission deadline, else the end of the event; null when neither is set. */
function closesAt(event) {
  if (event.submission_deadline) return new Date(event.submission_deadline);
  return event.end_date ? new Date(event.end_date) : null;
}

/**
 * Submissions are only taken while the hackathon runs: from its start until
 * the submission deadline (else the end). Late submissions lift the closing
 * check, never the opening one.
 * @returns {{ ok: true } | { ok: false, code: string, message: string }}
 */
function windowCheck(event, now = new Date()) {
  const start = event.start_date ? new Date(event.start_date) : null;
  if (start && now < start) {
    return { ok: false, code: 'HACKATHON_NOT_STARTED', message: 'The hackathon has not started yet. You can submit once it begins.' };
  }
  const close = closesAt(event);
  if (close && now > close && !event.allow_late_submissions) {
    return { ok: false, code: 'SUBMISSION_CLOSED', message: 'The submission window has closed for this hackathon.' };
  }
  return { ok: true };
}

/**
 * "github.com/team/app" → "https://github.com/team/app": people type links
 * the way they read them. Only a bare host (with a dot) and path gets the
 * prefix; anything with a scheme is left for the checks below.
 */
function normaliseLink(raw) {
  const s = String(raw).trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//')) return s;
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#].*)?$/i.test(s)) return `https://${s}`;
  return s;
}

function checkLink(raw, { label, key }) {
  const s = normaliseLink(raw);
  if (s.length > 2048) return { ok: false, message: `${label} is too long` };
  let u;
  try { u = new URL(s); } catch { return { ok: false, message: `${label} is not a valid link — it should start with https://` }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, message: `${label} must start with http:// or https://` };
  if (key === 'repo' && !CODE_HOSTS.has(u.hostname.toLowerCase())) {
    return { ok: false, message: 'The repository must be on GitHub, GitLab, Bitbucket or Codeberg (e.g. https://github.com/team/project)' };
  }
  return { ok: true, value: s };
}

const blank = (v) => v == null || String(v).trim() === '';

/**
 * Check a submission against the event's settings.
 *
 * @param {object} data  project_name, description, repo_link, demo_link,
 *                       presentation_link, video_link, tech_stack (trimmed)
 * @param {object} cfg   configFor(event)
 * @returns {{ ok: true, values: object } | { ok: false, message: string, errors: Array<{field, message}> }}
 *   `values` holds what to store: off fields come back as null.
 */
function checkSubmission(data, cfg) {
  const errors = [];
  const values = {};

  const name = validateDisplayName(data.project_name, 'Project name', { min: 1, max: 255 });
  if (!name.ok) errors.push({ field: 'projectName', message: name.message });
  else values.project_name = name.value;

  for (const link of LINKS) {
    const state = cfg.fields[link.key] || 'optional';
    const raw = data[link.column];
    if (state === 'off') { values[link.column] = null; continue; }
    if (blank(raw)) {
      if (state === 'required') errors.push({ field: link.field, message: `${link.label} is required for this event` });
      values[link.column] = null;
      continue;
    }
    const c = checkLink(raw, link);
    if (!c.ok) errors.push({ field: link.field, message: c.message });
    else values[link.column] = c.value;
  }

  const summaryState = cfg.fields.summary || 'required';
  if (summaryState === 'off') values.description = null;
  else {
    const d = validateText(data.description, 'Description', { max: 5000, required: summaryState === 'required' });
    if (!d.ok) errors.push({ field: 'description', message: d.message });
    else values.description = d.value;
  }

  const techState = cfg.fields.tech || 'optional';
  if (techState === 'off') values.tech_stack = null;
  else {
    const tch = validateText(data.tech_stack, 'Technologies', { max: 500, required: techState === 'required' });
    if (!tch.ok) errors.push({ field: 'techStack', message: tch.message });
    else values.tech_stack = tch.value;
  }

  if (errors.length) return { ok: false, message: errors[0].message, errors };
  return { ok: true, values };
}

module.exports = { MAX_FILES, LINKS, configFor, fileLimits, closesAt, windowCheck, checkSubmission, normaliseLink };
