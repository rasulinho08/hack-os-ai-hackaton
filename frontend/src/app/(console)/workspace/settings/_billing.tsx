"use client";

/**
 * Settings → Billing and invoices: who bills, the account buyers pay into,
 * and whether VAT is charged.
 *
 * GET / PUT /api/owner/settings/billing. Everything here prints on the
 * invoice PDF and in the bank-transfer instructions (the approval e-mail, the
 * buyer's account). Until legal name, VÖEN, address, bank, IBAN and SWIFT are
 * all in, invoices say the bank details follow by e-mail and the overview
 * warns. The VAT switch is the one VAT line every page shows: off, "VAT not
 * charged (the seller is not VAT-registered)"; on, the rate is added at
 * checkout.
 */

import { useEffect, useMemo, useState } from "react";
import { Landmark, Save } from "lucide-react";
import { Badge, Button, Card, CardHeader, ErrorState, TableSkeleton } from "@/components/ds/primitives";
import { ApiError } from "@/lib/api";
import { BILLING_FIELD_LABEL, loadBillingSetting, saveBillingSetting, type BillingSetting } from "@/lib/superadmin/owner";

interface Form {
  legalName: string;
  taxId: string;
  address: string;
  email: string;
  bankName: string;
  accountHolder: string;
  iban: string;
  swift: string;
  vatRegistered: boolean;
  vatRatePercent: string;
}

const formOf = (b: BillingSetting | null): Form => ({
  legalName: b?.legalName ?? "",
  taxId: b?.taxId ?? "",
  address: b?.address ?? "",
  email: b?.email ?? "",
  bankName: b?.bankName ?? "",
  accountHolder: b?.accountHolder ?? "",
  iban: b?.ibanGrouped || b?.iban || "",
  swift: b?.swift ?? "",
  vatRegistered: Boolean(b?.vatRegistered),
  vatRatePercent: b?.vatRatePercent != null ? String(b.vatRatePercent) : "18",
});

const TEXT_FIELDS: { key: keyof Omit<Form, "vatRegistered" | "vatRatePercent">; label: string; hint?: string; wide?: boolean; rows?: number; mono?: boolean }[] = [
  { key: "legalName", label: "Legal name", hint: "As registered, e.g. “HackOS MMC”.", wide: true },
  { key: "taxId", label: "VÖEN", hint: "Ten digits.", mono: true },
  { key: "email", label: "Billing e-mail", hint: "Printed as the place for questions." },
  { key: "address", label: "Registered address", hint: "One line per row.", wide: true, rows: 3 },
  { key: "bankName", label: "Bank" },
  { key: "accountHolder", label: "Account holder", hint: "Empty: the legal name." },
  { key: "iban", label: "IBAN", hint: "Checked before it is saved.", mono: true },
  { key: "swift", label: "SWIFT / BIC", mono: true },
];

export function BillingSettings() {
  const [saved, setSaved] = useState<BillingSetting | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [form, setForm] = useState<Form>(formOf(null));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadBillingSetting()
      .then((b) => {
        if (cancelled) return;
        setSaved(b);
        setForm(formOf(b));
        setLoadError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load the billing details");
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const dirty = useMemo(() => saved !== undefined && JSON.stringify(form) !== JSON.stringify(formOf(saved ?? null)), [form, saved]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setNotice(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setNotice(null);
    try {
      const result = await saveBillingSetting({
        legalName: form.legalName,
        taxId: form.taxId,
        address: form.address,
        email: form.email,
        bankName: form.bankName,
        accountHolder: form.accountHolder,
        iban: form.iban,
        swift: form.swift,
        vatRegistered: form.vatRegistered,
        vatRatePercent: form.vatRegistered ? Number(form.vatRatePercent) : null,
      });
      setSaved(result);
      setForm(formOf(result));
      setNotice({ tone: "ok", text: result.ready ? "Saved. New invoices carry these details." : "Saved. Invoices still say the bank details follow by e-mail until the rest is filled in." });
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length) {
        const next: Record<string, string> = {};
        for (const f of err.fieldErrors) next[f.field] = f.message || "Check this field.";
        setErrors(next);
        setNotice({ tone: "danger", text: err.summary || "Some fields need attention." });
      } else {
        setNotice({ tone: "danger", text: err instanceof Error ? err.message : "The billing details were not saved." });
      }
    } finally {
      setSaving(false);
    }
  };

  const field = "w-full rounded-[var(--radius-sm)] border px-3 text-sm outline-none";
  const fieldStyle = (bad?: string): React.CSSProperties => ({
    borderColor: bad ? "var(--hs-danger)" : "var(--line-strong)",
    background: "var(--surface)",
    color: "var(--ink)",
  });
  const label = "mb-1 block text-xs font-medium";
  const labelStyle: React.CSSProperties = { color: "var(--hs-ink-2)" };

  if (loadError && saved === undefined) {
    return (
      <div className="mt-8">
        <ErrorState title="Could not load the billing details" body={loadError} onRetry={() => setNonce((n) => n + 1)} />
      </div>
    );
  }

  return (
    <section id="billing" className="mt-8 scroll-mt-24">
      {saved === undefined ? (
        <Card padded={false}>
          <TableSkeleton rows={4} cols={2} />
        </Card>
      ) : (
        <form onSubmit={save} noValidate>
          <Card>
            <CardHeader
              title={
                <span className="inline-flex items-center gap-2">
                  <Landmark size={15} aria-hidden="true" /> Billing and invoices
                </span>
              }
              hint="Who bills and where buyers pay. Printed on every invoice and in the bank-transfer instructions buyers receive when an order is approved."
              action={saved?.ready ? <Badge tone="ok" dot>Invoices can be paid</Badge> : <Badge tone="warn" dot>Details missing</Badge>}
            />
            {!saved?.ready && saved?.missing?.length ? (
              <p className="-mt-2 mb-4 text-xs" style={{ color: "var(--hs-warn)" }}>
                Missing: {saved.missing.map((m) => BILLING_FIELD_LABEL[m] ?? m).join(", ")}. Until then invoices say the bank details follow by e-mail.
              </p>
            ) : null}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {TEXT_FIELDS.map((f) => (
                <div key={f.key} className={f.wide ? "sm:col-span-2" : undefined}>
                  <label htmlFor={`bill-${f.key}`} className={label} style={labelStyle}>{f.label}</label>
                  {f.rows ? (
                    <textarea
                      id={`bill-${f.key}`}
                      rows={f.rows}
                      value={form[f.key]}
                      onChange={(e) => set(f.key, e.target.value)}
                      aria-invalid={Boolean(errors[f.key]) || undefined}
                      className={`${field} py-2 leading-relaxed`}
                      style={fieldStyle(errors[f.key])}
                    />
                  ) : (
                    <input
                      id={`bill-${f.key}`}
                      value={form[f.key]}
                      onChange={(e) => set(f.key, e.target.value)}
                      aria-invalid={Boolean(errors[f.key]) || undefined}
                      inputMode={f.key === "taxId" ? "numeric" : undefined}
                      className={`${field} min-h-10 ${f.mono ? "font-mono" : ""}`}
                      style={fieldStyle(errors[f.key])}
                    />
                  )}
                  {errors[f.key] ? (
                    <p className="mt-1 text-xs" style={{ color: "var(--hs-danger)" }}>{errors[f.key]}</p>
                  ) : f.hint ? (
                    <p className="mt-1 text-[11px]" style={{ color: "var(--hs-ink-3)" }}>{f.hint}</p>
                  ) : null}
                </div>
              ))}
            </div>

            <fieldset className="mt-5 border-t pt-4" style={{ borderColor: "var(--line)" }}>
              <legend className="sr-only">VAT</legend>
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" checked={form.vatRegistered} onChange={(e) => set("vatRegistered", e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--hs-brand)]" />
                <span className="text-sm" style={{ color: "var(--hs-ink)" }}>
                  VAT-registered (ƏDV ödəyicisi)
                  <span className="block text-xs" style={{ color: "var(--hs-ink-3)" }}>
                    Off: every page and invoice says “VAT not charged (the seller is not VAT-registered)”. On: the rate below is added to the plan price at checkout. Orders already placed keep what they were charged.
                  </span>
                </span>
              </label>
              {form.vatRegistered ? (
                <div className="mt-3 max-w-[10rem]">
                  <label htmlFor="bill-vat" className={label} style={labelStyle}>VAT rate, %</label>
                  <input
                    id="bill-vat"
                    inputMode="decimal"
                    value={form.vatRatePercent}
                    onChange={(e) => set("vatRatePercent", e.target.value)}
                    className={`${field} min-h-10`}
                    style={fieldStyle(errors.vatRatePercent)}
                  />
                  {errors.vatRatePercent ? <p className="mt-1 text-xs" style={{ color: "var(--hs-danger)" }}>{errors.vatRatePercent}</p> : null}
                </div>
              ) : null}
            </fieldset>
          </Card>

          <div className="sticky bottom-0 z-10 mt-4 flex flex-wrap items-center gap-3 border-t py-3" style={{ borderColor: "var(--hs-line)", background: "var(--hs-bg)" }}>
            <Button type="submit" variant="primary" icon={<Save size={15} />} loading={saving} disabled={saving || !dirty}>
              Save billing details
            </Button>
            {dirty ? (
              <Button type="button" variant="ghost" onClick={() => { setForm(formOf(saved ?? null)); setErrors({}); setNotice(null); }}>
                Discard changes
              </Button>
            ) : null}
            {notice ? (
              <p role={notice.tone === "danger" ? "alert" : "status"} className="text-sm" style={{ color: notice.tone === "danger" ? "var(--hs-danger)" : "var(--hs-ok)" }}>
                {notice.text}
              </p>
            ) : null}
          </div>
        </form>
      )}
    </section>
  );
}
