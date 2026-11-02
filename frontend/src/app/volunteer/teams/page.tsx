"use client";

import { useEffect, useState, useCallback } from "react";
import { Users, Search } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { LoadFailure } from "@/components/LoadFailure";
import { useToast } from "@/contexts/ToastContext";
import { apiGet } from "@/lib/api";
import { staffEventId } from "@/lib/participantEvent";
import { BrandLoader } from "@/components/BrandLoader";

interface Team {
  id: number;
  name: string;
  join_code?: string;
  member_count?: number;
}

export default function VolunteerTeams() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The teams of the volunteer's own event, not every team the API can show.
      const eventId = await staffEventId("volunteer");
      const data = eventId != null ? await apiGet<Team[]>(`/api/teams?eventId=${eventId}&excludeEmpty=true`) : [];
      setTeams(data || []);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
      toast(t("volunteer.teams.toast_failed"), "error");
    } finally {
      setLoading(false);
    }
  }, [toast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredTeams = teams.filter((team) =>
    String(team.name ?? "")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <BrandLoader />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E1003C]/10">
          <Users className="text-[#E1003C]" size={20} />
        </div>
        <h1 className="text-xl font-semibold text-white">
          {t("volunteer.teams.title")}
        </h1>
      </div>

      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-muted-2)]"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("volunteer.teams.search")}
          className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] pl-10 pr-4 text-[15px] text-white outline-none placeholder:text-[var(--app-muted-2)] focus:border-[#E1003C]/50"
        />
      </div>

      <div className="rounded-2xl border border-white/5 bg-[var(--app-surface)] p-4">
        <div className="table-scroll">
          <table className="w-full text-left text-[15px]">
            <thead className="text-[var(--app-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">{t("volunteer.teams.name")}</th>
                <th className="px-3 py-2 font-medium">{t("volunteer.members")}</th>
                <th className="px-3 py-2 font-medium">{t("volunteer.join_code")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredTeams.map((team) => (
                <tr key={team.id} className="hover:bg-white/[0.02]">
                  <td className="px-3 py-3 text-white">{team.name}</td>
                  <td className="px-3 py-3 text-[var(--app-muted)]">{team.member_count || 0}</td>
                  <td className="px-3 py-3 font-mono text-[13px] text-[var(--app-muted-2)]">
                    {team.join_code || "—"}
                  </td>
                </tr>
              ))}
              {filteredTeams.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-8 text-center text-[var(--app-muted-2)]">
                    {loadFailed ? (
                      <LoadFailure compact onRetry={() => void load()} retrying={loading} />
                    ) : (
                      t("volunteer.teams.empty")
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
