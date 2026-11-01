import type { Metadata } from "next";
import { VerifyEmailView } from "@/components/verify/VerifyEmailView";

/*
 * The link in the confirmation e-mail: /verify-email?token=…. The page
 * confirms the address from the browser (a POST), so a mail scanner that
 * only fetches the link does not use it up. Never indexed.
 */

export const metadata: Metadata = {
  title: "Confirm your e-mail",
  description: "Confirm the e-mail address of your HackOS account.",
  robots: { index: false, follow: false, nocache: true },
};

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function VerifyEmailPage({ searchParams }: Params) {
  const sp = await searchParams;
  const raw = typeof sp.token === "string" ? sp.token.trim() : "";
  // The API's tokens are base64url, 43 characters; anything else cannot be one.
  const token = /^[A-Za-z0-9_-]{16,200}$/.test(raw) ? raw : null;
  return <VerifyEmailView token={token} />;
}
