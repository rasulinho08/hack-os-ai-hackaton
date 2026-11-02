"use client";

/**
 * The hackathon directory: a search, the filters (status, format, city) and
 * the listed events as cards, a page at a time. Every filter is in the
 * address, so a filtered list can be shared and the server renders it; the
 * words follow the reader's language.
 */

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import Form from "next/form";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarDays, Globe2, MapPin, Search, Star, Users, X } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import {
  DIRECTORY_FORMATS, DIRECTORY_STATUSES, directorySearch, eventDates, isFiltered, localDay, placeOf, statusOf, teamSizeText,
  type DirectoryEvent, type DirectoryPage, type DirectoryQuery, type StatusTone,
} from "@/lib/directory";
import { formatDate } from "@/lib/i18n/dates";
import { countText, directoryCopy, type DirectoryCopy } from "./copy";

const TONE: Record<StatusTone, { fg: string; bg: string; dot: string }> = {
  open: { fg: "var(--hs-ok)", bg: "var(--hs-ok-weak)", dot: "var(--hs-ok)" },
  soon: { fg: "var(--hs-info)", bg: "var(--hs-info-weak)", dot: "var(--hs-info)" },
  live: { fg: "var(--hs-brand)", bg: "var(--hs-brand-weak)", dot: "var(--hs-brand-solid)" },
  done: { fg: "var(--hs-ink-2)", bg: "var(--hs-tint)", dot: "var(--hs-ink-3)" },
};

export function DirectoryView({ data, query }: { data: DirectoryPage | null; query: DirectoryQuery }) {
  const { lang } = useTranslation();
  const copy = directoryCopy(lang);
  const router = useRouter();
  const pathname = usePathname() || "/hackathons";
  const [pending, startTransition] = useTransition();

  const go = (next: Partial<DirectoryQuery>) => {
    const target = { ...query, page: 1, ...next };
    startTransition(() => router.push(`${pathname}${directorySearch(target)}`, { scroll: false }));
  };

  return (
    <>
      <section className="border-b" style={{ borderColor: "var(--hs-line)" }}>
        <div className="mx-auto max-w-6xl px-5 pb-10 pt-14 sm:px-8 sm:pb-12 sm:pt-20">
          <p className="hs-chapter">{copy.chapter}</p>
          <h1 className="hs-display hs-h2 mt-5 max-w-[18ch] text-balance">{copy.title}</h1>
          <p className="hs-lead-lg mt-6 max-w-[42rem]">{copy.lead}</p>
          <SearchBar key={query.q ?? ""} copy={copy} query={query} />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16 pt-8 sm:px-8 sm:pb-20">
        <Filters copy={copy} data={data} query={query} onChange={go} />

        <div aria-busy={pending} className="transition-opacity duration-200" style={{ opacity: pending ? 0.55 : 1 }}>
          {data === null ? (
            <div className="hs-card mx-auto mt-8 max-w-lg px-6 py-12 text-center" role="status">
              <h2 className="hs-h3" style={{ color: "var(--hs-ink)" }}>{copy.failed.title}</h2>
              <p className="mt-2 text-[15px]" style={{ color: "var(--hs-ink-2)" }}>{copy.failed.body}</p>
              <button type="button" onClick={() => startTransition(() => router.refresh())} className="hs-pill hs-pill-ghost mt-6">
                {copy.failed.retry}
              </button>
            </div>
          ) : data.items.length === 0 ? (
            <div className="hs-card mx-auto mt-8 max-w-lg px-6 py-12 text-center">
              <h2 className="hs-h3" style={{ color: "var(--hs-ink)" }}>{copy.empty.title}</h2>
              <p className="mt-2 text-[15px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>
                {isFiltered(query) ? copy.empty.filtered : copy.empty.body}
              </p>
              {isFiltered(query) ? (
                <Link href={pathname} scroll={false} className="hs-pill hs-pill-ghost mt-6">{copy.filters.reset}</Link>
              ) : null}
            </div>
          ) : (
            <>
              <p className="mt-6 text-[14px]" style={{ color: "var(--hs-ink-3)" }} aria-live="polite">
                {countText(copy, data.total)}
              </p>
              <EventGrid items={data.items} copy={copy} lang={lang} />
              <Pager data={data} query={query} copy={copy} pathname={pathname} />
            </>
          )}
        </div>
      </section>

      <section className="border-t" style={{ borderColor: "var(--hs-line)" }}>
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-16 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="hs-display text-[clamp(26px,3vw,36px)] tracking-[-0.03em]">{copy.cta.title}</h2>
            <p className="mt-2 max-w-[36rem] text-[16px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>{copy.cta.body}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/pricing" className="hs-pill hs-pill-primary">{copy.cta.primary}</Link>
            <Link href="/demo" className="hs-pill hs-pill-ghost">{copy.cta.secondary}</Link>
          </div>
        </div>
      </section>
    </>
  );
}

/* ── Search ─────────────────────────────────────────────────────────────── */

function SearchBar({ copy, query }: { copy: DirectoryCopy; query: DirectoryQuery }) {
  const [text, setText] = useState(query.q ?? "");
  return (
    <Form action="/hackathons" scroll={false} role="search" aria-label={copy.search.label} className="mt-9 flex max-w-2xl items-center gap-2">
      {/* The other filters ride along with a new search. */}
      {query.status ? <input type="hidden" name="status" value={query.status} /> : null}
      {query.format ? <input type="hidden" name="format" value={query.format} /> : null}
      {query.city ? <input type="hidden" name="city" value={query.city} /> : null}
      <label className="relative flex h-12 min-w-0 flex-1 items-center rounded-full border transition-colors focus-within:border-[var(--hs-ink-3)]"
        style={{ borderColor: "var(--hs-line-2)", background: "var(--hs-surface)" }}>
        <span className="sr-only">{copy.search.label}</span>
        <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-4" style={{ color: "var(--hs-ink-3)" }} />
        <input
          type="search"
          name="q"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={80}
          placeholder={copy.search.placeholder}
          autoComplete="off"
          className="h-full w-full min-w-0 rounded-full bg-transparent pl-11 pr-10 text-[15px] outline-none placeholder:text-[var(--hs-ink-3)] [&::-webkit-search-cancel-button]:hidden"
          style={{ color: "var(--hs-ink)" }}
        />
        {text ? (
          <button type="button" onClick={() => setText("")} aria-label={copy.search.clear}
            className="absolute right-2 inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-[var(--hs-tint)]" style={{ color: "var(--hs-ink-3)" }}>
            <X size={15} aria-hidden="true" />
          </button>
        ) : null}
      </label>
      <button type="submit" aria-label={copy.search.submit} className="hs-pill hs-pill-primary h-12 shrink-0" style={{ minHeight: 48, paddingLeft: 20, paddingRight: 20 }}>
        <Search size={17} aria-hidden="true" className="sm:hidden" />
        <span className="hidden sm:inline">{copy.search.submit}</span>
      </button>
    </Form>
  );
}

/* ── Filters ────────────────────────────────────────────────────────────── */

function Chip({ active, onClick, children, count }: { active: boolean; onClick: () => void; children: React.ReactNode; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[14px] transition-colors hover:border-[var(--hs-ink-3)]"
      style={{
        borderColor: active ? "var(--hs-ink)" : "var(--hs-line-2)",
        background: active ? "var(--hs-ink)" : "transparent",
        color: active ? "var(--hs-bg)" : "var(--hs-ink-2)",
        fontWeight: active ? 500 : 400,
      }}
    >
      {children}
      {count != null ? (
        <span className="hs-mono text-[11px]" style={{ color: active ? "var(--hs-bg)" : "var(--hs-ink-3)", opacity: active ? 0.75 : 1 }}>{count}</span>
      ) : null}
    </button>
  );
}

function Filters({ copy, data, query, onChange }: {
  copy: DirectoryCopy; data: DirectoryPage | null; query: DirectoryQuery; onChange: (q: Partial<DirectoryQuery>) => void;
}) {
  const f = data?.facets;
  const statusCount = (s: (typeof DIRECTORY_STATUSES)[number]) =>
    f ? (s === "upcoming" ? f.phases.open + f.phases.upcoming : f.phases[s]) : undefined;
  const cities = f?.cities ?? [];
  const cityKnown = !query.city || cities.some((c) => c.name.toLowerCase() === query.city!.toLowerCase());
  return (
    <div role="group" aria-label={copy.filters.label} className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0" aria-label={copy.filters.status} role="group">
        <Chip active={!query.status} onClick={() => onChange({ status: null })} count={f?.total}>{copy.filters.all}</Chip>
        {DIRECTORY_STATUSES.map((s) => (
          <Chip key={s} active={query.status === s} onClick={() => onChange({ status: query.status === s ? null : s })} count={statusCount(s)}>
            {copy.filters.statuses[s]}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={copy.filters.format} className="flex items-center rounded-full p-0.5" style={{ background: "var(--hs-tint)" }}>
          {[null, ...DIRECTORY_FORMATS].map((fmt) => {
            const active = query.format === fmt;
            return (
              <button
                key={fmt ?? "all"}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ format: fmt })}
                className="h-8 whitespace-nowrap rounded-full px-3 text-[13px] transition-colors"
                style={{
                  background: active ? "var(--hs-surface)" : "transparent",
                  color: active ? "var(--hs-ink)" : "var(--hs-ink-2)",
                  boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                  fontWeight: active ? 500 : 400,
                }}
              >
                {fmt ? copy.formats[fmt] : copy.filters.all}
              </button>
            );
          })}
        </div>
        <label className="relative">
          <span className="sr-only">{copy.filters.city}</span>
          <MapPin size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--hs-ink-3)" }} />
          <select
            value={query.city ?? ""}
            onChange={(e) => onChange({ city: e.target.value || null })}
            className="h-9 max-w-[14rem] appearance-none rounded-full border pl-8 pr-8 text-[13.5px] outline-none focus-visible:border-[var(--hs-ink-3)]"
            style={{ borderColor: "var(--hs-line-2)", background: "var(--hs-surface)", color: "var(--hs-ink)" }}
          >
            <option value="">{copy.filters.allCities}</option>
            {!cityKnown && query.city ? <option value={query.city}>{query.city}</option> : null}
            {cities.map((c) => (
              <option key={c.name} value={c.name}>{`${c.name} (${c.count})`}</option>
            ))}
          </select>
          <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px]" style={{ color: "var(--hs-ink-3)" }}>▼</span>
        </label>
        {isFiltered(query) ? (
          <button type="button" onClick={() => onChange({ status: null, format: null, city: null, q: null })}
            className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-[13px] underline-offset-4 hover:underline" style={{ color: "var(--hs-ink-2)" }}>
            <X size={14} aria-hidden="true" /> {copy.filters.reset}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ── Cards ──────────────────────────────────────────────────────────────── */

function EventGrid({ items, copy, lang }: { items: DirectoryEvent[]; copy: DirectoryCopy; lang: string }) {
  // A heading where the finished events begin, when this page has both kinds.
  const firstPast = items.findIndex((e) => e.phase === "past");
  const split = firstPast > 0;
  const groups = split ? [items.slice(0, firstPast), items.slice(firstPast)] : [items];
  return (
    <div className="mt-4 space-y-10">
      {groups.map((group, gi) => (
        <section key={gi} aria-label={split ? (gi === 0 ? copy.sections.now : copy.sections.past) : undefined}>
          {split ? (
            <h2 className="hs-mono mb-4 text-[12px] uppercase tracking-[0.14em]" style={{ color: "var(--hs-ink-3)" }}>
              {gi === 0 ? copy.sections.now : copy.sections.past}
            </h2>
          ) : null}
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {group.map((e, i) => (
              <li key={e.slug}>
                <EventCard event={e} copy={copy} lang={lang} eager={gi === 0 && i < 2} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function EventCard({ event: e, copy, lang, eager }: { event: DirectoryEvent; copy: DirectoryCopy; lang: string; eager: boolean }) {
  const status = statusOf(e, copy.status, lang);
  const tone = TONE[status.tone];
  const dates = eventDates(e, lang);
  const place = placeOf(e, copy.formats);
  const start = localDay(e.startDate, e.timezone);
  const startDay = start ? formatDate(`${start}T12:00:00Z`, lang, { day: "numeric", timeZone: "UTC" }) : "";
  const startMonth = start ? formatDate(`${start}T12:00:00Z`, lang, { month: "short", timeZone: "UTC" }).replace(".", "") : "";
  const PlaceIcon = e.format === "online" ? Globe2 : MapPin;

  return (
    <Link
      href={e.url}
      className="hs-card group flex h-full flex-col overflow-hidden transition-[transform,border-color] duration-300 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4"
      style={{ outlineColor: "var(--hs-brand)" }}
    >
      <div className="relative aspect-[16/8] overflow-hidden" style={{ background: "var(--hs-raised)" }}>
        {e.cover ? (
          <Image src={e.cover} alt="" fill sizes="(min-width: 1024px) 384px, (min-width: 640px) 50vw, 100vw"
            loading={eager ? "eager" : undefined} fetchPriority={eager ? "high" : undefined}
            className="object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none" />
        ) : (
          <div
            className="absolute inset-0 flex items-end justify-between p-5"
            aria-hidden="true"
            style={{
              backgroundImage: "linear-gradient(to right, var(--hs-line) 1px, transparent 1px), linear-gradient(to bottom, var(--hs-line) 1px, transparent 1px)",
              backgroundSize: "28px 28px",
              backgroundPosition: "-1px -1px",
            }}
          >
            <span className="flex flex-col leading-none">
              <span className="hs-display text-[44px] tracking-[-0.04em]" style={{ color: "var(--hs-ink)" }}>{startDay}</span>
              <span className="hs-mono mt-1 text-[12px] uppercase tracking-[0.14em]" style={{ color: "var(--hs-ink-3)" }}>{startMonth}</span>
            </span>
            <span className="hs-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--hs-ink-3)" }}>{copy.formats[e.format]}</span>
          </div>
        )}
        <span
          className="absolute left-3 top-3 inline-flex max-w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium backdrop-blur"
          style={{ background: e.cover ? "color-mix(in srgb, var(--hs-surface) 88%, transparent)" : tone.bg, color: tone.fg }}
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.tone === "live" ? "animate-pulse motion-reduce:animate-none" : ""}`} style={{ background: tone.dot }} aria-hidden="true" />
          <span className="truncate">{status.label}</span>
        </span>
        {e.featured ? (
          <span
            className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold"
            style={{ background: "var(--hs-brand-solid)", color: "#fff" }}
          >
            <Star size={12} aria-hidden="true" fill="currentColor" />
            {copy.featured}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <h3 className="hs-h3 text-balance" style={{ color: "var(--hs-ink)" }}>{e.name}</h3>
        {e.organiser ? (
          <p className="mt-1.5 text-[14px]" style={{ color: "var(--hs-ink-2)" }}>{copy.organisedBy.replace("{who}", e.organiser.name)}</p>
        ) : null}
        {e.tagline ? (
          <p className="mt-3 line-clamp-2 text-[14.5px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>{e.tagline}</p>
        ) : null}
        <dl className="mt-5 space-y-2 text-[13.5px]" style={{ color: "var(--hs-ink-2)" }}>
          <Fact icon={<CalendarDays size={15} aria-hidden="true" />} label={copy.facts.when}>{dates}</Fact>
          <Fact icon={<PlaceIcon size={15} aria-hidden="true" />} label={copy.facts.where}>{place}</Fact>
          <Fact icon={<Users size={15} aria-hidden="true" />} label={copy.facts.team}>{teamSizeText(e, copy.team)}</Fact>
        </dl>
        <span className="mt-auto inline-flex items-center gap-1.5 pt-6 text-[14px] font-medium" style={{ color: "var(--hs-brand)" }}>
          {copy.open}
          <ArrowRight size={15} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}

function Fact({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="flex items-start gap-2.5">
      <dt className="mt-[2px] shrink-0" style={{ color: "var(--hs-ink-3)" }}><span className="sr-only">{label}</span>{icon}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/* ── Pages ──────────────────────────────────────────────────────────────── */

function Pager({ data, query, copy, pathname }: { data: DirectoryPage; query: DirectoryQuery; copy: DirectoryCopy; pathname: string }) {
  if (data.pages <= 1) return null;
  const href = (page: number) => `${pathname}${directorySearch({ ...query, page })}`;
  const prev = data.page > 1 ? href(data.page - 1) : null;
  const next = data.page < data.pages ? href(data.page + 1) : null;
  const look = "hs-pill hs-pill-ghost inline-flex items-center gap-1.5";
  return (
    <nav aria-label={copy.pager.label} className="mt-10 flex items-center justify-between gap-3">
      {prev ? <Link href={prev} className={look} rel="prev"><ArrowLeft size={15} aria-hidden="true" /> {copy.pager.prev}</Link> : <span />}
      <span className="hs-mono text-[12px]" style={{ color: "var(--hs-ink-3)" }}>
        {copy.pager.page.replace("{n}", String(data.page)).replace("{total}", String(data.pages))}
      </span>
      {next ? <Link href={next} className={look} rel="next">{copy.pager.next} <ArrowRight size={15} aria-hidden="true" /></Link> : <span />}
    </nav>
  );
}
