"use client";

/*
 * The home page.
 *
 * One idea per screen, a lot of air between them: a two-tone headline that
 * says what HackOS is, the hackathons it already ran (with their organisers'
 * logos), live figures from the API, a manifesto
 * that lights up as it is read, the modules, the workspace, the five roles,
 * how buying and running an event works, integrations, the plans with their
 * real prices, questions, and a closing call to action.
 *
 * The closing section carries `data-logo-stage` so a brand visual can be
 * staged there later without touching the layout.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, Plus } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { Logo3D } from "@/components/brand/Logo3D";
import { numberFormatter } from "@/lib/i18n/numbers";
import { fetchPublicStats, type PublicStats } from "@/lib/publicStats";
import { CONTACT_EMAIL } from "@/lib/site";
import { PLAN_PRICES, formatPrice, livePrice, useCheckoutInfo } from "../_plans";
import { LANDING_COPY, type Lang, type LandingCopy } from "./copy";

/* ── Shared building blocks ──────────────────────────────────────────── */

function Container({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>{children}</div>;
}

/** Two-column section head: chapter + title on the left, lead on the right. */
function SectionHead({
  chapter,
  title,
  lead,
  action,
}: {
  chapter: string;
  title: string;
  lead?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="hs-reveal grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-16">
      <div>
        <p className="hs-chapter">{chapter}</p>
        <h2 className="hs-display hs-h2 mt-5 max-w-[14ch] text-balance">{title}</h2>
      </div>
      {(lead || action) && (
        <div className="md:pt-10">
          {lead && <p className="hs-lead-lg max-w-[34rem]">{lead}</p>}
          {action && <div className="mt-6">{action}</div>}
        </div>
      )}
    </div>
  );
}

function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1.5 text-[15px] font-medium"
      style={{ color: "var(--hs-brand)" }}
    >
      {children}
      <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/* ── Manifesto: words light up as the paragraph scrolls through ──────── */

function Manifesto({ chapter, text }: { chapter: string; text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [progress, setProgress] = useState(1);
  const words = useMemo(() => text.split(" "), [text]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // 0 when the paragraph's top reaches 85% of the viewport, 1 when its
      // bottom reaches 45%.
      const start = vh * 0.85;
      const end = vh * 0.45;
      const total = r.height + (start - end);
      setProgress(Math.min(1, Math.max(0, (start - r.top) / total)));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section className="py-28 md:py-40">
      <Container>
        <p className="hs-chapter">{chapter}</p>
        <p
          ref={ref}
          className="mt-8 max-w-[24ch] text-[clamp(28px,4.2vw,58px)] font-semibold leading-[1.1] tracking-[-0.035em]"
          style={{ color: "var(--hs-ink)" }}
        >
          {words.map((w, i) => {
            const at = (i + 0.5) / words.length;
            const lit = Math.min(1, Math.max(0, (progress - at) * words.length * 0.6 + 1));
            return (
              <span key={i} style={{ opacity: 0.16 + 0.84 * lit, transition: "opacity .15s linear" }}>
                {w}{" "}
              </span>
            );
          })}
        </p>
      </Container>
    </section>
  );
}

/* ── Roles drawn around one event ────────────────────────────────────── */

function RolesDiagram({ roles, tags }: { roles: LandingCopy["roles"]["items"]; tags: string[] }) {
  // Five nodes on a circle around the event, starting at the top.
  const nodes = roles.map((r, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / roles.length;
    return { ...r, tag: tags[i] ?? "", x: 50 + Math.cos(a) * 36, y: 50 + Math.sin(a) * 36 };
  });
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[460px]" aria-hidden>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
        <circle cx="50" cy="50" r="46" fill="none" stroke="var(--hs-line)" strokeDasharray="0.6 1.4" strokeWidth="0.3" />
        {nodes.map((n) => {
          // Line from the centre circle's edge to the node circle's edge.
          const dx = n.x - 50;
          const dy = n.y - 50;
          const len = Math.hypot(dx, dy);
          const ux = dx / len;
          const uy = dy / len;
          return (
            <g key={n.name}>
              <line
                x1={50 + ux * 13.5}
                y1={50 + uy * 13.5}
                x2={n.x - ux * 10.5}
                y2={n.y - uy * 10.5}
                stroke="var(--hs-ink-3)"
                strokeWidth="0.25"
              />
              <circle cx={n.x - ux * 10.5} cy={n.y - uy * 10.5} r="0.7" fill="var(--hs-ink)" />
            </g>
          );
        })}
      </svg>
      <div
        className="absolute left-1/2 top-1/2 flex h-[27%] w-[27%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[1.5px] text-[clamp(14px,1.6vw,18px)] font-semibold"
        style={{ borderColor: "var(--hs-ink)", background: "var(--hs-surface)", color: "var(--hs-ink)" }}
      >
        HackOS
      </div>
      {nodes.map((n) => (
        <div
          key={n.name}
          className="absolute flex h-[21%] w-[21%] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border text-center"
          style={{ left: `${n.x}%`, top: `${n.y}%`, borderColor: "var(--hs-ink)", background: "var(--hs-surface)" }}
        >
          <span className="text-[clamp(11px,1.15vw,14px)] font-medium" style={{ color: "var(--hs-ink)" }}>
            {n.name}
          </span>
          <span className="hs-mono mt-0.5 px-1 text-[clamp(7px,0.7vw,9px)] uppercase leading-tight" style={{ color: "var(--hs-ink-3)" }}>
            {n.tag}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── A drawn impression of the console ───────────────────────────────── */

function ConsoleMock() {
  return (
    <div
      className="hs-card overflow-hidden"
      style={{ boxShadow: "0 40px 80px -40px rgba(15, 18, 30, 0.35)" }}
      aria-hidden
    >
      <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--hs-line)", background: "var(--hs-raised)" }}>
        <span className="flex gap-1.5">
          {["#e0554f", "#e8b23a", "#4aa96c"].map((c) => (
            <span key={c} className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
          ))}
        </span>
        <span className="hs-mono ml-2 truncate text-[11px]" style={{ color: "var(--hs-ink-3)" }}>
          app.hack-os.app
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3 p-5">
        {[
          { label: "Participants", value: "152" },
          { label: "Teams", value: "21" },
          { label: "Scores", value: "855" },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border p-3.5" style={{ borderColor: "var(--hs-line)" }}>
            <p className="hs-mono text-[9px] uppercase" style={{ color: "var(--hs-ink-3)" }}>
              {s.label}
            </p>
            <p className="mt-1.5 text-[20px] font-semibold tracking-[-0.02em]" style={{ color: "var(--hs-ink)", fontVariantNumeric: "tabular-nums" }}>
              {s.value}
            </p>
          </div>
        ))}
      </div>
      <div className="px-5 pb-5">
        <div className="flex h-28 items-end gap-2 rounded-2xl border p-4" style={{ borderColor: "var(--hs-line)" }}>
          {[22, 34, 48, 41, 63, 88, 72, 54].map((h, i) => (
            <span
              key={i}
              className="flex-1 rounded-t-[4px]"
              style={{ height: `${h}%`, background: i === 5 ? "var(--hs-brand-solid)" : "var(--hs-tint-2)" }}
            />
          ))}
        </div>
      </div>
      <div className="border-t px-5 py-3.5" style={{ borderColor: "var(--hs-line)" }}>
        {[
          { team: "Team Nebula", state: "Judging" },
          { team: "Byte Builders", state: "Submitted" },
          { team: "Caspian AI", state: "Submitted" },
        ].map((r, i) => (
          <div key={r.team} className="flex items-center justify-between gap-3 py-1.5 text-[13px]" style={{ color: "var(--hs-ink-2)" }}>
            <span className="truncate">{r.team}</span>
            <span
              className="hs-mono shrink-0 rounded-full px-2.5 py-0.5 text-[10px]"
              style={{
                background: i === 0 ? "var(--hs-brand-weak)" : "var(--hs-tint)",
                color: i === 0 ? "var(--hs-brand)" : "var(--hs-ink-2)",
              }}
            >
              {r.state}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}


/* ── Hackathons run on HackOS, with their organisers' logos ─────────── */

const LOGOS: Record<LandingCopy["usedBy"]["items"][number]["logo"], { src: string; alt: string; width: number; height: number }> = {
  azcon: { src: "/logos/azcon-holding.svg", alt: "AZCON Holding", width: 602, height: 184 },
  holberton: { src: "/logos/holberton-azerbaijan.png", alt: "Holberton School Azerbaijan", width: 720, height: 214 },
};

function UsedBySection({ copy }: { copy: LandingCopy["usedBy"] }) {
  return (
    <section id="used-by" className="scroll-mt-24 py-20 md:py-28">
      <Container>
        <SectionHead chapter={copy.eyebrow} title={copy.title} lead={copy.body} />
        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-2">
          {copy.items.map((it) => {
            const logo = LOGOS[it.logo];
            return (
              <article key={it.name} className="hs-reveal hs-card flex flex-col p-7 sm:p-9">
                <div className="flex h-14 items-center">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a static file, sized here */}
                  <img
                    src={logo.src}
                    alt={logo.alt}
                    width={logo.width}
                    height={logo.height}
                    className="hs-partner-logo h-11 w-auto max-w-[220px] object-contain object-left"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <h3 className="hs-h3 mt-7" style={{ color: "var(--hs-ink)" }}>
                  {it.name}
                </h3>
                <p className="hs-mono mt-3 text-[11px] uppercase tracking-[0.12em]" style={{ color: "var(--hs-ink-3)" }}>
                  {it.hosts}
                </p>
                <p className="mt-4 flex-1 text-[15px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>
                  {it.blurb}
                </p>
                <p className="mt-7 border-t pt-5 text-[13.5px] font-medium" style={{ borderColor: "var(--hs-line)", color: "var(--hs-ink)" }}>
                  {it.meta}
                </p>
              </article>
            );
          })}
        </div>
      </Container>
    </section>
  );
}

/* ── Figures from the API, counted up once they come into view ──────── */

function useCountUp(target: number | null, run: boolean) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (target == null || !run) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || target === 0) {
      const id = requestAnimationFrame(() => setShown(target));
      return () => cancelAnimationFrame(id);
    }
    const start = performance.now();
    const ms = 1200;
    let raf = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / ms);
      setShown(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [target, run]);
  return shown;
}

function Figure({ value, label, run, lang }: { value: number | null; label: string; run: boolean; lang: Lang }) {
  const shown = useCountUp(value, run);
  const fmt = useMemo(() => numberFormatter(lang), [lang]);
  return (
    <div>
      <p
        className="text-[clamp(36px,4.4vw,56px)] font-semibold tracking-[-0.04em]"
        style={{ color: value == null ? "var(--hs-ink-3)" : "var(--hs-ink)", fontVariantNumeric: "tabular-nums" }}
        aria-label={value == null ? undefined : `${fmt.format(value)} ${label}`}
      >
        {value == null ? "—" : fmt.format(shown)}
      </p>
      <p className="hs-mono mt-2 text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--hs-ink-3)" }} aria-hidden={value != null}>
        {label}
      </p>
    </div>
  );
}

function StatsBand({ copy, lang }: { copy: LandingCopy["stats"]; lang: Lang }) {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchPublicStats(ctrl.signal).then((s) => {
      if (ctrl.signal.aborted) return;
      if (s) setStats(s);
      else setFailed(true);
    });
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // No figures rather than made-up ones.
  if (failed) return null;
  const items: { key: keyof Omit<PublicStats, "countedAt">; label: string }[] = [
    { key: "events", label: copy.events },
    { key: "participants", label: copy.participants },
    { key: "teams", label: copy.teams },
    { key: "projects", label: copy.projects },
  ];
  return (
    <section>
      <Container>
        <div ref={box} className="hs-reveal hs-cols grid-cols-2 md:grid-cols-4" style={{ borderBottom: "1px solid var(--hs-line)" }} aria-busy={!stats}>
          {items.map((it) => (
            <Figure key={it.key} value={stats ? stats[it.key] : null} label={it.label} run={visible} lang={lang} />
          ))}
        </div>
        <p className="mt-5 max-w-xl text-[13px]" style={{ color: "var(--hs-ink-3)" }}>
          {copy.caption}
        </p>
      </Container>
    </section>
  );
}

/* ── The plans, with the prices the pricing page and checkout use ───── */

const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));

function PricingPreview({ copy, lang }: { copy: LandingCopy["pricing"]; lang: Lang }) {
  const [billing, setBilling] = useState<"event" | "annual">("event");
  const annual = billing === "annual";
  const fmt = useMemo(() => numberFormatter(lang), [lang]);
  const { t } = useTranslation();
  const info = useCheckoutInfo();
  const vat = info.vat.registered && info.vat.ratePercent ? fill(t("vat.sentence_added"), { rate: info.vat.ratePercent }) : t("vat.none");
  const listed = PLAN_PRICES.filter((p) => !p.quoteOnly);
  const featured = "professional";
  return (
    <section id="pricing" className="scroll-mt-24 py-24 md:py-36">
      <Container>
        <SectionHead
          chapter={copy.eyebrow}
          title={copy.title}
          lead={copy.body}
          action={<TextLink href="/pricing">{copy.compare}</TextLink>}
        />
        <div className="hs-reveal mt-12 inline-flex rounded-full border p-1" role="radiogroup" aria-label={copy.eyebrow} style={{ borderColor: "var(--hs-line-2)" }}>
          {(["event", "annual"] as const).map((b) => {
            const on = billing === b;
            return (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setBilling(b)}
                className="min-h-10 rounded-full px-5 text-[14px] font-medium transition-colors"
                style={{ background: on ? "var(--hs-ink)" : "transparent", color: on ? "var(--hs-bg)" : "var(--hs-ink-2)" }}
              >
                {b === "event" ? copy.perEvent : copy.annual}
              </button>
            );
          })}
        </div>
        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-3">
          {listed.map((p) => {
            const amount = livePrice(p, annual, info);
            const isFeatured = p.id === featured;
            const lines = [
              p.participants != null ? fill(copy.upTo, { n: fmt.format(p.participants) }) : null,
              p.seats != null ? fill(copy.seats, { n: p.seats }) : null,
              annual ? (p.eventsPerYear != null ? fill(copy.eventsYear, { n: p.eventsPerYear }) : null) : copy.oneEvent,
            ].filter((l): l is string => Boolean(l));
            return (
              <article
                key={p.id}
                className="hs-reveal flex flex-col rounded-[24px] border p-7"
                style={{ borderColor: isFeatured ? "var(--hs-ink)" : "var(--hs-line)", background: "var(--hs-surface)" }}
              >
                <h3 className="hs-h3" style={{ color: "var(--hs-ink)" }}>
                  {p.name}
                </h3>
                <p className="mt-2 text-[15px]" style={{ color: "var(--hs-ink-2)" }}>
                  {copy.taglines[p.id as keyof typeof copy.taglines] ?? ""}
                </p>
                <p className="mt-6 flex items-baseline gap-2">
                  <span className="text-[34px] font-semibold tracking-[-0.03em]" style={{ color: "var(--hs-ink)", fontVariantNumeric: "tabular-nums" }}>
                    {amount != null ? formatPrice(amount, lang) : "—"}
                  </span>
                  <span className="text-[14px]" style={{ color: "var(--hs-ink-3)" }}>
                    {annual ? copy.annualUnit : copy.perEventUnit}
                  </span>
                </p>
                <ul className="mt-6 flex-1 space-y-2.5 border-t pt-6" style={{ borderColor: "var(--hs-line)" }}>
                  {lines.map((l) => (
                    <li key={l} className="flex gap-3 text-[14px]" style={{ color: "var(--hs-ink-2)" }}>
                      <Check size={15} className="mt-[3px] shrink-0" style={{ color: "var(--hs-brand)" }} aria-hidden />
                      {l}
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/checkout?plan=${p.id}&period=${annual ? "annual" : "per_event"}`}
                  className={`hs-pill mt-8 w-full ${isFeatured ? "hs-pill-primary" : "hs-pill-ghost"}`}
                  style={{ minHeight: 46 }}
                >
                  {fill(copy.choose, { plan: p.name })}
                </Link>
              </article>
            );
          })}
        </div>
        <div className="hs-reveal mt-5 flex flex-col gap-4 rounded-[24px] border p-7 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "var(--hs-line)" }}>
          <p className="max-w-2xl text-[15px]" style={{ color: "var(--hs-ink-2)" }}>
            {copy.enterpriseBody}
          </p>
          <a
            href="/contact?topic=enterprise"
            className="hs-pill hs-pill-ghost shrink-0"
          >
            {copy.enterpriseCta}
          </a>
        </div>
        <p className="mt-6 max-w-2xl text-[13px]" style={{ color: "var(--hs-ink-3)" }}>
          {fill(copy.note, { vat })}
        </p>
      </Container>
    </section>
  );
}

/* ── Page ────────────────────────────────────────────────────────────── */

export default function HomePage() {
  const { lang: rawLang } = useTranslation();
  const lang: Lang = (rawLang as Lang) in LANDING_COPY ? (rawLang as Lang) : "en";
  const copy = LANDING_COPY[lang];
  // The contact form posts to the sales inbox; a mailto: link does nothing without a mail client.
  const contactHref = "/contact";
  const [faqOpen, setFaqOpen] = useState<number | null>(0);

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="relative -mt-20 overflow-hidden">
        <div className="hs-hero-glow" aria-hidden />
        <Container className="relative flex min-h-[92vh] flex-col items-center justify-center pb-16 pt-36 text-center">
          {/* The mark, in 3D once the page is idle; flat until then, same box. */}
          <div className="hs-rise mb-9 md:mb-10">
            <Logo3D className="h-14 w-14 md:h-[72px] md:w-[72px]" />
          </div>
          <p className="hs-rise hs-mono inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[11px] uppercase tracking-[0.16em]" style={{ borderColor: "var(--hs-line-2)", color: "var(--hs-ink-2)" }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--hs-brand-solid)" }} />
            {copy.hero.eyebrow}
          </p>

          <h1 className="hs-rise hs-display hs-h1 mt-8 max-w-[15ch] text-balance" style={{ animationDelay: ".05s" }}>
            <span className="hs-mute">{copy.hero.title}</span>{" "}
            <span>{copy.hero.titleAccent}</span>
          </h1>

          <p className="hs-rise hs-lead-lg mt-8 max-w-[40rem]" style={{ animationDelay: ".12s" }}>
            {copy.hero.body}
          </p>

          <div className="hs-rise mt-10 flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: ".18s" }}>
            <Link href="/pricing" className="hs-pill hs-pill-primary">
              {copy.hero.ctaPrimary}
            </Link>
            <Link href="/demo" className="hs-pill hs-pill-ghost">
              {copy.hero.ctaSecondary}
            </Link>
          </div>

          <a href="#used-by" className="hs-rise hs-mono mt-10 text-[12px] underline-offset-4 hover:underline" style={{ color: "var(--hs-ink-3)", animationDelay: ".24s" }}>
            {copy.hero.trust}
          </a>

          <div className="mt-12 flex flex-col items-center gap-2" aria-hidden>
            <span className="hs-scroll-cue" />
          </div>
        </Container>
      </section>

      {/* ── Figures from the database ────────────────────────────────── */}
      <StatsBand copy={copy.stats} lang={lang} />

      {/* ── Where it already ran ─────────────────────────────────────── */}
      <UsedBySection copy={copy.usedBy} />

      {/* ── Manifesto ────────────────────────────────────────────────── */}
      <Manifesto chapter={copy.manifesto.chapter} text={copy.manifesto.text} />

      {/* ── Modules ──────────────────────────────────────────────────── */}
      <section id="platform" className="scroll-mt-24 py-24 md:py-36">
        <Container>
          <SectionHead
            chapter={copy.features.eyebrow}
            title={copy.features.title}
            lead={copy.features.body}
            action={<TextLink href="/pricing">{copy.ui.plans}</TextLink>}
          />
          <div className="hs-reveal hs-cols hs-cols-wrap mt-16 md:grid-cols-3">
            {copy.features.items.map((f, i) => (
              <div key={f.title}>
                <p className="hs-mono text-[12px]" style={{ color: "var(--hs-ink-3)" }}>
                  {String(i + 1).padStart(2, "0")}
                </p>
                <h3 className="hs-h3 mt-6" style={{ color: "var(--hs-ink)" }}>
                  {f.title}
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ── Workspace preview ────────────────────────────────────────── */}
      <section className="py-24 md:py-36">
        <Container>
          <div className="grid grid-cols-1 items-center gap-14 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="hs-reveal">
              <p className="hs-chapter">{copy.preview.eyebrow}</p>
              <h2 className="hs-display hs-h2 mt-5 max-w-[14ch] text-balance">{copy.preview.title}</h2>
              <p className="hs-lead-lg mt-6 max-w-[32rem]">{copy.preview.body}</p>
              <ul className="mt-8 space-y-3">
                {copy.preview.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-3 text-[15px]" style={{ color: "var(--hs-ink-2)" }}>
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rotate-45" style={{ background: "var(--hs-brand-solid)" }} />
                    {b}
                  </li>
                ))}
              </ul>
              <Link href="/demo" className="hs-pill hs-pill-ghost mt-10">
                {copy.preview.cta}
                <ArrowUpRight size={16} />
              </Link>
            </div>
            <div className="hs-reveal">
              <ConsoleMock />
            </div>
          </div>
        </Container>
      </section>

      {/* ── Roles ────────────────────────────────────────────────────── */}
      <section className="py-24 md:py-36">
        <Container>
          <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-2">
            <div className="hs-reveal">
              <p className="hs-chapter">{copy.roles.eyebrow}</p>
              <h2 className="hs-display hs-h2 mt-5 max-w-[14ch] text-balance">{copy.roles.title}</h2>
              <p className="hs-lead-lg mt-6 max-w-[34rem]">{copy.roles.body}</p>
              <ul className="mt-8 border-t" style={{ borderColor: "var(--hs-line)" }}>
                {copy.roles.items.map((r) => (
                  <li key={r.name} className="flex gap-4 border-b py-3.5 text-[15px]" style={{ borderColor: "var(--hs-line)" }}>
                    <span className="w-28 shrink-0 font-medium" style={{ color: "var(--hs-ink)" }}>
                      {r.name}
                    </span>
                    <span style={{ color: "var(--hs-ink-2)" }}>{r.body}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="hs-reveal">
              <RolesDiagram roles={copy.roles.items} tags={copy.roleTags} />
            </div>
          </div>
        </Container>
      </section>

      {/* ── How it works: order → set up → create → run ──────────────── */}
      <section id="how" className="scroll-mt-24 py-24 md:py-36">
        <Container>
          <SectionHead chapter={copy.how.eyebrow} title={copy.how.title} lead={copy.how.body} />
          <div className="hs-reveal hs-cols hs-cols-wrap mt-16 sm:grid-cols-2 lg:grid-cols-4">
            {copy.how.items.map((p) => (
              <div key={p.marker}>
                <p className="hs-mono text-[12px]" style={{ color: "var(--hs-brand)" }}>
                  {p.marker}
                </p>
                <h3 className="hs-h3 mt-6" style={{ color: "var(--hs-ink)" }}>
                  {p.title}
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>
                  {p.body}
                </p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ── Integrations: a ticker ───────────────────────────────────── */}
      <section className="py-20 md:py-28">
        <Container>
          <SectionHead chapter={copy.integrations.eyebrow} title={copy.integrations.title} lead={copy.integrations.body} />
        </Container>
        <div className="hs-marquee mt-14 border-y py-7" style={{ borderColor: "var(--hs-line)" }}>
          {/* Four copies, not two: with only a handful of items one copy can be
              narrower than a wide screen, and the ticker would show a gap. */}
          {[0, 1, 2, 3].map((k) => (
            <ul key={k} className="flex shrink-0 items-center" aria-hidden={k > 0}>
              {copy.integrations.items.map((it) => (
                <li key={it.name} className="flex items-center gap-10 pr-10">
                  <span className="h-1.5 w-1.5 rotate-45" style={{ background: "var(--hs-brand-solid)" }} />
                  <span className="whitespace-nowrap">
                    <span className="text-[17px] font-medium" style={{ color: "var(--hs-ink)" }}>
                      {it.name}
                    </span>
                    <span className="ml-3 text-[14px]" style={{ color: "var(--hs-ink-3)" }}>
                      {it.desc}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </section>

      {/* ── Plans and prices ─────────────────────────────────────────── */}
      <PricingPreview copy={copy.pricing} lang={lang} />

      {/* ── FAQ ──────────────────────────────────────────────────────── */}
      <section id="faq" className="scroll-mt-24 py-24 md:py-36">
        <Container>
          <div className="grid grid-cols-1 gap-12 md:grid-cols-[0.8fr_1.2fr] md:gap-20">
            <div className="hs-reveal">
              <p className="hs-chapter">{copy.faq.eyebrow}</p>
              <h2 className="hs-display hs-h2 mt-5">{copy.faq.title}</h2>
              <p className="mt-6 flex flex-col gap-2 text-[15px]" style={{ color: "var(--hs-ink-2)" }}>
                <Link href={contactHref} className="underline decoration-[var(--hs-line-2)] underline-offset-4 hover:decoration-current">
                  {copy.ui.faqMore}
                </Link>
                <Link href="/privacy" className="underline decoration-[var(--hs-line-2)] underline-offset-4 hover:decoration-current">
                  {copy.ui.privacy}
                </Link>
              </p>
            </div>
            <ul className="hs-reveal border-t" style={{ borderColor: "var(--hs-line)" }}>
              {copy.faq.items.map((f, i) => {
                const open = faqOpen === i;
                return (
                  <li key={f.q} className="border-b" style={{ borderColor: "var(--hs-line)" }}>
                    <button
                      type="button"
                      onClick={() => setFaqOpen(open ? null : i)}
                      aria-expanded={open}
                      className="flex w-full items-center justify-between gap-6 py-6 text-left text-[17px] font-medium"
                      style={{ color: "var(--hs-ink)" }}
                    >
                      {f.q}
                      <Plus
                        size={18}
                        className="shrink-0 transition-transform duration-300"
                        style={{ transform: open ? "rotate(45deg)" : "none", color: "var(--hs-ink-3)" }}
                      />
                    </button>
                    <div
                      className="grid transition-[grid-template-rows] duration-300"
                      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
                    >
                      <p className="overflow-hidden pr-10 text-[15px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>
                        <span className="block pb-6">{f.a}</span>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </Container>
      </section>

      {/* ── Closing call to action ───────────────────────────────────── */}
      <section data-logo-stage className="relative overflow-hidden py-32 md:py-44">
        <div className="hs-hero-glow" style={{ top: "auto", bottom: 0 }} aria-hidden />
        <Container className="relative text-center">
          <div className="hs-reveal">
            <p className="hs-chapter justify-center">{copy.contact.eyebrow}</p>
            <h2 className="hs-display mx-auto mt-6 max-w-[14ch] text-balance text-[clamp(40px,6.4vw,88px)]">
              {copy.contact.title}
            </h2>
            <p className="hs-lead-lg mx-auto mt-7 max-w-[36rem]">{copy.contact.body}</p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <Link href={contactHref} className="hs-pill hs-pill-primary">
                {copy.contact.cta}
              </Link>
              <Link href="/pricing" className="hs-pill hs-pill-ghost">
                {copy.contact.secondary}
              </Link>
            </div>
            <a href={`mailto:${CONTACT_EMAIL}`} className="mt-6 inline-block text-[15px] underline-offset-4 hover:underline" style={{ color: "var(--hs-ink-2)" }}>
              {CONTACT_EMAIL}
            </a>
          </div>
        </Container>
      </section>
    </>
  );
}
