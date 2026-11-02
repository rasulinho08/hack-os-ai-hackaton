/**
 * The projects page's strings and the status page's copy: every string exists
 * in AZ, EN and RU with the same {placeholders}, every key the pages ask for
 * is defined (dynamic keys expanded from the lists the code uses), and the
 * registry serves them.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import en from "@/lib/i18n/projects/en";
import az from "@/lib/i18n/projects/az";
import ru from "@/lib/i18n/projects/ru";
import { resolve } from "@/lib/i18n";
import { PROJECTS_ERROR_CODES } from "@/lib/publicProjects";
import { CHECK_KEYS } from "@/lib/platformStatus";
import { STATUS_COPY, checkSentence, statusCopy } from "@/app/(site)/status/copy";

const ROOT = join(__dirname, "..");
const SOURCES = [
  join(ROOT, "app", "e", "[slug]", "projects", "page.tsx"),
  join(ROOT, "components", "projects", "ProjectsPublicView.tsx"),
  join(ROOT, "components", "projects", "ProjectsClosed.tsx"),
  join(ROOT, "components", "projects", "ProjectsPagePanel.tsx"),
  join(ROOT, "components", "projects", "ProjectVisibility.tsx"),
  join(ROOT, "components", "event-page", "EventPublicView.tsx"),
  join(ROOT, "lib", "publicProjects.ts"),
];

const DYNAMIC: Record<string, string[]> = {
  "pj.err.": [...PROJECTS_ERROR_CODES],
};

const ph = (s: string) => (s.match(/\{[a-z]+\}/g) || []).sort().join(",");

describe("projects page strings", () => {
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

  it("cover every key the pages use", () => {
    expect(SOURCES.every(existsSync)).toBe(true);
    const used = new Set<string>();
    const literal = /["'`](pj\.[A-Za-z0-9_.-]*[A-Za-z0-9_])["'`]/g;
    for (const file of SOURCES) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(literal)) used.add(m[1]);
    }
    for (const [prefix, names] of Object.entries(DYNAMIC)) for (const n of names) used.add(prefix + n);
    const missing = [...used].filter((k) => !(k in en)).sort();
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(50);
  });

  it("are served by the registry in each language, and the event page's words they borrow exist", () => {
    expect(resolve("en", "pj.ep_cta")).toBe(en["pj.ep_cta"]);
    expect(resolve("az", "pj.org.toggle")).toBe(az["pj.org.toggle"]);
    expect(resolve("ru", "pj.mine.toggle")).toBe(ru["pj.mine.toggle"]);
    for (const lang of ["en", "az", "ru"] as const) {
      for (const k of ["ep.language", "ep.organised_by", "ep.powered"]) expect(resolve(lang, k), `${lang}:${k}`).not.toBe(k);
    }
  });
});

describe("status page copy", () => {
  /** Every string of an object, by its path. */
  const flat = (v: unknown, path = ""): Record<string, string> => {
    if (typeof v === "string") return { [path]: v };
    if (v && typeof v === "object") {
      return Object.entries(v as Record<string, unknown>).reduce<Record<string, string>>(
        (acc, [k, x]) => ({ ...acc, ...flat(x, path ? `${path}.${k}` : k) }),
        {},
      );
    }
    return {};
  };

  it("has the same strings with the same {placeholders} in every language", () => {
    const base = flat(STATUS_COPY.en);
    for (const lang of ["az", "ru"] as const) {
      const other = flat(STATUS_COPY[lang]);
      expect(Object.keys(other).sort()).toEqual(Object.keys(base).sort());
      for (const [k, s] of Object.entries(base)) {
        expect(other[k].trim().length, `${lang}:${k}`).toBeGreaterThan(0);
        expect(ph(other[k]), `${lang}:${k}`).toBe(ph(s));
      }
    }
  });

  it("says something for every check in every state the API can report", () => {
    for (const lang of ["en", "az", "ru"] as const) {
      const copy = STATUS_COPY[lang];
      for (const key of CHECK_KEYS) {
        for (const state of ["ok", "degraded", "down", "off", "unknown"] as const) {
          expect(checkSentence(copy, key, state).trim().length, `${lang}:${key}:${state}`).toBeGreaterThan(0);
        }
      }
      // The states each check really reports have their own sentence, not the fallback.
      expect(copy.checks.database.degraded).toBeTruthy();
      expect(copy.checks.jobs.down).toBeTruthy();
      expect(copy.checks.mail.off).toBeTruthy();
      expect(copy.updated).toContain("{time}");
    }
  });

  it("falls back to English for a language it does not have", () => {
    expect(statusCopy("de")).toBe(STATUS_COPY.en);
    expect(statusCopy("az")).toBe(STATUS_COPY.az);
  });
});
