"use client";

/**
 * The organiser's teams: how many there are and who still has no team, then
 * every team — make one for participants, add and move people, change the
 * lead, eliminate or restore, delete; export and import the line-up as CSV
 * (one row per member: Team, Email, Name, Lead, …).
 *
 * Only approved participants without a team can be added (the API refuses
 * anyone else), so the pickers offer exactly those people.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Ban, Crown, Download, Plus, RefreshCw, RotateCcw, ShieldAlert, Trash2, Upload, Users } from "lucide-react";
import { DataTable, type Column, type Facet } from "@/components/ds/DataTable";
import { Badge, Button, buttonLook } from "@/components/ds/primitives";
import { useDemoBasePath } from "@/lib/demoPath";
import { Modal } from "@/components/ds/overlays";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EliminateTeamDialog } from "@/components/teams/EliminateTeamDialog";
import { NewTeamModal, type NewTeamInput } from "@/components/teams/NewTeamModal";
import { TeamDrawer } from "@/components/teams/TeamDrawer";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { downloadCSV, toCSV } from "@/lib/csvExport";
import { parseCSV, readFileAsText } from "@/lib/csvImport";
import { fill } from "@/lib/i18n/fill";
import { tableLabels } from "@/lib/i18n/tableLabels";
import type { CapacitySummary } from "@/lib/participantsAdmin";
import {
  TEAM_CSV_HEADERS, leadOf, normalizeTeamless, normalizeTeams, planTeamImport, teamsCsvRows,
  type AdminTeam, type AdminTeamMember, type TeamImportPlan, type Teamless,
} from "@/lib/teamsAdmin";

type Summary = CapacitySummary & { teamSize?: { min: number; max: number } };

type Confirm =
  | { kind: "delete"; team: AdminTeam }
  | { kind: "remove"; team: AdminTeam; member: AdminTeamMember }
  | null;

export default function TeamsPage() {
  const { t } = useTranslation();
  const demoBase = useDemoBasePath();
  const { toast } = useToast();
  const { activeEventId, loading: eventLoading } = useActiveEvent();
  const [teams, setTeams] = useState<AdminTeam[]>([]);
  const [people, setPeople] = useState<Teamless[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [eliminate, setEliminate] = useState<AdminTeam | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [importResult, setImportResult] = useState<{ teams: number; people: number; skipped: TeamImportPlan["skipped"] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const maxSize = summary?.teamSize?.max || 4;

  const load = useCallback(async () => {
    if (activeEventId == null) return;
    try {
      const [list, free, sum] = await Promise.all([
        apiGet<unknown[]>(`/api/teams?eventId=${activeEventId}`),
        apiGet<unknown[]>(`/api/events/${activeEventId}/participants/unassigned`),
        apiGet<Summary>(`/api/events/${activeEventId}/participants/summary`),
      ]);
      setTeams(normalizeTeams(list));
      setPeople(normalizeTeamless(free));
      setSummary(sum);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [activeEventId]);

  useEffect(() => {
    if (eventLoading) return;
    if (activeEventId == null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void load();
  }, [activeEventId, eventLoading, load]);

  const open = useMemo(() => teams.find((x) => x.id === openId) || null, [teams, openId]);

  const errText = (err: unknown) => {
    const code = err instanceof ApiError ? err.code : undefined;
    const key = code ? `tm.err.${code}` : "";
    const known = key ? t(key) : key;
    return code && known !== key ? known : t("tm.failed");
  };

  /** Run a change, then reload; one toast either way. */
  const run = async (fn: () => Promise<unknown>, okKey: string) => {
    setBusy(true);
    try {
      await fn();
      toast(t(okKey), "success");
      await load();
      return true;
    } catch (err) {
      toast(errText(err), "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const create = async (input: NewTeamInput) => {
    if (activeEventId == null) return;
    setBusy(true);
    setCreateError(null);
    try {
      await apiPost("/api/teams", { eventId: activeEventId, ...input });
      toast(t("tm.created"), "success");
      setCreating(false);
      await load();
    } catch (err) {
      setCreateError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const rows = teamsCsvRows(teams);
    downloadCSV(`teams-${activeEventId}.csv`, toCSV(rows, TEAM_CSV_HEADERS.map((h) => ({ key: h, header: h }))));
  };

  const importCsv = async (file: File) => {
    if (activeEventId == null) return;
    setBusy(true);
    try {
      const records = parseCSV(await readFileAsText(file));
      const plan = planTeamImport(records, { teams, teamless: people, maxSize });
      if (!plan.create.length && !plan.add.length && !plan.skipped.length) {
        toast(t("tm.import_none"), "error");
        return;
      }
      let made = 0;
      let placed = 0;
      const skipped = [...plan.skipped];
      for (const c of plan.create) {
        try {
          await apiPost("/api/teams", { eventId: activeEventId, name: c.name, memberIds: c.memberIds, leaderId: c.leaderId });
          made += 1;
          placed += c.memberIds.length;
        } catch {
          for (const id of c.memberIds) skipped.push({ email: people.find((p) => p.userId === id)?.email || String(id), team: c.name, reason: "taken" });
        }
      }
      for (const a of plan.add) {
        for (const userId of a.userIds) {
          try {
              await apiPost(`/api/teams/${a.teamId}/members`, { userId });
            placed += 1;
          } catch {
            skipped.push({ email: people.find((p) => p.userId === userId)?.email || String(userId), team: a.teamName, reason: "full" });
          }
        }
      }
      setImportResult({ teams: made, people: placed, skipped });
      await load();
    } catch {
      toast(t("tm.import_failed"), "error");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const columns: Column<AdminTeam>[] = [
    {
      id: "name", header: t("tm.col.team"), sortable: true,
      value: (r) => `${r.name} ${r.members.map((m) => `${m.name} ${m.email}`).join(" ")}`,
      cell: (r) => (
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium" style={{ color: "var(--ink)" }}>
            {r.name}
            {r.recruiting ? <Badge tone="info">{t("tm.recruiting")}</Badge> : null}
          </p>
          <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>{r.members.map((m) => m.name).join(", ") || t("tm.no_members")}</p>
        </div>
      ),
    },
    {
      id: "lead", header: t("tm.col.lead"), sortable: true, value: (r) => leadOf(r)?.name || "",
      cell: (r) => {
        const lead = leadOf(r);
        return lead ? (
          <span className="inline-flex items-center gap-1.5" style={{ color: "var(--ink)" }}>
            <Crown size={12} aria-hidden="true" style={{ color: "var(--warn)" }} />{lead.name}
          </span>
        ) : <span style={{ color: "var(--ink-3)" }}>{t("tm.no_lead")}</span>;
      },
    },
    {
      id: "members", header: t("tm.col.members"), sortable: true, align: "right", width: "110px", value: (r) => r.members.length,
      cell: (r) => (
        <span className="tabular-nums" style={{ color: r.members.length >= maxSize ? "var(--ink)" : "var(--ink-2)" }}>
          {fill(t("tm.size"), { n: r.members.length, limit: maxSize })}
        </span>
      ),
    },
    {
      id: "status", header: t("tm.col.status"), sortable: true, width: "130px", value: (r) => r.status,
      cell: (r) => (r.status === "eliminated"
        ? <Badge tone="danger" dot>{t("tm.status.eliminated")}</Badge>
        : <Badge tone="ok" dot>{t("tm.status.active")}</Badge>),
    },
    { id: "code", header: t("tm.col.code"), value: (r) => r.joinCode, optional: true, cell: (r) => <code className="font-mono text-[12.5px]" style={{ color: "var(--ink-2)" }}>{r.joinCode}</code> },
    { id: "wanted", header: t("tm.drawer.wanted"), value: (r) => r.wantedSkills.join(", "), optional: true },
    {
      id: "actions", header: "", value: () => "", align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {r.status === "eliminated" ? (
            <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} disabled={busy}
              onClick={() => void run(() => apiPatch(`/api/teams/${r.id}/status`, { status: "active" }), "tm.restored")}>{t("tm.restore")}</Button>
          ) : (
            <Button size="sm" variant="ghost" icon={<Ban size={13} />} disabled={busy} onClick={() => setEliminate(r)}>{t("tm.eliminate")}</Button>
          )}
          <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} aria-label={t("tm.delete")} title={t("tm.delete")} style={{ color: "var(--danger)" }} disabled={busy} onClick={() => setConfirm({ kind: "delete", team: r })} />
        </div>
      ),
    },
  ];

  const facets: Facet<AdminTeam>[] = [
    {
      id: "status", label: t("tm.col.status"),
      options: [{ value: "active", label: t("tm.status.active") }, { value: "eliminated", label: t("tm.status.eliminated") }],
      match: (r, selected) => selected.includes(r.status),
    },
  ];

  if (activeEventId == null && !eventLoading) {
    return <p className="py-10 text-center text-[15px]" style={{ color: "var(--ink-3)" }}>{t("tm.no_event")}</p>;
  }

  const stats = [
    { label: t("tm.stat.teams"), value: summary?.teams ?? teams.filter((x) => x.status === "active").length },
    { label: t("tm.stat.teamless"), value: summary?.teamlessApproved ?? people.length },
    { label: t("tm.stat.looking"), value: summary?.lookingForTeam ?? people.filter((p) => p.looking).length },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("tm.title")}</h1>
          <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>{t("tm.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<Download size={14} />} onClick={exportCsv} disabled={!teams.length}>{t("tm.export")}</Button>
          <Button size="sm" icon={<Upload size={14} />} onClick={() => fileRef.current?.click()} title={t("tm.import_hint")} disabled={busy}>{t("tm.import")}</Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f); }} />
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void load()}>{t("tm.refresh")}</Button>
          {/* Rounds of elimination live on their own page, reached from here (not the sidebar). */}
          <Link href={`${demoBase}/eliminate`} {...buttonLook("secondary", "sm")}><ShieldAlert size={14} aria-hidden="true" />{t("rs.go_eliminate")}</Link>
          <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => { setCreateError(null); setCreating(true); }}>{t("tm.new")}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-[var(--radius)] border px-4 py-3.5" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
            <p className="text-[12px] font-medium uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{s.label}</p>
            <p className="mt-1 flex items-center gap-2 text-[24px] font-bold tabular-nums" style={{ color: "var(--ink)" }}>
              <Users size={16} aria-hidden="true" style={{ color: "var(--ink-3)" }} />{s.value}
            </p>
          </div>
        ))}
      </div>

      <DataTable
        rows={teams}
        columns={columns}
        facets={facets}
        loading={loading}
        error={failed && teams.length === 0}
        onRetry={() => void load()}
        searchPlaceholder={t("tm.search")}
        emptyTitle={t("tm.empty")}
        onRowClick={(r) => setOpenId(r.id)}
        pageSize={25}
        labels={tableLabels(t)}
      />

      <TeamDrawer
        key={open?.id ?? "none"}
        team={open}
        teams={teams}
        people={people}
        maxSize={maxSize}
        busy={busy}
        onClose={() => setOpenId(null)}
        onAdd={(team, userId) => void run(() => apiPost(`/api/teams/${team.id}/members`, { userId }), "tm.added")}
        onMove={(member, to) => void run(() => apiPost(`/api/teams/${to.id}/members`, { userId: member.id, move: true }), "tm.moved")}
        onRemove={(team, member) => setConfirm({ kind: "remove", team, member })}
        onMakeLead={(team, member) => void run(() => apiPatch(`/api/teams/${team.id}/members/${member.id}/lead`, {}), "tm.lead_changed")}
        onEliminate={(team) => setEliminate(team)}
        onRestore={(team) => void run(() => apiPatch(`/api/teams/${team.id}/status`, { status: "active" }), "tm.restored")}
        onDelete={(team) => setConfirm({ kind: "delete", team })}
      />

      {creating ? (
        <NewTeamModal open people={people} maxSize={maxSize} busy={busy} error={createError} onCreate={(i) => void create(i)} onClose={() => setCreating(false)} />
      ) : null}

      <EliminateTeamDialog
        key={eliminate?.id ?? "none"}
        team={eliminate}
        busy={busy}
        onClose={() => setEliminate(null)}
        onConfirm={async (reason) => {
          const team = eliminate;
          if (!team) return;
          const ok = await run(() => apiPatch(`/api/teams/${team.id}/status`, { status: "eliminated", reason: reason || undefined }), "tm.eliminated");
          if (ok) setEliminate(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.kind === "delete" ? fill(t("tm.delete_t"), { team: confirm.team.name }) : confirm?.kind === "remove" ? `${t("tm.remove_member")}: ${confirm.member.name}` : ""}
        message={confirm?.kind === "delete" ? t("tm.delete_b") : confirm?.kind === "remove" ? confirm.team.name : ""}
        confirmLabel={confirm?.kind === "delete" ? t("tm.delete") : t("tm.remove_member")}
        cancelLabel={t("tm.keep")}
        variant="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c?.kind === "delete") {
            void run(() => apiDelete(`/api/teams/${c.team.id}`), "tm.deleted").then((ok) => { if (ok) setOpenId(null); });
          }
          if (c?.kind === "remove") void run(() => apiDelete(`/api/teams/${c.team.id}/members/${c.member.id}`), "tm.removed");
        }}
      />

      <Modal
        open={Boolean(importResult)}
        onClose={() => setImportResult(null)}
        title={t("tm.import_result")}
        description={importResult ? fill(t("tm.import_done"), { teams: importResult.teams, people: importResult.people }) : undefined}
        footer={<div className="flex justify-end"><Button size="sm" variant="primary" onClick={() => setImportResult(null)}>{t("mm.close")}</Button></div>}
      >
        {importResult?.skipped.length ? (
          <div>
            <p className="mb-2 text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{t("tm.import_skipped")}</p>
            <ul className="max-h-64 space-y-1 overflow-y-auto text-[13px]">
              {importResult.skipped.map((s, i) => (
                <li key={`${s.email}-${i}`} style={{ color: "var(--ink-2)" }}>
                  <span style={{ color: "var(--ink)" }}>{s.email}</span> · {s.team} — {t(`tm.skip.${s.reason}`)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
