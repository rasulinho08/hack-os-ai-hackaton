"use client";

/**
 * The organiser's mentors: who is around right now, what each knows, how
 * many requests they are on and have resolved, their next hours. Invite a
 * mentor by e-mail (they sign up through the link and land in this event);
 * edit a mentor's skills and place, add or remove their hours, remove them.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock, Copy, Mail, Plus, RefreshCw, Trash2, UserCheck } from "lucide-react";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { Badge, Button } from "@/components/ds/primitives";
import { Drawer, Modal } from "@/components/ds/overlays";
import { ChipsInput, DateTimeInput, Notice, Segmented, TextArea, TextInput } from "@/components/builder/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PresenceDot, SkillChips, slotText } from "@/components/help/HelpParts";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { activatePendingStaff, addEventStaff, buildStaffInviteUrl, listEventStaff, removeEventStaff } from "@/lib/eventStaff";
import { fill } from "@/lib/i18n/fill";
import { tableLabels } from "@/lib/i18n/tableLabels";
import { useEventZone } from "@/lib/useEventZone";
import { helpErrorWords, normalizeMentors, normalizeSlots, type MentorCard, type MentorSlot } from "@/lib/helpQueue";

type Row =
  | { id: string; kind: "active"; mentor: MentorCard }
  | { id: string; kind: "pending"; email: string; inviteId: number | null };

type Confirm = { kind: "remove"; row: Row } | null;

export default function MentorsPage() {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const { activeEventId, loading: eventLoading } = useActiveEvent();
  const [mentors, setMentors] = useState<MentorCard[]>([]);
  const [pending, setPending] = useState<{ email: string; inviteId: number | null }[]>([]);
  const [slots, setSlots] = useState<MentorSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [mailReady, setMailReady] = useState<boolean | null>(null);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const { timeZone, zone } = useEventZone(activeEventId);

  const load = useCallback(async () => {
    if (activeEventId == null) return;
    try {
      const [ms, staff, sl] = await Promise.all([
        apiGet<unknown[]>(`/api/events/${activeEventId}/mentors`),
        listEventStaff(activeEventId, "mentor"),
        apiGet<unknown[]>(`/api/events/${activeEventId}/mentors/slots`).catch(() => []),
      ]);
      setMentors(normalizeMentors(ms));
      setPending(staff.filter((r) => r.status === "pending").map((r) => ({ email: r.email, inviteId: r.inviteId })));
      setSlots(normalizeSlots(sl));
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

  // The presence dots go stale; look again every half minute.
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const rows: Row[] = useMemo(() => [
    ...mentors.map((m) => ({ id: `a${m.assignmentId}`, kind: "active" as const, mentor: m })),
    ...pending.map((p) => ({ id: `i${p.inviteId ?? p.email}`, kind: "pending" as const, email: p.email, inviteId: p.inviteId })),
  ], [mentors, pending]);

  const open = mentors.find((m) => m.assignmentId === openId) || null;
  const onlineNow = mentors.filter((m) => m.online).length;

  const sendInvite = async (email: string) => {
    if (activeEventId == null) return false;
    const url = buildStaffInviteUrl(activeEventId, email);
    try {
      await apiPost("/api/mail/staff-invite", { to: email, role: "mentor", inviteUrl: url, eventId: activeEventId });
      toast(t("mt.invite_sent"), "success");
      return true;
    } catch {
      toast(t("mt.invite_not_sent"), "error");
      return false;
    }
  };

  const copyLink = async (email: string) => {
    if (activeEventId == null) return;
    const url = buildStaffInviteUrl(activeEventId, email);
    try {
      await navigator.clipboard.writeText(url);
      toast(t("mt.link_copied"), "success");
    } catch {
      toast(url, "info", 12000);
    }
  };

  const activate = async (email: string) => {
    if (activeEventId == null) return;
    const r = await activatePendingStaff(activeEventId, "mentor", email);
    if (r.ok) toast(t("mt.activated"), "success");
    else toast(r.reason === "user-not-registered" ? t("mt.not_registered") : t("hq.failed"), "error");
    await load();
  };

  const remove = async (row: Row) => {
    if (activeEventId == null) return;
    try {
      if (row.kind === "active") await apiDelete(`/api/events/${activeEventId}/mentors/${row.mentor.assignmentId}`);
      else await removeEventStaff(activeEventId, "mentor", { assignmentId: null, inviteId: row.inviteId });
      toast(t("mt.removed"), "success");
      setOpenId(null);
      await load();
    } catch {
      toast(t("hq.failed"), "error");
    }
  };

  const columns: Column<Row>[] = [
    {
      id: "name", header: t("mt.col.name"), sortable: true,
      value: (r) => (r.kind === "active" ? `${r.mentor.name} ${r.mentor.email ?? ""} ${r.mentor.skills.join(" ")}` : r.email),
      cell: (r) => (r.kind === "active" ? (
        <div className="min-w-0">
          <p className="truncate font-medium" style={{ color: "var(--ink)" }}>{r.mentor.name}</p>
          <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>{r.mentor.email}</p>
        </div>
      ) : (
        <div className="min-w-0">
          <p className="truncate font-medium" style={{ color: "var(--ink)" }}>{r.email}</p>
          <p className="text-xs" style={{ color: "var(--ink-3)" }}>{t("mt.pending_hint")}</p>
        </div>
      )),
    },
    {
      id: "status", header: t("mt.col.status"), value: (r) => (r.kind === "active" ? (r.mentor.online ? 0 : 1) : 2), sortable: true,
      cell: (r) => (r.kind === "active" ? <PresenceDot mentor={r.mentor} /> : <Badge tone="warn" dot>{t("mt.invited")}</Badge>),
    },
    {
      id: "skills", header: t("mt.col.skills"), value: (r) => (r.kind === "active" ? r.mentor.skills.join(", ") : ""),
      cell: (r) => (r.kind === "active" ? <SkillChips items={r.mentor.skills} max={4} /> : null),
    },
    {
      id: "load", header: t("mt.col.load"), align: "right", sortable: true,
      value: (r) => (r.kind === "active" ? r.mentor.activeTickets : -1),
      cell: (r) => (r.kind === "active" ? (
        <span className="tabular-nums" style={{ color: "var(--ink-2)" }}>{fill(t("mt.load"), { now: r.mentor.activeTickets, done: r.mentor.resolvedTickets })}</span>
      ) : null),
    },
    {
      id: "next", header: t("mt.col.next"), value: (r) => (r.kind === "active" && r.mentor.nextSlot ? r.mentor.nextSlot.startsAt : ""),
      cell: (r) => (r.kind === "active" && r.mentor.nextSlot
        ? <span className="text-[13px]" style={{ color: "var(--ink-2)" }}>{slotText(r.mentor.nextSlot, timeZone, lang, t)}</span>
        : <span style={{ color: "var(--ink-3)" }}>—</span>),
      optional: false,
    },
    {
      id: "actions", header: "", value: () => "", align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {r.kind === "pending" ? (
            <>
              <Button size="sm" variant="ghost" icon={<UserCheck size={13} />} onClick={() => void activate(r.email)}>{t("mt.activate")}</Button>
              <Button size="sm" variant="ghost" icon={<Copy size={13} />} aria-label={t("mt.copy_link")} title={t("mt.copy_link")} onClick={() => void copyLink(r.email)} />
              {mailReady !== false ? <Button size="sm" variant="ghost" icon={<Mail size={13} />} aria-label={t("mt.resend")} title={t("mt.resend")} onClick={() => void sendInvite(r.email)} /> : null}
            </>
          ) : null}
          <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} aria-label={t("mt.remove")} title={t("mt.remove")} style={{ color: "var(--danger)" }} onClick={() => setConfirm({ kind: "remove", row: r })} />
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
          <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("mt.title")}</h1>
          <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>{t("mt.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void load()}>{t("tm.refresh")}</Button>
          <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setAdding(true)}>{t("mt.add")}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: t("mt.stat.mentors"), value: mentors.length },
          { label: t("mt.stat.online"), value: onlineNow },
          { label: t("mt.stat.invited"), value: pending.length },
        ].map((s) => (
          <div key={s.label} className="rounded-[var(--radius)] border px-4 py-3.5" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
            <p className="text-[12px] font-medium uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{s.label}</p>
            <p className="mt-1 text-[24px] font-bold tabular-nums" style={{ color: "var(--ink)" }}>{s.value}</p>
          </div>
        ))}
      </div>

      {mailReady === false ? <Notice tone="warn">{t("mt.mail_off")}</Notice> : null}

      <DataTable
        rows={rows}
        columns={columns}
        loading={loading}
        error={failed && rows.length === 0}
        onRetry={() => void load()}
        searchPlaceholder={t("mt.search")}
        emptyTitle={t("mt.empty")}
        onRowClick={(r) => { if (r.kind === "active") setOpenId(r.mentor.assignmentId); }}
        pageSize={25}
        labels={tableLabels(t)}
      />

      {adding ? (
        <AddMentorModal
          busy={busy}
          onClose={() => setAdding(false)}
          onAdd={async (email, skills, availability) => {
            if (activeEventId == null) return;
            setBusy(true);
            try {
              const r = await addEventStaff(activeEventId, "mentor", { email, expertise: skills.join(", "), availability });
              if (!r.invited && !r.assigned) throw new Error(r.error);
              if (mailReady !== false) await sendInvite(email);
              else await copyLink(email);
              setAdding(false);
              await load();
            } catch (err) {
              toast(err instanceof ApiError ? err.message : t("hq.failed"), "error");
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}

      {open ? (
        <MentorDrawer
          key={open.assignmentId}
          eventId={activeEventId as number}
          mentor={open}
          slots={slots.filter((s) => s.userId === open.userId)}
          timeZone={timeZone}
          zone={zone}
          onClose={() => setOpenId(null)}
          onChanged={load}
          onRemove={() => setConfirm({ kind: "remove", row: { id: `a${open.assignmentId}`, kind: "active", mentor: open } })}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm ? fill(t("mt.remove_t"), { name: confirm.row.kind === "active" ? confirm.row.mentor.name : confirm.row.email }) : ""}
        message={t("mt.remove_b")}
        confirmLabel={t("mt.remove")}
        cancelLabel={t("tm.keep")}
        variant="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => { const c = confirm; setConfirm(null); if (c) void remove(c.row); }}
      />
    </div>
  );
}

function AddMentorModal({ busy, onClose, onAdd }: { busy: boolean; onClose: () => void; onAdd: (email: string, skills: string[], availability: string) => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [availability, setAvailability] = useState("");
  const [tried, setTried] = useState(false);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  return (
    <Modal open onClose={() => !busy && onClose()} title={t("mt.add")} description={t("mt.add_hint")}
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>{t("tm.form.cancel")}</Button>
          <Button size="sm" variant="primary" loading={busy} disabled={busy} onClick={() => { setTried(true); if (valid) onAdd(email.trim().toLowerCase(), skills, availability.trim()); }}>{t("mt.invite")}</Button>
        </div>
      }>
      <div className="space-y-4">
        <TextInput label={t("mt.email")} type="email" value={email} onChange={setEmail} required autoComplete="off" error={tried && !valid ? t("mt.email_invalid") : null} />
        <ChipsInput label={t("mt.skills")} values={skills} onChange={setSkills} max={20} placeholder={t("mt.skills_ph")} />
        <TextInput label={t("mt.availability")} value={availability} onChange={setAvailability} maxLength={255} placeholder={t("mt.availability_ph")} optional={t("Optional")} />
      </div>
    </Modal>
  );
}

function MentorDrawer({ eventId, mentor, slots, timeZone, zone, onClose, onChanged, onRemove }: {
  eventId: number;
  mentor: MentorCard;
  slots: MentorSlot[];
  timeZone: string;
  zone: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onRemove: () => void;
}) {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const [skills, setSkills] = useState(mentor.skills);
  const [bio, setBio] = useState(mentor.bio ?? "");
  const [location, setLocation] = useState(mentor.location ?? "");
  const [availability, setAvailability] = useState(mentor.availability ?? "");
  const [slot, setSlot] = useState<{ startsAt: string | null; endsAt: string | null; mode: "onsite" | "online" }>({ startsAt: null, endsAt: null, mode: "onsite" });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await apiPut(`/api/events/${eventId}/mentors/${mentor.assignmentId}`, { skills, bio, location, availability });
      toast(t("hq.saved"), "success");
      await onChanged();
    } catch (err) {
      toast(helpErrorWords(err, t), "error");
    } finally {
      setBusy(false);
    }
  };

  const addSlot = async () => {
    if (!slot.startsAt || !slot.endsAt) return;
    setBusy(true);
    try {
      await apiPost(`/api/events/${eventId}/mentors/slots`, { userId: mentor.userId, startsAt: slot.startsAt, endsAt: slot.endsAt, mode: slot.mode });
      toast(t("hq.slot_added"), "success");
      setSlot({ startsAt: null, endsAt: null, mode: slot.mode });
      await onChanged();
    } catch (err) {
      const fe = err instanceof ApiError ? err.fieldErrors[0] : null;
      const key = fe?.code ? `hq.slot_err.${fe.code}` : "";
      const words = key ? t(key) : "";
      toast(fe && words !== key ? words : helpErrorWords(err, t), "error");
    } finally {
      setBusy(false);
    }
  };

  const removeSlot = async (s: MentorSlot) => {
    try {
      await apiDelete(`/api/events/${eventId}/mentors/slots/${s.id}`);
      toast(t("hq.slot_removed"), "success");
      await onChanged();
    } catch (err) {
      toast(helpErrorWords(err, t), "error");
    }
  };

  return (
    <Drawer open onClose={onClose} title={mentor.name} description={mentor.email ?? undefined}
      footer={
        <div className="flex w-full flex-wrap justify-between gap-2">
          <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} style={{ color: "var(--danger)" }} onClick={onRemove}>{t("mt.remove")}</Button>
          <Button size="sm" variant="primary" onClick={() => void save()} loading={busy} disabled={busy}>{t("hq.save")}</Button>
        </div>
      }>
      <div className="space-y-5 text-[13.5px]">
        <div className="flex flex-wrap items-center gap-3">
          <PresenceDot mentor={mentor} />
          <span style={{ color: "var(--ink-2)" }}>{fill(t("mt.load"), { now: mentor.activeTickets, done: mentor.resolvedTickets })}</span>
          {mentor.waitingForThem ? <Badge tone="info">{fill(t("mt.waiting_for_them"), { n: mentor.waitingForThem })}</Badge> : null}
        </div>
        <ChipsInput label={t("mt.skills")} values={skills} onChange={setSkills} max={20} placeholder={t("mt.skills_ph")} />
        <TextArea label={t("mt.bio")} value={bio} onChange={setBio} rows={3} maxLength={600} />
        <TextInput label={t("mt.location")} value={location} onChange={setLocation} maxLength={120} placeholder={t("mt.location_ph")} />
        <TextInput label={t("mt.availability")} value={availability} onChange={setAvailability} maxLength={255} placeholder={t("mt.availability_ph")} />

        <section className="space-y-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{t("mt.hours")}</h3>
          {slots.length ? (
            <ul className="divide-y rounded-[var(--radius-sm)] border" style={{ borderColor: "var(--line)" }}>
              {slots.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2" style={{ borderColor: "var(--line)" }}>
                  <span className="flex min-w-0 items-center gap-1.5" style={{ color: "var(--ink)" }}><Clock size={13} aria-hidden="true" style={{ color: "var(--ink-3)" }} /><span className="truncate">{slotText(s, timeZone, lang, t)}</span></span>
                  <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} aria-label={t("hq.slot_remove")} title={t("hq.slot_remove")} onClick={() => void removeSlot(s)} />
                </li>
              ))}
            </ul>
          ) : <p style={{ color: "var(--ink-3)" }}>{t("mt.no_hours")}</p>}
          <DateTimeInput label={t("mt.from")} value={slot.startsAt} onChange={(v) => setSlot({ ...slot, startsAt: v })} timeZone={timeZone} zoneLabel={fill(t("an.zone"), { zone })} />
          <DateTimeInput label={t("mt.to")} value={slot.endsAt} onChange={(v) => setSlot({ ...slot, endsAt: v })} timeZone={timeZone} zoneLabel={fill(t("an.zone"), { zone })} />
          <Segmented value={slot.mode} onChange={(v) => setSlot({ ...slot, mode: v })} options={[{ value: "onsite", label: t("hq.mode.onsite") }, { value: "online", label: t("hq.mode.online") }]} />
          <div className="flex justify-end">
            <Button size="sm" icon={<Plus size={13} />} onClick={() => void addSlot()} disabled={busy || !slot.startsAt || !slot.endsAt}>{t("mt.add_hours")}</Button>
          </div>
        </section>
      </div>
    </Drawer>
  );
}
