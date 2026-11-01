import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, SITE_URL } from "@/lib/site";
import { fetchDirectorySlugs } from "@/lib/directoryFetch";
import { fetchProfileSitemap } from "@/lib/profileFetch";

/**
 * /sitemap.xml — the public marketing pages, the directory of hackathons, the
 * pages of the events listed in it (published, public events their
 * organisers left listed) and the public profiles whose owners let search
 * engines find them. Private and invite-only events, portals and the console
 * are deliberately absent.
 *
 * Built on each request, so a profile switched back to "not for search
 * engines" leaves it at once; the event list keeps its own hour-long cache
 * (directoryFetch).
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // No lastModified on the static pages: stamping "now" on every request
  // tells crawlers each page changed every time they look.
  const pages: MetadataRoute.Sitemap = PUBLIC_PAGES.map(({ path, priority }) => ({
    url: `${SITE_URL}${path === "/" ? "" : path}`,
    changeFrequency: "monthly",
    priority,
  }));
  const [slugs, profiles] = await Promise.all([fetchDirectorySlugs(), fetchProfileSitemap()]);
  const events = slugs.map(({ slug, updatedAt }) => ({
    url: `${SITE_URL}/e/${slug}`,
    ...(updatedAt ? { lastModified: updatedAt } : {}),
    changeFrequency: "weekly" as const,
    priority: 0.5,
  }));
  const people = profiles.map(({ handle, updatedAt }) => ({
    url: `${SITE_URL}/u/${handle}`,
    ...(updatedAt ? { lastModified: updatedAt } : {}),
    changeFrequency: "monthly" as const,
    priority: 0.3,
  }));
  return [...pages, ...events, ...people];
}
