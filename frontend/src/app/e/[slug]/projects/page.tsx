import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchPublicEvent, redirectIfMoved } from "@/lib/builder/publicFetch";
import { ProjectsPublicView } from "@/components/projects/ProjectsPublicView";
import { fetchPublicProjects } from "@/lib/publicProjectsFetch";
import { projectsPagePath } from "@/lib/publicProjects";
import { resolve } from "@/lib/i18n";
import { fill } from "@/lib/i18n/fill";

/*
 * An event's projects, for anyone: the winners first, then every project its
 * team let through. Read on the server, so the projects are in the page's
 * HTML for search engines and link previews. The page exists only while the
 * organiser keeps it open and the results are published; otherwise the
 * segment's not-found page says so (with a 404).
 */

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const page = await fetchPublicProjects(slug).catch(() => null);
  if (!page) return { title: resolve("en", "pj.closed_title"), robots: { index: false } };
  const { event } = page;
  const title = fill(resolve(event.language, "pj.meta_title"), { event: event.name });
  const description = fill(resolve(event.language, "pj.meta_description"), { event: event.name });
  const path = projectsPagePath(event.slug);
  // Naming openGraph here replaces what the event page's share image would
  // give, so the same picture is named explicitly.
  const image = { url: `/e/${encodeURIComponent(event.slug)}/opengraph-image`, width: 1200, height: 630, type: "image/png", alt: event.name };
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title, description, type: "website", url: path, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function EventProjectsPage({ params }: Params) {
  const { slug } = await params;
  const page = await fetchPublicProjects(slug);
  if (!page) {
    // An address the event used to have: on to its current one.
    redirectIfMoved(await fetchPublicEvent(slug).catch(() => null), "/projects");
    notFound();
  }
  return <ProjectsPublicView page={page} />;
}
