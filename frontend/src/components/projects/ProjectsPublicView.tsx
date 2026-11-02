"use client";

/**
 * An event's projects, as visitors see them: the winners first with their
 * places and prizes, then every project as a card with its links, and a
 * filter by track. Like the event page it speaks the event's language first,
 * with a switch for visitors who read another, and the brand colour (when
 * the plan includes it) is the accent.
 *
 * Nothing here comes from the visitor: links are http(s) only and open in a
 * new tab without handing over the page (noopener, and nofollow for search
 * engines since the teams wrote them).
 */

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import { ArrowLeft, Award, CalendarDays, CodeXml, ExternalLink, CirclePlay, FolderOpen, Medal } from "lucide-react";
import { formatInZone } from "@/lib/builder/datetime";
import { resolve, type Lang } from "@/lib/i18n";
import { fill } from "@/lib/i18n/fill";
import { medal, ordinal } from "@/lib/results";
import { inTrack, isWinner, shownAwards, type PublicProject, type PublicProjectsPage } from "@/lib/publicProjects";

const LANGS: Lang[] = ["az", "en", "ru"];
const MEDAL_COLOUR = { gold: "#C9A227", silver: "#9AA4AE", bronze: "#B87333" } as const;
const ON_DARK = "#FBFAF8";

/*
 * The event page's look (its eventTheme): the `.hs` scope with the brand
 * colour as accent. Repeated rather than imported, because importing it
 * brought the whole event page's code into this page's bundle.
 */
function theme(accent: string | null): CSSProperties {
  return {
    background: "var(--surface-sunken)",
    color: "var(--ink)",
    ...(accent ? { ["--accent-solid" as string]: accent, ["--accent" as string]: accent, ["--hs-brand" as string]: accent, ["--hs-brand-solid" as string]: accent } : {}),
  };
}

export function ProjectsPublicView({ page }: { page: PublicProjectsPage }) {
  const { event } = page;
  const [lang, setLang] = useState<Lang>(event.language);
  const [track, setTrack] = useState<number | null>(null);
  const t = (k: string) => resolve(lang, k);
  const tz = event.timezone || "Asia/Baku";
  const day = (iso: string | null) => formatInZone(iso, tz, lang, { hour: undefined, minute: undefined });

  const shown = useMemo(() => inTrack(page.projects, track), [page.projects, track]);
  const winners = useMemo(() => shown.filter(isWinner), [shown]);
  const eventHref = `/e/${encodeURIComponent(event.slug)}`;
  const dates = [day(event.startDate), day(event.endDate)].filter(Boolean).join(" – ");
  const placeText = (p: PublicProject) => (p.place != null ? fill(t("pj.place"), { place: ordinal(p.place, lang) }) : null);

  return (
    <div className="hs min-h-dvh" lang={lang} style={theme(event.brandColor)}>
      <header className="relative overflow-hidden">
        <div className="absolute inset-0" aria-hidden="true"
          style={{ background: event.bannerUrl ? `center / cover no-repeat url("${event.bannerUrl}")` : "radial-gradient(1200px 400px at 10% -10%, color-mix(in srgb, var(--accent-solid) 55%, transparent), transparent), linear-gradient(135deg, #14181F, #1C222C)" }} />
        <div className="absolute inset-0" aria-hidden="true" style={{ background: "linear-gradient(180deg, rgba(20,24,31,0.35) 0%, rgba(20,24,31,0.9) 100%)" }} />
        <div className="relative mx-auto max-w-5xl px-4 pb-10 pt-5 sm:px-6 sm:pb-12">
          <div className="flex items-center justify-between gap-3">
            <Link href={eventHref} className="inline-flex min-h-10 min-w-0 items-center gap-2 rounded-full pr-2 text-[13.5px] font-medium hover:underline" style={{ color: "rgba(251,250,248,0.88)" }}>
              <ArrowLeft size={16} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{t("pj.event_page")}</span>
            </Link>
            <div role="group" aria-label={t("ep.language")} className="inline-flex shrink-0 rounded-full p-0.5" style={{ background: "rgba(251,250,248,0.12)" }}>
              {LANGS.map((l) => (
                <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l} lang={l}
                  className="min-h-8 rounded-full px-2.5 text-[11.5px] font-semibold uppercase"
                  style={{ background: lang === l ? "rgba(251,250,248,0.95)" : "transparent", color: lang === l ? "#14161C" : "rgba(251,250,248,0.85)" }}>{l}</button>
              ))}
            </div>
          </div>
          <div className="mt-10 flex items-end gap-4 sm:mt-14">
            {event.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={event.logoUrl} alt="" className="h-14 w-14 shrink-0 rounded-[14px] border-2 bg-white object-cover sm:h-16 sm:w-16" style={{ borderColor: "rgba(251,250,248,0.9)" }} />
            ) : null}
            <div className="min-w-0">
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: "rgba(251,250,248,0.75)" }}>{t("pj.eyebrow")}</p>
              <h1 className="mt-1.5 text-[30px] font-semibold leading-[1.08] tracking-tight sm:text-[44px]" style={{ color: ON_DARK, fontFamily: "var(--font-display)", textWrap: "balance", overflowWrap: "anywhere" }}>{event.name}</h1>
            </div>
          </div>
          <p className="mt-4 max-w-2xl text-[15.5px] leading-relaxed" style={{ color: "rgba(251,250,248,0.82)" }}>{t("pj.lead")}</p>
          <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-1.5 text-[13.5px]" style={{ color: "rgba(251,250,248,0.88)" }}>
            {dates ? <li className="inline-flex items-center gap-2"><CalendarDays size={15} aria-hidden="true" />{dates}</li> : null}
            <li>{fill(t("pj.count"), { n: page.projects.length })}</li>
            {page.resultsPublishedAt ? <li>{fill(t("pj.results_at"), { date: day(page.resultsPublishedAt) })}</li> : null}
          </ul>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">
        {page.tracks.length > 1 ? (
          <nav aria-label={t("pj.filter")} className="sticky top-0 z-10 -mx-4 flex gap-1.5 overflow-x-auto border-b px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6"
            style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--surface-sunken) 88%, transparent)" }}>
            {[{ id: null as number | null, name: t("pj.filter_all") }, ...page.tracks].map((tr) => (
              <button key={tr.id ?? "all"} type="button" onClick={() => setTrack(tr.id)} aria-pressed={track === tr.id}
                className="min-h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-medium transition-colors"
                style={track === tr.id
                  ? { background: "var(--accent-solid)", borderColor: "var(--accent-solid)", color: "#fff" }
                  : { background: "var(--surface)", borderColor: "var(--line)", color: "var(--ink-2)" }}>
                {tr.name}
              </button>
            ))}
          </nav>
        ) : null}

        {page.projects.length === 0 ? (
          <Message title={t("pj.empty_title")} body={t("pj.empty_body")}>
            <Link href={eventHref} className="hs-pill hs-pill-ghost">{t("pj.closed_cta")}</Link>
          </Message>
        ) : shown.length === 0 ? (
          <Message title={t("pj.filter_empty")}>
            <button type="button" onClick={() => setTrack(null)} className="hs-pill hs-pill-ghost">{t("pj.show_all")}</button>
          </Message>
        ) : (
          <>
            {winners.length ? (
              <section aria-labelledby="pj-winners" className="pt-9 sm:pt-12">
                <h2 id="pj-winners" className="text-[22px] font-semibold tracking-tight sm:text-[26px]" style={{ color: "var(--ink)", fontFamily: "var(--font-display)" }}>{t("pj.winners")}</h2>
                {page.places === "winners" ? <p className="mt-1.5 text-[13.5px]" style={{ color: "var(--ink-3)" }}>{t("pj.places_winners")}</p> : null}
                <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {winners.map((p) => (
                    <li key={p.id}>
                      <a href={`#pj-${p.id}`} className="flex h-full items-start gap-3 rounded-[16px] border p-4 transition-colors hover:bg-[var(--tint)]"
                        style={{ borderColor: p.place === 1 ? "var(--accent-solid)" : "var(--line)", background: "var(--surface)" }}>
                        <PlaceMark place={p.place} />
                        <span className="min-w-0">
                          {p.place != null ? <span className="block text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>{placeText(p)}</span> : null}
                          <span className="mt-0.5 block text-[15.5px] font-semibold leading-snug" style={{ color: "var(--ink)", overflowWrap: "anywhere" }}>{p.title}</span>
                          {p.teamName ? <span className="mt-0.5 block text-[13px]" style={{ color: "var(--ink-2)" }}>{fill(t("pj.team"), { team: p.teamName })}</span> : null}
                          {shownAwards(p).length ? (
                            <span className="mt-2 flex flex-wrap gap-1.5">
                              {shownAwards(p).map((a, i) => <AwardChip key={i} name={a.name} value={a.value} />)}
                            </span>
                          ) : null}
                        </span>
                      </a>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            <section aria-labelledby="pj-all" className="pt-10 sm:pt-12">
              <h2 id="pj-all" className="text-[22px] font-semibold tracking-tight sm:text-[26px]" style={{ color: "var(--ink)", fontFamily: "var(--font-display)" }}>
                {t("pj.all")} <span className="text-[15px] font-medium tabular-nums" style={{ color: "var(--ink-3)" }}>{shown.length}</span>
              </h2>
              <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((p) => <ProjectCard key={p.id} project={p} place={placeText(p)} t={t} />)}
              </ul>
            </section>
          </>
        )}

        <footer className="mt-16 border-t pt-8 text-[12.5px]" style={{ borderColor: "var(--line)", color: "var(--ink-3)" }}>
          {event.organiser ? <p>{fill(t("ep.organised_by"), { name: event.organiser })}</p> : null}
          <p className="mt-1">{t("ep.powered")} <Link href="/" className="font-semibold hover:underline" style={{ color: "var(--ink-2)" }}>HackOS</Link></p>
        </footer>
      </main>
    </div>
  );
}

function PlaceMark({ place }: { place: number | null }) {
  const m = place != null ? medal(place) : null;
  const style: CSSProperties = m
    ? { background: MEDAL_COLOUR[m], color: "#fff" }
    : place != null
      ? { background: "var(--tint)", color: "var(--ink)" }
      : { background: "color-mix(in srgb, var(--accent-solid) 14%, transparent)", color: "var(--accent-solid)" };
  return (
    <span aria-hidden="true" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[14px] font-bold tabular-nums" style={style}>
      {m ? <Medal size={18} /> : place != null ? place : <Award size={18} />}
    </span>
  );
}

function AwardChip({ name, value }: { name: string; value: string | null }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium"
      style={{ background: "color-mix(in srgb, var(--accent-solid) 12%, transparent)", color: "var(--ink)" }}>
      <Award size={12} aria-hidden="true" style={{ color: "var(--accent-solid)" }} className="shrink-0" />
      <span className="truncate">{value ? `${name} · ${value}` : name}</span>
    </span>
  );
}

function ProjectCard({ project: p, place, t }: { project: PublicProject; place: string | null; t: (k: string) => string }) {
  const m = p.place != null ? medal(p.place) : null;
  const links = [
    { url: p.links.repo, label: t("pj.link.repo"), Icon: CodeXml },
    { url: p.links.demo, label: t("pj.link.demo"), Icon: ExternalLink },
    { url: p.links.video, label: t("pj.link.video"), Icon: CirclePlay },
  ].filter((l): l is { url: string; label: string; Icon: typeof CodeXml } => Boolean(l.url));
  return (
    <li id={`pj-${p.id}`} className="scroll-mt-20">
      <article className="flex h-full flex-col rounded-[18px] border p-5" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
        {place || p.track ? (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {place ? (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold"
                style={m ? { background: MEDAL_COLOUR[m], color: "#fff" } : { background: "var(--tint)", color: "var(--ink)" }}>
                <Medal size={12} aria-hidden="true" />{place}
              </span>
            ) : null}
            {p.track ? <span className="rounded-full px-2.5 py-1 text-[12px] font-medium" style={{ background: "var(--tint)", color: "var(--ink-2)" }}>{p.track}</span> : null}
          </div>
        ) : null}
        <h3 className="text-[17px] font-semibold leading-snug" style={{ color: "var(--ink)", overflowWrap: "anywhere" }}>{p.title}</h3>
        {p.teamName ? <p className="mt-0.5 text-[13px]" style={{ color: "var(--ink-3)" }}>{fill(t("pj.team"), { team: p.teamName })}</p> : null}
        {shownAwards(p).length ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {shownAwards(p).map((a, i) => <AwardChip key={i} name={a.name} value={a.value} />)}
          </div>
        ) : null}
        {p.description ? <p className="mt-3 whitespace-pre-line text-[14px] leading-relaxed" style={{ color: "var(--ink-2)", overflowWrap: "anywhere" }}>{p.description}</p> : null}
        {p.techStack ? (
          <p className="mt-3 text-[12.5px] leading-relaxed" style={{ color: "var(--ink-3)", overflowWrap: "anywhere" }}>
            <span className="font-semibold" style={{ color: "var(--ink-2)" }}>{t("pj.built_with")}:</span> {p.techStack}
          </p>
        ) : null}
        {links.length ? (
          <div className="mt-auto flex flex-wrap gap-2 pt-4">
            {links.map(({ url, label, Icon }) => (
              <a key={label} href={url} target="_blank" rel="noopener noreferrer nofollow ugc"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors hover:bg-[var(--tint)]"
                style={{ borderColor: "var(--line)", color: "var(--ink)" }}>
                <Icon size={14} aria-hidden="true" style={{ color: "var(--accent-solid)" }} />
                {label}
                <span className="sr-only"> ({t("pj.new_tab")})</span>
              </a>
            ))}
          </div>
        ) : null}
      </article>
    </li>
  );
}

function Message({ title, body, children }: { title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="hs-card mx-auto mt-10 max-w-lg px-6 py-10 text-center sm:px-10">
      <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "var(--tint)", color: "var(--ink-2)" }}>
        <FolderOpen size={20} aria-hidden="true" />
      </span>
      <p className="mt-4 text-[20px] font-semibold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{title}</p>
      {body ? <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{body}</p> : null}
      {children ? <div className="mt-6 flex flex-wrap justify-center gap-3">{children}</div> : null}
    </div>
  );
}
