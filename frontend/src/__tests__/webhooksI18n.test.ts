/**
 * The webhooks page's strings: every string exists in AZ, EN and RU with
 * the same {placeholders}, every key the page asks for is defined (dynamic
 * keys expanded from the lists the code uses), sentences are translated
 * rather than copied, and the registry serves them.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import en from "@/lib/i18n/webhooks/en";
import az from "@/lib/i18n/webhooks/az";
import ru from "@/lib/i18n/webhooks/ru";
import { resolve } from "@/lib/i18n";
import { DELIVERY_TYPES, ERROR_CODES, FIELD_CODES, WEBHOOK_EVENT_TYPES, type Health } from "@/lib/webhooks";

const ROOT = join(__dirname, "..");
const SOURCES = [
  join(ROOT, "app", "(site)", "account", "webhooks", "page.tsx"),
  join(ROOT, "app", "(site)", "account", "page.tsx"),
  join(ROOT, "lib", "webhooks.ts"),
];

const HEALTH: Health[] = ["ok", "new", "retrying", "failing", "off_failing", "off_manual"];
const DYNAMIC: Record<string, string[]> = {
  "wh.type.": [...DELIVERY_TYPES],
  "wh.type_hint.": [...WEBHOOK_EVENT_TYPES],
  "wh.health.": HEALTH,
  "wh.status.": ["queued", "retrying", "delivered", "failed"],
  "wh.code.": [...FIELD_CODES],
  "wh.err.": [...ERROR_CODES, "generic"],
};

const ph = (s: string) => (s.match(/\{[a-z]+\}/g) || []).sort().join(",");

function usedKeys(): Set<string> {
  const used = new Set<string>();
  const literal = /["'`](wh\.[A-Za-z0-9_.-]*[A-Za-z0-9_])["'`]/g;
  for (const file of SOURCES) {
    for (const m of readFileSync(file, "utf8").matchAll(literal)) used.add(m[1]);
  }
  for (const [prefix, names] of Object.entries(DYNAMIC)) for (const n of names) used.add(prefix + n);
  return used;
}

describe("webhooks strings", () => {
  it("read every screen they are used on", () => {
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
    const words = (s: string) => s.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
    // Units and product names stay as they are ("{ms} ms", "Test"); sentences do not.
    const same = (dict: Record<string, string>) => Object.keys(en).filter((k) => dict[k] === en[k] && words(en[k]) > 2);
    expect(same(az)).toEqual([]);
    expect(same(ru)).toEqual([]);
  });

  it("cover every key the page uses, and carry none it does not", () => {
    const used = usedKeys();
    expect([...used].filter((k) => !(k in en)).sort()).toEqual([]);
    expect(Object.keys(en).filter((k) => !used.has(k)).sort()).toEqual([]);
    expect(used.size).toBeGreaterThan(100);
  });

  it("stay inside their own prefix", () => {
    expect(Object.keys(en).filter((k) => !k.startsWith("wh."))).toEqual([]);
  });

  it("are served by the registry in each language", () => {
    expect(resolve("en", "wh.title")).toBe(en["wh.title"]);
    expect(resolve("az", "wh.code.URL_PRIVATE_ADDRESS")).toBe(az["wh.code.URL_PRIVATE_ADDRESS"]);
    expect(resolve("ru", "wh.secret.title")).toBe(ru["wh.secret.title"]);
    // The account page's eyebrow and the bell's words for a switched-off endpoint exist too.
    for (const lang of ["en", "az", "ru"] as const) {
      for (const k of ["acct.eyebrow", "nt.k.webhook.disabled", "nt.group.webhooks", "nt.webhook_failures", "nt.an_endpoint"]) {
        expect(resolve(lang, k), `${lang} ${k}`).not.toBe(k);
      }
    }
  });
});
