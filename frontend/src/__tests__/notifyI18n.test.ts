/**
 * The bell, the calendar feed and e-mail confirmation (nt.*, cal.*, ve.*):
 * every string exists in AZ, EN and RU with the same {placeholders}, and
 * every key the screens ask for is defined — dynamic keys are expanded from
 * the same lists the code uses.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import en from "@/lib/i18n/notify/en";
import az from "@/lib/i18n/notify/az";
import ru from "@/lib/i18n/notify/ru";
import { NOTIFICATION_GROUPS, NOTIFICATION_KINDS } from "@/lib/notifications";
import { INVITE_ROLES } from "@/lib/emailVerification";

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

const ROOT = join(__dirname, "..");
const SOURCES = [
  join(ROOT, "components", "NotificationsBell.tsx"),
  join(ROOT, "lib", "notifications.ts"),
  ...walk(join(ROOT, "components", "calendar")),
  join(ROOT, "components", "event-page", "AddToCalendar.tsx"),
  join(ROOT, "components", "event-page", "RegistrationForm.tsx"),
  join(ROOT, "components", "notices", "VerifyEmailBanner.tsx"),
  ...walk(join(ROOT, "components", "verify")),
  join(ROOT, "app", "login", "LoginClient.tsx"),
  join(ROOT, "components", "builder", "sections", "staff.tsx"),
  join(ROOT, "lib", "emailVerification.ts"),
];

const PREFIXES = "(?:nt|cal|ve)";
const DYNAMIC: Record<string, string[]> = {
  "nt.k.": [...NOTIFICATION_KINDS, "other", "chat.support_many", "chat.support_org", "chat.support_org_many", "chat.ticket_many"],
  "nt.group.": [...NOTIFICATION_GROUPS],
  "ve.role.": [...INVITE_ROLES],
};

function usedKeys(): Set<string> {
  const used = new Set<string>();
  const call = new RegExp(`\\b(?:t|tEn)\\(\\s*["\`](${PREFIXES}\\.[^"\`$]+)["\`]`, "g");
  // Keys handed around as plain strings (a ternary, a helper's answer) count too.
  const literal = new RegExp(`["'\`](${PREFIXES}\\.[A-Za-z0-9_.-]*[A-Za-z0-9_])["'\`]`, "g");
  for (const file of SOURCES) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(call)) used.add(m[1]);
    for (const m of src.matchAll(literal)) used.add(m[1]);
  }
  for (const [prefix, names] of Object.entries(DYNAMIC)) for (const n of names) used.add(prefix + n);
  return used;
}

describe("bell, calendar and e-mail confirmation strings", () => {
  it("read every screen they are used on", () => {
    expect(SOURCES.filter((f) => !existsSync(f))).toEqual([]);
  });

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

  it("are translated, not English copies", () => {
    const words = (s: string) => s.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
    // Product names are the same everywhere ("Apple / Outlook"); sentences are not.
    const same = (dict: Record<string, string>) => Object.keys(en).filter((k) => dict[k] === en[k] && words(en[k]) > 2);
    expect(same(az)).toEqual([]);
    expect(same(ru)).toEqual([]);
  });

  it("cover every key the screens use", () => {
    const used = usedKeys();
    const missing = [...used].filter((k) => !(k in en)).sort();
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(100);
  });

  it("carry no key that no screen uses", () => {
    const used = usedKeys();
    expect(Object.keys(en).filter((k) => !used.has(k)).sort()).toEqual([]);
  });

  it("stay inside their own prefixes", () => {
    expect(Object.keys(en).filter((k) => !/^(nt|cal|ve)\./.test(k))).toEqual([]);
  });
});
