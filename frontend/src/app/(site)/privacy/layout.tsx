import { pageMetadata } from "@/lib/pageMetadata";

/*
 * The page itself is a client component (it follows the reader's language)
 * and cannot export metadata, so its title, canonical URL and share tags live here.
 */
export const metadata = pageMetadata({
  title: "Privacy policy",
  path: "/privacy",
  description:
    "What personal data HackOS keeps, why, who helps run the service, how long the data stays and how to reach us about it.",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
