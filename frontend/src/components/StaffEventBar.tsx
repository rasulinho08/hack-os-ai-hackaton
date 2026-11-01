"use client";

/**
 * Which event a mentor's or volunteer's screens are about, at the top of
 * each of them, and a way to change it when they help at more than one.
 * The pages pick their event the same way (myEventsAs: the one entered,
 * else the one running now…), so the bar and the page always agree;
 * choosing another enters that workspace and loads the page again.
 */

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { enterEventWorkspace, myEventsAs, type WorkspaceEvent } from "@/lib/workspaces";

export function StaffEventBar({ role }: { role: "mentor" | "volunteer" }) {
  const { t } = useTranslation();
  const [events, setEvents] = useState<WorkspaceEvent[] | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    let live = true;
    myEventsAs(role).then((list) => { if (live) setEvents(list); }).catch(() => { if (live) setEvents([]); });
    return () => { live = false; };
  }, [role]);

  if (!events || !events.length) return null;
  const current = events[0];
  return (
    <div className="mb-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius)] border px-3.5 py-2.5 text-[13.5px]"
      style={{ borderColor: "var(--line)", background: "var(--surface)", color: "var(--ink-2)" }} data-staff-event={current.id}>
      <CalendarDays size={15} aria-hidden="true" className="shrink-0" style={{ color: "var(--accent)" }} />
      {events.length > 1 ? (
        <label className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="shrink-0">{t("staff.event_for")}</span>
          <select value={current.id} disabled={switching}
            onChange={async (e) => {
              setSwitching(true);
              await enterEventWorkspace(Number(e.target.value));
              window.location.reload();
            }}
            className="min-h-10 min-w-0 max-w-full flex-1 rounded-[8px] border px-2 text-[14px] font-semibold sm:flex-none"
            style={{ borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink)" }}>
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name || `#${ev.id}`}</option>)}
          </select>
        </label>
      ) : (
        <p className="min-w-0 flex-1 break-words">
          {t("staff.event_for")} <span className="font-semibold" style={{ color: "var(--ink)" }}>{current.name || `#${current.id}`}</span>
        </p>
      )}
    </div>
  );
}
