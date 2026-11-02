"use client";

/**
 * The organiser's announcements: write one (for whom, where, when), follow
 * how it is delivered, correct or cancel it; connect the event's Telegram
 * channel. Everything is decided and delivered by the API; this page polls
 * while something is still on its way.
 */

import { useCallback, useEffect, useState } from "react";
import { Bot, Settings2 } from "lucide-react";
import { BrandLoader } from "@/components/BrandLoader";
import { LoadFailure } from "@/components/LoadFailure";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Composer, type ComposerTrack } from "@/components/announcements/Composer";
import { AnnouncementRow } from "@/components/announcements/AnnouncementRow";
import { TelegramChannelCard } from "@/components/announcements/TelegramChannelCard";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { hasPending, normalizeAdminList, type AdminAnnouncement } from "@/lib/announcementsAdmin";

const POLL_MS = 6_000;

export default function AnnouncementsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { activeEventId, loading: eventLoading } = useActiveEvent();
  const [list, setList] = useState<AdminAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [timeZone, setTimeZone] = useState("Asia/Baku");
  const [tracks, setTracks] = useState<ComposerTrack[]>([]);
  const [editing, setEditing] = useState<AdminAnnouncement | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "delete" | "cancel"; a: AdminAnnouncement } | null>(null);

  const load = useCallback(async () => {
    if (activeEventId == null) return;
    try {
      setList(normalizeAdminList(await apiGet<unknown[]>(`/api/announcements?eventId=${activeEventId}`)));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [activeEventId]);

  useEffect(() => {
    if (eventLoading) return;
    if (activeEventId == null) {
      setList([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setEditing(null);
    void load();
    // The event's own time zone for scheduling, and its tracks for the audience.
    apiGet<{ timezone?: string }>(`/api/events/${activeEventId}`)
      .then((e) => setTimeZone(e?.timezone || "Asia/Baku"))
      .catch(() => setTimeZone("Asia/Baku"));
    apiGet<unknown[]>(`/api/events/${activeEventId}/tracks`)
      .then((rows) => setTracks(
        (Array.isArray(rows) ? rows : [])
          .map((r) => r as { id?: unknown; name?: unknown })
          .filter((r) => Number(r.id) > 0 && String(r.name ?? "").trim())
          .map((r) => ({ id: Number(r.id), name: String(r.name) })),
      ))
      .catch(() => setTracks([]));
  }, [activeEventId, eventLoading, load]);

  // Keep the counts moving while messages are on their way or one is scheduled.
  const pending = list.some(hasPending);
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pending, load]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast(done, "success");
      await load();
    } catch {
      toast(t("an.toast.failed"), "error");
    }
  };

  const onConfirm = async () => {
    if (!confirm) return;
    const { kind, a } = confirm;
    setConfirm(null);
    if (kind === "delete") {
      if (editing?.id === a.id) setEditing(null);
      await act(() => apiDelete(`/api/announcements/${a.id}`), t("an.toast.deleted"));
    } else {
      await act(() => apiPost(`/api/announcements/${a.id}/cancel`, {}), t("an.toast.cancelled"));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("an.title")}</h1>
        <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>{t("an.subtitle")}</p>
      </div>

      {activeEventId == null && !eventLoading ? (
        <p className="py-10 text-center text-[15px]" style={{ color: "var(--ink-3)" }}>{t("an.no_event")}</p>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-6">
            {activeEventId != null ? (
              <Composer
                eventId={activeEventId}
                timeZone={timeZone}
                tracks={tracks}
                editing={editing}
                onSaved={() => void load()}
                onCancelEdit={() => setEditing(null)}
              />
            ) : null}

            <section aria-labelledby="an-list-title" className="space-y-3">
              <h2 id="an-list-title" className="text-[13px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{t("an.list")}</h2>
              {loading ? (
                <BrandLoader size={52} message={null} fullMinHeight={false} minimal className="py-10" />
              ) : failed && list.length === 0 ? (
                <LoadFailure compact onRetry={() => void load()} />
              ) : list.length === 0 ? (
                <p className="rounded-[var(--radius)] border border-dashed py-10 text-center text-[14px]" style={{ borderColor: "var(--line-strong)", color: "var(--ink-3)" }}>{t("an.empty")}</p>
              ) : (
                list.map((a) => (
                  <AnnouncementRow
                    key={a.id}
                    a={a}
                    timeZone={timeZone}
                    onEdit={() => {
                      setEditing(a);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    onSendNow={() => void act(() => apiPost(`/api/announcements/${a.id}/send-now`, {}), t("an.toast.published"))}
                    onCancel={() => setConfirm({ kind: "cancel", a })}
                    onDelete={() => setConfirm({ kind: "delete", a })}
                  />
                ))
              )}
            </section>
          </div>

          <aside className="min-w-0 space-y-4 lg:sticky lg:top-4">
            {activeEventId != null ? <TelegramChannelCard eventId={activeEventId} /> : null}
            <section className="rounded-[var(--radius)] border p-5" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
              <h3 className="flex items-center gap-2 text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
                <Bot size={15} aria-hidden="true" /> {t("an.auto_title")}
              </h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: "var(--ink-3)" }}>{t("an.auto_body")}</p>
              {activeEventId != null ? (
                <a
                  href={`/create-event/${activeEventId}?section=communication`}
                  className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium underline-offset-2 hover:underline"
                  style={{ color: "var(--accent)" }}
                >
                  <Settings2 size={13} aria-hidden="true" /> {t("an.auto_link")}
                </a>
              ) : null}
            </section>
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === "cancel" ? t("an.confirm_cancel_t") : t("an.confirm_delete_t")}
        message={confirm?.kind === "cancel" ? t("an.confirm_cancel_b") : t("an.confirm_delete_b")}
        confirmLabel={confirm?.kind === "cancel" ? t("an.confirm_yes_cancel") : t("an.confirm_yes_delete")}
        cancelLabel={t("an.confirm_no")}
        variant="danger"
        onConfirm={() => void onConfirm()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
