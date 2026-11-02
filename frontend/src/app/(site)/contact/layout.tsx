import { pageMetadata } from "@/lib/pageMetadata";

/*
 * The page itself is a client component and cannot export metadata, so its
 * title, canonical URL and share tags live here.
 */
export const metadata = pageMetadata({
  title: "Contact",
  path: "/contact",
  description:
    "Tell us about your event — dates, participants, judging — and we will come back with a quote and a walkthrough of the platform.",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
