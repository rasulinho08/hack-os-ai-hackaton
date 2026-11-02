"use client";

/**
 * The organiser's home for one event: where it is and what comes next, the
 * few things that need someone now, the counts, the latest activity and the
 * event's dates — all from one call (GET /api/events/:id/overview), refreshed
 * every half minute while the tab is open.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle, AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, ClipboardList, ExternalLink, FileText,
  GraduationCap, HelpCircle, Info, Megaphone, Pencil, RefreshCw, Rocket, UserPlus, Users, UsersRound,
  type LucideIcon,
} from "lucide-react";
import { Badge, Button, Card, Progress, buttonLook } from "@/components/ds/primitives";
import { BrandLoader } from "@/components/BrandLoader";
import { LoadFailure } from "@/components/LoadFailure";
import { useTranslation } from "@/contexts/LanguageContext";
import { apiGet } from "@/lib/api";
import { formatInZone, zoneLabel } from "@/lib/builder/datetime";
import { useDemoBasePath } from "@/lib/demoPath";
import { fill } from "@/lib/i18n/fill";
import {
  activityGroup, activityWords, alertWords, isLivePhase, normalizeOverview, phaseTone, relativeFrom,
  type ActivityItem, type Overview, type OverviewAlert,
} from "@/lib/eventOverview";

const POLL_MS = 30_000;
const FEED_SHORT = 12;

const ink = (n: "" | "-2" | "-3" = "") => ({ color: `var(--ink${n})` });
const box: React.CSSProperties = { borderColor: "var(--line)", background: "var(--surface)" };
const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

type Fmt = (iso: string) => string;

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Baku";
  } catch {
    return "Asia/Baku";
  }
}

export function EventHome({ eventId }: { eventId: number }) {
  const { t, lang } = useTranslation();
  const base = useDemoBasePath();
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = normalizeOverview(await apiGet<unknown>(`/api/events/${eventId}/overview`));
      if (!next) throw new Error("bad overview");
      setData(next);
      setFailed(false);
    } catch {
      // A refresh that fails keeps what is on screen; only a first load shows the failure.
      setFailed(true);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    const onShow = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const tz = data?.event.timezone || browserZone();
  const time = useCallback<Fmt>((iso) => formatInZone(iso, tz, lang, { year: undefined }), [tz, lang]);
  const href = useCallback((path: string) => `${base}${path}`, [base]);

  if (!data) {
    return failed
      ? <LoadFailure message={t("ov.load_failed")} onRetry={() => void refresh()} />
      : <BrandLoader message={t("Loading")} fullMinHeight />;
  }

  return (
    <div className="space-y-6">
      <Header data={data} time={time} tz={tz} href={href} refreshing={refreshing} onRefresh={() => void refresh()} />
      <Alerts alerts={data.alerts} time={time} href={href} />
      <Kpis data={data} time={time} href={href} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2"><ActivityFeed items={data.activity} time={time} /></div>
        <div className="min-w-0"><Dates data={data} time={time} tz={tz} /></div>
      </div>
      {failed ? <p className="text-[12.5px]" style={ink("-3")} role="status">{t("ov.refresh_failed")}</p> : null}
    </div>
  );
}

function Header({ data: d, time, tz, href, refreshing, onRefresh }: {
  data: Overview; time: Fmt; tz: string; href: (p: string) => string; refreshing: boolean; onRefresh: () => void;
}) {
  const { t, lang } = useTranslation();
  const phase = d.phase;
  const until = phase.until ? fill(t(`ov.until.${phase.key}`), { when: relativeFrom(phase.until, lang), at: time(phase.until) }) : null;
  const edit = buttonLook("secondary", "sm");
  const pub = buttonLook("ghost", "sm");
  return (
    <Card>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={phaseTone(phase.key)} dot={isLivePhase(phase.key)}>{t(`ov.phase.${phase.key}`)}</Badge>
            <span className="text-[12px]" style={ink("-3")}>{zoneLabel(tz)}</span>
          </div>
          <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em] [text-wrap:balance]" style={ink()}>{d.event.name}</h1>
          <p className="max-w-2xl text-[14.5px]" style={ink("-2")}>{until ?? t(`ov.phase_hint.${phase.key}`)}</p>
          {d.next && d.next.at !== phase.until ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13.5px]" style={ink("-2")}>
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock size={14} aria-hidden="true" style={ink("-3")} />
                <span className="font-medium" style={ink()}>{t("ov.next")}</span>
                <span>{t(`ov.ms.${d.next.key}`)}</span>
              </span>
              <span className="tabular-nums" style={ink("-3")}>{time(d.next.at)} · {relativeFrom(d.next.at, lang)}</span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <Link href={href(`/create-event/${d.event.id}`)} className={edit.className} style={edit.style}>
            <Pencil size={14} aria-hidden="true" />{t("ov.edit")}
          </Link>
          {d.event.slug && phase.key !== "draft" ? (
            <a href={`/e/${d.event.slug}`} target="_blank" rel="noreferrer" className={pub.className} style={pub.style}>
              <ExternalLink size={14} aria-hidden="true" />{t("ov.public_page")}
            </a>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onRefresh} aria-label={t("ov.refresh")}
            icon={<RefreshCw size={14} aria-hidden="true" className={refreshing ? "animate-spin" : undefined} />}>
            <span className="hidden sm:inline">{t("ov.refresh")}</span>
          </Button>
        </div>
      </div>
    </Card>
  );
}

const SEVERITY_ICON: Record<OverviewAlert["severity"], LucideIcon> = { danger: AlertTriangle, warn: AlertCircle, info: Info };

function Alerts({ alerts, time, href }: { alerts: OverviewAlert[]; time: Fmt; href: (p: string) => string }) {
  const { t } = useTranslation();
  if (!alerts.length) {
    return (
      <p className="flex items-center gap-2.5 rounded-[var(--radius)] border px-4 py-3 text-[14px]" style={{ ...box, color: "var(--ink-2)" }}>
        <CheckCircle2 size={16} aria-hidden="true" style={{ color: "var(--ok)" }} />
        {t("ov.all_clear")}
      </p>
    );
  }
  return (
    <section aria-labelledby="ov-attention" className="space-y-2.5">
      <h2 id="ov-attention" className="text-[16px] font-semibold" style={ink()}>{t("ov.attention")}</h2>
      <ul className="grid gap-2.5 md:grid-cols-2">
        {alerts.map((a) => {
          const Icon = SEVERITY_ICON[a.severity];
          const words = alertWords(a, t, time);
          const color = `var(--${a.severity})`;
          return (
            <li key={a.code}>
              <Link href={href(a.href)} className={`group flex h-full items-start gap-3 rounded-[var(--radius)] border px-4 py-3 ${focusRing}`}
                style={{ borderColor: color, background: `var(--${a.severity}-weak)` }}>
                <Icon size={17} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium" style={ink()}>{words.title}</span>
                  {words.details.length ? (
                    <span className="mt-1 block space-y-0.5">
                      {words.details.slice(0, 5).map((d) => (
                        <span key={d} className="block truncate text-[12.5px]" style={ink("-2")}>{d}</span>
                      ))}
                      {words.details.length > 5 ? (
                        <span className="block text-[12.5px]" style={ink("-3")}>{fill(t("ov.alert.judges_more"), { n: words.details.length - 5 })}</span>
                      ) : null}
                    </span>
                  ) : null}
                  <span className="mt-0.5 inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ color }}>
                    {words.action}<ArrowRight size={12} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Kpis({ data: d, time, href }: { data: Overview; time: Fmt; href: (p: string) => string }) {
  const { t } = useTranslation();
  const k = d.kpis;
  const p = k.participants;
  const cap = p.capacity;
  const v = k.volunteers;
  return (
    <section aria-label={t("ov.numbers")} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi href={href("/participants")} icon={Users} label={t("ov.k.participants")} value={p.total}
          lines={[
            fill(t("ov.k.participants_line"), { approved: p.byStatus.approved, pending: p.byStatus.pending }),
            p.byStatus.waitlisted ? fill(t("ov.k.waitlisted"), { n: p.byStatus.waitlisted }) : null,
            p.new24h ? fill(t("ov.k.new24h"), { n: p.new24h }) : null,
          ]}>
          {cap.limit != null ? (
            <div className="mt-3">
              <Progress value={Math.round((cap.taken / Math.max(1, cap.limit)) * 100)} tone={cap.full ? "warn" : "brand"} />
              <p className="mt-1 text-[12px] tabular-nums" style={ink("-3")}>{fill(t("ov.k.seats"), { taken: cap.taken, limit: cap.limit })}</p>
            </div>
          ) : null}
        </Kpi>
        <Kpi href={href("/teams")} icon={UsersRound} label={t("ov.k.teams")} value={k.teams.active}
          lines={[
            k.teams.teamlessApproved ? fill(t("ov.k.teamless"), { n: k.teams.teamlessApproved }) : t("ov.k.everyone_in_team"),
            k.teams.looking ? fill(t("ov.k.looking"), { n: k.teams.looking }) : null,
            k.teams.eliminated ? fill(t("ov.k.eliminated"), { n: k.teams.eliminated }) : null,
          ]} />
        <Kpi href={href("/submissions")} icon={FileText} label={t("ov.k.projects")} value={k.submissions.total}
          lines={[
            !k.teams.active ? t("ov.k.no_teams_yet")
              : k.teams.withoutSubmission ? fill(t("ov.k.without_project"), { n: k.teams.withoutSubmission }) : t("ov.k.all_handed_in"),
          ]} />
        <Kpi href={href("/help-queue")} icon={HelpCircle} label={t("ov.k.help")} value={k.help.open} danger={k.help.waitingLong > 0}
          lines={[
            fill(t("ov.k.help_line"), { n: k.help.inProgress }),
            k.help.medianWaitMin != null ? fill(t("ov.k.median_wait"), { n: k.help.medianWaitMin }) : null,
            k.help.resolved24h ? fill(t("ov.k.resolved24h"), { n: k.help.resolved24h }) : null,
          ]} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Small href={href("/mentors")} icon={GraduationCap} label={t("ov.k.mentors")}
          value={k.mentors.total ? fill(t("ov.k.mentors_value"), { online: k.mentors.online, total: k.mentors.total }) : t("ov.k.mentors_none")} />
        <Small href={href("/volunteers")} icon={ClipboardList} label={t("ov.k.tasks")}
          value={v.tasksOpen
            ? fill(t(v.tasksOverdue ? "ov.k.tasks_value_overdue" : "ov.k.tasks_value"), { open: v.tasksOpen, overdue: v.tasksOverdue })
            : t("ov.k.tasks_none")} />
        <Small href={href("/announcements")} icon={Megaphone} label={t("ov.k.announcements")}
          value={fill(t("ov.k.announcements_value"), { sent: k.announcements.sent, scheduled: k.announcements.scheduled })}
          hint={k.announcements.nextScheduledAt ? fill(t("ov.k.next_announcement"), { at: time(k.announcements.nextScheduledAt) }) : null} />
      </div>
    </section>
  );
}

function Kpi({ href, icon: Icon, label, value, lines, danger = false, children }: {
  href: string; icon: LucideIcon; label: string; value: number; lines: (string | null)[]; danger?: boolean; children?: React.ReactNode;
}) {
  return (
    <Link href={href} className={`block rounded-[var(--radius)] border p-4 transition-colors hover:border-[var(--line-strong)] ${focusRing}`} style={box}>
      <span className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium uppercase tracking-[0.08em]" style={ink("-3")}>{label}</span>
        <Icon size={16} aria-hidden="true" style={ink("-3")} />
      </span>
      <span className="mt-2 block text-[28px] font-bold leading-none tabular-nums" style={{ color: danger ? "var(--danger)" : "var(--ink)" }}>
        {value.toLocaleString()}
      </span>
      <span className="mt-2 block space-y-0.5">
        {lines.filter((l): l is string => Boolean(l)).map((l) => <span key={l} className="block text-[13px]" style={ink("-2")}>{l}</span>)}
      </span>
      {children}
    </Link>
  );
}

function Small({ href, icon: Icon, label, value, hint }: { href: string; icon: LucideIcon; label: string; value: string; hint?: string | null }) {
  return (
    <Link href={href} className={`flex items-center gap-3 rounded-[var(--radius)] border px-4 py-3 transition-colors hover:border-[var(--line-strong)] ${focusRing}`} style={box}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--tint)" }}>
        <Icon size={16} aria-hidden="true" style={ink("-2")} />
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] font-medium uppercase tracking-[0.08em]" style={ink("-3")}>{label}</span>
        <span className="block text-[14px] font-semibold" style={ink()}>{value}</span>
        {hint ? <span className="block text-[12px]" style={ink("-3")}>{hint}</span> : null}
      </span>
    </Link>
  );
}

const GROUP_ICON: Record<ReturnType<typeof activityGroup>, LucideIcon> = {
  people: UserPlus,
  teams: UsersRound,
  projects: FileText,
  help: HelpCircle,
  news: Megaphone,
  staff: GraduationCap,
  event: Rocket,
};

/** The latest things that happened, newest first; twelve at a time. */
function ActivityFeed({ items, time }: { items: ActivityItem[]; time: Fmt }) {
  const { t, lang } = useTranslation();
  const [all, setAll] = useState(false);
  const shown = useMemo(() => (all ? items : items.slice(0, FEED_SHORT)), [items, all]);
  return (
    <Card>
      <h2 className="text-[16px] font-semibold" style={ink()}>{t("ov.activity")}</h2>
      {shown.length ? (
        <ul className="mt-2">
          {shown.map((x, i) => {
            const Icon = GROUP_ICON[activityGroup(x.type)];
            return (
              <li key={x.id} className="flex items-start gap-3 py-2.5" style={i ? { borderTop: "1px solid var(--line)" } : undefined}>
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--tint)" }}>
                  <Icon size={14} aria-hidden="true" style={ink("-2")} />
                </span>
                <p className="min-w-0 flex-1 break-words text-[14px]" style={ink()}>{activityWords(x, t)}</p>
                <time dateTime={x.at} title={time(x.at)} className="shrink-0 pt-0.5 text-[12px] tabular-nums" style={ink("-3")}>
                  {relativeFrom(x.at, lang)}
                </time>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-[13.5px]" style={ink("-3")}>{t("ov.no_activity")}</p>
      )}
      {items.length > FEED_SHORT ? (
        <div className="mt-2">
          <Button size="sm" variant="ghost" onClick={() => setAll((x) => !x)} aria-expanded={all}>
            {all ? t("ov.show_less") : fill(t("ov.show_all"), { n: items.length })}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function Dates({ data: d, time, tz }: { data: Overview; time: Fmt; tz: string }) {
  const { t, lang } = useTranslation();
  return (
    <Card>
      <h2 className="text-[16px] font-semibold" style={ink()}>{t("ov.dates")}</h2>
      <p className="mt-0.5 text-[12.5px]" style={ink("-3")}>{fill(t("ov.dates_zone"), { zone: zoneLabel(tz) })}</p>
      {d.milestones.length ? (
        <ol className="mt-4">
          {d.milestones.map((m, i) => (
            <li key={m.key} className="relative flex gap-3 pb-4 last:pb-0">
              {i < d.milestones.length - 1 ? (
                <span aria-hidden="true" className="absolute left-[7px] top-5 h-[calc(100%-12px)] w-px" style={{ background: m.state === "done" ? "var(--ok)" : "var(--line)" }} />
              ) : null}
              <span aria-hidden="true" className="relative mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-2"
                style={m.state === "done"
                  ? { background: "var(--ok)", borderColor: "var(--ok)" }
                  : m.state === "next"
                    ? { background: "var(--surface)", borderColor: "var(--accent)", boxShadow: "0 0 0 3px var(--accent-weak)" }
                    : { background: "var(--surface)", borderColor: "var(--line-strong)" }} />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-[14px] font-medium" style={m.state === "upcoming" ? ink("-2") : ink()}>
                  {t(`ov.ms.${m.key}`)}
                  {m.state === "next" ? <Badge tone="brand">{t("ov.next_badge")}</Badge> : null}
                  <span className="sr-only">{t(`ov.ms_state.${m.state}`)}</span>
                </span>
                <span className="block text-[12.5px] tabular-nums" style={ink("-3")}>
                  {time(m.at)}{m.state !== "done" ? ` · ${relativeFrom(m.at, lang)}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-[13.5px]" style={ink("-3")}>{t("ov.no_dates")}</p>
      )}
    </Card>
  );
}
