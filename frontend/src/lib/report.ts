/**
 * The post-event report (plan module "reports", Professional and above):
 *
 *   GET /api/events/:eventId/report          the figures, as data  ?lang=az|en|ru
 *   GET /api/events/:eventId/report/pdf      the PDF               ?lang=…&inline=1
 *
 * 409 EVENT_NOT_OVER until the event has ended (or its results are out);
 * 403 MODULE_DISABLED when the plan does not include it.
 */

import { ApiError } from "@/lib/api";

export const REPORT_LANGS = ["az", "en", "ru"] as const;
export type ReportLang = (typeof REPORT_LANGS)[number];

export interface ReportSummary {
  language: ReportLang;
  registrations: number;
  approved: number;
  checkedIn: number | null;
  teams: number;
  projects: number;
  nps: number | null;
  branded: boolean;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const reportLangOf = (v: unknown): ReportLang => (REPORT_LANGS.includes(v as ReportLang) ? (v as ReportLang) : "az");

export function normalizeReportSummary(raw: unknown): ReportSummary {
  const d = obj(raw);
  const f = obj(d.funnel);
  const nps = obj(obj(d.feedback).nps);
  return {
    language: reportLangOf(d.language),
    registrations: n(f.registrations),
    approved: n(f.approved),
    checkedIn: f.checkedIn == null ? null : n(f.checkedIn),
    teams: n(f.teams),
    projects: n(f.projects),
    nps: nps.score == null ? null : n(nps.score),
    branded: obj(d.branding).branded === true,
  };
}

export function reportPdfPath(eventId: number, lang: ReportLang, inline = false): string {
  return `/api/events/${eventId}/report/pdf?lang=${lang}${inline ? "&inline=1" : ""}`;
}

/** What the card shows when the API refused: the plan lacks it, or the event is not over. */
export function reportStateOf(err: unknown): "locked" | "not_over" | "failed" {
  if (err instanceof ApiError && err.code === "MODULE_DISABLED") return "locked";
  if (err instanceof ApiError && err.code === "EVENT_NOT_OVER") return "not_over";
  return "failed";
}

/** "+27", "0", "−12", or "—" without answers. */
export const npsText = (v: number | null) => (v == null ? "—" : v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : "0");
