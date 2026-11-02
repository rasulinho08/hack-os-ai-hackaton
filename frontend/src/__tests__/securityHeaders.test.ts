/**
 * The security headers and the cross-site write check (middleware).
 */
import { describe, expect, it } from "vitest";
import { baseHeaders, contentSecurityPolicy, securityHeaders } from "@/lib/securityHeaders";
import { isCrossSiteWrite } from "@/lib/originCheck";

const header = (list: { key: string; value: string }[], key: string) => list.find((h) => h.key === key)?.value;

describe("content security policy", () => {
  it("keeps production pages to their own origin", () => {
    const csp = contentSecurityPolicy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("connect-src 'self';");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("vercel.live");
    expect(csp).toContain("upgrade-insecure-requests");
  });
  it("lets development and previews do what they need", () => {
    expect(contentSecurityPolicy({ dev: true })).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy({ dev: true })).toContain("ws:");
    expect(contentSecurityPolicy({ dev: true })).not.toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy({ preview: true })).toContain("https://vercel.live");
  });
  it("pages carry the policy, API answers do not", () => {
    expect(header(securityHeaders(), "Content-Security-Policy")).toBeTruthy();
    expect(header(baseHeaders(), "Content-Security-Policy")).toBeUndefined();
    expect(header(baseHeaders(), "X-Content-Type-Options")).toBe("nosniff");
    expect(header(baseHeaders(), "X-Frame-Options")).toBe("DENY");
    expect(header(baseHeaders(), "Strict-Transport-Security")).toBe("max-age=31536000");
    expect(header(baseHeaders({ dev: true }), "Strict-Transport-Security")).toBeUndefined();
    expect(header(baseHeaders({ https: false }), "Strict-Transport-Security")).toBeUndefined();
    expect(contentSecurityPolicy({ https: false })).not.toContain("upgrade-insecure-requests");
  });
});

describe("cross-site writes", () => {
  const base = { method: "POST", pathname: "/api/teams", hosts: ["app.hack-os.app"] };
  it("lets the site's own pages write", () => {
    expect(isCrossSiteWrite({ ...base, origin: "https://app.hack-os.app", secFetchSite: "same-origin" })).toBe(false);
    expect(isCrossSiteWrite({ ...base, origin: "https://APP.hack-os.app" })).toBe(false);
    expect(isCrossSiteWrite({ ...base, hosts: ["internal:3000", "app.hack-os.app"], origin: "https://app.hack-os.app" })).toBe(false);
  });
  it("refuses a page on another site", () => {
    expect(isCrossSiteWrite({ ...base, origin: "https://evil.example" })).toBe(true);
    expect(isCrossSiteWrite({ ...base, origin: "https://app.hack-os.app.evil.example" })).toBe(true);
    expect(isCrossSiteWrite({ ...base, origin: "null" })).toBe(true);
    expect(isCrossSiteWrite({ ...base, origin: null, secFetchSite: "cross-site" })).toBe(true);
    expect(isCrossSiteWrite({ ...base, method: "DELETE", origin: "https://hack-os.app" })).toBe(true);
  });
  it("leaves reads, server calls and the Telegram webhook alone", () => {
    expect(isCrossSiteWrite({ ...base, method: "GET", origin: "https://evil.example" })).toBe(false);
    expect(isCrossSiteWrite({ ...base, origin: null })).toBe(false);
    expect(isCrossSiteWrite({ ...base, pathname: "/api/telegram/webhook", origin: "https://evil.example" })).toBe(false);
  });
});
