/**
 * People's choice: the API payloads read safely (no counts reach the
 * participant's view, only http(s) links become links), the error codes map
 * to words, and every string exists in AZ, EN and RU with the same
 * {placeholders}, every key the pages use included.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "@/lib/i18n/voting/en";
import az from "@/lib/i18n/voting/az";
import ru from "@/lib/i18n/voting/ru";
import { VOTE_ERRORS, VOTING_STATES, normalizeMyVoting, normalizeTally, voteErrorKey } from "@/lib/voting";

const ROOT = join(__dirname, "..");
const SOURCES = [
  join(ROOT, "app", "hacker", "vote", "page.tsx"),
  join(ROOT, "components", "voting", "VoteCallout.tsx"),
  join(ROOT, "components", "voting", "VoteTally.tsx"),
  join(ROOT, "lib", "voting.ts"),
];
const DYNAMIC: Record<string, readonly string[]> = { "vo.err.": VOTE_ERRORS, "vo.state.": VOTING_STATES };

describe("a participant's voting payload", () => {
  it("reads the projects and the vote, and nothing it does not know", () => {
    const v = normalizeMyVoting({
      enabled: true, state: "open", opensAt: "2026-11-01T09:00:00Z", eligible: true, myVote: "12",
      candidates: [
        { submissionId: 12, teamId: 3, teamName: "Xəzər", projectName: "SəsKöməkçi", description: "Səsli köməkçi",
          repoLink: "https://github.com/x/y", demoLink: "javascript:alert(1)", videoLink: null, track: "Fintex", votes: 9 },
        { teamName: "no id" },
      ],
    });
    expect(v.state).toBe("open");
    expect(v.myVote).toBe(12);
    expect(v.candidates).toHaveLength(1);
    expect(v.candidates[0].repoLink).toBe("https://github.com/x/y");
    expect(v.candidates[0].demoLink).toBeNull();
    expect("votes" in v.candidates[0]).toBe(false);
  });

  it("falls back to 'off' for anything unexpected", () => {
    expect(normalizeMyVoting(null)).toEqual({ enabled: false, state: "off", opensAt: null, eligible: false, candidates: [], myVote: null });
    expect(normalizeMyVoting({ enabled: true, state: "weird" }).state).toBe("off");
  });
});

describe("the organiser's count", () => {
  it("keeps the order, clamps shares and drops rows without a project", () => {
    const t = normalizeTally({
      enabled: true, state: "closed", eligible: 40, voters: 3,
      tally: [{ submissionId: 1, teamName: "A", votes: 2, share: 66.7 }, { submissionId: 2, teamName: "B", votes: -1, share: 140 }, { teamName: "C" }],
    });
    expect(t.tally.map((r) => [r.submissionId, r.votes, r.share])).toEqual([[1, 2, 66.7], [2, 0, 100]]);
    expect(t.eligible).toBe(40);
  });
});

describe("error words", () => {
  it("are found for the API's codes only", () => {
    expect(voteErrorKey("OWN_TEAM")).toBe("vo.err.OWN_TEAM");
    expect(voteErrorKey("SOMETHING_ELSE")).toBeNull();
    expect(voteErrorKey(undefined)).toBeNull();
  });
});

describe("people's choice strings", () => {
  it("are the same set of keys in AZ, EN and RU, never empty, with the same {placeholders}", () => {
    const keys = Object.keys(en).sort();
    expect(Object.keys(az).sort()).toEqual(keys);
    expect(Object.keys(ru).sort()).toEqual(keys);
    const ph = (s: string) => (s.match(/\{[a-z]+\}/g) || []).sort().join(",");
    for (const k of keys) {
      for (const dict of [az, ru]) {
        expect(dict[k]?.trim().length, k).toBeGreaterThan(0);
        expect(ph(dict[k]), k).toBe(ph(en[k]));
      }
    }
  });

  it("cover every key the pages use", () => {
    const used = new Set<string>();
    const re = /\bt\(\s*["`](vo\.[^"`$]+)["`]/g;
    for (const file of SOURCES) for (const m of readFileSync(file, "utf8").matchAll(re)) used.add(m[1]);
    for (const [prefix, names] of Object.entries(DYNAMIC)) for (const n of names) used.add(prefix + n);
    expect([...used].filter((k) => !(k in en)).sort()).toEqual([]);
    expect(used.size).toBeGreaterThan(30);
  });
});
