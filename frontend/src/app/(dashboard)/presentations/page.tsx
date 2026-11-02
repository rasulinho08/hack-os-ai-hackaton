"use client";

/**
 * Presentation day: the running order (made from the projects handed in,
 * then moved by hand), each slot's time from demo day, links to the slides,
 * repository and demo — and the stage itself.
 *
 * Presenter mode fills the screen with the team on stage, a countdown for
 * the pitch and then the questions (the organiser's lengths and warning from
 * the builder), and who is up next. The clock is anchored to the wall clock
 * and kept in this browser per event, so a reload, a closed tab or a second
 * tab shows the same seconds. Space starts and pauses, ← and → move through
 * the order.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronDown, ChevronUp, Download, ExternalLink, FastForward, Link2, Maximize2, MonitorPlay, Pause, Play, Presentation,
  RefreshCw, RotateCcw, SkipBack, SkipForward, Sparkles, X,
} from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Progress, Skeleton } from "@/components/ds/primitives";
import { Portal } from "@/components/ds/overlays";
import { Notice } from "@/components/builder/ui";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { ApiError, DemoReadOnlyError, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";
import { downloadCSV, toCSV } from "@/lib/csvExport";
import { fill } from "@/lib/i18n/fill";
import { formatDate } from "@/lib/i18n/dates";
import { useEventZone } from "@/lib/useEventZone";
import {
  IDLE, clock, configFrom, loadSaved, onStage, parseSaved, reset as resetTimer, save as saveTimer, skipToQa, storageKey,
  toggle as toggleTimer, viewOf, type TimerConfig, type TimerState, type TimerView,
} from "@/lib/presenterTimer";

type Status = "waiting" | "presenting" | "done";

interface Entry {
  id: number;
  team: string;
  project: string;
  driveLink: string;
  presentationLink: string;
  repoLink: string;
  demoLink: string;
  order: number;
  status: Status;
  duration: number;
  scheduledAt: string | null;
}

interface Settings {
  slotMinutes: number;
  qaMinutes: number;
  warnSeconds: number;
  order: "submission" | "random" | "manual";
  demoDay: string | null;
}

const DEFAULT_SETTINGS: Settings = { slotMinutes: 3, qaMinutes: 2, warnSeconds: 60, order: "submission", demoDay: null };

function normalize(raw: unknown): Entry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = Number(o.id);
  if (!Number.isFinite(id)) return null;
  const s = String(o.status ?? "").toLowerCase();
  return {
    id,
    team: String(o.team ?? o.team_name ?? "").trim() || "—",
    project: String(o.project ?? o.project_name ?? "").trim() || "—",
    driveLink: String(o.driveLink ?? o.drive_link ?? o.link ?? "").trim(),
    presentationLink: String(o.presentationLink ?? o.presentation_link ?? "").trim(),
    repoLink: String(o.repoLink ?? o.repo_link ?? "").trim(),
    demoLink: String(o.demoLink ?? o.demo_link ?? "").trim(),
    order: Number(o.order ?? o.presentation_order ?? o.slot_order ?? 0),
    status: s === "presenting" || s === "done" ? s : "waiting",
    duration: Number(o.duration ?? o.duration_minutes ?? 0) || 0,
    scheduledAt: typeof o.scheduled_at === "string" ? o.scheduled_at : null,
  };
}

function readSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_SETTINGS;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return {
    slotMinutes: Math.max(1, num(o.slotMinutes, DEFAULT_SETTINGS.slotMinutes)),
    qaMinutes: num(o.qaMinutes, DEFAULT_SETTINGS.qaMinutes),
    warnSeconds: num(o.warnSeconds, DEFAULT_SETTINGS.warnSeconds),
    order: (["submission", "random", "manual"].includes(String(o.order)) ? o.order : "submission") as Settings["order"],
    demoDay: typeof o.demoDay === "string" ? o.demoDay : null,
  };
}

const href = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);
const ink = (n: "" | "-2" | "-3" = "") => ({ color: `var(--ink${n})` });

/** Where the presenter keys must not act: typing in a field. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export default function PresentationsPage() {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const { activeEventId, events, loading: eventLoading } = useActiveEvent();
  const { timeZone } = useEventZone(activeEventId);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [state, setState] = useState<"loading" | "ready" | "failed" | "locked">("loading");
  const [generating, setGenerating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [timer, setTimer] = useState<TimerState>(IDLE);
  const [presenter, setPresenter] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const cfg: TimerConfig = configFrom(settings);

  const load = useCallback(async (quiet = false) => {
    if (activeEventId == null) return;
    if (quiet) setRefreshing(true);
    try {
      const [raw, rawSettings] = await Promise.all([
        apiGet<unknown[]>(`/api/events/${activeEventId}/presentations`),
        apiGet<unknown>(`/api/events/${activeEventId}/presentations/settings`).catch(() => null),
      ]);
      setSettings(readSettings(rawSettings));
      setEntries((Array.isArray(raw) ? raw : []).map(normalize).filter((e): e is Entry => e != null).sort((a, b) => a.order - b.order));
      if (!quiet) {
        const saved = loadSaved(activeEventId);
        setTimer(saved?.timer ?? IDLE);
        setPresenter(Boolean(saved?.open));
        setNow(Date.now());
      }
      setState("ready");
    } catch (err) {
      if (err instanceof ApiError && err.code === "MODULE_DISABLED") setState("locked");
      else if (quiet) toast(t("pr.refresh_failed"), "error");
      else setState("failed");
    } finally {
      setRefreshing(false);
    }
  }, [activeEventId, t, toast]);

  useEffect(() => {
    if (eventLoading || activeEventId == null) return;
    void load();
  }, [activeEventId, eventLoading, load]);

  // The clock ticks only while it runs; a paused clock needs no redraws.
  useEffect(() => {
    if (!timer.running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [timer.running]);

  // Another tab of this browser moved the clock: follow it.
  useEffect(() => {
    if (activeEventId == null) return;
    const key = storageKey(activeEventId);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      const saved = parseSaved(e.newValue);
      if (saved) { setTimer(saved.timer); setNow(Date.now()); }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [activeEventId]);

  /** Change the clock (and whether the presenter screen is open) and keep it. */
  const commit = useCallback((next: TimerState, open: boolean = presenter) => {
    setTimer(next);
    setPresenter(open);
    setNow(Date.now());
    if (activeEventId != null) saveTimer(activeEventId, { timer: next, open });
  }, [activeEventId, presenter]);

  const patchStatus = useCallback(async (id: number, status: Status) => {
    if (activeEventId == null) return true;
    try {
      await apiPatch(`/api/events/${activeEventId}/presentations/${id}`, { status });
      return true;
    } catch (err) {
      if (!(err instanceof DemoReadOnlyError)) toast(t("pr.status_failed"), "error");
      return false;
    }
  }, [activeEventId, t, toast]);

  const current = entries.find((e) => e.id === timer.slotId) ?? entries.find((e) => e.status === "presenting") ?? null;
  const index = current ? entries.findIndex((e) => e.id === current.id) : -1;
  const upNext = entries.filter((e, i) => e.status === "waiting" && i > index).slice(0, 3);

  /** Put a team on stage: the one there before is done, the clock starts fresh and waits. */
  const putOnStage = useCallback(async (entry: Entry, { finishCurrent = true }: { finishCurrent?: boolean } = {}) => {
    const before = entries.find((e) => e.status === "presenting" && e.id !== entry.id) ?? null;
    setEntries((prev) => prev.map((e) => {
      if (e.id === entry.id) return { ...e, status: "presenting" };
      if (before && e.id === before.id) return { ...e, status: finishCurrent ? "done" : "waiting" };
      return e;
    }));
    commit(onStage(entry.id));
    if (before) await patchStatus(before.id, finishCurrent ? "done" : "waiting");
    await patchStatus(entry.id, "presenting");
  }, [entries, commit, patchStatus]);

  const finish = useCallback(async (entry: Entry) => {
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, status: "done" } : e)));
    if (timer.slotId === entry.id || current?.id === entry.id) commit(onStage(null));
    if (await patchStatus(entry.id, "done")) toast(fill(t("pr.finished"), { team: entry.team }), "success");
  }, [timer.slotId, current, commit, patchStatus, t, toast]);

  const next = useCallback(async () => {
    const following = entries.find((e, i) => i > index && e.status === "waiting") ?? (index < 0 ? entries.find((e) => e.status === "waiting") : undefined);
    if (!following) {
      if (current) await finish(current);
      toast(t("pr.no_more"), "info");
      return;
    }
    await putOnStage(following, { finishCurrent: true });
  }, [entries, index, current, finish, putOnStage, t, toast]);

  const previous = useCallback(async () => {
    if (index <= 0) return;
    await putOnStage(entries[index - 1], { finishCurrent: false });
  }, [entries, index, putOnStage]);

  const toggle = useCallback(() => {
    if (!current) {
      const first = entries.find((e) => e.status === "waiting");
      if (!first) { toast(t("pr.no_more"), "info"); return; }
      void putOnStage(first).then(() => commit(toggleTimer(onStage(first.id), Date.now())));
      return;
    }
    const base = timer.slotId === current.id ? timer : onStage(current.id);
    commit(toggleTimer(base, Date.now()));
  }, [current, entries, timer, commit, putOnStage, t, toast]);

  const resetClock = useCallback(() => commit(resetTimer(current ? { ...timer, slotId: current.id } : timer)), [commit, current, timer]);
  const toQuestions = useCallback(() => {
    if (!current || cfg.qaSec <= 0) return;
    const base = timer.slotId === current.id ? timer : onStage(current.id);
    commit(skipToQa(base, cfg, Date.now()));
  }, [current, cfg, timer, commit]);

  const generate = async () => {
    if (activeEventId == null) return;
    setGenerating(true);
    try {
      const res = await apiPost<unknown>(`/api/events/${activeEventId}/presentations/generate`, {});
      toast(Array.isArray(res) ? fill(t("pr.generated_n"), { n: res.length }) : t("pr.generated"), "success");
      await load(true);
    } catch (err) {
      if (!(err instanceof DemoReadOnlyError)) toast(t("pr.generate_failed"), "error");
    } finally {
      setGenerating(false);
    }
  };

  const move = async (id: number, by: -1 | 1) => {
    if (activeEventId == null) return;
    const i = entries.findIndex((e) => e.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= entries.length) return;
    const list = [...entries];
    [list[i], list[j]] = [list[j], list[i]];
    const reordered = list.map((e, k) => ({ ...e, order: k + 1 }));
    setEntries(reordered);
    try {
      await apiPut(`/api/events/${activeEventId}/presentations/reorder`, { order: reordered.map((e) => e.id) });
      await load(true);
    } catch (err) {
      if (!(err instanceof DemoReadOnlyError)) toast(t("pr.order_failed"), "error");
    }
  };

  const saveLink = async (entry: Entry, link: string) => {
    if (activeEventId == null || link === entry.driveLink) return;
    try {
      await apiPatch(`/api/events/${activeEventId}/presentations/${entry.id}`, { driveLink: link });
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, driveLink: link } : e)));
      toast(t("pr.link_saved"), "success");
    } catch (err) {
      if (!(err instanceof DemoReadOnlyError)) toast(err instanceof ApiError && err.summary ? err.summary : t("pr.link_failed"), "error");
    }
  };

  const exportCsv = () => {
    const csv = toCSV(entries.map((e, i) => ({
      n: i + 1,
      team: e.team,
      project: e.project,
      at: e.scheduledAt ? formatDate(e.scheduledAt, lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }) : "",
      minutes: e.duration,
      slides: e.driveLink || e.presentationLink,
      demo: e.demoLink,
      status: t(`pr.status.${e.status}`),
    })), [
      { key: "n", header: "#" },
      { key: "team", header: t("pr.col.team") },
      { key: "project", header: t("pr.col.project") },
      { key: "at", header: t("pr.col.time") },
      { key: "minutes", header: t("pr.col.minutes") },
      { key: "slides", header: t("pr.col.slides") },
      { key: "demo", header: t("pr.col.demo") },
      { key: "status", header: t("pr.col.status") },
    ]);
    downloadCSV("presentations.csv", csv);
  };

  const view = viewOf(current && timer.slotId === current.id ? timer : onStage(current?.id ?? null), cfg, now);
  const done = entries.filter((e) => e.status === "done").length;
  const waiting = entries.filter((e) => e.status === "waiting").length;
  const eventName = events.find((e) => e.id === activeEventId)?.name ?? "";

  if (activeEventId == null && !eventLoading) {
    return <p className="py-10 text-center text-[15px]" style={ink("-3")}>{t("rs.no_event")}</p>;
  }

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={ink()}>{t("pr.title")}</h1>
        <p className="mt-1 max-w-2xl text-[15px]" style={ink("-2")}>{t("pr.subtitle")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" icon={<RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />} disabled={refreshing || state !== "ready"} onClick={() => void load(true)}>{t("pr.refresh")}</Button>
        <Button size="sm" variant="secondary" icon={<Sparkles size={14} />} loading={generating} disabled={generating || state !== "ready"} onClick={() => void generate()}>{t("pr.generate")}</Button>
        <Button size="sm" variant="ghost" icon={<Download size={14} />} disabled={entries.length === 0} onClick={exportCsv}>{t("pr.export")}</Button>
        <Button size="sm" variant="primary" icon={<MonitorPlay size={14} />} disabled={entries.length === 0} onClick={() => commit(timer, true)}>{t("pr.presenter")}</Button>
      </div>
    </div>
  );

  if (state === "loading" || eventLoading) {
    return <div className="space-y-6" aria-busy="true">{header}<Skeleton className="h-40 rounded-[var(--radius)]" /><Skeleton className="h-64 rounded-[var(--radius)]" /></div>;
  }
  if (state === "locked") return <div className="space-y-6">{header}<Notice tone="info">{t("pr.locked")}</Notice></div>;
  if (state === "failed") {
    return <div className="space-y-6">{header}<ErrorState title={t("common.load_failed_title")} body={t("pr.load_failed")} onRetry={() => { setState("loading"); void load(); }} /></div>;
  }

  return (
    <div className="space-y-6">
      {header}

      <p className="text-[13px]" style={ink("-3")}>
        {fill(t("pr.rules"), { talk: settings.slotMinutes, qa: settings.qaMinutes, warn: clock(settings.warnSeconds) })}{" "}
        {activeEventId != null ? <Link href={`/create-event/${activeEventId}?section=presentation`} className="underline underline-offset-2" style={{ color: "var(--accent)" }}>{t("pr.change_rules")}</Link> : null}
        {settings.order === "random" ? <span className="ml-1">· {t("pr.order_random")}</span> : null}
      </p>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={ink("-3")}>{t("pr.on_stage")}</p>
            <p className="mt-1 truncate text-[18px] font-semibold" style={ink()}>{current ? current.team : t("pr.nobody")}</p>
            {current ? <p className="truncate text-[13.5px]" style={ink("-2")}>{current.project}</p> : null}
          </div>
          <TimerFace view={view} cfg={cfg} size="md" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" icon={<SkipBack size={14} />} aria-label={t("pr.previous")} title={t("pr.previous")} disabled={index <= 0} onClick={() => void previous()} />
            <Button size="sm" variant={timer.running ? "secondary" : "primary"} icon={timer.running ? <Pause size={14} /> : <Play size={14} />} onClick={toggle} disabled={entries.length === 0}>
              {t(timer.running ? "pr.pause" : view.phase === "ready" ? "pr.start" : "pr.resume")}
            </Button>
            <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} aria-label={t("pr.reset")} title={t("pr.reset")} onClick={resetClock} disabled={!current} />
            <Button size="sm" variant="ghost" icon={<SkipForward size={14} />} onClick={() => void next()} disabled={entries.length === 0}>{t("pr.next")}</Button>
          </div>
        </div>
        <div className="mt-4">
          <Progress value={entries.length ? Math.round((done / entries.length) * 100) : 0} label={fill(t("pr.progress"), { done, total: entries.length, waiting })} />
        </div>
      </Card>

      <Card padded={false}>
        <div className="px-5 py-4">
          <h2 className="text-[15px] font-semibold" style={ink()}>{t("pr.queue")}</h2>
          <p className="mt-0.5 text-[12.5px]" style={ink("-3")}>{t("pr.queue_hint")}</p>
        </div>
        {entries.length === 0 ? (
          <EmptyState icon={<Presentation size={19} />} title={t("pr.empty")} body={t("pr.empty_hint")}
            action={<Button size="sm" variant="primary" icon={<Sparkles size={14} />} loading={generating} onClick={() => void generate()}>{t("pr.generate")}</Button>} />
        ) : (
          <ol className="divide-y border-t" style={{ borderColor: "var(--line)" }}>
            {entries.map((e, i) => (
              <QueueRow
                // A link saved elsewhere starts the row's field afresh.
                key={`${e.id}:${e.driveLink}`}
                entry={e}
                position={i + 1}
                first={i === 0}
                last={i === entries.length - 1}
                timeZone={timeZone}
                onUp={() => void move(e.id, -1)}
                onDown={() => void move(e.id, 1)}
                onStage={() => void putOnStage(e)}
                onFinish={() => void finish(e)}
                onBack={() => { setEntries((prev) => prev.map((x) => (x.id === e.id ? { ...x, status: "waiting" } : x))); void patchStatus(e.id, "waiting"); }}
                onSaveLink={(link) => void saveLink(e, link)}
              />
            ))}
          </ol>
        )}
      </Card>

      {presenter ? (
        <PresenterScreen
          eventName={eventName}
          current={current}
          position={index + 1}
          total={entries.length}
          upNext={upNext}
          view={view}
          cfg={cfg}
          running={timer.running}
          timeZone={timeZone}
          canPrevious={index > 0}
          onToggle={toggle}
          onNext={() => void next()}
          onPrevious={() => void previous()}
          onReset={resetClock}
          onQuestions={toQuestions}
          onClose={() => commit(timer, false)}
        />
      ) : null}
    </div>
  );
}

/* ── The clock face ──────────────────────────────────────────────────────── */

function phaseColour(view: TimerView): string {
  if (view.phase === "over") return "var(--danger)";
  if (view.warn) return "var(--warn)";
  if (view.phase === "qa") return "var(--info)";
  return "var(--ink)";
}

function TimerFace({ view, cfg, size }: { view: TimerView; cfg: TimerConfig; size: "md" | "xl" }) {
  const { t } = useTranslation();
  const label = view.phase === "over" ? t("pr.phase.over") : view.phase === "qa" ? t("pr.phase.qa") : view.phase === "talk" ? t("pr.phase.talk") : t("pr.phase.ready");
  const digits = view.phase === "over" ? `+${clock(view.overtime)}` : clock(view.remaining);
  const talkShare = cfg.talkSec + cfg.qaSec > 0 ? (cfg.talkSec / (cfg.talkSec + cfg.qaSec)) * 100 : 100;
  return (
    <div className={size === "xl" ? "w-full max-w-4xl" : "min-w-[11rem]"}>
      <div className="flex items-baseline justify-center gap-3">
        <span
          className={`font-bold tabular-nums tracking-[-0.03em] ${view.warn && view.phase !== "over" ? "motion-safe:animate-pulse" : ""}`}
          style={{ color: phaseColour(view), fontSize: size === "xl" ? "clamp(5rem, 20vw, 15rem)" : "2.75rem", lineHeight: 1 }}
          aria-hidden="true"
        >
          {digits}
        </span>
      </div>
      <p className="mt-2 text-center font-semibold uppercase tracking-[0.12em]" style={{ color: phaseColour(view), fontSize: size === "xl" ? "clamp(1rem, 2.2vw, 1.6rem)" : "0.75rem" }}>
        {label}
      </p>
      {/* What a screen reader hears: the phase when it changes, not every second. */}
      <p className="sr-only" aria-live="assertive">{label}</p>
      <span className="sr-only">{fill(t("pr.time_left"), { time: digits })}</span>
      <div className="relative mt-3 h-2 overflow-hidden rounded-full" style={{ background: "var(--tint)" }} aria-hidden="true">
        <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-200" style={{ width: `${view.progress * 100}%`, background: phaseColour(view) }} />
        {cfg.qaSec > 0 ? <div className="absolute inset-y-0 w-0.5" style={{ left: `${talkShare}%`, background: "var(--surface)" }} /> : null}
      </div>
    </div>
  );
}

/* ── One slot in the queue ───────────────────────────────────────────────── */

function QueueRow({ entry, position, first, last, timeZone, onUp, onDown, onStage, onFinish, onBack, onSaveLink }: {
  entry: Entry;
  position: number;
  first: boolean;
  last: boolean;
  timeZone: string;
  onUp: () => void;
  onDown: () => void;
  onStage: () => void;
  onFinish: () => void;
  onBack: () => void;
  onSaveLink: (link: string) => void;
}) {
  const { t, lang } = useTranslation();
  const [link, setLink] = useState(entry.driveLink);
  const slides = entry.driveLink || entry.presentationLink;
  const on = entry.status === "presenting";
  const done = entry.status === "done";
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap" style={{ borderColor: "var(--line)", background: on ? "var(--accent-weak)" : undefined, opacity: done ? 0.7 : 1 }}>
      <div className="flex items-center gap-1">
        <div className="flex flex-col">
          <button type="button" onClick={onUp} disabled={first} aria-label={fill(t("pr.move_up"), { team: entry.team })} className="inline-flex h-6 w-7 items-center justify-center rounded disabled:opacity-25" style={ink("-2")}>
            <ChevronUp size={15} />
          </button>
          <button type="button" onClick={onDown} disabled={last} aria-label={fill(t("pr.move_down"), { team: entry.team })} className="inline-flex h-6 w-7 items-center justify-center rounded disabled:opacity-25" style={ink("-2")}>
            <ChevronDown size={15} />
          </button>
        </div>
        <span className="w-7 text-center text-[14px] font-bold tabular-nums" style={ink("-2")}>{position}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium" style={ink()}>
          {entry.team}
          <Badge tone={on ? "brand" : done ? "ok" : "neutral"} dot={on}>{t(`pr.status.${entry.status}`)}</Badge>
        </p>
        <p className="truncate text-[13px]" style={ink("-2")}>{entry.project}</p>
        <p className="mt-0.5 text-[12px] tabular-nums" style={ink("-3")}>
          {[
            entry.scheduledAt ? formatDate(entry.scheduledAt, lang, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }) : null,
            entry.duration ? fill(t("pr.minutes"), { n: entry.duration }) : null,
          ].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {slides ? (
          <a href={href(slides)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium" style={{ background: "var(--accent-weak)", color: "var(--accent)" }}>
            <Presentation size={12} aria-hidden="true" />{t("pr.slides")}
          </a>
        ) : (
          <label className="inline-flex items-center gap-1">
            <span className="sr-only">{fill(t("pr.link_label"), { team: entry.team })}</span>
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onBlur={() => onSaveLink(link.trim())}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              placeholder={t("pr.link_ph")}
              className="h-8 w-40 rounded-md border px-2 text-[12px] outline-none focus:ring-2"
              style={{ borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink)", ["--tw-ring-color" as string]: "var(--accent-weak)" }}
            />
          </label>
        )}
        {entry.repoLink ? (
          <a href={href(entry.repoLink)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px]" style={{ background: "var(--tint)", color: "var(--ink-2)" }}>
            <Link2 size={12} aria-hidden="true" />{t("pr.repo")}
          </a>
        ) : null}
        {entry.demoLink ? (
          <a href={href(entry.demoLink)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px]" style={{ background: "var(--tint)", color: "var(--ink-2)" }}>
            <ExternalLink size={12} aria-hidden="true" />{t("pr.demo")}
          </a>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-1.5">
        {on ? (
          <Button size="sm" variant="secondary" onClick={onFinish}>{t("pr.finish")}</Button>
        ) : done ? (
          <Button size="sm" variant="ghost" onClick={onBack}>{t("pr.back_to_queue")}</Button>
        ) : (
          <Button size="sm" variant="primary" onClick={onStage}>{t("pr.put_on_stage")}</Button>
        )}
      </div>
    </li>
  );
}

/* ── Presenter mode ──────────────────────────────────────────────────────── */

function PresenterScreen({
  eventName, current, position, total, upNext, view, cfg, running, timeZone, canPrevious,
  onToggle, onNext, onPrevious, onReset, onQuestions, onClose,
}: {
  eventName: string;
  current: Entry | null;
  position: number;
  total: number;
  upNext: Entry[];
  view: TimerView;
  cfg: TimerConfig;
  running: boolean;
  timeZone: string;
  canPrevious: boolean;
  onToggle: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onReset: () => void;
  onQuestions: () => void;
  onClose: () => void;
}) {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const box = useRef<HTMLDivElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);

  // The latest handlers for the keyboard, without re-binding on every tick.
  const keys = useRef({ onToggle, onNext, onPrevious, onReset, onClose });
  useEffect(() => { keys.current = { onToggle, onNext, onPrevious, onReset, onClose }; });

  const fullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (box.current?.requestFullscreen) await box.current.requestFullscreen();
      else throw new Error("unsupported");
    } catch {
      toast(t("lb.fullscreen_failed"), "info");
    }
  }, [t, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      const onButton = (e.target as HTMLElement | null)?.tagName === "BUTTON";
      if (e.key === " " && !onButton) { e.preventDefault(); keys.current.onToggle(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); keys.current.onNext(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); keys.current.onPrevious(); }
      else if ((e.key === "r" || e.key === "R") && !e.metaKey && !e.ctrlKey) keys.current.onReset();
      else if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey) void fullscreen();
      else if (e.key === "Escape" && !document.fullscreenElement) keys.current.onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focus = window.setTimeout(() => startButton.current?.focus(), 30);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      window.clearTimeout(focus);
    };
  }, [fullscreen]);

  return (
    <Portal>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={t("pr.presenter")}
        className="fixed inset-0 flex flex-col overflow-y-auto"
        style={{ zIndex: 115, background: "var(--surface)", color: "var(--ink)" }}
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-8" style={{ borderColor: "var(--line)" }}>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold" style={ink()}>{eventName || t("pr.title")}</p>
            <p className="text-[12.5px] tabular-nums" style={ink("-3")}>{current ? fill(t("pr.slot_of"), { n: position, total }) : t("pr.nobody")}</p>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" icon={<Maximize2 size={15} />} onClick={() => void fullscreen()}>{t("lb.fullscreen")}</Button>
            <Button size="sm" variant="ghost" icon={<X size={16} />} onClick={onClose}>{t("pr.exit")}</Button>
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-6 text-center sm:px-8">
          <div className="min-w-0 max-w-5xl">
            <p className="text-balance font-bold tracking-[-0.02em]" style={{ fontSize: "clamp(2rem, 6vw, 4.5rem)", lineHeight: 1.05, color: "var(--ink)" }}>
              {current ? current.team : t("pr.nobody")}
            </p>
            {current ? <p className="mt-2 text-balance" style={{ fontSize: "clamp(1.1rem, 2.6vw, 2rem)", color: "var(--ink-2)" }}>{current.project}</p> : null}
          </div>

          <TimerFace view={view} cfg={cfg} size="xl" />

          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button size="lg" variant="ghost" icon={<SkipBack size={18} />} onClick={onPrevious} disabled={!canPrevious}>{t("pr.previous")}</Button>
            <Button ref={startButton} size="lg" variant={running ? "secondary" : "primary"} icon={running ? <Pause size={18} /> : <Play size={18} />} onClick={onToggle} className="min-w-[9rem]">
              {t(running ? "pr.pause" : view.phase === "ready" ? "pr.start" : "pr.resume")}
            </Button>
            <Button size="lg" variant="ghost" icon={<RotateCcw size={18} />} onClick={onReset} disabled={!current}>{t("pr.reset")}</Button>
            {cfg.qaSec > 0 && view.phase === "talk" ? (
              <Button size="lg" variant="ghost" icon={<FastForward size={18} />} onClick={onQuestions}>{t("pr.to_questions")}</Button>
            ) : null}
            <Button size="lg" variant="secondary" icon={<SkipForward size={18} />} onClick={onNext}>{t("pr.next")}</Button>
          </div>
        </div>

        <div className="grid gap-4 border-t px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-8" style={{ borderColor: "var(--line)" }}>
          <div className="min-w-0">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em]" style={ink("-3")}>{t("pr.up_next")}</p>
            {upNext.length === 0 ? <p className="mt-1 text-[14px]" style={ink("-3")}>{t("pr.no_more")}</p> : (
              <ol className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1">
                {upNext.map((e) => (
                  <li key={e.id} className="min-w-0 text-[15px]" style={ink()}>
                    <span className="font-semibold">{e.team}</span>
                    <span style={ink("-3")}> — {e.project}</span>
                    {e.scheduledAt ? <span className="ml-1.5 tabular-nums text-[13px]" style={ink("-3")}>{formatDate(e.scheduledAt, lang, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone })}</span> : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <p className="self-end text-[12px]" style={ink("-3")}>{t("pr.keys")}</p>
        </div>
      </div>
    </Portal>
  );
}
