/**
 * The platform notice: every string exists in AZ, EN and RU with the same
 * {placeholders}, and every key the banner asks for is defined — the level
 * labels are expanded from the same list the banner uses.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "@/lib/i18n/platform/en";
import az from "@/lib/i18n/platform/az";
import ru from "@/lib/i18n/platform/ru";
import { NOTICE_LEVELS } from "@/lib/superadmin/owner";

const ROOT = join(__dirname, "..");
const SOURCES = [join(ROOT, "components", "notices", "PlatformNotice.tsx")];
const DYNAMIC: Record<string, string[]> = { "pn.label.": [...NOTICE_LEVELS] };

describe("platform notice strings", () => {
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

  it("cover every key the banner uses", () => {
    const used = new Set<string>();
    const re = /\bt\(\s*["`](pn\.[^"`$]+)["`]/g;
    for (const file of SOURCES) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(re)) used.add(m[1]);
    }
    for (const [prefix, names] of Object.entries(DYNAMIC)) for (const n of names) used.add(prefix + n);
    const missing = [...used].filter((k) => !(k in en)).sort();
    expect(missing).toEqual([]);
    expect(used.has("pn.dismiss")).toBe(true);
    expect(used.has("pn.until")).toBe(true);
  });
});
