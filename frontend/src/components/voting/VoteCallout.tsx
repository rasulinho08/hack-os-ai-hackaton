"use client";

/**
 * On the participant's home while people's choice is open: who they voted
 * for (or that they have not), and the way to the vote. Renders nothing when
 * voting is off, not open, or not for this person.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import { Card, buttonLook } from "@/components/ds/primitives";
import { useTranslation } from "@/contexts/LanguageContext";
import { apiGet } from "@/lib/api";
import { fill } from "@/lib/i18n/fill";
import { normalizeMyVoting, type MyVoting } from "@/lib/voting";

export function VoteCallout({ eventId }: { eventId: number }) {
  const { t } = useTranslation();
  const [data, setData] = useState<MyVoting | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<unknown>(`/api/events/${eventId}/voting/me`)
      .then((v) => { if (!cancelled) setData(normalizeMyVoting(v)); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [eventId]);

  if (!data || !data.enabled || data.state !== "open" || !data.eligible || !data.candidates.length) return null;
  const chosen = data.candidates.find((c) => c.submissionId === data.myVote);
  const look = buttonLook(chosen ? "secondary" : "primary", "sm");
  return (
    <Card className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--accent-weak)", color: "var(--accent)" }}>
          <Heart size={17} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{t("vo.callout_title")}</p>
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--ink-3)" }}>
            {chosen ? fill(t("vo.callout_voted"), { project: chosen.projectName || chosen.teamName }) : t("vo.callout_body")}
          </p>
        </div>
      </div>
      <Link href="/hacker/vote" className={look.className} style={look.style}>
        {chosen ? t("vo.callout_change") : t("vo.callout_cta")}
      </Link>
    </Card>
  );
}
