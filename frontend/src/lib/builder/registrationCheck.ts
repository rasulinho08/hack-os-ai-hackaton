/**
 * The registration form's own checks, run before anything is sent so people
 * read what to fix in the page's language. They mirror the API's rules
 * (src/services/eventRegistration.service.js and registrationForm.service.js
 * in the backend), which stay the authority: whatever slips past here is
 * refused there.
 */

import type { Eligibility } from "./types";
import type { PublicField } from "./public";

export type EntryType = "solo" | "lead" | "member";

/** A problem as a translation key plus the values its sentence needs. */
export interface Problem { key: string; params?: Record<string, string | number> }

export interface RegistrationInput {
  form: PublicField[];
  eligibility: Eligibility;
  signedIn: boolean;
  account: { fullName: string; email: string; password: string };
  entry: { type: EntryType; teamName: string; teamCode: string };
  answers: Record<string, unknown>;
  accept: { rules: boolean; coc: boolean };
  /** A personal invitation puts the person in a team that exists: "join" needs no code. */
  invitedTeam?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TRANSLIT: Record<string, string> = {
  ə: "e", ı: "i", ş: "s", ç: "c", ğ: "g", ö: "o", ü: "u",
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k",
  л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** "Bakı" and "Baki" are the same city; so are "Гянджа" and "gyandzha". */
export function normaliseCity(s: string): string {
  return String(s || "")
    .replace(/İ/g, "i")
    .toLowerCase()
    .split("")
    .map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch))
    .join("")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The link the API would store, or undefined when it is not one. */
export function normaliseLink(value: string, key: string): string | null | undefined {
  let s = String(value || "").trim();
  if (!s) return null;
  if (key === "github" && !/[./]/.test(s.replace(/^@/, ""))) s = `https://github.com/${s.replace(/^@/, "")}`;
  if (key === "linkedin" && !/[./]/.test(s)) s = `https://www.linkedin.com/in/${s}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  let u: URL;
  try { u = new URL(s); } catch { return undefined; }
  if (!["http:", "https:"].includes(u.protocol) || !u.hostname.includes(".")) return undefined;
  return u.toString();
}

export function isEmpty(type: string, v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) || (type === "checkbox" && v !== true);
}

function checkValue(fl: PublicField, raw: unknown): Problem | null {
  switch (fl.type) {
    case "text":
    case "textarea": {
      const max = fl.type === "textarea" ? 5000 : 500;
      return String(raw).trim().length > max ? { key: "rg.err.too_long", params: { max } } : null;
    }
    case "number": {
      const n = Number(raw);
      const min = fl.min ?? -1e9;
      const max = fl.max ?? 1e9;
      if (!Number.isFinite(n) || n < min || n > max || (fl.kind === "standard" && !Number.isInteger(n))) {
        return { key: "rg.err.number", params: { min, max } };
      }
      return null;
    }
    case "phone": {
      const s = String(raw).trim();
      const digits = s.replace(/\D/g, "");
      return !/^\+?[0-9 ()-]{7,24}$/.test(s) || digits.length < 7 || digits.length > 15 ? { key: "rg.err.phone" } : null;
    }
    case "email": {
      const s = String(raw).trim();
      return !EMAIL_RE.test(s) || s.length > 255 ? { key: "rg.err.email" } : null;
    }
    case "url":
      return normaliseLink(String(raw), fl.key) === undefined ? { key: "rg.err.url" } : null;
    case "select":
      return fl.options.includes(String(raw)) ? null : { key: "rg.err.option" };
    case "multiselect": {
      const list = Array.isArray(raw) ? raw.map(String) : [];
      return !list.length || list.some((x) => !fl.options.includes(x)) ? { key: "rg.err.option" } : null;
    }
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(String(raw).trim()) && !Number.isNaN(new Date(`${String(raw).trim()}T00:00:00Z`).getTime()) ? null : { key: "rg.err.date" };
    case "country":
      return /^[A-Z]{2}$/.test(String(raw).trim().toUpperCase()) ? null : { key: "rg.err.country" };
    case "university": {
      const s = String(raw || "").trim();
      return !s || s.length > 200 ? { key: "rg.err.university" } : null;
    }
    case "skills": {
      const list = Array.isArray(raw) ? raw.map(String) : [];
      return list.length > 30 || list.some((x) => x.length > 40) ? { key: "rg.err.skills" } : null;
    }
    case "file": {
      const f = raw as { fileId?: string; claimToken?: string } | null;
      return !f || typeof f !== "object" || !f.fileId || !f.claimToken ? { key: "rg.err.file_again" } : null;
    }
    default:
      return null;
  }
}

/** Every problem with what someone filled in, keyed like the API's field errors. */
export function checkRegistration(input: RegistrationInput): Record<string, Problem> {
  const out: Record<string, Problem> = {};
  const { account, entry, answers, accept, eligibility: e } = input;

  if (!input.signedIn) {
    const name = account.fullName.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 200) out["account.fullName"] = { key: "rg.err.name" };
    else if (/[<>]/.test(name)) out["account.fullName"] = { key: "rg.err.no_brackets" };
    const email = account.email.trim();
    if (!EMAIL_RE.test(email) || email.length > 255) out["account.email"] = { key: "rg.err.email" };
    if (account.password.length < 8 || account.password.length > 128) out["account.password"] = { key: "rg.err.password" };
    else if (!/\d/.test(account.password)) out["account.password"] = { key: "rg.err.password_digit" };
  }

  if (entry.type === "lead") {
    const name = entry.teamName.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 80) out["entry.teamName"] = { key: "rg.err.team_name" };
    else if (/[<>]/.test(name)) out["entry.teamName"] = { key: "rg.err.no_brackets" };
  }
  // An invitation that names an existing team joins it without a code.
  const joinsInvitedTeam = Boolean(input.invitedTeam) && !entry.teamCode.trim();
  if (entry.type === "member" && !joinsInvitedTeam && !/^[A-Za-z0-9]{4,20}$/.test(entry.teamCode.trim())) {
    out["entry.teamCode"] = { key: "rg.err.team_code" };
  }

  const byKey: Record<string, unknown> = {};
  for (const fl of input.form) {
    const field = `answers.${fl.key}`;
    const raw = answers[fl.key];
    if (isEmpty(fl.type, raw)) {
      if (fl.required) out[field] = { key: fl.type === "checkbox" ? "rg.err.confirm" : "rg.err.required" };
      continue;
    }
    const problem = checkValue(fl, raw);
    if (problem) { out[field] = problem; continue; }
    byKey[fl.key] = fl.type === "number" ? Number(raw) : raw;
  }

  // Who may take part, judged on the answers above.
  if (e.minAge != null || e.maxAge != null) {
    const age = byKey.age as number | undefined;
    if (age == null) out["answers.age"] ??= { key: "rg.err.required" };
    else if ((e.minAge != null && age < e.minAge) || (e.maxAge != null && age > e.maxAge)) {
      out["answers.age"] = e.minAge != null && e.maxAge != null
        ? { key: "rg.err.age_between", params: { min: e.minAge, max: e.maxAge } }
        : e.minAge != null
          ? { key: "rg.err.age_min", params: { min: e.minAge } }
          : { key: "rg.err.age_max", params: { max: e.maxAge as number } };
    }
  }
  if (e.countries?.length) {
    const c = byKey.country as string | undefined;
    if (!c) out["answers.country"] ??= { key: "rg.err.required" };
    else if (!e.countries.includes(String(c).toUpperCase())) out["answers.country"] = { key: "rg.err.country_not_open" };
  }
  if (e.cities?.length && byKey.city !== undefined) {
    if (!e.cities.map(normaliseCity).includes(normaliseCity(String(byKey.city)))) {
      out["answers.city"] = { key: "rg.err.city_not_open", params: { cities: e.cities.join(", ") } };
    }
  }
  if (e.studentsOnly && !byKey.university) out["answers.university"] ??= { key: "rg.err.students_only" };

  if (e.requireRules && !accept.rules) out["accept.rules"] = { key: "rg.err.rules" };
  if (e.requireCoc && !accept.coc) out["accept.coc"] = { key: "rg.err.coc" };
  return out;
}

/** Registration refusals with a sentence of their own in each language (rg.api.*). */
export const REGISTER_CODES = new Set([
  "EMAIL_TAKEN", "ALREADY_REGISTERED", "ALREADY_STAFF", "EVENT_FULL", "REGISTRATION_CLOSED", "REGISTRATION_NOT_OPEN",
  "TEAM_FORMATION_CLOSED", "TEAM_FORMATION_CLOSED_SOLO", "TEAM_NOT_FOUND", "TEAM_FULL", "TEAM_ELIMINATED", "NOT_FOUND", "RATE_LIMITED", "FILE_NOT_FOUND",
  "INVITE_ONLY", "INVITE_EXPIRED", "INVITE_REVOKED", "INVITE_USED", "INVITE_EMAIL_MISMATCH", "INVALID_INVITE_TOKEN",
]);

/** Upload refusals with a sentence of their own (rg.file.*). */
export const FILE_CODES = new Set(["FILE_TOO_LARGE", "FILE_TYPE_NOT_ALLOWED", "EMPTY_FILE", "STORAGE_FULL", "PLAN_STORAGE_FULL", "RATE_LIMITED"]);

/** Field errors the API raises together with these codes. */
export const CODE_FIELDS: Record<string, string> = {
  EMAIL_TAKEN: "account.email",
  INVITE_EMAIL_MISMATCH: "account.email",
  TEAM_NOT_FOUND: "entry.teamCode",
  TEAM_FULL: "entry.teamCode",
  TEAM_ELIMINATED: "entry.teamCode",
};

/** Whether teams can still be created or joined (the API's registration.teamFormation). */
export interface TeamFormation {
  open: boolean;
  closesAt: string | null;
  /** "deadline": the team deadline passed; "disabled": the organisers form the teams. */
  reason: "deadline" | "disabled" | null;
  minTeamSize: number;
  /** false: alone now, a person could never join a team, so never hand in a project. */
  soloCanCompete: boolean;
}

/**
 * What the form offers about teams. While team formation is open, the
 * event's own choice (alone, create a team, join one). Once it closed, only
 * "on my own" — and nothing at all where a person on their own could not
 * take part (teams of two or more after the deadline, or a teams-only
 * event): the API refuses those registrations, so the page says so first.
 */
export function entryOptions(event: {
  registration_mode: "solo" | "team" | "both";
  registration?: { teamFormation?: TeamFormation | null } | null;
}): { allowed: EntryType[]; closed: TeamFormation | null; blocked: null | "solo_cannot_compete" | "teams_only" } {
  const base: EntryType[] = event.registration_mode === "solo" ? ["solo"] : event.registration_mode === "team" ? ["lead", "member"] : ["solo", "lead", "member"];
  const tf = event.registration?.teamFormation ?? null;
  if (!tf || tf.open) return { allowed: base, closed: null, blocked: null };
  const allowed = base.filter((x) => x === "solo");
  if (!allowed.length) return { allowed, closed: tf, blocked: "teams_only" };
  if (!tf.soloCanCompete) return { allowed: [], closed: tf, blocked: "solo_cannot_compete" };
  return { allowed, closed: tf, blocked: null };
}
