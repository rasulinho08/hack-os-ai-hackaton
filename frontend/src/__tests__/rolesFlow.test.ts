/**
 * Participant, judge, mentor and volunteer screens: the rules behind what
 * they show — team formation on the registration form, the team page's
 * labels, staff announcements, people's choice captions, the pending
 * screen's facts, the language a link names, and the judge's "changed since
 * your review" marker.
 */
import { describe, expect, it } from "vitest";
import { entryOptions, type TeamFormation } from "@/lib/builder/registrationCheck";
import { memberLabel } from "@/lib/teamNormalize";
import { forStaff, normalizeAnnouncement } from "@/lib/announcements";
import { teamCaption } from "@/lib/voting";
import { registrationFacts } from "@/lib/participantProgress";
import { langFromSearch } from "@/lib/i18n";
import { eventEnded, teamFormationOpen } from "@/lib/eventPhase";
import { normalizeMyJudging, normalizeProgress } from "@/lib/judging";
import { teamInviteUrl } from "@/lib/teamInviteUrl";

const tf = (o: Partial<TeamFormation>): TeamFormation => ({ open: false, closesAt: "2026-10-20T08:00:00Z", reason: "deadline", minTeamSize: 1, soloCanCompete: true, ...o });

describe("registration while team formation is closed", () => {
  it("offers every way while open", () => {
    expect(entryOptions({ registration_mode: "both", registration: { teamFormation: tf({ open: true, reason: null }) } }).allowed).toEqual(["solo", "lead", "member"]);
    expect(entryOptions({ registration_mode: "both" }).allowed).toEqual(["solo", "lead", "member"]); // an older API says nothing
  });
  it("only alone once it closed, with the reason", () => {
    const o = entryOptions({ registration_mode: "both", registration: { teamFormation: tf({}) } });
    expect(o.allowed).toEqual(["solo"]);
    expect(o.closed?.reason).toBe("deadline");
    expect(o.blocked).toBeNull();
  });
  it("nobody, where alone could never hand in a project or the event is for teams only", () => {
    expect(entryOptions({ registration_mode: "both", registration: { teamFormation: tf({ minTeamSize: 2, soloCanCompete: false }) } }).blocked).toBe("solo_cannot_compete");
    expect(entryOptions({ registration_mode: "team", registration: { teamFormation: tf({}) } }).blocked).toBe("teams_only");
  });
  it("the preview and the dashboard read team formation the API's way", () => {
    const now = Date.parse("2026-10-20T10:00:00Z");
    expect(teamFormationOpen({ team_deadline: "2026-10-20T09:00:00Z", start_date: "2026-10-21T00:00:00Z" }, now)).toBe(false);
    expect(teamFormationOpen({ team_deadline: null, start_date: "2026-10-21T00:00:00Z" }, now)).toBe(true);
    expect(teamFormationOpen({ start_date: "2026-10-21T00:00:00Z", allow_team_formation: false }, now)).toBe(false);
    expect(teamFormationOpen(null, now)).toBe(true);
    expect(eventEnded({ end_date: "2026-10-20T09:59:00Z" }, now)).toBe(true);
    expect(eventEnded({ end_date: "2026-10-20T10:01:00Z" }, now)).toBe(false);
    expect(eventEnded({}, now)).toBe(false);
  });
});

describe("team page", () => {
  it("names roles in plain words and says who is not accepted yet", () => {
    expect(memberLabel({ is_lead: true, status: "approved" })).toEqual({ roleKey: "hacker.my_team.role_lead", statusKey: null });
    expect(memberLabel({ is_lead: false, status: "pending" })).toEqual({ roleKey: "hacker.my_team.role_member", statusKey: "hacker.my_team.status_pending" });
    expect(memberLabel({ status: "waitlisted" }).statusKey).toBe("hacker.my_team.status_waitlisted");
    expect(memberLabel({ status: "rejected" }).statusKey).toBe("hacker.my_team.status_rejected");
    expect(memberLabel({}).statusKey).toBeNull();
  });
  it("one invite link, the registration page with the team's code", () => {
    expect(teamInviteUrl("https://app.x/", "rolesaud1", "ab12cd")).toBe("https://app.x/e/rolesaud1/register?team=ab12cd");
    expect(teamInviteUrl("https://app.x", "", "ab12cd")).toBe("");
    expect(teamInviteUrl("https://app.x", "ev", null)).toBe("");
  });
});

describe("staff announcements", () => {
  const list = [
    { id: 1, title: "Tell friends who have not registered yet", audience: "everyone", source: "auto" },
    { id: 2, title: "Lunch moved to 14:00", audience: "everyone", source: "app" },
    { id: 3, title: "Judges' briefing", audience: "judges", source: "app" },
    { id: 4, title: "Mentors meet at 9", audience: "mentors", source: "app" },
    { id: 5, title: "Welcome hackers", audience: "participants", source: "app" },
    { id: 6, title: "Staff dinner", audience: "staff", source: "app" },
  ].map((x) => normalizeAnnouncement(x));
  it("a judge sees the judges', the staff's and the organisers' posts to everyone", () => {
    expect(forStaff(list, "judge").map((a) => a.id)).toEqual([2, 3, 6]);
    expect(forStaff(list, "mentor").map((a) => a.id)).toEqual([2, 4, 6]);
  });
  it("reads the event and whether it is automatic", () => {
    const a = normalizeAnnouncement({ id: 9, title: "x", event_id: 42, automatic: true });
    expect(a.eventId).toBe(42);
    expect(a.automatic).toBe(true);
  });
});

describe("people's choice", () => {
  it("does not say Team twice", () => {
    expect(teamCaption("Beta", "Team {team}")).toBe("Team Beta");
    expect(teamCaption("Team Beta", "Team {team}")).toBe("Team Beta");
    expect(teamCaption("team-beta", "Team {team}")).toBe("team-beta");
    expect(teamCaption("Kodçular komandası", "{team} komandası")).toBe("Kodçular komandası");
    expect(teamCaption("Teamwork", "Team {team}")).toBe("Team Teamwork");
  });
});

describe("pending screen", () => {
  it("names the event, the team, the date and the e-mail state", () => {
    const facts = registrationFacts(
      { eventName: "Roles Audit Hack", registeredAt: "2026-10-18T09:00:00Z", team: { name: "Team Alpha" } },
      { email_verified: false },
    );
    expect(facts).toEqual({ eventName: "Roles Audit Hack", teamName: "Team Alpha", registeredAt: "2026-10-18T09:00:00Z", emailVerified: false });
    expect(registrationFacts({ eventName: "X", team: null }, null)).toMatchObject({ teamName: null, emailVerified: null });
    expect(registrationFacts(null, null)).toBeNull();
  });
});

describe("language from a link", () => {
  it("takes ?lang= when it is one the app speaks", () => {
    expect(langFromSearch("?token=abc&lang=az")).toBe("az");
    expect(langFromSearch("?lang=RU")).toBe("ru");
    expect(langFromSearch("?lang=de")).toBeNull();
    expect(langFromSearch("")).toBeNull();
  });
});

describe("judging: changed since the review", () => {
  it("the judge's view carries the marker, the window says when judging opens", () => {
    const m = normalizeMyJudging({
      event: { id: 1, name: "E" },
      window: { state: "not_open", start: "2026-10-21T00:00:00Z", end: null, startsAtDeadline: true },
      teams: [{ teamId: 5, submissionId: 9, state: "done", changedSinceReview: true, changedAt: "2026-10-20T10:00:00Z", reviewedAt: "2026-10-20T09:00:00Z" }],
      progress: { total: 1, done: 1, partial: 0, changed: 1 },
    });
    expect(m.window.startsAtDeadline).toBe(true);
    expect(m.teams[0].changedSinceReview).toBe(true);
    expect(m.teams[0].changedAt).toBe("2026-10-20T10:00:00Z");
    expect(m.progress.changed).toBe(1);
  });
  it("the organiser's matrix marks the cells", () => {
    const p = normalizeProgress({
      cells: [{ judgeId: 1, teamId: 5, state: "done", changedSinceReview: true }, { judgeId: 2, teamId: 5, state: "done" }],
      changedSinceReview: 1, judges: [{ id: 1, changed: 1 }], teams: [{ id: 5, changed: 1 }],
    });
    expect(p.changed.has("1:5")).toBe(true);
    expect(p.changed.has("2:5")).toBe(false);
    expect(p.changedCount).toBe(1);
    expect(p.judges[0].changed).toBe(1);
    expect(p.teams[0].changed).toBe(1);
  });
});
