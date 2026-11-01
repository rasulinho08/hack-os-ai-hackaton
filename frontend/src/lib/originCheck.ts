/**
 * Cross-site writes are refused before they reach the API.
 *
 * The session cookie is SameSite=Lax, which already keeps it off most
 * cross-site requests; this is the second lock. A request that changes
 * something (POST, PUT, PATCH, DELETE) and comes from a browser page on
 * another site is answered 403 here: the browser says where a request comes
 * from (Origin, Sec-Fetch-Site) and a page cannot forge either.
 *
 * Requests without those headers are not from a page (the API's own
 * server-side calls, scripts, Telegram's webhook) and pass; the API
 * authenticates them as before.
 */

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Written to by other servers, never by a page. */
const SERVER_TO_SERVER = new Set(["/api/telegram/webhook"]);

export interface RequestFacts {
  method: string;
  pathname: string;
  /** The Origin header, if any. */
  origin: string | null;
  /** The hosts this request was addressed to: Host and X-Forwarded-Host. */
  hosts: Array<string | null | undefined>;
  /** The Sec-Fetch-Site header, if any. */
  secFetchSite?: string | null;
}

const bare = (h: string) => h.trim().toLowerCase().replace(/\.$/, "");

/** True when this is a write from a page on another site. */
export function isCrossSiteWrite({ method, pathname, origin, hosts, secFetchSite }: RequestFacts): boolean {
  if (!UNSAFE.has(String(method).toUpperCase())) return false;
  if (SERVER_TO_SERVER.has(pathname)) return false;
  if (String(secFetchSite || "").toLowerCase() === "cross-site") return true;
  if (!origin) return false;
  // Sandboxed frames and file pages send "null".
  if (origin === "null") return true;
  let originHost: string;
  try {
    originHost = bare(new URL(origin).host);
  } catch {
    return true;
  }
  const own = hosts
    .flatMap((h) => String(h || "").split(","))
    .map(bare)
    .filter(Boolean);
  return !own.includes(originHost);
}
