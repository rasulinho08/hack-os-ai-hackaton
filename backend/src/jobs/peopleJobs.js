/**
 * @file peopleJobs.js
 * @description Background jobs about people in an event.
 *
 *   participant.status_message  a registration was approved, not accepted,
 *                               waitlisted or moved up: e-mail (in the
 *                               event's language) and a Telegram message
 *   people.notify               a short notice to one person (join requests):
 *                               Telegram, and e-mail when asked
 *   account.welcome             an imported participant chooses a password
 *   volunteer.task_assigned     a volunteer got a task (Telegram)
 *
 * Planner (every five minutes): events whose waiting list can move up into
 * free seats, in case a seat freed up some other way (a raised limit).
 */

const db = require('../config/db');
const telegram = require('../services/telegram.service');
const emailService = require('../services/email.service');
const { eventSender } = require('../services/eventSender');
const { resolveFrontendBaseUrl } = require('../utils/frontendUrl');
const { promoteWaitlist } = require('../services/participantAdmin.service');
const notifications = require('../services/notification.service');

const SWEEP_EVERY_MS = 5 * 60e3;
let lastSweep = 0;

const STATUS_TEXT = {
  en: {
    approved: '✅ You are in: your registration for {event} was approved.',
    rejected: 'Your registration for {event} was not accepted this time.',
    waitlisted: '⏳ {event} is full for now — you are on the waiting list.',
    promoted: '🎉 A place opened up at {event}: you are off the waiting list. The organisers will review your registration.',
  },
  az: {
    approved: '✅ Qəbul olundunuz: {event} tədbirinə qeydiyyatınız təsdiqləndi.',
    rejected: '{event} tədbirinə qeydiyyatınız bu dəfə qəbul olunmadı.',
    waitlisted: '⏳ {event} hazırda doludur — gözləmə siyahısındasınız.',
    promoted: '🎉 {event} tədbirində yer açıldı: gözləmə siyahısından çıxdınız. Təşkilatçılar qeydiyyatınıza baxacaq.',
  },
  ru: {
    approved: '✅ Вы приняты: регистрация на {event} одобрена.',
    rejected: 'Регистрация на {event} в этот раз не принята.',
    waitlisted: '⏳ Мест на {event} пока нет — вы в листе ожидания.',
    promoted: '🎉 На {event} освободилось место: вы вышли из листа ожидания. Организаторы рассмотрят заявку.',
  },
};

const NOTICE = {
  en: {
    request_new: ['New join request', '🙋 {name} wants to join {team}. Open HackOS → My team to accept or decline.'],
    request_accepted: ['You joined {team}', '✅ You are in {team} for {event}. Say hello to your teammates in HackOS → My team.'],
    request_declined: ['Join request declined', '{team} could not take you this time. Other teams are still looking — see HackOS → Find a team.'],
  },
  az: {
    request_new: ['Yeni qoşulma sorğusu', '🙋 {name} {team} komandasına qoşulmaq istəyir. Qəbul və ya rədd etmək üçün HackOS → Komandam bölməsini açın.'],
    request_accepted: ['{team} komandasına qoşuldunuz', '✅ {event} üçün {team} komandasındasınız. HackOS → Komandam bölməsində komanda yoldaşlarınızla tanış olun.'],
    request_declined: ['Qoşulma sorğusu rədd edildi', '{team} bu dəfə sizi qəbul edə bilmədi. Başqa komandalar hələ axtarır — HackOS → Komanda tap bölməsinə baxın.'],
  },
  ru: {
    request_new: ['Новая заявка в команду', '🙋 {name} хочет вступить в {team}. Откройте HackOS → Моя команда, чтобы принять или отклонить.'],
    request_accepted: ['Вы в команде {team}', '✅ Вы в команде {team} на {event}. Познакомьтесь с командой в HackOS → Моя команда.'],
    request_declined: ['Заявка отклонена', '{team} в этот раз не смогла вас принять. Другие команды ещё ищут участников — HackOS → Найти команду.'],
  },
};

const TASK_TEXT = {
  en: '📋 New task for you at {event}: "{title}"{where}{due}. See HackOS → My tasks.',
  az: '📋 {event} tədbirində sizə yeni tapşırıq: "{title}"{where}{due}. HackOS → Tapşırıqlarım bölməsinə baxın.',
  ru: '📋 Новая задача для вас на {event}: «{title}»{where}{due}. Смотрите HackOS → Мои задачи.',
};
const DUE_WORD = { en: ' — by {time}', az: ' — {time} qədər', ru: ' — до {time}' };

const fill = (s, vars) => Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v ?? '')), s);

/** A Telegram message to one person, if they connected the bot and did not block it. */
async function messageUser(userId, text) {
  const link = (await db.query('SELECT chat_id, blocked_at FROM telegram_links WHERE user_id = $1', [userId])).rows[0];
  if (!link || link.blocked_at || !telegram.isEnabled()) return { skipped: true };
  const r = await telegram.sendMessage(String(link.chat_id), telegram.escapeHtml(text));
  if (!r.ok && r.error_code === 403) await db.query('UPDATE telegram_links SET blocked_at = now() WHERE user_id = $1', [userId]);
  if (!r.ok && !r.permanent) throw new Error(r.description);
  return { ok: r.ok };
}

const mailOn = (key) => String(process.env[key] || 'true').trim().toLowerCase() !== 'false';

function register({ jobs, addPlanner }) {
  jobs.register('participant.status_message', async ({ participantId, status }) => {
    const r = await db.query(
      `SELECT p.id, p.user_id, LOWER(TRIM(p.status)) AS current, u.full_name, u.email, LOWER(u.role) AS role,
              e.id AS event_id, e.name AS event_name, e.language
         FROM participants p JOIN users u ON u.id = p.user_id JOIN events e ON e.id = p.event_id
        WHERE p.id = $1`,
      [participantId],
    );
    const p = r.rows[0];
    // Gone, or changed again since: the newer change sends its own message.
    if (!p) return;
    const expected = status === 'promoted' ? 'pending' : status;
    if (p.current !== expected) return;
    const lang = STATUS_TEXT[p.language] ? p.language : 'en';
    const text = STATUS_TEXT[lang][status];
    // The bell first: a retry of a failed e-mail brings the same row back, not a second one.
    await notifications.notify([p.user_id], {
      eventId: p.event_id,
      kind: `participant.${status}`,
      target: 'home',
      data: { status, eventName: p.event_name },
      dedupeKey: `pstatus:${p.id}`,
      collapse: 'replace',
    });
    if (text) await messageUser(p.user_id, fill(text, { event: p.event_name }));
    const flag = status === 'approved' ? 'SEND_EMAIL_ON_PARTICIPANT_APPROVED' : 'SEND_EMAIL_ON_PARTICIPANT_STATUS';
    if (p.email && mailOn(flag) && ['approved', 'rejected', 'waitlisted', 'promoted'].includes(status)) {
      const out = await emailService.sendParticipantStatusEmail({
        to: p.email, fullName: p.full_name, eventName: p.event_name, status, lang,
        frontendUrl: resolveFrontendBaseUrl(), sender: await eventSender(p.event_id),
      });
      if (!out.ok && out.status !== 400) throw new Error(out.message || 'mail failed');
    }
  });

  jobs.register('people.notify', async ({ userId, eventId, kind, vars = {}, email = false }) => {
    const ev = (await db.query('SELECT name, language FROM events WHERE id = $1', [eventId])).rows[0];
    if (!ev) return;
    const lang = NOTICE[ev.language] ? ev.language : 'en';
    const words = NOTICE[lang][kind];
    if (!words) return;
    const all = { ...vars, event: ev.name };
    await notifications.notify([userId], {
      eventId,
      kind: `team.${kind}`,
      target: 'team',
      data: { team: vars.team || null, name: vars.name || null, requestId: vars.requestId || null },
      dedupeKey: vars.requestId ? `treq:${vars.requestId}:${kind}` : null,
    });
    await messageUser(userId, fill(words[1], all));
    if (email) {
      const u = (await db.query('SELECT email FROM users WHERE id = $1', [userId])).rows[0];
      if (u?.email) {
        await emailService.sendEventNotice({
          to: u.email, eventName: ev.name, subject: fill(words[0], all), heading: fill(words[0], all),
          body: fill(words[1], all), cta: { label: 'HackOS', url: `${resolveFrontendBaseUrl()}/hacker/team` },
          lang, sender: await eventSender(eventId),
        });
      }
    }
  });

  // An organiser imported this person: a "set your password" link, valid a week.
  jobs.register('account.welcome', async ({ userId, eventId }) => {
    const u = (await db.query('SELECT email, full_name FROM users WHERE id = $1', [userId])).rows[0];
    const ev = (await db.query('SELECT name, language FROM events WHERE id = $1', [eventId])).rows[0];
    if (!u?.email || !ev) return;
    const reset = await require('../services/auth.service').createPasswordResetToken(u.email, { ttlMinutes: 7 * 24 * 60 });
    if (!reset) return;
    const out = await emailService.sendWelcomeImportedEmail({
      to: u.email, fullName: u.full_name, eventName: ev.name, lang: ev.language,
      setUrl: `${resolveFrontendBaseUrl()}/reset-password?token=${encodeURIComponent(reset.token)}`,
      sender: await eventSender(eventId),
    });
    if (!out.ok && out.status !== 400) throw new Error(out.message || 'mail failed');
  });

  jobs.register('volunteer.task_assigned', async ({ eventId, taskId }) => {
    const r = await db.query(
      `SELECT t.title, t.location, t.due_at, t.assignee_id, e.name AS event_name, e.language, e.timezone
         FROM volunteer_tasks t JOIN events e ON e.id = t.event_id
        WHERE t.id = $1 AND t.event_id = $2`,
      [taskId, eventId],
    );
    const task = r.rows[0];
    if (!task || !task.assignee_id) return;
    const lang = TASK_TEXT[task.language] ? task.language : 'en';
    let due = '';
    if (task.due_at) {
      const locale = lang === 'az' ? 'az-AZ' : lang === 'ru' ? 'ru-RU' : 'en-GB';
      const opts = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
      let time;
      try {
        time = new Date(task.due_at).toLocaleString(locale, { ...opts, timeZone: task.timezone || 'Asia/Baku' });
      } catch {
        time = new Date(task.due_at).toLocaleString(locale, { ...opts, timeZone: 'UTC' });
      }
      due = fill(DUE_WORD[lang], { time });
    }
    await messageUser(task.assignee_id, fill(TASK_TEXT[lang], {
      event: task.event_name, title: task.title, where: task.location ? ` · ${task.location}` : '', due,
    }));
  });

  addPlanner(async () => {
    if (Date.now() - lastSweep < SWEEP_EVERY_MS) return;
    lastSweep = Date.now();
    const candidates = await db.query(
      `SELECT DISTINCT p.event_id FROM participants p JOIN events e ON e.id = p.event_id
        WHERE LOWER(TRIM(p.status)) = 'waitlisted' AND e.waitlist_enabled
          AND e.start_date > now() AND LOWER(COALESCE(e.status, '')) <> 'archived'
        LIMIT 100`,
    );
    for (const { event_id: eventId } of candidates.rows) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await promoteWaitlist(eventId);
      } catch (err) {
        console.error(`[waitlist] event ${eventId}: ${err.message}`);
      }
    }
  });
}

module.exports = { register, messageUser, STATUS_TEXT, NOTICE };
