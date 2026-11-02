"use client";

/**
 * The conversation: day lines, each author's name above a run of their
 * messages (with the badge of their place in the event), own messages on the
 * right, "message removed" where something was taken out, and a menu per
 * message (remove; mute the author for organisers; report for everyone else).
 *
 * It stays at the bottom while new messages come in — unless the reader has
 * scrolled up to read, then a "new messages" button takes them down. Loading
 * older messages keeps the reader where they were.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertCircle, ArrowDown, Flag, Loader2, MoreHorizontal, RotateCcw, Trash2, VolumeX, X } from "lucide-react";
import { Avatar, Button, type Tone } from "@/components/ds/primitives";
import { MessageText } from "@/components/chat/MessageText";
import { useTranslation } from "@/contexts/LanguageContext";
import { formatDate } from "@/lib/i18n/dates";
import { groupByDay, initials, startsRun, type AuthorRole, type ChatMessage } from "@/lib/chat";

const ROLE_TONE: Record<AuthorRole, Tone> = {
  organizer: "brand", judge: "info", mentor: "ok", volunteer: "warn", participant: "neutral",
};
/** The badge colours of each place in the event (the DS tones, smaller than a Badge). */
const ROLE_COLORS: Record<AuthorRole, { fg: string; bg: string }> = {
  organizer: { fg: "var(--accent)", bg: "var(--accent-weak)" },
  judge: { fg: "var(--info)", bg: "var(--info-weak)" },
  mentor: { fg: "var(--ok)", bg: "var(--ok-weak)" },
  volunteer: { fg: "var(--warn)", bg: "var(--warn-weak)" },
  participant: { fg: "var(--ink-2)", bg: "var(--tint)" },
};

export interface MessageActions {
  onRemove: (m: ChatMessage) => void;
  onReport: (m: ChatMessage) => void;
  onMute: (m: ChatMessage) => void;
  onRetry: (m: ChatMessage) => void;
  onDiscard: (m: ChatMessage) => void;
}

function MessageMenu({ m, canModerate, actions }: { m: ChatMessage; canModerate: boolean; actions: MessageActions }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items: { key: string; label: string; icon: React.ReactNode; danger?: boolean; run: () => void }[] = [];
  if (m.mine || canModerate) items.push({ key: "remove", label: t("ch.remove"), icon: <Trash2 size={14} />, danger: true, run: () => actions.onRemove(m) });
  if (!m.mine && canModerate && m.author && m.author.role !== "organizer") {
    items.push({ key: "mute", label: t("ch.mute_author"), icon: <VolumeX size={14} />, run: () => actions.onMute(m) });
  }
  if (!m.mine && !canModerate) items.push({ key: "report", label: t("ch.report"), icon: <Flag size={14} />, run: () => actions.onReport(m) });
  if (!items.length) return null;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={t("ch.message_menu")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 group-hover:opacity-100"
        style={{ color: "var(--ink-3)", minHeight: 28 }}
      >
        <MoreHorizontal size={16} />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute z-20 mt-1 min-w-[180px] overflow-hidden rounded-[var(--radius-sm)] border py-1 shadow-lg"
          style={{ background: "var(--surface)", borderColor: "var(--line-strong)", [m.mine ? "right" : "left"]: 0 }}
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); it.run(); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-[var(--tint)] focus-visible:bg-[var(--tint)] focus-visible:outline-none"
              style={{ color: it.danger ? "var(--danger)" : "var(--ink)" }}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MessageItem({
  m, showHead, canModerate, actions,
}: { m: ChatMessage; showHead: boolean; canModerate: boolean; actions: MessageActions }) {
  const { t, lang } = useTranslation();
  const time = m.createdAt ? formatDate(m.createdAt, lang, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "";
  const role = m.author?.role ?? "participant";
  const name = m.mine ? t("ch.you") : m.author?.name || t("ch.someone");

  return (
    <li className={`group flex gap-2.5 ${m.mine ? "flex-row-reverse" : ""} ${showHead ? "mt-3" : "mt-0.5"}`}>
      <div className="w-8 shrink-0">
        {showHead && !m.mine ? <Avatar initials={initials(m.author?.name)} size={32} tone={ROLE_TONE[role]} title={m.author?.name || undefined} /> : null}
      </div>
      <div className={`flex min-w-0 max-w-[min(560px,82%)] flex-col ${m.mine ? "items-end" : "items-start"}`}>
        {showHead ? (
          <div className={`mb-1 flex flex-wrap items-center gap-1.5 text-[12px] ${m.mine ? "justify-end" : ""}`}>
            <span className="font-semibold" style={{ color: "var(--ink)" }}>{name}</span>
            {role !== "participant" ? (
              <span className="rounded-full px-2 py-0.5 text-[10.5px] font-medium" style={{ color: ROLE_COLORS[role].fg, background: ROLE_COLORS[role].bg }}>
                {t(`ch.role.${role}`)}
              </span>
            ) : null}
            {time ? <time dateTime={m.createdAt ?? undefined} style={{ color: "var(--ink-3)" }}>{time}</time> : null}
          </div>
        ) : null}
        <div className={`flex items-start gap-1 ${m.mine ? "flex-row-reverse" : ""}`}>
          <div
            className="rounded-[14px] px-3.5 py-2 text-[14px] leading-relaxed"
            style={m.removed
              ? { background: "transparent", border: "1px dashed var(--line-strong)", color: "var(--ink-3)" }
              : m.mine
                ? { background: "var(--accent-weak)", color: "var(--ink)", opacity: m.pending ? 0.65 : 1 }
                : { background: "var(--surface-sunken)", color: "var(--ink)", border: "1px solid var(--line)" }}
            title={!showHead && time ? time : undefined}
          >
            {m.removed ? <em>{t("ch.removed")}</em> : <MessageText text={m.body ?? ""} />}
          </div>
          {!m.removed && !m.pending && !m.failed && m.id > 0 ? <MessageMenu m={m} canModerate={canModerate} actions={actions} /> : null}
        </div>
        {m.pending ? (
          <span className="mt-1 inline-flex items-center gap-1 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
            <Loader2 size={11} className="animate-spin" aria-hidden="true" />{t("ch.sending")}
          </span>
        ) : null}
        {m.failed ? (
          <span role="alert" className="mt-1 inline-flex flex-wrap items-center gap-2 text-[12px]" style={{ color: "var(--danger)" }}>
            <AlertCircle size={12} aria-hidden="true" />
            {t(m.failed)}
            <button type="button" className="inline-flex items-center gap-1 font-medium underline" onClick={() => actions.onRetry(m)}>
              <RotateCcw size={11} aria-hidden="true" />{t("ch.retry")}
            </button>
            <button type="button" className="inline-flex items-center gap-1 underline" style={{ color: "var(--ink-3)" }} onClick={() => actions.onDiscard(m)}>
              <X size={11} aria-hidden="true" />{t("ch.discard")}
            </button>
          </span>
        ) : null}
      </div>
    </li>
  );
}

export function MessageList({
  messages, hasMore, loadingOlder, onLoadOlder, canModerate, actions, emptyText, label,
}: {
  messages: ChatMessage[];
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  canModerate: boolean;
  actions: MessageActions;
  emptyText: string;
  /** The channel's name, for screen readers. */
  label: string;
}) {
  const { t, lang } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const edges = useRef<{ first: number | null; last: number | null; height: number }>({ first: null, last: null, height: 0 });
  const [unseen, setUnseen] = useState(false);

  // Before the browser paints: older messages keep the reader's place; new
  // ones keep the view at the bottom (when it was there) or raise the button.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const first = messages[0]?.id ?? null;
    const last = messages.at(-1)?.id ?? null;
    const before = edges.current;
    const prepended = before.first != null && first !== before.first && last === before.last;
    if (prepended) {
      el.scrollTop += el.scrollHeight - before.height;
    } else if (last !== before.last) {
      const own = messages.at(-1)?.mine ?? false;
      if (atBottom.current || own || before.last == null) el.scrollTop = el.scrollHeight;
      else window.setTimeout(() => setUnseen(true), 0);
    }
    edges.current = { first, last, height: el.scrollHeight };
  }, [messages]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottom.current = near;
    edges.current.height = el.scrollHeight;
    if (near && unseen) setUnseen(false);
  };

  const toBottom = () => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setUnseen(false);
  };

  const groups = groupByDay(messages);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={onScroll} className="absolute inset-0 overflow-y-auto px-3 py-3 sm:px-4">
        {hasMore ? (
          <div className="mb-2 flex justify-center">
            <Button size="sm" variant="ghost" loading={loadingOlder} disabled={loadingOlder} onClick={onLoadOlder}>{t("ch.load_older")}</Button>
          </div>
        ) : null}
        {messages.length === 0 ? (
          <p className="px-4 py-12 text-center text-[13.5px]" style={{ color: "var(--ink-3)" }}>{emptyText}</p>
        ) : (
          <div role="log" aria-live="polite" aria-relevant="additions" aria-label={label}>
            {groups.map((g) => (
              <section key={g.day || "pending"} aria-label={g.messages[0]?.createdAt ? formatDate(g.messages[0].createdAt, lang, { weekday: "long", day: "numeric", month: "long" }) : undefined}>
                {g.day ? (
                  <div className="my-3 flex items-center gap-3" aria-hidden="true">
                    <span className="h-px flex-1" style={{ background: "var(--line)" }} />
                    <span className="text-[11.5px] font-medium" style={{ color: "var(--ink-3)" }}>
                      {formatDate(g.messages[0]?.createdAt, lang, { weekday: "long", day: "numeric", month: "long" })}
                    </span>
                    <span className="h-px flex-1" style={{ background: "var(--line)" }} />
                  </div>
                ) : null}
                <ul className="m-0 list-none p-0">
                  {g.messages.map((m, i) => (
                    <MessageItem key={m.id} m={m} showHead={startsRun(g.messages[i - 1], m)} canModerate={canModerate} actions={actions} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
      {unseen ? (
        <button
          type="button"
          onClick={toBottom}
          className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium shadow-lg"
          style={{ background: "var(--accent-solid)", color: "#fff" }}
        >
          <ArrowDown size={13} aria-hidden="true" />{t("ch.new_messages")}
        </button>
      ) : null}
    </div>
  );
}
