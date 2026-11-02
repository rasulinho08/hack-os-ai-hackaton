"use client";

/**
 * The organiser's people's choice count on the results page: votes per
 * project, how many of the admitted participants voted, and whether voting
 * is open. Participants never see this.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import { Badge, Card, CardHeader, type Tone } from "@/components/ds/primitives";
import { LoadFailure } from "@/components/LoadFailure";
import { useTranslation } from "@/contexts/LanguageContext";
import { apiGet } from "@/lib/api";
import { fill } from "@/lib/i18n/fill";
import { normalizeTally, type Tally, type VotingState } from "@/lib/voting";

const STATE_TONE: Record<VotingState, Tone> = { off: "neutral", not_open: "info", open: "ok", closed: "neutral", archived: "neutral" };

/** `refreshKey`: changes whenever the results page reloads (Refresh, Publish, Unpublish), so the count follows. */
export function VoteTally({ eventId, builderHref, refreshKey = 0 }: { eventId: number; builderHref?: string; refreshKey?: number }) {
  const { t } = useTranslation();
  const [data, setData] = useState<Tally | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiGet<unknown>(`/api/events/${eventId}/voting`)
      .then((v) => { if (!cancelled) { setData(normalizeTally(v)); setFailed(false); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [eventId, attempt, refreshKey]);

  if (failed) return <Card><LoadFailure compact message={t("vo.tally_failed")} onRetry={() => setAttempt((n) => n + 1)} /></Card>;
  if (!data) return null;
  const top = Math.max(1, ...data.tally.map((r) => r.votes));
  return (
    <Card>
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><Heart size={15} aria-hidden="true" />{t("vo.title")}</span>}
        hint={data.enabled ? fill(t("vo.tally_hint"), { voters: data.voters, eligible: data.eligible }) : undefined}
        action={<Badge tone={STATE_TONE[data.state]} dot>{t(`vo.state.${data.state}`)}</Badge>}
      />
      {!data.enabled ? (
        <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>
          {t("vo.tally_off")}{" "}
          {builderHref ? <Link href={builderHref} className="font-medium underline underline-offset-2" style={{ color: "var(--accent)" }}>{t("vo.open_builder")}</Link> : null}
        </p>
      ) : data.voters === 0 ? (
        <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>{t("vo.tally_empty")}</p>
      ) : (
        <ol className="space-y-3">
          {data.tally.map((r) => (
            <li key={r.submissionId} className="min-w-0">
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate font-medium" style={{ color: "var(--ink)" }}>
                  {r.projectName || r.teamName}
                  <span className="font-normal" style={{ color: "var(--ink-3)" }}> · {r.teamName}</span>
                </span>
                <span className="shrink-0 tabular-nums" style={{ color: "var(--ink-2)" }}>{fill(t("vo.votes"), { n: r.votes })} · {r.share}%</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full" style={{ background: "var(--tint)" }} aria-hidden="true">
                <div className="h-full rounded-full" style={{ width: `${(r.votes / top) * 100}%`, background: "var(--accent)" }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
