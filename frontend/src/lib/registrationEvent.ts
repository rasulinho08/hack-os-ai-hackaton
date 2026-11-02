/**
 * Which event the login screen's "register with event code" link should open.
 *
 * The public event list is not ordered by openness, so taking its first row
 * once pointed production visitors at a finished event named "test". Prefer an
 * event whose registration window is open now; failing that, one that has not
 * finished; failing that, nothing — the screen then shows a hint instead of a
 * link.
 */
export interface RegistrationEventCandidate {
  event_code?: string | null;
  registration_start?: string | null;
  registration_end?: string | null;
  end_date?: string | null;
  derived_status?: string | null;
}

const parse = (v?: string | null): number => (v ? Date.parse(v) : NaN);

export function pickRegistrationEvent<T extends RegistrationEventCandidate>(
  events: T[] | null | undefined,
  now: number = Date.now(),
): T | null {
  if (!events || events.length === 0) return null;
  const withCode = events.filter((e) => Boolean(e.event_code));

  const open = withCode.find((e) => {
    const start = parse(e.registration_start);
    const end = parse(e.registration_end);
    return (Number.isNaN(start) || start <= now) && !Number.isNaN(end) && end >= now;
  });
  if (open) return open;

  const notFinished = withCode.find((e) => {
    const end = parse(e.end_date);
    const status = String(e.derived_status || "").toLowerCase();
    return status !== "completed" && status !== "archived" && (Number.isNaN(end) || end >= now);
  });
  return notFinished ?? null;
}
