/**
 * Answers the console's API reads from sample data while the walkthrough is on.
 *
 * This is a router, not a server: it recognises the read paths the organiser
 * screens use and returns the matching rows from `./console`. Anything it does
 * not recognise returns `undefined`, which the API client treats as "not part
 * of the demo" — so a path added later fails visibly during development rather
 * than silently rendering an empty screen.
 *
 * Writes never reach here. The API client refuses them separately: a
 * walkthrough anyone can open must not be able to reach the real backend, and
 * a visitor pressing Approve should get an explanation rather than a 401.
 */

import {
  DEMO_ANNOUNCEMENTS,
  DEMO_CRITERIA,
  DEMO_EVENT,
  DEMO_FEEDBACK,
  DEMO_INVITES,
  DEMO_JUDGES,
  DEMO_MENTORS,
  DEMO_PARTICIPANTS,
  DEMO_PRESENTATIONS,
  DEMO_RESOURCES,
  DEMO_SCORES,
  DEMO_SETTINGS,
  DEMO_SUBMISSIONS,
  DEMO_TEAMS,
  DEMO_TICKETS,
  DEMO_VOLUNTEER_TASKS,
  DEMO_VOLUNTEERS,
} from "./console";
import { resolveJudgingDemo } from "./judging";
import { resolveResultsDemo } from "./results";
import { resolveWrapupDemo } from "./wrapup";
import { resolveChatDemo } from "./chat";
import { resolveNotifyDemo } from "./notify";
import { resolveGalleryDemo } from "./gallery";
import { resolveCheckinDemo } from "./checkin";

/** The signed-in organiser the walkthrough presents as. */
const DEMO_ME = {
  id: 1,
  role: "admin",
  full_name: "Demo Organiser",
  email: "demo@hack-os.app",
};

const teamless = () => DEMO_PARTICIPANTS.filter((p) => p.status === "approved" && !p.current_team_id);

/** The capacity card on the participants page, worked out from the sample rows. */
function demoSummary() {
  const byStatus: Record<string, number> = { pending: 0, approved: 0, waitlisted: 0, rejected: 0, eliminated: 0 };
  for (const p of DEMO_PARTICIPANTS) byStatus[p.status] = (byStatus[p.status] || 0) + 1;
  const limit = DEMO_EVENT.max_participants;
  const taken = byStatus.pending + byStatus.approved;
  const free = teamless();
  return {
    capacity: { limit, taken, remaining: Math.max(0, limit - taken), full: taken >= limit, waitlistEnabled: true, approvalMode: "manual" },
    byStatus,
    total: DEMO_PARTICIPANTS.length,
    teamlessApproved: free.length,
    lookingForTeam: free.filter((p) => p.looking_for_team).length,
    teams: DEMO_TEAMS.filter((t) => t.status !== "eliminated").length,
    teamSize: { min: 1, max: DEMO_EVENT.max_team_size },
  };
}

/**
 * The organiser's home for the walkthrough: frozen in judging, with times
 * counted from now so "3 hours left" reads as it would on the day. The
 * counts come from the same sample rows the other screens show.
 */
function demoOverview() {
  const now = Date.now();
  const at = (h: number) => new Date(now + h * 3600e3).toISOString();
  const s = demoSummary();
  const open = DEMO_TICKETS.filter((x) => x.status === "open");
  const busy = DEMO_TICKETS.filter((x) => x.status === "in-progress");
  const done = DEMO_TICKETS.filter((x) => x.status === "resolved");
  const active = DEMO_TEAMS.filter((t) => t.status !== "eliminated");
  const handedIn = new Set(DEMO_SUBMISSIONS.map((x) => x.team_id));
  const tasksOpen = DEMO_VOLUNTEER_TASKS.filter((x) => x.status !== "done");
  const people = DEMO_PARTICIPANTS.slice(-4);
  const activity = [
    ...open.map((x, i) => ({ id: `help_asked:${x.id}`, type: "help_asked", at: at(-0.1 - i * 0.2), actor: null, subject: x.team_name, meta: { topic: x.topic } })),
    ...done.slice(0, 3).map((x, i) => ({ id: `help_resolved:${x.id}`, type: "help_resolved", at: at(-0.9 - i * 0.4), actor: x.mentor_name, subject: x.team_name, meta: { topic: x.topic, reason: "resolved" } })),
    ...DEMO_ANNOUNCEMENTS.slice(0, 2).map((x, i) => ({ id: `announced:${x.id}`, type: "announced", at: at(-1.2 - i * 3), actor: "Demo Organiser", subject: x.title, meta: { auto: false } })),
    ...DEMO_SUBMISSIONS.slice(0, 5).map((x, i) => ({ id: `submitted:${x.id}`, type: "submitted", at: at(-2.1 - i * 0.3), actor: null, subject: x.team_name, meta: { project: x.project_name } })),
    ...people.map((p, i) => ({ id: `registered:${p.id}`, type: "registered", at: at(-30 - i * 5), actor: null, subject: p.full_name, meta: { status: p.status } })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
  return {
    event: { id: DEMO_EVENT.id, name: DEMO_EVENT.name, slug: null, timezone: "Asia/Baku" },
    phase: { key: "judging", until: at(3) },
    next: { key: "judging_end", at: at(3) },
    milestones: [
      { key: "registration_opens", at: at(-24 * 30), state: "done" },
      { key: "registration_closes", at: at(-24 * 4), state: "done" },
      { key: "start", at: at(-50), state: "done" },
      { key: "submission_deadline", at: at(-2), state: "done" },
      { key: "judging_start", at: at(-1), state: "done" },
      { key: "judging_end", at: at(3), state: "next" },
      { key: "results", at: at(4), state: "upcoming" },
    ],
    formation: { open: false, closesAt: at(-50) },
    kpis: {
      participants: { total: s.total, byStatus: s.byStatus, capacity: s.capacity, new24h: 0, pendingOld: s.byStatus.pending },
      teams: {
        active: active.length, eliminated: DEMO_TEAMS.length - active.length,
        withoutSubmission: active.filter((t) => !handedIn.has(t.id)).length,
        teamlessApproved: s.teamlessApproved, looking: s.lookingForTeam,
      },
      submissions: { total: DEMO_SUBMISSIONS.length },
      help: { open: open.length, inProgress: busy.length, flagged: 0, waitingLong: 1, oldestOpenAt: at(-0.4), resolved24h: done.length, medianWaitMin: 6 },
      mentors: { total: DEMO_MENTORS.length, online: DEMO_MENTORS.filter((m) => m.online && m.presence !== "away").length },
      volunteers: {
        total: DEMO_VOLUNTEERS.length, tasksOpen: tasksOpen.length, tasksOverdue: 0,
        tasksUnassigned: tasksOpen.filter((x) => x.assignee_id == null).length,
      },
      announcements: { sent: DEMO_ANNOUNCEMENTS.length, scheduled: 0, nextScheduledAt: null, failed24h: 0 },
    },
    alerts: [
      { code: "help_waiting", severity: "danger", count: 1, href: "/help-queue", since: at(-0.4) },
      ...(s.byStatus.pending ? [{ code: "pending_old", severity: "warn", count: s.byStatus.pending, href: "/participants?status=pending" }] : []),
    ],
    activity,
    generatedAt: new Date(now).toISOString(),
  };
}

/** `/api/events/12/participants` → `["events", "12", "participants"]` */
function segments(path: string): string[] {
  const clean = path.split("?")[0].split("#")[0];
  return clean.split("/").filter(Boolean).slice(1); // drop the leading "api"
}

export function resolveDemoRead(path: string): unknown | undefined {
  const s = segments(path);
  if (s.length === 0) return undefined;

  // Judging, results and the stage, what comes after the event, the chat, the
  // photo gallery and check-in at the door answer from their own files first.
  const extra = resolveJudgingDemo(s) ?? resolveResultsDemo(s) ?? resolveWrapupDemo(s) ?? resolveChatDemo(s) ?? resolveGalleryDemo(s) ?? resolveCheckinDemo(s, path);
  if (extra !== undefined) return extra;
  // The bell.
  const bell = resolveNotifyDemo(s);
  if (bell !== undefined) return bell;

  // ── Session ────────────────────────────────────────────────────────
  if (s[0] === "auth" && s[1] === "me") return DEMO_ME;

  // ── Integration status: both off, so the screens show their real
  //    "not configured" states rather than pretending a live connection.
  if (s[0] === "telegram" && s[1] === "status") {
    return { telegramConfigured: false, configured: false, botUsername: null, hint: "Not connected in the walkthrough." };
  }
  if (s[0] === "telegram" && s[1] === "me") {
    return { configured: false, botUsername: null, linked: false, username: null, firstName: null, blocked: false };
  }
  if (s[0] === "mail" && s[1] === "status") {
    return { smtpConfigured: false, fromConfigured: false };
  }

  // ── Events ─────────────────────────────────────────────────────────
  if (s[0] === "events") {
    if (s.length === 1) return [DEMO_EVENT];
    if (s.length === 2) return DEMO_EVENT;

    switch (s[2]) {
      case "overview":
        return demoOverview();
      case "participants":
        if (s[3] === "summary") return demoSummary();
        if (s[3] === "unassigned") {
          return teamless().map((p) => ({
            id: p.id, user_id: p.user_id, full_name: p.full_name, email: p.email, skills: p.skills,
            looking_for_team: p.looking_for_team, looking_note: null,
          }));
        }
        return DEMO_PARTICIPANTS;
      case "mentors":
        if (s[3] === "slots") return [];
        return DEMO_MENTORS;
      case "volunteers":
        return DEMO_VOLUNTEERS.map((v) => ({
          ...v,
          tasks_todo: DEMO_VOLUNTEER_TASKS.filter((x) => x.assignee_id === v.user_id && x.status === "todo").length,
          tasks_doing: DEMO_VOLUNTEER_TASKS.filter((x) => x.assignee_id === v.user_id && x.status === "doing").length,
          tasks_done: DEMO_VOLUNTEER_TASKS.filter((x) => x.assignee_id === v.user_id && x.status === "done").length,
        }));
      case "volunteer-tasks":
        return DEMO_VOLUNTEER_TASKS;
      case "invites":
        return DEMO_INVITES;
      case "participant-invites": {
        // The walkthrough has sent no personal invitations: the screen shows its empty state.
        const s = demoSummary();
        return {
          event: { id: DEMO_EVENT.id, name: DEMO_EVENT.name, slug: null, visibility: "public", published: true, archived: false, language: "en" },
          items: [],
          counts: { not_sent: 0, sent: 0, opened: 0, registered: 0, expired: 0, revoked: 0, total: 0 },
          capacity: { limit: s.capacity.limit, taken: s.capacity.taken, outstanding: 0, remaining: s.capacity.remaining, overBy: 0 },
          limits: { batch: 500, defaultDays: 14, maxDays: 60, dailySends: 2000 },
        };
      }
      case "presentations":
        if (s[3] === "settings") return { order: "submission", slotMinutes: 3, qaMinutes: 2, warnSeconds: 60, demoDay: null };
        return DEMO_PRESENTATIONS;
      case "resources":
        return DEMO_RESOURCES;
      case "feedback":
        return DEMO_FEEDBACK;
      case "settings":
        return DEMO_SETTINGS;
      case "telegram":
        return { configured: false, botUsername: null, linked: false, channel: null };
      case "tracks":
        return [];
      case "judging":
        if (s[3] === "criteria") return DEMO_CRITERIA;
        if (s[3] === "judges") return DEMO_JUDGES;
        if (s[3] === "scores") return DEMO_SCORES;
        return undefined;
      default:
        return undefined;
    }
  }

  // ── Collections the screens read with an eventId query ──────────────
  if (s[0] === "teams") {
    if (s.length === 1) return DEMO_TEAMS;
    const id = Number(s[1]);
    const team = DEMO_TEAMS.find((t) => t.id === id);
    if (!team) return undefined;
    if (s[2] === "members") return team.members;
    return team;
  }

  if (s[0] === "submissions") {
    if (s.length === 1) return DEMO_SUBMISSIONS;
    const id = Number(s[1]);
    return DEMO_SUBMISSIONS.find((x) => x.id === id);
  }

  if (s[0] === "tickets") {
    if (s.length === 1) return DEMO_TICKETS;
    const id = Number(s[1]);
    return DEMO_TICKETS.find((x) => x.id === id);
  }

  if (s[0] === "announcements") {
    if (s.length === 1) return DEMO_ANNOUNCEMENTS;
    if (s[1] === "audience") {
      const people = DEMO_PARTICIPANTS.length;
      return { audience: "everyone", people, email: people, telegram: 0, channel: null };
    }
    if (s[2] === "deliveries") return { report: {}, problems: [] };
    const id = Number(s[1]);
    return DEMO_ANNOUNCEMENTS.find((x) => x.id === id);
  }

  return undefined;
}
