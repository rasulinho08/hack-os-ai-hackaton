/**
 * The one link a team lead shares: the event's registration page with the
 * team's code filled in. Someone new registers and joins in one go; someone
 * registered already is told so there. Used by the registration success
 * screen and the team page alike.
 */
export function teamInviteUrl(origin: string, eventSlug: string | null | undefined, joinCode: string | null | undefined): string {
  const code = String(joinCode ?? "").trim();
  const slug = String(eventSlug ?? "").trim();
  if (!code || !slug) return "";
  return `${origin.replace(/\/+$/, "")}/e/${encodeURIComponent(slug)}/register?team=${encodeURIComponent(code)}`;
}
