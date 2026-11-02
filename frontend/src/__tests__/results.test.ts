/**
 * Results read from the API: the organiser's payload and a participant's,
 * odd values defused, ties marked in a published ranking, drift between the
 * published and the live ranking, a judge's own score, ordinals per language.
 */
import { describe, expect, it } from "vitest";
import {
  bigScreenView, formatScore, isCompleteReview, judgeScore, medal, normalizeOrganiserResults, normalizeParticipantResults, ordinal, publishRefusal,
  resultsErrorKey, reviewsOf, snapshotChanges, sortPrizes,
} from "@/lib/results";

const criteria = [{ id: 1, name: "Innovation", max: 10, weight: 2 }, { id: 2, name: "Execution", max: 10, weight: 1 }];
const row = (teamId: number, place: number, score: number, extra: Record<string, unknown> = {}) => ({
  teamId, teamName: `Team ${teamId}`, projectName: `Project ${teamId}`, submissionId: 100 + teamId, trackId: null, track: null,
  score, judgesCount: 2, place, tie: false, breakdown: [{ criterionId: 1, name: "Innovation", max: 10, weight: 2, avg: 8 }], ...extra,
});

const organiser = (over: Record<string, unknown> = {}) => normalizeOrganiserResults({
  published: null,
  settings: { visibility: "own_and_winners", showScores: false },
  criteria,
  ranking: [row(2, 2, 70), row(1, 1, 90), row(3, 2, 70)],
  unscored: [{ teamId: 9, teamName: "Late", projectName: null }],
  eliminated: [],
  snapshot: null,
  prizes: [
    { prize: { id: 5, name: "Audience", kind: "special", manual: true }, teams: [{ teamId: 3, teamName: "Team 3" }] },
    { prize: { id: 1, name: "Grand", kind: "place", position: 1 }, teams: [{ teamId: 1, teamName: "Team 1", place: 1 }] },
    { prize: { id: 7, name: "AI track", kind: "track", trackId: 4 }, teams: [] },
  ],
  reviews: [
    { teamId: 1, judgeId: 11, judgeName: "Zaur", scores: { 1: 9, 2: 6 }, feedback: "Strong" },
    { teamId: 1, judgeId: 10, judgeName: "Aysel", scores: { 1: 10 }, feedback: "" },
  ],
  ...over,
});

describe("the organiser's results", () => {
  it("are read into one shape, in place order", () => {
    const r = organiser();
    expect(r.ranking.map((x) => x.teamId)).toEqual([1, 2, 3]);
    expect(r.ranking[0].breakdown[0]).toEqual({ criterionId: 1, name: "Innovation", max: 10, weight: 2, avg: 8 });
    expect(r.unscored[0]).toEqual({ teamId: 9, teamName: "Late", projectName: null, trackId: null, track: null });
    expect(r.criteria).toEqual(criteria);
    expect(r.reviews[1].feedback).toBeNull();
    expect(r.snapshot).toBeNull();
  });

  it("mark teams sharing a place as tied", () => {
    const r = organiser();
    expect(r.ranking.map((x) => x.tie)).toEqual([false, true, true]);
  });

  it("survive nonsense", () => {
    const r = normalizeOrganiserResults({ ranking: [{ teamId: "x" }, { teamId: 4, place: 0 }, null], reviews: "no", prizes: [{ prize: {} }] });
    expect(r.ranking).toEqual([]);
    expect(r.reviews).toEqual([]);
    expect(r.prizes).toEqual([]);
    expect(r.settings).toEqual({ visibility: "own_and_winners", showScores: false });
    expect(normalizeOrganiserResults(null).published).toBeNull();
  });

  it("keep the published ranking only once published", () => {
    expect(organiser({ snapshot: [row(1, 1, 90)] }).snapshot).toBeNull();
    const p = organiser({ published: { at: "2026-10-01T10:00:00Z", visibility: "full", showScores: true }, snapshot: [row(1, 1, 90), row(2, 1, 90)] });
    expect(p.published).toEqual({ at: "2026-10-01T10:00:00Z", visibility: "full", showScores: true, outdatedConfirmed: null });
    expect(p.snapshot?.map((x) => x.tie)).toEqual([true, true]);
  });

  it("the big screen shows nothing before publication unless the live preview is on", () => {
    const live = organiser();
    const waiting = bigScreenView(live, { livePreview: false, hideScores: false });
    expect(waiting.mode).toBe("waiting");
    expect(waiting.rows).toEqual([]);
    expect(waiting.showScores).toBe(false);
    const preview = bigScreenView(live, { livePreview: true, hideScores: false });
    expect(preview.mode).toBe("live_preview");
    expect(preview.rows.map((x) => x.teamId)).toEqual([1, 2, 3]);
    expect(preview.showScores).toBe(true);
    expect(bigScreenView(live, { livePreview: true, hideScores: true }).showScores).toBe(false);
  });

  it("after publication the big screen shows what was published: the full table, with scores only if published", () => {
    const at = "2026-10-01T10:00:00Z";
    const full = organiser({ published: { at, visibility: "full", showScores: true }, snapshot: [row(7, 1, 50)] });
    const v = bigScreenView(full, { livePreview: true, hideScores: false });
    expect(v.mode).toBe("ranking");
    expect(v.rows).toEqual(full.snapshot);
    expect([v.showScores, v.scoresLocked]).toEqual([true, false]);
    expect(bigScreenView(full, { livePreview: false, hideScores: true }).showScores).toBe(false);

    const hidden = organiser({ published: { at, visibility: "full", showScores: false }, snapshot: [row(7, 1, 50)] });
    const h = bigScreenView(hidden, { livePreview: false, hideScores: false });
    expect([h.mode, h.showScores, h.scoresLocked]).toEqual(["ranking", false, true]);
  });

  it("published as own place and winners, or winners only, the big screen shows the winners and no ranking", () => {
    const at = "2026-10-01T10:00:00Z";
    for (const visibility of ["own_and_winners", "winners"] as const) {
      const r = organiser({ published: { at, visibility, showScores: true }, snapshot: [row(1, 1, 90), row(2, 2, 70)] });
      const v = bigScreenView(r, { livePreview: true, hideScores: false });
      expect(v.mode).toBe("winners");
      expect(v.rows).toEqual([]);
      expect(v.showScores).toBe(false);
      expect(v.winners.map((w) => w.prize.name)).toEqual(["Grand", "Audience"]);
    }
  });

  it("say what moved since publishing", () => {
    const same = organiser({ published: { at: "2026-10-01T10:00:00Z" }, snapshot: [row(1, 1, 90), row(2, 2, 70), row(3, 2, 70)] });
    expect(snapshotChanges(same)).toEqual([]);
    const moved = organiser({ published: { at: "2026-10-01T10:00:00Z" }, snapshot: [row(1, 1, 90), row(2, 2, 71), row(8, 3, 60)] });
    expect(snapshotChanges(moved)).toEqual([
      { teamId: 2, teamName: "Team 2", from: 2, to: 2 },
      { teamId: 3, teamName: "Team 3", from: null, to: 2 },
      { teamId: 8, teamName: "Team 8", from: 3, to: null },
    ]);
    expect(snapshotChanges(organiser()), "nothing published, nothing drifts").toEqual([]);
  });

  it("list a team's reviews by judge name and score a judge like the ranking does", () => {
    const r = organiser();
    expect(reviewsOf(r.reviews, 1).map((x) => x.judgeName)).toEqual(["Aysel", "Zaur"]);
    // (9×2 + 6×1) / (10×2 + 10×1) = 24/30
    expect(judgeScore(r.reviews[0], criteria)).toBe(80);
    // A review missing a criterion does not count yet (not 20/20 = 100).
    expect(isCompleteReview(r.reviews[1], criteria)).toBe(false);
    expect(judgeScore(r.reviews[1], criteria)).toBeNull();
    expect(isCompleteReview(r.reviews[0], criteria)).toBe(true);
    expect(judgeScore({ teamId: 1, judgeId: 1, judgeName: "x", scores: {}, feedback: null, changed: 0 }, criteria)).toBeNull();
  });

  it("carry the partial reviews and the teams that are not eligible", () => {
    const r = organiser({
      unscored: [{ teamId: 9, teamName: "Late", projectName: null, partialReviews: 2 }],
      ineligible: [{ teamId: 12, teamName: "Gamma", projectName: "Pending project" }, { teamName: "no id" }],
      incomplete: [{ teamId: 9, judgeId: 10, filled: 1, of: 2 }, { teamId: "x" }],
    });
    expect(r.unscored[0].partialReviews).toBe(2);
    expect(r.ineligible.map((x) => x.teamId)).toEqual([12]);
    expect(r.incomplete).toEqual([{ teamId: 9, judgeId: 10, filled: 1, of: 2 }]);
    expect(organiser().ineligible).toEqual([]);
    expect(organiser().incomplete).toEqual([]);
  });

  it("read what a refusal to publish carries", () => {
    expect(publishRefusal("SUBMISSIONS_OPEN", [{ field: "closesAt", message: "2026-10-24T12:00:00.000Z" }]))
      .toEqual({ code: "SUBMISSIONS_OPEN", closesAt: "2026-10-24T12:00:00.000Z" });
    expect(publishRefusal("SUBMISSIONS_OPEN", [{ field: "closesAt", message: "soon" }])).toEqual({ code: "SUBMISSIONS_OPEN", closesAt: null });
    expect(publishRefusal("JUDGING_INCOMPLETE", [{ field: "todo", message: "2" }, { field: "partial", message: "1" }]))
      .toEqual({ code: "JUDGING_INCOMPLETE", todo: 2, partial: 1 });
    expect(publishRefusal("JUDGING_INCOMPLETE", [])).toEqual({ code: "JUDGING_INCOMPLETE", todo: 0, partial: 0 });
    expect(publishRefusal("NO_SCORES", [])).toBeNull();
    expect(resultsErrorKey("JUDGING_INCOMPLETE")).toBe("rs.err.JUDGING_INCOMPLETE");
  });

  it("order prizes as a ceremony reads them", () => {
    expect(sortPrizes(organiser().prizes).map((p) => p.prize.id)).toEqual([1, 7, 5]);
  });
});

describe("a participant's results", () => {
  it("are nothing before publishing", () => {
    expect(normalizeParticipantResults({ published: null })).toEqual({ published: null, mine: null, winners: [], leaderboard: null });
  });

  it("carry their place, scores and feedback when shown", () => {
    const r = normalizeParticipantResults({
      published: { at: "2026-10-01T10:00:00Z", visibility: "own_and_winners", showScores: true },
      mine: { teamId: 3, teamName: "Kod", place: 2, of: 9, score: 81.5, breakdown: [{ criterionId: 1, name: "Innovation", max: 10, weight: 1, avg: 8.2 }], feedback: ["Good", "", null], won: [{ id: 4, name: "Best UX", kind: "special" }] },
      winners: [{ prize: { id: 4, name: "Best UX", kind: "special" }, teams: [{ teamId: 3, teamName: "Kod" }] }, { prize: { id: 6, name: "Empty" }, teams: [] }],
      leaderboard: null,
    });
    expect(r.mine).toMatchObject({ teamId: 3, place: 2, of: 9, score: 81.5, feedback: ["Good"] });
    expect(r.mine?.won.map((p) => p.name)).toEqual(["Best UX"]);
    expect(r.winners.map((w) => w.prize.id), "prizes nobody won are left out").toEqual([4]);
  });

  it("show no place and no scores when only the winners are published", () => {
    const r = normalizeParticipantResults({
      published: { at: "2026-10-01T10:00:00Z", visibility: "winners", showScores: false },
      mine: { teamId: 3, teamName: "Kod", place: null, of: null, score: null, breakdown: null, feedback: null, won: [] },
      winners: [],
      leaderboard: null,
    });
    expect(r.mine).toMatchObject({ place: null, of: null, score: null, breakdown: null, feedback: null });
  });

  it("read the full leaderboard in place order", () => {
    const r = normalizeParticipantResults({
      published: { at: "2026-10-01T10:00:00Z", visibility: "full", showScores: false },
      mine: null,
      winners: [],
      leaderboard: [{ place: 2, teamId: 5, teamName: "B", score: null }, { place: 1, teamId: 4, teamName: "A", score: null }, { place: "x", teamId: 1 }],
    });
    expect(r.leaderboard?.map((x) => x.teamId)).toEqual([4, 5]);
  });
});

describe("small rules", () => {
  it("write scores with at most two decimals", () => {
    expect(formatScore(87.5)).toBe("87.5");
    expect(formatScore(100)).toBe("100");
    expect(formatScore(62.256)).toBe("62.26");
    expect(formatScore(null)).toBe("—");
    expect(formatScore(Number.NaN)).toBe("—");
  });

  it("write places as each language does", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map((n) => ordinal(n, "en"))).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 60, 90, 100].map((n) => ordinal(n, "az"))).toEqual([
      "1-ci", "2-ci", "3-cü", "4-cü", "5-ci", "6-cı", "7-ci", "8-ci", "9-cu", "10-cu", "20-ci", "30-cu", "40-cı", "60-cı", "90-cı", "100-cü",
    ]);
    expect(ordinal(3, "ru")).toBe("3-е");
  });

  it("give medals to the podium only", () => {
    expect([1, 2, 3, 4].map(medal)).toEqual(["gold", "silver", "bronze", null]);
  });

  it("explain the errors it knows and leave the rest to the API's words", () => {
    expect(resultsErrorKey("NO_SCORES")).toBe("rs.err.NO_SCORES");
    expect(resultsErrorKey("SOMETHING_ELSE")).toBeNull();
    expect(resultsErrorKey(undefined)).toBeNull();
  });
});
