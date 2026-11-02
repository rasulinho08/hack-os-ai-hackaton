/**
 * Server-side read of an event's public page data, for the page itself, its
 * metadata and its share image. Straight to the API (no browser in between),
 * never cached: places left and the registration state change by the minute.
 */

import { redirect } from "next/navigation";
import { getBackendOrigin } from "@/lib/backendOrigin";
import type { PublicEvent } from "./public";

export async function fetchPublicEvent(slug: string): Promise<PublicEvent | null> {
  if (!slug || slug.length > 100) return null;
  const res = await fetch(`${getBackendOrigin()}/api/public/events/${encodeURIComponent(slug)}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Event page: API answered ${res.status}`);
  const json = await res.json();
  return (json?.data as PublicEvent) || null;
}

/**
 * An event found by an address it used to have (its organiser or the owner
 * renamed it) goes to its current one, with the rest of the path and the
 * query kept (a team code, an invitation). Temporary on purpose: the address
 * can be changed back, and a browser that remembered a permanent redirect
 * would then go round in a circle.
 */
export function redirectIfMoved(
  event: Pick<PublicEvent, "slug" | "moved_from"> | null,
  rest = "",
  searchParams: Record<string, string | string[] | undefined> = {},
): void {
  if (!event?.moved_from || !event.slug || event.moved_from === event.slug) return;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === "string") qs.set(k, v);
    else if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
  }
  const q = qs.toString();
  redirect(`/e/${encodeURIComponent(event.slug)}${rest}${q ? `?${q}` : ""}`);
}
