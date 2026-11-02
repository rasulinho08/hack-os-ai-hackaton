"use client";

/**
 * The participant's home: where they stand in their event — six stages from
 * registration to results — and the one thing to do next, a countdown to the
 * start or the project deadline, where the event happens, their team (or the
 * way to find one), the latest announcements and the event's resources.
 *
 * The event is the participant's own (participantEventId), never the
 * platform's "active" one, and the stages come from the API
 * (/api/me/event-progress), which knows the event's dates and the person's
 * state. The page refreshes every minute while it is open.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, BookOpen, Check, ChevronRight, Clock, Crown, ExternalLink, Lock, MapPin, Megaphone, Minus,
  Search, Send, Users, Video, X,
} from "lucide-react";
import { Badge, Card, buttonLook } from "@/components/ds/primitives";
import { Notice } from "@/components/builder/ui";
import { BrandLoader } from "@/components/BrandLoader";
import { LoadFailure } from "@/components/LoadFailure";
import { useTranslation } from "@/contexts/LanguageContext";
import { ApiError, apiGet } from "@/lib/api";
import {
  normalizeAnnouncementsList,
  safeFormatAnnouncementTime,
  type NormalizedAnnouncement,
} from "@/lib/announcements";
import { formatInZone, zoneLabel } from "@/lib/builder/datetime";
import { relativeFrom } from "@/lib/eventOverview";
import { fill } from "@/lib/i18n/fill";
import { participantEventId } from "@/lib/participantEvent";
import { eventEnded } from "@/lib/eventPhase";
import { VoteCallout } from "@/components/voting/VoteCallout";
import { GalleryCallout } from "@/components/gallery/GalleryCallout";
import { TicketCard } from "@/components/checkin/TicketCard";
import {
  STEPS_WITH_BUTTON, TIMED_STEPS, countdownTarget, normalizeProgress, statusTone, timeLeft,
  type Progress, type Stage, type StageState,
} from "@/lib/participantProgress";

const POLL_MS = 60_000;
const ink = (n: "" | "-2" | "-3" = "") => ({ color: `var(--ink${n})` });

/** Where the event happens, as the organiser set it in the builder (Format and place). */
interface EventInfo {
  id: number;
  name?: string | null;
  slug?: string | null;
  timezone?: string | null;
  format?: "online" | "offline" | "hybrid" | null;
  venue_name?: string | null;
  venue_address?: string | null;
  city?: string | null;
  map_url?: string | null;
  end_date?: string | null;
  /** Only sent to admitted participants and the event's team. */
  online_url?: string | null;
}

interface ResourceLink { id?: number; label: string; url?: string | null }

type State = "loading" | "ready" | "no_event" | "failed";

export default function HackerDashboard() {
  const { t, lang } = useTranslation();
  const [state, setState] = useState<State>("loading");
  const [eventId, setEventId] = useState<number | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [announcements, setAnnouncements] = useState<NormalizedAnnouncement[]>([]);
  const [resources, setResources] = useState<ResourceLink[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (eid: number) => {
    const [prog, ev, ann, res] = await Promise.allSettled([
      apiGet<unknown>(`/api/me/event-progress?eventId=${eid}`),
      apiGet<EventInfo>(`/api/events/${eid}`),
      apiGet<unknown[]>(`/api/announcements?eventId=${eid}`),
      apiGet<ResourceLink[]>(`/api/events/${eid}/resources`),
    ]);
    if (prog.status === "rejected") {
      const err = prog.reason;
      setState(err instanceof ApiError && (err.status === 404 || err.status === 403) ? "no_event" : "failed");
      return;
    }
    setProgress(normalizeProgress(prog.value));
    if (ev.status === "fulfilled" && ev.value) setEvent(ev.value);
    if (ann.status === "fulfilled") setAnnouncements(normalizeAnnouncementsList(ann.value ?? []));
    if (res.status === "fulfilled" && Array.isArray(res.value)) setResources(res.value.slice(0, 8));
    setState("ready");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const eid = await participantEventId();
      if (cancelled) return;
      if (eid == null) {
        setState("no_event");
        return;
      }
      setEventId(eid);
      await load(eid);
    })();
    return () => { cancelled = true; };
  }, [load]);

  useEffect(() => {
    if (eventId == null) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(eventId);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [eventId, load]);

  // The countdown ticks every second; nothing else depends on it.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (state === "loading") return <BrandLoader message={t("Loading")} fullMinHeight />;

  if (state !== "ready" || !progress) {
    return (
      <div className="space-y-6">
        <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={ink()}>{t("hacker.dashboard.title")}</h1>
        {state === "failed"
          ? <LoadFailure message={t("pg.load_failed")} onRetry={() => eventId != null && void load(eventId)} />
          : <Notice tone="info" icon={<Lock size={15} />}>{t("pg.no_event")}</Notice>}
      </div>
    );
  }

  const tz = event?.timezone || "Asia/Baku";
  const fmt = (iso: string) => formatInZone(iso, tz, lang, { year: undefined });
  const target = countdownTarget(progress, now);
  const left = target ? timeLeft(target.at, now) : null;
  const urgent = target?.kind === "deadline" && left != null && left.total > 0 && left.total <= 15 * 60 && !progress.submitted;
  const teamStage = progress.stages.find((s) => s.key === "team");
  const status = progress.participantStatus;

  return (
    <div className="space-y-6">
      {urgent && left ? (
        <div role="alert" className="flex items-start gap-3 rounded-[var(--radius)] border-2 p-4" style={{ borderColor: "var(--danger)", background: "var(--danger-weak)" }}>
          <Clock size={20} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: "var(--danger)" }} />
          <div className="min-w-0 flex-1">
            <p className="font-bold" style={{ color: "var(--danger)" }}>{fill(t("hacker.dashboard.urgent_title"), { n: Math.max(1, Math.ceil(left.total / 60)) })}</p>
            <p className="mt-1 text-[14px]" style={ink()}>{t("hacker.dashboard.urgent_body")}</p>
            <Link href="/hacker/submit" className={`mt-3 ${buttonLook("primary", "sm").className}`} style={buttonLook("primary", "sm").style}>
              <Send size={14} aria-hidden="true" />{t("hacker.dashboard.urgent_cta")}
            </Link>
          </div>
        </div>
      ) : null}

      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(status)} dot>{t(`pg.status.${["pending", "approved", "waitlisted", "rejected", "eliminated"].includes(status) ? status : "pending"}`)}</Badge>
          <span className="text-[12px]" style={ink("-3")}>{zoneLabel(tz)}</span>
        </div>
        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] [text-wrap:balance]" style={ink()}>{event?.name || t("hacker.dashboard.title")}</h1>
        <p className="text-[15px]" style={ink("-2")}>{t("pg.subtitle")}</p>
      </header>

      <NextStep progress={progress} fmt={fmt} />

      {/* The entrance ticket is for the door: gone once the event is over. */}
      {eventId != null && !eventEnded(event, now) ? <TicketCard eventId={eventId} timeZone={tz} /> : null}
      {eventId != null ? <VoteCallout eventId={eventId} /> : null}
      {eventId != null ? <GalleryCallout eventId={eventId} /> : null}

      <Stages stages={progress.stages} fmt={fmt} />

      {target && left ? (
        <Card>
          <p className="flex items-center gap-2 text-[13px]" style={ink("-2")}>
            <Clock size={14} aria-hidden="true" style={{ color: target.kind === "start" ? "var(--warn)" : "var(--accent)" }} />
            {t(target.kind === "start" ? "hacker.countdown.starts_in" : "hacker.countdown.ends_in")}
            <span style={ink("-3")}>· {fmt(target.at)}</span>
          </p>
          <p className="mt-3 flex flex-wrap items-baseline gap-x-1 tabular-nums" style={ink()} aria-live="off">
            {left.d > 0 ? <><span className="text-5xl font-bold">{left.d}</span><span className="mr-2 text-2xl" style={ink("-3")}>{t("common.time_unit_day")}</span></> : null}
            <span className="text-5xl font-bold">{String(left.h).padStart(2, "0")}</span><span className="mr-2 text-2xl" style={ink("-3")}>{t("common.time_unit_hour")}</span>
            <span className="text-5xl font-bold">{String(left.m).padStart(2, "0")}</span><span className="mr-2 text-2xl" style={ink("-3")}>{t("common.time_unit_minute")}</span>
            <span className="text-5xl font-bold">{String(left.s).padStart(2, "0")}</span><span className="text-2xl" style={ink("-3")}>{t("common.time_unit_second")}</span>
          </p>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <TeamCard progress={progress} teamState={teamStage?.state ?? null} closesAt={teamStage?.until ?? null} fmt={fmt} />
        {event && hasPlace(event) ? <WhereCard event={event} admitted={status === "approved"} /> : null}
      </div>

      <Card>
        <h2 className="mb-3 flex items-center gap-2 text-[16px] font-semibold" style={ink()}>
          <Megaphone size={16} aria-hidden="true" style={{ color: "var(--accent)" }} />
          {t("hacker.announcements.title")}
        </h2>
        {announcements.length ? (
          <ul className="space-y-2">
            {announcements.slice(0, 3).map((a) => (
              <li key={a.id} className="rounded-[var(--radius-sm)] px-4 py-3 text-[14px]"
                style={a.type === "urgent" ? { border: "1px solid var(--accent)", background: "var(--accent-weak)" } : { background: "var(--tint)" }}>
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0" style={ink()}>
                    {a.title ? <span className="font-semibold">{a.title}. </span> : null}
                    <span style={ink("-2")}>{a.content}</span>
                  </p>
                  <span className="shrink-0 text-[12px]" style={ink("-3")}>{safeFormatAnnouncementTime(a.created_at, lang)}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px]" style={ink("-3")}>{t("hacker.dashboard.announcements_empty")}</p>
        )}
        <Link href="/hacker/announcements" className="mt-3 inline-flex items-center gap-1 text-[13.5px] font-medium" style={{ color: "var(--accent)" }}>
          {t("hacker.dashboard.view_all")} <ChevronRight size={13} aria-hidden="true" />
        </Link>
      </Card>

      <Card>
        <h2 className="mb-3 flex items-center gap-2 text-[16px] font-semibold" style={ink()}>
          <BookOpen size={16} aria-hidden="true" style={{ color: "var(--accent)" }} />
          {t("hacker.resources.title")}
        </h2>
        {resources.length ? (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {resources.map((r, i) => {
              const external = Boolean(r.url?.startsWith("http"));
              return (
                <li key={r.id ?? i}>
                  <a href={r.url || "/hacker/resources"} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}
                    className="flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2.5 text-[13.5px] transition-colors hover:bg-[var(--tint)]"
                    style={{ border: "1px solid var(--line)", color: "var(--ink-2)" }}>
                    <ExternalLink size={13} aria-hidden="true" className="shrink-0" />
                    <span className="min-w-0 truncate">{r.label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[14px]" style={ink("-3")}>
            {t("hacker.dashboard.resources_empty")}{" "}
            <Link href="/hacker/resources" className="font-medium" style={{ color: "var(--accent)" }}>{t("hacker.dashboard.resources_page")}</Link>{" "}
            {t("hacker.dashboard.resources_later")}
          </p>
        )}
      </Card>
    </div>
  );
}

/** The one thing to do next, with its button when there is a page for it. */
function NextStep({ progress, fmt }: { progress: Progress; fmt: (iso: string) => string }) {
  const { t, lang } = useTranslation();
  const n = progress.next;
  const tone = n.code === "eliminated" || n.code === "rejected" || n.code === "missed_submission" ? "danger"
    : n.code === "submit" || n.code === "find_team" ? "accent" : "line";
  const border = tone === "danger" ? "var(--danger)" : tone === "accent" ? "var(--accent)" : "var(--line)";
  const cta = buttonLook(tone === "danger" ? "secondary" : "primary", "md");
  return (
    <section aria-labelledby="pg-next" className="rounded-[var(--radius)] border-2 p-5" style={{ borderColor: border, background: "var(--surface)" }}>
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={ink("-3")}>{t("pg.next_label")}</p>
      <h2 id="pg-next" className="mt-1 text-[20px] font-bold tracking-[-0.01em] [text-wrap:balance]" style={ink()}>{t(`pg.next.${n.code}`)}</h2>
      <p className="mt-1.5 max-w-2xl text-[14.5px]" style={ink("-2")}>{t(`pg.next_b.${n.code}`)}</p>
      {n.at && TIMED_STEPS.includes(n.code) ? (
        <p className="mt-2 flex items-center gap-1.5 text-[13.5px] font-medium tabular-nums" style={ink()}>
          <Clock size={14} aria-hidden="true" style={ink("-3")} />
          {fill(t(`pg.when.${n.code}`), { at: fmt(n.at), when: relativeFrom(n.at, lang) })}
        </p>
      ) : null}
      {n.href && STEPS_WITH_BUTTON.includes(n.code) ? (
        <Link href={n.href} className={`mt-4 ${cta.className}`} style={cta.style}>
          {t(`pg.cta.${n.code}`)}<ArrowRight size={15} aria-hidden="true" />
        </Link>
      ) : null}
    </section>
  );
}

const STATE_STYLE: Record<StageState, { ring: string; fill: string; fg: string }> = {
  done: { ring: "var(--ok)", fill: "var(--ok)", fg: "#fff" },
  current: { ring: "var(--accent)", fill: "var(--accent-solid)", fg: "#fff" },
  upcoming: { ring: "var(--line-strong)", fill: "var(--surface)", fg: "var(--ink-3)" },
  skipped: { ring: "var(--line)", fill: "var(--tint)", fg: "var(--ink-3)" },
  missed: { ring: "var(--danger)", fill: "var(--danger-weak)", fg: "var(--danger)" },
};

function StageDot({ state }: { state: StageState }) {
  const s = STATE_STYLE[state];
  const Icon = state === "done" ? Check : state === "missed" ? X : state === "skipped" ? Minus : null;
  return (
    <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2"
      style={{ borderColor: s.ring, background: s.fill, color: s.fg, boxShadow: state === "current" ? "0 0 0 4px var(--accent-weak)" : undefined }}>
      {Icon ? <Icon size={15} strokeWidth={2.5} /> : <span className="h-2 w-2 rounded-full" style={{ background: state === "current" ? "#fff" : "var(--line-strong)" }} />}
    </span>
  );
}

/** The six stages, left to right on wide screens and top to bottom on phones. */
function Stages({ stages, fmt }: { stages: Stage[]; fmt: (iso: string) => string }) {
  const { t } = useTranslation();
  const dateOf = (s: Stage) => {
    if (s.state === "done" || s.state === "skipped") return null;
    if (s.key === "registration" || s.key === "team" || s.key === "submission") return s.until ? fill(t("pg.until"), { at: fmt(s.until) }) : null;
    return s.at ? fmt(s.at) : null;
  };
  return (
    <Card>
      <h2 className="text-[16px] font-semibold" style={ink()}>{t("pg.stages")}</h2>
      <ol className="mt-4 grid gap-4 md:grid-cols-6 md:gap-2">
        {stages.map((s, i) => {
          const date = dateOf(s);
          return (
            <li key={s.key} className="relative flex items-start gap-3 md:flex-col md:items-center md:text-center"
              aria-current={s.state === "current" ? "step" : undefined}>
              {i < stages.length - 1 ? (
                <span aria-hidden="true" className="absolute hidden h-0.5 md:block" style={{ top: 15, left: "calc(50% + 20px)", right: "calc(-50% + 20px)", background: s.state === "done" ? "var(--ok)" : "var(--line)" }} />
              ) : null}
              <StageDot state={s.state} />
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold" style={s.state === "upcoming" || s.state === "skipped" ? ink("-2") : ink()}>{t(`pg.stage.${s.key}`)}</span>
                <span className="block text-[12.5px]" style={{ color: s.state === "missed" ? "var(--danger)" : s.state === "current" ? "var(--accent)" : "var(--ink-3)" }}>
                  {t(`pg.state.${s.state}`)}
                </span>
                {date ? <span className="block text-[12px] tabular-nums" style={ink("-3")}>{date}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function TeamCard({ progress, teamState, closesAt, fmt }: { progress: Progress; teamState: StageState | null; closesAt: string | null; fmt: (iso: string) => string }) {
  const { t } = useTranslation();
  const team = progress.team;
  const look = buttonLook("secondary", "sm");
  if (team) {
    return (
      <Card>
        <h2 className="mb-3 flex items-center gap-2 text-[16px] font-semibold" style={ink()}>
          <Users size={16} aria-hidden="true" style={{ color: "var(--accent)" }} />{t("pg.team.title")}
        </h2>
        <p className="text-[17px] font-semibold" style={ink()}>{team.name || t("pg.team.unnamed")}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]" style={ink("-2")}>
          <span>{fill(t("pg.team.size"), { n: team.size })}</span>
          {team.isLead ? <span className="inline-flex items-center gap-1"><Crown size={13} aria-hidden="true" style={{ color: "var(--warn)" }} />{t("pg.team.you_lead")}</span> : null}
          <Badge tone={progress.submitted ? "ok" : "warn"}>{t(progress.submitted ? "pg.team.submitted" : "pg.team.not_submitted")}</Badge>
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/hacker/team" className={look.className} style={look.style}>{t("pg.team.open")}<ChevronRight size={13} aria-hidden="true" /></Link>
        </div>
      </Card>
    );
  }
  if (teamState === "current") {
    const primary = buttonLook("primary", "sm");
    return (
      <Card style={{ borderColor: "var(--accent)" }}>
        <h2 className="mb-2 flex items-center gap-2 text-[16px] font-semibold" style={ink()}>
          <Search size={16} aria-hidden="true" style={{ color: "var(--accent)" }} />{t("pg.team.find_title")}
        </h2>
        <p className="text-[14px]" style={ink("-2")}>{t("pg.team.find_body")}</p>
        {closesAt ? <p className="mt-1 text-[13px]" style={ink("-3")}>{fill(t("pg.team.closes"), { at: fmt(closesAt) })}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/hacker/lobby" className={primary.className} style={primary.style}>{t("pg.team.find_cta")}<ArrowRight size={14} aria-hidden="true" /></Link>
          <Link href="/hacker/team" className={look.className} style={look.style}>{t("pg.team.join_code")}</Link>
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <h2 className="mb-2 flex items-center gap-2 text-[16px] font-semibold" style={ink()}>
        <Users size={16} aria-hidden="true" style={ink("-3")} />{t("pg.team.title")}
      </h2>
      <p className="text-[14px]" style={ink("-2")}>
        {t(teamState !== "skipped" ? "pg.team.later" : progress.registrationMode === "solo" ? "pg.team.solo" : "pg.team.closed")}
      </p>
    </Card>
  );
}

/** A venue to show, or an online part (its link, or the note that it comes later). */
function hasPlace(event: EventInfo): boolean {
  const venue = event.format !== "online" && Boolean(event.venue_name || event.venue_address || event.city);
  return venue || event.format === "online" || event.format === "hybrid" || Boolean(event.online_url);
}

function WhereCard({ event, admitted }: { event: EventInfo; admitted: boolean }) {
  const { t } = useTranslation();
  const primary = buttonLook("primary", "sm");
  const showVenue = event.format !== "online" && (event.venue_name || event.venue_address || event.city);
  const showOnline = event.format === "online" || event.format === "hybrid";
  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 text-[16px] font-semibold" style={ink()}>
        <MapPin size={16} aria-hidden="true" style={{ color: "var(--accent)" }} />{t("hacker.where.title")}
      </h2>
      <div className="space-y-3 text-[14px]">
        {showVenue ? (
          <div>
            {event.venue_name ? <p className="font-semibold" style={ink()}>{event.venue_name}</p> : null}
            {event.venue_address || event.city ? <p style={ink("-2")}>{[event.venue_address, event.city].filter(Boolean).join(", ")}</p> : null}
            {event.map_url ? (
              <a href={event.map_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1.5 text-[13.5px] font-medium" style={{ color: "var(--accent)" }}>
                {t("hacker.where.map")} <ExternalLink size={12} aria-hidden="true" />
              </a>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {showOnline ? (
            event.online_url ? (
              <a href={event.online_url} target="_blank" rel="noreferrer" className={primary.className} style={primary.style}>
                <Video size={15} aria-hidden="true" />{t("hacker.where.join_online")}
              </a>
            ) : (
              <p className="text-[13.5px]" style={ink("-3")}>{t(admitted ? "hacker.where.link_later" : "pg.where.after_approval")}</p>
            )
          ) : null}
          {event.slug ? (
            <Link href={`/e/${event.slug}`} className="inline-flex items-center gap-1 text-[13.5px]" style={ink("-2")}>
              {t("hacker.where.event_page")} <ChevronRight size={12} aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
