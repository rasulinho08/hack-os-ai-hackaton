"use client";

import Image from "next/image";
import { useTranslation } from "@/contexts/LanguageContext";

export interface BrandLoaderProps {
  /** Logo box size in px */
  size?: number;
  /** Text under logo; `undefined` = i18n "Loading", `null` = no text */
  message?: string | null;
  /** Taller vertical area (e.g. full page block) */
  fullMinHeight?: boolean;
  className?: string;
  /** Skip ring + glow (minimal inline use) */
  minimal?: boolean;
}

export function BrandLoader({
  size = 72,
  message,
  fullMinHeight = true,
  className = "",
  minimal = false,
}: BrandLoaderProps) {
  const { t } = useTranslation();
  const label =
    message === undefined ? t("Loading") : message === null ? null : message;

  const ring = size + 36;

  const logoBox = (
    <div className="relative z-[1] animate-brand-loader rounded-2xl bg-white/[0.04] p-2 shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
      <Image
        src="/logo.svg"
        alt=""
        width={size}
        height={size}
        className="rounded-xl object-contain"
        priority
      />
    </div>
  );

  return (
    <div
      className={`flex flex-col items-center justify-center gap-5 ${
        fullMinHeight ? "min-h-[45vh] py-16" : "py-10"
      } ${className}`}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      {minimal ? (
        <div className="relative flex items-center justify-center">{logoBox}</div>
      ) : (
        <div
          className="relative flex items-center justify-center"
          style={{ width: ring, height: ring }}
        >
          <div
            className="pointer-events-none absolute rounded-full bg-[#E1003C]/25 blur-2xl animate-brand-loader-glow"
            style={{ width: ring, height: ring }}
          />
          <div
            className="pointer-events-none absolute rounded-full border-2 border-white/[0.08] border-t-[#E1003C] border-r-[#E1003C]/50 animate-spin-slow"
            style={{ width: ring, height: ring }}
          />
          {logoBox}
        </div>
      )}
      {label ? (
        <p className="max-w-xs text-center text-[15px] text-[var(--app-muted)]">{label}</p>
      ) : null}
    </div>
  );
}
