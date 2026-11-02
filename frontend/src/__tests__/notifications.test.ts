/**
 * The bell (src/lib/notifications.ts): what the API's rows become — the
 * badge, the group label, the words in each language — and the screen each
 * row opens for the reader's role in that event. Every path it can produce
 * is a page that exists, so a click never lands on a 404.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { resolve, type Lang } from "@/lib/i18n";
import {
  EVENT_ROLES, NOTIFICATION_GROUPS, NOTIFICATION_KINDS, NOTIFICATION_TARGETS,
  badgeText, describe as words, groupOf, normalizeList, normalizeUnread, pathFor, roleFor,
  type AppNotification, type EventRole,
} from "@/lib/notifications";

const en = (k: string) => resolve("en", k);

function row(over: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 1, eventId: 12, eventName: "Baku AI Hackathon", kind: "announcement", target: "announcements",
    title: null, body: null, data: {}, count: 1, createdAt: "2026-10-19T10:00:00.000Z", read: false, ...over,
  };
}

/** Every page route of the app, route groups left out: /hacker/chat, /, /judge … */
function pageRoutes(): Set<string> {
  const app = join(__dirname, "..", "app");
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f === "page.tsx") {
        const segs = relative(app, dir).split(sep).filter((s) => s && !/^\(.*\)$/.test(s));
        out.add(`/${segs.join("/")}`);
      }
    }
  };
  if (existsSync(app)) walk(app);
  return out;
}

describe("normalizeList", () => {
  it("reads both spellings, drops rows without an id and keeps known roles only", () => {
    const list = normalizeList({
      unread: 3,
      roles: { 12: "organizer", 13: "participant", 14: "superhero", 15: null },
      items: [
        { id: 5, event_id: "12", event_name: "Baku AI", kind: "chat.support", target: "chat", count: 4, created_at: "2026-10-19T09:00:00Z", read: 0, data: { channelId: 9 } },
        { id: 6, eventId: 13, eventName: "  ", kind: "announcement", title: " Doors open ", data: ["not", "an", "object"], count: 0 },
        { kind: "announcement" },
        null,
        "junk",
      ],
    });
    expect(list.unread).toBe(3);
    expect(list.roles).toEqual({ 12: "organizer", 13: "participant", 14: null, 15: null });
    expect(list.items.map((x) => x.id)).toEqual([5, 6]);
    expect(list.items[0]).toMatchObject({ eventId: 12, eventName: "Baku AI", count: 4, createdAt: "2026-10-19T09:00:00Z", read: false, data: { channelId: 9 } });
    expect(list.items[1]).toMatchObject({ eventName: null, title: "Doors open", data: {}, count: 1, target: null });
  });

  it("keeps an absent event or thread absent, not 0", () => {
    const [n] = normalizeList({ items: [{ id: 1, eventId: null, event_id: null, kind: "other", data: { channelId: null } }] }).items;
    expect(n.eventId).toBeNull();
    expect(pathFor({ ...n, kind: "chat.support", target: "chat" }, "participant")).toBe("/hacker/chat");
  });

  it("answers an empty list for anything that is not one", () => {
    for (const raw of [null, undefined, "x", 3, [], { unread: -4, items: "no" }]) {
      expect(normalizeList(raw)).toEqual({ unread: 0, roles: {}, items: [] });
    }
  });

  it("reads the unread count", () => {
    expect(normalizeUnread({ unread: "7", latest: "2026-10-19T10:00:00Z" })).toEqual({ unread: 7, latest: "2026-10-19T10:00:00Z" });
    expect(normalizeUnread({ unread: -1, latest: "" })).toEqual({ unread: 0, latest: null });
    expect(normalizeUnread(null)).toEqual({ unread: 0, latest: null });
  });
});

describe("badgeText", () => {
  it("shows nothing at zero and caps at 9+", () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(-2)).toBeNull();
    expect(badgeText(Number.NaN)).toBeNull();
    expect(badgeText(1)).toBe("1");
    expect(badgeText(9)).toBe("9");
    expect(badgeText(10)).toBe("9+");
    expect(badgeText(250)).toBe("9+");
  });
});

describe("groupOf", () => {
  it("puts every kind in a known group, and anything new under other", () => {
    for (const kind of NOTIFICATION_KINDS) {
      expect(NOTIFICATION_GROUPS).toContain(groupOf(kind));
      expect(groupOf(kind), kind).not.toBe("other");
    }
    expect(groupOf("participant.approved")).toBe("registration");
    expect(groupOf("team.invite")).toBe("team");
    expect(groupOf("ticket.claimed")).toBe("help");
    expect(groupOf("chat.report")).toBe("chat");
    expect(groupOf("results.published")).toBe("results");
    expect(groupOf("certificate.issued")).toBe("certificate");
    expect(groupOf("billing.invoice")).toBe("other");
    expect(groupOf("")).toBe("other");
  });
});

describe("describe (the words of a row)", () => {
  it("uses an announcement's own title and text", () => {
    expect(words(row({ title: "Doors open at 9", body: "Bring your ID." }), en)).toEqual({ line: "Doors open at 9", detail: "Bring your ID." });
    expect(words(row(), en).line).toBe(en("nt.k.announcement"));
  });

  it("names the event in registration news, from the row or its data", () => {
    expect(words(row({ kind: "participant.approved" }), en).line).toContain("Baku AI Hackathon");
    expect(words(row({ kind: "participant.waitlisted", eventName: null, data: { eventName: "Ganja Jam" } }), en).line).toContain("Ganja Jam");
    expect(words(row({ kind: "participant.rejected", eventName: null }), en).line).toContain(en("nt.this_event"));
  });

  it("names the people and teams of team news, with a fallback for each", () => {
    const line = words(row({ kind: "team.request_new", data: { name: "Aysel", team: "Byte Club" } }), en).line;
    expect(line).toContain("Aysel");
    expect(line).toContain("Byte Club");
    const bare = words(row({ kind: "team.invite" }), en).line;
    expect(bare).toContain(en("nt.someone"));
    expect(bare).toContain(en("nt.their_team"));
  });

  it("says where a help request waits, and who took it", () => {
    const fresh = words(row({ kind: "ticket.new_for_you", title: "Docker", data: { teamName: "Byte Club", topic: "Docker", place: "Table 4" } }), en);
    expect(fresh.line).toContain("Byte Club");
    expect(fresh.line).toContain("Docker");
    expect(fresh.detail).toContain("Table 4");
    expect(words(row({ kind: "ticket.new_for_you", data: { topic: "Docker" } }), en).detail).toBeNull();
    expect(words(row({ kind: "ticket.claimed", data: { mentorName: "Rauf", topic: "Docker" } }), en).line).toContain("Rauf");
    expect(words(row({ kind: "ticket.escalated", title: "Auth bug", data: {} }), en).line).toContain("Auth bug");
  });

  it("words a support thread for the organisers and for the person writing to them", () => {
    const toOrg = words(row({ kind: "chat.support", target: "chat", title: "Aysel", body: "Is there parking?", count: 3, data: { personName: "Aysel M." } }), en, "organizer");
    expect(toOrg.line).toContain("Aysel M.");
    expect(toOrg.line).toContain("3");
    expect(toOrg.detail).toBe("Is there parking?");
    const one = words(row({ kind: "chat.support", target: "chat", body: "Yes, at gate B.", count: 1 }), en, "participant");
    expect(one.line).toBe(en("nt.k.chat.support"));
    expect(one.detail).toBe("Yes, at gate B.");
    expect(words(row({ kind: "chat.support", count: 2 }), en, "participant").line).toContain("2");
  });

  it("puts the author before the text of a help request's thread", () => {
    const out = words(row({ kind: "chat.ticket", title: "Rauf", body: "Try port 5433.", data: { ticketTopic: "Postgres" } }), en, "participant");
    expect(out.line).toContain("Postgres");
    expect(out.detail).toBe("Rauf: Try port 5433.");
    expect(words(row({ kind: "chat.ticket", data: {} }), en).line).toContain(en("nt.your_request"));
  });

  it("gives a report its reason and an unknown kind its own title", () => {
    expect(words(row({ kind: "chat.report", body: "spam" }), en).detail).toContain("spam");
    expect(words(row({ kind: "chat.report" }), en).detail).toBeNull();
    expect(words(row({ kind: "billing.invoice", title: "Invoice ready", body: "INV-12" }), en)).toEqual({ line: "Invoice ready", detail: "INV-12" });
    expect(words(row({ kind: "billing.invoice" }), en).line).toBe(en("nt.k.other"));
  });

  it("never leaves a {placeholder} or an empty line, in any language, with or without data", () => {
    const full = { name: "Aysel", team: "Byte Club", teamName: "Byte Club", topic: "Docker", mentorName: "Rauf", place: "Table 4", personName: "Aysel M.", ticketTopic: "Docker", eventName: "Baku AI", channelId: 3 };
    for (const lang of ["en", "az", "ru"] as Lang[]) {
      const t = (k: string) => resolve(lang, k);
      for (const kind of NOTIFICATION_KINDS) {
        for (const role of [null, ...EVENT_ROLES]) {
          for (const n of [
            row({ kind, count: 1, data: full, title: "Rauf", body: "Hello" }),
            row({ kind, count: 4, data: {}, eventName: null }),
          ]) {
            const out = words(n, t, role);
            const label = `${lang} ${kind} ${role} ×${n.count}`;
            expect(out.line.trim().length, label).toBeGreaterThan(0);
            expect(out.line, label).not.toMatch(/\{[a-z]+\}/);
            expect(out.line, label).not.toMatch(/^nt\./);
            if (out.detail) expect(out.detail, label).not.toMatch(/\{[a-z]+\}/);
          }
        }
      }
    }
  });
});

describe("pathFor (the screen a row opens)", () => {
  const ROLES = EVENT_ROLES;
  const expected: Record<string, Record<EventRole, string>> = {
    chat: { organizer: "/chat", judge: "/judge/chat", mentor: "/mentor/chat", volunteer: "/volunteer/chat", participant: "/hacker/chat" },
    announcements: { organizer: "/announcements", judge: "/judge", mentor: "/mentor/announcements", volunteer: "/volunteer/announcements", participant: "/hacker/announcements" },
    help: { organizer: "/help-queue", judge: "/judge", mentor: "/mentor/my-tickets", volunteer: "/volunteer", participant: "/hacker/help" },
    team: { organizer: "/", judge: "/judge", mentor: "/mentor", volunteer: "/volunteer", participant: "/hacker/team" },
    results: { organizer: "/results", judge: "/judge", mentor: "/mentor", volunteer: "/volunteer", participant: "/hacker/results" },
    certificates: { organizer: "/certificates", judge: "/judge", mentor: "/mentor", volunteer: "/volunteer", participant: "/hacker/results" },
    home: { organizer: "/", judge: "/judge", mentor: "/mentor", volunteer: "/volunteer", participant: "/hacker" },
    webhooks: { organizer: "/account/webhooks", judge: "/account/webhooks", mentor: "/account/webhooks", volunteer: "/account/webhooks", participant: "/account/webhooks" },
  };

  it("covers every target", () => {
    expect(Object.keys(expected).sort()).toEqual([...NOTIFICATION_TARGETS].sort());
  });

  it.each(NOTIFICATION_TARGETS.flatMap((target) => ROLES.map((role) => [target, role] as const)))("%s for %s", (target, role) => {
    expect(pathFor(row({ kind: "announcement", target }), role)).toBe(expected[target][role]);
  });

  it("opens the chat on its thread", () => {
    for (const role of ROLES) {
      expect(pathFor(row({ kind: "chat.support", target: "chat", data: { channelId: 42 } }), role)).toBe(`${expected.chat[role]}?c=42`);
    }
    expect(pathFor(row({ kind: "chat.support", target: "chat", data: { channelId: "nope" } }), "participant")).toBe("/hacker/chat");
    // A thread id on a row that does not open the chat is not used.
    expect(pathFor(row({ kind: "announcement", target: "announcements", data: { channelId: 42 } }), "participant")).toBe("/hacker/announcements");
  });

  it("sends a mentor asked by name to the queue, and anyone no longer in the event to the picker", () => {
    expect(pathFor(row({ kind: "ticket.new_for_you", target: "help" }), "mentor")).toBe("/mentor/help-queue");
    expect(pathFor(row({ kind: "ticket.new_for_you", target: "help" }), "organizer")).toBe("/help-queue");
    for (const target of NOTIFICATION_TARGETS.filter((x) => x !== "webhooks")) expect(pathFor(row({ target }), null)).toBe("/workspaces");
    // The organisation's webhooks are not about an event: their page opens for whoever manages them.
    expect(pathFor(row({ kind: "webhook.disabled", target: "webhooks", eventId: null }), null)).toBe("/account/webhooks");
  });

  it("treats a target it does not know as the role's home", () => {
    expect(pathFor(row({ target: "billing" }), "participant")).toBe("/hacker");
    expect(pathFor(row({ target: null }), "organizer")).toBe("/");
  });

  it("only ever opens pages that exist", () => {
    const routes = pageRoutes();
    expect(routes.size).toBeGreaterThan(20);
    const paths = new Set<string>(["/workspaces", "/mentor/help-queue"]);
    for (const target of NOTIFICATION_TARGETS) for (const role of ROLES) paths.add(pathFor(row({ target }), role));
    const missing = [...paths].filter((p) => !routes.has(p.split("?")[0]));
    expect(missing).toEqual([]);
  });
});

describe("roleFor", () => {
  it("reads the reader's role for the row's event", () => {
    const list = { roles: { 12: "mentor" as const, 13: null } };
    expect(roleFor(list, row({ eventId: 12 }))).toBe("mentor");
    expect(roleFor(list, row({ eventId: 13 }))).toBeNull();
    expect(roleFor(list, row({ eventId: 99 }))).toBeNull();
    expect(roleFor(list, row({ eventId: null }))).toBeNull();
  });
});
