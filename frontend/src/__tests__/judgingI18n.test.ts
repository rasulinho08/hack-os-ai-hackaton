/**
 * Judging (the organiser's judges page and the judge's portal): every string
 * exists in AZ, EN and RU with the same {placeholders}, every key the pages
 * ask for is defined — dynamic keys are expanded from the same lists the
 * code uses — and none of them shadows a key of another dictionary.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "@/lib/i18n/judging/en";
import az from "@/lib/i18n/judging/az";
import ru from "@/lib/i18n/judging/ru";
import coreEn from "@/lib/i18n/en";
import builderEn from "@/lib/i18n/builder/en";
import opsEn from "@/lib/i18n/ops/en";
import { ASSIGNMENT_MODES, CELL_STATES, JUDGES_TABS, JUDGING_ERROR_CODES, REVIEW_STATES, WINDOW_STATES } from "@/lib/judging";

const ROOT = join(__dirname, "..");
const SOURCES = [
  join(ROOT, "app", "(dashboard)", "judges", "page.tsx"),
  join(ROOT, "app", "judge", "page.tsx"),
  join(ROOT, "lib", "judging.ts"),
];

const PREFIXES = "(?:jg|jp)";
const DYNAMIC: Record<string, string[]> = {
  "jg.tab.": [...JUDGES_TABS],
  "jg.cell.": [...CELL_STATES],
  "jg.mode.": [...ASSIGNMENT_MODES],
  "jg.mode_hint.": [...ASSIGNMENT_MODES],
  "jg.window.": [...WINDOW_STATES],
  "jg.window_hint.": [...WINDOW_STATES],
  "jg.err.": [...JUDGING_ERROR_CODES],
  "jp.err.": [...JUDGING_ERROR_CODES],
  "jp.filter.": ["all", ...REVIEW_STATES],
  "jp.state.": [...REVIEW_STATES],
  "jp.window.": [...WINDOW_STATES],
};

describe("judging strings", () => {
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

  it("cover every key the pages use", () => {
    const used = new Set<string>();
    const re = new RegExp(`\\bt\\(\\s*["\`](${PREFIXES}\\.[^"\`$]+)["\`]`, "g");
    // Keys handed around as plain strings (to errorKey, a fallback) count too.
    const literal = new RegExp(`["'](${PREFIXES}\\.[A-Za-z0-9_.-]*[A-Za-z0-9_])["']`, "g");
    for (const file of SOURCES) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(re)) used.add(m[1]);
      for (const m of src.matchAll(literal)) used.add(m[1]);
    }
    for (const [prefix, names] of Object.entries(DYNAMIC)) for (const n of names) used.add(prefix + n);
    const missing = [...used].filter((k) => !(k in en)).sort();
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(250);
  });

  it("do not shadow the app's other strings", () => {
    const others = new Set([...Object.keys(coreEn), ...Object.keys(builderEn), ...Object.keys(opsEn)]);
    expect(Object.keys(en).filter((k) => others.has(k))).toEqual([]);
  });
});
