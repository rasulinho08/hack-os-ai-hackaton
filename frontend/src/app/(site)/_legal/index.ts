import type { Lang } from "@/lib/i18n/types";
import type { LegalPageId } from "@/lib/legal";
import { COOKIES } from "./cookies";
import { PRIVACY } from "./privacy";
import { REFUNDS } from "./refunds";
import { TERMS } from "./terms";
import type { LegalDocSet, LegalUi } from "./types";

export const LEGAL_DOCS: Record<LegalPageId, LegalDocSet> = {
  privacy: PRIVACY,
  terms: TERMS,
  cookies: COOKIES,
  refunds: REFUNDS,
};

export const LEGAL_UI: Record<Lang, LegalUi> = {
  en: { eyebrow: "Legal", updated: "Last updated", onThisPage: "On this page", questions: "Questions?", related: "Other policies" },
  az: { eyebrow: "Hüquqi məlumat", updated: "Son yenilənmə", onThisPage: "Bu səhifədə", questions: "Sualınız var?", related: "Digər sənədlər" },
  ru: { eyebrow: "Правовая информация", updated: "Последнее обновление", onThisPage: "На этой странице", questions: "Остались вопросы?", related: "Другие документы" },
};
