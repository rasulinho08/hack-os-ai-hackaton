/**
 * @file ticketJobs.js
 * @description Background work for the help queue.
 *
 *   ticket.notify   the bell in the app, and a short Telegram message in
 *                   the event's language:
 *                     new_for_you → the mentor a participant asked for
 *                     claimed     → the team: a mentor is on the way
 *                     resolved    → the participant: marked as resolved
 *                     escalated   → the organisers (bell only)
 *                   (Telegram only for people who connected the bot;
 *                   nothing by e-mail — a help request is a matter of minutes)
 *
 * Planner (every ten minutes): requests still open two hours after their
 * event ended are closed as "event_ended".
 */

const db = require('../config/db');
const ticketService = require('../services/ticket.service');
const { messageUser } = require('./peopleJobs');
const notifications = require('../services/notification.service');

const SWEEP_EVERY_MS = 10 * 60e3;
let lastSweep = 0;

const TEXT = {
  en: {
    new_for_you: '🙋 {team} asked for you: "{topic}"{where}. Open HackOS → Help queue to take it.',
    claimed: '🧑‍🏫 {mentor} took your help request "{topic}" and is on the way.',
    resolved: '✅ Your help request "{topic}" was marked as resolved. If you still need help, ask again in HackOS.',
    where: ' — {place}',
  },
  az: {
    new_for_you: '🙋 {team} sizi istədi: "{topic}"{where}. Götürmək üçün HackOS → Kömək növbəsini açın.',
    claimed: '🧑‍🏫 {mentor} "{topic}" kömək sorğunuzu götürdü və yoldadır.',
    resolved: '✅ "{topic}" kömək sorğunuz həll edilmiş kimi qeyd olundu. Hələ kömək lazımdırsa, HackOS-da yenidən soruşun.',
    where: ' — {place}',
  },
  ru: {
    new_for_you: '🙋 {team} просит именно вас: «{topic}»{where}. Откройте HackOS → Очередь помощи, чтобы взять запрос.',
    claimed: '🧑‍🏫 {mentor} взял(а) ваш запрос «{topic}» и уже идёт.',
    resolved: '✅ Ваш запрос «{topic}» отмечен как решённый. Если помощь ещё нужна, спросите снова в HackOS.',
    where: ' — {place}',
  },
};

const fill = (s, vars) => Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v ?? '')), s);

function register({ jobs, addPlanner }) {
  jobs.register('ticket.notify', async ({ ticketId, kind }) => {
    const r = await db.query(
      `SELECT ht.*, e.language, u.full_name AS requester_name, t.name AS team_name, m.full_name AS mentor_name
         FROM help_tickets ht
         JOIN events e ON e.id = ht.event_id
         LEFT JOIN users u ON u.id = ht.requester_id
         LEFT JOIN teams t ON t.id = ht.team_id
         LEFT JOIN users m ON m.id = ht.mentor_id
        WHERE ht.id = $1`,
      [ticketId],
    );
    const tk = r.rows[0];
    if (!tk) return;
    const lang = TEXT[tk.language] ? tk.language : 'en';
    const words = TEXT[lang];
    const vars = {
      topic: tk.topic,
      team: tk.team_name || tk.requester_name || '',
      mentor: tk.mentor_name || '',
      where: tk.table_location ? fill(words.where, { place: tk.table_location }) : '',
    };
    const status = String(tk.status || '').toLowerCase();
    const bell = (userIds, target) => notifications.notify(userIds, {
      eventId: tk.event_id,
      kind: `ticket.${kind}`,
      target,
      title: tk.topic,
      data: { ticketId: tk.id, topic: tk.topic, teamName: tk.team_name || null, mentorName: tk.mentor_name || null, place: tk.table_location || null },
      // Once per occurrence: a request taken by another mentor, or resolved
      // again after being reopened, is news again.
      dedupeKey: `ticket:${tk.id}:${kind}:${({
        claimed: tk.mentor_id || 0,
        resolved: tk.resolved_at ? new Date(tk.resolved_at).getTime() : 0,
        escalated: tk.escalated_at ? new Date(tk.escalated_at).getTime() : 0,
      })[kind] ?? 0}`,
    });
    if (kind === 'new_for_you') {
      // Already taken by then: nothing to say.
      if (status !== 'open' || !tk.preferred_mentor_id) return;
      await bell([tk.preferred_mentor_id], 'help');
      await messageUser(tk.preferred_mentor_id, fill(words.new_for_you, vars));
    } else if (kind === 'claimed') {
      if (status !== 'in-progress' || !tk.requester_id) return;
      await bell([tk.requester_id, ...(await notifications.teamMemberIds(tk.team_id))], 'help');
      await messageUser(tk.requester_id, fill(words.claimed, vars));
    } else if (kind === 'resolved') {
      if (tk.closed_reason !== 'resolved' || !tk.requester_id) return;
      await bell([tk.requester_id], 'help');
      await messageUser(tk.requester_id, fill(words.resolved, vars));
    } else if (kind === 'escalated') {
      if (!tk.escalated_to_admin) return;
      await bell(await notifications.organiserIds(tk.event_id), 'help');
    }
  });

  addPlanner(async () => {
    if (Date.now() - lastSweep < SWEEP_EVERY_MS) return;
    lastSweep = Date.now();
    const n = await ticketService.closeRequestsOfEndedEvents();
    if (n) console.log(`[tickets] closed ${n} request(s) of ended events`);
  });
}

module.exports = { register, TEXT };
