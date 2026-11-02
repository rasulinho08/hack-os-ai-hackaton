/** Persisted active event for the creator dashboard (multi-event). */
export const ACTIVE_EVENT_ID_KEY = "hh_active_event_id";

export function readActiveEventIdFromStorage(): number | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(ACTIVE_EVENT_ID_KEY);
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function writeActiveEventIdToStorage(id: number) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ACTIVE_EVENT_ID_KEY, String(id));
}

export function clearActiveEventIdFromStorage() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ACTIVE_EVENT_ID_KEY);
}
