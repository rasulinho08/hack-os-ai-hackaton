"use client";

/**
 * The card fields of the checkout.
 *
 * Validates like a real payment form — brand from the first digits, grouping,
 * Luhn checksum, expiry, CVC length — and reports upwards only whether the
 * card is valid, its brand and its last four digits. The number and the code
 * stay in this component's state and are never part of any request.
 */

import { useMemo, useState } from "react";
import { CreditCard, Lock } from "lucide-react";
import {
  BRAND_LABEL,
  type CardBrand,
  cardNumberValid,
  cvcLength,
  cvcValid,
  detectBrand,
  digitsOnly,
  expiryValid,
  formatCardNumber,
  formatExpiry,
} from "@/lib/card";
import { useTranslation } from "@/contexts/LanguageContext";

export interface CardSummary {
  valid: boolean;
  brand: CardBrand;
  last4: string;
}

function BrandMark({ brand }: { brand: CardBrand }) {
  if (brand === "mastercard") {
    return (
      <svg width="30" height="20" viewBox="0 0 30 20" aria-label="Mastercard" role="img">
        <circle cx="11" cy="10" r="7" fill="#EB001B" />
        <circle cx="19" cy="10" r="7" fill="#F79E1B" fillOpacity="0.9" />
      </svg>
    );
  }
  if (brand === "visa") {
    return (
      <span aria-label="Visa" className="text-[13px] font-extrabold italic tracking-tight" style={{ color: "#1A1F71" }}>
        VISA
      </span>
    );
  }
  if (brand === "other") return <CreditCard size={18} style={{ color: "var(--hs-ink-3)" }} aria-hidden="true" />;
  return (
    <span className="rounded px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide" style={{ background: "var(--hs-tint)", color: "var(--hs-ink-2)" }}>
      {BRAND_LABEL[brand]}
    </span>
  );
}

export function CardForm({ onChange }: { onChange: (card: CardSummary) => void }) {
  const { t } = useTranslation();
  const [number, setNumber] = useState("");
  const [holder, setHolder] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");
  const [touched, setTouched] = useState({ number: false, holder: false, expiry: false, cvc: false });

  const brand = detectBrand(number);
  const checks = useMemo(
    () => ({
      number: cardNumberValid(number),
      holder: holder.trim().length >= 2,
      expiry: expiryValid(expiry),
      cvc: cvcValid(cvc, brand),
    }),
    [number, holder, expiry, cvc, brand],
  );

  const report = (next: Partial<{ number: string; holder: string; expiry: string; cvc: string }>) => {
    const n = next.number ?? number;
    const h = next.holder ?? holder;
    const e = next.expiry ?? expiry;
    const c = next.cvc ?? cvc;
    const b = detectBrand(n);
    const d = digitsOnly(n);
    onChange({
      valid: cardNumberValid(n) && h.trim().length >= 2 && expiryValid(e) && cvcValid(c, b),
      brand: b,
      last4: d.slice(-4),
    });
  };

  const blur = (k: keyof typeof touched) => () => setTouched((x) => ({ ...x, [k]: true }));
  const showError = (k: keyof typeof touched) => touched[k] && !checks[k];

  const field =
    "min-h-12 w-full rounded-[12px] border px-3.5 text-[15px] outline-none transition-[border-color,box-shadow] duration-150 focus:border-[var(--hs-brand)] focus:shadow-[0_0_0_3px_var(--hs-brand-weak)]";
  const style = (k: keyof typeof touched): React.CSSProperties => ({
    borderColor: showError(k) ? "var(--hs-danger)" : "var(--hs-line-2)",
    background: "var(--hs-surface)",
    color: "var(--hs-ink)",
  });
  const label = "mb-1.5 block text-[13px] font-medium";
  const err = (k: keyof typeof touched, msg: string) =>
    showError(k) ? (
      <p className="mt-1.5 text-[12.5px]" style={{ color: "var(--hs-danger)" }} role="alert">
        {msg}
      </p>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor="cc-number" className={label} style={{ color: "var(--hs-ink-2)" }}>
          {t("checkout.pay.number")}
        </label>
        <div className="relative">
          <input
            id="cc-number"
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="1234 1234 1234 1234"
            value={number}
            onChange={(e) => {
              const v = formatCardNumber(e.target.value);
              setNumber(v);
              report({ number: v });
            }}
            onBlur={blur("number")}
            aria-invalid={showError("number")}
            className={`${field} pr-16 font-mono tracking-[0.04em]`}
            style={style("number")}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center">
            <BrandMark brand={brand} />
          </span>
        </div>
        {err("number", t("checkout.pay.err_number"))}
      </div>

      <div>
        <label htmlFor="cc-name" className={label} style={{ color: "var(--hs-ink-2)" }}>
          {t("checkout.pay.holder")}
        </label>
        <input
          id="cc-name"
          autoComplete="cc-name"
          value={holder}
          onChange={(e) => {
            setHolder(e.target.value);
            report({ holder: e.target.value });
          }}
          onBlur={blur("holder")}
          aria-invalid={showError("holder")}
          className={`${field} uppercase`}
          style={style("holder")}
        />
        {err("holder", t("checkout.pay.err_holder"))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="cc-exp" className={label} style={{ color: "var(--hs-ink-2)" }}>
            {t("checkout.pay.expiry")}
          </label>
          <input
            id="cc-exp"
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="MM / YY"
            value={expiry}
            onChange={(e) => {
              const v = formatExpiry(e.target.value);
              setExpiry(v);
              report({ expiry: v });
            }}
            onBlur={blur("expiry")}
            aria-invalid={showError("expiry")}
            className={`${field} font-mono`}
            style={style("expiry")}
          />
          {err("expiry", t("checkout.pay.err_expiry"))}
        </div>
        <div>
          <label htmlFor="cc-csc" className={label} style={{ color: "var(--hs-ink-2)" }}>
            {t("checkout.pay.cvc")}
          </label>
          <input
            id="cc-csc"
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder={brand === "amex" ? "1234" : "123"}
            maxLength={cvcLength(brand)}
            value={cvc}
            onChange={(e) => {
              const v = digitsOnly(e.target.value).slice(0, cvcLength(brand));
              setCvc(v);
              report({ cvc: v });
            }}
            onBlur={blur("cvc")}
            aria-invalid={showError("cvc")}
            className={`${field} font-mono`}
            style={style("cvc")}
          />
          {err("cvc", t("checkout.pay.err_cvc"))}
        </div>
      </div>

      <p className="flex items-start gap-2 text-[12px] leading-relaxed" style={{ color: "var(--hs-ink-3)" }}>
        <Lock size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        {t("checkout.pay.card_note")}
      </p>
    </div>
  );
}
