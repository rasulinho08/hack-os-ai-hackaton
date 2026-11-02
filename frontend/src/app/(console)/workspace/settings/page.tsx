"use client";

/**
 * Platform settings: the notice every page shows (planned maintenance, an
 * incident being worked on), and the seller's billing details (./_billing).
 *
 * GET / PUT /api/owner/settings/notice. The notice is written in up to three
 * languages; each reader sees theirs, then English, Azerbaijani, Russian.
 * A start and an end bound when it shows; outside them, or switched off, it
 * shows nowhere. Info and warning notices can be dismissed by the reader
 * for their session; a critical one cannot. The preview below is the very
 * banner the pages render.
 */

import { useEffect, useMemo, useState } from "react";
import { Megaphone, Save } from "lucide-react";
import { Badge, Button, Card, CardHeader, ErrorState, TableSkeleton } from "@/components/ds/primitives";
import { PageHead } from "../_shell";
import { ApiError } from "@/lib/api";
import { NoticeBanner, forgetNoticeCache } from "@/components/notices/PlatformNotice";
import {
  NOTICE_LANGS,
  NOTICE_LEVELS,
  NOTICE_MAX,
  fromLocalInput,
  loadNoticeSetting,
  noticeState,
  noticeText,
  saveNoticeSetting,
  toLocalInput,
  type NoticeLang,
  type NoticeLevel,
  type NoticeSetting,
} from "@/lib/superadmin/owner";
import { BillingSettings } from "./_billing";

interface Form {
  active: boolean;
  level: NoticeLevel;
  message: Record<NoticeLang, string>;
  startsAt: string;
  endsAt: string;
}

const LANG_NAME: Record<NoticeLang, string> = { az: "Azerbaijani", en: "English", ru: "Russian" };

const LEVEL_INFO: Record<NoticeLevel, { label: string; hint: string }> = {
  info: { label: "Info", hint: "News people may want; they can close it." },
  warning: { label: "Warning", hint: "Something that changes their plans; they can close it." },
  critical: { label: "Critical", hint: "An outage in progress; it cannot be closed." },
};

const STATE_INFO: Record<ReturnType<typeof noticeState>, { label: string; tone: "ok" | "info" | "neutral" | "warn" }> = {
  live: { label: "Showing on every page now", tone: "ok" },
  scheduled: { label: "Scheduled", tone: "info" },
  ended: { label: "Ended — no longer shown", tone: "warn" },
  off: { label: "Off — shown nowhere", tone: "neutral" },
};

const formOf = (n: NoticeSetting | null): Form => ({
  active: Boolean(n?.active),
  level: n?.level ?? "info",
  message: { az: n?.message?.az ?? "", en: n?.message?.en ?? "", ru: n?.message?.ru ?? "" },
  startsAt: toLocalInput(n?.startsAt),
  endsAt: toLocalInput(n?.endsAt),
});

const stamp = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export default function PlatformSettingsPage() {
  const [saved, setSaved] = useState<NoticeSetting | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [form, setForm] = useState<Form>(formOf(null));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [previewLang, setPreviewLang] = useState<NoticeLang>("az");

  useEffect(() => {
    let cancelled = false;
    loadNoticeSetting()
      .then((n) => {
        if (cancelled) return;
        setSaved(n ?? null);
        setForm(formOf(n ?? null));
        setLoadError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load the settings");
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const dirty = useMemo(() => saved !== undefined && JSON.stringify(form) !== JSON.stringify(formOf(saved)), [form, saved]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setNotice(null);
  };
  const setMessage = (lang: NoticeLang, v: string) => {
    setForm((f) => ({ ...f, message: { ...f.message, [lang]: v } }));
    setNotice(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setNotice(null);
    try {
      const result = await saveNoticeSetting({
        active: form.active,
        level: form.level,
        message: form.message,
        startsAt: fromLocalInput(form.startsAt),
        endsAt: fromLocalInput(form.endsAt),
      });
      setSaved(result);
      setForm(formOf(result));
      forgetNoticeCache();
      setNotice({ tone: "ok", text: "Saved. Pages pick it up within a minute." });
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length) {
        const next: Record<string, string> = {};
        for (const f of err.fieldErrors) next[f.field] = f.message || "Check this field.";
        setErrors(next);
        setNotice({ tone: "danger", text: err.summary || "Some fields need attention." });
      } else {
        setNotice({ tone: "danger", text: err instanceof Error ? err.message : "The notice was not saved." });
      }
    } finally {
      setSaving(false);
    }
  };

  const field = "w-full rounded-[var(--radius-sm)] border px-3 text-sm outline-none";
  const fieldStyle = (bad?: string): React.CSSProperties => ({
    borderColor: bad ? "var(--hs-danger)" : "var(--line-strong)",
    background: "var(--surface)",
    color: "var(--ink)",
  });
  const label = "mb-1 block text-xs font-medium";
  const labelStyle: React.CSSProperties = { color: "var(--hs-ink-2)" };
  const errorText = (key: string) =>
    errors[key] ? (
      <p id={`err-${key}`} className="mt-1 text-xs" style={{ color: "var(--hs-danger)" }}>
        {errors[key]}
      </p>
    ) : null;

  if (loadError && saved === undefined) {
    return (
      <>
        <PageHead title="Settings" />
        <ErrorState title="Could not load the settings" body={loadError} onRetry={() => setNonce((n) => n + 1)} />
      </>
    );
  }

  const state = noticeState(saved ?? null);
  const previewText = noticeText(form.message, previewLang);

  return (
    <>
      <PageHead title="Settings" sub="Platform-wide settings, for every organisation and visitor." />

      {saved === undefined ? (
        <Card padded={false}>
          <TableSkeleton rows={4} cols={2} />
        </Card>
      ) : (
        <form onSubmit={save} noValidate>
          <Card>
            <CardHeader
              title={
                <span className="inline-flex items-center gap-2">
                  <Megaphone size={15} aria-hidden="true" /> Notice on every page
                </span>
              }
              hint="Planned maintenance, an incident, a change people should know about. Shown above the content of the site, the app and this console."
              action={<Badge tone={STATE_INFO[state].tone} dot>{STATE_INFO[state].label}</Badge>}
            />

            {saved?.updatedAt ? (
              <p className="-mt-2 mb-4 text-xs" style={{ color: "var(--hs-ink-3)" }}>
                Last saved {stamp(saved.updatedAt)}
                {state === "scheduled" && saved.startsAt ? ` · starts ${stamp(saved.startsAt)}` : ""}
                {state === "live" && saved.endsAt ? ` · ends ${stamp(saved.endsAt)}` : ""}
              </p>
            ) : null}

            <div className="space-y-5">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => set("active", e.target.checked)}
                  className="h-4 w-4 accent-[var(--hs-brand)]"
                />
                <span className="text-sm" style={{ color: "var(--hs-ink)" }}>
                  Show the notice
                  <span className="block text-xs" style={{ color: "var(--hs-ink-3)" }}>
                    Off keeps the words for next time and shows nothing.
                  </span>
                </span>
              </label>

              <fieldset>
                <legend className={label} style={labelStyle}>Level</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup">
                  {NOTICE_LEVELS.map((lvl) => {
                    const on = form.level === lvl;
                    return (
                      <label
                        key={lvl}
                        className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-sm)] border px-3 py-2.5"
                        style={{ borderColor: on ? "var(--hs-brand)" : "var(--line-strong)", background: on ? "var(--hs-brand-weak)" : "var(--surface)" }}
                      >
                        <input
                          type="radio"
                          name="level"
                          value={lvl}
                          checked={on}
                          onChange={() => set("level", lvl)}
                          className="mt-0.5 accent-[var(--hs-brand)]"
                        />
                        <span className="text-sm" style={{ color: "var(--hs-ink)" }}>
                          {LEVEL_INFO[lvl].label}
                          <span className="block text-xs" style={{ color: "var(--hs-ink-3)" }}>{LEVEL_INFO[lvl].hint}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {errorText("level")}
              </fieldset>

              <div className="space-y-3">
                {NOTICE_LANGS.map((lang) => {
                  const key = `message.${lang}`;
                  const left = NOTICE_MAX - form.message[lang].length;
                  return (
                    <div key={lang}>
                      <label htmlFor={`msg-${lang}`} className={label} style={labelStyle}>
                        {LANG_NAME[lang]} <span style={{ color: "var(--hs-ink-3)" }}>({lang.toUpperCase()})</span>
                      </label>
                      <textarea
                        id={`msg-${lang}`}
                        rows={2}
                        maxLength={NOTICE_MAX}
                        value={form.message[lang]}
                        onChange={(e) => setMessage(lang, e.target.value)}
                        aria-invalid={Boolean(errors[key] || errors.message) || undefined}
                        aria-describedby={`count-${lang}${errors[key] ? ` err-${key}` : ""}`}
                        className={`${field} min-h-[4.5rem] py-2 leading-relaxed`}
                        style={fieldStyle(errors[key] || errors.message)}
                        lang={lang}
                      />
                      <p id={`count-${lang}`} className="mt-1 text-right text-[11px]" style={{ color: left < 30 ? "var(--hs-warn)" : "var(--hs-ink-3)" }}>
                        {left} characters left
                      </p>
                      {errorText(key)}
                    </div>
                  );
                })}
                {errorText("message")}
                <p className="text-xs" style={{ color: "var(--hs-ink-3)" }}>
                  Readers see their own language; a missing one falls back to English, then Azerbaijani, then Russian.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="notice-start" className={label} style={labelStyle}>Starts (optional)</label>
                  <input
                    id="notice-start"
                    type="datetime-local"
                    value={form.startsAt}
                    onChange={(e) => set("startsAt", e.target.value)}
                    className={`${field} min-h-10`}
                    style={fieldStyle(errors.startsAt)}
                    aria-invalid={Boolean(errors.startsAt) || undefined}
                  />
                  {errorText("startsAt")}
                </div>
                <div>
                  <label htmlFor="notice-end" className={label} style={labelStyle}>Ends (optional)</label>
                  <input
                    id="notice-end"
                    type="datetime-local"
                    value={form.endsAt}
                    min={form.startsAt || undefined}
                    onChange={(e) => set("endsAt", e.target.value)}
                    className={`${field} min-h-10`}
                    style={fieldStyle(errors.endsAt)}
                    aria-invalid={Boolean(errors.endsAt) || undefined}
                  />
                  {errorText("endsAt")}
                </div>
                <p className="text-xs sm:col-span-2" style={{ color: "var(--hs-ink-3)" }}>
                  Times are in your time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Leave both empty to show it until you switch it off.
                </p>
              </div>
            </div>
          </Card>

          <Card className="mt-4">
            <CardHeader
              title="Preview"
              hint="Exactly what the pages show, in the language you pick."
              action={
                <div role="group" aria-label="Preview language" className="flex rounded-full p-0.5" style={{ background: "var(--hs-tint)" }}>
                  {NOTICE_LANGS.map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => setPreviewLang(lang)}
                      aria-pressed={previewLang === lang}
                      className="min-h-8 rounded-full px-3 text-xs font-medium"
                      style={{
                        background: previewLang === lang ? "var(--hs-surface)" : "transparent",
                        color: previewLang === lang ? "var(--hs-ink)" : "var(--hs-ink-2)",
                      }}
                    >
                      {lang.toUpperCase()}
                    </button>
                  ))}
                </div>
              }
            />
            {previewText ? (
              <NoticeBanner
                level={form.level}
                text={previewText}
                endsAt={fromLocalInput(form.endsAt)}
                lang={previewLang}
                onDismiss={form.level === "critical" ? undefined : () => {}}
              />
            ) : (
              <p className="text-sm" style={{ color: "var(--hs-ink-3)" }}>Write the notice above to see it here.</p>
            )}
            {!form.active && previewText ? (
              <p className="mt-2 text-xs" style={{ color: "var(--hs-ink-3)" }}>Switched off: saved like this, it shows nowhere.</p>
            ) : null}
          </Card>

          <div className="sticky bottom-0 z-10 mt-4 flex flex-wrap items-center gap-3 border-t py-3" style={{ borderColor: "var(--hs-line)", background: "var(--hs-bg)" }}>
            <Button type="submit" variant="primary" icon={<Save size={15} />} loading={saving} disabled={saving || !dirty}>
              Save notice
            </Button>
            {dirty ? (
              <Button type="button" variant="ghost" onClick={() => { setForm(formOf(saved ?? null)); setErrors({}); setNotice(null); }}>
                Discard changes
              </Button>
            ) : null}
            {notice ? (
              <p role={notice.tone === "danger" ? "alert" : "status"} className="text-sm" style={{ color: notice.tone === "danger" ? "var(--hs-danger)" : "var(--hs-ok)" }}>
                {notice.text}
              </p>
            ) : null}
          </div>
        </form>
      )}

      <BillingSettings />
    </>
  );
}
