import { pageMetadata } from "@/lib/pageMetadata";

/*
 * The page itself is a client component and cannot export metadata, so its
 * title, canonical URL and share tags live here.
 */
export const metadata = pageMetadata({
  title: null,
  path: "/",
  description:
    "Run registration, teams, submissions, weighted judging, results and reporting in one system, with separate views for organisers, judges, mentors, participants and volunteers.",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
