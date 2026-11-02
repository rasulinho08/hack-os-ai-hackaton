"use client";

/**
 * The big screen: results in type large enough for the back of a hall.
 *
 * It projects what the organiser published, no more: the full leaderboard
 * when that is what they published (scores only if they published scores),
 * or the winners when participants see only their own place and the
 * winners. Before publication it shows a holding screen; the live ranking
 * appears only when the organiser turns on the live preview, and then it is
 * marked on screen as not the result. The rule is bigScreenView in
 * lib/results; nothing is scored in the browser.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Clock3, Eye, Maximize2, Medal, Minimize2, RefreshCw, Trophy } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Skeleton, buttonLook } from "@/components/ds/primitives";
import { Notice, Select, Toggle } from "@/components/builder/ui";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { ApiError, apiGet } from "@/lib/api";
import { fill } from "@/lib/i18n/fill";
import { formatDate } from "@/lib/i18n/dates";
import {
  bigScreenView, formatScore, medal, normalizeOrganiserResults, ordinal,
  type OrganiserResults, type PrizeResult, type RankedTeam,
} from "@/lib/results";

const REFRESH_MS = 20_000;
const TOP_CHOICES = ["5", "10", "20", "all"] as const;
type Top = (typeof TOP_CHOICES)[number];
const MEDAL_COLOUR = { gold: "#C9A227", silver: "#9AA4AE", bronze: "#B87333" } as const;

type Load = "loading" | "ready" | "failed" | "locked";

export default function LeaderboardPage() {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const { activeEventId, events, loading: eventLoading } = useActiveEvent();
  const [state, setState] = useState<Load>("loading");
  const [results, setResults] = useState<OrganiserResults | null>(null);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [top, setTop] = useState<Top>("10");
  const [hideScores, setHideScores] = useState(false);
  // Off every time the page opens: projecting the live ranking is a choice.
  const [livePreview, setLivePreview] = useState(false);
  const [full, setFull] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (activeEventId == null) return;
    try {
      setResults(normalizeOrganiserResults(await apiGet<unknown>(`/api/events/${activeEventId}/results`)));
      setUpdated(new Date());
      setState("ready");
    } catch (err) {
      if (err instanceof ApiError && err.code === "MODULE_DISABLED") setState("locked");
      else setState((s) => (s === "ready" ? s : "failed"));
    }
  }, [activeEventId]);

  useEffect(() => {
    if (eventLoading || activeEventId == null) return;
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [activeEventId, eventLoading, load]);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === stage.current && stage.current != null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (stage.current?.requestFullscreen) await stage.current.requestFullscreen();
      else throw new Error("unsupported");
    } catch {
      toast(t("lb.fullscreen_failed"), "info");
    }
  };

  const eventName = events.find((e) => e.id === activeEventId)?.name ?? "";
  const view = results ? bigScreenView(results, { livePreview, hideScores }) : null;
  const published = Boolean(results?.published);
  const shownRows = view ? (top === "all" ? view.rows : view.rows.slice(0, Number(top))) : [];
  const listsRanking = view?.mode === "ranking" || view?.mode === "live_preview";

  if (activeEventId == null && !eventLoading) {
    return <p className="py-10 text-center text-[15px]" style={{ color: "var(--ink-3)" }}>{t("rs.no_event")}</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("lb.title")}</h1>
          <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>{t("lb.subtitle")}</p>
        </div>
        <Link href="/results" {...buttonLook("ghost", "sm")}><ArrowLeft size={14} />{t("lb.back")}</Link>
      </div>

      {state === "ready" && view ? (
        <div className="space-y-3 rounded-[var(--radius)] border px-4 py-3" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
          <p className="flex flex-wrap items-center gap-2 text-[13.5px]" style={{ color: "var(--ink-2)" }}>
            <Badge tone={published ? "ok" : "warn"} dot>{t(published ? "lb.published" : "lb.not_published")}</Badge>
            <span>{published && view.visibility ? t(`lb.mode.${view.visibility}`) : t("lb.waiting_hint")}</span>
          </p>
          {!published ? (
            <div className="max-w-xl rounded-[12px] border px-3 py-1" style={{ borderColor: livePreview ? "var(--warn)" : "var(--line)", background: livePreview ? "var(--warn-weak)" : "transparent" }}>
              <Toggle label={t("lb.preview_label")} help={t("lb.preview_help")} checked={livePreview} onChange={setLivePreview} />
            </div>
          ) : null}
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            {listsRanking ? (
              <div className="w-40">
                <Select label={t("lb.top")} value={top} onChange={(v) => setTop(v as Top)} options={TOP_CHOICES.map((c) => ({ value: c, label: c === "all" ? t("lb.top_all") : fill(t("lb.top_n"), { n: c }) }))} />
              </div>
            ) : null}
            {listsRanking ? (
              <div className="min-w-[14rem] max-w-md">
                <Toggle compact label={t("lb.hide_scores")} checked={view.scoresLocked ? true : hideScores} onChange={setHideScores}
                  disabled={view.scoresLocked} help={view.scoresLocked ? t("lb.scores_locked") : undefined} />
              </div>
            ) : null}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--ink-3)" }} aria-live="polite">
                <RefreshCw size={12} aria-hidden="true" />
                {updated ? fill(t("lb.updated"), { time: formatDate(updated, lang, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }) }) : t("lb.auto")}
              </span>
              <Button size="sm" variant="primary" icon={<Maximize2 size={14} />} onClick={() => void toggleFullscreen()}>{t("lb.fullscreen")}</Button>
            </div>
          </div>
        </div>
      ) : null}

      {state === "locked" ? <Notice tone="info">{t("rs.err.MODULE_DISABLED")}</Notice> : null}
      {state === "failed" ? <ErrorState title={t("common.load_failed_title")} body={t("rs.load_failed")} onRetry={() => { setState("loading"); void load(); }} /> : null}
      {state === "loading" || eventLoading ? <Skeleton className="h-[420px] rounded-[var(--radius)]" /> : null}

      {state === "ready" && view ? (
        <div
          ref={stage}
          className="relative overflow-hidden rounded-[var(--radius)] border"
          style={{
            borderColor: view.mode === "live_preview" ? "var(--warn)" : "var(--line)",
            borderWidth: view.mode === "live_preview" ? 3 : 1,
            background: "var(--surface)",
            padding: full ? "clamp(1.5rem, 4vw, 4rem)" : "clamp(1rem, 3vw, 2rem)",
            minHeight: full ? "100vh" : undefined,
          }}
        >
          {view.mode === "live_preview" ? (
            <p role="status" className="mb-5 flex items-center justify-center gap-2 rounded-[12px] px-4 py-2.5 text-center font-bold uppercase tracking-[0.06em]"
              style={{ background: "repeating-linear-gradient(135deg, var(--warn-weak) 0 14px, transparent 14px 28px)", color: "var(--ink)", border: "1px solid var(--warn)", fontSize: full ? "clamp(1rem, 1.8vw, 1.6rem)" : "0.95rem" }}>
              <Eye size={full ? 24 : 16} aria-hidden="true" style={{ color: "var(--warn)" }} />
              {t("lb.preview_banner")}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold tracking-[-0.01em]" style={{ color: "var(--ink)", fontSize: full ? "clamp(1.5rem, 3vw, 2.75rem)" : "clamp(1.25rem, 2.4vw, 1.75rem)" }}>
                {eventName || t("lb.title")}
              </p>
              <p className="mt-1" style={{ color: "var(--ink-3)", fontSize: full ? "1.1rem" : "0.9rem" }}>
                {t(view.mode === "live_preview" ? "lb.live_sub" : view.mode === "winners" ? "lb.winners_sub" : view.mode === "ranking" ? "lb.published_sub" : "lb.waiting_sub")}
              </p>
            </div>
            {view.mode === "live_preview" ? <Badge tone="warn" dot>{t("lb.live")}</Badge> : view.mode === "waiting" ? null : <Badge tone="ok" dot>{t("lb.published")}</Badge>}
          </div>

          {view.mode === "waiting" ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center" style={{ minHeight: full ? "60vh" : 280 }}>
              <Clock3 aria-hidden="true" style={{ color: "var(--ink-3)", width: full ? 64 : 40, height: full ? 64 : 40 }} />
              <p className="font-semibold" style={{ color: "var(--ink)", fontSize: full ? "clamp(1.8rem, 4vw, 3.5rem)" : "clamp(1.3rem, 3vw, 2rem)" }}>{t("lb.waiting_title")}</p>
            </div>
          ) : view.mode === "winners" ? (
            view.winners.length === 0 ? (
              <EmptyState title={t("lb.no_winners_title")} body={t("lb.no_winners")} />
            ) : (
              <ol className="mt-6 grid gap-3 md:grid-cols-2" aria-label={t("lb.winners_title")}>
                {view.winners.map((w) => <WinnerCard key={w.prize.id} row={w} full={full} lang={lang} />)}
              </ol>
            )
          ) : shownRows.length === 0 ? (
            <EmptyState title={t("rs.empty")} body={t("lb.empty_hint")} />
          ) : (
            <ol className="mt-6 space-y-2.5" aria-label={t("lb.title")}>
              {shownRows.map((r) => <BigRow key={r.teamId} row={r} hideScores={!view.showScores} full={full} />)}
            </ol>
          )}

          {full ? (
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full opacity-40 transition-opacity hover:opacity-100 focus-visible:opacity-100"
              style={{ color: "var(--ink-2)" }}
              aria-label={t("lb.exit_fullscreen")}
            >
              <Minimize2 size={18} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WinnerCard({ row, full, lang }: { row: PrizeResult; full: boolean; lang: string }) {
  const { prize, teams } = row;
  const m = prize.kind === "place" && prize.position ? medal(prize.position) : null;
  return (
    <li className="rounded-[14px] border px-4 py-3" style={{ borderColor: m ? "var(--line-strong)" : "var(--line)", background: m ? "var(--surface-sunken)" : "transparent" }}>
      <p className="flex items-center gap-2 font-semibold" style={{ color: "var(--ink-2)", fontSize: full ? "1.2rem" : "0.95rem" }}>
        {m ? <Medal aria-hidden="true" style={{ color: MEDAL_COLOUR[m], width: "1.1em", height: "1.1em" }} /> : <Trophy aria-hidden="true" style={{ color: "var(--accent)", width: "1em", height: "1em" }} />}
        <span className="min-w-0 truncate">{prize.name}</span>
        {prize.kind === "place" && prize.position ? <span className="ml-auto shrink-0 tabular-nums" style={{ color: "var(--ink-3)" }}>{ordinal(prize.position, lang)}</span> : null}
      </p>
      {teams.map((x) => (
        <p key={x.teamId} className="mt-1 min-w-0">
          <span className="block truncate font-bold" style={{ color: "var(--ink)", fontSize: full ? "clamp(1.4rem, 3vw, 2.6rem)" : "clamp(1.1rem, 2.2vw, 1.6rem)" }}>{x.teamName}</span>
          {x.projectName ? <span className="block truncate" style={{ color: "var(--ink-3)", fontSize: full ? "1.1rem" : "0.9rem" }}>{x.projectName}</span> : null}
        </p>
      ))}
    </li>
  );
}

function BigRow({ row, hideScores, full }: { row: RankedTeam; hideScores: boolean; full: boolean }) {
  const { t } = useTranslation();
  const m = medal(row.place);
  const pct = row.score == null ? 0 : Math.max(0, Math.min(100, row.score));
  const big = full ? "clamp(1.4rem, 3.2vw, 3rem)" : "clamp(1.1rem, 2.4vw, 1.75rem)";
  return (
    <li
      className="grid items-center gap-x-4 gap-y-1 rounded-[14px] border px-4 py-3"
      style={{
        gridTemplateColumns: hideScores ? "auto minmax(0,1fr)" : "auto minmax(0,1fr) minmax(7rem, 30%)",
        borderColor: m ? "var(--line-strong)" : "var(--line)",
        background: m ? "var(--surface-sunken)" : "transparent",
      }}
    >
      <span className="flex items-center gap-2 tabular-nums" style={{ fontSize: big, color: "var(--ink)", fontWeight: 700, minWidth: "3.2ch" }}>
        {m ? <Medal aria-hidden="true" style={{ color: MEDAL_COLOUR[m], width: "0.9em", height: "0.9em" }} /> : null}
        {row.place}
        {row.tie ? <span className="sr-only">{t("rs.tie")}</span> : null}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-semibold" style={{ fontSize: big, color: "var(--ink)" }}>{row.teamName}</span>
        {row.projectName ? <span className="block truncate" style={{ fontSize: full ? "1.1rem" : "0.9rem", color: "var(--ink-3)" }}>{row.projectName}</span> : null}
      </span>
      {!hideScores ? (
        <span className="flex items-center gap-3">
          <span className="h-2.5 flex-1 overflow-hidden rounded-full" style={{ background: "var(--tint)" }} aria-hidden="true">
            <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: "var(--accent-solid)" }} />
          </span>
          <span className="w-[4.5ch] text-right font-semibold tabular-nums" style={{ fontSize: full ? "1.6rem" : "1.15rem", color: "var(--ink)" }}>{formatScore(row.score)}</span>
        </span>
      ) : null}
    </li>
  );
}
