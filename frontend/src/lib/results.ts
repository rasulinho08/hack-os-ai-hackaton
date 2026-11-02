/**
 * Results as the API sends them (GET /api/events/:id/results for organisers,
 * /results/me for participants), read defensively into one shape the pages
 * share, plus the few small rules the screens need: which ranking to show,
 * whether the published one still matches the scores, ordinals, scores.
 *
 * The ranking itself is the API's (weighted per judge, out of 100, ties share
 * a place, only complete reviews count); nothing here scores teams. See the
 * backend's results.service.js.
 */

export const VISIBILITIES = ["full", "own_and_winners", "winners"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const PRIZE_KINDS = ["place", "track", "special"] as const;
export type PrizeKind = (typeof PRIZE_KINDS)[number];

/** How far judging has got with a project, as the API works it out from the scores. */
export const SUBMISSION_STATUSES = ["submitted", "reviewing", "graded"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** Error codes the results screens explain in their own words. */
export const RESULTS_ERRORS = [
  "NO_SCORES", "EVENT_ARCHIVED", "PRIZE_BY_PLACE", "NOT_FOUND", "VALIDATION_ERROR", "MODULE_DISABLED", "SUBMISSIONS_OPEN", "JUDGING_INCOMPLETE",
  "REVIEWS_OUTDATED", "NOTHING_OUTDATED", "RESULTS_PUBLISHED",
] as const;

/** Why publishing did not issue certificates by itself (the publish answer's `certificates.reason`). */
export const CERTIFICATE_HOLDS = ["ISSUE_BY_HAND", "NO_KINDS", "SIGNER_MISSING"] as const;

export interface Criterion {
  id: number;
  name: string;
  max: number;
  weight: number;
}

export interface BreakdownItem {
  criterionId: number;
  name: string;
  max: number;
  weight: number;
  /** The judges' average for this criterion; null when nobody scored it. */
  avg: number | null;
}

export interface TeamRef {
  teamId: number;
  teamName: string;
  projectName: string | null;
  trackId: number | null;
  track: string | null;
  /** Reviews a judge started but did not finish: not counted until every criterion is scored. */
  partialReviews?: number;
}

/** A judge's review that misses criteria, so the ranking leaves it out. */
export interface IncompleteReview {
  teamId: number;
  judgeId: number;
  filled: number;
  of: number;
}

export interface RankedTeam extends TeamRef {
  submissionId: number | null;
  place: number;
  /** Out of 100; null only in a published ranking that kept none. */
  score: number | null;
  judgesCount: number;
  tie: boolean;
  breakdown: BreakdownItem[];
}

export interface Prize {
  id: number;
  name: string;
  description: string | null;
  value: string | null;
  kind: PrizeKind;
  position: number | null;
  trackId: number | null;
  /** The organiser chose the winner (special and track prizes). */
  manual: boolean;
}

export interface PrizeWinner {
  teamId: number;
  teamName: string;
  projectName: string | null;
  place: number | null;
}

export interface PrizeResult {
  prize: Prize;
  teams: PrizeWinner[];
}

export interface Review {
  teamId: number;
  judgeId: number;
  judgeName: string;
  /** criterion id → score */
  scores: Record<number, number>;
  feedback: string | null;
  /** How often the judge changed a score they had already given (the judge audit). */
  changed: number;
}

export interface PublishedState {
  at: string;
  visibility: Visibility;
  showScores: boolean;
  /** Published over outdated reviews the organiser confirmed: how many, and when. */
  outdatedConfirmed: { count: number; at: string | null } | null;
}

/** One judge's review older than the team's last change to its project. */
export interface OutdatedReview {
  judgeId: number;
  judgeName: string;
  teamId: number;
  teamName: string;
  projectName: string | null;
  reviewedAt: string | null;
  changedAt: string | null;
}

/**
 * Reviews older than their project's latest change (the API's
 * `outdated`): publishing asks before it goes ahead over them.
 */
export interface OutdatedReviews {
  count: number;
  /** Judging opened before submissions closed (rolling judging). */
  rolling: boolean;
  /** The judging window: judges can save again only while it is open. */
  windowState: string;
  reviews: OutdatedReview[];
  judges: { judgeId: number; name: string; count: number }[];
  projects: { teamId: number; teamName: string; projectName: string | null; count: number }[];
}

export interface OrganiserResults {
  published: PublishedState | null;
  settings: { visibility: Visibility; showScores: boolean };
  criteria: Criterion[];
  ranking: RankedTeam[];
  /** No complete review yet (some may have partial ones). */
  unscored: TeamRef[];
  eliminated: TeamRef[];
  /** A project handed in, but no member accepted to the event: not judged or ranked. */
  ineligible: TeamRef[];
  incomplete: IncompleteReview[];
  /** The frozen ranking participants see; null until published. */
  snapshot: RankedTeam[] | null;
  prizes: PrizeResult[];
  reviews: Review[];
  /** Null once published (nothing to warn about any more) or when the API did not say. */
  outdated: OutdatedReviews | null;
}

export interface MyResult {
  teamId: number;
  teamName: string;
  /** Null when the organiser shows only the winners, or the team was not ranked. */
  place: number | null;
  /** How many teams were ranked; null when places are not shown. */
  of: number | null;
  score: number | null;
  breakdown: BreakdownItem[] | null;
  /** The judges' written feedback, without names; null when scores are hidden. */
  feedback: string[] | null;
  won: Prize[];
}

export interface LeaderboardRow {
  place: number;
  teamId: number;
  teamName: string;
  projectName: string | null;
  score: number | null;
}

export interface ParticipantResults {
  published: PublishedState | null;
  mine: MyResult | null;
  winners: PrizeResult[];
  /** Only when the organiser publishes the full leaderboard. */
  leaderboard: LeaderboardRow[] | null;
}

/* ── Reading ─────────────────────────────────────────────────────────────── */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const int = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) ? Math.trunc(n) : null;
};
const num = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) ? n : null;
};
const text = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  return s ? s : null;
};
const oneOf = <T extends string>(options: readonly T[], v: unknown, fallback: T): T =>
  (options as readonly string[]).includes(String(v)) ? (v as T) : fallback;

function readBreakdown(v: unknown): BreakdownItem[] {
  return list(v)
    .map((raw) => {
      const b = obj(raw);
      const id = int(b.criterionId ?? b.criterion_id ?? b.id);
      if (id == null) return null;
      return {
        criterionId: id,
        name: text(b.name) ?? "—",
        max: num(b.max ?? b.max_score) ?? 10,
        weight: num(b.weight) ?? 1,
        avg: num(b.avg),
      };
    })
    .filter((b): b is BreakdownItem => b != null);
}

function readTeamRef(raw: unknown): TeamRef | null {
  const r = obj(raw);
  const teamId = int(r.teamId ?? r.team_id);
  if (teamId == null) return null;
  const partial = int(r.partialReviews);
  return {
    teamId,
    teamName: text(r.teamName ?? r.team_name) ?? `#${teamId}`,
    projectName: text(r.projectName ?? r.project_name),
    trackId: int(r.trackId ?? r.track_id),
    track: text(r.track ?? r.track_name),
    ...(partial != null && partial > 0 ? { partialReviews: partial } : {}),
  };
}

function readRanked(raw: unknown): RankedTeam | null {
  const base = readTeamRef(raw);
  if (!base) return null;
  const r = obj(raw);
  const place = int(r.place);
  if (place == null || place < 1) return null;
  return {
    ...base,
    submissionId: int(r.submissionId ?? r.submission_id),
    place,
    score: num(r.score),
    judgesCount: int(r.judgesCount ?? r.judges_count) ?? 0,
    tie: Boolean(r.tie),
    breakdown: readBreakdown(r.breakdown),
  };
}

/** Ties are worked out again for rows that do not say (a published ranking). */
function markTies(rows: RankedTeam[]): RankedTeam[] {
  const count = new Map<number, number>();
  for (const r of rows) count.set(r.place, (count.get(r.place) ?? 0) + 1);
  return rows.map((r) => ({ ...r, tie: r.tie || (count.get(r.place) ?? 0) > 1 }));
}

function readRanking(v: unknown): RankedTeam[] {
  const rows = list(v).map(readRanked).filter((r): r is RankedTeam => r != null);
  rows.sort((a, b) => a.place - b.place || (b.score ?? 0) - (a.score ?? 0) || a.teamName.localeCompare(b.teamName));
  return markTies(rows);
}

function readPublished(v: unknown): PublishedState | null {
  const p = obj(v);
  const at = text(p.at);
  if (!at) return null;
  const o = obj(p.outdatedConfirmed);
  const count = int(o.count);
  return {
    at,
    visibility: oneOf(VISIBILITIES, p.visibility, "own_and_winners"),
    showScores: Boolean(p.showScores),
    outdatedConfirmed: count != null && count > 0 ? { count, at: text(o.at) } : null,
  };
}

/** The API's outdated reviews, read defensively; null when it sent none. */
export function readOutdated(v: unknown): OutdatedReviews | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = obj(v);
  const reviews = list(o.reviews)
    .map((raw) => {
      const r = obj(raw);
      const judgeId = int(r.judgeId);
      const teamId = int(r.teamId);
      if (judgeId == null || teamId == null) return null;
      return {
        judgeId,
        judgeName: text(r.judgeName) ?? `#${judgeId}`,
        teamId,
        teamName: text(r.teamName) ?? `#${teamId}`,
        projectName: text(r.projectName),
        reviewedAt: text(r.reviewedAt),
        changedAt: text(r.changedAt),
      };
    })
    .filter((r): r is OutdatedReview => r != null);
  const judges = list(o.judges)
    .map((raw) => {
      const j = obj(raw);
      const judgeId = int(j.judgeId);
      return judgeId == null ? null : { judgeId, name: text(j.name) ?? `#${judgeId}`, count: Math.max(0, int(j.count) ?? 0) };
    })
    .filter((j): j is OutdatedReviews["judges"][number] => j != null);
  const projects = list(o.projects)
    .map((raw) => {
      const p = obj(raw);
      const teamId = int(p.teamId);
      return teamId == null ? null : { teamId, teamName: text(p.teamName) ?? `#${teamId}`, projectName: text(p.projectName), count: Math.max(0, int(p.count) ?? 0) };
    })
    .filter((p): p is OutdatedReviews["projects"][number] => p != null);
  return {
    count: Math.max(0, int(o.count) ?? reviews.length),
    rolling: Boolean(o.rolling),
    windowState: text(obj(o.window).state) ?? "open",
    reviews,
    judges,
    projects,
  };
}

/** The outdated reviews of one project, judge by judge, for the dialog: newest change first. */
export function outdatedByProject(o: OutdatedReviews): { teamId: number; teamName: string; projectName: string | null; changedAt: string | null; reviews: OutdatedReview[] }[] {
  const out = new Map<number, { teamId: number; teamName: string; projectName: string | null; changedAt: string | null; reviews: OutdatedReview[] }>();
  for (const r of o.reviews) {
    if (!out.has(r.teamId)) out.set(r.teamId, { teamId: r.teamId, teamName: r.teamName, projectName: r.projectName, changedAt: r.changedAt, reviews: [] });
    const p = out.get(r.teamId)!;
    p.reviews.push(r);
    if (r.changedAt && (!p.changedAt || r.changedAt > p.changedAt)) p.changedAt = r.changedAt;
  }
  return [...out.values()]
    .map((p) => ({ ...p, reviews: [...p.reviews].sort((a, b) => a.judgeName.localeCompare(b.judgeName)) }))
    .sort((a, b) => (b.changedAt ?? "").localeCompare(a.changedAt ?? "") || a.teamName.localeCompare(b.teamName));
}

export function readPrize(v: unknown): Prize | null {
  const p = obj(v);
  const id = int(p.id);
  if (id == null) return null;
  return {
    id,
    name: text(p.name) ?? `#${id}`,
    description: text(p.description),
    value: text(p.value),
    kind: oneOf(PRIZE_KINDS, p.kind, "special"),
    position: int(p.position),
    trackId: int(p.trackId ?? p.track_id),
    manual: Boolean(p.manual),
  };
}

function readPrizes(v: unknown): PrizeResult[] {
  return list(v)
    .map((raw) => {
      const r = obj(raw);
      const prize = readPrize(r.prize);
      if (!prize) return null;
      const teams = list(r.teams)
        .map((t) => {
          const x = obj(t);
          const teamId = int(x.teamId ?? x.team_id);
          if (teamId == null) return null;
          return {
            teamId,
            teamName: text(x.teamName ?? x.team_name) ?? `#${teamId}`,
            projectName: text(x.projectName ?? x.project_name),
            place: int(x.place),
          };
        })
        .filter((t): t is PrizeWinner => t != null);
      return { prize, teams };
    })
    .filter((p): p is PrizeResult => p != null);
}

function readReviews(v: unknown): Review[] {
  return list(v)
    .map((raw) => {
      const r = obj(raw);
      const teamId = int(r.teamId ?? r.team_id);
      const judgeId = int(r.judgeId ?? r.judge_id);
      if (teamId == null || judgeId == null) return null;
      const scores: Record<number, number> = {};
      for (const [k, s] of Object.entries(obj(r.scores))) {
        const id = int(k);
        const n = num(s);
        if (id != null && n != null) scores[id] = n;
      }
      return {
        teamId,
        judgeId,
        judgeName: text(r.judgeName ?? r.judge_name) ?? `#${judgeId}`,
        scores,
        feedback: text(r.feedback),
        changed: Math.max(0, int(r.changed) ?? 0),
      };
    })
    .filter((r): r is Review => r != null);
}

export function normalizeOrganiserResults(raw: unknown): OrganiserResults {
  const r = obj(raw);
  const settings = obj(r.settings);
  const published = readPublished(r.published);
  return {
    published,
    settings: {
      visibility: oneOf(VISIBILITIES, settings.visibility ?? published?.visibility, "own_and_winners"),
      showScores: Boolean(settings.showScores ?? published?.showScores),
    },
    criteria: list(r.criteria)
      .map((c) => {
        const x = obj(c);
        const id = int(x.id);
        if (id == null) return null;
        return { id, name: text(x.name) ?? `#${id}`, max: num(x.max ?? x.max_score) ?? 10, weight: num(x.weight) ?? 1 };
      })
      .filter((c): c is Criterion => c != null),
    ranking: readRanking(r.ranking),
    unscored: list(r.unscored).map(readTeamRef).filter((t): t is TeamRef => t != null),
    eliminated: list(r.eliminated).map(readTeamRef).filter((t): t is TeamRef => t != null),
    ineligible: list(r.ineligible).map(readTeamRef).filter((t): t is TeamRef => t != null),
    incomplete: list(r.incomplete)
      .map((raw) => {
        const x = obj(raw);
        const teamId = int(x.teamId);
        const judgeId = int(x.judgeId);
        if (teamId == null || judgeId == null) return null;
        return { teamId, judgeId, filled: Math.max(0, int(x.filled) ?? 0), of: Math.max(0, int(x.of) ?? 0) };
      })
      .filter((x): x is IncompleteReview => x != null),
    snapshot: published && Array.isArray(r.snapshot) ? readRanking(r.snapshot) : null,
    prizes: readPrizes(r.prizes),
    reviews: readReviews(r.reviews),
    outdated: published ? null : readOutdated(r.outdated),
  };
}

export function normalizeParticipantResults(raw: unknown): ParticipantResults {
  const r = obj(raw);
  const published = readPublished(r.published);
  if (!published) return { published: null, mine: null, winners: [], leaderboard: null };
  const m = obj(r.mine);
  const teamId = int(m.teamId ?? m.team_id);
  const mine: MyResult | null = teamId == null ? null : {
    teamId,
    teamName: text(m.teamName ?? m.team_name) ?? `#${teamId}`,
    place: int(m.place),
    of: int(m.of),
    score: num(m.score),
    breakdown: Array.isArray(m.breakdown) ? readBreakdown(m.breakdown) : null,
    feedback: Array.isArray(m.feedback) ? m.feedback.map(text).filter((f): f is string => f != null) : null,
    won: list(m.won).map(readPrize).filter((p): p is Prize => p != null),
  };
  const leaderboard = Array.isArray(r.leaderboard)
    ? r.leaderboard
      .map((raw) => {
        const x = obj(raw);
        const id = int(x.teamId ?? x.team_id);
        const place = int(x.place);
        if (id == null || place == null) return null;
        return { place, teamId: id, teamName: text(x.teamName ?? x.team_name) ?? `#${id}`, projectName: text(x.projectName ?? x.project_name), score: num(x.score) };
      })
      .filter((x): x is LeaderboardRow => x != null)
      .sort((a, b) => a.place - b.place)
    : null;
  return { published, mine, winners: readPrizes(r.winners).filter((w) => w.teams.length > 0), leaderboard };
}

/* ── Rules the screens share ─────────────────────────────────────────────── */

/**
 * What the big screen may project.
 *
 *   waiting       not published, and the organiser has not asked for the
 *                 live preview: a holding screen, no ranking.
 *   live_preview  not published, the organiser explicitly turned the
 *                 preview on: the live ranking, marked on screen as not the
 *                 result.
 *   ranking       published with the full leaderboard: the frozen ranking;
 *                 scores only when the organiser published them.
 *   winners       published as "own place and the winners" or "winners
 *                 only": a hall sees what every participant sees, the
 *                 winners, with no places of other teams and no scores.
 *
 * The organiser can show less (hide scores) but never more than they
 * published: `scoresLocked` says the scores are not theirs to show here.
 */
export type BigScreenMode = "waiting" | "live_preview" | "ranking" | "winners";

export interface BigScreenView {
  mode: BigScreenMode;
  /** Rows to list (ranking and live preview). */
  rows: RankedTeam[];
  /** Prizes with their winners, in ceremony order (winners mode). */
  winners: PrizeResult[];
  showScores: boolean;
  /** The published results hide scores: the toggle cannot bring them back. */
  scoresLocked: boolean;
  visibility: Visibility | null;
}

export function bigScreenView(
  r: OrganiserResults,
  opts: { livePreview: boolean; hideScores: boolean },
): BigScreenView {
  if (r.published && r.snapshot) {
    const visibility = r.published.visibility;
    if (visibility === "full") {
      return {
        mode: "ranking", rows: r.snapshot, winners: [], visibility,
        scoresLocked: !r.published.showScores,
        showScores: r.published.showScores && !opts.hideScores,
      };
    }
    return {
      mode: "winners", rows: [], visibility, scoresLocked: true, showScores: false,
      winners: sortPrizes(r.prizes.filter((p) => p.teams.length > 0)),
    };
  }
  if (opts.livePreview) {
    return { mode: "live_preview", rows: r.ranking, winners: [], visibility: null, scoresLocked: false, showScores: !opts.hideScores };
  }
  return { mode: "waiting", rows: [], winners: [], visibility: null, scoresLocked: false, showScores: false };
}

/**
 * Teams whose place or score moved since publishing, plus teams that entered
 * or left the ranking. Empty when the published ranking still matches.
 */
export function snapshotChanges(r: OrganiserResults): { teamId: number; teamName: string; from: number | null; to: number | null }[] {
  if (!r.published || !r.snapshot) return [];
  const before = new Map(r.snapshot.map((x) => [x.teamId, x]));
  const now = new Map(r.ranking.map((x) => [x.teamId, x]));
  const out: { teamId: number; teamName: string; from: number | null; to: number | null }[] = [];
  for (const x of r.ranking) {
    const b = before.get(x.teamId);
    if (!b) out.push({ teamId: x.teamId, teamName: x.teamName, from: null, to: x.place });
    else if (b.place !== x.place || roundScore(b.score) !== roundScore(x.score)) out.push({ teamId: x.teamId, teamName: x.teamName, from: b.place, to: x.place });
  }
  for (const b of r.snapshot) if (!now.has(b.teamId)) out.push({ teamId: b.teamId, teamName: b.teamName, from: b.place, to: null });
  return out;
}

const roundScore = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);

/** One judge's reviews of one team, in judge-name order. */
export function reviewsOf(reviews: Review[], teamId: number): Review[] {
  return reviews.filter((r) => r.teamId === teamId).sort((a, b) => a.judgeName.localeCompare(b.judgeName));
}

/** Whether a judge's review scores every criterion: only such a review counts in the ranking. */
export function isCompleteReview(review: Review, criteria: Criterion[]): boolean {
  return criteria.length > 0 && criteria.every((c) => review.scores[c.id] != null);
}

/**
 * A judge's own score for a team, out of 100, by the same rule as the
 * ranking: null for a review that misses criteria (it does not count yet).
 */
export function judgeScore(review: Review, criteria: Criterion[]): number | null {
  if (!isCompleteReview(review, criteria)) return null;
  let points = 0;
  let max = 0;
  for (const c of criteria) {
    points += review.scores[c.id] * c.weight;
    max += c.max * c.weight;
  }
  return max > 0 ? Math.round((points / max) * 10000) / 100 : null;
}

/**
 * What the API's refusal to publish carries, for the screen to say it in the
 * organiser's language: when submissions close (SUBMISSIONS_OPEN), or how
 * many assigned reviews are not started or not finished (JUDGING_INCOMPLETE).
 */
export function publishRefusal(
  code: string | undefined | null,
  details: { field: string; message?: string }[],
):
  | { code: "SUBMISSIONS_OPEN"; closesAt: string | null }
  | { code: "JUDGING_INCOMPLETE"; todo: number; partial: number }
  | { code: "REVIEWS_OUTDATED"; count: number; judges: string[]; projects: string[] }
  | null {
  const value = (field: string) => details.find((d) => d.field === field)?.message ?? null;
  const count = (field: string) => Math.max(0, int(value(field)) ?? 0);
  if (code === "SUBMISSIONS_OPEN") {
    const at = value("closesAt");
    return { code, closesAt: at && !Number.isNaN(new Date(at).getTime()) ? at : null };
  }
  if (code === "JUDGING_INCOMPLETE") return { code, todo: count("todo"), partial: count("partial") };
  if (code === "REVIEWS_OUTDATED") {
    const all = (field: string) => details.filter((d) => d.field === field).map((d) => d.message ?? "").filter(Boolean);
    return { code, count: count("count"), judges: all("judge"), projects: all("project") };
  }
  return null;
}

/** "87.5", "100", "62.25" — at most two decimals, none when whole. */
export function formatScore(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return String(Math.round(n * 100) / 100);
}

/** 1st, 1-ci, 1-е — the place as each language writes it. */
export function ordinal(n: number, lang: string): string {
  if (lang === "az") {
    const units: Record<number, string> = { 1: "ci", 2: "ci", 3: "cü", 4: "cü", 5: "ci", 6: "cı", 7: "ci", 8: "ci", 9: "cu" };
    const tens: Record<number, string> = { 1: "cu", 2: "ci", 3: "cu", 4: "cı", 5: "ci", 6: "cı", 7: "ci", 8: "ci", 9: "cı" };
    let suffix: string;
    if (n % 10) suffix = units[n % 10];
    else if (n % 100) suffix = tens[(n % 100) / 10];
    else suffix = n % 1000 ? "cü" : "ci";
    return `${n}-${suffix}`;
  }
  if (lang === "ru") return `${n}-е`;
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] || "th";
  return `${n}${s}`;
}

/** Medal colours for the podium; nothing below third. */
export function medal(place: number): "gold" | "silver" | "bronze" | null {
  return place === 1 ? "gold" : place === 2 ? "silver" : place === 3 ? "bronze" : null;
}

/** Prizes in the order a ceremony reads them: places first, then tracks, then the rest. */
export function sortPrizes<T extends { prize: Prize }>(rows: T[]): T[] {
  const rank = (k: PrizeKind) => (k === "place" ? 0 : k === "track" ? 1 : 2);
  return [...rows].sort((a, b) => rank(a.prize.kind) - rank(b.prize.kind) || (a.prize.position ?? 99) - (b.prize.position ?? 99) || a.prize.name.localeCompare(b.prize.name));
}

/** The words for an API error on the results screens: the key to look up, or null for the API's own sentence. */
export function resultsErrorKey(code: string | undefined | null): string | null {
  return code && (RESULTS_ERRORS as readonly string[]).includes(code) ? `rs.err.${code}` : null;
}
