"use client";

/**
 * The organisers' chat: every channel of the event (the general one, team
 * channels and people's threads with the organisers once they have
 * messages, help requests), the reported messages to deal with, and who is
 * muted. A notification links here with `?c=<channel id>`.
 */

import { Suspense, useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ds/primitives";
import { ChatView } from "@/components/chat/ChatView";
import { MutesPanel, ReportsPanel } from "@/components/chat/Moderation";
import { useTranslation } from "@/contexts/LanguageContext";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { chatApi, type ChatList } from "@/lib/chat";

type Tab = "chat" | "reports" | "mutes";

function OrganizerChat() {
  const { t } = useTranslation();
  const params = useSearchParams();
  const { activeEventId, loading } = useActiveEvent();
  const fromQuery = Number(params.get("c"));
  const [tab, setTab] = useState<Tab>(params.get("tab") === "reports" ? "reports" : "chat");
  const [focus, setFocus] = useState<{ id: number | null; n: number }>({
    id: Number.isInteger(fromQuery) && fromQuery > 0 ? fromQuery : null, n: 0,
  });
  const [counts, setCounts] = useState<{ eventId: number; reports: number } | null>(null);

  const onLoaded = useCallback((list: ChatList) => {
    if (activeEventId != null) setCounts({ eventId: activeEventId, reports: list.openReports ?? 0 });
  }, [activeEventId]);

  const recount = useCallback(() => {
    if (activeEventId == null) return;
    chatApi.list(activeEventId).then((list) => onLoaded(list), () => { /* the count stays */ });
  }, [activeEventId, onLoaded]);

  const reports = counts && counts.eventId === activeEventId ? counts.reports : undefined;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("ch.title")}</h1>
        <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>{t("ch.page_sub.organizer")}</p>
      </div>
      {activeEventId == null ? (
        loading ? <div className="hs-skeleton h-[420px] rounded-[var(--radius)]" aria-busy="true" /> : (
          <p className="py-10 text-center text-[15px]" style={{ color: "var(--ink-3)" }}>{t("ch.no_event_org")}</p>
        )
      ) : (
        <>
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "chat", label: t("ch.tab.chat") },
              { id: "reports", label: t("ch.tab.reports"), count: reports },
              { id: "mutes", label: t("ch.tab.mutes") },
            ]}
          />
          {tab === "chat" ? (
            <ChatView key={`${activeEventId}-${focus.n}`} eventId={activeEventId} initialChannelId={focus.id} onLoaded={onLoaded} fitShell />
          ) : tab === "reports" ? (
            <ReportsPanel
              eventId={activeEventId}
              onChanged={recount}
              onOpenChannel={(id) => { setFocus((f) => ({ id, n: f.n + 1 })); setTab("chat"); }}
            />
          ) : (
            <MutesPanel eventId={activeEventId} />
          )}
        </>
      )}
    </div>
  );
}

export default function OrganizerChatPage() {
  return (
    <Suspense fallback={<div className="hs-skeleton h-[420px] rounded-[var(--radius)]" aria-busy="true" />}>
      <OrganizerChat />
    </Suspense>
  );
}
