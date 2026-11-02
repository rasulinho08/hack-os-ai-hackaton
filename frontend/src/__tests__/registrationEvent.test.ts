/**
 * The login screen's "register with event code" link.
 *
 * Regression for production, where the public list began with a finished
 * event named "test" and the link sent every visitor there.
 */
import { describe, expect, it } from "vitest";
import { pickRegistrationEvent } from "@/lib/registrationEvent";

const NOW = Date.parse("2026-10-09T15:00:00Z");
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

const finishedTest = { event_code: "TEST", registration_start: day(-150), registration_end: day(-140), end_date: day(-130), derived_status: "completed" };
const openNow = { event_code: "OPEN", registration_start: day(-2), registration_end: day(5), end_date: day(9), derived_status: "upcoming" };
const upcomingNotYetOpen = { event_code: "SOON", registration_start: day(3), registration_end: day(10), end_date: day(20), derived_status: "upcoming" };

describe("pickRegistrationEvent", () => {
  it("skips a finished event that happens to be listed first", () => {
    expect(pickRegistrationEvent([finishedTest, openNow], NOW)?.event_code).toBe("OPEN");
  });
  it("prefers the event whose registration window is open now", () => {
    expect(pickRegistrationEvent([upcomingNotYetOpen, openNow], NOW)?.event_code).toBe("OPEN");
  });
  it("falls back to an event that has not finished when nothing is open", () => {
    expect(pickRegistrationEvent([finishedTest, upcomingNotYetOpen], NOW)?.event_code).toBe("SOON");
  });
  it("returns null when every event has finished, so the screen shows the hint", () => {
    expect(pickRegistrationEvent([finishedTest], NOW)).toBeNull();
    expect(pickRegistrationEvent([], NOW)).toBeNull();
    expect(pickRegistrationEvent(null, NOW)).toBeNull();
  });
  it("ignores rows without an event code", () => {
    expect(pickRegistrationEvent([{ ...openNow, event_code: "" }], NOW)).toBeNull();
  });
});
