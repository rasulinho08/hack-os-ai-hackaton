/**
 * The builder's publish checklist in words and links: a date out of order
 * names both dates in each language and leads to the field; a refused save
 * says the same; a participant limit below the places taken asks first.
 */
import { describe, expect, it } from "vitest";
import { checklistField, checklistText, fieldId, timelineErrorText } from "@/lib/builder/checklist";
import { capacityChange } from "@/lib/builder/capacity";
import en from "@/lib/i18n/builder/en";
import az from "@/lib/i18n/builder/az";
import ru from "@/lib/i18n/builder/ru";
import type { ChecklistItem } from "@/lib/builder/types";

const tr = (map: Record<string, string>) => (k: string) => map[k] ?? k;
const item = (params: Record<string, string>): ChecklistItem => ({ severity: "error", section: "schedule", code: "timeline_order", params });

describe("dates out of order", () => {
  it("name the date and the date it clashes with, in every language", () => {
    const early = item({ field: "submission_deadline", other: "start_date", rel: "before" });
    expect(checklistText(early, tr(en))).toBe("The submission deadline can't be earlier than the event start.");
    expect(checklistText(item({ field: "registration_end", other: "end_date", rel: "after" }), tr(en))).toBe("The registration close can't be later than the event end.");
    for (const map of [en, az, ru]) {
      const s = checklistText(early, tr(map));
      expect(s).not.toMatch(/[{}]|b\.when\./);
      expect(s).toContain(map["b.when.submission_deadline"]);
      expect(s).toContain(map["b.when.start_date"]);
    }
  });

  it("every date the API can name has words", () => {
    const dates = ["start_date", "end_date", "registration_start", "registration_end", "team_deadline", "submission_deadline", "judging_start", "judging_end", "demo_day", "results_at"];
    for (const map of [en, az, ru]) for (const d of dates) expect(map[`b.when.${d}`], d).toBeTruthy();
  });

  it("lead to the field itself", () => {
    expect(checklistField(item({ field: "results_at", other: "submission_deadline", rel: "before" }))).toBe("results_at");
    expect(checklistField({ severity: "warning", section: "basics", code: "logo_missing" })).toBeNull();
    expect(fieldId("results_at")).toBe("bf-results_at");
  });

  it("an older checklist item without the other date still reads", () => {
    expect(checklistText(item({ field: "judging_end" }), tr(en))).toBe("A date is out of order: judging end.");
  });

  it("a refused save says the same sentence as the checklist", () => {
    expect(timelineErrorText("judging_start", "TIMELINE_BEFORE", "submission_deadline", tr(en))).toBe("The judging start can't be earlier than the submission deadline.");
    expect(timelineErrorText("judging_start", "TOO_LONG", "x", tr(en))).toBeNull();
  });
});

describe("participant limit", () => {
  it("below the people holding places needs a confirmation; nothing else does", () => {
    expect(capacityChange(2, 3)).toBe("confirm");
    expect(capacityChange(3, 3)).toBe("save");
    expect(capacityChange(120, 3)).toBe("save");
    expect(capacityChange(null, 30)).toBe("save");
  });
});
