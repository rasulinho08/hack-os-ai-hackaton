"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import {
  Award,
  Calendar,
  Code2,
  Edit3,
  GitBranch,
  Globe,
  GraduationCap,
  Linkedin,
  Loader2,
  MapPin,
  Phone,
  Save,
  Trophy,
  User,
  Wifi,
  X,
  type LucideIcon,
} from "lucide-react";
import { apiGet, apiPatch } from "@/lib/api";
import { useToast } from "@/contexts/ToastContext";
import { useTranslation } from "@/contexts/LanguageContext";
import { TelegramConnectCard } from "@/components/announcements/TelegramConnectCard";
import {
  normalizeUserFromApi,
  buildUserPatchPayload,
  type UserProfileNormalized,
} from "@/lib/userProfileNormalize";
import {
  mergeHackerProfileWithCache,
  readHackerProfileCache,
  writeHackerProfileCache,
} from "@/lib/hackerProfileCache";
import {
  COUNTRIES,
  TIMEZONES,
  SKILL_OPTIONS,
  EXPERIENCE_LEVELS,
} from "@/types/participant";
import {
  formatAgeFieldValue,
  normalizeAzerbaijanPhoneInput,
  parseAgeInputDigits,
  isCompleteAzerbaijanPhone,
  isAzerbaijanPhoneEmptyOrPrefixOnly,
  sanitizeSocialUrl,
} from "@/lib/azPhoneAge";
import { formatDate } from "@/lib/i18n/dates";
import { CalendarFeedCard } from "@/components/calendar/CalendarFeedCard";

export default function ProfilePage() {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<UserProfileNormalized | null>(null);
  const [projectCount, setProjectCount] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<UserProfileNormalized>>({});
  const [skillSearch, setSkillSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      const [me, subs] = await Promise.allSettled([
        apiGet<unknown>("/api/auth/me"),
        apiGet<unknown[]>("/api/submissions"),
      ]);
      if (me.status === "fulfilled") {
        const normalized = normalizeUserFromApi(me.value);
        if (normalized) {
          const merged = mergeHackerProfileWithCache(
            normalized,
            readHackerProfileCache(normalized.id)
          );
          setUser(merged);
          writeHackerProfileCache(merged);
        } else {
          setUser(null);
        }
      } else {
        setUser(null);
      }
      if (subs.status === "fulfilled")
        setProjectCount(Array.isArray(subs.value) ? subs.value.length : 0);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const startEdit = () => {
    if (!user) return;
    setEditData({
      ...user,
      phone: normalizeAzerbaijanPhoneInput(user.phone || ""),
    });
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditData({});
  };

  const saveEdit = async () => {
    if (!user) return;
    const mergedAge = editData.age ?? user.age;
    if (!mergedAge || mergedAge < 14 || mergedAge > 99) {
      toast(t("profile.invalid_age"), "error");
      return;
    }
    const mergedPhone = normalizeAzerbaijanPhoneInput(
      String(editData.phone ?? user.phone ?? "")
    );
    if (
      !isAzerbaijanPhoneEmptyOrPrefixOnly(mergedPhone) &&
      !isCompleteAzerbaijanPhone(mergedPhone)
    ) {
      toast(t("profile.invalid_phone"), "error");
      return;
    }
    setSaving(true);
    try {
      const payload = buildUserPatchPayload(
        {
          ...editData,
          age: mergedAge,
          phone: mergedPhone,
          linkedin: sanitizeSocialUrl(String(editData.linkedin ?? user.linkedin)),
          github: sanitizeSocialUrl(String(editData.github ?? user.github)),
        },
        user
      );
      await apiPatch(`/api/users/${user.id}`, payload);
      const fresh = await apiGet<unknown>("/api/auth/me");
      const normalized = normalizeUserFromApi(fresh);
      if (normalized) {
        let merged = mergeHackerProfileWithCache(
          normalized,
          readHackerProfileCache(normalized.id)
        );
        merged = {
          ...merged,
          ...editData,
          id: merged.id,
          email: merged.email,
        } as UserProfileNormalized;
        setUser(merged);
        writeHackerProfileCache(merged);
        toast(t("profile.saved"), "success");
      } else {
        const fallback = { ...user, ...editData } as UserProfileNormalized;
        setUser(fallback);
        writeHackerProfileCache(fallback);
        toast(t("profile.saved"), "success");
      }
      setEditing(false);
      setEditData({});
    } catch (e) {
      const fallback = { ...user, ...editData } as UserProfileNormalized;
      writeHackerProfileCache(fallback);
      toast(
        e instanceof Error ? e.message : t("profile.toast_save_failed"),
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  const setField = <K extends keyof UserProfileNormalized>(
    key: K,
    value: UserProfileNormalized[K]
  ) => {
    setEditData((prev) => ({ ...prev, [key]: value }));
  };

  const toggleSkill = (skill: string) => {
    const current = (editData.skills as string[]) || user?.skills || [];
    setEditData((prev) => ({
      ...prev,
      skills: current.includes(skill)
        ? current.filter((s) => s !== skill)
        : [...current, skill],
    }));
  };

  const filteredSkills = useMemo(
    () =>
      SKILL_OPTIONS.filter((s) =>
        String(s ?? "")
          .toLowerCase()
          .includes(skillSearch.toLowerCase()),
      ),
    [skillSearch]
  );

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#E1003C]" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md space-y-4 rounded-2xl border border-white/10 bg-[var(--app-surface)] p-8 text-center">
        <p className="text-[15px] text-[var(--app-muted)]">{t("profile.load_error")}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void loadProfile();
          }}
          className="inline-flex w-full items-center justify-center rounded-xl bg-[#E1003C] px-4 py-3 text-[15px] font-semibold text-white hover:bg-[#C00035]"
        >
          {t("profile.retry")}
        </button>
      </div>
    );
  }

  const profile = {
    firstName: user?.first_name || user?.full_name?.split(" ")[0] || "Hacker",
    lastName:
      user?.last_name || user?.full_name?.split(" ").slice(1).join(" ") || "",
    email: user?.email || "—",
    avatar: (
      (user?.first_name || user?.email || "H")
        .split(" ")
        .map((n) => n[0])
        .join("") + (user?.last_name?.[0] || "")
    )
      .slice(0, 2)
      .toUpperCase(),
    age: user?.age || 0,
    phone: user?.phone || "",
    country: user?.country || "",
    timezone: user?.timezone || "",
    attendanceMode: user?.attendance_mode || "online",
    linkedIn: user?.linkedin || "",
    github: user?.github || "",
    experience: user?.experience || "beginner",
    skills: user?.skills || [],
    university: user?.university || "",
    cohort: user?.cohort || "",
    hasTeam: user?.is_team_lead || false,
    isTeamLead: user?.is_team_lead || false,
    dietary: user?.dietary || "Yoxdur",
    tshirtSize: user?.tshirt_size || "M",
    motivation: user?.motivation || "",
    howHeard: user?.how_heard || "",
    role: user?.role || "Developer",
    hackathons: 1,
    wins: 0,
    projects: projectCount,
    registeredAt: user?.registered_at || "",
  };

  const stats = [
    { label: t("profile.hackathons"), value: profile.hackathons, icon: Trophy, color: "#FFC107" },
    { label: t("profile.wins"), value: profile.wins, icon: Award, color: "#00C853" },
    { label: t("profile.projects"), value: profile.projects, icon: Code2, color: "#8B5CF6" },
  ];

  const expLabel =
    EXPERIENCE_LEVELS.find((l) => l.value === profile.experience)?.label ||
    profile.experience;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em] text-[var(--app-heading)]">{t("profile.title")}</h1>
          <p className="mt-1 text-[15px] text-[var(--app-muted)]">{t("profile.subtitle")}</p>
        </div>

        <TelegramConnectCard />

        {!editing ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] leading-relaxed text-[var(--app-muted-2)] sm:max-w-xl">
              {t("profile.edit_hint")}
            </p>
            <button
              type="button"
              onClick={startEdit}
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl border-2 border-[#E1003C]/50 bg-[#E1003C]/15 px-6 text-[15px] font-semibold text-white shadow-[0_0_24px_rgba(225,0,60,0.15)] transition-colors hover:bg-[#E1003C]/25 sm:min-w-[200px]"
            >
              <Edit3 size={16} /> {t("profile.edit")}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2 text-[15px] font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <X size={16} /> {t("profile.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void saveEdit()}
              disabled={saving}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-[#E1003C] px-5 py-2 text-[15px] font-semibold text-white transition-colors hover:bg-[#C00035] disabled:opacity-60"
            >
              <Save size={16} /> {saving ? t("profile.saving") : t("profile.save")}
            </button>
          </div>
        )}
      </div>

      {/* Profile card */}
      <section className="card-shadow rounded-2xl border border-white/5 bg-[var(--app-surface)] p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[#E1003C] to-[#ff6b6b] text-lg font-bold text-white">
            {profile.avatar}
          </div>
          <div className="flex-1">
            {editing ? (
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={editData.first_name || ""}
                  onChange={(e) => setField("first_name", e.target.value)}
                  className="h-9 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-[15px] text-white outline-none focus:border-[#E1003C]/50"
                  placeholder={t("profile.first_name_ph")}
                />
                <input
                  value={editData.last_name || ""}
                  onChange={(e) => setField("last_name", e.target.value)}
                  className="h-9 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-[15px] text-white outline-none focus:border-[#E1003C]/50"
                  placeholder={t("profile.last_name_ph")}
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-lg font-bold text-white">
                  {profile.firstName} {profile.lastName}
                </p>
                {profile.isTeamLead && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#FFC107]/15 px-2 py-0.5 text-[13px] font-semibold text-[var(--app-warn)]">
                    <Award size={12} /> {t("profile.team_lead_badge")}
                  </span>
                )}
              </div>
            )}
            <p className="mt-0.5 text-[13px] text-[var(--app-muted)]">{profile.email}</p>
            {profile.registeredAt && (
              <p className="mt-0.5 text-[11px] text-[var(--app-muted-2)]">
                {t("profile.registered_prefix")}:{" "}
                {formatDate(profile.registeredAt, lang, { day: "numeric", month: "short", year: "numeric" })}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className="card-shadow rounded-2xl border border-white/5 bg-[var(--app-surface)] p-5 text-center"
            >
              <Icon size={20} className="mx-auto" style={{ color: s.color }} />
              <p className="mt-2 text-2xl font-bold text-white">{s.value}</p>
              <p className="mt-1 text-[12px] text-[var(--app-muted)]">{s.label}</p>
            </div>
          );
        })}
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Personal Info */}
        <section className="card-shadow rounded-2xl border border-white/5 bg-[var(--app-surface)] p-6">
          <h2 className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-white">
            <User size={16} className="text-[#E1003C]" /> {t("profile.personal")}
          </h2>
          <div className="space-y-3 text-[13px]">
            <InfoRow
              icon={Calendar}
              label={t("profile.age")}
              value={profile.age > 0 ? String(profile.age) : "—"}
              editing={editing}
              editValue={formatAgeFieldValue(editData.age ?? user.age ?? 0)}
              onChange={(v) => setField("age", parseAgeInputDigits(v))}
              inputMode="numeric"
              maxLength={3}
            />
            <InfoRow
              icon={Phone}
              label={t("profile.phone")}
              value={profile.phone}
              editing={editing}
              editValue={normalizeAzerbaijanPhoneInput(
                String(editData.phone ?? user.phone ?? "")
              )}
              onChange={(v) => setField("phone", normalizeAzerbaijanPhoneInput(v))}
              inputMode="tel"
              autoComplete="tel"
            />
            <InfoRow
              icon={Globe}
              label={t("profile.country")}
              value={profile.country}
              editing={editing}
              editValue={editData.country ?? ""}
              onChange={(v) => setField("country", v)}
              selectOptions={COUNTRIES}
            />
            <InfoRow
              icon={MapPin}
              label={t("profile.timezone")}
              value={profile.timezone}
              editing={editing}
              editValue={editData.timezone ?? ""}
              onChange={(v) => setField("timezone", v)}
              selectOptions={TIMEZONES}
            />
            <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2.5">
              <span className="flex items-center gap-2 text-[var(--app-muted)]">
                <Wifi size={13} /> {t("profile.attendance")}
              </span>
              {editing ? (
                <div className="flex gap-1">
                  {(["online", "offline"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setField("attendance_mode", m)}
                      className={`rounded-md px-2 py-1 text-[11px] font-medium transition-all ${(editData.attendance_mode ?? user?.attendance_mode) === m
                          ? "bg-[#E1003C] text-white"
                          : "bg-white/[0.05] text-[var(--app-muted-2)]"
                        }`}
                    >
                      {t(
                        m === "online"
                          ? "profile.attendance_online"
                          : "profile.attendance_offline",
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${profile.attendanceMode === "online"
                      ? "bg-[#00C853]/15 text-[var(--app-ok)]"
                      : "bg-[#FFC107]/15 text-[var(--app-warn)]"
                    }`}
                >
                  {t(
                    profile.attendanceMode === "online"
                      ? "profile.attendance_online"
                      : "profile.attendance_offline",
                  )}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Social & Academic */}
        <section className="card-shadow rounded-2xl border border-white/5 bg-[var(--app-surface)] p-6">
          <h2 className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-white">
            <GitBranch size={16} className="text-[#E1003C]" /> {t("profile.social_academic")}
          </h2>
          <div className="space-y-3 text-[13px]">
            <InfoRow
              icon={Linkedin}
              label={t("profile.linkedin")}
              value={profile.linkedIn}
              editing={editing}
              editValue={editData.linkedin ?? ""}
              onChange={(v) => setField("linkedin", sanitizeSocialUrl(v))}
              isLink
            />
            <InfoRow
              icon={GitBranch}
              label={t("profile.github")}
              value={profile.github}
              editing={editing}
              editValue={editData.github ?? ""}
              onChange={(v) => setField("github", sanitizeSocialUrl(v))}
              isLink
            />
            <InfoRow
              icon={GraduationCap}
              label={t("profile.university")}
              value={profile.university}
              editing={editing}
              editValue={editData.university ?? ""}
              onChange={(v) => setField("university", v)}
            />
            <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2.5">
              <span className="text-[var(--app-muted)]">{t("profile.cohort")}</span>
              {editing ? (
                <input
                  value={editData.cohort ?? ""}
                  onChange={(e) => setField("cohort", e.target.value)}
                  className="w-28 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-right text-[13px] text-white outline-none focus:border-[#E1003C]/50"
                />
              ) : (
                <span className="text-white">{profile.cohort || "—"}</span>
              )}
            </div>
            <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2.5">
              <span className="text-[var(--app-muted)]">{t("profile.experience")}</span>
              {editing ? (
                <select
                  value={editData.experience ?? "beginner"}
                  onChange={(e) => setField("experience", e.target.value)}
                  className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[13px] text-white outline-none focus:border-[#E1003C]/50"
                >
                  {EXPERIENCE_LEVELS.map((l) => (
                    <option key={l.value} value={l.value} className="bg-[var(--app-surface)]">
                      {l.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-white">{expLabel}</span>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Skills */}
      <section className="card-shadow rounded-2xl border border-white/5 bg-[var(--app-surface)] p-6">
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-white">
          <Code2 size={16} className="text-[#E1003C]" /> {t("profile.skills")}
        </h2>
        {editing ? (
          <>
            <input
              value={skillSearch}
              onChange={(e) => setSkillSearch(e.target.value)}
              placeholder={t("profile.skill_search_ph")}
              className="mb-2 h-8 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 text-[13px] text-white placeholder-[#7a7a7a] outline-none focus:border-[#E1003C]/50"
            />
            <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-white/5 bg-white/[0.02] p-2">
              {filteredSkills.map((skill) => {
                const active = ((editData.skills as string[]) ?? user?.skills ?? []).includes(skill);
                return (
                  <button
                    key={skill}
                    type="button"
                    onClick={() => toggleSkill(skill)}
                    className={`rounded-full px-2.5 py-1 text-[12px] font-medium transition-all ${active
                        ? "bg-[#E1003C] text-white"
                        : "bg-white/[0.05] text-[var(--app-muted)] hover:bg-white/[0.1]"
                      }`}
                  >
                    {skill}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap gap-2">
            {profile.skills.length > 0 ? (
              profile.skills.map((skill) => (
                <span
                  key={skill}
                  className="rounded-full bg-white/[0.05] px-3 py-1 text-[13px] text-[var(--app-muted)]"
                >
                  {skill}
                </span>
              ))
            ) : (
              <p className="text-[13px] text-[var(--app-muted-2)]">{t("profile.no_skills")}</p>
            )}
          </div>
        )}
      </section>

      <CalendarFeedCard />
    </div>
  );
}

/* ─── Reusable info row ─── */
function InfoRow({
  icon: Icon,
  label,
  value,
  editing,
  editValue,
  onChange,
  selectOptions,
  isLink,
  inputMode,
  maxLength,
  autoComplete,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  editing: boolean;
  editValue: string;
  onChange: (v: string) => void;
  selectOptions?: string[];
  isLink?: boolean;
  inputMode?: "numeric" | "tel" | "text" | "url";
  maxLength?: number;
  autoComplete?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2.5">
      <span className="flex items-center gap-2 text-[var(--app-muted)]">
        <Icon size={13} /> {label}
      </span>
      {editing ? (
        selectOptions ? (
          <select
            value={editValue}
            onChange={(e) => onChange(e.target.value)}
            className="max-w-[160px] rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[13px] text-white outline-none focus:border-[#E1003C]/50"
          >
            <option value="" className="bg-[var(--app-surface)]">
              --
            </option>
            {selectOptions.map((o) => (
              <option key={o} value={o} className="bg-[var(--app-surface)]">
                {o}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={editValue}
            onChange={(e) => onChange(e.target.value)}
            inputMode={inputMode ?? "text"}
            maxLength={maxLength}
            autoComplete={autoComplete}
            pattern={inputMode === "numeric" ? "[0-9]*" : undefined}
            className="w-40 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-right text-[13px] text-white outline-none focus:border-[#E1003C]/50"
          />
        )
      ) : isLink && value ? (
        <a
          href={value.startsWith("http") ? value : `https://${value}`}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate text-[13px] text-[#E1003C] hover:underline"
        >
          {value}
        </a>
      ) : (
        <span className="text-white">{value || "—"}</span>
      )}
    </div>
  );
}
