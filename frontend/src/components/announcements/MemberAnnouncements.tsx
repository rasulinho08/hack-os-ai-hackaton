"use client";

/**
 * Announcements as a participant, judge, mentor or volunteer reads them:
 * the ones meant for them in their event(s), newest first, the important
 * ones marked — and the card that connects their Telegram, so the next ones
 * arrive there too.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Megaphone, Send } from "lucide-react";
import { Badge } from "@/components/ds/primitives";
import { LoadFailure } from "@/components/LoadFailure";
import { TelegramConnectCard } from "@/components/announcements/TelegramConnectCard";
import { useTranslation } from "@/contexts/LanguageContext";
import { fetchAnnouncementsForEvents, forStaff, safeFormatAnnouncementTime, type NormalizedAnnouncement } from "@/lib/announcements";
import { myEventsAs } from "@/lib/workspaces";

export function MemberAnnouncements({
  loadEventIds, title, subtitle, empty, staffRole,
}: {
  /** The events whose announcements to show (the person's own). */
  loadEventIds: () => Promise<number[]>;
  title: string;
  subtitle?: string;
  empty: string;
  /** A staff page: only posts for the staff and the organisers' posts to everyone, each with its event's name. */
  staffRole?: "mentor" | "volunteer";
}) {
  const { t, lang } = useTranslation();
  const [items, setItems] = useState<NormalizedAnnouncement[]>([]);
  const [eventNames, setEventNames] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ids = await loadEventIds();
      const list = await fetchAnnouncementsForEvents(ids);
      setItems(staffRole ? forStaff(list, staffRole) : list);
      if (staffRole && ids.length > 1) {
        const mine = await myEventsAs(staffRole).catch(() => []);
        setEventNames(new Map(mine.map((e) => [e.id, e.name])));
      }
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [loadEventIds, staffRole]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{title}</h1>
        {subtitle ? <p className="mt-1 text-[15px]" style={{ color: "var(--ink-2)" }}>{subtitle}</p> : null}
      </div>

      <TelegramConnectCard compact />

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin" style={{ color: "var(--accent-solid)" }} aria-label="…" />
        </div>
      ) : items.length === 0 && failed ? (
        <LoadFailure onRetry={() => void load()} retrying={loading} />
      ) : items.length === 0 ? (
        <p className="rounded-[var(--radius)] border border-dashed py-10 text-center text-[15px]" style={{ borderColor: "var(--line-strong)", color: "var(--ink-3)" }}>{empty}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((a) => {
            const loud = a.type === "urgent" || a.type === "warning";
            return (
              <li
                key={a.id}
                className="flex gap-3 rounded-[var(--radius)] border p-5"
                style={{
                  borderColor: a.type === "urgent" ? "var(--danger)" : "var(--line)",
                  background: a.type === "urgent" ? "var(--danger-weak)" : "var(--surface)",
                }}
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)]"
                  style={{ background: a.type === "urgent" ? "var(--danger-weak)" : a.type === "warning" ? "var(--warn-weak)" : "var(--tint)", color: a.type === "urgent" ? "var(--danger)" : a.type === "warning" ? "var(--warn)" : "var(--ink-2)" }}
                >
                  {loud ? <AlertTriangle size={15} /> : <Megaphone size={15} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="flex flex-wrap items-center gap-1.5 text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
                      {a.title}
                      {a.type === "urgent" ? <Badge tone="danger">{t("an.badge.urgent")}</Badge> : a.type === "warning" ? <Badge tone="warn">{t("an.badge.important")}</Badge> : null}
                      {a.source === "TELEGRAM" ? <Badge tone="info"><Send size={11} aria-hidden="true" />{t("an.badge.telegram")}</Badge> : null}
                    </h2>
                    <time className="shrink-0 text-[12px]" style={{ color: "var(--ink-3)" }} dateTime={a.created_at}>
                      {safeFormatAnnouncementTime(a.created_at, lang)}
                    </time>
                  </div>
                  {a.eventId != null && eventNames.get(a.eventId) ? (
                    <p className="mt-0.5 text-[12px] font-medium" style={{ color: "var(--ink-3)" }}>{eventNames.get(a.eventId)}</p>
                  ) : null}
                  <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{a.content}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
