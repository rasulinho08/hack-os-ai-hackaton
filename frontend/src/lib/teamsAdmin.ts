/**
 * Teams as the organiser manages them: one shape for a row of the API's
 * list, the people who could still join a team, and the CSV round trip —
 * the export has one row per member (Team, Email, Name, Lead, …) and the
 * import reads the same columns back, so a sheet filled in by hand or
 * edited after an export becomes teams in one go.
 */

export type TeamStatus = "active" | "eliminated";

export interface AdminTeamMember {
  id: number;
  name: string;
  email: string;
  isLead: boolean;
}

export interface AdminTeam {
  id: number;
  name: string;
  joinCode: string;
  leaderId: number | null;
  status: TeamStatus;
  eliminationReason: string | null;
  recruiting: boolean;
  recruitingNote: string | null;
  wantedSkills: string[];
  createdAt: string | null;
  members: AdminTeamMember[];
}

/** An approved participant without a team (GET …/participants/unassigned). */
export interface Teamless {
  userId: number;
  name: string;
  email: string;
  skills: string[];
  looking: boolean;
  note: string | null;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function list(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed: unknown = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : v.split(",");
    } catch {
      return v.split(",");
    }
  }
  return [];
}

export const skillList = (v: unknown): string[] => list(v).map((s) => String(s ?? "").trim()).filter(Boolean);

export function normalizeTeam(raw: Record<string, unknown>): AdminTeam {
  const leaderRaw = raw.leader_id;
  const leaderId = leaderRaw == null || leaderRaw === "" ? null : Number(leaderRaw);
  const members = list(raw.members)
    .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object")
    .map((m) => ({
      id: Number(m.id),
      name: String(m.full_name ?? m.name ?? m.email ?? "").trim() || "—",
      email: String(m.email ?? ""),
      isLead: m.is_leader === true || (leaderId != null && Number(m.id) === leaderId),
    }))
    .filter((m) => Number.isFinite(m.id) && m.id > 0);
  return {
    id: Number(raw.id),
    name: String(raw.name ?? "").trim() || "—",
    joinCode: String(raw.join_code ?? ""),
    leaderId: leaderId != null && Number.isFinite(leaderId) ? leaderId : null,
    status: String(raw.status ?? "").trim().toLowerCase() === "eliminated" ? "eliminated" : "active",
    eliminationReason: str(raw.elimination_reason),
    recruiting: raw.recruiting === true,
    recruitingNote: str(raw.recruiting_note),
    wantedSkills: skillList(raw.wanted_skills),
    createdAt: str(raw.created_at),
    members,
  };
}

export function normalizeTeams(data: unknown): AdminTeam[] {
  return Array.isArray(data)
    ? data
        .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
        .map(normalizeTeam)
        .filter((t) => Number.isFinite(t.id) && t.id > 0)
    : [];
}

export function normalizeTeamless(data: unknown): Teamless[] {
  return Array.isArray(data)
    ? data
        .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
        .map((r) => ({
          userId: Number(r.user_id),
          name: String(r.full_name ?? "").trim() || String(r.email ?? ""),
          email: String(r.email ?? ""),
          skills: skillList(r.skills),
          looking: r.looking_for_team === true,
          note: str(r.looking_note),
        }))
        .filter((p) => Number.isFinite(p.userId) && p.userId > 0)
    : [];
}

export const leadOf = (team: AdminTeam) => team.members.find((m) => m.isLead) ?? null;

/** Column headers of the export, also the ones the import reads first. */
export const TEAM_CSV_HEADERS = ["Team", "Email", "Name", "Lead", "Status", "Join code", "Recruiting", "Looking for"] as const;

/** One row per member (a team without members still gets a row). */
export function teamsCsvRows(teams: AdminTeam[]): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  for (const team of teams) {
    const base = {
      Team: team.name,
      Status: team.status,
      "Join code": team.joinCode,
      Recruiting: team.recruiting ? "yes" : "",
      "Looking for": team.wantedSkills.join(", "),
    };
    if (!team.members.length) rows.push({ ...base, Email: "", Name: "", Lead: "" });
    for (const m of team.members) rows.push({ ...base, Email: m.email, Name: m.name, Lead: m.isLead ? "yes" : "" });
  }
  return rows;
}

const pick = (row: Record<string, string>, keys: string[]) => {
  for (const k of keys) {
    const hit = Object.keys(row).find((h) => h.trim().toLowerCase() === k.toLowerCase());
    const v = hit ? row[hit]?.trim() : "";
    if (v) return v;
  }
  return "";
};

const TEAM_KEYS = ["Team", "Team name", "Komanda", "Komanda adı", "Команда", "Название команды", "name"];
const EMAIL_KEYS = ["Email", "E-mail", "Member email", "E-poçt", "Почта", "email"];
const LEAD_KEYS = ["Lead", "Team lead", "Lider", "Kapitan", "Лидер", "Капитан"];
const YES = new Set(["yes", "y", "true", "1", "x", "✓", "bəli", "he", "hə", "да"]);

export interface TeamImportPlan {
  /** New teams with their members (user ids) and lead. */
  create: { name: string; memberIds: number[]; leaderId: number | null }[];
  /** People to add to teams that already exist. */
  add: { teamId: number; teamName: string; userIds: number[] }[];
  /** Addresses that could not be placed, and why. */
  skipped: { email: string; team: string; reason: "unknown" | "taken" | "twice" | "full" }[];
}

/**
 * What an import would do, before it does anything: rows are grouped by team
 * name (any case), addresses matched to approved participants without a
 * team, a person placed once, and no team filled past `maxSize`.
 */
export function planTeamImport(
  records: Record<string, string>[],
  ctx: { teams: AdminTeam[]; teamless: Teamless[]; maxSize: number },
): TeamImportPlan {
  const byEmail = new Map(ctx.teamless.map((p) => [p.email.trim().toLowerCase(), p]));
  const inTeam = new Set(ctx.teams.flatMap((t) => t.members.map((m) => m.email.trim().toLowerCase())));
  const existing = new Map(ctx.teams.map((t) => [t.name.trim().toLowerCase(), t]));
  const groups = new Map<string, { name: string; rows: { email: string; lead: boolean }[] }>();
  for (const row of records) {
    const name = pick(row, TEAM_KEYS);
    if (!name) continue;
    const key = name.toLowerCase();
    if (!groups.has(key)) groups.set(key, { name, rows: [] });
    const mail = pick(row, EMAIL_KEYS).toLowerCase();
    if (mail) groups.get(key)!.rows.push({ email: mail, lead: YES.has(pick(row, LEAD_KEYS).toLowerCase()) });
  }

  const placed = new Set<string>();
  const plan: TeamImportPlan = { create: [], add: [], skipped: [] };
  for (const [key, g] of groups) {
    const target = existing.get(key);
    let room = Math.max(0, ctx.maxSize - (target ? target.members.length : 0));
    const ids: number[] = [];
    let leaderId: number | null = null;
    for (const r of g.rows) {
      if (placed.has(r.email)) {
        plan.skipped.push({ email: r.email, team: g.name, reason: "twice" });
        continue;
      }
      if (target?.members.some((m) => m.email.trim().toLowerCase() === r.email)) {
        placed.add(r.email);
        continue; // already there: nothing to do
      }
      const person = byEmail.get(r.email);
      if (!person) {
        plan.skipped.push({ email: r.email, team: g.name, reason: inTeam.has(r.email) ? "taken" : "unknown" });
        continue;
      }
      if (room <= 0) {
        plan.skipped.push({ email: r.email, team: g.name, reason: "full" });
        continue;
      }
      placed.add(r.email);
      room -= 1;
      ids.push(person.userId);
      if (r.lead && leaderId == null) leaderId = person.userId;
    }
    if (target) {
      if (ids.length) plan.add.push({ teamId: target.id, teamName: target.name, userIds: ids });
    } else {
      plan.create.push({ name: g.name, memberIds: ids, leaderId: leaderId ?? ids[0] ?? null });
    }
  }
  return plan;
}
