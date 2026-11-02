/**
 * The platform's public status (GET /api/public/status), for the /status
 * page: whether the API, the database, the background jobs and e-mail work.
 * The API keeps its answer 30 seconds and says 503 while it is down (the body
 * still carries the status); the page asks again every minute.
 *
 * Anything that is not a status — no answer, a proxy's error page — reads as
 * "unreachable": from where the visitor sits, the service did not answer.
 */

export type Overall = "ok" | "degraded" | "down" | "unreachable";
export type CheckState = "ok" | "degraded" | "down" | "off" | "unknown";
export const CHECK_KEYS = ["api", "database", "jobs", "mail"] as const;
export type CheckKey = (typeof CHECK_KEYS)[number];

export interface Check {
  state: CheckState;
  latencyMs: number | null;
  lagSeconds: number | null;
}

export interface PlatformStatus {
  status: Overall;
  checks: Record<CheckKey, Check>;
  /** When the check ran (ISO). */
  time: string;
  version: string | null;
}

export const STATUS_PATH = "/api/public/status";
export const STATUS_REFRESH_MS = 60_000;

const OVERALL = ["ok", "degraded", "down"] as const;
const STATES: readonly CheckState[] = ["ok", "degraded", "down", "off", "unknown"];

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** What the page says when the API gave no status at all. */
export function unreachable(at: Date = new Date()): PlatformStatus {
  const unknown: Check = { state: "unknown", latencyMs: null, lagSeconds: null };
  return {
    status: "unreachable",
    checks: { api: { ...unknown, state: "down" }, database: unknown, jobs: unknown, mail: unknown },
    time: at.toISOString(),
    version: null,
  };
}

export function normalizeStatus(v: unknown, at: Date = new Date()): PlatformStatus {
  const o = obj(v);
  const status = OVERALL.find((s) => s === o.status);
  if (!status) return unreachable(at);
  const checks = obj(o.checks);
  const check = (k: CheckKey): Check => {
    const c = obj(checks[k]);
    const state = STATES.find((s) => s === c.state) ?? "unknown";
    return { state, latencyMs: num(c.latencyMs), lagSeconds: num(c.lagSeconds) };
  };
  const time = typeof o.time === "string" && !Number.isNaN(Date.parse(o.time)) ? o.time : at.toISOString();
  const version = typeof o.version === "string" && /^[0-9a-f]{7,40}$/i.test(o.version) ? o.version.slice(0, 7) : null;
  return {
    status,
    checks: { api: check("api"), database: check("database"), jobs: check("jobs"), mail: check("mail") },
    time,
    version,
  };
}

/** The status, read in the browser through the site's own origin. */
export async function fetchStatus(timeoutMs = 10_000): Promise<PlatformStatus> {
  try {
    const res = await fetch(STATUS_PATH, { cache: "no-store", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    const json = (await res.json().catch(() => null)) as { data?: unknown } | null;
    return normalizeStatus(json?.data);
  } catch {
    return unreachable();
  }
}

/** How long the oldest due background job has waited, in the unit the page shows it in. */
export function lagParts(lagSeconds: number | null): { unit: "none" | "s" | "min"; n: number } | null {
  if (lagSeconds == null) return null;
  if (lagSeconds < 1) return { unit: "none", n: 0 };
  if (lagSeconds < 60) return { unit: "s", n: Math.round(lagSeconds) };
  return { unit: "min", n: Math.round(lagSeconds / 60) };
}
