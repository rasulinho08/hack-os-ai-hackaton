import { pageMetadata } from "@/lib/pageMetadata";
import { DIRECTORY_COPY } from "./copy";

/*
 * The directory follows the reader's language in the browser, so its title,
 * canonical address and share tags are the English ones, set here.
 */
export const metadata = pageMetadata({
  title: DIRECTORY_COPY.en.meta.title,
  path: "/hackathons",
  description: DIRECTORY_COPY.en.meta.description,
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
