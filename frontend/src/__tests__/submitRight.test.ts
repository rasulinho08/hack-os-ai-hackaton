/**
 * Who may hand in a team's project, as GET /api/teams/mine says it: the
 * approved lead, or an approved member while the lead is not an approved
 * participant. Before, the pages let the lead alone, so a team whose lead
 * was pending or rejected could not hand in at all.
 */
import { describe, expect, it } from "vitest";
import { submitRight } from "@/lib/teamNormalize";

describe("submitRight", () => {
  it("lets an approved member hand in while the lead is not approved", () => {
    expect(submitRight({ id: 3, can_submit: true, submit_as_lead: false }, false)).toBe("member");
    expect(submitRight({ team: { id: 3, can_submit: true, submit_as_lead: false } }, false)).toBe("member");
  });

  it("is the lead's when the lead is approved, and nobody else's", () => {
    expect(submitRight({ id: 3, can_submit: true, submit_as_lead: true }, true)).toBe("lead");
    expect(submitRight({ id: 3, can_submit: false, submit_as_lead: false }, false)).toBe("none");
    expect(submitRight({ id: 3, can_submit: false, submit_as_lead: false }, true)).toBe("none");
  });

  it("falls back to the lead alone with an older API", () => {
    expect(submitRight({ id: 3 }, true)).toBe("lead");
    expect(submitRight({ id: 3 }, false)).toBe("none");
    expect(submitRight(null, false)).toBe("none");
  });
});
