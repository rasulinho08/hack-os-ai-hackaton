/**
 * People and teams on the organiser's and the participant's pages: the rows
 * the API sends become the shapes the pages draw, a bulk result reads right,
 * the team CSV round-trips (export → import), and matchmaking answers in
 * either mode with the reasons behind each suggestion.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { bulkCounts, normalizeParticipant, normalizeParticipants } from "@/lib/participantsAdmin";
import { normalizeTeam, normalizeTeamless, normalizeTeams, planTeamImport, teamsCsvRows, TEAM_CSV_HEADERS } from "@/lib/teamsAdmin";
import { errorWords, isFormationClosed, normalizeIncoming, normalizeMyRequests, normalizeOverview } from "@/lib/matchmaking";
import { parseCSV } from "@/lib/csvImport";
import { toCSV } from "@/lib/csvExport";

describe("participants for the organiser", () => {
  it("reads a row of the list, team and lead included", () => {
    const p = normalizeParticipant({
      id: 7, user_id: 70, full_name: " Aysel Məmmədova ", email: "aysel@example.az", status: " Approved ",
      current_team_id: 3, team_name: "Byte Bakers", team_leader: true, looking_for_team: false,
      skills: '["React","Figma"]', university: "ADA", ref_source: "instagram", registered_at: "2026-10-01T09:00:00Z",
      answers: { motivation: "Build things" },
    });
    expect(p).toMatchObject({
      id: 7, userId: 70, name: "Aysel Məmmədova", status: "approved", teamId: 3, teamName: "Byte Bakers",
      isLead: true, skills: ["React", "Figma"], source: "instagram", answers: { motivation: "Build things" },
    });
  });

  it("keeps an unknown status as pending and drops what is not a row", () => {
    expect(normalizeParticipant({ id: 1, status: "weird" }).status).toBe("pending");
    expect(normalizeParticipants([null, 3, { id: 2, status: "waitlisted" }]).map((p) => p.status)).toEqual(["waitlisted"]);
    expect(normalizeParticipants({})).toEqual([]);
  });

  it("is not a lead without a team in this event", () => {
    expect(normalizeParticipant({ id: 1, team_leader: null, is_team_lead: true, current_team_id: null }).isLead).toBe(false);
  });

  it("separates the people a full event refused from other skips", () => {
    const c = bulkCounts({
      changed: [{ id: 1, from: "pending", to: "approved" }],
      skipped: [{ id: 2, reason: "CAPACITY_FULL" }, { id: 3, reason: "UNCHANGED" }, { id: 4, reason: "CAPACITY_FULL" }],
    });
    expect(c).toEqual({ updated: 1, full: [2, 4], other: 1 });
  });
});

const TEAMS = normalizeTeams([
  {
    id: 1, name: "Byte Bakers", join_code: "ab12cd34", leader_id: 10, status: "active", recruiting: true,
    wanted_skills: ["Design"], members: [
      { id: 10, full_name: "Lead One", email: "lead@x.az", is_leader: true },
      { id: 11, full_name: "Two", email: "two@x.az", is_leader: false },
    ],
  },
  { id: 2, name: "=EVIL()", join_code: "zz", status: "eliminated", elimination_reason: "Late", members: "[]" },
]);

const FREE = normalizeTeamless([
  { user_id: 20, full_name: "Free A", email: "a@x.az", skills: ["Go"], looking_for_team: true },
  { user_id: 21, full_name: "Free B", email: "b@x.az" },
  { user_id: 22, full_name: "Free C", email: "c@x.az" },
]);

describe("teams for the organiser", () => {
  it("reads teams, members and the lead", () => {
    expect(TEAMS).toHaveLength(2);
    expect(TEAMS[0].members.map((m) => [m.name, m.isLead])).toEqual([["Lead One", true], ["Two", false]]);
    expect(TEAMS[0].wantedSkills).toEqual(["Design"]);
    expect(TEAMS[1]).toMatchObject({ status: "eliminated", eliminationReason: "Late", members: [] });
    expect(normalizeTeam({ id: 5, members: [{ id: 9, email: "x@y" }], leader_id: 9 }).members[0].isLead).toBe(true);
    expect(FREE[0]).toMatchObject({ userId: 20, looking: true, skills: ["Go"] });
  });

  it("exports one row per member and defuses formulas", () => {
    const rows = teamsCsvRows(TEAMS);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ Team: "Byte Bakers", Email: "lead@x.az", Lead: "yes", Recruiting: "yes" });
    const csv = toCSV(rows, TEAM_CSV_HEADERS.map((h) => ({ key: h, header: h })));
    expect(csv).toContain("'=EVIL()");
    expect(csv.split("\r\n")[0]).toBe(TEAM_CSV_HEADERS.join(","));
  });

  it("plans an import: new teams, people added to existing ones, and why the rest were skipped", () => {
    const csv = [
      "Team,Email,Lead",
      "New Crew,a@x.az,",
      "New Crew,b@x.az,yes",
      "byte bakers,c@x.az,",
      "Byte Bakers,two@x.az,",
      "Other,a@x.az,",
      "Other,ghost@x.az,",
      ",lonely@x.az,",
    ].join("\n");
    const plan = planTeamImport(parseCSV(csv), { teams: TEAMS, teamless: FREE, maxSize: 3 });
    expect(plan.create).toEqual([
      { name: "New Crew", memberIds: [20, 21], leaderId: 21 },
      { name: "Other", memberIds: [], leaderId: null },
    ]);
    expect(plan.add).toEqual([{ teamId: 1, teamName: "Byte Bakers", userIds: [22] }]);
    expect(plan.skipped).toEqual([
      { email: "a@x.az", team: "Other", reason: "twice" },
      { email: "ghost@x.az", team: "Other", reason: "unknown" },
    ]);
  });

  it("does not fill a team past its size, and reads Azerbaijani headers", () => {
    const csv = "Komanda;E-poçt\nByte Bakers;a@x.az\nByte Bakers;b@x.az";
    const plan = planTeamImport(parseCSV(csv), { teams: TEAMS, teamless: FREE, maxSize: 3 });
    expect(plan.add).toEqual([{ teamId: 1, teamName: "Byte Bakers", userIds: [20] }]);
    expect(plan.skipped).toEqual([{ email: "b@x.az", team: "Byte Bakers", reason: "full" }]);
  });

  it("tells a person already in a team from an unknown address", () => {
    const plan = planTeamImport(parseCSV("Team,Email\nNew,two@x.az"), { teams: TEAMS, teamless: FREE, maxSize: 4 });
    expect(plan.skipped).toEqual([{ email: "two@x.az", team: "New", reason: "taken" }]);
  });
});

describe("finding a team", () => {
  it("reads the solo view with the reasons behind each suggestion", () => {
    const o = normalizeOverview({
      mode: "solo", formation: { open: true, closesAt: "2026-11-01T09:00:00.000Z" }, teamSize: 4,
      me: { looking: true, note: "Frontend", skills: ["React"] },
      teams: [{ id: 3, name: "Data Crew", openSpots: 2, size: 2, wantedSkills: ["React"], matched: ["React"], brings: [], recruiting: true }],
      people: [{ userId: 9, name: "Go Dev", skills: ["Go"], matched: [], brings: ["Go"], looking: true }],
    });
    expect(o.mode).toBe("solo");
    if (o.mode !== "solo") throw new Error("mode");
    expect(o.formation).toEqual({ open: true, closesAt: "2026-11-01T09:00:00.000Z" });
    expect(o.teams[0]).toMatchObject({ id: 3, openSpots: 2, matched: ["React"], recruiting: true });
    expect(o.people[0]).toMatchObject({ userId: 9, brings: ["Go"], looking: true });
  });

  it("reads the team view and assumes teams can change when the API does not say", () => {
    const o = normalizeOverview({ mode: "team", team: { id: 3, name: "Data Crew", size: 2, isLead: true, wantedSkills: ["React"] }, people: [] });
    expect(o.mode).toBe("team");
    if (o.mode !== "team") throw new Error("mode");
    expect(o.team).toMatchObject({ id: 3, isLead: true, wantedSkills: ["React"] });
    expect(o.formation.open).toBe(true);
    expect(o.teamSize).toBe(4);
  });

  it("reads requests both ways", () => {
    expect(normalizeMyRequests([{ id: 1, team_id: 3, team_name: "Data Crew", status: "declined" }, { id: 0 }])).toEqual([
      { id: 1, teamId: 3, teamName: "Data Crew", status: "declined", message: null, createdAt: null },
    ]);
    expect(normalizeIncoming([{ id: 4, user_id: 9, full_name: "Go Dev", skills: ["Go"], message: "hi" }])[0]).toMatchObject({ id: 4, userId: 9, skills: ["Go"], message: "hi" });
  });

  it("says what went wrong from the API's code, or plainly", () => {
    const dict: Record<string, string> = { "mm.err.TEAM_FULL": "Full!", "mm.failed": "Did not work" };
    const t = (k: string) => dict[k] ?? k;
    expect(errorWords(new ApiError("x", 400, [], "TEAM_FULL"), t)).toBe("Full!");
    expect(errorWords(new ApiError("x", 400, [], "SOMETHING_NEW"), t)).toBe("Did not work");
    expect(errorWords(new Error("boom"), t)).toBe("Did not work");
    expect(isFormationClosed(new ApiError("x", 403, [], "TEAM_FORMATION_CLOSED"))).toBe(true);
    expect(isFormationClosed(new Error("x"))).toBe(false);
  });
});
