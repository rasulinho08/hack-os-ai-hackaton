/**
 * Walkthrough answers for the event chat (GET /api/events/:id/chat and the
 * channels, reports and mutes under it): what the organiser of the sample
 * event sees on judging day — the general channel, a few team channels,
 * people's threads with the organisers, help-request threads, one reported
 * message and two people muted. `s` is the path without "api"
 * (`/api/events/1/chat/channels/1501/messages` → ["events", "1", "chat",
 * "channels", "1501", "messages"]); anything not recognised returns
 * undefined.
 *
 * The query (`?after`, `?before`) never reaches here, which is fine: every
 * channel fits on one page, and the walkthrough does not poll. Every help
 * request of the sample queue has a thread, so "Messages" on any of them
 * opens one; most are still empty.
 */

import { DEMO_JUDGES, DEMO_MENTORS, DEMO_TEAMS, DEMO_TICKETS, DEMO_VOLUNTEERS } from "./console";

type Role = "organizer" | "judge" | "mentor" | "volunteer" | "participant";
interface Author { id: number; name: string; role: Role }

/** The organiser the walkthrough presents as (the same person as /auth/me). */
const ME: Author = { id: 1, name: "Demo Organiser", role: "organizer" };

const member = (teamIndex: number, k: number): Author => {
  const team = DEMO_TEAMS[teamIndex % DEMO_TEAMS.length];
  const m = team.members.length ? team.members[k % team.members.length] : null;
  return { id: m?.id ?? 1900 + teamIndex * 10 + k, name: m?.full_name ?? `${team.name} member`, role: "participant" };
};
const mentor = (i: number): Author => ({ id: DEMO_MENTORS[i].user_id, name: DEMO_MENTORS[i].full_name, role: "mentor" });
const judge = (i: number): Author => ({ id: DEMO_JUDGES[i].user_id, name: DEMO_JUDGES[i].full_name, role: "judge" });
const volunteer = (i: number): Author => ({ id: DEMO_VOLUNTEERS[i].user_id, name: DEMO_VOLUNTEERS[i].full_name, role: "volunteer" });

/** [minutes ago, author, words — null for a message an organiser removed] */
type Line = [number, Author, string | null];

interface Seed {
  id: number;
  kind: "general" | "team" | "support" | "ticket";
  teamIndex?: number;
  person?: Author;
  ticketIndex?: number;
  /** How many of the newest messages the organiser has not opened yet. */
  unread?: number;
  lines: Line[];
}

/** Posted the link everyone reported, and muted for it. */
const ADVERTISER = member(5, 2);
const SPAM_LINE: Line = [118, ADVERTISER, "DM me for cheap cloud credits, half the price of the official ones 👉 https://example.com/free-credits"];

const SEEDS: Seed[] = [
  {
    id: 1501,
    kind: "general",
    lines: [
      [190, ME, "Good morning, everyone! Judging starts at 13:00 — the schedule is on the event page. Ask here, or in your thread with the organisers, if anything is unclear."],
      [176, volunteer(0), "Breakfast and coffee are on the second floor until 11:00 ☕"],
      [151, member(0, 1), "Is the Wi-Fi password the same as yesterday?"],
      [148, volunteer(1), "Yes — it is on the card on every table."],
      SPAM_LINE,
      [96, member(7, 3), null],
      [64, mentor(0), "Mentors are at the desks by the stage until 16:00. Open a help request and we come to your table."],
      [31, judge(0), "Judges here 👋 We walk round the tables first, then the presentations. Please have your demo open."],
      [12, ME, "Submissions are closed. The presentation order is on the screen in the main hall — good luck!"],
    ],
  },
  {
    id: 1511,
    kind: "team",
    teamIndex: 0,
    lines: [
      [240, member(0, 0), "I pushed the map fix — can someone check the deploy?"],
      [236, member(0, 1), "On it"],
      [225, member(0, 1), "Works on my phone too 🎉"],
      [80, member(0, 2), "Who presents? I can do the demo part."],
      [78, member(0, 0), "I'll do the intro, you take the demo."],
    ],
  },
  {
    id: 1512,
    kind: "team",
    teamIndex: 1,
    lines: [
      [300, member(1, 0), "The slides are in our shared folder."],
      [55, member(1, 2), "Rehearsal in the quiet room at 12:30?"],
      [53, member(1, 1), "👍"],
    ],
  },
  {
    id: 1521,
    kind: "support",
    person: member(2, 1),
    unread: 2,
    lines: [
      [42, member(2, 1), "Hi! One of our team is ill today — can she present with us by video?"],
      [35, ME, "Yes, she can join the presentation by video. Send us the link ten minutes before your slot."],
      [9, member(2, 1), "Thank you! We will send it before 14:20."],
      [4, member(2, 1), "One more thing — can we use our own laptop for the demo?"],
    ],
  },
  {
    id: 1522,
    kind: "support",
    person: member(3, 0),
    lines: [
      [130, member(3, 0), "Where can we leave our bikes?"],
      [126, ME, "There is a rack by the main entrance, next to the security desk."],
    ],
  },
  {
    id: 1531,
    kind: "ticket",
    ticketIndex: 0,
    unread: 1,
    lines: [
      [24, member(0, 3), "The build log says \"out of memory\" right after npm install."],
      [22, ME, "A mentor is on the way. Meanwhile, try installing without the dev dependencies."],
      [7, member(0, 3), "Same error. We are at table 1, by the window."],
    ],
  },
  {
    id: 1532,
    kind: "ticket",
    ticketIndex: 3,
    lines: [
      [50, member(3, 2), "We are at table 4, near the window."],
      [47, mentor(3), "Coming over in five minutes — have the repository open."],
      [20, member(3, 2), "Thanks, both services build now!"],
    ],
  },
];

/** A help request without a prepared thread: its (empty) channel id. */
const EMPTY_TICKET_BASE = 1700;

function messagesOf(seed: Seed, at: (minutesAgo: number) => string) {
  return seed.lines.map(([ago, author, body], i) => ({
    id: seed.id * 100 + i + 1,
    channelId: seed.id,
    author: { id: author.id, name: author.name, role: author.role, avatar: null },
    body,
    removed: body == null,
    createdAt: at(ago),
    mine: author.id === ME.id,
  }));
}

function summaryOf(seed: Seed, at: (minutesAgo: number) => string) {
  const messages = messagesOf(seed, at);
  const readCount = Math.max(0, messages.length - (seed.unread ?? 0));
  const lastReadId = readCount ? messages[readCount - 1].id : 0;
  const last = messages.at(-1);
  const team = seed.teamIndex != null ? DEMO_TEAMS[seed.teamIndex] : null;
  const ticket = seed.ticketIndex != null ? DEMO_TICKETS[seed.ticketIndex] : null;
  return {
    id: seed.id,
    kind: seed.kind,
    teamId: team?.id ?? null,
    teamName: team?.name ?? null,
    userId: seed.person?.id ?? null,
    personName: seed.person?.name ?? null,
    ticketId: ticket?.id ?? null,
    ticketTopic: ticket?.topic ?? null,
    ticketStatus: ticket?.status ?? null,
    locked: false,
    // An organiser reads, writes and moderates every channel.
    canPost: true,
    canModerate: true,
    unread: messages.filter((m) => m.id > lastReadId && !m.removed && !m.mine).length,
    lastReadId,
    lastMessage: last
      ? { id: last.id, preview: last.body == null ? null : last.body.slice(0, 140), at: last.createdAt, authorName: last.author.name }
      : null,
  };
}

/** The seed of a channel, or of a help request's thread (prepared or empty). */
function seedOf(channelId: number): Seed | null {
  const prepared = SEEDS.find((x) => x.id === channelId);
  if (prepared) return prepared;
  const ticketIndex = channelId - EMPTY_TICKET_BASE;
  if (ticketIndex >= 0 && ticketIndex < DEMO_TICKETS.length && !SEEDS.some((x) => x.ticketIndex === ticketIndex)) {
    return { id: channelId, kind: "ticket", ticketIndex, lines: [] };
  }
  return null;
}

function demoReports(at: (minutesAgo: number) => string) {
  const general = SEEDS[0];
  const index = general.lines.indexOf(SPAM_LINE);
  return [{
    messageId: general.id * 100 + index + 1,
    channelId: general.id,
    channelKind: general.kind,
    teamName: null,
    body: SPAM_LINE[2],
    createdAt: at(SPAM_LINE[0]),
    author: { id: ADVERTISER.id, name: ADVERTISER.name },
    reports: 2,
    reasons: ["Advertising", "The same link was posted in our team channel too"],
    firstReportedAt: at(110),
  }];
}

function demoMutes(at: (minutesAgo: number) => string) {
  const other = member(9, 1);
  return [
    { userId: ADVERTISER.id, name: ADVERTISER.name, until: at(-45), reason: "Advertising in the general channel", since: at(15), mutedBy: ME.name },
    { userId: other.id, name: other.name, until: null, reason: "Posted another team's code in the general channel", since: at(260), mutedBy: ME.name },
  ];
}

export function resolveChatDemo(s: string[]): unknown | undefined {
  if (s[0] !== "events" || s[2] !== "chat") return undefined;
  const now = Date.now();
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60e3).toISOString();

  if (s.length === 3) {
    return {
      enabled: { general: true, team: true, support: true, ticket: true },
      me: { userId: ME.id, organizer: true, muted: false, mutedUntil: null },
      openReports: demoReports(at).length,
      channels: SEEDS.map((seed) => summaryOf(seed, at)),
    };
  }
  if (s[3] === "tickets" && s.length === 5) {
    const ticketIndex = DEMO_TICKETS.findIndex((x) => x.id === Number(s[4]));
    if (ticketIndex < 0) return undefined;
    const seed = SEEDS.find((x) => x.ticketIndex === ticketIndex) ?? seedOf(EMPTY_TICKET_BASE + ticketIndex);
    return seed ? summaryOf(seed, at) : undefined;
  }
  if (s[3] === "channels" && s[5] === "messages" && s.length === 6) {
    const seed = seedOf(Number(s[4]));
    if (!seed) return undefined;
    return { channelId: seed.id, messages: messagesOf(seed, at), removed: [], at: new Date(now).toISOString(), hasMore: false };
  }
  if (s[3] === "reports" && s.length === 4) return demoReports(at);
  if (s[3] === "mutes" && s.length === 4) return demoMutes(at);
  return undefined;
}
