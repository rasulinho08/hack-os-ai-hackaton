"use client";

/**
 * The volunteers' scanner at the door (see CheckinScanner). A ticket's QR
 * code leads here with the event and the code (…/volunteer/scan?e=12&c=…),
 * so a phone's own camera app opens the scanner with the ticket filled in.
 * The scanner works in the ticket's event when the person volunteers there,
 * else in the event they work in (and says the ticket is for another one).
 */

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { Notice } from "@/components/builder/ui";
import { BrandLoader } from "@/components/BrandLoader";
import { CheckinScanner } from "@/components/checkin/CheckinScanner";
import { useTranslation } from "@/contexts/LanguageContext";
import { ticketFromSearch } from "@/lib/checkin";
import { myEventsAs } from "@/lib/workspaces";

type State = { kind: "loading" } | { kind: "none" } | { kind: "ready"; eventId: number; initial: string | null };

export default function VolunteerScanPage() {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const ticket = ticketFromSearch(window.location.search);
    void (async () => {
      const own = await myEventsAs("volunteer").then((list) => list.map((e) => e.id), () => [] as number[]);
      if (cancelled) return;
      const wanted = ticket?.eventId ?? null;
      const eventId = wanted != null && (own.length === 0 || own.includes(wanted)) ? wanted : (own[0] ?? null);
      setState(eventId == null ? { kind: "none" } : { kind: "ready", eventId, initial: ticket?.text ?? null });
    })();
    return () => { cancelled = true; };
  }, []);

  if (state.kind === "loading") return <BrandLoader message={t("Loading")} fullMinHeight />;
  if (state.kind === "none") {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="text-[26px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("ci.scan.title")}</h1>
        <Notice tone="info" icon={<Lock size={15} />}>{t("ci.scan.no_event")}</Notice>
      </div>
    );
  }
  return <CheckinScanner key={state.eventId} eventId={state.eventId} initial={state.initial} listHref="/checkin" />;
}
