"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { FaqContent } from "@/components/FaqContent";
import { useTranslation } from "@/contexts/LanguageContext";

export default function FaqPage() {
  const { t } = useTranslation();
  const [isLoggedIn] = useState(() =>
    typeof document !== "undefined" && document.cookie.includes("hh_role=")
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#111111]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-[520px] w-[520px] rounded-full bg-[#E1003C]/15 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-[640px] w-[640px] rounded-full bg-[#E1003C]/8 blur-3xl" />
      </div>

      <div className="absolute right-4 top-4 z-50">
        <LanguageSwitcher />
      </div>

      <div className="relative mx-auto max-w-2xl px-4 py-10 pb-16 pt-16">
        <Link
          href={isLoggedIn ? "/" : "/login"}
          className="mb-8 inline-flex items-center gap-2 text-xs font-medium text-[#b3b3b3] transition-colors hover:text-white"
        >
          <ArrowLeft size={14} />
          {isLoggedIn ? t("nav.dashboard") || "Back to Dashboard" : t("faq.back_login")}
        </Link>

        <div className="mb-8 flex items-center gap-3">
          <Image
            src="/logo.svg"
            alt=""
            width={40}
            height={40}
            className="rounded-lg bg-white/5 object-contain"
          />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-[#E1003C]">
              {t("brand.platform_name")}
            </p>
            <p className="text-[11px] text-[#7a7a7a]">{t("brand.event_year")}</p>
          </div>
        </div>

        <FaqContent />
      </div>
    </div>
  );
}
