"use client";

/**
 * The judge's portal: the projects this judge reviews (without team names
 * when judging is blind), one review at a time — every criterion and the
 * written feedback, saved together — the conflict-of-interest declaration
 * when the organiser asks for one, and conflicts with single teams.
 *
 * What a judge may see and score is the API's decision (assignment mode,
 * their own team, declared conflicts, the judging window); this page shows
 * it and explains every refusal. Drafts are kept per project, so moving
 * between projects loses nothing; leaving the page with unsaved scores asks
 * first.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle, CheckCircle2, CircleDashed, Clock, ExternalLink, EyeOff, FileText, GitBranch, Link2, Lock,
  MinusCircle, Presentation, RefreshCw, Search, ShieldCheck, Video,
} from "lucide-react";
import { BrandLoader } from "@/components/BrandLoader";
import { MyCertificates } from "@/components/wrapup/MyCertificates";
import { CalendarFeedCard } from "@/components/calendar/CalendarFeedCard";
import { LoadFailure } from "@/components/LoadFailure";
import { Badge, Button, Progress, type Tone } from "@/components/ds/primitives";
import { Modal } from "@/components/ds/overlays";
import { Notice, TextArea } from "@/components/builder/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { ApiError, apiGet } from "@/lib/api";
import { fetchAnnouncementsForEvents, forStaff, safeFormatAnnouncementTime, type NormalizedAnnouncement } from "@/lib/announcements";
import { fill } from "@/lib/i18n/fill";
import { formatDate } from "@/lib/i18n/dates";
import { resolveJudgeEventIds } from "@/lib/resolveEventId";
import { myEventsAs } from "@/lib/workspaces";
import {
  REVIEW_STATES, canScore, errorKey, judgingApi, judgingError, parseScore, reviewBody, teamTitle, weightedPercent,
  type JudgeTeam, type JudgingCriterion, type MyJudging, type ReviewState, type WindowState,
} from "@/lib/judging";

interface JudgeEvent { id: number; name: string | null }

/** The events this person judges, the one to work in first. */
async function judgeEvents(): Promise<JudgeEvent[]> {
  try {
    const mine = await myEventsAs("judge");
    if (mine.length) return mine.map((e) => ({ id: e.id, name: e.name || null }));
  } catch {
    /* fall back below */
  }
  const ids = await resolveJudgeEventIds().catch(() => [] as number[]);
  return ids.map((id) => ({ id, name: null }));
}

export default function JudgePortalPage() {
  return (
    <Suspense fallback={<BrandLoader message="…" fullMinHeight />}>
      <JudgePortal />
    </Suspense>
  );
}

function JudgePortal() {
  const params = useSearchParams();
  const { t } = useTranslation();
  const { toast } = useToast();
  const fromQuery = Number(params.get("eventId")) || null;
  const [events, setEvents] = useState<JudgeEvent[] | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    judgeEvents().then((list) => {
      if (cancelled) return;
      if (fromQuery != null && list.length && !list.some((e) => e.id === fromQuery)) toast(t("jp.query_event_redirect"), "info");
      setEvents(list);
    });
    return () => { cancelled = true; };
  }, [fromQuery, toast, t]);

  if (events == null) return <BrandLoader message={t("Loading")} fullMinHeight />;
  const eventId = chosen ?? (fromQuery != null && events.some((e) => e.id === fromQuery) ? fromQuery : events[0]?.id ?? null);
  if (eventId == null) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 lg:max-w-6xl">
        <PortalHeading t={t} />
        <Notice tone="info" icon={<Lock size={15} />}>{t("jp.no_event")}</Notice>
      </div>
    );
  }
  const switchTo = (id: number) => {
    setChosen(id);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("eventId", String(id));
      window.history.replaceState(window.history.state, "", url.toString());
    } catch { /* the address is a convenience */ }
  };
  return <JudgeBoard key={eventId} eventId={eventId} events={events} onSwitch={switchTo} />;
}

function PortalHeading({ t, eventName }: { t: (k: string) => string; eventName?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-[12px] font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--accent)" }}>{t("jp.eyebrow")}</p>
      <h1 className="mt-1 break-words text-[26px] font-bold tracking-[-0.02em] sm:text-[28px]" style={{ color: "var(--ink)" }}>{eventName || t("jp.title")}</h1>
      <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>{t("jp.subtitle")}</p>
    </div>
  );
}

/* ── One event ───────────────────────────────────────────────────────── */

type Draft = { scores: Record<number, string>; feedback: string };
type Filter = "all" | ReviewState;

const STATE_TONE: Record<ReviewState, Tone> = { todo: "neutral", partial: "warn", done: "ok" };
const STATE_ICON: Record<ReviewState, typeof CheckCircle2> = { todo: MinusCircle, partial: CircleDashed, done: CheckCircle2 };

const serverDraft = (team: JudgeTeam, criteria: JudgingCriterion[]): Draft => ({
  scores: Object.fromEntries(criteria.map((c) => [c.id, team.scores[c.id] != null ? String(team.scores[c.id]) : ""])),
  feedback: team.feedback ?? "",
});
const sameDraft = (a: Draft, b: Draft, criteria: JudgingCriterion[]) =>
  a.feedback.trim() === b.feedback.trim() && criteria.every((c) => (a.scores[c.id] ?? "").trim() === (b.scores[c.id] ?? "").trim());

function JudgeBoard({ eventId, events, onSwitch }: { eventId: number; events: JudgeEvent[]; onSwitch: (id: number) => void }) {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const [data, setData] = useState<MyJudging | null>(null);
  const [failure, setFailure] = useState<"failed" | "not_judge" | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [errors, setErrors] = useState<Record<number, Record<number, string>>>({});
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [declaring, setDeclaring] = useState<JudgeTeam | null>(null);
  const [withdrawing, setWithdrawing] = useState<number | null>(null);
  const [announcements, setAnnouncements] = useState<NormalizedAnnouncement[]>([]);
  const [me, setMe] = useState<{ name: string; email: string } | null>(null);

  const apply = useCallback((next: MyJudging) => {
    setData(next);
    setFailure(null);
  }, []);
  const fail = useCallback((err: unknown) => {
    setFailure(err instanceof ApiError && err.status === 403 ? "not_judge" : "failed");
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await judgingApi.me(eventId));
    } catch (err) {
      fail(err);
    }
  }, [eventId, apply, fail]);

  useEffect(() => {
    let cancelled = false;
    judgingApi.me(eventId).then((d) => { if (!cancelled) apply(d); }).catch((err) => { if (!cancelled) fail(err); });
    // This event's posts for its judges and staff only: not other events', not the participants' reminders.
    fetchAnnouncementsForEvents([eventId]).then((a) => { if (!cancelled) setAnnouncements(forStaff(a, "judge")); }).catch(() => undefined);
    apiGet<Record<string, unknown>>("/api/auth/me").then((u) => {
      if (cancelled || !u) return;
      setMe({ name: String(u.full_name ?? u.name ?? "").trim(), email: String(u.email ?? "").trim() });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [eventId, apply, fail]);

  // The organiser may reorder presentations or close judging: look again every minute.
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const dirtyIds = useMemo(() => {
    if (!data) return new Set<number>();
    return new Set(data.teams.filter((tm) => drafts[tm.submissionId] && !sameDraft(drafts[tm.submissionId], serverDraft(tm, data.criteria), data.criteria)).map((tm) => tm.submissionId));
  }, [data, drafts]);

  // Leaving with unsaved scores asks first.
  useEffect(() => {
    if (!dirtyIds.size) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyIds]);

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 lg:max-w-6xl">
        <PortalHeading t={t} />
        {failure === "not_judge" ? <Notice tone="info" icon={<Lock size={15} />}>{t("jp.not_judge")}</Notice> : null}
        {failure === "failed" ? <LoadFailure message={t("jp.load_failed")} onRetry={() => void refresh()} /> : null}
        {!failure ? <BrandLoader message={t("Loading")} /> : null}
      </div>
    );
  }

  const can = canScore(data);
  const team = data.teams.find((x) => x.submissionId === selected)
    ?? data.teams.find((x) => x.state !== "done" || x.changedSinceReview) ?? data.teams[0] ?? null;
  const counts = { all: data.teams.length, todo: 0, partial: 0, done: 0 } as Record<Filter, number>;
  for (const x of data.teams) counts[x.state] += 1;
  const q = query.trim().toLowerCase();
  const shown = data.teams.filter((x) => (filter === "all" || x.state === filter)
    && (!q || `#${x.number} ${x.projectName ?? ""} ${x.teamName ?? ""} ${x.track ?? ""}`.toLowerCase().includes(q)));
  const pct = data.progress.total ? Math.round((data.progress.done / data.progress.total) * 100) : 0;
  const draft = team ? drafts[team.submissionId] ?? serverDraft(team, data.criteria) : null;

  const select = (sid: number) => {
    setSelected(sid);
    setProblem(null);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      window.setTimeout(() => document.getElementById("scores")?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
    }
  };

  const edit = (patch: Partial<Draft>) => {
    if (!team || !draft) return;
    setDrafts((prev) => ({ ...prev, [team.submissionId]: { ...draft, ...patch, scores: { ...draft.scores, ...(patch.scores || {}) } } }));
    if (patch.scores) {
      setErrors((prev) => {
        const mine = { ...(prev[team.submissionId] || {}) };
        for (const k of Object.keys(patch.scores || {})) delete mine[Number(k)];
        return { ...prev, [team.submissionId]: mine };
      });
    }
  };

  const save = async (andNext: boolean) => {
    if (!team || !draft) return;
    const body = reviewBody(team.submissionId, data.criteria, draft.scores, draft.feedback);
    // A saved score can be changed but not taken back: the API keeps it.
    const cleared = data.criteria.filter((c) => team.scores[c.id] != null && !(draft.scores[c.id] ?? "").trim()).map((c) => c.id);
    if ("invalid" in body || cleared.length) {
      const bad = "invalid" in body ? body.invalid : [];
      setErrors((prev) => ({
        ...prev,
        [team.submissionId]: { ...Object.fromEntries(cleared.map((id) => [id, "CLEARED"])), ...Object.fromEntries(bad.map((id) => [id, "SCORE_OUT_OF_RANGE"])) },
      }));
      setProblem(t("jp.fix_scores"));
      return;
    }
    if (!body.scores.length && !body.feedback.trim() && !team.feedback) {
      setProblem(t("jp.nothing_to_save"));
      return;
    }
    setSaving(true);
    setProblem(null);
    try {
      await judgingApi.saveReview(eventId, body);
      const next = await judgingApi.me(eventId);
      apply(next);
      setDrafts((prev) => { const copy = { ...prev }; delete copy[team.submissionId]; return copy; });
      setErrors((prev) => ({ ...prev, [team.submissionId]: {} }));
      toast(t("jp.saved"), "success");
      if (andNext) {
        const order = next.teams;
        const at = order.findIndex((x) => x.submissionId === team.submissionId);
        const after = [...order.slice(at + 1), ...order.slice(0, Math.max(0, at))].find((x) => x.state !== "done" || x.changedSinceReview);
        if (after) select(after.submissionId);
      }
    } catch (err) {
      const why = judgingError(err);
      if (Object.keys(why.byCriterion).length) setErrors((prev) => ({ ...prev, [team.submissionId]: why.byCriterion }));
      setProblem(t(errorKey("jp.err.", err, "jp.save_failed")));
      // A closed window or a changed assignment shows itself after a fresh look.
      if (why.code && why.code !== "VALIDATION_ERROR") void refresh();
    } finally {
      setSaving(false);
    }
  };

  const confirmCoi = async () => {
    try {
      await judgingApi.confirmCoi(eventId);
      toast(t("jp.coi_done"), "success");
      await refresh();
    } catch (err) {
      toast(t(errorKey("jp.err.", err, "jp.failed")), "error");
    }
  };

  const withdraw = async (teamId: number) => {
    try {
      await judgingApi.clearMine(eventId, teamId);
      toast(t("jp.conflict_withdrawn"), "success");
      await refresh();
    } catch (err) {
      toast(t(errorKey("jp.err.", err, "jp.failed")), "error");
    }
  };

  const otherEvents = events.filter((e) => e.id !== eventId);

  return (
    <div className="mx-auto min-w-0 max-w-3xl space-y-5 pb-4 lg:max-w-6xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <PortalHeading t={t} eventName={data.event.name} />
        <div className="flex flex-wrap items-center gap-2">
          {otherEvents.length ? (
            <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--ink-2)" }}>
              <span>{t("jp.event")}</span>
              <select value={eventId} onChange={(e) => onSwitch(Number(e.target.value))}
                className="max-w-[14rem] rounded-[8px] border px-2 py-1.5 text-[13px]" style={{ borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink)" }}>
                {events.map((e) => <option key={e.id} value={e.id}>{e.id === eventId ? data.event.name : e.name ?? `#${e.id}`}</option>)}
              </select>
            </label>
          ) : null}
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void refresh()}>{t("jp.refresh")}</Button>
        </div>
      </div>

      {/* Progress */}
      <section className="rounded-[var(--radius)] border p-4 sm:p-5" style={{ borderColor: "var(--line)", background: "var(--surface)" }} aria-label={t("jp.progress")}>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {[
            { label: t("jp.stat.assigned"), value: data.progress.total },
            { label: t("jp.stat.done"), value: data.progress.done },
            { label: t("jp.stat.left"), value: Math.max(0, data.progress.total - data.progress.done) },
          ].map((s) => (
            <div key={s.label} className="min-w-0 rounded-[12px] px-2 py-2.5 text-center sm:px-3" style={{ background: "var(--surface-sunken)" }}>
              <p className="truncate text-[11px] font-medium uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{s.label}</p>
              <p className="mt-1 text-[22px] font-bold tabular-nums" style={{ color: "var(--ink)" }}>{s.value}</p>
            </div>
          ))}
        </div>
        <Progress value={pct} tone={pct === 100 ? "ok" : "brand"} className="mt-4" label={t("jp.progress")} />
        {data.progress.partial ? <p className="mt-2 text-[12.5px]" style={{ color: "var(--ink-3)" }}>{fill(t("jp.partial_n"), { n: data.progress.partial })}</p> : null}
        {data.progress.changed ? (
          <p className="mt-2 flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color: "var(--warn)" }}>
            <RefreshCw size={13} aria-hidden="true" />{fill(t(data.progress.changed === 1 ? "jp.changed_one" : "jp.changed_n"), { n: data.progress.changed })}
          </p>
        ) : null}
      </section>

      <WindowBanner state={data.window.state} start={data.window.start} end={data.window.end} atDeadline={data.window.startsAtDeadline} />
      {data.config.blind ? <Notice tone="info" icon={<EyeOff size={15} />}>{t("jp.blind")}</Notice> : null}
      {can.reason === "coi" ? <CoiCard onConfirm={confirmCoi} /> : null}
      {data.config.coiRequired && data.judge.coiConfirmedAt ? (
        <p className="flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
          <ShieldCheck size={14} aria-hidden="true" style={{ color: "var(--ok)" }} />
          {fill(t("jp.coi_confirmed_on"), { at: formatDate(data.judge.coiConfirmedAt, lang, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) })}
        </p>
      ) : null}
      {!data.criteria.length ? <Notice tone="warn">{t("jp.no_criteria")}</Notice> : null}

      {data.teams.length === 0 ? (
        <section id="queue" className="rounded-[var(--radius)] border px-5 py-10 text-center" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
          <p className="font-semibold" style={{ color: "var(--ink)" }}>{t("jp.empty")}</p>
          <p className="mx-auto mt-1.5 max-w-md text-[13.5px]" style={{ color: "var(--ink-2)" }}>{t(data.config.assignment === "per_team" ? "jp.empty_per_team" : "jp.empty_b")}</p>
        </section>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          {/* The list */}
          <section id="queue" aria-label={t("jp.queue")} className="min-w-0 space-y-3 rounded-[var(--radius)] border p-3 sm:p-4" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("jp.filter")}>
              {(["all", ...REVIEW_STATES] as Filter[]).map((f) => (
                <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
                  className="min-h-9 rounded-full border px-3 text-[12.5px] font-medium transition-colors"
                  style={{ borderColor: filter === f ? "var(--accent-solid)" : "var(--line)", background: filter === f ? "var(--accent-weak)" : "transparent", color: filter === f ? "var(--ink)" : "var(--ink-2)" }}>
                  {t(`jp.filter.${f}`)} <span className="tabular-nums" style={{ color: "var(--ink-3)" }}>{counts[f]}</span>
                </button>
              ))}
            </div>
            {data.teams.length > 6 ? (
              <label className="flex items-center gap-2 rounded-[10px] border px-3" style={{ borderColor: "var(--line-strong)" }}>
                <Search size={14} aria-hidden="true" style={{ color: "var(--ink-3)" }} />
                <span className="sr-only">{t("jp.search")}</span>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("jp.search")} className="min-w-0 flex-1 bg-transparent py-2 text-[13.5px] outline-none" style={{ color: "var(--ink)" }} />
              </label>
            ) : null}
            <ul className="space-y-1.5">
              {shown.map((x) => {
                const on = team?.submissionId === x.submissionId;
                const Icon = STATE_ICON[x.state];
                return (
                  <li key={x.submissionId}>
                    <button type="button" onClick={() => select(x.submissionId)} aria-current={on ? "true" : undefined}
                      className="flex w-full items-start gap-3 rounded-[12px] border px-3 py-2.5 text-left transition-colors"
                      style={{ borderColor: on ? "var(--accent-solid)" : "var(--line)", background: on ? "var(--accent-weak)" : "var(--surface)" }}>
                      <Icon size={17} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: x.state === "done" ? "var(--ok)" : x.state === "partial" ? "var(--warn)" : "var(--ink-3)" }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium" style={{ color: "var(--ink)" }}>
                          <span className="tabular-nums" style={{ color: "var(--ink-3)" }}>#{x.number}</span> {x.projectName ?? t("jp.untitled")}
                        </span>
                        <span className="block truncate text-[12px]" style={{ color: "var(--ink-3)" }}>
                          {[x.teamName, x.track, x.presentationOrder ? fill(t("jp.pitch_n"), { n: x.presentationOrder }) : null].filter(Boolean).join(" · ") || t(`jp.state.${x.state}`)}
                        </span>
                      </span>
                      {dirtyIds.has(x.submissionId) ? <Badge tone="warn">{t("jp.unsaved")}</Badge>
                        : x.changedSinceReview ? <Badge tone="warn">{t("jp.changed_badge")}</Badge>
                          : <span className="sr-only">{t(`jp.state.${x.state}`)}</span>}
                    </button>
                  </li>
                );
              })}
              {!shown.length ? <li className="px-2 py-6 text-center text-[13px]" style={{ color: "var(--ink-3)" }}>{t("jp.no_match")}</li> : null}
            </ul>
          </section>

          {/* The review */}
          <section id="scores" aria-label={t("jp.review")} className="min-w-0 scroll-mt-20">
            {team && draft ? (
              <ReviewPanel
                key={team.submissionId}
                team={team}
                criteria={data.criteria}
                blind={data.config.blind}
                draft={draft}
                errors={errors[team.submissionId] || {}}
                editable={can.ok}
                dirty={dirtyIds.has(team.submissionId)}
                saving={saving}
                problem={problem}
                onEdit={edit}
                onSave={save}
                onDeclare={() => setDeclaring(team)}
              />
            ) : null}
          </section>
        </div>
      )}

      {data.conflicts.length ? (
        <section aria-label={t("jp.conflicts")} className="space-y-2 rounded-[var(--radius)] border p-4 sm:p-5" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
          <h2 className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>{t("jp.conflicts")}</h2>
          <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>{t("jp.conflicts_help")}</p>
          <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
            {data.conflicts.map((c) => (
              <li key={c.teamId} className="flex flex-wrap items-center justify-between gap-2 py-2.5" style={{ borderColor: "var(--line)" }}>
                <span className="min-w-0">
                  <span className="block truncate text-[14px]" style={{ color: "var(--ink)" }}>{teamTitle(c, t("jp.untitled"))}</span>
                  {c.reason ? <span className="block truncate text-[12.5px]" style={{ color: "var(--ink-3)" }}>{c.reason}</span> : null}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setWithdrawing(c.teamId)}>{t("jp.conflict_withdraw")}</Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <MyCertificates eventId={eventId} />

      <section id="announcements" aria-label={t("jp.announcements")} className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0 rounded-[var(--radius)] border p-4 sm:p-5" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
          <h2 className="mb-3 text-[15px] font-semibold" style={{ color: "var(--ink)" }}>{t("jp.announcements")}</h2>
          {announcements.length === 0 ? (
            <p className="text-[13.5px]" style={{ color: "var(--ink-3)" }}>{t("jp.no_announcements")}</p>
          ) : (
            <ul className="space-y-3">
              {announcements.slice(0, 8).map((a) => (
                <li key={a.id} className="rounded-[12px] border px-4 py-3" style={{ borderColor: "var(--line)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 break-words font-medium" style={{ color: "var(--ink)" }}>{a.title}</p>
                    <span className="shrink-0 text-[11.5px]" style={{ color: "var(--ink-3)" }}>{safeFormatAnnouncementTime(a.created_at, lang)}</span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{a.content}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div id="help" className="min-w-0 space-y-3 rounded-[var(--radius)] border p-4 text-[13.5px] leading-relaxed sm:p-5" style={{ borderColor: "var(--line)", background: "var(--surface)", color: "var(--ink-2)" }}>
          <h2 className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>{t("jp.how")}</h2>
          {me && (me.name || me.email) ? (
            <div className="rounded-[12px] px-3.5 py-2.5" style={{ background: "var(--surface-sunken)" }}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--ink-3)" }}>{t("jp.signed_in_as")}</p>
              <p className="mt-1 font-medium" style={{ color: "var(--ink)" }}>{me.name || me.email}</p>
              {me.name && me.email ? <p className="break-all text-[12.5px]" style={{ color: "var(--ink-3)" }}>{me.email}</p> : null}
            </div>
          ) : null}
          <p>{t("jp.how_1")}</p>
          <p>{t("jp.how_2")}</p>
          <p>{t("jp.how_3")}</p>
        </div>
      </section>

      <CalendarFeedCard compact />

      {declaring ? (
        <DeclareModal
          team={declaring}
          onClose={() => setDeclaring(null)}
          onDone={async (reason) => {
            try {
              await judgingApi.declareMine(eventId, declaring.teamId, reason);
              toast(t("jp.conflict_saved"), "success");
              setDeclaring(null);
              setSelected(null);
              await refresh();
            } catch (err) {
              toast(t(errorKey("jp.err.", err, "jp.failed")), "error");
            }
          }}
        />
      ) : null}

      <ConfirmDialog
        open={withdrawing != null}
        title={t("jp.conflict_withdraw_t")}
        message={t("jp.conflict_withdraw_b")}
        confirmLabel={t("jp.conflict_withdraw")}
        cancelLabel={t("jp.cancel")}
        onCancel={() => setWithdrawing(null)}
        onConfirm={() => { const id = withdrawing; setWithdrawing(null); if (id != null) void withdraw(id); }}
      />
    </div>
  );
}

/* ── The judging window and the declaration ──────────────────────────── */

function WindowBanner({ state, start, end, atDeadline }: { state: WindowState; start: string | null; end: string | null; atDeadline: boolean }) {
  const { t, lang } = useTranslation();
  const at = (v: string | null) => (v ? formatDate(v, lang, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "");
  if (state === "open") {
    return end ? <p className="flex items-center gap-1.5 text-[13px]" style={{ color: "var(--ink-2)" }}><Clock size={14} aria-hidden="true" />{fill(t("jp.window_closes"), { at: at(end) })}</p> : null;
  }
  const text = state === "not_open" && start && atDeadline ? fill(t("jp.window.not_open_deadline"), { at: at(start) })
    : state === "not_open" && start ? fill(t("jp.window.not_open_at"), { at: at(start) })
    : state === "closed" && end ? fill(t("jp.window.closed_at"), { at: at(end) })
    : t(`jp.window.${state}`);
  return <Notice tone={state === "not_open" ? "info" : "warn"} icon={<Lock size={15} />}><span role="status">{text}</span></Notice>;
}

function CoiCard({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const { t } = useTranslation();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <section aria-label={t("jp.coi_title")} className="space-y-3 rounded-[var(--radius)] border p-4 sm:p-5" style={{ borderColor: "var(--accent-solid)", background: "var(--surface)" }}>
      <h2 className="flex items-center gap-2 text-[16px] font-semibold" style={{ color: "var(--ink)" }}><ShieldCheck size={18} aria-hidden="true" style={{ color: "var(--accent)" }} />{t("jp.coi_title")}</h2>
      <p className="text-[13.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{t("jp.coi_body")}</p>
      <ul className="list-disc space-y-1 pl-5 text-[13.5px]" style={{ color: "var(--ink-2)" }}>
        <li>{t("jp.coi_point_1")}</li>
        <li>{t("jp.coi_point_2")}</li>
        <li>{t("jp.coi_point_3")}</li>
      </ul>
      <label className="flex items-start gap-2.5 text-[13.5px]" style={{ color: "var(--ink)" }}>
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent-solid)]" />
        <span>{t("jp.coi_agree")}</span>
      </label>
      <div className="flex justify-end">
        <Button variant="primary" size="sm" disabled={!agreed || busy} loading={busy}
          onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>
          {t("jp.coi_confirm")}
        </Button>
      </div>
    </section>
  );
}

/* ── One review ──────────────────────────────────────────────────────── */

function ReviewPanel({ team, criteria, blind, draft, errors, editable, dirty, saving, problem, onEdit, onSave, onDeclare }: {
  team: JudgeTeam;
  criteria: JudgingCriterion[];
  blind: boolean;
  draft: Draft;
  errors: Record<number, string>;
  editable: boolean;
  dirty: boolean;
  saving: boolean;
  problem: string | null;
  onEdit: (patch: Partial<Draft>) => void;
  onSave: (andNext: boolean) => Promise<void>;
  onDeclare: () => void;
}) {
  const { t, lang } = useTranslation();
  const parsed = Object.fromEntries(criteria.map((c) => {
    const v = parseScore(draft.scores[c.id] ?? "", c.maxScore);
    return [c.id, typeof v === "number" ? v : null];
  })) as Record<number, number | null>;
  const total = weightedPercent(criteria, parsed);
  const filled = criteria.filter((c) => parsed[c.id] != null).length;
  const links = [
    { href: team.repoLink, label: t("jp.link.repo"), icon: GitBranch },
    { href: team.demoLink, label: t("jp.link.demo"), icon: Link2 },
    { href: team.slidesLink, label: t("jp.link.slides"), icon: Presentation },
    { href: team.videoLink, label: t("jp.link.video"), icon: Video },
  ].filter((l): l is { href: string; label: string; icon: typeof Link2 } => Boolean(l.href));

  return (
    <div className="space-y-4 rounded-[var(--radius)] border p-4 sm:p-5" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATE_TONE[team.state]}>{t(`jp.state.${team.state}`)}</Badge>
          {team.track ? <Badge tone="neutral">{team.track}</Badge> : null}
          {team.presentationOrder ? <Badge tone="info">{fill(t("jp.pitch_n"), { n: team.presentationOrder })}{team.presentationAt ? ` · ${formatDate(team.presentationAt, lang, { hour: "2-digit", minute: "2-digit" })}` : ""}</Badge> : null}
          {dirty ? <Badge tone="warn">{t("jp.unsaved")}</Badge> : null}
          {team.changedSinceReview ? <Badge tone="warn">{t("jp.changed_badge")}</Badge> : null}
        </div>
        <h2 className="break-words text-[20px] font-semibold tracking-[-0.01em]" style={{ color: "var(--ink)" }}>
          <span className="tabular-nums" style={{ color: "var(--ink-3)" }}>#{team.number}</span> {team.projectName ?? t("jp.untitled")}
        </h2>
        <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>{blind ? t("jp.team_hidden") : team.teamName ?? "—"}</p>
      </header>

      {team.changedSinceReview ? (
        <Notice tone="warn" icon={<RefreshCw size={15} />}>
          <span role="status">
            <span className="block font-medium">{t("jp.changed_title")}</span>
            <span className="block">{team.changedAt
              ? fill(t("jp.changed_body_at"), { at: formatDate(team.changedAt, lang, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) })
              : t("jp.changed_body")}</span>
          </span>
        </Notice>
      ) : null}

      {team.description ? <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed" style={{ color: "var(--ink)" }}>{team.description}</p> : null}
      {team.techStack ? <p className="text-[13px]" style={{ color: "var(--ink-2)" }}><span className="font-medium" style={{ color: "var(--ink)" }}>{t("jp.built_with")}</span> {team.techStack}</p> : null}

      {links.length || team.files.length ? (
        <div className="flex flex-wrap gap-2">
          {links.map((l) => {
            const Icon = l.icon;
            return (
              <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 text-[13px] font-medium"
                style={{ borderColor: "var(--line-strong)", color: "var(--ink)" }}>
                <Icon size={14} aria-hidden="true" />{l.label}<ExternalLink size={12} aria-hidden="true" style={{ color: "var(--ink-3)" }} />
                <span className="sr-only">{t("jp.opens_new_tab")}</span>
              </a>
            );
          })}
          {team.files.map((f) => (
            <a key={f.id} href={`/api/files/${f.id}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 text-[13px]"
              style={{ borderColor: "var(--line)", color: "var(--ink-2)" }}>
              <FileText size={14} aria-hidden="true" /><span className="truncate">{f.filename}</span>
            </a>
          ))}
        </div>
      ) : null}

      <div className="space-y-4 border-t pt-4" style={{ borderColor: "var(--line)" }}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>{t("jp.scores")}</h3>
          <p className="text-[13px] tabular-nums" style={{ color: "var(--ink-2)" }}>
            {total != null ? fill(t("jp.total"), { n: total }) : fill(t("jp.filled"), { n: filled, total: criteria.length })}
          </p>
        </div>
        {criteria.map((c) => (
          <CriterionInput key={c.id} criterion={c} value={draft.scores[c.id] ?? ""} error={errors[c.id] ?? null} disabled={!editable || saving}
            onChange={(v) => onEdit({ scores: { [c.id]: v } })} />
        ))}
        <TextArea label={t("jp.feedback")} value={draft.feedback} onChange={(v) => onEdit({ feedback: v })} rows={4} maxLength={4000}
          help={t("jp.feedback_help")} placeholder={t("jp.feedback_ph")} />
      </div>

      {problem ? <Notice tone="danger" icon={<AlertTriangle size={15} />}><span role="alert">{problem}</span></Notice> : null}

      <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--line)" }}>
        <Button size="sm" variant="ghost" onClick={onDeclare} disabled={saving}>{t("jp.declare")}</Button>
        <div className="flex flex-col gap-2 sm:flex-row">
          {/* A changed project's review can be confirmed as it is: saving again clears the marker. */}
          <Button size="md" variant="secondary" onClick={() => void onSave(false)} disabled={!editable || saving || (!dirty && !team.changedSinceReview)}>
            {!dirty && team.changedSinceReview ? t("jp.recheck_confirm") : t("jp.save")}
          </Button>
          <Button size="md" variant="primary" onClick={() => void onSave(true)} loading={saving} disabled={!editable || saving || (!dirty && !team.changedSinceReview)}>{t("jp.save_next")}</Button>
        </div>
      </div>
      {!editable ? <p className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>{t("jp.read_only")}</p> : null}
    </div>
  );
}

function CriterionInput({ criterion: c, value, error, disabled, onChange }: {
  criterion: JudgingCriterion;
  value: string;
  error: string | null;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  const id = `crit-${c.id}`;
  const parsed = parseScore(value, c.maxScore);
  // While a number is half typed ("7,") the slider stays where the digits put it.
  const loose = Number(String(value).replace(",", ".").replace(/\.$/, ""));
  const sliderValue = typeof parsed === "number" ? parsed : Number.isFinite(loose) ? Math.min(c.maxScore, Math.max(0, loose)) : 0;
  const step = c.maxScore <= 10 ? 0.5 : 1;
  const errText = error
    ? error === "SCORE_OUT_OF_RANGE" ? fill(t("jp.range"), { max: c.maxScore })
      : error === "CLEARED" ? t("jp.cleared")
        : t(errorKeyForCode(error))
    : null;
  const describedBy = [c.description ? `${id}-d` : null, errText ? `${id}-e` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <label htmlFor={id} className="text-[14px] font-medium" style={{ color: "var(--ink)" }}>{c.name}</label>
        <span className="text-[12px] tabular-nums" style={{ color: "var(--ink-3)" }}>{fill(t("jp.weight_max"), { w: c.weight, max: c.maxScore })}</span>
      </div>
      {c.description ? <p id={`${id}-d`} className="mt-0.5 text-[12.5px] leading-relaxed" style={{ color: "var(--ink-3)" }}>{c.description}</p> : null}
      <div className="mt-2 flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={c.maxScore}
          step={step}
          value={sliderValue}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-label={fill(t("jp.slider"), { name: c.name })}
          aria-valuetext={typeof parsed === "number" ? `${parsed} / ${c.maxScore}` : t("jp.not_scored")}
          className="h-2 min-w-0 flex-1 cursor-pointer accent-[var(--accent-solid)] disabled:cursor-not-allowed disabled:opacity-50"
        />
        <input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, "").slice(0, 6))}
          disabled={disabled}
          placeholder="—"
          aria-invalid={errText ? true : undefined}
          aria-describedby={describedBy}
          className="w-[4.5rem] rounded-[10px] border px-2 py-2 text-center text-[15px] tabular-nums outline-none focus:ring-2 disabled:opacity-60"
          style={{ background: "var(--surface)", color: "var(--ink)", borderColor: errText ? "var(--danger)" : "var(--line-strong)", ["--tw-ring-color" as string]: "var(--accent-weak)" }}
        />
        <span className="w-10 text-[13px] tabular-nums" style={{ color: "var(--ink-3)" }} aria-hidden="true">/ {c.maxScore}</span>
      </div>
      {errText ? <p id={`${id}-e`} role="alert" className="mt-1.5 text-[12.5px]" style={{ color: "var(--danger)" }}>{errText}</p> : null}
    </div>
  );
}

/** A criterion-level refusal worded by its code. */
function errorKeyForCode(code: string): string {
  return `jp.err.${code === "UNKNOWN_CRITERION" ? "UNKNOWN_CRITERION" : "SCORE_OUT_OF_RANGE"}`;
}

function DeclareModal({ team, onClose, onDone }: { team: JudgeTeam; onClose: () => void; onDone: (reason: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={() => !busy && onClose()} title={t("jp.declare_t")} description={fill(t("jp.declare_b"), { n: team.number })}
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>{t("jp.cancel")}</Button>
          <Button size="sm" variant="danger" loading={busy} disabled={busy}
            onClick={async () => { setBusy(true); try { await onDone(reason.trim()); } finally { setBusy(false); } }}>
            {t("jp.declare_confirm")}
          </Button>
        </div>
      }>
      <div className="space-y-3">
        <p className="text-[13.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{t("jp.declare_help")}</p>
        <TextArea label={t("jp.declare_reason")} value={reason} onChange={setReason} rows={3} maxLength={300} optional={t("jp.optional")} placeholder={t("jp.declare_reason_ph")} />
      </div>
    </Modal>
  );
}
