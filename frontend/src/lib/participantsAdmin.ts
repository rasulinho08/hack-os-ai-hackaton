/**
 * Participants as the organiser manages them: one shape for a row of the
 * API's list, the capacity summary, and the result of a bulk change.
 */

export const PARTICIPANT_STATUSES = ["pending", "approved", "waitlisted", "rejected", "eliminated"] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

export interface AdminParticipant {
  id: number;
  userId: number;
  name: string;
  email: string;
  status: ParticipantStatus;
  teamId: number | null;
  teamName: string | null;
  isLead: boolean;
  looking: boolean;
  lookingNote: string | null;
  skills: string[];
  university: string | null;
  experience: string | null;
  country: string | null;
  phone: string | null;
  source: string | null;
  registeredAt: string | null;
  answers: Record<string, unknown>;
}

export interface CapacitySummary {
  capacity: {
    limit: number | null;
    taken: number;
    remaining: number | null;
    full: boolean;
    waitlistEnabled: boolean;
    approvalMode: "manual" | "auto" | "team" | string;
  };
  byStatus: Record<ParticipantStatus, number>;
  total: number;
  teamlessApproved: number;
  lookingForTeam: number;
  teams: number;
}

export interface BulkResult {
  changed: { id: number; from: string; to: string }[];
  skipped: { id: number; reason: "NOT_FOUND" | "UNCHANGED" | "CAPACITY_FULL" | string }[];
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function skills(v: unknown): string[] {
  let arr = v;
  if (typeof v === "string") {
    try { arr = JSON.parse(v); } catch { arr = v.split(","); }
  }
  return Array.isArray(arr) ? arr.map((s) => String(s).trim()).filter(Boolean) : [];
}

export function normalizeParticipant(raw: Record<string, unknown>): AdminParticipant {
  const status = String(raw.status ?? "pending").trim().toLowerCase();
  return {
    id: Number(raw.id),
    userId: Number(raw.user_id ?? 0),
    name: String(raw.full_name ?? "").trim() || "—",
    email: String(raw.email ?? ""),
    status: (PARTICIPANT_STATUSES as readonly string[]).includes(status) ? (status as ParticipantStatus) : "pending",
    teamId: raw.current_team_id != null ? Number(raw.current_team_id) : null,
    teamName: str(raw.team_name),
    isLead: raw.team_leader === true || (raw.team_leader == null && raw.is_team_lead === true && raw.current_team_id != null),
    looking: raw.looking_for_team === true,
    lookingNote: str(raw.looking_note),
    skills: skills(raw.skills),
    university: str(raw.university),
    experience: str(raw.experience),
    country: str(raw.country),
    phone: str(raw.phone),
    source: str(raw.ref_source),
    registeredAt: str(raw.registered_at),
    answers: raw.answers && typeof raw.answers === "object" ? (raw.answers as Record<string, unknown>) : {},
  };
}

export function normalizeParticipants(data: unknown): AdminParticipant[] {
  return Array.isArray(data)
    ? data.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object").map(normalizeParticipant)
    : [];
}

/** How a bulk result reads: counts of updated, skipped for capacity, skipped otherwise. */
export function bulkCounts(r: BulkResult) {
  return {
    updated: r.changed.length,
    full: r.skipped.filter((s) => s.reason === "CAPACITY_FULL").map((s) => s.id),
    other: r.skipped.filter((s) => s.reason !== "CAPACITY_FULL").length,
  };
}
