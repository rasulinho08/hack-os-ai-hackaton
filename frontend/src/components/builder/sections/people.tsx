"use client";

import { useCallback, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, User, Users, UsersRound, X } from "lucide-react";
import { Button } from "@/components/ds/primitives";
import { Card, ChipsInput, Notice, NumberStepper, Segmented, Select, SoonBadge, TextInput, Toggle } from "../ui";
import { useListDraft } from "../useListDraft";
import { countryName, countryOptions } from "@/lib/builder/countries";
import type { FormField } from "@/lib/builder/types";
import { capacityChange } from "@/lib/builder/capacity";
import type { SectionCtx } from "./context";

export function RegistrationSection({ ev, data, set, err, t, f }: SectionCtx) {
  const limit = data.limits.participants;
  const teams = ev.registration_mode !== "solo";
  return (
    <div className="space-y-5">
      <Card title={t("b.reg.mode")} description={t("b.reg.mode_help")}>
        <Segmented value={ev.registration_mode} onChange={(v) => set({ registration_mode: v })} error={err("registration_mode")}
          options={[
            { value: "both", label: t("b.reg.both"), hint: t("b.reg.both_hint"), icon: <UsersRound size={15} /> },
            { value: "team", label: t("b.reg.team"), hint: t("b.reg.team_hint"), icon: <Users size={15} /> },
            { value: "solo", label: t("b.reg.solo"), hint: t("b.reg.solo_hint"), icon: <User size={15} /> },
          ]} />
        {teams ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberStepper label={t("b.reg.team_min")} value={ev.min_team_size} min={1} max={ev.team_size_limit || 50}
              onChange={(v) => set({ min_team_size: v ?? 1 })} error={err("min_team_size")} suffix={t("b.reg.people")} />
            <NumberStepper label={t("b.reg.team_max")} value={ev.team_size_limit} min={Math.max(2, ev.min_team_size || 1)} max={50}
              onChange={(v) => set({ team_size_limit: v ?? 2 })} error={err("team_size_limit")} suffix={t("b.reg.people")} />
          </div>
        ) : null}
      </Card>
      <Card title={t("b.reg.capacity")} description={t("b.reg.capacity_help")}>
        <CapacityField value={ev.max_participants} taken={data.capacity.taken} max={limit ?? 100000} t={t} f={f}
          onSave={(v) => set({ max_participants: v })} error={err("max_participants")}
          help={limit != null ? f("b.reg.plan_limit", { limit }) : t("b.reg.no_plan_limit")} />
        <p className="text-[12.5px]" style={{ color: "var(--ink-2)" }}>
          {f("b.reg.now", { taken: data.capacity.taken, waitlisted: data.capacity.waitlisted })}
        </p>
        <Toggle label={t("b.reg.waitlist")} help={t("b.reg.waitlist_help")} checked={ev.waitlist_enabled} onChange={(v) => set({ waitlist_enabled: v })} />
      </Card>
      <Card title={t("b.reg.approval")} description={t("b.reg.approval_help")}>
        <Segmented value={ev.approval_mode} onChange={(v) => set({ approval_mode: v })} error={err("approval_mode")}
          options={[
            { value: "manual", label: t("b.reg.manual"), hint: t("b.reg.manual_hint") },
            { value: "team", label: t("b.reg.by_team"), hint: t("b.reg.by_team_hint") },
            { value: "auto", label: t("b.reg.auto"), hint: t("b.reg.auto_hint") },
          ]} />
      </Card>
    </div>
  );
}

/**
 * The participant limit. A limit below the people already holding places is
 * held back until the organiser confirms it (see lib/builder/capacity).
 */
function CapacityField({ value, taken, max, onSave, error, help, t, f }: {
  value: number | null; taken: number; max: number; onSave: (v: number | null) => void;
  error: string | null; help: string; t: SectionCtx["t"]; f: SectionCtx["f"];
}) {
  // A limit waiting for the organiser's yes; otherwise the field shows what is saved.
  const [pending, setPending] = useState<number | null>(null);
  const held = pending != null;
  const draft = held ? pending : value;
  const change = (v: number | null) => {
    if (capacityChange(v, taken) === "confirm") { setPending(v); return; }
    setPending(null);
    onSave(v);
  };
  return (
    <div className="space-y-2">
      <NumberStepper label={t("b.reg.max")} value={draft} min={1} max={max} nullable nullLabel={t("b.reg.no_limit")}
        onChange={change} error={error} help={help} />
      {held && draft != null ? (
        <div role="alert" className="space-y-2.5 rounded-[12px] border px-3.5 py-3 text-[13px]" style={{ borderColor: "var(--warn)", background: "var(--warn-weak)", color: "var(--ink)" }}>
          <p className="font-semibold">{f("b.reg.below_taken_title", { taken, n: draft })}</p>
          <p style={{ color: "var(--ink-2)" }}>{f("b.reg.below_taken_body", { taken, n: draft })}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => { setPending(null); onSave(draft); }}>{f("b.reg.below_taken_confirm", { n: draft })}</Button>
            <Button size="sm" variant="secondary" onClick={() => setPending(null)}>
              {value == null ? t("b.reg.below_taken_keep_none") : f("b.reg.below_taken_keep", { n: value })}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The standard fields eligibility needs, and whether they are asked as required. */
function useFormFix({ data, b }: SectionCtx) {
  return useCallback(async (key: string) => {
    const items = data.fields.map((fl) => ({
      id: fl.id, key: fl.field_key, kind: fl.kind, type: fl.type, label: fl.label, help: fl.help, options: fl.options,
      enabled: fl.field_key === key ? true : fl.enabled,
      required: fl.field_key === key ? true : fl.required,
      sensitive: fl.sensitive,
    }));
    await b.saveList("form", items);
  }, [data.fields, b]);
}

export function EligibilitySection(ctx: SectionCtx) {
  const { ev, data, set, err, t, lang } = ctx;
  const fix = useFormFix(ctx);
  const e = ev.eligibility;
  const setE = (patch: Partial<typeof e>) => set({ eligibility: { ...e, ...patch } });
  const field = (k: string) => data.fields.find((x) => x.field_key === k);
  const askedRequired = (k: string) => Boolean(field(k)?.enabled && field(k)?.required);
  const needs: { key: string; when: boolean }[] = [
    { key: "age", when: e.minAge != null || e.maxAge != null },
    { key: "country", when: e.countries.length > 0 },
    { key: "university", when: e.studentsOnly },
  ];
  return (
    <div className="space-y-5">
      <Card title={t("b.elig.age")} description={t("b.elig.age_help")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberStepper label={t("b.elig.min_age")} value={e.minAge} min={10} max={99} nullable nullLabel={t("b.elig.any")}
            onChange={(v) => setE({ minAge: v })} error={err("eligibility.minAge")} />
          <NumberStepper label={t("b.elig.max_age")} value={e.maxAge} min={10} max={120} nullable nullLabel={t("b.elig.any")}
            onChange={(v) => setE({ maxAge: v })} error={err("eligibility.maxAge")} />
        </div>
      </Card>
      <Card title={t("b.elig.where")} description={t("b.elig.where_help")}>
        <Select label={t("b.elig.add_country")} value="" placeholder={t("b.elig.add_country_ph")}
          options={countryOptions(lang).filter((o) => !e.countries.includes(o.value))}
          onChange={(v) => v && setE({ countries: [...e.countries, v] })} error={err("eligibility.countries")} />
        {e.countries.length ? (
          <div className="flex flex-wrap gap-1.5">
            {e.countries.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px]" style={{ background: "var(--tint)", color: "var(--ink)" }}>
                {countryName(c, lang)}
                <button type="button" aria-label={`× ${c}`} onClick={() => setE({ countries: e.countries.filter((x) => x !== c) })}><X size={12} /></button>
              </span>
            ))}
          </div>
        ) : <p className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>{t("b.elig.all_countries")}</p>}
        <ChipsInput label={t("b.elig.cities")} values={e.cities} onChange={(v) => setE({ cities: v })} placeholder={t("b.elig.cities_ph")}
          help={t("b.elig.cities_help")} error={err("eligibility.cities")} />
      </Card>
      <Card title={t("b.elig.who")}>
        <Toggle label={t("b.elig.students")} help={t("b.elig.students_help")} checked={e.studentsOnly} onChange={(v) => setE({ studentsOnly: v })} />
        <Toggle label={t("b.elig.rules")} help={t("b.elig.rules_help")} checked={e.requireRules} onChange={(v) => setE({ requireRules: v })} />
        <Toggle label={t("b.elig.coc")} help={t("b.elig.coc_help")} checked={e.requireCoc} onChange={(v) => setE({ requireCoc: v })} />
      </Card>
      {needs.filter((n) => n.when && !askedRequired(n.key)).map((n) => (
        <Notice key={n.key} tone="warn">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{t(`b.elig.needs_${n.key}`)}</span>
            <Button size="sm" variant="secondary" onClick={() => void fix(n.key)}>{t("b.elig.fix")}</Button>
          </div>
        </Notice>
      ))}
    </div>
  );
}

type DraftField = FormField & { cid?: string };

const fieldPayload = (fl: DraftField) => ({
  key: fl.field_key, kind: fl.kind, type: fl.type, label: fl.label, help: fl.help, options: fl.options,
  required: fl.required, enabled: fl.enabled, sensitive: fl.sensitive,
});

export function FormSection(ctx: SectionCtx) {
  const { data, b, t, has, catalog, f } = ctx;
  const list = useListDraft<DraftField>("form", data.fields as DraftField[], fieldPayload, b.saveList);
  const customAllowed = has("forms");
  const types = catalog?.customFieldTypes || ["text", "textarea", "select", "multiselect", "checkbox", "number", "date", "url", "file"];

  return (
    <div className="space-y-5">
      <Notice tone="info">{t("b.form.account_note")}</Notice>
      <Card title={t("b.form.standard")} description={t("b.form.standard_help")}>
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[13px]">
            <thead>
              <tr style={{ color: "var(--ink-3)" }}>
                <th className="px-1 pb-2 font-medium">{t("b.form.field")}</th>
                <th className="px-1 pb-2 text-center font-medium">{t("b.form.ask")}</th>
                <th className="px-1 pb-2 text-center font-medium">{t("b.form.required")}</th>
                <th className="px-1 pb-2 text-center font-medium">{t("b.form.sensitive")}</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((fl, i) => fl.kind !== "standard" ? null : (
                <tr key={fl.id || fl.cid} className="border-t" style={{ borderColor: "var(--line)" }}>
                  <td className="px-1 py-2.5">
                    <span className="font-medium" style={{ color: "var(--ink)" }}>{t(`b.field.${fl.field_key}`)}</span>
                  </td>
                  <td className="px-1 py-2.5 text-center">
                    <input type="checkbox" aria-label={`${t("b.form.ask")}: ${t(`b.field.${fl.field_key}`)}`} checked={fl.enabled}
                      onChange={(e) => list.update(i, { enabled: e.target.checked, required: e.target.checked ? fl.required : false })} className="h-4 w-4 accent-[var(--accent-solid)]" />
                  </td>
                  <td className="px-1 py-2.5 text-center">
                    <input type="checkbox" aria-label={`${t("b.form.required")}: ${t(`b.field.${fl.field_key}`)}`} checked={fl.required} disabled={!fl.enabled}
                      onChange={(e) => list.update(i, { required: e.target.checked })} className="h-4 w-4 accent-[var(--accent-solid)]" />
                  </td>
                  <td className="px-1 py-2.5 text-center">
                    <input type="checkbox" aria-label={`${t("b.form.sensitive")}: ${t(`b.field.${fl.field_key}`)}`} checked={fl.sensitive}
                      onChange={(e) => list.update(i, { sensitive: e.target.checked })} className="h-4 w-4 accent-[var(--accent-solid)]" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[12px]" style={{ color: "var(--ink-3)" }}>{t("b.form.sensitive_help")}</p>
      </Card>

      <Card title={t("b.form.custom")} description={customAllowed ? t("b.form.custom_help") : t("b.form.custom_locked")}
        actions={customAllowed ? (
          <Button size="sm" variant="secondary" onClick={() => list.add({
            id: 0, field_key: "", kind: "custom", type: "text", label: "", help: null, options: [], required: false, enabled: true, sensitive: false, sort_order: list.items.length,
          } as DraftField)}>
            <Plus size={14} /> {t("b.form.add")}
          </Button>
        ) : undefined}>
        {list.items.filter((x) => x.kind === "custom").length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>{t("b.form.none")}</p>
        ) : null}
        {list.items.map((fl, i) => fl.kind !== "custom" ? null : (
          <div key={fl.id || fl.cid} className="space-y-3 rounded-[12px] border p-3.5" style={{ borderColor: "var(--line)" }}>
            <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
              <TextInput label={t("b.form.question")} value={fl.label} onChange={(v) => list.update(i, { label: v })} maxLength={200} error={list.errorOf(i, "label")} />
              <Select label={t("b.form.type")} value={fl.type} onChange={(v) => list.update(i, { type: v })} error={list.errorOf(i, "type")}
                options={types.map((ty) => ({ value: ty, label: t(`b.ftype.${ty}`) }))} />
            </div>
            <TextInput label={t("b.form.help")} value={fl.help} onChange={(v) => list.update(i, { help: v })} maxLength={300} optional={t("Optional")} error={list.errorOf(i, "help")} />
            {fl.type === "select" || fl.type === "multiselect" ? (
              <ChipsInput label={t("b.form.options")} values={fl.options || []} onChange={(v) => list.update(i, { options: v })} placeholder={t("b.form.options_ph")} error={list.errorOf(i, "options")} />
            ) : null}
            {fl.type === "file" ? <p className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>{t("b.form.file_help")}</p> : null}
            {fl.answer_count ? <p className="text-[12px]" style={{ color: "var(--ink-3)" }}>{f("b.form.answered", { n: fl.answer_count })}</p> : null}
            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-2 text-[13px]" style={{ color: "var(--ink)" }}>
                <input type="checkbox" checked={fl.required} onChange={(e) => list.update(i, { required: e.target.checked })} className="h-4 w-4 accent-[var(--accent-solid)]" /> {t("b.form.required")}
              </label>
              <label className="inline-flex items-center gap-2 text-[13px]" style={{ color: "var(--ink)" }}>
                <input type="checkbox" checked={fl.sensitive} onChange={(e) => list.update(i, { sensitive: e.target.checked })} className="h-4 w-4 accent-[var(--accent-solid)]" /> {t("b.form.sensitive")}
              </label>
              <span className="flex-1" />
              <button type="button" aria-label={t("b.common.up")} onClick={() => list.move(i, i - 1)} className="rounded p-1.5 hover:bg-[var(--tint)]"><ArrowUp size={15} /></button>
              <button type="button" aria-label={t("b.common.down")} onClick={() => list.move(i, i + 1)} className="rounded p-1.5 hover:bg-[var(--tint)]"><ArrowDown size={15} /></button>
              <button type="button" aria-label={t("Delete")} onClick={() => list.remove(i)} className="rounded p-1.5 hover:bg-[var(--tint)]" style={{ color: "var(--danger)" }}><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
        {list.listError ? <Notice tone="danger">{list.listError}</Notice> : null}
        {!customAllowed ? <SoonBadge>{t("b.locked.plan_badge")}</SoonBadge> : null}
      </Card>
    </div>
  );
}
