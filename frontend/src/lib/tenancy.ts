/**
 * Seats, colleagues and invitations on a customer's account.
 *
 * Like `commerce.ts`, every read here goes to a path the backend scopes from
 * the session. There is no customer id in this file on purpose: the customer
 * an administrator manages is decided by who they are signed in as, not by
 * anything the browser sends.
 *
 * The one number worth being careful with is `seats.limit`. `null` means no
 * limit was agreed — not unlimited-as-a-big-number, and emphatically not zero.
 * Every place that renders it has to say so in words rather than print a
 * figure, which is why `remaining` is `null` alongside it instead of `Infinity`.
 */

import { apiGet, apiPost, apiDelete } from "@/lib/api";

export interface Seats {
  /** `null` when the deal names no limit. */
  limit: number | null;
  /** Linked accounts plus live invitations — a pending invite holds its seat. */
  used: number;
  linked: number;
  pending: number;
  /** `null` when `limit` is. */
  remaining: number | null;
}

export interface Member {
  id: number;
  customer_id: number;
  /** `null` for a billing contact with no platform account — costs no seat. */
  user_id: number | null;
  email: string;
  full_name: string | null;
  role_title: string | null;
  is_primary: boolean;
  platform_role: string | null;
  created_at: string;
}

export type InviteState = "pending" | "accepted" | "revoked" | "expired";

export interface Invite {
  id: number;
  email: string;
  full_name: string | null;
  role_title: string | null;
  grant_role: "org_admin" | "admin";
  state: InviteState;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  invited_by_name: string | null;
  created_at: string;
}

export interface Team {
  customerId: number;
  seats: Seats;
  members: Member[];
  invites: Invite[];
}

/** What an invite link says about itself, before the recipient signs in. */
export interface InvitePreview {
  email: string;
  fullName: string | null;
  grantRole: string;
  customerName: string;
  state: InviteState;
}

export const ROLE_LABEL: Record<string, string> = {
  superadmin: "Platform owner",
  admin: "Administrator",
  org_admin: "Organiser",
  hacker: "Participant",
  pending: "Awaiting approval",
  judge: "Judge",
  mentor: "Mentor",
  volunteer: "Volunteer",
};

export const INVITE_STATE_LABEL: Record<InviteState, string> = {
  pending: "Waiting",
  accepted: "Accepted",
  revoked: "Withdrawn",
  expired: "Expired",
};

export const INVITE_STATE_TONE: Record<InviteState, "info" | "ok" | "neutral" | "warn"> = {
  pending: "info",
  accepted: "ok",
  revoked: "neutral",
  expired: "warn",
};

export const loadTeam = () => apiGet<Team>("/api/account/team");

export interface InviteResult {
  invite: Invite;
  /** Always usable, whether or not the mail went out. */
  acceptUrl: string;
  emailed: boolean;
}

export const inviteColleague = (body: {
  email: string;
  fullName?: string;
  roleTitle?: string;
  grantRole?: "org_admin" | "admin";
}) => apiPost<InviteResult>("/api/account/team/invites", body);

export const revokeInvite = (id: number) => apiDelete(`/api/account/team/invites/${id}`);

export const removeMember = (contactId: number) =>
  apiDelete(`/api/account/team/members/${contactId}`);

export const peekInvite = (token: string) =>
  apiGet<InvitePreview>(`/api/account/invites/${encodeURIComponent(token)}`);

export const acceptInvite = (token: string) =>
  apiPost<{ customerId: number; customerName: string; grantedRole: string }>(
    `/api/account/invites/${encodeURIComponent(token)}`,
    {},
  );

/**
 * How to phrase a seat count.
 *
 * Kept here rather than in a component so the three screens that show it
 * cannot drift into saying different things about the same `null`.
 */
export function describeSeats(seats: Seats): string {
  if (seats.limit == null) {
    return seats.used === 1 ? "1 person" : `${seats.used} people`;
  }
  return `${seats.used} of ${seats.limit} seats`;
}
