import { pageMetadata } from "@/lib/pageMetadata";

/*
 * The page itself is a client component and cannot export metadata, so its
 * title, canonical URL and share tags live here.
 */
export const metadata = pageMetadata({
  title: "Solutions",
  path: "/solutions",
  description:
    "HackOS for universities, corporates, accelerators and the public sector: annual programmes, recruitment hackathons, demo days and procurement-ready deployments.",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
