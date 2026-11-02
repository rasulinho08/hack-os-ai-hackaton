"use client";

/**
 * The organisers' scanner at the door (see CheckinScanner), for the event
 * chosen in the header. The event's volunteers have theirs at
 * /volunteer/scan, where a ticket's QR code leads; an organiser who follows
 * one is sent here with the ticket (lib/roleRedirects.ts).
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BrandLoader } from "@/components/BrandLoader";
import { CheckinScanner } from "@/components/checkin/CheckinScanner";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { useTranslation } from "@/contexts/LanguageContext";
import { ticketFromSearch } from "@/lib/checkin";

export default function OrganiserScanPage() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const { activeEventId, loading } = useActiveEvent();
  const [initial, setInitial] = useState<string | null>(null);

  useEffect(() => {
    const ticket = ticketFromSearch(window.location.search);
    if (ticket) queueMicrotask(() => setInitial(ticket.text));
  }, []);

  if (activeEventId == null) {
    return loading
      ? <BrandLoader message={t("Loading")} fullMinHeight />
      : <p className="py-10 text-center text-[15px]" style={{ color: "var(--ink-3)" }}>{t("ci.no_event")}</p>;
  }
  return <CheckinScanner key={activeEventId} eventId={activeEventId} initial={initial} listHref={pathname.replace(/\/scan\/?$/, "") || "/checkin"} />;
}
