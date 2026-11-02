import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EventPublicView } from "@/components/event-page/EventPublicView";
import { fetchPublicEvent, redirectIfMoved } from "@/lib/builder/publicFetch";

type Params = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const event = await fetchPublicEvent(slug).catch(() => null);
  if (!event) return { title: "Event not found", robots: { index: false } };
  const description = event.tagline || event.description?.slice(0, 160) || undefined;
  // A private or invite-only event is reached by its link, never by a search engine.
  const listed = !event.visibility || event.visibility === "public";
  return {
    title: event.name,
    description,
    ...(listed ? {} : { robots: { index: false, follow: false } }),
    alternates: { canonical: `/e/${event.slug}` },
    openGraph: { title: event.name, description, type: "website", url: `/e/${event.slug}` },
    twitter: { card: "summary_large_image", title: event.name, description },
  };
}

export default async function EventPage({ params, searchParams }: Params) {
  const { slug } = await params;
  const sp = await searchParams;
  const event = await fetchPublicEvent(slug);
  if (!event) notFound();
  redirectIfMoved(event, "", sp);
  const ref = typeof sp.ref === "string" ? sp.ref.slice(0, 40) : null;
  return <EventPublicView event={event} refParam={ref} />;
}
