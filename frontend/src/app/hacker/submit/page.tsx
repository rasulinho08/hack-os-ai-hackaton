"use client";

import { useEffect, useState } from "react";
import { Check, Clock, Presentation, GitBranch, Link2, Loader2, Lock, Send, Video, FileUp, Trash2, FileText } from "lucide-react";
import { ApiError, apiGet, apiPost, apiPut } from "@/lib/api";
import { useToast } from "@/contexts/ToastContext";
import { useTranslation } from "@/contexts/LanguageContext";
import {
  getSubmissionWindowState,
  type SubmissionWindowState,
} from "@/lib/eventPhase";
import { useEventWatcher } from "@/lib/useEventWatcher";
import { participantEventId } from "@/lib/participantEvent";
import { LoadFailure } from "@/components/LoadFailure";
import { ProjectVisibility } from "@/components/projects/ProjectVisibility";
import {
  normalizeTeamMine,
  submitRight,
  normalizeMembersFromPayload,
  extractLeaderIdFromTeamPayload,
} from "@/lib/teamNormalize";
import { formatDate } from "@/lib/i18n/dates";
import { formatInZone } from "@/lib/builder/datetime";
import { normaliseLink, shortTimeLeft, submissionCloses, submitView } from "@/lib/submitView";

interface SubmissionForm {
  name: string;
  description: string;
  repo: string;
  demo: string;
  tech: string;
  presentation: string;
  video: string;
}

const emptyForm: SubmissionForm = { name: "", description: "", repo: "", demo: "", tech: "", presentation: "", video: "" };

/** What the organiser asks for (event builder → Submissions), from GET /api/submissions/rules. */
type FieldState = "required" | "optional" | "off";
type RuleKey = "repo" | "demo" | "slides" | "video" | "summary" | "tech";
interface SubmissionRules {
  fields: Record<RuleKey, FieldState>;
  files: { enabled: boolean; maxMb: number; types: string[]; maxFiles: number };
}
const DEFAULT_RULES: SubmissionRules = {
  fields: { repo: "required", demo: "optional", slides: "optional", video: "optional", summary: "required", tech: "optional" },
  files: { enabled: false, maxMb: 10, types: ["pdf", "pptx"], maxFiles: 5 },
};
const ACCEPT: Record<string, string> = {
  pdf: ".pdf,application/pdf",
  pptx: ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  zip: ".zip,application/zip",
  image: ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp",
};
interface AttachedFile { id: string; filename: string; size: number }

function readRules(raw: unknown): SubmissionRules {
  if (!raw || typeof raw !== "object") return DEFAULT_RULES;
  const o = raw as { fields?: Record<string, unknown>; files?: Record<string, unknown> };
  const state = (v: unknown, d: FieldState): FieldState => (v === "required" || v === "optional" || v === "off" ? v : d);
  const f = o.fields || {};
  const files = o.files || {};
  return {
    fields: {
      repo: state(f.repo, "required"), demo: state(f.demo, "optional"), slides: state(f.slides, "optional"),
      video: state(f.video, "optional"), summary: state(f.summary, "required"), tech: state(f.tech, "optional"),
    },
    files: {
      enabled: files.enabled === true,
      maxMb: Number(files.maxMb) > 0 ? Number(files.maxMb) : 10,
      types: Array.isArray(files.types) ? files.types.map(String) : ["pdf", "pptx"],
      maxFiles: Number(files.maxFiles) > 0 ? Number(files.maxFiles) : 5,
    },
  };
}

function readFiles(raw: unknown): AttachedFile[] {
  return (Array.isArray(raw) ? raw : [])
    .map((x) => x as Record<string, unknown>)
    .filter((x) => typeof x?.id === "string")
    .map((x) => ({ id: String(x.id), filename: String(x.filename ?? "file"), size: Number(x.size ?? 0) }));
}

const inputClass =
  "h-10 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 text-[15px] text-white outline-none placeholder:text-[var(--app-muted-2)] focus:border-[#E1003C]/50 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-[var(--app-danger)]";

/** One field of the form: label (with * when the organiser requires it), control, hint, problem. */
function SubmitField({ label, htmlFor, icon, required, error, hint, children }: {
  label: string; htmlFor?: string; icon?: React.ReactNode; required?: boolean; error?: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-[var(--app-muted)]">
        {icon}{label}{required ? <span aria-hidden="true" className="text-[#E1003C]">*</span> : null}
      </label>
      {children}
      {hint && !error ? <p className="mt-1 text-[12px] text-[var(--app-muted-2)]">{hint}</p> : null}
      {error ? <p role="alert" className="mt-1 text-[12.5px] text-[var(--app-danger)]">{error}</p> : null}
    </div>
  );
}

function formatSubmittedAt(iso: string | null, lang: string): string {
  if (!iso) return "";
  try {
    return formatDate(iso, lang, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  } catch {
    return "";
  }
}

export default function SubmitProjectPage() {
  const { t, lang } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<SubmissionForm>(emptyForm);
  const [submissionId, setSubmissionId] = useState<number | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hasTeam, setHasTeam] = useState<boolean>(false);
  // Who may hand in (the API's rule): the approved lead, or any approved
  // member while the lead is not an approved participant.
  const [submitAs, setSubmitAs] = useState<"lead" | "member" | "none">("none");
  const [teamLeadName, setTeamLeadName] = useState<string>("");
  const [teamMemberCount, setTeamMemberCount] = useState<number>(0);
  const [minTeamSize, setMinTeamSize] = useState<number>(1);
  const [windowState, setWindowState] = useState<SubmissionWindowState>("open");
  // When submissions close, on the event's clock, for the line under the title.
  const [deadline, setDeadline] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState<string>("Asia/Baku");
  const [now, setNow] = useState(() => Date.now());
  // Problem 12: remember the active event's id so we can keep polling
  // it for schedule changes (admin moves start/end/deadline) and
  // recompute the submission window on the fly.
  const [eventId, setEventId] = useState<number | null>(null);
  const [rules, setRules] = useState<SubmissionRules>(DEFAULT_RULES);
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { toast } = useToast();

  useEffect(() => {
    async function load() {
      try {
        const eventHint = await participantEventId();
        const mineUrl =
          eventHint != null
            ? `/api/teams/mine?eventId=${eventHint}`
            : "/api/teams/mine";

        const [subs, me, team, evt] = await Promise.allSettled([
          apiGet<unknown[]>("/api/submissions"),
          apiGet<Record<string, unknown>>("/api/auth/me"),
          apiGet<unknown>(mineUrl),
          apiGet<Record<string, unknown>>("/api/events/active"),
        ]);
        // A failed read of the submission must not render as an empty form.
        setLoadError(
          subs.status === "rejected"
            ? subs.reason instanceof Error && subs.reason.message
              ? subs.reason.message
              : "load_failed"
            : null,
        );

        let meId: number | null = null;
        if (me.status === "fulfilled" && me.value) {
          const idRaw = me.value.id ?? me.value.user_id;
          const n = Number(idRaw);
          if (Number.isFinite(n) && n > 0) meId = n;
        }

        if (subs.status === "fulfilled" && Array.isArray(subs.value) && subs.value.length > 0) {
          const raw = subs.value[0] as Record<string, unknown>;
          const id = Number(raw.id ?? 0);
          if (id > 0) setSubmissionId(id);
          const createdAt = String(raw.created_at ?? raw.createdAt ?? "") || null;
          const updated = String(raw.updated_at ?? raw.updatedAt ?? "") || null;
          setSubmittedAt(createdAt);
          setUpdatedAt(updated);
          setForm({
            name: String(raw.project_name ?? raw.projectName ?? raw.name ?? ""),
            description: String(raw.description ?? ""),
            repo: String(raw.repo_link ?? raw.repoLink ?? raw.repo ?? ""),
            demo: String(raw.demo_link ?? raw.demoLink ?? raw.demo ?? ""),
            tech: String(raw.tech_stack ?? raw.techStack ?? raw.tech ?? ""),
            presentation: String(raw.presentation_link ?? raw.presentationLink ?? raw.presentation ?? ""),
            video: String(raw.video_link ?? raw.videoLink ?? ""),
          });
          setFiles(readFiles(raw.files));
        }

        let teamEventId: number | null = null;
        if (team.status === "fulfilled" && team.value != null) {
          let normalized = normalizeTeamMine(team.value);
          if (normalized && normalized.id > 0) {
            try {
              const extra = await apiGet<unknown[]>(
                `/api/teams/${normalized.id}/members`,
              );
              const lid = extractLeaderIdFromTeamPayload(team.value);
              const roster = normalizeMembersFromPayload(
                Array.isArray(extra) ? extra : [],
                lid,
              );
              if (roster.length > 0) {
                normalized = { ...normalized, members: roster };
              }
            } catch {
              /* keep mine members */
            }
          }

          if (normalized && normalized.id > 0) {
            setHasTeam(true);
            const teamRaw =
              typeof team.value === "object" && team.value != null
                ? (team.value as Record<string, unknown>)
                : null;
            const rawEventId = Number(
              teamRaw?.event_id ?? teamRaw?.eventId ?? normalized.event_id,
            );
            if (Number.isFinite(rawEventId) && rawEventId > 0) {
              teamEventId = rawEventId;
            }
            const members = normalized.members;
            setTeamMemberCount(members.length);
            const lidRow = extractLeaderIdFromTeamPayload(team.value);
            const leaderId = Number.isFinite(lidRow) && lidRow > 0 ? lidRow : 0;
            const lead = members.find(
              (m) =>
                m.is_lead ||
                (leaderId > 0 && m.id === leaderId),
            );
            if (lead) {
              const fullName = lead.full_name?.trim();
              if (fullName) setTeamLeadName(fullName);
            }
            const amLead = meId != null && ((leaderId > 0 && leaderId === meId) || (lead != null && lead.id > 0 && lead.id === meId));
            setSubmitAs(submitRight(team.value, amLead));
          } else {
            setHasTeam(false);
            setTeamMemberCount(0);
            setSubmitAs("none");
          }
        } else {
          setHasTeam(false);
          setTeamMemberCount(0);
          setSubmitAs("none");
        }

        // Submission gating must always follow the hacker's own team event.
        // Using /events/active can drift to another event in multi-event
        // installs, which leaves submit locked even if admin opened this
        // team's submission window.
        const scopedEventId = teamEventId ?? eventHint;
        // What this event asks a team to hand in.
        apiGet<unknown>(`/api/submissions/rules${scopedEventId != null ? `?eventId=${scopedEventId}` : ""}`)
          .then((r) => setRules(readRules(r)))
          .catch(() => { /* the original rules apply */ });
        if (scopedEventId != null) {
          setEventId(scopedEventId);
          try {
            const scopedEvt = await apiGet<Record<string, unknown>>(
              `/api/events/${scopedEventId}`,
            );
            const minRaw = Number(
              scopedEvt.min_team_size ?? scopedEvt.minTeamSize ?? 1,
            );
            if (Number.isFinite(minRaw) && minRaw >= 1) setMinTeamSize(minRaw);
            setWindowState(
              getSubmissionWindowState(
                scopedEvt as Parameters<typeof getSubmissionWindowState>[0],
              ),
            );
            setDeadline(submissionCloses(scopedEvt));
            if (typeof scopedEvt.timezone === "string" && scopedEvt.timezone) setTimeZone(scopedEvt.timezone);
            return;
          } catch {
            // Fallback to /events/active handling below.
          }
        }

        if (evt.status === "fulfilled" && evt.value) {
          const minRaw = Number(evt.value.min_team_size ?? evt.value.minTeamSize ?? 1);
          if (Number.isFinite(minRaw) && minRaw >= 1) setMinTeamSize(minRaw);
          setWindowState(getSubmissionWindowState(evt.value as Parameters<typeof getSubmissionWindowState>[0]));
          setDeadline(submissionCloses(evt.value));
          if (typeof evt.value.timezone === "string" && evt.value.timezone) setTimeZone(evt.value.timezone);
          const evId = Number(evt.value.id);
          if (Number.isFinite(evId) && evId > 0) setEventId(evId);
        } else if (eventHint != null) {
          setEventId(eventHint);
        }
      } catch {
        // no existing submission
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Problem 12: poll the event so the Submit window auto-opens /
  // auto-closes when the admin edits start_date, end_date, or
  // submission_deadline mid-hackathon. Without this, the hacker would
  // keep seeing "not started yet" until they manually refreshed.
  useEventWatcher(eventId, (evt) => {
    setWindowState(
      getSubmissionWindowState(
        evt as Parameters<typeof getSubmissionWindowState>[0],
      ),
    );
    const minRaw = Number(evt.min_team_size ?? evt.minTeamSize ?? 1);
    if (Number.isFinite(minRaw) && minRaw >= 1) setMinTeamSize(minRaw);
    setDeadline(submissionCloses(evt as Record<string, unknown>));
  });

  // The countdown moves on its own, once a minute.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const update = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    const apiField: Record<string, string> = { name: "projectName", description: "description", repo: "repoLink", demo: "demoLink", tech: "techStack", presentation: "presentationLink", video: "videoLink" };
    setFieldErrors((e) => {
      const k = apiField[key];
      if (!k || !(k in e)) return e;
      const n = { ...e }; delete n[k]; return n;
    });
  };

  const fileError = (code: string | undefined) =>
    t(code === "FILE_TOO_LARGE" || code === "PAYLOAD_TOO_LARGE" ? "hacker.submit.file_too_large"
      : code === "FILE_TYPE_NOT_ALLOWED" ? "hacker.submit.file_type"
        : code === "FILES_DISABLED" ? "hacker.submit.files_disabled"
          : code === "PLAN_STORAGE_FULL" || code === "STORAGE_FULL" ? "hacker.submit.file_storage"
            : "hacker.submit.file_failed")
      .replace("{mb}", String(rules.files.maxMb));

  const uploadFile = async (file: File | undefined) => {
    if (!file || eventId == null) return;
    if (files.length >= rules.files.maxFiles) {
      toast(t("hacker.submit.files_max").replace("{n}", String(rules.files.maxFiles)), "error");
      return;
    }
    if (file.size > rules.files.maxMb * 1024 * 1024) {
      toast(fileError("FILE_TOO_LARGE"), "error");
      return;
    }
    setUploading(true);
    try {
      const res = await fetch(`/api/files?purpose=submission&eventId=${eventId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
        body: file,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        toast(fileError(typeof json?.code === "string" ? json.code : res.status === 413 ? "FILE_TOO_LARGE" : undefined), "error");
        return;
      }
      setFiles((prev) => [...prev, { id: json.data.id, filename: json.data.filename || file.name, size: json.data.size || file.size }]);
      setFieldErrors((e) => { const n = { ...e }; delete n.fileIds; return n; });
    } catch {
      toast(fileError(undefined), "error");
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasTeam) {
      toast(t("hacker.submit.no_team_title"), "error");
      return;
    }
    if (submitAs === "none") {
      toast(t("hacker.submit.lead_only_title"), "error");
      return;
    }
    if (windowState === "not_started") {
      toast(t("hacker.submit.not_started_title"), "error");
      return;
    }
    if (windowState === "closed") {
      toast(t("hacker.submit.closed_title"), "error");
      return;
    }
    if (minTeamSize > 1 && teamMemberCount < minTeamSize) {
      toast(
        t("hacker.submit.team_too_small_title")
          .replace("{min}", String(minTeamSize))
          .replace("{current}", String(teamMemberCount)),
        "error",
      );
      return;
    }
    setSaving(true);
    try {
      const payload = {
        projectName: form.name,
        description: form.description,
        repoLink: normaliseLink(form.repo),
        demoLink: normaliseLink(form.demo),
        techStack: form.tech,
        presentationLink: normaliseLink(form.presentation),
        videoLink: normaliseLink(form.video),
        ...(rules.files.enabled ? { fileIds: files.map((f) => f.id) } : {}),
      };
      setFieldErrors({});
      if (submissionId) {
        const res = await apiPut<Record<string, unknown>>(
          `/api/submissions/${submissionId}`,
          payload,
        );
        const newUpdated = String(res?.updated_at ?? res?.updatedAt ?? new Date().toISOString());
        setUpdatedAt(newUpdated);
        toast(t("hacker.submit.toast_updated"), "success");
      } else {
        const res = await apiPost<Record<string, unknown>>(
          "/api/submissions",
          payload,
        );
        const newId = Number(res?.id ?? 0);
        if (newId > 0) setSubmissionId(newId);
        const created = String(
          res?.created_at ?? res?.createdAt ?? new Date().toISOString(),
        );
        setSubmittedAt(created);

        // The API e-mails the whole team a receipt; nothing to send from here.
        toast(t("hacker.submit.toast_submitted"), "success");
      }
      } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.fieldErrors.length) {
        // The organiser's rules, field by field, next to the fields.
        setFieldErrors(Object.fromEntries(err.fieldErrors.map((fe) => [fe.field, fe.message || err.summary])));
        if (err.code === "FILE_NOT_FOUND") setFiles([]);
        toast(t("hacker.submit.fix_fields"), "error");
        return;
      }
      if (err instanceof ApiError && err.status === 403) {
        const low = (err.message || "").toLowerCase();
        if (low.includes("team lead") || low.includes("not_team_lead")) {
          toast(t("hacker.submit.lead_only_title"), "error");
          setSubmitAs("none");
          return;
        }
        if (low.includes("has not started") || low.includes("hackathon_not_started")) {
          toast(t("hacker.submit.not_started_title"), "error");
          setWindowState("not_started");
          return;
        }
        if (low.includes("submission window has closed") || low.includes("submission_closed")) {
          toast(t("hacker.submit.closed_title"), "error");
          setWindowState("closed");
          return;
        }
        if (low.includes("team needs at least") || low.includes("team_too_small")) {
          toast(
            t("hacker.submit.team_too_small_title")
              .replace("{min}", String(minTeamSize))
              .replace("{current}", String(teamMemberCount)),
            "error",
          );
          return;
        }
      }
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : t("common.error.unknown");
      toast(
        msg
          ? `${t("hacker.submit.toast_failed_prefix")} ${msg}`
          : t("hacker.submit.toast_failed"),
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
      {loadError && (
        <LoadFailure message={loadError === "load_failed" ? undefined : loadError} onRetry={() => window.location.reload()} />
      )}
        <Loader2 className="h-8 w-8 animate-spin text-[#E1003C]" />
      </div>
    );
  }

  const isUpdating = submissionId != null;
  const lastActivity = updatedAt || submittedAt;
  const teamSizeOk = minTeamSize <= 1 || teamMemberCount >= minTeamSize;
  const windowOpen = windowState === "open";
  // Only the team lead (or, while the lead is not approved, an approved
  // member) may write AND the hackathon window must be open AND
  // the team must satisfy min-team-size. All three gates are enforced on
  // the backend too (see submission.controller.assertSubmissionWindow /
  // assertMinTeamSize) — these flags only drive UI state.
  // One state for the whole page (lib/submitView): editable, or the one reason it is not.
  const view = submitView({ hasTeam, submitAs, windowState, teamSizeOk, hasSubmission: isUpdating });
  const canSubmit = view.editable && windowOpen;
  const readOnly = !canSubmit;
  const deadlineText = deadline ? formatInZone(deadline, timeZone, lang, {}) : null;
  const left = deadline && windowState !== "closed"
    ? shortTimeLeft(deadline, now, { d: t("hacker.submit.unit_d"), h: t("hacker.submit.unit_h"), m: t("hacker.submit.unit_m") })
    : null;
  const tidy = (key: "repo" | "demo" | "presentation" | "video") => {
    const next = normaliseLink(form[key]);
    if (next !== form[key]) update(key, next);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.02em] text-[var(--app-heading)]">
          {t(view.title)}
        </h1>
        {view.subtitle ? (
          <p className="mt-1 text-[15px] text-[var(--app-muted)]">{t(view.subtitle)}</p>
        ) : null}
        {deadlineText ? (
          <p className="mt-3 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[13px] text-[var(--app-muted)]" data-submit-deadline="">
            <Clock size={13} aria-hidden="true" />
            <span>
              {t(windowState === "closed" ? "hacker.submit.deadline_closed" : "hacker.submit.deadline").replace("{at}", deadlineText)}
            </span>
            {left ? <span className="font-semibold text-[var(--app-heading)]">{t("hacker.submit.deadline_left").replace("{left}", left)}</span> : null}
          </p>
        ) : null}
      </div>

      {view.banner === "not_started" && (
        <div className="card-shadow rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/20">
              <Clock size={16} className="text-amber-400" />
            </div>
            <div>
              <p className="text-[15px] font-semibold text-white">
                {t("hacker.submit.not_started_title")}
              </p>
              <p className="mt-1 text-[13px] text-[var(--app-muted)]">
                {t("hacker.submit.not_started_desc")}
              </p>
            </div>
          </div>
        </div>
      )}

      {view.banner === "closed" && (
        <div className="card-shadow rounded-2xl border border-[#b3b3b3]/20 bg-white/[0.03] p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10">
              <Lock size={16} className="text-[var(--app-muted)]" />
            </div>
            <div>
              <p className="text-[15px] font-semibold text-white">
                {t("hacker.submit.closed_title")}
              </p>
              <p className="mt-1 text-[13px] text-[var(--app-muted)]">
                {t("hacker.submit.closed_desc")}
              </p>
            </div>
          </div>
        </div>
      )}

      {view.banner === "team_too_small" && (
        <div className="card-shadow rounded-2xl border border-[#E1003C]/20 bg-[#E1003C]/5 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E1003C]/15">
              <Lock size={16} className="text-[#E1003C]" />
            </div>
            <div>
              <p className="text-[15px] font-semibold text-white">
                {t("hacker.submit.team_too_small_title")
                  .replace("{min}", String(minTeamSize))
                  .replace("{current}", String(teamMemberCount))}
              </p>
              <p className="mt-1 text-[13px] text-[var(--app-muted)]">
                {t("hacker.submit.team_too_small_desc")
                  .replace("{min}", String(minTeamSize))
                  .replace("{current}", String(teamMemberCount))}
              </p>
            </div>
          </div>
        </div>
      )}

      {view.memberMayHandIn && (
        <div className="card-shadow rounded-2xl border border-[#00C853]/20 bg-[#00C853]/5 p-4">
          <p className="text-[15px] font-semibold text-white">{t("hacker.submit.member_can_title")}</p>
          <p className="mt-1 text-[13px] text-[var(--app-muted)]">{t("hacker.submit.member_can_desc")}</p>
        </div>
      )}

      {/* Not an error: a member reads the project, the lead hands it in. */}
      {view.banner === "lead_only" && (
        <div className="card-shadow rounded-2xl border border-[#b3b3b3]/20 bg-white/[0.03] p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10">
              <Lock size={16} className="text-[var(--app-muted)]" />
            </div>
            <div>
              <p className="text-[15px] font-semibold text-white">
                {t("hacker.submit.lead_only_title")}
              </p>
              <p className="mt-1 text-[13px] text-[var(--app-muted)]">
                {teamLeadName
                  ? t("hacker.submit.lead_only_desc_named").replace(
                      "{lead}",
                      teamLeadName,
                    )
                  : t("hacker.submit.lead_only_desc")}
              </p>
            </div>
          </div>
        </div>
      )}

      {view.banner === "no_team" && (
        <div className="card-shadow rounded-2xl border border-[#E1003C]/20 bg-[#E1003C]/5 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E1003C]/15">
              <Lock size={16} className="text-[#E1003C]" />
            </div>
            <div>
              <p className="text-[15px] font-semibold text-white">
                {t("hacker.submit.no_team_title")}
              </p>
              <p className="mt-1 text-[13px] text-[var(--app-muted)]">
                {t("hacker.submit.no_team_desc")}
              </p>
            </div>
          </div>
        </div>
      )}

      {isUpdating && (
        <div className="card-shadow rounded-2xl border border-[#00C853]/20 bg-[#00C853]/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#00C853]/15">
                <Check size={16} className="text-[var(--app-ok)]" />
              </div>
              <div>
                <p className="text-[15px] font-semibold text-white">
                  {t("hacker.submit.status_submitted")}
                </p>
                <p className="mt-1 text-[12px] text-[var(--app-muted)]">
                  {submittedAt && (
                    <span className="inline-flex items-center gap-1">
                      <Clock size={10} />
                      {t("hacker.submit.submitted_at").replace(
                        "{t}",
                        formatSubmittedAt(submittedAt, lang),
                      )}
                    </span>
                  )}
                  {updatedAt && updatedAt !== submittedAt && (
                    <>
                      {submittedAt && <span className="mx-1.5">·</span>}
                      <span className="inline-flex items-center gap-1">
                        <Clock size={10} />
                        {t("hacker.submit.last_updated").replace(
                          "{t}",
                          formatSubmittedAt(updatedAt, lang),
                        )}
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>
          {lastActivity && canSubmit && (
            <p className="mt-3 text-[12px] text-[var(--app-muted-2)]">
              {t("hacker.submit.last_activity_msg")}
            </p>
          )}
        </div>
      )}

      <form
        onSubmit={onSubmit}
        className="card-shadow space-y-5 rounded-2xl border border-white/5 bg-[var(--app-surface)] p-6"
      >
        <SubmitField htmlFor="sub-name" label={t("hacker.submit.project_name")} required error={fieldErrors.projectName}>
          <input
            required
            id="sub-name"
              value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="Smart Baku AI"
            readOnly={readOnly}
            disabled={readOnly}
            maxLength={255}
            aria-invalid={Boolean(fieldErrors.projectName) || undefined}
            className={inputClass}
          />
        </SubmitField>

        {rules.fields.summary !== "off" ? (
          <SubmitField htmlFor="sub-desc" label={t("hacker.submit.description")} required={rules.fields.summary === "required"} error={fieldErrors.description}>
            <textarea
              required={rules.fields.summary === "required"}
              id="sub-desc"
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              rows={3}
              maxLength={5000}
              placeholder={t("hacker.submit.description_ph")}
              readOnly={readOnly}
              disabled={readOnly}
              aria-invalid={Boolean(fieldErrors.description) || undefined}
              className={`${inputClass} h-auto py-2.5`}
            />
          </SubmitField>
        ) : null}

        {rules.fields.repo !== "off" ? (
          <SubmitField icon={<GitBranch size={12} />} htmlFor="sub-repo" label={t("hacker.submit.repo")} required={rules.fields.repo === "required"} error={fieldErrors.repoLink}>
            <input
              required={rules.fields.repo === "required"}
              inputMode="url"
              id="sub-repo"
              value={form.repo}
              onChange={(e) => update("repo", e.target.value)}
              onBlur={() => tidy("repo")}
              placeholder="https://github.com/team/project"
              readOnly={readOnly}
              disabled={readOnly}
              aria-invalid={Boolean(fieldErrors.repoLink) || undefined}
              className={inputClass}
            />
          </SubmitField>
        ) : null}

        {rules.fields.demo !== "off" ? (
          <SubmitField icon={<Link2 size={12} />} htmlFor="sub-demo" label={t("hacker.submit.demo")} required={rules.fields.demo === "required"} error={fieldErrors.demoLink}>
            <input
              required={rules.fields.demo === "required"}
              inputMode="url"
              id="sub-demo"
              value={form.demo}
              onChange={(e) => update("demo", e.target.value)}
              onBlur={() => tidy("demo")}
              placeholder="https://your-demo.app"
              readOnly={readOnly}
              disabled={readOnly}
              aria-invalid={Boolean(fieldErrors.demoLink) || undefined}
              className={inputClass}
            />
          </SubmitField>
        ) : null}

        {rules.fields.video !== "off" ? (
          <SubmitField icon={<Video size={12} />} htmlFor="sub-video" label={t("hacker.submit.video")} required={rules.fields.video === "required"} error={fieldErrors.videoLink}>
            <input
              required={rules.fields.video === "required"}
              inputMode="url"
              id="sub-video"
              value={form.video}
              onChange={(e) => update("video", e.target.value)}
              onBlur={() => tidy("video")}
              placeholder={t("hacker.submit.video_ph")}
              readOnly={readOnly}
              disabled={readOnly}
              aria-invalid={Boolean(fieldErrors.videoLink) || undefined}
              className={inputClass}
            />
          </SubmitField>
        ) : null}

        {rules.fields.tech !== "off" ? (
          <SubmitField htmlFor="sub-tech" label={t("hacker.submit.tech_stack")} required={rules.fields.tech === "required"} error={fieldErrors.techStack}>
            <input
              required={rules.fields.tech === "required"}
              id="sub-tech"
              value={form.tech}
              onChange={(e) => update("tech", e.target.value)}
              placeholder={t("hacker.submit.tech_stack_ph")}
              readOnly={readOnly}
              disabled={readOnly}
              maxLength={500}
              aria-invalid={Boolean(fieldErrors.techStack) || undefined}
              className={inputClass}
            />
          </SubmitField>
        ) : null}

        {rules.fields.slides !== "off" ? (
          <SubmitField icon={<Presentation size={12} />} htmlFor="sub-slides" label={t("hacker.submit.presentation")} required={rules.fields.slides === "required"} error={fieldErrors.presentationLink}
            hint={t("hacker.submit.presentation_hint")}>
            <input
              required={rules.fields.slides === "required"}
              inputMode="url"
              id="sub-slides"
              value={form.presentation}
              onChange={(e) => update("presentation", e.target.value)}
              onBlur={() => tidy("presentation")}
              placeholder={t("hacker.submit.presentation_ph")}
              readOnly={readOnly}
              disabled={readOnly}
              aria-invalid={Boolean(fieldErrors.presentationLink) || undefined}
              className={inputClass}
            />
          </SubmitField>
        ) : null}

        {rules.files.enabled || files.length > 0 ? (
          <SubmitField icon={<FileText size={12} />} label={t("hacker.submit.files")} error={fieldErrors.fileIds}
            hint={t("hacker.submit.files_hint")
              .replace("{types}", rules.files.types.map((x) => x.toUpperCase()).join(", "))
              .replace("{mb}", String(rules.files.maxMb))
              .replace("{n}", String(rules.files.maxFiles))}>
            <div className="space-y-2">
              {files.map((f) => (
                <div key={f.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                  <FileText size={15} className="shrink-0 text-[var(--app-muted)]" aria-hidden="true" />
                  <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[14px] text-white hover:underline">{f.filename}</a>
                  <span className="shrink-0 text-[12px] tabular-nums text-[var(--app-muted-2)]">{f.size >= 1024 * 1024 ? `${(f.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`}</span>
                  {!readOnly && rules.files.enabled ? (
                    <button type="button" onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))}
                      aria-label={t("hacker.submit.file_remove")} className="shrink-0 p-1 text-[var(--app-danger)]">
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
              ))}
              {!readOnly && rules.files.enabled && files.length < rules.files.maxFiles ? (
                <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-dashed border-white/15 px-3 py-3 text-[14px] text-[var(--app-muted)] hover:border-[#E1003C]/40">
                  {uploading ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <FileUp size={15} aria-hidden="true" />}
                  {uploading ? t("hacker.submit.file_uploading") : t("hacker.submit.file_choose")}
                  <input
                    type="file"
                    className="sr-only"
                    disabled={uploading}
                    accept={rules.files.types.map((x) => ACCEPT[x] || "").filter(Boolean).join(",")}
                    onChange={(e) => { void uploadFile(e.target.files?.[0]); e.target.value = ""; }}
                  />
                </label>
              ) : null}
            </div>
          </SubmitField>
        ) : null}

        {canSubmit && (
          <button
            type="submit"
            disabled={saving || uploading}
            className="inline-flex items-center gap-2 rounded-xl bg-[#E1003C] px-5 py-2.5 text-[15px] font-semibold text-white transition-colors hover:bg-[#C00035] disabled:opacity-60"
          >
            <Send size={14} />
            {saving
              ? isUpdating
                ? t("hacker.submit.btn_saving")
                : t("hacker.submit.btn_submitting")
              : isUpdating
                ? t("hacker.submit.btn_update")
                : t("hacker.submit.btn_submit")}
          </button>
        )}
      </form>

      {eventId != null && hasTeam ? <ProjectVisibility eventId={eventId} /> : null}
    </div>
  );
}
