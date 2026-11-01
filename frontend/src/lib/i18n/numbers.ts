/**
 * Numbers in the reader's language.
 *
 * Chromium ships ICU without Azerbaijani number data (as with dates, see
 * dates.ts): there Intl writes 1664 as "1,664", which an Azerbaijani reader
 * takes for a decimal comma. Azerbaijani is therefore written here — a dot
 * between thousands, a comma before decimals — from the parts Intl gives in
 * English; English and Russian go through Intl as they are.
 */

export interface NumberFormatter {
  format: (n: number) => string;
}

const AZ_PARTS: Partial<Record<Intl.NumberFormatPartTypes, string>> = { group: ".", decimal: "," };

export function numberFormatter(lang: string, options: Intl.NumberFormatOptions = {}): NumberFormatter {
  if (lang === "az") {
    const en = new Intl.NumberFormat("en-US", options);
    return { format: (n) => en.formatToParts(n).map((p) => AZ_PARTS[p.type] ?? p.value).join("") };
  }
  return new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-US", options);
}
