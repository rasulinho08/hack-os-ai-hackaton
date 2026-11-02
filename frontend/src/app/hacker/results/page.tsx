"use client";

/**
 * A participant's results, as the organiser chose to publish them
 * (decision E8): their own team's place — and its scores per criterion with
 * the judges' written feedback when scores are shown — the winners of each
 * prize, and the whole leaderboard when it is public. Before publishing
 * there is nothing to show but when to expect it.
 *
 * The event is the participant's own (participantEventId), never the
 * platform's "active" one.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Hourglass, Layers, Lock, Medal, MessageSquareQuote, PartyPopper, Sparkles, Trophy } from "lucide-react";
import { Badge, Card, CardHeader, Skeleton, buttonLook } from "@/components/ds/primitives";
import { Notice } from "@/components/builder/ui";
import { LoadFailure } from "@/components/LoadFailure";
import { MyCertificates } from "@/components/wrapup/MyCertificates";
import { NpsPrompt } from "@/components/wrapup/NpsPrompt";
import { useTranslation } from "@/contexts/LanguageContext";
import { ApiError, apiGet } from "@/lib/api";
import { formatInZone } from "@/lib/builder/datetime";
import { fill } from "@/lib/i18n/fill";
import { participantEventId } from "@/lib/participantEvent";
import {
  formatScore, medal, normalizeParticipantResults, ordinal, sortPrizes,
  type BreakdownItem, type LeaderboardRow, type MyResult, type ParticipantResults, type PrizeResult,
} from "@/lib/results";

type State = "loading" | "ready" | "no_event" | "not_participant" | "locked" | "failed";

interface EventInfo {
  name?: string | null;
  timezone?: string | null;
  results_at?: string | null;
}

const ink = (n: "" | "-2" | "-3" = "") => ({ color: `var(--ink${n})` });
const MEDAL_COLOUR = { gold: "#C9A227", silver: "#9AA4AE", bronze: "#B87333" } as const;
const POLL_MS = 60_000;

export default function HackerResultsPage() {
  const { t, lang } = useTranslation();
  const [state, setState] = useState<State>("loading");
  const [eventId, setEventId] = useState<number | null>(null);
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [data, setData] = useState<ParticipantResults | null>(null);

  const load = useCallback(async (eid: number) => {
    const [res, ev] = await Promise.allSettled([
      apiGet<unknown>(`/api/events/${eid}/results/me`),
      apiGet<EventInfo>(`/api/events/${eid}`),
    ]);
    if (ev.status === "fulfilled" && ev.value) setEvent(ev.value);
    if (res.status === "rejected") {
      const err = res.reason;
      if (err instanceof ApiError && err.code === "NOT_PARTICIPANT") setState("not_participant");
      else if (err instanceof ApiError && err.code === "MODULE_DISABLED") setState("locked");
      else if (err instanceof ApiError && err.status === 404) setState("no_event");
      else setState((s) => (s === "ready" ? s : "failed"));
      return;
    }
    setData(normalizeParticipantResults(res.value));
    setState("ready");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const eid = await participantEventId();
      if (cancelled) return;
      if (eid == null) { setState("no_event"); return; }
      setEventId(eid);
      await load(eid);
    })();
    return () => { cancelled = true; };
  }, [load]);

  // Waiting for results: look again every minute while the page is open.
  useEffect(() => {
    if (eventId == null || data?.published) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(eventId); }, POLL_MS);
    return () => clearInterval(timer);
  }, [eventId, data?.published, load]);

  const tz = event?.timezone || "Asia/Baku";
  const when = (iso: string) => formatInZone(iso, tz, lang);

  const title = (
    <div>
      <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={ink()}>{t("hr.title")}</h1>
      {event?.name ? <p className="mt-1 text-[15px]" style={ink("-2")}>{event.name}</p> : null}
    </div>
  );

  if (state === "loading") {
    return <div className="space-y-6" aria-busy="true">{title}<Skeleton className="h-40 rounded-[var(--radius)]" /><Skeleton className="h-56 rounded-[var(--radius)]" /></div>;
  }
  if (state === "failed") {
    return <div className="space-y-6">{title}<LoadFailure message={t("hr.load_failed")} onRetry={() => eventId != null && void load(eventId)} /></div>;
  }
  if (state !== "ready" || !data) {
    const words = state === "not_participant" ? "hr.not_participant" : state === "locked" ? "hr.locked" : "hr.no_event";
    return <div className="space-y-6">{title}<Notice tone="info" icon={<Lock size={15} />}>{t(words)}</Notice></div>;
  }

  if (!data.published) {
    return (
      <div className="space-y-6">
        {title}
        <Card className="text-center">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "var(--tint)", color: "var(--ink-2)" }}>
            <Hourglass size={20} aria-hidden="true" />
          </span>
          <p className="mt-3 text-[17px] font-semibold" style={ink()}>{t("hr.waiting")}</p>
          <p className="mx-auto mt-1.5 max-w-md text-[14px] leading-relaxed" style={ink("-2")}>
            {event?.results_at ? fill(t("hr.waiting_at"), { when: when(event.results_at) }) : t("hr.waiting_hint")}
          </p>
          <div className="mt-5">
            <Link href="/hacker" {...buttonLook("secondary", "sm")}><ArrowLeft size={14} />{t("hr.back")}</Link>
          </div>
        </Card>
        {/* It opens when the event ends, before the results too. */}
        {eventId != null ? <NpsPrompt eventId={eventId} /> : null}
      </div>
    );
  }

  const { mine, winners, leaderboard, published } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {title}
        <p className="text-[12.5px]" style={ink("-3")}>{fill(t("hr.published_at"), { when: when(published.at) })}</p>
      </div>

      {mine ? <MyCard mine={mine} visibility={published.visibility} lang={lang} /> : <Notice tone="info">{t("hr.no_team")}</Notice>}

      {mine?.breakdown && mine.breakdown.length ? <BreakdownCard items={mine.breakdown} feedback={mine.feedback ?? []} /> : null}

      {eventId != null ? <MyCertificates eventId={eventId} /> : null}

      <WinnersCard winners={winners} myTeam={mine?.teamId ?? null} />

      {leaderboard ? <LeaderboardCard rows={leaderboard} myTeam={mine?.teamId ?? null} /> : null}

      {eventId != null ? <NpsPrompt eventId={eventId} /> : null}
    </div>
  );
}

function MyCard({ mine, visibility, lang }: { mine: MyResult; visibility: string; lang: string }) {
  const { t } = useTranslation();
  const m = mine.place != null ? medal(mine.place) : null;
  return (
    <Card>
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={ink("-3")}>{t("hr.your_team")}</p>
      <p className="mt-1 text-[20px] font-bold" style={ink()}>{mine.teamName}</p>

      {mine.won.length ? (
        <div className="mt-4 flex items-start gap-3 rounded-[12px] px-4 py-3" style={{ background: "var(--ok-weak)" }}>
          <PartyPopper size={20} aria-hidden="true" style={{ color: "var(--ok)" }} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold" style={ink()}>{t("hr.you_won")}</p>
            <p className="mt-0.5 text-[14px]" style={ink("-2")}>{mine.won.map((p) => p.name).join(", ")}</p>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3">
        {mine.place != null ? (
          <div>
            <p className="flex items-center gap-2 font-bold tracking-[-0.02em]" style={{ ...ink(), fontSize: "clamp(2rem, 6vw, 3rem)", lineHeight: 1 }}>
              {m ? <Medal aria-hidden="true" style={{ color: MEDAL_COLOUR[m], width: "0.8em", height: "0.8em" }} /> : null}
              {fill(t("hr.place"), { place: ordinal(mine.place, lang) })}
            </p>
            {mine.of ? <p className="mt-1 text-[13.5px]" style={ink("-2")}>{fill(t("hr.of"), { n: mine.of })}</p> : null}
          </div>
        ) : (
          <p className="text-[14px] leading-relaxed" style={ink("-2")}>{t(visibility === "winners" ? (mine.won.length ? "hr.winners_only_won" : "hr.winners_only") : "hr.not_ranked")}</p>
        )}
        {mine.score != null ? (
          <div>
            <p className="font-bold tabular-nums" style={{ ...ink(), fontSize: "clamp(1.5rem, 4vw, 2.25rem)", lineHeight: 1 }}>{formatScore(mine.score)}<span className="text-[15px] font-medium" style={ink("-3")}> / 100</span></p>
            <p className="mt-1 text-[13.5px]" style={ink("-2")}>{t("hr.score")}</p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function BreakdownCard({ items, feedback }: { items: BreakdownItem[]; feedback: string[] }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader title={t("hr.breakdown")} hint={t("hr.breakdown_hint")} />
      <ul className="space-y-3">
        {items.map((b) => {
          const pct = b.avg == null || b.max <= 0 ? 0 : Math.round((b.avg / b.max) * 100);
          return (
            <li key={b.criterionId}>
              <div className="flex items-baseline justify-between gap-3 text-[14px]">
                <span style={ink()}>{b.name}{b.weight !== 1 ? <span className="ml-1.5 text-[12px]" style={ink("-3")}>{fill(t("hr.weight"), { n: b.weight })}</span> : null}</span>
                <span className="tabular-nums" style={ink("-2")}>{b.avg == null ? "—" : `${formatScore(b.avg)} / ${formatScore(b.max)}`}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full" style={{ background: "var(--tint)" }} role="img" aria-label={fill(t("hr.bar"), { name: b.name, pct })}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--accent-solid)" }} />
              </div>
            </li>
          );
        })}
      </ul>
      {feedback.length ? (
        <section className="mt-6">
          <h3 className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.06em]" style={ink("-3")}>
            <MessageSquareQuote size={14} aria-hidden="true" />{t("hr.feedback")}
          </h3>
          <ul className="space-y-2.5">
            {feedback.map((f, i) => (
              <li key={i} className="rounded-[12px] border px-3.5 py-3 text-[14px] leading-relaxed" style={{ borderColor: "var(--line)", ...ink() }}>
                <span className="whitespace-pre-line">“{f}”</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Card>
  );
}

function WinnersCard({ winners, myTeam }: { winners: PrizeResult[]; myTeam: number | null }) {
  const { t } = useTranslation();
  const sorted = sortPrizes(winners);
  return (
    <Card>
      <CardHeader title={t("hr.winners")} />
      {sorted.length === 0 ? <p className="text-[14px]" style={ink("-3")}>{t("hr.winners_none")}</p> : (
        <ul className="space-y-2.5">
          {sorted.map(({ prize, teams }) => (
            <li key={prize.id} className="flex flex-wrap items-start justify-between gap-3 rounded-[12px] border px-3.5 py-3" style={{ borderColor: "var(--line)" }}>
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="mt-0.5 shrink-0">
                  {prize.kind === "place" ? <Trophy size={16} aria-hidden="true" style={{ color: MEDAL_COLOUR.gold }} />
                    : prize.kind === "track" ? <Layers size={16} aria-hidden="true" style={{ color: "var(--info)" }} />
                      : <Sparkles size={16} aria-hidden="true" style={{ color: "var(--accent)" }} />}
                </span>
                <div className="min-w-0">
                  <p className="font-medium" style={ink()}>{prize.name}</p>
                  {prize.value ? <p className="text-[12.5px]" style={ink("-3")}>{prize.value}</p> : null}
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-1.5">
                {teams.map((w) => (
                  <Badge key={w.teamId} tone={w.teamId === myTeam ? "ok" : "neutral"}>
                    {w.teamName}{w.teamId === myTeam ? ` · ${t("hr.yours")}` : ""}
                  </Badge>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function LeaderboardCard({ rows, myTeam }: { rows: LeaderboardRow[]; myTeam: number | null }) {
  const { t } = useTranslation();
  const scores = rows.some((r) => r.score != null);
  return (
    <Card padded={false}>
      <div className="px-5 pt-4"><CardHeader title={t("hr.leaderboard")} /></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-[14px]">
          <caption className="sr-only">{t("hr.leaderboard")}</caption>
          <thead>
            <tr className="text-left text-[11.5px] uppercase tracking-[0.06em]" style={ink("-3")}>
              <th scope="col" className="px-5 py-2 font-medium">{t("rs.col.place")}</th>
              <th scope="col" className="px-3 py-2 font-medium">{t("rs.col.team")}</th>
              {scores ? <th scope="col" className="px-5 py-2 text-right font-medium">{t("rs.col.score")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const mineRow = r.teamId === myTeam;
              return (
                <tr key={r.teamId} className="border-t" style={{ borderColor: "var(--line)", background: mineRow ? "var(--accent-weak)" : undefined }} aria-current={mineRow ? "true" : undefined}>
                  <td className="px-5 py-2.5 font-semibold tabular-nums" style={ink()}>{r.place}</td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium" style={ink()}>{r.teamName}{mineRow ? <span className="ml-2 text-[12px] font-normal" style={ink("-2")}>{t("hr.yours")}</span> : null}</p>
                    {r.projectName ? <p className="text-[12.5px]" style={ink("-3")}>{r.projectName}</p> : null}
                  </td>
                  {scores ? <td className="px-5 py-2.5 text-right font-semibold tabular-nums" style={ink()}>{formatScore(r.score)}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
