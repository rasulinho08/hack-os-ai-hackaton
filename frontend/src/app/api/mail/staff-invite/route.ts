import type { NextRequest } from "next/server";
import { proxyToBackendMail } from "@/lib/proxyBackendMail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Proxies to Express `/api/mail/staff-invite` (SMTP on API host). */
export async function POST(req: NextRequest) {
  return proxyToBackendMail(req, {
    path: "/api/mail/staff-invite",
    method: "POST",
  });
}
