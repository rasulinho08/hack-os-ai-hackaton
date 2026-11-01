import type { MetadataRoute } from "next";
import { PRIVATE_PATH_PREFIXES, SITE_URL } from "@/lib/site";

/**
 * /robots.txt — the marketing pages may be indexed; the product itself may
 * not. The path has a dot in it, so the middleware never sees the request
 * (its matcher skips anything that looks like a file).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: PRIVATE_PATH_PREFIXES,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
