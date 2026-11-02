"use client";

/**
 * The channels one person has in an event, with what is new in each: the
 * general channel, their team, their thread with the organisers (for
 * organisers: everyone's threads that have messages), help requests.
 */

import { Hash, HelpCircle, Lock, MessageCircleQuestion, Users } from "lucide-react";
import { channelLabel } from "@/components/chat/labels";
import { useTranslation } from "@/contexts/LanguageContext";
import { formatDate } from "@/lib/i18n/dates";
import type { ChannelKind, ChannelSummary } from "@/lib/chat";

const KIND_ICON: Record<ChannelKind, typeof Hash> = {
  general: Hash,
  team: Users,
  support: MessageCircleQuestion,
  ticket: HelpCircle,
};

export function ChannelList({
  channels, activeId, organizer, onSelect,
}: {
  channels: ChannelSummary[];
  activeId: number | null;
  organizer: boolean;
  onSelect: (c: ChannelSummary) => void;
}) {
  const { t, lang } = useTranslation();
  return (
    <nav aria-label={t("ch.channels")} className="min-h-0 flex-1 overflow-y-auto p-2">
      <ul className="m-0 list-none space-y-0.5 p-0">
        {channels.map((c) => {
          const Icon = KIND_ICON[c.kind];
          const { title } = channelLabel(c, organizer, t);
          const active = c.id === activeId;
          const preview = c.lastMessage
            ? c.lastMessage.preview == null
              ? t("ch.removed")
              : `${c.lastMessage.authorName ? `${c.lastMessage.authorName}: ` : ""}${c.lastMessage.preview}`
            : t(`ch.kind_hint.${c.kind}`);
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelect(c)}
                aria-current={active ? "true" : undefined}
                className="flex w-full items-start gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-left transition-colors focus-visible:outline-2"
                style={{ background: active ? "var(--accent-weak)" : "transparent", outlineColor: "var(--accent)" }}
              >
                <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: "var(--tint)", color: active ? "var(--accent)" : "var(--ink-3)" }}>
                  <Icon size={14} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={`truncate text-[13.5px] ${c.unread ? "font-semibold" : "font-medium"}`} style={{ color: "var(--ink)" }}>{title}</span>
                    {c.locked ? <Lock size={11} aria-label={t("ch.locked")} style={{ color: "var(--warn)" }} /> : null}
                    {c.lastMessage?.at ? (
                      <time className="ml-auto shrink-0 text-[11px]" dateTime={c.lastMessage.at} style={{ color: "var(--ink-3)" }}>
                        {formatDate(c.lastMessage.at, lang, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}
                      </time>
                    ) : null}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: "var(--ink-3)" }}>{preview}</span>
                    {c.unread ? (
                      <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums" style={{ background: "var(--accent-solid)", color: "#fff" }}
                        aria-label={`${c.unread} ${t("ch.unread")}`}>
                        {c.unread > 99 ? "99+" : c.unread}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
