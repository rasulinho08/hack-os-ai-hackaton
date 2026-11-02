/**
 * A customer's colleagues (/account/team) and the invitation page
 * (/invite/<token>): every string exists in AZ, EN and RU with the same
 * {placeholders}, every key the pages ask for is defined — dynamic keys are
 * expanded from the same lists the code uses — and none of them shadows a key
 * of another dictionary.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "@/lib/i18n/account/en";
import az from "@/lib/i18n/account/az";
import ru from "@/lib/i18n/account/ru";
import coreEn from "@/lib/i18n/en";
import builderEn from "@/lib/i18n/builder/en";
import opsEn from "@/lib/i18n/ops/en";
import judgingEn from "@/lib/i18n/judging/en";
import resultsEn from "@/lib/i18n/results/en";
import wrapupEn from "@/lib/i18n/wrapup/en";
import votingEn from "@/lib/i18n/voting/en";
import chatEn from "@/lib/i18n/chat/en";
import notifyEn from "@/lib/i18n/notify/en";
import platformEn from "@/lib/i18n/platform/en";
import { resolve } from "@/lib/i18n";

const ROOT = join(__dirname, "..");
const SOURCES = [
  join(ROOT, "app", "(site)", "account", "team", "page.tsx"),
  join(ROOT, "app", "(site)", "invite", "[token]", "page.tsx"),
];
const ROLES = ["superadmin", "admin", "org_admin", "hacker", "pending", "judge", "mentor", "volunteer"];
const INVITE_STATES = ["pending", "accepted", "revoked", "expired"];
const DYNAMIC: Record<string, string[]> = {
  "acct.role.": ROLES,
  "acct.state.": INVITE_STATES,
  "acct.inv.": ["accepted", "revoked", "expired"].flatMap((s) => [`${s}_title`, `${s}_body`]),
};

describe("account strings", () => {
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

  it("cover every key the two pages use", () => {
    const used = new Set<string>();
    const re = /\bt\(\s*["`](acct\.[^"`$]+)["`]/g;
    for (const file of SOURCES) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(re)) used.add(m[1]);
    }
    for (const [prefix, names] of Object.entries(DYNAMIC)) for (const n of names) used.add(prefix + n);
    const missing = [...used].filter((k) => !(k in en)).sort();
    expect(missing).toEqual([]);
    expect(used.has("acct.team.invite_title")).toBe(true);
    expect(used.has("acct.inv.wrong_account")).toBe(true);
  });

  it("do not shadow a key of another dictionary", () => {
    const others = [coreEn, builderEn, opsEn, judgingEn, resultsEn, wrapupEn, votingEn, chatEn, notifyEn, platformEn];
    const clash = Object.keys(en).filter((k) => others.some((d) => k in d));
    expect(clash).toEqual([]);
  });

  it("are what t() returns in each language", () => {
    expect(resolve("az", "acct.team.title")).toBe(az["acct.team.title"]);
    expect(resolve("ru", "acct.state.revoked")).toBe(ru["acct.state.revoked"]);
    expect(resolve("en", "acct.inv.not_now")).toBe("Not now");
  });
});
