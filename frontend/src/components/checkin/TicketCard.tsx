"use client";

/**
 * On the participant's home once the organisers have accepted them and the
 * event's plan has check-in: the ticket to show at the door — its QR code,
 * the code in large type for reading out, and whether they are in. Renders
 * nothing otherwise (not accepted, no check-in in the plan, a failed load).
 * Looks again every 30 seconds until the person is checked in.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Maximize2, Ticket as TicketIcon } from "lucide-react";
import { Badge, Card, buttonLook } from "@/components/ds/primitives";
import { TicketQr } from "@/components/checkin/TicketQr";
import { useTranslation } from "@/contexts/LanguageContext";
import { formatInZone } from "@/lib/builder/datetime";
import { checkinApi, formatCode, ticketQrValue, type Ticket } from "@/lib/checkin";
import { fill } from "@/lib/i18n/fill";

const POLL_MS = 30_000;

export function TicketCard({ eventId, timeZone }: { eventId: number; timeZone: string }) {
  const { t, lang } = useTranslation();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const inRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      checkinApi.mine(eventId).then(
        (v) => {
          if (cancelled || !v || v.eventId !== eventId) return;
          inRef.current = v.checkedIn;
          setTicket(v);
        },
        // A failed refresh keeps the ticket on screen; a first failure shows nothing.
        () => {},
      );
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !inRef.current) void load();
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [eventId]);

  if (!ticket || ticket.eventId !== eventId) return null;
  const look = buttonLook("secondary", "sm");
  const code = formatCode(ticket.code);
  return (
    <Card className="flex flex-col gap-5 sm:flex-row sm:items-center">
      <TicketQr
        value={ticketQrValue(ticket.eventId, ticket.code)}
        label={fill(t("ci.ticket.qr_label"), { code })}
        size={144}
        className="w-[144px] shrink-0 self-center sm:self-auto"
      />
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <h2 className="flex items-center gap-2 text-[16px] font-semibold" style={{ color: "var(--ink)" }}>
            <TicketIcon size={16} aria-hidden="true" style={{ color: "var(--accent)" }} />
            {t("ci.ticket.title")}
          </h2>
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--ink-3)" }}>{t("ci.ticket.body")}</p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.1em]" style={{ color: "var(--ink-3)" }}>{t("ci.ticket.code")}</p>
          <p className="font-mono text-[26px] font-bold tracking-[0.14em] sm:text-[30px]" style={{ color: "var(--ink)" }} data-ticket-code="">
            {code}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {ticket.checkedIn ? (
            <Badge tone="ok" dot>{fill(t("ci.ticket.checked_in"), { time: formatInZone(ticket.checkedInAt, timeZone, lang, { year: undefined }) })}</Badge>
          ) : (
            <Badge tone="neutral" dot>{t("ci.ticket.not_yet")}</Badge>
          )}
          <Link href="/hacker/ticket" className={look.className} style={look.style}>
            <Maximize2 size={14} aria-hidden="true" />
            {t("ci.ticket.open")}
          </Link>
        </div>
      </div>
    </Card>
  );
}
