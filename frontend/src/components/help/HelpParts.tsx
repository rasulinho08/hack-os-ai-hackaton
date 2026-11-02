"use client";

/**
 * Small pieces the help-queue pages share: a request's status in words, a
 * mentor's presence dot, a mentor card, skill chips and a slot's time.
 */

import { Clock, MapPin, Wifi } from "lucide-react";
import { Badge, type Tone } from "@/components/ds/primitives";
import { useTranslation } from "@/contexts/LanguageContext";
import { formatInZone } from "@/lib/builder/datetime";
import { fill } from "@/lib/i18n/fill";
import type { HelpTicket, MentorCard, SlotBrief } from "@/lib/helpQueue";

export function SkillChips({ items, strong = [], max = 8 }: { items: string[]; strong?: string[]; max?: number }) {
  if (!items.length) return null;
  const on = new Set(strong.map((s) => s.toLowerCase()));
  const shown = items.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((s) => (
        <span key={s} className="rounded-full px-2 py-0.5 text-[12px]"
          style={on.has(s.toLowerCase())
            ? { background: "var(--accent-weak)", color: "var(--ink)", fontWeight: 600 }
            : { background: "var(--tint)", color: "var(--ink-2)" }}>
          {s}
        </span>
      ))}
      {items.length > max ? <span className="px-1 text-[12px]" style={{ color: "var(--ink-3)" }}>+{items.length - max}</span> : null}
    </div>
  );
}

/** The online dot and the mentor's own status, in words. Nothing when hidden by the organiser. */
export function PresenceDot({ mentor }: { mentor: Pick<MentorCard, "online" | "presence"> }) {
  const { t } = useTranslation();
  if (mentor.online == null && mentor.presence == null) return null;
  const color = mentor.presence === "away" ? "var(--ink-3)" : mentor.online ? "var(--ok)" : mentor.presence === "busy" ? "var(--warn)" : "var(--ink-3)";
  const label = mentor.presence === "away"
    ? t("hq.presence.away")
    : mentor.online
      ? (mentor.presence === "busy" ? t("hq.presence.busy") : t("hq.presence.online"))
      : t("hq.presence.offline");
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: "var(--ink-2)" }}>
      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

export function slotText(slot: SlotBrief, timeZone: string, lang: string, t: (k: string) => string): string {
  const day = formatInZone(slot.startsAt, timeZone, lang, { year: undefined, hour: undefined, minute: undefined, weekday: "short" });
  const from = formatInZone(slot.startsAt, timeZone, lang, { day: undefined, month: undefined, year: undefined });
  const to = formatInZone(slot.endsAt, timeZone, lang, { day: undefined, month: undefined, year: undefined });
  return fill(t("hq.slot_line"), { day, from, to, mode: t(`hq.mode.${slot.mode}`) });
}

export function MentorCardView({ mentor, matched = [], timeZone, footer, compact = false }: {
  mentor: MentorCard;
  matched?: string[];
  timeZone: string;
  footer?: React.ReactNode;
  compact?: boolean;
}) {
  const { t, lang } = useTranslation();
  return (
    <div className="flex h-full flex-col gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold" style={{ color: "var(--ink)" }}>{mentor.name}</p>
          <PresenceDot mentor={mentor} />
        </div>
        {mentor.activeTickets > 0 ? <Badge tone="warn">{fill(t("hq.helping_n"), { n: mentor.activeTickets })}</Badge> : null}
      </div>
      {!compact && mentor.bio ? <p className="text-[13px] leading-snug" style={{ color: "var(--ink-2)" }}>{mentor.bio}</p> : null}
      <SkillChips items={mentor.skills} strong={matched} max={compact ? 5 : 8} />
      <div className="space-y-1 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
        {mentor.location ? <p className="flex items-center gap-1.5"><MapPin size={12} aria-hidden="true" />{mentor.location}</p> : null}
        {mentor.nextSlot ? (
          <p className="flex items-center gap-1.5">
            {mentor.nextSlot.mode === "online" ? <Wifi size={12} aria-hidden="true" /> : <Clock size={12} aria-hidden="true" />}
            {slotText(mentor.nextSlot, timeZone, lang, t)}
          </p>
        ) : mentor.availability ? <p className="flex items-center gap-1.5"><Clock size={12} aria-hidden="true" />{mentor.availability}</p> : null}
      </div>
      {footer ? <div className="mt-auto pt-1">{footer}</div> : null}
    </div>
  );
}

const STATUS_TONE: Record<string, Tone> = { open: "warn", "in-progress": "info", resolved: "ok" };

/** A request's state in words: waiting, someone is on it, or why it closed. */
export function TicketStatusBadge({ ticket }: { ticket: HelpTicket }) {
  const { t } = useTranslation();
  if (ticket.status === "resolved") {
    const reason = ticket.closedReason || "resolved";
    return <Badge tone={reason === "resolved" ? "ok" : "neutral"} dot>{t(`hq.closed.${reason}`)}</Badge>;
  }
  if (ticket.escalated) return <Badge tone="danger" dot>{t("hq.status.escalated")}</Badge>;
  return <Badge tone={STATUS_TONE[ticket.status]} dot>{t(`hq.status.${ticket.status}`)}</Badge>;
}

export const PRIORITY_TONE: Record<string, Tone> = { low: "neutral", normal: "neutral", high: "warn", urgent: "danger" };
