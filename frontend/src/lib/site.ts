/**
 * The public identity of the site, in one place.
 *
 * Titles, Open Graph tags, the sitemap, robots.txt and the web manifest all
 * read from here so the name and description cannot drift between them.
 *
 * NEXT_PUBLIC_SITE_URL is the canonical marketing origin (used for absolute
 * URLs in share metadata and the sitemap). It defaults to the production
 * domain so a deployment without the variable still produces correct links.
 */
export const SITE_NAME = "HackOS";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.hack-os.app")
  .trim()
  .replace(/\/+$/, "");

export const SITE_TITLE = "HackOS — Hackathon management platform";

export const SITE_DESCRIPTION =
  "Registration, teams, submissions, weighted judging, results and reporting in one platform. Separate views for organisers, judges, mentors, participants and volunteers.";

/**
 * Where people write to the business: the footer, /contact, the legal pages.
 * NEXT_PUBLIC_CONTACT_EMAIL sets it (a domain mailbox such as sales@… once
 * one exists); without it the address the site has always shown stands.
 */
export const CONTACT_EMAIL = (process.env.NEXT_PUBLIC_CONTACT_EMAIL || "").trim() || "mamishovrasul028@gmail.com";

/** Marketing pages that belong in the sitemap, with a relative change frequency. */
export const PUBLIC_PAGES: { path: string; priority: number }[] = [
  { path: "/", priority: 1 },
  { path: "/solutions", priority: 0.8 },
  { path: "/pricing", priority: 0.9 },
  { path: "/hackathons", priority: 0.8 },
  { path: "/contact", priority: 0.6 },
  { path: "/demo", priority: 0.7 },
  { path: "/signin", priority: 0.4 },
  { path: "/status", priority: 0.3 },
  { path: "/privacy", priority: 0.3 },
  { path: "/terms", priority: 0.3 },
  { path: "/cookies", priority: 0.3 },
  { path: "/refunds", priority: 0.3 },
];

/**
 * Everything behind a session or specific to one event. Crawlers get nothing
 * useful from these (they redirect to the login screen) and listing them
 * only advertises the shape of the product.
 */
export const PRIVATE_PATH_PREFIXES = [
  "/api/",
  "/account",
  "/checkout",
  "/workspace",
  "/hacker",
  "/judge",
  "/mentor",
  "/volunteer",
  "/login",
  "/join/",
  "/invite/",
  "/create-event",
  "/edit-event",
  "/participants",
  "/invitations",
  "/teams",
  "/submissions",
  "/judges",
  "/mentors",
  "/volunteers",
  "/leaderboard",
  "/results",
  "/analytics",
  "/announcements",
  "/help-queue",
  "/resources",
  "/settings",
  "/presentations",
  "/feedback",
  "/eliminate",
  "/archive",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/chat",
];
