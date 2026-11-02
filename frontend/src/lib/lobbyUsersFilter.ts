/**
 * Team lobby: only hackers who registered solo (not as team lead with a new team).
 * Aligns with dashboard participants: is_solo, is_team_lead, team_id.
 */

export interface LobbyUserNormalized {
  id: number;
  full_name: string;
  email?: string;
  skills: string[];
  status: string;
  /** Hackathon / team role preference (e.g. Frontend, Backend). */
  role?: string;
  /** Account role from `users.role` (e.g. hacker, pending). */
  account_role?: string;
  participant_status?: string;
  is_solo?: boolean;
  experience?: string;
  country?: string;
  university?: string;
  timezone?: string;
  attendance_mode?: string;
  linkedin?: string;
  github_link?: string;
}

function record(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object"
    ? (raw as Record<string, unknown>)
    : null;
}

function truthyFlag(v: unknown): boolean {
  if (v === true || v === 1 || v === "1") return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "t" || s === "yes") return true;
  }
  return false;
}

function falsyFlag(v: unknown): boolean {
  if (v === false || v === 0 || v === "0") return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "false" || s === "f" || s === "no") return true;
  }
  return false;
}

/** True if this row should appear in solo-hacker lobby. */
export function isSoloHackerLobbyRow(o: Record<string, unknown>): boolean {
  if (falsyFlag(o.is_solo) || falsyFlag(o.isSolo)) return false;
  if (truthyFlag(o.is_solo) || truthyFlag(o.isSolo)) return true;
  if (o.solo_registration === true || o.soloRegistration === true) return true;
  const rt = String(
    o.registration_type ?? o.registrationType ?? ""
  ).toLowerCase();
  if (rt === "solo") return true;

  const isLead =
    o.is_team_lead === true ||
    o.isTeamLead === true ||
    truthyFlag(o.is_team_lead) ||
    truthyFlag(o.isTeamLead);
  if (isLead) return false;

  const tid = Number(o.team_id ?? o.teamId ?? 0);
  if (Number.isFinite(tid) && tid > 0) return false;

  const teamName = String(o.team ?? o.team_name ?? o.teamName ?? "").trim();
  if (teamName.length > 0) return false;

  return true;
}

export function isHackerRoleRow(o: Record<string, unknown>): boolean {
  const r = String(
    o.role ?? o.account_role ?? o.accountRole ?? ""
  )
    .toLowerCase()
    .trim();
  return r === "" || r === "hacker" || r === "pending";
}

export function normalizeLobbyUserRaw(raw: unknown): LobbyUserNormalized | null {
  const o = record(raw);
  if (!o) return null;
  const id = Number(o.user_id ?? o.userId ?? o.id);
  if (!Number.isFinite(id) || id <= 0) return null;

  const full_name =
    String(o.full_name ?? o.fullName ?? o.name ?? "").trim() || "Member";

  let skills: string[] = [];
  const skillsRaw = o.skills;
  if (Array.isArray(skillsRaw)) {
    skills = skillsRaw.map((x) => String(x)).filter(Boolean);
  } else if (typeof skillsRaw === "string" && skillsRaw.trim()) {
    try {
      const p = JSON.parse(skillsRaw) as unknown;
      if (Array.isArray(p)) skills = p.map(String).filter(Boolean);
      else
        skills = skillsRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
    } catch {
      skills = skillsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  const participantStatus = String(
    o.participant_status ?? o.participantStatus ?? ""
  ).trim();

  const status =
    String(o.status ?? o.lobby_status ?? o.lobbyStatus ?? "").trim() ||
    (participantStatus
      ? participantStatus.charAt(0).toUpperCase() +
        participantStatus.slice(1).toLowerCase()
      : "") ||
    "Looking for Team";

  const email = String(o.email ?? "").trim() || undefined;

  const role =
    String(o.role_preference ?? o.rolePreference ?? "").trim() || undefined;
  const accountRole =
    String(o.account_role ?? o.accountRole ?? "").trim() || undefined;
  const experience =
    String(o.experience ?? "").trim() || undefined;
  const country = String(o.country ?? "").trim() || undefined;
  const university = String(o.university ?? "").trim() || undefined;
  const timezone = String(o.timezone ?? "").trim() || undefined;
  const attendance_mode =
    String(o.attendance_mode ?? o.attendanceMode ?? "").trim() || undefined;
  const linkedin = String(o.linkedin ?? "").trim() || undefined;
  const github_link =
    String(o.github_link ?? o.githubLink ?? o.github ?? "").trim() ||
    undefined;

  const isSoloRaw = o.is_solo ?? o.isSolo;
  const is_solo =
    typeof isSoloRaw === "boolean" ? isSoloRaw : undefined;

  return {
    id,
    full_name,
    email,
    skills,
    status,
    role,
    account_role: accountRole,
    participant_status: participantStatus || undefined,
    is_solo,
    experience,
    country,
    university,
    timezone,
    attendance_mode,
    linkedin,
    github_link,
  };
}

export function dedupeLobbyUsersById(
  rows: LobbyUserNormalized[]
): LobbyUserNormalized[] {
  const seen = new Set<number>();
  const out: LobbyUserNormalized[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

export function filterSoloHackersForLobby(
  list: unknown[]
): LobbyUserNormalized[] {
  const out: LobbyUserNormalized[] = [];
  for (const raw of list) {
    const o = record(raw);
    if (!o) continue;
    if (!isHackerRoleRow(o)) continue;
    if (!isSoloHackerLobbyRow(o)) continue;
    const n = normalizeLobbyUserRaw(raw);
    if (n) out.push(n);
  }
  return dedupeLobbyUsersById(out);
}

/**
 * Rows from `GET /api/events/:eventId/participants/lobby-hackers`.
 * Client-side solo filter + id coercion keeps the lobby aligned when the
 * API returns mixed rows or numeric boolean fields from Postgres.
 */
export function mapLobbyHackersFromApi(list: unknown[]): LobbyUserNormalized[] {
  return filterSoloHackersForLobby(Array.isArray(list) ? list : []);
}
