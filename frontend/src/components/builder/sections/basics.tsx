"use client";

import { Globe2, MapPinned, Monitor, RefreshCcw, Shuffle } from "lucide-react";
import { checklistText, fieldId } from "@/lib/builder/checklist";
import { Card, DateTimeInput, LockedPanel, Notice, Segmented, Select, TextArea, TextInput } from "../ui";
import { ImageUpload } from "../ImageUpload";
import { countryOptions } from "@/lib/builder/countries";
import { formatInZone, timeZones, zoneLabel as labelOf } from "@/lib/builder/datetime";
import type { SectionCtx } from "./context";
import { isRollingJudging } from "@/lib/judging";

export function BasicsSection({ ev, set, err, t, catalog }: SectionCtx) {
  return (
    <div className="space-y-5">
      <Card>
        <TextInput label={t("b.basics.name")} value={ev.name} onChange={(v) => set({ name: v })} required maxLength={255}
          error={err("name")} help={t("b.basics.name_help")} />
        <TextInput label={t("b.basics.tagline")} value={ev.tagline} onChange={(v) => set({ tagline: v })} required maxLength={200}
          error={err("tagline")} help={t("b.basics.tagline_help")} placeholder={t("b.basics.tagline_ph")} />
        <TextArea label={t("b.basics.description")} value={ev.description} onChange={(v) => set({ description: v })} rows={9}
          error={err("description")} help={t("b.basics.description_help")} placeholder={t("b.basics.description_ph")} />
      </Card>
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label={t("b.basics.category")} value={ev.category} onChange={(v) => set({ category: v })}
            options={(catalog?.categories || ["hackathon"]).map((c) => ({ value: c, label: t(`b.category.${c}`) }))}
            error={err("category")} />
          <Select label={t("b.basics.language")} value={ev.language} onChange={(v) => set({ language: v })}
            options={[{ value: "az", label: "Azərbaycanca" }, { value: "en", label: "English" }, { value: "ru", label: "Русский" }]}
            error={err("language")} help={t("b.basics.language_help")} />
        </div>
      </Card>
    </div>
  );
}

const SWATCHES = ["#e1003c", "#1f6feb", "#0e9f6e", "#7c3aed", "#f59e0b", "#0f172a", "#db2777", "#0891b2"];

export function BrandSection({ ev, set, err, t, has }: SectionCtx) {
  if (!has("branding")) {
    return <LockedPanel title={t("b.locked.title")} body={t("b.brand.locked")} />;
  }
  const color = ev.brand_color || "#e1003c";
  return (
    <div className="space-y-5">
      <Card title={t("b.brand.images")} description={t("b.brand.images_help")}>
        <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
          <ImageUpload eventId={ev.id} purpose="event_logo" url={ev.logo_url} label={t("b.brand.logo")} help={t("b.brand.logo_help")}
            maxW={512} maxH={512} onUploaded={(f) => set({ logo_file_id: f.id, logo_url: f.url })} onRemove={() => set({ logo_file_id: null, logo_url: null })} />
          <ImageUpload eventId={ev.id} purpose="event_banner" url={ev.banner_url} label={t("b.brand.banner")} help={t("b.brand.banner_help")}
            shape="wide" maxW={1600} maxH={900} onUploaded={(f) => set({ banner_file_id: f.id, banner_url: f.url })} onRemove={() => set({ banner_file_id: null, banner_url: null })} />
        </div>
        {err("logo_file_id") || err("banner_file_id") ? <Notice tone="danger">{err("logo_file_id") || err("banner_file_id")}</Notice> : null}
      </Card>
      <Card title={t("b.brand.color")} description={t("b.brand.color_help")}>
        <div className="flex flex-wrap items-center gap-2">
          {SWATCHES.map((c) => (
            <button key={c} type="button" aria-label={c} aria-pressed={color === c} onClick={() => set({ brand_color: c })}
              className="h-9 w-9 rounded-full border-2 transition-transform hover:scale-105"
              style={{ background: c, borderColor: color === c ? "var(--ink)" : "transparent" }} />
          ))}
          <label className="ml-1 inline-flex items-center gap-2 text-[13px]" style={{ color: "var(--ink-2)" }}>
            <input type="color" value={color} onChange={(e) => set({ brand_color: e.target.value.toLowerCase() })} className="h-9 w-12 cursor-pointer rounded border-0 bg-transparent" aria-label={t("b.brand.custom")} />
            <span className="font-mono">{color}</span>
          </label>
        </div>
        {err("brand_color") ? <p role="alert" className="text-[12.5px]" style={{ color: "var(--danger)" }}>{err("brand_color")}</p> : null}
        <div className="overflow-hidden rounded-[14px] border" style={{ borderColor: "var(--line)" }}>
          <div className="h-24 w-full" style={{ background: ev.banner_url ? `center / cover no-repeat url(${ev.banner_url})` : `linear-gradient(120deg, ${color}, #0f172a)` }} />
          <div className="flex items-center gap-3 p-4">
            {ev.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ev.logo_url} alt="" className="-mt-10 h-14 w-14 rounded-[12px] border-2 bg-white object-cover" style={{ borderColor: "var(--surface)" }} />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold" style={{ color: "var(--ink)" }}>{ev.name}</p>
              <p className="truncate text-[12.5px]" style={{ color: "var(--ink-2)" }}>{ev.tagline || t("b.basics.tagline_ph")}</p>
            </div>
            <span className="rounded-full px-3.5 py-2 text-[12.5px] font-semibold text-white" style={{ background: color }}>{t("b.brand.preview_cta")}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

export function PlaceSection({ ev, set, err, t, lang }: SectionCtx) {
  const offline = ev.format === "offline" || ev.format === "hybrid";
  const online = ev.format === "online" || ev.format === "hybrid";
  return (
    <div className="space-y-5">
      <Card>
        <Segmented label={t("b.place.format")} value={ev.format} onChange={(v) => set({ format: v })} error={err("format")}
          options={[
            { value: "offline", label: t("b.place.offline"), hint: t("b.place.offline_hint"), icon: <MapPinned size={15} /> },
            { value: "online", label: t("b.place.online"), hint: t("b.place.online_hint"), icon: <Monitor size={15} /> },
            { value: "hybrid", label: t("b.place.hybrid"), hint: t("b.place.hybrid_hint"), icon: <Shuffle size={15} /> },
          ]} />
      </Card>
      {offline ? (
        <Card title={t("b.place.venue_title")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput label={t("b.place.venue_name")} value={ev.venue_name} onChange={(v) => set({ venue_name: v })} error={err("venue_name")} placeholder={t("b.place.venue_name_ph")} maxLength={200} />
            <TextInput label={t("b.place.city")} value={ev.city} onChange={(v) => set({ city: v })} error={err("city")} required maxLength={100} />
            <TextInput className="sm:col-span-2" label={t("b.place.address")} value={ev.venue_address} onChange={(v) => set({ venue_address: v })} error={err("venue_address")} maxLength={300} />
            <Select label={t("b.place.country")} value={ev.country || ""} onChange={(v) => set({ country: v || null })} options={countryOptions(lang)} placeholder={t("b.common.choose")} error={err("country")} />
            <TextInput label={t("b.place.map")} value={ev.map_url} onChange={(v) => set({ map_url: v })} error={err("map_url")} placeholder="https://maps.google.com/…" help={t("b.place.map_help")} />
          </div>
        </Card>
      ) : null}
      {online ? (
        <Card title={t("b.place.online_title")}>
          <TextInput label={t("b.place.online_url")} value={ev.online_url} onChange={(v) => set({ online_url: v })} error={err("online_url")} placeholder="https://meet.google.com/…" help={t("b.place.online_url_help")} />
        </Card>
      ) : null}
      <Card title={t("b.place.zone_title")} description={t("b.place.zone_help")}>
        <Select label={t("b.place.zone")} value={ev.timezone} onChange={(v) => set({ timezone: v })} error={err("timezone")}
          options={timeZones().map((z) => ({ value: z, label: `${z.replace(/_/g, " ")} (${labelOf(z)})` }))} />
        <p className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--ink-2)" }}>
          <Globe2 size={14} aria-hidden="true" />
          {t("b.place.zone_now")} {formatInZone(new Date().toISOString(), ev.timezone, lang)}
        </p>
      </Card>
    </div>
  );
}

const PHASES: { key: string; from: keyof SectionCtx["ev"]; to: keyof SectionCtx["ev"]; color: string }[] = [
  { key: "registration", from: "registration_start", to: "registration_end", color: "#1f6feb" },
  { key: "teams", from: "registration_start", to: "team_deadline", color: "#7c3aed" },
  { key: "hacking", from: "start_date", to: "end_date", color: "#e1003c" },
  { key: "judging", from: "judging_start", to: "judging_end", color: "#f59e0b" },
];

function Timeline({ ev, t, lang }: { ev: SectionCtx["ev"]; t: SectionCtx["t"]; lang: string }) {
  const points = [ev.registration_start, ev.registration_end, ev.team_deadline, ev.start_date, ev.end_date, ev.judging_start, ev.judging_end, ev.results_at, ev.demo_day]
    .filter(Boolean).map((d) => new Date(d as string).getTime());
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(max - min, 1);
  const pos = (d: string | null) => (d ? ((new Date(d).getTime() - min) / span) * 100 : null);
  return (
    <div className="space-y-2" aria-hidden="true">
      {PHASES.map((p) => {
        const a = pos(ev[p.from] as string | null);
        const b = pos(ev[p.to] as string | null);
        if (a == null || b == null || b < a) return null;
        return (
          <div key={p.key} className="grid grid-cols-[7rem_1fr] items-center gap-3">
            <span className="truncate text-[12px]" style={{ color: "var(--ink-2)" }}>{t(`b.schedule.phase_${p.key}`)}</span>
            <div className="relative h-2.5 rounded-full" style={{ background: "var(--tint)" }}>
              <span className="absolute top-0 h-2.5 rounded-full" style={{ left: `${a}%`, width: `${Math.max(b - a, 1.5)}%`, background: p.color }} />
            </div>
          </div>
        );
      })}
      {ev.results_at ? (
        <div className="grid grid-cols-[7rem_1fr] items-center gap-3">
          <span className="truncate text-[12px]" style={{ color: "var(--ink-2)" }}>{t("b.schedule.phase_results")}</span>
          <div className="relative h-2.5">
            <span className="absolute top-0 h-2.5 w-2.5 -translate-x-1/2 rounded-full" style={{ left: `${pos(ev.results_at)}%`, background: "#0e9f6e" }} />
          </div>
        </div>
      ) : null}
      <div className="flex justify-between pl-[7.75rem] text-[11px] tabular-nums" style={{ color: "var(--ink-3)" }}>
        <span>{formatInZone(new Date(min).toISOString(), ev.timezone, lang, { hour: undefined, minute: undefined })}</span>
        <span>{formatInZone(new Date(max).toISOString(), ev.timezone, lang, { hour: undefined, minute: undefined })}</span>
      </div>
    </div>
  );
}

export function ScheduleSection(ctx: SectionCtx) {
  const { ev, set, err, t, zone, zoneLabel, lang, data } = ctx;
  // A date out of order that is already saved (an older event) is on the
  // checklist; say it on the field too, in the same words.
  const stored = new Map(data.checklist
    .filter((i) => i.code === "timeline_order" && i.params?.field)
    .map((i) => [String(i.params!.field), checklistText(i, t)]));
  const dt = (key: keyof typeof ev, label: string, extra: { required?: boolean; help?: string } = {}) => (
    <DateTimeInput id={fieldId(String(key))} label={label} value={(ev[key] as string | null) ?? null} onChange={(v) => set({ [key]: v })}
      timeZone={zone} zoneLabel={zoneLabel} error={err(String(key)) ?? stored.get(String(key)) ?? null} required={extra.required} help={extra.help}
      optional={extra.required ? undefined : t("Optional")} />
  );
  return (
    <div className="space-y-5">
      <Card>
        <Notice tone="info" icon={<Globe2 size={15} />}>{t("b.schedule.zone_note").replace("{zone}", `${zone.replace(/_/g, " ")} (${zoneLabel})`)}</Notice>
        <Timeline ev={ev} t={t} lang={lang} />
      </Card>
      <Card title={t("b.schedule.registration")}>
        <div className="grid gap-4 sm:grid-cols-2">
          {dt("registration_start", t("b.schedule.reg_opens"), { required: true })}
          {dt("registration_end", t("b.schedule.reg_closes"), { required: true })}
          {dt("team_deadline", t("b.schedule.team_deadline"), { help: t("b.schedule.team_deadline_help") })}
        </div>
      </Card>
      <Card title={t("b.schedule.event")}>
        <div className="grid gap-4 sm:grid-cols-2">
          {dt("start_date", t("b.schedule.starts"), { required: true })}
          {dt("end_date", t("b.schedule.ends"), { required: true })}
          {dt("submission_deadline", t("b.schedule.submission_deadline"), { help: t("b.schedule.submission_deadline_help") })}
        </div>
      </Card>
      <Card title={t("b.schedule.after")}>
        <div className="grid gap-4 sm:grid-cols-2">
          {dt("judging_start", t("b.schedule.judging_start"))}
          {dt("judging_end", t("b.schedule.judging_end"))}
          {dt("demo_day", t("b.schedule.demo_day"))}
          {dt("results_at", t("b.schedule.results_at"))}
        </div>
        {isRollingJudging(ev) ? (
          <Notice tone="info" icon={<RefreshCcw size={15} />}>
            <span className="block font-medium" style={{ color: "var(--ink)" }}>{t("b.schedule.rolling_title")}</span>
            <span className="mt-0.5 block">{t("b.schedule.rolling_note").replace("{when}", formatInZone(ev.judging_start, zone, lang))}</span>
          </Notice>
        ) : null}
        {err("event") ? <Notice tone="danger">{err("event")}</Notice> : null}
      </Card>
    </div>
  );
}
