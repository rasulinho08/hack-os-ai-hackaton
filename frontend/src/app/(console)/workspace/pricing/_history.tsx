"use client";

/**
 * Prices & discounts → Price history: every save of the catalogue, newest
 * first — when, who, which plan, and each field as old → new, with the note
 * written when it was saved. Filtered by plan.
 */

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Card, EmptyState, ErrorState, TableSkeleton } from "@/components/ds/primitives";
import { formatPriceMinor } from "@/lib/pricing";
import { MONEY_FIELDS, PLAN_FIELD_LABEL, loadPriceHistory, type CataloguePlan, type PlanField, type PriceChange } from "@/lib/superadmin/pricing";
import { PersonLink } from "../_ui";
import { ago, when } from "@/lib/superadmin/directory";

function show(field: PlanField, v: unknown): string {
  if (field === "active") return v ? "on sale" : "off sale";
  if (v == null) return MONEY_FIELDS.includes(field) ? "none" : "unlimited";
  if (MONEY_FIELDS.includes(field)) return formatPriceMinor(Number(v));
  if (field === "storageGb") return `${Number(v).toLocaleString("en-US")} GB`;
  return Number(v).toLocaleString("en-US");
}

export function PriceHistory({ plans }: { plans: CataloguePlan[] | null }) {
  const [plan, setPlan] = useState<string>("");
  const [rows, setRows] = useState<PriceChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadPriceHistory(plan || undefined)
      .then((r) => { if (!cancelled) { setRows(r); setError(null); } })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the history"); });
    return () => { cancelled = true; };
  }, [plan, nonce]);

  const name = (id: string) => plans?.find((p) => p.id === id)?.name ?? id;
  const priced = (plans ?? []).filter((p) => !p.quoteOnly);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Plan">
        {[{ id: "", name: "All plans" }, ...priced].map((p) => {
          const on = plan === p.id;
          return (
            <button
              key={p.id || "all"}
              type="button"
              aria-pressed={on}
              onClick={() => { setRows(null); setPlan(p.id); }}
              className="inline-flex min-h-9 items-center rounded-full border px-3 text-[13px] font-medium"
              style={{ borderColor: on ? "var(--accent)" : "var(--line-strong)", background: on ? "var(--accent-weak)" : "var(--surface)", color: on ? "var(--accent)" : "var(--ink-2)" }}
            >
              {p.name}
            </button>
          );
        })}
      </div>

      {error && !rows ? (
        <ErrorState title="Could not load the price history" body={error} onRetry={() => setNonce((n) => n + 1)} />
      ) : !rows ? (
        <Card padded={false}><TableSkeleton rows={5} cols={3} /></Card>
      ) : rows.length === 0 ? (
        <EmptyState title="No price changes yet" body="Every save on the Plans tab is listed here: who changed what, and when." />
      ) : (
        <Card padded={false}>
          <ol>
            {rows.map((h) => (
              <li key={h.id} className="flex flex-col gap-2 border-b px-4 py-3.5 last:border-b-0 sm:flex-row sm:items-start sm:gap-6" style={{ borderColor: "var(--line)" }}>
                <div className="w-full shrink-0 sm:w-48">
                  <p className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{name(h.plan_id)}</p>
                  <p className="text-xs" style={{ color: "var(--ink-3)" }}>
                    <time dateTime={h.changed_at} title={when(h.changed_at)}>{ago(h.changed_at)}</time>
                    {" · "}
                    {h.changed_by ? <PersonLink id={h.changed_by} name={h.changed_by_name} muted /> : "the platform"}
                  </p>
                </div>
                <div className="min-w-0 flex-1">
                  <ul className="flex flex-col gap-1">
                    {Object.entries(h.changes).map(([field, pair]) => {
                      const [from, to] = pair as [unknown, unknown];
                      const f = field as PlanField;
                      return (
                        <li key={field} className="flex flex-wrap items-center gap-x-2 text-sm" style={{ color: "var(--ink-2)" }}>
                          <span className="min-w-[10rem]">{PLAN_FIELD_LABEL[f] ?? field}</span>
                          <s className="tabular-nums" style={{ color: "var(--ink-3)" }}>{show(f, from)}</s>
                          <ArrowRight size={13} style={{ color: "var(--ink-3)" }} aria-label="to" />
                          <span className="font-semibold tabular-nums" style={{ color: "var(--ink)" }}>{show(f, to)}</span>
                        </li>
                      );
                    })}
                  </ul>
                  {h.note ? <p className="mt-1.5 text-xs italic" style={{ color: "var(--ink-3)" }}>“{h.note}”</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
