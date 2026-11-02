import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteFooter, SiteHeader } from "./_chrome";
import { PlatformNotice } from "@/components/notices/PlatformNotice";
import { SiteRoot } from "./_theme";
import { SITE_DESCRIPTION } from "@/lib/site";

/*
 * The public site loads its own faces, declared here so a judge scoring
 * projects on a phone never pays for marketing typography.
 *
 * Geist for text and display: tight, technical and neutral, it carries a
 * very large headline without drifting into decoration. Geist Mono for
 * chapter markers, labels and figures.
 */
const sans = Geist({
  subsets: ["latin", "latin-ext", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-site",
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
  variable: "--font-mono-ui",
  display: "swap",
});

export const metadata: Metadata = {
  description: SITE_DESCRIPTION,
};

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <SiteRoot className={`${sans.variable} ${mono.variable}`}>
      {/* The owner's notice (maintenance, an incident), above the floating header. */}
      <PlatformNotice frame="px-3 pt-3 sm:px-5 sm:pt-4" className="mx-auto max-w-6xl" />
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </SiteRoot>
  );
}
