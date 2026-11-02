/**
 * Running an event (announcements, Telegram, people, staff, the event homes): every
 * string exists in AZ, EN and RU with the same {placeholders}, and every key
 * the pages ask for is defined — dynamic keys are expanded from the same
 * lists the code uses.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import en from "@/lib/i18n/ops/en";
import az from "@/lib/i18n/ops/az";
import ru from "@/lib/i18n/ops/ru";
import { AUDIENCES, DELIVERY_KINDS, PRIORITIES, TEMPLATES } from "@/lib/announcementsAdmin";
import { PARTICIPANT_STATUSES } from "@/lib/participantsAdmin";
import { ACTIVITY_STATUSES, ACTIVITY_TYPES, ALERT_CODES, CLOSE_REASONS, MILESTONES, PHASES, STAFF_ROLES } from "@/lib/eventOverview";
import { NEXT_CODES, STAGES, STAGE_STATES, STEPS_WITH_BUTTON, TIMED_STEPS } from "@/lib/participantProgress";

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

const ROOT = join(__dirname, "..");
const SOURCES = [
  ...walk(join(ROOT, "components", "announcements")),
  ...walk(join(ROOT, "components", "teams")),
  ...walk(join(ROOT, "components", "help")),
  ...walk(join(ROOT, "components", "volunteer")),
  ...walk(join(ROOT, "components", "overview")),
  join(ROOT, "app", "(dashboard)", "page.tsx"),
  join(ROOT, "app", "hacker", "page.tsx"),
  join(ROOT, "lib", "eventOverview.ts"),
  join(ROOT, "lib", "participantProgress.ts"),
  join(ROOT, "app", "(dashboard)", "mentors", "page.tsx"),
  join(ROOT, "app", "(dashboard)", "help-queue", "page.tsx"),
  join(ROOT, "app", "(dashboard)", "volunteers", "page.tsx"),
  join(ROOT, "app", "hacker", "help", "page.tsx"),
  join(ROOT, "app", "mentor", "page.tsx"),
  join(ROOT, "app", "volunteer", "page.tsx"),
  join(ROOT, "app", "volunteer", "tasks", "page.tsx"),
  join(ROOT, "lib", "helpQueue.ts"),
  join(ROOT, "app", "(dashboard)", "announcements", "page.tsx"),
  join(ROOT, "app", "(dashboard)", "participants", "page.tsx"),
  join(ROOT, "app", "(dashboard)", "teams", "page.tsx"),
  join(ROOT, "app", "hacker", "lobby", "page.tsx"),
  join(ROOT, "app", "hacker", "team", "page.tsx"),
  join(ROOT, "lib", "i18n", "tableLabels.ts"),
  join(ROOT, "lib", "matchmaking.ts"),
].filter(existsSync);

const PREFIXES = "(?:an|tg|tgme|pt|tm|mm|tbl|hq|mt|vt|ov|pg)";
const DYNAMIC: Record<string, string[]> = {
  "an.aud.": [...AUDIENCES],
  "an.audhint.": [...AUDIENCES],
  "an.prio.": [...PRIORITIES],
  "an.tpl.": [...TEMPLATES, ...TEMPLATES.map((k) => `${k}_t`), ...TEMPLATES.map((k) => `${k}_b`)],
  "an.d.": [...DELIVERY_KINDS],
  "an.err.": ["REQUIRED", "TOO_LONG", "INVALID", "IN_PAST", "TOO_FAR", "EMAIL_LIMIT", "MODULE_DISABLED"],
  "pt.status.": [...PARTICIPANT_STATUSES],
  "pt.approval.": ["manual", "auto", "team"],
  "tm.err.": ["ALREADY_IN_TEAM", "TEAM_FULL", "NOT_A_PARTICIPANT", "USER_NOT_FOUND", "VALIDATION_ERROR", "TEAM_NOT_FOUND", "NOT_A_MEMBER", "ALREADY_LEAD"],
  "tm.skip.": ["unknown", "taken", "twice", "full"],
  "mm.req.": ["pending", "accepted", "declined", "cancelled"],
  "mm.err.": [
    "ALREADY_IN_TEAM", "TEAM_FULL", "REQUEST_EXISTS", "TOO_MANY_REQUESTS", "TEAM_FORMATION_CLOSED", "TEAM_NOT_FOUND",
    "HACKER_NOT_APPROVED", "INVITE_EXISTS", "TARGET_NOT_APPROVED", "SENDER_NOT_APPROVED", "INVITE_NOT_FOUND",
    "INVITE_CLOSED", "NOT_TEAM_LEAD", "REQUEST_CLOSED", "TEAM_ELIMINATED",
  ],
  "hq.closed.": ["resolved", "withdrawn", "event_ended"],
  "hq.empty.": ["open", "mine", "done"],
  "hq.tab.": ["open", "mine", "done"],
  "hq.mode.": ["onsite", "online"],
  "hq.otab.": ["open", "in-progress", "flagged", "resolved", "all"],
  "hq.oempty.": ["open", "in-progress", "flagged", "resolved", "all"],
  "hq.presence_set.": ["available", "busy", "away"],
  "mt.presence_hint.": ["available", "busy", "away"],
  "hq.prio.": ["low", "normal", "high", "urgent"],
  "hq.prio_hint.": ["normal", "high", "urgent"],
  "hq.status.": ["open", "in-progress", "escalated"],
  "hq.slot_err.": ["BEFORE_START", "TOO_LONG", "IN_PAST", "INVALID"],
  "hq.err.": [
    "TICKET_LIMIT", "TICKETS_DISABLED", "NOT_PARTICIPANT", "NO_ACTIVE_EVENT", "NOT_EVENT_MENTOR", "TICKET_TAKEN", "TICKET_NOT_OPEN",
    "TICKET_NOT_IN_PROGRESS", "NOT_TICKET_OWNER", "TICKET_RESOLVED", "TICKET_NOT_RESOLVED", "TICKET_CLOSED", "SLOT_OVERLAP",
    "SLOT_INVALID", "NOT_SLOT_OWNER", "VALIDATION_ERROR",
  ],
  "vt.status.": ["todo", "doing", "done"],
  "vt.tab.": ["open", "todo", "doing", "done", "all"],
  "vt.sec.": ["doing", "todo", "done", "free"],
  "vt.sec_empty.": ["doing", "todo", "done", "free"],
  "ov.phase.": [...PHASES],
  "ov.phase_hint.": [...PHASES],
  "ov.until.": ["upcoming", "registration", "before_start", "hacking", "judging"],
  "ov.ms.": [...MILESTONES],
  "ov.ms_state.": ["done", "next", "upcoming"],
  "ov.alert.": [...ALERT_CODES],
  "ov.alert_go.": [...ALERT_CODES],
  // Types worded by their own key (the others pick a variant below).
  "ov.act.": ACTIVITY_TYPES.filter((x) => !["submitted", "help_asked", "help_resolved", "help_closed", "announced", "status_changed", "bulk_status", "team_status", "staff_joined"].includes(x)),
  "ov.act.status.": [...ACTIVITY_STATUSES],
  "ov.act.bulk.": [...ACTIVITY_STATUSES],
  "ov.act.team_status.": [...ACTIVITY_STATUSES],
  "ov.act.help_closed.": [...CLOSE_REASONS],
  "ov.act.staff_joined.": [...STAFF_ROLES],
  "pg.status.": [...PARTICIPANT_STATUSES],
  "pg.stage.": [...STAGES],
  "pg.state.": [...STAGE_STATES],
  "pg.next.": [...NEXT_CODES],
  "pg.next_b.": [...NEXT_CODES],
  "pg.when.": [...TIMED_STEPS],
  "pg.cta.": [...STEPS_WITH_BUTTON],
  "tg.err.": [
    "TG_BAD_USERNAME", "TG_CHAT_NOT_FOUND", "TG_NOT_CHANNEL", "TG_BOT_NOT_ADMIN", "TG_OWNER_NOT_LINKED",
    "TG_NOT_CHANNEL_ADMIN", "TELEGRAM_NOT_CONFIGURED", "TELEGRAM_UNAVAILABLE", "TG_SEND_FAILED", "TG_NO_CHANNEL",
  ],
};

describe("running-an-event strings", () => {
  it("are the same set of keys in AZ, EN and RU", () => {
    const keys = Object.keys(en).sort();
    expect(Object.keys(az).sort()).toEqual(keys);
    expect(Object.keys(ru).sort()).toEqual(keys);
  });

  it("are never empty and keep their {placeholders}", () => {
    const ph = (s: string) => (s.match(/\{[a-z]+\}/g) || []).sort().join(",");
    for (const k of Object.keys(en)) {
      for (const dict of [az, ru]) {
        expect(dict[k]?.trim().length, k).toBeGreaterThan(0);
        expect(ph(dict[k]), k).toBe(ph(en[k]));
      }
    }
  });

  it("cover every key the pages use", () => {
    const used = new Set<string>();
    const re = new RegExp(`\\bt\\(\\s*["\`](${PREFIXES}\\.[^"\`$]+)["\`]`, "g");
    // Keys passed around as plain strings (a toast's words handed to a helper) count too.
    const literal = new RegExp(`["'](${PREFIXES}\\.[A-Za-z0-9_.-]*[A-Za-z0-9_])["']`, "g");
    for (const file of SOURCES) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(re)) used.add(m[1]);
      for (const m of src.matchAll(literal)) used.add(m[1]);
    }
    for (const [prefix, names] of Object.entries(DYNAMIC)) for (const n of names) used.add(prefix + n);
    const missing = [...used].filter((k) => !(k in en)).sort();
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(250);
  });
});
