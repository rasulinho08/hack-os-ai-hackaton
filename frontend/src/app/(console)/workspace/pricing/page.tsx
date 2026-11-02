"use client";

/**
 * Prices & discounts: what each plan costs and allows, the discount codes and
 * campaigns buyers can use, and every price change.
 *
 *   Plans      one editor per plan, with the card as the pricing page will
 *              show it and the annual rule checked as the owner types. Saving
 *              shows every change as old → new first (./_plans).
 *   Discounts  codes and automatic campaigns, searchable and filtered by
 *              state, with their uses, the revenue they brought and what they
 *              gave away; created and edited in a drawer (./_coupons).
 *   History    who changed which price when (./_history).
 *
 * The tab is kept in the address (?tab=discounts), so a link from an order or
 * the audit trail opens the right one. Orders already placed and invoices
 * already issued keep the prices they were made with; the page says so where
 * it matters.
 */

import { useCallback, useEffect, useState } from "react";
import { ErrorState, Tabs } from "@/components/ds/primitives";
import { PageHead } from "../_shell";
import { loadPricing, type PricingData } from "@/lib/superadmin/pricing";
import { PlansEditor } from "./_plans";
import { Coupons } from "./_coupons";
import { PriceHistory } from "./_history";

type Tab = "plans" | "discounts" | "history";
const TABS: Tab[] = ["plans", "discounts", "history"];

function tabFromUrl(): Tab {
  if (typeof window === "undefined") return "plans";
  const t = new URLSearchParams(window.location.search).get("tab");
  return TABS.includes(t as Tab) ? (t as Tab) : "plans";
}

export default function PricingPage() {
  const [tab, setTab] = useState<Tab>("plans");
  const [data, setData] = useState<PricingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [couponCount, setCouponCount] = useState<number | undefined>(undefined);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // The address decides the first tab; it is read once the page is in the browser.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setTab(tabFromUrl()), []);

  useEffect(() => {
    let cancelled = false;
    loadPricing()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the prices");
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const choose = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "plans") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    url.searchParams.delete("coupon");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  };

  return (
    <>
      <PageHead
        title="Prices & discounts"
        sub="What each plan costs on the website and at checkout, and the discounts buyers can use. Orders already placed and invoices already issued keep the prices they were made with."
      />
      <Tabs
        className="mb-6"
        value={tab}
        onChange={choose}
        tabs={[
          { id: "plans", label: "Plans" },
          { id: "discounts", label: "Discounts", count: couponCount },
          { id: "history", label: "Price history", count: data ? data.history.length || undefined : undefined },
        ]}
      />
      {error && !data && tab !== "discounts" ? (
        <ErrorState title="Could not load the prices" body={error} onRetry={reload} />
      ) : tab === "plans" ? (
        <PlansEditor data={data} onSaved={reload} />
      ) : tab === "discounts" ? (
        <Coupons onCount={setCouponCount} />
      ) : (
        <PriceHistory plans={data?.plans ?? null} />
      )}
    </>
  );
}
