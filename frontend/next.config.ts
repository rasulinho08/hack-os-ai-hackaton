import type { NextConfig } from "next";
import { getBackendOrigin } from "./src/lib/backendOrigin";
import { CAMERA_PAGES, baseHeaders, permissionsPolicy, securityHeaders } from "./src/lib/securityHeaders";

const backendOrigin = getBackendOrigin();

const headerOptions = {
  dev: process.env.NODE_ENV !== "production",
  preview: process.env.VERCEL_ENV === "preview",
  // Vercel serves https only; elsewhere FORCE_HTTPS=1 says the same.
  https: process.env.VERCEL === "1" || process.env.FORCE_HTTPS === "1",
};

const nextConfig: NextConfig = {
  /**
   * Standalone is for the Docker image only (the Dockerfile sets
   * DOCKER_BUILD=1). Vercel builds its own bundle and standalone output
   * confuses its file tracing, so it must stay off there.
   */
  ...(process.env.DOCKER_BUILD === "1" ? { output: "standalone" as const } : {}),
  /*
   * Story photos are resized for the reader's screen (next/image). Their
   * sources are uploads served by the API under /api/files/<uuid>: a file
   * never changes under its id, so the resized copies may be kept a year.
   * Only the stories pages use this; the event galleries keep plain <img>
   * (hundreds of photos per event would use up the host's image quota).
   */
  images: {
    localPatterns: [{ pathname: "/api/files/**" }],
    deviceSizes: [640, 828, 1080, 1280, 1920],
    imageSizes: [96, 256, 384],
    minimumCacheTTL: 31536000,
  },
  /* The event share image reads its font from disk; make sure it ships. */
  outputFileTracingIncludes: {
    "/e/[slug]/opengraph-image": ["./src/assets/fonts/**"],
  },
  async headers() {
    return [
      // Pages: the Content Security Policy and the rest (src/lib/securityHeaders.ts).
      { source: "/((?!api/).*)", headers: securityHeaders(headerOptions) },
      { source: "/api/:path*", headers: baseHeaders(headerOptions) },
      // The check-in scanners may use the camera; a later rule's header replaces an earlier one's.
      ...CAMERA_PAGES.map((source) => ({ source, headers: [{ key: "Permissions-Policy", value: permissionsPolicy({ camera: true }) }] })),
    ];
  },
  /**
   * Proxy unmatched /api/* to Express. Use fallback (not afterFiles):
   * afterFiles runs before some App Router API routes, so requests still
   * hit Express and 404. fallback runs last, after local route handlers.
   */
  /*
   * The separate Platform and Security pages were folded into the home page.
   * /welcome is the home page on every host (the marketing host serves it at
   * "/"), so old links land on the right section wherever they were opened.
   */
  async redirects() {
    return [
      { source: "/platform", destination: "/welcome#platform", permanent: true },
      { source: "/security", destination: "/welcome#faq", permanent: true },
      /* Stories were retired: the directory of hackathons covers past events. */
      { source: "/stories", destination: "/hackathons", permanent: true },
      { source: "/stories/:path*", destination: "/hackathons", permanent: true },
    ];
  },
  async rewrites() {
    return {
      fallback: [
        {
          source: "/api/:path*",
          destination: `${backendOrigin}/api/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
