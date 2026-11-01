"use client";

/* ═══════════════════════════════════════════
   LanguageSwitcher — Dropdown selector
   ═══════════════════════════════════════════
   Shows current language with flag; opens a
   dropdown with all supported languages.
   Outside-click and Escape to close.
   ═══════════════════════════════════════════ */

import { useState, useRef, useEffect, useCallback } from "react";
import { Globe } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { LANGUAGES, type Lang } from "@/lib/i18n";

/** `compact`: the language name only on wide screens (the organiser header on tablets). */
export function LanguageSwitcher({ compact = false }: { compact?: boolean } = {}) {
  const { lang, setLang } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  /* ── Close on outside click ─────────────── */
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  /* ── Close on Escape ────────────────────── */
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const handleSelect = useCallback(
    (code: Lang) => {
      setLang(code);
      setOpen(false);
    },
    [setLang],
  );

  const current = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0];

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={current.label}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[13px] font-medium text-[var(--app-muted)] transition-all hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#E1003C]/50"
      >
        <Globe size={14} className="shrink-0 opacity-60" />
        <span className="text-[15px] leading-none">{current.flag}</span>
        <span className={compact ? "hidden xl:inline" : "hidden sm:inline"}>{current.label}</span>
        <svg
          className={`ml-0.5 h-3 w-3 opacity-50 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="listbox"
          aria-activedescendant={`lang-${lang}`}
          className="absolute right-0 z-50 mt-1.5 w-44 origin-top-right animate-fade-in-up rounded-xl border border-white/10 bg-[#1a1a1a] py-1 shadow-2xl backdrop-blur-lg"
        >
          {LANGUAGES.map((l) => {
            const active = lang === l.code;
            return (
              <button
                key={l.code}
                id={`lang-${l.code}`}
                role="option"
                aria-selected={active}
                onClick={() => handleSelect(l.code)}
                className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] transition-colors ${
                  active
                    ? "bg-[#E1003C]/10 font-semibold text-[#E1003C]"
                    : "text-[var(--app-muted)] hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                <span className="text-base leading-none">{l.flag}</span>
                <span className="flex-1">{l.label}</span>
                {active && (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#E1003C]" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
