"use client";

/** The volunteer's home: the organisers' note, the next tasks, free ones to take — and, after the event, their certificates. */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { VolunteerTaskList } from "@/components/volunteer/VolunteerTaskList";
import { MyCertificates } from "@/components/wrapup/MyCertificates";
import { CalendarFeedCard } from "@/components/calendar/CalendarFeedCard";
import { useTranslation } from "@/contexts/LanguageContext";

export default function VolunteerHomePage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <VolunteerTaskList compact title={t("vt.home_title")} subtitle={t("vt.home_subtitle")} />
      <div className="flex flex-wrap gap-3 text-[14px]">
        <Link href="/volunteer/tasks" className="inline-flex items-center gap-1.5 font-medium" style={{ color: "var(--accent)" }}>{t("vt.all_tasks")} <ArrowRight size={14} aria-hidden="true" /></Link>
        <Link href="/volunteer/announcements" className="inline-flex items-center gap-1.5 font-medium" style={{ color: "var(--accent)" }}>{t("nav.announcements")} <ArrowRight size={14} aria-hidden="true" /></Link>
      </div>
      {/* Appears once certificates are issued. */}
      <MyCertificates />
      <CalendarFeedCard />
    </div>
  );
}
