import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { VerifyView, type VerifyResult } from "@/components/wrapup/VerifyView";
import { getBackendOrigin } from "@/lib/backendOrigin";
import { isCodeShape, normaliseCode, normalizePublic, verifyPath, type PublicCertificate } from "@/lib/certificates";

/*
 * The public check of a certificate: /verify/ABCD-EFGH-JKLM, the link on
 * every certificate and in the e-mail that sends it. Read on the server,
 * straight from the API and never cached (a certificate can be revoked at
 * any moment). Kept out of search engines: it shows a person's name.
 */

type Params = { params: Promise<{ code: string }> };

export const metadata: Metadata = {
  title: "Certificate check",
  description: "Check that a certificate issued through HackOS is genuine.",
  robots: { index: false, follow: false, nocache: true },
};

async function fetchCertificate(code: string): Promise<{ result: VerifyResult; cert: PublicCertificate | null }> {
  if (!isCodeShape(code)) return { result: "not_found", cert: null };
  try {
    const res = await fetch(`${getBackendOrigin()}/api/public/certificates/${encodeURIComponent(code)}`, { cache: "no-store" });
    if (res.status === 404) return { result: "not_found", cert: null };
    if (!res.ok) return { result: "error", cert: null };
    const json = await res.json();
    const cert = normalizePublic(json?.data);
    return cert ? { result: "ok", cert } : { result: "not_found", cert: null };
  } catch {
    return { result: "error", cert: null };
  }
}

export default async function VerifyPage({ params }: Params) {
  const { code: raw } = await params;
  let typed = raw;
  try {
    typed = decodeURIComponent(raw);
  } catch {
    /* keep it as it came */
  }
  const code = normaliseCode(typed);
  // ABCDEFGHJKLM, abcd-efgh-jklm, "ABCD EFGH JKLM" → one address for each certificate.
  if (isCodeShape(code) && code !== typed) redirect(verifyPath(code));
  const { result, cert } = await fetchCertificate(code);
  return <VerifyView code={code} result={result} cert={cert} />;
}
