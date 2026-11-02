/**
 * Event chat: the channels of one event, their messages, and the organisers'
 * moderation. The API decides who reads and writes what (see the backend's
 * chat.service); this file only talks to it and keeps the pure parts the
 * screens share (merging what a long poll brings, links in plain text, the
 * day a message belongs to) testable.
 *
 *   GET    /api/events/:id/chat                              the caller's channels
 *   GET    /api/events/:id/chat/tickets/:ticketId            a help request's thread
 *   GET    /api/events/:id/chat/channels/:cid/messages       ?after&wait&since | ?before
 *   POST   /api/events/:id/chat/channels/:cid/messages       { body }
 *   POST   /api/events/:id/chat/channels/:cid/read           { lastId }
 *   POST   /api/events/:id/chat/channels/:cid/lock | unlock  organisers
 *   DELETE /api/events/:id/chat/messages/:mid                its author or an organiser
 *   POST   /api/events/:id/chat/messages/:mid/report         { reason }
 *   GET    /api/events/:id/chat/reports                      organisers
 *   POST   /api/events/:id/chat/reports/:mid/resolve         { action: dismiss | remove }
 *   GET    /api/events/:id/chat/mutes, POST, DELETE /:userId organisers
 */

import { ApiError, api, apiDelete, apiGet, apiPost } from "@/lib/api";

export const CHANNEL_KINDS = ["general", "team", "support", "ticket"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/** The author's place in the event, as the badge next to their name says it. */
export const AUTHOR_ROLES = ["organizer", "judge", "mentor", "volunteer", "participant"] as const;
export type AuthorRole = (typeof AUTHOR_ROLES)[number];

/** Codes the API answers a chat request with; each has words in the "ch.err." keys. */
export const CHAT_ERRORS = [
  "CHAT_MUTED", "CHAT_LOCKED", "CHAT_READ_ONLY", "RATE_LIMITED", "VALIDATION_ERROR",
  "MODULE_DISABLED", "EVENT_ARCHIVED", "OWN_MESSAGE", "NOT_FOUND", "FORBIDDEN",
] as const;

/** How long an organiser can mute someone, in minutes; null is "until lifted". */
export const MUTE_CHOICES = [15, 60, 1440, null] as const;
export type MuteChoice = (typeof MUTE_CHOICES)[number];
export const muteKey = (m: MuteChoice) => (m == null ? "ch.mute.forever" : `ch.mute.${m}`);

export const MAX_BODY = 2000;
/** The longest the API holds a long poll (seconds). */
export const WAIT_SECONDS = 20;

export interface ChannelSummary {
  id: number;
  kind: ChannelKind;
  teamId: number | null;
  teamName: string | null;
  userId: number | null;
  personName: string | null;
  ticketId: number | null;
  ticketTopic: string | null;
  ticketStatus: string | null;
  locked: boolean;
  canPost: boolean;
  canModerate: boolean;
  unread: number;
  lastReadId: number;
  lastMessage: { id: number; preview: string | null; at: string | null; authorName: string | null } | null;
}

export interface ChatList {
  enabled: { general: boolean; team: boolean; support: boolean; ticket: boolean };
  /** Whether the event's plan has the chat (null: the answer did not say). */
  chatModule: boolean | null;
  /** The event is archived: everything reads, nothing writes. */
  archived: boolean;
  me: { userId: number | null; organizer: boolean; muted: boolean; mutedUntil: string | null };
  openReports: number | null;
  channels: ChannelSummary[];
}

export interface ChatAuthor {
  id: number;
  name: string | null;
  role: AuthorRole;
  avatar: string | null;
}

export interface ChatMessage {
  /** The server's id; negative for a message still on its way. */
  id: number;
  channelId: number;
  author: ChatAuthor | null;
  body: string | null;
  removed: boolean;
  createdAt: string | null;
  mine: boolean;
  /** Sent from this browser and not confirmed yet. */
  pending?: boolean;
  /** Sending failed: the "ch.err." key to show, and the words to send again. */
  failed?: string | null;
}

export interface MessagePage {
  channelId: number;
  messages: ChatMessage[];
  removed: number[];
  /** The server's clock at the answer: the next `since`. */
  at: string | null;
  hasMore: boolean;
}

export interface ChatReport {
  messageId: number;
  channelId: number;
  channelKind: ChannelKind;
  teamName: string | null;
  body: string;
  createdAt: string | null;
  author: { id: number; name: string | null } | null;
  reports: number;
  reasons: string[];
  firstReportedAt: string | null;
}

export interface ChatMute {
  userId: number;
  name: string;
  until: string | null;
  reason: string | null;
  since: string | null;
  mutedBy: string | null;
}

/* ── Reading the API's answers ───────────────────────────────────────── */

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const kindOf = (v: unknown): ChannelKind => ((CHANNEL_KINDS as readonly string[]).includes(String(v)) ? (v as ChannelKind) : "general");
const roleOf = (v: unknown): AuthorRole => ((AUTHOR_ROLES as readonly string[]).includes(String(v)) ? (v as AuthorRole) : "participant");

export function normalizeChannel(v: unknown): ChannelSummary | null {
  const c = obj(v);
  const id = num(c.id);
  if (id == null) return null;
  const last = c.lastMessage ? obj(c.lastMessage) : null;
  return {
    id,
    kind: kindOf(c.kind),
    teamId: num(c.teamId),
    teamName: str(c.teamName),
    userId: num(c.userId),
    personName: str(c.personName),
    ticketId: num(c.ticketId),
    ticketTopic: str(c.ticketTopic),
    ticketStatus: str(c.ticketStatus),
    locked: Boolean(c.locked),
    canPost: Boolean(c.canPost),
    canModerate: Boolean(c.canModerate),
    unread: Math.max(0, num(c.unread) ?? 0),
    lastReadId: num(c.lastReadId) ?? 0,
    lastMessage: last && num(last.id) != null
      ? { id: num(last.id) as number, preview: typeof last.preview === "string" ? last.preview : null, at: str(last.at), authorName: str(last.authorName) }
      : null,
  };
}

export function normalizeList(v: unknown): ChatList {
  const d = obj(v);
  const en = obj(d.enabled);
  const me = obj(d.me);
  return {
    enabled: { general: Boolean(en.general), team: Boolean(en.team), support: Boolean(en.support), ticket: Boolean(en.ticket) },
    chatModule: typeof d.chatModule === "boolean" ? d.chatModule : null,
    archived: Boolean(d.archived),
    me: { userId: num(me.userId), organizer: Boolean(me.organizer), muted: Boolean(me.muted), mutedUntil: str(me.mutedUntil) },
    openReports: num(d.openReports),
    channels: (Array.isArray(d.channels) ? d.channels : []).map(normalizeChannel).filter((c): c is ChannelSummary => c != null),
  };
}

export function normalizeMessage(v: unknown): ChatMessage | null {
  const m = obj(v);
  const id = num(m.id);
  if (id == null) return null;
  const a = m.author ? obj(m.author) : null;
  const removed = Boolean(m.removed);
  return {
    id,
    channelId: num(m.channelId) ?? 0,
    author: a && num(a.id) != null ? { id: num(a.id) as number, name: str(a.name), role: roleOf(a.role), avatar: str(a.avatar) } : null,
    body: removed ? null : typeof m.body === "string" ? m.body : null,
    removed,
    createdAt: str(m.createdAt),
    mine: Boolean(m.mine),
  };
}

export function normalizePage(v: unknown): MessagePage {
  const d = obj(v);
  return {
    channelId: num(d.channelId) ?? 0,
    messages: (Array.isArray(d.messages) ? d.messages : []).map(normalizeMessage).filter((m): m is ChatMessage => m != null),
    removed: (Array.isArray(d.removed) ? d.removed : []).map(num).filter((n): n is number => n != null),
    at: str(d.at),
    hasMore: Boolean(d.hasMore),
  };
}

export function normalizeReports(v: unknown): ChatReport[] {
  return (Array.isArray(v) ? v : []).map((x) => {
    const r = obj(x);
    const a = r.author ? obj(r.author) : null;
    return {
      messageId: num(r.messageId) ?? 0,
      channelId: num(r.channelId) ?? 0,
      channelKind: kindOf(r.channelKind),
      teamName: str(r.teamName),
      body: typeof r.body === "string" ? r.body : "",
      createdAt: str(r.createdAt),
      author: a && num(a.id) != null ? { id: num(a.id) as number, name: str(a.name) } : null,
      reports: num(r.reports) ?? 1,
      reasons: (Array.isArray(r.reasons) ? r.reasons : []).filter((s): s is string => typeof s === "string" && s.trim() !== ""),
      firstReportedAt: str(r.firstReportedAt),
    };
  }).filter((r) => r.messageId > 0);
}

export function normalizeMutes(v: unknown): ChatMute[] {
  return (Array.isArray(v) ? v : []).map((x) => {
    const m = obj(x);
    return {
      userId: num(m.userId) ?? 0,
      name: str(m.name) ?? "",
      until: str(m.until),
      reason: str(m.reason),
      since: str(m.since),
      mutedBy: str(m.mutedBy),
    };
  }).filter((m) => m.userId > 0);
}

/* ── Talking to the API ──────────────────────────────────────────────── */

const base = (eventId: number) => `/api/events/${eventId}/chat`;

export const chatApi = {
  list: async (eventId: number) => normalizeList(await apiGet<unknown>(base(eventId))),
  ticket: async (eventId: number, ticketId: number) => normalizeChannel(await apiGet<unknown>(`${base(eventId)}/tickets/${ticketId}`)),
  /** One channel the caller may read: a link from the bell to one the list does not show. */
  channel: async (eventId: number, channelId: number) => normalizeChannel(await apiGet<unknown>(`${base(eventId)}/channels/${channelId}`)),
  /**
   * A page of messages. `after` with `wait` is the long poll; the signal ends
   * it when the screen changes channel or goes away.
   */
  messages: async (
    eventId: number,
    channelId: number,
    q: { after?: number | null; before?: number | null; since?: string | null; wait?: number } = {},
    signal?: AbortSignal,
  ) => {
    const qs = new URLSearchParams();
    if (q.after != null) qs.set("after", String(q.after));
    if (q.before != null) qs.set("before", String(q.before));
    if (q.since) qs.set("since", q.since);
    if (q.wait) qs.set("wait", String(q.wait));
    const s = qs.toString();
    return normalizePage(await api<unknown>(`${base(eventId)}/channels/${channelId}/messages${s ? `?${s}` : ""}`, { signal }));
  },
  post: async (eventId: number, channelId: number, body: string) =>
    normalizeMessage(await apiPost<unknown>(`${base(eventId)}/channels/${channelId}/messages`, { body })),
  markRead: (eventId: number, channelId: number, lastId: number) =>
    apiPost<unknown>(`${base(eventId)}/channels/${channelId}/read`, { lastId }),
  lock: (eventId: number, channelId: number, locked: boolean) =>
    apiPost<unknown>(`${base(eventId)}/channels/${channelId}/${locked ? "lock" : "unlock"}`, {}),
  remove: (eventId: number, messageId: number) => apiDelete<unknown>(`${base(eventId)}/messages/${messageId}`),
  report: (eventId: number, messageId: number, reason: string) =>
    apiPost<{ reported?: boolean; alreadyRemoved?: boolean }>(`${base(eventId)}/messages/${messageId}/report`, { reason }),
  reports: async (eventId: number) => normalizeReports(await apiGet<unknown>(`${base(eventId)}/reports`)),
  resolve: (eventId: number, messageId: number, action: "dismiss" | "remove") =>
    apiPost<unknown>(`${base(eventId)}/reports/${messageId}/resolve`, { action }),
  mutes: async (eventId: number) => normalizeMutes(await apiGet<unknown>(`${base(eventId)}/mutes`)),
  mute: (eventId: number, input: { userId: number; minutes: number | null; reason?: string }) =>
    apiPost<unknown>(`${base(eventId)}/mutes`, { userId: input.userId, minutes: input.minutes, reason: input.reason || undefined }),
  unmute: (eventId: number, userId: number) => apiDelete<unknown>(`${base(eventId)}/mutes/${userId}`),
};

/** The "ch.err." key for a failed chat request. */
export function chatErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code && (CHAT_ERRORS as readonly string[]).includes(err.code)) return `ch.err.${err.code}`;
    if (err.status === 429) return "ch.err.RATE_LIMITED";
    if (err.status === 404) return "ch.err.NOT_FOUND";
  }
  return "ch.err.generic";
}

/* ── The pure parts ──────────────────────────────────────────────────── */

const byId = (a: ChatMessage, b: ChatMessage) => {
  // Messages still on their way (negative ids) come after the confirmed ones,
  // in the order they were written.
  if (a.id < 0 && b.id < 0) return b.id - a.id;
  if (a.id < 0) return 1;
  if (b.id < 0) return -1;
  return a.id - b.id;
};

/**
 * What is on screen plus what a page brought: one entry per id (the newer
 * answer wins, so a removal sticks), in order. A message from this browser
 * still on its way disappears once the server's copy of it arrives.
 */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (!incoming.length) return current;
  const map = new Map<number, ChatMessage>();
  for (const m of current) map.set(m.id, m);
  const confirmedMine = incoming.filter((m) => m.id > 0 && !m.pending && m.mine && m.body != null);
  for (const m of incoming) {
    const had = map.get(m.id);
    // Once removed, a message stays removed, whatever an older page says.
    map.set(m.id, had?.removed && !m.removed ? had : m);
  }
  const out = [...map.values()];
  // A pending copy with the same words as a confirmed message of mine is that message.
  const used = new Set<number>();
  const kept = out.filter((m) => {
    if (!m.pending || m.failed) return true;
    const match = confirmedMine.find((c) => !used.has(c.id) && c.body === m.body);
    if (!match) return true;
    used.add(match.id);
    return false;
  });
  return kept.sort(byId);
}

/** Marks the ids the server says were removed: the words go, the place stays. */
export function applyRemoved(current: ChatMessage[], removed: number[]): ChatMessage[] {
  if (!removed.length) return current;
  const gone = new Set(removed);
  let changed = false;
  const out = current.map((m) => {
    if (!gone.has(m.id) || m.removed) return m;
    changed = true;
    return { ...m, removed: true, body: null };
  });
  return changed ? out : current;
}

/** The newest confirmed id on screen (0 when there is none). */
export function lastConfirmedId(messages: ChatMessage[]): number {
  let max = 0;
  for (const m of messages) if (m.id > max) max = m.id;
  return max;
}

/** The oldest confirmed id on screen, for the page before it (null when there is none). */
export function firstConfirmedId(messages: ChatMessage[]): number | null {
  let min: number | null = null;
  for (const m of messages) if (m.id > 0 && (min == null || m.id < min)) min = m.id;
  return min;
}

export type TextPart = { type: "text"; value: string } | { type: "link"; value: string; href: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
/** Characters that end a sentence rather than an address. */
const TRAILING = new Set([".", ",", ";", ":", "!", "?", "]", "}", "'", "\"", "»", "”"]);

/** Drops sentence punctuation from the end of an address; a ")" stays when it closes a "(" of the address. */
function trimAddress(url: string): string {
  let out = url;
  for (;;) {
    const ch = out.at(-1);
    if (!ch) return out;
    if (TRAILING.has(ch)) { out = out.slice(0, -1); continue; }
    if (ch === ")") {
      const open = (out.match(/\(/g) || []).length;
      const close = (out.match(/\)/g) || []).length;
      if (close > open) { out = out.slice(0, -1); continue; }
    }
    return out;
  }
}

/**
 * Plain text cut into words and web addresses (http and https only), so the
 * screen can show links without ever treating the text as HTML.
 */
export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    const url = trimAddress(match[0]);
    if (!url || !/^https?:\/\/[^/]/i.test(url)) continue;
    if (start > last) parts.push({ type: "text", value: text.slice(last, start) });
    parts.push({ type: "link", value: url, href: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts.length ? parts : [{ type: "text", value: text }];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar day a moment falls on, in this browser's time zone: "2026-10-19". */
export function dayKey(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Messages in runs of one day each, for the day lines between them. */
export function groupByDay(messages: ChatMessage[]): { day: string; messages: ChatMessage[] }[] {
  const groups: { day: string; messages: ChatMessage[] }[] = [];
  for (const m of messages) {
    const day = m.pending || m.failed ? (groups.at(-1)?.day ?? dayKey(m.createdAt)) : dayKey(m.createdAt);
    const lastGroup = groups.at(-1);
    if (lastGroup && lastGroup.day === day) lastGroup.messages.push(m);
    else groups.push({ day, messages: [m] });
  }
  return groups;
}

/**
 * Whether a message starts a new run (its author's name is shown): another
 * author, a removed message, or more than five minutes after the previous one.
 */
export function startsRun(prev: ChatMessage | undefined, m: ChatMessage): boolean {
  if (!prev) return true;
  if (prev.mine !== m.mine) return true;
  if ((prev.author?.id ?? null) !== (m.author?.id ?? null)) return true;
  if (!prev.createdAt || !m.createdAt) return false;
  return new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60e3;
}

/** Initials for an avatar: "Aysel Məmmədova" → "AM". */
export function initials(name: string | null | undefined): string {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

/** The words of a channel's title for this reader. */
export function channelTitleKey(c: ChannelSummary, organizer: boolean): { key: string; name: string | null } {
  if (c.kind === "team") return { key: "ch.kind.team", name: c.teamName };
  if (c.kind === "ticket") return { key: "ch.kind.ticket", name: c.ticketTopic };
  if (c.kind === "support") return organizer ? { key: "ch.kind.support_person", name: c.personName } : { key: "ch.kind.support", name: null };
  return { key: "ch.kind.general", name: null };
}

/** Channels in the order the list shows them: the general one, the team, the thread with the organisers, help requests; within a kind, the latest first. */
export function sortChannels(channels: ChannelSummary[]): ChannelSummary[] {
  const rank: Record<ChannelKind, number> = { general: 0, team: 1, support: 2, ticket: 3 };
  const at = (c: ChannelSummary) => (c.lastMessage?.at ? new Date(c.lastMessage.at).getTime() : 0);
  return [...channels].sort((a, b) => rank[a.kind] - rank[b.kind] || at(b) - at(a) || a.id - b.id);
}
