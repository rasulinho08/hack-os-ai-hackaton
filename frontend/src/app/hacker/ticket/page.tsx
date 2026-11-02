"use client";

/**
 * The participant's ticket on its own, for the door: the QR code as large as
 * the phone allows, black on white whatever the theme, the code in large type
 * for reading out when a camera will not read it, and whether they are in.
 * The screen is kept awake while the page is open (where the browser can),
 * and the page looks again every 20 seconds until the person is checked in.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Lock, Sun } from "lucide-react";
import { buttonLook } from "@/components/ds/primitives";
import { Notice } from "@/components/builder/ui";
import { BrandLoader } from "@/components/BrandLoader";
import { LoadFailure } from "@/components/LoadFailure";
import { TicketQr } from "@/components/checkin/TicketQr";
import { useTranslation } from "@/contexts/LanguageContext";
import { ApiError } from "@/lib/api";
import { formatInZone } from "@/lib/builder/datetime";
import { checkinApi, formatCode, ticketQrValue, type Ticket } from "@/lib/checkin";
import { fill } from "@/lib/i18n/fill";
import { participantEventId } from "@/lib/participantEvent";
import { useEventZone } from "@/lib/useEventZone";

const POLL_MS = 20_000;

type State = "loading" | "ready" | "none" | "off" | "failed";

export default function TicketPage() {
  const { t, lang } = useTranslation();
  const [state, setState] = useState<State>("loading");
  const [eventId, setEventId] = useState<number | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [awake, setAwake] = useState(false);
  const inRef = useRef(false);
  const { timeZone } = useEventZone(eventId);

  const load = useCallback(async (eid: number, first: boolean) => {
    try {
      const v = await checkinApi.mine(eid);
      if (!v) throw new Error("unreadable ticket");
      inRef.current = v.checkedIn;
      setTicket(v);
      setState("ready");
    } catch (err) {
      // A failed refresh keeps the ticket on screen.
      if (!first) return;
      const code = err instanceof ApiError ? String(err.code ?? "") : "";
      if (code === "MODULE_DISABLED") setState("off");
      else if (code === "NOT_APPROVED" || code === "NOT_REGISTERED" || (err instanceof ApiError && (err.status === 403 || err.status === 404))) setState("none");
      else setState("failed");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const eid = await participantEventId();
      if (cancelled) return;
      if (eid == null) {
        setState("none");
        return;
      }
      setEventId(eid);
      await load(eid, true);
    })();
    return () => { cancelled = true; };
  }, [load]);

  useEffect(() => {
    if (eventId == null) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !inRef.current) void load(eventId, false);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [eventId, load]);

  // Keep the screen on while the ticket is shown; the lock is dropped whenever
  // the page is hidden, so it is asked for again when the page comes back.
  const showing = state === "ready";
  useEffect(() => {
    if (!showing || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void next.release();
          return;
        }
        lock = next;
        setAwake(true);
        next.addEventListener("release", () => setAwake(false));
      } catch {
        setAwake(false);
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void request(); };
    void request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (lock) void lock.release().catch(() => {});
    };
  }, [showing]);

  const back = buttonLook("secondary", "md");
  const backLink = (
    <Link href="/hacker" className={back.className} style={back.style}>
      <ArrowLeft size={15} aria-hidden="true" />
      {t("ci.ticket.back")}
    </Link>
  );

  if (state === "loading") return <BrandLoader message={t("Loading")} fullMinHeight />;

  if (state !== "ready" || !ticket) {
    return (
      <div className="mx-auto max-w-md space-y-5">
        <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("ci.ticket.page_title")}</h1>
        {state === "failed" ? (
          <LoadFailure onRetry={() => eventId != null && void load(eventId, true)} />
        ) : (
          <Notice tone="info" icon={<Lock size={15} />}>{t(state === "off" ? "ci.err.MODULE_DISABLED" : "ci.ticket.none")}</Notice>
        )}
        {backLink}
      </div>
    );
  }

  const code = formatCode(ticket.code);
  return (
    <div className="mx-auto max-w-md space-y-5">
      <section
        aria-labelledby="ticket-h"
        className="rounded-[20px] border-2 p-5 text-center sm:p-7"
        style={{ background: "#FFFFFF", color: "#000000", borderColor: ticket.checkedIn ? "#15803D" : "#000000" }}
      >
        <p className="text-[13px] font-semibold uppercase tracking-[0.12em]" style={{ color: "#3F3F46" }}>{ticket.eventName}</p>
        <h1 id="ticket-h" className="mt-1 text-[22px] font-bold leading-tight [overflow-wrap:anywhere]">{ticket.name || t("ci.ticket.title")}</h1>
        {ticket.team ? <p className="mt-0.5 text-[15px]" style={{ color: "#3F3F46" }}>{ticket.team}</p> : null}

        <TicketQr
          value={ticketQrValue(ticket.eventId, ticket.code)}
          label={fill(t("ci.ticket.qr_label"), { code })}
          size={320}
          className="mx-auto mt-5 w-full"
        />

        <p className="mt-4 text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: "#3F3F46" }}>{t("ci.ticket.code")}</p>
        <p className="font-mono text-[36px] font-bold leading-tight tracking-[0.16em] sm:text-[42px]" data-ticket-code="">{code}</p>

        <p
          className="mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2 text-[15px] font-semibold"
          style={ticket.checkedIn ? { background: "#DCFCE7", color: "#14532D" } : { background: "#F4F4F5", color: "#18181B" }}
          aria-live="polite"
        >
          {ticket.checkedIn ? <CheckCircle2 size={18} aria-hidden="true" /> : null}
          {ticket.checkedIn
            ? fill(t("ci.ticket.checked_in"), { time: formatInZone(ticket.checkedInAt, timeZone, lang, { year: undefined }) })
            : t("ci.ticket.not_yet")}
        </p>
      </section>

      <p className="flex items-start gap-2 text-[13px]" style={{ color: "var(--ink-2)" }}>
        <Sun size={15} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: "var(--warn)" }} />
        <span>
          {t("ci.ticket.brightness")}
          {awake ? ` ${t("ci.ticket.awake")}` : ""}
        </span>
      </p>
      {backLink}
    </div>
  );
}
