/**
 * Elimination rounds as the API sends them (/api/events/:id/elimination),
 * and the cut the organiser is offered: keep the best N of the live ranking,
 * teams tied at the cut all stay, then the unscored and the teams with no
 * project go. The rule is the API's own (elimination.service.js suggest);
 * it runs here on the candidate list so the cut can be moved without a
 * round trip per click.
 */

export const SKIP_REASONS = ["NOT_FOUND", "ALREADY_ELIMINATED"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** Error codes the elimination screen explains in its own words. */
export const ELIMINATION_ERRORS = ["ROUND_IN_USE", "EVENT_ARCHIVED", "NOT_FOUND", "TEAM_NOT_FOUND", "VALIDATION_ERROR", "MODULE_DISABLED", "RESULTS_PUBLISHED"] as const;

export interface EliminatedTeam {
  teamId: number;
  teamName: string;
  reason: string | null;
  eliminatedAt: string | null;
  members: number;
}

export interface Round {
  id: number;
  name: string;
  note: string | null;
  position: number;
  createdAt: string | null;
  teams: EliminatedTeam[];
}

export interface RoundsPayload {
  rounds: Round[];
  outsideRounds: EliminatedTeam[];
}

/** Where a team still in stands: ranked, a project without scores yet, or no project. */
export const CANDIDATE_STATES = ["ranked", "unscored", "no_project"] as const;

/** A team that is still in: its place and score in the live ranking when it has them. */
export interface Candidate {
  teamId: number;
  teamName: string;
  place: number | null;
  score: number | null;
  state: (typeof CANDIDATE_STATES)[number];
  members: number;
}

export interface EliminateOutcome {
  eliminated: number[];
  skipped: { teamId: number; reason: SkipReason }[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const int = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) ? Math.trunc(n) : null;
};
const text = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
};

function readEliminated(raw: unknown): EliminatedTeam | null {
  const t = obj(raw);
  const teamId = int(t.teamId ?? t.team_id ?? t.id);
  if (teamId == null) return null;
  return {
    teamId,
    teamName: text(t.teamName ?? t.team_name ?? t.name) ?? `#${teamId}`,
    reason: text(t.reason ?? t.elimination_reason),
    eliminatedAt: text(t.eliminatedAt ?? t.eliminated_at),
    members: int(t.members ?? t.member_count) ?? 0,
  };
}

export function normalizeRounds(raw: unknown): RoundsPayload {
  const r = obj(raw);
  const rounds = list(r.rounds)
    .map((x) => {
      const o = obj(x);
      const id = int(o.id);
      if (id == null) return null;
      return {
        id,
        name: text(o.name) ?? `#${id}`,
        note: text(o.note),
        position: int(o.position) ?? 0,
        createdAt: text(o.createdAt ?? o.created_at),
        teams: list(o.teams).map(readEliminated).filter((t): t is EliminatedTeam => t != null),
      };
    })
    .filter((x): x is Round => x != null)
    .sort((a, b) => a.position - b.position || a.id - b.id);
  return { rounds, outsideRounds: list(r.outsideRounds ?? r.outside_rounds).map(readEliminated).filter((t): t is EliminatedTeam => t != null) };
}

export function normalizeOutcome(raw: unknown): EliminateOutcome {
  const r = obj(raw);
  return {
    eliminated: list(r.eliminated).map(int).filter((n): n is number => n != null),
    skipped: list(r.skipped)
      .map((s) => {
        const o = obj(s);
        const teamId = int(o.teamId ?? o.team_id);
        if (teamId == null) return null;
        const reason = (SKIP_REASONS as readonly string[]).includes(String(o.reason)) ? (o.reason as SkipReason) : "NOT_FOUND";
        return { teamId, reason };
      })
      .filter((s): s is { teamId: number; reason: SkipReason } => s != null),
  };
}

/**
 * Every team still in, in ranking order: the API's suggestion for keeping
 * none (GET …/elimination/suggest?keep=0 lists the whole live ranking, then
 * the unscored), plus the event's other active teams, which have no project.
 */
export function buildCandidates(suggestion: unknown, teams: unknown): Candidate[] {
  const s = obj(suggestion);
  const membersOf = new Map<number, number>();
  const active: { id: number; name: string }[] = [];
  for (const raw of list(teams)) {
    const t = obj(raw);
    const id = int(t.id);
    if (id == null) continue;
    const members = int(t.member_count) ?? list(t.members).length;
    membersOf.set(id, members);
    if (String(t.status ?? "active").toLowerCase() !== "eliminated") active.push({ id, name: text(t.name ?? t.team_name) ?? `#${id}` });
  }
  const seen = new Set<number>();
  const out: Candidate[] = [];
  for (const raw of [...list(s.stays), ...list(s.eliminate)]) {
    const c = obj(raw);
    const teamId = int(c.teamId ?? c.team_id);
    if (teamId == null || seen.has(teamId)) continue;
    seen.add(teamId);
    const place = int(c.place);
    const score = c.score == null || c.score === "" ? null : Number(c.score);
    out.push({
      teamId,
      teamName: text(c.teamName ?? c.team_name) ?? `#${teamId}`,
      place: place != null && place > 0 ? place : null,
      score: score != null && Number.isFinite(score) ? score : null,
      state: place != null && place > 0 ? "ranked" : "unscored",
      members: membersOf.get(teamId) ?? 0,
    });
  }
  out.sort((a, b) => rankOf(a) - rankOf(b) || (a.place ?? 0) - (b.place ?? 0) || a.teamName.localeCompare(b.teamName));
  for (const t of active) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push({ teamId: t.id, teamName: t.name, place: null, score: null, state: "no_project", members: membersOf.get(t.id) ?? 0 });
  }
  return out;
}

const rankOf = (c: Candidate) => (c.state === "ranked" ? 0 : c.state === "unscored" ? 1 : 2);

/**
 * The teams a cut that keeps the best `keep` would eliminate: ranked teams
 * below the cut (all teams tied at the cut stay), then everyone without a
 * place. `keep` 0 keeps nobody.
 */
export function suggestCut(candidates: Candidate[], keep: number): number[] {
  const n = Math.max(0, Math.floor(Number(keep) || 0));
  const ranked = candidates.filter((c) => c.state === "ranked").sort((a, b) => (a.place ?? 0) - (b.place ?? 0));
  const cutPlace = n > 0 ? ranked[n - 1]?.place ?? Infinity : 0;
  const below = ranked.filter((c) => n === 0 || (c.place ?? 0) > cutPlace);
  return [...below, ...candidates.filter((c) => c.state !== "ranked")].map((c) => c.teamId);
}

/** How many teams a cut keeps: may be more than asked when teams tie at the cut. */
export function keptBy(candidates: Candidate[], keep: number): number {
  const out = new Set(suggestCut(candidates, keep));
  return candidates.filter((c) => !out.has(c.teamId)).length;
}

/** The key for an API error on the elimination screen, or null to use the API's own sentence. */
export function eliminationErrorKey(code: string | undefined | null): string | null {
  return code && (ELIMINATION_ERRORS as readonly string[]).includes(code) ? `el.err.${code}` : null;
}
