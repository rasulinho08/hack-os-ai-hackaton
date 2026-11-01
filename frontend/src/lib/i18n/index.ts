/* ═══════════════════════════════════════════
   i18n — Registry, Resolver & Helpers
   ═══════════════════════════════════════════
   ▸ Loads all translation maps
   ▸ Builds a reverse lookup (EN value → key)
     so developers can write t("Save") OR t("common.save")
   ▸ Resolves: current lang → EN fallback → raw key
   ▸ console.warn on missing translations (dev only)
   ═══════════════════════════════════════════ */

import type { Lang, TranslationMap } from "./types";
import coreEn from "./en";
import coreAz from "./az";
import coreRu from "./ru";
import builderEn from "./builder/en";
import builderAz from "./builder/az";
import builderRu from "./builder/ru";
import opsEn from "./ops/en";
import opsAz from "./ops/az";
import opsRu from "./ops/ru";
import judgingEn from "./judging/en";
import judgingAz from "./judging/az";
import judgingRu from "./judging/ru";
import resultsEn from "./results/en";
import resultsAz from "./results/az";
import resultsRu from "./results/ru";
import wrapupEn from "./wrapup/en";
import wrapupAz from "./wrapup/az";
import wrapupRu from "./wrapup/ru";
import votingEn from "./voting/en";
import votingAz from "./voting/az";
import votingRu from "./voting/ru";
import chatEn from "./chat/en";
import chatAz from "./chat/az";
import chatRu from "./chat/ru";
import notifyEn from "./notify/en";
import notifyAz from "./notify/az";
import notifyRu from "./notify/ru";
import platformEn from "./platform/en";
import platformAz from "./platform/az";
import platformRu from "./platform/ru";
import accountEn from "./account/en";
import accountAz from "./account/az";
import accountRu from "./account/ru";
import galleryEn from "./gallery/en";
import galleryAz from "./gallery/az";
import galleryRu from "./gallery/ru";
import checkinEn from "./checkin/en";
import checkinAz from "./checkin/az";
import checkinRu from "./checkin/ru";
import projectsEn from "./projects/en";
import projectsAz from "./projects/az";
import projectsRu from "./projects/ru";
import webhooksEn from "./webhooks/en";
import webhooksAz from "./webhooks/az";
import webhooksRu from "./webhooks/ru";
import profileEn from "./profile/en";
import profileAz from "./profile/az";
import profileRu from "./profile/ru";
import pricingEn from "./pricing/en";
import pricingAz from "./pricing/az";
import pricingRu from "./pricing/ru";
import invitesEn from "./invites/en";
import invitesAz from "./invites/az";
import invitesRu from "./invites/ru";

/* ── Translation registry ─────────────────── */
// The event builder and event page, running an event (announcements,
// Telegram, people, dashboards), judging, results and the stage, what comes
// after the event (certificates, archive, NPS), people's choice, the event
// chat, the bell with calendars and e-mail confirmation, the owner's notice,
// a customer's colleagues and invitations, the event's photo gallery, check-in
// at the door, the public projects page, the organisation's webhooks and a
// participant's hackathons and public profile, the organiser's invitations,
// and the prices and discounts on the pricing page and in checkout keep
// their strings in their own files; they are merged here so t() finds them
// like any other key.
const en: TranslationMap = { ...coreEn, ...builderEn, ...opsEn, ...judgingEn, ...resultsEn, ...wrapupEn, ...votingEn, ...chatEn, ...notifyEn, ...platformEn, ...accountEn, ...galleryEn, ...checkinEn, ...projectsEn, ...webhooksEn, ...profileEn, ...pricingEn, ...invitesEn };
const az: TranslationMap = { ...coreAz, ...builderAz, ...opsAz, ...judgingAz, ...resultsAz, ...wrapupAz, ...votingAz, ...chatAz, ...notifyAz, ...platformAz, ...accountAz, ...galleryAz, ...checkinAz, ...projectsAz, ...webhooksAz, ...profileAz, ...pricingAz, ...invitesAz };
const ru: TranslationMap = { ...coreRu, ...builderRu, ...opsRu, ...judgingRu, ...resultsRu, ...wrapupRu, ...votingRu, ...chatRu, ...notifyRu, ...platformRu, ...accountRu, ...galleryRu, ...checkinRu, ...projectsRu, ...webhooksRu, ...profileRu, ...pricingRu, ...invitesRu };

const registry: Record<Lang, TranslationMap> = { en, az, ru };

/* ── Reverse map: EN value → key ──────────── */
// Allows t("Save") to resolve by looking up the English value "Save"
// and finding which key it belongs to, then translating that key.

const reverseEn: Map<string, string> = new Map();
for (const [key, value] of Object.entries(en)) {
  // Map English VALUE → KEY (only store the first occurrence)
  if (!reverseEn.has(value)) {
    reverseEn.set(value, key);
  }
}

/* ── Warned set (avoid repeat console.warn) ── */
const warned = new Set<string>();

/* ── Core resolver ────────────────────────── */

/**
 * Resolve a translation.
 *
 * Resolution order:
 * 1. Direct key lookup in current language
 * 2. Reverse lookup: treat input as English text → find key → translate
 * 3. Fallback to English direct key
 * 4. Return raw input as-is (last resort)
 *
 * Logs console.warn in development when a key is missing.
 */
export function resolve(lang: Lang, keyOrText: string): string {
  if (keyOrText == null) return "";

  const dict = registry[lang];

  // 1) Direct key match in target language
  if (dict[keyOrText] !== undefined && dict[keyOrText] !== null) {
    return String(dict[keyOrText]);
  }

  // 2) Reverse lookup: maybe the dev wrote t("Save") — an English value
  const resolvedKey = reverseEn.get(keyOrText);
  if (resolvedKey && dict[resolvedKey] !== undefined && dict[resolvedKey] !== null) {
    return String(dict[resolvedKey]);
  }

  // 3) Fallback to English
  if (lang !== "en" && en[keyOrText] !== undefined && en[keyOrText] !== null) {
    return String(en[keyOrText]);
  }

  // 4) Return raw input — it's either an English phrase used as-is, or truly missing
  if (process.env.NODE_ENV === "development" && !warned.has(keyOrText)) {
    warned.add(keyOrText);
    console.warn(`[i18n] Missing translation: "${keyOrText}" for lang="${lang}"`);
  }

  return String(keyOrText);
}

/* ── Browser language auto-detection ──────── */

const LANG_KEY = "hh_lang";
const SUPPORTED: Lang[] = ["en", "az", "ru"];

/** Detect language: localStorage → navigator → "en" */
export function detectLang(): Lang {
  if (typeof window === "undefined") return "en";

  // 0) A link that names the language (?lang=az): e-mails about an event
  //    carry its language, so the page they open speaks it too. It becomes
  //    the saved preference; the switcher still changes it.
  const fromLink = langFromSearch(window.location.search);
  if (fromLink) {
    persistLang(fromLink);
    return fromLink;
  }

  // 1) Previously saved preference
  let saved: Lang | null = null;
  try { saved = localStorage.getItem(LANG_KEY) as Lang | null; } catch { /* storage blocked */ }
  if (saved && SUPPORTED.includes(saved)) return saved;

  // 2) Browser language (navigator.language = "az-AZ" → "az")
  const browserLang = navigator.language?.split("-")[0]?.toLowerCase() as Lang;
  if (SUPPORTED.includes(browserLang)) return browserLang;

  // 3) Default
  return "en";
}

/** The language a link names with ?lang=, when it is one the app speaks. */
export function langFromSearch(search: string): Lang | null {
  try {
    const v = new URLSearchParams(search).get("lang")?.trim().toLowerCase() as Lang | undefined;
    return v && SUPPORTED.includes(v) ? v : null;
  } catch {
    return null;
  }
}

/** Persist language choice */
export function persistLang(lang: Lang): void {
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
  }
}

/* ── Re-exports ───────────────────────────── */
export { SUPPORTED };
export type { Lang, TranslationMap } from "./types";
export { LANGUAGES } from "./types";
