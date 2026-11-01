import { ApiError } from "@/lib/api";

/**
 * True when POST /api/auth/register failed only because this email is
 * already registered (or a prior partial signup). Backend often returns
 * 409 or a vague "could not be completed" to avoid email enumeration.
 * Callers should continue with login + enrollment instead of surfacing
 * a blocking error (login register tab, join flows).
 */
export function isDuplicateRegistrationError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 409) return true;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("already") ||
    msg.includes("exists") ||
    msg.includes("duplicate") ||
    msg.includes("taken") ||
    msg.includes("could not be completed")
  );
}

/**
 * Backend refused an action (create team, enroll, etc.) because the hacker is
 * not organiser-approved yet. Team-lead registration should still finish and
 * send the user to /login — not surface this as a fatal registration error.
 */
export function isPendingApprovalBlockingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (!msg) return false;
  if (msg.includes("not approved")) return true;
  if (msg.includes("not been approved")) return true;
  if (msg.includes("hasn't been approved")) return true;
  if (msg.includes("until an organiser approves")) return true;
  if (msg.includes("until an organizer approves")) return true;
  if (msg.includes("until approved")) return true;
  if (msg.includes("pending review")) return true;
  if (msg.includes("awaiting approval")) return true;
  return false;
}
