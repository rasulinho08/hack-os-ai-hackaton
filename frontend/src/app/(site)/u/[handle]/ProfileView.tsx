"use client";

/**
 * A participant's public profile: only the parts they chose to show — their
 * name, hackathons, projects and certificates — in the reader's language.
 * There is nothing else in the data this page receives: no e-mail, no
 * phone, no ids.
 */

import Link from "next/link";
import { ArrowRight, Award, BadgeCheck, CalendarDays, ExternalLink, FolderGit2, Medal, Trophy, Users } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { certificateTitle } from "@/components/wrapup/CertificateParts";
import { kindOf, ordinal } from "@/lib/certificates";
import { formatDate } from "@/lib/i18n/dates";
import { byDateDesc, eventDatesOf, type PublicProfile } from "@/lib/profile";

export function ProfileView({ profile: p }: { profile: PublicProfile }) {
  const { t, lang } = useTranslation();
  const events = p.events ? byDateDesc(p.events) : null;
  const projects = p.projects ? byDateDesc(p.projects) : null;
  const certs = p.certificates ?? null;
  const nothing = !events?.length && !projects?.length && !certs?.length;
  const initials = (p.name || p.handle).split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");

  const figures = [
    events ? { icon: Trophy, n: events.length, label: t("pf.stat.events") } : null,
    projects ? { icon: FolderGit2, n: projects.length, label: t("pf.stat.projects") } : null,
    certs ? { icon: Award, n: certs.length, label: t("pf.stat.certificates") } : null,
  ].filter((x): x is { icon: typeof Trophy; n: number; label: string } => x != null);

  return (
    <>
      <section className="border-b" style={{ borderColor: "var(--hs-line)" }}>
        <div className="mx-auto max-w-5xl px-5 pb-12 pt-14 sm:px-8 sm:pt-20">
          <p className="hs-chapter">{t("pf.u.eyebrow")}</p>
          <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-center">
            <span aria-hidden="true" className="inline-flex h-20 w-20 shrink-0 items-center justify-center rounded-full text-[28px] font-semibold"
              style={{ background: "var(--hs-brand-weak)", color: "var(--hs-brand)" }}>
              {initials}
            </span>
            <div className="min-w-0">
              <h1 className="hs-display text-[clamp(32px,5vw,52px)] leading-[1.05] tracking-[-0.035em] break-words">{p.name || `@${p.handle}`}</h1>
              {p.headline ? <p className="hs-lead-lg mt-3 max-w-[40rem]">{p.headline}</p> : null}
              <p className="hs-mono mt-3 text-[12px]" style={{ color: "var(--hs-ink-3)" }}>/u/{p.handle}</p>
            </div>
          </div>
          {figures.length ? (
            <ul className="mt-10 grid max-w-xl grid-cols-3 gap-3">
              {figures.map(({ icon: Icon, n, label }) => (
                <li key={label} className="hs-card px-4 py-3.5">
                  <Icon size={16} aria-hidden="true" style={{ color: "var(--hs-ink-3)" }} />
                  <p className="mt-2 text-[26px] font-semibold leading-none tabular-nums" style={{ color: "var(--hs-ink)" }}>{n}</p>
                  <p className="mt-1 truncate text-[13px]" style={{ color: "var(--hs-ink-3)" }}>{label}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      <div className="mx-auto max-w-5xl space-y-14 px-5 py-14 sm:px-8">
        {nothing ? (
          <p className="text-[16px]" style={{ color: "var(--hs-ink-2)" }}>{t("pf.u.empty")}</p>
        ) : null}

        {events?.length ? (
          <section aria-labelledby="u-events">
            <h2 id="u-events" className="hs-h3" style={{ color: "var(--hs-ink)" }}>{t("pf.u.events")}</h2>
            <ul className="mt-5 divide-y border-y" style={{ borderColor: "var(--hs-line)" }}>
              {events.map((e, i) => (
                <li key={`${e.event.name}-${i}`} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--hs-line)" }}>
                  <div className="min-w-0">
                    <p className="text-[16px] font-medium" style={{ color: "var(--hs-ink)" }}>
                      {e.event.slug ? <Link href={`/e/${e.event.slug}`} className="underline-offset-4 hover:underline">{e.event.name}</Link> : e.event.name}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]" style={{ color: "var(--hs-ink-3)" }}>
                      <span className="inline-flex items-center gap-1.5"><CalendarDays size={13} aria-hidden="true" />{eventDatesOf(e.event, lang)}</span>
                      {e.event.organiser ? <span>{t("pf.u.organised_by").replace("{who}", e.event.organiser)}</span> : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="rounded-full px-2.5 py-1 font-medium" style={{ background: "var(--hs-tint)", color: "var(--hs-ink)" }}>{t(`pf.role.${e.role}`)}</span>
                    {e.team ? <span className="inline-flex items-center gap-1.5" style={{ color: "var(--hs-ink-2)" }}><Users size={13} aria-hidden="true" />{t("pf.u.team").replace("{team}", e.team)}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {projects?.length ? (
          <section aria-labelledby="u-projects">
            <h2 id="u-projects" className="hs-h3" style={{ color: "var(--hs-ink)" }}>{t("pf.u.projects")}</h2>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2">
              {projects.map((pr, i) => (
                <li key={`${pr.name}-${i}`} className="hs-card flex flex-col p-5">
                  <div className="flex flex-wrap gap-2">
                    {pr.place ? (
                      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium" style={{ background: "var(--hs-warn-weak)", color: "var(--hs-warn)" }}>
                        <Medal size={13} aria-hidden="true" />{t("pf.place").replace("{place}", ordinal(lang, pr.place))}
                      </span>
                    ) : null}
                    {pr.prizes.filter((x) => x.kind !== "place").map((x) => (
                      <span key={x.name} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium" style={{ background: "var(--hs-brand-weak)", color: "var(--hs-brand)" }}>
                        <Trophy size={13} aria-hidden="true" />{x.name}
                      </span>
                    ))}
                  </div>
                  <h3 className="mt-3 text-[18px] font-semibold tracking-[-0.01em]" style={{ color: "var(--hs-ink)" }}>{pr.name}</h3>
                  <p className="mt-1 text-[14px]" style={{ color: "var(--hs-ink-2)" }}>
                    {[pr.event.name, pr.team ? t("pf.u.team").replace("{team}", pr.team) : null].filter(Boolean).join(" · ")}
                  </p>
                  {pr.tech ? <p className="mt-2 text-[13px]" style={{ color: "var(--hs-ink-3)" }}>{t("pf.u.built_with").replace("{tech}", pr.tech)}</p> : null}
                  {pr.url ? (
                    <Link href={pr.url} className="mt-auto inline-flex items-center gap-1.5 pt-4 text-[14px] font-medium" style={{ color: "var(--hs-brand)" }}>
                      {t("pf.u.see_projects")} <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {certs?.length ? (
          <section aria-labelledby="u-certs">
            <h2 id="u-certs" className="hs-h3" style={{ color: "var(--hs-ink)" }}>{t("pf.u.certificates")}</h2>
            <ul className="mt-5 space-y-3">
              {certs.map((c) => {
                const kind = kindOf(c.kind) ?? "participation";
                return (
                  <li key={c.code} className="hs-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--hs-ok-weak)", color: "var(--hs-ok)" }}>
                        <BadgeCheck size={17} aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[15px] font-medium" style={{ color: "var(--hs-ink)" }}>{certificateTitle(t, lang, { kind, place: c.place, title: c.title })}</p>
                        <p className="mt-0.5 text-[13.5px]" style={{ color: "var(--hs-ink-3)" }}>
                          {[c.eventName, c.issuedAt ? formatDate(c.issuedAt, lang, { day: "numeric", month: "long", year: "numeric" }) : null].filter(Boolean).join(" · ")}
                        </p>
                        <p className="hs-mono mt-1 text-[11.5px] tracking-[0.08em]" style={{ color: "var(--hs-ink-3)" }}>{c.code}</p>
                      </div>
                    </div>
                    <Link href={c.verifyUrl} className="hs-pill hs-pill-ghost inline-flex shrink-0 items-center gap-1.5 self-start sm:self-auto">
                      <ExternalLink size={14} aria-hidden="true" /> {t("pf.u.verify")}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <div className="flex flex-col gap-4 border-t pt-8 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--hs-line)" }}>
          <p className="text-[13.5px]" style={{ color: "var(--hs-ink-3)" }}>{t("pf.u.footer")}</p>
          <Link href="/hackathons" className="hs-pill hs-pill-ghost inline-flex items-center gap-1.5 self-start">{t("pf.u.cta")} <ArrowRight size={14} aria-hidden="true" /></Link>
        </div>
      </div>
    </>
  );
}
