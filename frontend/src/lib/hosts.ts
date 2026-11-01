/**
 * Where the marketing site ends and the product begins.
 *
 * In production the two live on different hosts: the landing page is served
 * from the apex domain and the app from `app.<domain>`. Locally there is only
 * one origin, so both env vars are unset and everything stays relative —
 * `npm run dev` behaves exactly as it did before any of this existed.
 *
 *   NEXT_PUBLIC_APP_ORIGIN   https://app.hack-os.app
 *   NEXT_PUBLIC_MARKETING_HOSTS   hack-os.app,www.hack-os.app
 *
 * Both are NEXT_PUBLIC_ on purpose. Neither is a secret — one is the site's own
 * domain list, the other its app origin — and only NEXT_PUBLIC_ values are
 * inlined into the Edge middleware bundle, where the host check runs.
 */

/** The configured app origin, or "" when there is none. */
export function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_ORIGIN || "").trim().replace(/\/+$/, "");
}

/** Absolute URL into the app, or a relative path when no app origin is set. */
export function appUrl(path = "/"): string {
  const origin = appOrigin();
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return origin ? `${origin}${suffix}` : suffix;
}

/**
 * Hosts that should serve the landing page instead of the app.
 * Empty when unconfigured, which switches host routing off entirely.
 */
export function marketingHosts(): string[] {
  return (process.env.NEXT_PUBLIC_MARKETING_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The public site's origin, for links people share (a public profile, the
 * directory): the first marketing host on this page's scheme and port, or
 * this page's own origin when none is configured. "" on the server.
 */
export function siteOrigin(): string {
  if (typeof window === "undefined") return "";
  const host = marketingHosts()[0];
  if (!host) return window.location.origin;
  const port = window.location.port ? `:${window.location.port}` : "";
  return `${window.location.protocol}//${host}${port}`;
}

/** Strips the port so `localhost:3000` and `example.com:443` compare cleanly. */
export function hostnameOf(hostHeader: string | null | undefined): string {
  return String(hostHeader || "").toLowerCase().split(":")[0];
}

export function isMarketingHost(hostHeader: string | null | undefined): boolean {
  const hosts = marketingHosts();
  if (hosts.length === 0) return false;
  return hosts.includes(hostnameOf(hostHeader));
}

/**
 * The owner console's own host (e.g. admin.hack-os.app), or "" when unset.
 * When set, the console is served only there; every other host answers 404
 * for its paths, so nobody finds it by typing /workspace on the main site.
 */
export function adminHost(): string {
  return (process.env.NEXT_PUBLIC_ADMIN_HOST || "").trim().toLowerCase();
}

export function isAdminHost(host: string | null): boolean {
  const configured = adminHost();
  if (!configured || !host) return false;
  return host.trim().toLowerCase().replace(/:\d+$/, "") === configured.replace(/:\d+$/, "");
}

/** Paths that belong to the owner console. */
export function isConsolePath(pathname: string): boolean {
  return pathname === "/workspace" || pathname.startsWith("/workspace/") || pathname === "/admin-login";
}
