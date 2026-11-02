import { normalizeAzerbaijanPhoneInput } from "@/lib/azPhoneAge";

/**
 * Normalizes GET /api/auth/me (and similar) into the shape the hacker profile UI uses.
 * Handles both snake_case and camelCase so data survives navigation after save.
 */

export interface UserProfileNormalized {
  id: number;
  email: string;
  full_name: string;
  first_name: string;
  last_name: string;
  age: number;
  phone: string;
  country: string;
  timezone: string;
  attendance_mode: string;
  linkedin: string;
  github: string;
  experience: string;
  skills: string[];
  university: string;
  cohort: string;
  is_team_lead: boolean;
  dietary: string;
  tshirt_size: string;
  motivation: string;
  how_heard: string;
  role: string;
  registered_at: string;
}

function str(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (v != null && v !== "") return String(v).trim();
  }
  return "";
}

export function normalizeUserFromApi(raw: unknown): UserProfileNormalized | null {
  if (!raw || typeof raw !== "object") return null;
  let o = raw as Record<string, unknown>;
  let id = Number(o.id);
  if (!Number.isFinite(id) || id <= 0) {
    const inner = o.user ?? o.data ?? o.profile;
    if (inner && typeof inner === "object") {
      o = inner as Record<string, unknown>;
      id = Number(o.id);
    }
  }
  if (!Number.isFinite(id) || id <= 0) return null;

  const first = str(o, "first_name", "firstName");
  const last = str(o, "last_name", "lastName");
  let full = str(o, "full_name", "fullName");
  if (!full) full = [first, last].filter(Boolean).join(" ").trim();

  const first_name = first || (full ? full.split(/\s+/)[0] : "") || "";
  const last_name =
    last || (full ? full.split(/\s+/).slice(1).join(" ") : "") || "";

  const skillsRaw = o.skills ?? o.skill_list;
  let skills: string[] = [];
  if (Array.isArray(skillsRaw)) {
    skills = skillsRaw.map((x) => String(x)).filter(Boolean);
  } else if (typeof skillsRaw === "string" && skillsRaw.trim()) {
    try {
      const parsed = JSON.parse(skillsRaw) as unknown;
      if (Array.isArray(parsed)) skills = parsed.map(String);
      else skills = skillsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    } catch {
      skills = skillsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  const attendance = String(
    o.attendance_mode ?? o.attendanceMode ?? "online"
  ).toLowerCase();

  const github = str(o, "github", "github_link", "githubLink");

  return {
    id,
    email: str(o, "email"),
    full_name: full || `${first_name} ${last_name}`.trim(),
    first_name,
    last_name,
    age: Math.max(0, Number(o.age ?? o.age_years ?? 0) || 0),
    phone: normalizeAzerbaijanPhoneInput(
      str(o, "phone", "phone_number", "phoneNumber")
    ),
    country: str(o, "country", "country_code"),
    timezone: str(o, "timezone", "time_zone", "timeZone"),
    attendance_mode: attendance === "offline" ? "offline" : "online",
    linkedin: str(o, "linkedin", "linked_in", "linkedIn"),
    github,
    experience: str(o, "experience") || "beginner",
    skills,
    university: str(o, "university", "university_name"),
    cohort: str(o, "cohort"),
    is_team_lead: Boolean(o.is_team_lead ?? o.isTeamLead),
    dietary: str(o, "dietary") || "Yoxdur",
    tshirt_size: str(o, "tshirt_size", "tshirtSize") || "M",
    motivation: str(o, "motivation"),
    how_heard: str(o, "how_heard", "howHeard"),
    role: str(o, "role") || "Developer",
    registered_at: str(o, "registered_at", "registeredAt", "created_at"),
  };
}

/** Body for PATCH /api/users/:id — snake_case + common aliases backends expect */
export function buildUserPatchPayload(
  edit: Partial<UserProfileNormalized>,
  base: UserProfileNormalized
): Record<string, unknown> {
  const m: UserProfileNormalized = { ...base, ...edit };
  // Prefer first+last (what the profile form edits). Using stale `m.full_name`
  // here kept `users.full_name` unchanged in the DB while the UI showed the new
  // name — e.g. My Team reads `users.full_name` and stayed out of date.
  const fromParts = [m.first_name, m.last_name]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  const full_name = fromParts || m.full_name.trim();

  return {
    first_name: m.first_name,
    last_name: m.last_name,
    full_name,
    age: m.age,
    phone: normalizeAzerbaijanPhoneInput(m.phone || ""),
    country: m.country,
    timezone: m.timezone,
    attendance_mode: m.attendance_mode,
    linkedin: m.linkedin,
    github: m.github,
    github_link: m.github,
    experience: m.experience,
    skills: m.skills,
    university: m.university,
    cohort: m.cohort,
    dietary: m.dietary,
    tshirt_size: m.tshirt_size,
    motivation: m.motivation,
    how_heard: m.how_heard,
    role: m.role,
  };
}
