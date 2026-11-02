import { pageMetadata } from "@/lib/pageMetadata";

/*
 * The page itself is a client component (it follows the reader's language)
 * and cannot export metadata, so its title, canonical URL and share tags live here.
 */
export const metadata = pageMetadata({
  title: "Terms of use",
  path: "/terms",
  description:
    "The rules for using HackOS — for the organisations that buy it and for everyone who takes part in their events.",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
