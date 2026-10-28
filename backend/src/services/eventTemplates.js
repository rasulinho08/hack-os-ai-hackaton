/**
 * @file eventTemplates.js
 * @description Starting points for a new event (decision J1: templates).
 *
 * A template fills the builder with sensible values — dates relative to
 * today in the event's time zone, team sizes, what a submission asks for,
 * judging criteria, the first three prizes, the registration form and a set
 * of house rules — so a typical event needs minutes, not an afternoon.
 * Everything it sets stays editable; nothing here is enforced.
 */

const { STANDARD_FIELDS, CONFIG_DEFAULTS } = require('../constants/eventBuilder');

const TEMPLATE_KEYS = Object.freeze(['blank', 'hackathon24', 'ideathon', 'university']);

// ── Time zones ──────────────────────────────────────────────────────────────

/** Milliseconds the zone is ahead of UTC at `date`. */
function zoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const p = Object.fromEntries(parts.filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The UTC instant of a wall-clock time in a zone. */
function zonedTime(y, m, d, hh, mm, timeZone) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = zoneOffsetMs(new Date(guess), timeZone);
  let ts = guess - first;
  const second = zoneOffsetMs(new Date(ts), timeZone);
  if (second !== first) ts = guess - second;
  return new Date(ts);
}

/** Calendar date (y, m, d) of `date` in a zone, shifted by `days`. */
function zonedDay(date, timeZone, days = 0) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const p = Object.fromEntries(parts.filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

const HOUR = 3600 * 1000;

// ── Localised starting text ─────────────────────────────────────────────────

const CRITERIA = {
  hackathon: {
    az: [['İnnovasiya', 'İdeya nə qədər yeni və cəsarətlidir'], ['Texniki icra', 'Məhsul işləyirmi, kod nə qədər keyfiyyətlidir'], ['Təsir', 'Real problemi nə qədər həll edir'], ['Təqdimat', 'Komanda ideyanı nə qədər aydın çatdırır']],
    en: [['Innovation', 'How new and bold the idea is'], ['Technical execution', 'Does it work, how good is the build'], ['Impact', 'How well it solves a real problem'], ['Presentation', 'How clearly the team tells the story']],
    ru: [['Инновационность', 'Насколько идея новая и смелая'], ['Техническая реализация', 'Работает ли продукт, качество решения'], ['Влияние', 'Насколько решает реальную проблему'], ['Презентация', 'Насколько ясно команда подаёт идею']],
  },
  ideathon: {
    az: [['Problem', 'Problem nə qədər dərin anlaşılıb'], ['Həll', 'Həll problemə nə qədər uyğundur'], ['Reallıq', 'Biznes modeli və icra planı'], ['Pitch', 'Təqdimatın aydınlığı və inandırıcılığı']],
    en: [['Problem', 'How deeply the problem is understood'], ['Solution', 'How well the solution fits the problem'], ['Feasibility', 'Business model and plan to deliver'], ['Pitch', 'Clarity and persuasiveness of the pitch']],
    ru: [['Проблема', 'Насколько глубоко понята проблема'], ['Решение', 'Насколько решение соответствует проблеме'], ['Реализуемость', 'Бизнес-модель и план реализации'], ['Питч', 'Ясность и убедительность выступления']],
  },
};

const PLACES = {
  az: ['1-ci yer', '2-ci yer', '3-cü yer'],
  en: ['1st place', '2nd place', '3rd place'],
  ru: ['1 место', '2 место', '3 место'],
};

const RULES = {
  az: [
    '1. Layihə tədbir müddətində yaradılmalıdır. Açıq mənbəli kitabxanalardan, API-lərdən və hazır alətlərdən istifadə etmək olar; əvvəlcədən hazırlanmış layihə təqdim etmək olmaz.',
    '2. Komandanın tərkibi qeydiyyatda göstərilən ölçüdə olmalıdır. Komanda dəyişiklikləri komanda qurma son tarixinə qədər edilə bilər.',
    '3. Təqdimetmə son tarixdən sonra qəbul edilmir. Təqdimetmədə tələb olunan bütün linklər işlək olmalıdır.',
    '4. Hakimlərin qərarı yekundur. Qiymətləndirmə meyarları tədbir səhifəsində açıqlanıb.',
    '5. Bütün iştirakçılar bir-birinə, mentorlara, hakimlərə və təşkilatçılara hörmətlə yanaşmalıdır. Təhqir, ayrı-seçkilik və təcavüz tədbirdən kənarlaşdırma ilə nəticələnir.',
    '6. Layihənin müəllif hüquqları komandaya məxsusdur, əgər təşkilatçı ayrıca şərt elan etməyibsə.',
  ].join('\n\n'),
  en: [
    '1. Projects must be built during the event. Open-source libraries, APIs and existing tools are allowed; submitting work prepared in advance is not.',
    '2. Teams must stay within the team size set at registration. Team changes are possible until the team formation deadline.',
    '3. Submissions are not accepted after the deadline. Every link a submission requires must work.',
    "4. The judges' decision is final. Judging criteria are published on the event page.",
    '5. Everyone treats fellow participants, mentors, judges and organisers with respect. Harassment, discrimination or abuse leads to removal from the event.',
    '6. Teams own the rights to their projects unless the organisers announce other terms.',
  ].join('\n\n'),
  ru: [
    '1. Проект должен быть создан во время мероприятия. Можно использовать open-source библиотеки, API и готовые инструменты; подавать заранее подготовленный проект нельзя.',
    '2. Состав команды должен соответствовать размеру, указанному при регистрации. Изменения возможны до окончания формирования команд.',
    '3. Работы после дедлайна не принимаются. Все обязательные ссылки должны работать.',
    '4. Решение жюри окончательное. Критерии оценки опубликованы на странице мероприятия.',
    '5. Все участники уважительно относятся друг к другу, к менторам, жюри и организаторам. Оскорбления, дискриминация и домогательства ведут к исключению.',
    '6. Права на проект принадлежат команде, если организаторы не объявили иное.',
  ].join('\n\n'),
};

// ── Templates ───────────────────────────────────────────────────────────────

const SPECS = {
  blank: { category: 'hackathon', hours: 48, teamMin: 1, teamMax: 4, criteria: null, prizes: false },
  hackathon24: { category: 'hackathon', hours: 24, teamMin: 2, teamMax: 4, criteria: 'hackathon', prizes: true },
  ideathon: {
    category: 'ideathon',
    hours: 32,
    teamMin: 2,
    teamMax: 5,
    criteria: 'ideathon',
    prizes: true,
    submission: {
      fields: { repo: 'off', demo: 'off', slides: 'required', video: 'optional', summary: 'required', tech: 'off' },
      files: { enabled: true, maxMb: 10, types: ['pdf', 'pptx'] },
    },
    fields: { github: { enabled: false } },
  },
  university: {
    category: 'hackathon',
    hours: 48,
    teamMin: 2,
    teamMax: 4,
    criteria: 'hackathon',
    prizes: true,
    studentsOnly: true,
    fields: { university: { enabled: true, required: true }, major: { enabled: true, required: true } },
  },
};

/**
 * Everything a new event starts with.
 * @param {string} key  one of TEMPLATE_KEYS
 * @param {{ timeZone: string, language: string, now?: Date }} opts
 */
function buildTemplate(key, { timeZone, language, now = new Date() }) {
  const spec = SPECS[key] || SPECS.blank;
  const lang = ['az', 'en', 'ru'].includes(language) ? language : 'az';

  const day = zonedDay(now, timeZone, 30);
  const start = zonedTime(day.y, day.m, day.d, 10, 0, timeZone);
  const end = new Date(start.getTime() + spec.hours * HOUR);
  const regClose = zonedDay(start, timeZone, -2);
  const registrationEnd = zonedTime(regClose.y, regClose.m, regClose.d, 23, 59, timeZone);
  const registrationStart = new Date(Math.floor(now.getTime() / 60000) * 60000);

  const event = {
    category: spec.category,
    language: lang,
    timezone: timeZone,
    start_date: start,
    end_date: end,
    registration_start: registrationStart,
    registration_end: registrationEnd,
    team_deadline: start,
    submission_deadline: end,
    demo_day: new Date(end.getTime() + HOUR),
    judging_start: new Date(end.getTime() + HOUR),
    judging_end: new Date(end.getTime() + 4 * HOUR),
    results_at: new Date(end.getTime() + 5 * HOUR),
    min_team_size: spec.teamMin,
    team_size_limit: spec.teamMax,
    registration_mode: 'both',
    approval_mode: 'manual',
    waitlist_enabled: true,
    rules: RULES[lang],
    eligibility: { ...CONFIG_DEFAULTS.eligibility, studentsOnly: Boolean(spec.studentsOnly), requireRules: true },
    submission_config: {
      fields: { ...CONFIG_DEFAULTS.submission_config.fields, ...(spec.submission?.fields || {}) },
      files: { ...CONFIG_DEFAULTS.submission_config.files, ...(spec.submission?.files || {}) },
    },
    judging_config: { ...CONFIG_DEFAULTS.judging_config },
    mentor_config: { ...CONFIG_DEFAULTS.mentor_config },
    presentation_config: { ...CONFIG_DEFAULTS.presentation_config },
    comms_config: { ...CONFIG_DEFAULTS.comms_config, auto: { ...CONFIG_DEFAULTS.comms_config.auto } },
    certificate_config: { ...CONFIG_DEFAULTS.certificate_config, types: [...CONFIG_DEFAULTS.certificate_config.types] },
    template: key in SPECS ? key : 'blank',
  };

  const fields = STANDARD_FIELDS.map((f, i) => {
    const o = spec.fields?.[f.key] || {};
    return {
      field_key: f.key,
      kind: 'standard',
      type: f.type,
      options: f.options || [],
      enabled: o.enabled ?? f.defaultOn,
      required: o.required ?? false,
      sensitive: Boolean(f.sensitive),
      sort_order: i,
    };
  });

  const criteria = spec.criteria
    ? CRITERIA[spec.criteria][lang].map(([name, description], i) => ({ name, description, max_score: 10, weight: 1, sort_order: i }))
    : [];

  const prizes = spec.prizes
    ? PLACES[lang].map((name, i) => ({ kind: 'place', position: i + 1, name, value: null, sort_order: i }))
    : [];

  return { event, fields, criteria, prizes };
}

// ── Codes and slugs ─────────────────────────────────────────────────────────

const TRANSLIT = {
  ə: 'e', ı: 'i', İ: 'i', ş: 's', ç: 'c', ğ: 'g', ö: 'o', ü: 'u',
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function transliterate(s) {
  return String(s || '')
    .replace(/İ/g, 'i')
    .toLowerCase()
    .split('')
    .map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch))
    .join('')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

/** A URL-safe slug from a name: "Bakı AI Hackathon 2026" → "baki-ai-hackathon-2026". */
function slugify(name) {
  const s = transliterate(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '');
  return s || 'event';
}

/** A short registration code from a name: "Bakı AI Hackathon 2026" → "BAKIAIHACKAT". */
function codeFrom(name) {
  const s = transliterate(name).replace(/[^a-z0-9]+/g, '').toUpperCase().slice(0, 12);
  return s.length >= 3 ? s : `EVENT${s}`;
}

module.exports = {
  TEMPLATE_KEYS,
  buildTemplate,
  slugify,
  codeFrom,
  transliterate,
  zonedTime,
  zonedDay,
};
