"use client";

import Link from "next/link";
import { ArrowRight, Building2, Play, Shield, Trophy, Workflow } from "lucide-react";
import { Badge, Card, Eyebrow, Lead, SectionTitle } from "@/components/ds/primitives";
import { useTranslation } from "@/contexts/LanguageContext";
import { CONTACT_EMAIL } from "@/lib/site";
import { SOLUTIONS_COPY, type Lang, type SegmentId } from "./copy";

/* The subjects stay English: they are read in the sales inbox, not on the page. */
const mailto = (s: string) => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(s)}`;

interface Segment {
  id: SegmentId;
  n: string;
  icon: typeof Building2;
  /** The English name, for the enquiry's subject line. */
  subject: string;
  /** Figures already run on the platform; their labels are in ./copy.ts. */
  proof?: string[];
}

const SEGMENTS: Segment[] = [
  { id: "universities", n: "01", icon: Building2, subject: "Universities" },
  { id: "corporates", n: "02", icon: Trophy, subject: "Corporates", proof: ["152", "855"] },
  { id: "accelerators", n: "03", icon: Workflow, subject: "Accelerators" },
  { id: "public", n: "04", icon: Shield, subject: "Public sector" },
];

export default function SolutionsPage() {
  const { lang: rawLang } = useTranslation();
  const lang: Lang = rawLang === "az" || rawLang === "ru" ? rawLang : "en";
  const copy = SOLUTIONS_COPY[lang];
  return (
    <>
      <section className="border-b" style={{ borderColor: "var(--hs-line)" }}>
        <div className="mx-auto max-w-6xl px-5 pb-12 pt-14 sm:pt-20">
          <Eyebrow>{copy.eyebrow}</Eyebrow>
          <SectionTitle as="h1">{copy.title}</SectionTitle>
          <Lead>{copy.lead}</Lead>

          <ul className="hs-stagger mt-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {SEGMENTS.map((s) => {
              const Icon = s.icon;
              const words = copy.segments[s.id];
              return (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="block">
                    <Card lift className="h-full">
                      <span
                        className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-[8px]"
                        style={{ background: "var(--hs-brand-weak)", color: "var(--hs-brand)" }}
                      >
                        <Icon size={16} />
                      </span>
                      <p className="text-[15px] font-medium" style={{ color: "var(--hs-ink)" }}>
                        {words.name}
                      </p>
                      <p className="mt-1 text-[13px]" style={{ color: "var(--hs-ink-3)" }}>
                        {words.plan}
                      </p>
                    </Card>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {SEGMENTS.map((s, i) => {
        const Icon = s.icon;
        const words = copy.segments[s.id];
        return (
          <section
            key={s.id}
            id={s.id}
            className="scroll-mt-16 border-b"
            style={{
              borderColor: "var(--hs-line)",
              background: i % 2 === 1 ? "var(--hs-raised)" : "var(--hs-bg)",
            }}
          >
            <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
              <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] lg:gap-14">
                <div>
                  <div className="mb-3 flex items-center gap-2.5">
                    <span
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[7px]"
                      style={{ background: "var(--hs-brand-weak)", color: "var(--hs-brand)" }}
                    >
                      <Icon size={15} />
                    </span>
                    <Eyebrow n={s.n}>{words.name}</Eyebrow>
                  </div>
                  <SectionTitle>{words.headline}</SectionTitle>
                  <Lead>{words.body}</Lead>

                  <ul className="mt-8 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
                    {words.fit.map((f) => (
                      <li key={f.title} className="border-t pt-4" style={{ borderColor: "var(--hs-line)" }}>
                        <p
                          className="text-[15px] font-semibold"
                          style={{ fontFamily: "var(--font-display)", color: "var(--hs-ink)" }}
                        >
                          {f.title}
                        </p>
                        <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>
                          {f.body}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
                  <Card>
                    <p
                      className="mb-3 text-[11px] font-semibold uppercase tracking-[0.1em]"
                      style={{ color: "var(--hs-ink-3)" }}
                    >
                      {copy.pains}
                    </p>
                    <ul className="space-y-2.5">
                      {words.pains.map((p) => (
                        <li key={p} className="flex gap-2.5 text-[13px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>
                          <span
                            aria-hidden="true"
                            className="mt-1.5 h-1 w-1 shrink-0 rounded-full"
                            style={{ background: "var(--hs-danger)" }}
                          />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </Card>

                  {s.proof && (
                    <Card>
                      <p
                        className="mb-3 text-[11px] font-semibold uppercase tracking-[0.1em]"
                        style={{ color: "var(--hs-ink-3)" }}
                      >
                        {copy.proof}
                      </p>
                      <dl className="grid grid-cols-2 gap-4">
                        {s.proof.map((value, k) => ({ value, label: words.proof?.[k] ?? "" })).map((m) => (
                          <div key={m.label}>
                            <dd
                              className="text-2xl font-semibold"
                              style={{
                                fontFamily: "var(--font-display)",
                                color: "var(--hs-ink)",
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              {m.value}
                            </dd>
                            <dt className="text-[11px] uppercase tracking-[0.09em]" style={{ color: "var(--hs-ink-3)" }}>
                              {m.label}
                            </dt>
                          </div>
                        ))}
                      </dl>
                    </Card>
                  )}

                  <Card>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[13px]" style={{ color: "var(--hs-ink-3)" }}>
                        {copy.startsOn}
                      </span>
                      <Badge tone="brand">{words.plan}</Badge>
                    </div>
                    <a
                      href={mailto(`HackOS — ${s.subject} enquiry`)}
                      className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--hs-radius-sm)] px-4 text-[15px] font-semibold"
                      style={{ background: "var(--hs-ink)", color: "var(--hs-bg)" }}
                    >
                      {copy.talk} <ArrowRight size={15} />
                    </a>
                  </Card>
                </div>
              </div>
            </div>
          </section>
        );
      })}

      <section className="hs-grid" style={{ background: "var(--hs-deep)" }}>
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <div className="max-w-2xl">
            <SectionTitle light>{copy.notSure}</SectionTitle>
            <Lead light>{copy.notSureLead}</Lead>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/demo"
                className="inline-flex min-h-11 items-center gap-2 rounded-[var(--hs-radius-sm)] px-5 text-[15px] font-semibold"
                style={{ background: "var(--hs-on-deep)", color: "var(--hs-deep-ink)" }}
              >
                <Play size={15} /> {copy.walkthrough}
              </Link>
              <Link
                href="/pricing"
                className="inline-flex min-h-11 items-center gap-2 rounded-[var(--hs-radius-sm)] border px-5 text-[15px] font-medium"
                style={{ borderColor: "var(--hs-line-deep)", color: "var(--hs-on-deep)" }}
              >
                {copy.compare}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
