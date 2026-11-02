import type { Metadata } from "next";
import { GalleryMembersView } from "@/components/gallery/GalleryMembersView";
import { fetchPublicEvent, redirectIfMoved } from "@/lib/builder/publicFetch";
import { resolve } from "@/lib/i18n";

/*
 * An event's photos, for its people: the link the organisers share in the
 * chat and by e-mail. The photos are read in the browser with the visitor's
 * session (the API decides who may see them), so nothing private is in the
 * server's HTML, and the page is kept out of search engines.
 */

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const event = await fetchPublicEvent(slug).catch(() => null);
  const robots = { index: false, follow: false };
  if (!event) return { title: resolve("en", "gl.title"), robots };
  return {
    title: resolve(event.language || "az", "gl.m.title").split("{event}").join(event.name),
    robots,
  };
}

export default async function EventGalleryPage({ params }: Params) {
  const { slug } = await params;
  redirectIfMoved(await fetchPublicEvent(slug).catch(() => null), "/gallery");
  return <GalleryMembersView slug={slug} />;
}
