/**
 * The pages the middleware lets through without a session.
 *
 * Regression for the production incident where /signup and /invite/<token>
 * were missing from the list and every new customer was bounced to /login.
 */
import { describe, expect, it } from "vitest";
import { isPublicPagePath } from "@/lib/publicPaths";

describe("isPublicPagePath", () => {
  it.each([
    "/login", "/signin", "/signup", "/signup/", "/invite/abc123", "/forgot-password",
    "/reset-password", "/welcome", "/faq", "/demo", "/demo/participants", "/platform",
    "/solutions", "/pricing", "/security", "/contact", "/account", "/account/team",
    "/checkout", "/join/HBTN2026", "/favicon.ico", "/robots.txt", "/sitemap.xml",
    "/e/baku-ai-hackathon", "/e/baku-ai-hackathon/register", "/e/baku-ai-hackathon/opengraph-image",
    "/verify/ABCD-EFGH-JKLM", "/verify-email", "/stories", "/stories/azcon-future-tech-2026",
    "/privacy", "/terms", "/cookies", "/refunds", "/status", "/e/baku-ai-hackathon/projects",
    "/hackathons", "/u/aysel-memmedova",
  ])("lets %s through without a session", (path) => {
    expect(isPublicPagePath(path)).toBe(true);
  });

  it.each([
    "/", "/participants", "/teams", "/settings", "/hacker", "/hacker/team", "/judge",
    "/mentor", "/volunteer", "/workspace", "/workspace/orders", "/create-event",
    "/signupx", "/invitee", "/joined", "/create-event/12", "/events", "/edit-event",
    "/verify", "/verifyx", "/certificates", "/hacker/results", "/verify-emailx", "/verify-email/abc",
    "/storiesx", "/privacyx", "/gallery", "/statusx", "/results", "/hackathonsx", "/hacker/hackathons", "/users",
  ])("keeps %s behind the session check", (path) => {
    expect(isPublicPagePath(path)).toBe(false);
  });
});

describe("public API routes for visitors without an account", () => {
  it("lets the home page's figures through, and no longer the retired stories", async () => {
    const { isPublicApiRoute } = await import("@/lib/backendAuth");
    expect(isPublicApiRoute("/api/public/stats", "GET")).toBe(true);
    expect(isPublicApiRoute("/api/public/stats", "POST")).toBe(false);
    expect(isPublicApiRoute("/api/public/showcase", "GET")).toBe(false);
    expect(isPublicApiRoute("/api/public/showcase/azcon-future-tech-2026", "GET")).toBe(false);
    expect(isPublicApiRoute("/api/owner/showcase", "GET")).toBe(false);
  });


  it("lets the contact form and the price list through, nothing else new", async () => {
    const { isPublicApiRoute } = await import("@/lib/backendAuth");
    expect(isPublicApiRoute("/api/leads", "POST")).toBe(true);
    expect(isPublicApiRoute("/api/leads", "GET")).toBe(false);
    expect(isPublicApiRoute("/api/checkout/plans", "GET")).toBe(true);
    expect(isPublicApiRoute("/api/checkout", "POST")).toBe(false);
  });

  it("lets event pages, registration, universities and files through; the builder stays closed", async () => {
    const { isPublicApiRoute } = await import("@/lib/backendAuth");
    expect(isPublicApiRoute("/api/public/events/baku-ai", "GET")).toBe(true);
    expect(isPublicApiRoute("/api/public/events/baku-ai/register", "POST")).toBe(true);
    expect(isPublicApiRoute("/api/public/events/baku-ai/register", "GET")).toBe(false);
    expect(isPublicApiRoute("/api/universities", "GET")).toBe(true);
    expect(isPublicApiRoute("/api/files/0b8c9d4e-1f2a-4b3c-8d9e-0a1b2c3d4e5f", "GET")).toBe(true);
    expect(isPublicApiRoute("/api/files", "POST")).toBe(true);
    expect(isPublicApiRoute("/api/files/0b8c9d4e-1f2a-4b3c-8d9e-0a1b2c3d4e5f", "DELETE")).toBe(false);
    expect(isPublicApiRoute("/api/events/12/builder", "GET")).toBe(false);
    expect(isPublicApiRoute("/api/events/drafts", "POST")).toBe(false);
  });

  it("lets the certificate check and its PDF through, nothing around them", async () => {
    const { isPublicApiRoute } = await import("@/lib/backendAuth");
    expect(isPublicApiRoute("/api/public/certificates/ABCD-EFGH-JKLM", "GET")).toBe(true);
    expect(isPublicApiRoute("/api/public/certificates/ABCD-EFGH-JKLM/pdf", "GET")).toBe(true);
    expect(isPublicApiRoute("/api/public/certificates/ABCD-EFGH-JKLM", "POST")).toBe(false);
    expect(isPublicApiRoute("/api/public/certificates", "GET")).toBe(false);
    expect(isPublicApiRoute("/api/public/certificates/ABCD/../../events", "GET")).toBe(false);
    expect(isPublicApiRoute("/api/me/certificates", "GET")).toBe(false);
    expect(isPublicApiRoute("/api/events/12/certificates", "GET")).toBe(false);
  });

  it("lets the e-mail confirmation link and the platform notice through; a new link stays for the account", async () => {
    const { isPublicApiRoute } = await import("@/lib/backendAuth");
    expect(isPublicApiRoute("/api/auth/verify-email", "POST")).toBe(true);
    expect(isPublicApiRoute("/api/auth/verify-email", "GET")).toBe(false);
    expect(isPublicApiRoute("/api/auth/verify-email/resend", "POST")).toBe(false);
    expect(isPublicApiRoute("/api/public/notice", "GET")).toBe(true);
    expect(isPublicApiRoute("/api/public/notice", "POST")).toBe(false);
    expect(isPublicApiRoute("/api/public/notices", "GET")).toBe(false);
  });

  it("lets calendar apps fetch an event's dates and a signed personal feed, nothing around them", async () => {
    const { isPublicApiRoute } = await import("@/lib/backendAuth");
    expect(isPublicApiRoute("/api/public/events/baku-ai/calendar.ics", "GET")).toBe(true);
    expect(isPublicApiRoute("/api/public/events/baku-ai/calendar.ics", "POST")).toBe(false);
    expect(isPublicApiRoute("/api/public/events/baku-ai/calendar", "GET")).toBe(false);
    const feed = `/api/calendar/42.3.${"aB3_-".repeat(6)}xy.ics`;
    expect(isPublicApiRoute(feed, "GET")).toBe(true);
    expect(isPublicApiRoute(feed, "POST")).toBe(false);
    expect(isPublicApiRoute("/api/calendar/abc.ics", "GET")).toBe(false);
    expect(isPublicApiRoute(`/api/calendar/42.3.${"a".repeat(31)}.ics`, "GET")).toBe(false);
    expect(isPublicApiRoute(`/api/calendar/42.3.${"a".repeat(32)}`, "GET")).toBe(false);
    expect(isPublicApiRoute(`/api/calendar/42.3.${"a".repeat(32)}.ics/../me`, "GET")).toBe(false);
    expect(isPublicApiRoute("/api/me/calendar", "GET")).toBe(false);
    expect(isPublicApiRoute("/api/me/calendar/reset", "POST")).toBe(false);
  });

  it("lets an event's projects page and the platform's status be read, nothing that changes them", async () => {
    const { isPublicApiRoute } = await import("@/lib/backendAuth");
    expect(isPublicApiRoute("/api/public/events/baku-ai/projects", "GET")).toBe(true);
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) expect(isPublicApiRoute("/api/public/events/baku-ai/projects", m), m).toBe(false);
    expect(isPublicApiRoute("/api/public/events/baku-ai/projects/12", "GET")).toBe(false);
    expect(isPublicApiRoute("/api/public/events/a/b/projects", "GET")).toBe(false);
    // The organiser's switch and the team lead's choice stay behind the session.
    expect(isPublicApiRoute("/api/events/42/results/projects", "GET")).toBe(false);
    expect(isPublicApiRoute("/api/events/42/results/projects", "PUT")).toBe(false);
    expect(isPublicApiRoute("/api/events/42/results/projects/mine", "PUT")).toBe(false);
    expect(isPublicApiRoute("/api/public/status", "GET")).toBe(true);
    expect(isPublicApiRoute("/api/public/status", "HEAD")).toBe(true);
    expect(isPublicApiRoute("/api/public/status", "POST")).toBe(false);
    expect(isPublicApiRoute("/api/public/status/x", "GET")).toBe(false);
  });
});

describe("the directory and public profiles", () => {
  it("are read without an account, never written", async () => {
    const { isPublicApiRoute } = await import("@/lib/backendAuth");
    expect(isPublicApiRoute("/api/public/directory", "GET")).toBe(true);
    expect(isPublicApiRoute("/api/public/directory/slugs", "GET")).toBe(true);
    expect(isPublicApiRoute("/api/public/directory", "POST")).toBe(false);
    expect(isPublicApiRoute("/api/public/directory/other", "GET")).toBe(false);
    expect(isPublicApiRoute("/api/public/profiles/aysel-m", "GET")).toBe(true);
    expect(isPublicApiRoute("/api/public/profiles/aysel-m", "PUT")).toBe(false);
    expect(isPublicApiRoute("/api/public/profiles/a/b", "GET")).toBe(false);
    // The person's own record and switches stay behind the session.
    expect(isPublicApiRoute("/api/me/hackathons", "GET")).toBe(false);
    expect(isPublicApiRoute("/api/me/public-profile", "PUT")).toBe(false);
    expect(isPublicApiRoute("/api/events/42/report/pdf", "GET")).toBe(false);
  });
});

describe("the sitemap", () => {
  it("lists only pages a visitor without a session can open", async () => {
    const { PUBLIC_PAGES } = await import("@/lib/site");
    expect(PUBLIC_PAGES.some((p) => p.path === "/status")).toBe(true);
    expect(PUBLIC_PAGES.some((p) => p.path === "/hackathons")).toBe(true);
    // "/" is the landing page on the marketing host (the middleware rewrites it there).
    for (const { path } of PUBLIC_PAGES) if (path !== "/") expect(isPublicPagePath(path), path).toBe(true);
  });
});
