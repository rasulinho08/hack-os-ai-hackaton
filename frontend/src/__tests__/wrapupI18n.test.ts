/**
 * After the event (certificates, the public check, the archive, NPS, written
 * feedback): every string exists in AZ, EN and RU with the same
 * {placeholders}, and every key the screens ask for is defined — dynamic keys
 * are expanded from the same lists the code uses.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import en from "@/lib/i18n/wrapup/en";
import az from "@/lib/i18n/wrapup/az";
import ru from "@/lib/i18n/wrapup/ru";
import { CERT_ERRORS, CERT_KINDS, LIST_STATES, MAIL_STATES } from "@/lib/certificates";
import { NPS_BANDS, NPS_ERRORS } from "@/lib/nps";
import { ARCHIVE_STAGES, EXPORT_FILES } from "@/lib/archive";

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

const ROOT = join(__dirname, "..");
const SOURCES = [
  ...walk(join(ROOT, "components", "wrapup")),
  join(ROOT, "app", "(dashboard)", "certificates", "page.tsx"),
  join(ROOT, "app", "(dashboard)", "archive", "page.tsx"),
  join(ROOT, "app", "(dashboard)", "feedback", "page.tsx"),
  join(ROOT, "app", "verify", "[code]", "page.tsx"),
  join(ROOT, "app", "hacker", "feedback", "page.tsx"),
  join(ROOT, "app", "mentor", "page.tsx"),
  join(ROOT, "app", "volunteer", "page.tsx"),
  join(ROOT, "lib", "certificates.ts"),
  join(ROOT, "lib", "nps.ts"),
  join(ROOT, "lib", "archive.ts"),
].filter(existsSync);

const PREFIXES = "(?:ct|ar|np|vf|mc|fb)";
const DYNAMIC: Record<string, string[]> = {
  "ct.kind.": [...CERT_KINDS],
  "ct.state.": [...LIST_STATES],
  "ct.mail.": [...MAIL_STATES],
  "ct.err.": [...CERT_ERRORS, "generic"],
  "np.band.": [...NPS_BANDS],
  "np.comment.": [...NPS_BANDS],
  "np.tone.": ["ok", "warn", "danger", "neutral"],
  "np.err.": [...NPS_ERRORS, "generic"],
  "ar.stage.": [...ARCHIVE_STAGES],
  "ar.file.": [...EXPORT_FILES],
};

describe("after-the-event strings", () => {
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

  it("cover every key the screens use", () => {
    const used = new Set<string>();
    const re = new RegExp(`\\bt\\(\\s*["\`](${PREFIXES}\\.[^"\`$]+)["\`]`, "g");
    // Keys handed around as plain strings (a list of sentences, a helper's answer) count too.
    const literal = new RegExp(`["'\`](${PREFIXES}\\.[A-Za-z0-9_.-]*[A-Za-z0-9_])["'\`]`, "g");
    for (const file of SOURCES) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(re)) used.add(m[1]);
      for (const m of src.matchAll(literal)) used.add(m[1]);
    }
    for (const [prefix, names] of Object.entries(DYNAMIC)) for (const n of names) used.add(prefix + n);
    const missing = [...used].filter((k) => !(k in en)).sort();
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(200);
  });

  it("use the app's own word for a judge in Azerbaijani", () => {
    expect(az["ct.kind.judge"]).toBe("Hakim");
  });
});
