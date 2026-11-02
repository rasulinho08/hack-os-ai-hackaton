"use client";

/**
 * Prices & discounts → Discounts: codes the buyer types at checkout and
 * campaigns that apply without one.
 *
 * The list is searchable (code, name, internal note) and filtered by state —
 * active, scheduled, paused, expired, used up — and by kind. Each row has its
 * uses against its limit, the revenue of the orders that used it (after the
 * discount) and the discount it gave away. A code is copied with one click.
 *
 * The drawer creates and edits both kinds: percent or a fixed amount, which
 * plans and billing periods, when it is valid, how many uses in total and per
 * organisation, first orders only, paused or active, and a note only the
 * owner reads. A campaign is for everyone (applied automatically, shown on
 * the pricing page), for universities and schools, or for non-profits (the
 * buyer claims it; the owner approves or removes it on the order). Editing a
 * discount never changes an order that already used it.
 *
 * A new discount can start from a preset (Education −40%, Non-profit −30%,
 * First event −20%, …): it fills the form and nothing more — no discount
 * exists or applies until the owner creates it. No discount takes more than
 * half the price. A launch partner's code, given to one organisation, is made
 * from that organisation's page and shows here with its name.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BadgePercent, Building2, Check, Copy, GraduationCap, HeartHandshake, Megaphone, Pause, Play, Plus, Shuffle, Sparkles, Tag, Trash2 } from "lucide-react";
import { Badge, Button, ErrorState, Stat } from "@/components/ds/primitives";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { Drawer } from "@/components/ds/overlays";
import { ApiError } from "@/lib/api";
import { PLAN_LABEL, STATUS_LABEL, type OrderStatus } from "@/lib/commerce";
import { COUPON_STATES, PERIODS, SELF_SERVE_PLANS, discountValueText, formatPriceMinor, minorToInput, parseManat, suggestCode, type BillingPeriod } from "@/lib/pricing";
import {
  COUPON_STATE_LABEL,
  ELIGIBILITY_LABEL,
  MAX_PERCENT_OFF,
  PERIOD_LABEL,
  PRESETS,
  type Preset,
  createCoupon,
  deleteCoupon,
  loadCoupon,
  loadCoupons,
  pauseCoupon,
  updateCoupon,
  type Coupon,
  type CouponInput,
  type CouponList,
  type CouponOrder,
} from "@/lib/superadmin/pricing";
import { day } from "@/lib/superadmin/directory";
import { fromLocalInput, toLocalInput } from "@/lib/superadmin/owner";
import { hrefFor, money } from "../_ui";

type Editing = { mode: "new"; kind: "code" | "campaign" } | { mode: "edit"; id: number };

function couponFromUrl(): number | null {
  if (typeof window === "undefined") return null;
  const n = Number(new URLSearchParams(window.location.search).get("coupon"));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function Coupons({ onCount }: { onCount: (n: number) => void }) {
  const [data, setData] = useState<CouponList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // A link from an order or the audit trail opens that discount.
  useEffect(() => {
    const id = couponFromUrl();
    if (id) setEditing({ mode: "edit", id });
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadCoupons()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
        onCount(d.rows.length);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the discounts");
      });
    return () => {
      cancelled = true;
    };
  }, [nonce, onCount]);

  const togglePause = async (c: Coupon) => {
    setBusy(c.id);
    try {
      await pauseCoupon(c.id, c.active);
      reload();
    } finally {
      setBusy(null);
    }
  };

  const columns: Column<Coupon>[] = [
    {
      id: "discount",
      header: "Discount",
      // Search reads the code, the name and the owner's note.
      value: (c) => `${c.code ?? ""} ${c.name} ${c.note ?? ""} ${c.customerName ?? ""}`,
      cell: (c) => (
        <div className="min-w-0">
          {c.kind === "code" ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="truncate font-mono text-[13px] font-semibold tracking-[0.03em]" style={{ color: "var(--ink)" }}>{c.code}</span>
              <CopyCode code={c.code!} />
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: "var(--ink)" }}>
              <AudienceIcon eligibility={c.eligibility} />
              <span className="truncate">{c.name}</span>
            </span>
          )}
          <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>
            {c.kind === "code" ? (c.customerName ? `Only for ${c.customerName}` : c.name !== c.code ? c.name : "Code") : ELIGIBILITY_LABEL[c.eligibility ?? "all"]}
            {c.note ? ` · ${c.note}` : ""}
          </p>
        </div>
      ),
    },
    {
      id: "value",
      header: "Off",
      sortable: true,
      value: (c) => (c.discountType === "percent" ? c.percentOff ?? 0 : (c.amountOffMinor ?? 0) / 100),
      cell: (c) => <span className="whitespace-nowrap font-semibold tabular-nums" style={{ color: "var(--ok)" }}>{discountValueText(c)}</span>,
      width: "100px",
    },
    {
      id: "scope",
      header: "Applies to",
      value: (c) => scopeText(c),
      cell: (c) => (
        <span className="block text-xs leading-relaxed" style={{ color: "var(--ink-2)" }}>
          <span className="block">{c.plans ? c.plans.map((p) => PLAN_LABEL[p] ?? p).join(", ") : "All plans"}</span>
          <span className="block" style={{ color: "var(--ink-3)" }}>
            {c.periods ? c.periods.map((p) => PERIOD_LABEL[p]).join(", ") : "Per event and annual"}{c.firstPurchaseOnly ? " · first order" : ""}
          </span>
        </span>
      ),
      width: "190px",
    },
    {
      id: "valid",
      header: "Valid",
      sortable: true,
      value: (c) => c.validUntil ?? "9999",
      cell: (c) => <span className="whitespace-nowrap text-xs" style={{ color: "var(--ink-2)" }}>{validText(c)}</span>,
      width: "150px",
    },
    {
      id: "uses",
      header: "Uses",
      sortable: true,
      align: "right",
      value: (c) => c.usesCount,
      cell: (c) => (
        <span className="whitespace-nowrap tabular-nums">
          <span style={{ color: "var(--ink)" }}>{c.usesCount.toLocaleString("en-US")}</span>
          <span className="text-xs" style={{ color: "var(--ink-3)" }}>{c.maxUses != null ? ` / ${c.maxUses.toLocaleString("en-US")}` : ""}</span>
          {c.stats.claimed ? <span className="block text-[11px]" style={{ color: "var(--warn)" }}>{c.stats.claimed} to review</span> : null}
        </span>
      ),
      width: "90px",
    },
    {
      id: "revenue",
      header: "Revenue",
      sortable: true,
      align: "right",
      value: (c) => c.stats.revenueMinor,
      cell: (c) => <span className="tabular-nums" style={{ color: "var(--ink)" }}>{money(c.stats.revenueMinor)}</span>,
      width: "130px",
    },
    {
      id: "given",
      header: "Given away",
      sortable: true,
      align: "right",
      optional: false,
      value: (c) => c.stats.discountMinor,
      cell: (c) => <span className="tabular-nums" style={{ color: "var(--ink-2)" }}>{money(c.stats.discountMinor)}</span>,
      width: "120px",
    },
    {
      id: "state",
      header: "State",
      sortable: true,
      value: (c) => c.state,
      cell: (c) => <Badge tone={COUPON_STATE_LABEL[c.state][1]} dot>{COUPON_STATE_LABEL[c.state][0]}</Badge>,
      width: "110px",
    },
    {
      id: "actions",
      header: "",
      value: () => "",
      hideOnCard: false,
      cell: (c) => (
        <span onClick={(e) => e.stopPropagation()} className="inline-flex">
          <Button
            size="sm"
            variant="ghost"
            loading={busy === c.id}
            disabled={busy !== null}
            icon={c.active ? <Pause size={13} /> : <Play size={13} />}
            onClick={() => togglePause(c)}
            aria-label={c.active ? `Pause ${c.code ?? c.name}` : `Resume ${c.code ?? c.name}`}
          >
            {c.active ? "Pause" : "Resume"}
          </Button>
        </span>
      ),
      width: "100px",
    },
  ];

  const counts = data?.counts;
  const live = counts ? counts.active : 0;

  if (error && !data) return <ErrorState title="Could not load the discounts" body={error} onRetry={reload} />;

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Active now" value={data ? live.toLocaleString("en-US") : "—"} hint={data ? `${data.rows.length} in all` : undefined} icon={<BadgePercent size={15} />} />
        <Stat label="Orders with a discount" value={data ? data.totals.orders.toLocaleString("en-US") : "—"} hint="Refused orders give their use back" />
        <Stat label="Revenue from them" value={data ? wholeManat(data.totals.revenueMinor) : "—"} hint="After the discount, before VAT" />
        <Stat label="Discount given" value={data ? wholeManat(data.totals.discountMinor) : "—"} hint="Taken off those orders" />
      </div>

      <DataTable
        rows={data?.rows ?? []}
        columns={columns}
        loading={!data}
        pageSize={20}
        onRowClick={(c) => setEditing({ mode: "edit", id: c.id })}
        searchPlaceholder="Search code, name or note…"
        emptyTitle="No discounts yet"
        emptyBody="Create a code to hand out, or a campaign that applies by itself."
        toolbarExtra={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setEditing({ mode: "new", kind: "code" })}>New code</Button>
            <Button size="sm" icon={<Megaphone size={14} />} onClick={() => setEditing({ mode: "new", kind: "campaign" })}>New campaign</Button>
          </div>
        }
        facets={[
          {
            id: "state",
            label: "State",
            options: COUPON_STATES.map((s) => ({ value: s, label: `${COUPON_STATE_LABEL[s][0]}${counts ? ` (${counts[s]})` : ""}` })),
            match: (c, sel) => sel.includes(c.state),
          },
          {
            id: "kind",
            label: "Kind",
            options: [{ value: "code", label: "Codes" }, { value: "campaign", label: "Campaigns" }],
            match: (c, sel) => sel.includes(c.kind),
          },
        ]}
      />

      <CouponDrawer
        editing={editing}
        onClose={() => {
          setEditing(null);
          const url = new URL(window.location.href);
          if (url.searchParams.has("coupon")) {
            url.searchParams.delete("coupon");
            window.history.replaceState(null, "", `${url.pathname}${url.search}`);
          }
        }}
        onSaved={reload}
      />
    </>
  );
}

/** A tile's figure in whole manat ("₼11,391"), so it fits a phone; the table has the qəpik. */
const wholeManat = (minor: number) => formatPriceMinor(Math.round(minor / 100) * 100);

function AudienceIcon({ eligibility }: { eligibility: Coupon["eligibility"] }) {
  const Icon = eligibility === "education" ? GraduationCap : eligibility === "nonprofit" ? HeartHandshake : Megaphone;
  return <Icon size={14} className="shrink-0" style={{ color: "var(--accent)" }} />;
}

function scopeText(c: Pick<Coupon, "plans" | "periods" | "firstPurchaseOnly">) {
  const plans = c.plans ? c.plans.map((p) => PLAN_LABEL[p] ?? p).join(", ") : "All plans";
  const periods = c.periods ? c.periods.map((p) => PERIOD_LABEL[p].toLowerCase()).join(", ") : "both periods";
  return `${plans} · ${periods}${c.firstPurchaseOnly ? " · first order" : ""}`;
}

function validText(c: Pick<Coupon, "validFrom" | "validUntil">) {
  if (!c.validFrom && !c.validUntil) return "Always";
  if (c.validFrom && c.validUntil) return `${day(c.validFrom)} – ${day(c.validUntil)}`;
  return c.validUntil ? `Until ${day(c.validUntil)}` : `From ${day(c.validFrom)}`;
}

function CopyCode({ code }: { code: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(code);
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        } catch { /* the code is selectable */ }
      }}
      aria-label={done ? "Copied" : `Copy ${code}`}
      title={done ? "Copied" : "Copy the code"}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-[var(--tint)]"
      style={{ color: done ? "var(--ok)" : "var(--ink-3)" }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

/* ── The drawer ────────────────────────────────────────────────────────── */

interface Form {
  kind: "code" | "campaign";
  code: string;
  name: string;
  eligibility: "all" | "education" | "nonprofit";
  discountType: "percent" | "fixed";
  percentOff: string;
  amountOff: string;
  plans: string[];
  periods: BillingPeriod[];
  validFrom: string;
  validUntil: string;
  maxUses: string;
  maxUsesPerCustomer: string;
  firstPurchaseOnly: boolean;
  active: boolean;
  note: string;
}

const blank = (kind: "code" | "campaign"): Form => ({
  kind,
  code: kind === "code" ? suggestCode() : "",
  name: kind === "campaign" ? "Education" : "",
  eligibility: kind === "campaign" ? "education" : "all",
  discountType: "percent",
  percentOff: kind === "campaign" ? "40" : "20",
  amountOff: "",
  plans: [...SELF_SERVE_PLANS],
  periods: [...PERIODS],
  validFrom: "",
  validUntil: "",
  maxUses: "",
  maxUsesPerCustomer: kind === "code" ? "1" : "",
  firstPurchaseOnly: false,
  active: true,
  note: "",
});

const formOf = (c: Coupon): Form => ({
  kind: c.kind,
  code: c.code ?? "",
  name: c.name,
  eligibility: c.eligibility ?? "all",
  discountType: c.discountType,
  percentOff: c.percentOff != null ? String(c.percentOff) : "",
  amountOff: c.amountOffMinor != null ? minorToInput(c.amountOffMinor) : "",
  plans: c.plans ?? [...SELF_SERVE_PLANS],
  periods: c.periods ?? [...PERIODS],
  validFrom: toLocalInput(c.validFrom),
  validUntil: toLocalInput(c.validUntil),
  maxUses: c.maxUses != null ? String(c.maxUses) : "",
  maxUsesPerCustomer: c.maxUsesPerCustomer != null ? String(c.maxUsesPerCustomer) : "",
  firstPurchaseOnly: c.firstPurchaseOnly,
  active: c.active,
  note: c.note ?? "",
});

/** A preset's values in the form: what it says, the rest left as a new discount has them. */
function fromPreset(p: Preset): Form {
  const f = blank(p.form.kind);
  return {
    ...f,
    code: p.form.code ?? f.code,
    name: p.form.name,
    eligibility: p.form.eligibility ?? "all",
    discountType: "percent",
    percentOff: String(p.form.percentOff),
    periods: p.form.periods ?? [...PERIODS],
    firstPurchaseOnly: Boolean(p.form.firstPurchaseOnly),
    maxUsesPerCustomer: p.form.maxUsesPerCustomer == null ? "" : String(p.form.maxUsesPerCustomer),
    note: p.form.note,
  };
}

/** The form as the API's fields. A number box that is not a number is sent as typed: the API says why. */
function bodyOf(f: Form): CouponInput {
  const int = (s: string) => (s.trim() === "" ? null : Number(s.trim()));
  const amount = parseManat(f.amountOff);
  return {
    ...(f.kind === "code" ? { code: f.code.trim().toUpperCase() } : { eligibility: f.eligibility }),
    kind: f.kind,
    name: f.name.trim(),
    discountType: f.discountType,
    ...(f.discountType === "percent"
      ? { percentOff: Number(f.percentOff.replace(",", ".")) }
      : { amountOffMinor: amount == null ? undefined : amount }),
    plans: f.plans,
    periods: f.periods,
    validFrom: fromLocalInput(f.validFrom),
    validUntil: fromLocalInput(f.validUntil),
    maxUses: int(f.maxUses),
    maxUsesPerCustomer: int(f.maxUsesPerCustomer),
    firstPurchaseOnly: f.firstPurchaseOnly,
    active: f.active,
    note: f.note,
  };
}

function CouponDrawer({ editing, onClose, onSaved }: { editing: Editing | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Form>(blank("code"));
  const [current, setCurrent] = useState<(Coupon & { orders: CouponOrder[] }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [preset, setPreset] = useState<string | null>(null);

  useEffect(() => {
    setErrors({});
    setNotice(null);
    setConfirmDelete(false);
    setPreset(null);
    if (!editing) return;
    if (editing.mode === "new") {
      setCurrent(null);
      setForm(blank(editing.kind));
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadCoupon(editing.id)
      .then((c) => {
        if (cancelled) return;
        setCurrent(c);
        setForm(formOf(c));
      })
      .catch((e: unknown) => { if (!cancelled) setNotice(e instanceof Error ? e.message : "Could not load this discount"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [editing]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: "" }));
    setNotice(null);
  };
  const toggle = <K extends "plans" | "periods">(k: K, v: Form[K][number]) =>
    set(k, (form[k] as string[]).includes(v) ? (form[k] as string[]).filter((x) => x !== v) as Form[K] : [...(form[k] as string[]), v] as Form[K]);

  const preview = useMemo(() => {
    const pct = Number(form.percentOff.replace(",", "."));
    const amt = parseManat(form.amountOff);
    return form.discountType === "percent"
      ? (Number.isFinite(pct) && pct > 0 ? discountValueText({ discountType: "percent", percentOff: pct, amountOffMinor: null }) : null)
      : (amt && !Number.isNaN(amt) ? discountValueText({ discountType: "fixed", percentOff: null, amountOffMinor: amt }) : null);
  }, [form.discountType, form.percentOff, form.amountOff]);

  const save = async () => {
    setSaving(true);
    setErrors({});
    setNotice(null);
    try {
      const body = bodyOf(form);
      if (form.discountType === "fixed" && body.amountOffMinor === undefined) {
        setErrors({ amountOffMinor: "An amount in manat, e.g. 50 or 49.50." });
        return;
      }
      if (editing?.mode === "edit") {
        // The kind is chosen once, when the discount is made.
        const rest = { ...body };
        delete rest.kind;
        await updateCoupon(editing.id, rest);
      } else {
        await createCoupon(body);
      }
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length) {
        const next: Record<string, string> = {};
        for (const f of err.fieldErrors) next[f.field] = f.message || "Check this field.";
        setErrors(next);
      }
      setNotice(err instanceof ApiError ? err.summary || err.message : "The discount was not saved.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (editing?.mode !== "edit") return;
    setSaving(true);
    try {
      await deleteCoupon(editing.id);
      onSaved();
      onClose();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.summary || err.message : "It was not deleted.");
    } finally {
      setSaving(false);
      setConfirmDelete(false);
    }
  };

  const field = "min-h-10 w-full rounded-[var(--radius-sm)] border px-3 text-sm outline-none focus:border-[var(--accent)]";
  const fieldStyle = (bad?: string): React.CSSProperties => ({ borderColor: bad ? "var(--danger)" : "var(--line-strong)", background: "var(--surface-sunken)", color: "var(--ink)" });
  const labelCls = "mb-1 block text-xs font-medium";
  const err = (k: string) => (errors[k] ? <p className="mt-1 text-[11px]" style={{ color: "var(--danger)" }}>{errors[k]}</p> : null);
  const chip = (on: boolean) => ({
    className: "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors",
    style: { borderColor: on ? "var(--accent)" : "var(--line-strong)", background: on ? "var(--accent-weak)" : "var(--surface)", color: on ? "var(--accent)" : "var(--ink-2)" } as React.CSSProperties,
  });

  const isCode = form.kind === "code";
  const title = editing?.mode === "edit" ? (current ? `Edit ${current.code ?? current.name}` : "Discount") : isCode ? "New discount code" : "New campaign";

  return (
    <Drawer
      open={editing !== null}
      onClose={onClose}
      title={title}
      description={isCode ? "A code the buyer types at checkout." : "Applies without a code."}
      width={520}
      footer={
        <>
          {editing?.mode === "edit" && current && current.usesCount === 0 && current.stats.orders === 0 ? (
            confirmDelete ? (
              <Button size="sm" variant="danger" icon={<Trash2 size={13} />} loading={saving} onClick={remove}>Delete for good</Button>
            ) : (
              <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => setConfirmDelete(true)} className="mr-auto">Delete</Button>
            )
          ) : null}
          <Button size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" variant="primary" icon={<Check size={14} />} loading={saving && !confirmDelete} disabled={saving || loading} onClick={save}>
            {editing?.mode === "edit" ? "Save changes" : isCode ? "Create code" : "Start campaign"}
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="py-8 text-center text-sm" style={{ color: "var(--ink-3)" }}>Loading…</p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); save(); }} className="flex flex-col gap-5" noValidate>
          {current ? <Usage coupon={current} /> : null}

          {editing?.mode === "new" ? (
            <fieldset>
              <legend className="mb-1.5 flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--ink-2)" }}>
                <Sparkles size={13} style={{ color: "var(--accent)" }} /> Start from a preset
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    title={p.hint}
                    aria-pressed={preset === p.id}
                    onClick={() => { setPreset(p.id); setForm(fromPreset(p)); setErrors({}); setNotice(null); }}
                    {...chip(preset === p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] leading-snug" style={{ color: "var(--ink-3)" }}>
                {preset ? PRESETS.find((p) => p.id === preset)?.hint : "A preset only fills in the form. Nothing applies until you create it."}
              </p>
            </fieldset>
          ) : null}

          {isCode ? (
            <div>
              <label htmlFor="cp-code" className={labelCls} style={{ color: "var(--ink-2)" }}>Code</label>
              <div className="flex gap-2">
                <input
                  id="cp-code"
                  value={form.code}
                  onChange={(e) => set("code", e.target.value.toUpperCase().replace(/\s/g, ""))}
                  maxLength={40}
                  autoComplete="off"
                  spellCheck={false}
                  className={`${field} font-mono uppercase tracking-[0.04em]`}
                  style={fieldStyle(errors.code)}
                />
                <Button type="button" size="sm" icon={<Shuffle size={13} />} onClick={() => set("code", suggestCode())} aria-label="Suggest a code" title="Suggest a code" />
              </div>
              {errors.code ? err("code") : <p className="mt-1 text-[11px]" style={{ color: "var(--ink-3)" }}>Letters, digits, “-” and “_”. Buyers can type it in any case.</p>}
              {current?.customerName ? (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: "var(--info-weak)", color: "var(--info)" }}>
                  <Building2 size={12} /> Only for {current.customerName}
                </p>
              ) : null}
            </div>
          ) : (
            <fieldset>
              <legend className={labelCls} style={{ color: "var(--ink-2)" }}>Who it is for</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(["education", "nonprofit", "all"] as const).map((e) => {
                  const on = form.eligibility === e;
                  return (
                    <button
                      key={e}
                      type="button"
                      onClick={() => set("eligibility", e)}
                      aria-pressed={on}
                      className="flex items-start gap-2 rounded-[var(--radius-sm)] border p-3 text-left"
                      style={{ borderColor: on ? "var(--accent)" : "var(--line-strong)", background: on ? "var(--accent-weak)" : "var(--surface)" }}
                    >
                      <AudienceIcon eligibility={e} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium" style={{ color: "var(--ink)" }}>{e === "education" ? "Universities & schools" : e === "nonprofit" ? "Non-profits" : "Everyone"}</span>
                        <span className="block text-[11px] leading-snug" style={{ color: "var(--ink-3)" }}>
                          {e === "all" ? "Applied to every order it fits and shown on the pricing page." : "The buyer says so at checkout; you approve or remove it on the order."}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {err("eligibility")}
            </fieldset>
          )}

          <div>
            <label htmlFor="cp-name" className={labelCls} style={{ color: "var(--ink-2)" }}>{isCode ? "Name" : "Name buyers see"}</label>
            <input id="cp-name" value={form.name} maxLength={120} onChange={(e) => set("name", e.target.value)} placeholder={isCode ? "Defaults to the code" : "e.g. Education, Launch offer"} className={field} style={fieldStyle(errors.name)} />
            {err("name")}
          </div>

          <fieldset>
            <legend className={labelCls} style={{ color: "var(--ink-2)" }}>Discount</legend>
            <div className="flex flex-wrap items-start gap-2">
              <div className="inline-flex rounded-[var(--radius-sm)] border p-0.5" style={{ borderColor: "var(--line-strong)" }} role="group" aria-label="Kind of discount">
                {(["percent", "fixed"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={form.discountType === t}
                    onClick={() => set("discountType", t)}
                    className="min-h-9 rounded-[6px] px-3 text-[13px] font-medium"
                    style={{ background: form.discountType === t ? "var(--ink)" : "transparent", color: form.discountType === t ? "var(--surface)" : "var(--ink-2)" }}
                  >
                    {t === "percent" ? "Percent" : "Fixed amount"}
                  </button>
                ))}
              </div>
              <div className="relative w-36">
                {form.discountType === "fixed" ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--ink-3)" }}>₼</span> : null}
                <input
                  aria-label={form.discountType === "percent" ? "Per cent off" : "Manat off"}
                  inputMode="decimal"
                  value={form.discountType === "percent" ? form.percentOff : form.amountOff}
                  onChange={(e) => (form.discountType === "percent" ? set("percentOff", e.target.value) : set("amountOff", e.target.value))}
                  className={`${field} ${form.discountType === "fixed" ? "pl-7" : "pr-8"}`}
                  style={fieldStyle(errors.percentOff || errors.amountOffMinor)}
                />
                {form.discountType === "percent" ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--ink-3)" }}>%</span> : null}
              </div>
              {preview ? <Badge tone="ok"><Tag size={11} /> {preview}</Badge> : null}
            </div>
            {err("percentOff")}
            {err("amountOffMinor")}
            {form.discountType === "percent" && !errors.percentOff ? (
              <p className="mt-1 text-[11px]" style={{ color: "var(--ink-3)" }}>At most {MAX_PERCENT_OFF}%. When several discounts fit, the largest wins; they never add up.</p>
            ) : null}
            {form.discountType === "fixed" ? <p className="mt-1 text-[11px]" style={{ color: "var(--ink-3)" }}>Never more than half the price: a ₼500 code on a ₼390 plan takes ₼195 off.</p> : null}
          </fieldset>

          <fieldset>
            <legend className={labelCls} style={{ color: "var(--ink-2)" }}>Plans</legend>
            <div className="flex flex-wrap gap-2">
              {SELF_SERVE_PLANS.map((p) => (
                <button key={p} type="button" aria-pressed={form.plans.includes(p)} onClick={() => toggle("plans", p)} {...chip(form.plans.includes(p))}>
                  {form.plans.includes(p) ? <Check size={12} /> : null}{PLAN_LABEL[p]}
                </button>
              ))}
            </div>
            {err("plans")}
            {form.plans.length === 0 ? <p className="mt-1 text-[11px]" style={{ color: "var(--danger)" }}>Choose at least one plan.</p> : null}
          </fieldset>

          <fieldset>
            <legend className={labelCls} style={{ color: "var(--ink-2)" }}>Billing period</legend>
            <div className="flex flex-wrap gap-2">
              {PERIODS.map((p) => (
                <button key={p} type="button" aria-pressed={form.periods.includes(p)} onClick={() => toggle("periods", p)} {...chip(form.periods.includes(p))}>
                  {form.periods.includes(p) ? <Check size={12} /> : null}{PERIOD_LABEL[p]}
                </button>
              ))}
            </div>
            {err("periods")}
            {form.periods.length === 0 ? <p className="mt-1 text-[11px]" style={{ color: "var(--danger)" }}>Choose at least one period.</p> : null}
          </fieldset>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="cp-from" className={labelCls} style={{ color: "var(--ink-2)" }}>Valid from</label>
              <input id="cp-from" type="datetime-local" value={form.validFrom} onChange={(e) => set("validFrom", e.target.value)} className={field} style={fieldStyle(errors.validFrom)} />
              {errors.validFrom ? err("validFrom") : <p className="mt-1 text-[11px]" style={{ color: "var(--ink-3)" }}>Empty: from now.</p>}
            </div>
            <div>
              <label htmlFor="cp-until" className={labelCls} style={{ color: "var(--ink-2)" }}>Valid until</label>
              <input id="cp-until" type="datetime-local" value={form.validUntil} onChange={(e) => set("validUntil", e.target.value)} className={field} style={fieldStyle(errors.validUntil)} />
              {errors.validUntil ? err("validUntil") : <p className="mt-1 text-[11px]" style={{ color: "var(--ink-3)" }}>Empty: no end.</p>}
            </div>
            <div>
              <label htmlFor="cp-max" className={labelCls} style={{ color: "var(--ink-2)" }}>Uses in total</label>
              <input id="cp-max" inputMode="numeric" value={form.maxUses} placeholder="No limit" onChange={(e) => set("maxUses", e.target.value)} className={field} style={fieldStyle(errors.maxUses)} />
              {err("maxUses")}
            </div>
            <div>
              <label htmlFor="cp-per" className={labelCls} style={{ color: "var(--ink-2)" }}>Uses per organisation</label>
              <input id="cp-per" inputMode="numeric" value={form.maxUsesPerCustomer} placeholder="No limit" onChange={(e) => set("maxUsesPerCustomer", e.target.value)} className={field} style={fieldStyle(errors.maxUsesPerCustomer)} />
              {err("maxUsesPerCustomer")}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={form.firstPurchaseOnly} onChange={(e) => set("firstPurchaseOnly", e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--accent-solid)]" />
              <span className="text-sm" style={{ color: "var(--ink)" }}>
                First order only
                <span className="block text-xs" style={{ color: "var(--ink-3)" }}>For organisations that have not ordered before.</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--accent-solid)]" />
              <span className="text-sm" style={{ color: "var(--ink)" }}>
                Active
                <span className="block text-xs" style={{ color: "var(--ink-3)" }}>Off: paused — it stops applying, and buyers are told it is not active.</span>
              </span>
            </label>
          </div>

          <div>
            <label htmlFor="cp-note" className={labelCls} style={{ color: "var(--ink-2)" }}>Internal note</label>
            <textarea id="cp-note" rows={2} maxLength={2000} value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="Who it was given to, and why. Buyers never see this." className={`${field} py-2`} style={fieldStyle(errors.note)} />
            {err("note")}
          </div>

          {notice ? <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{notice}</p> : null}
          {current && current.stats.orders > 0 ? (
            <p className="text-xs leading-relaxed" style={{ color: "var(--ink-3)" }}>
              Changes apply to orders from now on. The {current.stats.orders} order{current.stats.orders === 1 ? "" : "s"} that used it keep the discount they were placed with.
            </p>
          ) : null}
        </form>
      )}
    </Drawer>
  );
}

/** What a discount has done so far, and the orders that used it. */
function Usage({ coupon }: { coupon: Coupon & { orders: CouponOrder[] } }) {
  const [label, tone] = COUPON_STATE_LABEL[coupon.state];
  return (
    <div className="rounded-[var(--radius-sm)] border p-3" style={{ borderColor: "var(--line)", background: "var(--surface-sunken)" }}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={tone} dot>{label}</Badge>
        <span className="text-xs" style={{ color: "var(--ink-3)" }}>
          Created {day(coupon.createdAt)}{coupon.createdByName ? ` by ${coupon.createdByName}` : ""}
        </span>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          ["Uses", `${coupon.usesCount}${coupon.maxUses != null ? ` / ${coupon.maxUses}` : ""}`],
          ["Revenue", formatPriceMinor(coupon.stats.revenueMinor)],
          ["Given away", formatPriceMinor(coupon.stats.discountMinor)],
        ].map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[10px] font-medium uppercase tracking-[0.09em]" style={{ color: "var(--ink-3)" }}>{k}</dt>
            <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums" style={{ color: "var(--ink)" }}>{v}</dd>
          </div>
        ))}
      </dl>
      {coupon.orders.length ? (
        <ul className="mt-3 border-t pt-2" style={{ borderColor: "var(--line)" }}>
          {coupon.orders.slice(0, 6).map((o) => (
            <li key={o.id} className="flex items-baseline justify-between gap-2 py-1 text-xs">
              <Link prefetch={false} href={hrefFor.order(o.id)} className="min-w-0 truncate hover:underline" style={{ color: "var(--ink)" }}>
                {o.order_code} · {o.customer_name}
              </Link>
              <span className="shrink-0 tabular-nums" style={{ color: o.released ? "var(--ink-3)" : "var(--ink-2)" }}>
                {o.released ? "given back" : o.discount_status === "claimed" ? "to review" : STATUS_LABEL[o.status as OrderStatus] ?? o.status}
                {" · "}−{formatPriceMinor(Number(o.discount_minor || 0))}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
