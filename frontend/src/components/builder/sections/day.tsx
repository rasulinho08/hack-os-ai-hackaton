"use client";

import { useState } from "react";
import { Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ds/primitives";
import { ApiError, apiDelete, apiPatch, apiPost } from "@/lib/api";
import { Card, DateTimeInput, LockedPanel, Notice, NumberStepper, Segmented, TextInput, Toggle } from "../ui";
import { ImageUpload } from "../ImageUpload";
import { formatInZone } from "@/lib/builder/datetime";
import type { Resource, SubmissionFieldState } from "@/lib/builder/types";
import type { SectionCtx } from "./context";

const SUB_FIELDS = ["repo", "demo", "slides", "video", "summary", "tech"] as const;
const FILE_TYPES = ["pdf", "pptx", "docx", "zip", "image"];

export function SubmissionsSection({ ev, set, err, t, has }: SectionCtx) {
  if (!has("submissions")) return <LockedPanel title={t("b.locked.title")} body={t("b.subs.locked")} />;
  const sc = ev.submission_config;
  const setS = (patch: Partial<typeof sc>) => set({ submission_config: { ...sc, ...patch } });
  return (
    <div className="space-y-5">
      <Card title={t("b.subs.links")} description={t("b.subs.links_help")}>
        <div className="space-y-3">
          {SUB_FIELDS.map((k) => (
            <div key={k} className="grid items-center gap-2 sm:grid-cols-[12rem_1fr]">
              <span className="text-[13.5px] font-medium" style={{ color: "var(--ink)" }}>{t(`b.subs.f_${k}`)}</span>
              <div role="radiogroup" aria-label={t(`b.subs.f_${k}`)} className="inline-flex w-fit rounded-[10px] border p-0.5" style={{ borderColor: "var(--line-strong)" }}>
                {(["required", "optional", "off"] as SubmissionFieldState[]).map((s) => {
                  const on = sc.fields[k] === s;
                  return (
                    <button key={s} type="button" role="radio" aria-checked={on} onClick={() => setS({ fields: { ...sc.fields, [k]: s } })}
                      className="rounded-[8px] px-3 py-1.5 text-[12.5px] font-medium transition-colors"
                      style={{ background: on ? (s === "off" ? "var(--tint)" : "var(--accent-solid)") : "transparent", color: on && s !== "off" ? "#fff" : "var(--ink-2)" }}>
                      {t(`b.subs.${s}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {err("submission_config") ? <Notice tone="danger">{err("submission_config")}</Notice> : null}
      </Card>
      <Card title={t("b.subs.files")} description={t("b.subs.files_help")}>
        <Toggle label={t("b.subs.files_on")} checked={sc.files.enabled} onChange={(v) => setS({ files: { ...sc.files, enabled: v } })} />
        {sc.files.enabled ? (
          <>
            <NumberStepper label={t("b.subs.max_mb")} value={sc.files.maxMb} min={1} max={10} suffix="MB" onChange={(v) => setS({ files: { ...sc.files, maxMb: v ?? 10 } })} />
            <div className="flex flex-wrap gap-3">
              {FILE_TYPES.map((ft) => (
                <label key={ft} className="inline-flex items-center gap-2 text-[13px]" style={{ color: "var(--ink)" }}>
                  <input type="checkbox" className="h-4 w-4 accent-[var(--accent-solid)]" checked={sc.files.types.includes(ft)}
                    onChange={(e) => setS({ files: { ...sc.files, types: e.target.checked ? [...sc.files.types, ft] : sc.files.types.filter((x) => x !== ft) } })} />
                  {t(`b.subs.type_${ft}`)}
                </label>
              ))}
            </div>
          </>
        ) : null}
      </Card>
      <Card>
        <Toggle label={t("b.subs.late")} help={t("b.subs.late_help")} checked={ev.allow_late_submissions} onChange={(v) => set({ allow_late_submissions: v })} />
        <Toggle label={t("b.subs.github_check")} help={t("b.subs.github_check_help")} checked={Boolean(sc.githubCheck)} onChange={(v) => setS({ githubCheck: v })} />
      </Card>
    </div>
  );
}

export function PresentationSection({ ev, set, err, t, has, f, data }: SectionCtx) {
  if (!has("presentations")) return <LockedPanel title={t("b.locked.title")} body={t("b.pres.locked")} />;
  const pc = ev.presentation_config;
  const setP = (patch: Partial<typeof pc>) => set({ presentation_config: { ...pc, ...patch } });
  const teams = Math.max(1, Math.ceil((data.capacity.limit || 60) / Math.max(1, ev.team_size_limit || 1)));
  const total = teams * (pc.slotMinutes + pc.qaMinutes);
  return (
    <div className="space-y-5">
      <Card title={t("b.pres.slot")} description={t("b.pres.slot_help")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberStepper label={t("b.pres.talk")} value={pc.slotMinutes} min={1} max={60} suffix={t("b.common.min")} onChange={(v) => setP({ slotMinutes: v ?? 3 })} error={err("presentation_config.slotMinutes")} />
          <NumberStepper label={t("b.pres.qa")} value={pc.qaMinutes} min={0} max={30} suffix={t("b.common.min")} onChange={(v) => setP({ qaMinutes: v ?? 0 })} error={err("presentation_config.qaMinutes")} />
          <NumberStepper label={t("b.pres.warn")} value={pc.warnSeconds} min={0} max={600} step={15} suffix={t("b.common.sec")} onChange={(v) => setP({ warnSeconds: v ?? 60 })} error={err("presentation_config.warnSeconds")} />
        </div>
        <p className="text-[12.5px]" style={{ color: "var(--ink-2)" }}>{f("b.pres.estimate", { teams, minutes: total, hours: (total / 60).toFixed(1) })}</p>
      </Card>
      <Card title={t("b.pres.order")}>
        <Segmented value={pc.order} onChange={(v) => setP({ order: v })}
          options={[
            { value: "submission", label: t("b.pres.by_submission"), hint: t("b.pres.by_submission_hint") },
            { value: "random", label: t("b.pres.random"), hint: t("b.pres.random_hint") },
            { value: "manual", label: t("b.pres.manual"), hint: t("b.pres.manual_hint") },
          ]} />
      </Card>
    </div>
  );
}

export function CommunicationSection({ ev, set, err, t, has, catalog }: SectionCtx) {
  if (!has("announcements")) return <LockedPanel title={t("b.locked.title")} body={t("b.comms.locked")} />;
  const cc = ev.comms_config;
  const setC = (patch: Partial<typeof cc>) => set({ comms_config: { ...cc, ...patch } });
  const autos = catalog?.autoAnnouncements || Object.keys(cc.auto);
  const canAuto = has("automations");
  const canChat = has("chat");
  const chat = { general: true, team: true, support: true, ...(cc.chat || {}) };
  return (
    <div className="space-y-5">
      <Card title={t("b.comms.email")} description={t("b.comms.email_help")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label={t("b.comms.sender")} value={cc.senderName} onChange={(v) => setC({ senderName: v })} maxLength={80} placeholder={ev.name} error={err("comms_config.senderName")} help={t("b.comms.sender_help")} />
          <TextInput label={t("b.comms.reply_to")} type="email" value={cc.replyTo} onChange={(v) => setC({ replyTo: v })} placeholder="team@example.com" error={err("comms_config.replyTo")} help={t("b.comms.reply_to_help")} />
        </div>
      </Card>
      <Card title={t("b.comms.auto")}
        description={canAuto ? t("b.comms.auto_help") : t("b.comms.auto_locked")}>
        <div className="divide-y" style={{ borderColor: "var(--line)" }}>
          {autos.map((k) => (
            <Toggle key={k} compact disabled={!canAuto} label={t(`b.auto.${k}`)} checked={Boolean(cc.auto[k])}
              onChange={(v) => setC({ auto: { ...cc.auto, [k]: v } })} />
          ))}
        </div>
      </Card>
      <Card title={t("b.comms.chat")} description={canChat ? t("b.comms.chat_help") : t("b.comms.chat_locked")}>
        <div className="divide-y" style={{ borderColor: "var(--line)" }}>
          {(["general", "team", "support"] as const).map((k) => (
            <Toggle key={k} disabled={!canChat} label={t(`b.comms.chat_${k}`)} help={t(`b.comms.chat_${k}_help`)} checked={chat[k]}
              onChange={(v) => setC({ chat: { ...chat, [k]: v } })} />
          ))}
        </div>
      </Card>
    </div>
  );
}

type ResourceDraft = { label: string; url: string; description: string; visible_from: string | null };
const EMPTY_RES: ResourceDraft = { label: "", url: "", description: "", visible_from: null };

export function ResourcesSection({ ev, data, b, t, has, zone, zoneLabel, lang }: SectionCtx) {
  const [draft, setDraft] = useState<ResourceDraft>(EMPTY_RES);
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!has("resources")) return <LockedPanel title={t("b.locked.title")} body={t("b.res.locked")} />;

  const save = async () => {
    if (!draft.label.trim()) { setError(t("b.res.label_required")); return; }
    setBusy(true);
    setError(null);
    try {
      const body = { label: draft.label.trim(), url: draft.url.trim() || null, description: draft.description.trim() || null, visible_from: draft.visible_from };
      if (editing) await apiPatch(`/api/events/${ev.id}/resources/${editing}`, body);
      else await apiPost(`/api/events/${ev.id}/resources`, body);
      setDraft(EMPTY_RES);
      setEditing(null);
      await b.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("b.staff.failed"));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (r: Resource) => {
    try {
      await apiDelete(`/api/events/${ev.id}/resources/${r.id}`);
      await b.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("b.staff.failed"));
    }
  };

  return (
    <div className="space-y-5">
      <Card title={editing ? t("b.res.edit") : t("b.res.add")} description={t("b.res.help")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label={t("b.res.label")} value={draft.label} onChange={(v) => setDraft((d) => ({ ...d, label: v }))} maxLength={255} />
          <TextInput label={t("b.res.url")} value={draft.url} onChange={(v) => setDraft((d) => ({ ...d, url: v }))} placeholder="https://" />
          <TextInput className="sm:col-span-2" label={t("b.res.description")} value={draft.description} onChange={(v) => setDraft((d) => ({ ...d, description: v }))} optional={t("Optional")} />
          <DateTimeInput label={t("b.res.visible_from")} value={draft.visible_from} onChange={(v) => setDraft((d) => ({ ...d, visible_from: v }))}
            timeZone={zone} zoneLabel={zoneLabel} optional={t("Optional")} help={t("b.res.visible_help")} />
        </div>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => void save()} loading={busy}><Plus size={15} /> {editing ? t("Save") : t("b.res.add_btn")}</Button>
          {editing ? <Button variant="ghost" onClick={() => { setEditing(null); setDraft(EMPTY_RES); }}>{t("Cancel")}</Button> : null}
        </div>
      </Card>
      <Card title={t("b.res.list")}>
        {data.resources.length === 0 ? <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>{t("b.res.none")}</p> : null}
        <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
          {data.resources.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <Link2 size={15} style={{ color: "var(--ink-3)" }} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium" style={{ color: "var(--ink)" }}>{r.label}</p>
                <p className="truncate text-[12px]" style={{ color: "var(--ink-3)" }}>
                  {r.url || "—"}{r.visible_from ? ` · ${t("b.res.from")} ${formatInZone(r.visible_from, zone, lang)}` : ""}
                </p>
              </div>
              <button type="button" aria-label={t("Edit")} className="rounded p-1.5 hover:bg-[var(--tint)]"
                onClick={() => { setEditing(r.id); setDraft({ label: r.label, url: r.url || "", description: r.description || "", visible_from: r.visible_from }); }}><Pencil size={15} /></button>
              <button type="button" aria-label={t("Delete")} className="rounded p-1.5 hover:bg-[var(--tint)]" style={{ color: "var(--danger)" }} onClick={() => void remove(r)}><Trash2 size={15} /></button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export function CertificatesSection({ ev, set, err, t, has, catalog }: SectionCtx) {
  if (!has("certificates")) return <LockedPanel title={t("b.locked.title")} body={t("b.certs.locked")} />;
  const cc = ev.certificate_config;
  const setC = (patch: Partial<typeof cc>) => set({ certificate_config: { ...cc, ...patch } });
  const types = catalog?.certificateTypes || ["participation", "winners", "special", "judge", "mentor", "volunteer"];
  return (
    <div className="space-y-5">
      <Card title={t("b.certs.types")} description={t("b.certs.types_help")}>
        <div className="grid gap-2 sm:grid-cols-2">
          {types.map((ty) => (
            <label key={ty} className="inline-flex items-center gap-2 text-[13.5px]" style={{ color: "var(--ink)" }}>
              <input type="checkbox" className="h-4 w-4 accent-[var(--accent-solid)]" checked={cc.types.includes(ty)}
                onChange={(e) => setC({ types: e.target.checked ? [...cc.types, ty] : cc.types.filter((x) => x !== ty) })} />
              {t(`b.cert.${ty}`)}
            </label>
          ))}
        </div>
      </Card>
      <Card title={t("b.certs.signer")} description={t("b.certs.signer_help")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label={t("b.certs.signer_name")} value={cc.signerName} onChange={(v) => setC({ signerName: v })} maxLength={100} error={err("certificate_config.signerName")} />
          <TextInput label={t("b.certs.signer_title")} value={cc.signerTitle} onChange={(v) => setC({ signerTitle: v })} maxLength={100} error={err("certificate_config.signerTitle")} />
        </div>
        <ImageUpload eventId={ev.id} purpose="signature" url={cc.signatureFileId ? `/api/files/${cc.signatureFileId}` : null}
          label={t("b.certs.signature")} help={t("b.certs.signature_help")} shape="wide" maxW={900} maxH={300}
          onUploaded={(file) => setC({ signatureFileId: file.id })} onRemove={() => setC({ signatureFileId: null })} />
        <Toggle label={t("b.certs.after_results")} help={t("b.certs.after_results_help")} checked={cc.issueAfterResults} onChange={(v) => setC({ issueAfterResults: v })} />
      </Card>
    </div>
  );
}
