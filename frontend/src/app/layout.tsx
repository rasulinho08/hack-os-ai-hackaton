import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

/*
 * One title template for the whole app. Route groups and pages supply only
 * the part that differs ("Pricing", "Judge Dashboard"); the suffix is added
 * here, once. Nothing below this layout should write "| HackOS" itself or the
 * tab reads "… | HackOS | HackOS", which is what production showed.
 *
 * metadataBase makes the Open Graph image and canonical URLs absolute, which
 * Slack, LinkedIn and Telegram require before they render a preview card.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "en_GB",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

// Mobile viewport: width=device-width is mandatory or every page renders
// at desktop width on phones. viewport-fit=cover lets us draw under the
// iPhone notch / Android gesture bar and pair with the .pb-safe / .pt-safe
// helpers in globals.css to inset content correctly. We allow zoom so the
// app stays accessible.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#111111",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
