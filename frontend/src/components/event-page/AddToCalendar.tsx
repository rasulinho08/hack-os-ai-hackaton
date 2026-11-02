"use client";

/**
 * "Add to calendar" on an event's public page (when its plan includes
 * calendars): Google Calendar with the event filled in, or the event's
 * public dates as an .ics file for Apple Calendar and Outlook. It speaks the
 * page's language (`t` is the page's translator, in the event's language or
 * the visitor's choice).
 */

import { useEffect, useId, useRef, useState } from "react";
import { CalendarPlus, ChevronDown, Download, ExternalLink } from "lucide-react";
import { googleEventUrl, publicIcsPath } from "@/lib/calendar";

export function AddToCalendar({
  name, slug, start, end, details, location, t, tone = "hero",
}: {
  name: string;
  slug: string;
  start: string | null;
  end: string | null;
  details?: string | null;
  location?: string | null;
  t: (key: string) => string;
  /** "hero" sits on the dark top of the event page; "surface" on a light card. */
  tone?: "hero" | "surface";
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const google = googleEventUrl({ name, start, end, details, location });
  const item = "flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2.5 text-left text-[13.5px] font-medium transition-colors hover:bg-[var(--tint)]";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={`inline-flex items-center gap-2 rounded-[12px] px-4 text-[14px] font-semibold transition-colors ${tone === "hero" ? "min-h-12" : "min-h-11 border hover:bg-[var(--tint)]"}`}
        style={tone === "hero" ? { background: "rgba(251,250,248,0.14)", color: "#FBFAF8" } : { borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink)" }}
      >
        <CalendarPlus size={16} aria-hidden="true" /> {t("cal.add")}
        <ChevronDown size={14} aria-hidden="true" className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>
      {open ? (
        <div
          id={menuId}
          className="absolute left-0 top-full z-20 mt-2 w-64 rounded-[12px] border p-1.5 shadow-xl"
          style={{ background: "var(--surface)", borderColor: "var(--line)", color: "var(--ink)" }}
        >
          {google ? (
            <a href={google} target="_blank" rel="noopener noreferrer" className={item} style={{ color: "var(--ink)" }} onClick={() => setOpen(false)}>
              <ExternalLink size={15} aria-hidden="true" style={{ color: "var(--accent-solid)" }} /> {t("cal.google")}
            </a>
          ) : null}
          <a href={publicIcsPath(slug)} download={`${slug}.ics`} className={item} style={{ color: "var(--ink)" }} onClick={() => setOpen(false)}>
            <Download size={15} aria-hidden="true" style={{ color: "var(--accent-solid)" }} /> {t("cal.ics")}
          </a>
        </div>
      ) : null}
    </div>
  );
}
