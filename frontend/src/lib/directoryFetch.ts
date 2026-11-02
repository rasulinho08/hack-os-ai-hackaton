/**
 * Server-side reads of the hackathon directory, for /hackathons and the
 * sitemap: straight to the API, never cached here (the API keeps its answer
 * a minute and drops it as soon as an event changes, so an organiser who
 * takes an event off the directory sees it gone at once). Deduplicated per
 * request, so a page and its metadata ask once.
 */

import { cache } from "react";
import { getBackendOrigin } from "@/lib/backendOrigin";
import { PAGE_SIZE, directorySearch, normalizeDirectory, type DirectoryPage, type DirectoryQuery } from "@/lib/directory";

/** One page of the directory; null when the API did not answer. */
export const fetchDirectory = cache(async (key: string): Promise<DirectoryPage | null> => {
  try {
    const q = JSON.parse(key) as DirectoryQuery;
    const search = directorySearch(q);
    const res = await fetch(`${getBackendOrigin()}/api/public/directory${search ? `${search}&` : "?"}limit=${PAGE_SIZE}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return normalizeDirectory(json?.data);
  } catch {
    return null;
  }
});

/** The listed events' addresses for the sitemap; [] when the API did not answer. */
export async function fetchDirectorySlugs(): Promise<{ slug: string; updatedAt: string | null }[]> {
  try {
    const res = await fetch(`${getBackendOrigin()}/api/public/directory/slugs`, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const json = await res.json();
    return (Array.isArray(json?.data) ? json.data : [])
      .filter((x: { slug?: unknown }) => typeof x?.slug === "string" && /^[a-z0-9-]{1,80}$/.test(x.slug))
      .map((x: { slug: string; updatedAt?: string | null }) => ({ slug: x.slug, updatedAt: typeof x.updatedAt === "string" ? x.updatedAt : null }));
  } catch {
    return [];
  }
}
