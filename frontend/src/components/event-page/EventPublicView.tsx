"use client";

/**
 * The public page of one event, as visitors see it and as the organiser
 * previews it in the builder.
 *
 * It speaks the event's language first (the organiser chose it), with a
 * switch for visitors who read another. Times are shown on the event's own
 * clock with the zone named. The brand colour, when the plan includes it,
 * becomes the page's accent.
 */

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import {
  Award, CalendarDays, CheckCircle2, ChevronDown, Clock, ExternalLink, Gavel, Globe2, MapPin, Monitor, Moon, Shuffle, Sun, Trophy, Users,
} from "lucide-react";
import { useSiteTheme } from "@/app/(site)/_theme";
import { resolve, type Lang } from "@/lib/i18n";
import { formatInZone, zoneLabel } from "@/lib/builder/datetime";
import { countryName } from "@/lib/builder/countries";
import type { PublicEvent } from "@/lib/builder/public";
import { AddToCalendar } from "./AddToCalendar";

const LANGS: Lang[] = ["az", "en", "ru"];

function paragraphs(text: string | null): string[] {
  return String(text || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 border-t py-10 sm:py-12" style={{ borderColor: "var(--line)" }}>
      <h2 id={`${id}-h`} className="text-[22px] font-semibold tracking-tight sm:text-[26px]" style={{ color: "var(--ink)", fontFamily: "var(--font-display)", textWrap: "balance" }}>{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** The event's look on its own pages: the `.hs` scope, with the brand colour as accent. */
export function eventTheme(event: Pick<PublicEvent, "brand_color">): React.CSSProperties {
  const accent = event.brand_color || undefined;
  return {
    background: "var(--surface-sunken)",
    color: "var(--ink)",
    ...(accent ? { ["--accent-solid" as string]: accent, ["--accent" as string]: accent, ["--hs-brand" as string]: accent, ["--hs-brand-solid" as string]: accent } : {}),
  };
}

export function EventPublicView({
  event, registerHref, preview = false, refParam,
}: {
  event: PublicEvent;
  registerHref?: string;
  preview?: boolean;
  refParam?: string | null;
}) {
  const [lang, setLang] = useState<Lang>(event.language || "az");
  const t = (k: string) => resolve(lang, k);
  const f = (k: string, p: Record<string, string | number>) => Object.entries(p).reduce((s, [a, b]) => s.replace(`{${a}}`, String(b)), t(k));
  // Visitors get the public site's light or dark theme; the builder's preview stays as the organiser's console draws it.
  const { theme, toggle } = useSiteTheme();
  const dark = !preview && theme === "dark";
  const tz = event.timezone || "Asia/Baku";
  const when = (iso: string | null, opts?: Intl.DateTimeFormatOptions) => formatInZone(iso, tz, lang, opts);
  const reg = event.registration;
  const features = (event as PublicEvent & { features?: { calendar?: boolean; projects?: boolean } }).features;
  const href = registerHref || `/e/${event.slug}/register${refParam ? `?ref=${encodeURIComponent(refParam)}` : ""}`;

  const places = event.prizes.filter((p) => p.kind === "place").sort((a, b) => (a.position || 0) - (b.position || 0));
  const others = event.prizes.filter((p) => p.kind !== "place");
  const trackName = (id: number | null) => event.tracks.find((tr) => tr.id === id)?.name || "";
  const tiers = useMemo(() => {
    const order = ["platinum", "gold", "silver", "bronze", "partner", ""];
    const groups: Record<string, PublicEvent["sponsors"]> = {};
    for (const s of event.sponsors) (groups[s.tier || ""] ||= []).push(s);
    return order.filter((k) => groups[k]?.length).map((k) => ({ tier: k, items: groups[k] }));
  }, [event.sponsors]);

  const inviteOnly = event.visibility === "invite";
  const cta = (() => {
    if (inviteOnly) return { label: t("ep.cta.invite"), disabled: true };
    if (reg.state === "not_open") return { label: f("ep.cta.opens", { date: when(event.registration_start) }), disabled: true };
    if (reg.state === "closed") return { label: t("ep.cta.closed"), disabled: true };
    if (reg.full && !reg.waitlistEnabled) return { label: t("ep.cta.full"), disabled: true };
    if (reg.full) return { label: t("ep.cta.waitlist"), disabled: false };
    return { label: t("ep.cta.register"), disabled: false };
  })();

  const timeline = [
    { key: "reg_open", at: event.registration_start },
    { key: "reg_close", at: event.registration_end },
    { key: "teams", at: event.team_deadline },
    { key: "start", at: event.start_date },
    { key: "submission", at: event.submission_deadline },
    { key: "end", at: event.end_date },
    { key: "demo", at: event.demo_day },
    { key: "judging", at: event.judging_start },
    { key: "results", at: event.results_at },
  ].filter((x) => x.at).sort((a, b) => new Date(a.at as string).getTime() - new Date(b.at as string).getTime());

  const elig = event.eligibility;
  const subFields = (Object.entries(event.submission?.fields || {}) as [string, string][]).filter(([, s]) => s !== "off");

  const FormatIcon = event.format === "online" ? Monitor : event.format === "hybrid" ? Shuffle : MapPin;
  const place = event.format === "online"
    ? t("ep.online")
    : [event.venue_name, event.city, event.country ? countryName(event.country, lang) : null].filter(Boolean).join(", ");

  const Cta = ({ className = "" }: { className?: string }) => (cta.disabled || preview ? (
    <span aria-disabled="true" className={`inline-flex min-h-12 items-center justify-center rounded-[12px] px-6 text-[15px] font-semibold opacity-80 ${className}`}
      style={{ background: preview && !cta.disabled ? "var(--accent-solid)" : "var(--tint-2, var(--tint))", color: preview && !cta.disabled ? "#fff" : "var(--ink-2)" }}>
      {cta.label}
    </span>
  ) : (
    <Link href={href} className={`inline-flex min-h-12 items-center justify-center rounded-[12px] px-6 text-[15px] font-semibold text-white transition-[filter] hover:brightness-110 ${className}`} style={{ background: "var(--accent-solid)" }}>
      {cta.label}
    </Link>
  ));

  return (
    <div className={`hs ${dark ? "hs-night" : ""} min-h-dvh`} style={eventTheme(event)}>
      {/* Hero */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0" aria-hidden="true"
          style={{ background: event.banner_url ? `center / cover no-repeat url(${event.banner_url})` : `radial-gradient(1200px 400px at 10% -10%, color-mix(in srgb, var(--accent-solid) 55%, transparent), transparent), linear-gradient(135deg, #14181F, #1C222C)` }} />
        <div className="absolute inset-0" aria-hidden="true" style={{ background: "linear-gradient(180deg, rgba(20,24,31,0.25) 0%, rgba(20,24,31,0.86) 100%)" }} />
        <div className="relative mx-auto max-w-5xl px-4 pb-10 pt-6 sm:px-6 sm:pb-14">
          <div className="flex items-center justify-between gap-3">
            {event.organiser ? (
              <span className="truncate text-[13px] font-medium" style={{ color: "rgba(251,250,248,0.8)" }}>{event.organiser.name}</span>
            ) : <span />}
            <div className="flex shrink-0 items-center gap-1.5">
              <div role="group" aria-label={t("ep.language")} className="inline-flex rounded-full p-0.5" style={{ background: "rgba(251,250,248,0.12)" }}>
                {LANGS.map((l) => (
                  <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}
                    className="min-h-8 rounded-full px-2.5 text-[12px] font-semibold uppercase"
                    style={{ background: lang === l ? "rgba(251,250,248,0.95)" : "transparent", color: lang === l ? "#14161C" : "rgba(251,250,248,0.85)" }}>{l}</button>
                ))}
              </div>
              {!preview ? (
                <button type="button" onClick={toggle} aria-label={dark ? t("ve.theme_light") : t("ve.theme_dark")}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[rgba(251,250,248,0.12)]" style={{ color: "rgba(251,250,248,0.85)" }}>
                  {dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
                </button>
              ) : null}
            </div>
          </div>
          <div className="mt-14 flex flex-col gap-6 sm:mt-20">
            {event.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={event.logo_url} alt="" className="h-16 w-16 rounded-[16px] border-2 bg-white object-cover sm:h-20 sm:w-20" style={{ borderColor: "rgba(251,250,248,0.9)" }} />
            ) : null}
            <div>
              <span className="inline-flex rounded-full px-3 py-1 text-[12px] font-semibold uppercase tracking-wide" style={{ background: "rgba(251,250,248,0.14)", color: "#FBFAF8" }}>
                {t(`b.category.${event.category}`)}
              </span>
              <h1 className="mt-3 max-w-3xl text-[34px] font-semibold leading-[1.05] tracking-tight sm:text-[52px]" style={{ color: "#FBFAF8", fontFamily: "var(--font-display)", textWrap: "balance" }}>{event.name}</h1>
              {event.tagline ? <p className="mt-3 max-w-2xl text-[16px] leading-relaxed sm:text-[18px]" style={{ color: "rgba(251,250,248,0.82)" }}>{event.tagline}</p> : null}
            </div>
            <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[14px]" style={{ color: "rgba(251,250,248,0.9)" }}>
              <li className="inline-flex items-center gap-2"><CalendarDays size={16} aria-hidden="true" />{when(event.start_date, { hour: undefined, minute: undefined })} – {when(event.end_date, { hour: undefined, minute: undefined })}</li>
              <li className="inline-flex items-center gap-2"><FormatIcon size={16} aria-hidden="true" />{place || t(`b.place.${event.format}`)}</li>
              {event.registration_mode !== "solo" ? (
                <li className="inline-flex items-center gap-2"><Users size={16} aria-hidden="true" />{f("ep.team_size", { min: event.min_team_size, max: event.team_size_limit })}</li>
              ) : null}
            </ul>
            {inviteOnly && !preview ? (
              <p className="max-w-2xl text-[14px]" style={{ color: "rgba(251,250,248,0.85)" }}>{t("ep.invite_note")}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-4">
              <Cta />
              {/* Once the organiser opened it and the results are out (the API says so). */}
              {!preview && features?.projects ? (
                <Link href={`/e/${event.slug}/projects`} className="inline-flex min-h-12 items-center gap-2 rounded-[12px] px-4 text-[14px] font-semibold transition-colors"
                  style={{ background: "rgba(251,250,248,0.14)", color: "#FBFAF8" }}>
                  <Trophy size={16} aria-hidden="true" /> {t("pj.ep_cta")}
                </Link>
              ) : null}
              {/* A plan feature (the API says whether this page may offer it). */}
              {!preview && features?.calendar ? (
                <AddToCalendar
                  name={event.name}
                  slug={event.slug}
                  start={event.start_date}
                  end={event.end_date}
                  details={[event.tagline, typeof window !== "undefined" ? `${window.location.origin}/e/${event.slug}` : null].filter(Boolean).join("\n\n") || null}
                  location={event.format === "online" ? t("ep.online") : place || null}
                  t={t}
                />
              ) : null}
              {reg.limit != null && reg.state === "open" ? (
                <span className="text-[13.5px]" style={{ color: "rgba(251,250,248,0.78)" }}>
                  {reg.full ? t("ep.full_note") : f("ep.places_left", { n: Math.max(0, reg.limit - reg.taken), limit: reg.limit })}
                </span>
              ) : null}
              {reg.state === "open" && event.registration_end ? (
                <span className="inline-flex items-center gap-1.5 text-[13.5px]" style={{ color: "rgba(251,250,248,0.78)" }}><Clock size={14} aria-hidden="true" />{f("ep.until", { date: when(event.registration_end) })}</span>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-28 sm:px-6">
        <nav aria-label={t("ep.on_page")} className="sticky top-0 z-10 -mx-4 flex gap-1 overflow-x-auto border-b px-4 py-2 text-[13px] backdrop-blur sm:-mx-6 sm:px-6"
          style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--surface-sunken) 88%, transparent)" }}>
          {[
            ["about", true], ["timeline", timeline.length > 0], ["tracks", event.tracks.length > 0], ["prizes", event.prizes.length > 0],
            ["judging", event.criteria.length > 0], ["who", true], ["sponsors", event.sponsors.length > 0], ["rules", Boolean(event.rules)], ["faq", event.faq.length > 0],
          ].filter(([, show]) => show).map(([id]) => (
            <a key={String(id)} href={`#${id}`} className="shrink-0 rounded-full px-3 py-1.5 font-medium hover:bg-[var(--tint)]" style={{ color: "var(--ink-2)" }}>{t(`ep.nav.${id}`)}</a>
          ))}
        </nav>

        <Section id="about" title={t("ep.nav.about")}>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="max-w-[68ch] space-y-4 text-[15.5px] leading-[1.75]" style={{ color: "var(--ink-2)" }}>
              {paragraphs(event.description).length ? paragraphs(event.description).map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>) : <p>{event.tagline}</p>}
            </div>
            <aside className="h-fit space-y-3 rounded-[16px] border p-4 text-[13.5px]" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
              <p className="flex items-start gap-2"><CalendarDays size={15} className="mt-0.5 shrink-0" aria-hidden="true" style={{ color: "var(--accent-solid)" }} /><span>{when(event.start_date)} – {when(event.end_date)}</span></p>
              <p className="flex items-start gap-2"><Globe2 size={15} className="mt-0.5 shrink-0" aria-hidden="true" style={{ color: "var(--accent-solid)" }} /><span>{tz.replace(/_/g, " ")} ({zoneLabel(tz, new Date(event.start_date))})</span></p>
              <p className="flex items-start gap-2"><FormatIcon size={15} className="mt-0.5 shrink-0" aria-hidden="true" style={{ color: "var(--accent-solid)" }} />
                <span>{t(`b.place.${event.format}`)}{event.format !== "online" && event.venue_address ? ` · ${event.venue_address}` : ""}</span></p>
              {event.map_url && event.format !== "online" ? (
                <a href={event.map_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium hover:underline" style={{ color: "var(--accent-solid)" }}>{t("ep.map")} <ExternalLink size={13} /></a>
              ) : null}
            </aside>
          </div>
        </Section>

        {timeline.length ? (
          <Section id="timeline" title={t("ep.nav.timeline")}>
            <ol className="relative space-y-5 border-l pl-6" style={{ borderColor: "var(--line-strong)" }}>
              {timeline.map((x) => (
                <li key={x.key} className="relative">
                  <span className="absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2" style={{ borderColor: "var(--accent-solid)", background: "var(--surface-sunken)" }} aria-hidden="true" />
                  <p className="text-[14.5px] font-semibold" style={{ color: "var(--ink)" }}>{t(`ep.tl.${x.key}`)}</p>
                  <p className="text-[13.5px] tabular-nums" style={{ color: "var(--ink-2)" }}>{when(x.at)}</p>
                </li>
              ))}
            </ol>
          </Section>
        ) : null}

        {event.tracks.length ? (
          <Section id="tracks" title={t("ep.nav.tracks")}>
            <div className="grid gap-4 sm:grid-cols-2">
              {event.tracks.map((tr) => {
                const sponsor = event.sponsors.find((s) => s.id === tr.sponsor_id);
                return (
                  <article key={tr.id} className="rounded-[16px] border p-5" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
                    <h3 className="text-[16px] font-semibold" style={{ color: "var(--ink)" }}>{tr.name}</h3>
                    {tr.description ? <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{tr.description}</p> : null}
                    {sponsor ? <p className="mt-3 text-[12.5px]" style={{ color: "var(--ink-3)" }}>{f("ep.track_by", { name: sponsor.name })}</p> : null}
                  </article>
                );
              })}
            </div>
          </Section>
        ) : null}

        {event.prizes.length ? (
          <Section id="prizes" title={t("ep.nav.prizes")}>
            {places.length ? (
              <div className="grid gap-4 sm:grid-cols-3">
                {places.map((p) => (
                  <article key={p.id} className="rounded-[18px] border p-5" style={{ borderColor: p.position === 1 ? "var(--accent-solid)" : "var(--line)", background: "var(--surface)" }}>
                    <Trophy size={22} aria-hidden="true" style={{ color: p.position === 1 ? "var(--accent-solid)" : "var(--ink-3)" }} />
                    <p className="mt-3 text-[13px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>{p.name}</p>
                    {p.value ? <p className="mt-1 text-[24px] font-semibold tabular-nums" style={{ color: "var(--ink)", fontFamily: "var(--font-display)" }}>{p.value}</p> : null}
                    {p.description ? <p className="mt-2 text-[13.5px]" style={{ color: "var(--ink-2)" }}>{p.description}</p> : null}
                  </article>
                ))}
              </div>
            ) : null}
            {others.length ? (
              <ul className="mt-5 divide-y rounded-[16px] border" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
                {others.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3.5" style={{ borderColor: "var(--line)" }}>
                    <span className="flex items-center gap-2 text-[14.5px] font-medium" style={{ color: "var(--ink)" }}><Award size={16} aria-hidden="true" style={{ color: "var(--accent-solid)" }} />{p.name}{p.kind === "track" && p.track_id ? <span className="text-[12.5px] font-normal" style={{ color: "var(--ink-3)" }}>· {trackName(p.track_id)}</span> : null}</span>
                    {p.value ? <span className="text-[14px] font-semibold tabular-nums" style={{ color: "var(--ink)" }}>{p.value}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </Section>
        ) : null}

        {event.criteria.length ? (
          <Section id="judging" title={t("ep.nav.judging")}>
            <ul className="grid gap-3 sm:grid-cols-2">
              {(() => {
                const total = event.criteria.reduce((s, c) => s + (c.weight || 0), 0) || 1;
                return event.criteria.map((c) => (
                  <li key={c.name} className="rounded-[14px] border p-4" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
                    <p className="flex items-center justify-between gap-3 text-[14.5px] font-semibold" style={{ color: "var(--ink)" }}>
                      <span className="inline-flex items-center gap-2"><Gavel size={15} aria-hidden="true" style={{ color: "var(--accent-solid)" }} />{c.name}</span>
                      <span className="tabular-nums">{Math.round((c.weight / total) * 100)}%</span>
                    </p>
                    {c.description ? <p className="mt-1.5 text-[13.5px]" style={{ color: "var(--ink-2)" }}>{c.description}</p> : null}
                  </li>
                ));
              })()}
            </ul>
            {subFields.length ? (
              <div className="mt-6">
                <h3 className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>{t("ep.submit_title")}</h3>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {subFields.map(([k, s]) => (
                    <li key={k} className="rounded-full px-3 py-1.5 text-[13px]" style={{ background: "var(--tint)", color: "var(--ink)" }}>
                      {t(`b.subs.f_${k}`)}{s === "optional" ? ` · ${t("ep.optional")}` : ""}
                    </li>
                  ))}
                  {event.submission?.files?.enabled ? <li className="rounded-full px-3 py-1.5 text-[13px]" style={{ background: "var(--tint)", color: "var(--ink)" }}>{t("ep.files_allowed")}</li> : null}
                </ul>
              </div>
            ) : null}
          </Section>
        ) : null}

        <Section id="who" title={t("ep.nav.who")}>
          <ul className="grid gap-3 text-[14.5px] sm:grid-cols-2">
            <li className="flex items-start gap-2.5"><CheckCircle2 size={17} className="mt-0.5 shrink-0" style={{ color: "var(--ok)" }} aria-hidden="true" />
              <span>{event.registration_mode === "solo" ? t("ep.mode_solo")
                : event.registration.teamFormation && !event.registration.teamFormation.open && event.registration.teamFormation.reason === "deadline"
                  ? f("ep.mode_teams_closed", { min: event.min_team_size, max: event.team_size_limit })
                  : event.registration_mode === "team" ? f("ep.mode_team", { min: event.min_team_size, max: event.team_size_limit }) : f("ep.mode_both", { min: event.min_team_size, max: event.team_size_limit })}</span></li>
            {elig.minAge != null || elig.maxAge != null ? (
              <li className="flex items-start gap-2.5"><CheckCircle2 size={17} className="mt-0.5 shrink-0" style={{ color: "var(--ok)" }} aria-hidden="true" />
                <span>{elig.minAge != null && elig.maxAge != null ? f("ep.age_range", { min: elig.minAge, max: elig.maxAge }) : elig.minAge != null ? f("ep.age_min", { min: elig.minAge }) : f("ep.age_max", { max: elig.maxAge as number })}</span></li>
            ) : null}
            {elig.studentsOnly ? <li className="flex items-start gap-2.5"><CheckCircle2 size={17} className="mt-0.5 shrink-0" style={{ color: "var(--ok)" }} aria-hidden="true" /><span>{t("ep.students")}</span></li> : null}
            {elig.countries.length ? (
              <li className="flex items-start gap-2.5"><CheckCircle2 size={17} className="mt-0.5 shrink-0" style={{ color: "var(--ok)" }} aria-hidden="true" /><span>{f("ep.countries", { list: elig.countries.map((c) => countryName(c, lang)).join(", ") })}</span></li>
            ) : null}
            {elig.cities.length ? <li className="flex items-start gap-2.5"><CheckCircle2 size={17} className="mt-0.5 shrink-0" style={{ color: "var(--ok)" }} aria-hidden="true" /><span>{f("ep.cities", { list: elig.cities.join(", ") })}</span></li> : null}
            {reg.limit != null ? <li className="flex items-start gap-2.5"><CheckCircle2 size={17} className="mt-0.5 shrink-0" style={{ color: "var(--ok)" }} aria-hidden="true" /><span>{f("ep.capacity", { limit: reg.limit })}</span></li> : null}
          </ul>
        </Section>

        {tiers.length ? (
          <Section id="sponsors" title={t("ep.nav.sponsors")}>
            <div className="space-y-6">
              {tiers.map((g) => (
                <div key={g.tier || "none"}>
                  {g.tier ? <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--ink-3)" }}>{t(`b.tier.${g.tier}`)}</p> : null}
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {g.items.map((s) => {
                      const body = (
                        <span className="flex h-24 items-center justify-center rounded-[14px] border p-4" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
                          {s.logo_url
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={s.logo_url} alt={s.name} className="max-h-14 max-w-full object-contain" />
                            : <span className="text-center text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{s.name}</span>}
                        </span>
                      );
                      return <li key={s.id}>{s.website ? <a href={s.website} target="_blank" rel="noreferrer" aria-label={s.name}>{body}</a> : body}</li>;
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {event.rules ? (
          <Section id="rules" title={t("ep.nav.rules")}>
            <details className="group rounded-[16px] border p-5" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[14.5px] font-semibold" style={{ color: "var(--ink)" }}>
                {t("ep.rules_open")} <ChevronDown size={18} className="transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-4 max-w-[70ch] space-y-3 text-[14.5px] leading-[1.75]" style={{ color: "var(--ink-2)" }}>
                {paragraphs(event.rules).map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>)}
              </div>
            </details>
          </Section>
        ) : null}

        {event.faq.length ? (
          <Section id="faq" title={t("ep.nav.faq")}>
            <div className="divide-y rounded-[16px] border" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
              {event.faq.map((item, i) => (
                <details key={i} className="group px-5 py-4" style={{ borderColor: "var(--line)" }}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[14.5px] font-semibold" style={{ color: "var(--ink)" }}>
                    {item.q} <ChevronDown size={17} className="shrink-0 transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="mt-2.5 whitespace-pre-line text-[14px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{item.a}</p>
                </details>
              ))}
            </div>
          </Section>
        ) : null}

        <footer className="border-t pt-8 text-[12.5px]" style={{ borderColor: "var(--line)", color: "var(--ink-3)" }}>
          {event.organiser ? <p>{f("ep.organised_by", { name: event.organiser.name })}</p> : null}
          <p className="mt-1">{t("ep.powered")} <Link href="/" className="font-semibold hover:underline" style={{ color: "var(--ink-2)" }}>HackOS</Link></p>
        </footer>
      </main>

      {/* Phone: the call to action stays in reach. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t px-4 py-3 sm:hidden" style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--surface) 94%, transparent)", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
        <Cta className="w-full" />
      </div>
    </div>
  );
}
