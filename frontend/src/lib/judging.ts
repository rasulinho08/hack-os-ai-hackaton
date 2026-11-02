/**
 * Judging, as the API serves it: what a judge has to judge (their portal)
 * and the organiser's tools — who judges which team, declared conflicts of
 * interest and the progress matrix.
 *
 * The rules live in the API (blind judging, assignment modes, the conflict
 * declaration, the judging window); these helpers only shape its answers
 * for the screens and turn its refusals into something a person can read.
 */

import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";

/* ── Shared vocabularies ─────────────────────────────────────────────── */

/** Where judging stands for the event. */
export const WINDOW_STATES = ["open", "not_open", "closed", "published", "archived"] as const;
export type WindowState = (typeof WINDOW_STATES)[number];

/** Who judges whom (builder → Judging). */
export const ASSIGNMENT_MODES = ["all", "track", "per_team"] as const;
export type AssignmentMode = (typeof ASSIGNMENT_MODES)[number];

/** One judge × one team in the organiser's matrix. */
export const CELL_STATES = ["done", "partial", "todo", "conflict", "na", "eliminated"] as const;
export type CellState = (typeof CELL_STATES)[number];

/** One judge's review of one project. */
export const REVIEW_STATES = ["todo", "partial", "done"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/** The organiser's judges page, one tab per job (?tab= in the address). */
export const JUDGES_TABS = ["judges", "assignment", "conflicts", "progress"] as const;

/**
 * Rolling judging: the organiser set a judging start before submissions
 * close (the submission deadline, else the end of the event), so judges may
 * score projects their teams are still changing. Judging otherwise opens
 * when submissions close.
 */
export function isRollingJudging(ev: { judging_start?: string | null; submission_deadline?: string | null; end_date?: string | null }): boolean {
  const start = ev.judging_start ? new Date(ev.judging_start).getTime() : NaN;
  const closeAt = ev.submission_deadline || ev.end_date;
  const close = closeAt ? new Date(closeAt).getTime() : NaN;
  return Number.isFinite(start) && Number.isFinite(close) && start < close;
}
export type JudgesTab = (typeof JUDGES_TABS)[number];

/** What participants see once results are published (builder → Judging). */
export const RESULTS_VISIBILITY = ["own_and_winners", "winners", "full"] as const;
export type ResultsVisibility = (typeof RESULTS_VISIBILITY)[number];

/**
 * The API's reasons a score or a judging action was refused. Each has its
 * own sentence in the portal and on the judges page.
 */
export const JUDGING_ERROR_CODES = [
  "SCORE_OUT_OF_RANGE", "UNKNOWN_CRITERION", "NOT_ASSIGNED", "CONFLICT_OF_INTEREST", "COI_NOT_CONFIRMED",
  "TEAM_ELIMINATED", "JUDGING_NOT_OPEN", "JUDGING_CLOSED", "RESULTS_PUBLISHED", "EVENT_ARCHIVED",
  "NOT_EVENT_JUDGE", "NOT_FOUND", "TEAM_NOT_FOUND", "VALIDATION_ERROR",
] as const;
export type JudgingErrorCode = (typeof JUDGING_ERROR_CODES)[number];

/* ── Small readers ───────────────────────────────────────────────────── */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "string" ? Number(v.trim()) : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const idOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return v != null && v !== "" && Number.isInteger(n) && n > 0 ? n : null;
};
const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
};
function oneOf<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  return (list as readonly string[]).includes(String(v)) ? (v as T) : fallback;
}
/** A link a judge can open: http(s) only, "https://" added when it was left off. */
export function safeLink(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  return /^https?:\/\//i.test(withScheme) ? withScheme : null;
}

/* ── The judge's portal: GET /api/events/:id/judging/me ──────────────── */

export interface JudgingCriterion {
  id: number;
  name: string;
  description: string | null;
  maxScore: number;
  weight: number;
}

export interface JudgingFile {
  id: string;
  filename: string;
  size: number | null;
}

export interface JudgeTeam {
  teamId: number;
  submissionId: number;
  /** A stable number per project (by hand-in order); what blind judging shows. */
  number: number;
  /** null when judging is blind. */
  teamName: string | null;
  projectName: string | null;
  description: string | null;
  repoLink: string | null;
  demoLink: string | null;
  slidesLink: string | null;
  videoLink: string | null;
  techStack: string | null;
  track: string | null;
  files: JudgingFile[];
  presentationOrder: number | null;
  presentationAt: string | null;
  /** criterionId → score this judge gave. */
  scores: Record<number, number>;
  feedback: string | null;
  state: ReviewState;
  /** When this judge last saved their review. */
  reviewedAt: string | null;
  /** The team changed its project after this judge's review: look again and save. */
  changedSinceReview: boolean;
  changedAt: string | null;
}

export interface DeclaredConflict {
  teamId: number;
  number: number;
  teamName: string | null;
  projectName: string | null;
  reason: string | null;
}

export interface MyJudging {
  event: { id: number; name: string };
  judge: { id: number; trackId: number | null; coiConfirmedAt: string | null };
  config: { blind: boolean; assignment: AssignmentMode; coiRequired: boolean };
  window: JudgingWindow;
  criteria: JudgingCriterion[];
  teams: JudgeTeam[];
  conflicts: DeclaredConflict[];
  progress: { total: number; done: number; partial: number; changed: number };
}

/**
 * The judging window. `startsAtDeadline`: the organiser set no judging start,
 * so judging opens when submissions close (`start` is that moment).
 */
export interface JudgingWindow { state: WindowState; start: string | null; end: string | null; startsAtDeadline: boolean }

function normalizeWindow(raw: unknown): JudgingWindow {
  const win = obj(raw);
  return { state: oneOf(WINDOW_STATES, win.state, "open"), start: str(win.start), end: str(win.end), startsAtDeadline: win.startsAtDeadline === true };
}

function normalizeCriterion(raw: unknown): JudgingCriterion | null {
  const o = obj(raw);
  const id = idOrNull(o.id);
  if (id == null) return null;
  const max = num(o.maxScore ?? o.max_score, 10);
  return {
    id,
    name: str(o.name) ?? `#${id}`,
    description: str(o.description),
    maxScore: max > 0 ? max : 10,
    weight: num(o.weight, 1) > 0 ? num(o.weight, 1) : 1,
  };
}

function normalizeScores(raw: unknown): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(obj(raw))) {
    const id = idOrNull(k);
    const n = Number(v);
    if (id != null && v != null && v !== "" && Number.isFinite(n)) out[id] = n;
  }
  return out;
}

function normalizeTeam(raw: unknown, index: number): JudgeTeam | null {
  const o = obj(raw);
  const teamId = idOrNull(o.teamId ?? o.team_id);
  const submissionId = idOrNull(o.submissionId ?? o.submission_id);
  if (teamId == null || submissionId == null) return null;
  return {
    teamId,
    submissionId,
    number: idOrNull(o.number) ?? index + 1,
    teamName: str(o.teamName ?? o.team_name),
    projectName: str(o.projectName ?? o.project_name),
    description: str(o.description),
    repoLink: safeLink(o.repoLink ?? o.repo_link),
    demoLink: safeLink(o.demoLink ?? o.demo_link),
    slidesLink: safeLink(o.slidesLink ?? o.presentation_link),
    videoLink: safeLink(o.videoLink ?? o.video_link),
    techStack: str(o.techStack ?? o.tech_stack),
    track: str(o.track),
    files: arr(o.files).map(obj).filter((f) => typeof f.id === "string" && f.id).map((f) => ({
      id: String(f.id),
      filename: str(f.filename) ?? "file",
      size: f.size == null ? null : num(f.size, 0),
    })),
    presentationOrder: idOrNull(o.presentationOrder ?? o.presentation_order),
    presentationAt: str(o.presentationAt ?? o.scheduled_at),
    scores: normalizeScores(o.scores),
    feedback: typeof o.feedback === "string" ? o.feedback : null,
    state: oneOf(REVIEW_STATES, o.state, "todo"),
    reviewedAt: str(o.reviewedAt),
    changedSinceReview: o.changedSinceReview === true,
    changedAt: str(o.changedAt),
  };
}

export function normalizeMyJudging(raw: unknown): MyJudging {
  const o = obj(raw);
  const ev = obj(o.event);
  const judge = obj(o.judge);
  const cfg = obj(o.config);
  const teams = arr(o.teams).map(normalizeTeam).filter((x): x is JudgeTeam => x != null);
  const prog = obj(o.progress);
  return {
    event: { id: num(ev.id), name: str(ev.name) ?? "" },
    judge: { id: num(judge.id), trackId: idOrNull(judge.trackId ?? judge.track_id), coiConfirmedAt: str(judge.coiConfirmedAt ?? judge.coi_confirmed_at) },
    config: {
      blind: Boolean(cfg.blind),
      assignment: oneOf(ASSIGNMENT_MODES, cfg.assignment, "all"),
      coiRequired: Boolean(cfg.coiRequired),
    },
    window: normalizeWindow(o.window),
    criteria: arr(o.criteria).map(normalizeCriterion).filter((x): x is JudgingCriterion => x != null),
    teams,
    conflicts: arr(o.conflicts).map(obj).filter((c) => idOrNull(c.teamId) != null).map((c, i) => ({
      teamId: idOrNull(c.teamId) as number,
      number: idOrNull(c.number) ?? i + 1,
      teamName: str(c.teamName),
      projectName: str(c.projectName),
      reason: str(c.reason),
    })),
    progress: {
      total: num(prog.total, teams.length),
      done: num(prog.done, teams.filter((t) => t.state === "done").length),
      partial: num(prog.partial, teams.filter((t) => t.state === "partial").length),
      changed: num(prog.changed, teams.filter((t) => t.changedSinceReview).length),
    },
  };
}

/** What a judge may do now: score, or only look (and why). */
export function canScore(m: Pick<MyJudging, "window" | "config" | "judge">): { ok: boolean; reason: WindowState | "coi" | null } {
  if (m.window.state !== "open") return { ok: false, reason: m.window.state };
  if (m.config.coiRequired && !m.judge.coiConfirmedAt) return { ok: false, reason: "coi" };
  return { ok: true, reason: null };
}

/** How a team is named to this judge: its number and project, its team name unless judging is blind. */
export function teamTitle(t: Pick<JudgeTeam, "number" | "projectName" | "teamName">, untitled: string): string {
  return t.projectName ? `#${t.number} · ${t.projectName}` : `#${t.number} · ${t.teamName ?? untitled}`;
}

/* ── Scores in the review form ───────────────────────────────────────── */

/**
 * A typed score: a number from 0 to the criterion's maximum, with a comma
 * or a point; "" is "not scored yet".
 */
export function parseScore(input: string, max: number): number | null | "invalid" {
  const s = String(input ?? "").trim().replace(",", ".");
  if (!s) return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return "invalid";
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > max) return "invalid";
  return Math.round(n * 100) / 100;
}

/**
 * This judge's weighted score for one project, out of 100: Σ(score × weight)
 * ÷ Σ(max × weight) over the criteria they scored, the same sum the results
 * use per judge. null until every criterion has a score.
 */
export function weightedPercent(criteria: JudgingCriterion[], scores: Record<number, number | null | undefined>): number | null {
  if (!criteria.length) return null;
  let points = 0;
  let max = 0;
  for (const c of criteria) {
    const v = scores[c.id];
    if (v == null || !Number.isFinite(v)) return null;
    points += v * c.weight;
    max += c.maxScore * c.weight;
  }
  return max > 0 ? Math.round((points / max) * 1000) / 10 : null;
}

/** The review a judge saves: every scored criterion and the written feedback, all together. */
export function reviewBody(
  submissionId: number,
  criteria: JudgingCriterion[],
  drafts: Record<number, string>,
  feedback: string,
): { submissionId: number; scores: { criterionId: number; score: number }[]; feedback: string } | { invalid: number[] } {
  const scores: { criterionId: number; score: number }[] = [];
  const invalid: number[] = [];
  for (const c of criteria) {
    const v = parseScore(drafts[c.id] ?? "", c.maxScore);
    if (v === "invalid") invalid.push(c.id);
    else if (v != null) scores.push({ criterionId: c.id, score: v });
  }
  if (invalid.length) return { invalid };
  return { submissionId, scores, feedback: feedback.slice(0, 4000) };
}

/**
 * Why the API refused: the overall reason, and per criterion the reason a
 * score was not accepted (the API names them `scores.<criterionId>`).
 */
export function judgingError(err: unknown): { code: string | null; byCriterion: Record<number, string> } {
  if (!(err instanceof ApiError)) return { code: null, byCriterion: {} };
  const byCriterion: Record<number, string> = {};
  for (const fe of err.fieldErrors) {
    const m = /^scores\.(\d+)$/.exec(fe.field);
    if (m && fe.code) byCriterion[Number(m[1])] = fe.code;
  }
  return { code: err.code ?? null, byCriterion };
}

/** The i18n key of a refusal: `${prefix}${code}` when the code is one we word, else the generic one. */
export function errorKey(prefix: string, err: unknown, fallback: string): string {
  const { code } = judgingError(err);
  return code && (JUDGING_ERROR_CODES as readonly string[]).includes(code) ? `${prefix}${code}` : fallback;
}

/* ── The organiser's side ────────────────────────────────────────────── */

export interface JudgeRow {
  /** judges.id — what assignments, conflicts and tracks refer to. */
  id: number;
  userId: number;
  name: string;
  email: string | null;
  trackId: number | null;
  coiConfirmedAt: string | null;
}

/** GET /api/events/:id/judging/judges */
export function normalizeJudges(raw: unknown): JudgeRow[] {
  return arr(raw).map(obj).filter((j) => idOrNull(j.id) != null).map((j) => ({
    id: idOrNull(j.id) as number,
    userId: num(j.user_id ?? j.userId),
    name: str(j.full_name ?? j.name) ?? str(j.email) ?? `#${j.id}`,
    email: str(j.email),
    trackId: idOrNull(j.track_id ?? j.trackId),
    coiConfirmedAt: str(j.coi_confirmed_at ?? j.coiConfirmedAt),
  }));
}

export interface ProgressJudge {
  id: number;
  userId: number;
  name: string;
  trackId: number | null;
  coiConfirmedAt: string | null;
  assigned: number;
  done: number;
  partial: number;
  /** Reviews of projects changed after the review. */
  changed: number;
}

export interface ProgressTeam {
  id: number;
  name: string;
  projectName: string | null;
  submissionId: number;
  eliminated: boolean;
  track: string | null;
  done: number;
  partial: number;
  assigned: number;
  changed: number;
}

export interface JudgingProgress {
  config: { assignment: AssignmentMode; judgesPerTeam: number; blind: boolean; coiRequired: boolean };
  window: JudgingWindow;
  criteria: number;
  judges: ProgressJudge[];
  teams: ProgressTeam[];
  /** `${judgeId}:${teamId}` → state */
  cells: Record<string, CellState>;
  /** `${judgeId}:${teamId}` of reviews older than the team's last change to its project. */
  changed: Set<string>;
  /** How many reviews are flagged for a re-check. */
  changedCount: number;
}

export const cellKey = (judgeId: number, teamId: number) => `${judgeId}:${teamId}`;

/** GET /api/events/:id/judging/progress */
export function normalizeProgress(raw: unknown): JudgingProgress {
  const o = obj(raw);
  const cfg = obj(o.config);
  const cells: Record<string, CellState> = {};
  const changed = new Set<string>();
  for (const c of arr(o.cells).map(obj)) {
    const j = idOrNull(c.judgeId);
    const t = idOrNull(c.teamId);
    if (j != null && t != null) {
      cells[cellKey(j, t)] = oneOf(CELL_STATES, c.state, "na");
      if (c.changedSinceReview === true) changed.add(cellKey(j, t));
    }
  }
  return {
    config: {
      assignment: oneOf(ASSIGNMENT_MODES, cfg.assignment, "all"),
      judgesPerTeam: Math.max(1, Math.round(num(cfg.judgesPerTeam, 3))),
      blind: Boolean(cfg.blind),
      coiRequired: Boolean(cfg.coiRequired),
    },
    window: normalizeWindow(o.window),
    criteria: num(o.criteria),
    judges: arr(o.judges).map(obj).filter((j) => idOrNull(j.id) != null).map((j) => ({
      id: idOrNull(j.id) as number,
      userId: num(j.userId),
      name: str(j.name) ?? `#${j.id}`,
      trackId: idOrNull(j.trackId),
      coiConfirmedAt: str(j.coiConfirmedAt),
      assigned: num(j.assigned),
      done: num(j.done),
      partial: num(j.partial),
      changed: num(j.changed),
    })),
    teams: arr(o.teams).map(obj).filter((t) => idOrNull(t.id) != null).map((t) => ({
      id: idOrNull(t.id) as number,
      name: str(t.name) ?? `#${t.id}`,
      projectName: str(t.projectName),
      submissionId: num(t.submissionId),
      eliminated: Boolean(t.eliminated),
      track: str(t.track),
      done: num(t.done),
      partial: num(t.partial),
      assigned: num(t.assigned),
      changed: num(t.changed),
    })),
    cells,
    changed,
    changedCount: num(o.changedSinceReview, changed.size),
  };
}

/** The share of assigned reviews that are complete, 0–100 (null with nothing assigned). */
export function completion(done: number, assigned: number): number | null {
  return assigned > 0 ? Math.round((done / assigned) * 100) : null;
}

/** GET /api/events/:id/judging/assignments → judgeId → team ids. */
export function normalizeAssignments(raw: unknown): Record<number, number[]> {
  const out: Record<number, number[]> = {};
  for (const [k, v] of Object.entries(obj(raw))) {
    const id = idOrNull(k);
    if (id == null) continue;
    out[id] = [...new Set(arr(v).map((x) => idOrNull(x)).filter((x): x is number => x != null))].sort((a, b) => a - b);
  }
  return out;
}

/** How many judges each team has in per-team mode. */
export function judgesPerTeamCount(assignments: Record<number, number[]>): Record<number, number> {
  const out: Record<number, number> = {};
  for (const ids of Object.values(assignments)) for (const t of ids) out[t] = (out[t] || 0) + 1;
  return out;
}

export interface ConflictRow {
  id: number;
  judgeId: number;
  teamId: number;
  reason: string | null;
  createdAt: string | null;
  judgeName: string;
  teamName: string;
  /** Declared by the judge themselves (else by an organiser). */
  byJudge: boolean;
}

/** GET /api/events/:id/judging/conflicts */
export function normalizeConflicts(raw: unknown): ConflictRow[] {
  return arr(raw).map(obj).filter((c) => idOrNull(c.id) != null).map((c) => ({
    id: idOrNull(c.id) as number,
    judgeId: num(c.judge_id ?? c.judgeId),
    teamId: num(c.team_id ?? c.teamId),
    reason: str(c.reason),
    createdAt: str(c.created_at ?? c.createdAt),
    judgeName: str(c.judge_name ?? c.judgeName) ?? "—",
    teamName: str(c.team_name ?? c.teamName) ?? "—",
    byJudge: Boolean(c.by_judge ?? c.byJudge),
  }));
}

export interface JudgingSettings {
  blind: boolean;
  assignment: AssignmentMode;
  judgesPerTeam: number;
  resultsVisibility: ResultsVisibility;
  coiRequired: boolean;
  showScores: boolean;
}

/** The event's judging_config with the API's defaults filled in. */
export function judgingSettings(raw: unknown): JudgingSettings {
  const o = obj(raw);
  return {
    blind: Boolean(o.blind),
    assignment: oneOf(ASSIGNMENT_MODES, o.assignment, "all"),
    judgesPerTeam: Math.min(20, Math.max(1, Math.round(num(o.judgesPerTeam, 3)))),
    resultsVisibility: oneOf(RESULTS_VISIBILITY, o.resultsVisibility, "own_and_winners"),
    coiRequired: Boolean(o.coiRequired),
    showScores: Boolean(o.showScores),
  };
}

/* ── Calls ───────────────────────────────────────────────────────────── */

const base = (eventId: number) => `/api/events/${eventId}/judging`;

export const judgingApi = {
  me: async (eventId: number) => normalizeMyJudging(await apiGet<unknown>(`${base(eventId)}/me`)),
  saveReview: (eventId: number, body: { submissionId: number; scores: { criterionId: number; score: number }[]; feedback: string }) =>
    apiPost<unknown>(`${base(eventId)}/me/reviews`, body),
  confirmCoi: (eventId: number) => apiPost<{ coiConfirmedAt: string }>(`${base(eventId)}/me/coi`, {}),
  declareMine: (eventId: number, teamId: number, reason: string) => apiPost<unknown>(`${base(eventId)}/me/conflicts`, { teamId, reason }),
  clearMine: (eventId: number, teamId: number) => apiDelete<unknown>(`${base(eventId)}/me/conflicts/${teamId}`),

  judges: async (eventId: number) => normalizeJudges(await apiGet<unknown>(`${base(eventId)}/judges`)),
  setTrack: (eventId: number, judgeId: number, trackId: number | null) => apiPatch<unknown>(`${base(eventId)}/judges/${judgeId}`, { trackId }),
  progress: async (eventId: number) => normalizeProgress(await apiGet<unknown>(`${base(eventId)}/progress`)),
  assignments: async (eventId: number) => normalizeAssignments(await apiGet<unknown>(`${base(eventId)}/assignments`)),
  generate: (eventId: number, replace: boolean) =>
    apiPost<{ assigned: number; shortfall: { teamId: number; missing: number }[] }>(`${base(eventId)}/assignments/generate`, { replace }),
  setAssignments: (eventId: number, judgeId: number, teamIds: number[]) => apiPut<unknown>(`${base(eventId)}/assignments/${judgeId}`, { teamIds }),
  conflicts: async (eventId: number) => normalizeConflicts(await apiGet<unknown>(`${base(eventId)}/conflicts`)),
  declare: (eventId: number, judgeId: number, teamId: number, reason: string) =>
    apiPost<unknown>(`${base(eventId)}/conflicts`, { judgeId, teamId, reason }),
  clear: (eventId: number, conflictId: number) => apiDelete<unknown>(`${base(eventId)}/conflicts/${conflictId}`),
  /** The mode and the number of judges per team live in the builder's judging settings. */
  saveMode: (eventId: number, assignment: AssignmentMode, judgesPerTeam: number) =>
    apiPatch<unknown>(`/api/events/${eventId}/builder`, { judging_config: { assignment, judgesPerTeam } }),
};
