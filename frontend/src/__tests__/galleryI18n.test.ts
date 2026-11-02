/**
 * The photo gallery's strings: every string exists in
 * AZ, EN and RU with the same {placeholders}, every key the pages ask for is
 * defined (dynamic keys expanded from the lists the code uses), and the
 * registry serves them.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import en from "@/lib/i18n/gallery/en";
import az from "@/lib/i18n/gallery/az";
import ru from "@/lib/i18n/gallery/ru";
import { resolve } from "@/lib/i18n";
import { CHAT_OUTCOMES, EMAIL_OUTCOMES, GALLERY_ERROR_CODES } from "@/lib/gallery";

const ROOT = join(__dirname, "..");
const SOURCES = [
  join(ROOT, "app", "(dashboard)", "gallery", "page.tsx"),
  join(ROOT, "app", "e", "[slug]", "gallery", "page.tsx"),
  join(ROOT, "components", "gallery", "GalleryCallout.tsx"),
  join(ROOT, "components", "gallery", "GalleryMembersView.tsx"),
  join(ROOT, "lib", "gallery.ts"),
  join(ROOT, "lib", "sidebarMenu.ts"),
];

const DYNAMIC: Record<string, string[]> = {
  "gl.err.": [...GALLERY_ERROR_CODES],
  "gl.share.chat.": [...CHAT_OUTCOMES],
  "gl.share.email.": [...EMAIL_OUTCOMES],
  "gl.file.": ["NOT_AN_IMAGE", "UNREADABLE", "TOO_LARGE"],
  "gl.upload.": ["waiting", "preparing", "done", "skipped"],
};

const ph = (s: string) => (s.match(/\{[a-z]+\}/g) || []).sort().join(",");

describe("gallery strings", () => {
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
    const literal = /["'`]((?:gl|nav)\.[A-Za-z0-9_.-]*[A-Za-z0-9_])["'`]/g;
    for (const file of SOURCES) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(literal)) if (m[1].startsWith("gl.") || m[1] === "nav.gallery") used.add(m[1]);
    }
    for (const [prefix, names] of Object.entries(DYNAMIC)) for (const n of names) used.add(prefix + n);
    const missing = [...used].filter((k) => !(k in en)).sort();
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(60);
  });

  it("are served by the registry in each language", () => {
    expect(resolve("en", "nav.gallery")).toBe(en["nav.gallery"]);
    expect(resolve("az", "gl.m.title")).toBe(az["gl.m.title"]);
    expect(resolve("ru", "gl.share.email.limit")).toBe(ru["gl.share.email.limit"]);
    // The new audience the gallery's announcement goes to has its words too.
    for (const lang of ["en", "az", "ru"] as const) {
      expect(resolve(lang, "an.aud.attendees")).not.toBe("an.aud.attendees");
      expect(resolve(lang, "an.audhint.attendees")).not.toBe("an.audhint.attendees");
    }
  });
});
