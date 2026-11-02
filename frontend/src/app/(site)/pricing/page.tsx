"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Minus, Play, Shield } from "lucide-react";
import { Card, Eyebrow, Lead, SectionTitle } from "@/components/ds/primitives";
import { useTranslation } from "@/contexts/LanguageContext";
import { fill } from "@/lib/i18n/fill";
import { numberFormatter } from "@/lib/i18n/numbers";
import { formatDate } from "@/lib/i18n/dates";
import { discountValueText, formatPriceMinor, savingPercent } from "@/lib/pricing";
import { educationOffer, liveCommunity, liveOffer, livePlan, onSale, planById, useCheckoutInfo, type PlanPrice } from "../_plans";
import { PRICING_COPY, type Lang, type PlanId, type PricingCopy } from "./copy";
import { FEATURED, MATRIX, TIER_IDS, type Val } from "./matrix";

/* Quoted plans go to the contact form (it posts to the sales inbox); a mailto:
   link does nothing on a laptop without a mail client. */
const contactHref = (plan: string) => `/contact?topic=enterprise&plan=${encodeURIComponent(plan)}`;

type Billing = "event" | "annual";

function Cell({ value, labels }: { value: string | boolean; labels: PricingCopy["compare"] }) {
  if (value === true)
    return <Check size={15} style={{ color: "var(--hs-ok)" }} aria-label={labels.included} />;
  if (value === false)
    return <Minus size={15} style={{ color: "var(--hs-ink-3)" }} aria-label={labels.notIncluded} />;
  return (
    <span className="text-[13px]" style={{ color: "var(--hs-ink-2)", fontVariantNumeric: "tabular-nums" }}>
      {value}
    </span>
  );
}

export default function PricingPage() {
  const [billing, setBilling] = useState<Billing>("annual");
  const { lang: rawLang, t } = useTranslation();
  const lang: Lang = rawLang === "az" || rawLang === "ru" ? rawLang : "en";
  const copy = PRICING_COPY[lang];
  const num = useMemo(() => numberFormatter(lang), [lang]);
  const info = useCheckoutInfo();
  const perEvent = billing === "event";
  /* The one VAT line, from the seller's setting. */
  const vatRate = info.vat.registered ? info.vat.ratePercent : null;
  const vatShort = vatRate ? fill(t("vat.excl"), { rate: vatRate }) : t("vat.none_short");
  const vatSentence = vatRate ? fill(t("vat.sentence_added"), { rate: vatRate }) : t("vat.none");

  /* What a plan allows, in words, from the numbers in ../_plans.ts. */
  const limitsOf = (id: PlanId, plan: PlanPrice | null) => {
    const v = copy.limitValues;
    const unlimited = (n: number | null | undefined) => n == null;
    const events = !plan || plan.quoteOnly || unlimited(plan.eventsPerYear)
      ? v.unlimited
      : billing === "event"
        ? "1"
        : fill(v.perYear, { n: plan.eventsPerYear });
    const participants = !plan || unlimited(plan.participants)
      ? v.unlimited
      : fill(v.perEvent, { n: num.format(plan.participants as number) });
    const seats = !plan || unlimited(plan.seats) ? v.unlimited : String(plan.seats);
    return [
      { label: copy.limitLabels.events, value: events },
      { label: copy.limitLabels.participants, value: participants },
      { label: copy.limitLabels.seats, value: seats },
      { label: copy.limitLabels.support, value: copy.tiers[id].support },
    ];
  };

  /* The includes follow the billing period too: a per-event purchase is one event. */
  const includesOf = (id: PlanId, plan: PlanPrice | null) =>
    copy.tiers[id].includes.map((line) =>
      fill(line, {
        events: perEvent || plan?.eventsPerYear == null
          ? copy.limitValues.oneEvent
          : fill(copy.limitValues.eventsYear, { n: plan.eventsPerYear }),
        participants: plan?.participants != null ? num.format(plan.participants) : "",
      }),
    );

  /* The plan as the owner's catalogue has it: its limits, once the API has answered. */
  const planOf = (id: string) => {
    const p = planById(id);
    return p ? livePlan(p, info) : null;
  };

  const matrixValue = (v: Val, id: PlanId): string | boolean => {
    if (typeof v === "boolean") return v;
    const plan = planOf(id);
    if (v === "events" && perEvent) return plan?.quoteOnly ? copy.limitValues.unlimited : "1";
    const n = v === "events" ? plan?.eventsPerYear : plan?.seats;
    return n == null ? copy.limitValues.unlimited : String(n);
  };

  return (
    <>
      {/* ── Head ─────────────────────────────────────────────────────── */}
      <section className="border-b" style={{ borderColor: "var(--hs-line)" }}>
        <div className="mx-auto max-w-6xl px-5 pb-10 pt-14 sm:pt-20">
          <Eyebrow>{copy.eyebrow}</Eyebrow>
          <SectionTitle as="h1">{copy.title}</SectionTitle>
          <Lead>{copy.lead}</Lead>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <div
              role="group"
              aria-label={copy.billingLabel}
              className="inline-flex items-center rounded-[var(--hs-radius-sm)] border p-0.5"
              style={{ borderColor: "var(--hs-line-2)", background: "var(--hs-surface)" }}
            >
              {(
                [
                  { id: "event", label: copy.perEvent },
                  { id: "annual", label: copy.annual },
                ] as { id: Billing; label: string }[]
              ).map((b) => {
                const active = billing === b.id;
                return (
                  <button
                    key={b.id}
                    onClick={() => setBilling(b.id)}
                    aria-pressed={active}
                    className="min-h-9 rounded-[5px] px-3.5 text-[15px] font-medium transition-colors"
                    style={{
                      background: active ? "var(--hs-ink)" : "transparent",
                      color: active ? "var(--hs-bg)" : "var(--hs-ink-2)",
                    }}
                  >
                    {b.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[13px]" style={{ color: "var(--hs-ink-3)" }}>
              {billing === "annual" ? copy.annualHint : copy.perEventHint}
            </p>
          </div>
        </div>
      </section>

      {/* ── Tiers ────────────────────────────────────────────────────── */}
      <section className="border-b" style={{ borderColor: "var(--hs-line)" }}>
        <div className="mx-auto max-w-6xl px-5 py-12">
          <div className="hs-stagger grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {TIER_IDS.map((id) => {
              const price = planOf(id);
              const name = price?.name ?? id;
              const tier = copy.tiers[id];
              const featured = id === FEATURED;
              return (
              <div
                key={id}
                className="flex flex-col rounded-[var(--hs-radius)] border p-6"
                style={{
                  borderColor: featured ? "var(--hs-feature-border)" : "var(--hs-line)",
                  background: featured ? "var(--hs-feature-bg)" : "var(--hs-surface)",
                  color: featured ? "var(--hs-on-deep)" : "var(--hs-ink)",
                  boxShadow: featured ? "var(--hs-feature-glow)" : "none",
                }}
              >
                <h2
                  className="text-lg font-semibold tracking-[-0.01em]"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {name}
                </h2>
                <p
                  className="mt-1.5 text-[15px] leading-relaxed"
                  style={{ color: featured ? "var(--hs-on-deep-2)" : "var(--hs-ink-2)" }}
                >
                  {tier.tagline}
                </p>

                {(() => {
                  const annual = billing === "annual";
                  const selling = price ? onSale(price, info) : false;
                  const offer = price && selling ? liveOffer(price, annual, info) : null;
                  const amount = offer ? offer.nowMinor : null;
                  // The larger of the university and the non-profit campaign, if either runs.
                  const edu = price && selling
                    ? [educationOffer(price, annual, info, "education"), educationOffer(price, annual, info, "nonprofit")]
                      .reduce((a, b) => (b && (!a || b.discountMinor > a.discountMinor) ? b : a), null)
                    : null;
                  const muted = featured ? "var(--hs-on-deep-3)" : "var(--hs-ink-3)";
                  const off = price && !price.quoteOnly && !selling;
                  return (
                    <>
                      {/* A campaign for everyone, or the owner's "was" price, reads
                          as a struck-through figure beside the price charged. */}
                      {offer?.campaign ? (
                        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-semibold">
                          <span
                            className="rounded-full px-2 py-0.5"
                            style={{ background: featured ? "var(--hs-on-deep)" : "var(--hs-brand-weak)", color: featured ? "var(--hs-deep-ink)" : "var(--hs-brand)" }}
                          >
                            {fill(t("price.offer"), { name: offer.campaign.name, value: discountValueText(offer.campaign, lang) })}
                          </span>
                          {offer.campaign.firstPurchaseOnly ? (
                            <span className="font-normal" style={{ color: muted }}>{t("price.offer_first")}</span>
                          ) : null}
                          {offer.campaign.validUntil ? (
                            <span className="font-normal" style={{ color: muted }}>
                              {fill(t("price.offer_until"), { date: formatDate(offer.campaign.validUntil, lang, { day: "numeric", month: "long" }) })}
                            </span>
                          ) : null}
                        </p>
                      ) : null}
                      <p className={`${offer?.campaign ? "mt-2" : "mt-5"} flex flex-wrap items-baseline gap-x-2`}>
                        <span
                          className="text-2xl font-semibold tracking-[-0.02em]"
                          style={{ fontFamily: "var(--font-display)", fontVariantNumeric: "tabular-nums" }}
                        >
                          {off ? t("price.off_sale") : amount == null ? copy.custom : formatPriceMinor(amount, lang)}
                        </span>
                        {offer?.wasMinor != null && amount != null ? (
                          <>
                            <s
                              className="text-[15px] font-medium"
                              style={{ color: muted, fontVariantNumeric: "tabular-nums" }}
                              aria-label={fill(t("price.was"), { price: formatPriceMinor(offer.wasMinor, lang) })}
                            >
                              {formatPriceMinor(offer.wasMinor, lang)}
                            </s>
                            <span className="text-[12px] font-semibold" style={{ color: featured ? "var(--hs-on-deep)" : "var(--hs-ok)" }}>
                              {fill(t("price.save"), { n: savingPercent(offer.wasMinor, amount) })}
                            </span>
                          </>
                        ) : null}
                      </p>
                      <p
                        className="text-[13px]"
                        style={{ color: muted }}
                      >
                        {off
                          ? t("price.off_sale_body")
                          : amount == null
                            ? annual ? copy.quotedAnnually : copy.quotedPerEvent
                            : `${annual ? copy.perYearUnit : copy.perEventUnit} · ${vatShort}`}
                      </p>
                      {edu ? (
                        <p className="mt-2 text-[12px] leading-relaxed" style={{ color: featured ? "var(--hs-on-deep-2)" : "var(--hs-ink-2)" }}>
                          {fill(t("price.edu_note"), { value: discountValueText(edu.campaign, lang) })}
                        </p>
                      ) : null}

                      {/* Quoted plans and plans off sale go to a person, through
                          the contact form; priced ones go to checkout. */}
                      {amount == null || off ? (
                        <Link
                          href={contactHref(id)}
                          className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--hs-radius-sm)] px-4 text-[15px] font-semibold"
                          style={
                            featured
                              ? { background: "var(--hs-on-deep)", color: "var(--hs-deep-ink)" }
                              : { background: "var(--hs-brand-solid)", color: "#fff" }
                          }
                        >
                          {off ? t("price.off_sale_cta") : tier.cta}
                          <ArrowRight size={15} />
                        </Link>
                      ) : (
                        <Link
                          href={`/checkout?plan=${id}&period=${billing}`}
                          className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--hs-radius-sm)] px-4 text-[15px] font-semibold"
                          style={
                            featured
                              ? { background: "var(--hs-on-deep)", color: "var(--hs-deep-ink)" }
                              : { background: "var(--hs-brand-solid)", color: "#fff" }
                          }
                        >
                          {fill(copy.choose, { plan: name })}
                          <ArrowRight size={15} />
                        </Link>
                      )}
                    </>
                  );
                })()}

                <dl className="mt-6 space-y-2 border-t pt-5" style={{ borderColor: featured ? "var(--hs-line-deep)" : "var(--hs-line)" }}>
                  {limitsOf(id, price).map((l) => (
                    <div key={l.label} className="flex items-baseline justify-between gap-3 text-[13px]">
                      <dt style={{ color: featured ? "var(--hs-on-deep-3)" : "var(--hs-ink-3)" }}>
                        {l.label}
                      </dt>
                      <dd
                        className="text-right font-medium"
                        style={{
                          color: featured ? "var(--hs-on-deep)" : "var(--hs-ink)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {l.value}
                      </dd>
                    </div>
                  ))}
                </dl>

                <ul className="mt-5 flex-1 space-y-2">
                  {includesOf(id, price).map((i) => (
                    <li key={i} className="flex gap-2 text-[13px] leading-relaxed">
                      <Check
                        size={13}
                        className="mt-0.5 shrink-0"
                        style={{ color: featured ? "var(--hs-on-deep)" : "var(--hs-brand)" }}
                      />
                      <span style={{ color: featured ? "var(--hs-on-deep-2)" : "var(--hs-ink-2)" }}>
                        {i}
                      </span>
                    </li>
                  ))}
                </ul>

                <p
                  className="mt-5 border-t pt-4 text-[12px] leading-relaxed"
                  style={{
                    borderColor: featured ? "var(--hs-line-deep)" : "var(--hs-line)",
                    color: featured ? "var(--hs-on-deep-3)" : "var(--hs-ink-3)",
                  }}
                >
                  {fill(copy.bestFor, { who: tier.best })}
                </p>
              </div>
              );
            })}
          </div>

          {/* Community: free, granted by hand, so "Apply" opens the contact form. */}
          {(() => {
            const c = liveCommunity(info);
            const events = c.eventsPerYear == null ? copy.limitValues.unlimited : fill(copy.limitValues.eventsYear, { n: c.eventsPerYear });
            return (
              <div
                className="mt-4 flex flex-col gap-5 rounded-[var(--hs-radius)] border p-6 md:flex-row md:items-center md:justify-between"
                style={{ borderColor: "var(--hs-line)", background: "var(--hs-surface)" }}
              >
                <div className="min-w-0 max-w-2xl">
                  <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-lg font-semibold tracking-[-0.01em]" style={{ fontFamily: "var(--font-display)", color: "var(--hs-ink)" }}>
                      {copy.community.name}
                    </span>
                    <span className="rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: "var(--hs-ok-weak)", color: "var(--hs-ok)" }}>
                      {copy.community.free}
                    </span>
                  </p>
                  <p className="mt-1.5 text-[15px] font-medium" style={{ color: "var(--hs-ink)" }}>{copy.community.title}</p>
                  <p className="mt-1 text-[14px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>{copy.community.body}</p>
                  <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
                    {copy.community.points.map((pt) => (
                      <li key={pt} className="flex items-center gap-1.5 text-[13px]" style={{ color: "var(--hs-ink-2)" }}>
                        <Check size={13} className="shrink-0" style={{ color: "var(--hs-brand)" }} />
                        {fill(pt, { events, participants: c.participants == null ? copy.limitValues.unlimited : num.format(c.participants) })}
                      </li>
                    ))}
                  </ul>
                </div>
                <Link
                  href="/contact?topic=community"
                  className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-[var(--hs-radius-sm)] border px-5 text-[15px] font-semibold"
                  style={{ borderColor: "var(--hs-line-2)", color: "var(--hs-ink)" }}
                >
                  {copy.community.cta} <ArrowRight size={15} />
                </Link>
              </div>
            );
          })()}

          <p
            className="mt-6 max-w-2xl text-[13px] leading-relaxed"
            style={{ fontFamily: "var(--font-mono-ui)", color: "var(--hs-ink-2)" }}
          >
            {fill(copy.note, { vat: vatSentence })}
          </p>
        </div>
      </section>

      {/* ── Comparison matrix ────────────────────────────────────────── */}
      <section className="border-b" style={{ borderColor: "var(--hs-line)", background: "var(--hs-raised)" }}>
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <Eyebrow n="01">{copy.compare.eyebrow}</Eyebrow>
          <SectionTitle>{copy.compare.title}</SectionTitle>
          <Lead>{copy.compare.lead}</Lead>

          <div
            className="hs-scroll-x mt-10 rounded-[var(--hs-radius)] border"
            style={{ background: "var(--hs-surface)", borderColor: "var(--hs-line)" }}
          >
            <table className="w-full text-[15px]" style={{ minWidth: 720 }}>
              <thead>
                <tr className="border-b" style={{ borderColor: "var(--hs-line)" }}>
                  <th className="px-4 py-3 text-left font-medium" style={{ color: "var(--hs-ink-3)", width: "34%" }}>
                    {copy.compare.feature}
                  </th>
                  {TIER_IDS.map((id) => (
                    <th
                      key={id}
                      className="px-3 py-3 text-center text-[15px] font-semibold"
                      style={{
                        color: id === FEATURED ? "var(--hs-brand)" : "var(--hs-ink)",
                        fontFamily: "var(--font-display)",
                      }}
                    >
                      {planOf(id)?.name ?? id}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MATRIX.map((g) => {
                  const words = copy.matrix[g.group] as { title: string; rows: Record<string, string> };
                  return (
                  <Fragment key={g.group}>
                    <tr style={{ background: "var(--hs-bg)" }}>
                      <td
                        colSpan={5}
                        className="px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.1em]"
                        style={{ color: "var(--hs-ink-3)" }}
                      >
                        {words.title}
                      </td>
                    </tr>
                    {g.rows.map((r) => (
                      <tr key={g.group + r.key} className="border-b" style={{ borderColor: "var(--hs-line)" }}>
                        <td className="px-4 py-2.5" style={{ color: "var(--hs-ink-2)" }}>
                          {g.group === "workspace" && r.key === "events" && perEvent ? copy.matrix.workspace.eventsPerPurchase : words.rows[r.key]}
                        </td>
                        {r.values.map((v, i) => (
                          <td key={i} className="px-3 py-2.5 text-center">
                            <span className="inline-flex items-center justify-center">
                              <Cell value={matrixValue(v, TIER_IDS[i])} labels={copy.compare} />
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Enterprise ───────────────────────────────────────────────── */}
      <section className="hs-grid" style={{ background: "var(--hs-deep)" }}>
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-center">
            <div>
              <p
                className="mb-3 text-[12px] font-medium uppercase tracking-[0.16em]"
                style={{ fontFamily: "var(--font-mono-ui)", color: "var(--hs-brand-lift)" }}
              >
                {copy.enterprise.eyebrow}
              </p>
              <SectionTitle light>{copy.enterprise.title}</SectionTitle>
              <Lead light>{copy.enterprise.lead}</Lead>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href={contactHref("enterprise")}
                  className="inline-flex min-h-11 items-center gap-2 rounded-[var(--hs-radius-sm)] px-5 text-[15px] font-semibold"
                  style={{ background: "var(--hs-on-deep)", color: "var(--hs-deep-ink)" }}
                >
                  {copy.enterprise.contact} <ArrowRight size={16} />
                </Link>
                <Link
                  href="/privacy"
                  className="inline-flex min-h-11 items-center gap-2 rounded-[var(--hs-radius-sm)] border px-5 text-[15px] font-medium"
                  style={{ borderColor: "var(--hs-line-deep)", color: "var(--hs-on-deep)" }}
                >
                  <Shield size={15} /> {copy.enterprise.data}
                </Link>
              </div>
            </div>

            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {copy.enterprise.points.map((f) => (
                <li
                  key={f}
                  className="flex gap-2.5 rounded-[var(--hs-radius-sm)] border p-3.5 text-[13px] leading-relaxed"
                  style={{ borderColor: "var(--hs-line-deep)", color: "var(--hs-on-deep-2)" }}
                >
                  <Check size={14} className="mt-0.5 shrink-0" style={{ color: "var(--hs-brand-lift)" }} />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────── */}
      <section className="border-b" style={{ borderColor: "var(--hs-line)" }}>
        <div className="mx-auto max-w-3xl px-5 py-16 sm:py-20">
          <Eyebrow n="02">{copy.faq.eyebrow}</Eyebrow>
          <SectionTitle>{copy.faq.title}</SectionTitle>
          <dl className="mt-10 border-t" style={{ borderColor: "var(--hs-line)" }}>
            {copy.faq.items.map((f) => (
              <div key={f.q} className="border-b py-5" style={{ borderColor: "var(--hs-line)" }}>
                <dt
                  className="text-[16px] font-medium"
                  style={{ fontFamily: "var(--font-display)", color: "var(--hs-ink)" }}
                >
                  {f.q}
                </dt>
                <dd className="mt-2 text-[15px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>
                  {fill(f.a, { vat: vatSentence })}
                </dd>
              </div>
            ))}
          </dl>

          <Card className="mt-10">
            <p className="text-[15px] font-semibold" style={{ color: "var(--hs-ink)" }}>
              {copy.help.title}
            </p>
            <p className="mt-1.5 text-[15px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>
              {copy.help.body}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/demo"
                className="inline-flex min-h-11 items-center gap-2 rounded-[var(--hs-radius-sm)] px-5 text-[15px] font-semibold"
                style={{ background: "var(--hs-ink)", color: "var(--hs-bg)" }}
              >
                <Play size={15} /> {copy.help.walkthrough}
              </Link>
              <Link
                href="/contact"
                className="inline-flex min-h-11 items-center gap-2 rounded-[var(--hs-radius-sm)] border px-5 text-[15px] font-medium"
                style={{ borderColor: "var(--hs-line-2)", color: "var(--hs-ink)" }}
              >
                {copy.help.contact}
              </Link>
            </div>
          </Card>
        </div>
      </section>
    </>
  );
}
