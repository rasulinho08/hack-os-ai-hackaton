/**
 * Results and the stage (results, the big screen, elimination rounds,
 * presentations, submissions, a participant's results): every string exists
 * in AZ, EN and RU with the same {placeholders}, and every key the pages ask
 * for is defined — dynamic keys are expanded from the same lists the code uses.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import en from "@/lib/i18n/results/en";
import az from "@/lib/i18n/results/az";
import ru from "@/lib/i18n/results/ru";
import { CERTIFICATE_HOLDS, PRIZE_KINDS, RESULTS_ERRORS, SUBMISSION_STATUSES, VISIBILITIES } from "@/lib/results";
import { CANDIDATE_STATES, ELIMINATION_ERRORS, SKIP_REASONS } from "@/lib/elimination";
import { REPO_FLAGS, REPO_STATUSES } from "@/components/judging/RepoCheck";

const ROOT = join(__dirname, "..");
const SOURCES = [
  join(ROOT, "app", "(dashboard)", "results", "page.tsx"),
  join(ROOT, "components", "judging", "ScoreHistory.tsx"),
  join(ROOT, "components", "judging", "RepoCheck.tsx"),
  join(ROOT, "app", "(dashboard)", "leaderboard", "page.tsx"),
  join(ROOT, "app", "(dashboard)", "eliminate", "page.tsx"),
  join(ROOT, "app", "(dashboard)", "presentations", "page.tsx"),
  join(ROOT, "app", "(dashboard)", "submissions", "page.tsx"),
  join(ROOT, "app", "hacker", "results", "page.tsx"),
  join(ROOT, "lib", "results.ts"),
  join(ROOT, "lib", "elimination.ts"),
].filter(existsSync);

const PREFIXES = "(?:rs|lb|el|pr|sb|hr)";
const DYNAMIC: Record<string, string[]> = {
  "rs.vis.": [...VISIBILITIES],
  "rs.vis_hint.": [...VISIBILITIES],
  "rs.vis_effect.": [...VISIBILITIES],
  "lb.mode.": [...VISIBILITIES],
  "rs.kind.": [...PRIZE_KINDS],
  "rs.err.": [...RESULTS_ERRORS],
  "rs.certs_hold.": [...CERTIFICATE_HOLDS],
  "el.err.": [...ELIMINATION_ERRORS],
  "el.skip.": [...SKIP_REASONS],
  "el.state.": [...CANDIDATE_STATES],
  "pr.status.": ["waiting", "presenting", "done"],
  "pr.phase.": ["ready", "talk", "qa", "over"],
  "sb.status.": [...SUBMISSION_STATUSES],
  "sb.gh.": [...REPO_STATUSES, "not_checked"],
  "sb.gh.flag.": [...REPO_FLAGS],
};

describe("results and stage strings", () => {
  it("are the same set of keys in AZ, EN and RU", () => {
    const keys = Object.keys(en).sort();
    expect(Object.keys(az).sort()).toEqual(keys);
    expect(Object.keys(ru).sort()).toEqual(keys);
  });

  it("are never empty and keep their {placeholders}", () => {
    const ph = (s: string) => (s.match(/\{[a-z]+\}/g) || []).sort().join(",");
    for (const k of Object.keys(en)) {
      expect(en[k]?.trim().length, k).toBeGreaterThan(0);
      for (const dict of [az, ru]) {
        expect(dict[k]?.trim().length, k).toBeGreaterThan(0);
        expect(ph(dict[k]), k).toBe(ph(en[k]));
      }
    }
  });

  it("use only their own prefixes", () => {
    const own = new RegExp(`^${PREFIXES}\\.`);
    expect(Object.keys(en).filter((k) => !own.test(k))).toEqual([]);
  });

  it("cover every key the pages use", () => {
    const used = new Set<string>();
    const re = new RegExp(`\\bt\\(\\s*["\`](${PREFIXES}\\.[^"\`$]+)["\`]`, "g");
    const literal = new RegExp(`["'](${PREFIXES}\\.[A-Za-z0-9_.-]*[A-Za-z0-9_])["']`, "g");
    for (const file of SOURCES) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(re)) used.add(m[1]);
      for (const m of src.matchAll(literal)) used.add(m[1]);
    }
    for (const [prefix, names] of Object.entries(DYNAMIC)) for (const n of names) used.add(prefix + n);
    const missing = [...used].filter((k) => !(k in en)).sort();
    expect(missing).toEqual([]);
    expect(SOURCES.length).toBe(10);
    expect(used.size).toBeGreaterThan(280);
  });

  it("has no keys nothing uses", () => {
    const used = new Set<string>();
    const literal = new RegExp(`["'\`](${PREFIXES}\\.[A-Za-z0-9_.-]*[A-Za-z0-9_])["'\`]`, "g");
    for (const file of SOURCES) for (const m of readFileSync(file, "utf8").matchAll(literal)) used.add(m[1]);
    for (const [prefix, names] of Object.entries(DYNAMIC)) for (const n of names) used.add(prefix + n);
    expect(Object.keys(en).filter((k) => !used.has(k)).sort()).toEqual([]);
  });
});
