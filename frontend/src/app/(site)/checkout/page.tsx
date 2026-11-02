"use client";

/**
 * Checkout, in five steps: plan → organisation → payment → review → done.
 *
 * Placing the order (`POST /api/checkout`) records it as placed and, for a
 * first order, creates the organisation in "awaiting review". Nothing is
 * granted until the platform owner approves it; the buyer then receives a
 * setup link by e-mail. The confirmation screen says exactly that.
 *
 * Payment: bank transfer against an invoice, which is issued when the order
 * is approved and is due 14 days later — the one rule every page states.
 * The card option appears only when the API lists `card` among the payment
 * methods (a card provider is connected); the number and the security code
 * never leave the browser even then.
 *
 * A returning buyer chooses one of their organisations (its VÖEN, city and
 * country are kept for the invoice) or names a different one. Placing needs
 * the Terms and Refund policy accepted, and sends one idempotency key per
 * attempt, so a double click or a retry cannot place two orders. Once placed,
 * the address becomes /checkout?placed=<id>: reloading shows that order, not
 * the form.
 *
 * The price is not sent from here. The amount shown is read from
 * `/api/checkout/plans` and the server prices the order from the same table.
 *
 * Discounts: "Have a code?" in the summary checks the code with the server
 * as soon as it is applied (`POST /api/checkout/quote`) and says why one does
 * not work (expired, used up, not for this plan…). A buyer who is a
 * university or a non-profit can say so on the organisation step when such a
 * campaign runs; that discount is applied after the owner's review. The
 * summary shows the plan's price, the discount and what is charged — always
 * the server's figures once it has answered. Only the code and the claim are
 * sent with the order, never an amount.
 */

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, BadgePercent, Building2, Check, CircleCheck, Download, FileText, GraduationCap, Landmark, CreditCard, Info, Loader2, X } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { BRAND_LABEL } from "@/lib/card";
import { formatMoney, loadMyCommerce, orderStage, type CustomerSummary, type Order } from "@/lib/commerce";
import { useTranslation } from "@/contexts/LanguageContext";
import { fill } from "@/lib/i18n/fill";
import { numberFormatter } from "@/lib/i18n/numbers";
import { CLAIMS, bestCampaign, discountValueText, formatPriceMinor, isCouponReason, type BillingPeriod, type Claim } from "@/lib/pricing";
import { PLAN_PRICES, educationOffer, liveOffer, livePlan, livePriceMinor, onSale, planById, useCheckoutInfo, type PaymentMethod, type PlanPrice } from "../_plans";
import { CardForm, type CardSummary } from "./_card-form";

interface Me {
  id: number;
  full_name?: string;
  email?: string;
}

interface PlacedOrder {
  order: Order;
  customerId: number;
  createdCustomer: boolean;
  replayed?: boolean;
}

type Step = 1 | 2 | 3 | 4 | 5;
type PayMethod = PaymentMethod;
/** The organisation the order is for: one of the buyer's, by id, or a new one. */
type OrgChoice = number | "new";

const SELF_SERVE = PLAN_PRICES.filter((p) => !p.quoteOnly);

/** The country field's default in each language, so it can follow a language switch. */
const COUNTRY_DEFAULTS = ["Azerbaijan", "Azərbaycan", "Азербайджан"];

/** The API's refusals the buyer can act on, in their language. */
const ERROR_KEYS: Record<string, string> = {
  ORGANISATION_NAME_TAKEN: "checkout.err.name_taken",
  CARD_UNAVAILABLE: "checkout.err.card",
  TERMS_REQUIRED: "checkout.err.terms",
  TERMS_CHANGED: "checkout.err.terms_changed",
  IDEMPOTENCY_MISMATCH: "checkout.err.attempt",
  BILLING_OWNER_ONLY: "checkout.err.owner_only",
  PLAN_NOT_ON_SALE: "price.err.PLAN_NOT_ON_SALE",
};

/** The server's price for the order being put together. */
interface Quote {
  plan: string;
  billingPeriod: BillingPeriod;
  priceMinor: number;
  listPriceMinor: number | null;
  discountMinor: number;
  amountMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
  discount: {
    kind: "code" | "campaign";
    code: string | null;
    name: string;
    label: string;
    discountType: "percent" | "fixed";
    percentOff: number | null;
    amountOffMinor: number | null;
    status: "applied" | "claimed";
    needsReview: boolean;
  } | null;
  code: { ok: boolean; code: string; reason?: string; message?: string; applied?: boolean } | null;
}

/** One key per checkout attempt; the API answers a repeat with the order it made. */
function newAttemptKey(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `co-${crypto.randomUUID()}`;
  } catch { /* fall through */ }
  return `co-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function CheckoutInner() {
  const { t, lang } = useTranslation();
  const params = useSearchParams();
  const router = useRouter();
  const info = useCheckoutInfo();
  const placedParam = Number.parseInt(params.get("placed") ?? "", 10);

  const [planId, setPlanId] = useState(() => {
    const p = planById(params.get("plan") ?? "");
    return p && !p.quoteOnly ? p.id : "professional";
  });
  const [annual, setAnnual] = useState(() => (params.get("period") ?? "per_event") === "annual");
  const [step, setStep] = useState<Step>(() => (placedParam > 0 ? 5 : params.get("resume") === "1" ? 2 : 1));

  const [me, setMe] = useState<Me | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [myOrgs, setMyOrgs] = useState<CustomerSummary[]>([]);
  const [myOrders, setMyOrders] = useState<Order[]>([]);
  const [choice, setChoice] = useState<OrgChoice>("new");
  const [org, setOrg] = useState({ name: params.get("org") ?? "", vat: "", country: t("checkout.org.country_default"), city: "", eventName: "" });
  const [method, setMethod] = useState<PayMethod>("bank_transfer");
  const [card, setCard] = useState<CardSummary>({ valid: false, brand: "other", last4: "" });
  // Remounting the card form clears the number from memory once the order is placed.
  const [cardKey, setCardKey] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const [placedMissing, setPlacedMissing] = useState(false);
  const attempt = useRef<string>(newAttemptKey());
  // Discounts: the code as typed, the code the buyer applied, and the claim.
  const [codeOpen, setCodeOpen] = useState(() => Boolean(params.get("code")));
  const [codeInput, setCodeInput] = useState(() => (params.get("code") ?? "").toUpperCase());
  const [appliedCode, setAppliedCode] = useState<string | null>(() => (params.get("code") ? params.get("code")!.trim().toUpperCase() : null));
  const [codeError, setCodeError] = useState<string | null>(null);
  const [edu, setEdu] = useState<{ on: boolean; type: Claim; institution: string }>({ on: false, type: "education", institution: "" });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);

  const plan: PlanPrice = livePlan(planById(planId) ?? planById("professional")!, info);
  const num = useMemo(() => numberFormatter(lang), [lang]);
  const cardOn = info.methods.includes("card");

  useEffect(() => {
    let cancelled = false;
    apiGet<Me>("/api/auth/me")
      .then(async (user) => {
        if (cancelled) return;
        setMe(user?.email ? user : null);
        if (!user?.email) return;
        try {
          const mine = await loadMyCommerce();
          if (cancelled) return;
          setMyOrgs(mine.customers.filter((c) => c.status !== "cancelled" || mine.orders.some((o) => o.customer_id === c.id)));
          setMyOrders(mine.orders);
          // A returning buyer starts on their organisation: the one they typed, else the first.
          const typed = (params.get("org") ?? "").trim().toLowerCase();
          const pick = mine.customers.find((c) => c.name.trim().toLowerCase() === typed) ?? (typed ? null : mine.customers[0]);
          if (pick) chooseOrg(pick);
        } catch { /* a first-time buyer has nothing to choose from */ }
      })
      .catch(() => { if (!cancelled) setMe(null); })
      .finally(() => { if (!cancelled) setCheckingSession(false); });
    return () => { cancelled = true; };
    // Once per page: the session and the buyer's organisations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The country field follows a language switch until the buyer types their own.
  useEffect(() => {
    setOrg((o) => (COUNTRY_DEFAULTS.includes(o.country) ? { ...o, country: t("checkout.org.country_default") } : o));
  }, [lang, t]);

  // A placed order, after a reload: show it, not the form again.
  useEffect(() => {
    if (!(placedParam > 0) || placed?.order.id === placedParam) return;
    let cancelled = false;
    loadMyCommerce()
      .then((mine) => {
        if (cancelled) return;
        const found = mine.orders.find((o) => o.id === placedParam);
        if (found) setPlaced({ order: found, customerId: found.customer_id, createdCustomer: false });
        else setPlacedMissing(true);
      })
      .catch(() => { if (!cancelled) setPlacedMissing(true); });
    return () => { cancelled = true; };
  }, [placedParam, placed?.order.id]);

  function chooseOrg(c: CustomerSummary | "new") {
    setOrgError(null);
    if (c === "new") {
      setChoice("new");
      setOrg((o) => ({ ...o, name: "", vat: "", city: "", country: t("checkout.org.country_default") }));
      return;
    }
    setChoice(c.id);
    setOrg((o) => ({ ...o, name: c.name, vat: c.vat_id ?? "", city: c.city ?? "", country: c.country || o.country }));
  }

  const chosen = typeof choice === "number" ? myOrgs.find((c) => c.id === choice) ?? null : null;
  const canEditDetails = !chosen || chosen.my_role === "owner";
  const underReview = myOrders.find((o) => orderStage(o) === "under_review" && (!chosen || o.customer_id === chosen.id));

  const period: BillingPeriod = annual ? "annual" : "per_event";
  // The claims a campaign exists for on this plan and period: a university or
  // school, a non-profit, or both (the buyer then says which).
  const claimable = CLAIMS.filter((c) => educationOffer(plan, annual, info, c));
  const claimType: Claim = claimable.includes(edu.type) ? edu.type : claimable[0] ?? "education";
  const eduOffer = claimable.length ? educationOffer(plan, annual, info, claimType) : null;
  const claimEdu = Boolean(eduOffer) && edu.on;

  // A plan the owner switched off is not chosen; the first one on sale is.
  useEffect(() => {
    if (!info.loaded || onSale(plan, info)) return;
    const next = SELF_SERVE.find((p) => onSale(p, info));
    if (next) setPlanId(next.id);
  }, [info, plan]);

  // The server's price for this plan, period, code and claim. Asked again
  // when any of them changes; the last answer wins.
  const quoteSeq = useRef(0);
  useEffect(() => {
    if (!info.loaded) return;
    const seq = ++quoteSeq.current;
    const timer = window.setTimeout(() => {
      setQuoting(true);
      apiPost<Quote>("/api/checkout/quote", {
        plan: plan.id,
        billingPeriod: period,
        discountCode: appliedCode || undefined,
        education: claimEdu ? { type: claimType, institution: edu.institution.trim() || undefined } : undefined,
        customerId: typeof choice === "number" ? choice : undefined,
      })
        .then((q) => {
          if (seq !== quoteSeq.current) return;
          setQuote(q);
          if (q.code && !q.code.ok) {
            // A code that does not apply is not kept: the order would be refused.
            setCodeError(codeMessage(q.code.reason));
            setAppliedCode(null);
          }
        })
        .catch((err) => {
          if (seq !== quoteSeq.current) return;
          if (appliedCode) setCodeError(err instanceof ApiError && err.code === "RATE_LIMITED" ? t("price.code.err.RATE_LIMITED") : t("price.code.err.generic"));
        })
        .finally(() => { if (seq === quoteSeq.current) setQuoting(false); });
    }, 200);
    return () => window.clearTimeout(timer);
    // `edu.institution` changes the claim, not the price.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.loaded, plan.id, period, appliedCode, claimEdu, claimType, choice]);

  /** Why a code does not apply, in the buyer's language. */
  function codeMessage(reason: string | undefined): string {
    return isCouponReason(reason) ? fill(t(`price.code.err.${reason}`), { plan: plan.name }) : t("price.code.err.generic");
  }

  const applyCode = () => {
    const code = codeInput.trim().toUpperCase();
    setCodeError(null);
    if (!code) return;
    setAppliedCode(code);
  };
  const removeCode = () => {
    setAppliedCode(null);
    setCodeInput("");
    setCodeError(null);
  };

  /* What the summary shows: the server's figures for this plan and period
     once it has answered, the same arithmetic on the price list before. */
  const priceMinor = livePriceMinor(plan, annual, info);
  const q = quote && quote.plan === plan.id && quote.billingPeriod === period ? quote : null;
  const localOffer = bestCampaign(info.campaigns, plan.id, period, priceMinor);
  const localEdu = claimEdu && eduOffer && (!localOffer || eduOffer.discountMinor > localOffer.discountMinor) ? eduOffer : null;
  const discountMinor = q ? q.discountMinor : (localEdu ?? localOffer)?.discountMinor ?? 0;
  const amountMinor = q ? q.amountMinor : priceMinor == null ? null : priceMinor - discountMinor;
  const rate = info.vat.registered ? info.vat.ratePercent : null;
  const taxMinor = q ? q.taxMinor : amountMinor != null && rate ? Math.round((amountMinor * rate) / 100) : 0;
  const discountLabel = q?.discount
    ? q.discount.kind === "code" ? `${q.discount.code} ${discountValueText(q.discount, lang)}` : `${q.discount.name} ${discountValueText(q.discount, lang)}`
    : localEdu ?? localOffer ? `${(localEdu ?? localOffer)!.campaign.name} ${discountValueText((localEdu ?? localOffer)!.campaign, lang)}` : null;
  const discountReview = q ? Boolean(q.discount?.needsReview) : Boolean(localEdu);
  const codeOutcome = q?.code && q.code.ok && appliedCode && q.code.code === appliedCode ? q.code : null;
  const money = (minor: number | null) => (minor == null ? t("checkout.summary.quoted") : formatPriceMinor(minor, lang));
  const amount = amountMinor;

  const resumeQuery = useMemo(() => {
    const q = new URLSearchParams({ plan: plan.id, period: annual ? "annual" : "per_event", resume: "1" });
    if (org.name.trim()) q.set("org", org.name.trim());
    return q;
  }, [plan.id, annual, org.name]);

  const orgReady = !!me && (chosen ? true : org.name.trim().length >= 2);
  const payReady = method === "bank_transfer" || (cardOn && card.valid);

  const placeOrder = async () => {
    if (!orgReady || !payReady || !confirmed || !accepted || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<PlacedOrder>("/api/checkout", {
        plan: plan.id,
        billingPeriod: annual ? "annual" : "per_event",
        ...(chosen ? { customerId: chosen.id } : { organisation: org.name.trim() }),
        // Saved on an existing organisation only by its owner.
        ...(canEditDetails ? {
          vatId: org.vat.trim() || undefined,
          country: org.country.trim() || undefined,
          city: org.city.trim() || undefined,
        } : {}),
        eventName: org.eventName.trim() || undefined,
        // Brand and last four digits only. The number and code stay in the form.
        payment: method === "card" ? { method: "card", card: { brand: card.brand, last4: card.last4 } } : { method: "bank_transfer" },
        // A code and a claim, never an amount: the server prices the discount.
        discountCode: appliedCode || undefined,
        education: claimEdu ? { type: claimType, institution: edu.institution.trim() || undefined } : undefined,
        acceptTerms: true,
        termsVersion: info.termsVersion ?? undefined,
        idempotencyKey: attempt.current,
        lang,
      });
      setPlaced(result);
      setCardKey((k) => k + 1);
      setStep(5);
      attempt.current = newAttemptKey();
      // Reloading this address shows the order, never the form again.
      router.replace(`/checkout?placed=${result.order.id}`, { scroll: false });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      const key = err instanceof ApiError && err.code ? ERROR_KEYS[err.code] : undefined;
      const message = key
        ? t(key)
        : err instanceof ApiError && err.status >= 400 && err.status < 500 && (err.summary || err.message)
          ? err.summary || err.message
          : t("checkout.err.generic");
      if (err instanceof ApiError && isCouponReason(err.code)) {
        // The code stopped applying since it was checked (used up meanwhile).
        const why = codeMessage(err.code);
        setAppliedCode(null);
        setCodeOpen(true);
        setCodeError(why);
        setError(why);
      } else if (err instanceof ApiError && err.code === "ORGANISATION_NAME_TAKEN") {
        setOrgError(message);
        setStep(2);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const go = (s: Step) => {
    setError(null);
    setStep(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const field =
    "min-h-12 w-full rounded-[12px] border px-3.5 text-[15px] outline-none transition-[border-color,box-shadow] duration-150 focus:border-[var(--hs-brand)] focus:shadow-[0_0_0_3px_var(--hs-brand-weak)]";
  const fieldStyle: React.CSSProperties = { borderColor: "var(--hs-line-2)", background: "var(--hs-surface)", color: "var(--hs-ink)" };
  const label = "mb-1.5 block text-[13px] font-medium";
  const panel = "rounded-[22px] border p-5 sm:p-7";
  const panelStyle: React.CSSProperties = {
    background: "var(--hs-surface)",
    borderColor: "var(--hs-line)",
    boxShadow: "0 1px 2px rgba(20,22,28,0.04), 0 24px 48px -32px rgba(20,22,28,0.16)",
  };
  const primary =
    "group inline-flex min-h-12 items-center justify-center gap-2 rounded-[12px] px-6 text-[15px] font-semibold transition-[filter,opacity] duration-150 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";
  const secondary =
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-[12px] border px-5 text-[15px] font-medium transition-colors hover:bg-[var(--hs-tint)]";

  const limitText = (n: number | null, unit: string) => (n == null ? `${t("checkout.plan.unlimited")} ${unit}` : `${num.format(n)} ${unit}`);

  const stepNames: [Step, string][] = [
    [1, t("checkout.step.plan")],
    [2, t("checkout.step.org")],
    [3, t("checkout.step.payment")],
    [4, t("checkout.step.review")],
    [5, t("checkout.step.done")],
  ];

  const nav = (back: Step | null, next: (() => void) | null, nextLabel: string, nextDisabled = false) => (
    <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t pt-5" style={{ borderColor: "var(--hs-line)" }}>
      {back ? (
        <button type="button" onClick={() => go(back)} className={secondary} style={{ borderColor: "var(--hs-line-2)", color: "var(--hs-ink)" }}>
          <ArrowLeft size={16} /> {t("checkout.back")}
        </button>
      ) : <span />}
      {next ? (
        <button type="button" onClick={next} disabled={nextDisabled} className={primary} style={{ background: "var(--hs-brand-solid)", color: "#fff" }}>
          {nextLabel} <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
        </button>
      ) : null}
    </div>
  );

  /* ── Steps ─────────────────────────────────────────────────────────── */

  let body: React.ReactNode = null;

  if (step === 1) {
    body = (
      <div className={panel} style={panelStyle}>
        <div role="radiogroup" aria-label={t("checkout.summary.billing")} className="inline-flex gap-1 rounded-full p-1" style={{ background: "var(--hs-tint)" }}>
          {([false, true] as const).map((a) => (
            <button
              key={String(a)}
              type="button"
              role="radio"
              aria-checked={annual === a}
              onClick={() => setAnnual(a)}
              className="h-10 rounded-full px-5 text-[14px] font-semibold transition-colors"
              style={{
                background: annual === a ? "var(--hs-surface)" : "transparent",
                color: annual === a ? "var(--hs-ink)" : "var(--hs-ink-3)",
                boxShadow: annual === a ? "0 1px 2px rgba(0,0,0,0.08), 0 0 0 1px var(--hs-line)" : "none",
              }}
            >
              {a ? t("checkout.period.annual") : t("checkout.period.per_event")}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[13px]" style={{ color: "var(--hs-ink-3)" }}>
          {annual ? t("checkout.period.annual_note") : t("checkout.period.per_event_note")}
        </p>

        <div role="radiogroup" aria-label={t("checkout.step.plan")} className="mt-5 grid gap-3 sm:grid-cols-3">
          {SELF_SERVE.map((raw) => {
            const p = livePlan(raw, info);
            const chosen = p.id === plan.id;
            const selling = onSale(p, info);
            const offer = liveOffer(p, annual, info);
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={chosen}
                disabled={!selling}
                onClick={() => setPlanId(p.id)}
                className="flex flex-col rounded-[16px] border p-4 text-left transition-[border-color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-55"
                style={{
                  borderColor: chosen ? "var(--hs-brand)" : "var(--hs-line-2)",
                  boxShadow: chosen ? "0 0 0 3px var(--hs-brand-weak)" : "none",
                  background: "var(--hs-surface)",
                }}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[15px] font-semibold" style={{ color: "var(--hs-ink)" }}>{p.name}</span>
                  <span
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border"
                    style={{ borderColor: chosen ? "var(--hs-brand)" : "var(--hs-line-2)", background: chosen ? "var(--hs-brand-solid)" : "transparent" }}
                  >
                    {chosen ? <Check size={12} color="#fff" strokeWidth={3} /> : null}
                  </span>
                </span>
                <span className="mt-3 flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[1.6rem] font-semibold tabular-nums" style={{ fontFamily: "var(--font-display)", color: "var(--hs-ink)" }}>
                    {selling ? money(offer.nowMinor) : t("price.plan.off_sale")}
                  </span>
                  {selling && offer.wasMinor != null ? (
                    <s className="text-[14px] tabular-nums" style={{ color: "var(--hs-ink-3)" }} aria-label={fill(t("price.was"), { price: money(offer.wasMinor) })}>
                      {money(offer.wasMinor)}
                    </s>
                  ) : null}
                </span>
                {selling && offer.campaign ? (
                  <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={{ background: "var(--hs-brand-weak)", color: "var(--hs-brand)" }}>
                    <BadgePercent size={12} /> {fill(t("price.offer"), { name: offer.campaign.name, value: discountValueText(offer.campaign, lang) })}
                  </span>
                ) : null}
                <span className="mt-3 flex flex-col gap-1 text-[12.5px]" style={{ color: "var(--hs-ink-2)" }}>
                  <span>{annual ? limitText(p.eventsPerYear, t("checkout.plan.events_year")) : t("checkout.plan.one_event")}</span>
                  <span>{limitText(p.participants, t("checkout.plan.participants"))}</span>
                  <span>{limitText(p.seats, t("checkout.plan.seats"))}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-4 text-[13px]" style={{ color: "var(--hs-ink-3)" }}>
          {t("checkout.plan.enterprise")}{" "}
          <Link href="/contact?topic=enterprise" className="font-medium hover:underline" style={{ color: "var(--hs-brand)" }}>
            {t("checkout.plan.enterprise_cta")}
          </Link>
        </p>
        {nav(null, () => go(2), t("checkout.continue"))}
      </div>
    );
  } else if (step === 2) {
    body = (
      <div className={panel} style={panelStyle}>
        <h2 className="text-[17px] font-semibold" style={{ color: "var(--hs-ink)" }}>{t("checkout.org.title")}</h2>
        {checkingSession ? (
          <div className="mt-5 space-y-3">
            <div className="hh-skeleton h-12 rounded-[12px]" />
            <div className="hh-skeleton h-12 rounded-[12px]" />
          </div>
        ) : me ? (
          <>
            <p className="mt-1 text-[13px]" style={{ color: "var(--hs-ink-3)" }}>
              {t("checkout.org.signed_in_as")} {me.full_name ? `${me.full_name} · ` : ""}{me.email}
            </p>
            {underReview ? (
              <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[12px] border px-3.5 py-2.5 text-[13.5px]" style={{ borderColor: "var(--hs-warn)", background: "var(--hs-warn-weak)", color: "var(--hs-ink)" }}>
                <Info size={15} style={{ color: "var(--hs-warn)" }} />
                {fill(t("checkout.org.pending"), { code: underReview.order_code })}
                <Link href="/account#orders" className="font-medium hover:underline" style={{ color: "var(--hs-brand)" }}>{t("checkout.org.pending_link")}</Link>
              </p>
            ) : null}
            {myOrgs.length > 0 ? (
              <fieldset className="mt-5">
                <legend className={label} style={{ color: "var(--hs-ink-2)" }}>{t("checkout.org.choose")}</legend>
                <div role="radiogroup" aria-label={t("checkout.org.choose")} className="grid gap-2 sm:grid-cols-2">
                  {[...myOrgs.map((c) => ({ key: String(c.id), on: choice === c.id, title: c.name, sub: [c.city, c.country].filter(Boolean).join(", "), pick: () => chooseOrg(c) })),
                    { key: "new", on: choice === "new", title: t("checkout.org.new"), sub: "", pick: () => chooseOrg("new") }].map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      role="radio"
                      aria-checked={o.on}
                      onClick={o.pick}
                      className="flex min-h-12 items-center justify-between gap-3 rounded-[12px] border px-3.5 py-2.5 text-left transition-[border-color,box-shadow] duration-150"
                      style={{ borderColor: o.on ? "var(--hs-brand)" : "var(--hs-line-2)", boxShadow: o.on ? "0 0 0 3px var(--hs-brand-weak)" : "none", background: "var(--hs-surface)" }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[14.5px] font-semibold" style={{ color: "var(--hs-ink)" }}>{o.title}</span>
                        {o.sub ? <span className="block truncate text-[12.5px]" style={{ color: "var(--hs-ink-3)" }}>{o.sub}</span> : null}
                      </span>
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border" style={{ borderColor: o.on ? "var(--hs-brand)" : "var(--hs-line-2)", background: o.on ? "var(--hs-brand-solid)" : "transparent" }}>
                        {o.on ? <Check size={12} color="#fff" strokeWidth={3} /> : null}
                      </span>
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="co-org" className={label} style={{ color: "var(--hs-ink-2)" }}>{t("checkout.org.name")}</label>
                <input
                  id="co-org"
                  autoComplete="organization"
                  value={org.name}
                  readOnly={!!chosen}
                  aria-invalid={orgError ? true : undefined}
                  aria-describedby={orgError ? "co-org-error" : chosen ? "co-org-note" : undefined}
                  onChange={(e) => { setOrgError(null); setOrg((o) => ({ ...o, name: e.target.value })); }}
                  placeholder={t("checkout.org.name_hint")}
                  className={field}
                  style={{ ...fieldStyle, ...(chosen ? { background: "var(--hs-tint)", color: "var(--hs-ink-2)" } : {}), ...(orgError ? { borderColor: "var(--hs-danger)" } : {}) }}
                />
                {orgError ? (
                  <p id="co-org-error" role="alert" className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--hs-danger)" }}>{orgError}</p>
                ) : chosen ? (
                  <p id="co-org-note" className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: "var(--hs-ink-3)" }}>
                    {canEditDetails ? t("checkout.org.existing_note") : t("checkout.org.member_note")}
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor="co-vat" className={label} style={{ color: "var(--hs-ink-2)" }}>
                  {t("checkout.org.vat")} <span className="font-normal" style={{ color: "var(--hs-ink-3)" }}>({t("checkout.org.optional")})</span>
                </label>
                <input id="co-vat" inputMode="numeric" disabled={!canEditDetails} value={org.vat} onChange={(e) => setOrg((o) => ({ ...o, vat: e.target.value }))} className={field} style={fieldStyle} />
              </div>
              <div>
                <label htmlFor="co-country" className={label} style={{ color: "var(--hs-ink-2)" }}>{t("checkout.org.country")}</label>
                <input id="co-country" autoComplete="country-name" disabled={!canEditDetails} value={org.country} onChange={(e) => setOrg((o) => ({ ...o, country: e.target.value }))} className={field} style={fieldStyle} />
              </div>
              <div>
                <label htmlFor="co-city" className={label} style={{ color: "var(--hs-ink-2)" }}>{t("checkout.org.city")}</label>
                <input id="co-city" autoComplete="address-level2" disabled={!canEditDetails} value={org.city} onChange={(e) => setOrg((o) => ({ ...o, city: e.target.value }))} className={field} style={fieldStyle} />
              </div>
              {eduOffer ? (
                <div className="sm:col-span-2 rounded-[14px] border p-4" style={{ borderColor: edu.on ? "var(--hs-brand)" : "var(--hs-line-2)", background: edu.on ? "var(--hs-brand-weak)" : "var(--hs-surface)" }}>
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={edu.on}
                      onChange={(e) => setEdu((v) => ({ ...v, on: e.target.checked }))}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--hs-brand-solid)]"
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-[14.5px] font-semibold" style={{ color: "var(--hs-ink)" }}>
                        <GraduationCap size={16} style={{ color: "var(--hs-brand)" }} /> {t("price.edu.label")}
                      </span>
                      <span className="mt-1 block text-[13px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>
                        {fill(t("price.edu.hint"), { value: discountValueText(eduOffer.campaign, lang) })}
                      </span>
                    </span>
                  </label>
                  {edu.on && claimable.length > 1 ? (
                    <div role="radiogroup" aria-label={t("price.edu.label")} className="mt-3 flex flex-wrap gap-2 sm:pl-7">
                      {claimable.map((c) => (
                        <button
                          key={c}
                          type="button"
                          role="radio"
                          aria-checked={claimType === c}
                          onClick={() => setEdu((v) => ({ ...v, type: c }))}
                          className="inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-[13.5px] font-medium"
                          style={{ borderColor: claimType === c ? "var(--hs-brand)" : "var(--hs-line-2)", background: "var(--hs-surface)", color: claimType === c ? "var(--hs-brand)" : "var(--hs-ink-2)" }}
                        >
                          {claimType === c ? <Check size={13} /> : null}{t(`price.edu.${c}`)} · {discountValueText(educationOffer(plan, annual, info, c)!.campaign, lang)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {edu.on ? (
                    <div className="mt-3 sm:pl-7">
                      <label htmlFor="co-edu" className={label} style={{ color: "var(--hs-ink-2)" }}>{t("price.edu.institution")}</label>
                      <input
                        id="co-edu"
                        value={edu.institution}
                        onChange={(e) => setEdu((v) => ({ ...v, institution: e.target.value }))}
                        placeholder={t("price.edu.institution_hint")}
                        className={field}
                        style={fieldStyle}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div>
                <label htmlFor="co-event" className={label} style={{ color: "var(--hs-ink-2)" }}>
                  {t("checkout.org.event")} <span className="font-normal" style={{ color: "var(--hs-ink-3)" }}>({t("checkout.org.optional")})</span>
                </label>
                <input id="co-event" value={org.eventName} onChange={(e) => setOrg((o) => ({ ...o, eventName: e.target.value }))} placeholder={t("checkout.org.event_hint")} className={field} style={fieldStyle} />
              </div>
            </div>
          </>
        ) : (
          <div className="mt-5 rounded-[16px] border p-5" style={{ borderColor: "var(--hs-line)", background: "var(--hs-tint)" }}>
            <p className="text-[15px] font-semibold" style={{ color: "var(--hs-ink)" }}>{t("checkout.org.need_account")}</p>
            <p className="mt-1.5 text-[14px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>{t("checkout.org.need_account_body")}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href={`/signin?mode=register&${resumeQuery.toString()}`}
                className={primary}
                style={{ background: "var(--hs-brand-solid)", color: "#fff" }}
              >
                {t("checkout.org.create")} <ArrowRight size={16} />
              </Link>
              <Link
                href={`/signin?next=${encodeURIComponent(`/checkout?${resumeQuery.toString()}`)}`}
                className={secondary}
                style={{ borderColor: "var(--hs-line-2)", color: "var(--hs-ink)" }}
              >
                {t("checkout.org.sign_in")}
              </Link>
            </div>
          </div>
        )}
        {nav(1, me ? () => go(3) : null, t("checkout.continue"), !orgReady)}
      </div>
    );
  } else if (step === 3) {
    const option = (m: PayMethod, Icon: typeof CreditCard, title: string, desc: string) => {
      const on = method === m;
      return (
        <button
          type="button"
          role="radio"
          aria-checked={on}
          onClick={() => setMethod(m)}
          className="flex flex-1 items-start gap-3 rounded-[16px] border p-4 text-left transition-[border-color,box-shadow] duration-150"
          style={{ borderColor: on ? "var(--hs-brand)" : "var(--hs-line-2)", boxShadow: on ? "0 0 0 3px var(--hs-brand-weak)" : "none", background: "var(--hs-surface)" }}
        >
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]" style={{ background: on ? "var(--hs-brand-weak)" : "var(--hs-tint)", color: on ? "var(--hs-brand)" : "var(--hs-ink-2)" }}>
            <Icon size={18} />
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-semibold" style={{ color: "var(--hs-ink)" }}>{title}</span>
            <span className="block text-[13px]" style={{ color: "var(--hs-ink-3)" }}>{desc}</span>
          </span>
        </button>
      );
    };
    body = (
      <div className={panel} style={panelStyle}>
        <h2 className="text-[17px] font-semibold" style={{ color: "var(--hs-ink)" }}>{t("checkout.pay.title")}</h2>
        {cardOn ? (
          <div role="radiogroup" aria-label={t("checkout.pay.title")} className="mt-4 flex flex-col gap-3 sm:flex-row">
            {option("bank_transfer", Landmark, t("checkout.pay.bank"), t("checkout.pay.bank_desc"))}
            {option("card", CreditCard, t("checkout.pay.card"), t("checkout.pay.card_desc"))}
          </div>
        ) : (
          <p className="mt-1 text-[13px]" style={{ color: "var(--hs-ink-3)" }}>{t("checkout.pay.only_bank")}</p>
        )}
        <div className="mt-6">
          {method === "card" && cardOn ? (
            <CardForm key={cardKey} onChange={setCard} />
          ) : (
            <div className="flex items-start gap-3 rounded-[16px] border p-4" style={{ borderColor: "var(--hs-line)", background: "var(--hs-tint)" }}>
              <FileText size={18} className="mt-0.5 shrink-0" style={{ color: "var(--hs-ink-2)" }} />
              <div className="min-w-0">
                <p className="text-[15px] font-semibold" style={{ color: "var(--hs-ink)" }}>{t("checkout.pay.bank")} · {t("checkout.pay.bank_desc")}</p>
                <p className="mt-1 text-[14px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>{t("checkout.pay.bank_body")}</p>
              </div>
            </div>
          )}
        </div>
        {nav(2, () => go(4), t("checkout.continue"), !payReady)}
      </div>
    );
  } else if (step === 4) {
    const row = (title: string, value: React.ReactNode, editStep: Step) => (
      <div className="flex items-start justify-between gap-4 border-b py-4 last:border-b-0" style={{ borderColor: "var(--hs-line)" }}>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--hs-ink-3)" }}>{title}</p>
          <div className="mt-1 text-[15px]" style={{ color: "var(--hs-ink)" }}>{value}</div>
        </div>
        <button type="button" onClick={() => go(editStep)} className="shrink-0 text-[13px] font-medium hover:underline" style={{ color: "var(--hs-brand)" }}>
          {t("checkout.edit")}
        </button>
      </div>
    );
    body = (
      <div className={panel} style={panelStyle}>
        <h2 className="text-[17px] font-semibold" style={{ color: "var(--hs-ink)" }}>{t("checkout.review.title")}</h2>
        <div className="mt-2">
          {row(t("checkout.review.plan"), <>{plan.name} · {annual ? t("checkout.period.annual") : t("checkout.period.per_event")} · <strong className="font-semibold tabular-nums">{money(amount)}</strong>{discountMinor > 0 ? <s className="ml-2 text-[13px] tabular-nums" style={{ color: "var(--hs-ink-3)" }}>{money(priceMinor)}</s> : null}</>, 1)}
          {discountMinor > 0 && discountLabel ? row(
            t("price.review.discount"),
            <span className="inline-flex flex-wrap items-center gap-x-2">
              <BadgePercent size={16} style={{ color: "var(--hs-ok)" }} /> {discountLabel} · <strong className="font-semibold tabular-nums" style={{ color: "var(--hs-ok)" }}>{money(-discountMinor)}</strong>
              {discountReview ? <span className="text-[13px]" style={{ color: "var(--hs-ink-3)" }}>· {t("price.summary.review")}</span> : null}
            </span>,
            discountReview ? 2 : 1,
          ) : null}
          {row(
            t("checkout.review.org"),
            <>
              <span className="font-semibold">{org.name.trim()}</span>
              <span className="block text-[13px]" style={{ color: "var(--hs-ink-3)" }}>
                {[org.vat.trim() && `${t("checkout.org.vat")}: ${org.vat.trim()}`, [org.city.trim(), org.country.trim()].filter(Boolean).join(", "), org.eventName.trim()].filter(Boolean).join(" · ")}
              </span>
            </>,
            2,
          )}
          {row(
            t("checkout.review.payment"),
            method === "card" ? (
              <span className="inline-flex items-center gap-2"><CreditCard size={16} /> {BRAND_LABEL[card.brand]} {t("checkout.review.card_ending")} {card.last4}</span>
            ) : (
              <span className="inline-flex flex-wrap items-center gap-x-2"><Landmark size={16} /> {t("checkout.pay.bank")} <span className="text-[13px]" style={{ color: "var(--hs-ink-3)" }}>· {t("checkout.pay.bank_desc")}</span></span>
            ),
            3,
          )}
        </div>
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-[14px] border p-4" style={{ borderColor: "var(--hs-line-2)" }}>
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--hs-brand-solid)]" />
          <span className="text-[14px]" style={{ color: "var(--hs-ink-2)" }}>{t("checkout.review.confirm")}</span>
        </label>
        <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-[14px] border p-4" style={{ borderColor: "var(--hs-line-2)" }}>
          <input type="checkbox" required checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--hs-brand-solid)]" />
          <span className="text-[14px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>
            {t("checkout.review.terms").split(/(\{terms\}|\{refunds\})/).map((part, i) =>
              part === "{terms}" ? (
                <a key={i} href="/terms" target="_blank" rel="noopener" className="font-medium underline underline-offset-2" style={{ color: "var(--hs-brand)" }}>{t("checkout.review.terms_link")}</a>
              ) : part === "{refunds}" ? (
                <a key={i} href="/refunds" target="_blank" rel="noopener" className="font-medium underline underline-offset-2" style={{ color: "var(--hs-brand)" }}>{t("checkout.review.refunds_link")}</a>
              ) : (
                <span key={i}>{part}</span>
              ),
            )}
          </span>
        </label>
        {error ? (
          <p role="alert" className="mt-4 rounded-[12px] border px-3 py-2.5 text-[13px]" style={{ borderColor: "var(--hs-danger)", background: "var(--hs-danger-weak)", color: "var(--hs-ink)" }}>
            {error}
          </p>
        ) : null}
        {nav(3, placeOrder, busy ? t("checkout.review.placing") : t("checkout.review.place"), !confirmed || !accepted || busy || !orgReady || !payReady)}
      </div>
    );
  } else if (placed) {
    body = (
      <div className={`${panel} text-center`} style={panelStyle}>
        <span className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full" style={{ background: "var(--hs-ok-weak)", color: "var(--hs-ok)" }}>
          <CircleCheck size={34} />
        </span>
        <h2 className="mt-4 text-[1.6rem] font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--hs-ink)" }}>{t("checkout.done.title")}</h2>
        <p className="hs-mono mt-1 text-[13px]" style={{ color: "var(--hs-ink-3)" }}>{placed.order.order_code}</p>
        <span className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold" style={{ background: "var(--hs-warn-weak)", color: "var(--hs-warn)" }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--hs-warn)" }} /> {t(`order.stage.${orderStage(placed.order)}`)}
        </span>
        {placed.order.discount_label && placed.order.discount_status !== "removed" ? (
          <p className="mt-3 flex items-center justify-center gap-1.5 text-[13.5px] font-medium" style={{ color: "var(--hs-ok)" }}>
            <BadgePercent size={15} />
            {fill(t(placed.order.discount_status === "claimed" ? "price.done.discount_review" : "price.done.discount"), { label: placed.order.discount_label })}
          </p>
        ) : null}
        <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>{t("checkout.done.body")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/account#orders" className={primary} style={{ background: "var(--hs-brand-solid)", color: "#fff" }}>
            {t("checkout.done.orders")} <ArrowRight size={16} />
          </Link>
          <a href={`/api/me/orders/${placed.order.id}/invoice.pdf`} className={secondary} style={{ borderColor: "var(--hs-line-2)", color: "var(--hs-ink)" }}>
            <Download size={16} /> {placed.order.invoice_number ? t("portal.download_invoice") : t("checkout.done.invoice")}
          </a>
        </div>
      </div>
    );
  } else if (step === 5) {
    body = (
      <div className={`${panel} text-center`} style={panelStyle}>
        <p className="text-[15px]" style={{ color: "var(--hs-ink-2)" }}>{placedMissing ? t("checkout.done.missing") : t("checkout.done.loading")}</p>
        {placedMissing ? (
          <Link href="/account#orders" className={`${primary} mt-5`} style={{ background: "var(--hs-brand-solid)", color: "#fff" }}>
            {t("checkout.done.orders")} <ArrowRight size={16} />
          </Link>
        ) : null}
      </div>
    );
  }

  /* ── Layout ────────────────────────────────────────────────────────── */

  return (
    <section style={{ background: "var(--hs-bg)" }}>
      <div className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-5 sm:pt-14">
        <p className="hs-mono mb-3 text-[11.5px] font-medium uppercase tracking-[0.16em]" style={{ color: "var(--hs-brand)" }}>
          {t("checkout.eyebrow")}
        </p>
        <h1 className="text-balance text-[2rem] font-semibold leading-[1.08] tracking-[-0.025em] sm:text-[2.5rem]" style={{ fontFamily: "var(--font-display)", color: "var(--hs-ink)" }}>
          {t("checkout.title")}
        </h1>

        <ol className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-2" aria-label={t("checkout.eyebrow")}>
          {stepNames.map(([n, name], i) => {
            const done = step > n;
            const current = step === n;
            return (
              <li key={n} className="flex items-center gap-2" aria-current={current ? "step" : undefined}>
                <span
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[12.5px] font-semibold"
                  style={{
                    background: done ? "var(--hs-ok)" : current ? "var(--hs-brand-solid)" : "var(--hs-tint)",
                    color: done || current ? "#fff" : "var(--hs-ink-3)",
                  }}
                >
                  {done ? <Check size={14} strokeWidth={3} /> : n}
                </span>
                <span className="text-[13.5px] font-medium" style={{ color: current ? "var(--hs-ink)" : "var(--hs-ink-3)" }}>{name}</span>
                {i < stepNames.length - 1 ? <span aria-hidden="true" className="mx-1 hidden h-px w-6 sm:inline-block" style={{ background: "var(--hs-line-2)" }} /> : null}
              </li>
            );
          })}
        </ol>

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div>{body}</div>

          <aside className="rounded-[22px] border p-5 lg:sticky lg:top-28" style={{ background: "var(--hs-surface)", borderColor: "var(--hs-line)" }}>
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--hs-ink-3)" }}>{t("checkout.summary.title")}</p>
            <div className="mt-4 flex items-start justify-between gap-3 border-b pb-4" style={{ borderColor: "var(--hs-line)" }}>
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--hs-ink)" }}>
                  <Building2 size={15} style={{ color: "var(--hs-ink-3)" }} /> HackOS {plan.name}
                </p>
                <p className="mt-0.5 text-[13px]" style={{ color: "var(--hs-ink-3)" }}>
                  {annual ? t("checkout.period.annual_note") : t("checkout.period.per_event_note")}
                </p>
              </div>
            </div>
            <dl className="mt-4 space-y-2.5 text-[13px]">
              {[
                [t("checkout.summary.billing"), annual ? t("checkout.summary.once_year") : t("checkout.summary.once_event")],
                [t("checkout.plan.participants"), plan.participants == null ? t("checkout.plan.unlimited") : num.format(plan.participants)],
                [t("checkout.plan.seats"), plan.seats == null ? t("checkout.plan.unlimited") : String(plan.seats)],
                [t("checkout.summary.payment"), t("checkout.summary.payment_value")],
                ...(discountMinor > 0
                  ? [
                    [t("price.summary.price"), money(priceMinor)],
                    [t("price.summary.discount"), money(-discountMinor)],
                    [t("price.summary.subtotal"), money(amount)],
                  ]
                  : []),
                ...(info.vat.registered && info.vat.ratePercent
                  ? [
                    ...(discountMinor > 0 ? [] : [[t("checkout.summary.price"), money(amount)]]),
                    [fill(t("vat.rate"), { rate: info.vat.ratePercent }), formatMoney(taxMinor, "AZN") ?? "—"],
                  ]
                  : [[t("checkout.summary.vat"), t("vat.none_short")]]),
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3">
                  <dt className="first-letter:uppercase" style={{ color: "var(--hs-ink-3)" }}>{k}</dt>
                  <dd className="text-right tabular-nums" style={{ color: k === t("price.summary.discount") ? "var(--hs-ok)" : "var(--hs-ink-2)", fontWeight: k === t("price.summary.discount") ? 600 : undefined }}>{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex items-baseline justify-between border-t pt-4" style={{ borderColor: "var(--hs-line)" }}>
              <span className="text-[14px] font-semibold" style={{ color: "var(--hs-ink)" }}>{t("checkout.summary.total")}</span>
              <span className="text-[1.6rem] font-semibold tabular-nums" style={{ fontFamily: "var(--font-display)", color: "var(--hs-ink)" }}>
                {amount == null ? t("checkout.summary.quoted") : money(amount + taxMinor)}
              </span>
            </div>
            <p className="mt-1 text-right text-[12px]" style={{ color: "var(--hs-ink-3)" }}>
              AZN · {info.vat.registered && info.vat.ratePercent ? fill(t("vat.rate"), { rate: info.vat.ratePercent }) : t("vat.none")}
            </p>
            {/* A code shows its own line under "Have a code?"; a campaign, and
                the placed order, show it here. */}
            {discountMinor > 0 && discountLabel && (q?.discount?.kind !== "code" || step === 5) ? (
              <p className="mt-3 flex items-start gap-1.5 rounded-[10px] px-2.5 py-2 text-[12.5px] leading-snug" style={{ background: "var(--hs-ok-weak)", color: "var(--hs-ok)" }}>
                <BadgePercent size={14} className="mt-px shrink-0" />
                <span>{discountLabel}{discountReview ? ` · ${t("price.summary.review")}` : ""}</span>
              </p>
            ) : null}

            {/* Have a code? Checked with the server as soon as it is applied. */}
            {step < 5 ? (
              <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--hs-line)" }}>
                {!codeOpen && !appliedCode ? (
                  <button type="button" onClick={() => setCodeOpen(true)} className="text-[13.5px] font-medium hover:underline" style={{ color: "var(--hs-brand)" }}>
                    {t("price.code.toggle")}
                  </button>
                ) : appliedCode && codeOutcome ? (
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 text-[13px] leading-snug" role="status" style={{ color: codeOutcome.applied ? "var(--hs-ok)" : "var(--hs-ink-2)" }}>
                      {codeOutcome.applied
                        ? fill(t("price.code.applied"), { code: appliedCode, value: q?.discount ? discountValueText(q.discount, lang) : "" })
                        : fill(t("price.code.better_offer"), { code: appliedCode, offer: q?.discount?.name ?? "" })}
                    </p>
                    <button type="button" onClick={removeCode} aria-label={t("price.code.remove")} title={t("price.code.remove")} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-[var(--hs-tint)]" style={{ color: "var(--hs-ink-3)" }}>
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <form onSubmit={(e) => { e.preventDefault(); applyCode(); }}>
                    <label htmlFor="co-code" className="mb-1.5 block text-[12.5px] font-medium" style={{ color: "var(--hs-ink-2)" }}>{t("price.code.label")}</label>
                    <div className="flex gap-2">
                      <input
                        id="co-code"
                        value={codeInput}
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        maxLength={40}
                        onChange={(e) => { setCodeInput(e.target.value.toUpperCase()); setCodeError(null); }}
                        placeholder={t("price.code.placeholder")}
                        aria-invalid={codeError ? true : undefined}
                        aria-describedby={codeError ? "co-code-error" : undefined}
                        className="min-h-10 min-w-0 flex-1 rounded-[10px] border px-3 font-mono text-[14px] uppercase tracking-[0.04em] outline-none focus:border-[var(--hs-brand)]"
                        style={{ ...fieldStyle, ...(codeError ? { borderColor: "var(--hs-danger)" } : {}) }}
                      />
                      <button
                        type="submit"
                        disabled={!codeInput.trim() || (quoting && Boolean(appliedCode))}
                        className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-[10px] border px-3.5 text-[13.5px] font-semibold disabled:opacity-50"
                        style={{ borderColor: "var(--hs-line-2)", color: "var(--hs-ink)", background: "var(--hs-surface)" }}
                      >
                        {quoting && appliedCode ? <Loader2 size={14} className="animate-spin" /> : null}
                        {quoting && appliedCode ? t("price.code.checking") : t("price.code.apply")}
                      </button>
                    </div>
                    {codeError ? (
                      <p id="co-code-error" role="alert" className="mt-1.5 text-[12.5px] leading-snug" style={{ color: "var(--hs-danger)" }}>{codeError}</p>
                    ) : null}
                  </form>
                )}
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </section>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutInner />
    </Suspense>
  );
}
