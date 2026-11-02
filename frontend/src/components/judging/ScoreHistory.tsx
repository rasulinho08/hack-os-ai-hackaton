"use client";

/**
 * The judge audit for one project: every score a judge gave or changed,
 * who, when, from and to, newest first (GET …/judging/history). Opened from
 * a judge's review on the results page when they changed a score.
 */

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/ds/primitives";
import { Modal } from "@/components/ds/overlays";
import { LoadFailure } from "@/components/LoadFailure";
import { useTranslation } from "@/contexts/LanguageContext";
import { apiGet } from "@/lib/api";
import { formatDate } from "@/lib/i18n/dates";
import { fill } from "@/lib/i18n/fill";

interface Entry {
  id: number;
  at: string;
  judge: { id: number; name: string };
  criterion: { id: number; name: string; max: number };
  from: number | null;
  to: number | null;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** The API's entries, read safely; anything without an id or a time is dropped. */
export function normalizeHistory(v: unknown): Entry[] {
  const list = Array.isArray(obj(v).entries) ? (obj(v).entries as unknown[]) : [];
  return list.flatMap((raw) => {
    const e = obj(raw);
    const id = num(e.id);
    if (id == null || typeof e.at !== "string") return [];
    const judge = obj(e.judge);
    const criterion = obj(e.criterion);
    return [{
      id,
      at: e.at,
      judge: { id: num(judge.id) ?? 0, name: typeof judge.name === "string" ? judge.name : "" },
      criterion: { id: num(criterion.id) ?? 0, name: typeof criterion.name === "string" ? criterion.name : "", max: num(criterion.max) ?? 10 },
      from: num(e.from),
      to: num(e.to),
    }];
  });
}

function HistoryList({ eventId, submissionId, judgeId }: { eventId: number; submissionId: number; judgeId: number }) {
  const { t, lang } = useTranslation();
  const [rows, setRows] = useState<Entry[] | "failed" | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiGet<unknown>(`/api/events/${eventId}/judging/history?submissionId=${submissionId}&judgeId=${judgeId}`)
      .then((v) => { if (!cancelled) setRows(normalizeHistory(v)); })
      .catch(() => { if (!cancelled) setRows("failed"); });
    return () => { cancelled = true; };
  }, [eventId, submissionId, judgeId, attempt]);

  if (rows === "failed") return <LoadFailure compact message={t("rs.hist_failed")} onRetry={() => setAttempt((n) => n + 1)} />;
  if (rows === null) return <p role="status" className="text-[13px]" style={{ color: "var(--ink-3)" }}>{t("Loading")}</p>;
  if (!rows.length) return <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>{t("rs.hist_empty")}</p>;
  return (
    <ol className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
      {rows.map((e) => (
        <li key={e.id} className="rounded-[10px] border px-3 py-2 text-[13px]" style={{ borderColor: "var(--line)" }}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium" style={{ color: "var(--ink)" }}>{e.criterion.name}</span>
            <time dateTime={e.at} className="text-[12px] tabular-nums" style={{ color: "var(--ink-3)" }}>
              {formatDate(e.at, lang, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}
            </time>
          </div>
          <p className="mt-0.5 tabular-nums" style={{ color: "var(--ink-2)" }}>
            {e.from == null
              ? fill(t("rs.hist_first"), { to: e.to ?? "—", max: e.criterion.max })
              : fill(t("rs.hist_changed"), { from: e.from, to: e.to ?? "—", max: e.criterion.max })}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** A "changed n×" button on a judge's review that opens their history for the project. */
export function ScoreHistoryButton({ eventId, submissionId, judgeId, judgeName, times }: {
  eventId: number; submissionId: number; judgeId: number; judgeName: string; times: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" icon={<History size={13} />} onClick={() => setOpen(true)}
        aria-label={fill(t("rs.hist_open"), { judge: judgeName })}>
        {fill(t("rs.hist_times"), { n: times })}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={fill(t("rs.hist_title"), { judge: judgeName })} description={t("rs.hist_hint")}>
        {open ? <HistoryList eventId={eventId} submissionId={submissionId} judgeId={judgeId} /> : null}
      </Modal>
    </>
  );
}
