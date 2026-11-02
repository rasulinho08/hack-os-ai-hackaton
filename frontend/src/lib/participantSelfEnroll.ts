import { apiPost, ApiError } from "@/lib/api";

export type ParticipantSelfPayload = {
  is_solo: boolean;
  is_team_lead?: boolean;
  team_id?: number;
};

/**
 * Hacker-scoped enrollment for an event (`POST …/participants/self`).
 * Admin `POST …/participants` returns 403 for normal hackers, so join/login
 * flows must use this route instead.
 */
export async function postEventParticipantSelf(
  eventId: number,
  body: ParticipantSelfPayload,
): Promise<void> {
  await apiPost(`/api/events/${eventId}/participants/self`, body);
}

/** True when self-enroll failed in a way that is safe to ignore (idempotent / duplicate). */
export function isBenignParticipantSelfError(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  const m = e.message.toLowerCase();
  return (
    e.status === 409 ||
    e.status === 400 ||
    m.includes("already") ||
    m.includes("duplicate") ||
    m.includes("exists") ||
    m.includes("enrolled")
  );
}

/**
 * Same as {@link postEventParticipantSelf} but never throws: duplicates /
 * validation noise are ignored; other failures are logged so registration
 * can still redirect to login.
 */
export async function postEventParticipantSelfSilent(
  eventId: number,
  body: ParticipantSelfPayload,
): Promise<void> {
  try {
    await postEventParticipantSelf(eventId, body);
  } catch (e) {
    if (isBenignParticipantSelfError(e)) return;
    console.warn("[participantSelf] enrollment failed", e);
  }
}
