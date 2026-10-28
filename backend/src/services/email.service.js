/**
 * @file email.service.js
 * @description Every e-mail HackOS sends, one function each.
 *
 * Delivery goes through `mailer.js` (Resend, Brevo or SMTP — see there); the
 * look comes from `emailTemplate.js`. Functions here only decide the words and
 * the link. Recipients and links are always derived on the server by the
 * caller — nothing here should be handed an address or URL straight from a
 * request body without the caller checking it first.
 *
 * Every function resolves to the mailer's result and never throws:
 *   { ok: true, provider, id }  or  { ok: false, provider, status, message }
 * The older `{ success }` field is kept alongside for callers that read it.
 */

const mailer = require('./mailer');
const { renderEmail } = require('./emailTemplate');

const appBase = (frontendUrl) => String(frontendUrl || '').replace(/\/+$/, '');

const LANGS = new Set(['az', 'en', 'ru']);
/** The event's language when it is one the app speaks, else null. */
const eventLang = (lang) => (LANGS.has(lang) ? lang : null);

/**
 * The link with the event's language on it (?lang=), so the page it opens
 * (confirming the address, signing in, the dashboard) speaks the language
 * of the e-mail, whatever the browser had chosen before.
 */
function withLang(url, lang) {
  if (!url || !eventLang(lang)) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has('lang')) u.searchParams.set('lang', lang);
    return u.toString();
  } catch {
    return url;
  }
}

/** Adds the legacy `success` flag the older callers check. */
const withLegacy = (out) => ({ ...out, success: out.ok });

/**
 * @param {string} to
 * @param {object} content          see emailTemplate.renderEmail
 * @param {{ replyTo?: string, fromName?: string }} [sender]
 *   An event's own signature (eventSender.js); platform mail passes nothing.
 */
async function deliver(to, content, { replyTo, fromName } = {}) {
  const { html, text } = renderEmail(content.cta && content.linkLang
    ? { ...content, cta: { ...content.cta, url: withLang(content.cta.url, content.linkLang) } }
    : content);
  return withLegacy(await mailer.sendMail({ to, subject: content.subject, html, text, replyTo, fromName }));
}

/* ── Registration links ─────────────────────────────────────────────────── */

/**
 * Where an invited judge/mentor/volunteer registers.
 *
 * The web app has no /register route: registration lives on /login, which
 * reads eventCode, email and register=1 from the query string and opens the
 * register tab with the fields filled in. The role comes from the invitation
 * the inviteToken names (inviteToken.js): signing up through this link hands
 * it over at once; without the token it waits until the address is confirmed.
 */
const buildInviteRegisterUrl = (frontendUrl, eventCode, email, inviteToken) => {
  const params = new URLSearchParams({ eventCode: String(eventCode || ''), email: String(email || ''), register: '1' });
  if (inviteToken) params.set('inviteToken', String(inviteToken));
  return `${appBase(frontendUrl)}/login?${params.toString()}`;
};

const ROLE_LABELS = { judge: 'Judge', mentor: 'Mentor', volunteer: 'Volunteer', hacker: 'Participant' };

/* ── Event staff and participants ───────────────────────────────────────── */

/**
 * Invite onto an event roster (judge, mentor, volunteer or pre-approved
 * hacker). Sent from the dashboard's "send registration link" action and,
 * when SEND_EMAIL_ON_EVENT_INVITE=true, as soon as the invite row is added.
 */
function sendEventInviteEmail({ to, role, eventName, eventCode, frontendUrl, inviterName, sender, inviteToken }) {
  const label = ROLE_LABELS[role] || 'Participant';
  const event = String(eventName || 'a hackathon');
  return deliver(to, {
    subject: `You're invited to ${event} as a ${label}`,
    preheader: `Create your HackOS account to join ${event}.`,
    eyebrow: event,
    heading: `You're invited as a ${label}`,
    paragraphs: [
      [inviterName ? { b: String(inviterName) } : 'The organisers', ' invited you to ', { b: event }, ' as a ', { b: label.toLowerCase() }, '.'],
      ['Create your account with ', { b: String(to) }, ' through the button below — the invitation is tied to this address and your role is applied when you sign up.'],
      ...(eventCode ? [['Event code: ', { b: String(eventCode) }]] : []),
    ],
    cta: { label: 'Create my account', url: buildInviteRegisterUrl(frontendUrl, eventCode, to, inviteToken) },
    note: 'If you were not expecting this invitation, you can ignore this e-mail.',
  }, sender);
}

/**
 * An existing account was added to an event as judge, mentor, volunteer or
 * pre-approved participant. No registration needed: sign in and pick the
 * event under "My workspaces".
 */
function sendAddedToEventEmail({ to, fullName, role, eventName, frontendUrl, inviterName, sender }) {
  const label = ROLE_LABELS[role] || 'Participant';
  const event = String(eventName || 'a hackathon');
  const name = String(fullName || '').trim() || 'there';
  return deliver(to, {
    subject: `You were added to ${event} as a ${label}`,
    preheader: `Sign in to HackOS to open ${event}.`,
    eyebrow: event,
    heading: `You're a ${label.toLowerCase()} at ${event}`,
    paragraphs: [
      [`Hi ${name},`],
      [inviterName ? { b: String(inviterName) } : 'The organisers', ' added you to ', { b: event }, ' as a ', { b: label.toLowerCase() }, '.'],
      ['Sign in with your existing account and choose the event under “My workspaces”.'],
    ],
    cta: { label: 'Open HackOS', url: `${appBase(frontendUrl)}/workspaces` },
    note: 'If you were not expecting this, reply to this e-mail and we will remove you.',
  }, sender);
}

/** Kept for the original call sites; same message as sendEventInviteEmail. */
const sendInviteEmail = (args) => sendEventInviteEmail(args);

/**
 * A hacker signed up for an event. Open registration lands as "pending" and
 * the organiser reviews it; an invited hacker is approved straight away.
 */
const REGISTERED_WORDS = {
  en: {
    approved: ['You\'re registered — {event}', 'Your place at {event} is confirmed.', 'Your registration is confirmed', ['You are registered for {event}. You can sign in and open your dashboard now.'], 'Open my dashboard'],
    waitlisted: ['You\'re on the waiting list — {event}', '{event} is full; you are on the waiting list.', 'You are on the waiting list', ['Thanks for registering for {event}. Every place is taken right now, so you are on the waiting list.', 'If a place opens up you move up automatically, and you will get an e-mail when that happens.'], 'Check my status'],
    pending: ['Registration received — {event}', 'The organisers of {event} will review your registration.', 'We received your registration', ['Thanks for registering for {event}. The organisers review every registration; you will get another e-mail as soon as yours is approved.', 'Until then, signing in shows the status of your application.'], 'Check my status'],
    hi: 'Hi {name},', there: 'there', note: 'If you did not register, you can ignore this e-mail.',
  },
  az: {
    approved: ['Qeydiyyatdan keçdiniz — {event}', '{event} tədbirində yeriniz təsdiqləndi.', 'Qeydiyyatınız təsdiqləndi', ['{event} tədbirinə qeydiyyatdan keçdiniz. İndi daxil olub panelinizi aça bilərsiniz.'], 'Panelimi aç'],
    waitlisted: ['Gözləmə siyahısındasınız — {event}', '{event} doludur; gözləmə siyahısındasınız.', 'Gözləmə siyahısındasınız', ['{event} tədbirinə qeydiyyatdan keçdiyiniz üçün təşəkkür edirik. Hazırda bütün yerlər tutulub, ona görə gözləmə siyahısındasınız.', 'Yer açılsa, avtomatik irəliləyəcəksiniz və bu barədə e-poçt alacaqsınız.'], 'Statusuma bax'],
    pending: ['Qeydiyyatınız qəbul edildi — {event}', '{event} təşkilatçıları qeydiyyatınıza baxacaq.', 'Qeydiyyatınızı aldıq', ['{event} tədbirinə qeydiyyatdan keçdiyiniz üçün təşəkkür edirik. Təşkilatçılar hər qeydiyyata baxır; sizinki təsdiqlənən kimi daha bir məktub alacaqsınız.', 'O vaxtadək daxil olub müraciətinizin statusunu görə bilərsiniz.'], 'Statusuma bax'],
    hi: 'Salam, {name}!', there: '', note: 'Qeydiyyatdan keçməmisinizsə, bu məktuba məhəl qoymayın.',
  },
  ru: {
    approved: ['Вы зарегистрированы — {event}', 'Ваше место на {event} подтверждено.', 'Регистрация подтверждена', ['Вы зарегистрированы на {event}. Можно войти и открыть кабинет.'], 'Открыть кабинет'],
    waitlisted: ['Вы в листе ожидания — {event}', 'Мест на {event} нет; вы в листе ожидания.', 'Вы в листе ожидания', ['Спасибо за регистрацию на {event}. Сейчас все места заняты, поэтому вы в листе ожидания.', 'Если место освободится, вы продвинетесь автоматически и получите письмо.'], 'Мой статус'],
    pending: ['Заявка получена — {event}', 'Организаторы {event} рассмотрят вашу заявку.', 'Мы получили вашу заявку', ['Спасибо за регистрацию на {event}. Организаторы рассматривают каждую заявку; как только вашу одобрят, придёт ещё одно письмо.', 'А пока статус заявки виден после входа.'], 'Мой статус'],
    hi: 'Здравствуйте, {name}!', there: '', note: 'Если вы не регистрировались, просто проигнорируйте это письмо.',
  },
};

/**
 * Someone just registered for an event: confirmed, received for review, or
 * on the waiting list — in the event's language, signed by the event.
 */
function sendRegistrationReceivedEmail({ to, fullName, eventName, status, frontendUrl, sender, lang }) {
  const L = REGISTERED_WORDS[lang] ? lang : 'en';
  const w = REGISTERED_WORDS[L];
  const words = w[status === 'approved' || status === 'waitlisted' ? status : 'pending'];
  const event = String(eventName || 'HackOS');
  const fillIn = (x) => String(x).split('{event}').join(event);
  const name = String(fullName || '').trim();
  return deliver(to, {
    subject: fillIn(words[0]),
    preheader: fillIn(words[1]),
    eyebrow: event,
    heading: words[2],
    paragraphs: [
      ...(name || w.there ? [[w.hi.split('{name}').join(name || w.there)]] : []),
      ...words[3].map((x) => [fillIn(x)]),
    ],
    cta: { label: words[4], url: `${appBase(frontendUrl)}/login` },
    note: w.note,
    lang: L,
    linkLang: eventLang(lang),
  }, sender);
}

/** Hacker approved for an event (admin PATCH participant status). */
function sendParticipantApprovedEmail({ to, fullName, eventName, eventCode, frontendUrl, sender }) {
  const event = String(eventName || 'the hackathon');
  const name = String(fullName || '').trim() || 'there';
  return deliver(to, {
    subject: `You're approved — ${event}`,
    preheader: `Your registration for ${event} has been approved.`,
    eyebrow: event,
    heading: "You're in!",
    paragraphs: [
      [`Hi ${name},`],
      ['Your registration for ', { b: event }, ' has been ', { b: 'approved' }, '. Your dashboard is open: find or create a team, follow announcements and submit your project there.'],
      ...(eventCode ? [['Event code: ', { b: String(eventCode) }]] : []),
    ],
    cta: { label: 'Open my dashboard', url: `${appBase(frontendUrl)}/hacker` },
    note: 'If you did not register, you can ignore this e-mail.',
  }, sender);
}

const SUBMITTED_WORDS = {
  en: {
    subject: 'Project submitted — {event}', pre: '{project} is in for {event}.', heading: 'Your project is submitted',
    hi: 'Hi {name},', team: '{team} submitted {project} for {event}.', noTeam: 'Your team submitted {project} for {event}.',
    edit: 'The team lead can still update the submission until the deadline. Judges see the latest version.',
    cta: 'View submission', project: 'its project',
  },
  az: {
    subject: 'Layihə təqdim olundu — {event}', pre: '{project} {event} üçün qəbul olundu.', heading: 'Layihəniz təqdim olundu',
    hi: 'Salam, {name}!', team: '{team} komandası {event} üçün {project} layihəsini təqdim etdi.', noTeam: 'Komandanız {event} üçün {project} layihəsini təqdim etdi.',
    edit: 'Komanda lideri son tarixədək layihəni yeniləyə bilər. Münsiflər ən son versiyanı görür.',
    cta: 'Təqdimata bax', project: 'layihəsini',
  },
  ru: {
    subject: 'Проект сдан — {event}', pre: '{project} принят на {event}.', heading: 'Ваш проект сдан',
    hi: 'Здравствуйте, {name}!', team: 'Команда {team} сдала проект {project} на {event}.', noTeam: 'Ваша команда сдала проект {project} на {event}.',
    edit: 'Капитан может обновлять проект до дедлайна. Жюри видит последнюю версию.',
    cta: 'Открыть проект', project: 'свой проект',
  },
};

/** Sent to every member of the team when its lead submits the project, in the event's language. */
function sendSubmissionReceivedEmail({ to, fullName, eventName, teamName, projectName, frontendUrl, sender, lang }) {
  const L = SUBMITTED_WORDS[lang] ? lang : 'en';
  const w = SUBMITTED_WORDS[L];
  const event = String(eventName || 'HackOS');
  const project = String(projectName || '').trim();
  const name = String(fullName || '').trim();
  const fill = (x) => String(x)
    .split('{event}').join(event)
    .split('{project}').join(project || w.project)
    .split('{team}').join(String(teamName || ''))
    .split('{name}').join(name);
  return deliver(to, {
    subject: fill(w.subject),
    preheader: fill(w.pre),
    eyebrow: event,
    heading: w.heading,
    paragraphs: [
      ...(name ? [[fill(w.hi)]] : []),
      [fill(teamName ? w.team : w.noTeam)],
      [w.edit],
    ],
    cta: { label: w.cta, url: `${appBase(frontendUrl)}/hacker/submit` },
    lang: L,
    linkLang: eventLang(lang),
  }, sender);
}

/* ── Announcements ──────────────────────────────────────────────────────── */

const ANNOUNCEMENT_WORDS = {
  en: { open: 'Open announcements', urgent: 'Urgent', why: 'You receive this because you take part in {event}.' },
  az: { open: 'Elanlara bax', urgent: 'Təcili', why: '{event} tədbirində iştirak etdiyiniz üçün bu məktubu alırsınız.' },
  ru: { open: 'Открыть объявления', urgent: 'Срочно', why: 'Вы получили это письмо, потому что участвуете в {event}.' },
};

/**
 * An organiser's announcement, by e-mail (announcementDelivery.js). The
 * words are the organiser's; the frame is in the event's language, and the
 * mail is signed the way the event signs its mail.
 */
function sendAnnouncementEmail({ to, eventName, title, content, priority, url, lang, sender }) {
  const w = ANNOUNCEMENT_WORDS[lang] || ANNOUNCEMENT_WORDS.en;
  const event = String(eventName || 'HackOS');
  const urgent = ['urgent', 'high'].includes(String(priority || '').toLowerCase());
  const text = String(content || '').trim();
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => [p]);
  return deliver(to, {
    subject: `${urgent ? `[${w.urgent}] ` : ''}${String(title || '').trim()} — ${event}`,
    preheader: text.replace(/\s+/g, ' ').slice(0, 140),
    eyebrow: event,
    heading: String(title || '').trim(),
    paragraphs,
    cta: url ? { label: w.open, url } : undefined,
    note: w.why.replace('{event}', event),
    lang: ANNOUNCEMENT_WORDS[lang] ? lang : 'en',
    linkLang: eventLang(lang),
  }, sender);
}

/* ── Participant status (in the event's language) ──────────────────────── */

const STATUS_WORDS = {
  en: {
    approved: ['You\'re in — {event}', 'You\'re in!', 'Your registration for {event} has been approved. Your dashboard is open: find or create a team, follow announcements and submit your project there.', 'Open my dashboard'],
    rejected: ['About your registration — {event}', 'Your registration was not accepted', 'Thank you for registering for {event}. The organisers could not offer you a place this time. We hope to see you at a future event.', null],
    waitlisted: ['You\'re on the waiting list — {event}', 'You\'re on the waiting list', '{event} is full for now. You are on the waiting list and will hear from us as soon as a place opens up.', null],
    promoted: ['A place opened up — {event}', 'A place opened up for you', 'Good news: a place at {event} opened up and you have moved off the waiting list. The organisers will review your registration shortly.', 'Open HackOS'],
    hi: 'Hi {name},',
    note: 'If you did not register, you can ignore this e-mail.',
  },
  az: {
    approved: ['Qəbul olundunuz — {event}', 'Qəbul olundunuz!', '{event} tədbirinə qeydiyyatınız təsdiqləndi. Paneliniz açıqdır: komanda tapın və ya yaradın, elanları izləyin və layihənizi oradan təqdim edin.', 'Panelimi aç'],
    rejected: ['Qeydiyyatınız haqqında — {event}', 'Qeydiyyatınız qəbul olunmadı', '{event} tədbirinə qeydiyyatdan keçdiyiniz üçün təşəkkür edirik. Təşkilatçılar bu dəfə sizə yer təklif edə bilmədilər. Növbəti tədbirlərdə görüşmək ümidi ilə.', null],
    waitlisted: ['Gözləmə siyahısındasınız — {event}', 'Gözləmə siyahısındasınız', '{event} hazırda doludur. Gözləmə siyahısındasınız; yer açılan kimi sizə xəbər verəcəyik.', null],
    promoted: ['Yer açıldı — {event}', 'Sizin üçün yer açıldı', 'Xoş xəbər: {event} tədbirində yer açıldı və gözləmə siyahısından çıxdınız. Təşkilatçılar qeydiyyatınıza tezliklə baxacaq.', 'HackOS-u aç'],
    hi: 'Salam, {name}!',
    note: 'Qeydiyyatdan keçməmisinizsə, bu məktuba məhəl qoymayın.',
  },
  ru: {
    approved: ['Вы приняты — {event}', 'Вы приняты!', 'Ваша регистрация на {event} одобрена. Кабинет открыт: найдите или создайте команду, следите за объявлениями и сдавайте проект там.', 'Открыть кабинет'],
    rejected: ['О вашей регистрации — {event}', 'Регистрация не принята', 'Спасибо за регистрацию на {event}. В этот раз организаторы не смогли предложить вам место. Надеемся увидеть вас на следующих мероприятиях.', null],
    waitlisted: ['Вы в листе ожидания — {event}', 'Вы в листе ожидания', 'Мест на {event} пока нет. Вы в листе ожидания — мы сообщим, как только освободится место.', null],
    promoted: ['Освободилось место — {event}', 'Для вас освободилось место', 'Хорошие новости: на {event} освободилось место, и вы вышли из листа ожидания. Организаторы скоро рассмотрят вашу заявку.', 'Открыть HackOS'],
    hi: 'Здравствуйте, {name}!',
    note: 'Если вы не регистрировались, просто проигнорируйте это письмо.',
  },
};

/**
 * A participant's registration changed: approved, not accepted, on the
 * waiting list, or moved up from it. In the event's language, signed by the
 * event.
 */
function sendParticipantStatusEmail({ to, fullName, eventName, status, lang, frontendUrl, sender }) {
  const L = STATUS_WORDS[lang] ? lang : 'en';
  const w = STATUS_WORDS[L];
  const words = w[status];
  if (!words) return Promise.resolve({ ok: false, success: false, status: 400, message: `No e-mail for status ${status}` });
  const event = String(eventName || 'HackOS');
  const fillIn = (x) => String(x).split('{event}').join(event);
  const name = String(fullName || '').trim();
  return deliver(to, {
    subject: fillIn(words[0]),
    preheader: fillIn(words[2]).slice(0, 140),
    eyebrow: event,
    heading: fillIn(words[1]),
    paragraphs: [
      ...(name ? [[w.hi.split('{name}').join(name)]] : []),
      [fillIn(words[2])],
    ],
    cta: words[3] ? { label: words[3], url: `${appBase(frontendUrl)}/hacker` } : undefined,
    note: w.note,
    lang: L,
    linkLang: eventLang(lang),
  }, sender);
}

/**
 * A short notice about an event (a team accepted a join request…): the
 * caller gives the words, already in the event's language.
 */
function sendEventNotice({ to, eventName, subject, heading, body, cta, lang, sender }) {
  const event = String(eventName || 'HackOS');
  return deliver(to, {
    subject: `${String(subject || heading || '').trim()} — ${event}`,
    preheader: String(body || '').slice(0, 140),
    eyebrow: event,
    heading: String(heading || subject || '').trim(),
    paragraphs: String(body || '').split(/\n\s*\n/).map((x) => [x.trim()]).filter((x) => x[0]),
    cta: cta && cta.url ? cta : undefined,
    lang: STATUS_WORDS[lang] ? lang : 'en',
    linkLang: eventLang(lang),
  }, sender);
}

const WELCOME_WORDS = {
  en: ['You were added to {event}', 'You have a place at {event}', 'The organisers of {event} added you as a participant. Choose a password to sign in and open your dashboard.', 'Set my password', 'The link works for 7 days. If you did not expect this, you can ignore this e-mail.'],
  az: ['{event} tədbirinə əlavə olundunuz', '{event} tədbirində yeriniz var', '{event} təşkilatçıları sizi iştirakçı kimi əlavə etdi. Daxil olub panelinizi açmaq üçün şifrə seçin.', 'Şifrəmi təyin et', 'Link 7 gün işləyir. Bunu gözləmirdinizsə, məktuba məhəl qoymayın.'],
  ru: ['Вас добавили на {event}', 'У вас есть место на {event}', 'Организаторы {event} добавили вас как участника. Задайте пароль, чтобы войти и открыть кабинет.', 'Задать пароль', 'Ссылка действует 7 дней. Если вы этого не ждали, просто проигнорируйте письмо.'],
};

/** An organiser imported this person: choose a password (link lives 7 days). */
function sendWelcomeImportedEmail({ to, fullName, eventName, setUrl, lang, sender }) {
  const L = WELCOME_WORDS[lang] ? lang : 'en';
  const [subject, heading, body, cta, note] = WELCOME_WORDS[L];
  const event = String(eventName || 'HackOS');
  const f = (x) => x.split('{event}').join(event);
  const hi = STATUS_WORDS[L].hi.split('{name}').join(String(fullName || '').trim());
  return deliver(to, {
    subject: f(subject),
    preheader: f(body).slice(0, 140),
    eyebrow: event,
    heading: f(heading),
    paragraphs: [...(String(fullName || '').trim() ? [[hi]] : []), [f(body)]],
    cta: { label: cta, url: setUrl },
    note,
    lang: L,
    linkLang: eventLang(lang),
  }, sender);
}

/* ── Accounts ───────────────────────────────────────────────────────────── */

/** Password reset link (POST /api/auth/forgot-password). */
function sendPasswordResetEmail({ to, fullName, resetUrl }) {
  const name = String(fullName || '').trim() || 'there';
  return deliver(to, {
    subject: 'Reset your HackOS password',
    preheader: 'Use this link within 1 hour to choose a new password.',
    heading: 'Reset your password',
    paragraphs: [
      [`Hi ${name},`],
      ['We received a request to reset the password for this account. The link below works once and expires in ', { b: '1 hour' }, '.'],
    ],
    cta: { label: 'Set a new password', url: resetUrl },
    note: 'If you did not ask for this, ignore this e-mail — your password stays the same.',
  });
}

const VERIFY_WORDS = {
  en: {
    subject: 'Confirm your e-mail for HackOS',
    pre: 'One click to confirm {email}.',
    heading: 'Confirm your e-mail address',
    hi: 'Hi {name},',
    body: 'Confirm that {email} is yours: it keeps your account safe and lets the organisers reach you.',
    invite: 'Your invitation to {event} as a {role} is waiting: it opens as soon as you confirm.',
    cta: 'Confirm my e-mail',
    note: 'The link works for 3 days. If you did not create a HackOS account, you can ignore this e-mail.',
    roles: { judge: 'judge', mentor: 'mentor', volunteer: 'volunteer', hacker: 'participant' },
  },
  az: {
    subject: 'HackOS üçün e-poçtunuzu təsdiqləyin',
    pre: '{email} ünvanını bir kliklə təsdiqləyin.',
    heading: 'E-poçt ünvanınızı təsdiqləyin',
    hi: 'Salam, {name}!',
    body: '{email} ünvanının sizə məxsus olduğunu təsdiqləyin: bu, hesabınızı qoruyur və təşkilatçıların sizinlə əlaqə saxlamasına imkan verir.',
    invite: '{event} tədbirinə {role} dəvətiniz gözləyir: təsdiqlədiyiniz kimi açılacaq.',
    cta: 'E-poçtumu təsdiqlə',
    note: 'Link 3 gün işləyir. HackOS hesabı yaratmamısınızsa, bu məktuba məhəl qoymayın.',
    roles: { judge: 'münsif', mentor: 'mentor', volunteer: 'könüllü', hacker: 'iştirakçı' },
  },
  ru: {
    subject: 'Подтвердите e-mail для HackOS',
    pre: 'Подтвердите {email} одним нажатием.',
    heading: 'Подтвердите адрес e-mail',
    hi: 'Здравствуйте, {name}!',
    body: 'Подтвердите, что {email} принадлежит вам: так аккаунт защищён, а организаторы смогут с вами связаться.',
    invite: 'Вас ждёт приглашение на {event} в роли «{role}»: оно откроется сразу после подтверждения.',
    cta: 'Подтвердить e-mail',
    note: 'Ссылка действует 3 дня. Если вы не создавали аккаунт HackOS, просто проигнорируйте письмо.',
    roles: { judge: 'судья', mentor: 'ментор', volunteer: 'волонтёр', hacker: 'участник' },
  },
};

/**
 * The link that confirms a new account's address. Names the invitation that
 * waits for it, when there is one.
 */
function sendVerifyEmail({ to, fullName, verifyUrl, lang, invite }) {
  const L = VERIFY_WORDS[lang] ? lang : 'en';
  const w = VERIFY_WORDS[L];
  const name = String(fullName || '').trim();
  const fill = (x) => String(x)
    .split('{email}').join(String(to))
    .split('{name}').join(name)
    .split('{event}').join(String(invite?.eventName || 'HackOS'))
    .split('{role}').join(w.roles[invite?.role] || w.roles.hacker);
  return deliver(to, {
    subject: w.subject,
    preheader: fill(w.pre),
    heading: w.heading,
    paragraphs: [
      ...(name ? [[fill(w.hi)]] : []),
      [fill(w.body)],
      ...(invite ? [[fill(w.invite)]] : []),
    ],
    cta: { label: w.cta, url: verifyUrl },
    note: w.note,
    lang: L,
    linkLang: eventLang(lang),
  });
}

/**
 * A colleague is invited onto a customer's account (organisation team), as
 * opposed to an event roster.
 */
async function sendCustomerInviteEmail(body) {
  const to = String(body?.to || '').trim();
  const inviteUrl = String(body?.inviteUrl || '').trim();
  if (!to || !inviteUrl) return { ok: false, success: false, status: 400, message: 'Missing fields: to, inviteUrl' };
  const org = String(body?.customerName || '').trim() || 'your organisation';
  const inviter = String(body?.inviterName || '').trim();
  const days = Number(body?.expiresInDays) || 7;
  return deliver(to, {
    subject: `Join ${org} on HackOS`,
    preheader: `${inviter || 'A colleague'} invited you to help run hackathons for ${org}.`,
    eyebrow: 'Team invitation',
    heading: `Join ${org}`,
    paragraphs: [
      [inviter ? { b: inviter } : 'A colleague', ' invited you to help run hackathons for ', { b: org }, ' on HackOS.'],
      ['Accept with the account for ', { b: to }, ' — the invitation only works for that address.'],
    ],
    cta: { label: 'Accept invitation', url: inviteUrl },
    note: `This link expires in ${days} days and can be used once. If you were not expecting it, you can ignore this e-mail.`,
  });
}

/* ── Sales ────────────────────────────────────────────────────────────── */

const money = (minor, currency) =>
  `${(Number(minor || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || 'AZN'}`;

/*
 * The order e-mails, in the language the buyer ordered in (orders.locale).
 *
 * One vocabulary everywhere the buyer reads about an order — checkout,
 * e-mail, account, console: received → under review → approved · active →
 * paid, or refused / cancelled. And one payment rule: the invoice is issued
 * when the order is approved and is due 14 days later, paid by bank transfer
 * with the order code as the reference.
 *
 * `**text**` in these strings is bold; `{key}` is filled in.
 */
const ORDER_WORDS = {
  en: {
    hi: 'Hi {name},', hiNoName: 'Hello,',
    period: { annual: 'annual', per_event: 'per event' },
    vatNone: 'VAT not charged (the seller is not VAT-registered)',
    vatAdded: 'plus VAT {rate}%: {tax}, total {gross}',
    placed: {
      subject: 'Order {code} received — HackOS {plan}',
      pre: 'We have your order for {org}. It is under review.',
      heading: 'Order received',
      body: 'Your order for **HackOS {plan}** ({period}) for **{org}** is in. Status: **under review**.',
      amount: 'Amount: **{amount}**, {vat}.',
      pay: 'Payment: bank transfer against an invoice. We send the invoice when we approve the order; pay it within 14 days of the invoice, quoting **{code}** as the reference.',
      card: 'Payment: the card ending **{last4}**.',
      review: 'We review every order by hand, usually within one working day. When it is approved, the organisation becomes active and the invoice is in your account.',
      cta: 'Follow my order',
      note: 'Questions about the order? Reply to this e-mail.',
    },
    approved: {
      subject: 'Order {code} approved — {org}',
      pre: '{org} is active. Invoice {invoice} is due {due}.',
      preNoInvoice: '{org} is active.',
      heading: 'Approved — your organisation is active',
      body: 'We have approved your order for **HackOS {plan}**. **{org}** is active. Status: **approved · active**.',
      invoice: 'Invoice **{invoice}**: **{total}**, due **{due}** (14 days). Pay by bank transfer, quoting **{code}** as the reference.',
      paid: 'Invoice **{invoice}**: **{total}**, already paid. Thank you.',
      holder: 'Beneficiary: **{holder}**{taxId}',
      bank: 'Bank: **{bank}**{swift}',
      iban: 'IBAN: **{iban}**',
      noBank: 'The bank details follow in a separate e-mail.',
      card: 'The card you entered was not charged. Please pay this invoice by bank transfer.',
      setup: 'Use the button to finish setting up the organisation: name, logo, colour, time zone, and the colleagues who will run events with you.',
      ctaSetup: 'Set up my organisation',
      ctaAccount: 'Open my account',
      noteSetup: 'The setup link works once and expires in {hours} hours. If it runs out, ask for a new one on the page the link opens or in your account.',
      noteAccount: 'The invoice is in your account.',
    },
    rejected: {
      subject: 'About your HackOS order {code}',
      pre: 'We could not approve this order.',
      heading: 'Order refused',
      body: 'We have reviewed order **{code}** and could not approve it. Status: **refused**.',
      reason: 'Reason: {reason}',
      after: 'No invoice was issued and nothing is owed; anything already paid is returned. Reply to this e-mail if you would like to talk it through.',
      cta: 'Open my account',
    },
    payment: {
      subject: 'Payment received — order {code}',
      pre: 'Thank you. {amount} received for order {code}.',
      heading: 'Payment received',
      body: 'We have received **{amount}** for order **{code}**. Thank you. Status: **paid**.',
      next: 'The invoice in your account now shows it as paid.',
      cta: 'View the invoice',
    },
    setupLink: {
      subject: 'Your new setup link — {org}',
      pre: 'A new link to finish setting up {org}.',
      heading: 'A new setup link',
      body: 'Here is a new link to finish setting up **{org}** on HackOS. Earlier links no longer work.',
      cta: 'Set up my organisation',
      note: 'The link works once and expires in {hours} hours.',
    },
  },
  az: {
    hi: 'Salam, {name}!', hiNoName: 'Salam!',
    period: { annual: 'illik', per_event: 'bir tədbir' },
    vatNone: 'ƏDV tutulmur (satıcı ƏDV ödəyicisi deyil)',
    vatAdded: 'üstəgəl ƏDV {rate}%: {tax}, cəmi {gross}',
    placed: {
      subject: '{code} sifarişi qəbul edildi — HackOS {plan}',
      pre: '{org} üçün sifarişinizi aldıq. Sifariş yoxlanılır.',
      heading: 'Sifariş qəbul edildi',
      body: '**{org}** üçün **HackOS {plan}** ({period}) sifarişiniz qəbul edildi. Status: **yoxlanılır**.',
      amount: 'Məbləğ: **{amount}**, {vat}.',
      pay: 'Ödəniş: hesab-faktura əsasında bank köçürməsi. Hesab-fakturanı sifarişi təsdiqləyəndə göndəririk; onu təyinatda **{code}** yazaraq hesab-fakturadan sonra 14 gün ərzində ödəyin.',
      card: 'Ödəniş: son rəqəmləri **{last4}** olan kart.',
      review: 'Hər sifarişi əl ilə yoxlayırıq, adətən bir iş günü ərzində. Təsdiqlənəndə təşkilat aktiv olur və hesab-faktura kabinetinizdə görünür.',
      cta: 'Sifarişimi izlə',
      note: 'Sifarişlə bağlı sualınız var? Bu məktuba cavab yazın.',
    },
    approved: {
      subject: '{code} sifarişi təsdiqləndi — {org}',
      pre: '{org} aktivdir. {invoice} hesab-fakturasının son ödəniş tarixi: {due}.',
      preNoInvoice: '{org} aktivdir.',
      heading: 'Təsdiqləndi — təşkilatınız aktivdir',
      body: '**HackOS {plan}** sifarişinizi təsdiqlədik. **{org}** aktivdir. Status: **təsdiqləndi · aktiv**.',
      invoice: 'Hesab-faktura **{invoice}**: **{total}**, son ödəniş tarixi **{due}** (14 gün). Təyinatda **{code}** yazaraq bank köçürməsi ilə ödəyin.',
      paid: 'Hesab-faktura **{invoice}**: **{total}**, artıq ödənilib. Təşəkkür edirik.',
      holder: 'Alan: **{holder}**{taxId}',
      bank: 'Bank: **{bank}**{swift}',
      iban: 'IBAN: **{iban}**',
      noBank: 'Bank rekvizitləri ayrıca məktubla göndəriləcək.',
      card: 'Daxil etdiyiniz kartdan pul tutulmayıb. Bu hesab-fakturanı bank köçürməsi ilə ödəyin.',
      setup: 'Təşkilatın qurulmasını düymə ilə tamamlayın: ad, loqo, rəng, saat qurşağı və sizinlə tədbir keçirəcək həmkarlar.',
      ctaSetup: 'Təşkilatımı qur',
      ctaAccount: 'Kabinetimi aç',
      noteSetup: 'Qurulma linki bir dəfə işləyir və {hours} saata bitir. Vaxtı keçsə, linkin açdığı səhifədən və ya kabinetinizdən yenisini istəyin.',
      noteAccount: 'Hesab-faktura kabinetinizdədir.',
    },
    rejected: {
      subject: 'HackOS sifarişiniz {code} haqqında',
      pre: 'Bu sifarişi təsdiqləyə bilmədik.',
      heading: 'Sifariş rədd edildi',
      body: '**{code}** sifarişini yoxladıq və təsdiqləyə bilmədik. Status: **rədd edildi**.',
      reason: 'Səbəb: {reason}',
      after: 'Hesab-faktura yaradılmayıb və heç bir borcunuz yoxdur; artıq ödənilibsə, geri qaytarılır. Danışmaq istəsəniz, bu məktuba cavab yazın.',
      cta: 'Kabinetimi aç',
    },
    payment: {
      subject: 'Ödəniş alındı — {code} sifarişi',
      pre: 'Təşəkkür edirik. {code} sifarişi üçün {amount} alındı.',
      heading: 'Ödəniş alındı',
      body: '**{code}** sifarişi üçün **{amount}** aldıq. Təşəkkür edirik. Status: **ödənilib**.',
      next: 'Kabinetinizdəki hesab-faktura artıq ödənilmiş kimi görünür.',
      cta: 'Hesab-fakturaya bax',
    },
    setupLink: {
      subject: 'Yeni qurulma linkiniz — {org}',
      pre: '{org} qurulmasını tamamlamaq üçün yeni link.',
      heading: 'Yeni qurulma linki',
      body: '**{org}** təşkilatının HackOS-da qurulmasını tamamlamaq üçün yeni link. Əvvəlki linklər artıq işləmir.',
      cta: 'Təşkilatımı qur',
      note: 'Link bir dəfə işləyir və {hours} saata bitir.',
    },
  },
  ru: {
    hi: 'Здравствуйте, {name}!', hiNoName: 'Здравствуйте!',
    period: { annual: 'годовой', per_event: 'за мероприятие' },
    vatNone: 'НДС не взимается (продавец не плательщик НДС)',
    vatAdded: 'плюс НДС {rate}%: {tax}, итого {gross}',
    placed: {
      subject: 'Заказ {code} получен — HackOS {plan}',
      pre: 'Мы получили ваш заказ для {org}. Он на проверке.',
      heading: 'Заказ получен',
      body: 'Ваш заказ **HackOS {plan}** ({period}) для **{org}** получен. Статус: **на проверке**.',
      amount: 'Сумма: **{amount}**, {vat}.',
      pay: 'Оплата: банковский перевод по счёту. Счёт мы выставляем при одобрении заказа; оплатите его в течение 14 дней с даты счёта, указав **{code}** в назначении платежа.',
      card: 'Оплата: карта с последними цифрами **{last4}**.',
      review: 'Мы проверяем каждый заказ вручную, обычно в течение одного рабочего дня. После одобрения организация становится активной, а счёт появляется в вашем кабинете.',
      cta: 'Следить за заказом',
      note: 'Вопросы по заказу? Ответьте на это письмо.',
    },
    approved: {
      subject: 'Заказ {code} одобрен — {org}',
      pre: '{org} активна. Счёт {invoice} нужно оплатить до {due}.',
      preNoInvoice: '{org} активна.',
      heading: 'Одобрено — ваша организация активна',
      body: 'Мы одобрили ваш заказ **HackOS {plan}**. **{org}** активна. Статус: **одобрен · активен**.',
      invoice: 'Счёт **{invoice}**: **{total}**, оплатить до **{due}** (14 дней). Оплата банковским переводом, в назначении платежа укажите **{code}**.',
      paid: 'Счёт **{invoice}**: **{total}**, уже оплачен. Спасибо.',
      holder: 'Получатель: **{holder}**{taxId}',
      bank: 'Банк: **{bank}**{swift}',
      iban: 'IBAN: **{iban}**',
      noBank: 'Банковские реквизиты придут отдельным письмом.',
      card: 'С указанной карты деньги не списывались. Оплатите, пожалуйста, этот счёт банковским переводом.',
      setup: 'Завершите настройку организации по кнопке: название, логотип, цвет, часовой пояс и коллеги, которые будут проводить мероприятия вместе с вами.',
      ctaSetup: 'Настроить организацию',
      ctaAccount: 'Открыть кабинет',
      noteSetup: 'Ссылка для настройки работает один раз и действует {hours} часа. Если срок истечёт, запросите новую на странице, которую открывает ссылка, или в кабинете.',
      noteAccount: 'Счёт находится в вашем кабинете.',
    },
    rejected: {
      subject: 'О вашем заказе HackOS {code}',
      pre: 'Мы не смогли одобрить этот заказ.',
      heading: 'Заказ отклонён',
      body: 'Мы рассмотрели заказ **{code}** и не смогли его одобрить. Статус: **отклонён**.',
      reason: 'Причина: {reason}',
      after: 'Счёт не выставлялся, вы ничего не должны; если оплата уже поступила, мы её вернём. Ответьте на это письмо, если хотите обсудить.',
      cta: 'Открыть кабинет',
    },
    payment: {
      subject: 'Оплата получена — заказ {code}',
      pre: 'Спасибо. По заказу {code} получено {amount}.',
      heading: 'Оплата получена',
      body: 'Мы получили **{amount}** по заказу **{code}**. Спасибо. Статус: **оплачен**.',
      next: 'Счёт в вашем кабинете теперь отмечен как оплаченный.',
      cta: 'Посмотреть счёт',
    },
    setupLink: {
      subject: 'Новая ссылка для настройки — {org}',
      pre: 'Новая ссылка, чтобы завершить настройку {org}.',
      heading: 'Новая ссылка для настройки',
      body: 'Вот новая ссылка, чтобы завершить настройку **{org}** в HackOS. Прежние ссылки больше не работают.',
      cta: 'Настроить организацию',
      note: 'Ссылка работает один раз и действует {hours} часа.',
    },
  },
};

const orderLang = (lang) => (ORDER_WORDS[lang] ? lang : 'en');
const DATE_LOCALE = { en: 'en-GB', az: 'az-AZ', ru: 'ru-RU' };
const longDate = (d, lang) => (d ? new Date(d).toLocaleDateString(DATE_LOCALE[lang] || 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Baku' }) : '');

/** "{a} and **{b}**" with values → the template's parts (strings and { b }). */
function para(template, values = {}) {
  const filled = String(template).replace(/\{(\w+)\}/g, (_, k) => (values[k] == null ? '' : String(values[k])));
  return filled.split(/\*\*(.+?)\*\*/).map((part, i) => (i % 2 ? { b: part } : part)).filter((p) => p !== '');
}
const plain = (template, values) => para(template, values).map((p) => (typeof p === 'string' ? p : p.b)).join('');
const greeting = (w, fullName) => {
  const name = String(fullName || '').trim();
  return name ? plain(w.hi, { name }) : w.hiNoName;
};

/** The VAT clause of an amount: the rate and the total when VAT was charged. */
function vatClause(w, amountMinor, taxMinor, currency) {
  const tax = Number(taxMinor || 0);
  if (!tax) return w.vatNone;
  const rate = Math.round((tax / Number(amountMinor || 1)) * 1000) / 10;
  return plain(w.vatAdded, { rate, tax: money(tax, currency), gross: money(Number(amountMinor || 0) + tax, currency) });
}

/** The buyer's receipt for an order placed at checkout. No payment is taken there. */
function sendOrderPlacedEmail({
  to, fullName, orderCode, planName, billingPeriod, amountMinor, taxMinor, currency, organisation, frontendUrl,
  paymentMethod, cardLast4, lang,
}) {
  const L = orderLang(lang);
  const w = ORDER_WORDS[L];
  const v = {
    code: orderCode, plan: planName, org: String(organisation || 'your organisation'),
    period: w.period[billingPeriod === 'annual' ? 'annual' : 'per_event'],
    amount: money(amountMinor, currency), vat: vatClause(w, amountMinor, taxMinor, currency), last4: cardLast4 || '••••',
  };
  return deliver(to, {
    subject: plain(w.placed.subject, v),
    preheader: plain(w.placed.pre, v),
    eyebrow: orderCode,
    heading: w.placed.heading,
    paragraphs: [
      [greeting(w, fullName)],
      para(w.placed.body, v),
      para(w.placed.amount, v),
      para(paymentMethod === 'card' ? w.placed.card : w.placed.pay, v),
      [w.placed.review],
    ],
    cta: { label: w.placed.cta, url: `${appBase(frontendUrl)}/account` },
    note: w.placed.note,
    lang: L,
  });
}

/**
 * The order is approved: the organisation is live, here is the invoice and
 * where to pay it, and — for an organisation not set up yet — the setup link.
 * `seller` is billing.service's payTo(); `setupUrl` null skips the setup part.
 */
function sendOrderApprovedEmail({
  to, fullName, orderCode, planName, organisation, setupUrl, expiresHours, lang, frontendUrl,
  invoiceNumber, invoiceDueAt, amountMinor, taxMinor, currency, paid, paymentMethod, seller,
}) {
  const L = orderLang(lang);
  const w = ORDER_WORDS[L];
  const a = w.approved;
  const v = {
    code: orderCode, plan: planName, org: String(organisation || ''), invoice: invoiceNumber || '',
    due: longDate(invoiceDueAt, L), total: money(Number(amountMinor || 0) + Number(taxMinor || 0), currency), hours: expiresHours,
  };
  const paragraphs = [[greeting(w, fullName)], para(a.body, v)];
  if (invoiceNumber) {
    paragraphs.push(para(paid ? a.paid : a.invoice, v));
    if (!paid) {
      if (seller && seller.iban && seller.bankName) {
        paragraphs.push(para(a.holder, { holder: seller.accountHolder || seller.legalName || 'HackOS', taxId: seller.taxId ? ` · VÖEN ${seller.taxId}` : '' }));
        paragraphs.push(para(a.bank, { bank: seller.bankName, swift: seller.swift ? ` · SWIFT ${seller.swift}` : '' }));
        paragraphs.push(para(a.iban, { iban: seller.ibanGrouped || seller.iban }));
      } else {
        paragraphs.push([a.noBank]);
      }
      if (paymentMethod === 'card') paragraphs.push([a.card]);
    }
  }
  if (setupUrl) paragraphs.push([a.setup]);
  return deliver(to, {
    subject: plain(a.subject, v),
    preheader: plain(invoiceNumber ? a.pre : a.preNoInvoice, v),
    eyebrow: orderCode,
    heading: a.heading,
    paragraphs,
    cta: setupUrl ? { label: a.ctaSetup, url: setupUrl } : { label: a.ctaAccount, url: `${appBase(frontendUrl)}/account` },
    note: setupUrl ? plain(a.noteSetup, v) : a.noteAccount,
    lang: L,
  });
}

/** A new setup link, asked for by the buyer or sent again by the owner. */
function sendSetupLinkEmail({ to, organisation, setupUrl, expiresHours, lang }) {
  const L = orderLang(lang);
  const w = ORDER_WORDS[L].setupLink;
  const v = { org: String(organisation || 'HackOS'), hours: expiresHours };
  return deliver(to, {
    subject: plain(w.subject, v),
    preheader: plain(w.pre, v),
    heading: w.heading,
    paragraphs: [para(w.body, v)],
    cta: { label: w.cta, url: setupUrl },
    note: plain(w.note, v),
    lang: L,
  });
}

/** The order is refused; the reason is the owner's own words. */
function sendOrderRejectedEmail({ to, fullName, orderCode, reason, frontendUrl, lang }) {
  const L = orderLang(lang);
  const w = ORDER_WORDS[L];
  const r = w.rejected;
  const v = { code: orderCode };
  return deliver(to, {
    subject: plain(r.subject, v),
    preheader: r.pre,
    eyebrow: orderCode,
    heading: r.heading,
    paragraphs: [
      [greeting(w, fullName)],
      para(r.body, v),
      [plain(r.reason, { reason: String(reason || '') })],
      [r.after],
    ],
    cta: { label: r.cta, url: `${appBase(frontendUrl)}/account` },
    lang: L,
  });
}

/** Money arrived for an order. */
function sendPaymentReceivedEmail({ to, fullName, orderCode, amountMinor, currency, frontendUrl, lang }) {
  const L = orderLang(lang);
  const w = ORDER_WORDS[L];
  const p = w.payment;
  const v = { code: orderCode, amount: money(amountMinor, currency) };
  return deliver(to, {
    subject: plain(p.subject, v),
    preheader: plain(p.pre, v),
    eyebrow: orderCode,
    heading: p.heading,
    paragraphs: [[greeting(w, fullName)], para(p.body, v), [p.next]],
    cta: { label: p.cta, url: `${appBase(frontendUrl)}/account` },
    lang: L,
  });
}

/** Where internal alerts (new orders, contact form) go. Null when nobody is set. */
function salesInbox() {
  const v = ['SALES_NOTIFY_EMAIL', 'MAIL_REPLY_TO', 'BOOTSTRAP_SUPERADMIN_EMAIL']
    .map((k) => String(process.env[k] || '').trim())
    .find(Boolean);
  return v || null;
}

/**
 * An internal alert to the sales inbox. `fields` is [label, value] pairs,
 * all treated as text; `replyTo` lets the inbox answer the person directly.
 */
function sendSalesAlert({ subject, heading, fields, replyTo, link }) {
  const to = salesInbox();
  if (!to && process.env.NODE_ENV !== 'production') {
    console.log(`[mail] (no SALES_NOTIFY_EMAIL, development) ${subject}`);
    return Promise.resolve({ ok: true, success: true, provider: 'log', logged: true });
  }
  if (!to) {
    console.warn('[mail] sales alert skipped: set SALES_NOTIFY_EMAIL');
    return Promise.resolve({ ok: false, success: false, status: 503, message: 'No SALES_NOTIFY_EMAIL' });
  }
  return deliver(
    to,
    {
      subject,
      preheader: heading,
      eyebrow: 'Internal',
      heading,
      paragraphs: fields.filter(([, v]) => v != null && String(v).trim() !== '').map(([k, v]) => [{ b: `${k}: ` }, String(v)]),
      ...(link ? { cta: { label: 'Open', url: link } } : {}),
    },
    { replyTo },
  );
}

/** POST /api/mail/test — proves the provider, sender and DNS work end to end. */
function sendTestEmail({ to, frontendUrl }) {
  const r = mailer.getReadiness();
  return deliver(to, {
    subject: 'HackOS test e-mail',
    preheader: 'If you can read this, e-mail delivery works.',
    heading: 'E-mail delivery works',
    paragraphs: [
      ['This message was sent from the HackOS API via ', { b: String(r.provider || 'none') }, ' as ', { b: String(r.fromEmail || '-') }, '.'],
      ['Check that it arrived in the inbox rather than spam. If it went to spam, the sender domain still needs its SPF, DKIM and DMARC records.'],
    ],
    cta: { label: 'Open HackOS', url: appBase(frontendUrl) },
  });
}

/* ── Certificates ───────────────────────────────────────────────────────── */

const CERT_WORDS = {
  en: {
    subject: 'Your certificate — {event}', pre: 'Your certificate from {event} is ready.', heading: 'Your certificate is ready',
    body: 'Thank you for being part of {event}. Your certificate is ready: open it, download the PDF and share it.',
    code: 'Its code is {code}; anyone can check it on the page the link opens.', cta: 'Open my certificate', hi: 'Hi {name},',
    note: 'You receive this because you took part in {event}.',
  },
  az: {
    subject: 'Sertifikatınız — {event}', pre: '{event} sertifikatınız hazırdır.', heading: 'Sertifikatınız hazırdır',
    body: '{event} tədbirinin bir parçası olduğunuz üçün təşəkkür edirik. Sertifikatınız hazırdır: açın, PDF-i yükləyin və paylaşın.',
    code: 'Sertifikatın kodu {code}-dir; linkin açdığı səhifədə hər kəs onu yoxlaya bilər.', cta: 'Sertifikatımı aç', hi: 'Salam, {name}!',
    note: 'Bu məktubu {event} tədbirində iştirak etdiyiniz üçün alırsınız.',
  },
  ru: {
    subject: 'Ваш сертификат — {event}', pre: 'Ваш сертификат {event} готов.', heading: 'Ваш сертификат готов',
    body: 'Спасибо, что были частью {event}. Ваш сертификат готов: откройте его, скачайте PDF и поделитесь.',
    code: 'Код сертификата — {code}; любой может проверить его на странице по ссылке.', cta: 'Открыть сертификат', hi: 'Здравствуйте, {name}!',
    note: 'Вы получили это письмо, потому что участвовали в {event}.',
  },
};

/** A certificate was issued: the link to its page (view, download, verify). */
function sendCertificateEmail({ to, fullName, eventName, code, url, lang, sender }) {
  const L = CERT_WORDS[lang] ? lang : 'en';
  const w = CERT_WORDS[L];
  const fillIn = (x) => String(x).split('{event}').join(String(eventName || 'HackOS')).split('{code}').join(code).split('{name}').join(String(fullName || '').trim());
  return deliver(to, {
    subject: fillIn(w.subject),
    preheader: fillIn(w.pre),
    eyebrow: String(eventName || 'HackOS'),
    heading: w.heading,
    paragraphs: [[fillIn(w.hi)], [fillIn(w.body)], [fillIn(w.code)]],
    cta: { label: w.cta, url },
    note: fillIn(w.note),
    lang: L,
    linkLang: eventLang(lang),
  }, sender);
}

/* ── Judging: look again ────────────────────────────────────────────────── */

const RECHECK_WORDS = {
  en: {
    subject: 'Please look at your reviews again — {event}',
    pre: '{n} projects changed after you reviewed them.',
    heading: 'Projects changed after your review',
    hi: 'Hi {name},',
    body: 'The organisers of {event} are about to publish the results. Some teams changed their project after you reviewed it, so your review may not match what they handed in:',
    ask: 'Please open each one, look at what changed and save your review again (the same scores are fine). It counts as checked once you save.',
    closed: 'Judging has closed, so the organisers will reopen it for you to save again.',
    cta: 'Open my judging',
    note: 'You receive this because you judge {event}.',
  },
  az: {
    subject: 'Rəylərinizə yenidən baxın — {event}',
    pre: '{n} layihə siz baxdıqdan sonra dəyişib.',
    heading: 'Rəyinizdən sonra layihələr dəyişib',
    hi: 'Salam, {name}!',
    body: '{event} təşkilatçıları nəticələri dərc etmək üzrədir. Bəzi komandalar siz baxdıqdan sonra layihələrini dəyişib, ona görə rəyiniz onların təqdim etdiyinə uyğun olmaya bilər:',
    ask: 'Hər birini açın, nəyin dəyişdiyinə baxın və rəyinizi yenidən yadda saxlayın (eyni ballar da olar). Yadda saxlayan kimi yoxlanmış sayılır.',
    closed: 'Qiymətləndirmə bağlanıb, ona görə təşkilatçılar yenidən yadda saxlamağınız üçün onu açacaq.',
    cta: 'Qiymətləndirməmi aç',
    note: 'Bu məktubu {event} tədbirində münsif olduğunuz üçün alırsınız.',
  },
  ru: {
    subject: 'Посмотрите свои оценки ещё раз — {event}',
    pre: 'Проектов, изменённых после вашей оценки: {n}.',
    heading: 'Проекты изменились после вашей оценки',
    hi: 'Здравствуйте, {name}!',
    body: 'Организаторы {event} собираются опубликовать результаты. Некоторые команды изменили проект после того, как вы его оценили, поэтому оценка может не соответствовать тому, что они сдали:',
    ask: 'Откройте каждый, посмотрите, что изменилось, и сохраните оценку ещё раз (те же баллы подойдут). После сохранения она считается проверенной.',
    closed: 'Оценивание закрыто, поэтому организаторы откроют его снова, чтобы вы могли сохранить оценку.',
    cta: 'Открыть оценивание',
    note: 'Вы получили это письмо, потому что вы судья {event}.',
  },
};

/**
 * The organiser asks a judge to look again at the projects that changed
 * after their review (Results → outdated reviews). In the event's language,
 * signed by the event; the projects are named, never the teams (a blind
 * judge sees project names only).
 */
function sendRecheckRequestEmail({ to, fullName, eventName, projects, frontendUrl, lang, sender, judgingClosed = false }) {
  const L = RECHECK_WORDS[lang] ? lang : 'en';
  const w = RECHECK_WORDS[L];
  const event = String(eventName || 'HackOS');
  const list = (Array.isArray(projects) ? projects : []).map((x) => String(x || '').trim()).filter(Boolean);
  const name = String(fullName || '').trim();
  const fillIn = (x) => String(x).split('{event}').join(event).split('{n}').join(String(list.length || 1)).split('{name}').join(name);
  return deliver(to, {
    subject: fillIn(w.subject),
    preheader: fillIn(w.pre),
    eyebrow: event,
    heading: w.heading,
    paragraphs: [
      ...(name ? [[fillIn(w.hi)]] : []),
      [fillIn(w.body)],
      ...list.slice(0, 20).map((x) => [{ b: `• ${x}` }]),
      [w.ask],
      ...(judgingClosed ? [[w.closed]] : []),
    ],
    cta: { label: w.cta, url: `${appBase(frontendUrl)}/judge` },
    note: fillIn(w.note),
    lang: L,
    linkLang: eventLang(lang),
  }, sender);
}

/* ── Personal invitations to register ───────────────────────────────────── */

const INVITATION_WORDS = {
  en: {
    subject: 'You are invited to {event}',
    pre: 'Your personal link to register for {event}.',
    heading: 'You are invited to {event}',
    hi: 'Hi {name},',
    body: '{inviter} invited you to take part in {event}.',
    when: 'It runs {dates}.',
    team: 'The organisers put you in the team {team}.',
    how: 'The button opens the registration with your e-mail address already filled in. The link is personal: it works only for {email}.',
    expires: 'The link works until {date}.',
    cta: 'Register now',
    organisers: 'The organisers',
    note: 'If you were not expecting this invitation, you can ignore this e-mail.',
  },
  az: {
    subject: '{event} tədbirinə dəvət olunursunuz',
    pre: '{event} üçün qeydiyyat linkiniz.',
    heading: '{event} tədbirinə dəvət olunursunuz',
    hi: 'Salam, {name}!',
    body: '{inviter} sizi {event} tədbirində iştirak etməyə dəvət etdi.',
    when: 'Tədbir {dates} keçirilir.',
    team: 'Təşkilatçılar sizi {team} komandasına əlavə edib.',
    how: 'Düymə e-poçt ünvanınız artıq yazılmış qeydiyyat formasını açır. Link şəxsidir: yalnız {email} üçün işləyir.',
    expires: 'Link {date} tarixinədək işləyir.',
    cta: 'Qeydiyyatdan keç',
    organisers: 'Təşkilatçılar',
    note: 'Bu dəvəti gözləmirdinizsə, məktuba məhəl qoymayın.',
  },
  ru: {
    subject: 'Приглашение на {event}',
    pre: 'Ваша личная ссылка для регистрации на {event}.',
    heading: 'Вы приглашены на {event}',
    hi: 'Здравствуйте, {name}!',
    body: '{inviter} приглашает вас принять участие в {event}.',
    when: 'Даты: {dates}.',
    team: 'Организаторы включили вас в команду {team}.',
    how: 'Кнопка откроет регистрацию с уже заполненным адресом. Ссылка личная: она работает только для {email}.',
    expires: 'Ссылка действует до {date}.',
    cta: 'Зарегистрироваться',
    organisers: 'Организаторы',
    note: 'Если вы не ждали этого приглашения, просто проигнорируйте письмо.',
  },
};

/**
 * A personal invitation to register for an event (the organiser's
 * Invitations screen): the registration link carries the invitation's own
 * token (inviteToken.js), so the form knows the address and lets the person
 * in even when the event takes invited people only. In the event's
 * language, signed by the event.
 */
function sendParticipantInvitationEmail({ to, fullName, eventName, url, startDate, endDate, expiresAt, teamName, inviterName, lang, sender }) {
  const L = INVITATION_WORDS[lang] ? lang : 'en';
  const w = INVITATION_WORDS[L];
  const event = String(eventName || 'HackOS');
  const name = String(fullName || '').trim();
  const dates = startDate
    ? [longDate(startDate, L), endDate && longDate(endDate, L) !== longDate(startDate, L) ? longDate(endDate, L) : null].filter(Boolean).join(' – ')
    : '';
  const fillIn = (x) => String(x)
    .split('{event}').join(event)
    .split('{name}').join(name)
    .split('{inviter}').join(String(inviterName || '').trim() || w.organisers)
    .split('{dates}').join(dates)
    .split('{team}').join(String(teamName || '').trim())
    .split('{email}').join(String(to))
    .split('{date}').join(expiresAt ? longDate(expiresAt, L) : '');
  return deliver(to, {
    subject: fillIn(w.subject),
    preheader: fillIn(w.pre),
    eyebrow: event,
    heading: fillIn(w.heading),
    paragraphs: [
      ...(name ? [[fillIn(w.hi)]] : []),
      [fillIn(w.body)],
      ...(dates ? [[fillIn(w.when)]] : []),
      ...(String(teamName || '').trim() ? [[fillIn(w.team)]] : []),
      [fillIn(w.how)],
      ...(expiresAt ? [[fillIn(w.expires)]] : []),
    ],
    cta: { label: w.cta, url },
    note: w.note,
    lang: L,
    linkLang: eventLang(lang),
  }, sender);
}

module.exports = {
  sendCertificateEmail,
  sendRecheckRequestEmail,
  sendParticipantInvitationEmail,
  buildInviteRegisterUrl,
  sendEventInviteEmail,
  sendInviteEmail,
  sendAddedToEventEmail,
  sendRegistrationReceivedEmail,
  sendParticipantApprovedEmail,
  sendSubmissionReceivedEmail,
  sendAnnouncementEmail,
  sendParticipantStatusEmail,
  sendEventNotice,
  sendWelcomeImportedEmail,
  sendPasswordResetEmail,
  sendVerifyEmail,
  sendCustomerInviteEmail,
  sendTestEmail,
  sendOrderPlacedEmail,
  sendOrderApprovedEmail,
  sendSetupLinkEmail,
  ORDER_WORDS,
  sendOrderRejectedEmail,
  sendPaymentReceivedEmail,
  sendSalesAlert,
  salesInbox,
  getMailReadiness: mailer.getReadiness,
  isMailConfigured: mailer.isMailConfigured,
  /* Older name; true when *any* provider is ready, not only SMTP. */
  isSmtpConfigured: mailer.isMailConfigured,
};
