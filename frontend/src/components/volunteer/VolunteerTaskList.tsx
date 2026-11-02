"use client";

/**
 * A volunteer's tasks: their own (to do → doing → done, or hand back) and
 * the free ones anyone can take. Used on the volunteer's home (compact, the
 * next few) and on "My tasks" (everything).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Clock, Hand, Lock, MapPin, Play, Undo2 } from "lucide-react";
import { Badge, Button } from "@/components/ds/primitives";
import { Notice } from "@/components/builder/ui";
import { BrandLoader } from "@/components/BrandLoader";
import { LoadFailure } from "@/components/LoadFailure";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { ApiError, apiGet, apiPatch } from "@/lib/api";
import { formatInZone } from "@/lib/builder/datetime";
import { staffEventId } from "@/lib/participantEvent";
import { useEventZone } from "@/lib/useEventZone";
import { isOverdue, normalizeTasks, type TaskStatus, type VolunteerTask } from "@/lib/volunteerTasks";

interface Me { userId: number; name: string; note: string | null }

export function VolunteerTaskList({ compact = false, title, subtitle }: { compact?: boolean; title: string; subtitle: string }) {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const [eventId, setEventId] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "no_event" | "failed">("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [tasks, setTasks] = useState<VolunteerTask[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const { timeZone } = useEventZone(eventId);

  const load = useCallback(async (eid: number) => {
    try {
      const mine = await apiGet<Record<string, unknown>>(`/api/events/${eid}/volunteers/me`);
      setMe({ userId: Number(mine.user_id), name: String(mine.full_name ?? ""), note: typeof mine.assigned_tasks === "string" && mine.assigned_tasks.trim() ? mine.assigned_tasks : null });
      setTasks(normalizeTasks(mine.tasks));
      setState("ready");
    } catch (err) {
      setState(err instanceof ApiError && err.status === 403 ? "no_event" : "failed");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const eid = await staffEventId("volunteer");
      if (cancelled) return;
      if (eid == null) {
        setState("no_event");
        return;
      }
      setEventId(eid);
      await load(eid);
    })();
    return () => { cancelled = true; };
  }, [load]);

  useEffect(() => {
    if (eventId == null) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(eventId); }, 30_000);
    return () => clearInterval(timer);
  }, [eventId, load]);

  const change = async (task: VolunteerTask, body: { status?: TaskStatus; assigneeId?: number | null }, okKey: string) => {
    if (eventId == null) return;
    setBusy(task.id);
    try {
      await apiPatch(`/api/events/${eventId}/volunteer-tasks/${task.id}`, body);
      toast(t(okKey), "success");
    } catch {
      toast(t("hq.failed"), "error");
    } finally {
      setBusy(null);
      await load(eventId);
    }
  };

  const lists = useMemo(() => {
    const mine = tasks.filter((x) => me && x.assigneeId === me.userId);
    return {
      doing: mine.filter((x) => x.status === "doing"),
      todo: mine.filter((x) => x.status === "todo"),
      done: mine.filter((x) => x.status === "done"),
      free: tasks.filter((x) => !x.assigneeId && x.status !== "done"),
    };
  }, [tasks, me]);

  if (state === "loading") return <BrandLoader message={t("Loading")} fullMinHeight={!compact} />;

  const header = (
    <div>
      <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{title}</h1>
      <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>{subtitle}</p>
    </div>
  );
  if (state !== "ready") {
    return (
      <div className="space-y-6">
        {header}
        {state === "failed"
          ? <LoadFailure message={t("hq.load_failed")} onRetry={() => eventId != null && void load(eventId)} />
          : <Notice tone="info" icon={<Lock size={15} />}>{t("hq.no_event_staff")}</Notice>}
      </div>
    );
  }

  const when = (iso: string) => formatInZone(iso, timeZone, lang, { year: undefined });

  const card = (task: VolunteerTask, kind: "mine" | "free") => (
    <li key={task.id} className="rounded-[var(--radius)] border p-4" style={{ borderColor: isOverdue(task) ? "var(--danger)" : "var(--line)", background: "var(--surface)" }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-semibold" style={{ color: "var(--ink)", textDecoration: task.status === "done" ? "line-through" : undefined }}>{task.title}</p>
        <Badge tone={task.status === "done" ? "ok" : task.status === "doing" ? "info" : isOverdue(task) ? "danger" : "neutral"} dot>
          {isOverdue(task) ? t("vt.overdue") : t(`vt.status.${task.status}`)}
        </Badge>
      </div>
      {task.details && !compact ? <p className="mt-1.5 whitespace-pre-line text-[13.5px]" style={{ color: "var(--ink-2)" }}>{task.details}</p> : null}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
        {task.location ? <span className="flex items-center gap-1"><MapPin size={12} aria-hidden="true" />{task.location}</span> : null}
        {task.dueAt ? <span className="flex items-center gap-1"><Clock size={12} aria-hidden="true" />{when(task.dueAt)}</span> : null}
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {kind === "free" ? (
          <Button size="sm" variant="primary" icon={<Hand size={13} />} disabled={busy != null} loading={busy === task.id}
            onClick={() => me && void change(task, { assigneeId: me.userId }, "vt.taken")}>{t("vt.take")}</Button>
        ) : task.status === "todo" ? (
          <>
            <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} disabled={busy != null} onClick={() => void change(task, { assigneeId: null }, "vt.handed_back")}>{t("vt.hand_back")}</Button>
            <Button size="sm" icon={<Play size={13} />} disabled={busy != null} onClick={() => void change(task, { status: "doing" }, "vt.started")}>{t("vt.start")}</Button>
            <Button size="sm" variant="primary" icon={<Check size={13} />} disabled={busy != null} onClick={() => void change(task, { status: "done" }, "vt.done_saved")}>{t("vt.mark_done")}</Button>
          </>
        ) : task.status === "doing" ? (
          <Button size="sm" variant="primary" icon={<Check size={13} />} disabled={busy != null} loading={busy === task.id} onClick={() => void change(task, { status: "done" }, "vt.done_saved")}>{t("vt.mark_done")}</Button>
        ) : (
          <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} disabled={busy != null} onClick={() => void change(task, { status: "todo" }, "vt.undone")}>{t("vt.not_done")}</Button>
        )}
      </div>
    </li>
  );

  const section = (key: "doing" | "todo" | "done" | "free", items: VolunteerTask[], kind: "mine" | "free") => (
    <section className="space-y-2.5" aria-label={t(`vt.sec.${key}`)}>
      <h2 className="flex items-center gap-2 text-[16px] font-semibold" style={{ color: "var(--ink)" }}>
        {t(`vt.sec.${key}`)}<span className="text-[13px] font-medium tabular-nums" style={{ color: "var(--ink-3)" }}>{items.length}</span>
      </h2>
      {items.length ? <ul className="space-y-2.5">{items.map((x) => card(x, kind))}</ul> : <p className="text-[13.5px]" style={{ color: "var(--ink-3)" }}>{t(`vt.sec_empty.${key}`)}</p>}
    </section>
  );

  if (compact) {
    const next = [...lists.doing, ...lists.todo].slice(0, 4);
    return (
      <div className="space-y-6">
        {header}
        {me?.note ? <Notice tone="info">{me.note}</Notice> : null}
        <div className="grid grid-cols-3 gap-3">
          {(["todo", "doing", "done"] as const).map((k) => (
            <div key={k} className="rounded-[var(--radius)] border px-4 py-3.5" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
              <p className="text-[12px] font-medium uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{t(`vt.status.${k}`)}</p>
              <p className="mt-1 text-[24px] font-bold tabular-nums" style={{ color: "var(--ink)" }}>{lists[k].length}</p>
            </div>
          ))}
        </div>
        <section className="space-y-2.5">
          <h2 className="text-[16px] font-semibold" style={{ color: "var(--ink)" }}>{t("vt.next")}</h2>
          {next.length ? <ul className="space-y-2.5">{next.map((x) => card(x, "mine"))}</ul> : <p className="text-[13.5px]" style={{ color: "var(--ink-3)" }}>{t("vt.sec_empty.todo")}</p>}
        </section>
        {lists.free.length ? section("free", lists.free.slice(0, 3), "free") : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      {me?.note ? <Notice tone="info">{me.note}</Notice> : null}
      {section("doing", lists.doing, "mine")}
      {section("todo", lists.todo, "mine")}
      {section("free", lists.free, "free")}
      {section("done", lists.done, "mine")}
    </div>
  );
}
