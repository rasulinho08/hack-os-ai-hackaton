/**
 * Lowering the participant limit below the people who already hold places.
 *
 * Nobody is removed — the API keeps every registration — but the event then
 * reads "full" with more people in it than places, and nobody new gets in
 * until enough of them leave. That is sometimes what the organiser wants (a
 * room got smaller), never something to do by a slip of the keyboard, so
 * the builder asks first.
 */

/** Whether a new limit can be saved as it is, or needs the organiser to confirm. */
export function capacityChange(next: number | null, taken: number): "save" | "confirm" {
  if (next == null) return "save";
  return next < Math.max(0, taken) ? "confirm" : "save";
}
