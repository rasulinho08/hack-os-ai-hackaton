"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Mail } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { AuthShell, authButtonClass, authInputClass } from "@/components/AuthShell";
import { apiPost, ApiError } from "@/lib/api";

interface ForgotResponse {
  /** Development convenience: returned only when SMTP is not configured. */
  resetUrl?: string;
}

export default function ForgotPasswordClient() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiPost<ForgotResponse | undefined>(
        "/api/auth/forgot-password",
        { email: email.trim() },
      );
      setSent(true);
      setDevUrl(res?.resetUrl ?? null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : t("common.error_generic"),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={t("auth.forgot.title")}
      subtitle={t("auth.forgot.subtitle")}
    >
      {sent ? (
        <div className="mt-6 space-y-4">
          <p className="rounded-lg bg-[#00C853]/10 px-3 py-3 text-xs leading-relaxed text-muted">
            {t("auth.forgot.sent")}
          </p>
          {devUrl ? (
            <p className="break-all rounded-lg bg-white/5 px-3 py-3 text-[11px] leading-relaxed text-muted">
              <span className="font-semibold text-white">Dev mode:</span>{" "}
              <a
                href={devUrl}
                className="text-[#E1003C] underline underline-offset-2"
              >
                {devUrl}
              </a>
            </p>
          ) : null}
          <Link
            href="/login"
            className="block text-center text-xs text-[#E1003C] hover:underline"
          >
            {t("auth.forgot.back")}
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">
              {t("login.email")}
            </label>
            <div className="relative">
              <Mail
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                placeholder="you@example.com"
                className={authInputClass}
              />
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-[#FF3B30]/10 px-3 py-2 text-xs text-[#FF3B30]">
              {error}
            </p>
          )}

          <button type="submit" disabled={loading} className={authButtonClass}>
            {loading ? t("login.wait") : t("auth.forgot.submit")}{" "}
            <ArrowRight size={16} />
          </button>

          <Link
            href="/login"
            className="block text-center text-xs text-muted transition-colors hover:text-[#E1003C] hover:underline"
          >
            {t("auth.forgot.back")}
          </Link>
        </form>
      )}
    </AuthShell>
  );
}
