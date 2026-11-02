"use client";

/**
 * The organiser's volunteers and the work: tasks with a place, a due time
 * and a person, from "to do" to "done". Make a task, give it to a volunteer
 * (they get a message), move it along, delete it. Invite volunteers by
 * e-mail, leave them a note, see how far each one is.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Mail, Pencil, Plus, RefreshCw, Trash2, UserCheck } from "lucide-react";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { Badge, Button } from "@/components/ds/primitives";
import { Modal } from "@/components/ds/overlays";
import { DateTimeInput, Notice, Select, TextArea, TextInput } from "@/components/builder/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";
import { activatePendingStaff, addEventStaff, buildStaffInviteUrl, listEventStaff, removeEventStaff } from "@/lib/eventStaff";
import { formatInZone } from "@/lib/builder/datetime";
import { fill } from "@/lib/i18n/fill";
import { tableLabels } from "@/lib/i18n/tableLabels";
import { useEventZone } from "@/lib/useEventZone";
import {
  TASK_STATUSES, isOverdue, normalizeTasks, normalizeVolunteers, progress,
  type TaskStatus, type VolunteerRow, type VolunteerTask,
} from "@/lib/volunteerTasks";

interface TaskForm { id?: number; title: string; details: string; location: string; dueAt: string | null; assigneeId: string }
const EMPTY_TASK: TaskForm = { title: "", details: "", location: "", dueAt: null, assigneeId: "" };

type Confirm = { kind: "task"; task: VolunteerTask } | { kind: "volunteer"; v: VolunteerRow } | { kind: "invite"; email: string; inviteId: number | null } | null;

export default function VolunteersPage() {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const { activeEventId, loading: eventLoading } = useActiveEvent();
  const [volunteers, setVolunteers] = useState<VolunteerRow[]>([]);
  const [pending, setPending] = useState<{ email: string; inviteId: number | null }[]>([]);
  const [tasks, setTasks] = useState<VolunteerTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<"open" | TaskStatus | "all">("open");
  const [form, setForm] = useState<TaskForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [noteFor, setNoteFor] = useState<VolunteerRow | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [mailReady, setMailReady] = useState<boolean | null>(null);
  const { timeZone, zone } = useEventZone(activeEventId);

  const load = useCallback(async () => {
    if (activeEventId == null) return;
    try {
      const [vs, staff, ts] = await Promise.all([
        apiGet<unknown[]>(`/api/events/${activeEventId}/volunteers`),
        listEventStaff(activeEventId, "volunteer"),
        apiGet<unknown[]>(`/api/events/${activeEventId}/volunteer-tasks`),
      ]);
      setVolunteers(normalizeVolunteers(vs));
      setPending(staff.filter((r) => r.status === "pending").map((r) => ({ email: r.email, inviteId: r.inviteId })));
      setTasks(normalizeTasks(ts));
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
    apiGet<{ smtpConfigured?: boolean; fromConfigured?: boolean }>("/api/mail/status")
      .then((s) => setMailReady(Boolean(s?.smtpConfigured && s?.fromConfigured)))
      .catch(() => setMailReady(null));
  }, []);

  const counts = useMemo(() => ({
    open: tasks.filter((x) => x.status !== "done").length,
    todo: tasks.filter((x) => x.status === "todo").length,
    doing: tasks.filter((x) => x.status === "doing").length,
    done: tasks.filter((x) => x.status === "done").length,
    all: tasks.length,
  }), [tasks]);
  const overdue = tasks.filter((x) => isOverdue(x)).length;
  const unassigned = tasks.filter((x) => x.status !== "done" && !x.assigneeId).length;
  const shown = useMemo(() => (tab === "all" ? tasks : tab === "open" ? tasks.filter((x) => x.status !== "done") : tasks.filter((x) => x.status === tab)), [tasks, tab]);

  const when = (iso: string | null) => (iso ? formatInZone(iso, timeZone, lang, { year: undefined }) : "—");

  const saveTask = async () => {
    if (activeEventId == null || !form) return;
    if (!form.title.trim()) {
      setFormError(t("vt.err.title"));
      return;
    }
    setBusy(true);
    const body = {
      title: form.title.trim(), details: form.details.trim() || null, location: form.location.trim() || null,
      dueAt: form.dueAt, assigneeId: form.assigneeId ? Number(form.assigneeId) : null,
    };
    try {
      if (form.id) await apiPatch(`/api/events/${activeEventId}/volunteer-tasks/${form.id}`, body);
      else await apiPost(`/api/events/${activeEventId}/volunteer-tasks`, body);
      toast(t(form.id ? "vt.saved" : "vt.created"), "success");
      setForm(null);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError && err.code === "NOT_EVENT_VOLUNTEER" ? t("vt.err.not_volunteer") : t("hq.failed"));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (task: VolunteerTask, status: TaskStatus) => {
    if (activeEventId == null) return;
    try {
      await apiPatch(`/api/events/${activeEventId}/volunteer-tasks/${task.id}`, { status });
      await load();
    } catch {
      toast(t("hq.failed"), "error");
    }
  };

  const reassign = async (task: VolunteerTask, assigneeId: number | null) => {
    if (activeEventId == null) return;
    try {
      await apiPatch(`/api/events/${activeEventId}/volunteer-tasks/${task.id}`, { assigneeId });
      toast(t("vt.saved"), "success");
      await load();
    } catch {
      toast(t("hq.failed"), "error");
    }
  };

  const invite = async (email: string, note: string) => {
    if (activeEventId == null) return;
    setBusy(true);
    try {
      const r = await addEventStaff(activeEventId, "volunteer", { email, expertise: note || undefined });
      if (!r.invited && !r.assigned) throw new Error(r.error);
      const url = buildStaffInviteUrl(activeEventId, email);
      if (mailReady !== false) {
        await apiPost("/api/mail/staff-invite", { to: email, role: "volunteer", inviteUrl: url, eventId: activeEventId })
          .then(() => toast(t("mt.invite_sent"), "success"))
          .catch(() => toast(t("mt.invite_not_sent"), "error"));
      } else {
        try { await navigator.clipboard.writeText(url); toast(t("mt.link_copied"), "success"); } catch { toast(url, "info", 12000); }
      }
      setInviting(false);
      await load();
    } catch {
      toast(t("hq.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const doConfirm = async (c: NonNullable<Confirm>) => {
    if (activeEventId == null) return;
    try {
      if (c.kind === "task") await apiDelete(`/api/events/${activeEventId}/volunteer-tasks/${c.task.id}`);
      if (c.kind === "volunteer") await apiDelete(`/api/events/${activeEventId}/volunteers/${c.v.id}`);
      if (c.kind === "invite") await removeEventStaff(activeEventId, "volunteer", { assignmentId: null, inviteId: c.inviteId });
      toast(t("vt.deleted"), "success");
      await load();
    } catch {
      toast(t("hq.failed"), "error");
    }
  };

  const assigneeOptions = volunteers.map((v) => ({ value: String(v.userId), label: v.name }));

  const taskColumns: Column<VolunteerTask>[] = [
    {
      id: "title", header: t("vt.col.task"), sortable: true, value: (r) => `${r.title} ${r.details ?? ""} ${r.location ?? ""}`,
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium" style={{ color: "var(--ink)" }}>{r.title}</p>
          {r.location || r.details ? <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>{[r.location, r.details].filter(Boolean).join(" · ")}</p> : null}
        </div>
      ),
    },
    {
      id: "who", header: t("vt.col.who"), value: (r) => r.assigneeName || "", sortable: true,
      cell: (r) => (
        <label className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <span className="sr-only">{t("vt.col.who")}</span>
          <select value={r.assigneeId ? String(r.assigneeId) : ""} onChange={(e) => void reassign(r, e.target.value ? Number(e.target.value) : null)}
            className="h-8 max-w-[11rem] rounded-[var(--radius-sm)] border px-2 text-[12.5px]"
            style={{ borderColor: "var(--line-strong)", background: "var(--surface)", color: r.assigneeId ? "var(--ink)" : "var(--ink-3)" }}>
            <option value="">{t("vt.nobody")}</option>
            {assigneeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      ),
    },
    {
      id: "due", header: t("vt.col.due"), value: (r) => (r.dueAt ? new Date(r.dueAt).getTime() : Number.MAX_SAFE_INTEGER), sortable: true,
      cell: (r) => <span className="text-[13px]" style={{ color: isOverdue(r) ? "var(--danger)" : "var(--ink-2)" }}>{when(r.dueAt)}</span>,
    },
    {
      id: "status", header: t("vt.col.status"), value: (r) => TASK_STATUSES.indexOf(r.status), sortable: true,
      cell: (r) => (
        <label className="inline-flex" onClick={(e) => e.stopPropagation()}>
          <span className="sr-only">{t("vt.col.status")}</span>
          <select value={r.status} onChange={(e) => void setStatus(r, e.target.value as TaskStatus)}
            className="h-8 rounded-[var(--radius-sm)] border px-2 text-[12.5px]"
            style={{ borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink)" }}>
            {TASK_STATUSES.map((s) => <option key={s} value={s}>{t(`vt.status.${s}`)}</option>)}
          </select>
        </label>
      ),
    },
    {
      id: "actions", header: "", value: () => "", align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" icon={<Pencil size={13} />} aria-label={t("vt.edit")} title={t("vt.edit")}
            onClick={() => { setFormError(null); setForm({ id: r.id, title: r.title, details: r.details ?? "", location: r.location ?? "", dueAt: r.dueAt, assigneeId: r.assigneeId ? String(r.assigneeId) : "" }); }} />
          <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} aria-label={t("vt.delete")} title={t("vt.delete")} style={{ color: "var(--danger)" }} onClick={() => setConfirm({ kind: "task", task: r })} />
        </div>
      ),
    },
  ];

  if (activeEventId == null && !eventLoading) {
    return <p className="py-10 text-center text-[15px]" style={{ color: "var(--ink-3)" }}>{t("tm.no_event")}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("vt.title")}</h1>
          <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>{t("vt.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void load()}>{t("tm.refresh")}</Button>
          <Button size="sm" icon={<Mail size={14} />} onClick={() => setInviting(true)}>{t("vt.invite")}</Button>
          <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => { setFormError(null); setForm({ ...EMPTY_TASK }); }}>{t("vt.new_task")}</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: t("vt.stat.volunteers"), value: volunteers.length },
          { label: t("vt.stat.open"), value: counts.open },
          { label: t("vt.stat.unassigned"), value: unassigned },
          { label: t("vt.stat.overdue"), value: overdue, tone: overdue ? "var(--danger)" : undefined },
        ].map((s) => (
          <div key={s.label} className="rounded-[var(--radius)] border px-4 py-3.5" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
            <p className="text-[12px] font-medium uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{s.label}</p>
            <p className="mt-1 text-[24px] font-bold tabular-nums" style={{ color: s.tone || "var(--ink)" }}>{s.value}</p>
          </div>
        ))}
      </div>

      <section className="space-y-3">
        <div role="tablist" aria-label={t("vt.col.status")} className="flex flex-wrap gap-1.5">
          {(["open", ...TASK_STATUSES, "all"] as const).map((k) => {
            const on = tab === k;
            return (
              <button key={k} role="tab" aria-selected={on} onClick={() => setTab(k)}
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium"
                style={{ borderColor: on ? "var(--accent-solid)" : "var(--line-strong)", background: on ? "var(--accent-weak)" : "var(--surface)", color: "var(--ink)" }}>
                {t(`vt.tab.${k}`)}<span className="tabular-nums" style={{ color: "var(--ink-3)" }}>{counts[k]}</span>
              </button>
            );
          })}
        </div>
        <DataTable rows={shown} columns={taskColumns} loading={loading} error={failed && tasks.length === 0} onRetry={() => void load()}
          searchPlaceholder={t("vt.search")} emptyTitle={tasks.length ? t("vt.empty_tab") : t("vt.empty")} pageSize={25} labels={tableLabels(t)}
          onRowClick={(r) => { setFormError(null); setForm({ id: r.id, title: r.title, details: r.details ?? "", location: r.location ?? "", dueAt: r.dueAt, assigneeId: r.assigneeId ? String(r.assigneeId) : "" }); }} />
      </section>

      <section className="space-y-3" aria-label={t("vt.people")}>
        <h2 className="text-[16px] font-semibold" style={{ color: "var(--ink)" }}>{t("vt.people")}</h2>
        {mailReady === false ? <Notice tone="warn">{t("mt.mail_off")}</Notice> : null}
        {volunteers.length || pending.length ? (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {volunteers.map((v) => {
              const pct = progress(v);
              return (
                <li key={v.id} className="rounded-[var(--radius)] border p-4" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold" style={{ color: "var(--ink)" }}>{v.name}</p>
                      <p className="truncate text-[12.5px]" style={{ color: "var(--ink-3)" }}>{v.email}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" icon={<Pencil size={13} />} aria-label={t("vt.note")} title={t("vt.note")} onClick={() => setNoteFor(v)} />
                      <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} aria-label={t("vt.remove")} title={t("vt.remove")} style={{ color: "var(--danger)" }} onClick={() => setConfirm({ kind: "volunteer", v })} />
                    </div>
                  </div>
                  <p className="mt-2 text-[13px]" style={{ color: "var(--ink-2)" }}>{fill(t("vt.counts"), { todo: v.todo, doing: v.doing, done: v.done })}</p>
                  {pct != null ? (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--tint)" }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--ok)" }} />
                    </div>
                  ) : null}
                  {v.note ? <p className="mt-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[12.5px]" style={{ background: "var(--tint)", color: "var(--ink-2)" }}>{v.note}</p> : null}
                </li>
              );
            })}
            {pending.map((p) => (
              <li key={`i${p.inviteId ?? p.email}`} className="rounded-[var(--radius)] border border-dashed p-4" style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold" style={{ color: "var(--ink)" }}>{p.email}</p>
                    <Badge tone="warn" dot>{t("mt.invited")}</Badge>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" icon={<UserCheck size={13} />} aria-label={t("mt.activate")} title={t("mt.activate")}
                      onClick={async () => {
                        if (activeEventId == null) return;
                        const r = await activatePendingStaff(activeEventId, "volunteer", p.email);
                        toast(r.ok ? t("mt.activated") : r.reason === "user-not-registered" ? t("mt.not_registered") : t("hq.failed"), r.ok ? "success" : "error");
                        await load();
                      }} />
                    <Button size="sm" variant="ghost" icon={<Copy size={13} />} aria-label={t("mt.copy_link")} title={t("mt.copy_link")}
                      onClick={async () => {
                        if (activeEventId == null) return;
                        const url = buildStaffInviteUrl(activeEventId, p.email);
                        try { await navigator.clipboard.writeText(url); toast(t("mt.link_copied"), "success"); } catch { toast(url, "info", 12000); }
                      }} />
                    <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} aria-label={t("vt.remove")} title={t("vt.remove")} style={{ color: "var(--danger)" }} onClick={() => setConfirm({ kind: "invite", email: p.email, inviteId: p.inviteId })} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13.5px]" style={{ color: "var(--ink-3)" }}>{t("vt.no_people")}</p>
        )}
      </section>

      {form ? (
        <Modal open onClose={() => !busy && setForm(null)} title={form.id ? t("vt.edit") : t("vt.new_task")}
          footer={
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <p className="text-[12.5px]" style={{ color: "var(--danger)" }} role={formError ? "alert" : undefined}>{formError}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setForm(null)} disabled={busy}>{t("tm.form.cancel")}</Button>
                <Button size="sm" variant="primary" onClick={() => void saveTask()} loading={busy} disabled={busy}>{form.id ? t("hq.save") : t("vt.create")}</Button>
              </div>
            </div>
          }>
          <div className="space-y-4">
            <TextInput label={t("vt.f.title")} value={form.title} onChange={(v) => setForm({ ...form, title: v })} maxLength={160} required placeholder={t("vt.f.title_ph")} />
            <TextArea label={t("vt.f.details")} value={form.details} onChange={(v) => setForm({ ...form, details: v })} rows={3} maxLength={2000} optional={t("Optional")} />
            <TextInput label={t("vt.f.location")} value={form.location} onChange={(v) => setForm({ ...form, location: v })} maxLength={120} placeholder={t("vt.f.location_ph")} optional={t("Optional")} />
            <DateTimeInput label={t("vt.f.due")} value={form.dueAt} onChange={(v) => setForm({ ...form, dueAt: v })} timeZone={timeZone} zoneLabel={fill(t("an.zone"), { zone })} optional={t("Optional")} />
            <Select label={t("vt.f.who")} value={form.assigneeId} onChange={(v) => setForm({ ...form, assigneeId: v })} options={assigneeOptions} placeholder={t("vt.nobody")} help={t("vt.f.who_help")} />
          </div>
        </Modal>
      ) : null}

      {inviting ? <InviteModal busy={busy} onClose={() => setInviting(false)} onInvite={(e, n) => void invite(e, n)} /> : null}

      {noteFor ? (
        <NoteModal key={noteFor.id} v={noteFor} onClose={() => setNoteFor(null)} onSave={async (note) => {
          if (activeEventId == null) return;
          try {
            await apiPut(`/api/events/${activeEventId}/volunteers/${noteFor.id}`, { assignedTasks: note });
            toast(t("vt.saved"), "success");
            setNoteFor(null);
            await load();
          } catch {
            toast(t("hq.failed"), "error");
          }
        }} />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.kind === "task" ? fill(t("vt.delete_t"), { title: confirm.task.title }) : confirm?.kind === "volunteer" ? fill(t("vt.remove_t"), { name: confirm.v.name }) : confirm?.kind === "invite" ? fill(t("vt.remove_t"), { name: confirm.email }) : ""}
        message={confirm?.kind === "task" ? t("vt.delete_b") : t("vt.remove_b")}
        confirmLabel={confirm?.kind === "task" ? t("vt.delete") : t("vt.remove")}
        cancelLabel={t("tm.keep")}
        variant="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => { const c = confirm; setConfirm(null); if (c) void doConfirm(c); }}
      />
    </div>
  );
}

function InviteModal({ busy, onClose, onInvite }: { busy: boolean; onClose: () => void; onInvite: (email: string, note: string) => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  return (
    <Modal open onClose={() => !busy && onClose()} title={t("vt.invite")} description={t("vt.invite_hint")}
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>{t("tm.form.cancel")}</Button>
          <Button size="sm" variant="primary" loading={busy} disabled={busy} onClick={() => { setTried(true); if (valid) onInvite(email.trim().toLowerCase(), note.trim()); }}>{t("mt.invite")}</Button>
        </div>
      }>
      <div className="space-y-4">
        <TextInput label={t("mt.email")} type="email" value={email} onChange={setEmail} required autoComplete="off" error={tried && !valid ? t("mt.email_invalid") : null} />
        <TextArea label={t("vt.note")} value={note} onChange={setNote} rows={2} maxLength={2000} optional={t("Optional")} placeholder={t("vt.note_ph")} />
      </div>
    </Modal>
  );
}

function NoteModal({ v, onClose, onSave }: { v: VolunteerRow; onClose: () => void; onSave: (note: string) => void }) {
  const { t } = useTranslation();
  const [note, setNote] = useState(v.note ?? "");
  return (
    <Modal open onClose={onClose} title={fill(t("vt.note_for"), { name: v.name })}
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>{t("tm.form.cancel")}</Button>
          <Button size="sm" variant="primary" onClick={() => onSave(note.trim())}>{t("hq.save")}</Button>
        </div>
      }>
      <TextArea label={t("vt.note")} value={note} onChange={setNote} rows={4} maxLength={2000} placeholder={t("vt.note_ph")} />
    </Modal>
  );
}
