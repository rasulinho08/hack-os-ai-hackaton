/**
 * Single source of truth for the Express API origin.
 *
 * `next.config` rewrites and middleware (`fetchBackendSession`) must use the
 * same host; otherwise login returns 200 + a JWT cookie from server A while
 * `/api/auth/me` is validated on server B and the session never sticks.
 *
 * Accepts `NEXT_PUBLIC_API_URL` as either `http://host:port` or `http://host/api`
 * (with or without trailing slashes). Defaults to the local dev API; in
 * Docker / production always set NEXT_PUBLIC_API_URL explicitly
 * (e.g. http://api:5000 inside docker compose).
 */
const DEFAULT_BACKEND_ORIGIN = "http://localhost:5000";

export function getBackendOrigin(): string {
  const raw = (process.env.NEXT_PUBLIC_API_URL || "").trim();

  if (!raw) {
    /**
     * On a deployed build this is always a misconfiguration: falling back to
     * localhost makes every API call resolve to a private address, which the
     * host then refuses (Vercel answers DNS_HOSTNAME_RESOLVED_PRIVATE) and
     * the app looks broken for reasons the error never explains. Fail the
     * build instead so the missing variable is obvious.
     *
     * NEXT_PUBLIC_* values are inlined at build time, so setting the variable
     * after a deploy requires a redeploy — it is not picked up on restart.
     */
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "NEXT_PUBLIC_API_URL is not set. Point it at the API origin " +
          "(e.g. https://hackos-api.onrender.com) and redeploy.",
      );
    }
    return DEFAULT_BACKEND_ORIGIN;
  }

  return raw.replace(/\/+$/, "").replace(/\/api\/?$/i, "");
}
