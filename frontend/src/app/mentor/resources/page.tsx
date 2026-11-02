"use client";

import { useEffect, useState, useCallback } from "react";
import { BookOpen, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { apiGet } from "@/lib/api";
import { resolveMentorEventId } from "@/lib/resolveEventId";
import { useToast } from "@/contexts/ToastContext";
import { useTranslation } from "@/contexts/LanguageContext";
import { LoadFailure } from "@/components/LoadFailure";

interface ResourceRow {
  id: number;
  section: string;
  label: string;
  description?: string | null;
  url?: string | null;
}

export default function MentorResourcesPage() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sections, setSections] = useState<Record<string, ResourceRow[]>>({});

  const load = useCallback(
    async (initial: boolean) => {
      if (initial) setLoading(true);
      else setRefreshing(true);
      try {
        const eid = await resolveMentorEventId();
        if (!eid) {
          setSections({});
          return;
        }
        const rows = await apiGet<ResourceRow[]>(
          `/api/events/${eid}/resources`,
        );
        const grouped: Record<string, ResourceRow[]> = {};
        for (const r of Array.isArray(rows) ? rows : []) {
          const sec = r.section || "General";
          (grouped[sec] ??= []).push(r);
        }
        setSections(grouped);
        setLoadFailed(false);
      } catch {
        setLoadFailed((prev) => (initial ? true : prev));
        if (initial) toast(t("mentor.resources.toast_failed"), "error");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [toast, t],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const keys = Object.keys(sections).sort();

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#E1003C]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em] text-[var(--app-heading)]">
            {t("mentor.resources.title")}
          </h1>
          <p className="mt-1 text-[15px] text-[var(--app-muted)]">
            {t("mentor.resources.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(false)}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] font-medium text-[var(--app-muted)] transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-60"
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          {refreshing
            ? t("mentor.resources.refreshing")
            : t("mentor.resources.refresh")}
        </button>
      </div>

      {keys.length === 0 &&
        (loadFailed ? (
          <LoadFailure onRetry={() => void load(true)} retrying={loading} />
        ) : (
          <div className="rounded-2xl border border-white/5 bg-[var(--app-surface)] p-8 text-center">
            <BookOpen size={36} className="mx-auto mb-3 text-[var(--app-muted-2)]" />
            <p className="text-[15px] text-white">
              {t("mentor.resources.empty_title")}
            </p>
            <p className="mt-2 text-[13px] text-[var(--app-muted)]">
              {t("mentor.resources.empty_body")}
            </p>
          </div>
        ))}

      {keys.map((sec) => (
        <section
          key={sec}
          className="card-shadow rounded-2xl border border-white/5 bg-[var(--app-surface)] p-6"
        >
          <h2 className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-white">
            <BookOpen size={16} className="text-[#E1003C]" />
            {sec}
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {sections[sec].map((item) => (
              <a
                key={item.id}
                href={item.url || "#"}
                target={item.url ? "_blank" : undefined}
                rel={item.url ? "noopener noreferrer" : undefined}
                className="flex items-start gap-3 rounded-xl bg-white/[0.03] px-4 py-3 text-[13px] transition-colors hover:bg-white/[0.06]"
              >
                <ExternalLink
                  size={13}
                  className="mt-0.5 shrink-0 text-[var(--app-muted)]"
                />
                <div>
                  <p className="font-medium text-white">{item.label}</p>
                  {item.description && (
                    <p className="mt-0.5 text-[12px] text-[var(--app-muted)]">
                      {item.description}
                    </p>
                  )}
                </div>
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
