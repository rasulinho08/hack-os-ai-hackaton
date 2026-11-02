/**
 * The webhooks page's helpers: how an endpoint's health is named, which
 * words an API refusal gets, and the organisation in each call.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { HEALTH_TONE, WEBHOOK_EVENT_TYPES, errorField, errorKey, healthOf, prettyPayload, receivesAll, scoped } from "@/lib/webhooks";

const endpoint = (over: Partial<Parameters<typeof healthOf>[0]> = {}) => ({
  active: true, disabledReason: null, consecutiveFailures: 0, lastDeliveryStatus: null, ...over,
}) as Parameters<typeof healthOf>[0];

describe("healthOf", () => {
  it("names each state an endpoint can be in", () => {
    expect(healthOf(endpoint())).toBe("new");
    expect(healthOf(endpoint({ lastDeliveryStatus: "delivered" }))).toBe("ok");
    expect(healthOf(endpoint({ lastDeliveryStatus: "retrying" }))).toBe("retrying");
    expect(healthOf(endpoint({ lastDeliveryStatus: "failed" }))).toBe("failing");
    expect(healthOf(endpoint({ lastDeliveryStatus: "delivered", consecutiveFailures: 2 }))).toBe("failing");
    expect(healthOf(endpoint({ active: false, disabledReason: "failing", consecutiveFailures: 5 }))).toBe("off_failing");
    expect(healthOf(endpoint({ active: false, disabledReason: "manual", lastDeliveryStatus: "delivered" }))).toBe("off_manual");
    expect(healthOf(endpoint({ active: false, disabledReason: null }))).toBe("off_manual");
  });

  it("gives every state a tone", () => {
    for (const h of ["ok", "new", "retrying", "failing", "off_failing", "off_manual"] as const) expect(HEALTH_TONE[h]).toBeTruthy();
    expect(HEALTH_TONE.off_failing).toBe("danger");
    expect(HEALTH_TONE.ok).toBe("ok");
  });
});

describe("errorKey and errorField", () => {
  it("prefer the code of the refused field", () => {
    const err = new ApiError("Validation failed: url: The URL must start with https://.", 400, [{ field: "url", message: "The URL must start with https://.", code: "URL_NOT_HTTPS" }], "VALIDATION_ERROR");
    expect(errorKey(err)).toBe("wh.code.URL_NOT_HTTPS");
    expect(errorField(err)).toBe("url");
  });

  it("know the answers the page words itself", () => {
    expect(errorKey(new ApiError("x", 409, [], "TOO_MANY_ENDPOINTS"))).toBe("wh.err.TOO_MANY_ENDPOINTS");
    expect(errorKey(new ApiError("x", 409, [], "DELIVERY_PENDING"))).toBe("wh.err.DELIVERY_PENDING");
    expect(errorKey(new ApiError("Too many", 429))).toBe("wh.err.RATE_LIMITED");
    expect(errorKey(new ApiError("x", 400, [{ field: "description", code: "TOO_LONG", max: 200 }], "VALIDATION_ERROR"))).toBe("wh.code.TOO_LONG");
  });

  it("leave anything else to the generic sentence", () => {
    expect(errorKey(new ApiError("boom", 500))).toBeNull();
    expect(errorKey(new Error("offline"))).toBeNull();
    expect(errorKey(new ApiError("x", 400, [{ field: "url", code: "SOMETHING_NEW" }], "VALIDATION_ERROR"))).toBeNull();
    expect(errorField(new Error("offline"))).toBeNull();
    expect(errorField(new ApiError("x", 400, [{ field: "(root)", message: "y" }]))).toBeNull();
  });
});

describe("scoped", () => {
  it("names the organisation only when one was picked", () => {
    expect(scoped("/api/account/webhooks", null)).toBe("/api/account/webhooks");
    expect(scoped("/api/account/webhooks", 12)).toBe("/api/account/webhooks?customerId=12");
    expect(scoped("/api/account/webhooks/3/deliveries", 12, { limit: 20, before: null })).toBe("/api/account/webhooks/3/deliveries?customerId=12&limit=20");
    expect(scoped("/api/account/webhooks/3/deliveries", null, { limit: 5, before: 99 })).toBe("/api/account/webhooks/3/deliveries?limit=5&before=99");
  });
});

describe("the rest", () => {
  it("knows an endpoint that receives everything", () => {
    expect(receivesAll(["*"])).toBe(true);
    expect(receivesAll(["registration.created"])).toBe(false);
  });

  it("lists the event types in the API's order", () => {
    expect(WEBHOOK_EVENT_TYPES).toEqual([
      "registration.created", "participant.approved", "participant.rejected", "team.created",
      "submission.created", "results.published", "certificate.issued", "event.published",
    ]);
  });

  it("indents a payload for reading and survives one that is not JSON", () => {
    expect(prettyPayload({ id: "a", data: { n: 1 } })).toBe('{\n  "id": "a",\n  "data": {\n    "n": 1\n  }\n}');
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(prettyPayload(loop)).toBe("[object Object]");
  });
});
