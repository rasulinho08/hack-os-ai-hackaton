/**
 * Server-side read of an event's public projects page, for the page and its
 * metadata: straight to the API, never cached — closing the page or keeping
 * a project off it must show at once. Deduplicated per request, so the page
 * and its metadata ask the API once.
 */

import { cache } from "react";
import { getBackendOrigin } from "@/lib/backendOrigin";
import { normalizePublicProjects, type PublicProjectsPage } from "@/lib/publicProjects";

/** The page's data; null while there is no open page at this address. Throws when the API fails. */
export const fetchPublicProjects = cache(async (slug: string): Promise<PublicProjectsPage | null> => {
  if (!slug || slug.length > 100) return null;
  const res = await fetch(`${getBackendOrigin()}/api/public/events/${encodeURIComponent(slug)}/projects`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Projects page: API answered ${res.status}`);
  const json = await res.json();
  return normalizePublicProjects(json?.data);
});
