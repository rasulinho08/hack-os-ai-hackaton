/**
 * Which pages are reachable without a session.
 *
 * This lives outside middleware.ts so it can be unit-tested: the list is the
 * single place a new public page has to be registered, and forgetting one
 * sends that page to the login screen — which is exactly how /signup and
 * /invite/<token> shipped unreachable on production.
 */
export const LOGIN_PATH = "/login";
export const SITE_PREFIXES = [
  "/account",
  "/checkout",
  "/signin",
  /*
   * /signup and /invite/<token> must be reachable without a session: one
   * creates the account, the other is opened from an e-mail by somebody who
   * may have no account yet (the page reads the invitation through a public
   * endpoint and only asks to sign in when accepting). Both were added after
   * this list and fell through to the login redirect, so a new customer could
   * never register and an invited colleague could never accept.
   */
  "/signup",
  "/invite",
  "/demo",
  /* /platform and /security now redirect to the home page; old links keep working. */
  "/platform",
  "/solutions",
  "/pricing",
  "/security",
  "/contact",
  "/customers",
  /* The old stories address (it redirects to the directory), the platform's status, and the legal pages. */
  "/stories",
  /* The directory of hackathons, and the profiles people chose to make public. */
  "/hackathons",
  "/u",
  "/status",
  "/privacy",
  "/terms",
  "/cookies",
  "/refunds",
];
export function isPublicPagePath(pathname: string): boolean {
  if (pathname === LOGIN_PATH) return true;
  if (pathname === "/forgot-password") return true;
  if (pathname === "/reset-password") return true;
  if (pathname === "/faq") return true;
  if (pathname === "/welcome") return true;
  /* The owner console's sign-in (password, then the second-step code). */
  if (pathname === "/admin-login") return true;
  /* The setup link from the approval e-mail; the page asks for sign-in itself. */
  if (pathname.startsWith("/setup/")) return true;
  /*
   * The public site and the workspace walkthrough. Both are marketing surfaces
   * with no session behind them — the demo reads a fixed sample dataset in the
   * browser and never calls the API, so there is nothing here to protect.
   */
  for (const prefix of SITE_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
  }
  if (pathname.startsWith("/join/")) return true;
  /* An event's public page, its share image and its registration form. */
  if (pathname.startsWith("/e/")) return true;
  /* The check of a certificate by its code, opened by whoever the holder shows it to. */
  if (pathname.startsWith("/verify/")) return true;
  /* The link in the e-mail that confirms an address: opened from a mailbox, often signed out. */
  if (pathname === "/verify-email") return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname.startsWith("/robots.txt")) return true;
  if (pathname.startsWith("/sitemap")) return true;
  return false;
}
