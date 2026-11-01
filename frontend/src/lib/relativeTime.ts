import type { Lang } from "@/lib/i18n/types";
import { formatRelative } from "@/lib/i18n/dates";

/** How long ago a moment was, in the reader's language ("5 minutes ago", "dünən"). */
export function formatRelativeTime(dateStr: string, lang: Lang): string {
  return formatRelative(dateStr, lang);
}
