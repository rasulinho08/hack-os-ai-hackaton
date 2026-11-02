"use client";

/**
 * Check-in at the door (plan module 'checkin'): who has arrived.
 *
 * The counts and the list refresh every 15 seconds while the page is open,
 * so the organisers' desk sees what the volunteers at the door scan. The
 * list is everyone accepted — searchable by name, e-mail, team or ticket
 * code, the latest arrivals first. Someone without their phone is checked in
 * by hand from here, and a check-in made by mistake is undone (the audit log
 * keeps both). The CSV has the whole list with codes and times. An archived
 * event's list can be read, not changed.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CheckCircle2, Download, LogIn, RefreshCw, ScanLine, Search, Undo2, Users } from "lucide-react";
import { Badge, Button, Card, EmptyState, Progress, Skeleton, Stat, Tabs, buttonLook } from "@/components/ds/primitives";
import { Notice, inputStyle } from "@/components/builder/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoadFailure } from "@/components/LoadFailure";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { ApiError, DemoReadOnlyError, isDemoApiEnabled } from "@/lib/api";
import { formatInZone } from "@/lib/builder/datetime";
import { FILTERS, checkinApi, checkinErrorKey, formatCode, type CheckinList, type CheckinPerson, type Filter } from "@/lib/checkin";
import { fill } from "@/lib/i18n/fill";
import { useEventZone } from "@/lib/useEventZone";

const PAGE = 50;
const POLL_MS = 15_000;

type T = (key: string) => string;

interface Loaded {
  eventId: number;
  list: CheckinList | null;
  /** The i18n key of why it did not load (null: it did). */
  error: string | null;
}

/** The walkthrough has no file to download. */
const demoRefusal = (e: { preventDefault: () => void }) => {
  if (!isDemoApiEnabled()) return;
  e.preventDefault();
  window.dispatchEvent(new CustomEvent("hackos:demo-write"));
};

const nameOf = (p: CheckinPerson) => p.name || p.email || `#${p.participantId}`;

export default function CheckinPage() {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const pathname = usePathname();
  const { activeEventId, primaryEvent, loading: eventLoading } = useActiveEvent();
  const { timeZone } = useEventZone(activeEventId);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Loaded | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [toUndo, setToUndo] = useState<CheckinPerson | null>(null);
  const [archivedEvent, setArchivedEvent] = useState<number | null>(null);
  const seq = useRef(0);
  const hasList = useRef(false);

  // Typing settles for a moment before the list is asked again.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  /** "show": a first load or a new search (a failure replaces the list); "quiet": a refresh (a failure keeps it). */
  const load = useCallback(async (mode: "show" | "quiet") => {
    if (activeEventId == null) return;
    const eventId = activeEventId;
    const id = ++seq.current;
    try {
      const list = await checkinApi.list(eventId, { q: query, filter, limit: PAGE, offset });
      if (id !== seq.current) return;
      hasList.current = true;
      setData({ eventId, list, error: null });
    } catch (err) {
      if (id !== seq.current || err instanceof DemoReadOnlyError) return;
      if (mode === "quiet" && hasList.current) return;
      hasList.current = false;
      const moduleOff = err instanceof ApiError && err.code === "MODULE_DISABLED";
      setData({ eventId, list: null, error: moduleOff ? "ci.err.MODULE_DISABLED" : "ci.load_failed" });
    }
  }, [activeEventId, query, filter, offset]);

  useEffect(() => {
    void load("show");
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load("quiet");
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const reload = async () => {
    setRefreshing(true);
    try {
      await load("show");
    } finally {
      setRefreshing(false);
    }
  };

  const current = data && data.eventId === activeEventId ? data : null;
  const list = current?.list ?? null;
  const loading = eventLoading || (activeEventId != null && !current);
  const status = String(primaryEvent?.derived_status || primaryEvent?.status || "").toLowerCase();
  const archived = status === "archived" || (archivedEvent != null && archivedEvent === activeEventId);
  const canEdit = !archived;
  const stats = list?.stats ?? null;
  const when = (iso: string | null) => formatInZone(iso, timeZone, lang, { year: undefined });

  /** A write refused in the walkthrough is announced by the walkthrough itself. */
  const fail = (err: unknown) => {
    if (err instanceof DemoReadOnlyError) return;
    if (err instanceof ApiError && err.code === "EVENT_ARCHIVED" && activeEventId != null) setArchivedEvent(activeEventId);
    toast(t(checkinErrorKey(err)), "error");
  };

  const checkIn = async (p: CheckinPerson) => {
    if (activeEventId == null || busyId != null) return;
    setBusyId(p.participantId);
    try {
      const res = await checkinApi.checkIn(activeEventId, p.participantId);
      toast(fill(t(res?.result === "already" ? "ci.done_already" : "ci.done_in"), { name: nameOf(p) }), "success");
      await load("quiet");
    } catch (err) {
      fail(err);
    } finally {
      setBusyId(null);
    }
  };

  const undo = async () => {
    const p = toUndo;
    setToUndo(null);
    if (!p || activeEventId == null) return;
    setBusyId(p.participantId);
    try {
      await checkinApi.undo(activeEventId, p.participantId);
      toast(fill(t("ci.done_undo"), { name: nameOf(p) }), "success");
      await load("quiet");
    } catch (err) {
      fail(err);
    } finally {
      setBusyId(null);
    }
  };

  if (activeEventId == null && !eventLoading) {
    return <p className="py-10 text-center text-[15px]" style={{ color: "var(--ink-3)" }}>{t("ci.no_event")}</p>;
  }

  const scanHref = `${pathname.replace(/\/$/, "")}/scan`;
  const primary = buttonLook("primary", "sm");
  const secondary = buttonLook("secondary", "sm");
  const pct = stats && stats.admitted > 0 ? Math.round((stats.checkedIn / stats.admitted) * 100) : 0;
  const counts: Record<Filter, number | undefined> = { all: stats?.admitted, in: stats?.checkedIn, out: stats?.remaining };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("ci.title")}</h1>
          <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>{t("ci.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} className={refreshing ? "animate-spin" : undefined} />} onClick={() => void reload()} disabled={refreshing || loading}>
            {t("ci.refresh")}
          </Button>
          <a
            href={activeEventId != null ? checkinApi.csvPath(activeEventId) : undefined}
            download
            onClick={demoRefusal}
            className={secondary.className}
            style={secondary.style}
          >
            <Download size={14} aria-hidden="true" /> {t("ci.csv")}
          </a>
          {/* A page load, not a move inside the app: the scanner's own headers allow the camera. */}
          <a href={scanHref} className={`${primary.className} order-first sm:order-none`} style={primary.style}>
            <ScanLine size={14} aria-hidden="true" /> {t("ci.open_scanner")}
          </a>
        </div>
      </div>

      {archived ? <Notice tone="warn">{t("ci.archived_note")}</Notice> : null}

      {current?.error === "ci.err.MODULE_DISABLED" ? (
        <Notice tone="warn">{t("ci.err.MODULE_DISABLED")}</Notice>
      ) : current?.error ? (
        <LoadFailure message={t(current.error)} onRetry={() => void reload()} retrying={refreshing} />
      ) : (
        <>
          {/* On a phone the progress line below says it in one line ("4 of 12 checked in"), so the search is near the top. */}
          <div className="hidden gap-4 sm:grid sm:grid-cols-3">
            <Stat label={t("ci.stat.admitted")} value={stats ? stats.admitted : <Skeleton className="h-7 w-14" />} icon={<Users size={16} />} />
            <Stat label={t("ci.stat.checked_in")} value={stats ? stats.checkedIn : <Skeleton className="h-7 w-14" />} icon={<CheckCircle2 size={16} />} />
            <Stat label={t("ci.stat.remaining")} value={stats ? stats.remaining : <Skeleton className="h-7 w-14" />} icon={<LogIn size={16} />} />
          </div>
          <div>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
              <span className="font-medium tabular-nums" style={{ color: "var(--ink)" }} data-checkin-progress="">
                {stats ? fill(t("ci.progress"), { in: stats.checkedIn, total: stats.admitted }) : " "}
              </span>
              <span style={{ color: "var(--ink-3)" }}>{t("ci.live")}</span>
            </div>
            <Progress value={pct} tone="ok" />
          </div>

          <Card padded={false}>
            <div className="px-4 pt-4 sm:px-5">
              <label className="relative block">
                <span className="sr-only">{t("ci.search")}</span>
                <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--ink-3)" }} />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("ci.search")}
                  maxLength={100}
                  className="min-h-10 w-full rounded-[var(--radius-sm)] border py-2 pl-9 pr-3 text-[14px] outline-none focus:ring-2"
                  style={inputStyle()}
                />
              </label>
            </div>
            <Tabs
              tabs={FILTERS.map((f) => ({ id: f, label: t(`ci.filter.${f}`), count: counts[f] }))}
              value={filter}
              onChange={(f) => {
                setFilter(f);
                setOffset(0);
              }}
              className="mt-3 px-2 sm:px-3"
            />

            {loading || !list ? (
              <div className="space-y-3 p-5">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : list.stats.admitted === 0 ? (
              <EmptyState icon={<Users size={19} />} title={t("ci.empty_title")} body={t("ci.empty_body")} />
            ) : list.items.length === 0 ? (
              <p className="px-5 py-10 text-center text-[14px]" style={{ color: "var(--ink-3)" }}>{t("ci.no_match")}</p>
            ) : (
              <ul aria-label={t("ci.title")}>
                {list.items.map((p) => (
                  <PersonRow
                    key={p.participantId}
                    person={p}
                    canEdit={canEdit}
                    busy={busyId === p.participantId}
                    when={when}
                    onCheckIn={() => void checkIn(p)}
                    onUndo={() => setToUndo(p)}
                    t={t}
                  />
                ))}
              </ul>
            )}

            {list && list.total > list.limit ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:px-5" style={{ borderColor: "var(--line)" }}>
                <span className="text-[13px] tabular-nums" style={{ color: "var(--ink-3)" }}>
                  {fill(t("ci.page"), { from: list.offset + 1, to: Math.min(list.offset + list.items.length, list.total), total: list.total })}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setOffset(Math.max(0, offset - PAGE))} disabled={offset === 0}>{t("ci.prev")}</Button>
                  <Button size="sm" onClick={() => setOffset(offset + PAGE)} disabled={list.offset + list.items.length >= list.total}>{t("ci.next")}</Button>
                </div>
              </div>
            ) : null}
          </Card>
        </>
      )}

      <ConfirmDialog
        open={toUndo != null}
        title={t("ci.undo_title")}
        message={toUndo ? fill(t("ci.undo_body"), { name: nameOf(toUndo) }) : ""}
        confirmLabel={t("ci.undo")}
        cancelLabel={t("ci.cancel")}
        variant="danger"
        onConfirm={() => void undo()}
        onCancel={() => setToUndo(null)}
      />
    </div>
  );
}

/* ── One person ────────────────────────────────────────────────────────── */

function PersonRow({
  person: p, canEdit, busy, when, onCheckIn, onUndo, t,
}: {
  person: CheckinPerson;
  canEdit: boolean;
  busy: boolean;
  when: (iso: string | null) => string;
  onCheckIn: () => void;
  onUndo: () => void;
  t: T;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-3 first:border-t-0 sm:px-5" style={{ borderColor: "var(--line)" }} data-participant={p.participantId}>
      <div className="min-w-0 flex-[1_1_14rem]">
        <p className="truncate text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{nameOf(p)}</p>
        {p.email && p.email !== nameOf(p) ? <p className="truncate text-[12px]" style={{ color: "var(--ink-3)" }}>{p.email}</p> : null}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]" style={{ color: "var(--ink-2)" }}>
          <span>{p.team || t("ci.no_team")}</span>
          {p.code ? <span className="font-mono tracking-[0.08em]" title={t("ci.ticket.code")}>{formatCode(p.code)}</span> : null}
          {p.status === "eliminated" ? <Badge tone="warn">{t("ci.status.eliminated")}</Badge> : null}
        </p>
      </div>
      <div className="flex min-w-0 flex-[1_1_16rem] flex-wrap items-center justify-between gap-3 sm:justify-end">
        {p.checkedIn ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px]" style={{ color: "var(--ink-2)" }}>
            <CheckCircle2 size={15} aria-hidden="true" className="shrink-0" style={{ color: "var(--ok)" }} />
            <span className="min-w-0">
              {fill(t("ci.at_by"), { time: when(p.checkedInAt), by: p.checkedInBy?.name || t("ci.scan.someone") })}
              {p.method ? <span style={{ color: "var(--ink-3)" }}> · {t(`ci.method.${p.method}`)}</span> : null}
            </span>
          </span>
        ) : (
          <span className="text-[13px]" style={{ color: "var(--ink-3)" }}>{t("ci.not_yet")}</span>
        )}
        {canEdit ? (
          p.checkedIn ? (
            <Button size="sm" variant="ghost" icon={<Undo2 size={14} />} onClick={onUndo} disabled={busy} loading={busy}>
              {t("ci.undo")}
            </Button>
          ) : (
            <Button size="sm" variant="primary" icon={<LogIn size={14} />} onClick={onCheckIn} disabled={busy} loading={busy}>
              {t("ci.check_in")}
            </Button>
          )
        ) : null}
      </div>
    </li>
  );
}
