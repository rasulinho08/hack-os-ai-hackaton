"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Clock,
  Copy,
  Crown,
  Loader2,
  Pencil,
  Save,
  Search,
  ShieldCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
  Check,
} from "lucide-react";
import { apiGet, apiPost, apiPut, apiPatch, apiDelete, ApiError } from "@/lib/api";
import { isPendingApprovalBlockingError } from "@/lib/registerErrors";
import { LoadFailure } from "@/components/LoadFailure";
import { useToast } from "@/contexts/ToastContext";
import { useTranslation } from "@/contexts/LanguageContext";
import { fill } from "@/lib/i18n/fill";
import {
  normalizeTeamMine,
  submitRight,
  normalizeMembersFromPayload,
  extractLeaderIdFromTeamPayload,
  memberLabel,
  type NormalizedTeamMine,
} from "@/lib/teamNormalize";
import { teamInviteUrl } from "@/lib/teamInviteUrl";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  mapLobbyHackersFromApi,
  type LobbyUserNormalized,
} from "@/lib/lobbyUsersFilter";
import {
  sendTeamInvite,
  getOutgoingInvites,
  type TeamInvite,
} from "@/lib/teamInvites";
import { teamFormationClosedMessage } from "@/lib/eventPhase";
import { useEventWatcher } from "@/lib/useEventWatcher";
import { participantEventId } from "@/lib/participantEvent";

type ActiveEventSnippet = {
  event_code?: string;
  slug?: string;
  approval_mode?: string;
  approvalMode?: string;
  eventCode?: string;
  start_date?: string;
  end_date?: string;
  startDate?: string;
  endDate?: string;
  team_size_limit?: number;
  teamSizeLimit?: number;
  team_deadline?: string | null;
  teamDeadline?: string | null;
  allow_team_formation?: boolean;
  allowTeamFormation?: boolean;
};

type EventPhase = "before_start" | "hacking" | "ended";

/**
 * The event clock, and whether teams can still change. The latter follows
 * the API's rule (event.service teamFormationState): the organiser's team
 * deadline when there is one — it may fall after the start — else the start.
 */
function useEventCountdown(startDate: string | null, endDate: string | null, teamDeadline: string | null, formationAllowed: boolean) {
  const compute = () => {
    const now = Date.now();
    const s = startDate ? new Date(startDate).getTime() : NaN;
    const e = endDate ? new Date(endDate).getTime() : NaN;
    const td = teamDeadline ? new Date(teamDeadline).getTime() : NaN;
    const formationOpen = formationAllowed && (!Number.isNaN(td) ? now < td : Number.isNaN(s) || now < s);
    if (!Number.isNaN(s) && now < s) {
      return { phase: "before_start" as EventPhase, targetMs: s, formationOpen };
    }
    if (!Number.isNaN(e) && now < e) {
      return { phase: "hacking" as EventPhase, targetMs: e, formationOpen };
    }
    return { phase: "ended" as EventPhase, targetMs: NaN, formationOpen };
  };
  const [state, setState] = useState(() => {
    const { phase, targetMs, formationOpen } = compute();
    return { phase, formationOpen, left: Number.isNaN(targetMs) ? 0 : Math.max(0, targetMs - Date.now()) };
  });
  useEffect(() => {
    const tick = () => {
      const { phase, targetMs, formationOpen } = compute();
      setState({ phase, formationOpen, left: Number.isNaN(targetMs) ? 0 : Math.max(0, targetMs - Date.now()) });
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, teamDeadline, formationAllowed]);
  const totalSec = Math.floor(state.left / 1000);
  return {
    phase: state.phase,
    formationOpen: state.formationOpen,
    d: Math.floor(totalSec / 86400),
    h: Math.floor((totalSec % 86400) / 3600),
    m: Math.floor((totalSec % 3600) / 60),
    s: totalSec % 60,
  };
}

export default function MyTeamPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  // A rejected read of the team is shown as a failure with a retry; before,
  // it rendered as "you are not on a team yet".
  const [loadError, setLoadError] = useState<string | null>(null);
  const [team, setTeam] = useState<NormalizedTeamMine | null>(null);
  const [teamName, setTeamName] = useState("");
  // Problem 20: explicit edit mode for the team name. The previous UI was a
  // bare <input> styled like a heading, so users didn't realise the team
  // name was editable at all. Now non-editing leads see the name as a
  // clickable header with a pencil icon; clicking enters edit mode and
  // surfaces Save/Cancel controls.
  const [editingName, setEditingName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // The lead is not an accepted participant, so this approved member hands in (API rule).
  const [memberMaySubmit, setMemberMaySubmit] = useState(false);
  const [copied, setCopied] = useState(false);
  const [eventJoinSlug, setEventJoinSlug] = useState<string>("");
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [teamDeadline, setTeamDeadline] = useState<string | null>(null);
  const [formationAllowed, setFormationAllowed] = useState(true);
  // Whether joiners still wait for the organisers (the invite link's promise depends on it).
  const [autoApproval, setAutoApproval] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ id: number; name: string; self: boolean } | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [teamSizeLimit, setTeamSizeLimit] = useState<number>(5);
  const [dismissedNewTeamBanner, setDismissedNewTeamBanner] = useState(false);
  // Creating a team from here: the path for a lead whose registration could
  // not create one because the account was still awaiting approval.
  const [newTeamName, setNewTeamName] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [newTeamFromLobbyQuery, setNewTeamFromLobbyQuery] = useState(false);
  // Problem 17: team-lead can invite new teammates directly from My Team.
  const [eventId, setEventId] = useState<number | null>(null);
  const [lobbyHackers, setLobbyHackers] = useState<LobbyUserNormalized[]>([]);
  const [lobbyLoading, setLobbyLoading] = useState(false);
  const [inviteSearch, setInviteSearch] = useState("");
  const [invitedUserIds, setInvitedUserIds] = useState<Set<number>>(new Set());
  const [invitingId, setInvitingId] = useState<number | null>(null);
  // Join requests waiting for the lead, and joining by a team's code.
  const [openRequests, setOpenRequests] = useState(0);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("new_team") === "1" || q.get("leadership") === "1") {
      setNewTeamFromLobbyQuery(true);
    }
  }, []);

  const showNewTeamLeadHint =
    !dismissedNewTeamBanner && newTeamFromLobbyQuery;

  const dismissNewTeamBanner = () => {
    setDismissedNewTeamBanner(true);
    router.replace("/hacker/team", { scroll: false });
  };

  const { phase, formationOpen, d, h, m, s } = useEventCountdown(startDate, endDate, teamDeadline, formationAllowed);

  const createTeam = async () => {
    const name = newTeamName.trim();
    if (!name || eventId == null) return;
    setCreatingTeam(true);
    try {
      await apiPost("/api/teams", { eventId, name });
      toast(t("hacker.my_team.create_done"), "success");
      setNewTeamName("");
      await loadTeamPageData();
    } catch (err) {
      toast(
        isPendingApprovalBlockingError(err)
          ? t("hacker.my_team.create_not_approved")
          : err instanceof Error && err.message
            ? err.message
            : t("hacker.my_team.create_failed"),
        "error",
      );
    } finally {
      setCreatingTeam(false);
    }
  };
  const joinByCode = async () => {
    const c = joinCode.trim();
    if (!c) return;
    setJoining(true);
    try {
      await apiPost("/api/teams/join", { joinCode: c });
      toast(t("mm.joined"), "success");
      setJoinCode("");
      await loadTeamPageData();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      const key = code ? `mm.err.${code}` : "";
      const words = key ? t(key) : "";
      toast(code && words !== key ? words : t("mm.failed"), "error");
    } finally {
      setJoining(false);
    }
  };
  const pad = (n: number) => String(n).padStart(2, "0");

  const loadTeamPageData = useCallback(async () => {
    try {
      const eventHint = await participantEventId();
      const mineUrl =
        eventHint != null
          ? `/api/teams/mine?eventId=${eventHint}`
          : "/api/teams/mine";

      const [teamRes, subs, activeRes, meRes] = await Promise.allSettled([
        apiGet<unknown>(mineUrl),
        apiGet<unknown[]>("/api/submissions"),
        apiGet<ActiveEventSnippet>("/api/events/active"),
        apiGet<{ id: number }>("/api/auth/me"),
      ]);
      setLoadError(
        teamRes.status === "rejected"
          ? teamRes.reason instanceof Error && teamRes.reason.message
            ? teamRes.reason.message
            : "load_failed"
          : null,
      );
      let teamEventSizeLimit: number | null = null;
      let resolvedEventId: number | null = null;
      setMemberMaySubmit(teamRes.status === "fulfilled" && submitRight(teamRes.value, false) === "member");
      if (teamRes.status === "fulfilled" && teamRes.value) {
        let normalized = normalizeTeamMine(teamRes.value);
        if (normalized && normalized.id > 0) {
          try {
            const extra = await apiGet<unknown[]>(
              `/api/teams/${normalized.id}/members`,
            );
            const lid = extractLeaderIdFromTeamPayload(teamRes.value);
            const fromEndpoint = normalizeMembersFromPayload(
              Array.isArray(extra) ? extra : [],
              lid,
            );
            // GET /teams/mine is sometimes scoped to the wrong event or returns
            // an empty/partial `members` JSON — the members route is the roster
            // source of truth for everyone on the team (post–invite accept).
            if (fromEndpoint.length > 0) {
              normalized = { ...normalized, members: fromEndpoint };
            }
          } catch {
            /* roster fetch failed — keep mine payload */
          }
        }
        if (normalized) {
          setTeam(normalized);
          setTeamName(normalized.name || "");
          if (
            normalized.team_size_limit != null &&
            normalized.team_size_limit > 0
          ) {
            teamEventSizeLimit = normalized.team_size_limit;
            setTeamSizeLimit(normalized.team_size_limit);
          }
          if (normalized.event_id != null) {
            resolvedEventId = Number(normalized.event_id);
          }
        }
      }
      if (subs.status === "fulfilled")
        setSubmitted(Array.isArray(subs.value) && subs.value.length > 0);
      if (meRes.status === "fulfilled" && meRes.value?.id != null) {
        setCurrentUserId(Number(meRes.value.id));
      }
      let slug = "";
      if (activeRes.status === "fulfilled" && activeRes.value) {
        const a = activeRes.value;
        // The registration page takes the event's slug (or its code).
        slug = String(a.slug ?? a.event_code ?? a.eventCode ?? "").trim();
        setAutoApproval(String(a.approval_mode ?? a.approvalMode ?? "") === "auto");
        const sd = a.start_date ?? a.startDate ?? null;
        const ed = a.end_date ?? a.endDate ?? null;
        if (sd) setStartDate(sd);
        if (ed) setEndDate(ed);
        setTeamDeadline(a.team_deadline ?? a.teamDeadline ?? null);
        setFormationAllowed((a.allow_team_formation ?? a.allowTeamFormation) !== false);
        const tsl = a.team_size_limit ?? a.teamSizeLimit;
        const n = Number(tsl);
        if (Number.isFinite(n) && n > 0 && teamEventSizeLimit == null) {
          setTeamSizeLimit(n);
        }
      }
      // No guessing from the list of all events: a link to another event's page would be worse than none.
      if (slug) setEventJoinSlug(slug);
      if (resolvedEventId != null && resolvedEventId > 0) {
        setEventId(resolvedEventId);
      } else if (eventHint != null) {
        setEventId(eventHint);
      } else if (
        activeRes.status === "fulfilled" &&
        activeRes.value &&
        typeof (activeRes.value as { id?: unknown }).id !== "undefined"
      ) {
        const aid = Number(
          (activeRes.value as { id?: unknown }).id ?? NaN,
        );
        if (Number.isFinite(aid) && aid > 0) setEventId(aid);
      }
    } catch {
      // handled per-request
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTeamPageData();
  }, [loadTeamPageData]);

  useEffect(() => {
    function onVis() {
      if (document.visibilityState === "visible") void loadTeamPageData();
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [loadTeamPageData]);

  // Problem 12: if the admin shifts the event's start or end date while
  // the hacker is on /hacker/team, re-read the event so the countdown,
  // "phase" banner, and any team-formation-gated controls pick up the
  // new timing without forcing a hard reload.
  useEventWatcher(eventId, (evt) => {
    const sd = (evt.start_date ?? evt.startDate) as string | undefined;
    const ed = (evt.end_date ?? evt.endDate) as string | undefined;
    if (sd !== undefined) setStartDate(sd || null);
    if (ed !== undefined) setEndDate(ed || null);
    const td = (evt.team_deadline ?? evt.teamDeadline) as string | null | undefined;
    if (td !== undefined) setTeamDeadline(td || null);
    const fa = (evt.allow_team_formation ?? evt.allowTeamFormation) as boolean | undefined;
    if (fa !== undefined) setFormationAllowed(fa !== false);
    const tsl = (evt.team_size_limit ?? evt.teamSizeLimit) as
      | number
      | string
      | undefined;
    const n = Number(tsl);
    if (Number.isFinite(n) && n > 0) setTeamSizeLimit(n);
  });

  // Problem 17: pull invitable solo hackers + already-sent invites once we
  // know the active event. The team-lead can search & invite from this list
  // without leaving the My Team page.
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    async function loadInviteSources() {
      setLobbyLoading(true);
      try {
        const [usersRes, outgoingRes] = await Promise.allSettled([
          apiGet<unknown[]>(
            `/api/events/${eventId}/participants/lobby-hackers`,
          ),
          getOutgoingInvites(eventId ?? undefined),
        ]);
        if (cancelled) return;
        if (usersRes.status === "fulfilled") {
          const list = Array.isArray(usersRes.value) ? usersRes.value : [];
          const normalized = mapLobbyHackersFromApi(list).filter(
            (u) => currentUserId == null || u.id !== currentUserId,
          );
          setLobbyHackers(normalized);
        }
        if (outgoingRes.status === "fulfilled") {
          const list = Array.isArray(outgoingRes.value)
            ? (outgoingRes.value as TeamInvite[])
            : [];
          setInvitedUserIds(new Set(list.map((i) => i.to_user_id)));
        }
      } finally {
        if (!cancelled) setLobbyLoading(false);
      }
    }
    loadInviteSources();
    return () => {
      cancelled = true;
    };
  }, [eventId, currentUserId]);

  // The lead hears about people asking to join (they answer on Find a team).
  useEffect(() => {
    const lead = team?.members.some((mm) => mm.is_lead && currentUserId != null && mm.id === currentUserId);
    if (!team || !lead) return;
    let cancelled = false;
    apiGet<unknown[]>(`/api/teams/${team.id}/requests`)
      .then((rows) => { if (!cancelled) setOpenRequests(Array.isArray(rows) ? rows.length : 0); })
      .catch(() => { /* the banner is a hint; without it the page still works */ });
    return () => { cancelled = true; };
  }, [team, currentUserId]);

  /**
   * The team's invite link: the event's registration page with the team's
   * code filled in — the same link the registration success screen gives
   * (lib/teamInviteUrl). Someone new registers and joins this team in one go.
   */
  const inviteEvent = eventJoinSlug || team?.event_code?.trim() || "";
  const teamCodeParam = team?.join_code?.trim() || "";
  const inviteLink =
    typeof window !== "undefined" ? teamInviteUrl(window.location.origin, inviteEvent, teamCodeParam) : "";

  const copyInvite = () => {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const saveTeamName = async () => {
    if (!team) return;
    const trimmed = teamName.trim();
    if (!trimmed) {
      toast(t("hacker.my_team.toast_name_empty"), "error");
      setTeamName(team.name);
      return;
    }
    if (trimmed.length > 100) {
      toast(t("hacker.my_team.toast_name_too_long"), "error");
      return;
    }
    if (trimmed === team.name) {
      setEditingName(false);
      setTeamName(team.name);
      return;
    }
    setSavingName(true);
    try {
      await apiPut(`/api/teams/${team.id}`, { name: trimmed });
      setTeam((prev) => (prev ? { ...prev, name: trimmed } : prev));
      setTeamName(trimmed);
      setEditingName(false);
      toast(t("hacker.my_team.toast_name_updated"), "success");
    } catch (err) {
      let msg = t("hacker.my_team.toast_name_failed");
      if (err instanceof ApiError) {
        if (err.status === 403) {
          msg = t("hacker.my_team.toast_only_lead_rename");
        } else if (err.message) {
          msg = err.message;
        }
      } else if (err instanceof Error && err.message) {
        msg = err.message;
      }
      toast(msg, "error");
      setTeamName(team.name);
    } finally {
      setSavingName(false);
    }
  };

  const cancelEditingName = () => {
    if (team) setTeamName(team.name);
    setEditingName(false);
  };

  const promoteToLead = async (memberId: number) => {
    if (!team) return;
    // Only the current lead can transfer
    const iAmLead = team.members.some(
      (m) => m.is_lead && currentUserId != null && m.id === currentUserId
    );
    if (!iAmLead) {
      toast(t("hacker.my_team.toast_only_lead_transfer"), "error");
      return;
    }
    const target = team.members.find((m) => m.id === memberId);
    if (!target || target.is_lead) return;
    try {
      await apiPatch(`/api/teams/${team.id}/members/${memberId}/lead`, {});
      setTeam((prev) =>
        prev
          ? {
              ...prev,
              members: prev.members.map((m) => ({
                ...m,
                is_lead: m.id === memberId,
              })),
            }
          : prev
      );
      toast(
        t("hacker.my_team.toast_new_lead").replace("{name}", target.full_name),
        "success",
      );
    } catch (err) {
      const raw = err instanceof Error ? err.message.toLowerCase() : "";
      let msg = t("hacker.my_team.toast_transfer_failed");
      if (raw.includes("only the current team lead")) {
        msg = t("hacker.my_team.toast_only_current_lead");
      } else if (raw.includes("not a member")) {
        msg = t("hacker.my_team.toast_not_member");
      }
      toast(msg, "error");
    }
  };

  const removeMember = async (memberId: number) => {
    if (!team) return;
    const target = team.members.find((m) => m.id === memberId);
    // Defensive: team lead cannot be removed from the team
    if (target?.is_lead) {
      return;
    }
    const isSelf = currentUserId != null && memberId === currentUserId;
    try {
      await apiDelete(`/api/teams/${team.id}/members/${memberId}`);
      if (isSelf) {
        // User left their own team → log out & redirect to login page
        try {
          await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
        } catch {
          /* ignore */
        }
        if (typeof document !== "undefined") {
          document.cookie = "hh_role=; Path=/; Max-Age=0; SameSite=Lax";
          document.cookie = "hh_email=; Path=/; Max-Age=0; SameSite=Lax";
        }
        router.replace("/login?left_team=1");
        return;
      }
      setTeam((prev) =>
        prev
          ? { ...prev, members: prev.members.filter((m) => m.id !== memberId) }
          : prev
      );
    } catch {
      // removal failed
    }
  };

  // Problem 17: send a team invite to a solo hacker straight from My Team.
  // Backend creates the team_invites row; once the recipient accepts in their
  // Lobby, they are added to THIS team automatically.
  const inviteHacker = async (user: LobbyUserNormalized) => {
    if (!eventId) {
      toast(t("hacker.my_team.toast_no_active_event"), "error");
      return;
    }
    if (!formationOpen) {
      toast(teamFormationClosedMessage(t), "error");
      return;
    }
    setInvitingId(user.id);
    try {
      await sendTeamInvite(user.id, eventId);
      setInvitedUserIds((prev) => new Set(prev).add(user.id));
      toast(
        t("hacker.my_team.toast_invite_sent").replace("{name}", user.full_name),
        "success",
      );
    } catch (err) {
      const raw = err instanceof Error ? err.message.toLowerCase() : "";
      let msg = t("hacker.my_team.toast_invite_failed");
      if (raw.includes("already in a team")) {
        msg = t("hacker.my_team.toast_already_team");
      } else if (
        raw.includes("already sent") ||
        raw.includes("invite already")
      ) {
        msg = t("hacker.my_team.toast_already_invited");
        setInvitedUserIds((prev) => new Set(prev).add(user.id));
      } else if (raw.includes("team is full")) {
        msg = t("hacker.my_team.toast_team_full");
      } else if (
        raw.includes("team formation is closed") ||
        raw.includes("event has already started") ||
        raw.includes("team_formation_closed")
      ) {
        msg = teamFormationClosedMessage(t);
      }
      toast(msg, "error");
    } finally {
      setInvitingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#E1003C]" />
      </div>
    );
  }

  const members = team?.members ?? [];
  const iAmTeamLead =
    members.some(
      (mm) => mm.is_lead && currentUserId != null && mm.id === currentUserId,
    );
  const memberIdSet = new Set(members.map((m) => m.id));
  const teamHasRoom = members.length < teamSizeLimit;
  const filteredInvitable = lobbyHackers.filter((u) => {
    if (memberIdSet.has(u.id)) return false;
    if (!inviteSearch.trim()) return true;
    const q = inviteSearch.trim().toLowerCase();
    return (
      String(u.full_name ?? "")
        .toLowerCase()
        .includes(q) ||
      (u.email ?? "").toLowerCase().includes(q) ||
      (u.role ?? "").toLowerCase().includes(q) ||
      (u.skills ?? []).some((s) =>
        String(s ?? "")
          .toLowerCase()
          .includes(q),
      )
    );
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.02em] text-[var(--app-heading)]">
          {t("hacker.my_team.title")}
        </h1>
        <p className="mt-1 text-[15px] text-[var(--app-muted)]">
          {t("hacker.my_team.subtitle")}
        </p>
      </div>

      {team && iAmTeamLead && openRequests > 0 && (
        <Link
          href="/hacker/lobby"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3"
          style={{ borderColor: "var(--warn)", background: "var(--warn-weak)", color: "var(--ink)" }}
        >
          <span className="text-[14px] font-medium">{fill(t("mm.team_banner"), { n: openRequests })}</span>
          <span className="text-[13px] font-semibold" style={{ color: "var(--accent)" }}>{t("mm.review")} →</span>
        </Link>
      )}

      {/* Countdown */}
      {(startDate || endDate) && (
        <section
          className={`card-shadow rounded-2xl border p-5 ${
            phase === "before_start"
              ? "border-amber-500/20"
              : phase === "hacking"
                ? "border-[#E1003C]/20"
                : "border-emerald-500/20"
          } bg-[var(--app-surface)]`}
        >
          <div className="flex items-center gap-2 text-[13px] text-[var(--app-muted)]">
            <Clock
              size={14}
              className={
                phase === "before_start"
                  ? "text-amber-400"
                  : phase === "hacking"
                    ? "text-[#E1003C]"
                    : "text-emerald-400"
              }
            />
            <span>
              {phase === "before_start"
                ? t("hacker.countdown.starts_in")
                : phase === "hacking"
                  ? t("hacker.countdown.ends_in")
                  : t("hacker.my_team.hacking_ended")}
            </span>
          </div>
          {phase !== "ended" ? (
            <div className="mt-2 flex flex-wrap items-baseline gap-1 text-white">
              {d > 0 && (
                <>
                  <span className="text-3xl font-bold tabular-nums">{d}</span>
                  <span className="text-base text-[var(--app-muted)]">d</span>
                </>
              )}
              <span className="text-3xl font-bold tabular-nums">{pad(h)}</span>
              <span className="text-base text-[var(--app-muted)]">h</span>
              <span className="text-3xl font-bold tabular-nums">{pad(m)}</span>
              <span className="text-base text-[var(--app-muted)]">m</span>
              <span className="text-3xl font-bold tabular-nums">{pad(s)}</span>
              <span className="text-base text-[var(--app-muted)]">s</span>
            </div>
          ) : (
            <p className="mt-2 text-[15px] text-emerald-400">
              {t("hacker.my_team.hackathon_ended")}
            </p>
          )}
        </section>
      )}

      {/* No team yet: say so, instead of drawing an empty team around the
          visitor. Solo registrants are matched by the organisers or invited
          by a lead from the lobby; a lead's invite link joins their team. */}
      {!team && loadError && (
        <LoadFailure message={loadError === "load_failed" ? undefined : loadError} onRetry={() => void loadTeamPageData()} />
      )}

      {!team && !loadError && (
        <section className="card-shadow rounded-2xl border border-white/5 bg-[var(--app-surface)] p-6">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E1003C]/15 text-[#E1003C]">
              <Users size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-white">
                {t("hacker.my_team.no_team_title")}
              </h2>
              <p className="mt-1 text-[15px] leading-relaxed text-[var(--app-muted)]">
                {t("hacker.my_team.no_team_body")}
              </p>
              <Link
                href="/hacker/lobby"
                className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#E1003C] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[#C00035]"
              >
                <UserPlus size={15} />
                {t("hacker.my_team.no_team_lobby")}
              </Link>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void joinByCode();
                }}
                className="mt-6 border-t border-white/5 pt-5"
              >
                <h3 className="text-[15px] font-semibold text-white">{t("mm.code_title")}</h3>
                <p className="mt-1 text-[13px] text-[var(--app-muted)]">{t("mm.code_hint")}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <input
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    maxLength={32}
                    autoComplete="off"
                    aria-label={t("mm.code_title")}
                    placeholder={t("mm.code_ph")}
                    className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 font-mono text-[15px] text-white placeholder-[#7a7a7a] outline-none transition-colors focus:border-[#E1003C]/50"
                  />
                  <button
                    type="submit"
                    disabled={joining || !joinCode.trim()}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 px-4 text-[14px] font-semibold text-white transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {joining ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {t("mm.code_join")}
                  </button>
                </div>
              </form>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void createTeam();
                }}
                className="mt-6 border-t border-white/5 pt-5"
              >
                <h3 className="text-[15px] font-semibold text-white">
                  {t("hacker.my_team.create_title")}
                </h3>
                <p className="mt-1 text-[13px] text-[var(--app-muted)]">
                  {t("hacker.my_team.create_hint")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <input
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    maxLength={100}
                    aria-label={t("hacker.my_team.team_name_placeholder")}
                    placeholder={t("hacker.my_team.team_name_placeholder")}
                    className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-[15px] text-white placeholder-[#7a7a7a] outline-none transition-colors focus:border-[#E1003C]/50"
                  />
                  <button
                    type="submit"
                    disabled={creatingTeam || newTeamName.trim().length < 2 || eventId == null}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#E1003C] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[#C00035] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creatingTeam ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
                    {t("hacker.my_team.create_button")}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </section>
      )}

      {/* Team info */}
      {team && (
      <section className="card-shadow rounded-2xl border border-white/5 bg-[var(--app-surface)] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {editingName ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  autoFocus
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void saveTeamName();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelEditingName();
                    }
                  }}
                  disabled={savingName}
                  maxLength={100}
                  className="min-w-0 flex-1 rounded-lg border border-[#E1003C]/40 bg-white/[0.04] px-3 py-1.5 text-lg font-bold text-white outline-none placeholder:text-[var(--app-muted-2)] focus:border-[#E1003C] focus:ring-1 focus:ring-[#E1003C]/50 disabled:opacity-60"
                  placeholder={t("hacker.my_team.team_name_placeholder")}
                />
                <button
                  type="button"
                  onClick={() => void saveTeamName()}
                  disabled={savingName || !teamName.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#E1003C] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#C00035] disabled:cursor-not-allowed disabled:opacity-50"
                  title={t("hacker.my_team.save")}
                >
                  {savingName ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Save size={14} />
                  )}
                  {t("hacker.my_team.save")}
                </button>
                <button
                  type="button"
                  onClick={cancelEditingName}
                  disabled={savingName}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-[13px] text-[var(--app-muted)] transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
                  title={t("hacker.my_team.cancel")}
                >
                  <X size={14} />
                  {t("hacker.my_team.cancel")}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="min-w-0 break-words text-lg font-bold text-white [overflow-wrap:anywhere]">
                  {team?.name?.trim() ||
                    teamName ||
                    t("hacker.my_team.team_name_fallback")}
                </h2>
                {iAmTeamLead && (
                  <button
                    type="button"
                    onClick={() => {
                      setTeamName(team?.name ?? "");
                      setEditingName(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[12px] text-[var(--app-muted)] transition-colors hover:border-[#E1003C]/40 hover:bg-white/5 hover:text-white"
                    title={t("hacker.my_team.rename")}
                  >
                    <Pencil size={12} />
                    {t("hacker.my_team.rename")}
                  </button>
                )}
              </div>
            )}
            <p className="mt-1 text-[13px] text-[var(--app-muted)]">
              {t("hacker.my_team.max_members").replace("{n}", String(teamSizeLimit))}
              {!iAmTeamLead && team && (
                <span className="ml-2 text-[11px] text-[var(--app-muted-2)]">
                  {t("hacker.my_team.only_lead_rename")}
                </span>
              )}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-[13px] font-semibold ${
              submitted
                ? "bg-[#00C853]/15 text-[var(--app-ok)]"
                : "bg-[#FFC107]/15 text-[var(--app-warn)]"
            }`}
          >
            {submitted
              ? t("hacker.team.submitted")
              : t("hacker.team.not_submitted")}
          </span>
        </div>
      </section>
      )}

      {team && memberMaySubmit && (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-[#00C853]/30 bg-[#00C853]/10 px-4 py-3">
          <div>
            <p className="text-[15px] font-semibold text-white">{t("hacker.submit.member_can_title")}</p>
            <p className="mt-1 text-[13px] text-[var(--app-muted)]">{t("hacker.submit.member_can_desc")}</p>
          </div>
          <Link href="/hacker/submit" className="text-[13px] font-semibold underline underline-offset-2">
            {t("hacker.team.submit_project")}
          </Link>
        </div>
      )}

      {showNewTeamLeadHint && team && (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-[#E1003C]/30 bg-[#E1003C]/10 px-4 py-3">
          <p className="text-[15px] text-white">
            <span className="font-semibold">
              {t("hacker.my_team.team_ready")}
            </span>{" "}
            {t("hacker.my_team.team_ready_desc")}
          </p>
          <button
            type="button"
            onClick={dismissNewTeamBanner}
            className="shrink-0 rounded-lg border border-white/15 px-3 py-1 text-[13px] text-[var(--app-muted)] transition-colors hover:bg-white/5 hover:text-white"
          >
            {t("hacker.my_team.got_it")}
          </button>
        </div>
      )}

      {/* Team lead (Problem 4): explicit leadership after lobby / any formation */}
      {team && (
        <section className="card-shadow rounded-2xl border border-[#FFC107]/25 bg-[var(--app-surface)] p-5">
          <h2 className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-white">
            <Crown size={16} className="text-[var(--app-warn)]" />
            {t("hacker.my_team.team_lead")}
          </h2>
          {(() => {
            const lead = members.find((m) => m.is_lead);
            const iAmLead = members.some(
              (mm) =>
                mm.is_lead &&
                currentUserId != null &&
                mm.id === currentUserId,
            );
            return (
              <>
                <p className="text-[15px] text-white">
                  {t("hacker.my_team.current_lead")}{" "}
                  <span className="font-semibold text-[var(--app-warn)]">
                    {lead?.full_name ?? "—"}
                  </span>
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--app-muted)]">
                  {iAmLead
                    ? t("hacker.my_team.you_are_lead")
                    : t("hacker.my_team.ask_lead").replace(
                        "{name}",
                        lead?.full_name ?? t("hacker.my_team.the_lead"),
                      )}
                </p>
              </>
            );
          })()}
        </section>
      )}

      {/* Members */}
      {team && (
      <section className="card-shadow rounded-2xl border border-white/5 bg-[var(--app-surface)] p-6">
        <h2 className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-white">
          <Users size={16} className="text-[#E1003C]" />
          {t("hacker.my_team.members_count")
            .replace("{current}", String(members.length))
            .replace("{max}", String(teamSizeLimit))}
        </h2>
        <div className="space-y-2">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl bg-white/[0.03] px-4 py-3"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#E1003C] to-[#ff6b6b] text-[13px] font-bold text-white">
                  {m.full_name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")}
                </div>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 break-words text-[15px] font-medium text-white">
                    {m.full_name}
                    {m.is_lead && (
                      <Crown size={12} className="text-[var(--app-warn)]" />
                    )}
                  </p>
                  {(() => {
                    const label = memberLabel(m);
                    return (
                      <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--app-muted)]">
                        <span>{t(label.roleKey)}</span>
                        {label.statusKey ? (
                          <span className="rounded-full border border-[#FFC107]/30 bg-[#FFC107]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--app-warn)]">{t(label.statusKey)}</span>
                        ) : null}
                      </p>
                    );
                  })()}
                </div>
              </div>
              {(() => {
                const iAmLead = members.some(
                  (mm) => mm.is_lead && currentUserId != null && mm.id === currentUserId,
                );
                const canPromote = iAmLead && !m.is_lead && currentUserId !== m.id;
                // Only the team lead may remove other members. Any member can
                // still remove themselves (= leave the team) — handled by the
                // self-leave path inside removeMember(). Without this guard,
                // every regular hacker saw a "kick" icon next to every other
                // hacker, even though the API would reject the request.
                const isSelf = currentUserId != null && currentUserId === m.id;
                const canRemove =
                  !m.is_lead && (iAmLead || isSelf);
                if (!canPromote && !canRemove) return null;
                return (
                  <div className="ml-11 flex flex-wrap items-center gap-2 sm:ml-0">
                    {canPromote && (
                      <button
                        type="button"
                        onClick={() => promoteToLead(m.id)}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-[var(--app-muted)] transition-colors hover:border-[#FFC107]/40 hover:bg-white/5 hover:text-[var(--app-warn)]"
                        title={t("hacker.my_team.make_lead_title")}
                      >
                        <ShieldCheck size={15} aria-hidden="true" />
                        <span className="text-[13px] font-medium">
                          {t("hacker.my_team.make_lead")}
                        </span>
                      </button>
                    )}
                    {canRemove && (
                      <button
                        type="button"
                        onClick={() => setConfirmRemove({ id: m.id, name: m.full_name, self: isSelf })}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-[13px] font-medium text-[var(--app-muted)] transition-colors hover:border-[var(--app-danger)]/40 hover:bg-white/5 hover:text-[var(--app-danger)]"
                      >
                        <UserMinus size={15} aria-hidden="true" />
                        {isSelf ? t("hacker.my_team.leave") : t("hacker.my_team.remove")}
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      </section>
      )}

      {/* Add teammate — Problem 17: leads can search & invite solo hackers
          right from My Team without bouncing to the Lobby. */}
      {team && iAmTeamLead && (
        <section className="card-shadow rounded-2xl border border-white/5 bg-[var(--app-surface)] p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-white">
              <UserPlus size={16} className="text-[#E1003C]" />
              {t("hacker.my_team.add_teammate")}
            </h2>
            <p className="text-[12px] text-[var(--app-muted)]">
              {teamHasRoom
                ? t("hacker.my_team.seats_left")
                    .replace("{n}", String(teamSizeLimit - members.length))
                    .replace(
                      "{s}",
                      teamSizeLimit - members.length === 1 ? "" : "s",
                    )
                : t("hacker.my_team.team_full")}
            </p>
          </div>

          {!formationOpen ? (
            <p className="rounded-xl border border-[#FFC107]/30 bg-[#FFC107]/10 px-3 py-2 text-[13px] text-[var(--app-warn)]">
              {t("hacker.my_team.formation_closed")}
            </p>
          ) : !teamHasRoom ? (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-200">
              {t("hacker.my_team.size_limit_reached").replace(
                "{n}",
                String(teamSizeLimit),
              )}
            </p>
          ) : (
            <>
              <div className="relative mb-3">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-muted-2)]"
                />
                <input
                  value={inviteSearch}
                  onChange={(e) => setInviteSearch(e.target.value)}
                  placeholder={t("hacker.my_team.search_solo")}
                  className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] pl-9 pr-3 text-[15px] text-white placeholder-[#7a7a7a] outline-none transition-colors focus:border-[#E1003C]/50"
                />
              </div>

              {lobbyLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-[#E1003C]" />
                </div>
              ) : filteredInvitable.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-[var(--app-muted)]">
                  {inviteSearch.trim()
                    ? t("hacker.my_team.no_match")
                    : t("hacker.my_team.no_solo")}
                </p>
              ) : (
                <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {filteredInvitable.map((u) => {
                    const initials = u.full_name
                      .split(" ")
                      .map((n) => n[0])
                      .filter(Boolean)
                      .slice(0, 2)
                      .join("")
                      .toUpperCase();
                    const alreadyInvited = invitedUserIds.has(u.id);
                    const sending = invitingId === u.id;
                    return (
                      <li
                        key={u.id}
                        className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#E1003C] text-[11px] font-bold text-white">
                            {initials || "?"}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-[15px] font-medium text-white">
                              {u.full_name}
                            </p>
                            <p className="truncate text-[12px] text-[var(--app-muted)]">
                              {u.role ? `${u.role} · ` : ""}
                              {u.email || "—"}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={alreadyInvited || sending}
                          onClick={() => inviteHacker(u)}
                          className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${
                            alreadyInvited
                              ? "cursor-default bg-emerald-500/15 text-emerald-300"
                              : "bg-[#E1003C] text-white hover:bg-[#C00035] disabled:opacity-60"
                          }`}
                        >
                          {alreadyInvited ? (
                            <>
                              <Check size={12} /> {t("hacker.my_team.invited")}
                            </>
                          ) : sending ? (
                            <>
                              <Loader2 size={12} className="animate-spin" />
                              {t("hacker.my_team.sending")}
                            </>
                          ) : (
                            <>
                              <UserPlus size={12} /> {t("hacker.my_team.invite")}
                            </>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-3 text-[11px] text-[var(--app-muted-2)]">
                {t("hacker.my_team.invite_hint")}
              </p>
            </>
          )}
        </section>
      )}

      {/* Invite — Problem 14: this is a TEAM-specific link (carries ?teamCode),
          not the generic event-registration URL. Anyone opening it will be
          auto-enrolled into THIS team after they sign in or register solo.
          Problem 24: hide once team formation closes (the team deadline, else
          the start) — the link can't add anyone then, so showing it would
          be misleading. */}
      {team && (
      <section className="card-shadow rounded-2xl border border-white/5 bg-[var(--app-surface)] p-6">
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-white">
          <UserPlus size={16} className="text-[#E1003C]" />
          {t("hacker.my_team.invite_link_title")}
          {teamCodeParam && (
            <span className="ml-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
              {t("hacker.my_team.personal")}
            </span>
          )}
        </h2>
        {!formationOpen ? (
          <p className="rounded-xl border border-[#FFC107]/30 bg-[#FFC107]/10 px-3 py-2 text-[13px] text-[var(--app-warn)]">
            {t("hacker.my_team.invite_link_closed")}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="flex-1 break-all rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-[13px] text-[var(--app-muted)]">
                {inviteLink || t("hacker.my_team.invite_link_empty")}
              </div>
              <button
                type="button"
                disabled={!inviteLink}
                onClick={copyInvite}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#E1003C] px-4 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-[#C00035] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Copy size={12} />
                {copied ? t("hacker.my_team.copied") : t("hacker.my_team.copy")}
              </button>
            </div>
            {teamCodeParam ? (
              <p className="mt-2 text-[12px] text-[var(--app-muted)]/70">
                {t(autoApproval ? "hacker.my_team.unique_link_auto" : "hacker.my_team.unique_link").replace(
                  "{team}",
                  team?.name || t("hacker.my_team.your_team_fallback"),
                )}
              </p>
            ) : (
              <p className="mt-2 text-[12px] text-amber-300/80">
                {t("hacker.my_team.heads_up")}
              </p>
            )}
          </>
        )}
      </section>
      )}
      <ConfirmDialog
        open={confirmRemove != null}
        title={confirmRemove?.self ? t("hacker.my_team.leave_confirm_t") : t("hacker.my_team.remove_confirm_t").replace("{name}", confirmRemove?.name ?? "")}
        message={confirmRemove?.self ? t("hacker.my_team.leave_confirm_b") : t("hacker.my_team.remove_confirm_b").replace("{name}", confirmRemove?.name ?? "")}
        confirmLabel={confirmRemove?.self ? t("hacker.my_team.leave") : t("hacker.my_team.remove")}
        cancelLabel={t("hacker.my_team.cancel")}
        variant="danger"
        onCancel={() => setConfirmRemove(null)}
        onConfirm={() => { const c = confirmRemove; setConfirmRemove(null); if (c) void removeMember(c.id); }}
      />
    </div>
  );
}
