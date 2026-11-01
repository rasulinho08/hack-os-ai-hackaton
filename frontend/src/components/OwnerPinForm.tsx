"use client";

/**
 * The platform owner's second step: a 6-digit code checked by the API
 * against SUPERADMIN_PIN (POST /api/auth/elevate). The code never lives in
 * this bundle; five wrong tries lock the form for 15 minutes server-side.
 */

import { useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import { ApiError, apiPost } from "@/lib/api";
import { useTranslation } from "@/contexts/LanguageContext";

export function OwnerPinForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/auth/elevate", { pin });
      onDone();
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      setError(status === 429 ? t("owner.pin_locked") : t("owner.pin_wrong"));
      setPin("");
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "rgba(225,0,60,0.12)", color: "#E1003C" }}>
          <KeyRound size={18} />
        </span>
        <div>
          <h2 className="text-base font-semibold" style={{ color: "var(--app-heading)" }}>{t("owner.pin_title")}</h2>
          <p className="text-[13px]" style={{ color: "var(--app-muted)" }}>{t("owner.pin_body")}</p>
        </div>
      </div>
      <input
        ref={inputRef}
        id="owner-pin"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        value={pin}
        onChange={(e) => {
          setPin(e.target.value.replace(/\D/g, "").slice(0, 6));
          setError(null);
        }}
        aria-label={t("owner.pin_title")}
        className="h-14 w-full rounded-xl border text-center font-mono text-2xl tracking-[0.5em] outline-none"
        style={{ background: "var(--app-surface-2)", borderColor: error ? "var(--app-danger)" : "var(--app-card-line)", color: "var(--app-heading)" }}
      />
      {error ? (
        <p role="alert" className="text-[13px]" style={{ color: "var(--app-danger)" }}>{error}</p>
      ) : null}
      <button
        type="submit"
        disabled={pin.length !== 6 || busy}
        className="h-11 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
        style={{ background: "#E1003C" }}
      >
        {t("owner.pin_submit")}
      </button>
    </form>
  );
}
