"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ds/primitives";
import { Card, Notice, NumberStepper, Select, TextArea, TextInput } from "../ui";
import { ImageUpload } from "../ImageUpload";
import { useListDraft } from "../useListDraft";
import type { Prize, Sponsor, Track } from "@/lib/builder/types";
import type { SectionCtx } from "./context";

function RowTools({ i, n, onMove, onRemove, t }: { i: number; n: number; onMove: (to: number) => void; onRemove: () => void; t: SectionCtx["t"] }) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" disabled={i === 0} aria-label={t("b.common.up")} onClick={() => onMove(i - 1)} className="rounded p-1.5 hover:bg-[var(--tint)] disabled:opacity-30"><ArrowUp size={15} /></button>
      <button type="button" disabled={i === n - 1} aria-label={t("b.common.down")} onClick={() => onMove(i + 1)} className="rounded p-1.5 hover:bg-[var(--tint)] disabled:opacity-30"><ArrowDown size={15} /></button>
      <button type="button" aria-label={t("Delete")} onClick={onRemove} className="rounded p-1.5 hover:bg-[var(--tint)]" style={{ color: "var(--danger)" }}><Trash2 size={15} /></button>
    </div>
  );
}

type DraftTrack = Track & { cid?: string };

export function TracksSection({ data, b, t }: SectionCtx) {
  const list = useListDraft<DraftTrack>("tracks", data.tracks as DraftTrack[],
    (x) => ({ name: x.name, description: x.description, sponsorId: x.sponsor_id }), b.saveList);
  return (
    <Card title={t("b.tracks.title")} description={t("b.tracks.help")}
      actions={<Button size="sm" variant="secondary" onClick={() => list.add({ id: 0, name: "", description: null, sponsor_id: null, sort_order: list.items.length } as DraftTrack)}><Plus size={14} /> {t("b.tracks.add")}</Button>}>
      {list.items.length === 0 ? <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>{t("b.tracks.none")}</p> : null}
      {list.items.map((tr, i) => (
        <div key={tr.id || tr.cid} className="space-y-3 rounded-[12px] border p-3.5" style={{ borderColor: "var(--line)" }}>
          <div className="flex items-start gap-3">
            <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[1fr_14rem]">
              <TextInput label={t("b.tracks.name")} value={tr.name} onChange={(v) => list.update(i, { name: v })} maxLength={120} error={list.errorOf(i, "name")} placeholder={t("b.tracks.name_ph")} />
              <Select label={t("b.tracks.sponsor")} value={tr.sponsor_id ? String(tr.sponsor_id) : ""} placeholder={t("b.tracks.no_sponsor")}
                onChange={(v) => list.update(i, { sponsor_id: v ? Number(v) : null })} error={list.errorOf(i, "sponsorId")}
                options={data.sponsors.map((s) => ({ value: String(s.id), label: s.name }))} />
            </div>
            <div className="pt-6"><RowTools i={i} n={list.items.length} t={t} onMove={(to) => list.move(i, to)} onRemove={() => list.remove(i)} /></div>
          </div>
          <TextArea label={t("b.tracks.description")} value={tr.description} onChange={(v) => list.update(i, { description: v })} rows={2} maxLength={2000} optional={t("Optional")} />
        </div>
      ))}
      {list.listError ? <Notice tone="danger">{list.listError}</Notice> : null}
    </Card>
  );
}

type DraftPrize = Prize & { cid?: string };

export function PrizesSection({ data, b, t }: SectionCtx) {
  const list = useListDraft<DraftPrize>("prizes", data.prizes as DraftPrize[],
    (x) => ({ kind: x.kind, position: x.position, trackId: x.track_id, name: x.name, value: x.value, description: x.description }), b.saveList);
  const nextPlace = () => Math.max(0, ...list.items.filter((p) => p.kind === "place").map((p) => p.position || 0)) + 1;
  return (
    <Card title={t("b.prizes.title")} description={t("b.prizes.help")}
      actions={<Button size="sm" variant="secondary" onClick={() => list.add({ id: 0, kind: "place", position: nextPlace(), track_id: null, name: "", value: null, description: null, sort_order: list.items.length } as DraftPrize)}><Plus size={14} /> {t("b.prizes.add")}</Button>}>
      {list.items.length === 0 ? <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>{t("b.prizes.none")}</p> : null}
      {list.items.map((p, i) => (
        <div key={p.id || p.cid} className="space-y-3 rounded-[12px] border p-3.5" style={{ borderColor: "var(--line)" }}>
          <div className="flex items-start gap-3">
            <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-3">
              <Select label={t("b.prizes.kind")} value={p.kind} onChange={(v) => list.update(i, { kind: v as Prize["kind"], position: v === "place" ? (p.position || nextPlace()) : null, track_id: v === "track" ? p.track_id : null })}
                options={[{ value: "place", label: t("b.prizes.place") }, { value: "special", label: t("b.prizes.special") }, { value: "track", label: t("b.prizes.track") }]} />
              {p.kind === "place" ? (
                <NumberStepper label={t("b.prizes.position")} value={p.position} min={1} max={20} onChange={(v) => list.update(i, { position: v })} error={list.errorOf(i, "position")} />
              ) : p.kind === "track" ? (
                <Select label={t("b.prizes.for_track")} value={p.track_id ? String(p.track_id) : ""} placeholder={t("b.common.choose")}
                  onChange={(v) => list.update(i, { track_id: v ? Number(v) : null })} error={list.errorOf(i, "trackId")}
                  options={data.tracks.map((tr) => ({ value: String(tr.id), label: tr.name }))} />
              ) : <div />}
              <TextInput label={t("b.prizes.value")} value={p.value} onChange={(v) => list.update(i, { value: v })} maxLength={120} placeholder={t("b.prizes.value_ph")} error={list.errorOf(i, "value")} />
            </div>
            <div className="pt-6"><RowTools i={i} n={list.items.length} t={t} onMove={(to) => list.move(i, to)} onRemove={() => list.remove(i)} /></div>
          </div>
          <TextInput label={t("b.prizes.name")} value={p.name} onChange={(v) => list.update(i, { name: v })} maxLength={120} error={list.errorOf(i, "name")} placeholder={t("b.prizes.name_ph")} />
          <TextInput label={t("b.prizes.description")} value={p.description} onChange={(v) => list.update(i, { description: v })} maxLength={1000} optional={t("Optional")} />
        </div>
      ))}
      {data.tracks.length === 0 ? <p className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>{t("b.prizes.track_hint")}</p> : null}
      {list.listError ? <Notice tone="danger">{list.listError}</Notice> : null}
    </Card>
  );
}

type DraftSponsor = Sponsor & { cid?: string };

export function SponsorsSection({ data, b, t, ev, catalog }: SectionCtx) {
  const list = useListDraft<DraftSponsor>("sponsors", data.sponsors as DraftSponsor[],
    (x) => ({ name: x.name, tier: x.tier, website: x.website, description: x.description, logoFileId: x.logo_file_id }), b.saveList);
  const tiers = catalog?.sponsorTiers || ["platinum", "gold", "silver", "bronze", "partner"];
  return (
    <Card title={t("b.sponsors.title")} description={t("b.sponsors.help")}
      actions={<Button size="sm" variant="secondary" onClick={() => list.add({ id: 0, name: "", tier: "gold", website: null, description: null, logo_file_id: null, logo_url: null, sort_order: list.items.length } as DraftSponsor)}><Plus size={14} /> {t("b.sponsors.add")}</Button>}>
      {list.items.length === 0 ? <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>{t("b.sponsors.none")}</p> : null}
      {list.items.map((s, i) => (
        <div key={s.id || s.cid} className="space-y-3 rounded-[12px] border p-3.5" style={{ borderColor: "var(--line)" }}>
          <div className="flex items-start gap-3">
            <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-3">
              <TextInput label={t("b.sponsors.name")} value={s.name} onChange={(v) => list.update(i, { name: v })} maxLength={120} error={list.errorOf(i, "name")} />
              <Select label={t("b.sponsors.tier")} value={s.tier || ""} onChange={(v) => list.update(i, { tier: v || null })} placeholder={t("b.sponsors.no_tier")}
                options={tiers.map((x) => ({ value: x, label: t(`b.tier.${x}`) }))} error={list.errorOf(i, "tier")} />
              <TextInput label={t("b.sponsors.website")} value={s.website} onChange={(v) => list.update(i, { website: v })} placeholder="https://" error={list.errorOf(i, "website")} />
            </div>
            <div className="pt-6"><RowTools i={i} n={list.items.length} t={t} onMove={(to) => list.move(i, to)} onRemove={() => list.remove(i)} /></div>
          </div>
          <ImageUpload eventId={ev.id} purpose="sponsor_logo" url={s.logo_url} label={t("b.sponsors.logo")} help={t("b.sponsors.logo_help")} maxW={600} maxH={300}
            onUploaded={(file) => list.update(i, { logo_file_id: file.id, logo_url: file.url })} onRemove={() => list.update(i, { logo_file_id: null, logo_url: null })} />
          {list.errorOf(i, "logoFileId") ? <p role="alert" className="text-[12.5px]" style={{ color: "var(--danger)" }}>{list.errorOf(i, "logoFileId")}</p> : null}
        </div>
      ))}
      {list.listError ? <Notice tone="danger">{list.listError}</Notice> : null}
    </Card>
  );
}
