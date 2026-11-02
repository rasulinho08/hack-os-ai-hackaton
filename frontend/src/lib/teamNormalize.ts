/** Normalizes GET /api/teams/mine for hacker dashboard & team page. */

export interface NormalizedTeamMember {
  id: number;
  full_name: string;
  role?: string;
  is_lead?: boolean;
  /** Whether the organisers accepted them in the team's event (approved, pending, waitlisted, rejected…), when the API says. */
  status?: string;
}

export interface NormalizedTeamMine {
  id: number;
  name: string;
  members: NormalizedTeamMember[];
  /** Team invite token from API — often a UUID; not valid for GET /api/events/:code */
  join_code: string;
  /** Event slug for /join/:eventCode when returned on team payload */
  event_code?: string;
  /** Max members for this team's event (from GET /api/teams/mine joined row). */
  team_size_limit?: number;
  /** Numeric event id for this team (teams.event_id). */
  event_id?: number;
}

/**
 * Join page uses GET /api/events/:code — only event slugs work (e.g. CYBER2025).
 * Team join_code is often a hex token / UUID; those must not be used as the path segment.
 */
function userRecord(
  mm: Record<string, unknown>,
): Record<string, unknown> | null {
  const u = mm.user ?? mm.User;
  return u && typeof u === "object" ? (u as Record<string, unknown>) : null;
}

function participantRecord(
  mm: Record<string, unknown>,
): Record<string, unknown> | null {
  const p =
    mm.participant ??
    mm.Participant ??
    mm.hacker ??
    mm.Hacker ??
    mm.profile ??
    mm.Profile;
  return p && typeof p === "object" ? (p as Record<string, unknown>) : null;
}

/** Safe boolean for DB / JSON (`'f'` must not become true via Boolean()). */
function coerceLeaderFlag(v: unknown): boolean {
  if (v === true || v === 1 || v === "1") return true;
  if (v === false || v === 0 || v === "0") return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "t" || s === "true" || s === "yes") return true;
    if (s === "f" || s === "false" || s === "no") return false;
  }
  return false;
}

/** One roster row from `GET /api/teams/mine` or `GET /api/teams/:id/members`. */
export function normalizeTeamMemberRow(m: unknown): NormalizedTeamMember | null {
  if (m == null || typeof m !== "object") return null;
  const mm = m as Record<string, unknown>;
  const nested = userRecord(mm);
  const part = participantRecord(mm);
  const mid = Number(
    mm.user_id ??
      mm.userId ??
      nested?.id ??
      nested?.user_id ??
      nested?.userId ??
      part?.user_id ??
      part?.userId ??
      part?.id ??
      mm.id ??
      0,
  );
  const fn = String(
    mm.full_name ??
      mm.fullName ??
      mm.name ??
      nested?.full_name ??
      nested?.fullName ??
      nested?.name ??
      part?.full_name ??
      part?.fullName ??
      part?.name ??
      mm.email ??
      nested?.email ??
      part?.email ??
      "",
  ).trim();
  const leadFlag =
    mm.is_leader ??
    mm.isLeader ??
    mm.is_lead ??
    mm.isLead ??
    mm.is_team_lead ??
    mm.isTeamLead;
  const isLead = coerceLeaderFlag(leadFlag);
  const accountRole = String(
    mm.role ?? nested?.role ?? part?.role ?? "",
  ).trim();
  const displayRole = isLead ? "Team Lead" : accountRole || undefined;
  if (!Number.isFinite(mid) || mid <= 0) return null;
  const rawStatus = String(mm.participant_status ?? mm.participantStatus ?? part?.status ?? "").trim().toLowerCase();
  return {
    id: mid,
    full_name: fn || "—",
    role: displayRole,
    is_lead: isLead,
    ...(rawStatus ? { status: rawStatus } : {}),
  };
}

function applyLeaderFallback(
  members: NormalizedTeamMember[],
  explicitLeaderId: number,
): void {
  if (
    members.length === 0 ||
    members.some((mem) => mem.is_lead) ||
    !Number.isFinite(explicitLeaderId) ||
    explicitLeaderId <= 0
  ) {
    return;
  }
  for (const mem of members) {
    if (mem.id === explicitLeaderId) {
      mem.is_lead = true;
      mem.role = "Team Lead";
    }
  }
}

/** Reads `leader_id` from `GET /api/teams/mine` (flat or nested `team`). */
export function extractLeaderIdFromTeamPayload(raw: unknown): number {
  if (raw == null || typeof raw !== "object") return NaN;
  const o = raw as Record<string, unknown>;
  const nested =
    o.team && typeof o.team === "object"
      ? (o.team as Record<string, unknown>)
      : o.data && typeof o.data === "object"
        ? (o.data as Record<string, unknown>)
        : o;
  return Number(
    nested.leader_id ??
      nested.leaderId ??
      nested.lead_user_id ??
      nested.leadUserId ??
      NaN,
  );
}

export function normalizeMembersFromPayload(
  membersRaw: unknown,
  explicitLeaderId: number,
): NormalizedTeamMember[] {
  const arr = Array.isArray(membersRaw) ? membersRaw : [];
  if (arr.length === 0) return [];

  const members: NormalizedTeamMember[] = [];
  for (const m of arr) {
    const row = normalizeTeamMemberRow(m);
    if (row) members.push(row);
  }
  applyLeaderFallback(members, explicitLeaderId);
  return members;
}

export function isPlausibleEventSlugForJoinRoute(slug: string): boolean {
  const s = slug.trim();
  if (s.length < 2) return false;
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  ) {
    return false;
  }
  if (/^[0-9a-f]{32}$/i.test(s)) return false;
  // Short hex-only tokens (e.g. f95e0cce) are team secrets, not event codes
  if (/^[0-9a-f]+$/i.test(s) && s.length >= 6) return false;
  return true;
}

export function normalizeTeamMine(raw: unknown): NormalizedTeamMine | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = Number(o.id ?? o.team_id ?? o.teamId);
  if (!Number.isFinite(id) || id <= 0) {
    const nested = o.team ?? o.data;
    if (nested && typeof nested === "object") {
      return normalizeTeamMine(nested);
    }
    return null;
  }

  const name = String(o.name ?? o.team_name ?? o.teamName ?? "").trim();

  const explicitLeaderId = Number(
    o.leader_id ?? o.leaderId ?? o.lead_user_id ?? o.leadUserId ?? NaN,
  );

  let membersRaw: unknown =
    o.members ??
    o.team_members ??
    o.teamMembers ??
    o.roster ??
    o.participants;
  if (typeof membersRaw === "string") {
    try {
      membersRaw = JSON.parse(membersRaw) as unknown;
    } catch {
      membersRaw = [];
    }
  }
  const members = normalizeMembersFromPayload(membersRaw, explicitLeaderId);

  const nestedEvent =
    o.event && typeof o.event === "object"
      ? (o.event as Record<string, unknown>)
      : null;

  const joinCode =
    String(
      o.join_code ??
        o.joinCode ??
        o.invite_code ??
        o.inviteCode ??
        o.team_join_code ??
        o.teamJoinCode ??
        o.code ??
        ""
    ).trim();

  const eventCodeFromPayload =
    String(
      nestedEvent?.event_code ??
        nestedEvent?.eventCode ??
        o.event_code ??
        o.eventCode ??
        ""
    ).trim();

  const rawLimit =
    o.team_size_limit ??
    o.teamSizeLimit ??
    nestedEvent?.team_size_limit ??
    nestedEvent?.teamSizeLimit;
  const parsedLimit =
    rawLimit === undefined || rawLimit === null || rawLimit === ""
      ? NaN
      : Number(rawLimit);
  const team_size_limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;

  const rawEventId =
    o.event_id ?? o.eventId ?? nestedEvent?.id ?? nestedEvent?.event_id;
  const parsedEventId = Number(rawEventId);
  const event_id =
    Number.isFinite(parsedEventId) && parsedEventId > 0
      ? parsedEventId
      : undefined;

  return {
    id,
    name: name || `Team #${id}`,
    members,
    join_code: joinCode,
    ...(eventCodeFromPayload ? { event_code: eventCodeFromPayload } : {}),
    ...(team_size_limit != null ? { team_size_limit } : {}),
    ...(event_id != null ? { event_id } : {}),
  };
}

/** True if the user has a team record from the API (even solo in that team). */
export function hasTeamRecord(team: NormalizedTeamMine | null): boolean {
  return team != null && Number(team.id) > 0;
}

/**
 * Whether the person asking may hand in the team's project, from GET
 * /api/teams/mine: "lead" (the approved lead), "member" (an approved member,
 * because the lead is not an approved participant), or "none". An older API
 * without can_submit leaves it to the lead alone.
 */
export function submitRight(raw: unknown, isLead: boolean): "lead" | "member" | "none" {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const team = r && r.team && typeof r.team === "object" ? (r.team as Record<string, unknown>) : r;
  if (typeof team?.can_submit !== "boolean") return isLead ? "lead" : "none";
  if (!team.can_submit) return "none";
  return team.submit_as_lead === false ? "member" : "lead";
}

/**
 * How a member is shown in the team's list, in words people use: the team
 * lead or a member (never the account's role, "hacker"), and — when the
 * organisers have not accepted them — why they do not count yet.
 */
export function memberLabel(m: Pick<NormalizedTeamMember, "is_lead" | "status">): { roleKey: string; statusKey: string | null } {
  const roleKey = m.is_lead ? "hacker.my_team.role_lead" : "hacker.my_team.role_member";
  const s = (m.status || "").toLowerCase();
  const statusKey = !s || s === "approved" || s === "eliminated" ? null
    : s === "waitlisted" ? "hacker.my_team.status_waitlisted"
      : s === "rejected" ? "hacker.my_team.status_rejected"
        : "hacker.my_team.status_pending";
  return { roleKey, statusKey };
}
