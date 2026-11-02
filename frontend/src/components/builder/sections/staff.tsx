"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Clock3, Link2, Mail, Plus, Trash2, UserCheck } from "lucide-react";
import { Button } from "@/components/ds/primitives";
import { useToast } from "@/contexts/ToastContext";
import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";
import { fill } from "@/lib/i18n/fill";
import { Card, DateTimeInput, LockedPanel, Notice, NumberStepper, Segmented, TextInput, Toggle } from "../ui";
import { useListDraft } from "../useListDraft";
import type { Criterion, PendingInvite, StaffMember } from "@/lib/builder/types";
import type { SectionCtx } from "./context";

type DraftCriterion = Criterion & { cid?: string };

export function JudgingSection({ data, b, t, ev, set, err, has, f, zone, zoneLabel }: SectionCtx) {
  const list = useListDraft<DraftCriterion>("criteria", data.criteria as DraftCriterion[],
    (x) => ({ name: x.name, description: x.description, maxScore: x.max_score, weight: Number(x.weight) }), b.saveList);
  if (!has("judging")) return <LockedPanel title={t("b.locked.title")} body={t("b.judging.locked")} />;
  const totalWeight = list.items.reduce((s, c) => s + (Number(c.weight) || 0), 0) || 1;
  const jc = ev.judging_config;
  const setJ = (patch: Partial<typeof jc>) => set({ judging_config: { ...jc, ...patch } });
  return (
    <div className="space-y-5">
      <Card title={t("b.judging.criteria")} description={t("b.judging.criteria_help")}
        actions={<Button size="sm" variant="secondary" onClick={() => list.add({ id: 0, name: "", description: null, max_score: 10, weight: 1, sort_order: list.items.length } as DraftCriterion)}><Plus size={14} /> {t("b.judging.add")}</Button>}>
        {list.items.length === 0 ? <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>{t("b.judging.none")}</p> : null}
        {list.items.map((c, i) => (
          <div key={c.id || c.cid} className="space-y-3 rounded-[12px] border p-3.5" style={{ borderColor: "var(--line)" }}>
            <div className="flex items-start gap-3">
              <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[1fr_9rem_9rem]">
                <TextInput label={t("b.judging.name")} value={c.name} onChange={(v) => list.update(i, { name: v })} maxLength={120} error={list.errorOf(i, "name")} />
                <NumberStepper label={t("b.judging.max")} value={c.max_score} min={1} max={100} onChange={(v) => list.update(i, { max_score: v ?? 10 })} error={list.errorOf(i, "maxScore")} />
                <TextInput label={t("b.judging.weight")} value={String(c.weight)} inputMode="decimal"
                  onChange={(v) => list.update(i, { weight: v.replace(",", ".") as unknown as number })} error={list.errorOf(i, "weight")}
                  help={`${Math.round(((Number(c.weight) || 0) / totalWeight) * 100)}%`} />
              </div>
              <div className="flex items-center gap-1 pt-6">
                <button type="button" disabled={i === 0} aria-label={t("b.common.up")} onClick={() => list.move(i, i - 1)} className="rounded p-1.5 hover:bg-[var(--tint)] disabled:opacity-30"><ArrowUp size={15} /></button>
                <button type="button" disabled={i === list.items.length - 1} aria-label={t("b.common.down")} onClick={() => list.move(i, i + 1)} className="rounded p-1.5 hover:bg-[var(--tint)] disabled:opacity-30"><ArrowDown size={15} /></button>
                <button type="button" aria-label={t("Delete")} onClick={() => list.remove(i)} className="rounded p-1.5 hover:bg-[var(--tint)]" style={{ color: "var(--danger)" }}><Trash2 size={15} /></button>
              </div>
            </div>
            <TextInput label={t("b.judging.description")} value={c.description} onChange={(v) => list.update(i, { description: v })} maxLength={1000} optional={t("Optional")} />
            {c.score_count ? <p className="text-[12px]" style={{ color: "var(--ink-3)" }}>{f("b.judging.scored", { n: c.score_count })}</p> : null}
          </div>
        ))}
        {list.listError ? <Notice tone="danger">{list.listError}</Notice> : null}
      </Card>
      <Card title={t("b.judging.how")} description={t("b.judging.how_help")}>
        <Toggle label={t("b.judging.blind")} help={t("b.judging.blind_help")} checked={jc.blind} onChange={(v) => setJ({ blind: v })} />
        <Toggle label={t("b.judging.coi")} help={t("b.judging.coi_help")} checked={Boolean(jc.coiRequired)} onChange={(v) => setJ({ coiRequired: v })} />
        <Segmented label={t("b.judging.assignment")}
          value={jc.assignment} onChange={(v) => setJ({ assignment: v })} error={err("judging_config.assignment")}
          options={[
            { value: "all", label: t("b.judging.assign_all"), hint: t("b.judging.assign_all_hint") },
            { value: "track", label: t("b.judging.assign_track"), hint: t("b.judging.assign_track_hint") },
            { value: "per_team", label: t("b.judging.assign_n"), hint: t("b.judging.assign_n_hint") },
          ]} />
        {jc.assignment === "per_team" ? (
          <NumberStepper label={t("b.judging.per_team")} value={jc.judgesPerTeam} min={1} max={20} onChange={(v) => setJ({ judgesPerTeam: v ?? 1 })} error={err("judging_config.judgesPerTeam")} />
        ) : null}
        <Segmented label={t("b.judging.results")}
          value={jc.resultsVisibility} onChange={(v) => setJ({ resultsVisibility: v })}
          options={[
            { value: "own_and_winners", label: t("b.judging.res_own"), hint: t("b.judging.res_own_hint") },
            { value: "winners", label: t("b.judging.res_winners"), hint: t("b.judging.res_winners_hint") },
            { value: "full", label: t("b.judging.res_full"), hint: t("b.judging.res_full_hint") },
          ]} />
        <Toggle label={t("b.judging.show_scores")}
          help={jc.resultsVisibility === "winners" ? `${t("b.judging.show_scores_help")} ${t("b.judging.show_scores_winners")}` : t("b.judging.show_scores_help")}
          checked={Boolean(jc.showScores)} onChange={(v) => setJ({ showScores: v })} />
        <Toggle label={t("b.judging.people_choice")} help={t("b.judging.people_choice_help")}
          checked={Boolean(jc.peopleChoice)} onChange={(v) => setJ({ peopleChoice: v })} />
        {jc.peopleChoice ? (
          <DateTimeInput label={t("b.judging.voting_start")} value={jc.votingStart ?? null} onChange={(v) => setJ({ votingStart: v })}
            timeZone={zone} zoneLabel={zoneLabel} error={err("judging_config.votingStart")} help={t("b.judging.voting_start_help")} optional={t("Optional")} />
        ) : null}
      </Card>
    </div>
  );
}

const REMOVE_PATH: Record<string, (eventId: number, id: number) => string> = {
  judge: (e, id) => `/api/events/${e}/judging/judges/${id}`,
  mentor: (e, id) => `/api/events/${e}/mentors/${id}`,
  volunteer: (e, id) => `/api/events/${e}/volunteers/${id}`,
};

function StaffPanel({
  ctx, role, people, extraLabel, extraKey,
}: {
  ctx: SectionCtx;
  role: "judge" | "mentor" | "volunteer";
  people: StaffMember[];
  extraLabel?: string;
  extraKey?: "expertise" | "tasks";
}) {
  const { ev, data, b, t } = ctx;
  const [email, setEmail] = useState("");
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ tone: "ok" | "info"; text: string } | null>(null);
  // Invite links fetched here, shown under their row to copy by hand as well.
  const [links, setLinks] = useState<Record<number, string>>({});
  const [linking, setLinking] = useState<number | null>(null);
  const { toast } = useToast();
  const invites = data.staff.invites.filter((i) => i.role === role);

  const invite = async () => {
    const addr = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) { setError(t("b.staff.bad_email")); return; }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await apiPost<{ assigned?: boolean; awaitingVerification?: boolean; emailed?: boolean }>(`/api/events/${ev.id}/invites`, {
        email: addr, role, meta: extraKey && extra.trim() ? { [extraKey]: extra.trim() } : {},
        ...(extraKey === "expertise" && extra.trim() ? { expertise: extra.trim() } : {}),
        ...(extraKey === "tasks" && extra.trim() ? { assignedTasks: extra.trim() } : {}),
      });
      // An unconfirmed account with this address: the role opens once it is confirmed.
      setDone(res?.awaitingVerification
        ? { tone: "info", text: fill(t("ve.awaiting_verification"), { email: addr }) }
        : res?.assigned
          ? { tone: "ok", text: t("b.staff.added") }
          // No account yet: say whether the invitation went by e-mail or has to be passed on by hand.
          : res?.emailed
            ? { tone: "ok", text: t("b.staff.invited_mailed") }
            : { tone: "info", text: t("b.staff.invited_link") });
      setEmail("");
      setExtra("");
      await b.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("b.staff.failed"));
    } finally {
      setBusy(false);
    }
  };

  const removePerson = async (p: StaffMember) => {
    try {
      await apiDelete(REMOVE_PATH[role](ev.id, p.id));
      await b.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("b.staff.failed"));
    }
  };
  const removeInvite = async (inv: PendingInvite) => {
    try {
      await apiDelete(`/api/events/${ev.id}/invites/${inv.id}`);
      await b.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("b.staff.failed"));
    }
  };
  // The invitation's own link, for passing on in a chat or by phone: it opens this invitation for its address only.
  const copyInviteLink = async (inv: PendingInvite) => {
    setLinking(inv.id);
    try {
      const out = await apiGet<{ url?: string }>(`/api/events/${ev.id}/invites/${inv.id}/link`);
      if (!out?.url) throw new Error("no link");
      const url = out.url;
      setLinks((prev) => ({ ...prev, [inv.id]: url }));
      try {
        await navigator.clipboard.writeText(url);
        toast(fill(t("ve.invite_link_copied"), { email: inv.email }), "success");
      } catch {
        /* the link is shown under the row to copy by hand */
      }
    } catch (err) {
      if (err instanceof ApiError && (err.status === 409 || err.code === "INVITE_USED")) {
        toast(t("ve.invite_used"), "info");
        await b.reload();
      } else {
        toast(t("ve.invite_link_failed"), "error");
      }
    } finally {
      setLinking(null);
    }
  };

  return (
    <div className="space-y-5">
      <Card title={t(`b.staff.${role}_invite`)} description={t(`b.staff.${role}_invite_help`)}>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label={t("b.staff.email")} type="email" value={email} onChange={setEmail} placeholder="name@example.com" error={error} autoComplete="off" />
            {extraLabel ? <TextInput label={extraLabel} value={extra} onChange={setExtra} optional={t("Optional")} maxLength={extraKey === "tasks" ? 500 : 200} /> : null}
          </div>
          <Button variant="primary" onClick={() => void invite()} loading={busy} disabled={!email.trim()}><Mail size={15} /> {t("b.staff.send")}</Button>
        </div>
        {done ? <Notice tone={done.tone}>{done.text}</Notice> : null}
      </Card>
      <Card title={t(`b.staff.${role}_list`)}>
        {people.length === 0 && invites.length === 0 ? <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>{t("b.staff.none")}</p> : null}
        <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
          {people.map((p) => (
            <li key={`p${p.id}`} className="flex items-center gap-3 py-2.5">
              <UserCheck size={16} style={{ color: "var(--ok)" }} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium" style={{ color: "var(--ink)" }}>{p.full_name}</p>
                <p className="truncate text-[12px]" style={{ color: "var(--ink-3)" }}>{p.email}{p.expertise ? ` · ${p.expertise}` : ""}{p.assigned_tasks ? ` · ${p.assigned_tasks}` : ""}</p>
              </div>
              <button type="button" onClick={() => void removePerson(p)} className="rounded p-1.5 hover:bg-[var(--tint)]" aria-label={`${t("Remove")} ${p.full_name}`} style={{ color: "var(--danger)" }}><Trash2 size={15} /></button>
            </li>
          ))}
          {invites.map((inv) => (
            <li key={`i${inv.id}`} className="py-2.5">
              <div className="flex items-center gap-3">
                <Clock3 size={16} style={{ color: "var(--warn)" }} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px]" style={{ color: "var(--ink)" }}>{inv.email}</p>
                  <p className="truncate text-[12px]" style={{ color: "var(--ink-3)" }}>{t("b.staff.pending")}{inv.meta?.expertise ? ` · ${inv.meta.expertise}` : ""}{inv.meta?.tasks ? ` · ${inv.meta.tasks}` : ""}</p>
                  {inv.awaiting_verification ? (
                    <p className="mt-0.5 text-[12px] leading-snug" style={{ color: "var(--warn)" }}>{t("ve.awaiting_row")}</p>
                  ) : null}
                </div>
                <Button size="sm" variant="ghost" onClick={() => void copyInviteLink(inv)} loading={linking === inv.id} disabled={linking === inv.id} aria-label={`${t("ve.copy_invite_link")} ${inv.email}`}>
                  <Link2 size={14} aria-hidden="true" /> <span className="hidden sm:inline">{t("ve.copy_invite_link")}</span>
                </Button>
                <button type="button" onClick={() => void removeInvite(inv)} className="rounded p-1.5 hover:bg-[var(--tint)]" aria-label={`${t("Remove")} ${inv.email}`} style={{ color: "var(--danger)" }}><Trash2 size={15} /></button>
              </div>
              {links[inv.id] ? (
                <div className="mt-1.5 pl-7">
                  <p className="select-all break-all font-mono text-[11.5px]" style={{ color: "var(--ink-2)" }}>{links[inv.id]}</p>
                  <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--ink-3)" }}>{t("ve.invite_link_help")}</p>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export function JudgesSection(ctx: SectionCtx) {
  if (!ctx.has("judging")) return <LockedPanel title={ctx.t("b.locked.title")} body={ctx.t("b.judging.locked")} />;
  return <StaffPanel ctx={ctx} role="judge" people={ctx.data.staff.judges} />;
}

export function MentorsSection(ctx: SectionCtx) {
  const { t, has, ev, set } = ctx;
  if (!has("mentors")) return <LockedPanel title={t("b.locked.title")} body={t("b.mentors.locked")} />;
  const mc = ev.mentor_config;
  const setM = (patch: Partial<typeof mc>) => set({ mentor_config: { ...mc, ...patch } });
  return (
    <div className="space-y-5">
      <StaffPanel ctx={ctx} role="mentor" people={ctx.data.staff.mentors} extraLabel={t("b.staff.expertise")} extraKey="expertise" />
      <Card title={t("b.mentors.help_queue")} description={t("b.mentors.help_queue_help")}>
        <Toggle label={t("b.mentors.tickets")} help={t("b.mentors.tickets_help")} checked={mc.ticketsEnabled} onChange={(v) => setM({ ticketsEnabled: v })} />
        {mc.ticketsEnabled ? (
          <NumberStepper label={t("b.mentors.max_open")} value={mc.maxOpenTicketsPerTeam} min={1} max={10} onChange={(v) => setM({ maxOpenTicketsPerTeam: v ?? 1 })} />
        ) : null}
        <Toggle label={t("b.mentors.online")}
          help={t("b.mentors.online_help")} checked={mc.showOnlineStatus} onChange={(v) => setM({ showOnlineStatus: v })} />
      </Card>
    </div>
  );
}

export function VolunteersSection(ctx: SectionCtx) {
  if (!ctx.has("volunteers")) return <LockedPanel title={ctx.t("b.locked.title")} body={ctx.t("b.volunteers.locked")} />;
  return <StaffPanel ctx={ctx} role="volunteer" people={ctx.data.staff.volunteers} extraLabel={ctx.t("b.staff.tasks")} extraKey="tasks" />;
}
