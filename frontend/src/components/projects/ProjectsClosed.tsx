"use client";

/**
 * What /e/<slug>/projects shows while there is no page there: the organiser
 * has not opened it, the results are not out, or there is no such event.
 * The visitor gets the reason in a sentence and the way to the event's page.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, FolderClosed } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { eventPathOf } from "@/lib/publicProjects";

export function ProjectsClosed() {
  const { t } = useTranslation();
  const eventHref = eventPathOf(usePathname());

  return (
    <div className="hs min-h-dvh" style={{ background: "var(--surface-sunken)", color: "var(--ink)" }}>
      <header className="mx-auto flex max-w-5xl items-center px-4 pt-5 sm:px-6">
        <Link href={eventHref || "/"} className="inline-flex min-h-10 items-center gap-2 rounded-full px-1 text-[14px] font-medium" style={{ color: "var(--ink-2)" }}>
          <ArrowLeft size={16} aria-hidden="true" />
          {eventHref ? t("pj.event_page") : t("pj.closed_home")}
        </Link>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-10 sm:px-6 sm:pt-16">
        <div className="hs-card mx-auto max-w-lg px-6 py-10 text-center sm:px-10">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "var(--tint)", color: "var(--ink-2)" }}>
            <FolderClosed size={20} aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em] [text-wrap:balance]" style={{ color: "var(--ink)" }}>{t("pj.closed_title")}</h1>
          <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{t("pj.closed_body")}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href={eventHref || "/"} className="hs-pill hs-pill-ghost">{eventHref ? t("pj.closed_cta") : t("pj.closed_home")}</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
