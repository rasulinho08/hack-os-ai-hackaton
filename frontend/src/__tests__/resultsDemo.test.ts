/**
 * The walkthrough's results, rounds and cut suggestion: shaped like the API's,
 * worked out the API's way from the sample scores, so /demo/results,
 * /demo/leaderboard and /demo/eliminate show a real-looking ranking.
 */
import { describe, expect, it } from "vitest";
import { resolveResultsDemo } from "@/lib/demo/results";
import { resolveDemoRead } from "@/lib/demo/resolve";
import { DEMO_TEAMS } from "@/lib/demo/console";
import { normalizeOrganiserResults } from "@/lib/results";
import { buildCandidates, normalizeRounds } from "@/lib/elimination";

describe("walkthrough results", () => {
  const r = normalizeOrganiserResults(resolveDemoRead("/api/events/1/results"));

  it("rank the active teams with scores, best first, ties sharing a place", () => {
    expect(r.ranking.length).toBeGreaterThan(5);
    expect(r.ranking[0].place).toBe(1);
    for (let i = 1; i < r.ranking.length; i += 1) {
      expect(r.ranking[i].score ?? 0).toBeLessThanOrEqual(r.ranking[i - 1].score ?? 0);
      expect(r.ranking[i].place).toBeGreaterThanOrEqual(r.ranking[i - 1].place);
    }
    expect(r.ranking.every((x) => (x.score ?? -1) >= 0 && (x.score ?? 101) <= 100)).toBe(true);
    const eliminated = DEMO_TEAMS.filter((t) => t.status === "eliminated").map((t) => t.id);
    expect(r.ranking.some((x) => eliminated.includes(x.teamId)), "eliminated teams are not ranked").toBe(false);
    expect(r.eliminated.map((x) => x.teamId).sort()).toEqual([...eliminated].sort());
  });

  it("are not published, list the unscored, the prizes and every judge's review", () => {
    expect(r.published).toBeNull();
    expect(r.unscored.length).toBeGreaterThan(0);
    expect(r.prizes.find((p) => p.prize.kind === "place" && p.prize.position === 1)?.teams[0]?.teamId).toBe(r.ranking[0].teamId);
    expect(r.reviews.length).toBeGreaterThan(r.ranking.length);
  });

  it("answer the rounds and the cut suggestion", () => {
    const rounds = normalizeRounds(resolveDemoRead("/api/events/1/elimination/rounds"));
    expect(rounds.rounds).toHaveLength(1);
    const candidates = buildCandidates(resolveDemoRead("/api/events/1/elimination/suggest?keep=0"), resolveDemoRead("/api/teams?eventId=1"));
    expect(candidates.filter((c) => c.state === "ranked")).toHaveLength(r.ranking.length);
    expect(candidates.filter((c) => c.state === "unscored")).toHaveLength(r.unscored.length);
  });

  it("leave other paths alone", () => {
    expect(resolveResultsDemo(["events", "1", "results", "me"])).toBeUndefined();
    expect(resolveResultsDemo(["teams"])).toBeUndefined();
  });
});
