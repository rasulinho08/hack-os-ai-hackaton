import type { NextRequest } from "next/server";
import { proxyToBackendMail } from "@/lib/proxyBackendMail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Proxies to Express `/api/mail/status` (SMTP readiness on API host). */
export async function GET(req: NextRequest) {
  return proxyToBackendMail(req, { path: "/api/mail/status", method: "GET" });
}
