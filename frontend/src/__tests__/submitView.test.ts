/**
 * The submit page says one thing at a time: editable, or the one reason it
 * is not — and links typed without https:// are completed.
 */
import { describe, expect, it } from "vitest";
import { normaliseLink, shortTimeLeft, submissionCloses, submitView } from "@/lib/submitView";

const base = { hasTeam: true, submitAs: "lead" as const, windowState: "open" as const, teamSizeOk: true, hasSubmission: false };

describe("submitView", () => {
  it("the lead in the window: a new project, then an update", () => {
    expect(submitView(base)).toMatchObject({ editable: true, banner: null, title: "hacker.submit.title_new" });
    expect(submitView({ ...base, hasSubmission: true })).toMatchObject({ editable: true, title: "hacker.submit.title_update", subtitle: "hacker.submit.subtitle_update" });
  });

  it("after the deadline a member reads one message, not three", () => {
    const v = submitView({ ...base, submitAs: "none", windowState: "closed", hasSubmission: true });
    expect(v.editable).toBe(false);
    expect(v.banner).toBe("closed");
    expect(v.title).toBe("hacker.submit.title_view");
    expect(v.subtitle).toBe("hacker.submit.subtitle_view_closed");
    expect(v.memberMayHandIn).toBe(false);
  });

  it("before the deadline a member who is not the lead sees why it is read-only", () => {
    const v = submitView({ ...base, submitAs: "none", hasSubmission: true });
    expect(v).toMatchObject({ editable: false, banner: "lead_only", title: "hacker.submit.title_view", subtitle: "hacker.submit.subtitle_view" });
  });

  it("the most basic reason wins: no team, not started, closed, not the lead, too small", () => {
    expect(submitView({ ...base, hasTeam: false, windowState: "closed" }).banner).toBe("no_team");
    expect(submitView({ ...base, windowState: "not_started", submitAs: "none" }).banner).toBe("not_started");
    expect(submitView({ ...base, teamSizeOk: false, submitAs: "none" }).banner).toBe("lead_only");
    expect(submitView({ ...base, teamSizeOk: false }).banner).toBe("team_too_small");
  });

  it("an accepted member may hand in while the lead is not accepted, only while it is open", () => {
    expect(submitView({ ...base, submitAs: "member" }).memberMayHandIn).toBe(true);
    expect(submitView({ ...base, submitAs: "member", windowState: "closed" }).memberMayHandIn).toBe(false);
  });
});

describe("deadline", () => {
  it("is the submission deadline, else the end", () => {
    expect(submissionCloses({ submission_deadline: "2026-10-21T03:17:00Z", end_date: "2026-10-22T00:00:00Z" })).toBe("2026-10-21T03:17:00Z");
    expect(submissionCloses({ submission_deadline: null, end_date: "2026-10-22T00:00:00Z" })).toBe("2026-10-22T00:00:00Z");
    expect(submissionCloses({})).toBeNull();
  });

  it("says the time left briefly", () => {
    const now = Date.parse("2026-10-21T01:03:00Z");
    const u = { d: "d", h: "h", m: "min" };
    expect(shortTimeLeft("2026-10-21T03:17:00Z", now, u)).toBe("2 h 14 min");
    expect(shortTimeLeft("2026-10-23T05:03:00Z", now, u)).toBe("2 d 4 h");
    expect(shortTimeLeft("2026-10-21T01:03:30Z", now, u)).toBe("1 min");
    expect(shortTimeLeft("2026-10-21T01:00:00Z", now, u)).toBeNull();
  });
});

describe("normaliseLink", () => {
  it("completes a host typed without https://", () => {
    expect(normaliseLink("github.com/alpha/assistant")).toBe("https://github.com/alpha/assistant");
    expect(normaliseLink(" www.demo.app/x?y=1 ")).toBe("https://www.demo.app/x?y=1");
  });
  it("leaves links with a scheme, and things that are not links, alone", () => {
    expect(normaliseLink("https://gitlab.com/a/b")).toBe("https://gitlab.com/a/b");
    expect(normaliseLink("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(normaliseLink("not a link")).toBe("not a link");
    expect(normaliseLink("")).toBe("");
  });
});
