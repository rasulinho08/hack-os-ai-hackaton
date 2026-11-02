/**
 * The help queue and the mentors behind it, as every page sees them: a help
 * request (ticket) with who asked, who was asked for, who took it and why it
 * closed; a mentor with skills, where to find them, whether they are around,
 * what they are on and their next hours; a slot of those hours.
 */

import { ApiError } from "@/lib/api";

export type TicketStatus = "open" | "in-progress" | "resolved";
export type ClosedReason = "resolved" | "withdrawn" | "event_ended";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type Presence = "available" | "busy" | "away";

export const TICKET_PRIORITIES: TicketPriority[] = ["normal", "high", "urgent"];
export const PRESENCES: Presence[] = ["available", "busy", "away"];

export interface HelpTicket {
  id: number;
  eventId: number;
  topic: string;
  description: string;
  status: TicketStatus;
  closedReason: ClosedReason | null;
  priority: TicketPriority;
  tableLocation: string | null;
  contactPhone: string | null;
  teamName: string | null;
  requesterId: number | null;
  requesterName: string | null;
  mentorId: number | null;
  mentorName: string | null;
  preferredMentorId: number | null;
  preferredMentor: string | null;
  escalated: boolean;
  createdAt: string | null;
  claimedAt: string | null;
  resolvedAt: string | null;
  eventFinished: boolean;
}

export interface SlotBrief {
  startsAt: string;
  endsAt: string;
  mode: "onsite" | "online";
  note: string | null;
}

export interface MentorCard {
  assignmentId: number;
  userId: number;
  name: string;
  email: string | null;
  skills: string[];
  bio: string | null;
  location: string | null;
  availability: string | null;
  presence: Presence | null;
  online: boolean | null;
  activeTickets: number;
  waitingForThem: number;
  resolvedTickets: number;
  nextSlot: SlotBrief | null;
}

export interface MentorSlot extends SlotBrief {
  id: number;
  userId: number;
  mentorName: string;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

function skills(v: unknown): string[] {
  let arr = v;
  if (typeof v === "string") {
    try { arr = JSON.parse(v); } catch { arr = v.split(/[,;]/); }
  }
  return Array.isArray(arr) ? arr.map((s) => String(s ?? "").trim()).filter(Boolean) : [];
}

export function ticketStatus(raw: unknown): TicketStatus {
  const s = String(raw ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (s === "resolved" || s === "closed" || s === "done") return "resolved";
  if (s === "in-progress" || s === "claimed" || s === "assigned") return "in-progress";
  return "open";
}

export function normalizeTicket(raw: unknown): HelpTicket | null {
  const o = obj(raw);
  const id = num(o.id);
  if (!id) return null;
  const reason = String(o.closed_reason ?? "");
  const prio = String(o.priority ?? "normal").toLowerCase();
  return {
    id,
    eventId: num(o.event_id) ?? 0,
    topic: String(o.topic ?? "").trim() || "—",
    description: String(o.description ?? "").trim(),
    status: ticketStatus(o.status),
    closedReason: reason === "resolved" || reason === "withdrawn" || reason === "event_ended" ? reason : null,
    priority: (["low", "normal", "high", "urgent"].includes(prio) ? prio : "normal") as TicketPriority,
    tableLocation: str(o.table_location),
    contactPhone: str(o.contact_phone),
    teamName: str(o.team_name),
    requesterId: num(o.requester_id),
    requesterName: str(o.requester_name),
    mentorId: num(o.mentor_id),
    mentorName: str(o.mentor_name),
    preferredMentorId: num(o.preferred_mentor_id),
    preferredMentor: str(o.preferred_mentor) ?? str(o.preferred_mentor_name),
    escalated: o.escalated_to_admin === true,
    createdAt: str(o.created_at),
    claimedAt: str(o.claimed_at),
    resolvedAt: str(o.resolved_at),
    eventFinished: o.event_finished === true,
  };
}

export const normalizeTickets = (raw: unknown): HelpTicket[] =>
  (Array.isArray(raw) ? raw : []).map(normalizeTicket).filter((t): t is HelpTicket => t !== null);

function slotBrief(raw: unknown): SlotBrief | null {
  const o = obj(raw);
  const startsAt = str(o.starts_at);
  const endsAt = str(o.ends_at);
  if (!startsAt || !endsAt) return null;
  return { startsAt, endsAt, mode: o.mode === "online" ? "online" : "onsite", note: str(o.note) };
}

export function normalizeMentors(raw: unknown): MentorCard[] {
  return (Array.isArray(raw) ? raw : []).map((x) => {
    const o = obj(x);
    const presence = String(o.presence ?? "");
    return {
      assignmentId: num(o.id) ?? 0,
      userId: num(o.user_id) ?? 0,
      name: String(o.full_name ?? "").trim() || String(o.email ?? "—"),
      email: str(o.email),
      skills: skills(o.skills),
      bio: str(o.bio),
      location: str(o.location),
      availability: str(o.availability),
      presence: (PRESENCES as string[]).includes(presence) ? (presence as Presence) : null,
      online: typeof o.online === "boolean" ? o.online : null,
      activeTickets: num(o.active_tickets) ?? 0,
      waitingForThem: num(o.waiting_for_them) ?? 0,
      resolvedTickets: num(o.resolved_tickets) ?? 0,
      nextSlot: slotBrief(o.next_slot),
    };
  }).filter((m) => m.userId > 0);
}

export function normalizeSlots(raw: unknown): MentorSlot[] {
  return (Array.isArray(raw) ? raw : []).flatMap((x) => {
    const o = obj(x);
    const brief = slotBrief(o);
    const id = num(o.id);
    return brief && id ? [{ ...brief, id, userId: num(o.user_id) ?? 0, mentorName: String(o.mentor_name ?? "").trim() }] : [];
  });
}

/** The mentor's skills that the request mentions (case-insensitive, whole words where it matters). */
export function skillsMentioned(mentorSkills: string[], text: string): string[] {
  const hay = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}+#.]+/gu, " ")} `;
  return mentorSkills.filter((s) => {
    const k = s.toLowerCase().trim();
    if (!k) return false;
    return k.length <= 2 ? hay.includes(` ${k} `) : hay.includes(k);
  });
}

/**
 * Mentors in the order a person asking for help should see them: who fits
 * the request (skills it mentions), then who is around and free, then by name.
 */
export function rankMentors(mentors: MentorCard[], text: string): (MentorCard & { matched: string[] })[] {
  return mentors
    .map((m) => ({ ...m, matched: text.trim() ? skillsMentioned(m.skills, text) : [] }))
    .sort((a, b) =>
      b.matched.length - a.matched.length
      || Number(b.online === true) - Number(a.online === true)
      || Number(a.presence === "away") - Number(b.presence === "away")
      || a.activeTickets - b.activeTickets
      || a.name.localeCompare(b.name));
}

/** Whole minutes since `iso` (0 when unknown or in the future). */
export function minutesSince(iso: string | null, now = Date.now()): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 60000)) : 0;
}

/** The middle waiting time (minutes) between asking and a mentor taking it, over requests taken. */
export function medianWait(tickets: HelpTicket[]): number | null {
  const waits = tickets
    .filter((t) => t.createdAt && t.claimedAt)
    .map((t) => (new Date(t.claimedAt as string).getTime() - new Date(t.createdAt as string).getTime()) / 60000)
    .filter((m) => Number.isFinite(m) && m >= 0)
    .sort((a, b) => a - b);
  if (!waits.length) return null;
  const mid = Math.floor(waits.length / 2);
  return Math.round(waits.length % 2 ? waits[mid] : (waits[mid - 1] + waits[mid]) / 2);
}

/** Words for a failure: `hq.err.<CODE>` when the page knows the code, else plain. */
export function helpErrorWords(err: unknown, t: (k: string) => string): string {
  const code = err instanceof ApiError ? err.code : undefined;
  if (code) {
    const key = `hq.err.${code}`;
    const words = t(key);
    if (words && words !== key) return words;
  }
  return t("hq.failed");
}
