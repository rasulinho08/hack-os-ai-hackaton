import type { Metadata } from "next";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from "@/lib/site";

/**
 * Metadata for one public page: its title, a canonical URL (the same marketing
 * paths are served on www.hack-os.app and app.hack-os.app, so without one a
 * crawler sees duplicate content) and Open Graph / Twitter tags that name the
 * page rather than the site. Relative URLs become absolute through the
 * metadataBase set in the root layout.
 *
 * Setting `openGraph` or `twitter` on a page replaces the parent's object
 * wholesale, including the images Next generates from app/opengraph-image.png
 * and app/twitter-image.png. Those files are served at fixed paths, so the
 * images are named here explicitly or the share card would have no picture.
 */
const OG_IMAGE = {
  url: "/opengraph-image.png",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: SITE_TITLE,
};
const TWITTER_IMAGE = { ...OG_IMAGE, url: "/twitter-image.png" };

export function pageMetadata({
  title,
  description = SITE_DESCRIPTION,
  path,
}: {
  /** Page name; `null` for the home page, which uses the site title as-is. */
  title: string | null;
  description?: string;
  /** Canonical path, e.g. "/pricing". */
  path: string;
}): Metadata {
  const shareTitle = title ? `${title} | ${SITE_NAME}` : SITE_TITLE;
  return {
    title: title ?? { absolute: SITE_TITLE },
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: shareTitle,
      description,
      url: path,
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: shareTitle,
      description,
      images: [TWITTER_IMAGE],
    },
  };
}
