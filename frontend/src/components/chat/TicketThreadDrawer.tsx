"use client";

/**
 * The conversation about one help request, in a side drawer: the team that
 * asked and the mentors (and the organisers) write to each other here —
 * "we are at table 7", "coming over". Opened from the request's card.
 */

import { useEffect, useState } from "react";
import { Drawer } from "@/components/ds/overlays";
import { ChatThread } from "@/components/chat/ChatThread";
import { useTranslation } from "@/contexts/LanguageContext";
import { chatApi, chatErrorKey, type ChannelSummary } from "@/lib/chat";

export function TicketThreadDrawer({
  eventId, ticketId, topic, open, onClose,
}: {
  eventId: number | null;
  ticketId: number | null;
  topic: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<{ ticketId: number; channel: ChannelSummary | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!open || eventId == null || ticketId == null) return;
    let cancelled = false;
    chatApi.ticket(eventId, ticketId).then(
      (channel) => { if (!cancelled) setLoaded({ ticketId, channel, error: channel ? null : "ch.err.generic" }); },
      (err) => { if (!cancelled) setLoaded({ ticketId, channel: null, error: chatErrorKey(err) }); },
    );
    return () => { cancelled = true; };
  }, [open, eventId, ticketId]);

  const current = loaded && loaded.ticketId === ticketId ? loaded : null;

  return (
    <Drawer open={open} onClose={onClose} title={topic || t("ch.kind.ticket")} description={t("ch.ticket_drawer_hint")} width={520}>
      {/* The drawer's own padding is given back: the conversation scrolls inside, the box stays at the bottom. */}
      <div className="-mx-5 -my-4 flex flex-col" style={{ height: "calc(100% + 2rem)" }}>
        {!current ? (
          <div className="space-y-3 p-4" aria-busy="true">
            {[0, 1].map((i) => <div key={i} className="hs-skeleton h-12 rounded-[14px]" style={{ width: `${70 - i * 20}%` }} />)}
          </div>
        ) : current.channel && eventId != null ? (
          <ChatThread
            bare
            eventId={eventId}
            channel={current.channel}
            viewer={{ organizer: current.channel.canModerate, muted: false, mutedUntil: null }}
            archived={false}
          />
        ) : (
          <p role="status" className="px-5 py-12 text-center text-[13.5px]" style={{ color: "var(--ink-3)" }}>
            {t(current.error === "ch.err.MODULE_DISABLED" ? "ch.ticket_off" : current.error || "ch.err.generic")}
          </p>
        )}
      </div>
    </Drawer>
  );
}
