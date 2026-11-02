"use client";

import { useState, useEffect } from "react";
import { Users, GitBranch, FolderGit2, Loader2, ExternalLink } from "lucide-react";
import { apiGet } from "@/lib/api";
import { resolveMentorEventId } from "@/lib/resolveEventId";
import { safeDisplayText } from "@/lib/ticketDisplay";
import { useTranslation } from "@/contexts/LanguageContext";
import { LoadFailure } from "@/components/LoadFailure";

interface TeamMember {
  id: number;
  name?: string;
  full_name?: string;
  email?: string;
  is_leader?: boolean;
}

interface Team {
  id: number;
  name: string;
  event_id?: number;
  members?: TeamMember[] | number | null;
}

interface Submission {
  id: number;
  team_id: number;
  team_name?: string;
  project_name?: string;
  description?: string;
  repo_link?: string;
  demo_link?: string;
  presentation_link?: string;
  tech_stack?: string;
  status?: string;
}

interface EventLite {
  id: number;
  team_size_limit?: number;
}

function memberDisplayName(m: TeamMember): string {
  return (
    (m.full_name && String(m.full_name).trim()) ||
    (m.name && String(m.name).trim()) ||
    (m.email && String(m.email).trim()) ||
    `User ${m.id}`
  );
}

/** True when backend returned no usable member rows for this team. */
function membersAreEmpty(team: Team): boolean {
  return !Array.isArray(team.members) || team.members.length === 0;
}

export default function MentorTeamsPage() {
  const { t } = useTranslation();
  const [teams, setTeams] = useState<Team[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [teamSizeLimit, setTeamSizeLimit] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    async function fetchData() {
      try {
        const eid = await resolveMentorEventId();
        // excludeEmpty=true filters out teams with zero members on the
        // server so we don't waste a round-trip on /:id/members for
        // abandoned shells (problem 17). The client-side filter below
        // is still kept as a safety net in case the backend is older.
        const [teamData, submissionData, eventData] = await Promise.all([
          apiGet<Team[]>(`/api/teams?eventId=${eid}&excludeEmpty=true`),
          apiGet<Submission[]>(`/api/submissions?eventId=${eid}`),
          apiGet<EventLite>(`/api/events/${eid}`).catch(() => null),
        ]);
        const baseTeams = Array.isArray(teamData) ? teamData : [];

        // Backfill members: GET /api/teams sometimes returns empty/aggregated
        // member arrays when the user/team_member join row is stale. For each
        // team that came back empty, fetch /api/teams/:id/members directly so
        // the mentor view never shows "Members: —" for a team that actually
        // has people on it.
        const enriched = await Promise.all(
          baseTeams.map(async (t) => {
            if (!membersAreEmpty(t)) return t;
            try {
              const mem = await apiGet<TeamMember[]>(
                `/api/teams/${t.id}/members`,
              );
              return { ...t, members: Array.isArray(mem) ? mem : [] };
            } catch {
              return t;
            }
          }),
        );

        // Defensive client-side filter: even after the round-trip
        // backfill, hide teams that genuinely have no members. The
        // mentor view exists to help live teams — empty shells aren't
        // actionable here (admin can clean them up from /teams).
        const populatedOnly = enriched.filter((t) => !membersAreEmpty(t));

        setTeams(populatedOnly);
        setSubmissions(Array.isArray(submissionData) ? submissionData : []);
        if (eventData?.team_size_limit != null) {
          setTeamSizeLimit(Number(eventData.team_size_limit));
        }
        setLoadFailed(false);
      } catch (err) {
        // Console-only again: a mentor whose team list failed was told there
        // were no teams to help.
        console.error("Failed to load teams data", err);
        setLoadFailed(true);
      } finally {
        setLoading(false);
      }
    }
    void fetchData();
  }, [reloadKey]);

  const getSubmissionForTeam = (teamId: number): Submission | undefined => {
    return submissions.find((s) => Number(s.team_id) === Number(teamId));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-[#E1003C]" />
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.02em] text-[var(--app-heading)]">
          {t("mentor.teams.title")}
        </h1>
        <p className="mt-1 text-[15px] text-[var(--app-muted)]">
          {t("mentor.teams.subtitle")}
        </p>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        {teams.length === 0 && loadFailed ? (
          <div className="col-span-full">
            <LoadFailure
              onRetry={() => setReloadKey((k) => k + 1)}
              retrying={loading}
            />
          </div>
        ) : teams.length === 0 ? (
          <p className="col-span-full py-10 text-center text-[15px] text-[var(--app-muted)]">
            {t("mentor.teams.empty")}
          </p>
        ) : (
          teams.map((team) => {
            const memberList: TeamMember[] = Array.isArray(team.members)
              ? (team.members as TeamMember[])
              : [];
            const memberCount = memberList.length;
            const submission = getSubmissionForTeam(team.id);
            const projectName = submission?.project_name?.trim() || "";
            const repoLink = submission?.repo_link?.trim() || "";
            const demoLink = submission?.demo_link?.trim() || "";
            const presentationLink =
              submission?.presentation_link?.trim() || "";
            const techStack = submission?.tech_stack?.trim() || "";
            const status = submission?.status?.trim() || "";
            const toHref = (u: string) =>
              u.startsWith("http") ? u : `https://${u}`;
            const teamName = team.name?.trim() || `Team #${team.id}`;

            return (
              <div
                key={team.id}
                className="card-shadow min-w-0 overflow-hidden rounded-xl border border-white/5 bg-[var(--app-surface)] p-4 sm:p-5"
              >
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#00C853]/15 text-[var(--app-ok)]">
                      <Users size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="break-words text-[15px] font-semibold text-white">
                        {safeDisplayText(teamName)}
                      </h3>
                      <p className="text-[12px] text-[var(--app-muted)]">
                        {t("mentor.teams.members_count")
                          .replace("{count}", String(memberCount))
                          .replace(
                            "{limit}",
                            teamSizeLimit != null ? `/${teamSizeLimit}` : "",
                          )}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 self-start sm:self-auto">
                  {submission ? (
                    <span
                      className={`inline-block max-w-full whitespace-normal break-words rounded-full px-2 py-0.5 text-left text-[11px] font-medium leading-snug sm:text-right ${
                        status === "graded"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : status === "reviewing"
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-blue-500/15 text-blue-300"
                      }`}
                    >
                      {status
                        ? t("mentor.teams.submission_status").replace(
                            "{status}",
                            status,
                          )
                        : t("mentor.teams.submitted")}
                    </span>
                  ) : (
                    <span className="inline-block max-w-full rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] font-medium text-[var(--app-muted)]">
                      {t("mentor.teams.no_submission")}
                    </span>
                  )}
                  </div>
                </div>

                <div className="mt-4 min-w-0 space-y-2 text-[15px]">
                  <div className="flex min-w-0 items-start gap-2 text-[var(--app-muted)]">
                    <FolderGit2
                      size={14}
                      className="mt-0.5 shrink-0 text-[#E1003C]"
                    />
                    <span className="min-w-0 flex-1 break-words">
                      {projectName ? (
                        <span className="text-white">{projectName}</span>
                      ) : (
                        <span className="text-[var(--app-muted-2)]">
                          {t("mentor.teams.no_project_name")}
                        </span>
                      )}
                      {techStack && (
                        <span className="mt-1 block text-[12px] text-[var(--app-muted-2)] sm:ml-2 sm:mt-0 sm:inline">
                          · {techStack}
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="flex min-w-0 items-start gap-2 text-[var(--app-muted)]">
                    <GitBranch size={14} className="mt-0.5 shrink-0 text-[#E1003C]" />
                    {repoLink ? (
                      <a
                        href={toHref(repoLink)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 flex-1 break-all text-[#E1003C] hover:underline"
                      >
                        {repoLink}
                      </a>
                    ) : (
                      <span className="text-[var(--app-muted-2)]">
                        {t("mentor.teams.no_repo")}
                      </span>
                    )}
                  </div>

                  {(demoLink || presentationLink) && (
                    <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-2 text-[12px]">
                      {demoLink && (
                        <a
                          href={toHref(demoLink)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[#E1003C] hover:underline"
                        >
                          <ExternalLink size={11} /> {t("mentor.teams.demo")}
                        </a>
                      )}
                      {presentationLink && (
                        <a
                          href={toHref(presentationLink)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[#E1003C] hover:underline"
                        >
                          <ExternalLink size={11} />{" "}
                          {t("mentor.teams.presentation")}
                        </a>
                      )}
                    </div>
                  )}

                  <div className="border-t border-white/5 pt-2">
                    <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--app-muted-2)]">
                      {t("mentor.teams.members")}
                    </p>
                    {memberList.length > 0 ? (
                      <ul className="space-y-2">
                        {memberList.map((m) => (
                          <li
                            key={m.id}
                            className="min-w-0 rounded-lg border border-white/[0.04] bg-black/20 px-2 py-2 text-[12px] text-[var(--app-muted)] sm:border-0 sm:bg-transparent sm:px-0 sm:py-0"
                          >
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="break-words text-white">
                                {memberDisplayName(m)}
                              </span>
                              {m.is_leader && (
                                <span className="shrink-0 rounded-full bg-[#E1003C]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#E1003C]">
                                  {t("mentor.teams.lead")}
                                </span>
                              )}
                            </div>
                            {m.email && (
                              <a
                                href={`mailto:${m.email}`}
                                className="mt-1 block break-all text-[var(--app-muted-2)] hover:text-white"
                              >
                                {m.email}
                              </a>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[12px] text-[var(--app-muted-2)]">
                        {t("mentor.teams.no_members")}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
