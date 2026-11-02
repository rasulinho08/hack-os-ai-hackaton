"use client";

/**
 * Start a new event: a name, a template, the language and time zone. The
 * draft is created on the server straight away and the builder opens on it;
 * nothing is public and nothing is taken from the plan until it is published.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarClock, FileText, GraduationCap, Lightbulb, Loader2 } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { ApiError } from "@/lib/api";
import { createDraft } from "@/lib/builder/api";
import { timeZones, zoneLabel } from "@/lib/builder/datetime";
import { enterEventWorkspace } from "@/lib/workspaces";
import { Segmented, Select, TextInput } from "@/components/builder/ui";

const TEMPLATES = [
  { key: "hackathon24", icon: CalendarClock },
  { key: "university", icon: GraduationCap },
  { key: "ideathon", icon: Lightbulb },
  { key: "blank", icon: FileText },
] as const;

export default function CreateEventPage() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<string>("hackathon24");
  const [language, setLanguage] = useState<string>(lang === "en" || lang === "ru" ? lang : "az");
  const [timezone, setTimezone] = useState("Asia/Baku");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 3) { setError(t("b.start.name_short")); return; }
    setBusy(true);
    setError(null);
    try {
      const draft = await createDraft({ name: name.trim(), template, language, timezone });
      await enterEventWorkspace(draft.event.id);
      router.push(`/create-event/${draft.event.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("b.start.failed"));
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh" style={{ background: "var(--surface-sunken)" }}>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <Link href="/workspaces" className="inline-flex items-center gap-1.5 text-[13px] hover:underline" style={{ color: "var(--ink-2)" }}>
          <ArrowLeft size={15} /> {t("b.shell.back")}
        </Link>
        <h1 className="mt-6 text-[28px] font-semibold leading-tight sm:text-[34px]" style={{ color: "var(--ink)", textWrap: "balance" }}>{t("b.start.title")}</h1>
        <p className="mt-2 max-w-xl text-[14.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{t("b.start.lead")}</p>

        <form onSubmit={start} className="mt-8 space-y-6">
          <div className="rounded-[18px] border p-5 sm:p-6" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
            <TextInput label={t("b.basics.name")} value={name} onChange={setName} placeholder={t("b.start.name_ph")} maxLength={255} required error={error} />
          </div>

          <div className="rounded-[18px] border p-5 sm:p-6" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
            <p className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>{t("b.start.template")}</p>
            <p className="mt-1 text-[13px]" style={{ color: "var(--ink-2)" }}>{t("b.start.template_help")}</p>
            <div role="radiogroup" aria-label={t("b.start.template")} className="mt-4 grid gap-3 sm:grid-cols-2">
              {TEMPLATES.map(({ key, icon: Icon }) => {
                const on = template === key;
                return (
                  <button key={key} type="button" role="radio" aria-checked={on} onClick={() => setTemplate(key)}
                    className="flex items-start gap-3 rounded-[14px] border p-4 text-left transition-[border-color,box-shadow] duration-150"
                    style={{ borderColor: on ? "var(--accent-solid)" : "var(--line-strong)", boxShadow: on ? "0 0 0 1px var(--accent-solid) inset" : "none", background: on ? "var(--accent-weak)" : "var(--surface)" }}>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]" style={{ background: on ? "var(--accent-solid)" : "var(--tint)", color: on ? "#fff" : "var(--ink-2)" }}>
                      <Icon size={18} aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{t(`b.tpl.${key}`)}</span>
                      <span className="mt-1 block text-[12.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{t(`b.tpl.${key}_desc`)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 rounded-[18px] border p-5 sm:grid-cols-2 sm:p-6" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
            <Segmented label={t("b.basics.language")} value={language} onChange={setLanguage} columns={3}
              options={[{ value: "az", label: "AZ" }, { value: "en", label: "EN" }, { value: "ru", label: "RU" }]} help={t("b.basics.language_help")} />
            <Select label={t("b.place.zone")} value={timezone} onChange={setTimezone}
              options={timeZones().map((z) => ({ value: z, label: `${z.replace(/_/g, " ")} (${zoneLabel(z)})` }))} help={t("b.start.zone_help")} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-md text-[12.5px] leading-relaxed" style={{ color: "var(--ink-3)" }}>{t("b.start.free_note")}</p>
            <button type="submit" disabled={busy}
              className="inline-flex min-h-11 items-center gap-2 rounded-[10px] px-5 text-[14px] font-semibold text-white disabled:opacity-60"
              style={{ background: "var(--accent-solid)" }}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : null}
              {t("b.start.go")} <ArrowRight size={16} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
