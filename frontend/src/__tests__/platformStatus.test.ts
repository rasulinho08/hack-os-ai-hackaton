/**
 * The status page's reading of GET /api/public/status: a status is taken as
 * the API reports it (a 503's body included), anything else — no answer, a
 * proxy's error page — reads as "unreachable", and a background job's wait
 * is shown in the unit that fits it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchStatus, lagParts, normalizeStatus, unreachable } from "@/lib/platformStatus";

const AT = new Date("2026-10-19T12:00:00.000Z");

describe("normalizeStatus", () => {
  it("keeps what the API reports", () => {
    const s = normalizeStatus({
      status: "degraded",
      checks: { api: { state: "ok" }, database: { state: "ok", latencyMs: 2.4 }, jobs: { state: "degraded", lagSeconds: 420 }, mail: { state: "off" } },
      time: "2026-10-19T11:59:30.000Z",
      version: "941191f",
    }, AT);
    expect(s).toEqual({
      status: "degraded",
      checks: {
        api: { state: "ok", latencyMs: null, lagSeconds: null },
        database: { state: "ok", latencyMs: 2.4, lagSeconds: null },
        jobs: { state: "degraded", latencyMs: null, lagSeconds: 420 },
        mail: { state: "off", latencyMs: null, lagSeconds: null },
      },
      time: "2026-10-19T11:59:30.000Z",
      version: "941191f",
    });
  });

  it("reads anything that is not a status as unreachable, at the time of the attempt", () => {
    for (const bad of [null, undefined, "ok", {}, { status: "fine" }, { status: "unreachable" }]) {
      expect(normalizeStatus(bad, AT), JSON.stringify(bad)).toEqual(unreachable(AT));
    }
    expect(unreachable(AT)).toMatchObject({ status: "unreachable", time: AT.toISOString(), checks: { api: { state: "down" }, database: { state: "unknown" } } });
  });

  it("turns unknown states, bad numbers, times and versions into nothing rather than guesses", () => {
    const s = normalizeStatus({
      status: "ok",
      checks: { api: { state: "great" }, database: { state: "ok", latencyMs: -3 }, jobs: { state: "ok", lagSeconds: "12" } },
      time: "yesterday",
      version: "<script>",
    }, AT);
    expect(s.checks.api.state).toBe("unknown");
    expect(s.checks.database.latencyMs).toBeNull();
    expect(s.checks.jobs.lagSeconds).toBeNull();
    expect(s.checks.mail.state).toBe("unknown");
    expect(s.time).toBe(AT.toISOString());
    expect(s.version).toBeNull();
    expect(normalizeStatus({ status: "ok", version: "941191fabcdef" }, AT).version).toBe("941191f");
  });
});

describe("lagParts", () => {
  it("says no delay, seconds, or minutes", () => {
    expect(lagParts(null)).toBeNull();
    expect(lagParts(0)).toEqual({ unit: "none", n: 0 });
    expect(lagParts(14.6)).toEqual({ unit: "s", n: 15 });
    expect(lagParts(59)).toEqual({ unit: "s", n: 59 });
    expect(lagParts(60)).toEqual({ unit: "min", n: 1 });
    expect(lagParts(1830)).toEqual({ unit: "min", n: 31 });
  });
});

describe("fetchStatus", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the status from a 503 as well as from a 200", async () => {
    const body = { success: true, data: { status: "down", checks: { api: { state: "ok" }, database: { state: "down" } }, time: AT.toISOString(), version: null } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 503, headers: { "content-type": "application/json" } })));
    const s = await fetchStatus();
    expect(s.status).toBe("down");
    expect(s.checks.database.state).toBe("down");
  });

  it("is unreachable when the answer is not a status or there is none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } })));
    expect((await fetchStatus()).status).toBe("unreachable");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect((await fetchStatus()).status).toBe("unreachable");
  });
});
