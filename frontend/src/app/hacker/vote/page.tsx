"use client";

/**
 * People's choice: the participant picks the project they like most — never
 * their own team's — and can change or withdraw the vote until the results
 * are published. Counts are never shown here; the organiser sees them.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Code2, ExternalLink, Heart, PlayCircle, Undo2 } from "lucide-react";
import { Badge, Button, Card, EmptyState } from "@/components/ds/primitives";
import { Notice } from "@/components/builder/ui";
import { BrandLoader } from "@/components/BrandLoader";
import { LoadFailure } from "@/components/LoadFailure";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";
import { formatDate } from "@/lib/i18n/dates";
import { fill } from "@/lib/i18n/fill";
import { participantEventId } from "@/lib/participantEvent";
import { normalizeMyVoting, teamCaption, voteErrorKey, type Candidate, type MyVoting } from "@/lib/voting";

type Load = "loading" | "ready" | "no_event" | "failed";

function ProjectLinks({ c }: { c: Candidate }) {
  const { t } = useTranslation();
  const links = [
    { href: c.repoLink, label: t("vo.repo"), icon: <Code2 size={14} aria-hidden="true" /> },
    { href: c.demoLink, label: t("vo.demo"), icon: <ExternalLink size={14} aria-hidden="true" /> },
    { href: c.videoLink, label: t("vo.video"), icon: <PlayCircle size={14} aria-hidden="true" /> },
  ].filter((l) => l.href);
  if (!links.length) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {links.map((l) => (
        <a key={l.label} href={l.href as string} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium underline-offset-2 hover:underline"
          style={{ color: "var(--accent)" }}>
          {l.icon}{l.label}
        </a>
      ))}
    </div>
  );
}

function ProjectCard({ c, mine, open, busy, onVote, onWithdraw }: {
  c: Candidate; mine: boolean; open: boolean; busy: boolean; onVote: () => void; onWithdraw: () => void;
}) {
  const { t } = useTranslation();
  const name = c.projectName || c.teamName;
  return (
    <Card className="flex min-w-0 flex-col gap-3" style={mine ? { borderColor: "var(--accent)", boxShadow: "0 0 0 1px var(--accent)" } : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-[15px] font-semibold" style={{ color: "var(--ink)" }}>{name}</h2>
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--ink-3)" }}>{teamCaption(c.teamName, t("vo.team"))}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {mine ? <Badge tone="brand" dot>{t("vo.your_vote")}</Badge> : null}
          {c.track ? <Badge>{c.track}</Badge> : null}
        </div>
      </div>
      {c.description ? (
        <p className="line-clamp-4 text-[13.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{c.description}</p>
      ) : null}
      <ProjectLinks c={c} />
      {open ? (
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          {mine ? (
            <Button variant="ghost" size="sm" icon={<Undo2 size={14} />} loading={busy} disabled={busy} onClick={onWithdraw}>
              {t("vo.withdraw")}
            </Button>
          ) : (
            <Button variant="primary" size="sm" icon={<Heart size={14} />} loading={busy} disabled={busy} onClick={onVote}
              aria-label={fill(t("vo.vote_for"), { project: name })}>
              {t("vo.vote")}
            </Button>
          )}
        </div>
      ) : null}
    </Card>
  );
}

export default function VotePage() {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const [load, setLoad] = useState<Load>("loading");
  const [eventId, setEventId] = useState<number | null>(null);
  const [data, setData] = useState<MyVoting | null>(null);
  const [busy, setBusy] = useState<number | "withdraw" | null>(null);

  const fetchVoting = useCallback(async (eid: number) => {
    try {
      setData(normalizeMyVoting(await apiGet<unknown>(`/api/events/${eid}/voting/me`)));
      setLoad("ready");
    } catch {
      setLoad("failed");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const eid = await participantEventId();
      if (cancelled) return;
      if (eid == null) { setLoad("no_event"); return; }
      setEventId(eid);
      await fetchVoting(eid);
    })();
    return () => { cancelled = true; };
  }, [fetchVoting]);

  const fail = (err: unknown) => {
    const key = voteErrorKey(err instanceof ApiError ? err.code : null);
    toast(key ? t(key) : t("vo.failed"), "error");
  };

  const vote = async (c: Candidate) => {
    if (eventId == null) return;
    setBusy(c.submissionId);
    try {
      await apiPost(`/api/events/${eventId}/voting/me`, { submissionId: c.submissionId });
      setData((d) => (d ? { ...d, myVote: c.submissionId } : d));
      toast(t("vo.saved"), "success");
    } catch (err) {
      fail(err);
      void fetchVoting(eventId);
    } finally {
      setBusy(null);
    }
  };

  const withdraw = async () => {
    if (eventId == null) return;
    setBusy("withdraw");
    try {
      await apiDelete(`/api/events/${eventId}/voting/me`);
      setData((d) => (d ? { ...d, myVote: null } : d));
      toast(t("vo.withdrawn"), "success");
    } catch (err) {
      fail(err);
      void fetchVoting(eventId);
    } finally {
      setBusy(null);
    }
  };

  if (load === "loading") return <BrandLoader message={t("Loading")} fullMinHeight />;
  if (load === "no_event") return <Card><EmptyState title={t("vo.no_event")} /></Card>;
  if (load === "failed" || !data) {
    return <LoadFailure message={t("vo.load_failed")} onRetry={() => eventId != null && void fetchVoting(eventId)} />;
  }

  const open = data.state === "open" && data.eligible;
  const chosen = data.candidates.find((c) => c.submissionId === data.myVote) || null;
  const chosenName = chosen ? chosen.projectName || chosen.teamName : null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("vo.title")}</h1>
        <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-3)" }}>{t("vo.subtitle")}</p>
      </header>

      {!data.enabled ? (
        <Card><EmptyState icon={<Heart size={19} />} title={t("vo.off_title")} body={t("vo.off_body")} /></Card>
      ) : (
        <>
          {!data.eligible ? <Notice tone="info">{t("vo.not_eligible")}</Notice> : null}
          {data.eligible && data.state === "not_open" ? (
            <Notice tone="info">
              {data.opensAt
                ? fill(t("vo.not_open"), { when: formatDate(data.opensAt, lang, { dateStyle: "long", timeStyle: "short" }) })
                : t("vo.not_open_nodate")}
            </Notice>
          ) : null}
          {data.state === "closed" ? <Notice tone="info">{t("vo.closed")}</Notice> : null}
          {data.state === "archived" ? <Notice tone="info">{t("vo.archived")}</Notice> : null}

          {data.eligible && data.state !== "not_open" ? (
            <p role="status" className="flex items-center gap-2 text-[14px]" style={{ color: "var(--ink-2)" }}>
              {chosenName ? <Check size={16} aria-hidden="true" style={{ color: "var(--ok)" }} /> : null}
              {chosenName ? fill(t("vo.voted_for"), { project: chosenName }) : t("vo.not_voted")}
            </p>
          ) : null}

          {data.eligible && data.state !== "not_open" ? (
            data.candidates.length ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {data.candidates.map((c) => (
                  <ProjectCard key={c.submissionId} c={c} mine={c.submissionId === data.myVote} open={open}
                    busy={busy === c.submissionId || (busy === "withdraw" && c.submissionId === data.myVote)}
                    onVote={() => void vote(c)} onWithdraw={() => void withdraw()} />
                ))}
              </div>
            ) : (
              <Card><EmptyState title={t("vo.no_projects")} /></Card>
            )
          ) : null}
        </>
      )}
    </div>
  );
}
