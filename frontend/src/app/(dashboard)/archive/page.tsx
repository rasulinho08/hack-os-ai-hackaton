"use client";

/**
 * The archive: when the event is over.
 *
 * A published event is archived 14 days after it ends and can then only be
 * read — participants, teams, projects, scores and settings stay exactly as
 * they were. The organiser can archive it sooner, or bring it back to change
 * something. Whatever its state, everything in it can be taken home as one
 * ZIP file (spreadsheets of every list, the settings, the uploaded files),
 * and once it is over its post-event report as a PDF for the sponsors.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive, ArchiveRestore, CalendarClock, CheckCircle2, Download, FileArchive, Lock, RefreshCw,
} from "lucide-react";
import { Badge, Button, buttonLook, Card, CardHeader, Skeleton } from "@/components/ds/primitives";
import { Notice } from "@/components/builder/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoadFailure } from "@/components/LoadFailure";
import { ReportCard } from "@/components/wrapup/ReportCard";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { eventPhaseOf, normalizeEventFromApi, phaseLabelKey } from "@/lib/eventPhase";
import { isLivePhase, phaseTone } from "@/lib/eventOverview";
import { ApiError, DemoReadOnlyError, apiGet, apiPost, isDemoApiEnabled } from "@/lib/api";
import {
  ARCHIVE_AFTER_DAYS, EXPORT_FILES, EXPORT_FILES_MB, EXPORT_FILE_NAMES, archiveStateOf, exportPath, isArchivedEvent,
  type ArchiveState,
} from "@/lib/archive";
import { formatDate, formatRelative } from "@/lib/i18n/dates";
import { fill } from "@/lib/i18n/fill";

interface EventRow {
  id: number;
  name: string;
  timezone: string;
  startDate: string | null;
  endDate: string | null;
  archivedAt: string | null;
  raw: Record<string, unknown>;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

function rowOf(raw: unknown): EventRow | null {
  const e = obj(raw);
  const id = Number(e.id);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    name: String(e.name ?? ""),
    timezone: String(e.timezone || "Asia/Baku"),
    startDate: e.start_date ? String(e.start_date) : null,
    endDate: e.end_date ? String(e.end_date) : null,
    archivedAt: e.archived_at ? String(e.archived_at) : null,
    raw: e,
  };
}

interface Loaded { eventId: number; event: EventRow | null; others: EventRow[]; failed: boolean }

async function fetchArchive(eventId: number): Promise<Loaded> {
  const [ev, all] = await Promise.all([
    apiGet<unknown>(`/api/events/${eventId}`),
    apiGet<unknown[]>("/api/events").catch(() => []),
  ]);
  const others = (Array.isArray(all) ? all : [])
    .filter((e) => isArchivedEvent(e) && Number(obj(e).id) !== eventId)
    .map(rowOf)
    .filter((x): x is EventRow => x != null)
    .sort((a, b) => String(b.archivedAt ?? b.endDate ?? "").localeCompare(String(a.archivedAt ?? a.endDate ?? "")));
  // The list carries the phase (the API's rule); the single read may not.
  const listed = (Array.isArray(all) ? all : []).find((e) => Number(obj(e).id) === eventId);
  const event = rowOf(listed && obj(ev).phase == null ? { ...obj(ev), phase: obj(listed).phase } : ev);
  return { eventId, event, others, failed: false };
}

/** A click on a download in the walkthrough explains instead of failing. */
function demoGuard(e: React.MouseEvent) {
  if (!isDemoApiEnabled()) return;
  e.preventDefault();
  window.dispatchEvent(new CustomEvent("hackos:demo-write"));
}

export default function ArchivePage() {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const { activeEventId, loading: eventLoading, refetch, setActiveEventId } = useActiveEvent();
  const [data, setData] = useState<Loaded | null>(null);
  const [confirm, setConfirm] = useState<"archive" | "restore" | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (activeEventId == null) return;
    let cancelled = false;
    fetchArchive(activeEventId).then(
      (d) => { if (!cancelled) setData(d); },
      () => { if (!cancelled) setData({ eventId: activeEventId, event: null, others: [], failed: true }); },
    );
    return () => { cancelled = true; };
  }, [activeEventId]);

  const reload = useCallback(async () => {
    if (activeEventId == null) return;
    setRefreshing(true);
    try {
      setData(await fetchArchive(activeEventId));
    } catch {
      toast(t("ar.refresh_failed"), "error");
    } finally {
      setRefreshing(false);
    }
  }, [activeEventId, toast, t]);

  const current = data && data.eventId === activeEventId ? data : null;
  const loading = eventLoading || (activeEventId != null && !current);
  const event = current?.event ?? null;
  const state: ArchiveState | null = useMemo(() => (event ? archiveStateOf(event.raw) : null), [event]);

  const act = async (what: "archive" | "unarchive") => {
    if (activeEventId == null) return;
    setBusy(true);
    try {
      await apiPost(`/api/events/${activeEventId}/${what}`, {});
      toast(t(what === "archive" ? "ar.archived_done" : "ar.restored_done"), "success");
      await Promise.all([reload(), refetch()]);
    } catch (err) {
      if (!(err instanceof DemoReadOnlyError)) {
        toast(err instanceof ApiError && err.status === 404 ? t("ar.err.NOT_FOUND") : t("ar.err.generic"), "error");
      }
    } finally {
      setBusy(false);
    }
  };

  if (activeEventId == null && !eventLoading) {
    return <p className="py-10 text-center text-[15px]" style={{ color: "var(--ink-3)" }}>{t("ar.no_event")}</p>;
  }

  const inZone = (iso: string | null, tz: string) => (iso ? formatDate(iso, lang, { day: "numeric", month: "long", year: "numeric", timeZone: tz }) : "");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("ar.title")}</h1>
          <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>{t("ar.subtitle")}</p>
        </div>
        <Button size="sm" variant="ghost" icon={<RefreshCw size={14} className={refreshing ? "animate-spin" : undefined} />} onClick={() => void reload()} disabled={refreshing || loading}>
          {t("ar.refresh")}
        </Button>
      </div>

      {current?.failed ? (
        <LoadFailure message={t("ar.load_failed")} onRetry={() => void reload()} retrying={refreshing} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <StateCard loading={loading} event={event} state={state} busy={busy} inZone={inZone}
            onArchive={() => setConfirm("archive")} onRestore={() => setConfirm("restore")} />
          <ExportCard loading={loading} eventId={activeEventId} />
          {activeEventId != null && event ? (
            <div className="lg:col-span-2">
              <ReportCard eventId={activeEventId} endsAt={event.endDate} timezone={event.timezone} />
            </div>
          ) : null}
        </div>
      )}

      {current && !current.failed && current.others.length > 0 ? (
        <section aria-labelledby="ar-others-h" className="space-y-3">
          <h2 id="ar-others-h" className="text-[18px] font-semibold" style={{ color: "var(--ink)" }}>{t("ar.others_title")}</h2>
          <ul className="divide-y overflow-hidden rounded-[var(--radius)] border" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
            {current.others.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderColor: "var(--line)" }}>
                <div className="min-w-0">
                  <p className="truncate text-[14.5px] font-medium" style={{ color: "var(--ink)" }}>{e.name}</p>
                  <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
                    {[inZone(e.endDate, e.timezone) ? fill(t("ar.ended_on"), { date: inZone(e.endDate, e.timezone) }) : null,
                      e.archivedAt ? fill(t("ar.archived_on"), { date: inZone(e.archivedAt, e.timezone) }) : null].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a href={exportPath(e.id)} onClick={demoGuard} {...buttonLook("secondary", "sm")}>
                    <Download size={13} aria-hidden="true" /> {t("ar.download_short")}
                  </a>
                  <Button size="sm" variant="ghost" onClick={() => setActiveEventId(e.id)}>{t("ar.open_event")}</Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ConfirmDialog
        open={confirm === "archive"}
        title={t("ar.archive_t")}
        message={t("ar.archive_b")}
        confirmLabel={t("ar.archive_now")}
        cancelLabel={t("ar.keep")}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); void act("archive"); }}
      />
      <ConfirmDialog
        open={confirm === "restore"}
        title={t("ar.restore_t")}
        message={fill(t("ar.restore_b"), { days: ARCHIVE_AFTER_DAYS })}
        confirmLabel={t("ar.restore")}
        cancelLabel={t("ar.keep")}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); void act("unarchive"); }}
      />
    </div>
  );
}

/* ── Where the event stands ──────────────────────────────────────────────── */

/** The event's phase, in the words the header and the home use. */
function PhaseBadge({ raw, archived }: { raw: Record<string, unknown>; archived: boolean }) {
  const { t } = useTranslation();
  const phase = archived ? "archived" : eventPhaseOf(normalizeEventFromApi(raw)) ?? "ended";
  return <Badge tone={phaseTone(phase)} dot={isLivePhase(phase)}>{t(phaseLabelKey(phase))}</Badge>;
}

function StateCard({
  loading, event, state, busy, inZone, onArchive, onRestore,
}: {
  loading: boolean;
  event: EventRow | null;
  state: ArchiveState | null;
  busy: boolean;
  inZone: (iso: string | null, tz: string) => string;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const { t, lang } = useTranslation();
  if (loading || !event || !state) {
    return (
      <Card>
        <Skeleton className="h-5 w-48" />
        <Skeleton className="mt-4 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-2/3" />
        <Skeleton className="mt-5 h-10 w-40" />
      </Card>
    );
  }
  const tz = event.timezone;
  const archived = state.stage === "archived";
  return (
    <Card>
      <CardHeader
        title={event.name}
        hint={event.endDate ? fill(t("ar.ends_on"), { date: inZone(event.endDate, tz) }) : t("ar.no_end_date")}
        action={<PhaseBadge raw={event.raw} archived={archived} />}
      />
      {archived ? (
        <div className="space-y-4">
          <Notice tone="info" icon={<Lock size={15} />}>
            <p className="font-medium">{state.archivedAt ? fill(t("ar.is_archived_since"), { date: inZone(state.archivedAt, tz) }) : t("ar.is_archived")}</p>
            <p className="mt-1">{t("ar.read_only")}</p>
          </Notice>
          <Button variant="secondary" icon={<ArchiveRestore size={15} />} onClick={onRestore} loading={busy} disabled={busy}>{t("ar.restore")}</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-[var(--radius-sm)] border px-3.5 py-3" style={{ borderColor: "var(--line)", background: "var(--surface-sunken)" }}>
            <CalendarClock size={18} className="mt-0.5 shrink-0" aria-hidden="true" style={{ color: state.stage === "due" ? "var(--warn)" : "var(--ink-3)" }} />
            <div className="min-w-0 text-[13.5px]" style={{ color: "var(--ink-2)" }}>
              <p className="font-medium" style={{ color: "var(--ink)" }}>
                {state.stage === "draft" ? t("ar.stage.draft")
                  : state.stage === "no_end" ? t("ar.stage.no_end")
                    : state.stage === "due" ? t("ar.stage.due")
                      : fill(t(`ar.stage.${state.stage}`), { date: inZone(state.autoAt, tz), when: state.autoAt ? formatRelative(state.autoAt, lang) : "" })}
              </p>
              <p className="mt-1">{fill(t("ar.auto_rule"), { days: ARCHIVE_AFTER_DAYS })}</p>
            </div>
          </div>
          <ul className="space-y-1.5 text-[13px]" style={{ color: "var(--ink-2)" }}>
            {(["ar.after.read_only", "ar.after.reads", "ar.after.restore"] as const).map((k) => (
              <li key={k} className="flex items-start gap-2">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden="true" style={{ color: "var(--ok)" }} />
                {t(k)}
              </li>
            ))}
          </ul>
          <Button variant="secondary" icon={<Archive size={15} />} onClick={onArchive} loading={busy} disabled={busy}>{t("ar.archive_now")}</Button>
        </div>
      )}
    </Card>
  );
}

/* ── Taking it home ──────────────────────────────────────────────────────── */

function ExportCard({ loading, eventId }: { loading: boolean; eventId: number | null }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader title={t("ar.export_title")} hint={t("ar.export_hint")} />
      <ul className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2" aria-label={t("ar.export_contents")}>
        {EXPORT_FILES.map((f) => (
          <li key={f} className="min-w-0 text-[13px]">
            <span className="block font-mono text-[12px]" style={{ color: "var(--ink)" }}>{EXPORT_FILE_NAMES[f]}</span>
            <span className="block" style={{ color: "var(--ink-3)" }}>{t(`ar.file.${f}`)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[12.5px]" style={{ color: "var(--ink-3)" }}>{fill(t("ar.export_note"), { mb: EXPORT_FILES_MB })}</p>
      <div className="mt-4">
        {eventId != null && !loading ? (
          <a href={exportPath(eventId)} onClick={demoGuard} {...buttonLook("primary", "md")}>
            <FileArchive size={15} aria-hidden="true" /> {t("ar.download")}
          </a>
        ) : (
          <Skeleton className="h-10 w-48" />
        )}
      </div>
    </Card>
  );
}
