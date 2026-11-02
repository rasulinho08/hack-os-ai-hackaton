"use client";

/**
 * The signed-in person's calendar feed: one private link (GET /api/me/calendar)
 * with every event they are part of — dates, deadlines, and what is theirs
 * (a judge's judging window, a team's presentation slot). Calendar apps
 * subscribe to it and refresh it themselves. Making a new link
 * (POST /api/me/calendar/reset) kills the old one everywhere.
 *
 * `compact` drops the explanation, for a page where the card sits at the end.
 */

import { useCallback, useEffect, useId, useState } from "react";
import { CalendarPlus, Copy, ExternalLink, RefreshCw, RotateCcw } from "lucide-react";
import { Button, buttonLook, cx } from "@/components/ds/primitives";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { apiGet, apiPost, isDemoApiEnabled } from "@/lib/api";
import { googleSubscribeUrl, normalizeFeed, type CalendarFeed } from "@/lib/calendar";

export function CalendarFeedCard({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [feed, setFeed] = useState<CalendarFeed | "failed" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const inputId = useId();

  const load = useCallback(async () => {
    const next = normalizeFeed(await apiGet<unknown>("/api/me/calendar"));
    if (!next) throw new Error("no feed");
    return next;
  }, []);

  useEffect(() => {
    // The walkthrough has no account to make a feed for.
    if (isDemoApiEnabled()) return;
    let cancelled = false;
    load().then(
      (f) => { if (!cancelled) setFeed(f); },
      () => { if (!cancelled) setFeed("failed"); },
    );
    return () => { cancelled = true; };
  }, [load]);

  const retry = async () => {
    setRetrying(true);
    try {
      setFeed(await load());
    } catch {
      setFeed("failed");
    } finally {
      setRetrying(false);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast(t("cal.copied"), "success");
    } catch {
      toast(t("cal.copy_failed"), "info");
    }
  };

  const reset = async () => {
    setConfirming(false);
    setResetting(true);
    try {
      const next = normalizeFeed(await apiPost<unknown>("/api/me/calendar/reset", {}));
      if (next) setFeed(next);
      toast(t("cal.reset_done"), "success");
    } catch {
      toast(t("cal.reset_failed"), "error");
    } finally {
      setResetting(false);
    }
  };

  if (feed === null) return null;

  const frame = cx("rounded-[var(--radius)] border p-5", className);
  const frameStyle = { borderColor: "var(--line)", background: "var(--surface)" };
  const heading = (
    <h2 className="flex items-center gap-2 text-[16px] font-semibold" style={{ color: "var(--ink)" }}>
      <CalendarPlus size={17} aria-hidden="true" style={{ color: "var(--accent)" }} /> {t("cal.feed_title")}
    </h2>
  );

  if (feed === "failed") {
    return (
      <section className={frame} style={frameStyle} aria-label={t("cal.feed_title")}>
        {heading}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13.5px]" style={{ color: "var(--ink-2)" }}>{t("cal.load_failed")}</p>
          <Button size="sm" icon={<RefreshCw size={13} className={retrying ? "animate-spin" : undefined} />} onClick={() => void retry()} disabled={retrying}>
            {t("cal.retry")}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className={frame} style={frameStyle} aria-label={t("cal.feed_title")}>
      {heading}
      {compact ? null : <p className="mt-1 max-w-prose text-[13.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{t("cal.feed_body")}</p>}

      <label htmlFor={inputId} className="mt-4 block text-[12px] font-medium" style={{ color: "var(--ink-3)" }}>{t("cal.link_label")}</label>
      <div className="mt-1 flex flex-col gap-2 sm:flex-row">
        <input
          id={inputId}
          readOnly
          value={feed.url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-[var(--radius-sm)] border px-3 py-2 font-mono text-[12px] outline-none focus:ring-2"
          style={{ background: "var(--surface-sunken)", color: "var(--ink-2)", borderColor: "var(--line-strong)", ["--tw-ring-color" as string]: "var(--accent-weak)" }}
        />
        <Button size="sm" icon={<Copy size={13} />} onClick={() => void copy(feed.url)}>{t("cal.copy")}</Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <a href={googleSubscribeUrl(feed.webcal)} target="_blank" rel="noopener noreferrer" {...buttonLook("primary", "sm")}>
          <ExternalLink size={13} aria-hidden="true" /> {t("cal.add_google")}
        </a>
        <a href={feed.webcal} {...buttonLook("secondary", "sm")}>
          <CalendarPlus size={13} aria-hidden="true" /> {t("cal.add_apple")}
        </a>
        <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} loading={resetting} disabled={resetting} onClick={() => setConfirming(true)}>
          {t("cal.reset")}
        </Button>
      </div>

      <p className="mt-3 text-[12.5px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
        {t("cal.feed_private")} {t("cal.feed_plan_note")}
      </p>

      <ConfirmDialog
        open={confirming}
        title={t("cal.reset_title")}
        message={t("cal.reset_body")}
        confirmLabel={t("cal.reset_confirm")}
        cancelLabel={t("cal.cancel")}
        variant="danger"
        onConfirm={() => void reset()}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
