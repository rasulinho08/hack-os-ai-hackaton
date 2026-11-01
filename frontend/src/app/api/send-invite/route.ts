import type { NextRequest } from "next/server";
import { proxyToBackendMail } from "@/lib/proxyBackendMail";

/** @deprecated Prefer POST `/api/mail/staff-invite`. Proxies to API (SMTP on backend). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return proxyToBackendMail(req, {
    path: "/api/mail/staff-invite",
    method: "POST",
  });
}
