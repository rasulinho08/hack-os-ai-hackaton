import type { Participant } from "@/types/participant";

/** Map API participant row (camelCase or snake_case) → app Participant for analytics. */
export function normalizeParticipantFromApi(raw: unknown): Participant | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = Number(r.id);
  if (!Number.isFinite(id)) return null;

  const exp = String(r.experience ?? "beginner").toLowerCase();
  const experience: Participant["experience"] =
    exp === "intermediate" || exp === "advanced" || exp === "expert"
      ? exp
      : "beginner";

  const statusRaw = String(r.status ?? "pending").toLowerCase();
  const status: Participant["status"] =
    statusRaw === "approved" || statusRaw === "rejected" ? statusRaw : "pending";

  const att = String(
    r.attendance_mode ?? r.attendanceMode ?? "online"
  ).toLowerCase();
  const attendanceMode: Participant["attendanceMode"] =
    att === "offline" ? "offline" : "online";

  const skillsRaw = r.skills;
  const skills = Array.isArray(skillsRaw)
    ? skillsRaw.map((s) => String(s)).filter(Boolean)
    : [];

  const full = String(r.full_name ?? r.fullName ?? "").trim();
  const nameParts = full.split(/\s+/);

  return {
    id: String(id),
    firstName: nameParts[0] || "",
    lastName: nameParts.slice(1).join(" ") || "",
    email: String(r.email ?? ""),
    age: Number(r.age ?? 0) || 0,
    phone: String(r.phone ?? ""),
    country: String(r.country ?? r.country_code ?? "").trim(),
    timezone: String(r.timezone ?? ""),
    attendanceMode,
    linkedIn: String(r.linked_in ?? r.linkedIn ?? ""),
    github: String(r.github ?? r.github_link ?? ""),
    experience,
    skills,
    role: String(r.role ?? "Developer"),
    university: String(r.university ?? r.university_name ?? "").trim(),
    cohort: String(r.cohort ?? ""),
    dietary: String(r.dietary ?? "Yoxdur"),
    tshirtSize: String(r.tshirt_size ?? r.tshirtSize ?? "M"),
    motivation: String(r.motivation ?? ""),
    howHeard: String(r.how_heard ?? r.howHeard ?? ""),
    isTeamLead: Boolean(r.is_team_lead ?? r.isTeamLead),
    isSolo: Boolean(r.is_solo ?? r.isSolo),
    team: String(r.team ?? r.team_name ?? "").trim(),
    status,
    registeredAt: String(
      r.registered_at ?? r.registeredAt ?? new Date().toISOString()
    ),
  };
}

export interface NormalizedTeam {
  id: number;
  name: string;
  memberCount: number;
  projectStatus: string;
}

export function normalizeTeamFromApi(raw: unknown): NormalizedTeam | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = Number(r.id);
  if (!Number.isFinite(id)) return null;
  const members = r.members;
  const memberCount = Array.isArray(members)
    ? members.length
    : Math.max(
        0,
        Number(r.member_count ?? r.members_count ?? r.memberCount ?? 0)
      );
  const ps = String(
    r.project_status ?? r.projectStatus ?? r.submission_status ?? ""
  ).toLowerCase();
  return {
    id,
    name: String(r.name ?? "").trim() || `Team ${id}`,
    memberCount,
    projectStatus: ps || "none",
  };
}

export interface NormalizedSubmission {
  id: number;
  status: string;
  submittedAt: string;
  /** Which team handed this in — the only link back from a submission. */
  teamId: number | null;
}

export function normalizeSubmissionFromApi(raw: unknown): NormalizedSubmission | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = Number(r.id);
  if (!Number.isFinite(id)) return null;
  const submittedAt = String(
    r.submitted_at ?? r.submittedAt ?? r.created_at ?? r.updated_at ?? ""
  );
  return {
    teamId: Number.isFinite(Number(r.team_id ?? r.teamId))
      ? Number(r.team_id ?? r.teamId)
      : null,
    id,
    status: String(r.status ?? "submitted").toLowerCase(),
    submittedAt,
  };
}

export interface NormalizedFeedback {
  rating: number;
}

export function normalizeFeedbackFromApi(raw: unknown): NormalizedFeedback | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const rating = Number(r.rating ?? r.score ?? r.stars ?? NaN);
  if (!Number.isFinite(rating) || rating <= 0) return null;
  return { rating };
}
