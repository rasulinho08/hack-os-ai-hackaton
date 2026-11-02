/**
 * The registration page's building blocks: the field look shared by every
 * control (16px text on phones so iOS does not zoom in, 48px tall), the
 * page's two-column layout, and the event summary that tells a visitor what
 * they are signing up for before they type anything.
 */

import type { CSSProperties, ReactNode } from "react";
import { BadgeCheck, CalendarDays, Clock, Hourglass, MapPin, Monitor, ShieldCheck, Shuffle, User, Users } from "lucide-react";
import { formatInZone } from "@/lib/builder/datetime";
import { countryName } from "@/lib/builder/countries";
import type { PublicEvent } from "@/lib/builder/public";
import type { Lang } from "@/lib/i18n";

/** A text-like control. Border colours come from fieldStyle so an error survives hover and focus. */
export const fieldClass =
  "block w-full min-h-12 rounded-[12px] border px-3.5 py-2.5 text-[16px] leading-snug outline-none transition-[border-color,box-shadow] "
  + "border-[color:var(--rf-border)] hover:border-[color:var(--rf-hover)] focus:border-[color:var(--rf-focus)] "
  + "focus:shadow-[0_0_0_4px_var(--rf-ring)] placeholder:text-[color:var(--ink-3)] sm:text-[15px]";

export function fieldStyle(err?: string | null): CSSProperties {
  return {
    background: "var(--surface)",
    color: "var(--ink)",
    // Focus is the accent border plus a ring (below), not the site-wide outline that would sit on top of the border.
    outline: "none",
    ["--rf-border" as string]: err ? "var(--danger)" : "var(--line-strong)",
    ["--rf-hover" as string]: err ? "var(--danger)" : "color-mix(in srgb, var(--ink) 32%, transparent)",
    ["--rf-focus" as string]: err ? "var(--danger)" : "var(--accent-solid)",
    ["--rf-ring" as string]: `color-mix(in srgb, ${err ? "var(--danger)" : "var(--accent-solid)"} 22%, transparent)`,
  };
}

/** A card on the page: one step of the form, a notice, the result. */
export const panelClass = "rounded-[20px] border";
export const panelStyle: CSSProperties = { borderColor: "var(--line)", background: "var(--surface)", boxShadow: "0 1px 2px rgba(20,22,28,0.04)" };

export const primaryButton = "inline-flex min-h-12 items-center justify-center gap-2 rounded-[12px] px-6 text-[15px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:opacity-60 disabled:hover:brightness-100";
export const secondaryButton = "inline-flex min-h-12 items-center justify-center gap-2 rounded-[12px] border px-5 text-[15px] font-medium transition-colors hover:bg-[var(--tint)]";
export const secondaryStyle: CSSProperties = { borderColor: "var(--line-strong)", color: "var(--ink)", background: "var(--surface)" };

/**
 * Summary first (on top on phones, a column on the right on wide
 * screens), then what the page is for.
 */
export function RegisterLayout({ aside, children }: { aside: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-10 xl:gap-12">
      <aside className="min-w-0 space-y-4 lg:col-start-2 lg:row-start-1 lg:self-start">{aside}</aside>
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">{children}</div>
    </div>
  );
}

/**
 * The event at a glance, painted like the top of its public page so the
 * registration reads as the same place: when, where, how people take part,
 * places left and the deadline, and whether the place is confirmed at once.
 */
export function EventSummary({
  event, lang, t, f, heading = "h1",
}: {
  event: PublicEvent;
  lang: Lang;
  t: (k: string) => string;
  f: (k: string, p: Record<string, string | number>) => string;
  /** The page's title on the form; a plain line where a notice or the result is the title. */
  heading?: "h1" | "p";
}) {
  const tz = event.timezone || "Asia/Baku";
  const day = (iso: string | null) => formatInZone(iso, tz, lang, { hour: undefined, minute: undefined });
  const sameDay = day(event.start_date) === day(event.end_date);
  const dates = sameDay
    ? `${formatInZone(event.start_date, tz, lang)}–${formatInZone(event.end_date, tz, lang, { day: undefined, month: undefined, year: undefined })}`
    : `${day(event.start_date)} – ${day(event.end_date)}`;
  const FormatIcon = event.format === "online" ? Monitor : event.format === "hybrid" ? Shuffle : MapPin;
  const where = event.format === "online"
    ? t("ep.online")
    : [event.venue_name, event.city, event.country ? countryName(event.country, lang) : null].filter(Boolean).join(", ");
  const place = event.format === "hybrid" && where ? `${where} · ${t("b.place.hybrid")}` : where || t(`b.place.${event.format}`);
  const teamsClosed = event.registration.teamFormation && !event.registration.teamFormation.open && event.registration.teamFormation.reason === "deadline";
  const mode = event.registration_mode === "solo"
    ? t("rg.sum.solo")
    : teamsClosed
      ? f("rg.sum.teams_closed", { min: event.min_team_size, max: event.team_size_limit })
      : event.registration_mode === "team"
      ? f("ep.team_size", { min: event.min_team_size, max: event.team_size_limit })
      : f("rg.sum.both", { min: event.min_team_size, max: event.team_size_limit });
  const reg = event.registration;
  const left = reg.limit != null ? Math.max(0, reg.limit - reg.taken) : null;
  const H = heading;

  return (
    <section aria-label={event.name} className="relative overflow-hidden rounded-[20px] border" style={{ background: "var(--inverse)", borderColor: "var(--line)", color: "var(--on-inverse)" }}>
      <div className="absolute inset-0" aria-hidden="true"
        style={{ background: event.banner_url ? `center / cover no-repeat url(${event.banner_url})` : "radial-gradient(520px 220px at 0% 0%, color-mix(in srgb, var(--accent-solid) 50%, transparent), transparent)" }} />
      {event.banner_url ? <div className="absolute inset-0" aria-hidden="true" style={{ background: "linear-gradient(180deg, rgba(20,24,31,0.55) 0%, rgba(20,24,31,0.92) 100%)" }} /> : null}
      <div className="relative p-5 sm:p-6">
        <div className="flex items-center gap-3">
          {event.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={event.logo_url} alt="" className="h-10 w-10 shrink-0 rounded-[10px] border bg-white object-cover" style={{ borderColor: "rgba(251,250,248,0.6)" }} />
          ) : null}
          {event.organiser ? <span className="min-w-0 truncate text-[12.5px] font-medium" style={{ color: "var(--on-inverse-2)" }}>{event.organiser.name}</span> : null}
        </div>
        <H className={`${event.logo_url || event.organiser ? "mt-4" : ""} min-w-0`}>
          <span className="block text-[11.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: "color-mix(in srgb, var(--on-inverse) 70%, transparent)" }}>{t("rg.title")}</span>
          <span className="mt-1.5 block break-words text-[24px] font-semibold leading-[1.15] tracking-tight sm:text-[26px]" style={{ fontFamily: "var(--font-display)", textWrap: "balance" }}>{event.name}</span>
        </H>
        <ul className="mt-4 grid gap-2 text-[13.5px]" style={{ color: "color-mix(in srgb, var(--on-inverse) 88%, transparent)" }}>
          <li className="flex items-start gap-2.5"><CalendarDays size={15} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{dates}</span></li>
          <li className="flex items-start gap-2.5"><FormatIcon size={15} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{place}</span></li>
          <li className="flex items-start gap-2.5">{event.registration_mode === "solo" ? <User size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> : <Users size={15} className="mt-0.5 shrink-0" aria-hidden="true" />}<span>{mode}</span></li>
        </ul>
      </div>
      <div className="relative grid gap-2.5 border-t empty:hidden px-5 py-4 text-[13px] sm:px-6" style={{ borderColor: "rgba(251,250,248,0.12)", background: "rgba(0,0,0,0.18)", color: "color-mix(in srgb, var(--on-inverse) 85%, transparent)" }}>
        {reg.limit != null && reg.state === "open" ? (
          reg.full ? (
            <p className="flex items-center gap-2.5 font-medium"><Hourglass size={15} className="shrink-0" aria-hidden="true" style={{ color: "#F0B429" }} />{reg.waitlistEnabled ? t("rg.sum.waitlist") : t("ep.cta.full")}</p>
          ) : (
            <div>
              <p className="flex items-center justify-between gap-3 font-medium"><span>{f("ep.places_left", { n: left ?? 0, limit: reg.limit })}</span></p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "rgba(251,250,248,0.14)" }} aria-hidden="true">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(4, (reg.taken / Math.max(1, reg.limit)) * 100))}%`, background: "var(--accent-solid)" }} />
              </div>
            </div>
          )
        ) : null}
        {reg.state === "open" && event.registration_end ? (
          <p className="flex items-center gap-2.5"><Clock size={15} className="shrink-0" aria-hidden="true" />{f("rg.sum.closes", { date: formatInZone(event.registration_end, tz, lang) })}</p>
        ) : null}
        {/* Once it is full, everyone new goes to the waitlist, whatever the approval. */}
        {reg.state === "open" && !reg.full ? (
          <p className="flex items-center gap-2.5">
            {reg.approval === "auto" ? <BadgeCheck size={15} className="shrink-0" aria-hidden="true" /> : <ShieldCheck size={15} className="shrink-0" aria-hidden="true" />}
            {reg.approval === "auto" ? t("rg.sum.approval_auto") : t("rg.sum.approval_manual")}
          </p>
        ) : null}
      </div>
    </section>
  );
}
