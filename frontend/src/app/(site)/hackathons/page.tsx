import type { Metadata } from "next";
import { DirectoryView } from "./DirectoryView";
import { fetchDirectory } from "@/lib/directoryFetch";
import { directoryJsonLd, directorySearch, isFiltered, jsonForScript, parseDirectoryQuery } from "@/lib/directory";
import { SITE_URL } from "@/lib/site";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/*
 * A filtered or later page is the same list seen another way: crawlers are
 * pointed at the plain address and asked not to index the variants.
 */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = parseDirectoryQuery(await searchParams);
  return isFiltered(q) || q.page > 1 ? { robots: { index: false, follow: true } } : {};
}

/* The listed events, read on the server so the list (and its markup for search engines) is in the page's HTML. */
export default async function HackathonsPage({ searchParams }: Props) {
  const query = parseDirectoryQuery(await searchParams);
  const data = await fetchDirectory(JSON.stringify(query));
  const jsonLd = data && data.items.length ? directoryJsonLd(data.items, SITE_URL, `/hackathons${directorySearch(query)}`) : null;
  return (
    <>
      {jsonLd ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonForScript(jsonLd) }} /> : null}
      <DirectoryView data={data} query={query} />
    </>
  );
}
