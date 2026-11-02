"use client";

/**
 * One channel: its name and what it is for, the conversation, and the box
 * to write in — with the organisers' tools (lock the channel, remove a
 * message, mute its author) and everyone else's (remove their own, report).
 */

import { useState } from "react";
import { ArrowLeft, Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ds/primitives";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Composer } from "@/components/chat/Composer";
import { MessageList, type MessageActions } from "@/components/chat/MessageList";
import { MuteDialog, ReportDialog } from "@/components/chat/Dialogs";
import { channelLabel } from "@/components/chat/labels";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { useChatThread } from "@/hooks/useChatThread";
import { DemoReadOnlyError } from "@/lib/api";
import { chatApi, chatErrorKey, type ChannelSummary, type ChatMessage, type MuteChoice } from "@/lib/chat";
import { formatDate } from "@/lib/i18n/dates";
import { fill } from "@/lib/i18n/fill";

export interface ThreadViewer {
  /** Organises this event (sees and moderates every channel). */
  organizer: boolean;
  muted: boolean;
  mutedUntil: string | null;
}

export function ChatThread({
  eventId, channel, viewer, archived, onArchived, onActivity, onBack, onLockChange, bare = false,
}: {
  /** Inside a drawer that already names the channel: no header of its own. */
  bare?: boolean;
  eventId: number;
  channel: ChannelSummary;
  viewer: ThreadViewer;
  archived: boolean;
  /** A write was refused because the event is archived. */
  onArchived?: () => void;
  /** Something changed that the channel list shows (read marks, new messages). */
  onActivity?: () => void;
  /** On phones: back to the channel list. */
  onBack?: () => void;
  onLockChange?: (locked: boolean) => void;
}) {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const thread = useChatThread(eventId, channel.id, { onActivity });
  const [toRemove, setToRemove] = useState<ChatMessage | null>(null);
  const [toReport, setToReport] = useState<ChatMessage | null>(null);
  const [toMute, setToMute] = useState<ChatMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [locking, setLocking] = useState(false);

  const { title, subtitle } = channelLabel(channel, viewer.organizer, t);
  const canModerate = channel.canModerate;
  const lockable = canModerate && (channel.kind === "general" || channel.kind === "team");

  const failed = (err: unknown) => {
    if (err instanceof DemoReadOnlyError) return;
    const key = chatErrorKey(err);
    if (key === "ch.err.EVENT_ARCHIVED") onArchived?.();
    toast(t(key), "error");
  };

  const reasonWhyNot = (): string | null => {
    if (archived) return t("ch.ro_archived");
    if (channel.canPost) return null;
    if (viewer.muted && !viewer.organizer) {
      return viewer.mutedUntil
        ? fill(t("ch.ro_muted_until"), { time: formatDate(viewer.mutedUntil, lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) })
        : t("ch.ro_muted");
    }
    if (channel.locked) return t("ch.ro_locked");
    return t("ch.ro_read_only");
  };

  const send = async (body: string) => {
    const result = await thread.send(body);
    if (!result.ok) {
      if (result.code === "EVENT_ARCHIVED") onArchived?.();
      // Muted, locked or read-only since the list was loaded: refresh what it says.
      if (result.code === "CHAT_MUTED" || result.code === "CHAT_LOCKED" || result.code === "CHAT_READ_ONLY") onActivity?.();
    }
    return true;
  };

  const actions: MessageActions = {
    onRemove: (m) => setToRemove(m),
    onReport: (m) => setToReport(m),
    onMute: (m) => setToMute(m),
    onRetry: (m) => { void thread.retry(m.id); },
    onDiscard: (m) => thread.discard(m.id),
  };

  const doRemove = async (m: ChatMessage) => {
    setBusy(true);
    try {
      await chatApi.remove(eventId, m.id);
      thread.markRemoved(m.id);
      toast(t("ch.removed_ok"), "success");
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  const doReport = async (m: ChatMessage, reason: string) => {
    setBusy(true);
    try {
      await chatApi.report(eventId, m.id, reason);
      setToReport(null);
      toast(t("ch.reported_ok"), "success");
    } catch (err) {
      // The walkthrough says itself that nothing is kept.
      if (err instanceof DemoReadOnlyError) setToReport(null);
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  const doMute = async (m: ChatMessage, minutes: MuteChoice, reason: string) => {
    if (!m.author) return;
    setBusy(true);
    try {
      await chatApi.mute(eventId, { userId: m.author.id, minutes, reason });
      setToMute(null);
      toast(fill(t("ch.muted_ok"), { name: m.author.name || t("ch.someone") }), "success");
    } catch (err) {
      if (err instanceof DemoReadOnlyError) setToMute(null);
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  const toggleLock = async () => {
    setLocking(true);
    try {
      await chatApi.lock(eventId, channel.id, !channel.locked);
      onLockChange?.(!channel.locked);
      toast(t(channel.locked ? "ch.unlocked_ok" : "ch.locked_ok"), "success");
      onActivity?.();
    } catch (err) {
      failed(err);
    } finally {
      setLocking(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {bare ? null : (
      <div className="flex items-start justify-between gap-3 border-b px-3 py-3 sm:px-4" style={{ borderColor: "var(--line)" }}>
        <div className="flex min-w-0 items-start gap-2">
          {onBack ? (
            <button type="button" onClick={onBack} aria-label={t("ch.back")} className="-ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md lg:hidden" style={{ color: "var(--ink-2)" }}>
              <ArrowLeft size={18} />
            </button>
          ) : null}
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 truncate text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
              {channel.locked ? <Lock size={14} aria-label={t("ch.locked")} style={{ color: "var(--warn)" }} /> : null}
              <span className="truncate">{title}</span>
            </h2>
            <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>{subtitle}</p>
          </div>
        </div>
        {lockable && !archived ? (
          <Button size="sm" variant="ghost" loading={locking} disabled={locking}
            icon={channel.locked ? <LockOpen size={14} /> : <Lock size={14} />} onClick={() => void toggleLock()}>
            {channel.locked ? t("ch.unlock") : t("ch.lock")}
          </Button>
        ) : null}
      </div>
      )}

      {thread.status === "loading" ? (
        <div className="flex-1 space-y-3 p-4" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="hs-skeleton h-12 rounded-[14px]" style={{ width: `${70 - i * 15}%`, marginLeft: i === 1 ? "auto" : undefined }} />
          ))}
        </div>
      ) : thread.status === "failed" ? (
        <p role="status" className="flex-1 px-4 py-12 text-center text-[13.5px]" style={{ color: "var(--ink-3)" }}>{t("ch.thread_failed")}</p>
      ) : thread.status === "gone" ? (
        <p role="status" className="flex-1 px-4 py-12 text-center text-[13.5px]" style={{ color: "var(--ink-3)" }}>{t("ch.thread_gone")}</p>
      ) : (
        <MessageList
          messages={thread.messages}
          hasMore={thread.hasMore}
          loadingOlder={thread.loadingOlder}
          onLoadOlder={() => { thread.loadOlder().catch(() => toast(t("ch.older_failed"), "error")); }}
          canModerate={canModerate}
          actions={actions}
          emptyText={t(`ch.empty.${channel.kind}`)}
          label={title}
        />
      )}

      {thread.status === "ready" ? (
        <Composer disabledReason={reasonWhyNot()} onSend={send} placeholder={fill(t("ch.write_to"), { name: title })} />
      ) : null}

      <ConfirmDialog
        open={Boolean(toRemove)}
        title={t("ch.remove_title")}
        message={toRemove?.mine ? t("ch.remove_own_body") : t("ch.remove_body")}
        confirmLabel={t("ch.remove")}
        cancelLabel={t("ch.cancel")}
        variant="danger"
        onCancel={() => setToRemove(null)}
        onConfirm={() => { const m = toRemove; setToRemove(null); if (m) void doRemove(m); }}
      />
      <ReportDialog
        key={`report-${toReport?.id ?? 0}`}
        open={Boolean(toReport)}
        busy={busy}
        onClose={() => setToReport(null)}
        onConfirm={(reason) => { if (toReport) void doReport(toReport, reason); }}
      />
      <MuteDialog
        key={`mute-${toMute?.id ?? 0}`}
        open={Boolean(toMute)}
        name={toMute?.author?.name || t("ch.someone")}
        busy={busy}
        onClose={() => setToMute(null)}
        onConfirm={(minutes, reason) => { if (toMute) void doMute(toMute, minutes, reason); }}
      />
    </div>
  );
}
