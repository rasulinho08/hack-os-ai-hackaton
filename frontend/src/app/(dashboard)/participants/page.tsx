"use client";

/**
 * The organiser's participants: capacity and the waiting list at the top,
 * then everyone by status — approve, put on the waiting list or reject one
 * by one, in bulk or a whole team at once; see a person's profile and
 * answers; export everything; import a list.
 *
 * The API decides capacity: when an approval does not fit, it says so and
 * the organiser can approve anyway. Seats that free up before the start are
 * filled from the waiting list by the API itself.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowUpCircle, Check, Clock, Crown, Download, MailPlus, RefreshCw, Trash2, Upload, Users, X } from "lucide-react";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { Badge, Button, buttonLook, type Tone } from "@/components/ds/primitives";
import { useDemoBasePath } from "@/lib/demoPath";
import { Drawer } from "@/components/ds/overlays";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { parseCSV, readFileAsText } from "@/lib/csvImport";
import { fill } from "@/lib/i18n/fill";
import { tableLabels } from "@/lib/i18n/tableLabels";
import { formatRelativeTime } from "@/lib/relativeTime";
import {
  PARTICIPANT_STATUSES, bulkCounts, normalizeParticipants,
  type AdminParticipant, type BulkResult, type CapacitySummary, type ParticipantStatus,
} from "@/lib/participantsAdmin";
import { formatDate } from "@/lib/i18n/dates";

const TONE: Record<ParticipantStatus, Tone> = {
  pending: "warn",
  approved: "ok",
  waitlisted: "info",
  rejected: "danger",
  eliminated: "neutral",
};

const POLL_MS = 20_000;

interface FormField { field_key: string; label: string | null; kind: string }

type Confirm =
  | { kind: "reject"; ids: number[] }
  | { kind: "remove"; p: AdminParticipant }
  | null;

/** `?status=pending` (from the dashboard's alerts) opens that tab. */
function tabFrom(value: string | null): "all" | ParticipantStatus {
  return (PARTICIPANT_STATUSES as readonly string[]).includes(String(value)) ? (value as ParticipantStatus) : "all";
}

export default function ParticipantsPage() {
  return (
    <Suspense fallback={null}>
      <Participants />
    </Suspense>
  );
}

function Participants() {
  const params = useSearchParams();
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const { activeEventId, loading: eventLoading } = useActiveEvent();
  const [rows, setRows] = useState<AdminParticipant[]>([]);
  const [summary, setSummary] = useState<CapacitySummary | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [tab, setTab] = useState<"all" | ParticipantStatus>(() => tabFrom(params.get("status")));
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [overCapacity, setOverCapacity] = useState<{ ids: number[]; to: ParticipantStatus } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const base = useDemoBasePath();

  const load = useCallback(async () => {
    if (activeEventId == null) return;
    try {
      const [list, sum] = await Promise.all([
        apiGet<unknown[]>(`/api/events/${activeEventId}/participants`),
        apiGet<CapacitySummary>(`/api/events/${activeEventId}/participants/summary`),
      ]);
      setRows(normalizeParticipants(list));
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
    setOverCapacity(null);
    void load();
    // Labels of the event's own questions, for the answers in the details.
    apiGet<{ fields?: FormField[] }>(`/api/events/${activeEventId}/builder`)
      .then((b) => setFields(Array.isArray(b?.fields) ? b.fields : []))
      .catch(() => setFields([]));
  }, [activeEventId, eventLoading, load]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(PARTICIPANT_STATUSES.map((s) => [s, 0])) as Record<ParticipantStatus, number>;
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

  const shown = useMemo(() => (tab === "all" ? rows : rows.filter((r) => r.status === tab)), [rows, tab]);
  const detail = useMemo(() => rows.find((r) => r.id === detailId) || null, [rows, detailId]);

  /** Change statuses; when some approvals do not fit, offer "approve anyway". */
  const setStatus = async (ids: number[], to: ParticipantStatus, force = false) => {
    if (activeEventId == null || !ids.length) return;
    setBusy(true);
    try {
      if (ids.length === 1) {
        try {
          await apiPatch(`/api/events/${activeEventId}/participants/${ids[0]}`, { status: to, force });
          toast(t("pt.updated"), "success");
          setOverCapacity(null);
        } catch (err) {
          if (err instanceof ApiError && err.code === "CAPACITY_FULL") setOverCapacity({ ids, to });
          else throw err;
        }
      } else {
        const r = await apiPost<BulkResult>(`/api/events/${activeEventId}/participants/bulk`, { ids, status: to, force });
        const c = bulkCounts(r);
        const parts = [fill(t("pt.bulk.done"), { n: c.updated })];
        if (c.other) parts.push(fill(t("pt.bulk.skipped_other"), { n: c.other }));
        toast(parts.join(" "), c.updated ? "success" : "info");
        setOverCapacity(c.full.length ? { ids: c.full, to } : null);
      }
      await load();
    } catch {
      toast(t("pt.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const approveTeam = async (p: AdminParticipant) => {
    if (activeEventId == null || !p.teamId) return;
    setBusy(true);
    try {
      const r = await apiPost<BulkResult>(`/api/events/${activeEventId}/participants/team/${p.teamId}/status`, { status: "approved" });
      const c = bulkCounts(r);
      toast(fill(t("pt.bulk.done"), { n: c.updated }), "success");
      setOverCapacity(c.full.length ? { ids: c.full, to: "approved" } : null);
      await load();
    } catch {
      toast(t("pt.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: AdminParticipant) => {
    if (activeEventId == null) return;
    try {
      await apiDelete(`/api/events/${activeEventId}/participants/${p.id}`);
      setDetailId(null);
      toast(t("pt.updated"), "success");
      await load();
    } catch {
      toast(t("pt.failed"), "error");
    }
  };

  const promote = async () => {
    if (activeEventId == null) return;
    try {
      const r = await apiPost<{ promoted: unknown[] }>(`/api/events/${activeEventId}/participants/promote`, {});
      const n = r?.promoted?.length || 0;
      toast(n ? fill(t("pt.promoted"), { n }) : t("pt.promoted_none"), n ? "success" : "info");
      await load();
    } catch {
      toast(t("pt.failed"), "error");
    }
  };

  const importCsv = async (file: File) => {
    if (activeEventId == null) return;
    try {
      const records = parseCSV(await readFileAsText(file));
      const pick = (row: Record<string, string>, ...keys: string[]) => keys.map((k) => row[k]).find((v) => v && v.trim())?.trim();
      const users = records
        .map((row) => {
          const email = pick(row, "Email", "email", "E-mail", "E-poçt")?.toLowerCase();
          if (!email) return null;
          return {
            email,
            full_name: pick(row, "Full Name", "fullName", "Name", "Ad Soyad", "Имя") || "Participant",
            phone: pick(row, "Phone", "phone", "Telefon"),
            university: pick(row, "University", "university", "Universitet"),
            country: pick(row, "Country", "country"),
            github_link: pick(row, "GitHub", "github"),
            linkedin: pick(row, "LinkedIn", "linkedin"),
            skills: pick(row, "Skills", "skills")?.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
          };
        })
        .filter(Boolean);
      if (!users.length) {
        toast(t("pt.import_empty"), "error");
        return;
      }
      const r = await apiPost<{ created: number; skipped: number; welcomed: number }>("/api/users/bulk-import", { users, eventId: activeEventId });
      toast(fill(t("pt.import_done"), { created: r.created, skipped: r.skipped, welcomed: r.welcomed ?? 0 }), "success", 8000);
      await load();
    } catch {
      toast(t("pt.import_failed"), "error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const statusLabel = (s: ParticipantStatus) => t(`pt.status.${s}`);

  const actionsFor = (p: AdminParticipant, size: "sm" = "sm") => {
    const btn = (key: string, label: string, icon: React.ReactNode, onClick: () => void, tone?: "danger") => (
      <Button key={key} size={size} variant="ghost" icon={icon} disabled={busy}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        style={tone === "danger" ? { color: "var(--danger)" } : undefined}>
        {label}
      </Button>
    );
    const out: React.ReactNode[] = [];
    if (p.status !== "approved" && p.status !== "eliminated") out.push(btn("ap", t("pt.act.approve"), <Check size={13} />, () => void setStatus([p.id], "approved")));
    if (p.status === "eliminated") out.push(btn("rs", t("pt.act.restore"), <Check size={13} />, () => void setStatus([p.id], "approved")));
    if (p.status === "pending" || p.status === "rejected") out.push(btn("wl", t("pt.act.waitlist"), <Clock size={13} />, () => void setStatus([p.id], "waitlisted")));
    if (p.status !== "rejected" && p.status !== "eliminated") out.push(btn("rj", t("pt.act.reject"), <X size={13} />, () => setConfirm({ kind: "reject", ids: [p.id] }), "danger"));
    return out;
  };

  const columns: Column<AdminParticipant>[] = [
    {
      id: "name", header: t("pt.col.name"), value: (r) => `${r.name} ${r.email}`, sortable: true,
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium" style={{ color: "var(--ink)" }}>{r.name}</p>
          <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>{r.email}</p>
        </div>
      ),
    },
    {
      id: "status", header: t("pt.col.status"), value: (r) => r.status, sortable: true,
      cell: (r) => <Badge tone={TONE[r.status]} dot>{statusLabel(r.status)}</Badge>,
    },
    {
      id: "team", header: t("pt.col.team"), value: (r) => r.teamName || "", sortable: true,
      cell: (r) => (r.teamName ? (
        <span className="inline-flex items-center gap-1.5" style={{ color: "var(--ink)" }}>
          {r.isLead ? <Crown size={12} aria-label={t("pt.lead")} style={{ color: "var(--warn)" }} /> : null}
          {r.teamName}
        </span>
      ) : r.looking ? (
        <Badge tone="info">{t("pt.looking")}</Badge>
      ) : (
        <span style={{ color: "var(--ink-3)" }}>{t("pt.no_team")}</span>
      )),
    },
    {
      id: "registered", header: t("pt.col.registered"), value: (r) => (r.registeredAt ? new Date(r.registeredAt).getTime() : 0), sortable: true,
      cell: (r) => <span style={{ color: "var(--ink-2)" }}>{r.registeredAt ? formatRelativeTime(r.registeredAt, lang) : "—"}</span>,
    },
    { id: "university", header: t("pt.col.university"), value: (r) => r.university || "", optional: true },
    { id: "experience", header: t("pt.col.experience"), value: (r) => r.experience || "", optional: true },
    { id: "skills", header: t("pt.col.skills"), value: (r) => r.skills.join(", "), optional: true },
    { id: "source", header: t("pt.col.source"), value: (r) => r.source || "", optional: true },
    {
      id: "actions", header: "", value: () => "", hideOnCard: false,
      cell: (r) => <div className="flex flex-wrap justify-end gap-1">{actionsFor(r)}</div>,
    },
  ];

  const cap = summary?.capacity;
  const pct = cap && cap.limit ? Math.min(100, Math.round((cap.taken / cap.limit) * 100)) : 0;
  const canPromote = Boolean(summary && cap && cap.waitlistEnabled && summary.byStatus.waitlisted > 0 && cap.remaining != null && cap.remaining > 0);

  const answerLabel = (key: string) => {
    const f = fields.find((x) => x.field_key === key);
    if (f?.label) return f.label;
    const std = t(`rg.field.${key}`);
    return std === `rg.field.${key}` ? key : std;
  };
  const answerValue = (v: unknown) => {
    if (v == null || v === "") return "—";
    if (Array.isArray(v)) return v.join(", ");
    if (typeof v === "boolean") return v ? "✓" : "—";
    if (typeof v === "object") return "📎";
    return String(v);
  };

  if (activeEventId == null && !eventLoading) {
    return <p className="py-10 text-center text-[15px]" style={{ color: "var(--ink-3)" }}>{t("pt.no_event")}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("pt.title")}</h1>
          <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>{t("pt.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={activeEventId != null ? `/api/events/${activeEventId}/participants/export.csv` : undefined}
            download
            className="inline-flex min-h-9 items-center gap-2 rounded-[var(--radius-sm)] border px-3 text-[13px] font-medium"
            style={{ borderColor: "var(--line-strong)", color: "var(--ink)", background: "var(--surface)" }}
          >
            <Download size={14} aria-hidden="true" /> {t("pt.export")}
          </a>
          {/* Personal invitations with a link to register: their own page. */}
          <Link href={`${base}/invitations`} {...buttonLook("primary", "sm")}><MailPlus size={14} aria-hidden="true" />{t("iv.participants_link")}</Link>
          <Button size="sm" icon={<Upload size={14} />} onClick={() => fileRef.current?.click()} title={t("pt.import_hint")}>{t("pt.import")}</Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f); }} />
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void load()}>{t("pt.refresh")}</Button>
        </div>
      </div>

      {summary && cap ? (
        <section className="rounded-[var(--radius)] border p-5" style={{ borderColor: "var(--line)", background: "var(--surface)" }} aria-label={t("pt.title")}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
                <Users size={16} aria-hidden="true" />
                {cap.limit != null ? fill(t("pt.cap_of"), { taken: cap.taken, limit: cap.limit }) : fill(t("pt.cap_nolimit"), { taken: cap.taken })}
                {cap.limit != null ? (
                  cap.full ? <Badge tone="danger">{t("pt.cap_full")}</Badge> : <Badge tone="ok">{fill(t("pt.cap_left"), { n: cap.remaining ?? 0 })}</Badge>
                ) : null}
              </p>
              {cap.limit != null ? (
                <div className="mt-2.5 h-2 w-full max-w-xl overflow-hidden rounded-full" style={{ background: "var(--tint)" }} role="progressbar" aria-valuemin={0} aria-valuemax={cap.limit} aria-valuenow={cap.taken}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: cap.full ? "var(--danger)" : "var(--accent-solid)" }} />
                </div>
              ) : null}
              <p className="mt-2 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
                {t(`pt.approval.${cap.approvalMode === "auto" || cap.approvalMode === "team" ? cap.approvalMode : "manual"}`)}
                {" · "}
                <a href={`/create-event/${activeEventId}?section=registration`} className="underline-offset-2 hover:underline" style={{ color: "var(--accent)" }}>{t("pt.cap_change")}</a>
              </p>
            </div>
            {canPromote ? (
              <Button size="sm" variant="primary" icon={<ArrowUpCircle size={14} />} onClick={() => void promote()}>{t("pt.promote")}</Button>
            ) : null}
          </div>
        </section>
      ) : null}

      {overCapacity ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border px-4 py-3" style={{ borderColor: "var(--warn)", background: "var(--warn-weak)" }} role="status">
          <p className="text-[13.5px]" style={{ color: "var(--ink)" }}>
            {overCapacity.ids.length > 1 ? fill(t("pt.bulk.skipped_full"), { n: overCapacity.ids.length }) : t("pt.err.CAPACITY_FULL")}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => void setStatus(overCapacity.ids, overCapacity.to, true)} disabled={busy}>{t("pt.bulk.anyway")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setOverCapacity(null)}>{t("pt.confirm_cancel")}</Button>
          </div>
        </div>
      ) : null}

      <div role="tablist" aria-label={t("pt.col.status")} className="flex flex-wrap gap-1.5">
        {(["all", ...PARTICIPANT_STATUSES] as const).map((s) => {
          const n = s === "all" ? rows.length : counts[s];
          const on = tab === s;
          return (
            <button
              key={s}
              role="tab"
              aria-selected={on}
              onClick={() => setTab(s)}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors"
              style={{ borderColor: on ? "var(--accent-solid)" : "var(--line-strong)", background: on ? "var(--accent-weak)" : "var(--surface)", color: "var(--ink)" }}
            >
              {s === "all" ? t("pt.tab.all") : statusLabel(s)}
              <span className="tabular-nums" style={{ color: "var(--ink-3)" }}>{n}</span>
            </button>
          );
        })}
      </div>

      <DataTable
        rows={shown}
        columns={columns}
        loading={loading}
        error={failed && rows.length === 0}
        onRetry={() => void load()}
        searchPlaceholder={t("pt.search")}
        emptyTitle={rows.length === 0 ? t("pt.empty") : t("pt.empty_tab")}
        onRowClick={(r) => setDetailId(r.id)}
        pageSize={25}
        labels={tableLabels(t)}
        bulkActions={[
          { id: "approve", label: t("pt.act.approve"), onRun: (ids) => void setStatus(ids.map(Number), "approved") },
          { id: "waitlist", label: t("pt.act.waitlist"), onRun: (ids) => void setStatus(ids.map(Number), "waitlisted") },
          { id: "reject", label: t("pt.act.reject"), tone: "danger", onRun: (ids) => setConfirm({ kind: "reject", ids: ids.map(Number) }) },
        ]}
      />

      <Drawer
        open={Boolean(detail)}
        onClose={() => setDetailId(null)}
        title={detail?.name || t("pt.detail.profile")}
        description={detail?.email}
        footer={detail ? (
          <div className="flex flex-wrap justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {actionsFor(detail)}
              {detail.teamId && detail.isLead ? (
                <Button size="sm" variant="ghost" icon={<Users size={13} />} onClick={() => void approveTeam(detail)} disabled={busy}>{t("pt.act.approve_team")}</Button>
              ) : null}
            </div>
            <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} style={{ color: "var(--danger)" }} onClick={() => setConfirm({ kind: "remove", p: detail })}>{t("pt.act.remove")}</Button>
          </div>
        ) : null}
      >
        {detail ? (
          <div className="space-y-5 text-[13.5px]">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={TONE[detail.status]} dot>{statusLabel(detail.status)}</Badge>
              {detail.teamName ? <Badge tone="neutral">{detail.isLead ? `${t("pt.lead")} · ` : ""}{detail.teamName}</Badge> : <Badge tone="neutral">{t("pt.no_team")}</Badge>}
              {detail.looking ? <Badge tone="info">{t("pt.looking")}</Badge> : null}
            </div>
            {detail.lookingNote ? <p className="rounded-[var(--radius-sm)] px-3 py-2" style={{ background: "var(--tint)", color: "var(--ink-2)" }}>“{detail.lookingNote}”</p> : null}
            <section>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{t("pt.detail.profile")}</h3>
              <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                {[
                  [t("pt.detail.email"), detail.email],
                  [t("pt.detail.phone"), detail.phone],
                  [t("pt.col.university"), detail.university],
                  [t("pt.col.experience"), detail.experience],
                  [t("pt.col.skills"), detail.skills.join(", ")],
                  [t("pt.col.source"), detail.source],
                  [t("pt.detail.registered"), formatDate(detail.registeredAt, lang, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) || null],
                ].filter(([, v]) => v).map(([k, v]) => (
                  <div key={String(k)} className="contents">
                    <dt style={{ color: "var(--ink-3)" }}>{k}</dt>
                    <dd className="min-w-0 break-words" style={{ color: "var(--ink)" }}>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section>
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{t("pt.detail.answers")}</h3>
              {Object.keys(detail.answers).length ? (
                <dl className="space-y-2">
                  {Object.entries(detail.answers).map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>{answerLabel(k)}</dt>
                      <dd className="whitespace-pre-line" style={{ color: "var(--ink)" }}>{answerValue(v)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p style={{ color: "var(--ink-3)" }}>{t("pt.detail.no_answers")}</p>
              )}
            </section>
          </div>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.kind === "remove" ? fill(t("pt.confirm_remove_t"), { name: confirm.p.name }) : fill(t("pt.confirm_reject_t"), { n: confirm?.kind === "reject" ? (confirm.ids.length > 1 ? fill(t("pt.people_n"), { n: confirm.ids.length }) : rows.find((r) => r.id === confirm.ids[0])?.name || "") : "" })}
        message={confirm?.kind === "remove" ? t("pt.confirm_remove_b") : t("pt.confirm_reject_b")}
        confirmLabel={confirm?.kind === "remove" ? t("pt.act.remove") : t("pt.act.reject")}
        cancelLabel={t("pt.confirm_cancel")}
        variant="danger"
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c?.kind === "reject") void setStatus(c.ids, "rejected");
          if (c?.kind === "remove") void remove(c.p);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
