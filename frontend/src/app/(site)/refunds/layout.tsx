import { pageMetadata } from "@/lib/pageMetadata";

/*
 * The page itself is a client component (it follows the reader's language)
 * and cannot export metadata, so its title, canonical URL and share tags live here.
 */
export const metadata = pageMetadata({
  title: "Refund policy",
  path: "/refunds",
  description:
    "How HackOS orders are reviewed and activated, what happens to a payment when an order is not activated, and how to ask for a refund.",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
