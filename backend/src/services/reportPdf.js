/**
 * @file reportPdf.js
 * @description The post-event report as a PDF: A4 portrait, in the event's
 * language (Azerbaijani, English or Russian), drawn with pdf-lib and Inter
 * like the certificates and invoices.
 *
 *   1  the event, the key numbers and the participation funnel
 *   2  the timeline, registrations per day and who came (aggregated)
 *   3  judging, winners and prizes, feedback (NPS) and sponsors
 *
 * The pages flow: a section that does not fit starts on the next page. The
 * input is report.service.js's data, which holds aggregates only; nothing
 * here reads the database. With the organiser's branding (a plan feature)
 * the report wears the event's colour and logo, otherwise HackOS's.
 *
 * Charts follow one rule set: one hue (the accent) for magnitude, bars from a
 * single baseline with a rounded data end, the value in ink at the tip,
 * hairline rules, no legend for a single series.
 */

const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { fonts } = require('../utils/pdfFonts');
const { azOrdinal, enOrdinal } = require('./certificatePdf');

const W = 595.28;
const H = 841.89;
const M = 48;
const CW = W - 2 * M;
const BOTTOM = 64;

const INK = rgb(0.08, 0.09, 0.11);
const INK2 = rgb(0.3, 0.32, 0.37);
const INK3 = rgb(0.47, 0.49, 0.54);
const LINE = rgb(0.87, 0.88, 0.9);
const SOFT = rgb(0.965, 0.968, 0.975);
const GREY = rgb(0.7, 0.72, 0.76);
const WHITE = rgb(1, 1, 1);

const MONTHS = {
  az: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
};
const MONTHS_SHORT = {
  az: ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avq', 'sen', 'okt', 'noy', 'dek'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ru: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
};

const WORDS = {
  en: {
    title: 'Post-event report',
    organisedBy: 'Organised by {who}',
    prepared: 'Prepared {date}',
    formats: { online: 'Online', offline: 'In person', hybrid: 'Hybrid' },
    key: 'Key numbers',
    summary: 'Summary',
    sum: {
      people: (c) => `${c.registrations} ${c.registrations === '1' ? 'person' : 'people'} registered and ${c.approved} ${c.approved === '1' ? 'was' : 'were'} admitted${c.checkedIn != null ? `; ${c.checkedIn} checked in on the day` : ''}.`,
      work: (c) => `${c.teams} ${c.teams === '1' ? 'team' : 'teams'} handed in ${c.projects} ${c.projects === '1' ? 'project' : 'projects'}; ${c.judges} ${c.judges === '1' ? 'judge' : 'judges'} completed ${c.reviews} ${c.reviews === '1' ? 'review' : 'reviews'}.`,
      winner: (c) => `First place${c.prize ? ` (${c.prize})` : ''}: ${c.project ? `${c.project} by ${c.team}` : c.team}.`,
      nps: (c) => `Participants gave the event an NPS of ${c.nps} (${c.responses} ${c.responses === '1' ? 'response' : 'responses'}).`,
    },
    k: {
      registrations: 'Registrations', approved: 'Approved', checkedIn: 'Checked in', teams: 'Teams',
      projects: 'Projects submitted', judges: 'Judges', reviews: 'Complete reviews', nps: 'NPS',
    },
    funnel: 'Participation funnel',
    funnelHint: 'People, from registration to a team; then teams to projects.',
    f: {
      registrations: 'Registered', approved: 'Approved', checkedIn: 'Checked in', inTeams: 'In a team',
      teams: 'Teams formed', projects: 'Projects submitted',
    },
    ofRegistered: 'of registered',
    notTracked: 'not tracked',
    statusLine: 'Also: {waitlisted} on the waiting list, {pending} not reviewed, {rejected} not admitted.',
    timeline: 'Timeline',
    t: {
      registration_start: 'Registration opened', registration_end: 'Registration closed', team_deadline: 'Teams locked',
      start: 'Event started', submission_deadline: 'Submissions closed', judging_start: 'Judging started',
      judging_end: 'Judging ended', end: 'Event ended', results: 'Results announced',
    },
    perDay: 'Registrations per day',
    perDayHint: 'From the first registration to the last, in the event’s time zone.',
    who: 'Who took part',
    whoHint: 'From the event’s registration form. Groups under {min} people are counted as “Other”.',
    d: { university: 'Universities', experience: 'Experience', city: 'Cities', country: 'Countries', major: 'Fields of study', gender: 'Gender', source: 'How they heard' },
    other: 'Other',
    answers: '{n} answers',
    tooFew: 'Fewer than {min} answers: not shown, to protect privacy.',
    noDemo: 'The registration form did not ask about universities, experience or cities.',
    judging: 'Judging',
    j: { judges: 'Judges', reviews: 'Complete reviews', perProject: 'Reviews per project', reviewed: 'Projects reviewed' },
    criteria: 'Criteria',
    weight: 'Weight',
    maxScore: 'Max score',
    noCriteria: 'No scoring criteria were set.',
    winners: 'Winners and prizes',
    w: { prize: 'Prize', team: 'Team', project: 'Project' },
    placeOf: (n) => `${enOrdinal(n)} place`,
    notPublished: 'The results were not published.',
    noPrizes: 'No prizes were awarded.',
    ranked: '{n} teams ranked',
    tracks: 'Tracks',
    teamsN: '{n} teams',
    feedback: 'Feedback',
    npsTitle: 'Net Promoter Score',
    npsHint: '“Would you recommend this event?” 0–10. Promoters 9–10, passives 7–8, detractors 0–6.',
    bands: { promoters: 'Promoters', passives: 'Passives', detractors: 'Detractors' },
    responses: '{n} responses',
    noNps: 'Nobody answered the recommendation question.',
    rating: 'Average rating: {avg} / 5 ({n} answers)',
    sponsors: 'Sponsors and partners',
    noSponsors: 'No sponsors were listed.',
    tiers: { platinum: 'Platinum', gold: 'Gold', silver: 'Silver', bronze: 'Bronze', partner: 'Partners', none: 'Sponsors' },
    privacy: 'This report holds aggregated figures only: no names, e-mail addresses or phone numbers of participants, judges or mentors, and no written feedback. Teams, projects, prizes and sponsors appear as the event published them.',
    page: '{i} / {n}',
    by: 'HackOS',
    experience: { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', expert: 'Expert' },
    gender: { female: 'Female', male: 'Male', other: 'Other', prefer_not: 'Prefer not to say' },
    source: { social: 'Social media', friend: 'A friend', university: 'University', email: 'E-mail', website: 'Website', telegram: 'Telegram', other: 'Other' },
  },
  az: {
    title: 'Tədbirdən sonrakı hesabat',
    organisedBy: 'Təşkilatçı: {who}',
    prepared: 'Hazırlanıb: {date}',
    formats: { online: 'Onlayn', offline: 'Əyani', hybrid: 'Hibrid' },
    key: 'Əsas göstəricilər',
    summary: 'Qısa xülasə',
    sum: {
      people: (c) => `${c.registrations} nəfər qeydiyyatdan keçdi, ${c.approved} nəfər qəbul olundu${c.checkedIn != null ? `, ${c.checkedIn} nəfər tədbirə gəldi` : ''}.`,
      work: (c) => `${c.teams} komanda ${c.projects} layihə təqdim etdi; ${c.judges} münsif ${c.reviews} tam qiymətləndirmə apardı.`,
      winner: (c) => `Birinci yer${c.prize ? ` (${c.prize})` : ''}: ${c.project ? `${c.team} komandasının “${c.project}” layihəsi` : `${c.team} komandası`}.`,
      nps: (c) => `İştirakçıların tövsiyə indeksi (NPS): ${c.nps} (${c.responses} cavab).`,
    },
    k: {
      registrations: 'Qeydiyyat', approved: 'Qəbul olunub', checkedIn: 'Gəlib', teams: 'Komanda',
      projects: 'Təqdim olunan layihə', judges: 'Münsif', reviews: 'Tam qiymətləndirmə', nps: 'NPS',
    },
    funnel: 'İştirak hunisi',
    funnelHint: 'İnsanlar: qeydiyyatdan komandaya qədər; sonra komandalardan layihələrə.',
    f: {
      registrations: 'Qeydiyyatdan keçib', approved: 'Qəbul olunub', checkedIn: 'Gəlib', inTeams: 'Komandada',
      teams: 'Yaradılan komanda', projects: 'Təqdim olunan layihə',
    },
    ofRegistered: 'qeydiyyatdan',
    notTracked: 'qeyd olunmayıb',
    statusLine: 'Həmçinin: {waitlisted} nəfər gözləmə siyahısında, {pending} nəfərə baxılmayıb, {rejected} nəfər qəbul olunmayıb.',
    timeline: 'Zaman xətti',
    t: {
      registration_start: 'Qeydiyyat açıldı', registration_end: 'Qeydiyyat bağlandı', team_deadline: 'Komandalar dəqiqləşdi',
      start: 'Tədbir başladı', submission_deadline: 'Layihə qəbulu bitdi', judging_start: 'Qiymətləndirmə başladı',
      judging_end: 'Qiymətləndirmə bitdi', end: 'Tədbir bitdi', results: 'Nəticələr elan olundu',
    },
    perDay: 'Günlər üzrə qeydiyyat',
    perDayHint: 'İlk qeydiyyatdan sonuncuya qədər, tədbirin saat qurşağı ilə.',
    who: 'Kimlər iştirak etdi',
    whoHint: 'Tədbirin qeydiyyat formasından. {min} nəfərdən az olan qruplar “Digər” kimi sayılır.',
    d: { university: 'Universitetlər', experience: 'Təcrübə', city: 'Şəhərlər', country: 'Ölkələr', major: 'İxtisaslar', gender: 'Cins', source: 'Haradan eşidiblər' },
    other: 'Digər',
    answers: '{n} cavab',
    tooFew: '{min} cavabdan az: məxfiliyi qorumaq üçün göstərilmir.',
    noDemo: 'Qeydiyyat forması universitet, təcrübə və ya şəhər haqqında soruşmayıb.',
    judging: 'Qiymətləndirmə',
    j: { judges: 'Münsif', reviews: 'Tam qiymətləndirmə', perProject: 'Layihə başına qiymət', reviewed: 'Qiymətləndirilən layihə' },
    criteria: 'Meyarlar',
    weight: 'Çəki',
    maxScore: 'Maks. bal',
    noCriteria: 'Qiymətləndirmə meyarı təyin olunmayıb.',
    winners: 'Qaliblər və mükafatlar',
    w: { prize: 'Mükafat', team: 'Komanda', project: 'Layihə' },
    placeOf: (n) => `${azOrdinal(n)} yer`,
    notPublished: 'Nəticələr dərc olunmayıb.',
    noPrizes: 'Mükafat verilməyib.',
    ranked: 'Reytinqdə {n} komanda',
    tracks: 'İstiqamətlər',
    teamsN: '{n} komanda',
    feedback: 'Rəylər',
    npsTitle: 'Net Promoter Score (NPS)',
    npsHint: '“Bu tədbiri tövsiyə edərdinizmi?” 0–10. Tərəfdarlar 9–10, neytrallar 7–8, narazılar 0–6.',
    bands: { promoters: 'Tərəfdarlar', passives: 'Neytrallar', detractors: 'Narazılar' },
    responses: '{n} cavab',
    noNps: 'Tövsiyə sualına cavab verən olmayıb.',
    rating: 'Orta qiymət: {avg} / 5 ({n} cavab)',
    sponsors: 'Sponsorlar və tərəfdaşlar',
    noSponsors: 'Sponsor qeyd olunmayıb.',
    tiers: { platinum: 'Platin', gold: 'Qızıl', silver: 'Gümüş', bronze: 'Bürünc', partner: 'Tərəfdaşlar', none: 'Sponsorlar' },
    privacy: 'Bu hesabatda yalnız ümumiləşdirilmiş rəqəmlər var: iştirakçıların, münsiflərin və mentorların adları, e-poçt ünvanları və telefon nömrələri, eləcə də yazılı rəylər yoxdur. Komandalar, layihələr, mükafatlar və sponsorlar tədbirin dərc etdiyi kimi göstərilir.',
    page: '{i} / {n}',
    by: 'HackOS',
    experience: { beginner: 'Başlanğıc', intermediate: 'Orta', advanced: 'Təcrübəli', expert: 'Ekspert' },
    gender: { female: 'Qadın', male: 'Kişi', other: 'Digər', prefer_not: 'Demək istəmir' },
    source: { social: 'Sosial şəbəkələr', friend: 'Dost', university: 'Universitet', email: 'E-poçt', website: 'Sayt', telegram: 'Telegram', other: 'Digər' },
  },
  ru: {
    title: 'Итоговый отчёт о мероприятии',
    organisedBy: 'Организатор: {who}',
    prepared: 'Подготовлен {date}',
    formats: { online: 'Онлайн', offline: 'Очно', hybrid: 'Гибрид' },
    key: 'Ключевые цифры',
    summary: 'Коротко',
    sum: {
      people: (c) => `Регистраций: ${c.registrations}, одобрено: ${c.approved}${c.checkedIn != null ? `, пришли на мероприятие: ${c.checkedIn}` : ''}.`,
      work: (c) => `Команд: ${c.teams}, сдано проектов: ${c.projects}; жюри (${c.judges}) провело полных оценок: ${c.reviews}.`,
      winner: (c) => `Первое место${c.prize ? ` (${c.prize})` : ''}: ${c.project ? `проект «${c.project}» команды «${c.team}»` : `команда «${c.team}»`}.`,
      nps: (c) => `Индекс NPS мероприятия: ${c.nps} (ответов: ${c.responses}).`,
    },
    k: {
      registrations: 'Регистрации', approved: 'Одобрено', checkedIn: 'Пришли', teams: 'Команды',
      projects: 'Сданные проекты', judges: 'Члены жюри', reviews: 'Полные оценки', nps: 'NPS',
    },
    funnel: 'Воронка участия',
    funnelHint: 'Люди — от регистрации до команды; затем команды — до проектов.',
    f: {
      registrations: 'Зарегистрировались', approved: 'Одобрены', checkedIn: 'Пришли', inTeams: 'В команде',
      teams: 'Команд создано', projects: 'Проектов сдано',
    },
    ofRegistered: 'от зарегистрированных',
    notTracked: 'не отмечалось',
    statusLine: 'Также: {waitlisted} в листе ожидания, {pending} не рассмотрено, {rejected} не допущено.',
    timeline: 'Хронология',
    t: {
      registration_start: 'Открыта регистрация', registration_end: 'Закрыта регистрация', team_deadline: 'Составы команд закрыты',
      start: 'Начало мероприятия', submission_deadline: 'Закрыт приём проектов', judging_start: 'Начало оценки',
      judging_end: 'Конец оценки', end: 'Конец мероприятия', results: 'Объявлены результаты',
    },
    perDay: 'Регистрации по дням',
    perDayHint: 'От первой регистрации до последней, по часовому поясу мероприятия.',
    who: 'Кто участвовал',
    whoHint: 'По анкете регистрации мероприятия. Группы меньше {min} человек считаются как «Другое».',
    d: { university: 'Университеты', experience: 'Опыт', city: 'Города', country: 'Страны', major: 'Специальности', gender: 'Пол', source: 'Откуда узнали' },
    other: 'Другое',
    answers: 'Ответов: {n}',
    tooFew: 'Меньше {min} ответов: не показано ради конфиденциальности.',
    noDemo: 'Анкета регистрации не спрашивала об университете, опыте или городе.',
    judging: 'Оценка',
    j: { judges: 'Члены жюри', reviews: 'Полные оценки', perProject: 'Оценок на проект', reviewed: 'Оценено проектов' },
    criteria: 'Критерии',
    weight: 'Вес',
    maxScore: 'Макс. балл',
    noCriteria: 'Критерии оценки не заданы.',
    winners: 'Победители и призы',
    w: { prize: 'Приз', team: 'Команда', project: 'Проект' },
    placeOf: (n) => `${n}-е место`,
    notPublished: 'Результаты не публиковались.',
    noPrizes: 'Призы не вручались.',
    ranked: 'В рейтинге команд: {n}',
    tracks: 'Направления',
    teamsN: 'Команд: {n}',
    feedback: 'Отзывы',
    npsTitle: 'Индекс NPS',
    npsHint: '«Порекомендуете ли вы это мероприятие?» 0–10. Сторонники 9–10, нейтральные 7–8, критики 0–6.',
    bands: { promoters: 'Сторонники', passives: 'Нейтральные', detractors: 'Критики' },
    responses: 'Ответов: {n}',
    noNps: 'На вопрос о рекомендации никто не ответил.',
    rating: 'Средняя оценка: {avg} / 5 (ответов: {n})',
    sponsors: 'Спонсоры и партнёры',
    noSponsors: 'Спонсоры не указаны.',
    tiers: { platinum: 'Платиновые', gold: 'Золотые', silver: 'Серебряные', bronze: 'Бронзовые', partner: 'Партнёры', none: 'Спонсоры' },
    privacy: 'В отчёте только сводные цифры: нет имён, адресов электронной почты и телефонов участников, членов жюри и менторов, нет текстов отзывов. Команды, проекты, призы и спонсоры указаны так, как их опубликовало мероприятие.',
    page: '{i} / {n}',
    by: 'HackOS',
    experience: { beginner: 'Начинающий', intermediate: 'Средний', advanced: 'Продвинутый', expert: 'Эксперт' },
    gender: { female: 'Женский', male: 'Мужской', other: 'Другое', prefer_not: 'Предпочли не указывать' },
    source: { social: 'Соцсети', friend: 'Друзья', university: 'Университет', email: 'E-mail', website: 'Сайт', telegram: 'Telegram', other: 'Другое' },
  },
};

const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));

/** "#C8102E" → rgb(); anything else → the HackOS red. */
function colour(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  const v = m ? parseInt(m[1], 16) : 0xc8102e;
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

/** Year, month, day, hour, minute of a moment in a time zone. */
function partsIn(date, tz) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  } catch {
    fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  }
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month) - 1, d: Number(p.day), hh: p.hour, mm: p.minute };
}

function dayText(lang, date, tz) {
  const p = partsIn(date, tz);
  if (!p) return '';
  const m = MONTHS[lang] || MONTHS.en;
  return `${p.d} ${m[p.m]} ${p.y}`;
}

function dateTimeText(lang, date, tz) {
  const p = partsIn(date, tz);
  if (!p) return '';
  return `${dayText(lang, date, tz)}, ${p.hh}:${p.mm}`;
}

/** "25–27 October 2026", "30 October – 2 November 2026" in the event's zone. */
function rangeText(lang, start, end, tz) {
  const a = start ? partsIn(start, tz) : null;
  const b = end ? partsIn(end, tz) : null;
  const m = MONTHS[lang] || MONTHS.en;
  if (!a && !b) return '';
  if (!a || !b) return dayText(lang, start || end, tz);
  if (a.y === b.y && a.m === b.m) return a.d === b.d ? dayText(lang, start, tz) : `${a.d}–${b.d} ${m[a.m]} ${a.y}`;
  if (a.y === b.y) return `${a.d} ${m[a.m]} – ${b.d} ${m[b.m]} ${b.y}`;
  return `${dayText(lang, start, tz)} – ${dayText(lang, end, tz)}`;
}

function num(lang, v) {
  const s = String(Math.round(Number(v) || 0));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'en' ? ',' : ' ');
}

const pct = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

/** Split text into lines no wider than `max`. */
function wrap(text, font, size, max) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= max || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Cut to fit `max` points, with an ellipsis. */
function fit(text, font, size, max) {
  let s = String(text ?? '');
  if (font.widthOfTextAtSize(s, size) <= max) return s;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** Characters Inter has no glyph for (emoji and the like) would stop the PDF; they are dropped. */
function printable(font) {
  const set = font.getCharacterSet ? new Set(font.getCharacterSet()) : null;
  return (text) => {
    const s = String(text ?? '');
    if (!set) return s;
    return [...s].filter((ch) => set.has(ch.codePointAt(0)) || ch === ' ').join('');
  };
}

class Doc {
  constructor(doc, regular, bold, accent, w, lang) {
    Object.assign(this, { doc, regular, bold, accent, w, lang });
    this.clean = printable(regular);
    this.pages = [];
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([W, H]);
    this.pages.push(this.page);
    this.page.drawRectangle({ x: 0, y: H - 5, width: W, height: 5, color: this.accent });
    this.y = H - M;
  }

  ensure(h) {
    if (this.y - h < BOTTOM) this.newPage();
  }

  text(s, x, y, { size = 10, font = this.regular, color = INK, max = null } = {}) {
    const str = this.clean(s);
    const out = max ? fit(str, font, size, max) : str;
    this.page.drawText(out, { x, y, size, font, color });
    return font.widthOfTextAtSize(out, size);
  }

  right(s, xr, y, opts = {}) {
    const font = opts.font || this.regular;
    const size = opts.size || 10;
    const str = this.clean(s);
    const w = font.widthOfTextAtSize(str, size);
    this.page.drawText(str, { x: xr - w, y, size, font, color: opts.color || INK });
  }

  /** A paragraph from the cursor down; returns its height. */
  para(s, { x = M, size = 10, font = this.regular, color = INK2, max = CW, leading = 1.45 } = {}) {
    const lines = wrap(this.clean(s), font, size, max);
    for (const l of lines) {
      this.ensure(size * leading);
      this.page.drawText(l, { x, y: this.y - size, size, font, color });
      this.y -= size * leading;
    }
    return lines.length * size * leading;
  }

  /** A section title with an accent tick; starts a page when less than `need` points are left. */
  section(title, hint = null, need = 120) {
    this.ensure(need);
    if (this.y < H - M - 4) this.y -= 14;
    this.page.drawRectangle({ x: M, y: this.y - 15, width: 3, height: 15, color: this.accent });
    this.text(title, M + 11, this.y - 13, { size: 14, font: this.bold });
    this.y -= 22;
    if (hint) {
      this.y -= 2;
      this.para(hint, { size: 9, color: INK3 });
    }
    this.y -= 8;
  }

  sub(title) {
    this.ensure(40);
    this.text(title, M, this.y - 10, { size: 10.5, font: this.bold });
    this.y -= 18;
  }

  rule(y = this.y) {
    this.page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: LINE });
  }

  /** A bar from the baseline with a rounded data end (square at the baseline). */
  bar(x, yTop, width, height, color) {
    if (width <= 0) return;
    const r = Math.min(3, height / 2, width);
    const path = `M0,0 H${width - r} Q${width},0 ${width},${r} V${height - r} Q${width},${height} ${width - r},${height} H0 Z`;
    this.page.drawSvgPath(path, { x, y: yTop, color });
  }

  column(x, yBase, width, height, color) {
    if (height <= 0) return;
    const r = Math.min(3, width / 2, height);
    const path = `M0,0 V${-(height - r)} Q0,${-height} ${r},${-height} H${width - r} Q${width},${-height} ${width},${-(height - r)} V0 Z`;
    this.page.drawSvgPath(path, { x, y: yBase, color });
  }
}

/** Horizontal bars, one row each: label, bar, value (and a share) at the tip. */
function hbars(d, rows, { labelW = 150, total = null, max = null, note = null } = {}) {
  const barMax = CW - labelW - 92;
  const top = max ?? Math.max(1, ...rows.map((r) => r.n || 0));
  const rowH = 22;
  for (const r of rows) {
    d.ensure(rowH);
    const yMid = d.y - rowH / 2;
    d.text(r.label, M, yMid - 3.5, { size: 9.5, color: r.muted ? INK3 : INK, max: labelW - 10 });
    if (r.n == null) {
      d.text(r.empty || '—', M + labelW + 6, yMid - 3.5, { size: 9, color: INK3 });
    } else {
      const w = Math.max(r.n > 0 ? 2 : 0, (r.n / top) * barMax);
      d.bar(M + labelW, yMid + 6, w, 12, r.muted ? GREY : d.accent);
      const value = `${num(d.lang, r.n)}${r.share ? `  ·  ${r.share}` : total ? `  ·  ${pct(r.n, total)}` : ''}`;
      d.text(value, M + labelW + w + 6, yMid - 3.5, { size: 9, color: INK2 });
    }
    d.y -= rowH;
  }
  // The baseline the bars grow from.
  const h = rows.length * rowH;
  d.page.drawLine({ start: { x: M + labelW, y: d.y + 4 }, end: { x: M + labelW, y: Math.min(d.y + h, H - M) }, thickness: 0.6, color: LINE });
  if (note) {
    d.y -= 4;
    d.para(note, { size: 8.5, color: INK3 });
  }
}

function drawHeader(d, c) {
  const { w, lang } = d;
  const e = c.event;
  let y = H - 40;
  // The organiser's logo when the plan includes branding; HackOS's mark otherwise.
  if (c._logoImage) {
    const img = c._logoImage;
    const scale = Math.min(150 / img.width, 40 / img.height, 1);
    d.page.drawImage(img, { x: M, y: y - img.height * scale, width: img.width * scale, height: img.height * scale });
  } else {
    d.page.drawRectangle({ x: M, y: y - 20, width: 20, height: 20, color: colour('#C8102E') });
    d.text('H', M + 5.6, y - 15.2, { size: 12, font: d.bold, color: WHITE });
    d.text('HackOS', M + 28, y - 15, { size: 12.5, font: d.bold });
  }
  d.right(w.title.toUpperCase(), W - M, y - 14, { size: 8.5, font: d.bold, color: INK3 });
  y -= 70;

  // The event's name, as large as it reads well, on up to two lines.
  let size = 28;
  let lines = wrap(d.clean(e.name), d.bold, size, CW);
  while (lines.length > 2 && size > 18) {
    size -= 2;
    lines = wrap(d.clean(e.name), d.bold, size, CW);
  }
  for (const l of lines.slice(0, 2)) {
    d.page.drawText(fit(l, d.bold, size, CW), { x: M, y: y - size, size, font: d.bold, color: INK });
    y -= size * 1.15;
  }
  d.y = y - 6;
  if (e.tagline) d.para(e.tagline, { size: 11.5, color: INK2 });
  d.y -= 4;
  const where = e.format === 'online'
    ? w.formats.online
    : [e.venue, e.city, w.formats[e.format] || null].filter(Boolean).join(' · ');
  const meta = [rangeText(lang, e.startDate, e.endDate, e.timezone), where].filter(Boolean).join('   ·   ');
  d.para(meta, { size: 10.5, color: INK, font: d.regular });
  const by = [e.organiser ? fill(w.organisedBy, { who: e.organiser }) : null, fill(w.prepared, { date: dayText(lang, c.generatedAt, e.timezone) })]
    .filter(Boolean).join('   ·   ');
  d.para(by, { size: 9.5, color: INK3 });
  d.y -= 14;
  d.rule();
  d.y -= 6;
}

function drawKeyNumbers(d, c) {
  const { w, lang } = d;
  d.section(w.key, null, 160);
  const f = c.funnel;
  const nps = c.feedback.nps;
  const tiles = [
    [w.k.registrations, num(lang, f.registrations)],
    [w.k.approved, num(lang, f.approved)],
    [w.k.checkedIn, f.checkedIn == null ? '—' : num(lang, f.checkedIn)],
    [w.k.teams, num(lang, f.teams)],
    [w.k.projects, num(lang, f.projects)],
    [w.k.judges, num(lang, c.judging.judges)],
    [w.k.reviews, num(lang, c.judging.reviews)],
    [w.k.nps, nps.score == null ? '—' : `${nps.score > 0 ? '+' : ''}${nps.score}`],
  ];
  const cols = 4;
  const gap = 10;
  const tw = (CW - gap * (cols - 1)) / cols;
  const th = 58;
  tiles.forEach(([label, value], i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = M + col * (tw + gap);
    const yTop = d.y - row * (th + gap);
    d.page.drawRectangle({ x, y: yTop - th, width: tw, height: th, color: SOFT });
    d.text(value, x + 12, yTop - 30, { size: 21, font: d.bold, max: tw - 20 });
    d.text(label, x + 12, yTop - 47, { size: 8.5, color: INK3, max: tw - 20 });
  });
  d.y -= 2 * th + gap + 6;
}

function drawFunnel(d, c) {
  const { w, lang } = d;
  const f = c.funnel;
  d.section(w.funnel, w.funnelHint, 220);
  hbars(d, [
    { label: w.f.registrations, n: f.registrations },
    { label: w.f.approved, n: f.approved, share: pct(f.approved, f.registrations) },
    { label: w.f.checkedIn, n: f.checkedIn, share: f.checkedIn == null ? null : pct(f.checkedIn, f.registrations), empty: w.notTracked },
    { label: w.f.inTeams, n: f.inTeams, share: pct(f.inTeams, f.registrations) },
  ], { max: Math.max(1, f.registrations) });
  d.y -= 8;
  hbars(d, [
    { label: w.f.teams, n: f.teams },
    { label: w.f.projects, n: f.projects, share: pct(f.projects, f.teams) },
  ], { max: Math.max(1, f.teams) });
  d.y -= 2;
  if (f.waitlisted || f.pending || f.rejected) {
    d.para(fill(w.statusLine, { waitlisted: num(lang, f.waitlisted), pending: num(lang, f.pending), rejected: num(lang, f.rejected) }), { size: 8.5, color: INK3 });
  }
}

/** A few sentences for whoever reads only the first page (a sponsor, a dean). */
function drawSummary(d, c) {
  const { w, lang } = d;
  const f = c.funnel;
  const N = (v) => num(lang, v);
  const lines = [
    w.sum.people({ registrations: N(f.registrations), approved: N(f.approved), checkedIn: f.checkedIn == null ? null : N(f.checkedIn) }),
    w.sum.work({ teams: N(f.teams), projects: N(f.projects), judges: N(c.judging.judges), reviews: N(c.judging.reviews) }),
  ];
  const first = c.winners.published ? c.winners.items.find((x) => x.kind === 'place' && x.position === 1) : null;
  if (first && first.team) lines.push(w.sum.winner({ prize: first.prize, team: first.team, project: first.project }));
  const { nps } = c.feedback;
  if (nps.responses) lines.push(w.sum.nps({ nps: `${nps.score > 0 ? '+' : ''}${nps.score}`, responses: N(nps.responses) }));
  const height = lines.reduce((h, l) => h + wrap(d.clean(l), d.regular, 10.5, CW - 40).length * 15.5, 0) + 18;
  d.section(w.summary, null, height + 40);
  d.page.drawRectangle({ x: M, y: d.y - height, width: CW, height, color: SOFT });
  let y = d.y - 18;
  for (const l of lines) {
    d.page.drawCircle({ x: M + 14, y: y + 3.5, size: 2, color: d.accent });
    for (const part of wrap(d.clean(l), d.regular, 10.5, CW - 40)) {
      d.page.drawText(part, { x: M + 24, y, size: 10.5, font: d.regular, color: INK });
      y -= 15.5;
    }
  }
  d.y -= height;
}

function drawTimeline(d, c) {
  const { w, lang } = d;
  const items = c.timeline.slice(0, 12);
  if (!items.length) return;
  // The section asks for room for every row, so the list never breaks across pages.
  d.section(w.timeline, null, 40 + items.length * 20);
  const x = M + 6;
  const rowH = 20;
  d.page.drawLine({ start: { x, y: d.y - 6 }, end: { x, y: d.y - 6 - (items.length - 1) * rowH }, thickness: 0.8, color: LINE });
  for (const t of items) {
    d.page.drawCircle({ x, y: d.y - 6, size: 5, color: WHITE });
    d.page.drawCircle({ x, y: d.y - 6, size: 3.2, color: d.accent });
    d.text(dateTimeText(lang, t.at, c.event.timezone), M + 20, d.y - 9.5, { size: 9.5, color: INK2 });
    d.text(w.t[t.key] || t.key, M + 190, d.y - 9.5, { size: 10, font: d.bold });
    d.y -= rowH;
  }
}

function drawPerDay(d, c) {
  const { w, lang } = d;
  const days = c.registrationsByDay;
  if (days.length < 2) return;
  const chartH = 110;
  d.section(w.perDay, w.perDayHint, chartH + 90);
  const top = Math.max(...days.map((x) => x.n));
  const slot = CW / days.length;
  const cw = Math.max(1.5, Math.min(18, slot - 2));
  const base = d.y - chartH;
  d.page.drawLine({ start: { x: M, y: base }, end: { x: W - M, y: base }, thickness: 0.8, color: LINE });
  days.forEach((x, i) => {
    const h = (x.n / top) * (chartH - 16);
    d.column(M + i * slot + (slot - cw) / 2, base, cw, h, d.accent);
  });
  // The busiest day, labelled at its cap; the axis carries the rest.
  const peak = days.reduce((a, b, i) => (b.n > days[a].n ? i : a), 0);
  const px = M + peak * slot + slot / 2;
  const label = num(lang, days[peak].n);
  d.text(label, Math.min(W - M - 20, Math.max(M, px - d.regular.widthOfTextAtSize(label, 8.5) / 2)), base + chartH - 16 + 4, { size: 8.5, color: INK2 });
  const short = (s) => {
    const [, mm, dd] = s.split('-').map(Number);
    return `${dd} ${(MONTHS_SHORT[lang] || MONTHS_SHORT.en)[mm - 1]}`;
  };
  d.text(short(days[0].day), M, base - 12, { size: 8, color: INK3 });
  d.right(short(days[days.length - 1].day), W - M, base - 12, { size: 8, color: INK3 });
  d.y = base - 22;
}

function optionLabel(w, lang, key, item) {
  if (key === 'experience' || key === 'gender' || key === 'source') return w[key]?.[item.key] || item.label;
  if (key === 'country' && /^[a-z]{2}$/i.test(item.label)) {
    try {
      return new Intl.DisplayNames([lang], { type: 'region' }).of(item.label.toUpperCase()) || item.label;
    } catch {
      return item.label;
    }
  }
  return item.label;
}

function drawDemographics(d, c) {
  const { w } = d;
  const keys = ['university', 'experience', 'city', 'country', 'major', 'gender', 'source'].filter((k) => c.demographics[k]);
  d.section(w.who, fill(w.whoHint, { min: c.privacy.minGroup }), 150);
  if (!keys.length) {
    d.para(w.noDemo, { size: 9.5, color: INK3 });
    return;
  }
  for (const key of keys) {
    const b = c.demographics[key];
    d.ensure(b.hidden || !b.items.length ? 50 : 30 + (b.items.length + (b.other ? 1 : 0)) * 22);
    d.text(w.d[key] || key, M, d.y - 10, { size: 10.5, font: d.bold });
    d.right(fill(w.answers, { n: num(d.lang, b.total) }), W - M, d.y - 10, { size: 8.5, color: INK3 });
    d.y -= 18;
    if (b.hidden || !b.items.length) {
      d.para(fill(w.tooFew, { min: c.privacy.minAnswers }), { size: 9, color: INK3 });
      d.y -= 8;
      continue;
    }
    const rows = b.items.map((it) => ({ label: optionLabel(w, d.lang, key, it), n: it.n }));
    if (b.other) rows.push({ label: w.other, n: b.other, muted: true });
    hbars(d, rows, { total: b.total, max: Math.max(...rows.map((r) => r.n)), labelW: 170 });
    d.y -= 10;
  }
}

function drawJudging(d, c) {
  const { w, lang } = d;
  const j = c.judging;
  d.section(w.judging, null, 150);
  const figs = [
    [w.j.judges, num(lang, j.judges)],
    [w.j.reviews, num(lang, j.reviews)],
    [w.j.reviewed, `${num(lang, j.projectsReviewed)} / ${num(lang, j.projects)}`],
    [w.j.perProject, j.reviewsPerProject == null ? '—' : String(j.reviewsPerProject).replace('.', lang === 'en' ? '.' : ',')],
  ];
  const fw = CW / figs.length;
  figs.forEach(([label, value], i) => {
    d.text(value, M + i * fw, d.y - 20, { size: 18, font: d.bold });
    d.text(label, M + i * fw, d.y - 34, { size: 8.5, color: INK3, max: fw - 8 });
  });
  d.y -= 50;
  if (!j.criteria.length) {
    d.para(w.noCriteria, { size: 9.5, color: INK3 });
    return;
  }
  const totalWeight = j.criteria.reduce((s, x) => s + (x.weight || 0), 0) || 1;
  d.ensure(30);
  d.text(w.criteria, M, d.y - 10, { size: 8.5, font: d.bold, color: INK3 });
  d.right(w.weight, W - M - 80, d.y - 10, { size: 8.5, font: d.bold, color: INK3 });
  d.right(w.maxScore, W - M, d.y - 10, { size: 8.5, font: d.bold, color: INK3 });
  d.y -= 16;
  for (const cr of j.criteria) {
    d.ensure(20);
    d.rule(d.y);
    d.text(cr.name, M, d.y - 13, { size: 10, max: CW - 180 });
    d.right(`${Math.round((cr.weight / totalWeight) * 100)}%`, W - M - 80, d.y - 13, { size: 10, color: INK2 });
    d.right(num(lang, cr.maxScore), W - M, d.y - 13, { size: 10, color: INK2 });
    d.y -= 20;
  }
  d.rule(d.y);
}

function drawWinners(d, c) {
  const { w, lang } = d;
  const win = c.winners;
  d.section(w.winners, win.published && win.teamsRanked ? fill(w.ranked, { n: num(lang, win.teamsRanked) }) : null, 120);
  if (!win.published) {
    d.para(w.notPublished, { size: 9.5, color: INK3 });
    return;
  }
  if (!win.items.length) {
    d.para(w.noPrizes, { size: 9.5, color: INK3 });
    return;
  }
  const colX = [M, M + 190, M + 340];
  const colW = [180, 145, CW - 340];
  d.ensure(30);
  [w.w.prize, w.w.team, w.w.project].forEach((h, i) => d.text(h, colX[i], d.y - 10, { size: 8.5, font: d.bold, color: INK3 }));
  d.y -= 16;
  for (const it of win.items) {
    const prizeLine = it.kind === 'place' && it.position ? `${w.placeOf(it.position)} · ${it.prize}` : it.prize;
    const sub = it.value ? it.value : null;
    const rowH = sub ? 32 : 22;
    d.ensure(rowH);
    d.rule(d.y);
    d.text(prizeLine, colX[0], d.y - 14, { size: 10, font: d.bold, max: colW[0] });
    if (sub) d.text(sub, colX[0], d.y - 26, { size: 8.5, color: INK3, max: colW[0] });
    d.text(it.team || '—', colX[1], d.y - 14, { size: 10, max: colW[1] - 8 });
    d.text(it.project || '—', colX[2], d.y - 14, { size: 10, color: INK2, max: colW[2] });
    d.y -= rowH;
  }
  d.rule(d.y);
  if (c.tracks.length) {
    d.y -= 14;
    d.sub(w.tracks);
    d.para(c.tracks.map((t) => `${t.name} (${fill(w.teamsN, { n: num(lang, t.teams) })})`).join('   ·   '), { size: 9.5 });
  }
}

function drawFeedback(d, c) {
  const { w, lang } = d;
  const { nps, rating } = c.feedback;
  d.section(w.feedback, null, 150);
  if (!nps.responses) {
    d.para(w.noNps, { size: 9.5, color: INK3 });
  } else {
    const score = `${nps.score > 0 ? '+' : ''}${nps.score}`;
    d.text(score, M, d.y - 40, { size: 44, font: d.bold });
    const sx = M + d.bold.widthOfTextAtSize(score, 44) + 18;
    d.text(w.npsTitle, sx, d.y - 18, { size: 11, font: d.bold });
    d.text(fill(w.responses, { n: num(lang, nps.responses) }), sx, d.y - 33, { size: 9, color: INK3 });
    d.y -= 58;
    // The split: detractors · passives · promoters, with a 2 pt gap between parts.
    const parts = [
      ['detractors', nps.detractors, rgb(0.62, 0.64, 0.68)],
      ['passives', nps.passives, rgb(0.82, 0.83, 0.86)],
      ['promoters', nps.promoters, d.accent],
    ];
    const total = nps.responses;
    let x = M;
    const barW = CW;
    const live = parts.filter((p) => p[1] > 0);
    const gaps = Math.max(0, live.length - 1) * 2;
    for (const [, n, col] of live) {
      const pw = ((barW - gaps) * n) / total;
      d.page.drawRectangle({ x, y: d.y - 12, width: pw, height: 12, color: col });
      x += pw + 2;
    }
    d.y -= 26;
    let lx = M;
    for (const [key, n, col] of parts) {
      d.page.drawRectangle({ x: lx, y: d.y - 8, width: 8, height: 8, color: col });
      const label = `${w.bands[key]}: ${num(lang, n)} (${pct(n, total)})`;
      d.text(label, lx + 13, d.y - 8, { size: 9, color: INK2 });
      lx += 13 + d.regular.widthOfTextAtSize(label, 9) + 22;
    }
    d.y -= 20;
    d.para(w.npsHint, { size: 8.5, color: INK3 });
  }
  if (rating.responses) {
    d.y -= 4;
    d.para(fill(w.rating, { avg: String(rating.average).replace('.', lang === 'en' ? '.' : ','), n: num(lang, rating.responses) }), { size: 10, color: INK });
  }
}

function drawSponsors(d, c) {
  const { w } = d;
  d.section(w.sponsors, null, 90);
  if (!c.sponsors.length) {
    d.para(w.noSponsors, { size: 9.5, color: INK3 });
    return;
  }
  const order = ['platinum', 'gold', 'silver', 'bronze', 'partner'];
  const groups = new Map();
  for (const s of c.sponsors) {
    const tier = order.includes(String(s.tier || '').toLowerCase()) ? String(s.tier).toLowerCase() : 'none';
    if (!groups.has(tier)) groups.set(tier, []);
    groups.get(tier).push(s.name);
  }
  for (const tier of [...order, 'none']) {
    if (!groups.has(tier)) continue;
    d.ensure(34);
    d.text(w.tiers[tier], M, d.y - 10, { size: 8.5, font: d.bold, color: INK3 });
    d.y -= 14;
    d.para(groups.get(tier).join('   ·   '), { size: 11, color: INK, font: d.bold });
    d.y -= 6;
  }
}

function drawPrivacy(d) {
  const lines = wrap(d.clean(d.w.privacy), d.regular, 8.5, CW - 24);
  const h = lines.length * 12.5 + 18;
  d.ensure(h + 20);
  d.y -= 18;
  d.page.drawRectangle({ x: M, y: d.y - h, width: CW, height: h, color: SOFT });
  let y = d.y - 15;
  for (const l of lines) {
    d.page.drawText(l, { x: M + 12, y, size: 8.5, font: d.regular, color: INK2 });
    y -= 12.5;
  }
  d.y -= h;
}

function drawFooters(d, c) {
  const n = d.pages.length;
  d.pages.forEach((page, i) => {
    page.drawLine({ start: { x: M, y: 40 }, end: { x: W - M, y: 40 }, thickness: 0.5, color: LINE });
    const left = fit(d.clean(`${c.event.name} · ${d.w.title}`), d.regular, 8, CW - 120);
    page.drawText(left, { x: M, y: 27, size: 8, font: d.regular, color: INK3 });
    const right = `${d.w.by}   ${fill(d.w.page, { i: i + 1, n })}`;
    page.drawText(right, { x: W - M - d.regular.widthOfTextAtSize(right, 8), y: 27, size: 8, font: d.regular, color: INK3 });
  });
}

/**
 * @param {object} c report.service.js build() output (without internals), plus
 *   `logo`: { bytes, mime } | null — the organiser's logo when branded
 * @returns {Promise<Uint8Array>}
 */
async function renderReportPdf(c) {
  const lang = WORDS[c.language] ? c.language : 'az';
  const w = WORDS[lang];
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const { regular: regularBytes, bold: boldBytes } = fonts();
  // Subsetting with @pdf-lib/fontkit drops glyphs; the whole font is embedded (as for invoices).
  const regular = await doc.embedFont(regularBytes, { subset: false });
  const bold = await doc.embedFont(boldBytes, { subset: false });
  doc.setTitle(`${w.title} · ${c.event.name}`);
  doc.setSubject(w.title);
  doc.setAuthor(c.event.organiser || 'HackOS');
  doc.setCreator('HackOS');
  doc.setProducer('HackOS');
  doc.setLanguage(lang);
  doc.setCreationDate(new Date(c.generatedAt || Date.now()));

  const accent = colour(c.branding && c.branding.branded ? c.branding.colour : null);
  const ctx = { ...c };
  if (c.logo && c.logo.bytes) {
    try {
      const mime = String(c.logo.mime || '').toLowerCase();
      ctx._logoImage = mime.includes('png') ? await doc.embedPng(c.logo.bytes) : await doc.embedJpg(c.logo.bytes);
    } catch (err) {
      console.warn('[report] logo skipped:', err.message);
    }
  }
  const d = new Doc(doc, regular, bold, accent, w, lang);
  drawHeader(d, ctx);
  drawKeyNumbers(d, ctx);
  drawFunnel(d, ctx);
  drawSummary(d, ctx);
  d.newPage();
  drawTimeline(d, ctx);
  drawPerDay(d, ctx);
  drawDemographics(d, ctx);
  drawJudging(d, ctx);
  drawWinners(d, ctx);
  drawFeedback(d, ctx);
  drawSponsors(d, ctx);
  drawPrivacy(d);
  drawFooters(d, ctx);
  return doc.save();
}

module.exports = { renderReportPdf, WORDS, rangeText, dayText };
