"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Lock } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { AuthShell, authButtonClass, authInputClass } from "@/components/AuthShell";
import { apiPost, ApiError } from "@/lib/api";

export default function ResetPasswordClient() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const token = (searchParams.get("token") || "").trim();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError(t("auth.reset.mismatch"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await apiPost("/api/auth/reset-password", { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthShell title={t("auth.reset.title")}>
        <div className="mt-6 space-y-4">
          <p className="rounded-lg bg-[#FF3B30]/10 px-3 py-3 text-xs leading-relaxed text-[#FF3B30]">
            {t("auth.reset.missing_token")}
          </p>
          <Link
            href="/forgot-password"
            className="block text-center text-xs text-[#E1003C] hover:underline"
          >
            {t("auth.forgot.submit")}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={t("auth.reset.title")}
      subtitle={t("auth.reset.subtitle")}
    >
      {done ? (
        <div className="mt-6 space-y-4">
          <p className="rounded-lg bg-[#00C853]/10 px-3 py-3 text-xs leading-relaxed text-muted">
            {t("auth.reset.done")}
          </p>
          <Link href="/login" className={authButtonClass}>
            {t("auth.reset.go_login")} <ArrowRight size={16} />
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">
              {t("auth.reset.password")}
            </label>
            <div className="relative">
              <Lock
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                placeholder="••••••••"
                className={authInputClass}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-muted/80">
              {t("auth.reset.rule")}
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">
              {t("auth.reset.confirm")}
            </label>
            <div className="relative">
              <Lock
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  setError(null);
                }}
                placeholder="••••••••"
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
            {loading ? t("login.wait") : t("auth.reset.submit")}{" "}
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
