import type { Lang } from "@/lib/i18n/types";

/**
 * One legal page in one language. Text may contain `{email}`, which the page
 * shows as the contact address (a mailto link).
 */
export type LegalBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };

export interface LegalSection {
  /** Anchor id, the same in every language. */
  id: string;
  title: string;
  blocks: LegalBlock[];
  /** Print the operator's details (service, legal name, VÖEN, address, e-mail) under the section. */
  operator?: boolean;
}

export interface LegalDoc {
  title: string;
  summary: string;
  /** "19 October 2026", written out in the page's language. */
  updated: string;
  sections: LegalSection[];
}

export type LegalDocSet = Record<Lang, LegalDoc>;

/** The words around the documents. */
export interface LegalUi {
  eyebrow: string;
  updated: string;
  onThisPage: string;
  questions: string;
  related: string;
}
