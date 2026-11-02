/**
 * Walkthrough answers for the bell (GET /api/me/notifications and its
 * unread count): what the organiser of the sample event would have been
 * told on judging day — a help request escalated by a mentor, and an
 * announcement a co-organiser sent to the staff. `s` is the path without
 * "api" (`/api/me/notifications` → ["me", "notifications"]); anything not
 * recognised returns undefined.
 *
 * Only screens the walkthrough has are linked (the help queue and the
 * announcements), so a click never leaves the sample.
 */

import { DEMO_EVENT, DEMO_EVENT_ID, DEMO_TICKETS } from "./console";

function demoNotifications() {
  const now = Date.now();
  const ago = (minutes: number) => new Date(now - minutes * 60e3).toISOString();
  const escalated = DEMO_TICKETS.find((x) => x.status === "open") ?? DEMO_TICKETS[0];
  const items = [
    {
      id: 7001,
      eventId: DEMO_EVENT_ID,
      eventName: DEMO_EVENT.name,
      kind: "ticket.escalated",
      target: "help",
      title: escalated?.topic ?? null,
      body: null,
      data: { ticketId: escalated?.id ?? null, topic: escalated?.topic ?? null, teamName: escalated?.team_name ?? null, mentorName: null, place: escalated?.table_location ?? null },
      count: 1,
      createdAt: ago(6),
      read: false,
    },
    {
      id: 7002,
      eventId: DEMO_EVENT_ID,
      eventName: DEMO_EVENT.name,
      kind: "announcement",
      target: "announcements",
      title: "Judges: scoring closes at 17:00",
      body: "Finish every review in the judging screen before the presentations end; late scores are not counted.",
      data: { announcementId: null, priority: "high" },
      count: 1,
      createdAt: ago(48),
      read: false,
    },
    {
      id: 7003,
      eventId: DEMO_EVENT_ID,
      eventName: DEMO_EVENT.name,
      kind: "ticket.escalated",
      target: "help",
      title: DEMO_TICKETS[1]?.topic ?? null,
      body: null,
      data: { ticketId: DEMO_TICKETS[1]?.id ?? null, topic: DEMO_TICKETS[1]?.topic ?? null, teamName: DEMO_TICKETS[1]?.team_name ?? null, mentorName: null, place: null },
      count: 1,
      createdAt: ago(190),
      read: true,
    },
  ];
  return { unread: items.filter((x) => !x.read).length, roles: { [DEMO_EVENT_ID]: "organizer" }, items };
}

export function resolveNotifyDemo(s: string[]): unknown | undefined {
  if (s[0] !== "me" || s[1] !== "notifications") return undefined;
  const list = demoNotifications();
  if (s.length === 2) return list;
  if (s[2] === "unread") return { unread: list.unread, latest: list.items[0]?.createdAt ?? null };
  return undefined;
}
