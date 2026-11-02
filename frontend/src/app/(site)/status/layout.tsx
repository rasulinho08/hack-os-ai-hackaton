import { pageMetadata } from "@/lib/pageMetadata";

/* The page follows the reader's language in the browser, so its title and share tags live here. */
export const metadata = pageMetadata({
  title: "Status",
  path: "/status",
  description: "Whether HackOS works right now: the API, the database, background jobs and e-mail.",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
