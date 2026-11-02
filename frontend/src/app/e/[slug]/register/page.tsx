import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RegisterClient } from "@/components/event-page/RegisterClient";
import { fetchPublicEvent, redirectIfMoved } from "@/lib/builder/publicFetch";
import { resolve } from "@/lib/i18n";

type Params = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (v: string | string[] | undefined, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const event = await fetchPublicEvent(slug).catch(() => null);
  if (!event) return { title: "Event not found", robots: { index: false } };
  return {
    title: resolve(event.language || "az", "rg.meta_title").split("{event}").join(event.name),
    robots: { index: false },
    alternates: { canonical: `/e/${event.slug}` },
  };
}

export default async function RegisterPage({ params, searchParams }: Params) {
  const { slug } = await params;
  const sp = await searchParams;
  const event = await fetchPublicEvent(slug);
  if (!event) notFound();
  redirectIfMoved(event, "/register", sp);
  const team = one(sp.team, 20);
  // An invitation's own link: the API checks it and lets its person through.
  const invite = one(sp.inviteToken, 200);
  const inviteToken = invite && /^[A-Za-z0-9._-]{8,200}$/.test(invite) ? invite : null;
  return (
    <RegisterClient
      event={event}
      teamCode={team && /^[A-Za-z0-9]{4,20}$/.test(team) ? team : null}
      refParam={one(sp.ref, 40)}
      invited={sp.invited === "1" || inviteToken !== null}
      inviteToken={inviteToken}
    />
  );
}
