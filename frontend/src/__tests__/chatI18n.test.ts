/**
 * The event chat (the channels, the thread, moderation, the help-request
 * threads): every string exists in AZ, EN and RU with the same
 * {placeholders}, every key the screens ask for is defined — dynamic keys are
 * expanded from the same lists the code uses — and none is left unused.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import en from "@/lib/i18n/chat/en";
import az from "@/lib/i18n/chat/az";
import ru from "@/lib/i18n/chat/ru";
import { AUTHOR_ROLES, CHANNEL_KINDS, CHAT_ERRORS, MUTE_CHOICES, muteKey } from "@/lib/chat";

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

const ROOT = join(__dirname, "..");
const SOURCES = [
  ...walk(join(ROOT, "components", "chat")),
  join(ROOT, "lib", "chat.ts"),
  join(ROOT, "hooks", "useChatThread.ts"),
  join(ROOT, "app", "(dashboard)", "chat", "page.tsx"),
  join(ROOT, "app", "hacker", "chat", "page.tsx"),
  join(ROOT, "app", "judge", "chat", "page.tsx"),
  join(ROOT, "app", "mentor", "chat", "page.tsx"),
  join(ROOT, "app", "volunteer", "chat", "page.tsx"),
  // "Messages" on a help request.
  join(ROOT, "app", "hacker", "help", "page.tsx"),
  join(ROOT, "app", "(dashboard)", "help-queue", "page.tsx"),
  join(ROOT, "components", "help", "MentorQueue.tsx"),
].filter(existsSync);

/** Who reads a chat page: the portals, and the organisers' own page. */
const PAGES = ["participant", "judge", "mentor", "volunteer", "organizer"];

const DYNAMIC: Record<string, string[]> = {
  "ch.kind.": [...CHANNEL_KINDS, "support_person"],
  "ch.kind_hint.": [...CHANNEL_KINDS],
  "ch.empty.": [...CHANNEL_KINDS],
  "ch.role.": [...AUTHOR_ROLES],
  "ch.err.": [...CHAT_ERRORS, "generic"],
  "ch.page_sub.": PAGES,
};

function usedKeys(): Set<string> {
  const used = new Set<string>();
  const re = /\bt\(\s*["`](ch\.[^"`$]+)["`]/g;
  // Keys handed around as plain strings (an error's key, a helper's answer) count too.
  const literal = /["'`](ch\.[A-Za-z0-9_.-]*[A-Za-z0-9_])["'`]/g;
  for (const file of SOURCES) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(re)) used.add(m[1]);
    for (const m of src.matchAll(literal)) used.add(m[1]);
  }
  for (const [prefix, names] of Object.entries(DYNAMIC)) for (const n of names) used.add(prefix + n);
  for (const m of MUTE_CHOICES) used.add(muteKey(m));
  return used;
}

describe("chat strings", () => {
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

  it("all start with the chat prefix", () => {
    expect(Object.keys(en).filter((k) => !k.startsWith("ch."))).toEqual([]);
  });

  it("cover every key the screens use", () => {
    const used = usedKeys();
    const missing = [...used].filter((k) => !(k in en)).sort();
    expect(missing).toEqual([]);
    expect(SOURCES.length).toBeGreaterThan(15);
    expect(used.size).toBeGreaterThan(100);
  });

  it("are all used somewhere", () => {
    const used = usedKeys();
    expect(Object.keys(en).filter((k) => !used.has(k)).sort()).toEqual([]);
  });

  it("are translated, not copied from English", () => {
    // Words that read the same in every language (a name of a role, "Mentor") are rare: allow a few.
    const same = (dict: Record<string, string>) => Object.keys(en).filter((k) => dict[k] === en[k] && /[a-z]{4}/i.test(en[k]));
    expect(same(az).length).toBeLessThanOrEqual(3);
    expect(same(ru)).toEqual([]);
  });

  it("use the app's own words in Azerbaijani", () => {
    expect(az["ch.role.judge"]).toBe("Hakim");
    expect(az["ch.title"]).toBe("Çat");
  });
});
