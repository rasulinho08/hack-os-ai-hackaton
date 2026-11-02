"use client";

/**
 * An organiser makes a team: a name, the people (approved participants
 * without a team — the only ones the API accepts) and who leads it. The
 * organiser is not put on the team.
 *
 * Mounted while open, so every new team starts from an empty form.
 */

import { useMemo, useState } from "react";
import { Crown, Search } from "lucide-react";
import { Modal } from "@/components/ds/overlays";
import { Badge, Button } from "@/components/ds/primitives";
import { Select, TextInput } from "@/components/builder/ui";
import { useTranslation } from "@/contexts/LanguageContext";
import { fill } from "@/lib/i18n/fill";
import type { Teamless } from "@/lib/teamsAdmin";

export interface NewTeamInput {
  name: string;
  memberIds: number[];
  leaderId: number | null;
}

export function NewTeamModal({
  open,
  people,
  maxSize,
  busy,
  error,
  onCreate,
  onClose,
}: {
  open: boolean;
  people: Teamless[];
  maxSize: number;
  busy?: boolean;
  error?: string | null;
  onCreate: (input: NewTeamInput) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<number[]>([]);
  const [lead, setLead] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [tried, setTried] = useState(false);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => `${p.name} ${p.email} ${p.skills.join(" ")}`.toLowerCase().includes(q));
  }, [people, query]);

  const toggle = (id: number) => {
    if (chosen.includes(id)) {
      setChosen(chosen.filter((x) => x !== id));
      if (lead === id) setLead(null);
    } else if (chosen.length < maxSize) {
      setChosen([...chosen, id]);
    }
  };

  const nameError = tried && name.trim().length < 2 ? t("tm.form.err_name") : null;
  const effectiveLead = lead != null && chosen.includes(lead) ? lead : chosen[0] ?? null;
  const byId = new Map(people.map((p) => [p.userId, p]));

  const submit = () => {
    setTried(true);
    if (name.trim().length < 2) return;
    onCreate({ name: name.trim(), memberIds: chosen, leaderId: effectiveLead });
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={t("tm.new")}
      width={600}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12.5px]" style={{ color: error ? "var(--danger)" : "var(--ink-3)" }} role={error ? "alert" : undefined}>
            {error || fill(t("tm.form.chosen"), { n: chosen.length, max: maxSize })}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>{t("tm.form.cancel")}</Button>
            <Button size="sm" variant="primary" onClick={submit} loading={busy} disabled={busy}>{t("tm.form.create")}</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <TextInput label={t("tm.form.name")} value={name} onChange={setName} placeholder={t("tm.form.name_ph")} maxLength={100} required error={nameError} />

        <div>
          <p className="text-[13px] font-medium" style={{ color: "var(--ink)" }}>{t("tm.form.members")}</p>
          <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>{t("tm.form.members_hint")}</p>
          {people.length ? (
            <>
              <label className="relative mt-2.5 block">
                <span className="sr-only">{t("tm.form.search")}</span>
                <Search size={14} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--ink-3)" }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("tm.form.search")}
                  className="h-9 w-full rounded-[var(--radius-sm)] border pl-8 pr-3 text-[13px] outline-none"
                  style={{ borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink)" }}
                />
              </label>
              <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1" aria-label={t("tm.form.members")}>
                {shown.map((p) => {
                  const on = chosen.includes(p.userId);
                  const disabled = !on && chosen.length >= maxSize;
                  return (
                    <li key={p.userId}>
                      <label
                        className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-sm)] border px-3 py-2"
                        style={{
                          borderColor: on ? "var(--accent-solid)" : "var(--line)",
                          background: on ? "var(--accent-weak)" : "var(--surface)",
                          opacity: disabled ? 0.55 : 1,
                        }}
                      >
                        <input type="checkbox" className="mt-1" checked={on} disabled={disabled} onChange={() => toggle(p.userId)} />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium" style={{ color: "var(--ink)" }}>
                            {p.name}
                            {p.looking ? <Badge tone="info">{t("pt.looking")}</Badge> : null}
                          </span>
                          <span className="block truncate text-[12px]" style={{ color: "var(--ink-3)" }}>
                            {p.email}{p.skills.length ? ` · ${p.skills.slice(0, 5).join(", ")}` : ""}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="mt-2 rounded-[var(--radius-sm)] px-3 py-3 text-[13px]" style={{ background: "var(--tint)", color: "var(--ink-2)" }}>
              {t("tm.drawer.nobody")}
            </p>
          )}
        </div>

        {chosen.length > 1 ? (
          <Select
            label={<span className="inline-flex items-center gap-1.5"><Crown size={13} aria-hidden="true" style={{ color: "var(--warn)" }} />{t("tm.form.lead")}</span>}
            value={String(effectiveLead ?? "")}
            onChange={(v) => setLead(v ? Number(v) : null)}
            options={chosen.map((id) => ({ value: String(id), label: byId.get(id)?.name || String(id) }))}
            help={t("tm.form.lead_hint")}
          />
        ) : null}
      </div>
    </Modal>
  );
}
