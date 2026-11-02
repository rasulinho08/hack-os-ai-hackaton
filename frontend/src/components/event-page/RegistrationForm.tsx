"use client";

/**
 * Registration for one event, built from what its organiser set up: how
 * people take part (alone, creating a team, joining one with a code), the
 * questions switched on, eligibility and the rules to accept. One request
 * registers everything; the answer says where the person stands (approved,
 * pending, waitlisted) and, for a team lead, the code to share.
 *
 * Answers are checked here first with the API's own rules, so problems are
 * named in the page's language; the API checks them again and has the last
 * word. A filled-in answer is checked as soon as the person leaves it; an
 * empty required one only on sending, so nobody is scolded for a field they
 * have not reached yet.
 *
 * The form is split into numbered steps (how you take part, your account,
 * about you, the organisers' own questions, rules) with the required answers
 * counted, and the send button stays in reach at the bottom of the screen.
 */

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle, CalendarPlus, Check, CircleAlert, Clock, Copy, Eye, EyeOff, FileText, FileUp, Hourglass, LayoutDashboard, Loader2, Lock, MailCheck,
  PartyPopper, Trash2, User, UserPlus, Users,
} from "lucide-react";
import { ApiError, apiPost } from "@/lib/api";
import { resolve, type Lang } from "@/lib/i18n";
import { countryOptions } from "@/lib/builder/countries";
import { formatInZone } from "@/lib/builder/datetime";
import type { PublicEvent, PublicField } from "@/lib/builder/public";
import { CODE_FIELDS, FILE_CODES, REGISTER_CODES, checkRegistration, entryOptions, isEmpty, type EntryType, type Problem } from "@/lib/builder/registrationCheck";
import { teamInviteUrl } from "@/lib/teamInviteUrl";
import { persistLang } from "@/lib/i18n";
import { enterEventWorkspace } from "@/lib/workspaces";
import { SKILL_OPTIONS } from "@/types/participant";
import { AddToCalendar } from "./AddToCalendar";
import { RegisterLayout, fieldClass, fieldStyle, panelClass, panelStyle, primaryButton, secondaryButton, secondaryStyle } from "./registerUi";
import { UniversityInput } from "./UniversityInput";

interface FileValue { fileId: string; claimToken: string; name: string }
type Msg = string | Problem;
export interface RegistrationResult {
  status: "approved" | "pending" | "waitlisted";
  created: boolean;
  team: { id: number; name: string; join_code: string | null } | null;
  teamSkipped: boolean;
  /** A new account: a link to confirm the address was e-mailed. */
  verificationRequired?: boolean;
}

/** Standard questions whose options are codes with a label in each language. */
const OPTION_LABELS = new Set(["gender", "diet", "source", "experience"]);
const FILE_LIMIT = 5 * 1024 * 1024;
/** What most hackathon participants pick, shown first; the full list is one tap away. */
const COMMON_SKILLS = [
  "Python", "JavaScript", "TypeScript", "Java", "C++", "React", "Node.js", "Machine Learning", "AI / LLM",
  "Data Science", "UI/UX Design", "Figma", "Mobile (Flutter)", "Mobile (React Native)", "DevOps / CI/CD", "Cybersecurity",
];
const SKILLS = [...COMMON_SKILLS.filter((s) => SKILL_OPTIONS.includes(s)), ...SKILL_OPTIONS.filter((s) => !COMMON_SKILLS.includes(s))];
const SKILLS_FIRST = COMMON_SKILLS.length;
const FILE_ACCEPT = ".pdf,.docx,.png,.jpg,.jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg";
/** Controls that need the whole row; the rest sit two to a row on wider screens. */
const WIDE_TYPES = new Set(["textarea", "multiselect", "skills", "checkbox", "file", "university"]);
/** Where each problem's control is, for the links in the summary of problems. */
const TARGETS: Record<string, string> = {
  "account.fullName": "rg-name", "account.email": "rg-email", "account.password": "rg-pw",
  "entry.type": "rg-entry", "entry.teamName": "rg-team", "entry.teamCode": "rg-code", "entry.trackId": "rg-track",
  "accept.rules": "rg-acc-rules", "accept.coc": "rg-acc-coc",
};
/** Problems linked by name in the summary; the rest are marked at their fields. */
const JUMP_MAX = 6;
const targetOf = (key: string) => TARGETS[key] || (key.startsWith("answers.") ? `rf-${key.slice(8)}` : "");

const muted = { color: "var(--ink-3)" };
const soft = { color: "var(--ink-2)" };
const ink = { color: "var(--ink)" };

function Req() {
  return <span aria-hidden="true" style={{ color: "var(--accent-solid)" }}> *</span>;
}

function Label({ htmlFor, id, children, required }: { htmlFor?: string; id?: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} id={id} className="mb-2 block text-[14px] font-medium leading-snug" style={ink}>
      {children}{required ? <Req /> : null}
    </label>
  );
}

function Err({ id, children }: { id?: string; children?: string | null }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-2 flex items-start gap-1.5 text-[13px] leading-snug" style={{ color: "var(--danger)" }}>
      <CircleAlert size={14} className="mt-[2px] shrink-0" aria-hidden="true" />{children}
    </p>
  );
}

/** One numbered step of the form; the number turns into a tick once its required answers are in. */
function Step({ id, n, title, hint, done, children }: { id: string; n: number; title: string; hint?: React.ReactNode; done: boolean; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className={`${panelClass} scroll-mt-6 p-5 sm:p-7`} style={panelStyle}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums transition-colors"
          style={done ? { background: "var(--ok-weak)", color: "var(--ok)" } : { background: "var(--tint)", color: "var(--ink-2)" }}>
          {done ? <Check size={15} strokeWidth={2.75} /> : n}
        </span>
        <div className="min-w-0">
          <h2 id={`${id}-h`} className="text-[17px] font-semibold leading-snug sm:text-[18px]" style={ink}>{title}</h2>
          {hint ? <div className="mt-1 text-[13.5px] leading-relaxed" style={soft}>{hint}</div> : null}
        </div>
      </div>
      <div className="mt-5 sm:pl-10">{children}</div>
    </section>
  );
}

/** A box to tick, as a whole row that is easy to hit with a thumb. */
function TickRow({ id, checked, onChange, invalid, describedBy, required, children }: {
  id: string; checked: boolean; onChange: (v: boolean) => void; invalid?: boolean; describedBy?: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <label htmlFor={id} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-[14px] border p-3.5 text-[14.5px] leading-snug transition-colors"
      style={{
        borderColor: invalid ? "var(--danger)" : checked ? "color-mix(in srgb, var(--accent-solid) 55%, transparent)" : "var(--line-strong)",
        background: checked ? "color-mix(in srgb, var(--accent-solid) 5%, var(--surface))" : "var(--surface)",
        color: "var(--ink)",
      }}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-invalid={invalid || undefined} aria-describedby={describedBy} aria-required={required || undefined}
        className="mt-px h-5 w-5 shrink-0 cursor-pointer accent-[var(--accent-solid)]" />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const complete = done >= total;
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color: complete ? "var(--ok)" : "var(--ink-2)" }}>
        {complete ? <Check size={13} strokeWidth={2.75} aria-hidden="true" /> : null}{label}
      </p>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-valuetext={label}
        className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--tint)" }}>
        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${total ? (done / total) * 100 : 100}%`, background: complete ? "var(--ok)" : "var(--accent-solid)" }} />
      </div>
    </div>
  );
}

/** What a personal invitation's link says about its person (GET /api/public/invitations/:token). */
export interface InvitationPreview {
  email: string;
  fullName: string | null;
  team: { name: string; exists: boolean } | null;
}

export function RegistrationForm({
  event, lang, signedIn, initialTeamCode, refParam, inviteToken, invitation = null, onDone, summary, banner,
}: {
  event: PublicEvent;
  lang: Lang;
  signedIn: { email: string; name?: string } | null;
  initialTeamCode?: string | null;
  refParam?: string | null;
  /** From an invitation's own link: the API lets its person through with it. */
  inviteToken?: string | null;
  /** The invitation that link belongs to: its address is filled in and fixed, its team offered. */
  invitation?: InvitationPreview | null;
  onDone?: (r: RegistrationResult) => void;
  /** The event at a glance, drawn beside (or above) the form. */
  summary?: (heading: "h1" | "p") => React.ReactNode;
  /** A note from the page above the form (an invitation through a closed registration). */
  banner?: React.ReactNode;
}) {
  const t = (k: string) => resolve(lang, k);
  const f = (k: string, p: Record<string, string | number>) => Object.entries(p).reduce((s, [a, b]) => s.split(`{${a}}`).join(String(b)), t(k));
  const say = (p: Problem) => (p.params ? f(p.key, p.params) : t(p.key));
  // Problems found here stay keys until shown, so switching language re-words them; the API's own sentences stay as sent.
  const msg = (m: Msg | undefined | null) => (m == null ? null : typeof m === "string" ? m : say(m));

  // Once team formation closed, only "on my own" — or nothing, where alone a person could not take part.
  const entryOpts = entryOptions(event);
  const allowed: EntryType[] = entryOpts.allowed;
  // A team on the invitation: join it when it exists (no code), else create it under that name.
  const invitedTeam = invitation?.team ?? null;
  const joinInvited = Boolean(invitedTeam?.exists && allowed.includes("member"));
  const [useCode, setUseCode] = useState(false);
  const [entry, setEntry] = useState<{ type: EntryType; teamName: string; teamCode: string; trackId: string }>({
    type: initialTeamCode && allowed.includes("member")
      ? "member"
      : joinInvited ? "member" : invitedTeam && allowed.includes("lead") ? "lead" : allowed[0] ?? "solo",
    teamName: invitedTeam && !invitedTeam.exists ? invitedTeam.name : "",
    teamCode: initialTeamCode || "",
    trackId: "",
  });
  const joiningInvited = joinInvited && !useCode && entry.type === "member" && !entry.teamCode.trim();
  const [account, setAccount] = useState({ fullName: signedIn?.name || invitation?.fullName || "", email: invitation?.email ?? "", password: "" });
  const [showPw, setShowPw] = useState(false);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [accept, setAccept] = useState({ rules: false, coc: false });
  const [errors, setErrors] = useState<Record<string, Msg>>({});
  const errOf = (k: string) => msg(errors[k]);
  const [topError, setTopError] = useState<{ message: Msg; code?: string; extra: Msg[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [allSkills, setAllSkills] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const elig = event.eligibility;

  const clear = (key: string) => setErrors((e) => {
    if (!(key in e)) return e;
    const n = { ...e }; delete n[key]; return n;
  });
  const set = (key: string, v: unknown) => {
    setAnswers((a) => ({ ...a, [key]: v }));
    clear(`answers.${key}`);
  };

  // Standard questions are asked in the participant's words (the builder names them for the organiser).
  const fieldLabel = (fl: PublicField) => (fl.kind === "standard" ? t(`rg.field.${fl.key}`) : fl.label || fl.key);
  const optionLabel = (fl: PublicField, o: string) => (fl.kind === "standard" && OPTION_LABELS.has(fl.key) ? t(`rg.opt.${fl.key}.${o}`) : o);

  // Profile questions first, then the organisers' own; each group keeps the organiser's order.
  const profileFields = useMemo(() => event.form.filter((fl) => fl.kind === "standard"), [event.form]);
  const customFields = useMemo(() => event.form.filter((fl) => fl.kind !== "standard"), [event.form]);

  /** Every field the page draws, in page order, so problems elsewhere go to the banner instead of nowhere. */
  const order = useMemo(() => {
    const s: string[] = [];
    if (allowed.length > 1) s.push("entry.type", "entry.teamName", "entry.teamCode", "entry.trackId");
    if (!signedIn) s.push("account.fullName", "account.email", "account.password");
    for (const fl of [...profileFields, ...customFields]) s.push(`answers.${fl.key}`);
    if (elig.requireRules) s.push("accept.rules");
    if (elig.requireCoc) s.push("accept.coc");
    return s;
  }, [profileFields, customFields, signedIn, allowed.length, elig.requireRules, elig.requireCoc]);
  const shown = useMemo(() => new Set(order), [order]);

  // The same checks as on sending, run as the person types: they drive the step ticks and the count.
  const live = checkRegistration({ form: event.form, eligibility: elig, signedIn: Boolean(signedIn), account, entry, answers, accept, invitedTeam: joiningInvited });
  const required: { key: string; step: string }[] = [
    ...(entry.type === "lead" && allowed.length > 1 ? [{ key: "entry.teamName", step: "rg-entry" }] : []),
    ...(entry.type === "member" && allowed.length > 1 && !joiningInvited ? [{ key: "entry.teamCode", step: "rg-entry" }] : []),
    ...(!signedIn ? ["account.fullName", "account.email", "account.password"].map((key) => ({ key, step: "rg-account" })) : []),
    ...event.form
      .filter((fl) => fl.required
        || (fl.key === "age" && (elig.minAge != null || elig.maxAge != null))
        || (fl.key === "country" && elig.countries.length > 0)
        || (fl.key === "university" && elig.studentsOnly))
      .map((fl) => ({ key: `answers.${fl.key}`, step: fl.kind === "standard" ? "rg-about" : "rg-questions" })),
    ...(elig.requireRules ? [{ key: "accept.rules", step: "rg-consent" }] : []),
    ...(elig.requireCoc ? [{ key: "accept.coc", step: "rg-consent" }] : []),
  ];
  const doneCount = required.filter((r) => !(r.key in live)).length;
  const stepDone = (step: string) => {
    const mine = required.filter((r) => r.step === step);
    return mine.length > 0 && mine.every((r) => !(r.key in live));
  };
  const progressLabel = doneCount >= required.length ? t("rg.progress_done") : f("rg.progress", { done: doneCount, total: required.length });

  /** Leaving a filled-in answer checks it at once; an empty one waits for sending. */
  const check = (key: string, empty: boolean) => {
    if (empty) return;
    const p = live[key];
    if (p) setErrors((e) => ({ ...e, [key]: p }));
  };

  const upload = async (fl: PublicField, file: File | undefined) => {
    if (!file) return;
    const key = `answers.${fl.key}`;
    if (file.size > FILE_LIMIT) { setErrors((e) => ({ ...e, [key]: { key: "rg.file.FILE_TOO_LARGE" } })); return; }
    setUploading((u) => ({ ...u, [fl.key]: true }));
    clear(key);
    try {
      const res = await fetch(`/api/files?purpose=registration&eventId=${event.id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
        body: file,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        const code = typeof json?.code === "string" ? json.code : "";
        const problem: Msg = FILE_CODES.has(code) ? { key: `rg.file.${code}` } : json?.message || { key: "rg.file.failed" };
        setErrors((e) => ({ ...e, [key]: problem }));
        return;
      }
      set(fl.key, { fileId: json.data.id, claimToken: json.data.claimToken, name: json.data.filename || file.name } as FileValue);
    } catch {
      setErrors((e) => ({ ...e, [key]: { key: "rg.file.failed" } }));
    } finally {
      setUploading((u) => ({ ...u, [fl.key]: false }));
    }
  };

  const showProblems = (map: Record<string, Msg>, message: Msg, code?: string) => {
    setErrors(map);
    const extra = Object.entries(map).filter(([k]) => !shown.has(k)).map(([, v]) => v);
    setTopError({ message, code, extra });
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (busy || Object.values(uploading).some(Boolean)) return;
    setTopError(null);
    const problems = checkRegistration({ form: event.form, eligibility: elig, signedIn: Boolean(signedIn), account, entry, answers, accept, invitedTeam: joiningInvited });
    if (Object.keys(problems).length) {
      showProblems(problems, { key: "rg.err.fix" });
      return;
    }
    setBusy(true);
    try {
      const body = {
        ...(signedIn ? {} : { account: { fullName: account.fullName.trim(), email: account.email.trim().toLowerCase(), password: account.password } }),
        answers,
        entry: {
          type: entry.type,
          ...(entry.type === "lead" ? { teamName: entry.teamName.trim(), trackId: entry.trackId || undefined } : {}),
          // Joining the invitation's team: the API finds it by the invitation.
          ...(entry.type === "member" && !joiningInvited ? { teamCode: entry.teamCode.trim() } : {}),
        },
        accept,
        ...(refParam ? { ref: refParam } : {}),
        ...(inviteToken ? { inviteToken } : {}),
      };
      const res = await apiPost<RegistrationResult>(`/api/public/events/${encodeURIComponent(event.slug)}/register`, body);
      await enterEventWorkspace(event.id).catch(() => null);
      // The app, the confirmation page and the sign-in page carry on in the language the person registered in.
      persistLang(lang);
      setResult(res);
      onDone?.(res);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      if (err instanceof ApiError) {
        const code = err.code && REGISTER_CODES.has(err.code) ? err.code : undefined;
        const sentence: Msg = code ? { key: `rg.api.${code}` } : err.code === "VALIDATION_ERROR" ? { key: "rg.err.fix" } : err.fieldErrors.length ? err.summary : err.message;
        const map: Record<string, Msg> = {};
        for (const fe of err.fieldErrors) map[fe.field] = fe.message || err.summary;
        // The API's sentence for these is the field's problem; say it in the page's language.
        if (code && CODE_FIELDS[code]) map[CODE_FIELDS[code]] = sentence;
        if (code === "FILE_NOT_FOUND") {
          // An upload expired or went missing: ask for each file again.
          const files = event.form.filter((fl) => fl.type === "file" && answers[fl.key]);
          setAnswers((a) => { const n = { ...a }; for (const fl of files) delete n[fl.key]; return n; });
          for (const fl of files) map[`answers.${fl.key}`] = { key: "rg.err.file_again" };
        }
        showProblems(map, sentence, err.code);
      } else {
        showProblems({}, { key: "rg.err.generic" });
      }
    } finally {
      setBusy(false);
    }
  };

  const inviteLink = useMemo(() => {
    if (!result?.team?.join_code || typeof window === "undefined") return "";
    return teamInviteUrl(window.location.origin, event.slug, result.team.join_code);
  }, [result, event.slug]);

  // Back to this form after signing in, with the team code and the invitation's link.
  const back = new URLSearchParams();
  if (entry.teamCode) back.set("team", entry.teamCode);
  if (inviteToken) back.set("inviteToken", inviteToken);
  const signInHref = `/login?next=${encodeURIComponent(`/e/${event.slug}/register${back.size ? `?${back.toString()}` : ""}`)}`;
  const calendarOn = Boolean((event as PublicEvent & { features?: { calendar?: boolean } }).features?.calendar);

  // ── Done ────────────────────────────────────────────────────────────────
  if (result) {
    const approved = result.status === "approved";
    const Icon = approved ? PartyPopper : result.status === "waitlisted" ? Hourglass : Clock;
    const tone = approved ? { fg: "var(--ok)", bg: "var(--ok-weak)" } : { fg: "var(--warn)", bg: "var(--warn-weak)" };
    const tz = event.timezone || "Asia/Baku";
    const day = (iso: string | null) => formatInZone(iso, tz, lang, { hour: undefined, minute: undefined });
    const where = event.format === "online" ? t("ep.online") : [event.venue_name, event.city].filter(Boolean).join(", ") || null;
    const steps: { key: string; icon: React.ReactNode; title: string; body?: React.ReactNode }[] = [];
    if (result.verificationRequired) steps.push({ key: "confirm", icon: <MailCheck size={17} aria-hidden="true" />, title: t("rg.next.confirm"), body: t("ve.check_inbox") });
    if (result.team) {
      steps.push({
        key: "team",
        icon: <Users size={17} aria-hidden="true" />,
        title: result.team.join_code ? t("rg.next.invite") : f("rg.done.team", { team: result.team.name }),
        body: result.team.join_code ? (
          <>
            <span className="block">{f("rg.done.team", { team: result.team.name })}</span>
            <span className="mt-3 flex flex-col items-start gap-3 rounded-[14px] border p-4 sm:flex-row sm:items-center" style={{ borderColor: "var(--line)", background: "var(--surface-sunken)" }}>
              <span className="min-w-0 flex-1">
                <span className="block whitespace-nowrap text-[11.5px] font-semibold uppercase tracking-[0.12em]" style={muted}>{t("rg.team_code")}</span>
                <span className="mt-0.5 block font-mono text-[24px] font-semibold tracking-[0.18em]" style={ink}>{result.team.join_code}</span>
              </span>
              <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(inviteLink); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* the link is shown below to copy by hand */ } }}
                className={`${secondaryButton} min-h-11 shrink-0 px-4 text-[14px]`} style={{ ...secondaryStyle, color: copied ? "var(--ok)" : "var(--ink)" }}>
                {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />} {copied ? t("rg.done.copied") : t("rg.done.copy_invite")}
              </button>
            </span>
            <span className="mt-2 block text-[12.5px]" style={muted}>{t("rg.done.code_help")}</span>
            <span className="mt-1 block select-all break-all font-mono text-[11.5px]" style={muted}>{inviteLink}</span>
          </>
        ) : undefined,
      });
    }
    if (result.teamSkipped) steps.push({ key: "later", icon: <UserPlus size={17} aria-hidden="true" />, title: t("rg.next.team_later"), body: t("rg.done.team_skipped") });
    if (approved) steps.push({ key: "dash", icon: <LayoutDashboard size={17} aria-hidden="true" />, title: t("rg.next.dashboard"), body: t("rg.next.dashboard_body") });
    else if (result.status === "waitlisted") steps.push({ key: "wait", icon: <Hourglass size={17} aria-hidden="true" />, title: t("rg.next.waitlist"), body: t("rg.next.waitlist_body") });
    else steps.push({ key: "review", icon: <Clock size={17} aria-hidden="true" />, title: t("rg.next.review"), body: t("rg.next.review_body") });
    if (calendarOn) {
      steps.push({
        key: "cal",
        icon: <CalendarPlus size={17} aria-hidden="true" />,
        title: t("rg.next.calendar"),
        body: (
          <>
            <span className="block">{day(event.start_date)} – {day(event.end_date)}</span>
            <span className="mt-3 block">
              <AddToCalendar tone="surface" name={event.name} slug={event.slug} start={event.start_date} end={event.end_date}
                details={[event.tagline, `${window.location.origin}/e/${event.slug}`].filter(Boolean).join("\n\n") || null} location={where} t={t} />
            </span>
          </>
        ),
      });
    }

    return (
      <RegisterLayout aside={summary?.("p")}>
        <div className={`${panelClass} hs-rise overflow-hidden`} style={panelStyle}>
          <div className="px-5 pb-7 pt-9 text-center sm:px-10" style={{ background: `radial-gradient(420px 180px at 50% 0%, ${tone.bg}, transparent)` }}>
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full" style={{ background: tone.bg, color: tone.fg, boxShadow: `0 0 0 8px color-mix(in srgb, ${tone.fg} 7%, transparent)` }}>
              <Icon size={28} aria-hidden="true" />
            </span>
            <h1 className="mt-5 text-[26px] font-semibold leading-tight tracking-tight sm:text-[30px]" style={{ ...ink, fontFamily: "var(--font-display)", textWrap: "balance" }}>{t(`rg.done.${result.status}`)}</h1>
            <p className="mx-auto mt-2.5 max-w-md text-[15px] leading-relaxed" style={soft}>{f(`rg.done.${result.status}_body`, { event: event.name })}</p>
          </div>

          <div className="border-t px-5 py-6 sm:px-8" style={{ borderColor: "var(--line)" }}>
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em]" style={muted}>{t("rg.next.title")}</h2>
            <ol className="mt-4 space-y-5">
              {steps.map((s) => (
                <li key={s.key} className="flex gap-3.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]" style={{ background: "var(--tint)", color: "var(--accent)" }}>{s.icon}</span>
                  <div className="min-w-0 flex-1 pt-1">
                    <p className="text-[15px] font-semibold leading-snug" style={ink}>{s.title}</p>
                    {s.body ? <div className="mt-1 text-[13.5px] leading-relaxed" style={soft}>{s.body}</div> : null}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-col gap-3 border-t px-5 py-5 sm:flex-row sm:px-8" style={{ borderColor: "var(--line)" }}>
            {/* Signed in already: the dashboard (or, while in review, where the registration stands). */}
            <a href="/hacker" className={`${primaryButton} sm:flex-1`} style={{ background: "var(--accent-solid)", color: "#fff" }}>{t(approved ? "rg.done.dashboard" : "rg.done.status")}</a>
            <Link href={`/e/${event.slug}`} className={secondaryButton} style={secondaryStyle}>{t("rg.back_to_event")}</Link>
          </div>
          {/* A confirmation link is promised only to those who still need one (the step above says so). */}
          {result.verificationRequired ? null : <p className="px-5 pb-5 text-center text-[12.5px]" style={muted}>{t("rg.done.email_copy")}</p>}
        </div>
      </RegisterLayout>
    );
  }

  // ── Nobody can take part any more ───────────────────────────────────────
  if (entryOpts.blocked && !inviteToken) {
    const closedOn = entryOpts.closed?.closesAt ? formatInZone(entryOpts.closed.closesAt, event.timezone || "Asia/Baku", lang, { hour: undefined, minute: undefined }) : null;
    return (
      <RegisterLayout aside={summary?.("h1")}>
        <div role="status" className={`${panelClass} px-5 py-8 text-center sm:px-10`} style={panelStyle}>
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "var(--warn-weak)", color: "var(--warn)" }}><Users size={24} aria-hidden="true" /></span>
          <h2 className="mt-5 text-[22px] font-semibold leading-tight" style={{ ...ink, fontFamily: "var(--font-display)", textWrap: "balance" }}>{t("rg.teams_closed.title")}</h2>
          <p className="mx-auto mt-2.5 max-w-md text-[15px] leading-relaxed" style={soft}>
            {entryOpts.blocked === "teams_only"
              ? (closedOn ? f("rg.teams_closed.teams_only_on", { date: closedOn }) : t("rg.teams_closed.teams_only"))
              : f(closedOn ? "rg.teams_closed.solo_blocked_on" : "rg.teams_closed.solo_blocked", { min: entryOpts.closed?.minTeamSize ?? event.min_team_size, date: closedOn ?? "" })}
          </p>
          <p className="mx-auto mt-2 max-w-md text-[13.5px]" style={muted}>{t("rg.teams_closed.contact")}</p>
          <div className="mx-auto mt-7 flex max-w-sm flex-col gap-3">
            <Link href={`/e/${event.slug}`} className={secondaryButton} style={secondaryStyle}>{t("rg.back_to_event")}</Link>
          </div>
        </div>
      </RegisterLayout>
    );
  }

  // ── Form ────────────────────────────────────────────────────────────────
  type EntryCard = { type: EntryType; icon: React.ReactNode; title: string; hint: string };
  const entryCards = ([
    { type: "solo", icon: <User size={19} aria-hidden="true" />, title: t(event.registration_mode === "both" ? "rg.entry.solo_both" : "rg.entry.solo"), hint: t(event.registration_mode === "both" ? "rg.entry.solo_both_hint" : "rg.entry.solo_hint") },
    { type: "lead", icon: <UserPlus size={19} aria-hidden="true" />, title: t("rg.entry.lead"), hint: f("rg.entry.lead_hint", { min: event.min_team_size, max: event.team_size_limit }) },
    { type: "member", icon: <Users size={19} aria-hidden="true" />, title: t("rg.entry.member"), hint: t("rg.entry.member_hint") },
  ] as EntryCard[]).filter((c) => allowed.includes(c.type));
  const pickEntry = (type: EntryType) => { setEntry((e) => ({ ...e, type })); clear("entry.type"); };
  const onEntryKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = entryCards.findIndex((c) => c.type === entry.type);
    const next = entryCards[(i + step + entryCards.length) % entryCards.length];
    pickEntry(next.type);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-entry="${next.type}"]`)?.focus();
  };

  const renderField = (fl: PublicField) => {
    const id = `rf-${fl.key}`;
    const err = errOf(`answers.${fl.key}`);
    const errId = err ? `${id}-err` : undefined;
    const helpId = fl.help && fl.type !== "checkbox" ? `${id}-help` : undefined;
    const describedBy = [helpId, errId].filter(Boolean).join(" ") || undefined;
    const v = answers[fl.key];
    const blur = () => check(`answers.${fl.key}`, isEmpty(fl.type, answers[fl.key]));
    const common = { id, "aria-invalid": err ? true : undefined, "aria-describedby": describedBy, "aria-required": fl.required || undefined, onBlur: blur } as const;
    const chip = (on: boolean) => ({
      borderColor: on ? "var(--accent-solid)" : "var(--line-strong)",
      background: on ? "var(--accent-weak)" : "var(--surface)",
      color: "var(--ink)",
      fontWeight: on ? 600 : 400,
    });
    let control: React.ReactNode;
    switch (fl.type) {
      case "textarea":
        control = <textarea {...common} rows={4} maxLength={5000} value={(v as string) || ""} onChange={(e) => set(fl.key, e.target.value)} className={`${fieldClass} min-h-[120px] resize-y`} style={fieldStyle(err)} />;
        break;
      case "number":
        control = <input {...common} inputMode="numeric" value={v == null ? "" : String(v)} onChange={(e) => { const d = e.target.value.replace(/\D/g, "").slice(0, 9); set(fl.key, d === "" ? "" : Number(d)); }} className={fieldClass} style={{ ...fieldStyle(err), maxWidth: 200 }} />;
        break;
      case "phone":
        control = <input {...common} type="tel" autoComplete="tel" maxLength={24} placeholder="+994 50 123 45 67" value={(v as string) || ""} onChange={(e) => set(fl.key, e.target.value)} className={fieldClass} style={fieldStyle(err)} />;
        break;
      case "email":
        control = <input {...common} type="email" autoComplete="email" maxLength={255} value={(v as string) || ""} onChange={(e) => set(fl.key, e.target.value)} className={fieldClass} style={fieldStyle(err)} />;
        break;
      case "url":
        control = <input {...common} inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={500} placeholder={fl.key === "github" ? t("rg.ph.github") : fl.key === "linkedin" ? t("rg.ph.linkedin") : "https://"} value={(v as string) || ""} onChange={(e) => set(fl.key, e.target.value)} className={fieldClass} style={fieldStyle(err)} />;
        break;
      case "date":
        control = <input {...common} type="date" value={(v as string) || ""} onChange={(e) => set(fl.key, e.target.value)} className={fieldClass} style={{ ...fieldStyle(err), maxWidth: 240 }} />;
        break;
      case "select":
        control = (
          <select {...common} value={(v as string) || ""} onChange={(e) => set(fl.key, e.target.value)} className={`${fieldClass} cursor-pointer`} style={fieldStyle(err)}>
            <option value="">{t("rg.choose")}</option>
            {fl.options.map((o) => <option key={o} value={o}>{optionLabel(fl, o)}</option>)}
          </select>
        );
        break;
      case "country":
        control = (
          <select {...common} autoComplete="country" value={(v as string) || ""} onChange={(e) => set(fl.key, e.target.value)} className={`${fieldClass} cursor-pointer`} style={fieldStyle(err)}>
            <option value="">{t("rg.choose")}</option>
            {countryOptions(lang).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );
        break;
      case "multiselect": {
        const list = Array.isArray(v) ? (v as string[]) : [];
        control = (
          <div id={id} tabIndex={-1} className="flex flex-wrap gap-2 outline-none" role="group" aria-labelledby={`${id}-l`} aria-describedby={describedBy}>
            {fl.options.map((o) => {
              const on = list.includes(o);
              return (
                <button key={o} type="button" aria-pressed={on} onClick={() => set(fl.key, on ? list.filter((x) => x !== o) : [...list, o])}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-[14px] transition-colors" style={chip(on)}>
                  {on ? <Check size={14} strokeWidth={2.75} aria-hidden="true" style={{ color: "var(--accent)" }} /> : null}{o}
                </button>
              );
            })}
          </div>
        );
        break;
      }
      case "checkbox":
        control = (
          <TickRow id={id} checked={v === true} onChange={(x) => set(fl.key, x)} invalid={Boolean(err)} describedBy={errId} required={fl.required}>
            <span className="font-medium">{fieldLabel(fl)}{fl.required ? <Req /> : null}</span>
            {fl.help ? <span className="mt-0.5 block text-[13.5px]" style={soft}>{fl.help}</span> : null}
          </TickRow>
        );
        break;
      case "university":
        control = <UniversityInput id={id} value={(v as string) || ""} onChange={(x) => set(fl.key, x)} placeholder={t("rg.ph.university")} invalid={Boolean(err)} describedBy={describedBy} />;
        break;
      case "skills": {
        const list = Array.isArray(v) ? (v as string[]) : [];
        // The common ones first; the rest one tap away, and anything picked always stays in view.
        const shownSkills = allSkills ? SKILLS : SKILLS.filter((s, i) => i < SKILLS_FIRST || list.includes(s));
        control = (
          <div id={id} tabIndex={-1} className="flex flex-wrap gap-2 outline-none" role="group" aria-labelledby={`${id}-l`} aria-describedby={describedBy}>
            {shownSkills.map((s) => {
              const on = list.includes(s);
              return (
                <button key={s} type="button" aria-pressed={on} onClick={() => set(fl.key, on ? list.filter((x) => x !== s) : [...list, s].slice(0, 30))}
                  className="inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-[13.5px] transition-colors" style={chip(on)}>
                  {on ? <Check size={13} strokeWidth={2.75} aria-hidden="true" style={{ color: "var(--accent)" }} /> : null}{s}
                </button>
              );
            })}
            {SKILLS.length > SKILLS_FIRST ? (
              <button type="button" onClick={() => setAllSkills((x) => !x)} aria-expanded={allSkills}
                className="inline-flex min-h-9 items-center rounded-full px-3 text-[13.5px] font-semibold hover:bg-[var(--tint)]" style={{ color: "var(--accent)" }}>
                {allSkills ? t("rg.skills_fewer") : f("rg.skills_more", { n: SKILLS.length - SKILLS_FIRST })}
              </button>
            ) : null}
          </div>
        );
        break;
      }
      case "file": {
        const fv = v as FileValue | undefined;
        control = fv ? (
          <div className="flex min-h-14 items-center gap-3 rounded-[14px] border px-3 py-2.5" style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px]" style={{ background: "var(--ok-weak)", color: "var(--ok)" }}><FileText size={18} aria-hidden="true" /></span>
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium" style={ink}>{fv.name}</span>
            <button type="button" onClick={() => set(fl.key, undefined)} aria-label={t("rg.file.remove")} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] hover:bg-[var(--danger-weak)]" style={{ color: "var(--danger)" }}><Trash2 size={16} aria-hidden="true" /></button>
          </div>
        ) : (
          <label className="flex min-h-[72px] cursor-pointer items-center gap-3.5 rounded-[14px] border border-dashed px-4 py-3 transition-colors hover:bg-[var(--tint)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--accent)]"
            style={{ borderColor: err ? "var(--danger)" : "var(--line-strong)", background: "var(--surface)" }}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px]" style={{ background: "var(--tint)", color: "var(--ink-2)" }}>
              {uploading[fl.key] ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <FileUp size={18} aria-hidden="true" />}
            </span>
            <span className="min-w-0">
              <span className="block text-[14.5px] font-semibold" style={ink}>{uploading[fl.key] ? t("rg.file.uploading") : t("rg.file.choose")}</span>
              <span className="mt-0.5 block text-[12.5px]" style={muted}>{t("rg.file.rules")}</span>
            </span>
            <input id={id} type="file" accept={FILE_ACCEPT} className="sr-only" aria-describedby={describedBy} disabled={uploading[fl.key]} onChange={(e) => { void upload(fl, e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        );
        break;
      }
      default:
        control = <input {...common} maxLength={500} autoComplete={fl.key === "city" ? "address-level2" : fl.key === "company" ? "organization" : undefined} value={(v as string) || ""} onChange={(e) => set(fl.key, e.target.value)} className={fieldClass} style={fieldStyle(err)} />;
    }
    const grouped = fl.type === "multiselect" || fl.type === "skills";
    return (
      <div key={fl.key} className="min-w-0">
        {fl.type === "checkbox" ? null : grouped
          ? <p id={`${id}-l`} className="mb-2 text-[14px] font-medium leading-snug" style={ink}>{fieldLabel(fl)}{fl.required ? <Req /> : null}</p>
          : <Label htmlFor={id} required={fl.required}>{fieldLabel(fl)}</Label>}
        {helpId ? <p id={helpId} className="-mt-1 mb-2 text-[12.5px] leading-snug" style={muted}>{fl.help}</p> : null}
        {control}
        <Err id={errId}>{err}</Err>
      </div>
    );
  };

  /** Short answers two to a row on wider screens, in the organiser's order; long ones on their own. */
  const renderFields = (list: PublicField[]) => {
    const wide = (fl: PublicField) => WIDE_TYPES.has(fl.type) || (fl.kind !== "standard" && fl.type === "text") || fieldLabel(fl).length > 28 || Boolean(fl.help && fl.help.length > 40);
    const rows: PublicField[][] = [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const b = list[i + 1];
      if (b && !wide(a) && !wide(b)) { rows.push([a, b]); i++; } else rows.push([a]);
    }
    return (
      <div className="grid gap-5">
        {rows.map((r) => (r.length === 2
          ? <div key={r[0].key} className="grid gap-5 sm:grid-cols-2">{r.map(renderField)}</div>
          : renderField(r[0])))}
      </div>
    );
  };

  const steps = [
    allowed.length > 1 ? { id: "rg-entry", title: t("rg.entry.title") } : null,
    { id: "rg-account", title: t("rg.account") },
    profileFields.length ? { id: "rg-about", title: t("rg.about_you") } : null,
    customFields.length ? { id: "rg-questions", title: t("rg.section.questions") } : null,
    elig.requireRules || elig.requireCoc ? { id: "rg-consent", title: t("rg.section.consent") } : null,
  ].filter((s): s is { id: string; title: string } => s !== null);
  const numberOf = (id: string) => steps.findIndex((s) => s.id === id) + 1;

  // An invited person's place is confirmed at once, full or not, whatever the approval mode.
  const note = invitation ? t("rg.submit_note_auto") : event.registration.full ? t("rg.submit_waitlist_note") : t(event.registration.approval === "auto" ? "rg.submit_note_auto" : "rg.submit_note");
  const blocked = busy || Object.values(uploading).some(Boolean);
  const jump = Object.keys(errors).filter((k) => shown.has(k) && targetOf(k)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const jumpLabel = (k: string) => {
    if (k.startsWith("answers.")) {
      const fl = event.form.find((x) => `answers.${x.key}` === k);
      return fl ? fieldLabel(fl) : k;
    }
    const names: Record<string, string> = {
      "account.fullName": t("rg.full_name"), "account.email": t("rg.email"), "account.password": t("rg.password"),
      "entry.type": t("rg.entry.title"), "entry.teamName": t("rg.team_name"), "entry.teamCode": t("rg.team_code"), "entry.trackId": t("rg.track"),
      "accept.rules": t("rg.accept_rules"), "accept.coc": t("rg.accept_coc"),
    };
    return (names[k] || k).replace(/[.:]$/, "");
  };
  const goTo = (e: React.MouseEvent<HTMLAnchorElement>, key: string) => {
    e.preventDefault();
    const el = document.getElementById(targetOf(key));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // A step (how you take part) is not a control itself: focus its chosen option.
    const target = el.matches("input, select, textarea, button, [tabindex]") ? el : el.querySelector<HTMLElement>("[tabindex='0'], input, select, button");
    target?.focus({ preventScroll: true });
  };

  const aside = (
    <>
      {summary?.("h1")}
      <nav aria-label={t("rg.steps")} className={`${panelClass} hidden p-5 lg:block`} style={panelStyle}>
        <p className="text-[12px] font-semibold uppercase tracking-[0.12em]" style={muted}>{t("rg.steps")}</p>
        <ol className="mt-3 space-y-0.5">
          {steps.map((s, i) => {
            const done = stepDone(s.id);
            return (
              <li key={s.id}>
                <a href={`#${s.id}`} className="flex min-h-10 items-center gap-3 rounded-[10px] px-2 text-[14px] font-medium transition-colors hover:bg-[var(--tint)]" style={ink}>
                  <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums"
                    style={done ? { background: "var(--ok-weak)", color: "var(--ok)" } : { background: "var(--tint)", color: "var(--ink-2)" }}>
                    {done ? <Check size={13} strokeWidth={2.75} /> : i + 1}
                  </span>
                  {s.title}
                </a>
              </li>
            );
          })}
        </ol>
        {required.length ? <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--line)" }}><Progress done={doneCount} total={required.length} label={progressLabel} /></div> : null}
      </nav>
    </>
  );

  return (
    <RegisterLayout aside={aside}>
      {banner}
      {event.registration.full ? (
        <p className="mb-5 flex items-start gap-3 rounded-[16px] px-4 py-3.5 text-[14px] leading-relaxed" style={{ background: "var(--warn-weak)", color: "var(--ink)" }}>
          <Hourglass size={17} className="mt-0.5 shrink-0" aria-hidden="true" style={{ color: "var(--warn)" }} />{t("rg.waitlist_note")}
        </p>
      ) : null}

      {entryOpts.closed ? (
        <p role="status" className="mb-5 flex items-start gap-3 rounded-[16px] px-4 py-3.5 text-[14px] leading-relaxed" style={{ background: "var(--tint)", color: "var(--ink)" }}>
          <Users size={17} className="mt-0.5 shrink-0" aria-hidden="true" style={{ color: "var(--ink-2)" }} />
          <span>{entryOpts.closed.reason === "disabled"
            ? t("rg.teams_closed.by_organisers")
            : entryOpts.closed.closesAt
              ? f("rg.teams_closed.notice_on", { date: formatInZone(entryOpts.closed.closesAt, event.timezone || "Asia/Baku", lang, {}) })
              : t("rg.teams_closed.notice")}</span>
        </p>
      ) : null}

      <div ref={topRef} className="scroll-mt-6" />
      {topError && !(typeof topError.message === "object" && topError.message.key === "rg.err.fix" && Object.keys(errors).length === 0) ? (
        <div role="alert" className="mb-5 flex gap-3 rounded-[16px] border p-4 text-[14px] leading-relaxed"
          style={{ borderColor: "color-mix(in srgb, var(--danger) 30%, transparent)", background: "var(--danger-weak)", color: "var(--ink)" }}>
          <AlertTriangle size={18} className="mt-0.5 shrink-0 self-start" aria-hidden="true" style={{ color: "var(--danger)" }} />
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {msg(topError.message)}
              {topError.code === "EMAIL_TAKEN" ? <> <Link className="font-semibold underline" href={signInHref}>{t("rg.sign_in")}</Link></> : null}
              {topError.code === "ALREADY_REGISTERED" ? <> <a className="font-semibold underline" href="/hacker">{t("rg.done.dashboard")}</a></> : null}
            </p>
            {jump.length ? (
              <>
                <p className="mt-2 text-[13px]" style={soft}>{t("rg.err.list")}</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {jump.slice(0, JUMP_MAX).map((k) => (
                    <li key={k} className="min-w-0 max-w-full">
                      <a href={`#${targetOf(k)}`} onClick={(e) => goTo(e, k)} className="inline-flex min-h-8 max-w-full items-center rounded-full border px-3 text-[13px] font-medium transition-colors hover:bg-[var(--tint)]"
                        style={{ borderColor: "color-mix(in srgb, var(--danger) 35%, transparent)", background: "var(--surface)", color: "var(--ink)" }}>
                        <span className="truncate">{jumpLabel(k)}</span>
                      </a>
                    </li>
                  ))}
                  {jump.length > JUMP_MAX ? <li className="inline-flex min-h-8 items-center px-1.5 text-[13px] font-medium" style={soft}>+{jump.length - JUMP_MAX}</li> : null}
                </ul>
              </>
            ) : null}
            {topError.extra.length ? <ul className="mt-2 list-disc pl-5">{topError.extra.map((x, i) => <li key={i}>{msg(x)}</li>)}</ul> : null}
          </div>
        </div>
      ) : null}

      {/* On phones a focused control scrolls clear of the bar along the bottom edge. */}
      <form onSubmit={submit} noValidate className="space-y-5 pb-32 sm:pb-0 [&_:is(input,select,textarea,button)]:scroll-mb-40 sm:[&_:is(input,select,textarea,button)]:scroll-mb-0">
        <p className="text-[13px]" style={muted}>{t("rg.required_note")}</p>

        {allowed.length > 1 ? (
          <Step id="rg-entry" n={numberOf("rg-entry")} title={t("rg.entry.title")} done={stepDone("rg-entry")}>
            <div id="rg-entry-group" role="radiogroup" aria-labelledby="rg-entry-h" onKeyDown={onEntryKey}
              className={`grid gap-3 ${entryCards.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
              {entryCards.map((c) => {
                const on = entry.type === c.type;
                return (
                  <button key={c.type} data-entry={c.type} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} onClick={() => pickEntry(c.type)}
                    className="relative flex min-h-[76px] items-start gap-3.5 rounded-[16px] border p-4 pr-11 text-left transition-[border-color,background-color,box-shadow] sm:flex-col sm:gap-3 sm:pr-4"
                    style={{
                      borderColor: on ? "var(--accent-solid)" : "var(--line-strong)",
                      background: on ? "color-mix(in srgb, var(--accent-solid) 6%, var(--surface))" : "var(--surface)",
                      boxShadow: on ? "0 0 0 1px var(--accent-solid) inset" : "none",
                    }}>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] transition-colors"
                      style={on ? { background: "var(--accent-solid)", color: "#fff" } : { background: "var(--tint)", color: "var(--ink-2)" }}>{c.icon}</span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold leading-snug" style={ink}>{c.title}</span>
                      <span className="mt-1 block text-[13px] leading-snug" style={soft}>{c.hint}</span>
                    </span>
                    <span aria-hidden="true" className="absolute right-4 top-4 flex h-5 w-5 items-center justify-center rounded-full border-2"
                      style={{ borderColor: on ? "var(--accent-solid)" : "var(--line-strong)", background: "var(--surface)" }}>
                      {on ? <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--accent-solid)" }} /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
            {entry.type === "lead" && invitedTeam && !invitedTeam.exists ? (
              <p className="mt-4 rounded-[14px] px-4 py-3 text-[13.5px] leading-relaxed" style={{ background: "var(--info-weak)", color: "var(--ink)" }}>
                {f("rg.inv.team_create", { team: invitedTeam.name })}
              </p>
            ) : null}
            {entry.type === "lead" ? (
              <div className="mt-4 grid gap-4 rounded-[16px] border p-4 sm:grid-cols-2 sm:p-5" style={{ borderColor: "var(--line)", background: "var(--surface-sunken)" }}>
                <div className={event.tracks.length ? "" : "sm:col-span-2"}>
                  <Label htmlFor="rg-team" required>{t("rg.team_name")}</Label>
                  <input id="rg-team" value={entry.teamName} maxLength={80} onChange={(e) => { setEntry((x) => ({ ...x, teamName: e.target.value })); clear("entry.teamName"); }}
                    onBlur={() => check("entry.teamName", !entry.teamName.trim())}
                    className={fieldClass} style={fieldStyle(errOf("entry.teamName"))} aria-invalid={Boolean(errOf("entry.teamName")) || undefined} aria-describedby={errOf("entry.teamName") ? "rg-team-err" : undefined} />
                  <Err id="rg-team-err">{errOf("entry.teamName")}</Err>
                </div>
                {event.tracks.length ? (
                  <div>
                    <Label htmlFor="rg-track">{t("rg.track")}</Label>
                    <select id="rg-track" value={entry.trackId} onChange={(e) => { setEntry((x) => ({ ...x, trackId: e.target.value })); clear("entry.trackId"); }} className={`${fieldClass} cursor-pointer`} style={fieldStyle(errOf("entry.trackId"))}>
                      <option value="">{t("rg.track_later")}</option>
                      {event.tracks.map((tr) => <option key={tr.id} value={String(tr.id)}>{tr.name}</option>)}
                    </select>
                    <Err>{errOf("entry.trackId")}</Err>
                  </div>
                ) : null}
              </div>
            ) : null}
            {entry.type === "member" && joiningInvited && invitedTeam ? (
              <div className="mt-4 rounded-[16px] border p-4 sm:p-5" style={{ borderColor: "var(--line)", background: "var(--surface-sunken)" }}>
                <p className="flex items-start gap-2 text-[14px] leading-relaxed" style={ink}>
                  <Check size={16} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: "var(--ok)" }} />
                  <span>{f("rg.inv.team_join", { team: invitedTeam.name })}</span>
                </p>
                <button type="button" onClick={() => setUseCode(true)} className="mt-2 inline-flex min-h-10 items-center text-[13px] font-semibold underline underline-offset-2" style={{ color: "var(--accent)" }}>
                  {t("rg.inv.use_code")}
                </button>
              </div>
            ) : entry.type === "member" ? (
              <div className="mt-4 rounded-[16px] border p-4 sm:p-5" style={{ borderColor: "var(--line)", background: "var(--surface-sunken)" }}>
                <Label htmlFor="rg-code" required>{t("rg.team_code")}</Label>
                <input id="rg-code" value={entry.teamCode} maxLength={20} autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(e) => { setEntry((x) => ({ ...x, teamCode: e.target.value.replace(/\s/g, "") })); clear("entry.teamCode"); }}
                  onBlur={() => check("entry.teamCode", !entry.teamCode.trim())}
                  placeholder="a1b2c3d4" className={`${fieldClass} font-mono tracking-[0.12em]`} style={{ ...fieldStyle(errOf("entry.teamCode")), maxWidth: 280 }} aria-invalid={Boolean(errOf("entry.teamCode")) || undefined} aria-describedby={errOf("entry.teamCode") ? "rg-code-err" : "rg-code-help"} />
                <p id="rg-code-help" className="mt-2 text-[12.5px] leading-snug" style={muted}>{t("rg.team_code_help")}</p>
                <Err id="rg-code-err">{errOf("entry.teamCode")}</Err>
              </div>
            ) : null}
            <Err>{errOf("entry.type")}</Err>
          </Step>
        ) : null}

        <Step id="rg-account" n={numberOf("rg-account")} title={t("rg.account")} done={signedIn ? true : stepDone("rg-account")}
          hint={signedIn ? null : <>{t("rg.account_help")}{" "}<Link href={signInHref} className="font-semibold underline underline-offset-2" style={{ color: "var(--accent)" }}>{t("rg.sign_in")}</Link></>}>
          {signedIn ? (
            <div className="flex items-center gap-3.5 rounded-[14px] p-3.5" style={{ background: "var(--tint)" }}>
              <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[16px] font-semibold uppercase" style={{ background: "var(--accent-weak)", color: "var(--accent)" }}>
                {(signedIn.name || signedIn.email).trim().charAt(0)}
              </span>
              <div className="min-w-0">
                {signedIn.name ? <p className="truncate text-[15px] font-semibold" style={ink}>{signedIn.name}</p> : null}
                <p className="text-[13.5px] leading-snug" style={soft}>{f("rg.signed_in_as", { email: signedIn.email })}</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-5">
              <div>
                <Label htmlFor="rg-name" required>{t("rg.full_name")}</Label>
                <input id="rg-name" autoComplete="name" maxLength={200} value={account.fullName} onChange={(e) => { setAccount((a) => ({ ...a, fullName: e.target.value })); clear("account.fullName"); }}
                  onBlur={() => check("account.fullName", !account.fullName.trim())}
                  className={fieldClass} style={fieldStyle(errOf("account.fullName"))} aria-invalid={Boolean(errOf("account.fullName")) || undefined} aria-describedby={errOf("account.fullName") ? "rg-name-err" : undefined} />
                <Err id="rg-name-err">{errOf("account.fullName")}</Err>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="min-w-0">
                  <Label htmlFor="rg-email" required>{t("rg.email")}</Label>
                  <input id="rg-email" type="email" inputMode="email" autoComplete="email" autoCapitalize="off" spellCheck={false} maxLength={255} value={account.email} onChange={(e) => { setAccount((a) => ({ ...a, email: e.target.value })); clear("account.email"); }}
                    onBlur={() => check("account.email", !account.email.trim())}
                    // The invitation's link works for its address only: filled in, and not to be changed.
                    readOnly={Boolean(invitation)}
                    className={fieldClass} style={{ ...fieldStyle(errOf("account.email")), ...(invitation ? { background: "var(--tint)", color: "var(--ink-2)" } : {}) }}
                    aria-invalid={Boolean(errOf("account.email")) || undefined} aria-describedby={errOf("account.email") ? "rg-email-err" : invitation ? "rg-email-inv" : undefined} />
                  {invitation ? (
                    <p id="rg-email-inv" className="mt-2 flex items-center gap-1.5 text-[12.5px] leading-snug" style={muted}>
                      <Lock size={13} aria-hidden="true" className="shrink-0" />{t("rg.inv.email_locked")}
                    </p>
                  ) : null}
                  <Err id="rg-email-err">{errOf("account.email")}</Err>
                </div>
                <div className="min-w-0">
                  <Label htmlFor="rg-pw" required>{t("rg.password")}</Label>
                  <div className="relative">
                    <input id="rg-pw" type={showPw ? "text" : "password"} autoComplete="new-password" maxLength={128} value={account.password} onChange={(e) => { setAccount((a) => ({ ...a, password: e.target.value })); clear("account.password"); }}
                      onBlur={() => check("account.password", !account.password)}
                      className={`${fieldClass} pr-12`} style={fieldStyle(errOf("account.password"))} aria-invalid={Boolean(errOf("account.password")) || undefined} aria-describedby={errOf("account.password") ? "rg-pw-err" : "rg-pw-rule"} />
                    <button type="button" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? t("rg.hide_pw") : t("rg.show_pw")} aria-pressed={showPw}
                      className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-[10px] hover:bg-[var(--tint)]" style={muted}>
                      {showPw ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                    </button>
                  </div>
                  <p id="rg-pw-rule" className="mt-2 text-[12.5px] leading-snug" style={muted}>{t("rg.password_rule")}</p>
                  <Err id="rg-pw-err">{errOf("account.password")}</Err>
                </div>
              </div>
            </div>
          )}
        </Step>

        {profileFields.length ? (
          <Step id="rg-about" n={numberOf("rg-about")} title={t("rg.about_you")} done={stepDone("rg-about")}>
            {renderFields(profileFields)}
          </Step>
        ) : null}

        {customFields.length ? (
          <Step id="rg-questions" n={numberOf("rg-questions")} title={t("rg.section.questions")} hint={f("rg.section.questions_hint", { event: event.name })} done={stepDone("rg-questions")}>
            {renderFields(customFields)}
          </Step>
        ) : null}

        {elig.requireRules || elig.requireCoc ? (
          <Step id="rg-consent" n={numberOf("rg-consent")} title={t("rg.section.consent")} done={stepDone("rg-consent")}>
            <div className="grid gap-3">
              {elig.requireRules ? (
                <div>
                  <TickRow id="rg-acc-rules" checked={accept.rules} onChange={(x) => { setAccept((a) => ({ ...a, rules: x })); clear("accept.rules"); }} invalid={Boolean(errOf("accept.rules"))} describedBy={errOf("accept.rules") ? "rg-acc-rules-err" : undefined} required>
                    {t("rg.accept_rules")}<Req />
                  </TickRow>
                  {event.rules ? (
                    <a href={`/e/${event.slug}#rules`} target="_blank" rel="noreferrer" className="ml-1 mt-1.5 inline-flex min-h-8 items-center text-[13px] font-medium underline underline-offset-2" style={{ color: "var(--accent)" }}>{t("rg.read_rules")}</a>
                  ) : null}
                  <Err id="rg-acc-rules-err">{errOf("accept.rules")}</Err>
                </div>
              ) : null}
              {elig.requireCoc ? (
                <div>
                  <TickRow id="rg-acc-coc" checked={accept.coc} onChange={(x) => { setAccept((a) => ({ ...a, coc: x })); clear("accept.coc"); }} invalid={Boolean(errOf("accept.coc"))} describedBy={errOf("accept.coc") ? "rg-acc-coc-err" : undefined} required>
                    {t("rg.accept_coc")}<Req />
                  </TickRow>
                  <details className="group ml-1 mt-1.5">
                    <summary className="inline-flex min-h-8 cursor-pointer list-none items-center text-[13px] font-medium underline underline-offset-2" style={{ color: "var(--accent)" }}>{t("rg.read_coc")}</summary>
                    <p className="mt-2 max-w-[65ch] whitespace-pre-line rounded-[12px] p-3.5 text-[13px] leading-relaxed" style={{ ...soft, background: "var(--tint)" }}>{t("rg.coc_body")}</p>
                  </details>
                  <Err id="rg-acc-coc-err">{errOf("accept.coc")}</Err>
                </div>
              ) : null}
            </div>
          </Step>
        ) : null}

        <p className="px-1 text-[13px] leading-relaxed sm:hidden" style={muted}>{note}</p>

        {/* Phones: the send button stays in reach as a bar along the bottom edge (fixed: the page's
            body clips sideways overflow, which keeps position: sticky from working). */}
        <div className="fixed inset-x-0 bottom-0 z-30 border-t px-4 pt-3 sm:static sm:rounded-[20px] sm:border sm:p-5"
          style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--surface) 94%, transparent)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          {required.length ? <div className="mb-2.5 lg:hidden"><Progress done={doneCount} total={required.length} label={progressLabel} /></div> : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="hidden max-w-sm text-[13px] leading-snug sm:block" style={muted}>{note}</p>
            <button type="submit" disabled={blocked} className={`${primaryButton} w-full shrink-0 sm:w-auto sm:min-w-[200px]`} style={{ background: "var(--accent-solid)" }}>
              {busy ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : null}
              {event.registration.full ? t("ep.cta.waitlist") : t("rg.submit")}
            </button>
          </div>
        </div>
      </form>
    </RegisterLayout>
  );
}
