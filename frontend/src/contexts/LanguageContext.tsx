"use client";

/* ═══════════════════════════════════════════
   LanguageProvider + useTranslation hook
   ═══════════════════════════════════════════
   ▸ Auto-detects browser language on first visit
   ▸ Persists selection in localStorage
   ▸ t() supports both dotted keys AND raw English text:
       t("nav.dashboard") → "Dashboard" / "İdarə Paneli" / "Панель"
       t("Save")          → "Save" / "Saxla" / "Сохранить"
   ▸ console.warn on missing keys in dev mode
   ═══════════════════════════════════════════ */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { resolve, detectLang, persistLang, type Lang } from "@/lib/i18n";

/* ── Context shape ────────────────────────── */

interface I18nContext {
  /** Current language code */
  lang: Lang;
  /** Switch language (persists to localStorage) */
  setLang: (lang: Lang) => void;
  /**
   * Translate a key or raw English text.
   *
   * @example
   * t("nav.dashboard")  // dotted key
   * t("Save")           // raw English text (auto-resolved)
   * t("login.title")    // grouped key
   */
  t: (keyOrText: string) => string;
}

const Ctx = createContext<I18nContext>({
  lang: "en",
  setLang: () => {},
  t: (k) => k,
});

/* ── Provider ─────────────────────────────── */

export function LanguageProvider({ children }: { children: ReactNode }) {
  /*
   * Both the server and the first client render use "en".
   *
   * The lazy initializer used to call detectLang() during the first client
   * render, which meant the server sent English and the browser immediately
   * rendered Azerbaijani — a hydration mismatch on every translated string.
   * React logs it and throws away the server markup; on the statically
   * prerendered landing page that is the whole document.
   *
   * The stored language is applied in the effect below instead, so the first
   * paint matches the HTML and the switch happens a frame later. It also means
   * crawlers see real English content rather than an empty shell.
   */
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const detected = detectLang();
    if (detected !== lang) setLangState(detected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang =
        lang === "az" ? "az" : lang === "ru" ? "ru" : "en";
    }
  }, [lang]);

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
    persistLang(newLang);
  }, []);

  const t = useCallback(
    (keyOrText: string) => resolve(lang, keyOrText),
    [lang],
  );

  return (
    <Ctx.Provider value={{ lang, setLang, t }}>
      {children}
    </Ctx.Provider>
  );
}

/* ── Hook ─────────────────────────────────── */

/**
 * Access translation utilities.
 *
 * @example
 * const { t, lang, setLang } = useTranslation();
 * <h1>{t("nav.dashboard")}</h1>
 * <button>{t("Save")}</button>
 */
export function useTranslation() {
  return useContext(Ctx);
}

/* ── Re-export Lang type for convenience ──── */
export type { Lang } from "@/lib/i18n";
