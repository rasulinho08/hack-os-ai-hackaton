/**
 * The event a participant is working in: the one they entered, else one
 * they were admitted to, else one running now, else the next (their own
 * registrations, from /api/me/workspaces). The API picks the same way when a
 * request names no event (effectiveRole.participantEventId), so the pages
 * and the API act in one event. Registered nowhere means no event, never a
 * guess: the lobby's guess (any live event, in the end event 1) is only for
 * older installs without that route. Never another organisation's event.
 */

import { resolveLobbyInviteEventId, resolveMentorEventIds } from "@/lib/resolveEventId";
import { enteredEventId, myEventsAs, type WorkspaceEvent } from "@/lib/workspaces";

const ADMITTED = new Set(["approved", "eliminated"]);

export async function participantEventId(): Promise<number | null> {
  let mine: WorkspaceEvent[];
  try {
    mine = await myEventsAs("participant");
  } catch {
    try {
      return await resolveLobbyInviteEventId();
    } catch {
      return null;
    }
  }
  const entered = enteredEventId();
  const chosen = mine.find((e) => e.id === entered)
    ?? mine.find((e) => ADMITTED.has(String(e.participant_status || "").toLowerCase()))
    ?? mine[0];
  return chosen?.id ?? null;
}

/**
 * The event a mentor or volunteer works in: the one they entered, else one
 * running now, else the next (their own assignments). Mentors on an older
 * install without /api/me/workspaces fall back to /api/mentor/me/events.
 */
export async function staffEventId(role: "mentor" | "volunteer"): Promise<number | null> {
  try {
    const mine = await myEventsAs(role);
    if (mine.length) return mine[0].id;
  } catch {
    /* fall back below */
  }
  if (role === "mentor") {
    const ids = await resolveMentorEventIds().catch(() => [] as number[]);
    return ids[0] ?? null;
  }
  return null;
}
