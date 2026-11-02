import { apiGet, apiPost, apiDelete } from "@/lib/api";

export interface TeamInvite {
  id: number;
  from_user_id: number;
  to_user_id: number;
  event_id: number;
  status: string;
  created_at: string;
  from_name?: string;
  from_email?: string;
  to_name?: string;
  to_email?: string;
}

/**
 * Send a peer-to-peer team invite.
 *
 * Backend expects strictly `{ toUserId: number, eventId: number }`. We coerce
 * both values with `Number(...)` to defend against stringified numbers that
 * some UIs hand in (e.g., from `<input value>` or URL params), and throw a
 * client-side error *before* the network call if either is missing/invalid.
 * This prevents the confusing backend message
 * "toUserId and eventId are required" from ever reaching the user.
 *
 * A team is auto-created when the invite is accepted, so no team needs to
 * exist beforehand.
 */
export async function sendTeamInvite(
  toUserId: number | string,
  eventId: number | string,
) {
  const toId = Number(toUserId);
  const evId = Number(eventId);
  if (!Number.isFinite(toId) || toId <= 0) {
    throw new Error("Invalid user to invite");
  }
  if (!Number.isFinite(evId) || evId <= 0) {
    throw new Error("Active event is not available yet");
  }
  // Send BOTH camelCase and snake_case keys so the call works regardless of
  // which backend version is deployed (older controllers only read snake_case
  // and emit the confusing "toUserId and eventId are required" error
  // otherwise — Problem 15).
  return apiPost<TeamInvite>("/api/team-invites", {
    toUserId: toId,
    eventId: evId,
    to_user_id: toId,
    event_id: evId,
  });
}

export async function getIncomingInvites(eventId?: number) {
  const qs = eventId ? `?eventId=${eventId}` : "";
  return apiGet<TeamInvite[]>(`/api/team-invites/incoming${qs}`);
}

export async function getOutgoingInvites(eventId?: number) {
  const qs = eventId ? `?eventId=${eventId}` : "";
  return apiGet<TeamInvite[]>(`/api/team-invites/outgoing${qs}`);
}

export interface AcceptInviteResult {
  teamId: number;
  eventId: number;
  /** Set when the server detected the invite was already accepted. */
  alreadyAccepted?: boolean;
  /** Set when the server detected the user was already on a team for this event. */
  alreadyOnTeam?: boolean;
}

export async function acceptTeamInvite(inviteId: number) {
  return apiPost<AcceptInviteResult>(
    `/api/team-invites/${inviteId}/accept`,
    {}
  );
}

export async function declineTeamInvite(inviteId: number) {
  return apiPost(`/api/team-invites/${inviteId}/decline`, {});
}

export async function cancelTeamInvite(inviteId: number) {
  return apiDelete(`/api/team-invites/${inviteId}`);
}
