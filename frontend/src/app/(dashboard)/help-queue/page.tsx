"use client";

/**
 * The organiser's view of the help queue: how many requests wait, how long
 * people wait for a mentor, what a mentor flagged. Assign an open request
 * to a mentor (the ones whose skills fit and who are around come first),
 * mark a flag as seen, reopen, delete; export as CSV.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Download, MessageSquare, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { Badge, Button } from "@/components/ds/primitives";
import { Drawer } from "@/components/ds/overlays";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PRIORITY_TONE, TicketStatusBadge } from "@/components/help/HelpParts";
import { TicketThreadDrawer } from "@/components/chat/TicketThreadDrawer";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { apiDelete, apiGet, apiPatch } from "@/lib/api";
import { downloadCSV, toCSV } from "@/lib/csvExport";
import { fill } from "@/lib/i18n/fill";
import { tableLabels } from "@/lib/i18n/tableLabels";
import { formatRelativeTime } from "@/lib/relativeTime";
import {
  helpErrorWords, medianWait, minutesSince, normalizeMentors, normalizeTickets, rankMentors,
  type HelpTicket, type MentorCard,
} from "@/lib/helpQueue";

type Tab = "open" | "in-progress" | "flagged" | "resolved" | "all";
const TABS: Tab[] = ["open", "in-progress", "flagged", "resolved", "all"];
const POLL_MS = 20_000;

export default function HelpQueuePage() {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const { activeEventId, loading: eventLoading } = useActiveEvent();
  const [tickets, setTickets] = useState<HelpTicket[]>([]);
  const [mentors, setMentors] = useState<MentorCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("open");
  const [openId, setOpenId] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<HelpTicket | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [thread, setThread] = useState<HelpTicket | null>(null);

  const load = useCallback(async () => {
    if (activeEventId == null) return;
    try {
      const [rows, ms] = await Promise.all([
        apiGet<unknown[]>(`/api/tickets?eventId=${activeEventId}`),
        apiGet<unknown[]>(`/api/events/${activeEventId}/mentors`).catch(() => []),
      ]);
      setTickets(normalizeTickets(rows));
      setMentors(normalizeMentors(ms));
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

  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const counts = useMemo(() => ({
    open: tickets.filter((x) => x.status === "open").length,
    "in-progress": tickets.filter((x) => x.status === "in-progress").length,
    flagged: tickets.filter((x) => x.escalated && x.status !== "resolved").length,
    resolved: tickets.filter((x) => x.status === "resolved").length,
    all: tickets.length,
  }), [tickets]);

  const shown = useMemo(() => {
    if (tab === "all") return tickets;
    if (tab === "flagged") return tickets.filter((x) => x.escalated && x.status !== "resolved");
    return tickets.filter((x) => x.status === tab);
  }, [tickets, tab]);

  const wait = medianWait(tickets);
  const detail = tickets.find((x) => x.id === openId) || null;

  const run = async (tk: HelpTicket, fn: () => Promise<unknown>, okKey: string) => {
    setBusy(tk.id);
    try {
      await fn();
      toast(t(okKey), "success");
      await load();
    } catch (err) {
      toast(helpErrorWords(err, t), "error");
    } finally {
      setBusy(null);
    }
  };

  const assign = (tk: HelpTicket, mentorUserId: number) =>
    run(tk, () => apiPatch(`/api/tickets/${tk.id}/assign`, { mentorUserId }), "hq.assigned");
  const reopen = (tk: HelpTicket) => run(tk, () => apiPatch(`/api/tickets/${tk.id}`, { status: "open" }), "hq.reopened");
  const seen = (tk: HelpTicket) => run(tk, () => apiPatch(`/api/tickets/${tk.id}/acknowledge-escalation`, {}), "hq.seen");

  const exportCsv = () => {
    const rows = tickets.map((x) => ({
      id: x.id, topic: x.topic, team: x.teamName || x.requesterName || "", status: x.status, closed: x.closedReason || "",
      priority: x.priority, asked_for: x.preferredMentor || "", mentor: x.mentorName || "", where: x.tableLocation || "",
      created: x.createdAt || "", claimed: x.claimedAt || "", resolved: x.resolvedAt || "", description: x.description,
    }));
    downloadCSV(`help-queue-${activeEventId}.csv`, toCSV(rows, [
      { key: "id", header: "ID" }, { key: "topic", header: "Topic" }, { key: "team", header: "Team" }, { key: "status", header: "Status" },
      { key: "closed", header: "Closed because" }, { key: "priority", header: "Priority" }, { key: "asked_for", header: "Asked for" },
      { key: "mentor", header: "Mentor" }, { key: "where", header: "Where" }, { key: "created", header: "Asked at" },
      { key: "claimed", header: "Taken at" }, { key: "resolved", header: "Closed at" }, { key: "description", header: "Description" },
    ]));
  };

  const assignSelect = (tk: HelpTicket) => {
    const ranked = rankMentors(mentors, `${tk.topic} ${tk.description}`);
    return (
      <label className="inline-flex" onClick={(e) => e.stopPropagation()}>
        <span className="sr-only">{t("hq.assign")}</span>
        <select value="" disabled={busy != null || !ranked.length}
          onChange={(e) => { const id = Number(e.target.value); if (id) void assign(tk, id); }}
          className="h-8 max-w-[12rem] rounded-[var(--radius-sm)] border px-2 text-[12.5px]"
          style={{ borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink)" }}>
          <option value="">{t("hq.assign")}</option>
          {ranked.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}{m.online ? " ●" : ""}{m.matched.length ? ` — ${m.matched.join(", ")}` : ""}{m.activeTickets ? ` (${m.activeTickets})` : ""}
            </option>
          ))}
        </select>
      </label>
    );
  };

  const columns: Column<HelpTicket>[] = [
    {
      id: "topic", header: t("hq.col.topic"), sortable: true,
      value: (r) => `${r.topic} ${r.teamName ?? ""} ${r.requesterName ?? ""} ${r.description}`,
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium" style={{ color: "var(--ink)" }}>{r.topic}</p>
          <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>{[r.teamName || r.requesterName, r.tableLocation].filter(Boolean).join(" · ")}</p>
        </div>
      ),
    },
    { id: "status", header: t("hq.col.status"), value: (r) => r.status, sortable: true, cell: (r) => <TicketStatusBadge ticket={r} /> },
    {
      id: "priority", header: t("hq.col.priority"), value: (r) => ({ urgent: 0, high: 1, normal: 2, low: 3 }[r.priority] ?? 2), sortable: true,
      cell: (r) => <Badge tone={PRIORITY_TONE[r.priority]}>{t(`hq.prio.${r.priority}`)}</Badge>,
    },
    {
      id: "mentor", header: t("hq.col.mentor"), value: (r) => r.mentorName || r.preferredMentor || "", sortable: true,
      cell: (r) => (r.mentorName
        ? <span style={{ color: "var(--ink)" }}>{r.mentorName}</span>
        : r.preferredMentor ? <span style={{ color: "var(--ink-2)" }}>{fill(t("hq.asked_for"), { name: r.preferredMentor })}</span>
          : <span style={{ color: "var(--ink-3)" }}>—</span>),
    },
    {
      id: "age", header: t("hq.col.age"), value: (r) => (r.createdAt ? new Date(r.createdAt).getTime() : 0), sortable: true,
      cell: (r) => (
        <span className="text-[13px]" style={{ color: r.status === "open" && minutesSince(r.createdAt) >= 15 ? "var(--danger)" : "var(--ink-2)" }}>
          {r.createdAt ? formatRelativeTime(r.createdAt, lang) : "—"}
        </span>
      ),
    },
    {
      id: "actions", header: "", value: () => "", align: "right",
      cell: (r) => (
        <div className="flex flex-wrap justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {r.status === "open" ? assignSelect(r) : null}
          {r.escalated && r.status !== "resolved" ? <Button size="sm" variant="ghost" icon={<Check size={13} />} disabled={busy != null} onClick={() => void seen(r)}>{t("hq.mark_seen")}</Button> : null}
          {r.status !== "open" ? <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} disabled={busy != null} onClick={() => void reopen(r)}>{t("hq.reopen")}</Button> : null}
          <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} aria-label={t("hq.delete")} title={t("hq.delete")} style={{ color: "var(--danger)" }} onClick={() => setToDelete(r)} />
        </div>
      ),
    },
  ];

  if (activeEventId == null && !eventLoading) {
    return <p className="py-10 text-center text-[15px]" style={{ color: "var(--ink-3)" }}>{t("tm.no_event")}</p>;
  }

  const stats = [
    { label: t("hq.stat.open"), value: counts.open },
    { label: t("hq.stat.in_progress"), value: counts["in-progress"] },
    { label: t("hq.stat.flagged"), value: counts.flagged, tone: counts.flagged ? "var(--danger)" : undefined },
    { label: t("hq.stat.wait"), value: wait == null ? "—" : fill(t("hq.minutes"), { n: wait }) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("hq.title_org")}</h1>
          <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>{t("hq.subtitle_org")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<Download size={14} />} onClick={exportCsv} disabled={!tickets.length}>{t("tm.export")}</Button>
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void load()}>{t("tm.refresh")}</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-[var(--radius)] border px-4 py-3.5" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
            <p className="text-[12px] font-medium uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{s.label}</p>
            <p className="mt-1 text-[24px] font-bold tabular-nums" style={{ color: s.tone || "var(--ink)" }}>{s.value}</p>
          </div>
        ))}
      </div>

      <div role="tablist" aria-label={t("hq.col.status")} className="flex flex-wrap gap-1.5">
        {TABS.map((k) => {
          const on = tab === k;
          return (
            <button key={k} role="tab" aria-selected={on} onClick={() => setTab(k)}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium"
              style={{ borderColor: on ? "var(--accent-solid)" : "var(--line-strong)", background: on ? "var(--accent-weak)" : "var(--surface)", color: "var(--ink)" }}>
              {t(`hq.otab.${k}`)}<span className="tabular-nums" style={{ color: "var(--ink-3)" }}>{counts[k]}</span>
            </button>
          );
        })}
      </div>

      <DataTable
        rows={shown}
        columns={columns}
        loading={loading}
        error={failed && tickets.length === 0}
        onRetry={() => void load()}
        searchPlaceholder={t("hq.search")}
        emptyTitle={t(`hq.oempty.${tab}`)}
        onRowClick={(r) => setOpenId(r.id)}
        pageSize={25}
        labels={tableLabels(t)}
      />

      <Drawer open={Boolean(detail)} onClose={() => setOpenId(null)} title={detail?.topic || ""} description={detail ? [detail.teamName || detail.requesterName, detail.tableLocation].filter(Boolean).join(" · ") : undefined}
        footer={detail ? (
          <div className="flex w-full flex-wrap justify-end gap-2">
            <Button size="sm" variant="ghost" icon={<MessageSquare size={13} />} onClick={() => { setThread(detail); setOpenId(null); }}>{t("ch.ticket_messages")}</Button>
            {detail.status === "open" ? assignSelect(detail) : null}
            {detail.status !== "open" ? <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => void reopen(detail)}>{t("hq.reopen")}</Button> : null}
          </div>
        ) : null}>
        {detail ? (
          <div className="space-y-4 text-[13.5px]">
            <div className="flex flex-wrap gap-1.5">
              <TicketStatusBadge ticket={detail} />
              <Badge tone={PRIORITY_TONE[detail.priority]}>{t(`hq.prio.${detail.priority}`)}</Badge>
              {detail.preferredMentor ? <Badge tone="neutral">{fill(t("hq.asked_for"), { name: detail.preferredMentor })}</Badge> : null}
            </div>
            <p className="whitespace-pre-line" style={{ color: "var(--ink)" }}>{detail.description || "—"}</p>
            <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
              {([
                [t("hq.d.requester"), detail.requesterName],
                [t("hq.d.mentor"), detail.mentorName],
                [t("hq.d.phone"), detail.contactPhone],
                [t("hq.d.asked"), detail.createdAt ? formatRelativeTime(detail.createdAt, lang) : null],
                [t("hq.d.taken"), detail.claimedAt ? formatRelativeTime(detail.claimedAt, lang) : null],
                [t("hq.d.closed"), detail.resolvedAt ? formatRelativeTime(detail.resolvedAt, lang) : null],
              ] as [string, string | null][]).filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt style={{ color: "var(--ink-3)" }}>{k}</dt>
                  <dd className="min-w-0 break-words" style={{ color: "var(--ink)" }}>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </Drawer>

      <TicketThreadDrawer eventId={activeEventId} ticketId={thread?.id ?? null} topic={thread?.topic ?? ""} open={Boolean(thread)} onClose={() => setThread(null)} />

      <ConfirmDialog
        open={Boolean(toDelete)}
        title={toDelete ? fill(t("hq.delete_t"), { topic: toDelete.topic }) : ""}
        message={t("hq.delete_b")}
        confirmLabel={t("hq.delete")}
        cancelLabel={t("tm.keep")}
        variant="danger"
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          const tk = toDelete;
          setToDelete(null);
          if (tk) void run(tk, () => apiDelete(`/api/tickets/${tk.id}`), "hq.deleted").then(() => setOpenId(null));
        }}
      />
    </div>
  );
}
