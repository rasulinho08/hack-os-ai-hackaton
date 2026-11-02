"use client";

/**
 * The organiser's home. With an event: where it is, what needs attention,
 * the counts, the latest activity and its dates (components/overview). Without
 * one yet: a welcome that leads to creating the first event.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Plus,
  Zap,
  Users,
  Trophy,
  BarChart3,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { BrandLoader } from "@/components/BrandLoader";
import { EventHome } from "@/components/overview/EventHome";

const ThreeBackground = dynamic(() => import("@/components/ThreeBackground"), {
  ssr: false,
});

const FEATURES = [
  {
    icon: Users,
    titleKey: "dashboard_home.feature_teams_title",
    descKey: "dashboard_home.feature_teams_desc",
  },
  {
    icon: Trophy,
    titleKey: "dashboard_home.feature_judging_title",
    descKey: "dashboard_home.feature_judging_desc",
  },
  {
    icon: Zap,
    titleKey: "dashboard_home.feature_live_title",
    descKey: "dashboard_home.feature_live_desc",
  },
  {
    icon: BarChart3,
    titleKey: "dashboard_home.feature_analytics_title",
    descKey: "dashboard_home.feature_analytics_desc",
  },
] as const;

function NoEventWelcome() {
  const { t } = useTranslation();
  return (
    <div className="relative flex min-h-[80vh] flex-col items-center justify-center px-4 py-16 text-center">
      {/* Glowing orb behind heading */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div
          style={{
            width: 480,
            height: 480,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(225,0,60,0.18) 0%, transparent 70%)",
            filter: "blur(40px)",
          }}
        />
      </div>

      {/* Badge */}
      <div className="animate-fade-in mb-6 inline-flex items-center gap-2 rounded-full border border-[#E1003C]/30 bg-[#E1003C]/10 px-4 py-1.5 text-[15px] font-medium text-[#E1003C]">
        <Sparkles size={14} />
        {t("dashboard_home.welcome_badge")}
      </div>

      {/* Main heading */}
      <h1
        className="animate-fade-in-up text-4xl font-extrabold tracking-tight text-white sm:text-5xl md:text-6xl"
        style={{ animationDelay: "80ms" }}
      >
        {t("dashboard_home.welcome_heading_1")}
        <br />
        <span
          style={{
            background: "linear-gradient(90deg, #E1003C 0%, #ff6b8a 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          {t("dashboard_home.welcome_heading_2")}
        </span>
      </h1>

      <p
        className="animate-fade-in-up mt-5 max-w-xl text-base text-[var(--app-muted)] sm:text-lg"
        style={{ animationDelay: "160ms" }}
      >
        {t("dashboard_home.welcome_subtitle")}
      </p>

      {/* CTA */}
      <div
        className="animate-fade-in-up mt-10 flex w-full max-w-sm flex-col items-stretch gap-4 sm:w-auto sm:max-w-none sm:flex-row sm:items-center"
        style={{ animationDelay: "240ms" }}
      >
        <Link
          id="create-event-cta"
          href="/create-event"
          className="group inline-flex items-center justify-center gap-2 rounded-xl bg-[#E1003C] px-6 py-3.5 text-base font-semibold text-white shadow-lg transition-all duration-200 hover:bg-[#C00035] hover:shadow-[0_0_32px_rgba(225,0,60,0.45)] hover:-translate-y-0.5 active:translate-y-0 sm:px-7"
        >
          <Plus size={20} />
          {t("dashboard_home.welcome_cta")}
          <ArrowRight
            size={16}
            className="transition-transform duration-200 group-hover:translate-x-1"
          />
        </Link>
      </div>

      {/* Feature grid */}
      <div
        className="animate-fade-in-up mt-16 grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2"
        style={{ animationDelay: "320ms" }}
      >
        {FEATURES.map((f, i) => (
          <div
            key={f.titleKey}
            className={`group flex items-start gap-4 rounded-2xl border border-white/5 bg-white/[0.03] p-5 text-left transition-all duration-200 hover:border-white/10 hover:bg-white/[0.06] hover:-translate-y-0.5 ${
              i % 2 === 0 ? "hh-dash-from-left" : "hh-dash-from-right"
            }`}
            style={{ animationDelay: `${380 + i * 80}ms` }}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E1003C]/10">
              <f.icon size={20} className="text-[#E1003C]" />
            </div>
            <div>
              <p className="font-semibold text-white">{t(f.titleKey)}</p>
              <p className="mt-1 text-[15px] text-[var(--app-muted)]">{t(f.descKey)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const { activeEventId, primaryEvent, loading } = useActiveEvent();

  if (loading) return <BrandLoader message={t("Loading")} fullMinHeight />;

  /* ── No event yet — the welcome that leads to the first one ── */
  if (!primaryEvent || activeEventId == null) {
    return (
      <>
        <ThreeBackground />
        <div className="relative z-10">
          <NoEventWelcome />
        </div>
      </>
    );
  }

  return <EventHome key={activeEventId} eventId={activeEventId} />;
}
