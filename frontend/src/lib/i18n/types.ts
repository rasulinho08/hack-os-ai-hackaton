/* ═══════════════════════════════════════════
   i18n — Core Types
   ═══════════════════════════════════════════ */

/** Supported languages */
export type Lang = "en" | "az" | "ru";

/** Flat dictionary: dotted keys → translated strings */
export type TranslationMap = Record<string, string>;

/** Language metadata for the switcher UI */
export interface LangMeta {
  code: Lang;
  label: string;
  flag: string;
  dir: "ltr" | "rtl";
}

/** All available languages with metadata */
export const LANGUAGES: LangMeta[] = [
  { code: "en", label: "English", flag: "ENG", dir: "ltr" },
  { code: "az", label: "Azərbaycan", flag: "🇦🇿", dir: "ltr" },
  { code: "ru", label: "Русский", flag: "🇷🇺", dir: "ltr" },
];
