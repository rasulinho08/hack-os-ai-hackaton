/**
 * The pricing page's and checkout's words for prices and discounts: every
 * string exists in AZ, EN and RU with the same {placeholders}, every key the
 * pages ask for is defined (the reasons a code is refused expanded from the
 * list the code uses), sentences are translated rather than copied, and the
 * registry serves them.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import en from "@/lib/i18n/pricing/en";
import az from "@/lib/i18n/pricing/az";
import ru from "@/lib/i18n/pricing/ru";
import { resolve } from "@/lib/i18n";
import { CLAIMS, COUPON_REASONS } from "@/lib/pricing";

const ROOT = join(__dirname, "..");
const SOURCES = [
  join(ROOT, "app", "(site)", "pricing", "page.tsx"),
  join(ROOT, "app", "(site)", "checkout", "page.tsx"),
];

const DYNAMIC: Record<string, string[]> = {
  "price.code.err.": [...COUPON_REASONS, "RATE_LIMITED", "generic"],
  "price.edu.": [...CLAIMS],
};

const ph = (s: string) => (s.match(/\{[a-z]+\}/g) || []).sort().join(",");

function usedKeys(): Set<string> {
  const used = new Set<string>();
  const literal = /["'`](price\.[A-Za-z0-9_.]*[A-Za-z0-9_])["'`]/g;
  for (const file of SOURCES) {
    for (const m of readFileSync(file, "utf8").matchAll(literal)) used.add(m[1]);
  }
  for (const [prefix, names] of Object.entries(DYNAMIC)) for (const n of names) used.add(prefix + n);
  return used;
}

describe("price and discount strings", () => {
  it("read every page they are used on", () => {
    expect(SOURCES.filter((f) => !existsSync(f))).toEqual([]);
  });

  it("are the same set of keys in AZ, EN and RU", () => {
    const keys = Object.keys(en).sort();
    expect(Object.keys(az).sort()).toEqual(keys);
    expect(Object.keys(ru).sort()).toEqual(keys);
  });

  it("are never empty and keep their {placeholders}", () => {
    for (const k of Object.keys(en)) {
      expect(en[k]?.trim().length, k).toBeGreaterThan(0);
      for (const dict of [az, ru]) {
        expect(dict[k]?.trim().length, k).toBeGreaterThan(0);
        expect(ph(dict[k]), k).toBe(ph(en[k]));
      }
    }
  });

  it("are translated, not English copies", () => {
    // Words outside the {placeholders}: "{name}: {value}" has none to translate.
    const words = (s: string) => s.replace(/\{[a-z]+\}/g, "").split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
    const same = (dict: Record<string, string>) => Object.keys(en).filter((k) => dict[k] === en[k] && words(en[k]) > 1);
    expect(same(az)).toEqual([]);
    expect(same(ru)).toEqual([]);
  });

  it("cover every key the pages use, and carry none they do not", () => {
    const used = usedKeys();
    expect([...used].filter((k) => !(k in en)).sort()).toEqual([]);
    expect(Object.keys(en).filter((k) => !used.has(k)).sort()).toEqual([]);
  });

  it("give every reason a code is refused its own sentence", () => {
    for (const reason of COUPON_REASONS) {
      const k = `price.code.err.${reason}`;
      for (const dict of [en, az, ru]) expect(dict[k], `${k}`).not.toBe(dict["price.code.err.generic"]);
    }
  });

  it("stay inside their own prefix, without clashing with another file's keys", async () => {
    expect(Object.keys(en).filter((k) => !k.startsWith("price."))).toEqual([]);
    const others = await Promise.all([
      import("@/lib/i18n/en"), import("@/lib/i18n/ops/en"), import("@/lib/i18n/results/en"), import("@/lib/i18n/account/en"),
    ]);
    for (const m of others) for (const k of Object.keys(en)) expect(k in m.default, k).toBe(false);
  });

  it("are served by the registry in each language", () => {
    for (const lang of ["en", "az", "ru"] as const) {
      const dict = { en, az, ru }[lang];
      for (const k of ["price.code.toggle", "price.code.err.COUPON_EXPIRED", "price.edu.label", "price.summary.discount"]) {
        expect(resolve(lang, k), `${lang} ${k}`).toBe(dict[k]);
      }
    }
  });
});
