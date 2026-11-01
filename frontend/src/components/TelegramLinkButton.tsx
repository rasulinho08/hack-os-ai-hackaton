"use client";

/**
 * TelegramLinkButton
 * -------------------------------------------------------------------
 * Header/sidebar button that opens the event's public Telegram channel
 * (or chatbot) in a new tab. Visible to every authenticated user so
 * they can stay in sync with announcements and contact organizers.
 *
 * URL resolution order:
 *   1. `NEXT_PUBLIC_TELEGRAM_CHANNEL_URL` (full URL, preferred)
 *   2. `NEXT_PUBLIC_TELEGRAM_USERNAME` (handle without @ → `https://t.me/<handle>`)
 *
 * Nothing is rendered when neither is set, or when the URL is set to "off".
 * There is deliberately no built-in channel: the old fallback pointed every
 * deployment at one specific organiser's channel, so anyone who had not
 * configured Telegram was quietly sending their participants somewhere else.
 */
export function TelegramLinkButton({
  title = "Telegram channel",
  className,
}: {
  title?: string;
  className?: string;
}) {
  const raw = process.env.NEXT_PUBLIC_TELEGRAM_CHANNEL_URL?.trim();
  if (raw === "off") return null;

  const handle = process.env.NEXT_PUBLIC_TELEGRAM_USERNAME?.trim().replace(
    /^@/,
    "",
  );
  const fromHandle =
    handle && handle.length > 0 ? `https://t.me/${handle}` : "";

  const url = raw && raw.length > 0 ? raw : fromHandle;
  if (!url) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      aria-label={title}
      className={
        className ??
        "theme-text-muted rounded-lg p-2 opacity-70 transition-colors hover:bg-[#229ED9]/10 hover:text-[#229ED9] hover:opacity-100"
      }
    >
      {/* Telegram logo — inline SVG (Lucide doesn't ship a Telegram icon) */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.14-.26.26-.53.26l.188-2.685 4.894-4.422c.212-.19-.047-.295-.328-.106l-6.048 3.807-2.607-.814c-.566-.176-.578-.566.118-.837l10.19-3.928c.472-.176.885.106.733.837z" />
      </svg>
    </a>
  );
}
