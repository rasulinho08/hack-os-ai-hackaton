import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { DEFAULT_BACKEND_URL } from "@/lib/backendAuth";

const base = () => DEFAULT_BACKEND_URL.replace(/\/$/, "");

/**
 * Forwards mail endpoints to Express so SMTP env lives on the API host only.
 */
export async function proxyToBackendMail(
  req: NextRequest,
  opts: { path: string; method: "GET" | "POST" },
): Promise<NextResponse> {
  const url = `${base()}${opts.path}`;
  const headers: Record<string, string> = {
    cookie: req.headers.get("cookie") || "",
  };
  const init: RequestInit = {
    method: opts.method,
    headers,
    cache: "no-store",
  };
  if (opts.method === "POST") {
    headers["content-type"] =
      req.headers.get("content-type") || "application/json";
    init.body = await req.text();
  }
  const res = await fetch(url, init);
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") || "application/json",
    },
  });
}
