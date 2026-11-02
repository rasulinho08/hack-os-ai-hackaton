"use client";

/**
 * Prices & discounts → Plans: one editor per plan.
 *
 * Each card edits the per-event and annual price, an optional higher "was"
 * price to strike through, whether the plan is on sale, and the limits an
 * order for it grants. Beside the form is the card as the public pricing
 * page will draw it (with any campaign that runs), and under the prices the
 * annual rule — a year never costs more than its events bought one by one —
 * is checked as the owner types, with the price that would keep it.
 *
 * Saving opens a dialog listing every change as old → new, with room for a
 * note that goes into the price history. The API checks the same rules again
 * and answers with the field to fix (ANNUAL_ABOVE_PER_EVENT,
 * LIST_PRICE_NOT_ABOVE, PLAN_NEEDS_PRICE). Enterprise is quoted and has no
 * price to edit.
 */

import { useMemo, useState } from "react";
import { BadgePercent, Check, Lock, RotateCcw, Save, TriangleAlert } from "lucide-react";
import { Badge, Button, Card, Skeleton } from "@/components/ds/primitives";
import { Modal } from "@/components/ds/overlays";
import { ApiError } from "@/lib/api";
import {
  annualRule,
  bestCampaign,
  discountValueText,
  displayPrice,
  formatPriceMinor,
  minorToInput,
  parseManat,
  savingPercent,
} from "@/lib/pricing";
import {
  MONEY_FIELDS,
  PLAN_FIELDS,
  PLAN_FIELD_LABEL,
  savePlan,
  type CataloguePlan,
  type PlanField,
  type PricingData,
} from "@/lib/superadmin/pricing";
import { ago, when } from "@/lib/superadmin/directory";

/** The form keeps what was typed; numbers are read from it when needed. */
type Form = Record<Exclude<PlanField, "active">, string> & { active: boolean };

const formOf = (p: CataloguePlan): Form => ({
  perEventMinor: minorToInput(p.perEventMinor),
  annualMinor: minorToInput(p.annualMinor),
  perEventListMinor: minorToInput(p.perEventListMinor),
  annualListMinor: minorToInput(p.annualListMinor),
  active: p.active,
  seats: p.seats == null ? "" : String(p.seats),
  participants: p.participants == null ? "" : String(p.participants),
  eventsPerYear: p.eventsPerYear == null ? "" : String(p.eventsPerYear),
  storageGb: p.storageGb == null ? "" : String(p.storageGb),
});

/** A count box: empty is unlimited (null); anything but a whole number is NaN. */
function parseCount(raw: string): number | null {
  const s = raw.replace(/[\s,]/g, "");
  if (s === "") return null;
  return /^\d+$/.test(s) ? Number(s) : Number.NaN;
}

/** The form as the API's values, and the boxes that are not numbers. */
function valuesOf(form: Form) {
  const out: Record<PlanField, number | boolean | null> = {} as Record<PlanField, number | boolean | null>;
  const bad: PlanField[] = [];
  for (const k of PLAN_FIELDS) {
    if (k === "active") { out.active = form.active; continue; }
    const v = MONEY_FIELDS.includes(k) ? parseManat(form[k]) : parseCount(form[k]);
    if (v != null && Number.isNaN(v)) bad.push(k);
    out[k] = v;
  }
  return { values: out, bad };
}

/** How a field's value reads in the change list. */
function show(field: PlanField, v: unknown): string {
  if (field === "active") return v ? "On sale" : "Off sale";
  if (v == null) return MONEY_FIELDS.includes(field) ? "None" : "Unlimited";
  if (MONEY_FIELDS.includes(field)) return formatPriceMinor(Number(v));
  if (field === "storageGb") return `${Number(v).toLocaleString("en-US")} GB`;
  return Number(v).toLocaleString("en-US");
}

export function PlansEditor({ data, onSaved }: { data: PricingData | null; onSaved: () => void }) {
  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2" aria-busy="true">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[420px]" />)}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-3xl text-sm leading-relaxed" style={{ color: "var(--ink-2)" }}>
        Prices are in manat, before VAT. A change shows on the pricing page and in checkout at once; orders already placed keep
        their amount and the limits they were sold with, and issued invoices never change.
      </p>
      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
        {data.plans.filter((p) => !p.grantOnly).map((p) =>
          p.quoteOnly ? <QuotedPlan key={p.id} plan={p} /> : <PlanEditor key={`${p.id}-${p.updatedAt ?? ""}`} plan={p} campaigns={data.campaigns} onSaved={onSaved} />,
        )}
        {data.plans.filter((p) => p.grantOnly).map((p) => <CommunityPlan key={p.id} plan={p} />)}
      </div>
    </div>
  );
}

function QuotedPlan({ plan }: { plan: CataloguePlan }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>{plan.name}</h2>
        <Badge tone="neutral"><Lock size={11} /> Quoted</Badge>
      </div>
      <p className="mt-2 max-w-xl text-sm leading-relaxed" style={{ color: "var(--ink-2)" }}>
        Enterprise is quoted for each customer and has no list price: the pricing page shows “Custom” and its button goes to the
        contact form. Its limits are part of the quote, so there is nothing to set here.
      </p>
    </Card>
  );
}

/**
 * Community: free, never sold, granted by hand from an organisation's page
 * (Customers → the organisation → Grant Community). Its limits are what a
 * grant gives; the pricing page shows the card with an "Apply" button that
 * opens the contact form.
 */
function CommunityPlan({ plan }: { plan: CataloguePlan }) {
  const n = (v: number | null, unit = "") => (v == null ? "Unlimited" : `${v.toLocaleString("en-US")}${unit}`);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>{plan.name}</h2>
        <Badge tone="ok">Free · granted by you</Badge>
      </div>
      <p className="mt-2 max-w-xl text-sm leading-relaxed" style={{ color: "var(--ink-2)" }}>
        For student clubs and non-commercial university events. It is not sold: buyers apply through the contact form from the
        pricing page, and you grant it on the organisation&apos;s page (Customers → the organisation → Grant Community). It has
        Starter&apos;s modules.
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Events a year", n(plan.eventsPerYear)],
          ["Participants per event", n(plan.participants)],
          ["Organiser seats", n(plan.seats)],
          ["Storage", n(plan.storageGb, " GB")],
        ].map(([k, v]) => (
          <div key={k} className="rounded-[var(--radius-sm)] border px-3 py-2" style={{ borderColor: "var(--line)" }}>
            <dt className="text-[10px] font-medium uppercase tracking-[0.09em]" style={{ color: "var(--ink-3)" }}>{k}</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums" style={{ color: "var(--ink)" }}>{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function PlanEditor({ plan, campaigns, onSaved }: { plan: CataloguePlan; campaigns: PricingData["campaigns"]; onSaved: () => void }) {
  const [form, setForm] = useState<Form>(() => formOf(plan));
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [fieldError, setFieldError] = useState<Partial<Record<PlanField, string>>>({});

  const { values, bad } = useMemo(() => valuesOf(form), [form]);
  const before = useMemo(() => valuesOf(formOf(plan)).values, [plan]);
  const changes = PLAN_FIELDS.filter((k) => values[k] !== before[k]);
  const dirty = changes.length > 0;

  const perEvent = values.perEventMinor as number | null;
  const annual = values.annualMinor as number | null;
  const events = values.eventsPerYear as number | null;
  const rule = annualRule(perEvent, annual, events);
  const listProblems: Partial<Record<PlanField, string>> = {};
  for (const [list, price, key] of [
    [values.perEventListMinor, perEvent, "perEventListMinor"],
    [values.annualListMinor, annual, "annualListMinor"],
  ] as [number | null, number | null, PlanField][]) {
    if (list == null) continue;
    if (price == null) listProblems[key] = "There is no price to show it beside.";
    else if (list <= price) listProblems[key] = `Has to be above the price (${formatPriceMinor(price)}).`;
  }
  const needsPrice = form.active && perEvent == null && annual == null;
  const blocked = bad.length > 0 || rule.ok === false || Object.keys(listProblems).length > 0 || needsPrice;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setNotice(null);
    setFieldError((e) => ({ ...e, [k]: undefined }));
  };

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const body: Partial<Record<PlanField, number | boolean | null>> & { note?: string } = {};
      for (const k of changes) body[k] = values[k];
      if (note.trim()) body.note = note.trim();
      const r = await savePlan(plan.id, body);
      setConfirming(false);
      setNote("");
      setNotice({ tone: "ok", text: `Saved ${Object.keys(r.changes).length} change${Object.keys(r.changes).length === 1 ? "" : "s"}. The pricing page and checkout use the new values now.` });
      onSaved();
    } catch (err) {
      setConfirming(false);
      if (err instanceof ApiError && err.fieldErrors.length) {
        const next: Partial<Record<PlanField, string>> = {};
        for (const f of err.fieldErrors) next[f.field as PlanField] = f.message || "Check this field.";
        setFieldError(next);
      }
      setNotice({ tone: "danger", text: err instanceof ApiError ? err.summary || err.message : "The prices were not saved." });
    } finally {
      setSaving(false);
    }
  };

  const field = "min-h-10 w-full rounded-[var(--radius-sm)] border px-3 text-sm outline-none focus:border-[var(--accent)]";
  const fieldStyle = (problem?: string): React.CSSProperties => ({
    borderColor: problem ? "var(--danger)" : "var(--line-strong)",
    background: "var(--surface-sunken)",
    color: "var(--ink)",
    fontVariantNumeric: "tabular-nums",
  });
  const labelCls = "mb-1 block text-xs font-medium";

  const box = (k: Exclude<PlanField, "active">, opts: { prefix?: string; suffix?: string; placeholder?: string; hint?: string } = {}) => {
    const problem = fieldError[k] || listProblems[k] || (bad.includes(k) ? (MONEY_FIELDS.includes(k) ? "An amount in manat, e.g. 490 or 489.50." : "A whole number, or empty for unlimited.") : undefined);
    const changed = values[k] !== before[k];
    return (
      <div className="min-w-0">
        <label htmlFor={`${plan.id}-${k}`} className={labelCls} style={{ color: "var(--ink-2)" }}>
          {PLAN_FIELD_LABEL[k]}
          {changed ? <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: "var(--accent-solid)" }} aria-label="changed" /> : null}
        </label>
        <div className="relative">
          {opts.prefix ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--ink-3)" }}>{opts.prefix}</span> : null}
          <input
            id={`${plan.id}-${k}`}
            inputMode={MONEY_FIELDS.includes(k) ? "decimal" : "numeric"}
            value={form[k]}
            placeholder={opts.placeholder}
            onChange={(e) => set(k, e.target.value)}
            aria-invalid={problem ? true : undefined}
            className={`${field} ${opts.prefix ? "pl-7" : ""} ${opts.suffix ? "pr-10" : ""}`}
            style={fieldStyle(problem)}
          />
          {opts.suffix ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--ink-3)" }}>{opts.suffix}</span> : null}
        </div>
        {problem ? (
          <p className="mt-1 text-[11px] leading-snug" style={{ color: "var(--danger)" }}>{problem}</p>
        ) : opts.hint ? (
          <p className="mt-1 text-[11px] leading-snug" style={{ color: "var(--ink-3)" }}>{opts.hint}</p>
        ) : null}
      </div>
    );
  };

  return (
    <Card className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>{plan.name}</h2>
          <p className="mt-0.5 text-xs" style={{ color: "var(--ink-3)" }}>
            {plan.updatedAt
              ? <>Last changed <time dateTime={plan.updatedAt} title={when(plan.updatedAt)}>{ago(plan.updatedAt)}</time>{plan.updatedByName ? ` by ${plan.updatedByName}` : ""}</>
              : "The launch prices — not changed yet"}
          </p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
          <span className="relative inline-flex h-5 w-9 shrink-0 items-center">
            <input
              type="checkbox"
              role="switch"
              checked={form.active}
              onChange={(e) => set("active", e.target.checked)}
              className="peer sr-only"
            />
            <span className="absolute inset-0 rounded-full transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2" style={{ background: form.active ? "var(--ok)" : "var(--line-strong)" }} />
            <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform" style={{ transform: form.active ? "translateX(16px)" : "none" }} />
          </span>
          {form.active ? "On sale" : "Off sale"}
        </label>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        <div className="min-w-0">
          <fieldset>
            <legend className="mb-2 text-[10px] font-medium uppercase tracking-[0.09em]" style={{ color: "var(--ink-3)" }}>Prices</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {box("perEventMinor", { prefix: "₼", placeholder: "Not sold per event" })}
              {box("annualMinor", { prefix: "₼", placeholder: "Not sold annually" })}
              {box("perEventListMinor", { prefix: "₼", placeholder: "None", hint: "Optional, struck through beside the price." })}
              {box("annualListMinor", { prefix: "₼", placeholder: "None", hint: "Optional, struck through beside the price." })}
            </div>
          </fieldset>

          <AnnualCheck rule={rule} perEvent={perEvent} annual={annual} events={events} onFix={(minor) => set("annualMinor", minorToInput(minor))} />

          <fieldset className="mt-5">
            <legend className="mb-2 text-[10px] font-medium uppercase tracking-[0.09em]" style={{ color: "var(--ink-3)" }}>What an order grants</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {box("seats", { placeholder: "Unlimited" })}
              {box("participants", { placeholder: "Unlimited" })}
              {box("eventsPerYear", { placeholder: "Unlimited", hint: "Annual plan." })}
              {box("storageGb", { placeholder: "Unlimited", suffix: "GB" })}
            </div>
          </fieldset>
        </div>

        <Preview plan={plan} values={values} campaigns={campaigns} />
      </div>

      {needsPrice ? (
        <p className="mt-4 text-xs" style={{ color: "var(--danger)" }}>A plan on sale needs a price per event, per year or both. To stop selling it, switch it off.</p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4" style={{ borderColor: "var(--line)" }}>
        <Button variant="primary" icon={<Save size={15} />} disabled={!dirty || blocked || saving} onClick={() => setConfirming(true)}>
          Review and save
        </Button>
        {dirty ? (
          <Button variant="ghost" icon={<RotateCcw size={14} />} onClick={() => { setForm(formOf(plan)); setFieldError({}); setNotice(null); }}>
            Discard
          </Button>
        ) : null}
        {dirty && !blocked ? (
          <span className="text-xs" style={{ color: "var(--ink-3)" }}>{changes.length} unsaved change{changes.length === 1 ? "" : "s"}</span>
        ) : null}
        {notice ? (
          <p role={notice.tone === "danger" ? "alert" : "status"} className="w-full text-sm sm:w-auto" style={{ color: notice.tone === "danger" ? "var(--danger)" : "var(--ok)" }}>
            {notice.text}
          </p>
        ) : null}
      </div>

      <Modal
        open={confirming}
        onClose={() => (saving ? undefined : setConfirming(false))}
        title={`Save ${plan.name} prices?`}
        description="New orders use these at once. Orders already placed and issued invoices keep theirs."
        width={520}
        footer={
          <>
            <Button size="sm" onClick={() => setConfirming(false)} disabled={saving}>Cancel</Button>
            <Button size="sm" variant="primary" icon={<Check size={14} />} loading={saving} onClick={save}>Save {changes.length} change{changes.length === 1 ? "" : "s"}</Button>
          </>
        }
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left" style={{ borderColor: "var(--line)" }}>
              <th className="pb-2 text-xs font-medium" style={{ color: "var(--ink-3)" }}>What</th>
              <th className="pb-2 text-right text-xs font-medium" style={{ color: "var(--ink-3)" }}>Now</th>
              <th className="pb-2 text-right text-xs font-medium" style={{ color: "var(--ink-3)" }}>New</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((k) => (
              <tr key={k} className="border-b last:border-b-0" style={{ borderColor: "var(--line)" }}>
                <td className="py-2 pr-2" style={{ color: "var(--ink)" }}>{PLAN_FIELD_LABEL[k]}</td>
                <td className="py-2 text-right tabular-nums" style={{ color: "var(--ink-3)" }}><s>{show(k, before[k])}</s></td>
                <td className="py-2 text-right font-semibold tabular-nums" style={{ color: "var(--ink)" }}>{show(k, values[k])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <label htmlFor={`${plan.id}-note`} className="mt-4 block text-xs font-medium" style={{ color: "var(--ink-2)" }}>
          Note for the price history <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>(optional)</span>
        </label>
        <input
          id={`${plan.id}-note`}
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Autumn 2026 prices"
          className={`${field} mt-1`}
          style={fieldStyle()}
        />
      </Modal>
    </Card>
  );
}

/** The annual rule, as the owner types: green with the saving, red with the price that keeps it. */
function AnnualCheck({ rule, perEvent, annual, events, onFix }: {
  rule: ReturnType<typeof annualRule>;
  perEvent: number | null;
  annual: number | null;
  events: number | null;
  onFix: (minor: number) => void;
}) {
  if (rule.ok == null) {
    return (
      <p className="mt-3 rounded-[var(--radius-sm)] border px-3 py-2 text-xs" style={{ borderColor: "var(--line)", color: "var(--ink-3)" }}>
        {perEvent == null || annual == null
          ? "Sold on one period only, so there is no annual rule to check."
          : "Unlimited events a year: there is nothing to compare the annual price with."}
      </p>
    );
  }
  const oneByOne = rule.oneByOneMinor as number;
  // 20% under the events one by one, rounded down to a whole ten manat — the launch formula.
  const suggested = Math.floor((oneByOne * 0.8) / 1000) * 1000;
  return rule.ok ? (
    <p className="mt-3 flex items-start gap-2 rounded-[var(--radius-sm)] border px-3 py-2 text-xs leading-relaxed" style={{ borderColor: "var(--ok)", background: "var(--ok-weak)", color: "var(--ink)" }} role="status">
      <Check size={14} className="mt-0.5 shrink-0" style={{ color: "var(--ok)" }} />
      <span>
        A year ({formatPriceMinor(annual as number)}) {rule.savingPercent > 0 ? <>costs <strong>{rule.savingPercent}% less</strong> than</> : "costs the same as"} its {events} events
        bought one by one ({events} × {formatPriceMinor(perEvent as number)} = {formatPriceMinor(oneByOne)}).
      </span>
    </p>
  ) : (
    <div className="mt-3 rounded-[var(--radius-sm)] border px-3 py-2 text-xs leading-relaxed" style={{ borderColor: "var(--danger)", background: "var(--danger-weak)", color: "var(--ink)" }} role="alert">
      <p className="flex items-start gap-2">
        <TriangleAlert size={14} className="mt-0.5 shrink-0" style={{ color: "var(--danger)" }} />
        <span>
          A year ({formatPriceMinor(annual as number)}) would cost more than its {events} events bought one by one
          ({events} × {formatPriceMinor(perEvent as number)} = {formatPriceMinor(oneByOne)}). It cannot be saved like this.
        </span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2 pl-6">
        <Button size="sm" onClick={() => onFix(oneByOne)}>Set to {formatPriceMinor(oneByOne)}</Button>
        {suggested > 0 && suggested < oneByOne ? <Button size="sm" variant="ghost" onClick={() => onFix(suggested)}>Use {formatPriceMinor(suggested)} (about 20% off)</Button> : null}
      </div>
    </div>
  );
}

/** The card as the public pricing page draws it, from the values in the form. */
function Preview({ plan, values, campaigns }: { plan: CataloguePlan; values: Record<PlanField, number | boolean | null>; campaigns: PricingData["campaigns"] }) {
  const [annual, setAnnual] = useState(true);
  const period = annual ? "annual" : "per_event";
  const price = (annual ? values.annualMinor : values.perEventMinor) as number | null;
  const list = (annual ? values.annualListMinor : values.perEventListMinor) as number | null;
  const camp = bestCampaign(campaigns, plan.id, period, price);
  const shown = displayPrice(price, list, camp);
  const edu = bestCampaign(campaigns, plan.id, period, price, "education");
  const count = (v: unknown, unit: string) => (v == null ? "Unlimited" : `${Number(v).toLocaleString("en-US")}${unit}`);
  const onSale = Boolean(values.active);
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-[0.09em]" style={{ color: "var(--ink-3)" }}>On the pricing page</p>
        <div className="inline-flex rounded-full p-0.5 text-[11px] font-medium" style={{ background: "var(--tint)" }} role="group" aria-label="Preview period">
          {[false, true].map((a) => (
            <button
              key={String(a)}
              type="button"
              aria-pressed={annual === a}
              onClick={() => setAnnual(a)}
              className="rounded-full px-2.5 py-1"
              style={{ background: annual === a ? "var(--surface)" : "transparent", color: annual === a ? "var(--ink)" : "var(--ink-3)", boxShadow: annual === a ? "0 0 0 1px var(--line)" : "none" }}
            >
              {a ? "Annual" : "Per event"}
            </button>
          ))}
        </div>
      </div>
      <div
        className="rounded-[var(--hs-radius,14px)] border p-5"
        style={{ borderColor: "var(--hs-line)", background: "var(--hs-surface)", color: "var(--hs-ink)", opacity: onSale ? 1 : 0.85 }}
        aria-label={`${plan.name} as the pricing page shows it`}
      >
        <p className="text-base font-semibold" style={{ fontFamily: "var(--font-display)" }}>{plan.name}</p>
        {onSale && shown.campaign ? (
          <span className="mt-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: "var(--hs-brand-weak)", color: "var(--hs-brand)" }}>
            <BadgePercent size={11} /> {shown.campaign.name}: {discountValueText(shown.campaign)}
          </span>
        ) : null}
        <p className={`${onSale && shown.campaign ? "mt-1.5" : "mt-3"} flex flex-wrap items-baseline gap-x-2`}>
          <span className="text-2xl font-semibold tracking-[-0.02em]" style={{ fontFamily: "var(--font-display)" }}>
            {!onSale ? "Not on sale right now" : shown.nowMinor == null ? "Custom" : formatPriceMinor(shown.nowMinor)}
          </span>
          {onSale && shown.wasMinor != null && shown.nowMinor != null ? (
            <>
              <s className="text-sm" style={{ color: "var(--hs-ink-3)", fontVariantNumeric: "tabular-nums" }}>{formatPriceMinor(shown.wasMinor)}</s>
              <span className="text-[11px] font-semibold" style={{ color: "var(--hs-ok)" }}>Save {savingPercent(shown.wasMinor, shown.nowMinor)}%</span>
            </>
          ) : null}
        </p>
        <p className="text-xs" style={{ color: "var(--hs-ink-3)" }}>
          {!onSale ? "Its button goes to the contact form." : shown.nowMinor == null ? (annual ? "quoted annually" : "quoted per event") : annual ? "per year" : "per event"}
        </p>
        {onSale && edu ? (
          <p className="mt-1.5 text-[11px]" style={{ color: "var(--hs-ink-2)" }}>University or non-profit? {discountValueText(edu.campaign)}, after a check.</p>
        ) : null}
        <span
          className="mt-4 flex min-h-9 items-center justify-center rounded-[var(--hs-radius-sm,8px)] text-[13px] font-semibold"
          style={{ background: "var(--hs-brand-solid)", color: "#fff" }}
          aria-hidden="true"
        >
          {!onSale || shown.nowMinor == null ? "Talk to us" : `Choose ${plan.name}`}
        </span>
        <dl className="mt-4 space-y-1.5 border-t pt-3 text-xs" style={{ borderColor: "var(--hs-line)" }}>
          {[
            ["Events", annual ? (values.eventsPerYear == null ? "Unlimited" : `up to ${values.eventsPerYear} / year`) : "1"],
            ["Participants", values.participants == null ? "Unlimited" : `up to ${Number(values.participants).toLocaleString("en-US")} per event`],
            ["Organiser seats", count(values.seats, "")],
            ["Storage", count(values.storageGb, " GB")],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt style={{ color: "var(--hs-ink-3)" }}>{k}</dt>
              <dd className="text-right font-medium" style={{ fontVariantNumeric: "tabular-nums" }}>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="mt-2 text-[11px] leading-snug" style={{ color: "var(--ink-3)" }}>
        {campaigns.length ? "Campaigns running now are applied, as buyers see them." : "No campaign runs now. Start one under Discounts."}
      </p>
    </div>
  );
}
