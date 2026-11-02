/**
 * The legal pages: where they live, what they are called in each language,
 * and who operates the service.
 *
 * The operator's registered details come from NEXT_PUBLIC_LEGAL_NAME,
 * NEXT_PUBLIC_LEGAL_TAX_ID (VÖEN) and NEXT_PUBLIC_LEGAL_ADDRESS. Until they are
 * set the pages name the service only ("HackOS") and leave those lines out: a
 * policy with "[VÖEN]" in it reads worse than one without the line.
 */

import { CONTACT_EMAIL } from "@/lib/site";
import type { Lang } from "@/lib/i18n/types";

export type LegalPageId = "privacy" | "terms" | "cookies" | "refunds";

/**
 * The date every policy was last changed (ISO); each page also prints it in
 * its own language. It is also the version of the terms a buyer accepts at
 * checkout: the API's `src/constants/legal.js` (TERMS_VERSION) must say the
 * same, or the checkout is told the terms changed.
 */
export const LEGAL_UPDATED = "2026-10-23";

/** The four pages, in the order the footer lists them. */
export const LEGAL_LINKS: { id: LegalPageId; href: string; label: Record<Lang, string> }[] = [
  { id: "privacy", href: "/privacy", label: { en: "Privacy policy", az: "Məxfilik siyasəti", ru: "Политика конфиденциальности" } },
  { id: "terms", href: "/terms", label: { en: "Terms of use", az: "İstifadə şərtləri", ru: "Условия использования" } },
  { id: "cookies", href: "/cookies", label: { en: "Cookie policy", az: "Cookie siyasəti", ru: "Политика cookie" } },
  { id: "refunds", href: "/refunds", label: { en: "Refund policy", az: "Geri ödəmə siyasəti", ru: "Политика возврата средств" } },
];

/** A page's name in the reader's language (English when the language is unknown). */
export function legalLabel(id: LegalPageId, lang: string): string {
  const link = LEGAL_LINKS.find((l) => l.id === id);
  if (!link) return id;
  return link.label[lang as Lang] ?? link.label.en;
}

export interface LegalOperator {
  brand: string;
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  email: string;
  lastUpdated: string;
}

interface LegalEnv {
  NEXT_PUBLIC_LEGAL_NAME?: string;
  NEXT_PUBLIC_LEGAL_TAX_ID?: string;
  NEXT_PUBLIC_LEGAL_ADDRESS?: string;
}

const clean = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function legalOperator(env: LegalEnv): LegalOperator {
  return {
    brand: "HackOS",
    legalName: clean(env.NEXT_PUBLIC_LEGAL_NAME),
    taxId: clean(env.NEXT_PUBLIC_LEGAL_TAX_ID),
    address: clean(env.NEXT_PUBLIC_LEGAL_ADDRESS),
    email: CONTACT_EMAIL,
    lastUpdated: LEGAL_UPDATED,
  };
}

/* Each variable is read by its full name so Next inlines it into the browser bundle. */
export const LEGAL_OPERATOR = legalOperator({
  NEXT_PUBLIC_LEGAL_NAME: process.env.NEXT_PUBLIC_LEGAL_NAME,
  NEXT_PUBLIC_LEGAL_TAX_ID: process.env.NEXT_PUBLIC_LEGAL_TAX_ID,
  NEXT_PUBLIC_LEGAL_ADDRESS: process.env.NEXT_PUBLIC_LEGAL_ADDRESS,
});

const LINE_LABELS: Record<Lang, Record<"service" | "legalName" | "taxId" | "address" | "email", string>> = {
  en: { service: "Service", legalName: "Legal name", taxId: "Tax ID (VÖEN)", address: "Address", email: "E-mail" },
  az: { service: "Xidmət", legalName: "Hüquqi ad", taxId: "VÖEN", address: "Ünvan", email: "E-poçt" },
  ru: { service: "Сервис", legalName: "Юридическое название", taxId: "VÖEN (ИНН)", address: "Адрес", email: "E-mail" },
};

export interface OperatorLine {
  key: "service" | "legalName" | "taxId" | "address" | "email";
  label: string;
  value: string;
}

/** The operator's details as labelled lines; the registered ones only when they are set. */
export function operatorLines(op: LegalOperator, lang: string): OperatorLine[] {
  const labels = LINE_LABELS[lang as Lang] ?? LINE_LABELS.en;
  const lines: OperatorLine[] = [{ key: "service", label: labels.service, value: op.brand }];
  if (op.legalName) lines.push({ key: "legalName", label: labels.legalName, value: op.legalName });
  if (op.taxId) lines.push({ key: "taxId", label: labels.taxId, value: op.taxId });
  if (op.address) lines.push({ key: "address", label: labels.address, value: op.address });
  lines.push({ key: "email", label: labels.email, value: op.email });
  return lines;
}
