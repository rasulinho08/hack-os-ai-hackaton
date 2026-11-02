/**
 * Elimination rounds read from the API, the candidate list (the live ranking,
 * the unscored, then teams without a project), and the suggested cut: keep the
 * best N, everyone tied at the cut stays, everyone without a place goes.
 */
import { describe, expect, it } from "vitest";
import { buildCandidates, eliminationErrorKey, keptBy, normalizeOutcome, normalizeRounds, suggestCut } from "@/lib/elimination";

// What GET …/elimination/suggest?keep=0 returns: the ranking, then the unscored.
const suggestion = {
  keep: 0,
  stays: [],
  eliminate: [
    { teamId: 1, teamName: "A", place: 1, score: 91 },
    { teamId: 2, teamName: "B", place: 2, score: 80 },
    { teamId: 3, teamName: "C", place: 2, score: 80 },
    { teamId: 4, teamName: "D", place: 4, score: 66.5 },
    { teamId: 5, teamName: "E", place: null, score: null },
  ],
};
const teams = [
  { id: 1, name: "A", member_count: 3, status: "active" },
  { id: 2, name: "B", members: [{}, {}], status: "active" },
  { id: 3, name: "C", member_count: 4 },
  { id: 4, name: "D", member_count: 2 },
  { id: 5, name: "E", member_count: 1 },
  { id: 6, name: "F", member_count: 2, status: "active" },
  { id: 7, name: "G", member_count: 2, status: "eliminated" },
];

describe("candidates", () => {
  const list = buildCandidates(suggestion, teams);

  it("are the ranking, then the unscored, then teams without a project", () => {
    expect(list.map((c) => [c.teamId, c.state])).toEqual([[1, "ranked"], [2, "ranked"], [3, "ranked"], [4, "ranked"], [5, "unscored"], [6, "no_project"]]);
    expect(list.find((c) => c.teamId === 2)?.members).toBe(2);
    expect(list.some((c) => c.teamId === 7), "an eliminated team is not a candidate").toBe(false);
  });

  it("survive nonsense", () => {
    expect(buildCandidates(null, null)).toEqual([]);
    expect(buildCandidates({ eliminate: [{ teamId: "x" }, { teamId: 2, place: "0" }] }, [])).toEqual([
      { teamId: 2, teamName: "#2", place: null, score: null, state: "unscored", members: 0 },
    ]);
  });
});

describe("the suggested cut", () => {
  const list = buildCandidates(suggestion, teams);

  it("keeps the best N and drops everyone without a place", () => {
    expect(suggestCut(list, 1)).toEqual([2, 3, 4, 5, 6]);
    expect(suggestCut(list, 3)).toEqual([4, 5, 6]);
  });

  it("keeps every team tied at the cut", () => {
    expect(suggestCut(list, 2), "B and C share 2nd place, so both stay").toEqual([4, 5, 6]);
    expect(keptBy(list, 2)).toBe(3);
  });

  it("keeping none eliminates everyone; keeping more than are ranked keeps all the ranked", () => {
    expect(suggestCut(list, 0)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(suggestCut(list, 10)).toEqual([5, 6]);
    expect(keptBy(list, 10)).toBe(4);
  });
});

describe("rounds and outcomes", () => {
  it("are read in position order with their teams", () => {
    const r = normalizeRounds({
      rounds: [
        { id: 9, name: "Final cut", position: 2, teams: [] },
        { id: 3, name: "Round 1", note: " After demos ", position: 1, createdAt: "2026-10-01T10:00:00Z", teams: [{ teamId: 4, teamName: "D", reason: "Below the cut", members: 2 }] },
        { name: "no id" },
      ],
      outsideRounds: [{ teamId: 7, teamName: "G", reason: null }],
    });
    expect(r.rounds.map((x) => x.id)).toEqual([3, 9]);
    expect(r.rounds[0]).toMatchObject({ name: "Round 1", note: "After demos", teams: [{ teamId: 4, reason: "Below the cut", members: 2 }] });
    expect(r.outsideRounds).toEqual([{ teamId: 7, teamName: "G", reason: null, eliminatedAt: null, members: 0 }]);
    expect(normalizeRounds(undefined)).toEqual({ rounds: [], outsideRounds: [] });
  });

  it("report the skipped teams with a known reason", () => {
    expect(normalizeOutcome({ eliminated: [1, "2", "x"], skipped: [{ teamId: 3, reason: "ALREADY_ELIMINATED" }, { teamId: 4, reason: "WEIRD" }] })).toEqual({
      eliminated: [1, 2],
      skipped: [{ teamId: 3, reason: "ALREADY_ELIMINATED" }, { teamId: 4, reason: "NOT_FOUND" }],
    });
  });

  it("explain the errors it knows", () => {
    expect(eliminationErrorKey("ROUND_IN_USE")).toBe("el.err.ROUND_IN_USE");
    expect(eliminationErrorKey("NOPE")).toBeNull();
  });
});
