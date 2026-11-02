/**
 * Check-in's strings: every string exists in AZ, EN and RU with the same
 * {placeholders}, every key the pages ask for is defined (dynamic keys
 * expanded from the lists the code uses), and the registry serves them.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import en from "@/lib/i18n/checkin/en";
import az from "@/lib/i18n/checkin/az";
import ru from "@/lib/i18n/checkin/ru";
import { resolve } from "@/lib/i18n";
import { CHECKIN_ERROR_CODES, FILTERS, SCAN_OUTCOMES } from "@/lib/checkin";

const ROOT = join(__dirname, "..");
const SOURCES = [
  join(ROOT, "app", "(dashboard)", "checkin", "page.tsx"),
  join(ROOT, "app", "(dashboard)", "checkin", "scan", "page.tsx"),
  join(ROOT, "app", "volunteer", "scan", "page.tsx"),
  join(ROOT, "app", "volunteer", "VolunteerShell.tsx"),
  join(ROOT, "app", "hacker", "ticket", "page.tsx"),
  join(ROOT, "components", "checkin", "CheckinScanner.tsx"),
  join(ROOT, "components", "checkin", "TicketCard.tsx"),
  join(ROOT, "lib", "checkin.ts"),
  join(ROOT, "lib", "sidebarMenu.ts"),
];

const DYNAMIC: Record<string, string[]> = {
  "ci.err.": [...CHECKIN_ERROR_CODES],
  "ci.filter.": [...FILTERS],
  "ci.scan.result.": [...SCAN_OUTCOMES, "error"],
  "ci.method.": ["qr", "manual"],
  "ci.status.": ["approved", "eliminated", "pending", "waitlisted", "rejected"],
};

const ph = (s: string) => (s.match(/\{[a-z]+\}/g) || []).sort().join(",");

describe("check-in strings", () => {
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

  it("cover every key the pages use, and the pages use every key", () => {
    expect(SOURCES.every(existsSync)).toBe(true);
    const used = new Set<string>();
    const literal = /["'`]((?:ci|nav)\.[A-Za-z0-9_.-]*[A-Za-z0-9_])["'`]/g;
    for (const file of SOURCES) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(literal)) if (m[1].startsWith("ci.") || m[1] === "nav.checkin") used.add(m[1]);
    }
    for (const [prefix, names] of Object.entries(DYNAMIC)) for (const n of names) used.add(prefix + n);
    expect([...used].filter((k) => !(k in en)).sort()).toEqual([]);
    expect(Object.keys(en).filter((k) => !used.has(k)).sort()).toEqual([]);
  });

  it("are served by the registry in each language", () => {
    expect(resolve("en", "nav.checkin")).toBe(en["nav.checkin"]);
    expect(resolve("az", "ci.scan.result.checked_in")).toBe(az["ci.scan.result.checked_in"]);
    expect(resolve("ru", "ci.ticket.title")).toBe(ru["ci.ticket.title"]);
    // A key no other group defines differently.
    for (const k of Object.keys(en)) expect(resolve("en", k), k).toBe(en[k]);
  });
});
