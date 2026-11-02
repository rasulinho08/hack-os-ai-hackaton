"use client";

/**
 * The account portal.
 *
 * What a customer gets after signing in on hack-os.app: their organisation
 * and its plan, what they have ordered and where each order stands, the
 * invoices, and the way through to the workspace. The owner additionally sees
 * the door to the console.
 *
 * Orders come from `/api/me/orders`, which the backend scopes from the
 * session. Where an order has no price recorded the amount shows a dash — not
 * a zero, because "we have not priced this yet" and "this was free" are
 * different facts.
 */

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CreditCard,
  Download,
  ExternalLink,
  Landmark,
  LayoutDashboard,
  LogOut,
  Receipt,
  ShieldCheck,
  Users,
  Webhook,
} from "lucide-react";
import { Badge, Card, ErrorState, TableSkeleton } from "@/components/ds/primitives";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import {
  formatMoney,
  loadMyCommerce,
  loadOrganisationPlan,
  orderStage,
  paymentState,
  PAYMENT_TONE,
  PLAN_LABEL,
  STAGE_TONE,
  type CustomerSummary,
  type Order,
  type OrganisationPlan,
  type SellerPayTo,
} from "@/lib/commerce";
import { fill } from "@/lib/i18n/fill";
import { BRAND_LABEL, type CardBrand } from "@/lib/card";
import { appUrl } from "@/lib/hosts";
import { consoleHref, signOut } from "@/lib/workspaces";
import { useTranslation } from "@/contexts/LanguageContext";
import { formatDate } from "@/lib/i18n/dates";

interface Me {
  id: number;
  full_name?: string;
  email?: string;
  role?: string;
  /** "superadmin" for the platform owner; decided by the API. */
  platformRole?: string | null;
}

const LIVE = new Set(["active", "pending_setup"]);

export default function AccountPage() {
  const { t, lang } = useTranslation();
  const [me, setMe] = useState<Me | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [plan, setPlan] = useState<OrganisationPlan | null>(null);
  const [seller, setSeller] = useState<SellerPayTo | null>(null);
  const [setupMsg, setSetupMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  const [nonce, setNonce] = useState(0);

  const day = (d?: string | null) => formatDate(d, lang, { day: "numeric", month: "short", year: "numeric" }) || "—";

  const retry = useCallback(() => {
    setError(null);
    setOrders(null);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiGet<Me>("/api/auth/me")
      .then(async (user) => {
        if (cancelled) return;
        if (!user?.email) {
          setAnonymous(true);
          return;
        }
        setMe(user);
        try {
          const data = await loadMyCommerce();
          if (cancelled) return;
          setOrders(data.orders);
          setCustomers(data.customers);
          setSeller(data.seller);
          const first = data.customers[0];
          if (first) {
            loadOrganisationPlan(first.id)
              .then((p) => { if (!cancelled) setPlan(p); })
              .catch(() => { /* the plan line stays hidden */ });
          }
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : "");
        }
      })
      .catch(() => {
        if (!cancelled) setAnonymous(true);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const leave = async () => {
    await signOut();
    window.location.href = "/";
  };

  const brandBtn = "inline-flex min-h-11 items-center gap-2 rounded-[12px] px-5 text-[15px] font-semibold";
  const linkBtn = "mt-4 inline-flex min-h-10 items-center gap-2 text-[14px] font-medium";
  const eyebrow = (
    <p className="hs-mono mb-3 text-[11.5px] font-medium uppercase tracking-[0.16em]" style={{ color: "var(--hs-brand)" }}>
      {t("portal.eyebrow")}
    </p>
  );
  const h1 = "text-balance text-[2rem] font-semibold leading-[1.08] tracking-[-0.025em] sm:text-[2.5rem]";

  if (anonymous) {
    return (
      <section style={{ background: "var(--hs-bg)" }}>
        <div className="mx-auto max-w-md px-5 pb-24 pt-16 sm:pt-24">
          {eyebrow}
          <h1 className={h1} style={{ fontFamily: "var(--font-display)", color: "var(--hs-ink)" }}>{t("portal.sign_in_title")}</h1>
          <Link href="/signin?next=%2Faccount" className={`${brandBtn} mt-8`} style={{ background: "var(--hs-brand-solid)", color: "#fff" }}>
            {t("portal.sign_in")} <ArrowRight size={15} />
          </Link>
        </div>
      </section>
    );
  }

  const isOwner = me?.platformRole === "superadmin";
  const org = customers[0] ?? null;
  const orgLive = !!org && LIVE.has(org.status || "active");

  const iconTile = (node: React.ReactNode, bg: string, fg: string) => (
    <span className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-[10px]" style={{ background: bg, color: fg }}>
      {node}
    </span>
  );

  /* What happens next, in the words the checkout and the e-mails use. */
  const nextStep = (o: Order) => {
    const stage = orderStage(o);
    const pay = paymentState(o);
    if (stage === "under_review") return o.paid_at ? t("portal.next.paid") : t("portal.next.pending");
    if (stage === "active" && (pay === "awaiting" || pay === "overdue")) {
      return fill(t("portal.next.awaiting"), { invoice: o.invoice_number ?? "", due: day(o.invoice_due_at), code: o.order_code });
    }
    if (stage === "active") return t("portal.next.delivered");
    if (stage === "refused") return t("portal.next.refused");
    return null;
  };

  const resendSetup = async () => {
    if (!org || setupBusy) return;
    setSetupBusy(true);
    setSetupMsg(null);
    try {
      const out = await apiPost<{ email: string }>(`/api/me/organisations/${org.id}/setup-link`, {});
      setSetupMsg({ ok: true, text: fill(t("portal.setup_sent"), { email: out.email }) });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      setSetupMsg({ ok: false, text: code === "SETUP_RECENT" ? t("setup.renew_recent") : code === "SETUP_DONE" ? t("setup.used_body") : t("portal.setup_failed") });
    } finally {
      setSetupBusy(false);
    }
  };

  return (
    <section style={{ background: "var(--hs-bg)" }}>
      <div className="mx-auto max-w-5xl px-4 pb-24 pt-10 sm:px-5 sm:pt-14">
        {eyebrow}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className={h1} style={{ fontFamily: "var(--font-display)", color: "var(--hs-ink)" }}>
            {me?.full_name || me?.email || t("portal.eyebrow")}
          </h1>
          <button
            type="button"
            onClick={leave}
            className="inline-flex min-h-10 items-center gap-2 rounded-[12px] border px-4 text-[13px] font-medium transition-colors hover:bg-[var(--hs-tint)]"
            style={{ borderColor: "var(--hs-line-2)", color: "var(--hs-ink-2)" }}
          >
            <LogOut size={14} /> {t("portal.sign_out")}
          </button>
        </div>

        {org && org.status === "active" && !org.onboarded_at && !org.plan_exempt ? (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border px-4 py-3 text-[14px]" style={{ borderColor: "var(--hs-info)", background: "var(--hs-info-weak)", color: "var(--hs-ink)" }}>
            <p className="min-w-0">
              {t("portal.setup_due")}
              {setupMsg ? (
                <span role="status" className="mt-1 block text-[13px]" style={{ color: setupMsg.ok ? "var(--hs-ok)" : "var(--hs-danger)" }}>{setupMsg.text}</span>
              ) : null}
            </p>
            {org.my_role === "owner" ? (
              <button
                type="button"
                onClick={resendSetup}
                disabled={setupBusy}
                className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-[12px] border px-4 text-[13px] font-medium transition-colors hover:bg-[var(--hs-tint)] disabled:opacity-60"
                style={{ borderColor: "var(--hs-line-2)", color: "var(--hs-ink)", background: "var(--hs-surface)" }}
              >
                {t("portal.setup_resend")}
              </button>
            ) : null}
          </div>
        ) : null}

        {/* ── Where to go ─────────────────────────────────────────── */}
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card lift>
            {iconTile(<LayoutDashboard size={16} />, "var(--hs-brand-weak)", "var(--hs-brand)")}
            <p className="text-[15px] font-semibold" style={{ color: "var(--hs-ink)" }}>{t("portal.workspace")}</p>
            <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>{t("portal.workspace_desc")}</p>
            {org && !orgLive ? (
              <p className="mt-4 text-[13px]" style={{ color: "var(--hs-ink-3)" }}>{t("portal.workspace_pending")}</p>
            ) : (
              <a href={appUrl("/workspaces?auto=1")} className={linkBtn} style={{ color: "var(--hs-brand)" }}>
                {t("portal.workspace_open")} <ExternalLink size={14} />
              </a>
            )}
          </Card>

          {isOwner ? (
            <Card lift>
              {iconTile(<ShieldCheck size={16} />, "var(--hs-ok-weak)", "var(--hs-ok)")}
              <p className="text-[15px] font-semibold" style={{ color: "var(--hs-ink)" }}>{t("portal.console")}</p>
              <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>{t("portal.console_desc")}</p>
              <a href={consoleHref()} className={linkBtn} style={{ color: "var(--hs-brand)" }}>
                {t("portal.console_open")} <ArrowRight size={14} />
              </a>
            </Card>
          ) : (
            <Card>
              {iconTile(<Building2 size={16} />, "var(--hs-tint)", "var(--hs-ink-2)")}
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[15px] font-semibold" style={{ color: "var(--hs-ink)" }}>{org ? org.name : t("portal.org_none")}</p>
                {org?.status ? (
                  <Badge tone={org.status === "active" ? "ok" : org.status === "pending_review" ? "warn" : "neutral"}>
                    {t(`portal.org_status.${org.status}`)}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>
                {org ? [org.sector, org.city, org.country].filter(Boolean).join(" · ") || " " : t("portal.org_none_desc")}
              </p>
              {plan ? (
                <p className="mt-3 text-[13px]" style={{ color: "var(--hs-ink-2)" }}>
                  <span style={{ color: "var(--hs-ink-3)" }}>{t("portal.plan")}: </span>
                  {plan.exempt
                    ? t("portal.plan_exempt")
                    : plan.plan
                      ? `${PLAN_LABEL[plan.plan] ?? plan.plan} · ${plan.eventsRemaining == null ? t("portal.events_unlimited") : `${plan.eventsRemaining} ${t("portal.events_left")}`}`
                      : "—"}
                </p>
              ) : null}
              {org?.billing_email ? (
                <p className="mt-2 text-[13px]" style={{ color: "var(--hs-ink-3)" }}>{t("portal.invoices_to")} {org.billing_email}</p>
              ) : null}
            </Card>
          )}

          {org && orgLive ? (
            <Card lift>
              {iconTile(<Users size={16} />, "var(--hs-tint)", "var(--hs-ink-2)")}
              <p className="text-[15px] font-semibold" style={{ color: "var(--hs-ink)" }}>{t("portal.team")}</p>
              <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>{t("portal.team_desc")}</p>
              <Link href="/account/team" className={linkBtn} style={{ color: "var(--hs-brand)" }}>
                {t("portal.team_manage")} <ArrowRight size={14} />
              </Link>
            </Card>
          ) : null}

          {org && orgLive ? (
            <Card lift>
              {iconTile(<Webhook size={16} />, "var(--hs-tint)", "var(--hs-ink-2)")}
              <p className="text-[15px] font-semibold" style={{ color: "var(--hs-ink)" }}>{t("wh.portal.title")}</p>
              <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>{t("wh.portal.desc")}</p>
              <Link href="/account/webhooks" className={linkBtn} style={{ color: "var(--hs-brand)" }}>
                {t("wh.portal.open")} <ArrowRight size={14} />
              </Link>
            </Card>
          ) : null}
        </div>

        {/* ── Orders ──────────────────────────────────────────────── */}
        <div id="orders" className="mt-10 flex scroll-mt-28 items-center gap-2.5">
          <Receipt size={17} style={{ color: "var(--hs-ink-3)" }} />
          <h2 className="text-[17px] font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--hs-ink)" }}>{t("portal.orders")}</h2>
        </div>

        {error !== null ? (
          <div className="mt-4">
            <ErrorState title={t("portal.orders_error")} body={error || undefined} onRetry={retry} />
          </div>
        ) : orders === null ? (
          <Card className="mt-4" padded={false}>
            <TableSkeleton />
          </Card>
        ) : orders.length === 0 ? (
          <Card className="mt-4">
            <p className="text-[15px]" style={{ color: "var(--hs-ink-2)" }}>{t("portal.orders_empty")}</p>
            <Link href="/pricing" className={linkBtn} style={{ color: "var(--hs-brand)" }}>
              {t("portal.see_plans")} <ArrowRight size={14} />
            </Link>
          </Card>
        ) : (
          <ul className="mt-4 space-y-3">
            {orders.map((o) => {
              const tax = Number(o.tax_minor || 0);
              const amount = o.amount_minor == null ? null : formatMoney(Number(o.amount_minor) + tax, o.currency);
              const vatText = tax > 0 && Number(o.amount_minor) > 0
                ? fill(t("vat.rate"), { rate: Math.round((tax / Number(o.amount_minor)) * 1000) / 10 })
                : t("vat.none_short");
              const hint = nextStep(o);
              const brand = (o.card_brand || "other") as CardBrand;
              const stage = orderStage(o);
              const pay = paymentState(o);
              return (
                <li key={o.id}>
                  <Card>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <p className="text-[15px] font-semibold" style={{ color: "var(--hs-ink)" }}>{PLAN_LABEL[o.plan] ?? o.plan}</p>
                          <Badge tone={STAGE_TONE[stage]}>{t(`order.stage.${stage}`)}</Badge>
                          {pay ? <Badge tone={PAYMENT_TONE[pay]}>{t(`order.pay.${pay}`)}</Badge> : null}
                        </div>
                        <p className="mt-1 text-[13px]" style={{ color: "var(--hs-ink-3)" }}>
                          <span className="hs-mono">{o.order_code}</span>
                          {o.customer_name ? ` · ${o.customer_name}` : ""}
                          {` · ${o.billing_period === "annual" ? t("portal.annual") : t("portal.per_event")}`}
                        </p>
                        {hint ? <p className="mt-2 text-[13px]" style={{ color: "var(--hs-ink-2)" }}>{hint}</p> : null}
                        {o.status_reason && (o.status === "cancelled" || o.status === "refunded") ? (
                          <p className="mt-2 rounded-[10px] px-3 py-2 text-[13px]" style={{ background: "var(--hs-tint)", color: "var(--hs-ink)" }}>
                            <span style={{ color: "var(--hs-ink-3)" }}>{t("portal.reason")}: </span>
                            {o.status_reason}
                          </p>
                        ) : null}
                      </div>
                      <div className="text-right">
                        <p className="text-[19px] font-semibold tabular-nums" style={{ fontFamily: "var(--font-display)", color: amount ? "var(--hs-ink)" : "var(--hs-ink-3)" }}>
                          {amount ?? "—"}
                        </p>
                        <p className="text-[12px]" style={{ color: "var(--hs-ink-3)" }}>{amount ? vatText : t("portal.not_priced")}</p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3" style={{ borderColor: "var(--hs-line)" }}>
                      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
                        <div>
                          <dt style={{ color: "var(--hs-ink-3)" }}>{t("portal.placed")}</dt>
                          <dd style={{ color: "var(--hs-ink-2)" }}>{day(o.placed_at || o.created_at)}</dd>
                        </div>
                        {o.paid_at ? (
                          <div>
                            <dt style={{ color: "var(--hs-ink-3)" }}>{t("portal.paid")}</dt>
                            <dd style={{ color: "var(--hs-ink-2)" }}>{day(o.paid_at)}</dd>
                          </div>
                        ) : o.invoice_due_at && o.status !== "cancelled" ? (
                          <div>
                            <dt style={{ color: "var(--hs-ink-3)" }}>{t("portal.due")}</dt>
                            <dd style={{ color: "var(--hs-ink-2)" }}>{day(o.invoice_due_at)}</dd>
                          </div>
                        ) : null}
                        {o.delivered_at ? (
                          <div>
                            <dt style={{ color: "var(--hs-ink-3)" }}>{t("portal.activated")}</dt>
                            <dd style={{ color: "var(--hs-ink-2)" }}>{day(o.delivered_at)}</dd>
                          </div>
                        ) : null}
                        <div>
                          <dt style={{ color: "var(--hs-ink-3)" }}>{o.payment_method === "card" ? t("portal.pay_card") : t("portal.pay_bank")}</dt>
                          <dd className="flex items-center gap-1.5" style={{ color: "var(--hs-ink-2)" }}>
                            {o.payment_method === "card" ? (
                              <>
                                <CreditCard size={13} /> {BRAND_LABEL[brand] ?? "Card"} •••• {o.card_last4}
                                {!o.paid_at ? <span style={{ color: "var(--hs-ink-3)" }}> · {t("portal.not_charged")}</span> : null}
                                {o.invoice_number ? <span style={{ color: "var(--hs-ink-3)" }}> · {t("portal.invoice")} {o.invoice_number}</span> : null}
                              </>
                            ) : (
                              <>
                                <Landmark size={13} /> {o.invoice_number ? `${t("portal.invoice")} ${o.invoice_number}` : t("checkout.pay.bank_desc")}
                              </>
                            )}
                          </dd>
                        </div>
                      </dl>
                      {o.status !== "draft" ? (
                        <a
                          href={`/api/me/orders/${o.id}/invoice.pdf`}
                          className="inline-flex min-h-10 items-center gap-2 rounded-[12px] border px-4 text-[13px] font-medium transition-colors hover:bg-[var(--hs-tint)]"
                          style={{ borderColor: "var(--hs-line-2)", color: "var(--hs-ink)" }}
                        >
                          <Download size={14} /> {o.invoice_number ? t("portal.download_invoice") : t("portal.download_confirmation")}
                        </a>
                      ) : null}
                    </div>

                    {(pay === "awaiting" || pay === "overdue") && seller ? (
                      <div className="mt-3 rounded-[12px] border px-3.5 py-3 text-[13px]" style={{ borderColor: "var(--hs-line)", background: "var(--hs-tint)" }}>
                        <p className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--hs-ink-3)" }}>{t("portal.pay_to")}</p>
                        {seller.iban && seller.bankName ? (
                          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
                            {[
                              [t("portal.beneficiary"), [seller.accountHolder || seller.legalName, seller.taxId ? `VÖEN ${seller.taxId}` : null].filter(Boolean).join(" · ")],
                              [t("portal.bank"), [seller.bankName, seller.swift ? `SWIFT ${seller.swift}` : null].filter(Boolean).join(" · ")],
                              ["IBAN", seller.ibanGrouped || seller.iban],
                              [t("portal.reference"), o.order_code],
                            ].map(([k, v]) => (
                              <Fragment key={k}>
                                <dt style={{ color: "var(--hs-ink-3)" }}>{k}</dt>
                                <dd className="min-w-0 break-words font-medium" style={{ color: "var(--hs-ink)" }}>{v}</dd>
                              </Fragment>
                            ))}
                          </dl>
                        ) : (
                          <p style={{ color: "var(--hs-ink-2)" }}>{t("portal.pay_to_missing")} {t("portal.reference")}: <span className="hs-mono">{o.order_code}</span></p>
                        )}
                      </div>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-8 text-[13px] leading-relaxed" style={{ color: "var(--hs-ink-3)" }}>
          {t("portal.contact")}{" "}
          <Link href="/contact" className="hover:underline" style={{ color: "var(--hs-brand)" }}>
            {t("portal.contact_cta")}
          </Link>{" "}
          {t("portal.contact_tail")}
        </p>
      </div>
    </section>
  );
}
