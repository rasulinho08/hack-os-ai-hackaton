/**
 * @file autoAnnouncements.js
 * @description The automatic announcements an organiser switches on in the
 * builder (Messages): when each is due, and its words in the event's language.
 *
 * Each has a moment taken from the event's timeline and a window after it in
 * which it is still worth sending: a server that slept through "coding starts
 * in 30 minutes" does not send it after the start. `results` and `certs` are
 * not on the clock — they go out when results are published and certificates
 * issued (`trigger`).
 */

const HOUR = 3600e3;
const MIN = 60e3;

/** key → (event) → { at, until } in ms, or null when the event has no such moment. */
const TIMING = {
  reg24: (e) => (e.registration_end ? { at: ms(e.registration_end) - 24 * HOUR, until: ms(e.registration_end) } : null),
  regclosed: (e) => (e.registration_end ? { at: ms(e.registration_end), until: ms(e.registration_end) + 6 * HOUR } : null),
  start30: (e) => (e.start_date ? { at: ms(e.start_date) - 30 * MIN, until: ms(e.start_date) } : null),
  started: (e) => (e.start_date ? { at: ms(e.start_date), until: ms(e.start_date) + 2 * HOUR } : null),
  sub24: (e) => (deadline(e) ? { at: deadline(e) - 24 * HOUR, until: deadline(e) } : null),
  sub1: (e) => (deadline(e) ? { at: deadline(e) - HOUR, until: deadline(e) } : null),
  subclosed: (e) => (deadline(e) ? { at: deadline(e), until: deadline(e) + 6 * HOUR } : null),
  pres1: (e) => (e.demo_day ? { at: ms(e.demo_day) - HOUR, until: ms(e.demo_day) } : null),
  results: () => null,
  certs: () => null,
};

/*
 * Who each one is for (announcementAudience.js). "Submit in an hour" goes
 * only to those who have not submitted; reminders about the coding go to
 * the approved participants; the rest to everyone in the event.
 */
const AUDIENCE = {
  reg24: 'everyone',
  regclosed: 'everyone',
  start30: 'participants',
  started: 'participants',
  sub24: 'participants',
  sub1: 'no_submission',
  subclosed: 'participants',
  pres1: 'everyone',
  results: 'everyone',
  certs: 'everyone',
};

/** Announcements that also go by e-mail (F8: "email də"); the rest: platform + Telegram. */
const EMAIL_TOO = new Set(['sub1', 'results']);
/** Shown as urgent in the app and sent by e-mail as well (F3: urgent → Telegram + e-mail). */
const URGENT = new Set(['sub1', 'subclosed']);

function ms(v) { return new Date(v).getTime(); }
function deadline(e) { return e.submission_deadline ? ms(e.submission_deadline) : e.end_date ? ms(e.end_date) : null; }

const TEXT = {
  az: {
    reg24: ['Qeydiyyat 24 saata bağlanır', '{event} tədbirinə qeydiyyat {time} tarixində bağlanır. Hələ qeydiyyatdan keçməyən dostlarınızı unutmayın.'],
    regclosed: ['Qeydiyyat bağlandı', '{event} tədbirinə qeydiyyat bağlandı. Təşkilatçılar müraciətlərə baxır.'],
    start30: ['Kodlaşdırma 30 dəqiqəyə başlayır', '{event} {time} tarixində başlayır. Komandanızı toplayın, hazır olun!'],
    started: ['Kodlaşdırma başladı', '{event} başladı. Uğurlar! Layihəni {deadline} tarixinədək təqdim edin.'],
    sub24: ['Təqdimetməyə 24 saat qaldı', '{event}: layihələr {deadline} tarixinədək təqdim olunmalıdır.'],
    sub1: ['Təqdimetməyə 1 saat qaldı', '{event}: təqdimetmə {deadline} tarixində bağlanır. Komanda lideri layihəni indi göndərsin.'],
    subclosed: ['Təqdimetmə bağlandı', '{event}: təqdimetmə bağlandı. Hakimlər layihələri qiymətləndirməyə başlayır.'],
    pres1: ['Təqdimatlar 1 saata başlayır', '{event}: təqdimatlar {time} tarixində başlayır. Slaydlarınızı yoxlayın.'],
    results: ['Nəticələr elan olundu', '{event} nəticələri elan olundu. Paneldə öz nəticənizə baxın.'],
    certs: ['Sertifikatlar hazırdır', '{event} sertifikatları hazırdır. Paneldən yükləyə bilərsiniz.'],
  },
  en: {
    reg24: ['Registration closes in 24 hours', 'Registration for {event} closes on {time}. Tell friends who have not registered yet.'],
    regclosed: ['Registration is closed', 'Registration for {event} is closed. The organisers are reviewing applications.'],
    start30: ['Coding starts in 30 minutes', '{event} starts on {time}. Gather your team and get ready!'],
    started: ['Coding has started', '{event} has started. Good luck! Submit your project by {deadline}.'],
    sub24: ['24 hours to submit', '{event}: projects must be submitted by {deadline}.'],
    sub1: ['1 hour to submit', '{event}: submissions close on {deadline}. Team leads, submit your project now.'],
    subclosed: ['Submissions are closed', '{event}: submissions are closed. The judges are starting to score the projects.'],
    pres1: ['Presentations start in 1 hour', '{event}: presentations start on {time}. Check your slides.'],
    results: ['Results are out', 'The results of {event} are out. See yours on your dashboard.'],
    certs: ['Certificates are ready', 'The certificates for {event} are ready. Download yours from your dashboard.'],
  },
  ru: {
    reg24: ['Регистрация закроется через 24 часа', 'Регистрация на {event} закрывается {time}. Напомните друзьям, которые ещё не зарегистрировались.'],
    regclosed: ['Регистрация закрыта', 'Регистрация на {event} закрыта. Организаторы рассматривают заявки.'],
    start30: ['Хакатон начнётся через 30 минут', '{event} начинается {time}. Собирайте команду и готовьтесь!'],
    started: ['Хакатон начался', '{event} начался. Удачи! Сдайте проект до {deadline}.'],
    sub24: ['До сдачи проектов 24 часа', '{event}: проекты нужно сдать до {deadline}.'],
    sub1: ['До сдачи проектов 1 час', '{event}: приём проектов закрывается {deadline}. Капитаны, отправьте проект сейчас.'],
    subclosed: ['Приём проектов закрыт', '{event}: приём проектов закрыт. Жюри начинает оценивать работы.'],
    pres1: ['Презентации начнутся через час', '{event}: презентации начинаются {time}. Проверьте слайды.'],
    results: ['Результаты объявлены', 'Результаты {event} объявлены. Посмотрите свой результат в кабинете.'],
    certs: ['Сертификаты готовы', 'Сертификаты {event} готовы. Скачайте свой в кабинете.'],
  },
};

const LOCALE = { az: 'az-AZ', en: 'en-GB', ru: 'ru-RU' };

/**
 * "21 October at 03:17", "21 октября в 03:17" — and for Azerbaijani an
 * explicit "21 oktyabr, 03:17": the runtime's az-AZ pattern joins the date
 * and the time with the English "at".
 */
function formatWhen(value, timeZone, lang) {
  if (!value) return '';
  try {
    const fmt = new Intl.DateTimeFormat(LOCALE[lang] || 'en-GB', {
      day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: timeZone || 'Asia/Baku',
    });
    if (lang !== 'az') return fmt.format(new Date(value));
    const part = Object.fromEntries(fmt.formatToParts(new Date(value)).map((x) => [x.type, x.value]));
    return `${part.day} ${part.month}, ${part.hour}:${part.minute}`;
  } catch {
    return new Date(value).toISOString().slice(0, 16).replace('T', ' ');
  }
}

/** Title and body of announcement `key` for event `e`, in the event's language. */
function render(key, e) {
  const lang = TEXT[e.language] ? e.language : 'en';
  const [title, body] = TEXT[lang][key];
  const time = key.startsWith('reg') ? e.registration_end : key === 'pres1' ? e.demo_day : e.start_date;
  const deadlineAt = e.submission_deadline || e.end_date;
  const fill = (s) => s
    .split('{event}').join(e.name)
    .split('{time}').join(formatWhen(time, e.timezone, lang))
    .split('{deadline}').join(formatWhen(deadlineAt, e.timezone, lang));
  return { title: fill(title), body: fill(body), urgent: URGENT.has(key), email: EMAIL_TOO.has(key) || URGENT.has(key) };
}

/** Keys of `enabled` whose moment has come and whose window is still open. */
function due(e, enabled, now = Date.now()) {
  return Object.keys(TIMING).filter((key) => {
    if (!enabled[key]) return false;
    const w = TIMING[key](e);
    return Boolean(w) && Number.isFinite(w.at) && now >= w.at && now < w.until;
  });
}

module.exports = { TIMING, TEXT, AUDIENCE, EMAIL_TOO, URGENT, render, due, formatWhen };
