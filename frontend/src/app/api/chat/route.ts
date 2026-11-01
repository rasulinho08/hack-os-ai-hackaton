import { NextResponse } from "next/server";
import { EVENT_CREATOR_CHATBOT_SYSTEM } from "@/lib/chatbotSystemPrompt";
import {
  fetchBackendSession,
  isAuthenticated,
  isOrganizerChatRole,
} from "@/lib/backendAuth";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Default: OpenRouter free tier (override with OPENROUTER_MODEL). */
const DEFAULT_OPENROUTER_MODEL = "qwen/qwen3.6-plus-preview:free";

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

function sanitizeMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ChatMessage[] = [];
  for (const m of raw.slice(-24)) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    const role = o.role;
    const content = o.content;
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const trimmed = content.trim().slice(0, 8000);
    if (!trimmed) continue;
    out.push({ role, content: trimmed });
  }
  if (out.length === 0) return null;
  return out;
}

export async function POST(req: Request) {
  const session = await fetchBackendSession(req.headers.get("cookie"));
  // Treat a transient backend hiccup ("network") as a soft error so the
  // chat panel can show a retry hint instead of pretending the user is
  // signed out (problem 21).
  if (session === "network") {
    return NextResponse.json(
      {
        success: false,
        message:
          "Couldn't verify your session right now (backend temporarily unreachable). Please retry.",
        error: "Backend unavailable",
      },
      { status: 503 }
    );
  }
  if (!isAuthenticated(session)) {
    return NextResponse.json(
      { success: false, message: "Unauthorized", error: "Unauthorized" },
      { status: 401 }
    );
  }
  if (!isOrganizerChatRole(session.role)) {
    return NextResponse.json(
      {
        success: false,
        message: "Forbidden: organizer role required",
        error: "Forbidden",
      },
      { status: 403 }
    );
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Chat is not configured (missing OPENROUTER_API_KEY)." },
      { status: 503 }
    );
  }

  let body: { messages?: unknown; pathname?: unknown };
  try {
    body = (await req.json()) as { messages?: unknown; pathname?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messages = sanitizeMessages(body.messages);
  if (!messages) {
    return NextResponse.json({ error: "Invalid messages" }, { status: 400 });
  }

  const pathname =
    typeof body.pathname === "string" ? body.pathname.slice(0, 256) : "";
  const pathHint = pathname
    ? `\n\n[Context: user is viewing dashboard path: ${pathname}]`
    : "";

  const model =
    process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
  const siteUrlRaw =
    process.env.OPENROUTER_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "https://localhost";
  /** HTTP headers must be ISO-8859-1 / ASCII; URLs with Unicode break ByteString in fetch(). */
  const siteUrl = /^[\x00-\x7F]*$/.test(siteUrlRaw)
    ? siteUrlRaw
    : "https://localhost";

  try {
    const upstream = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": siteUrl,
        // ASCII only (no em dash / smart quotes) — OpenRouter requires valid header bytes
        "X-Title": "HackOS — Organiser Assistant",
      },
      body: JSON.stringify({
        model,
        temperature: 0.35,
        max_tokens: 1200,
        messages: [
          {
            role: "system",
            content: EVENT_CREATOR_CHATBOT_SYSTEM + pathHint,
          },
          ...messages,
        ],
      }),
    });

    const data = (await upstream.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };

    if (!upstream.ok) {
      const msg =
        data.error?.message ||
        (typeof data === "object" && data !== null && "message" in data
          ? String((data as { message?: string }).message)
          : null) ||
        `OpenRouter error (${upstream.status})`;
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const reply = data.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      return NextResponse.json({ error: "Empty model response" }, { status: 502 });
    }

    return NextResponse.json({ reply });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Request failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
