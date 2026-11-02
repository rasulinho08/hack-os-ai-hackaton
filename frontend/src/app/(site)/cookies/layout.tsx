import { pageMetadata } from "@/lib/pageMetadata";

/*
 * The page itself is a client component (it follows the reader's language)
 * and cannot export metadata, so its title, canonical URL and share tags live here.
 */
export const metadata = pageMetadata({
  title: "Cookie policy",
  path: "/cookies",
  description:
    "The cookies and browser storage HackOS uses and how long each one lasts. No advertising or analytics cookies.",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
