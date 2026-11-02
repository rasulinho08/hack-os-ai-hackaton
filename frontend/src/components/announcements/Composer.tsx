"use client";

/**
 * Writing an announcement: words (or a template), who it is for, where it
 * goes besides the app, how important it is, and when. The audience line
 * says how many people that reaches right now, and by which channel, before
 * anything is sent.
 *
 * Editing a scheduled announcement changes everything; a sent one only its
 * words (people who were e-mailed or messaged keep what they got).
 */

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Mail, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ds/primitives";
import { DateTimeInput, Segmented, Select, TextArea, TextInput, Toggle, Notice } from "@/components/builder/ui";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { ApiError, apiGet, apiPost, apiPut } from "@/lib/api";
import { fill } from "@/lib/i18n/fill";
import { zoneLabel as zoneLabelOf } from "@/lib/builder/datetime";
import {
  AUDIENCES, PRIORITIES, TEMPLATES, typeForPriority,
  type AdminAnnouncement, type Audience, type AudienceSize, type Priority,
} from "@/lib/announcementsAdmin";

export interface ComposerTrack { id: number; name: string }

type FieldName = "title" | "content" | "audience" | "trackId" | "scheduledAt" | "channels";
type Errors = Partial<Record<FieldName, string>>;

const MAX_TITLE = 255;
const MAX_CONTENT = 10_000;

export function Composer({
  eventId, timeZone, tracks, editing, onSaved, onCancelEdit,
}: {
  eventId: number;
  timeZone: string;
  tracks: ComposerTrack[];
  editing: AdminAnnouncement | null;
  onSaved: () => void;
  onCancelEdit: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [audience, setAudience] = useState<Audience>("everyone");
  const [trackId, setTrackId] = useState<string>("");
  const [telegram, setTelegram] = useState(true);
  const [email, setEmail] = useState(false);
  const [priority, setPriority] = useState<Priority>("normal");
  const [when, setWhen] = useState<"now" | "later">("now");
  const [at, setAt] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [size, setSize] = useState<AudienceSize | null>(null);
  const [shownFor, setShownFor] = useState<AdminAnnouncement | null>(null);

  // Load the announcement being edited into the form (during render, not in an effect).
  if (editing !== shownFor) {
    setShownFor(editing);
    setErrors({});
    setFormError(null);
    if (editing) {
      setTitle(editing.title);
      setContent(editing.content);
      setAudience(editing.audience);
      setTrackId(editing.trackId ? String(editing.trackId) : "");
      setTelegram(editing.channels.includes("telegram"));
      setEmail(editing.channels.includes("email"));
      setPriority(editing.priority);
      setWhen(editing.status === "scheduled" ? "later" : "now");
      setAt(editing.scheduledAt);
    }
  }

  const sentEdit = editing?.status === "sent";

  // How many people the audience reaches now.
  useEffect(() => {
    if (sentEdit) return undefined;
    if (audience === "track" && !trackId) {
      setSize(null);
      return undefined;
    }
    let live = true;
    const q = new URLSearchParams({ eventId: String(eventId), audience, ...(audience === "track" ? { trackId } : {}) });
    const timer = setTimeout(() => {
      apiGet<AudienceSize>(`/api/announcements/audience?${q.toString()}`)
        .then((d) => { if (live) setSize(d); })
        .catch(() => { if (live) setSize(null); });
    }, 200);
    return () => { live = false; clearTimeout(timer); };
  }, [eventId, audience, trackId, sentEdit]);

  const zone = useMemo(() => {
    try {
      return zoneLabelOf(timeZone);
    } catch {
      return timeZone;
    }
  }, [timeZone]);

  const applyTemplate = (key: string) => {
    setTitle(t(`an.tpl.${key}_t`));
    setContent(t(`an.tpl.${key}_b`));
  };

  const reset = () => {
    setTitle("");
    setContent("");
    setAudience("everyone");
    setTrackId("");
    setTelegram(true);
    setEmail(false);
    setPriority("normal");
    setWhen("now");
    setAt(null);
    setErrors({});
    setFormError(null);
  };

  const errorFor = (code?: string, max?: number) => {
    const key = `an.err.${code || "INVALID"}`;
    const text = t(key);
    return fill(text === key ? t("an.err.INVALID") : text, { max: max ?? "" });
  };

  const check = (): Errors => {
    const e: Errors = {};
    if (!title.trim()) e.title = errorFor("REQUIRED");
    if (!content.trim()) e.content = errorFor("REQUIRED");
    if (!sentEdit) {
      if (audience === "track" && !trackId) e.trackId = errorFor("REQUIRED");
      if (when === "later") {
        if (!at) e.scheduledAt = errorFor("REQUIRED");
        else if (new Date(at).getTime() < Date.now() + 60_000) e.scheduledAt = errorFor("IN_PAST");
      }
    }
    return e;
  };

  const submit = async () => {
    const local = check();
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length) return;
    setSaving(true);
    const channels = [...(telegram ? ["telegram"] : []), ...(email ? ["email"] : [])];
    const body: Record<string, unknown> = sentEdit
      ? { title: title.trim(), content: content.trim(), priority, type: typeForPriority(priority) }
      : {
          eventId,
          title: title.trim(),
          content: content.trim(),
          priority,
          type: typeForPriority(priority),
          audience,
          ...(audience === "track" ? { trackId: Number(trackId) } : {}),
          channels,
          ...(when === "later" ? { scheduledAt: at } : {}),
        };
    try {
      if (editing) {
        await apiPut(`/api/announcements/${editing.id}`, body);
        // A scheduled one switched to "now" goes out right away.
        if (editing.status === "scheduled" && when === "now") {
          await apiPost(`/api/announcements/${editing.id}/send-now`, {});
          toast(t("an.toast.published"), "success");
        } else {
          toast(t("an.toast.saved"), "success");
        }
        onCancelEdit();
      } else {
        const created = await apiPost<{ status?: string }>("/api/announcements", body);
        toast(created?.status === "scheduled" ? t("an.toast.scheduled") : t("an.toast.published"), "success");
        reset();
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.code === "ANNOUNCEMENT_INVALID" && err.fieldErrors.length) {
        const next: Errors = {};
        for (const fe of err.fieldErrors) {
          const f = fe.field as FieldName;
          if (["title", "content", "audience", "trackId", "scheduledAt"].includes(f)) next[f] = errorFor(fe.code, fe.max);
        }
        setErrors(next);
      } else if (err instanceof ApiError && (err.code === "EMAIL_LIMIT" || err.code === "MODULE_DISABLED")) {
        setErrors({ channels: t(`an.err.${err.code}`) });
      } else {
        setFormError(t("an.toast.failed"));
      }
    } finally {
      setSaving(false);
    }
  };

  const audienceOptions = AUDIENCES.filter((a) => a !== "track" || tracks.length > 0).map((a) => ({ value: a, label: t(`an.aud.${a}`) }));
  const reach = size
    ? size.people === 0
      ? t("an.reach_none")
      : `${fill(t("an.reach"), { people: size.people, email: email ? size.email : 0, telegram: telegram ? size.telegram : 0 })}${
          telegram && size.channel && (audience === "everyone" || audience === "participants")
            ? ` ${fill(t("an.reach_channel"), { channel: size.channel.title || (size.channel.username ? `@${size.channel.username}` : "Telegram") })}`
            : ""
        }`
    : null;

  return (
    <section
      className="rounded-[var(--radius)] border p-5"
      style={{ borderColor: editing ? "var(--accent-solid)" : "var(--line)", background: "var(--surface)" }}
      aria-labelledby="an-compose-title"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id="an-compose-title" className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
          {editing ? t("an.compose_edit") : t("an.compose")}
        </h2>
      </div>

      {!editing ? (
        <div className="mb-4">
          <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color: "var(--ink-3)" }}>
            <Sparkles size={13} aria-hidden="true" /> {t("an.templates")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATES.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => applyTemplate(k)}
                className="rounded-full border px-3 py-1 text-[12.5px] transition-colors hover:border-[var(--accent-solid)]"
                style={{ borderColor: "var(--line-strong)", color: "var(--ink-2)", background: "var(--surface)" }}
              >
                {t(`an.tpl.${k}`)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {sentEdit ? <div className="mb-4"><Notice tone="info">{t("an.edit_sent")}</Notice></div> : null}

      <div className="space-y-4">
        <TextInput label={t("an.f_title")} value={title} onChange={setTitle} placeholder={t("an.f_title_ph")} maxLength={MAX_TITLE} required error={errors.title} />
        <TextArea label={t("an.f_content")} value={content} onChange={setContent} placeholder={t("an.f_content_ph")} rows={4} maxLength={MAX_CONTENT} required error={errors.content} />

        {!sentEdit ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label={t("an.f_audience")}
                value={audience}
                onChange={(v) => setAudience(v as Audience)}
                options={audienceOptions}
                help={t(`an.audhint.${audience}`)}
                error={errors.audience}
              />
              {audience === "track" ? (
                <Select
                  label={t("an.f_track")}
                  value={trackId}
                  onChange={setTrackId}
                  placeholder={t("an.f_track_ph")}
                  options={tracks.map((tr) => ({ value: String(tr.id), label: tr.name }))}
                  error={errors.trackId}
                  required
                />
              ) : null}
            </div>

            <div>
              <p className="mb-1 text-[13px] font-medium" style={{ color: "var(--ink)" }}>{t("an.f_channels")}</p>
              <div className="rounded-[var(--radius-sm)] border px-3" style={{ borderColor: "var(--line)" }}>
                <Toggle label={<span className="inline-flex items-center gap-1.5"><Send size={13} aria-hidden="true" />{t("an.ch.telegram")}</span>} help={t("an.ch.telegram_hint")} checked={telegram} onChange={setTelegram} compact />
                <div className="border-t" style={{ borderColor: "var(--line)" }}>
                  <Toggle label={<span className="inline-flex items-center gap-1.5"><Mail size={13} aria-hidden="true" />{t("an.ch.email")}</span>} help={t("an.ch.email_hint")} checked={email} onChange={setEmail} compact />
                </div>
              </div>
              {errors.channels ? (
                <p role="alert" className="mt-1.5 text-[12.5px]" style={{ color: "var(--danger)" }}>{errors.channels}</p>
              ) : reach ? (
                <p className="mt-1.5 text-[12.5px]" style={{ color: "var(--ink-3)" }} aria-live="polite">{reach}</p>
              ) : null}
            </div>
          </>
        ) : null}

        <Segmented
          label={t("an.f_priority")}
          value={priority}
          onChange={setPriority}
          options={PRIORITIES.map((p) => ({ value: p, label: t(`an.prio.${p}`) }))}
          columns={3}
        />

        {!sentEdit ? (
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Segmented
              label={t("an.f_when")}
              value={when}
              onChange={(v) => {
                setWhen(v);
                if (v === "later" && !at) setAt(new Date(Date.now() + 60 * 60_000).toISOString());
              }}
              options={[{ value: "now", label: t("an.when.now") }, { value: "later", label: t("an.when.later"), icon: <CalendarClock size={14} /> }]}
              columns={2}
            />
            {when === "later" ? (
              <DateTimeInput label={t("an.f_at")} value={at} onChange={setAt} timeZone={timeZone} zoneLabel={fill(t("an.zone"), { zone })} error={errors.scheduledAt} required />
            ) : null}
          </div>
        ) : null}

        {formError ? <p role="alert" className="text-[13px]" style={{ color: "var(--danger)" }}>{formError}</p> : null}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="primary" icon={when === "later" && !sentEdit ? <CalendarClock size={15} /> : <Send size={15} />} onClick={submit} loading={saving}>
            {editing ? t("an.btn.save") : when === "later" ? t("an.btn.schedule") : t("an.btn.publish")}
          </Button>
          {editing ? (
            <Button variant="ghost" onClick={onCancelEdit} disabled={saving}>{t("an.btn.cancel_edit")}</Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
