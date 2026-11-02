"use client";

/**
 * The post-event report for the organiser (and their sponsors): a few of its
 * figures as a preview, the language to write it in, and the PDF. A plan
 * feature (Professional and up): without it the card says so; before the
 * event is over it says when it will be ready.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Download, ExternalLink, FileBarChart2, Lock, RefreshCw } from "lucide-react";
import { Button, Card, CardHeader, Skeleton, buttonLook } from "@/components/ds/primitives";
import { Notice, Select } from "@/components/builder/ui";
import { useTranslation } from "@/contexts/LanguageContext";
import { apiGet, isDemoApiEnabled } from "@/lib/api";
import { useEventModules } from "@/lib/eventModules";
import { fill } from "@/lib/i18n/fill";
import { formatDate } from "@/lib/i18n/dates";
import {
  REPORT_LANGS, normalizeReportSummary, npsText, reportPdfPath, reportStateOf, type ReportLang, type ReportSummary,
} from "@/lib/report";

type State = { kind: "loading" } | { kind: "ready"; data: ReportSummary } | { kind: "locked" } | { kind: "not_over" } | { kind: "failed" };

export function ReportCard({ eventId, endsAt, timezone }: { eventId: number; endsAt?: string | null; timezone?: string }) {
  const { t, lang } = useTranslation();
  const modules = useEventModules(eventId);
  const locked = modules != null && !modules.has("reports");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [reportLang, setReportLang] = useState<ReportLang | null>(null);

  const load = useCallback(async () => {
    try {
      const data = normalizeReportSummary(await apiGet<unknown>(`/api/events/${eventId}/report`));
      setState({ kind: "ready", data });
      setReportLang((l) => l ?? data.language);
    } catch (err) {
      setState({ kind: reportStateOf(err) });
    }
  }, [eventId]);

  useEffect(() => {
    if (locked || isDemoApiEnabled()) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the card's first read
    void load();
  }, [load, locked]);

  // The walkthrough has no report to download.
  if (isDemoApiEnabled()) return null;

  const header = (
    <CardHeader
      title={<span className="inline-flex items-center gap-2"><FileBarChart2 size={15} aria-hidden="true" />{t("rp.title")}</span>}
      hint={t("rp.hint")}
    />
  );

  if (locked || state.kind === "locked") {
    return (
      <Card>
        {header}
        <Notice tone="info" icon={<Lock size={15} />}>{t("rp.locked")}</Notice>
        <div className="mt-4"><Link href="/pricing" {...buttonLook("secondary", "sm")}>{t("rp.locked_cta")}</Link></div>
      </Card>
    );
  }

  if (state.kind === "not_over") {
    const when = endsAt ? formatDate(endsAt, lang, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(timezone ? { timeZone: timezone } : {}) }) : "";
    return (
      <Card>
        {header}
        <Notice tone="info">{when ? fill(t("rp.not_over"), { date: when }) : t("rp.not_over_plain")}</Notice>
      </Card>
    );
  }

  if (state.kind === "failed") {
    return (
      <Card>
        {header}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13.5px]" style={{ color: "var(--ink-2)" }}>{t("rp.failed")}</p>
          <Button size="sm" icon={<RefreshCw size={13} />} onClick={() => { setState({ kind: "loading" }); void load(); }}>{t("rp.retry")}</Button>
        </div>
      </Card>
    );
  }

  const data = state.kind === "ready" ? state.data : null;
  const chosen = reportLang ?? data?.language ?? "az";
  const figures = data ? [
    [t("rp.stat.registrations"), String(data.registrations)],
    [t("rp.stat.checked_in"), data.checkedIn == null ? "—" : String(data.checkedIn)],
    [t("rp.stat.projects"), String(data.projects)],
    [t("rp.stat.nps"), npsText(data.nps)],
  ] : null;

  return (
    <Card>
      {header}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(figures ?? [0, 1, 2, 3].map(() => null)).map((f, i) => (
          <div key={i} className="rounded-[var(--radius-sm)] border px-3 py-2.5" style={{ borderColor: "var(--line)", background: "var(--surface-sunken)" }}>
            {f ? (
              <>
                <p className="text-[20px] font-semibold leading-none tabular-nums" style={{ color: "var(--ink)" }}>{f[1]}</p>
                <p className="mt-1.5 truncate text-[12px]" style={{ color: "var(--ink-3)" }}>{f[0]}</p>
              </>
            ) : <><Skeleton className="h-5 w-10" /><Skeleton className="mt-2 h-3 w-16" /></>}
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Select
            label={t("rp.language")}
            value={chosen}
            onChange={(v) => setReportLang(v as ReportLang)}
            options={REPORT_LANGS.map((l) => ({ value: l, label: t(`rp.lang.${l}`) }))}
          />
        </div>
        {data ? (
          <div className="flex flex-wrap gap-2">
            <a href={reportPdfPath(eventId, chosen)} download {...buttonLook("primary", "md")}>
              <Download size={15} aria-hidden="true" /> {t("rp.download")}
            </a>
            <a href={reportPdfPath(eventId, chosen, true)} target="_blank" rel="noopener noreferrer" {...buttonLook("ghost", "md")}>
              <ExternalLink size={14} aria-hidden="true" /> {t("rp.preview")}
            </a>
          </div>
        ) : <Skeleton className="h-10 w-40" />}
      </div>
      {data ? (
        <p className="mt-3 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
          {t(data.branded ? "rp.branded" : "rp.unbranded")} {t("rp.privacy")}
        </p>
      ) : null}
    </Card>
  );
}
