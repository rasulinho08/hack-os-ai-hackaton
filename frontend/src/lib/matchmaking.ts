/**
 * Finding a team, as the participant sees it: GET /api/events/:id/matchmaking
 * answers in one of two modes — `solo` (teams with room and other people
 * looking, ranked for the caller) or `team` (people to invite, ranked for
 * the caller's team) — plus whether teams can still change.
 *
 * Every suggestion carries the skills behind it (`matched`: what the other
 * side asked for; `brings`: what nobody there has yet), so the page can say
 * why it was suggested.
 */

import { ApiError } from "@/lib/api";

export interface Formation {
  open: boolean;
  closesAt: string | null;
}

export interface MmTeam {
  id: number;
  name: string;
  leadName: string | null;
  track: string | null;
  size: number;
  openSpots: number;
  recruiting: boolean;
  note: string | null;
  wantedSkills: string[];
  skills: string[];
  matched: string[];
  brings: string[];
}

export interface MmPerson {
  userId: number;
  name: string;
  university: string | null;
  experience: string | null;
  skills: string[];
  github: string | null;
  linkedin: string | null;
  looking: boolean;
  note: string | null;
  matched: string[];
  brings: string[];
}

export interface MyTeam {
  id: number;
  name: string;
  size: number;
  isLead: boolean;
  recruiting: boolean;
  note: string | null;
  wantedSkills: string[];
  skills: string[];
}

export type Overview =
  | { mode: "solo"; formation: Formation; teamSize: number; me: { looking: boolean; note: string | null; skills: string[] }; teams: MmTeam[]; people: MmPerson[] }
  | { mode: "team"; formation: Formation; teamSize: number; team: MyTeam; people: MmPerson[] };

export type RequestStatus = "pending" | "accepted" | "declined" | "cancelled";

/** One of the caller's own requests to join a team. */
export interface MyRequest {
  id: number;
  teamId: number;
  teamName: string;
  status: RequestStatus;
  message: string | null;
  createdAt: string | null;
}

/** Someone asking to join the caller's team. */
export interface IncomingRequest {
  id: number;
  userId: number;
  name: string;
  message: string | null;
  university: string | null;
  experience: string | null;
  skills: string[];
  createdAt: string | null;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const strings = (v: unknown) => (Array.isArray(v) ? v.map((s) => String(s ?? "").trim()).filter(Boolean) : []);
const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

function team(raw: unknown): MmTeam {
  const r = obj(raw);
  return {
    id: num(r.id), name: String(r.name ?? "").trim() || "—", leadName: str(r.leadName), track: str(r.track),
    size: num(r.size), openSpots: num(r.openSpots), recruiting: r.recruiting === true, note: str(r.note),
    wantedSkills: strings(r.wantedSkills), skills: strings(r.skills), matched: strings(r.matched), brings: strings(r.brings),
  };
}

function person(raw: unknown): MmPerson {
  const r = obj(raw);
  return {
    userId: num(r.userId), name: String(r.name ?? "").trim() || "—", university: str(r.university), experience: str(r.experience),
    skills: strings(r.skills), github: str(r.github), linkedin: str(r.linkedin), looking: r.looking === true, note: str(r.note),
    matched: strings(r.matched), brings: strings(r.brings),
  };
}

export function normalizeOverview(raw: unknown): Overview {
  const r = obj(raw);
  const f = obj(r.formation);
  const formation: Formation = { open: f.open !== false, closesAt: str(f.closesAt) };
  const teamSize = num(r.teamSize, 4) || 4;
  const people = Array.isArray(r.people) ? r.people.map(person).filter((p) => p.userId > 0) : [];
  if (r.mode === "team") {
    const tm = obj(r.team);
    return {
      mode: "team", formation, teamSize, people,
      team: {
        id: num(tm.id), name: String(tm.name ?? "").trim() || "—", size: num(tm.size), isLead: tm.isLead === true,
        recruiting: tm.recruiting === true, note: str(tm.note), wantedSkills: strings(tm.wantedSkills), skills: strings(tm.skills),
      },
    };
  }
  const me = obj(r.me);
  return {
    mode: "solo", formation, teamSize, people,
    me: { looking: me.looking === true, note: str(me.note), skills: strings(me.skills) },
    teams: Array.isArray(r.teams) ? r.teams.map(team).filter((x) => x.id > 0) : [],
  };
}

const STATUSES: RequestStatus[] = ["pending", "accepted", "declined", "cancelled"];

export function normalizeMyRequests(raw: unknown): MyRequest[] {
  return (Array.isArray(raw) ? raw : []).map((x) => {
    const r = obj(x);
    const s = String(r.status ?? "pending") as RequestStatus;
    return {
      id: num(r.id), teamId: num(r.team_id), teamName: String(r.team_name ?? "").trim() || "—",
      status: STATUSES.includes(s) ? s : "pending", message: str(r.message), createdAt: str(r.created_at),
    };
  }).filter((r) => r.id > 0);
}

export function normalizeIncoming(raw: unknown): IncomingRequest[] {
  return (Array.isArray(raw) ? raw : []).map((x) => {
    const r = obj(x);
    return {
      id: num(r.id), userId: num(r.user_id), name: String(r.full_name ?? "").trim() || "—", message: str(r.message),
      university: str(r.university), experience: str(r.experience), skills: strings(r.skills), createdAt: str(r.created_at),
    };
  }).filter((r) => r.id > 0);
}

/**
 * The words for a failure: the API's code when this page knows it
 * (`mm.err.<CODE>`), else a plain "did not work".
 */
export function errorWords(err: unknown, t: (k: string) => string): string {
  const code = err instanceof ApiError ? err.code : undefined;
  if (code) {
    const key = `mm.err.${code}`;
    const words = t(key);
    if (words && words !== key) return words;
  }
  return t("mm.failed");
}

/** True when a failure means teams can no longer change. */
export const isFormationClosed = (err: unknown) => err instanceof ApiError && err.code === "TEAM_FORMATION_CLOSED";
