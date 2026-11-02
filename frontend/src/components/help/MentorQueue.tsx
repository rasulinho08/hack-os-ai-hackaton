"use client";

/**
 * The mentor's help queue. Open requests first — the ones that asked for
 * you, then the urgent ones, then the longest waiting — each with the skills
 * of yours it mentions; take one and it moves to "Mine", where you mark it
 * resolved or flag it for the organisers. "Resolved by me" lets you reopen
 * one marked resolved by mistake.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Hand, Lock, MapPin, MessageSquare, RotateCcw } from "lucide-react";
import { Badge, Button } from "@/components/ds/primitives";
import { Notice } from "@/components/builder/ui";
import { BrandLoader } from "@/components/BrandLoader";
import { LoadFailure } from "@/components/LoadFailure";
import { PRIORITY_TONE, SkillChips, TicketStatusBadge } from "@/components/help/HelpParts";
import { TicketThreadDrawer } from "@/components/chat/TicketThreadDrawer";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { apiGet, apiPatch } from "@/lib/api";
import { fill } from "@/lib/i18n/fill";
import { formatRelativeTime } from "@/lib/relativeTime";
import { staffEventId } from "@/lib/participantEvent";
import { helpErrorWords, minutesSince, normalizeTickets, skillsMentioned, type HelpTicket } from "@/lib/helpQueue";

export type QueueTab = "open" | "mine" | "done";
const TABS: QueueTab[] = ["open", "mine", "done"];
const URGENCY: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const POLL_MS = 15_000;

interface Me { userId: number; skills: string[] }

export function MentorQueue({ initialTab = "open" }: { initialTab?: QueueTab }) {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const [eventId, setEventId] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "no_event" | "failed">("loading");
  const [tickets, setTickets] = useState<HelpTicket[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<QueueTab>(initialTab);
  const [busy, setBusy] = useState<number | null>(null);
  const [thread, setThread] = useState<HelpTicket | null>(null);

  const load = useCallback(async (eid: number) => {
    try {
      const [rows, mine] = await Promise.all([
        apiGet<unknown[]>(`/api/tickets?eventId=${eid}`),
        apiGet<{ user_id?: number; skills?: unknown }>(`/api/events/${eid}/mentors/me`).catch(() => null),
      ]);
      setTickets(normalizeTickets(rows));
      if (mine?.user_id) setMe({ userId: Number(mine.user_id), skills: Array.isArray(mine.skills) ? mine.skills.map(String) : [] });
      setState("ready");
    } catch {
      setState("failed");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const eid = await staffEventId("mentor");
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
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(eventId);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [eventId, load]);

  const lists = useMemo(() => {
    const mineId = me?.userId ?? -1;
    const open = tickets
      .filter((x) => x.status === "open" && !x.eventFinished)
      .sort((a, b) =>
        Number(b.preferredMentorId === mineId) - Number(a.preferredMentorId === mineId)
        || (URGENCY[a.priority] ?? 2) - (URGENCY[b.priority] ?? 2)
        || String(a.createdAt).localeCompare(String(b.createdAt)));
    const mine = tickets.filter((x) => x.status === "in-progress" && x.mentorId === mineId);
    const done = tickets.filter((x) => x.status === "resolved" && x.mentorId === mineId).slice(0, 30);
    return { open, mine, done };
  }, [tickets, me]);

  const act = async (tk: HelpTicket, path: string, okKey: string) => {
    if (eventId == null) return;
    setBusy(tk.id);
    try {
      await apiPatch(`/api/tickets/${tk.id}/${path}`, { eventId });
      toast(t(okKey), "success");
      if (path === "claim") setTab("mine");
    } catch (err) {
      toast(helpErrorWords(err, t), "error");
    } finally {
      setBusy(null);
      await load(eventId);
    }
  };

  if (state === "loading") return <BrandLoader message={t("Loading")} fullMinHeight />;

  const header = (
    <div>
      <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("hq.title_mentor")}</h1>
      <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>{t("hq.subtitle_mentor")}</p>
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

  const shown = lists[tab];

  const card = (tk: HelpTicket) => {
    const forMe = me != null && tk.preferredMentorId === me.userId;
    const fits = me ? skillsMentioned(me.skills, `${tk.topic} ${tk.description}`) : [];
    return (
      <li key={tk.id} className="rounded-[var(--radius)] border p-4" style={{ borderColor: forMe ? "var(--accent-solid)" : "var(--line)", background: "var(--surface)" }}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold" style={{ color: "var(--ink)" }}>{tk.topic}</p>
            <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
              {[tk.teamName || tk.requesterName, tk.createdAt ? formatRelativeTime(tk.createdAt, lang) : null].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {forMe ? <Badge tone="info">{t("hq.asked_you")}</Badge> : tk.preferredMentor ? <Badge tone="neutral">{fill(t("hq.asked_for"), { name: tk.preferredMentor })}</Badge> : null}
            {tk.priority !== "normal" ? <Badge tone={PRIORITY_TONE[tk.priority]}>{t(`hq.prio.${tk.priority}`)}</Badge> : null}
            <TicketStatusBadge ticket={tk} />
          </div>
        </div>
        {tk.description ? <p className="mt-2 whitespace-pre-line text-[13.5px]" style={{ color: "var(--ink-2)" }}>{tk.description}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
          {tk.tableLocation ? <span className="flex items-center gap-1"><MapPin size={12} aria-hidden="true" />{tk.tableLocation}</span> : null}
          {tk.status === "open" ? <span>{fill(t("hq.waiting"), { n: minutesSince(tk.createdAt) })}</span> : null}
        </div>
        {fits.length ? <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]" style={{ color: "var(--ink-3)" }}>{t("hq.fits")}<SkillChips items={fits} strong={fits} /></div> : null}
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="ghost" icon={<MessageSquare size={13} />} onClick={() => setThread(tk)}>{t("ch.ticket_messages")}</Button>
          {tab === "open" ? (
            <Button size="sm" variant="primary" icon={<Hand size={13} />} disabled={busy != null} loading={busy === tk.id} onClick={() => void act(tk, "claim", "hq.claimed")}>{t("hq.take")}</Button>
          ) : null}
          {tab === "mine" ? (
            <>
              {!tk.escalated ? (
                <Button size="sm" variant="ghost" icon={<AlertTriangle size={13} />} disabled={busy != null} onClick={() => void act(tk, "escalate", "hq.escalated")}>{t("hq.escalate")}</Button>
              ) : null}
              <Button size="sm" variant="primary" icon={<Check size={13} />} disabled={busy != null} loading={busy === tk.id} onClick={() => void act(tk, "resolve", "hq.resolved")}>{t("hq.resolve")}</Button>
            </>
          ) : null}
          {tab === "done" && tk.closedReason === "resolved" ? (
            <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} disabled={busy != null} onClick={() => void act(tk, "unresolve", "hq.reopened")}>{t("hq.reopen")}</Button>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      {header}
      <div role="tablist" aria-label={t("hq.title_mentor")} className="flex flex-wrap gap-1.5">
        {TABS.map((k) => {
          const on = tab === k;
          return (
            <button key={k} role="tab" aria-selected={on} onClick={() => setTab(k)}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium"
              style={{ borderColor: on ? "var(--accent-solid)" : "var(--line-strong)", background: on ? "var(--accent-weak)" : "var(--surface)", color: "var(--ink)" }}>
              {t(`hq.tab.${k}`)}
              <span className="tabular-nums" style={{ color: "var(--ink-3)" }}>{lists[k].length}</span>
            </button>
          );
        })}
      </div>
      {shown.length ? (
        <ul className="space-y-2.5">{shown.map(card)}</ul>
      ) : (
        <p className="rounded-[var(--radius)] border px-4 py-8 text-center text-[14px]" style={{ borderColor: "var(--line)", color: "var(--ink-3)", background: "var(--surface)" }}>{t(`hq.empty.${tab}`)}</p>
      )}
      <TicketThreadDrawer eventId={eventId} ticketId={thread?.id ?? null} topic={thread?.topic ?? ""} open={Boolean(thread)} onClose={() => setThread(null)} />
    </div>
  );
}
