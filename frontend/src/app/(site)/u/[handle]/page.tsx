import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProfileView } from "./ProfileView";
import { fetchPublicProfile } from "@/lib/profileFetch";
import { profileDescription, profileJsonLd } from "@/lib/profile";
import { jsonForScript } from "@/lib/directory";
import { resolve } from "@/lib/i18n";
import { SITE_NAME, SITE_URL } from "@/lib/site";

type Params = { params: Promise<{ handle: string }> };

/*
 * A person's public profile, shared by its link. Search engines are asked
 * not to index it unless its owner also switched on "Let search engines show
 * my profile": then the page is indexable, carries its description and
 * structured data (only the parts the person chose to show), and is in the
 * sitemap. The API is read fresh on every request (profileFetch), so
 * switching either off takes effect at once.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params;
  const p = await fetchPublicProfile(handle).catch(() => null);
  if (!p) return { title: "Profile not found", robots: { index: false, follow: false } };
  const who = p.name || `@${p.handle}`;
  const title = resolve("en", "pf.u.meta_title").replace("{name}", who);
  const description = profileDescription(p, (k) => resolve("en", k));
  return {
    title: { absolute: title },
    description,
    robots: p.indexable ? { index: true, follow: true } : { index: false, follow: false },
    alternates: { canonical: `/u/${p.handle}` },
    openGraph: {
      type: "profile",
      siteName: SITE_NAME,
      title,
      description,
      url: `/u/${p.handle}`,
      ...(p.name ? { firstName: p.name.split(" ")[0], lastName: p.name.split(" ").slice(1).join(" ") || undefined } : {}),
      username: p.handle,
      images: [{ url: "/opengraph-image.png", width: 1200, height: 630, type: "image/png", alt: title }],
    },
    twitter: { card: "summary", title, description },
  };
}

export default async function ProfilePage({ params }: Params) {
  const { handle } = await params;
  const profile = await fetchPublicProfile(handle);
  if (!profile) notFound();
  const jsonLd = profileJsonLd(profile, SITE_URL);
  return (
    <>
      {jsonLd ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonForScript(jsonLd) }} /> : null}
      <ProfileView profile={profile} />
    </>
  );
}
