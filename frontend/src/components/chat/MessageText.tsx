"use client";

import { linkify } from "@/lib/chat";

/**
 * A message's words: plain text with its line breaks, web addresses as links
 * that open in a new tab without telling the site where they came from.
 * Never HTML — what someone typed is shown, not run.
 */
export function MessageText({ text }: { text: string }) {
  return (
    <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      {linkify(text).map((part, i) =>
        part.type === "link" ? (
          <a
            key={i}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="underline underline-offset-2"
            style={{ color: "var(--accent)" }}
          >
            {part.value}
          </a>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </span>
  );
}
