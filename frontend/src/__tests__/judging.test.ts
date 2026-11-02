/**
 * Judging as the API serves it: the portal and organiser payloads are read
 * the same whatever their casing, links a judge opens are http(s) only, a
 * typed score is checked against its criterion, the weighted total matches
 * the results' sum, a review is sent whole, and the API's refusals map to
 * the criterion they concern.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import {
  canScore, completion, errorKey, judgesPerTeamCount, judgingError, judgingSettings, normalizeAssignments,
  normalizeConflicts, normalizeJudges, normalizeMyJudging, normalizeProgress, parseScore, reviewBody, safeLink,
  teamTitle, weightedPercent, type JudgingCriterion,
} from "@/lib/judging";

const criteria: JudgingCriterion[] = [
  { id: 1, name: "Innovation", description: null, maxScore: 10, weight: 2 },
  { id: 2, name: "Execution", description: null, maxScore: 10, weight: 1 },
];

describe("the judge's portal payload", () => {
  const raw = {
    event: { id: 7, name: "Baku Hack" },
    judge: { id: 3, trackId: null, coiConfirmedAt: null },
    config: { blind: true, assignment: "per_team", coiRequired: true },
    window: { state: "open", start: null, end: "2026-10-20T18:00:00.000Z" },
    criteria: [{ id: 1, name: "Innovation", maxScore: 10, weight: 2 }, { id: "x" }, { id: 2, name: "Execution", maxScore: "5", weight: 0 }],
    teams: [
      {
        teamId: 11, submissionId: 21, number: 2, teamName: null, projectName: "Qovluq",
        repoLink: "github.com/a/b", demoLink: "javascript:alert(1)", slidesLink: "https://s.example/x",
        files: [{ id: "abc", filename: "deck.pdf", size: 1200 }, { id: 5 }],
        scores: { 1: 8, 2: "", x: 3 }, feedback: "Good", state: "partial",
      },
      { teamId: 12 },
    ],
    conflicts: [{ teamId: 13, number: 4, projectName: "Other", reason: "mentored them" }],
    progress: { total: 1, done: 0, partial: 1 },
  };
  const m = normalizeMyJudging(raw);

  it("keeps what the screens need and drops what they cannot use", () => {
    expect(m.event).toEqual({ id: 7, name: "Baku Hack" });
    expect(m.config).toEqual({ blind: true, assignment: "per_team", coiRequired: true });
    expect(m.criteria.map((c) => [c.id, c.maxScore, c.weight])).toEqual([[1, 10, 2], [2, 5, 1]]);
    expect(m.teams).toHaveLength(1);
    const t = m.teams[0];
    expect(t.teamName).toBeNull();
    expect(t.repoLink).toBe("https://github.com/a/b");
    expect(t.demoLink).toBeNull();
    expect(t.slidesLink).toBe("https://s.example/x");
    expect(t.files).toEqual([{ id: "abc", filename: "deck.pdf", size: 1200 }]);
    expect(t.scores).toEqual({ 1: 8 });
    expect(t.state).toBe("partial");
    expect(m.conflicts[0]).toMatchObject({ teamId: 13, number: 4, reason: "mentored them" });
  });

  it("knows when a judge may score", () => {
    expect(canScore(m)).toEqual({ ok: false, reason: "coi" });
    expect(canScore({ ...m, judge: { ...m.judge, coiConfirmedAt: "2026-10-19T10:00:00Z" } })).toEqual({ ok: true, reason: null });
    expect(canScore({ ...m, window: { ...m.window, state: "published" } })).toEqual({ ok: false, reason: "published" });
  });

  it("falls back to safe defaults on an empty answer", () => {
    const empty = normalizeMyJudging(null);
    expect(empty.teams).toEqual([]);
    expect(empty.window.state).toBe("open");
    expect(empty.config.assignment).toBe("all");
  });

  it("names a project by its number, never by a hidden team name", () => {
    expect(teamTitle({ number: 3, projectName: "Qovluq", teamName: null }, "Untitled")).toBe("#3 · Qovluq");
    expect(teamTitle({ number: 3, projectName: null, teamName: null }, "Untitled")).toBe("#3 · Untitled");
  });
});

describe("links a judge opens", () => {
  it("are http(s) only", () => {
    expect(safeLink("https://x.example")).toBe("https://x.example");
    expect(safeLink("x.example/repo")).toBe("https://x.example/repo");
    expect(safeLink("javascript:alert(1)")).toBeNull();
    expect(safeLink("data:text/html,hi")).toBeNull();
    expect(safeLink("  ")).toBeNull();
  });
});

describe("scores in the review form", () => {
  it("are numbers from 0 to the maximum, with a comma or a point", () => {
    expect(parseScore("", 10)).toBeNull();
    expect(parseScore("7", 10)).toBe(7);
    expect(parseScore("7,5", 10)).toBe(7.5);
    expect(parseScore("10", 10)).toBe(10);
    expect(parseScore("10.5", 10)).toBe("invalid");
    expect(parseScore("-1", 10)).toBe("invalid");
    expect(parseScore("abc", 10)).toBe("invalid");
    expect(parseScore("1e1", 10)).toBe("invalid");
  });

  it("add up the way the results do: Σ(score × weight) ÷ Σ(max × weight)", () => {
    // (8×2 + 6×1) / (10×2 + 10×1) = 22/30 → 73.3
    expect(weightedPercent(criteria, { 1: 8, 2: 6 })).toBe(73.3);
    expect(weightedPercent(criteria, { 1: 10, 2: 10 })).toBe(100);
    expect(weightedPercent(criteria, { 1: 8 })).toBeNull();
    expect(weightedPercent([], {})).toBeNull();
  });

  it("are sent whole, or not at all when one is wrong", () => {
    expect(reviewBody(21, criteria, { 1: "8", 2: "" }, "Nice")).toEqual({ submissionId: 21, scores: [{ criterionId: 1, score: 8 }], feedback: "Nice" });
    expect(reviewBody(21, criteria, { 1: "11", 2: "x" }, "")).toEqual({ invalid: [1, 2] });
    const long = reviewBody(21, criteria, {}, "a".repeat(5000));
    expect("feedback" in long && long.feedback.length).toBe(4000);
  });
});

describe("the API's refusals", () => {
  it("point at the criterion they concern", () => {
    const err = new ApiError("Some scores are not valid.", 400, [
      { field: "scores.1", code: "SCORE_OUT_OF_RANGE", message: "Between 0 and 10." },
      { field: "scores.9", code: "UNKNOWN_CRITERION" },
      { field: "name", code: "REQUIRED" },
    ], "VALIDATION_ERROR");
    expect(judgingError(err)).toEqual({ code: "VALIDATION_ERROR", byCriterion: { 1: "SCORE_OUT_OF_RANGE", 9: "UNKNOWN_CRITERION" } });
    expect(judgingError(new Error("x"))).toEqual({ code: null, byCriterion: {} });
  });

  it("are worded by their code when it is one we know", () => {
    expect(errorKey("jp.err.", new ApiError("closed", 403, [], "JUDGING_CLOSED"), "jp.failed")).toBe("jp.err.JUDGING_CLOSED");
    expect(errorKey("jp.err.", new ApiError("?", 500, [], "SOMETHING_NEW"), "jp.failed")).toBe("jp.failed");
    expect(errorKey("jp.err.", new Error("network"), "jp.failed")).toBe("jp.failed");
  });
});

describe("the organiser's side", () => {
  it("reads the judges, the matrix, assignments and conflicts", () => {
    expect(normalizeJudges([{ id: 4, user_id: 9, full_name: "Nigar", email: "n@x.az", track_id: 2, coi_confirmed_at: null }, { id: null }]))
      .toEqual([{ id: 4, userId: 9, name: "Nigar", email: "n@x.az", trackId: 2, coiConfirmedAt: null }]);

    const p = normalizeProgress({
      config: { assignment: "track", judgesPerTeam: "2", blind: 0, coiRequired: 1 },
      window: { state: "closed", end: "2026-10-20T18:00:00Z" },
      criteria: 3,
      judges: [{ id: 4, name: "Nigar", assigned: 2, done: 1, partial: 1 }],
      teams: [{ id: 11, name: "Kod", projectName: "Qovluq", submissionId: 21, eliminated: false, done: 1, partial: 0, assigned: 1 }],
      cells: [{ judgeId: 4, teamId: 11, state: "done" }, { judgeId: 4, teamId: 12, state: "weird" }],
    });
    expect(p.config).toEqual({ assignment: "track", judgesPerTeam: 2, blind: false, coiRequired: true });
    expect(p.window.state).toBe("closed");
    expect(p.cells).toEqual({ "4:11": "done", "4:12": "na" });
    expect(completion(1, 2)).toBe(50);
    expect(completion(0, 0)).toBeNull();

    const a = normalizeAssignments({ 4: [11, "12", 12, null], x: [1], 5: [11] });
    expect(a).toEqual({ 4: [11, 12], 5: [11] });
    expect(judgesPerTeamCount(a)).toEqual({ 11: 2, 12: 1 });

    expect(normalizeConflicts([{ id: 1, judge_id: 4, team_id: 11, reason: null, judge_name: "Nigar", team_name: "Kod", by_judge: true }]))
      .toEqual([{ id: 1, judgeId: 4, teamId: 11, reason: null, createdAt: null, judgeName: "Nigar", teamName: "Kod", byJudge: true }]);
  });

  it("fills in the judging settings the API defaults to", () => {
    expect(judgingSettings(undefined)).toEqual({
      blind: false, assignment: "all", judgesPerTeam: 3, resultsVisibility: "own_and_winners", coiRequired: false, showScores: false,
    });
    expect(judgingSettings({ assignment: "per_team", judgesPerTeam: 99, showScores: true }).judgesPerTeam).toBe(20);
  });
});

describe("the walkthrough's judges page", () => {
  it("answers the progress matrix, assignments and conflicts from the sample rows", async () => {
    const { resolveJudgingDemo } = await import("@/lib/demo/judging");
    const { DEMO_JUDGES, DEMO_SUBMISSIONS } = await import("@/lib/demo/console");
    const p = normalizeProgress(resolveJudgingDemo(["events", "1", "judging", "progress"]));
    expect(p.judges).toHaveLength(DEMO_JUDGES.length);
    expect(p.teams).toHaveLength(DEMO_SUBMISSIONS.length);
    const states = Object.values(p.cells);
    expect(states).toContain("done");
    expect(states).toContain("todo");
    expect(states.filter((x) => x === "conflict")).toHaveLength(1);
    expect(p.window.state).toBe("open");
    const conflicts = normalizeConflicts(resolveJudgingDemo(["events", "1", "judging", "conflicts"]));
    expect(conflicts[0].byJudge).toBe(true);
    expect(p.cells[`${conflicts[0].judgeId}:${conflicts[0].teamId}`]).toBe("conflict");
    expect(resolveJudgingDemo(["events", "1", "judging", "assignments"])).toEqual({});
    // The judges list itself comes from the general router.
    expect(resolveJudgingDemo(["events", "1", "judging", "judges"])).toBeUndefined();
    expect(resolveJudgingDemo(["teams"])).toBeUndefined();
  });
});
