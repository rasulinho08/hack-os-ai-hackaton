/**
 * The help queue, mentors and volunteer tasks as the pages read them: rows
 * from the API become stable shapes, mentors are suggested by what a request
 * mentions and who is around, waiting times are summed up honestly, and
 * failures are put in the reader's words.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import {
  helpErrorWords, medianWait, minutesSince, normalizeMentors, normalizeSlots, normalizeTicket, normalizeTickets,
  rankMentors, skillsMentioned, ticketStatus,
} from "@/lib/helpQueue";
import { fromLocalInput, isOverdue, normalizeTasks, normalizeVolunteers, progress, toLocalInput } from "@/lib/volunteerTasks";

describe("help requests", () => {
  it("reads a request with who asked, who was asked for and why it closed", () => {
    const tk = normalizeTicket({
      id: 5, event_id: 9, topic: " CORS ", description: "fetch fails", status: "resolved", closed_reason: "withdrawn",
      priority: "URGENT", preferred_mentor_id: 3, preferred_mentor: "Aysel", mentor_id: null, escalated_to_admin: false,
      created_at: "2026-10-19T10:00:00Z", table_location: "Table 7",
    });
    expect(tk).toMatchObject({ id: 5, topic: "CORS", status: "resolved", closedReason: "withdrawn", priority: "urgent", preferredMentor: "Aysel", tableLocation: "Table 7" });
    expect(normalizeTicket({ id: 6, preferred_mentor_name: "Rauf" })?.preferredMentor).toBe("Rauf");
    expect(normalizeTickets([null, { id: 0 }, { id: 7, status: "claimed" }]).map((x) => x.status)).toEqual(["in-progress"]);
  });

  it("maps the old status spellings", () => {
    expect(ticketStatus("in_progress")).toBe("in-progress");
    expect(ticketStatus("Closed")).toBe("resolved");
    expect(ticketStatus("whatever")).toBe("open");
  });

  it("measures waiting from asking to a mentor taking it (the middle value)", () => {
    const at = (m: number) => new Date(Date.UTC(2026, 9, 19, 10, m)).toISOString();
    const rows = normalizeTickets([
      { id: 1, created_at: at(0), claimed_at: at(4) },
      { id: 2, created_at: at(0), claimed_at: at(10) },
      { id: 3, created_at: at(0), claimed_at: at(2) },
      { id: 4, created_at: at(0) },
    ]);
    expect(medianWait(rows)).toBe(4);
    expect(medianWait([])).toBeNull();
    expect(minutesSince(at(0), Date.UTC(2026, 9, 19, 10, 7, 30))).toBe(7);
    expect(minutesSince(null)).toBe(0);
  });
});

describe("mentors", () => {
  const mentors = normalizeMentors([
    { id: 1, user_id: 11, full_name: "Aysel", skills: ["React", "Node.js"], presence: "available", online: true, active_tickets: 1 },
    { id: 2, user_id: 12, full_name: "Rauf", skills: '["Go","Docker"]', presence: "away", online: false },
    { id: 3, user_id: 13, full_name: "Nigar", skills: "Python, ML", presence: "available", online: false, next_slot: { starts_at: "2026-10-19T12:00:00Z", ends_at: "2026-10-19T14:00:00Z", mode: "online" } },
    { id: 4, user_id: 0, full_name: "broken" },
  ]);

  it("reads skills in any shape and the next hours", () => {
    expect(mentors.map((m) => m.name)).toEqual(["Aysel", "Rauf", "Nigar"]);
    expect(mentors[1].skills).toEqual(["Go", "Docker"]);
    expect(mentors[2].skills).toEqual(["Python", "ML"]);
    expect(mentors[2].nextSlot).toMatchObject({ mode: "online" });
    expect(normalizeMentors([{ id: 9, user_id: 9, presence: "sleeping", online: "yes" }])[0]).toMatchObject({ presence: null, online: null });
  });

  it("finds the skills a request mentions, whole words for short ones", () => {
    expect(skillsMentioned(["Go", "Docker", "React"], "Docker build fails in our Go service")).toEqual(["Go", "Docker"]);
    expect(skillsMentioned(["Go"], "Google login does not work")).toEqual([]);
    expect(skillsMentioned(["Node.js"], "node.js crashes")).toEqual(["Node.js"]);
  });

  it("suggests who fits first, then who is around", () => {
    expect(rankMentors(mentors, "Docker image too big").map((m) => m.name)).toEqual(["Rauf", "Aysel", "Nigar"]);
    expect(rankMentors(mentors, "").map((m) => m.name)).toEqual(["Aysel", "Nigar", "Rauf"]);
  });

  it("reads slots and drops broken ones", () => {
    const s = normalizeSlots([{ id: 1, user_id: 11, mentor_name: "Aysel", starts_at: "2026-10-19T12:00:00Z", ends_at: "2026-10-19T13:00:00Z", mode: "onsite" }, { id: 2 }]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ mentorName: "Aysel", mode: "onsite" });
  });

  it("puts failures in the reader's words", () => {
    const t = (k: string) => ({ "hq.err.TICKET_TAKEN": "Taken!", "hq.failed": "Nope" } as Record<string, string>)[k] ?? k;
    expect(helpErrorWords(new ApiError("x", 409, [], "TICKET_TAKEN"), t)).toBe("Taken!");
    expect(helpErrorWords(new ApiError("x", 500), t)).toBe("Nope");
  });
});

describe("volunteer tasks", () => {
  it("reads tasks and volunteers with their progress", () => {
    const tasks = normalizeTasks([{ id: 1, title: " Desk ", status: "doing", due_at: "2020-01-01T00:00:00Z", assignee_id: 4 }, { id: 2, status: "weird" }, null]);
    expect(tasks.map((x) => [x.title, x.status])).toEqual([["Desk", "doing"], ["—", "todo"]]);
    expect(isOverdue(tasks[0])).toBe(true);
    expect(isOverdue({ ...tasks[0], status: "done" })).toBe(false);
    const vs = normalizeVolunteers([{ id: 3, user_id: 4, full_name: "Leyla", tasks_todo: 1, tasks_doing: 1, tasks_done: 2, assigned_tasks: " " }]);
    expect(vs[0]).toMatchObject({ name: "Leyla", note: null, done: 2 });
    expect(progress(vs[0])).toBe(50);
    expect(progress({ todo: 0, doing: 0, done: 0 })).toBeNull();
  });

  it("round-trips a local date-time input", () => {
    const iso = "2026-10-19T08:30:00.000Z";
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
    expect(toLocalInput(null)).toBe("");
    expect(fromLocalInput("")).toBeNull();
  });
});
