"use client";

/**
 * Ask a mentor for help: what is wrong, where you are, how urgent — and,
 * if you like, which mentor (they hear about it first; anyone can still
 * come). Follow your requests (waiting, someone is on the way, closed and
 * why) and withdraw one you no longer need. Below, the mentors: what they
 * know, where to find them, whether they are around, their next hours.
 *
 * The form is kept in this browser while you type, so a refresh does not
 * lose it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { HelpCircle, Lock, MessageSquare, Plus, Send, X } from "lucide-react";
import { Badge, Button } from "@/components/ds/primitives";
import { Notice, Segmented, TextArea, TextInput } from "@/components/builder/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { BrandLoader } from "@/components/BrandLoader";
import { LoadFailure } from "@/components/LoadFailure";
import { MentorCardView, PRIORITY_TONE, TicketStatusBadge, slotText } from "@/components/help/HelpParts";
import { TicketThreadDrawer } from "@/components/chat/TicketThreadDrawer";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { fill } from "@/lib/i18n/fill";
import { formatRelativeTime } from "@/lib/relativeTime";
import { participantEventId } from "@/lib/participantEvent";
import { useEventZone } from "@/lib/useEventZone";
import {
  TICKET_PRIORITIES, helpErrorWords, minutesSince, normalizeMentors, normalizeSlots, normalizeTickets, rankMentors,
  type HelpTicket, type MentorCard, type MentorSlot, type TicketPriority,
} from "@/lib/helpQueue";

const DRAFT_KEY = "hh:hacker_help:draft_v2";
const POLL_MS = 20_000;

interface Draft { topic: string; description: string; where: string; priority: TicketPriority; mentorId: number | null }
const EMPTY: Draft = { topic: "", description: "", where: "", priority: "normal", mentorId: null };

function readDraft(): Draft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    return {
      topic: typeof d.topic === "string" ? d.topic : "",
      description: typeof d.description === "string" ? d.description : "",
      where: typeof d.where === "string" ? d.where : "",
      priority: TICKET_PRIORITIES.includes(d.priority as TicketPriority) ? (d.priority as TicketPriority) : "normal",
      mentorId: typeof d.mentorId === "number" ? d.mentorId : null,
    };
  } catch {
    return null;
  }
}
function writeDraft(d: Draft | null) {
  try {
    if (d) window.localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* private mode */
  }
}

export default function HackerHelpPage() {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const [eventId, setEventId] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "no_event" | "failed">("loading");
  const [tickets, setTickets] = useState<HelpTicket[]>([]);
  const [mentors, setMentors] = useState<MentorCard[]>([]);
  const [slots, setSlots] = useState<MentorSlot[]>([]);
  // A draft from before a refresh reopens the form where it was. (The first
  // render is the loader on the server and in the browser alike.)
  const [draft, setDraft] = useState<Draft>(() => (typeof window === "undefined" ? EMPTY : readDraft() ?? EMPTY));
  const [open, setOpen] = useState(() => Boolean(draft.topic || draft.description));
  const [errors, setErrors] = useState<Partial<Record<"topic" | "description", string>>>({});
  const [busy, setBusy] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [withdraw, setWithdraw] = useState<HelpTicket | null>(null);
  const [thread, setThread] = useState<HelpTicket | null>(null);
  const { timeZone } = useEventZone(eventId);

  const load = useCallback(async (eid: number) => {
    try {
      const [mine, ms, sl] = await Promise.all([
        apiGet<unknown[]>(`/api/tickets?eventId=${eid}`),
        apiGet<unknown[]>(`/api/events/${eid}/mentors`).catch(() => []),
        apiGet<unknown[]>(`/api/events/${eid}/mentors/slots`).catch(() => []),
      ]);
      setTickets(normalizeTickets(mine));
      setMentors(normalizeMentors(ms));
      setSlots(normalizeSlots(sl));
      setState("ready");
    } catch {
      setState("failed");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const eid = await participantEventId();
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

  const update = (patch: Partial<Draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    writeDraft(next);
    if (patch.topic !== undefined || patch.description !== undefined) setErrors({});
  };

  const ranked = useMemo(() => rankMentors(mentors, `${draft.topic} ${draft.description}`), [mentors, draft.topic, draft.description]);

  const submit = async () => {
    if (eventId == null) return;
    const errs: typeof errors = {};
    if (!draft.topic.trim()) errs.topic = t("hq.f.topic_required");
    if (draft.description.trim().length < 10) errs.description = t("hq.f.desc_short");
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await apiPost("/api/tickets", {
        eventId,
        topic: draft.topic.trim().slice(0, 255),
        description: draft.description.trim(),
        tableLocation: draft.where.trim() || undefined,
        priority: draft.priority,
        preferredMentorId: draft.mentorId ?? undefined,
      });
      toast(t("hq.sent"), "success");
      setDraft(EMPTY);
      writeDraft(null);
      setOpen(false);
      await load(eventId);
    } catch (err) {
      if (err instanceof ApiError && err.code === "TICKETS_DISABLED") setDisabled(true);
      toast(helpErrorWords(err, t), "error");
    } finally {
      setBusy(false);
    }
  };

  const doWithdraw = async (tk: HelpTicket) => {
    if (eventId == null) return;
    try {
      await apiPost(`/api/tickets/${tk.id}/withdraw`, {});
      toast(t("hq.withdrawn"), "success");
      await load(eventId);
    } catch (err) {
      toast(helpErrorWords(err, t), "error");
    }
  };

  if (state === "loading") return <BrandLoader message={t("Loading")} fullMinHeight />;

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("hq.title_hacker")}</h1>
        <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>{t("hq.subtitle_hacker")}</p>
      </div>
      {state === "ready" && !open && !disabled ? (
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => setOpen(true)}>{t("hq.ask")}</Button>
      ) : null}
    </div>
  );

  if (state !== "ready") {
    return (
      <div className="space-y-6">
        {header}
        {state === "failed"
          ? <LoadFailure message={t("hq.load_failed")} onRetry={() => eventId != null && void load(eventId)} />
          : <Notice tone="info" icon={<Lock size={15} />}>{t("mm.no_event")}</Notice>}
      </div>
    );
  }

  const active = tickets.filter((x) => x.status !== "resolved");
  const closed = tickets.filter((x) => x.status === "resolved").slice(0, 10);

  const ticketCard = (tk: HelpTicket) => {
    const waiting = minutesSince(tk.createdAt);
    return (
      <li key={tk.id} className="rounded-[var(--radius)] border p-4" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold" style={{ color: "var(--ink)" }}>{tk.topic}</p>
            <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
              {[tk.createdAt ? formatRelativeTime(tk.createdAt, lang) : null, tk.tableLocation].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {tk.priority !== "normal" ? <Badge tone={PRIORITY_TONE[tk.priority]}>{t(`hq.prio.${tk.priority}`)}</Badge> : null}
            <TicketStatusBadge ticket={tk} />
          </div>
        </div>
        <p className="mt-2 text-[13.5px]" style={{ color: "var(--ink-2)" }}>
          {tk.status === "in-progress" && tk.mentorName
            ? fill(t("hq.on_the_way"), { name: tk.mentorName })
            : tk.status === "open"
              ? (tk.preferredMentor ? fill(t("hq.waiting_for"), { name: tk.preferredMentor, n: waiting }) : fill(t("hq.waiting"), { n: waiting }))
              : tk.mentorName ? fill(t("hq.helped_by"), { name: tk.mentorName }) : null}
        </p>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="ghost" icon={<MessageSquare size={13} />} onClick={() => setThread(tk)}>{t("ch.ticket_messages")}</Button>
          {tk.status !== "resolved" ? (
            <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => setWithdraw(tk)}>{t("hq.withdraw")}</Button>
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      {header}
      {disabled ? <Notice tone="warn" icon={<Lock size={15} />}>{t("hq.err.TICKETS_DISABLED")}</Notice> : null}

      {open && !disabled ? (
        <section className="space-y-5 rounded-[var(--radius)] border p-5" style={{ borderColor: "var(--line)", background: "var(--surface)" }} aria-label={t("hq.ask")}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-[16px] font-semibold" style={{ color: "var(--ink)" }}><HelpCircle size={16} aria-hidden="true" />{t("hq.ask")}</h2>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{t("hq.close")}</Button>
          </div>
          <TextInput label={t("hq.f.topic")} value={draft.topic} onChange={(v) => update({ topic: v })} placeholder={t("hq.f.topic_ph")} maxLength={255} required error={errors.topic} />
          <TextArea label={t("hq.f.desc")} value={draft.description} onChange={(v) => update({ description: v })} placeholder={t("hq.f.desc_ph")} rows={4} maxLength={4000} required error={errors.description} />
          <TextInput label={t("hq.f.where")} value={draft.where} onChange={(v) => update({ where: v })} placeholder={t("hq.f.where_ph")} maxLength={100} optional={t("Optional")} />
          <Segmented label={t("hq.f.priority")} value={draft.priority} onChange={(v) => update({ priority: v })}
            options={TICKET_PRIORITIES.map((p) => ({ value: p, label: t(`hq.prio.${p}`), hint: t(`hq.prio_hint.${p}`) }))} />
          {ranked.length ? (
            <div>
              <p className="text-[13px] font-medium" style={{ color: "var(--ink)" }}>{t("hq.f.mentor")} <span className="font-normal" style={{ color: "var(--ink-3)" }}>· {t("Optional")}</span></p>
              <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>{t("hq.f.mentor_hint")}</p>
              <div role="radiogroup" aria-label={t("hq.f.mentor")} className="mt-2.5 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                {[null, ...ranked].map((m) => {
                  const id = m ? m.userId : null;
                  const on = draft.mentorId === id;
                  return (
                    <button key={id ?? "anyone"} type="button" role="radio" aria-checked={on} onClick={() => update({ mentorId: id })}
                      className="rounded-[12px] border p-3 text-left transition-colors"
                      style={{ borderColor: on ? "var(--accent-solid)" : "var(--line)", background: on ? "var(--accent-weak)" : "var(--surface)", boxShadow: on ? "0 0 0 1px var(--accent-solid) inset" : "none" }}>
                      {m ? (
                        <MentorCardView mentor={m} matched={m.matched} timeZone={timeZone} compact />
                      ) : (
                        <span className="flex h-full flex-col justify-center gap-1">
                          <span className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>{t("hq.f.anyone")}</span>
                          <span className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>{t("hq.f.anyone_hint")}</span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setDraft(EMPTY); writeDraft(null); setOpen(false); }}>{t("hq.discard")}</Button>
            <Button variant="primary" icon={<Send size={14} />} onClick={() => void submit()} loading={busy} disabled={busy}>{t("hq.send")}</Button>
          </div>
        </section>
      ) : null}

      <section className="space-y-3" aria-label={t("hq.mine")}>
        <h2 className="text-[16px] font-semibold" style={{ color: "var(--ink)" }}>{t("hq.mine")}</h2>
        {active.length || closed.length ? (
          <ul className="space-y-2.5">{[...active, ...closed].map(ticketCard)}</ul>
        ) : (
          <p className="text-[13.5px]" style={{ color: "var(--ink-3)" }}>{t("hq.none_mine")}</p>
        )}
      </section>

      {mentors.length ? (
        <section className="space-y-3" aria-label={t("hq.mentors")}>
          <h2 className="text-[16px] font-semibold" style={{ color: "var(--ink)" }}>{t("hq.mentors")}</h2>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rankMentors(mentors, "").map((m) => (
              <li key={m.userId} className="rounded-[var(--radius)] border p-4" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
                <MentorCardView mentor={m} timeZone={timeZone} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {slots.length ? (
        <section className="space-y-2" aria-label={t("hq.hours")}>
          <h2 className="text-[16px] font-semibold" style={{ color: "var(--ink)" }}>{t("hq.hours")}</h2>
          <ul className="divide-y rounded-[var(--radius)] border" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
            {slots.slice(0, 30).map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13.5px]" style={{ borderColor: "var(--line)" }}>
                <span style={{ color: "var(--ink)" }}>{s.mentorName}</span>
                <span style={{ color: "var(--ink-2)" }}>{slotText(s, timeZone, lang, t)}{s.note ? ` · ${s.note}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <TicketThreadDrawer eventId={eventId} ticketId={thread?.id ?? null} topic={thread?.topic ?? ""} open={Boolean(thread)} onClose={() => setThread(null)} />

      <ConfirmDialog
        open={Boolean(withdraw)}
        title={withdraw ? fill(t("hq.withdraw_t"), { topic: withdraw.topic }) : ""}
        message={t("hq.withdraw_b")}
        confirmLabel={t("hq.withdraw")}
        cancelLabel={t("hq.keep")}
        variant="danger"
        onCancel={() => setWithdraw(null)}
        onConfirm={() => { const tk = withdraw; setWithdraw(null); if (tk) void doWithdraw(tk); }}
      />
    </div>
  );
}
