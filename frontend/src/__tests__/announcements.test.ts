/**
 * Announcements as the app reads them from the API: the member view (what
 * participants and staff see) and the organiser view (audience, channels,
 * schedule, delivery report). Plus: Telegram's webhook stays reachable
 * without a session — the API checks its secret header instead.
 */
import { describe, expect, it } from "vitest";
import { normalizeAnnouncement, normalizeAnnouncementsList } from "@/lib/announcements";
import {
  hasPending, normalizeAdminAnnouncement, normalizeAdminList, normalizeProblems, typeForPriority,
} from "@/lib/announcementsAdmin";
import { isPublicApiRoute } from "@/lib/backendAuth";

describe("member view", () => {
  it("shows when it went out, not when it was written, and how loud it is", () => {
    const a = normalizeAnnouncement({
      id: 7, title: "Lunch", content: "Hall B", created_at: "2026-10-18T08:00:00Z", sent_at: "2026-10-18T12:00:00Z",
      priority: "urgent", type: "info", source: "app",
    });
    expect(a.created_at).toBe("2026-10-18T12:00:00Z");
    expect(a.type).toBe("urgent");
    expect(a.source).toBe("WEBSITE");
  });

  it("reads where it came from: the app, the automatic planner, Telegram, or older payloads", () => {
    expect(normalizeAnnouncement({ id: 1, title: "x", source: "telegram" }).source).toBe("TELEGRAM");
    expect(normalizeAnnouncement({ id: 2, title: "x", source: "auto" }).source).toBe("WEBSITE");
    expect(normalizeAnnouncement({ id: 3, title: "x", source: "WEBSITE" }).source).toBe("WEBSITE");
    expect(normalizeAnnouncement({ id: 4, title: "x" }).source).toBe("UNKNOWN");
  });

  it("maps priority and older types to the three looks", () => {
    expect(normalizeAnnouncement({ id: 1, title: "x", priority: "high" }).type).toBe("warning");
    expect(normalizeAnnouncement({ id: 1, title: "x", type: "alert" }).type).toBe("urgent");
    expect(normalizeAnnouncement({ id: 1, title: "x", type: "warning" }).type).toBe("warning");
    expect(normalizeAnnouncement({ id: 1, title: "x", priority: "normal", type: "reminder" }).type).toBe("info");
  });

  it("takes a title from the first line when there is none, and survives junk", () => {
    expect(normalizeAnnouncement({ id: 1, content: "First line\nsecond" }).title).toBe("First line");
    expect(normalizeAnnouncementsList(null)).toEqual([]);
    expect(normalizeAnnouncementsList([null, 3])).toHaveLength(2);
  });
});

describe("organiser view", () => {
  const raw = {
    id: 12, title: "Wifi", content: "Network X", priority: "high", audience: "track", track_id: 3, track_name: "AI",
    channels: ["platform", "telegram", "email"], status: "scheduled", scheduled_at: "2026-10-19T10:00:00Z",
    sent_at: null, created_at: "2026-10-18T10:00:00Z", author_name: "Org", source: "app",
    deliveries: { email: { sent: 3, failed: 1, pending: 0, skipped: 0 }, telegram_channel: { sent: 1 } },
  };

  it("reads audience, channels, schedule and the delivery report", () => {
    const a = normalizeAdminAnnouncement(raw);
    expect(a.audience).toBe("track");
    expect(a.trackId).toBe(3);
    expect(a.trackName).toBe("AI");
    expect(a.channels).toEqual(["platform", "telegram", "email"]);
    expect(a.status).toBe("scheduled");
    expect(a.deliveries.email).toEqual({ sent: 3, failed: 1, pending: 0, skipped: 0 });
    expect(a.deliveries.telegram_channel).toEqual({ sent: 1, failed: 0, pending: 0, skipped: 0 });
    expect(a.deliveries.telegram).toBeUndefined();
  });

  it("falls back to safe values for anything unknown", () => {
    const a = normalizeAdminAnnouncement({ id: 1, audience: "aliens", status: "weird", channels: ["fax"], priority: "max", source: "x" });
    expect(a.audience).toBe("everyone");
    expect(a.status).toBe("sent");
    expect(a.channels).toEqual(["platform"]);
    expect(a.priority).toBe("normal");
    expect(a.source).toBe("app");
    expect(normalizeAdminList({})).toEqual([]);
  });

  it("keeps polling while something is scheduled or on its way", () => {
    expect(hasPending(normalizeAdminAnnouncement(raw))).toBe(true);
    expect(hasPending(normalizeAdminAnnouncement({ ...raw, status: "sent" }))).toBe(false);
    expect(hasPending(normalizeAdminAnnouncement({ ...raw, status: "sent", deliveries: { telegram: { pending: 2 } } }))).toBe(true);
    // Just published with e-mail: the deliveries are planned a moment later.
    const fresh = normalizeAdminAnnouncement({ ...raw, status: "sent", sent_at: new Date().toISOString(), deliveries: {} });
    expect(hasPending(fresh)).toBe(true);
    expect(hasPending(fresh, Date.now() + 5 * 60_000)).toBe(false);
    expect(hasPending(normalizeAdminAnnouncement({ ...raw, status: "sent", sent_at: new Date().toISOString(), channels: ["platform"], deliveries: {} }))).toBe(false);
  });

  it("stores a type that matches the importance", () => {
    expect(typeForPriority("urgent")).toBe("alert");
    expect(typeForPriority("high")).toBe("update");
    expect(typeForPriority("normal")).toBe("info");
  });

  it("lists who did not get it", () => {
    const p = normalizeProblems({ problems: [{ id: 1, channel: "telegram", status: "failed", attempts: 1, last_error: "Forbidden: bot was blocked by the user", full_name: "Aysel" }] });
    expect(p).toEqual([{ id: 1, channel: "telegram", status: "failed", attempts: 1, lastError: "Forbidden: bot was blocked by the user", name: "Aysel", email: null }]);
    expect(normalizeProblems(null)).toEqual([]);
  });
});

describe("Telegram's webhook", () => {
  it("is reachable without a session (the API checks its secret header)", () => {
    expect(isPublicApiRoute("/api/telegram/webhook", "POST")).toBe(true);
    expect(isPublicApiRoute("/api/telegram/webhook", "GET")).toBe(false);
    expect(isPublicApiRoute("/api/telegram/me", "GET")).toBe(false);
  });
});
