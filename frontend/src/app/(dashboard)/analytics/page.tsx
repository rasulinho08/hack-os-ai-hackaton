"use client";

import { useState, useEffect, useMemo } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
} from "recharts";
import type { PieLabelRenderProps } from "recharts";
import {
  BarChart3,
  TrendingUp,
  Users,
  Layers,
  MessageSquare,
  Activity,
} from "lucide-react";
import { BrandLoader } from "@/components/BrandLoader";
import { useTranslation } from "@/contexts/LanguageContext";
import { apiGet } from "@/lib/api";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { resolveActiveEventId } from "@/lib/resolveEventId";
import type { Participant } from "@/types/participant";
import {
  normalizeParticipantFromApi,
  normalizeTeamFromApi,
  normalizeSubmissionFromApi,
  normalizeFeedbackFromApi,
  type NormalizedTeam,
  type NormalizedSubmission,
  type NormalizedFeedback,
} from "@/lib/analyticsNormalize";
import { formatDate } from "@/lib/i18n/dates";

const tooltipStyle = {
  contentStyle: {
    backgroundColor: "#1F1F1F",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px",
    color: "#fff",
    fontSize: "12px",
  },
};

const COLORS = [
  "#E1003C",
  "#FFC107",
  "#00C853",
  "#8B5CF6",
  "#3B82F6",
  "#F97316",
  "#EC4899",
  "#14B8A6",
];

const CHART_ANIM_MS = 1100;

function ChartCard({
  title,
  subtitle,
  staggerIndex = 0,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Staggered entrance delay (charts grid). */
  staggerIndex?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="analytics-chart-card card-shadow rounded-xl border border-white/5 bg-gradient-to-b from-[#1F1F1F] to-[#1a1a1a] p-5"
      style={{ animationDelay: `${Math.min(staggerIndex, 24) * 0.04}s` }}
    >
      <div className="mb-3">
        <h3 className="text-[15px] font-semibold text-white">{title}</h3>
        {subtitle ? (
          <p className="mt-0.5 text-[12px] text-[var(--app-muted-2)]">{subtitle}</p>
        ) : null}
      </div>
      <div className="min-h-[220px]">{children}</div>
    </div>
  );
}

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-[220px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/10 bg-white/[0.02] px-4 text-center">
      <BarChart3 className="analytics-chart-empty-icon h-9 w-9 text-[#5a5a5a]" />
      <p className="max-w-[220px] text-[13px] leading-relaxed text-[var(--app-muted)]">
        {message}
      </p>
    </div>
  );
}

/** Count-up / ease for KPI tiles when data loads or event switches. */
function AnimatedMetric({
  value,
  color,
}: {
  value: number | string;
  color: string;
}) {
  // `null` means "not mid-animation" and the real value renders. Counting up
  // from "0" meant a background tab, where requestAnimationFrame never fires,
  // showed 0 for every metric on the page.
  const [animating, setAnimating] = useState<string | null>(null);

  useEffect(() => {
    if (value === "—") return;
    const raw =
      typeof value === "number"
        ? value
        : Number(String(value).trim().replace(/,/g, ""));
    if (!Number.isFinite(raw)) return;

    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced || document.hidden) return;

    const isInt = Number.isInteger(raw);
    const start = performance.now();
    const dur = 880;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      if (t >= 1) {
        setAnimating(null);
        return;
      }
      const v = (1 - (1 - t) ** 2.25) * raw;
      setAnimating(isInt ? String(Math.round(v)) : v.toFixed(1));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const settle = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        setAnimating(null);
      }
    };
    document.addEventListener("visibilitychange", settle);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", settle);
    };
  }, [value]);

  return (
    <p
      className="text-2xl font-bold tabular-nums tracking-tight"
      style={{ color }}
    >
      {animating ?? (typeof value === "number" ? value.toLocaleString() : value)}
    </p>
  );
}

function StatCard({
  label,
  value,
  color,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  color: string;
  icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}) {
  return (
    <div className="analytics-stat-slot">
      <div className="analytics-stat-card-inner group card-shadow relative overflow-hidden rounded-xl border border-white/5 bg-[var(--app-surface)] p-4 transition-colors hover:border-white/10">
        <div
          className="pointer-events-none absolute -right-4 -top-4 h-20 w-20 rounded-full opacity-[0.12] transition-transform duration-500 group-hover:scale-110"
          style={{ background: color }}
        />
        <div className="relative flex items-start justify-between gap-2">
          <div>
            <AnimatedMetric value={value} color={color} />
            <p className="mt-1 text-[12px] leading-tight text-[var(--app-muted)]">
              {label}
            </p>
          </div>
          {Icon ? (
            <Icon className="h-5 w-5 shrink-0 text-[#5a5a5a] transition-all duration-300 group-hover:scale-110 group-hover:text-[var(--app-muted)]" />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function attendanceFromRawRows(rows: unknown[]) {
  let online = 0;
  let offline = 0;
  let unspecified = 0;
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const am = r.attendance_mode ?? r.attendanceMode;
    if (am == null || am === "") {
      unspecified++;
      continue;
    }
    if (String(am).toLowerCase() === "offline") offline++;
    else online++;
  }
  const out: { name: string; value: number }[] = [];
  if (online) out.push({ name: "Online", value: online });
  if (offline) out.push({ name: "Offline", value: offline });
  if (unspecified) out.push({ name: "Not specified", value: unspecified });
  return out;
}

export default function AnalyticsPage() {
  const { t, lang } = useTranslation();
  const { activeEventId, loading: eventLoading } = useActiveEvent();
  const [eventId, setEventId] = useState<number | null>(null);
  const [participantRows, setParticipantRows] = useState<unknown[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [teams, setTeams] = useState<NormalizedTeam[]>([]);
  const [submissions, setSubmissions] = useState<NormalizedSubmission[]>([]);
  const [feedbacks, setFeedbacks] = useState<NormalizedFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState("");

  useEffect(() => {
    const fmt = () =>
      formatDate(new Date(), lang, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    setClock(fmt());
    const id = setInterval(() => setClock(fmt()), 1000);
    return () => clearInterval(id);
  }, [lang]);

  useEffect(() => {
    if (eventLoading) return;
    let cancelled = false;
    void (async () => {
      const eid = activeEventId ?? (await resolveActiveEventId());
      if (!cancelled) setEventId(eid);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeEventId, eventLoading]);

  useEffect(() => {
    if (eventId == null) {
      setParticipantRows([]);
      setParticipants([]);
      setTeams([]);
      setSubmissions([]);
      setFeedbacks([]);
      setLoading(false);
      return;
    }
    const eid = eventId;
    async function load() {
      setLoading(true);
      try {
        const [pData, tData, sData, fData] = await Promise.allSettled([
          apiGet<unknown[]>(`/api/events/${eid}/participants`),
          apiGet<unknown[]>(`/api/teams?eventId=${eid}`),
          apiGet<unknown[]>(`/api/submissions?eventId=${eid}`),
          apiGet<unknown[]>(`/api/events/${eid}/feedback`),
        ]);

        const pRows =
          pData.status === "fulfilled" && Array.isArray(pData.value)
            ? pData.value
            : [];
        setParticipantRows(pRows);
        setParticipants(
          pRows
            .map((row) => normalizeParticipantFromApi(row))
            .filter((x): x is Participant => x != null)
        );

        if (tData.status === "fulfilled" && Array.isArray(tData.value)) {
          setTeams(
            tData.value
              .map(normalizeTeamFromApi)
              .filter((x): x is NormalizedTeam => x != null)
          );
        } else setTeams([]);

        if (sData.status === "fulfilled" && Array.isArray(sData.value)) {
          setSubmissions(
            sData.value
              .map(normalizeSubmissionFromApi)
              .filter((x): x is NormalizedSubmission => x != null)
          );
        } else setSubmissions([]);

        if (fData.status === "fulfilled" && Array.isArray(fData.value)) {
          setFeedbacks(
            fData.value
              .map(normalizeFeedbackFromApi)
              .filter((x): x is NormalizedFeedback => x != null)
          );
        } else setFeedbacks([]);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [eventId]);

  const countryData = useMemo(() => {
    const counts: Record<string, number> = {};
    participants.forEach((p) => {
      const c = p.country?.trim();
      if (c) counts[c] = (counts[c] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }));
  }, [participants]);

  const experienceData = useMemo(() => {
    const counts: Record<string, number> = {};
    participants.forEach((p) => {
      const e = p.experience || "beginner";
      counts[e] = (counts[e] || 0) + 1;
    });
    return Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value,
      }));
  }, [participants]);

  const attendanceData = useMemo(
    () => attendanceFromRawRows(participantRows),
    [participantRows]
  );

  const skillsData = useMemo(() => {
    const counts: Record<string, number> = {};
    participants.forEach((p) => {
      p.skills?.forEach((s) => {
        const k = s.trim();
        if (k) counts[k] = (counts[k] || 0) + 1;
      });
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));
  }, [participants]);

  const uniData = useMemo(() => {
    const counts: Record<string, number> = {};
    participants.forEach((p) => {
      const u = p.university?.trim();
      if (u) counts[u] = (counts[u] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, value]) => ({ name, value }));
  }, [participants]);

  const regData = useMemo(() => {
    const byDate: Record<string, number> = {};
    participants.forEach((p) => {
      if (p.registeredAt) {
        try {
          const d = new Date(p.registeredAt);
          if (!Number.isNaN(d.getTime())) {
            const key = formatDate(d, lang, { month: "short", day: "numeric" });
            byDate[key] = (byDate[key] || 0) + 1;
          }
        } catch {
          /* skip */
        }
      }
    });
    let cumulative = 0;
    return Object.entries(byDate).map(([date, count]) => {
      cumulative += count;
      return { date, count, cumulative };
    });
  }, [participants, lang]);

  const statusBreakdown = useMemo(() => {
    const a = participants.filter((p) => p.status === "approved").length;
    const pe = participants.filter((p) => p.status === "pending").length;
    const r = participants.filter((p) => p.status === "rejected").length;
    return [
      { name: t("analytics.status_approved"), value: a },
      { name: t("analytics.status_pending"), value: pe },
      { name: t("analytics.status_rejected"), value: r },
    ].filter((x) => x.value > 0);
  }, [participants, t]);

  const roleData = useMemo(() => {
    const counts: Record<string, number> = {};
    participants.forEach((p) => {
      const role = (p.role || "Other").trim() || "Other";
      counts[role] = (counts[role] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({ name, value }));
  }, [participants]);

  const teamSizeData = useMemo(() => {
    const buckets: Record<string, number> = {
      "0": 0,
      "1": 0,
      "2–3": 0,
      "4–5": 0,
      "6+": 0,
    };
    teams.forEach((team) => {
      const n = team.memberCount;
      if (n <= 0) buckets["0"]++;
      else if (n === 1) buckets["1"]++;
      else if (n <= 3) buckets["2–3"]++;
      else if (n <= 5) buckets["4–5"]++;
      else buckets["6+"]++;
    });
    return Object.entries(buckets)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name, value }));
  }, [teams]);

  const submissionTimeline = useMemo(() => {
    const byDay: Record<string, number> = {};
    submissions.forEach((s) => {
      if (!s.submittedAt) return;
      try {
        const d = new Date(s.submittedAt);
        if (Number.isNaN(d.getTime())) return;
        const key = formatDate(d, lang, { month: "short", day: "numeric" });
        byDay[key] = (byDay[key] || 0) + 1;
      } catch {
        /* skip */
      }
    });
    return Object.entries(byDay).map(([date, count]) => ({ date, count }));
  }, [submissions, lang]);

  const submissionStatusData = useMemo(() => {
    const counts: Record<string, number> = {};
    submissions.forEach((s) => {
      const st = s.status || "submitted";
      counts[st] = (counts[st] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [submissions]);

  const feedbackHistogram = useMemo(() => {
    const buckets: Record<number, number> = {};
    feedbacks.forEach((f) => {
      const r = Math.round(f.rating);
      const k = Math.min(5, Math.max(1, r));
      buckets[k] = (buckets[k] || 0) + 1;
    });
    return [1, 2, 3, 4, 5].map((stars) => ({
      stars: `${stars}★`,
      count: buckets[stars] ?? 0,
    }));
  }, [feedbacks]);

  const totalParticipants = participants.length;
  const approvedCount = participants.filter((p) => p.status === "approved").length;
  const pendingCount = participants.filter((p) => p.status === "pending").length;
  const rejectedCount = participants.filter((p) => p.status === "rejected").length;
  const totalTeams = teams.length;
  /*
   * Counted from the submissions themselves.
   *
   * This used to read `project_status` off the team row, which no endpoint
   * returns — the teams table carries active/eliminated and nothing about
   * hand-ins — so the tile read 0 for every event, including ones where every
   * team had submitted. A submission knows its team, and that is the link.
   */
  const submittedTeams = new Set(
    submissions.map((s) => s.teamId).filter((id): id is number => id != null),
  ).size;
  const totalSubmissions = submissions.length;
  const avgFeedback = feedbacks.length
    ? (
        feedbacks.reduce((a, f) => a + f.rating, 0) / feedbacks.length
      ).toFixed(1)
    : "—";

  const soloCount = participants.filter((p) => p.isSolo).length;
  const teamLeadCount = participants.filter((p) => p.isTeamLead).length;

  const hasAnyData =
    participants.length > 0 ||
    teams.length > 0 ||
    submissions.length > 0 ||
    feedbacks.length > 0;

  if (loading) {
    return (
      <BrandLoader message={t("analytics.loading")} fullMinHeight />
    );
  }

  return (
    <div className="analytics-dash space-y-8">
      <div className="analytics-top-rail max-w-3xl" aria-hidden />

      <div className="relative overflow-hidden rounded-2xl border border-[#E1003C]/20 bg-gradient-to-br from-[#E1003C]/12 via-[#1F1F1F] to-[#111] p-6 sm:p-8">
        <div className="pointer-events-none absolute -left-24 -top-28 h-72 w-72 rounded-full bg-[#E1003C]/15 blur-3xl analytics-hero-blob" />
        <div className="pointer-events-none absolute -right-16 bottom-0 h-56 w-56 rounded-full bg-[#FFC107]/10 blur-3xl analytics-hero-blob--alt" />
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#E1003C]/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[12px] font-medium uppercase tracking-widest text-[#E1003C]/90">
              {t("analytics.badge")}
            </p>
            <h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">
              {t("analytics.title")}
            </h1>
            <p className="mt-2 max-w-xl text-[15px] text-[var(--app-muted)]">
              {t("analytics.subtitle")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 rounded-xl border border-white/10 bg-black/25 px-4 py-2.5 backdrop-blur-sm">
            <span
              className="analytics-live-dot relative flex h-2.5 w-2.5 rounded-full bg-[#00C853]"
              aria-hidden
            />
            <div className="flex flex-col">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--app-ok)]">
                <Activity className="h-3.5 w-3.5" aria-hidden />
                Live
              </span>
              <span className="font-mono text-[13px] tabular-nums text-white/90">
                {clock}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Summary stats — 5 per row so nothing drops */}
      <div
        key={`analytics-stats-${eventId ?? "none"}`}
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5"
      >
        <StatCard
          label={t("analytics.participants")}
          value={totalParticipants}
          color="#E1003C"
          icon={Users}
        />
        <StatCard
          label={t("analytics.approved")}
          value={approvedCount}
          color="#00C853"
        />
        <StatCard
          label={t("analytics.pending")}
          value={pendingCount}
          color="#FFC107"
        />
        <StatCard
          label={t("analytics.rejected")}
          value={rejectedCount}
          color="#FF3B30"
        />
        <StatCard
          label={t("analytics.teams")}
          value={totalTeams}
          color="#8B5CF6"
          icon={Layers}
        />
        <StatCard
          label={t("analytics.submitted_teams")}
          value={submittedTeams}
          color="#3B82F6"
        />
        <StatCard
          label={t("analytics.submissions")}
          value={totalSubmissions}
          color="#F97316"
        />
        <StatCard
          label={t("analytics.avg_feedback")}
          value={avgFeedback}
          color="#14B8A6"
          icon={MessageSquare}
        />
        <StatCard
          label={t("analytics.team_leads")}
          value={teamLeadCount}
          color="#EC4899"
        />
        <StatCard
          label={t("analytics.solo")}
          value={soloCount}
          color="#A855F7"
          icon={TrendingUp}
        />
      </div>

      {!hasAnyData && (
        <div className="animate-fade-in rounded-xl border border-[#FFC107]/25 bg-[#FFC107]/5 px-4 py-4 text-center text-[15px] text-[var(--app-warn)]">
          {t("analytics.no_data")}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard
          staggerIndex={0}
          title={t("analytics.participant_status")}
          subtitle={t("analytics.participant_status_hint")}
        >
          {statusBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={statusBreakdown}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={78}
                  animationDuration={CHART_ANIM_MS}
                  animationEasing="ease-out"
                  label={(props: PieLabelRenderProps) =>
                    `${props.name ?? ""} ${((((props.percent as number) ?? 0) * 100).toFixed(0))}%`
                  }
                >
                  {statusBreakdown.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip {...tooltipStyle} />
                <Legend
                  wrapperStyle={{ fontSize: "11px", color: "var(--app-muted)" }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty message={t("analytics.no_chart_data")} />
          )}
        </ChartCard>

        <ChartCard
          staggerIndex={1}
          title={t("analytics.country")}
          subtitle={t("analytics.country_hint")}
        >
          {countryData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={countryData} layout="vertical">
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.05)"
                />
                <XAxis
                  type="number"
                  tick={{ fill: "var(--app-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: "var(--app-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={100}
                />
                <Tooltip {...tooltipStyle} />
                <Bar
                  dataKey="value"
                  fill="#E1003C"
                  radius={[0, 4, 4, 0]}
                  animationDuration={CHART_ANIM_MS}
                  animationEasing="ease-out"
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty message={t("analytics.empty_country")} />
          )}
        </ChartCard>

        <ChartCard
          staggerIndex={2}
          title={t("analytics.experience")}
          subtitle={t("analytics.experience_hint")}
        >
          {experienceData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={experienceData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={78}
                  animationDuration={CHART_ANIM_MS}
                  animationEasing="ease-out"
                  label={(props: PieLabelRenderProps) =>
                    `${props.name ?? ""} ${((((props.percent as number) ?? 0) * 100).toFixed(0))}%`
                  }
                >
                  {experienceData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip {...tooltipStyle} />
                <Legend
                  wrapperStyle={{ fontSize: "11px", color: "var(--app-muted)" }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty message={t("analytics.empty_experience")} />
          )}
        </ChartCard>

        <ChartCard
          staggerIndex={3}
          title={t("analytics.participant_roles")}
          subtitle={t("analytics.participant_roles_hint")}
        >
          {roleData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={roleData} layout="vertical">
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.05)"
                />
                <XAxis
                  type="number"
                  tick={{ fill: "var(--app-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: "var(--app-muted)", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={90}
                />
                <Tooltip {...tooltipStyle} />
                <Bar
                  dataKey="value"
                  fill="#14B8A6"
                  radius={[0, 4, 4, 0]}
                  animationDuration={CHART_ANIM_MS}
                  animationEasing="ease-out"
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty message={t("analytics.no_chart_data")} />
          )}
        </ChartCard>

        <ChartCard
          staggerIndex={4}
          title={t("analytics.skills")}
          subtitle={t("analytics.skills_hint")}
        >
          {skillsData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={skillsData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.05)"
                />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "var(--app-muted)", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  angle={-25}
                  textAnchor="end"
                  height={56}
                />
                <YAxis
                  tick={{ fill: "var(--app-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip {...tooltipStyle} />
                <Bar
                  dataKey="count"
                  fill="#8B5CF6"
                  radius={[4, 4, 0, 0]}
                  animationDuration={CHART_ANIM_MS}
                  animationEasing="ease-out"
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty message={t("analytics.empty_skills")} />
          )}
        </ChartCard>

        <ChartCard
          staggerIndex={5}
          title={t("analytics.online_offline")}
          subtitle={t("analytics.online_offline_hint")}
        >
          {attendanceData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={attendanceData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={78}
                  animationDuration={CHART_ANIM_MS}
                  animationEasing="ease-out"
                  label={(props: PieLabelRenderProps) =>
                    `${props.name ?? ""} ${((((props.percent as number) ?? 0) * 100).toFixed(0))}%`
                  }
                >
                  {attendanceData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip {...tooltipStyle} />
                <Legend
                  wrapperStyle={{ fontSize: "11px", color: "var(--app-muted)" }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty message={t("analytics.no_chart_data")} />
          )}
        </ChartCard>

        <ChartCard
          staggerIndex={6}
          title={t("analytics.university")}
          subtitle={t("analytics.university_hint")}
        >
          {uniData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={uniData} layout="vertical">
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.05)"
                />
                <XAxis
                  type="number"
                  tick={{ fill: "var(--app-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: "var(--app-muted)", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={120}
                />
                <Tooltip {...tooltipStyle} />
                <Bar
                  dataKey="value"
                  fill="#3B82F6"
                  radius={[0, 4, 4, 0]}
                  animationDuration={CHART_ANIM_MS}
                  animationEasing="ease-out"
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty message={t("analytics.empty_university")} />
          )}
        </ChartCard>

        <ChartCard
          staggerIndex={7}
          title={t("analytics.team_sizes")}
          subtitle={t("analytics.team_sizes_hint")}
        >
          {teamSizeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={teamSizeData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.05)"
                />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "var(--app-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "var(--app-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip {...tooltipStyle} />
                <Bar
                  dataKey="value"
                  fill="#F97316"
                  radius={[4, 4, 0, 0]}
                  animationDuration={CHART_ANIM_MS}
                  animationEasing="ease-out"
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty message={t("analytics.empty_teams")} />
          )}
        </ChartCard>

        <ChartCard
          staggerIndex={8}
          title={t("analytics.submissions_timeline")}
          subtitle={t("analytics.submissions_timeline_hint")}
        >
          {submissionTimeline.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={submissionTimeline}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.05)"
                />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "var(--app-muted)", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "var(--app-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip {...tooltipStyle} />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#E1003C"
                  strokeWidth={2}
                  dot={{ fill: "#E1003C", r: 3 }}
                  animationDuration={CHART_ANIM_MS}
                  animationEasing="ease-out"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty message={t("analytics.empty_submissions")} />
          )}
        </ChartCard>

        <ChartCard
          staggerIndex={9}
          title={t("analytics.submission_status")}
          subtitle={t("analytics.submission_status_hint")}
        >
          {submissionStatusData.length > 0 && totalSubmissions > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={submissionStatusData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={78}
                  animationDuration={CHART_ANIM_MS}
                  animationEasing="ease-out"
                  label={(props: PieLabelRenderProps) =>
                    `${props.name ?? ""} ${((((props.percent as number) ?? 0) * 100).toFixed(0))}%`
                  }
                >
                  {submissionStatusData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip {...tooltipStyle} />
                <Legend
                  wrapperStyle={{ fontSize: "11px", color: "var(--app-muted)" }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty message={t("analytics.empty_submissions")} />
          )}
        </ChartCard>

        <ChartCard
          staggerIndex={10}
          title={t("analytics.feedback_distribution")}
          subtitle={t("analytics.feedback_distribution_hint")}
        >
          {feedbacks.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={feedbackHistogram}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.05)"
                />
                <XAxis
                  dataKey="stars"
                  tick={{ fill: "var(--app-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "var(--app-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip {...tooltipStyle} />
                <Bar
                  dataKey="count"
                  fill="#14B8A6"
                  radius={[4, 4, 0, 0]}
                  animationDuration={CHART_ANIM_MS}
                  animationEasing="ease-out"
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty message={t("analytics.empty_feedback")} />
          )}
        </ChartCard>

        <ChartCard
          staggerIndex={11}
          title={t("analytics.registration")}
          subtitle={t("analytics.registration_hint")}
        >
          {regData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={regData}>
                <defs>
                  <linearGradient id="regGradAnalytics" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#E1003C" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#E1003C" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.05)"
                />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "var(--app-muted)", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "var(--app-muted)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip {...tooltipStyle} />
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  stroke="#E1003C"
                  fill="url(#regGradAnalytics)"
                  strokeWidth={2}
                  animationDuration={CHART_ANIM_MS}
                  animationEasing="ease-out"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmpty message={t("analytics.empty_registration")} />
          )}
        </ChartCard>
      </div>
    </div>
  );
}
