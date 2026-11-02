/**
 * The notification centre (the bell): the rows of GET /api/me/notifications,
 * the words for each kind, and the screen each one opens.
 *
 * The API stores what happened (`kind`, its `data`) and which screen it is
 * about (`target`); the words are the app's, in the reader's language, and
 * the path depends on the reader's role in that event (`roles` of the list
 * response): a chat message opens /chat for an organiser and /hacker/chat
 * for a participant.
 */

import { fill } from "@/lib/i18n/fill";

export const NOTIFICATION_KINDS = [
  "announcement",
  "participant.approved",
  "participant.rejected",
  "participant.waitlisted",
  "participant.promoted",
  "team.request_new",
  "team.request_accepted",
  "team.request_declined",
  "team.invite",
  "ticket.new_for_you",
  "ticket.claimed",
  "ticket.resolved",
  "ticket.escalated",
  "chat.support",
  "chat.ticket",
  "chat.report",
  "results.published",
  "certificate.issued",
  "webhook.disabled",
  "judging.recheck",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** The small label above each row. */
export const NOTIFICATION_GROUPS = ["announcement", "registration", "team", "help", "chat", "judging", "results", "certificate", "webhooks", "other"] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

export const NOTIFICATION_TARGETS = ["chat", "announcements", "help", "team", "results", "certificates", "home", "webhooks"] as const;
export type NotificationTarget = (typeof NOTIFICATION_TARGETS)[number];

export const EVENT_ROLES = ["organizer", "judge", "mentor", "volunteer", "participant"] as const;
export type EventRole = (typeof EVENT_ROLES)[number];

export interface AppNotification {
  id: number;
  eventId: number | null;
  eventName: string | null;
  kind: string;
  target: string | null;
  title: string | null;
  body: string | null;
  data: Record<string, unknown>;
  count: number;
  createdAt: string;
  read: boolean;
}

export interface NotificationList {
  unread: number;
  /** The reader's role in each event the rows name; null: no longer part of it. */
  roles: Record<string, EventRole | null>;
  items: AppNotification[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  // Number(null) and Number("") are 0: an absent id is not event 0 or thread 0.
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

function normalizeItem(raw: unknown): AppNotification | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = num(o.id);
  if (id == null) return null;
  const data = o.data && typeof o.data === "object" && !Array.isArray(o.data) ? (o.data as Record<string, unknown>) : {};
  return {
    id,
    eventId: num(o.eventId ?? o.event_id),
    eventName: str(o.eventName ?? o.event_name),
    kind: String(o.kind ?? ""),
    target: str(o.target),
    title: str(o.title),
    body: str(o.body),
    data,
    count: Math.max(1, num(o.count) ?? 1),
    createdAt: String(o.createdAt ?? o.created_at ?? ""),
    read: Boolean(o.read),
  };
}

const isRole = (v: unknown): v is EventRole => typeof v === "string" && (EVENT_ROLES as readonly string[]).includes(v);

export function normalizeList(raw: unknown): NotificationList {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const items = Array.isArray(o.items) ? o.items.map(normalizeItem).filter((x): x is AppNotification => x != null) : [];
  const roles: Record<string, EventRole | null> = {};
  if (o.roles && typeof o.roles === "object") {
    for (const [k, v] of Object.entries(o.roles as Record<string, unknown>)) roles[k] = isRole(v) ? v : null;
  }
  return { unread: Math.max(0, num(o.unread) ?? 0), roles, items };
}

export function normalizeUnread(raw: unknown): { unread: number; latest: string | null } {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { unread: Math.max(0, num(o.unread) ?? 0), latest: str(o.latest) };
}

/** The number shown on the bell. */
export function badgeText(unread: number): string | null {
  if (!Number.isFinite(unread) || unread <= 0) return null;
  return unread > 9 ? "9+" : String(Math.floor(unread));
}

export function groupOf(kind: string): NotificationGroup {
  if (kind === "announcement") return "announcement";
  if (kind.startsWith("participant.")) return "registration";
  if (kind.startsWith("team.")) return "team";
  if (kind.startsWith("ticket.")) return "help";
  if (kind.startsWith("chat.")) return "chat";
  if (kind.startsWith("judging.")) return "judging";
  if (kind === "results.published") return "results";
  if (kind === "certificate.issued") return "certificate";
  if (kind.startsWith("webhook.")) return "webhooks";
  return "other";
}

type T = (key: string) => string;

/**
 * The words of one row: `line` (what happened) and `detail` (a second line,
 * or null). `role` is the reader's role in the event: a support thread reads
 * differently for the organisers and for the person writing to them.
 */
export function describe(n: AppNotification, t: T, role: EventRole | null = null): { line: string; detail: string | null } {
  const d = n.data;
  const event = n.eventName || str(d.eventName) || t("nt.this_event");
  const many = n.count > 1;
  const p = { event, n: n.count };
  switch (n.kind) {
    case "announcement":
      return { line: n.title || t("nt.k.announcement"), detail: n.body };
    case "participant.approved":
    case "participant.rejected":
    case "participant.waitlisted":
    case "participant.promoted":
      return { line: fill(t(`nt.k.${n.kind}`), p), detail: null };
    case "team.request_new":
      return { line: fill(t("nt.k.team.request_new"), { name: str(d.name) || t("nt.someone"), team: str(d.team) || t("nt.your_team") }), detail: null };
    case "team.request_accepted":
    case "team.request_declined":
      return { line: fill(t(`nt.k.${n.kind}`), { team: str(d.team) || t("nt.a_team") }), detail: null };
    case "team.invite":
      return { line: fill(t("nt.k.team.invite"), { name: str(d.name) || t("nt.someone"), team: str(d.team) || t("nt.their_team") }), detail: null };
    case "ticket.new_for_you":
      return {
        line: fill(t("nt.k.ticket.new_for_you"), { team: str(d.teamName) || t("nt.a_team"), topic: str(d.topic) || n.title || "" }),
        detail: str(d.place) ? fill(t("nt.at_place"), { place: String(d.place) }) : null,
      };
    case "ticket.claimed":
      return { line: fill(t("nt.k.ticket.claimed"), { mentor: str(d.mentorName) || t("nt.a_mentor"), topic: str(d.topic) || n.title || "" }), detail: null };
    case "ticket.resolved":
      return { line: fill(t("nt.k.ticket.resolved"), { topic: str(d.topic) || n.title || "" }), detail: null };
    case "ticket.escalated":
      return { line: fill(t("nt.k.ticket.escalated"), { topic: str(d.topic) || n.title || "", team: str(d.teamName) || t("nt.a_team") }), detail: null };
    case "chat.support": {
      if (role === "organizer") {
        const person = str(d.personName) || n.title || t("nt.someone");
        return { line: fill(t(many ? "nt.k.chat.support_org_many" : "nt.k.chat.support_org"), { person, n: n.count }), detail: n.body };
      }
      return { line: fill(t(many ? "nt.k.chat.support_many" : "nt.k.chat.support"), { n: n.count }), detail: n.body };
    }
    case "chat.ticket": {
      const topic = str(d.ticketTopic) || t("nt.your_request");
      const detail = n.body ? (n.title ? `${n.title}: ${n.body}` : n.body) : null;
      return { line: fill(t(many ? "nt.k.chat.ticket_many" : "nt.k.chat.ticket"), { topic, n: n.count }), detail };
    }
    case "chat.report":
      return { line: t("nt.k.chat.report"), detail: n.body ? fill(t("nt.reason"), { reason: n.body }) : null };
    case "results.published":
      return { line: fill(t("nt.k.results.published"), p), detail: null };
    case "certificate.issued":
      return { line: fill(t("nt.k.certificate.issued"), p), detail: n.title };
    case "judging.recheck": {
      // The organisers ask a judge to look again at projects changed after their review.
      const projects = Array.isArray(d.projects) ? d.projects.map(str).filter((x): x is string => x != null) : [];
      return { line: fill(t("nt.k.judging.recheck"), { event, n: num(d.count) ?? Math.max(1, projects.length) }), detail: projects.length ? projects.join(", ") : null };
    }
    case "webhook.disabled":
      return {
        line: fill(t("nt.k.webhook.disabled"), { host: str(d.host) || t("nt.an_endpoint") }),
        detail: num(d.failures) != null ? fill(t("nt.webhook_failures"), { n: num(d.failures) }) : null,
      };
    default:
      return { line: n.title || t("nt.k.other"), detail: n.body };
  }
}

const HOME: Record<EventRole, string> = {
  organizer: "/",
  judge: "/judge",
  mentor: "/mentor",
  volunteer: "/volunteer",
  participant: "/hacker",
};

const PATHS: Record<NotificationTarget, Partial<Record<EventRole, string>>> = {
  chat: { organizer: "/chat", judge: "/judge/chat", mentor: "/mentor/chat", volunteer: "/volunteer/chat", participant: "/hacker/chat" },
  announcements: { organizer: "/announcements", judge: "/judge", mentor: "/mentor/announcements", volunteer: "/volunteer/announcements", participant: "/hacker/announcements" },
  help: { organizer: "/help-queue", mentor: "/mentor/my-tickets", participant: "/hacker/help" },
  team: { participant: "/hacker/team" },
  results: { participant: "/hacker/results", organizer: "/results" },
  certificates: { participant: "/hacker/results", judge: "/judge", mentor: "/mentor", volunteer: "/volunteer", organizer: "/certificates" },
  home: HOME,
  webhooks: {},
};

/** The organisation's own pages, the same for whoever manages them (no event behind them). */
const ACCOUNT_PATHS: Partial<Record<NotificationTarget, string>> = { webhooks: "/account/webhooks" };

const isTarget = (v: unknown): v is NotificationTarget => typeof v === "string" && (NOTIFICATION_TARGETS as readonly string[]).includes(v);

/**
 * Where a row takes its reader. Someone who is no longer part of the event
 * (role null) goes to the workspace picker.
 */
export function pathFor(n: AppNotification, role: EventRole | null): string {
  if (isTarget(n.target) && ACCOUNT_PATHS[n.target]) return ACCOUNT_PATHS[n.target] as string;
  if (!role) return "/workspaces";
  // A participant asked for this mentor by name: the request waits in the queue to be taken.
  if (n.kind === "ticket.new_for_you" && role === "mentor") return "/mentor/help-queue";
  const target = isTarget(n.target) ? n.target : "home";
  const base = PATHS[target][role] ?? HOME[role];
  const channel = num(n.data.channelId);
  if (target === "chat" && base === PATHS.chat[role] && channel != null) return `${base}?c=${channel}`;
  return base;
}

/** The role a list names for a row's event. */
export function roleFor(list: Pick<NotificationList, "roles">, n: AppNotification): EventRole | null {
  if (n.eventId == null) return null;
  return list.roles[String(n.eventId)] ?? null;
}
