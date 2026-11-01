/**
 * The security headers every page and API answer carries (next.config.ts).
 *
 * The Content Security Policy keeps the site to its own origin: scripts,
 * styles, fonts and requests come from here only (the API sits behind the
 * same origin through the rewrite), nothing can frame the site, and plugins
 * and foreign form targets are off. Images may come from any https host
 * because organisations and sponsors link their own logos.
 *
 * Scripts still allow inline code: the App Router writes its hydration data
 * inline, and a nonce would make every page render per request (no static
 * pages). What the policy does buy is that no script from another host runs,
 * whatever gets injected.
 */

export interface HeaderOptions {
  /** `next dev`: React Refresh needs eval and a websocket. */
  dev?: boolean;
  /** A Vercel preview: the preview toolbar loads from vercel.live. */
  preview?: boolean;
  /**
   * Served over https only (Vercel): requests are upgraded and HSTS is sent.
   * Off for `next start` on a plain-http machine, where upgrading would
   * break every asset.
   */
  https?: boolean;
}

export function contentSecurityPolicy({ dev = false, preview = false, https = !dev }: HeaderOptions = {}): string {
  const live = preview ? " https://vercel.live" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}${live}`,
    `style-src 'self' 'unsafe-inline'${live}`,
    "img-src 'self' data: blob: https:",
    `font-src 'self' data:${live}`,
    `connect-src 'self'${dev ? " ws: wss:" : ""}${preview ? " https://vercel.live wss://ws-us3.pusher.com" : ""}`,
    "media-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    `frame-src ${preview ? "https://vercel.live" : "'none'"}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(https && !dev ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

type Header = { key: string; value: string };

/**
 * The pages that read tickets with the camera (check-in at the door): the
 * only ones the camera is allowed on, and only for the site itself
 * (next.config.ts sends them their own Permissions-Policy after the pages').
 */
export const CAMERA_PAGES = ["/checkin/scan", "/volunteer/scan"] as const;

export function permissionsPolicy({ camera = false }: { camera?: boolean } = {}): string {
  return `camera=${camera ? "(self)" : "()"}, microphone=(), geolocation=(), payment=(), usb=()`;
}

/**
 * Pages get everything; API answers (JSON, PDFs, calendars, files) get the
 * plain headers only — the API sends its own policy, and a page policy on a
 * PDF can stop the browser's viewer.
 */
export function securityHeaders(opts: HeaderOptions = {}): Header[] {
  return [{ key: "Content-Security-Policy", value: contentSecurityPolicy(opts) }, ...baseHeaders(opts)];
}

export function baseHeaders(opts: HeaderOptions = {}): Header[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    // The old XSS filter is itself an attack surface; the CSP replaces it.
    { key: "X-XSS-Protection", value: "0" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: permissionsPolicy() },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    // Not includeSubDomains: a mail provider's tracking host under the
    // domain may be plain http.
    ...((opts.https ?? !opts.dev) && !opts.dev ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
  ];
}
