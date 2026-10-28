/**
 * @file eventBuilder.js
 * @description The vocabulary of the event builder: allowed values, the
 * standard registration fields, and the default settings of a new event.
 *
 * The web app holds the labels (in three languages) and draws the same lists
 * from GET /api/events/builder/catalog, so a value added here appears there
 * without a second copy drifting out of date.
 */

const CATEGORIES = Object.freeze(['hackathon', 'ideathon', 'datathon', 'designathon', 'gamejam', 'case', 'other']);
const LANGUAGES = Object.freeze(['az', 'en', 'ru']);
const FORMATS = Object.freeze(['online', 'offline', 'hybrid']);
const REGISTRATION_MODES = Object.freeze(['solo', 'team', 'both']);
const APPROVAL_MODES = Object.freeze(['manual', 'team', 'auto']);
/*
 * Who can find the event (migration 0035): anyone ('public'), only people
 * with the link ('private'), or only people the organiser invited, who are
 * also the only ones who may register ('invite'). Only a public event can
 * appear in the HackOS directory.
 */
const VISIBILITIES = Object.freeze(['public', 'private', 'invite']);

/*
 * Standard registration fields (plan decision E5): every one is available to
 * every event and the organiser switches each on or off. `profile` names the
 * users column the answer also updates, so the next registration is
 * pre-filled; `defaultOn` is the form's starting state; `sensitive` hides the
 * answer from mentors and volunteers.
 */
const STANDARD_FIELDS = Object.freeze([
  { key: 'phone', type: 'phone', profile: 'phone', defaultOn: true, sensitive: true },
  { key: 'age', type: 'number', profile: 'age', defaultOn: true, sensitive: true, min: 10, max: 99 },
  { key: 'gender', type: 'select', defaultOn: false, sensitive: true, options: ['female', 'male', 'other', 'prefer_not'] },
  { key: 'country', type: 'country', profile: 'country', defaultOn: false },
  { key: 'city', type: 'text', defaultOn: true },
  { key: 'university', type: 'university', profile: 'university', defaultOn: true },
  { key: 'major', type: 'text', profile: 'cohort', defaultOn: true },
  { key: 'company', type: 'text', defaultOn: false },
  { key: 'linkedin', type: 'url', profile: 'linkedin', defaultOn: true },
  { key: 'github', type: 'url', profile: 'github_link', defaultOn: true },
  { key: 'cv', type: 'file', defaultOn: false, sensitive: true },
  { key: 'tshirt', type: 'select', profile: 'tshirt_size', defaultOn: true, options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
  { key: 'diet', type: 'select', profile: 'dietary', defaultOn: true, options: ['none', 'vegetarian', 'vegan', 'halal', 'gluten_free', 'lactose_free', 'nut_allergy', 'other'] },
  { key: 'source', type: 'select', profile: 'how_heard', defaultOn: true, options: ['social', 'friend', 'university', 'email', 'website', 'telegram', 'other'] },
  { key: 'experience', type: 'select', profile: 'experience', defaultOn: true, options: ['beginner', 'intermediate', 'advanced', 'expert'] },
  { key: 'skills', type: 'skills', profile: 'skills', defaultOn: true },
  { key: 'motivation', type: 'textarea', profile: 'motivation', defaultOn: false },
]);
const STANDARD_KEYS = Object.freeze(STANDARD_FIELDS.map((f) => f.key));

/** Types an organiser may give their own questions. */
const CUSTOM_FIELD_TYPES = Object.freeze(['text', 'textarea', 'select', 'multiselect', 'checkbox', 'number', 'date', 'url', 'file']);

/** What a submission can ask for (plan decision E6: links and/or files). */
const SUBMISSION_FIELDS = Object.freeze(['repo', 'demo', 'slides', 'video', 'summary', 'tech']);
const SUBMISSION_FIELD_STATES = Object.freeze(['required', 'optional', 'off']);
const SUBMISSION_FILE_TYPES = Object.freeze(['pdf', 'pptx', 'docx', 'zip', 'image']);

/** Automatic announcements the organiser can switch on (decision F8). */
const AUTO_ANNOUNCEMENTS = Object.freeze([
  'reg24', 'regclosed', 'start30', 'started', 'sub24', 'sub1', 'subclosed', 'pres1', 'results', 'certs',
]);

/** Certificate kinds (decision E10). */
const CERTIFICATE_TYPES = Object.freeze(['participation', 'winners', 'special', 'judge', 'mentor', 'volunteer']);

/** What participants see when results are released (decision E8). */
const RESULTS_VISIBILITY = Object.freeze(['full', 'own_and_winners', 'winners']);
/** How judges are matched to teams (decision E7). */
const JUDGE_ASSIGNMENT = Object.freeze(['all', 'track', 'per_team']);
const PRESENTATION_ORDER = Object.freeze(['submission', 'random', 'manual']);
const SPONSOR_TIERS = Object.freeze(['platinum', 'gold', 'silver', 'bronze', 'partner']);
const PRIZE_KINDS = Object.freeze(['place', 'special', 'track']);

/** Starting values of every JSONB setting; stored values are merged over these. */
const CONFIG_DEFAULTS = Object.freeze({
  eligibility: Object.freeze({
    minAge: null, maxAge: null, countries: [], cities: [], studentsOnly: false, requireRules: false, requireCoc: true,
  }),
  submission_config: Object.freeze({
    fields: Object.freeze({ repo: 'required', demo: 'optional', slides: 'optional', video: 'optional', summary: 'required', tech: 'optional' }),
    files: Object.freeze({ enabled: false, maxMb: 10, types: ['pdf', 'pptx'] }),
    // J1: check GitHub repositories for work from before the start.
    githubCheck: false,
  }),
  judging_config: Object.freeze({
    blind: false, assignment: 'all', judgesPerTeam: 3, resultsVisibility: 'own_and_winners',
    // J1: judges confirm a conflict-of-interest declaration before scoring.
    coiRequired: false,
    // E8: whether participants see their scores (not just places) once published.
    showScores: false,
    // J1: participants pick their favourite project (people's choice), one
    // vote each, never for their own team.
    peopleChoice: false,
    // When people's choice opens (ISO time); null: when submissions close.
    votingStart: null,
  }),
  mentor_config: Object.freeze({ ticketsEnabled: true, maxOpenTicketsPerTeam: 2, showOnlineStatus: true }),
  presentation_config: Object.freeze({ order: 'submission', slotMinutes: 3, qaMinutes: 2, warnSeconds: 60 }),
  comms_config: Object.freeze({
    senderName: '',
    replyTo: '',
    auto: Object.freeze(Object.fromEntries(AUTO_ANNOUNCEMENTS.map((k) => [k, true]))),
    // Event chat (module 'chat'): the channel for everyone, team channels,
    // and each person's thread with the organisers.
    chat: Object.freeze({ general: true, team: true, support: true }),
  }),
  certificate_config: Object.freeze({
    types: ['participation', 'winners', 'special', 'judge', 'mentor', 'volunteer'],
    signerName: '', signerTitle: '', signatureFileId: null, issueAfterResults: true,
  }),
});

/*
 * Builder sections in the order the wizard walks them, with the module a
 * section needs. A section whose module the event's plan lacks is shown
 * locked in the app and refused by the API.
 */
const SECTIONS = Object.freeze([
  { key: 'basics' }, { key: 'brand', module: 'branding' }, { key: 'place' }, { key: 'schedule' },
  { key: 'registration' }, { key: 'eligibility' }, { key: 'form' }, { key: 'tracks' }, { key: 'prizes' },
  { key: 'sponsors' }, { key: 'judging', module: 'judging' }, { key: 'judges', module: 'judging' },
  { key: 'mentors', module: 'mentors' }, { key: 'volunteers', module: 'volunteers' },
  { key: 'submissions', module: 'submissions' }, { key: 'presentation', module: 'presentations' },
  { key: 'communication', module: 'announcements' }, { key: 'resources', module: 'resources' },
  { key: 'certificates', module: 'certificates' }, { key: 'share' },
]);

module.exports = {
  CATEGORIES,
  LANGUAGES,
  FORMATS,
  REGISTRATION_MODES,
  APPROVAL_MODES,
  VISIBILITIES,
  STANDARD_FIELDS,
  STANDARD_KEYS,
  CUSTOM_FIELD_TYPES,
  SUBMISSION_FIELDS,
  SUBMISSION_FIELD_STATES,
  SUBMISSION_FILE_TYPES,
  AUTO_ANNOUNCEMENTS,
  CERTIFICATE_TYPES,
  RESULTS_VISIBILITY,
  JUDGE_ASSIGNMENT,
  PRESENTATION_ORDER,
  SPONSOR_TIERS,
  PRIZE_KINDS,
  CONFIG_DEFAULTS,
  SECTIONS,
};
