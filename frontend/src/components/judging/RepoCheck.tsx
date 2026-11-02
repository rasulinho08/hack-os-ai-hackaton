"use client";

/**
 * The GitHub check on the submissions page: was a project's repository made,
 * or worked on, before the event started, or not touched during it
 * (GET/POST …/judging/repo-checks). A warning for the organiser, never a
 * verdict.
 */

import { AlertTriangle, CheckCircle2, CircleDashed, CircleSlash, HelpCircle } from "lucide-react";
import { Badge, type Tone } from "@/components/ds/primitives";
import { useTranslation } from "@/contexts/LanguageContext";
import { formatDate } from "@/lib/i18n/dates";
import { fill } from "@/lib/i18n/fill";

export const REPO_STATUSES = ["ok", "warn", "skipped", "error"] as const;
export type RepoStatus = (typeof REPO_STATUSES)[number];
export const REPO_FLAGS = ["CREATED_BEFORE_START", "COMMITS_BEFORE_START", "NO_COMMITS_DURING", "NOT_FOUND"] as const;
export type RepoFlag = (typeof REPO_FLAGS)[number];

export interface RepoCheck {
  status: RepoStatus;
  flags: RepoFlag[];
  createdAt: string | null;
  commitsBefore: number | null;
  commitsDuring: number | null;
  capped: number;
  checkedAt: string | null;
}

export interface RepoChecks {
  enabled: boolean;
  bySubmission: Map<number, { github: boolean; check: RepoCheck | null }>;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function normalizeRepoChecks(v: unknown): RepoChecks {
  const r = obj(v);
  const bySubmission = new Map<number, { github: boolean; check: RepoCheck | null }>();
  for (const raw of Array.isArray(r.projects) ? r.projects : []) {
    const p = obj(raw);
    const id = num(p.submissionId);
    if (id == null) continue;
    const c = p.check ? obj(p.check) : null;
    const status = c && (REPO_STATUSES as readonly string[]).includes(String(c.status)) ? (c.status as RepoStatus) : null;
    bySubmission.set(id, {
      github: p.github === true,
      check: c && status ? {
        status,
        flags: (Array.isArray(c.flags) ? c.flags : []).filter((f): f is RepoFlag => (REPO_FLAGS as readonly string[]).includes(String(f))),
        createdAt: str(c.createdAt),
        commitsBefore: num(c.commitsBefore),
        commitsDuring: num(c.commitsDuring),
        capped: num(c.commitsCapped) ?? 100,
        checkedAt: str(c.checkedAt),
      } : null,
    });
  }
  return { enabled: r.enabled === true, bySubmission };
}

/** Warnings first, then problems, then fine, then the unchecked. */
export function repoSortValue(x: { github: boolean; check: RepoCheck | null } | undefined): number {
  if (!x || !x.github) return 5;
  if (!x.check) return 4;
  return { warn: 0, error: 1, ok: 2, skipped: 3 }[x.check.status];
}

const LOOK: Record<RepoStatus | "not_checked", { tone: Tone; icon: React.ReactNode }> = {
  ok: { tone: "ok", icon: <CheckCircle2 size={12} aria-hidden="true" /> },
  warn: { tone: "warn", icon: <AlertTriangle size={12} aria-hidden="true" /> },
  error: { tone: "danger", icon: <HelpCircle size={12} aria-hidden="true" /> },
  skipped: { tone: "neutral", icon: <CircleSlash size={12} aria-hidden="true" /> },
  not_checked: { tone: "neutral", icon: <CircleDashed size={12} aria-hidden="true" /> },
};

export function RepoCheckBadge({ item }: { item: { github: boolean; check: RepoCheck | null } | undefined }) {
  const { t } = useTranslation();
  if (!item || !item.github) return <span className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>—</span>;
  const key = item.check ? item.check.status : "not_checked";
  const look = LOOK[key];
  return <Badge tone={look.tone}><span className="inline-flex items-center gap-1">{look.icon}{t(`sb.gh.${key}`)}</span></Badge>;
}

const count = (n: number | null, cap: number) => (n == null ? "—" : n >= cap ? `${cap}+` : String(n));

export function RepoCheckDetails({ item, timeZone }: { item: { github: boolean; check: RepoCheck | null } | undefined; timeZone?: string }) {
  const { t, lang } = useTranslation();
  if (!item || !item.github) return <p style={{ color: "var(--ink-3)" }}>{t("sb.gh.skipped")}</p>;
  const c = item.check;
  if (!c) return <p style={{ color: "var(--ink-3)" }}>{t("sb.gh.not_checked")}</p>;
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }) : "—");
  return (
    <div className="space-y-2">
      <RepoCheckBadge item={item} />
      {c.flags.length ? (
        <ul className="space-y-1">
          {c.flags.map((f) => (
            <li key={f} className="flex items-start gap-2" style={{ color: "var(--ink)" }}>
              <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: "var(--warn)" }} />
              {fill(t(`sb.gh.flag.${f}`), { date: when(c.createdAt), n: count(c.commitsBefore, c.capped) })}
            </li>
          ))}
        </ul>
      ) : null}
      {c.status !== "error" && c.commitsDuring != null ? (
        <p style={{ color: "var(--ink-2)" }}>{fill(t("sb.gh_during"), { n: count(c.commitsDuring, c.capped) })}</p>
      ) : null}
      {c.checkedAt ? <p className="text-[12px]" style={{ color: "var(--ink-3)" }}>{fill(t("sb.gh_checked"), { when: when(c.checkedAt) })}</p> : null}
      <p className="text-[12px]" style={{ color: "var(--ink-3)" }}>{t("sb.gh_note")}</p>
    </div>
  );
}
