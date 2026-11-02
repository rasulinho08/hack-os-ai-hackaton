"use client";

/**
 * The chat page of a participant, judge, mentor or volunteer: finds the event
 * the person works in (each portal has its own way, passed in) and opens the
 * chat on it — on `?c=<channel id>` when the address names one.
 */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";
import { Notice } from "@/components/builder/ui";
import { ChatView } from "@/components/chat/ChatView";
import { useTranslation } from "@/contexts/LanguageContext";

export type ChatPortal = "participant" | "judge" | "mentor" | "volunteer";

function Inner({ portal, resolveEventId }: { portal: ChatPortal; resolveEventId: () => Promise<number | null> }) {
  const { t } = useTranslation();
  const params = useSearchParams();
  const fromQuery = Number(params.get("c"));
  const initialChannelId = Number.isInteger(fromQuery) && fromQuery > 0 ? fromQuery : null;
  const [event, setEvent] = useState<{ id: number | null; done: boolean }>({ id: null, done: false });

  useEffect(() => {
    let cancelled = false;
    resolveEventId().then(
      (id) => { if (!cancelled) setEvent({ id, done: true }); },
      () => { if (!cancelled) setEvent({ id: null, done: true }); },
    );
    return () => { cancelled = true; };
  }, [resolveEventId]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("ch.title")}</h1>
        <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>{t(`ch.page_sub.${portal}`)}</p>
      </div>
      {!event.done ? (
        <div className="hs-skeleton h-[420px] rounded-[var(--radius)]" aria-busy="true" />
      ) : event.id == null ? (
        <Notice tone="info" icon={<Lock size={15} />}>{t("ch.no_event")}</Notice>
      ) : (
        <ChatView eventId={event.id} initialChannelId={initialChannelId} />
      )}
    </div>
  );
}

export function ChatPage(props: { portal: ChatPortal; resolveEventId: () => Promise<number | null> }) {
  return (
    <Suspense fallback={<div className="hs-skeleton h-[420px] rounded-[var(--radius)]" aria-busy="true" />}>
      <Inner {...props} />
    </Suspense>
  );
}
