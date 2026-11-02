/**
 * The owner console's list queries and the words it prints: what a list
 * request asks the server for, and how months, times and audit actions read.
 */

import { describe, expect, it } from "vitest";
import { actionWords, ago, day, listQueryString, monthLabel } from "@/lib/superadmin/directory";

describe("listQueryString", () => {
  it("sends only what is set, with the page counted from one", () => {
    expect(listQueryString({})).toBe("");
    expect(listQueryString({ q: "  acme  ", sort: "revenue", dir: "desc", page: 2, pageSize: 25 })).toBe(
      "q=acme&sort=revenue&dir=desc&page=2&pageSize=25",
    );
    expect(listQueryString({ page: 1 })).toBe("");
  });

  it("joins a filter's values and leaves empty ones out", () => {
    expect(
      listQueryString({ filters: { status: ["active", "pending_review"], plan: [], customerId: 12, unpaid: false, eventId: null, q2: "" } }),
    ).toBe("status=active%2Cpending_review&customerId=12");
  });

  it("encodes what the reader typed", () => {
    expect(listQueryString({ q: "a&b=c #1" })).toBe("q=a%26b%3Dc+%231");
  });
});

describe("monthLabel", () => {
  it("reads a month key as a calendar month", () => {
    expect(monthLabel("2026-10")).toBe("Oct 2026");
    expect(monthLabel("2026-01", true)).toBe("Jan");
    expect(monthLabel("not a month")).toBe("not a month");
  });
});

describe("ago", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");
  it("says how long ago, then falls back to the date", () => {
    expect(ago("2026-10-23T11:59:30Z", now)).toBe("just now");
    expect(ago("2026-10-23T11:55:00Z", now)).toBe("5 min ago");
    expect(ago("2026-10-23T09:00:00Z", now)).toBe("3 h ago");
    expect(ago("2026-10-20T12:00:00Z", now)).toBe("3 d ago");
    expect(ago("2026-09-01T12:00:00Z", now)).toBe(day("2026-09-01T12:00:00Z"));
    expect(ago(null, now)).toBe("—");
    expect(ago("garbage", now)).toBe("—");
  });
});

describe("actionWords", () => {
  it("has words for the owner's own actions and readable ones for the rest", () => {
    expect(actionWords("order.approve")).toBe("approved an order");
    expect(actionWords("session.revoke_all")).toBe("ended every session");
    expect(actionWords("webhook.rotate_secret")).toBe("webhook rotate secret");
  });
});
