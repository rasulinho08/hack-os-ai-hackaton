"use client";

/**
 * On the organiser's results page: the switch for the event's public projects
 * page, what it would show (the projects on it, the ones their team kept off,
 * the eliminated ones) and, once it is open, the link to share. The page
 * itself opens only with the results; until then the switch says it waits.
 * The walkthrough shows the sample event's state and refuses the switch like
 * any write.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { Badge, Button, Card, CardHeader, Skeleton, buttonLook } from "@/components/ds/primitives";
import { Notice, Toggle } from "@/components/builder/ui";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { DemoReadOnlyError } from "@/lib/api";
import { formatDate } from "@/lib/i18n/dates";
import { fill } from "@/lib/i18n/fill";
import {
  organiserPhase, projectsApi, projectsErrorKey, projectsPagePath, projectsPageUrl, type OrganiserProjectsState,
} from "@/lib/publicProjects";

export function ProjectsPagePanel({ eventId, resultsAt }: { eventId: number; resultsAt: string | null }) {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const [state, setState] = useState<OrganiserProjectsState | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await projectsApi.organiser(eventId);
      setState(next);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [eventId]);

  // Publishing, republishing or withdrawing the results changes whether the page is live.
  useEffect(() => {
    void load();
  }, [load, resultsAt]);

  const save = async (on: boolean) => {
    setBusy(true);
    try {
      const next = await projectsApi.setPublic(eventId, on);
      setState(next);
      toast(t(!on ? "pj.org.off" : next.live ? "pj.org.on" : "pj.org.on_waiting"), "success");
    } catch (err) {
      if (!(err instanceof DemoReadOnlyError)) toast(t(projectsErrorKey(err)), "error");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!state?.slug) return;
    try {
      await navigator.clipboard.writeText(projectsPageUrl(state.slug));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast(t("pj.org.copy_failed"), "error");
    }
  };

  if (!state) {
    return (
      <Card>
        <CardHeader title={t("pj.org.title")} hint={t("pj.org.hint")} />
        {failed ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13.5px]" style={{ color: "var(--ink-2)" }}>{t("pj.load_failed")}</p>
            <Button size="sm" variant="ghost" onClick={() => void load()}>{t("pj.retry")}</Button>
          </div>
        ) : <Skeleton className="h-10 rounded-[12px]" />}
      </Card>
    );
  }

  const phase = organiserPhase(state);
  const counts = [
    { label: t("pj.org.listed"), n: state.projects.listed },
    { label: t("pj.org.hidden"), n: state.projects.hidden },
    { label: t("pj.org.eliminated"), n: state.projects.eliminated },
  ];

  return (
    <Card>
      <CardHeader
        title={t("pj.org.title")}
        hint={t("pj.org.hint")}
        action={phase === "live"
          ? <Badge tone="ok" dot>{t("pj.org.state.live")}</Badge>
          : phase === "waiting"
            ? <Badge tone="warn" dot>{t("pj.org.state.waiting")}</Badge>
            : <Badge tone="neutral" dot>{t("pj.org.state.off")}</Badge>}
      />
      <div className="space-y-4">
        <Toggle label={t("pj.org.toggle")} help={t("pj.org.toggle_help")} checked={state.public} disabled={busy} onChange={(v) => void save(v)} />
        {phase === "waiting" ? <Notice tone="info">{t(state.eventPublished ? "pj.org.waiting_results" : "pj.org.waiting_event")}</Notice> : null}
        <dl className="grid grid-cols-3 gap-2 sm:gap-3">
          {counts.map((c) => (
            <div key={c.label} className="rounded-[12px] border px-3 py-2.5" style={{ borderColor: "var(--line)" }}>
              <dt className="text-[11.5px] font-medium leading-tight" style={{ color: "var(--ink-3)" }}>{c.label}</dt>
              <dd className="mt-1 text-[20px] font-bold tabular-nums" style={{ color: "var(--ink)" }}>{c.n}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--ink-3)" }}>{t("pj.org.places_note")}</p>
        {phase === "live" && state.slug ? (
          <div className="flex flex-wrap items-center gap-2">
            <a href={projectsPagePath(state.slug)} target="_blank" rel="noopener noreferrer" {...buttonLook("secondary", "sm")}>
              <ExternalLink size={14} aria-hidden="true" />{t("pj.org.open")}
            </a>
            <Button size="sm" variant="ghost" icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={() => void copy()}>
              {t(copied ? "pj.org.copied" : "pj.org.copy")}
            </Button>
            {state.publicSince ? (
              <span className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>
                {fill(t("pj.org.since"), { when: formatDate(state.publicSince, lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) })}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
