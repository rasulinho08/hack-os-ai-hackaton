import { pageMetadata } from "@/lib/pageMetadata";

/*
 * The page itself is a client component and cannot export metadata, so its
 * title, canonical URL and share tags live here.
 */
export const metadata = pageMetadata({
  title: "Pricing",
  path: "/pricing",
  description:
    "Priced per organisation, not per seat. Single-event and annual programme plans, with a quoted Enterprise tier for your own domain and infrastructure.",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
