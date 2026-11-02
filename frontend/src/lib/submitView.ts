/**
 * What the submit page says, decided in one place so it never says two
 * things at once: one state for the page (can the person hand in or edit
 * now, and if not, the one reason why), the deadline line, and links as
 * people type them ("github.com/team/app") made into real links.
 */

import type { SubmissionWindowState } from "@/lib/eventPhase";

export type SubmitBanner = "no_team" | "not_started" | "closed" | "lead_only" | "team_too_small" | null;

export interface SubmitInput {
  hasTeam: boolean;
  /** Who may hand in: the lead, any accepted member (lead not accepted), or not this person. */
  submitAs: "lead" | "member" | "none";
  windowState: SubmissionWindowState;
  teamSizeOk: boolean;
  hasSubmission: boolean;
}

export interface SubmitView {
  /** The form can be filled in and sent. */
  editable: boolean;
  /** The one reason it cannot (most basic first), or null. */
  banner: SubmitBanner;
  /** The page title and subtitle keys. */
  title: string;
  subtitle: string | null;
  /** "You can hand it in, your lead is not accepted": only while that is true. */
  memberMayHandIn: boolean;
}

export function submitView(s: SubmitInput): SubmitView {
  const banner: SubmitBanner = !s.hasTeam ? "no_team"
    : s.windowState === "not_started" ? "not_started"
      : s.windowState === "closed" ? "closed"
        : s.submitAs === "none" ? "lead_only"
          : !s.teamSizeOk ? "team_too_small"
            : null;
  const editable = banner === null;
  let title: string;
  let subtitle: string | null;
  if (editable) {
    title = s.hasSubmission ? "hacker.submit.title_update" : "hacker.submit.title_new";
    subtitle = s.hasSubmission ? "hacker.submit.subtitle_update" : "hacker.submit.subtitle_new";
  } else if (s.hasSubmission) {
    title = "hacker.submit.title_view";
    subtitle = banner === "closed" ? "hacker.submit.subtitle_view_closed" : "hacker.submit.subtitle_view";
  } else {
    title = "hacker.submit.title_new";
    subtitle = null;
  }
  return { editable, banner, title, subtitle, memberMayHandIn: editable && s.submitAs === "member" };
}

/** When submissions close: the deadline, else the end of the event. */
export function submissionCloses(event: Record<string, unknown> | null | undefined): string | null {
  if (!event) return null;
  const raw = event.submission_deadline ?? event.submissionDeadline ?? event.end_date ?? event.endDate;
  if (typeof raw !== "string" || Number.isNaN(Date.parse(raw))) return null;
  return raw;
}

/** "2 d 4 h", "3 h 12 min", "8 min" — the time left, short; null once it passed. */
export function shortTimeLeft(at: string, now: number, units: { d: string; h: string; m: string }): string | null {
  const total = Math.floor((new Date(at).getTime() - now) / 60000);
  if (!Number.isFinite(total) || total < 0) return null;
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d > 0) return `${d} ${units.d}${h ? ` ${h} ${units.h}` : ""}`;
  if (h > 0) return `${h} ${units.h}${m ? ` ${m} ${units.m}` : ""}`;
  return `${Math.max(1, m)} ${units.m}`;
}

/**
 * "github.com/team/app" → "https://github.com/team/app", as the API stores
 * it. Only a bare host and path gets the prefix; anything with a scheme,
 * and anything that is not a link, is left for the checks to answer.
 */
export function normaliseLink(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith("//")) return s;
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#].*)?$/i.test(s)) return `https://${s}`;
  return s;
}
