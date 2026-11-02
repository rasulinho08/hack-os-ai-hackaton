"use client";

/**
 * The organiser's judges: who judges (invite, activate, remove; each judge's
 * track and conflict-of-interest declaration), who judges whom (every judge
 * every team, by track, or N judges per team shared out evenly or picked by
 * hand), conflicts of interest, and who has judged what so far.
 *
 * The rules are the API's: a judge never sees their own team or a team they
 * declared a conflict with, and in per-team mode only the teams assigned to
 * them. This page sets those inputs and shows their effect.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Check, CheckCircle2, CircleDashed, CircleSlash, Copy, EyeOff, Mail, MinusCircle, Pencil, Plus,
  RefreshCw, Shuffle, Trash2, UserCheck, XCircle,
} from "lucide-react";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { Badge, Button, EmptyState, ErrorState, Progress, Tabs, type Tone } from "@/components/ds/primitives";
import { Modal } from "@/components/ds/overlays";
import { Notice, NumberStepper, Segmented, Select, TextArea, TextInput } from "@/components/builder/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast, type ToastType } from "@/contexts/ToastContext";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { ApiError, DemoReadOnlyError, apiGet, apiPost } from "@/lib/api";
import { activatePendingStaff, addEventStaff, buildStaffInviteUrl, listEventStaff, removeEventStaff } from "@/lib/eventStaff";
import { fill } from "@/lib/i18n/fill";
import { formatDate } from "@/lib/i18n/dates";
import { tableLabels } from "@/lib/i18n/tableLabels";
import { useDemoBasePath } from "@/lib/demoPath";
import {
  ASSIGNMENT_MODES, CELL_STATES, JUDGES_TABS, cellKey, completion, errorKey, judgesPerTeamCount, judgingApi, judgingSettings,
  normalizeJudges,
  type AssignmentMode, type CellState, type ConflictRow, type JudgeRow, type JudgesTab, type JudgingProgress, type JudgingSettings,
  type ProgressTeam, type WindowState,
} from "@/lib/judging";

/* ── Tabs in the address (?tab=assignment) ───────────────────────────── */

type Tab = JudgesTab;
const tabFrom = (v: string | null): Tab => ((JUDGES_TABS as readonly string[]).includes(String(v)) ? (v as Tab) : "judges");

export default function JudgesPage() {
  return (
    <Suspense fallback={null}>
      <JudgesScreen />
    </Suspense>
  );
}

function JudgesScreen() {
  const { t } = useTranslation();
  const { activeEventId, loading: eventLoading } = useActiveEvent();
  if (activeEventId == null) {
    if (eventLoading) return null;
    return <p className="py-10 text-center text-[15px]" style={{ color: "var(--ink-3)" }}>{t("jg.no_event")}</p>;
  }
  // A new event starts from a clean slate: the board is remounted per event.
  return <JudgesBoard key={activeEventId} eventId={activeEventId} />;
}

/* ── Data ────────────────────────────────────────────────────────────── */

interface Track { id: number; name: string }
interface Pending { email: string; inviteId: number | null }
interface EventMeta { settings: JudgingSettings; judgingStart: string | null; judgingEnd: string | null }

interface Board {
  judges: JudgeRow[];
  pending: Pending[];
  /** e-mail → the judge invitation it came from (removed together with the judge). */
  inviteByEmail: Record<string, number>;
  progress: JudgingProgress;
  assignments: Record<number, number[]>;
  conflicts: ConflictRow[];
  tracks: Track[];
  meta: EventMeta;
}

async function loadBoard(eventId: number): Promise<Board> {
  const [staff, judgesRaw, invitesRaw, progress, assignments, conflicts, tracksRaw, eventRaw] = await Promise.all([
    listEventStaff(eventId, "judge"),
    apiGet<unknown>(`/api/events/${eventId}/judging/judges`),
    apiGet<unknown[]>(`/api/events/${eventId}/invites`).catch(() => [] as unknown[]),
    judgingApi.progress(eventId),
    judgingApi.assignments(eventId).catch(() => ({} as Record<number, number[]>)),
    judgingApi.conflicts(eventId).catch(() => [] as ConflictRow[]),
    apiGet<unknown[]>(`/api/events/${eventId}/tracks`).catch(() => [] as unknown[]),
    apiGet<Record<string, unknown>>(`/api/events/${eventId}`).catch(() => null),
  ]);
  const tracks = (Array.isArray(tracksRaw) ? tracksRaw : [])
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
    .filter((x) => Number(x.id) > 0)
    .map((x) => ({ id: Number(x.id), name: String(x.name ?? `#${x.id}`) }));
  const ev = eventRaw && typeof eventRaw === "object" ? eventRaw : {};
  const inviteByEmail: Record<string, number> = {};
  for (const raw of Array.isArray(invitesRaw) ? invitesRaw : []) {
    const inv = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const mail = String(inv.email ?? "").trim().toLowerCase();
    if (inv.role === "judge" && mail && Number(inv.id) > 0) inviteByEmail[mail] = Number(inv.id);
  }
  return {
    judges: normalizeJudges(judgesRaw),
    pending: staff.filter((r) => r.status === "pending").map((r) => ({ email: r.email, inviteId: r.inviteId })),
    inviteByEmail,
    progress,
    assignments,
    conflicts,
    tracks,
    meta: {
      // Without a stored judging_config (older events, the walkthrough) the API's defaults apply.
      settings: judgingSettings({ ...(ev.judging_config as object), assignment: progress.config.assignment, judgesPerTeam: progress.config.judgesPerTeam, blind: progress.config.blind, coiRequired: progress.config.coiRequired }),
      judgingStart: typeof ev.judging_start === "string" ? ev.judging_start : progress.window.start,
      judgingEnd: typeof ev.judging_end === "string" ? ev.judging_end : progress.window.end,
    },
  };
}

const WINDOW_TONE: Record<WindowState, Tone> = { open: "ok", not_open: "info", closed: "neutral", published: "brand", archived: "neutral" };

/** The words for a refusal from the API: its own sentence when we have one. */
function refusal(err: unknown, t: (k: string) => string): string {
  if (err instanceof DemoReadOnlyError) return t("jg.demo_read_only");
  const key = errorKey("jg.err.", err, "jg.failed");
  return t(key);
}

/* ── The board ───────────────────────────────────────────────────────── */

function JudgesBoard({ eventId }: { eventId: number }) {
  const params = useSearchParams();
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const base = useDemoBasePath();
  const [tab, setTabState] = useState<Tab>(() => tabFrom(params.get("tab")));
  const [board, setBoard] = useState<Board | null>(null);
  const [failed, setFailed] = useState(false);
  const [mailReady, setMailReady] = useState<boolean | null>(null);

  const setTab = (next: Tab) => {
    setTabState(next);
    try {
      const url = new URL(window.location.href);
      if (next === "judges") url.searchParams.delete("tab");
      else url.searchParams.set("tab", next);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch { /* the address is a convenience */ }
  };

  const load = useCallback(async () => {
    try {
      setBoard(await loadBoard(eventId));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [eventId]);

  useEffect(() => {
    let cancelled = false;
    loadBoard(eventId)
      .then((b) => { if (!cancelled) { setBoard(b); setFailed(false); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    apiGet<{ smtpConfigured?: boolean; fromConfigured?: boolean }>("/api/mail/status")
      .then((s) => { if (!cancelled) setMailReady(Boolean(s?.smtpConfigured && s?.fromConfigured)); })
      .catch(() => { if (!cancelled) setMailReady(null); });
    return () => { cancelled = true; };
  }, [eventId]);

  // Judges score while the organiser watches: look again every half minute.
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  // The walkthrough has no builder to open: its links are left out there.
  const builderHref = base ? null : `/create-event/${eventId}?section=judging`;

  if (!board) {
    return (
      <div className="space-y-6">
        <Header t={t} onRefresh={() => void load()} />
        {failed ? <ErrorState title={t("jg.load_failed")} body={t("jg.load_failed_b")} onRetry={() => void load()} /> : <div className="hs-skeleton h-64 rounded-[var(--radius)]" aria-busy="true" aria-label={t("Loading")} />}
      </div>
    );
  }

  const { progress, meta } = board;
  const s = meta.settings;
  const windowLine = windowText(progress.window.state, meta.judgingStart, meta.judgingEnd, lang, t, progress.window.startsAtDeadline);
  const tabs = [
    { id: "judges" as const, label: t("jg.tab.judges"), count: board.judges.length + board.pending.length },
    { id: "assignment" as const, label: t("jg.tab.assignment") },
    { id: "conflicts" as const, label: t("jg.tab.conflicts"), count: board.conflicts.length },
    { id: "progress" as const, label: t("jg.tab.progress") },
  ];

  return (
    <div className="space-y-6">
      <Header t={t} onRefresh={() => void load()} />

      <section aria-label={t("jg.settings")} className="flex flex-col gap-3 rounded-[var(--radius)] border px-4 py-3.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
        style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone={WINDOW_TONE[progress.window.state]} dot>{t(`jg.window.${progress.window.state}`)}</Badge>
          {windowLine ? <span className="text-[13px]" style={{ color: "var(--ink-2)" }}>{windowLine}</span> : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone="neutral">{t(`jg.mode.${s.assignment}`)}{s.assignment === "per_team" ? ` · ${fill(t("jg.per_team_n"), { n: s.judgesPerTeam })}` : ""}</Badge>
          <Badge tone={s.blind ? "info" : "neutral"}>{s.blind ? <EyeOff size={11} aria-hidden="true" /> : null}{t(s.blind ? "jg.set.blind_on" : "jg.set.blind_off")}</Badge>
          <Badge tone={s.coiRequired ? "info" : "neutral"}>{t(s.coiRequired ? "jg.set.coi_on" : "jg.set.coi_off")}</Badge>
          <Badge tone="neutral">{t(s.showScores ? "jg.set.scores_on" : "jg.set.scores_off")}</Badge>
          {builderHref ? <a href={builderHref} className="text-[13px] font-medium underline-offset-2 hover:underline" style={{ color: "var(--accent)" }}>{t("jg.change_in_builder")}</a> : null}
        </div>
      </section>

      {progress.criteria === 0 ? (
        <Notice tone="warn"><span>{t("jg.no_criteria")}{builderHref ? <> <a href={builderHref} className="font-medium underline underline-offset-2">{t("jg.add_criteria")}</a></> : null}</span></Notice>
      ) : null}

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      <div role="tabpanel" aria-label={tabs.find((x) => x.id === tab)?.label}>
        {tab === "judges" ? <JudgesPanel eventId={eventId} board={board} mailReady={mailReady} reload={load} toast={toast} /> : null}
        {tab === "assignment" ? <AssignmentPanel eventId={eventId} board={board} reload={load} toast={toast} goToJudges={() => setTab("judges")} /> : null}
        {tab === "conflicts" ? <ConflictsPanel eventId={eventId} board={board} reload={load} toast={toast} /> : null}
        {tab === "progress" ? <ProgressPanel board={board} /> : null}
      </div>
    </div>
  );
}

function Header({ t, onRefresh }: { t: (k: string) => string; onRefresh: () => void }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("jg.title")}</h1>
        <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>{t("jg.subtitle")}</p>
      </div>
      <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={onRefresh}>{t("jg.refresh")}</Button>
    </div>
  );
}

function windowText(state: WindowState, start: string | null, end: string | null, lang: string, t: (k: string) => string, atDeadline = false): string {
  const at = (v: string | null) => (v ? formatDate(v, lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
  // No judging start of its own: judging opens when submissions close.
  if (state === "not_open" && start && atDeadline) return fill(t("jg.window_opens_deadline"), { at: at(start) });
  if (state === "not_open" && start) return fill(t("jg.window_opens"), { at: at(start) });
  if (state === "open" && end) return fill(t("jg.window_closes"), { at: at(end) });
  if (state === "open") return t("jg.window_no_end");
  if (state === "closed" && end) return fill(t("jg.window_closed_at"), { at: at(end) });
  return t(`jg.window_hint.${state}`);
}

type ToastFn = (message: string, type?: ToastType, duration?: number) => void;

/* ── Judges ──────────────────────────────────────────────────────────── */

type Row =
  | { id: string; kind: "active"; judge: JudgeRow; assigned: number; done: number; partial: number }
  | { id: string; kind: "pending"; email: string; inviteId: number | null };

type RemoveTarget = Row | null;

function JudgesPanel({ eventId, board, mailReady, reload, toast }: { eventId: number; board: Board; mailReady: boolean | null; reload: () => Promise<void>; toast: ToastFn }) {
  const { t, lang } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<RemoveTarget>(null);
  const { progress, meta, tracks } = board;

  const stats = useMemo(() => {
    const byId = new Map(progress.judges.map((j) => [j.id, j]));
    let done = 0;
    let assigned = 0;
    for (const j of progress.judges) { done += j.done; assigned += j.assigned; }
    const confirmed = board.judges.filter((j) => j.coiConfirmedAt).length;
    return { byId, done, assigned, confirmed };
  }, [progress, board.judges]);

  const rows: Row[] = useMemo(() => [
    ...board.judges.map((j) => {
      const p = stats.byId.get(j.id);
      return { id: `a${j.id}`, kind: "active" as const, judge: j, assigned: p?.assigned ?? 0, done: p?.done ?? 0, partial: p?.partial ?? 0 };
    }),
    ...board.pending.map((p) => ({ id: `i${p.inviteId ?? p.email}`, kind: "pending" as const, email: p.email, inviteId: p.inviteId })),
  ], [board.judges, board.pending, stats]);

  const sendInvite = async (email: string) => {
    const url = buildStaffInviteUrl(eventId, email);
    try {
      await apiPost("/api/mail/staff-invite", { to: email, role: "judge", inviteUrl: url, eventId });
      toast(t("jg.invite_sent"), "success");
    } catch (err) {
      toast(err instanceof DemoReadOnlyError ? t("jg.demo_read_only") : t("jg.invite_not_sent"), "error");
    }
  };

  const copyLink = async (email: string) => {
    const url = buildStaffInviteUrl(eventId, email);
    try {
      await navigator.clipboard.writeText(url);
      toast(t("jg.link_copied"), "success");
    } catch {
      toast(url, "info", 12000);
    }
  };

  const activate = async (email: string) => {
    const r = await activatePendingStaff(eventId, "judge", email);
    if (r.ok) toast(t("jg.activated"), "success");
    else toast(r.reason === "user-not-registered" ? t("jg.not_registered") : r.reason === "already-active" ? t("jg.already_active") : t("jg.failed"), r.reason === "already-active" ? "info" : "error");
    await reload();
  };

  const setTrack = async (judge: JudgeRow, value: string) => {
    try {
      await judgingApi.setTrack(eventId, judge.id, value ? Number(value) : null);
      toast(t("jg.track_saved"), "success");
      await reload();
    } catch (err) {
      toast(refusal(err, t), "error");
    }
  };

  const remove = async (row: Row) => {
    try {
      // The invitation goes too, or the person would come back as "invited".
      if (row.kind === "active") await removeEventStaff(eventId, "judge", { assignmentId: row.judge.id, inviteId: board.inviteByEmail[(row.judge.email ?? "").toLowerCase()] ?? null });
      else await removeEventStaff(eventId, "judge", { assignmentId: null, inviteId: row.inviteId });
      toast(t("jg.removed"), "success");
      await reload();
    } catch (err) {
      toast(refusal(err, t), "error");
    }
  };

  const trackOptions = tracks.map((tr) => ({ value: String(tr.id), label: tr.name }));
  const columns: Column<Row>[] = [
    {
      id: "name", header: t("jg.col.judge"), sortable: true,
      value: (r) => (r.kind === "active" ? `${r.judge.name} ${r.judge.email ?? ""}` : r.email),
      cell: (r) => (r.kind === "active" ? (
        <div className="min-w-0">
          <p className="truncate font-medium" style={{ color: "var(--ink)" }}>{r.judge.name}</p>
          <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>{r.judge.email}</p>
        </div>
      ) : (
        <div className="min-w-0">
          <p className="truncate font-medium" style={{ color: "var(--ink)" }}>{r.email}</p>
          <p className="text-xs" style={{ color: "var(--ink-3)" }}>{t("jg.pending_hint")}</p>
        </div>
      )),
    },
    ...(tracks.length ? [{
      id: "track", header: t("jg.col.track"),
      value: (r: Row) => (r.kind === "active" ? tracks.find((x) => x.id === r.judge.trackId)?.name ?? "" : ""),
      cell: (r: Row) => (r.kind === "active" ? (
        <select
          aria-label={fill(t("jg.track_of"), { name: r.judge.name })}
          value={r.judge.trackId == null ? "" : String(r.judge.trackId)}
          onChange={(e) => void setTrack(r.judge, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className="max-w-[12rem] rounded-[8px] border px-2 py-1.5 text-[13px]"
          style={{ borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink)" }}
        >
          <option value="">{t("jg.track_all")}</option>
          {trackOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : null),
    }] : []),
    {
      id: "coi", header: t("jg.col.coi"),
      value: (r) => (r.kind === "active" ? (r.judge.coiConfirmedAt ? 0 : 1) : 2),
      cell: (r) => {
        if (r.kind !== "active") return <Badge tone="warn" dot>{t("jg.invited")}</Badge>;
        if (r.judge.coiConfirmedAt) {
          return <Badge tone="ok"><Check size={11} aria-hidden="true" />{fill(t("jg.coi_on"), { at: formatDate(r.judge.coiConfirmedAt, lang, { day: "numeric", month: "short" }) })}</Badge>;
        }
        return meta.settings.coiRequired ? <Badge tone="warn">{t("jg.coi_missing")}</Badge> : <span className="text-[13px]" style={{ color: "var(--ink-3)" }}>{t("jg.coi_not_required")}</span>;
      },
    },
    {
      id: "reviews", header: t("jg.col.reviews"), align: "right", sortable: true,
      value: (r) => (r.kind === "active" ? completion(r.done, r.assigned) ?? -1 : -2),
      cell: (r) => {
        if (r.kind !== "active") return null;
        const pct = completion(r.done, r.assigned);
        return (
          <div className="ml-auto w-36 text-right">
            <p className="text-[13px] tabular-nums" style={{ color: "var(--ink-2)" }}>{fill(t("jg.reviews_n"), { done: r.done, total: r.assigned })}</p>
            {pct != null ? <Progress value={pct} tone={pct === 100 ? "ok" : "brand"} className="mt-1" /> : null}
          </div>
        );
      },
    },
    {
      id: "actions", header: "", value: () => "", align: "right", hideOnCard: false,
      cell: (r) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {r.kind === "pending" ? (
            <>
              <Button size="sm" variant="ghost" icon={<UserCheck size={13} />} onClick={() => void activate(r.email)}>{t("jg.activate")}</Button>
              <Button size="sm" variant="ghost" icon={<Copy size={13} />} aria-label={t("jg.copy_link")} title={t("jg.copy_link")} onClick={() => void copyLink(r.email)} />
              {mailReady !== false ? <Button size="sm" variant="ghost" icon={<Mail size={13} />} aria-label={t("jg.resend")} title={t("jg.resend")} onClick={() => void sendInvite(r.email)} /> : null}
            </>
          ) : null}
          <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} aria-label={t("jg.remove")} title={t("jg.remove")} style={{ color: "var(--danger)" }} onClick={() => setRemoving(r)} />
        </div>
      ),
    },
  ];

  const statCards = [
    { label: t("jg.stat.judges"), value: String(board.judges.length) },
    { label: t("jg.stat.invited"), value: String(board.pending.length) },
    { label: t("jg.stat.reviews"), value: stats.assigned ? `${stats.done} / ${stats.assigned}` : "—" },
    { label: t("jg.stat.coi"), value: meta.settings.coiRequired ? `${stats.confirmed} / ${board.judges.length}` : t("jg.coi_not_required") },
  ];

  const removingName = removing ? (removing.kind === "active" ? removing.judge.name : removing.email) : "";
  const removingReviews = removing && removing.kind === "active" ? removing.done + removing.partial : 0;

  return (
    <div className="space-y-5 pt-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {statCards.map((s) => (
          <div key={s.label} className="rounded-[var(--radius)] border px-4 py-3.5" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
            <p className="text-[12px] font-medium uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{s.label}</p>
            <p className="mt-1 text-[22px] font-bold tabular-nums" style={{ color: "var(--ink)" }}>{s.value}</p>
          </div>
        ))}
      </div>

      {mailReady === false ? <Notice tone="warn">{t("jg.mail_off")}</Notice> : null}
      {tracks.length && meta.settings.assignment !== "track" && board.judges.some((j) => j.trackId) ? <Notice tone="info">{t("jg.tracks_unused")}</Notice> : null}

      <DataTable
        rows={rows}
        columns={columns}
        searchPlaceholder={t("jg.search")}
        emptyTitle={t("jg.empty")}
        emptyBody={t("jg.empty_b")}
        pageSize={25}
        labels={tableLabels(t)}
        toolbarExtra={<Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setAdding(true)}>{t("jg.add")}</Button>}
      />

      {adding ? (
        <AddJudgeModal
          busy={busy}
          onClose={() => setAdding(false)}
          onAdd={async (email) => {
            setBusy(true);
            try {
              const r = await addEventStaff(eventId, "judge", { email });
              if (!r.invited && !r.assigned) throw new Error(r.error);
              if (mailReady !== false) await sendInvite(email);
              else await copyLink(email);
              setAdding(false);
              await reload();
            } catch (err) {
              toast(err instanceof DemoReadOnlyError ? t("jg.demo_read_only") : err instanceof ApiError ? err.message : t("jg.failed"), "error");
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(removing)}
        title={fill(t("jg.remove_t"), { name: removingName })}
        message={removingReviews ? fill(t("jg.remove_b_scored"), { n: removingReviews }) : t("jg.remove_b")}
        confirmLabel={t("jg.remove")}
        cancelLabel={t("jg.keep")}
        variant="danger"
        onCancel={() => setRemoving(null)}
        onConfirm={() => { const r = removing; setRemoving(null); if (r) void remove(r); }}
      />
    </div>
  );
}

function AddJudgeModal({ busy, onClose, onAdd }: { busy: boolean; onClose: () => void; onAdd: (email: string) => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [tried, setTried] = useState(false);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  return (
    <Modal open onClose={() => !busy && onClose()} title={t("jg.add")} description={t("jg.add_hint")}
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>{t("jg.cancel")}</Button>
          <Button size="sm" variant="primary" loading={busy} disabled={busy} onClick={() => { setTried(true); if (valid) onAdd(email.trim().toLowerCase()); }}>{t("jg.invite")}</Button>
        </div>
      }>
      <TextInput label={t("jg.email")} type="email" value={email} onChange={setEmail} required autoComplete="off" placeholder="name@example.com"
        error={tried && !valid ? t("jg.email_invalid") : null} />
    </Modal>
  );
}

/* ── Who judges whom ─────────────────────────────────────────────────── */

function AssignmentPanel({ eventId, board, reload, toast, goToJudges }: { eventId: number; board: Board; reload: () => Promise<void>; toast: ToastFn; goToJudges: () => void }) {
  const { t } = useTranslation();
  const saved = board.meta.settings;
  const [mode, setMode] = useState<AssignmentMode>(saved.assignment);
  const [perTeam, setPerTeam] = useState<number>(saved.judgesPerTeam);
  const [busy, setBusy] = useState(false);
  const changed = mode !== saved.assignment || (mode === "per_team" && perTeam !== saved.judgesPerTeam);
  const locked = board.progress.window.state === "archived";

  const save = async () => {
    setBusy(true);
    try {
      await judgingApi.saveMode(eventId, mode, perTeam);
      toast(t("jg.mode_saved"), "success");
      await reload();
    } catch (err) {
      toast(refusal(err, t), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 pt-5">
      <section className="space-y-4 rounded-[var(--radius)] border p-4 sm:p-5" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
        <div>
          <h2 className="text-[16px] font-semibold" style={{ color: "var(--ink)" }}>{t("jg.mode_title")}</h2>
          <p className="mt-1 text-[13px]" style={{ color: "var(--ink-2)" }}>{t("jg.mode_help")}</p>
        </div>
        <Segmented value={mode} onChange={setMode} columns={3}
          options={ASSIGNMENT_MODES.map((m) => ({ value: m, label: t(`jg.mode.${m}`), hint: t(`jg.mode_hint.${m}`), disabled: locked }))} />
        {mode === "per_team" ? (
          <NumberStepper label={t("jg.per_team")} value={perTeam} min={1} max={20} onChange={(v) => setPerTeam(v ?? 1)} help={t("jg.per_team_help")} />
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {changed ? <span className="text-[13px]" style={{ color: "var(--warn)" }}>{t("jg.unsaved")}</span> : null}
          <Button size="sm" variant="primary" onClick={() => void save()} loading={busy} disabled={!changed || busy || locked}>{t("jg.save_mode")}</Button>
        </div>
      </section>

      {saved.assignment === "all" ? <AllTeamsView board={board} /> : null}
      {saved.assignment === "track" ? <TrackView board={board} goToJudges={goToJudges} /> : null}
      {saved.assignment === "per_team" ? <PerTeamView eventId={eventId} board={board} reload={reload} toast={toast} /> : null}
    </div>
  );
}

const activeTeams = (b: Board) => b.progress.teams.filter((x) => !x.eliminated);
const teamLabel = (x: ProgressTeam) => (x.projectName ? `${x.projectName} · ${x.name}` : x.name);

function AllTeamsView({ board }: { board: Board }) {
  const { t } = useTranslation();
  const teams = activeTeams(board).length;
  return (
    <Notice tone="info">
      {fill(t("jg.all_view"), { judges: board.judges.length, teams })}
    </Notice>
  );
}

function TrackView({ board, goToJudges }: { board: Board; goToJudges: () => void }) {
  const { t } = useTranslation();
  const teams = activeTeams(board);
  const free = board.judges.filter((j) => !j.trackId);
  const rows = board.tracks.map((tr) => ({
    track: tr,
    judges: board.judges.filter((j) => j.trackId === tr.id),
    teams: teams.filter((x) => x.track === tr.name).length,
  }));
  const untracked = teams.filter((x) => !x.track || !board.tracks.some((tr) => tr.name === x.track)).length;
  if (!board.tracks.length) return <Notice tone="warn">{t("jg.no_tracks")}</Notice>;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>{t("jg.track_view_help")}</p>
        <Button size="sm" variant="secondary" onClick={goToJudges}>{t("jg.set_tracks")}</Button>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const uncovered = r.teams > 0 && r.judges.length === 0 && free.length === 0;
          return (
            <li key={r.track.id} className="rounded-[var(--radius)] border p-4" style={{ borderColor: uncovered ? "var(--warn)" : "var(--line)", background: "var(--surface)" }}>
              <p className="font-semibold" style={{ color: "var(--ink)" }}>{r.track.name}</p>
              <p className="mt-1 text-[13px]" style={{ color: "var(--ink-2)" }}>{fill(t("jg.track_teams"), { n: r.teams })}</p>
              <p className="mt-2 text-[13px]" style={{ color: "var(--ink)" }}>
                {r.judges.length ? r.judges.map((j) => j.name).join(", ") : <span style={{ color: "var(--ink-3)" }}>{t("jg.track_no_judges")}</span>}
              </p>
              {uncovered ? <p className="mt-2 text-[12.5px]" style={{ color: "var(--warn)" }}>{t("jg.track_uncovered")}</p> : null}
            </li>
          );
        })}
      </ul>
      <Notice tone="info">
        {fill(t("jg.track_free"), { n: free.length })}
        {untracked ? ` ${fill(t("jg.track_untracked"), { n: untracked })}` : ""}
      </Notice>
    </section>
  );
}

function PerTeamView({ eventId, board, reload, toast }: { eventId: number; board: Board; reload: () => Promise<void>; toast: ToastFn }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [confirmRedraw, setConfirmRedraw] = useState(false);
  const [shortfall, setShortfall] = useState<{ teamId: number; missing: number }[] | null>(null);
  const [editing, setEditing] = useState<JudgeRow | null>(null);
  const teams = activeTeams(board);
  const target = board.meta.settings.judgesPerTeam;
  const counts = judgesPerTeamCount(board.assignments);
  const covered = teams.filter((x) => (counts[x.id] || 0) >= target).length;
  const loads = board.judges.map((j) => ({ judge: j, n: (board.assignments[j.id] || []).length }));
  const maxLoad = Math.max(1, ...loads.map((l) => l.n));
  const teamName = (id: number) => {
    const x = board.progress.teams.find((tm) => tm.id === id);
    return x ? teamLabel(x) : `#${id}`;
  };

  const generate = async (replace: boolean) => {
    setBusy(true);
    try {
      const out = await judgingApi.generate(eventId, replace);
      setShortfall(Array.isArray(out?.shortfall) ? out.shortfall : []);
      toast(fill(t("jg.generated"), { n: Number(out?.assigned) || 0 }), "success");
      await reload();
    } catch (err) {
      toast(refusal(err, t), "error");
    } finally {
      setBusy(false);
    }
  };

  if (!board.judges.length || !teams.length) {
    return <EmptyState title={t("jg.pt_empty")} body={t("jg.pt_empty_b")} />;
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-[var(--radius)] border p-4 sm:p-5" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold" style={{ color: "var(--ink)" }}>{t("jg.pt_title")}</h2>
            <p className="mt-1 text-[13px]" style={{ color: "var(--ink-2)" }}>{fill(t("jg.pt_covered"), { covered, teams: teams.length, n: target })}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" icon={<Shuffle size={14} />} loading={busy} disabled={busy} onClick={() => void generate(false)}>{t("jg.generate")}</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirmRedraw(true)}>{t("jg.redraw")}</Button>
          </div>
        </div>
        <Progress value={teams.length ? Math.round((covered / teams.length) * 100) : 0} tone={covered === teams.length ? "ok" : "warn"} />
        {shortfall && shortfall.length ? (
          <Notice tone="warn">{fill(t("jg.shortfall"), { n: shortfall.length })} {shortfall.slice(0, 6).map((x) => teamName(x.teamId)).join(", ")}{shortfall.length > 6 ? "…" : ""}</Notice>
        ) : null}
      </section>

      <section className="space-y-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{t("jg.pt_by_judge")}</h3>
        <ul className="divide-y rounded-[var(--radius)] border" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
          {loads.map(({ judge, n }) => (
            <li key={judge.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center" style={{ borderColor: "var(--line)" }}>
              <div className="min-w-0 sm:w-56">
                <p className="truncate font-medium" style={{ color: "var(--ink)" }}>{judge.name}</p>
                <p className="text-[12.5px] tabular-nums" style={{ color: "var(--ink-3)" }}>{fill(t("jg.pt_teams_n"), { n })}</p>
              </div>
              <div className="min-w-0 flex-1">
                <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--tint)" }} aria-hidden="true">
                  <div className="h-full rounded-full" style={{ width: `${Math.round((n / maxLoad) * 100)}%`, background: "var(--accent-solid)" }} />
                </div>
                <p className="mt-1.5 truncate text-[12.5px]" style={{ color: "var(--ink-2)" }} title={(board.assignments[judge.id] || []).map(teamName).join(", ")}>
                  {(board.assignments[judge.id] || []).map(teamName).join(", ") || t("jg.pt_none")}
                </p>
              </div>
              <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setEditing(judge)}>{t("jg.pt_edit")}</Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{t("jg.pt_by_team")}</h3>
        <div className="overflow-x-auto rounded-[var(--radius)] border" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
          <table className="w-full min-w-[32rem] text-[13.5px]">
            <thead>
              <tr style={{ color: "var(--ink-3)" }}>
                <th scope="col" className="px-4 py-2.5 text-left font-medium">{t("jg.col.team")}</th>
                <th scope="col" className="px-4 py-2.5 text-left font-medium">{t("jg.col.judges")}</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">{t("jg.col.count")}</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((x) => {
                const who = board.judges.filter((j) => (board.assignments[j.id] || []).includes(x.id));
                const n = who.length;
                return (
                  <tr key={x.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                    <td className="px-4 py-2.5" style={{ color: "var(--ink)" }}>{teamLabel(x)}</td>
                    <td className="px-4 py-2.5" style={{ color: "var(--ink-2)" }}>{who.map((j) => j.name).join(", ") || "—"}</td>
                    <td className="px-4 py-2.5 text-right"><Badge tone={n >= target ? "ok" : n ? "warn" : "danger"}>{`${n} / ${target}`}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={confirmRedraw}
        title={t("jg.redraw_t")}
        message={t("jg.redraw_b")}
        confirmLabel={t("jg.redraw")}
        cancelLabel={t("jg.cancel")}
        onCancel={() => setConfirmRedraw(false)}
        onConfirm={() => { setConfirmRedraw(false); void generate(true); }}
      />

      {editing ? (
        <AssignModal
          key={editing.id}
          eventId={eventId}
          judge={editing}
          teams={teams}
          current={board.assignments[editing.id] || []}
          blocked={new Set(board.conflicts.filter((c) => c.judgeId === editing.id).map((c) => c.teamId))}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload(); }}
          toast={toast}
        />
      ) : null}
    </div>
  );
}

function AssignModal({ eventId, judge, teams, current, blocked, onClose, onSaved, toast }: {
  eventId: number;
  judge: JudgeRow;
  teams: ProgressTeam[];
  current: number[];
  blocked: Set<number>;
  onClose: () => void;
  onSaved: () => Promise<void>;
  toast: ToastFn;
}) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(current.filter((id) => !blocked.has(id))));
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const shown = teams.filter((x) => !query.trim() || teamLabel(x).toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (id: number) => setChosen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const save = async () => {
    setBusy(true);
    try {
      await judgingApi.setAssignments(eventId, judge.id, [...chosen]);
      toast(t("jg.assignments_saved"), "success");
      await onSaved();
    } catch (err) {
      toast(refusal(err, t), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={() => !busy && onClose()} title={fill(t("jg.assign_t"), { name: judge.name })} description={fill(t("jg.assign_b"), { n: chosen.size })} width={560}
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>{t("jg.cancel")}</Button>
          <Button size="sm" variant="primary" onClick={() => void save()} loading={busy} disabled={busy}>{t("jg.save")}</Button>
        </div>
      }>
      <div className="space-y-3">
        <TextInput label={t("jg.find_team")} value={query} onChange={setQuery} placeholder={t("jg.find_team_ph")} />
        <fieldset>
          <legend className="sr-only">{t("jg.col.team")}</legend>
          <ul className="max-h-[42vh] divide-y overflow-y-auto rounded-[10px] border" style={{ borderColor: "var(--line)" }}>
            {shown.map((x) => {
              const conflict = blocked.has(x.id);
              const id = `asg-${judge.id}-${x.id}`;
              return (
                <li key={x.id} className="flex items-center gap-3 px-3 py-2.5" style={{ borderColor: "var(--line)" }}>
                  <input id={id} type="checkbox" checked={chosen.has(x.id)} disabled={conflict} onChange={() => toggle(x.id)} className="h-4 w-4 shrink-0 accent-[var(--accent-solid)]" />
                  <label htmlFor={id} className="min-w-0 flex-1 text-[13.5px]" style={{ color: conflict ? "var(--ink-3)" : "var(--ink)" }}>
                    {teamLabel(x)}
                    {x.track ? <span className="ml-1.5 text-[12px]" style={{ color: "var(--ink-3)" }}>· {x.track}</span> : null}
                  </label>
                  {conflict ? <Badge tone="danger">{t("jg.conflict")}</Badge> : null}
                </li>
              );
            })}
          </ul>
        </fieldset>
        <p className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>{t("jg.assign_own_team")}</p>
      </div>
    </Modal>
  );
}

/* ── Conflicts of interest ───────────────────────────────────────────── */

function ConflictsPanel({ eventId, board, reload, toast }: { eventId: number; board: Board; reload: () => Promise<void>; toast: ToastFn }) {
  const { t, lang } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [clearing, setClearing] = useState<ConflictRow | null>(null);

  const clear = async (c: ConflictRow) => {
    try {
      await judgingApi.clear(eventId, c.id);
      toast(t("jg.conflict_cleared"), "success");
      await reload();
    } catch (err) {
      toast(refusal(err, t), "error");
    }
  };

  const columns: Column<ConflictRow>[] = [
    { id: "judge", header: t("jg.col.judge"), sortable: true, value: (c) => c.judgeName, cell: (c) => <span className="font-medium" style={{ color: "var(--ink)" }}>{c.judgeName}</span> },
    { id: "team", header: t("jg.col.team_name"), sortable: true, value: (c) => c.teamName },
    { id: "reason", header: t("jg.col.reason"), value: (c) => c.reason ?? "", cell: (c) => <span style={{ color: c.reason ? "var(--ink-2)" : "var(--ink-3)" }}>{c.reason ?? "—"}</span> },
    { id: "by", header: t("jg.col.declared_by"), value: (c) => (c.byJudge ? 0 : 1), cell: (c) => <Badge tone={c.byJudge ? "info" : "neutral"}>{t(c.byJudge ? "jg.by_judge" : "jg.by_organiser")}</Badge> },
    { id: "at", header: t("jg.col.when"), sortable: true, value: (c) => c.createdAt ?? "", cell: (c) => <span className="text-[13px]" style={{ color: "var(--ink-3)" }}>{c.createdAt ? formatDate(c.createdAt, lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</span> },
    {
      id: "actions", header: "", value: () => "", align: "right",
      cell: (c) => <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} aria-label={t("jg.conflict_clear")} title={t("jg.conflict_clear")} style={{ color: "var(--danger)" }} onClick={() => setClearing(c)} />,
    },
  ];

  return (
    <div className="space-y-4 pt-5">
      <Notice tone="info">{t("jg.conflicts_help")}</Notice>
      <DataTable
        rows={board.conflicts}
        columns={columns}
        searchPlaceholder={t("jg.search_conflicts")}
        emptyTitle={t("jg.conflicts_empty")}
        emptyBody={t("jg.conflicts_empty_b")}
        pageSize={25}
        labels={tableLabels(t)}
        toolbarExtra={<Button size="sm" variant="primary" icon={<Plus size={14} />} disabled={!board.judges.length || !board.progress.teams.length} onClick={() => setAdding(true)}>{t("jg.conflict_add")}</Button>}
      />
      {adding ? (
        <ConflictModal eventId={eventId} board={board} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await reload(); }} toast={toast} />
      ) : null}
      <ConfirmDialog
        open={Boolean(clearing)}
        title={t("jg.conflict_clear_t")}
        message={clearing ? fill(t("jg.conflict_clear_b"), { judge: clearing.judgeName, team: clearing.teamName }) : ""}
        confirmLabel={t("jg.conflict_clear")}
        cancelLabel={t("jg.keep")}
        variant="danger"
        onCancel={() => setClearing(null)}
        onConfirm={() => { const c = clearing; setClearing(null); if (c) void clear(c); }}
      />
    </div>
  );
}

function ConflictModal({ eventId, board, onClose, onSaved, toast }: { eventId: number; board: Board; onClose: () => void; onSaved: () => Promise<void>; toast: ToastFn }) {
  const { t } = useTranslation();
  const [judgeId, setJudgeId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setTried(true);
    if (!judgeId || !teamId) return;
    setBusy(true);
    try {
      await judgingApi.declare(eventId, Number(judgeId), Number(teamId), reason.trim());
      toast(t("jg.conflict_saved"), "success");
      await onSaved();
    } catch (err) {
      toast(refusal(err, t), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={() => !busy && onClose()} title={t("jg.conflict_add")} description={t("jg.conflict_add_hint")}
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>{t("jg.cancel")}</Button>
          <Button size="sm" variant="primary" onClick={() => void save()} loading={busy} disabled={busy}>{t("jg.save")}</Button>
        </div>
      }>
      <div className="space-y-4">
        <Select label={t("jg.col.judge")} value={judgeId} onChange={setJudgeId} placeholder={t("jg.choose")} required
          options={board.judges.map((j) => ({ value: String(j.id), label: j.name }))} error={tried && !judgeId ? t("jg.required") : null} />
        <Select label={t("jg.col.team_name")} value={teamId} onChange={setTeamId} placeholder={t("jg.choose")} required
          options={board.progress.teams.map((x) => ({ value: String(x.id), label: teamLabel(x) }))} error={tried && !teamId ? t("jg.required") : null} />
        <TextArea label={t("jg.col.reason")} value={reason} onChange={setReason} rows={3} maxLength={300} optional={t("jg.optional")} placeholder={t("jg.reason_ph")} />
      </div>
    </Modal>
  );
}

/* ── Progress matrix ─────────────────────────────────────────────────── */

const CELL_LOOK: Record<CellState, { icon: typeof Check; color: string; bg: string }> = {
  done: { icon: CheckCircle2, color: "var(--ok)", bg: "var(--ok-weak)" },
  partial: { icon: CircleDashed, color: "var(--warn)", bg: "var(--warn-weak)" },
  todo: { icon: MinusCircle, color: "var(--ink-3)", bg: "transparent" },
  conflict: { icon: XCircle, color: "var(--danger)", bg: "var(--danger-weak)" },
  na: { icon: CircleSlash, color: "var(--line-strong)", bg: "transparent" },
  eliminated: { icon: CircleSlash, color: "var(--ink-3)", bg: "var(--tint)" },
};

function CellMark({ state, label }: { state: CellState; label: string }) {
  const look = CELL_LOOK[state];
  const Icon = look.icon;
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex h-7 w-7 items-center justify-center rounded-full" style={{ background: look.bg, color: look.color }}>
      <Icon size={16} aria-hidden="true" />
    </span>
  );
}

function ProgressPanel({ board }: { board: Board }) {
  const { t } = useTranslation();
  const { progress } = board;
  const judges = progress.judges;
  const teams = progress.teams;
  const totals = useMemo(() => {
    let done = 0;
    let assigned = 0;
    for (const j of judges) { done += j.done; assigned += j.assigned; }
    return { done, assigned, pct: completion(done, assigned) };
  }, [judges]);

  if (!judges.length || !teams.length) {
    return <div className="pt-5"><EmptyState title={t(!judges.length ? "jg.progress_no_judges" : "jg.progress_no_teams")} body={t("jg.progress_empty_b")} /></div>;
  }

  return (
    <div className="space-y-4 pt-5">
      <section className="rounded-[var(--radius)] border p-4 sm:p-5" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[16px] font-semibold" style={{ color: "var(--ink)" }}>{t("jg.progress_title")}</h2>
          <p className="text-[13px] tabular-nums" style={{ color: "var(--ink-2)" }}>{fill(t("jg.progress_total"), { done: totals.done, total: totals.assigned })}</p>
        </div>
        <Progress value={totals.pct ?? 0} tone={totals.pct === 100 ? "ok" : "brand"} className="mt-3" />
        {progress.config.blind ? <p className="mt-3 text-[12.5px]" style={{ color: "var(--ink-3)" }}>{t("jg.progress_blind")}</p> : null}
        {progress.changedCount ? (
          <div className="mt-3">
            <Notice tone="warn" icon={<RefreshCw size={15} />}>
              <span role="status">{fill(t(progress.changedCount === 1 ? "jg.changed_one" : "jg.changed_n"), { n: progress.changedCount })}</span>
            </Notice>
          </div>
        ) : null}
      </section>

      <div className="overflow-x-auto rounded-[var(--radius)] border" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
        <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
          <caption className="sr-only">{t("jg.progress_caption")}</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 border-b px-4 py-3 text-left font-medium" style={{ background: "var(--surface)", borderColor: "var(--line)", color: "var(--ink-3)" }}>{t("jg.col.team")}</th>
              {judges.map((j) => {
                const pct = completion(j.done, j.assigned);
                return (
                  <th key={j.id} scope="col" className="border-b px-2 py-3 text-center align-bottom font-medium" style={{ borderColor: "var(--line)", color: "var(--ink)" }}>
                    <span className="block max-w-[8.5rem] truncate" title={j.name}>{j.name}</span>
                    <span className="mt-0.5 block text-[11.5px] tabular-nums" style={{ color: pct === 100 ? "var(--ok)" : "var(--ink-3)" }}>{`${j.done}/${j.assigned}`}</span>
                  </th>
                );
              })}
              <th scope="col" className="border-b px-4 py-3 text-right font-medium" style={{ borderColor: "var(--line)", color: "var(--ink-3)" }}>{t("jg.col.reviews")}</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((x) => (
              <tr key={x.id}>
                <th scope="row" className="sticky left-0 z-10 max-w-[16rem] border-b px-4 py-2.5 text-left font-normal" style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
                  <span className="block truncate font-medium" style={{ color: x.eliminated ? "var(--ink-3)" : "var(--ink)" }} title={teamLabel(x)}>{x.projectName ?? x.name}</span>
                  <span className="block truncate text-[12px]" style={{ color: "var(--ink-3)" }}>{x.name}{x.track ? ` · ${x.track}` : ""}{x.eliminated ? ` · ${t("jg.cell.eliminated")}` : ""}</span>
                </th>
                {judges.map((j) => {
                  const state = progress.cells[cellKey(j.id, x.id)] ?? "na";
                  const changed = progress.changed.has(cellKey(j.id, x.id));
                  const label = fill(t("jg.cell_label"), { judge: j.name, team: x.projectName ?? x.name, state: t(`jg.cell.${state}`) });
                  return (
                    <td key={j.id} className="border-b px-2 py-2 text-center" style={{ borderColor: "var(--line)" }}>
                      <span className="relative inline-flex">
                        <CellMark state={state} label={changed ? `${label} · ${t("jg.cell.changed")}` : label} />
                        {changed ? <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2" style={{ background: "var(--warn)", ["--tw-ring-color" as string]: "var(--surface)" }} /> : null}
                      </span>
                    </td>
                  );
                })}
                <td className="border-b px-4 py-2.5 text-right tabular-nums" style={{ borderColor: "var(--line)", color: x.assigned && x.done === x.assigned ? "var(--ok)" : "var(--ink-2)" }}>
                  {x.eliminated ? "—" : `${x.done}/${x.assigned}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-2" aria-label={t("jg.legend")}>
        {CELL_STATES.map((st) => (
          <li key={st} className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--ink-2)" }}>
            <CellMark state={st} label={t(`jg.cell.${st}`)} />
            <span aria-hidden="true">{t(`jg.cell.${st}`)}</span>
          </li>
        ))}
        {progress.changedCount ? (
          <li className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--ink-2)" }}>
            <span aria-hidden="true" className="inline-flex h-7 w-7 items-center justify-center"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--warn)" }} /></span>
            <span>{t("jg.cell.changed")}</span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
