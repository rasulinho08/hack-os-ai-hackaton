/**
 * The publish checklist in the organiser's words, and where each item leads.
 *
 * A date out of order (timeline_order) names the date that is out of place
 * and the date it clashes with, and which way: earlier than it must be, or
 * later. The sentence names both dates; the link goes to the field itself.
 */

import type { ChecklistItem } from "./types";

/** The id of a builder field's input, for links straight to it. */
export const fieldId = (field: string) => `bf-${field.replace(/[^a-z0-9_]/gi, "-")}`;

export function checklistText(item: ChecklistItem, t: (k: string) => string): string {
  const p = item.params || {};
  let key = `b.check.${item.code}`;
  if (item.code === "timeline_order" && p.other && (p.rel === "before" || p.rel === "after")) key = `b.check.timeline_${p.rel}`;
  let s = t(key);
  for (const [k, v] of Object.entries(p)) {
    s = s.split(`{${k}}`).join(k === "field" || k === "other" ? t(`b.when.${v}`) : String(v));
  }
  return s;
}

/** The field an item is about, when it is one field (so the link can focus it). */
export const checklistField = (item: ChecklistItem): string | null =>
  item.code === "timeline_order" && typeof item.params?.field === "string" ? item.params.field : null;

/**
 * A save the API refused because a date is out of order carries the same
 * reason (TIMELINE_BEFORE / TIMELINE_AFTER and the other date): the field
 * shows it in the organiser's language instead of the API's English.
 */
export function timelineErrorText(field: string, code: string | undefined, other: string | undefined, t: (k: string) => string): string | null {
  if (!other || (code !== "TIMELINE_BEFORE" && code !== "TIMELINE_AFTER")) return null;
  return checklistText({ severity: "error", section: "schedule", code: "timeline_order", params: { field, other, rel: code === "TIMELINE_BEFORE" ? "before" : "after" } }, t);
}
