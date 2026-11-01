"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";

/**
 * Shown when a page had nothing to display *because the request failed*.
 *
 * Every list in the app used to treat a failed fetch and an genuinely empty
 * result the same way: the catch fired a toast, the toast faded after a few
 * seconds, and what stayed on screen was "No participants found." An organiser
 * whose session had expired, or who was on hotel wifi, was told their event was
 * empty. That is the worst thing this app can say to someone.
 *
 * Render this *instead of* the empty state when a load failed and there is
 * nothing to fall back on. When stale rows are still on screen a failed
 * refresh is a toast, not this — the data the user is looking at is real.
 */
export function LoadFailure({
  onRetry,
  retrying = false,
  message,
  compact = false,
}: {
  onRetry?: () => void;
  retrying?: boolean;
  /** Overrides the default line when a page can say something more specific. */
  message?: string;
  /** Sits inside an existing card (no border of its own). */
  compact?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      data-load-failure=""
      className={
        compact
          ? "px-4 py-10 text-center"
          : "rounded-xl border border-[#FFC107]/20 bg-[#FFC107]/[0.04] px-4 py-10 text-center"
      }
    >
      <AlertTriangle
        size={22}
        className="mx-auto mb-2.5 text-[var(--app-warn)]"
        aria-hidden="true"
      />
      <p className="text-[15px] font-medium text-white">
        {t("common.load_failed_title")}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-[var(--app-muted)]">
        {message || t("common.load_failed_body")}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/15 px-3.5 py-2 text-[15px] font-medium text-white transition-colors hover:bg-white/5 disabled:opacity-50"
        >
          <RefreshCw
            size={14}
            className={retrying ? "animate-spin" : undefined}
          />
          {retrying ? t("common.retrying") : t("common.retry")}
        </button>
      )}
    </div>
  );
}
