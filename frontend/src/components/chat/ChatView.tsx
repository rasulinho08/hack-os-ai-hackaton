"use client";

/**
 * The event chat for one person: their channels on the left (on a phone, a
 * screen of its own), the open channel on the right.
 *
 * The list comes back every thirty seconds while the tab is visible, and
 * sooner when the open channel had news, so unread counts stay true. A
 * `?c=<channel id>` in the address opens that channel (the notification
 * centre links there); choosing another one updates it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Archive, MessagesSquare, VolumeX } from "lucide-react";
import { EmptyState, buttonLook } from "@/components/ds/primitives";
import { Notice } from "@/components/builder/ui";
import { LoadFailure } from "@/components/LoadFailure";
import { ChannelList } from "@/components/chat/ChannelList";
import { ChatThread } from "@/components/chat/ChatThread";
import { useTranslation } from "@/contexts/LanguageContext";
import { useDemoBasePath } from "@/lib/demoPath";
import { useEventModules } from "@/lib/eventModules";
import { formatDate } from "@/lib/i18n/dates";
import { fill } from "@/lib/i18n/fill";
import { chatApi, sortChannels, type ChannelSummary, type ChatList } from "@/lib/chat";

const LIST_EVERY_MS = 30_000;
const SOON_MS = 3_000;

interface Loaded {
  eventId: number;
  data: ChatList | null;
  failed: boolean;
}

export function ChatView({
  eventId, initialChannelId = null, onLoaded, fitShell = false,
}: {
  eventId: number;
  initialChannelId?: number | null;
  /**
   * In the organiser console: the chat fills what is left of the window
   * under the page title and tabs, so the message box is on screen without
   * scrolling (1440×900, 1024×768).
   */
  fitShell?: boolean;
  /** Each fresh list (the organiser page counts open reports from it). */
  onLoaded?: (list: ChatList) => void;
}) {
  const { t, lang } = useTranslation();
  const demoBase = useDemoBasePath();
  // The plan's modules tell "not in the plan" from "switched off" (the list answers the same for both).
  const modules = useEventModules(eventId, !demoBase);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // A channel named in the address that the list does not show (organisers
  // see threads once they have messages): fetched on its own.
  const [linked, setLinked] = useState<ChannelSummary | null>(null);
  const [archivedFor, setArchivedFor] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(initialChannelId);
  const [pane, setPane] = useState<"list" | "thread">(initialChannelId ? "thread" : "list");
  // The address names another channel while the chat is open (a notification
  // followed from the header changes only ?c=): that one opens. Choosing a
  // channel here writes the same ?c=, which then changes nothing.
  const [followed, setFollowed] = useState(initialChannelId);
  if (initialChannelId !== followed) {
    setFollowed(initialChannelId);
    if (initialChannelId != null) {
      setSelectedId(initialChannelId);
      setPane("thread");
    }
  }
  const lastFetch = useRef(0);
  const soonTimer = useRef<number | null>(null);
  const onLoadedRef = useRef(onLoaded);

  useEffect(() => {
    onLoadedRef.current = onLoaded;
  });

  const refresh = useCallback(async () => {
    lastFetch.current = Date.now();
    try {
      const data = await chatApi.list(eventId);
      setLoaded({ eventId, data, failed: false });
      onLoadedRef.current?.(data);
    } catch {
      setLoaded((prev) => (prev && prev.eventId === eventId && prev.data ? prev : { eventId, data: null, failed: true }));
    }
  }, [eventId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) await refresh();
    })();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, LIST_EVERY_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (soonTimer.current != null) window.clearTimeout(soonTimer.current);
    };
  }, [eventId, refresh]);

  /** The open channel had news: the list follows, at most every few seconds. */
  const refreshSoon = useCallback(() => {
    if (soonTimer.current != null) return;
    const wait = Math.max(0, SOON_MS - (Date.now() - lastFetch.current));
    soonTimer.current = window.setTimeout(() => {
      soonTimer.current = null;
      void refresh();
    }, wait);
  }, [refresh]);

  const current = loaded && loaded.eventId === eventId ? loaded : null;
  const data = current?.data ?? null;
  // Archived per the list, or per a write the API refused since then.
  const archived = Boolean(data?.archived) || archivedFor === eventId;
  const missingLinked = Boolean(data && initialChannelId && !data.channels.some((c) => c.id === initialChannelId));
  useEffect(() => {
    if (!missingLinked || !initialChannelId || demoBase) return;
    let cancelled = false;
    chatApi.channel(eventId, initialChannelId)
      .then((ch) => { if (!cancelled && ch) setLinked(ch); })
      .catch(() => { /* not theirs, or gone: the first channel opens instead */ });
    return () => { cancelled = true; };
  }, [missingLinked, initialChannelId, eventId, demoBase]);
  const channels = useMemo(() => {
    if (!data) return [];
    const extra = linked && !data.channels.some((c) => c.id === linked.id) ? [linked] : [];
    return sortChannels([...extra, ...data.channels]);
  }, [data, linked]);
  const selected = channels.find((c) => c.id === selectedId) ?? channels[0] ?? null;

  const choose = (id: number) => {
    setSelectedId(id);
    setPane("thread");
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("c", String(id));
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      /* the address is a convenience */
    }
  };

  // Only organisers lock a channel, and they write in it either way.
  const setLocked = (channelId: number, locked: boolean) => {
    setLoaded((prev) => (prev && prev.data ? {
      ...prev,
      data: { ...prev.data, channels: prev.data.channels.map((c) => (c.id === channelId ? { ...c, locked } : c)) },
    } : prev));
  };

  if (!current) {
    return (
      <div className="grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)]" aria-busy="true">
        <div className="hs-skeleton h-64 rounded-[var(--radius)]" />
        <div className="hs-skeleton h-[420px] rounded-[var(--radius)]" />
      </div>
    );
  }
  if (!data) return <LoadFailure message={t("ch.load_failed")} onRetry={() => void refresh()} />;

  if (!channels.length) {
    // This page's own channels; help-request threads open from the requests themselves.
    const off = !(data.enabled.general || data.enabled.team || data.enabled.support);
    const planOff = data.chatModule === false || Boolean(modules && !modules.has("chat"));
    const state = planOff ? "plan" : off ? "off" : "none";
    const org = data.me.organizer;
    const words = {
      plan: [t("ch.plan_off_title"), t(org ? "ch.plan_off_body_org" : "ch.plan_off_body")],
      off: [t("ch.off_title"), t(org ? "ch.off_body_org" : "ch.off_body")],
      none: [t("ch.none_title"), t("ch.none_body")],
    }[state];
    return (
      <div className="rounded-[var(--radius)] border" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
        <EmptyState
          icon={<MessagesSquare size={19} />}
          title={words[0]}
          body={words[1]}
          action={org && state === "off" && !demoBase
            ? <Link href={`/create-event/${eventId}?section=communication`} {...buttonLook("secondary", "sm")}>{t("ch.open_settings")}</Link>
            : undefined}
        />
      </div>
    );
  }

  const viewer = { organizer: data.me.organizer, muted: data.me.muted, mutedUntil: data.me.mutedUntil };

  return (
    <div className="space-y-3">
      {archived ? <Notice tone="info" icon={<Archive size={15} />}>{t("ch.archived_notice")}</Notice> : null}
      {data.me.muted && !data.me.organizer ? (
        <Notice tone="warn" icon={<VolumeX size={15} />}>
          {data.me.mutedUntil
            ? fill(t("ch.muted_notice_until"), { time: formatDate(data.me.mutedUntil, lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) })
            : t("ch.muted_notice")}
        </Notice>
      ) : null}
      <div
        className={`grid overflow-hidden rounded-[var(--radius)] border lg:grid-cols-[300px_minmax(0,1fr)] ${fitShell ? "h-[min(760px,calc(100dvh_-_350px))] lg:h-[min(760px,calc(100dvh_-_290px))]" : ""}`}
        style={{ borderColor: "var(--line)", background: "var(--surface)", ...(fitShell ? {} : { height: "min(760px, calc(100dvh - 210px))" }), minHeight: 420 }}
      >
        <div className={`${pane === "thread" ? "hidden lg:flex" : "flex"} min-h-0 flex-col border-r`} style={{ borderColor: "var(--line)" }}>
          <p className="border-b px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ borderColor: "var(--line)", color: "var(--ink-3)" }}>{t("ch.channels")}</p>
          <ChannelList channels={channels} activeId={selected?.id ?? null} organizer={data.me.organizer} onSelect={(c) => choose(c.id)} />
        </div>
        <div className={`${pane === "list" ? "hidden lg:flex" : "flex"} min-h-0 min-w-0 flex-col`}>
          {selected ? (
            <ChatThread
              key={selected.id}
              eventId={eventId}
              channel={selected}
              viewer={viewer}
              archived={archived}
              onArchived={() => setArchivedFor(eventId)}
              onActivity={refreshSoon}
              onBack={() => setPane("list")}
              onLockChange={(locked) => setLocked(selected.id, locked)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
