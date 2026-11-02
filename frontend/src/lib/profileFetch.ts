/**
 * The server's read of a public profile for /u/<handle> and its metadata:
 * straight to the API, never cached here, so a page its owner switched off
 * is gone at once. Deduplicated per request.
 */

import { cache } from "react";
import { getBackendOrigin } from "@/lib/backendOrigin";
import { HANDLE_RE, normalizePublicProfile, type PublicProfile } from "@/lib/profile";

/** The profile, or null when there is none at this address (or it is off). Throws when the API fails. */
export const fetchPublicProfile = cache(async (handle: string): Promise<PublicProfile | null> => {
  const h = String(handle || "").toLowerCase();
  if (!HANDLE_RE.test(h)) return null;
  const res = await fetch(`${getBackendOrigin()}/api/public/profiles/${encodeURIComponent(h)}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Profile: API answered ${res.status}`);
  const json = await res.json();
  return normalizePublicProfile(json?.data);
});

/**
 * The profiles their owners let search engines find, for the sitemap: never
 * cached here either, so one switched off leaves the sitemap at once; []
 * when the API did not answer.
 */
export async function fetchProfileSitemap(): Promise<{ handle: string; updatedAt: string | null }[]> {
  try {
    const res = await fetch(`${getBackendOrigin()}/api/public/profiles/sitemap`, { cache: "no-store" });
    if (!res.ok) return [];
    const json = await res.json();
    return (Array.isArray(json?.data) ? json.data : [])
      .filter((x: { handle?: unknown }) => typeof x?.handle === "string" && HANDLE_RE.test(x.handle.toLowerCase()))
      .map((x: { handle: string; updatedAt?: unknown }) => ({ handle: x.handle.toLowerCase(), updatedAt: typeof x.updatedAt === "string" ? x.updatedAt : null }));
  } catch {
    return [];
  }
}
