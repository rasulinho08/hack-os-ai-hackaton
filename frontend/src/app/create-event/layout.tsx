import type { Metadata } from "next";

/* The page is a client component; its tab title lives here. */
export const metadata: Metadata = {
  title: "Create event",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
