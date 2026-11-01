"use client";

import { useTranslation } from "@/contexts/LanguageContext";

/** Must match keys faq.q1…faq.qN and faq.a1…faq.aN in i18n. */
export const FAQ_ITEM_COUNT = 10;

export function FaqContent() {
  const { t } = useTranslation();
  const items = Array.from({ length: FAQ_ITEM_COUNT }, (_, i) => i + 1);

  return (
    <div className="space-y-3">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">{t("faq.title")}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[var(--app-muted)]">
          {t("faq.subtitle")}
        </p>
      </div>
      <div className="space-y-2">
        {items.map((n) => (
          <details
            key={n}
            className="group card-shadow overflow-hidden rounded-xl border border-white/5 bg-[var(--app-surface)] open:border-[#E1003C]/20"
          >
            <summary className="cursor-pointer list-none px-4 py-3 text-[15px] font-medium text-white transition-colors hover:bg-white/[0.04] [&::-webkit-details-marker]:hidden">
              <span className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-[#E1003C]">Q{n}.</span>
                <span>{t(`faq.q${n}`)}</span>
              </span>
            </summary>
            <div className="border-t border-white/[0.06] px-4 pb-4 pt-2 text-[13px] leading-relaxed text-[var(--app-muted)]">
              {t(`faq.a${n}`)}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
