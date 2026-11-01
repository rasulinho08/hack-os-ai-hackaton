"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { useTranslation } from "@/contexts/LanguageContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

/**
 * Shared frame for the public auth pages (sign in, forgot password, reset
 * password) so they all render with the same background, branding and card.
 */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-130 w-130 rounded-full bg-[#E1003C]/20 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-160 w-160 rounded-full bg-[#E1003C]/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(225,0,60,0.12),transparent_55%)]" />
      </div>

      <div className="absolute right-4 top-4 z-50">
        <LanguageSwitcher />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-md items-center px-4 py-12">
        <div className="w-full space-y-8">
          <div className="animate-fade-in-up flex items-center justify-center gap-3">
            <Image
              src="/logo.svg"
              alt="HackOS logo"
              width={48}
              height={48}
              className="rounded-xl bg-white/5 object-contain"
              priority
            />
            <div>
              <h1 className="text-xl font-bold text-white">
                {t("brand.platform_name")}
              </h1>
              <p className="mt-0.5 text-[13px] text-muted">{t("brand.event_year")}</p>
            </div>
          </div>

          <div className="animate-fade-in-up card-shadow glass rounded-2xl p-6 sm:p-7">
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            {subtitle ? (
              <p className="mt-1 text-[15px] text-muted">{subtitle}</p>
            ) : null}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Input styling shared by the auth forms. */
export const authInputClass =
  "h-11 w-full rounded-xl border border-white/10 bg-white/3 pl-10 pr-4 text-[15px] text-white placeholder-[#7a7a7a] outline-none focus:border-[#E1003C]/50";

export const authButtonClass =
  "inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#E1003C] text-[15px] font-semibold text-white transition-colors hover:bg-[#C00035] disabled:opacity-60";
