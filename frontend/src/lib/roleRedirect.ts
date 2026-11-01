/** Post-login route by API user.role (shared login / join flows). */
export const ROLE_REDIRECT: Record<string, string> = {
  superadmin: "/",
  admin: "/",
  org_admin: "/",
  judge: "/judge",
  mentor: "/mentor",
  hacker: "/hacker",
  pending: "/hacker",
  volunteer: "/volunteer",
};

export function redirectPathForRole(role: string): string {
  return ROLE_REDIRECT[role] ?? "/";
}
