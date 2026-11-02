/**
 * The organiser's Invitations screen (iv.*): every string exists in AZ, EN
 * and RU with the same {placeholders}, and every key the screens ask for is
 * defined — dynamic keys are expanded from the same lists the code uses.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import en from "@/lib/i18n/invites/en";
import az from "@/lib/i18n/invites/az";
import ru from "@/lib/i18n/invites/ru";
import { resolve } from "@/lib/i18n";
import { INVITE_ERRORS, INVITE_STATUSES, SKIP_REASONS } from "@/lib/participantInvites";

const ROOT = join(__dirname, "..");
const SOURCES = [
  join(ROOT, "app", "(dashboard)", "invitations", "page.tsx"),
  join(ROOT, "app", "(dashboard)", "participants", "page.tsx"),
  join(ROOT, "lib", "participantInvites.ts"),
].filter(existsSync);

const DYNAMIC: Record<string, string[]> = {
  "iv.status.": [...INVITE_STATUSES],
  "iv.skip.": [...SKIP_REASONS],
  "iv.err.": [...INVITE_ERRORS],
  "iv.vis.": ["public", "private", "invite"],
};

describe("invitation strings", () => {
  it("are the same set of keys in AZ, EN and RU", () => {
    const keys = Object.keys(en).sort();
    expect(Object.keys(az).sort()).toEqual(keys);
    expect(Object.keys(ru).sort()).toEqual(keys);
  });

  it("are never empty and keep their {placeholders}", () => {
    const ph = (s: string) => (s.match(/\{[a-z]+\}/g) || []).sort().join(",");
    for (const k of Object.keys(en)) {
      for (const dict of [az, ru]) {
        expect(dict[k]?.trim().length, k).toBeGreaterThan(0);
        expect(ph(dict[k]), k).toBe(ph(en[k]));
      }
    }
  });

  it("cover every key the screens use", () => {
    const used = new Set<string>();
    const call = /\bt\(\s*["`](iv\.[^"`$]+)["`]/g;
    const literal = /["'](iv\.[A-Za-z0-9_.-]*[A-Za-z0-9_])["']/g;
    for (const file of SOURCES) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(call)) used.add(m[1]);
      for (const m of src.matchAll(literal)) used.add(m[1]);
    }
    for (const [prefix, names] of Object.entries(DYNAMIC)) for (const n of names) used.add(prefix + n);
    expect([...used].filter((k) => !(k in en)).sort()).toEqual([]);
    expect(used.size).toBeGreaterThan(60);
  });

  it("the sidebar names the page in every language", () => {
    for (const lang of ["en", "az", "ru"] as const) expect(resolve(lang, "nav.invitations")).not.toBe("nav.invitations");
  });
});
