/**
 * Calendar links (src/lib/calendar.ts) and e-mail confirmation answers
 * (src/lib/emailVerification.ts): the shapes the API sends, read the way the
 * screens need them. The API answers used here are the ones it gives
 * (GET /api/me/calendar, POST /api/auth/verify-email, 429 VERIFY_COOLDOWN).
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { calStamp, googleEventUrl, googleSubscribeUrl, normalizeFeed, publicIcsPath } from "@/lib/calendar";
import { inviteRoleKey, normalizeVerifyAnswer, retryAfterSeconds, verifyStateFromMe } from "@/lib/emailVerification";

const FEED = "https://hackos.az/api/calendar/42.3.aB3_-aB3_-aB3_-aB3_-aB3_-aB3_-xy.ics";

describe("normalizeFeed", () => {
  it("keeps the API's https and webcal links", () => {
    expect(normalizeFeed({ url: FEED, webcal: FEED.replace("https:", "webcal:") })).toEqual({ url: FEED, webcal: FEED.replace("https:", "webcal:") });
  });

  it("makes the webcal link when it is missing, and refuses anything that is not a link", () => {
    expect(normalizeFeed({ url: FEED })?.webcal).toBe(FEED.replace("https:", "webcal:"));
    expect(normalizeFeed({ url: "javascript:alert(1)" })).toBeNull();
    expect(normalizeFeed({ url: FEED, webcal: "javascript:alert(1)" })?.webcal).toBe(FEED.replace("https:", "webcal:"));
    expect(normalizeFeed(null)).toBeNull();
    expect(normalizeFeed("x")).toBeNull();
  });

  it("subscribes Google Calendar by the webcal link", () => {
    const u = new URL(googleSubscribeUrl(FEED.replace("https:", "webcal:")));
    expect(u.origin).toBe("https://calendar.google.com");
    expect(u.searchParams.get("cid")).toBe(FEED.replace("https:", "webcal:"));
  });
});

describe("googleEventUrl", () => {
  it("fills in the event in UTC", () => {
    const u = new URL(googleEventUrl({ name: "Baku AI Hackathon", start: "2026-11-18T06:00:00.000Z", end: "2026-11-19T06:00:00.000Z", details: "Bring a laptop", location: "ADA University" })!);
    expect(u.searchParams.get("action")).toBe("TEMPLATE");
    expect(u.searchParams.get("text")).toBe("Baku AI Hackathon");
    expect(u.searchParams.get("dates")).toBe("20261118T060000Z/20261119T060000Z");
    expect(u.searchParams.get("details")).toBe("Bring a laptop");
    expect(u.searchParams.get("location")).toBe("ADA University");
  });

  it("shows two hours when the end is missing or before the start, and nothing without a start", () => {
    expect(new URL(googleEventUrl({ name: "x", start: "2026-11-18T06:00:00Z" })!).searchParams.get("dates")).toBe("20261118T060000Z/20261118T080000Z");
    expect(new URL(googleEventUrl({ name: "x", start: "2026-11-18T06:00:00Z", end: "2026-11-17T06:00:00Z" })!).searchParams.get("dates")).toBe("20261118T060000Z/20261118T080000Z");
    expect(new URL(googleEventUrl({ name: "x", start: "2026-11-18T06:00:00Z", end: "soon" })!).searchParams.get("dates")).toBe("20261118T060000Z/20261118T080000Z");
    expect(googleEventUrl({ name: "x", start: null })).toBeNull();
    expect(googleEventUrl({ name: "x", start: "not a date" })).toBeNull();
    const bare = new URL(googleEventUrl({ name: "x", start: "2026-11-18T06:00:00Z" })!);
    expect(bare.searchParams.has("details")).toBe(false);
    expect(bare.searchParams.has("location")).toBe(false);
  });

  it("stamps dates the way the template wants them", () => {
    expect(calStamp("2026-11-01T08:00:00.123Z")).toBe("20261101T080000Z");
    expect(calStamp(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe("20260102T030405Z");
    expect(calStamp("")).toBeNull();
    expect(calStamp(undefined)).toBeNull();
  });

  it("asks the API for an event's public dates by its slug", () => {
    expect(publicIcsPath("baku-ai")).toBe("/api/public/events/baku-ai/calendar.ics");
    expect(publicIcsPath("a/b?c")).toBe("/api/public/events/a%2Fb%3Fc/calendar.ics");
  });
});

describe("e-mail confirmation answers", () => {
  it("reads /api/auth/me: unconfirmed, with its waiting invitations", () => {
    const s = verifyStateFromMe({
      email: "aysel@example.az", email_verified: false,
      pending_invites: [{ eventId: 12, role: "judge", eventName: "Baku AI" }, { event_id: "13", role: "boss", event_name: null }, "junk"],
    });
    expect(s).toEqual({
      email: "aysel@example.az", verified: false, dismissed: false,
      invites: [{ eventId: 12, role: "judge", eventName: "Baku AI" }, { eventId: 13, role: "hacker", eventName: null }],
    });
  });

  it("counts an answer without the flag as confirmed, and no account as nothing", () => {
    expect(verifyStateFromMe({ email: "a@b.az" })?.verified).toBe(true);
    expect(verifyStateFromMe({ email: "a@b.az", email_verified: true })?.verified).toBe(true);
    expect(verifyStateFromMe({ email: "" })).toBeNull();
    expect(verifyStateFromMe(null)).toBeNull();
  });

  it("reads the confirmation's answer and the invitations it opened", () => {
    expect(normalizeVerifyAnswer({
      verified: true, alreadyVerified: false, email: "a@b.az",
      applied: [{ eventId: 12, role: "mentor", eventName: " Baku AI " }, { eventId: 13, role: "judge", eventName: null }, { eventId: "x" }, null],
    })).toEqual({
      verified: true, alreadyVerified: false, email: "a@b.az",
      applied: [{ eventId: 12, role: "mentor", eventName: "Baku AI" }, { eventId: 13, role: "judge", eventName: null }],
    });
    expect(normalizeVerifyAnswer({ verified: true, alreadyVerified: true })).toEqual({ verified: true, alreadyVerified: true, email: null, applied: [] });
    expect(normalizeVerifyAnswer(undefined)).toEqual({ verified: true, alreadyVerified: false, email: null, applied: [] });
  });

  it("reads how long to wait before another link, from the API's 429", () => {
    // What src/lib/api.ts makes of { errors: { retryAfter: 50 }, code: "VERIFY_COOLDOWN" }.
    const cooldown = new ApiError("A link was just sent. You can ask for another in 50 s.: retryAfter: 50", 429, [{ field: "retryAfter", message: "50" }], "VERIFY_COOLDOWN", "A link was just sent. You can ask for another in 50 s.");
    expect(retryAfterSeconds(cooldown)).toBe(50);
    expect(retryAfterSeconds(new ApiError("Wait 12 s", 429, [], "VERIFY_COOLDOWN"))).toBe(12);
    expect(retryAfterSeconds(new ApiError("Slow down", 429, [], "VERIFY_COOLDOWN"))).toBe(60);
    expect(retryAfterSeconds(new ApiError("Too many requests", 429))).toBeNull();
    expect(retryAfterSeconds(new ApiError("Unauthorized", 401, [{ field: "retryAfter", message: "50" }]))).toBeNull();
  });

  it("words every invitation role, and an unknown one as a participant", () => {
    expect(inviteRoleKey("judge")).toBe("ve.role.judge");
    expect(inviteRoleKey("volunteer")).toBe("ve.role.volunteer");
    expect(inviteRoleKey("admin")).toBe("ve.role.hacker");
  });
});
