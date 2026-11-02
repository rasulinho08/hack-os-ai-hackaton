"use client";

/**
 * The organiser's results: the live ranking from the judges' scores (the
 * API's — weighted per judge, out of 100, ties share a place), each team's
 * averages per criterion and every judge's review, the teams still waiting
 * for scores, publishing with what participants get to see (decision E8),
 * and the winners of each prize.
 *
 * Publishing freezes the ranking participants see; scores changed later do
 * not move it until the organiser publishes again, and the page says when
 * the two have drifted apart. The API refuses to publish while submissions
 * are open, while assigned reviews are unfinished, and while reviews are
 * older than their project's latest change (rolling judging), unless the
 * organiser confirms each here. Outdated reviews are also shown before
 * anyone presses Publish, with a way to ask those judges to look again.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, BellRing, ChevronDown, ChevronRight, Download, Eye, EyeOff, Layers, Lock, Medal, RefreshCw, Send, Sparkles, Trophy, Tv, Undo2,
} from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Skeleton, Tabs, buttonLook } from "@/components/ds/primitives";
import { Notice, Segmented, Select, Toggle } from "@/components/builder/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Modal } from "@/components/ds/overlays";
import { ScoreHistoryButton } from "@/components/judging/ScoreHistory";
import { VoteTally } from "@/components/voting/VoteTally";
import { ProjectsPagePanel } from "@/components/projects/ProjectsPagePanel";
import { ReportCard } from "@/components/wrapup/ReportCard";
import { useDemoBasePath } from "@/lib/demoPath";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { ApiError, DemoReadOnlyError, apiGet, apiPatch, apiPost } from "@/lib/api";
import { downloadCSV, toCSV } from "@/lib/csvExport";
import { fill } from "@/lib/i18n/fill";
import { formatDate } from "@/lib/i18n/dates";
import { formatRelativeTime } from "@/lib/relativeTime";
import {
  CERTIFICATE_HOLDS, VISIBILITIES, formatScore, isCompleteReview, judgeScore, medal, normalizeOrganiserResults, outdatedByProject, publishRefusal,
  resultsErrorKey, reviewsOf, snapshotChanges, sortPrizes,
  type Criterion, type OrganiserResults, type OutdatedReviews, type PrizeResult, type RankedTeam, type Review, type TeamRef, type Visibility,
} from "@/lib/results";

type Load = "loading" | "ready" | "failed" | "locked";
type Confirm = "publish" | "incomplete" | "outdated" | "unpublish" | null;

/** What the organiser already confirmed on the way to publishing. */
interface PublishFlags {
  confirmIncomplete?: boolean;
  confirmOutdated?: boolean;
}

/** The answer of "ask judges to re-check". */
interface RecheckAnswer {
  judges?: number;
  notified?: number;
  emailed?: number;
  skipped?: number;
}

interface PublishAnswer {
  first?: boolean;
  teams?: number;
  certificates?: { issuing?: boolean; reason?: string | null };
}

const ink = (n: "" | "-2" | "-3" = "") => ({ color: `var(--ink${n})` });

const MEDAL_COLOUR = { gold: "#C9A227", silver: "#9AA4AE", bronze: "#B87333" } as const;

export default function ResultsPage() {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const { activeEventId, loading: eventLoading, refetch: refetchEvents } = useActiveEvent();
  // The walkthrough has no builder to open.
  const base = useDemoBasePath();
  const [state, setState] = useState<Load>("loading");
  const [data, setData] = useState<OrganiserResults | null>(null);
  const [visibility, setVisibility] = useState<Visibility>("own_and_winners");
  const [showScores, setShowScores] = useState(false);
  const [view, setView] = useState<"live" | "published">("live");
  const [confirm, setConfirm] = useState<Confirm>(null);
  // What the API said is still owed when it asked for a confirmation.
  const [owed, setOwed] = useState<{ todo: number; partial: number } | null>(null);
  // Confirmations given so far: publishing asks one thing at a time.
  const [flags, setFlags] = useState<PublishFlags>({});
  // The outdated-reviews dialog opened from the page's notice (not on the way to publishing).
  const [outdatedOnly, setOutdatedOnly] = useState(false);
  const [recheck, setRecheck] = useState<{ busy: boolean; result: RecheckAnswer | null; failed: boolean }>({ busy: false, result: null, failed: false });
  const [busy, setBusy] = useState(false);
  const [prizeBusy, setPrizeBusy] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Counts the loads, so the people's choice tally reloads with the results.
  const [loads, setLoads] = useState(0);

  const words = useCallback((err: unknown, fallback: string) => {
    if (err instanceof ApiError) {
      // Refusals that carry their numbers: said with them, in the page's language.
      const refusal = publishRefusal(err.code, err.fieldErrors);
      if (refusal?.code === "SUBMISSIONS_OPEN" && refusal.closesAt) {
        return fill(t("rs.err.SUBMISSIONS_OPEN_at"), { when: formatDate(refusal.closesAt, lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) });
      }
      const key = resultsErrorKey(err.code);
      if (key) return t(key);
      if (err.summary) return err.summary;
    }
    return t(fallback);
  }, [t, lang]);

  const load = useCallback(async (opts: { quiet?: boolean; keepDraft?: boolean } = {}) => {
    if (activeEventId == null) return;
    if (opts.quiet) setRefreshing(true);
    try {
      const r = normalizeOrganiserResults(await apiGet<unknown>(`/api/events/${activeEventId}/results`));
      setData(r);
      if (!opts.keepDraft) {
        setVisibility(r.published?.visibility ?? r.settings.visibility);
        setShowScores(r.published?.showScores ?? r.settings.showScores);
      }
      if (!r.published) setView("live");
      setState("ready");
      setLoads((n) => n + 1);
    } catch (err) {
      if (err instanceof ApiError && err.code === "MODULE_DISABLED") setState("locked");
      else if (opts.quiet) toast(t("rs.refresh_failed"), "error");
      else setState("failed");
    } finally {
      setRefreshing(false);
    }
  }, [activeEventId, t, toast]);

  useEffect(() => {
    if (eventLoading || activeEventId == null) return;
    void load();
  }, [activeEventId, eventLoading, load]);

  const publish = async (given: PublishFlags = {}) => {
    if (activeEventId == null) return;
    setBusy(true);
    setFlags(given);
    try {
      const out = await apiPost<PublishAnswer>(`/api/events/${activeEventId}/results/publish`, {
        visibility,
        showScores: visibility === "winners" ? false : showScores,
        ...(given.confirmIncomplete ? { confirmIncomplete: true } : {}),
        ...(given.confirmOutdated ? { confirmOutdated: true } : {}),
      });
      setFlags({});
      toast(out?.first ? t("rs.published_first") : t("rs.published_again"), "success");
      const hold = out?.certificates?.reason;
      if (out?.certificates?.issuing) toast(t("rs.certs_issuing"), "info");
      else if (hold && (CERTIFICATE_HOLDS as readonly string[]).includes(hold)) toast(t(`rs.certs_hold.${hold}`), "warning", 9000);
      await load({ quiet: true });
      // The header's phase follows the publication ("Results out").
      void refetchEvents();
    } catch (err) {
      const refusal = err instanceof ApiError ? publishRefusal(err.code, err.fieldErrors) : null;
      if (refusal?.code === "JUDGING_INCOMPLETE" && !given.confirmIncomplete) {
        // Ask again, with what is still owed; publishing anyway is the organiser's call.
        setOwed({ todo: refusal.todo, partial: refusal.partial });
        setConfirm("incomplete");
      } else if (refusal?.code === "REVIEWS_OUTDATED" && !given.confirmOutdated) {
        // Which reviews, by judge and project: the page's copy may be older than the refusal.
        await load({ quiet: true, keepDraft: true });
        setOutdatedOnly(false);
        setRecheck({ busy: false, result: null, failed: false });
        setConfirm("outdated");
      } else if (!(err instanceof DemoReadOnlyError)) toast(words(err, "rs.publish_failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  /** "Ask judges to re-check": the bell and an e-mail for each judge with an outdated review. */
  const askJudges = async () => {
    if (activeEventId == null) return;
    setRecheck({ busy: true, result: null, failed: false });
    try {
      const out = await apiPost<RecheckAnswer>(`/api/events/${activeEventId}/results/recheck`, {});
      setRecheck({ busy: false, result: out ?? {}, failed: false });
    } catch (err) {
      setRecheck({ busy: false, result: null, failed: !(err instanceof DemoReadOnlyError) });
      if (err instanceof ApiError && err.code === "NOTHING_OUTDATED") {
        toast(t("rs.err.NOTHING_OUTDATED"), "info");
        await load({ quiet: true, keepDraft: true });
      }
    }
  };

  const unpublish = async () => {
    if (activeEventId == null) return;
    setBusy(true);
    try {
      const out = await apiPost<{ certificatesRevoked?: number }>(`/api/events/${activeEventId}/results/unpublish`, {});
      const revoked = Number(out?.certificatesRevoked) || 0;
      toast(revoked > 0 ? fill(t("rs.unpublished_revoked"), { n: revoked }) : t("rs.unpublished"), "success");
      await load({ quiet: true, keepDraft: true });
      void refetchEvents();
    } catch (err) {
      if (!(err instanceof DemoReadOnlyError)) toast(words(err, "rs.unpublish_failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const chooseWinner = async (prizeId: number, teamId: number | null) => {
    if (activeEventId == null) return;
    setPrizeBusy(prizeId);
    try {
      await apiPatch(`/api/events/${activeEventId}/results/prizes/${prizeId}`, { teamId });
      toast(teamId == null ? t("rs.prize_cleared") : t("rs.prize_saved"), "success");
      await load({ quiet: true, keepDraft: true });
    } catch (err) {
      if (!(err instanceof DemoReadOnlyError)) toast(words(err, "rs.prize_failed"), "error");
    } finally {
      setPrizeBusy(null);
    }
  };

  const changes = useMemo(() => (data ? snapshotChanges(data) : []), [data]);
  const judgesWhoScored = useMemo(() => new Set((data?.reviews ?? []).map((r) => r.judgeId)).size, [data]);

  const exportCsv = () => {
    if (!data) return;
    const rows = (view === "published" && data.snapshot ? data.snapshot : data.ranking).map((r) => ({
      place: r.place,
      team: r.teamName,
      project: r.projectName ?? "",
      track: r.track ?? "",
      score: r.score ?? "",
      judges: r.judgesCount,
    }));
    const csv = toCSV(rows, [
      { key: "place", header: t("rs.col.place") },
      { key: "team", header: t("rs.col.team") },
      { key: "project", header: t("rs.col.project") },
      { key: "track", header: t("rs.col.track") },
      { key: "score", header: t("rs.col.score") },
      { key: "judges", header: t("rs.col.judges") },
    ]);
    downloadCSV(view === "published" ? "results-published.csv" : "results-live.csv", csv);
  };

  if (activeEventId == null && !eventLoading) {
    return <p className="py-10 text-center text-[15px]" style={ink("-3")}>{t("rs.no_event")}</p>;
  }

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={ink()}>{t("rs.title")}</h1>
        <p className="mt-1 max-w-2xl text-[15px]" style={ink("-2")}>{t("rs.subtitle")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" icon={<RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />} onClick={() => void load({ quiet: true, keepDraft: true })} disabled={refreshing || state !== "ready"}>
          {t("rs.refresh")}
        </Button>
        <Link href="/leaderboard" {...buttonLook("ghost", "sm")}><Tv size={14} />{t("rs.big_screen")}</Link>
        <Button size="sm" variant="secondary" icon={<Download size={14} />} onClick={exportCsv} disabled={!data || data.ranking.length === 0}>
          {t("rs.export")}
        </Button>
      </div>
    </div>
  );

  if (state === "loading" || eventLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        {header}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[76px] rounded-[var(--radius)]" />)}</div>
        <Skeleton className="h-64 rounded-[var(--radius)]" />
      </div>
    );
  }
  if (state === "locked") {
    return (
      <div className="space-y-6">
        {header}
        <Notice tone="info" icon={<Lock size={15} />}>{t("rs.err.MODULE_DISABLED")}</Notice>
      </div>
    );
  }
  if (state === "failed" || !data) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState title={t("common.load_failed_title")} body={t("rs.load_failed")} onRetry={() => { setState("loading"); void load(); }} />
      </div>
    );
  }

  const rows = view === "published" && data.snapshot ? data.snapshot : data.ranking;
  const published = data.published;

  return (
    <div className="space-y-6">
      {header}

      <section aria-label={t("rs.status_label")} className="flex flex-wrap items-center gap-2.5 rounded-[var(--radius)] border px-4 py-3" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
        {published ? (
          <>
            <Badge tone="ok" dot>{t("rs.state.published")}</Badge>
            <span className="text-[13.5px]" style={ink("-2")}>
              {fill(t("rs.published_at"), { when: formatDate(published.at, lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) })}
            </span>
            <span className="text-[13.5px]" style={ink("-2")}>· {t(`rs.vis.${published.visibility}`)}</span>
            {published.visibility !== "winners" ? (
              <span className="inline-flex items-center gap-1 text-[13.5px]" style={ink("-2")}>
                · {published.showScores ? <Eye size={13} aria-hidden="true" /> : <EyeOff size={13} aria-hidden="true" />}
                {t(published.showScores ? "rs.scores_shown" : "rs.scores_hidden")}
              </span>
            ) : null}
            {published.outdatedConfirmed ? (
              <Badge tone="warn">{fill(t("rs.outdated.confirmed"), { n: published.outdatedConfirmed.count })}</Badge>
            ) : null}
          </>
        ) : (
          <>
            <Badge tone="neutral" dot>{t("rs.state.draft")}</Badge>
            <span className="text-[13.5px]" style={ink("-2")}>{t("rs.draft_hint")}</span>
          </>
        )}
      </section>

      {published && changes.length > 0 ? (
        <Notice tone="warn">
          <p className="font-medium">{fill(t("rs.drift_title"), { n: changes.length })}</p>
          <p className="mt-0.5">{t("rs.drift_body")}</p>
        </Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: t("rs.stat.ranked"), value: data.ranking.length },
          { label: t("rs.stat.unscored"), value: data.unscored.length },
          { label: t("rs.stat.eliminated"), value: data.eliminated.length },
          { label: t("rs.stat.judges"), value: judgesWhoScored },
        ].map((s) => (
          <div key={s.label} className="rounded-[var(--radius)] border px-4 py-3.5" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
            <p className="text-[12px] font-medium uppercase tracking-[0.06em]" style={ink("-3")}>{s.label}</p>
            <p className="mt-1 text-[24px] font-bold tabular-nums" style={ink()}>{s.value}</p>
          </div>
        ))}
      </div>

      {!published && data.outdated && data.outdated.count > 0 ? (
        <OutdatedNotice
          outdated={data.outdated}
          busy={recheck.busy}
          onSee={() => { setOutdatedOnly(true); setConfirm("outdated"); }}
          onAsk={() => { setOutdatedOnly(true); setConfirm("outdated"); void askJudges(); }}
        />
      ) : null}

      <PublishPanel
        published={Boolean(published)}
        visibility={visibility}
        showScores={showScores}
        canPublish={data.ranking.length > 0}
        busy={busy}
        onVisibility={setVisibility}
        onShowScores={setShowScores}
        onPublish={() => setConfirm("publish")}
        onUnpublish={() => setConfirm("unpublish")}
      />

      {activeEventId != null ? <ProjectsPagePanel eventId={activeEventId} resultsAt={published?.at ?? null} /> : null}

      {/* Once the results are out, the report for the sponsors is one click away. */}
      {activeEventId != null && published ? <ReportCard eventId={activeEventId} /> : null}

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold" style={ink()}>{t("rs.ranking")}</h2>
            <p className="mt-0.5 text-[12.5px]" style={ink("-3")}>{t(view === "published" ? "rs.ranking_published_hint" : "rs.ranking_live_hint")}</p>
          </div>
        </div>
        {published && data.snapshot ? (
          <Tabs
            className="mt-3 px-3"
            value={view}
            onChange={setView}
            tabs={[
              { id: "live", label: t("rs.tab.live"), count: data.ranking.length },
              { id: "published", label: t("rs.tab.published"), count: data.snapshot.length },
            ]}
          />
        ) : <div className="mt-3 border-b" style={{ borderColor: "var(--line)" }} />}
        {rows.length === 0 ? (
          <EmptyState
            icon={<Trophy size={19} />}
            title={t("rs.empty")}
            body={t("rs.empty_hint")}
            action={<Link href="/judges" {...buttonLook("secondary", "sm")}>{t("rs.go_judges")}</Link>}
          />
        ) : (
          <RankingTable rows={rows} criteria={data.criteria} reviews={data.reviews} eventId={activeEventId ?? 0} />
        )}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <PrizesPanel prizes={data.prizes} ranking={data.ranking} unscored={data.unscored} busyId={prizeBusy} onChoose={(p, team) => void chooseWinner(p, team)} />
          {activeEventId != null ? <VoteTally eventId={activeEventId} refreshKey={loads} builderHref={base ? undefined : `/create-event/${activeEventId}?section=judging`} /> : null}
        </div>
        <div className="space-y-6">
          <TeamsCard title={t("rs.unscored")} hint={t("rs.unscored_hint")} teams={data.unscored} empty={t("rs.unscored_none")} />
          {data.ineligible.length > 0 ? (
            <TeamsCard title={t("rs.ineligible")} hint={t("rs.ineligible_hint")} teams={data.ineligible} empty="" />
          ) : null}
          <TeamsCard
            title={t("rs.eliminated")}
            hint={t("rs.eliminated_hint")}
            teams={data.eliminated}
            empty={t("rs.eliminated_none")}
            action={<Link href="/eliminate" className="text-[13px] font-medium underline-offset-2 hover:underline" style={{ color: "var(--accent)" }}>{t("rs.go_eliminate")}</Link>}
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "publish"}
        title={t(published ? "rs.confirm_republish_t" : "rs.confirm_publish_t")}
        message={[
          t(`rs.vis_effect.${visibility}`),
          visibility !== "winners" ? t(showScores ? "rs.confirm_scores_on" : "rs.confirm_scores_off") : "",
          t(published ? "rs.confirm_republish_b" : "rs.confirm_publish_b"),
          data.incomplete.length > 0 ? fill(t("rs.confirm_partial"), { n: data.incomplete.length }) : "",
        ].join(" ").replace(/\s+/g, " ").trim()}
        confirmLabel={t(published ? "rs.republish" : "rs.publish")}
        cancelLabel={t("rs.cancel")}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); void publish(); }}
      />
      <ConfirmDialog
        open={confirm === "incomplete"}
        title={t("rs.confirm_incomplete_t")}
        message={fill(t("rs.confirm_incomplete_b"), { todo: owed?.todo ?? 0, partial: owed?.partial ?? 0 })}
        confirmLabel={t("rs.publish_anyway")}
        cancelLabel={t("rs.cancel")}
        variant="danger"
        onCancel={() => { setConfirm(null); setOwed(null); }}
        onConfirm={() => { setConfirm(null); void publish({ ...flags, confirmIncomplete: true }); }}
      />
      <OutdatedDialog
        open={confirm === "outdated"}
        outdated={data.outdated}
        eventId={activeEventId}
        canPublish={!outdatedOnly}
        busy={busy}
        recheck={recheck}
        onAsk={() => void askJudges()}
        onClose={() => { setConfirm(null); setFlags({}); setOutdatedOnly(false); }}
        onPublish={() => { setConfirm(null); void publish({ ...flags, confirmOutdated: true }); }}
      />
      <ConfirmDialog
        open={confirm === "unpublish"}
        title={t("rs.confirm_unpublish_t")}
        message={t("rs.confirm_unpublish_b")}
        confirmLabel={t("rs.unpublish")}
        cancelLabel={t("rs.cancel")}
        variant="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); void unpublish(); }}
      />
    </div>
  );
}

/* ── Outdated reviews ────────────────────────────────────────────────────── */

/** On the page before publishing: how many reviews are older than their project's latest change. */
function OutdatedNotice({ outdated, busy, onSee, onAsk }: { outdated: OutdatedReviews; busy: boolean; onSee: () => void; onAsk: () => void }) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t("rs.outdated.dialog_t")}
      className="rounded-[var(--radius)] border px-4 py-3.5"
      style={{ borderColor: "color-mix(in srgb, var(--warn) 45%, var(--line))", background: "var(--warn-weak)" }}
    >
      <div className="flex flex-wrap items-start gap-3">
        <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: "var(--warn)" }} />
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-[14.5px] font-semibold" style={ink()}>{fill(t("rs.outdated.notice_t"), { n: outdated.count })}</p>
          <p className="mt-0.5 text-[13.5px] leading-relaxed" style={ink("-2")}>{t("rs.outdated.notice_b")}</p>
          {outdated.rolling ? <p className="mt-1 text-[12.5px] leading-relaxed" style={ink("-3")}>{t("rs.outdated.rolling")}</p> : null}
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button size="sm" variant="secondary" onClick={onSee}>{t("rs.outdated.see")}</Button>
          <Button size="sm" variant="primary" icon={<BellRing size={14} />} loading={busy} disabled={busy} onClick={onAsk}>{t("rs.outdated.ask")}</Button>
        </div>
      </div>
    </section>
  );
}

/**
 * What is outdated, project by project with each judge's review, a way to
 * the judging progress, "ask judges to re-check", and — on the way to
 * publishing — "publish anyway".
 */
function OutdatedDialog({
  open, outdated, eventId, canPublish, busy, recheck, onAsk, onClose, onPublish,
}: {
  open: boolean;
  outdated: OutdatedReviews | null;
  eventId: number | null;
  canPublish: boolean;
  busy: boolean;
  recheck: { busy: boolean; result: RecheckAnswer | null; failed: boolean };
  onAsk: () => void;
  onClose: () => void;
  onPublish: () => void;
}) {
  const { t, lang } = useTranslation();
  const base = useDemoBasePath();
  const projects = useMemo(() => (outdated ? outdatedByProject(outdated) : []), [outdated]);
  if (!outdated) return null;
  const when = (iso: string | null) => (iso ? formatRelativeTime(iso, lang) : "—");
  const r = recheck.result;
  const asked = Number(r?.notified) || 0;
  const skipped = Number(r?.skipped) || 0;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("rs.outdated.dialog_t")}
      width={640}
      footer={(
        <>
          <Link href={`${base}/judges?tab=progress`} {...buttonLook("ghost", "sm")}>{t("rs.outdated.progress")}</Link>
          <Button size="sm" variant="secondary" icon={<BellRing size={14} />} loading={recheck.busy} disabled={recheck.busy || Boolean(r)} onClick={onAsk}>
            {t("rs.outdated.ask")}
          </Button>
          {canPublish ? (
            <>
              <Button size="sm" variant="ghost" onClick={onClose}>{t("rs.cancel")}</Button>
              <Button size="sm" variant="danger" icon={<Send size={14} />} loading={busy} disabled={busy} onClick={onPublish}>{t("rs.publish_anyway")}</Button>
            </>
          ) : (
            <Button size="sm" variant="primary" onClick={onClose}>{t("Close")}</Button>
          )}
        </>
      )}
    >
      <div className="space-y-4 text-[13.5px]">
        <p className="leading-relaxed" style={ink("-2")}>
          {fill(t("rs.outdated.dialog_b"), { n: outdated.count, judges: outdated.judges.length, projects: outdated.projects.length })}
        </p>
        {outdated.rolling ? <p className="text-[12.5px] leading-relaxed" style={ink("-3")}>{t("rs.outdated.rolling")}</p> : null}
        {outdated.windowState !== "open" ? (
          <Notice tone="warn">
            {t("rs.outdated.judging_closed")}{" "}
            {base || eventId == null ? null : (
              <Link href={`/create-event/${eventId}?section=schedule`} className="font-medium underline underline-offset-2" style={{ color: "var(--accent)" }}>{t("rs.outdated.open_schedule")}</Link>
            )}
          </Notice>
        ) : null}
        <ul className="space-y-2.5" aria-label={t("rs.outdated.dialog_t")}>
          {projects.map((p) => (
            <li key={p.teamId} className="rounded-[12px] border px-3.5 py-3" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="min-w-0 font-medium" style={ink()}>
                  {p.projectName ?? p.teamName}
                  {p.projectName ? <span className="ml-1.5 text-[12.5px] font-normal" style={ink("-3")}>· {p.teamName}</span> : null}
                </p>
                <span className="text-[12.5px]" style={ink("-3")}>{fill(t("rs.outdated.changed"), { when: when(p.changedAt) })}</span>
              </div>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {p.reviews.map((rv) => (
                  <li key={rv.judgeId} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px]" style={{ background: "var(--tint)", color: "var(--ink)" }}>
                    <span className="font-medium">{rv.judgeName}</span>
                    <span style={ink("-3")}>{fill(t("rs.outdated.reviewed"), { when: when(rv.reviewedAt) })}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {r ? (
          <p role="status" className="rounded-[12px] px-3.5 py-2.5 text-[13px]" style={{ background: asked ? "var(--ok-weak)" : "var(--tint)", color: "var(--ink)" }}>
            {asked ? fill(t("rs.outdated.asked"), { n: asked }) : t("rs.outdated.asked_none")}
            {asked && skipped ? ` ${fill(t("rs.outdated.asked_skipped"), { n: skipped })}` : ""}
          </p>
        ) : null}
        {recheck.failed ? <p role="alert" className="text-[13px]" style={{ color: "var(--danger)" }}>{t("rs.outdated.ask_failed")}</p> : null}
        {canPublish ? <p className="text-[12.5px]" style={ink("-3")}>{t("rs.outdated.recorded")}</p> : null}
      </div>
    </Modal>
  );
}

/* ── Publishing ──────────────────────────────────────────────────────────── */

function PublishPanel({
  published, visibility, showScores, canPublish, busy, onVisibility, onShowScores, onPublish, onUnpublish,
}: {
  published: boolean;
  visibility: Visibility;
  showScores: boolean;
  canPublish: boolean;
  busy: boolean;
  onVisibility: (v: Visibility) => void;
  onShowScores: (v: boolean) => void;
  onPublish: () => void;
  onUnpublish: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader title={t(published ? "rs.publish_again_title" : "rs.publish_title")} hint={t("rs.publish_hint")} />
      <div className="space-y-4">
        <Segmented<Visibility>
          label={t("rs.vis_label")}
          value={visibility}
          onChange={onVisibility}
          options={VISIBILITIES.map((v) => ({ value: v, label: t(`rs.vis.${v}`), hint: t(`rs.vis_hint.${v}`) }))}
        />
        <Toggle
          label={t("rs.show_scores")}
          help={visibility === "winners" ? t("rs.show_scores_off_hint") : t("rs.show_scores_hint")}
          checked={visibility === "winners" ? false : showScores}
          disabled={visibility === "winners"}
          onChange={onShowScores}
        />
        {!canPublish ? <Notice tone="info">{t("rs.err.NO_SCORES")}</Notice> : null}
        <div className="flex flex-wrap justify-end gap-2">
          {published ? (
            <Button size="sm" variant="ghost" icon={<Undo2 size={14} />} disabled={busy} onClick={onUnpublish} style={{ color: "var(--danger)" }}>
              {t("rs.unpublish")}
            </Button>
          ) : null}
          <Button size="sm" variant="primary" icon={<Send size={14} />} loading={busy} disabled={busy || !canPublish} onClick={onPublish}>
            {t(published ? "rs.republish" : "rs.publish")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* ── The ranking ─────────────────────────────────────────────────────────── */

function PlaceMark({ team }: { team: RankedTeam }) {
  const { t } = useTranslation();
  const m = medal(team.place);
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      {m ? <Medal size={15} aria-hidden="true" style={{ color: MEDAL_COLOUR[m] }} /> : <span aria-hidden="true" className="inline-block w-[15px]" />}
      <span className="text-[15px] font-semibold" style={ink()}>{team.place}</span>
      {team.tie ? <span className="text-[11px]" style={ink("-3")} title={t("rs.tie")}>={" "}<span className="sr-only">{t("rs.tie")}</span></span> : null}
    </span>
  );
}

function ScoreBar({ value }: { value: number | null }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <span className="flex min-w-[7.5rem] items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: "var(--tint)" }} aria-hidden="true">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: "var(--accent-solid)" }} />
      </span>
      <span className="w-12 text-right text-[14px] font-semibold tabular-nums" style={ink()}>{formatScore(value)}</span>
    </span>
  );
}

function RankingTable({ rows, criteria, reviews, eventId }: { rows: RankedTeam[]; criteria: Criterion[]; reviews: Review[]; eventId: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Set<number>>(new Set());
  const flip = (id: number) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[13.5px]">
        <caption className="sr-only">{t("rs.ranking")}</caption>
        <thead>
          <tr className="text-left text-[11.5px] uppercase tracking-[0.06em]" style={ink("-3")}>
            <th scope="col" className="px-5 py-2.5 font-medium">{t("rs.col.place")}</th>
            <th scope="col" className="px-3 py-2.5 font-medium">{t("rs.col.team")}</th>
            <th scope="col" className="px-3 py-2.5 font-medium">{t("rs.col.track")}</th>
            <th scope="col" className="px-3 py-2.5 font-medium">{t("rs.col.score")}</th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">{t("rs.col.judges")}</th>
            <th scope="col" className="w-12 px-3 py-2.5"><span className="sr-only">{t("rs.details")}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isOpen = open.has(row.teamId);
            const detailsId = `rs-details-${row.teamId}`;
            return (
              <Fragment key={row.teamId}>
                <tr className="border-t" style={{ borderColor: "var(--line)" }}>
                  <td className="px-5 py-3 align-top"><PlaceMark team={row} /></td>
                  <td className="px-3 py-3 align-top">
                    <p className="font-medium" style={ink()}>{row.teamName}</p>
                    {row.projectName ? <p className="text-[12.5px]" style={ink("-3")}>{row.projectName}</p> : null}
                  </td>
                  <td className="px-3 py-3 align-top" style={ink("-2")}>{row.track ?? <span style={ink("-3")}>—</span>}</td>
                  <td className="px-3 py-3 align-top"><ScoreBar value={row.score} /></td>
                  <td className="px-3 py-3 text-right align-top tabular-nums" style={ink("-2")}>{row.judgesCount}</td>
                  <td className="px-3 py-2 align-top">
                    <button
                      type="button"
                      onClick={() => flip(row.teamId)}
                      aria-expanded={isOpen}
                      aria-controls={detailsId}
                      aria-label={fill(t(isOpen ? "rs.hide_details" : "rs.show_details"), { team: row.teamName })}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md focus-visible:outline-2"
                      style={{ color: "var(--ink-2)", outlineColor: "var(--accent)" }}
                    >
                      {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                  </td>
                </tr>
                {isOpen ? (
                  <tr id={detailsId} style={{ background: "var(--surface-sunken)" }}>
                    <td colSpan={6} className="px-5 py-4">
                      <TeamDetails row={row} criteria={criteria} reviews={reviewsOf(reviews, row.teamId)} eventId={eventId} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TeamDetails({ row, criteria, reviews, eventId }: { row: RankedTeam; criteria: Criterion[]; reviews: Review[]; eventId: number }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <section aria-label={t("rs.by_criterion")}>
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em]" style={ink("-3")}>{t("rs.by_criterion")}</h3>
        {row.breakdown.length === 0 ? <p className="text-[13px]" style={ink("-3")}>{t("rs.no_breakdown")}</p> : (
          <ul className="space-y-2.5">
            {row.breakdown.map((b) => {
              const pct = b.avg == null || b.max <= 0 ? 0 : Math.round((b.avg / b.max) * 100);
              return (
                <li key={b.criterionId}>
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span style={ink()}>{b.name}{b.weight !== 1 ? <span className="ml-1.5 text-[11.5px]" style={ink("-3")}>×{b.weight}</span> : null}</span>
                    <span className="tabular-nums" style={ink("-2")}>{b.avg == null ? "—" : `${formatScore(b.avg)} / ${formatScore(b.max)}`}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--tint)" }} aria-hidden="true">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--info)" }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section aria-label={t("rs.by_judge")}>
        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em]" style={ink("-3")}>{t("rs.by_judge")}</h3>
        {reviews.length === 0 ? (
          <p className="text-[13px]" style={ink("-3")}>{t("rs.no_reviews")}</p>
        ) : (
          <ul className="space-y-3">
            {reviews.map((r) => (
              <li key={r.judgeId} className="rounded-[12px] border px-3.5 py-3" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium" style={ink()}>{r.judgeName}</span>
                  <span className="flex flex-wrap items-center gap-2">
                    {r.changed > 0 && row.submissionId != null && eventId > 0 ? (
                      <ScoreHistoryButton eventId={eventId} submissionId={row.submissionId} judgeId={r.judgeId} judgeName={r.judgeName} times={r.changed} />
                    ) : null}
                    {isCompleteReview(r, criteria) ? (
                      <span className="text-[12.5px] tabular-nums" style={ink("-2")}>{fill(t("rs.judge_total"), { score: formatScore(judgeScore(r, criteria)) })}</span>
                    ) : (
                      <Badge tone="warn">{fill(t("rs.review_partial"), { n: criteria.filter((c) => r.scores[c.id] != null).length, of: criteria.length })}</Badge>
                    )}
                  </span>
                </div>
                <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]" style={ink("-2")}>
                  {criteria.map((c) => (
                    <span key={c.id}>{c.name}: <span className="tabular-nums font-medium" style={ink()}>{r.scores[c.id] == null ? "—" : formatScore(r.scores[c.id])}</span></span>
                  ))}
                </p>
                {r.feedback ? <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed" style={ink()}>“{r.feedback}”</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ── Prizes ──────────────────────────────────────────────────────────────── */

function PrizeIcon({ kind }: { kind: PrizeResult["prize"]["kind"] }) {
  if (kind === "place") return <Trophy size={16} aria-hidden="true" style={{ color: MEDAL_COLOUR.gold }} />;
  if (kind === "track") return <Layers size={16} aria-hidden="true" style={{ color: "var(--info)" }} />;
  return <Sparkles size={16} aria-hidden="true" style={{ color: "var(--accent)" }} />;
}

function PrizesPanel({ prizes, ranking, unscored, busyId, onChoose }: {
  prizes: PrizeResult[];
  ranking: RankedTeam[];
  unscored: TeamRef[];
  busyId: number | null;
  onChoose: (prizeId: number, teamId: number | null) => void;
}) {
  const { t } = useTranslation();
  const options = useMemo(() => [
    ...ranking.map((r) => ({ value: String(r.teamId), label: `${r.place}. ${r.teamName}${r.projectName ? ` — ${r.projectName}` : ""}` })),
    ...unscored.map((u) => ({ value: String(u.teamId), label: `${u.teamName}${u.projectName ? ` — ${u.projectName}` : ""} (${t("rs.unscored_short")})` })),
  ], [ranking, unscored, t]);
  const sorted = sortPrizes(prizes);
  return (
    <Card>
      <CardHeader title={t("rs.prizes")} hint={t("rs.prizes_hint")} />
      {sorted.length === 0 ? (
        <EmptyState icon={<Trophy size={19} />} title={t("rs.prizes_none")} body={t("rs.prizes_none_hint")} />
      ) : (
        <ul className="space-y-3">
          {sorted.map(({ prize, teams }) => (
            <li key={prize.id} className="rounded-[12px] border px-3.5 py-3" style={{ borderColor: "var(--line)" }}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                  <span className="mt-0.5"><PrizeIcon kind={prize.kind} /></span>
                  <div className="min-w-0">
                    <p className="font-medium" style={ink()}>{prize.name}</p>
                    {prize.value ? <p className="text-[12.5px]" style={ink("-3")}>{prize.value}</p> : null}
                  </div>
                </div>
                <Badge tone={prize.kind === "place" ? "warn" : prize.kind === "track" ? "info" : "brand"}>
                  {prize.kind === "place" && prize.position ? fill(t("rs.kind.place_n"), { n: prize.position }) : t(`rs.kind.${prize.kind}`)}
                </Badge>
              </div>
              <div className="mt-2.5">
                {prize.kind === "place" ? (
                  <p className="text-[13px]" style={ink("-2")}>
                    {teams.length ? teams.map((w) => w.teamName).join(", ") : t("rs.place_empty")}
                    <span className="ml-1.5 text-[12px]" style={ink("-3")}>· {t("rs.place_follows")}</span>
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    <Select
                      label={t("rs.prize_winner")}
                      value={prize.manual && teams[0] ? String(teams[0].teamId) : ""}
                      onChange={(v) => onChoose(prize.id, v ? Number(v) : null)}
                      placeholder={t(prize.kind === "track" ? "rs.prize_auto" : "rs.prize_nobody")}
                      options={options}
                    />
                    {prize.kind === "track" && !prize.manual ? (
                      <p className="text-[12.5px]" style={ink("-3")}>
                        {teams[0] ? fill(t("rs.prize_auto_now"), { team: teams[0].teamName }) : t("rs.prize_auto_none")}
                      </p>
                    ) : null}
                    {busyId === prize.id ? <p className="text-[12px]" role="status" style={ink("-3")}>{t("rs.saving")}</p> : null}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TeamsCard({ title, hint, teams, empty, action }: { title: string; hint: string; teams: TeamRef[]; empty: string; action?: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader title={`${title} · ${teams.length}`} hint={hint} action={action} />
      {teams.length === 0 ? <p className="text-[13px]" style={ink("-3")}>{empty}</p> : (
        <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
          {teams.map((x) => (
            <li key={x.teamId} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <span className="font-medium" style={ink()}>{x.teamName}</span>
              <span className="text-[12.5px]" style={ink("-3")}>
                {[x.projectName, x.track, x.partialReviews ? fill(t("rs.partial_reviews"), { n: x.partialReviews }) : null].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
