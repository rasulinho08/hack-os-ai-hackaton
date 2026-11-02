import { pageMetadata } from "@/lib/pageMetadata";

/*
 * The page itself is a client component and cannot export metadata, so its
 * title, canonical URL and share tags live here.
 */
export const metadata = pageMetadata({
  title: "Sign in",
  path: "/signin",
  description:
    "Sign in to your HackOS account to manage your organisation, orders and events.",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
