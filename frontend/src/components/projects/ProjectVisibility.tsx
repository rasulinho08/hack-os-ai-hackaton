"use client";

/**
 * On the participant's submission page: whether the team's project appears on
 * the event's public projects page. The team lead decides, before the page
 * opens or after; everyone else in the team sees what was decided. Renders
 * nothing without a team, or when the state cannot be read.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { Badge, Card } from "@/components/ds/primitives";
import { Toggle } from "@/components/builder/ui";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { projectsApi, projectsErrorKey, projectsPagePath, type MyProjectState } from "@/lib/publicProjects";

export function ProjectVisibility({ eventId }: { eventId: number }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [state, setState] = useState<MyProjectState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    projectsApi.mine(eventId).then(
      (v) => { if (!cancelled) setState(v); },
      () => { if (!cancelled) setState(null); },
    );
    return () => { cancelled = true; };
  }, [eventId]);

  const team = state?.team;
  if (!state || !team) return null;
  const shown = !team.hidden;

  const save = async (show: boolean) => {
    setBusy(true);
    try {
      const next = await projectsApi.setHidden(eventId, !show);
      setState(next);
      toast(t(show ? "pj.mine.on" : "pj.mine.off"), "success");
    } catch (err) {
      toast(t(projectsErrorKey(err)), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--accent-weak)", color: "var(--accent)" }}>
          <FolderOpen size={17} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{t("pj.mine.title")}</p>
          <p className="mt-0.5 text-[13px] leading-relaxed" style={{ color: "var(--ink-3)" }}>{t("pj.mine.body")}</p>
          {team.eliminated ? (
            <p className="mt-3 text-[13px]" style={{ color: "var(--ink-2)" }}>{t("pj.mine.eliminated")}</p>
          ) : team.isLead ? (
            <div className="mt-2">
              <Toggle label={t("pj.mine.toggle")} checked={shown} disabled={busy} onChange={(v) => void save(v)} />
            </div>
          ) : (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-[13px]" style={{ color: "var(--ink-2)" }}>
              <Badge tone={shown ? "ok" : "neutral"} dot>{t(shown ? "pj.mine.shown" : "pj.mine.hidden")}</Badge>
              {t("pj.mine.lead_only")}
            </p>
          )}
          <p className="mt-2 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
            {state.live && state.slug ? (
              <Link href={projectsPagePath(state.slug)} className="font-medium underline-offset-2 hover:underline" style={{ color: "var(--accent)" }}>{t("pj.mine.see")}</Link>
            ) : t("pj.mine.not_open")}
          </p>
        </div>
      </div>
    </Card>
  );
}
