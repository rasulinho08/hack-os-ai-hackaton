"use client";

/**
 * The mentor's home: say whether you are around (participants see it, as an
 * online dot while this portal is open), what you know and where to find
 * you, the hours you will be there — and the queue at a glance.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Clock, Lock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ds/primitives";
import { ChipsInput, DateTimeInput, Notice, Segmented, TextArea, TextInput } from "@/components/builder/ui";
import { BrandLoader } from "@/components/BrandLoader";
import { LoadFailure } from "@/components/LoadFailure";
import { slotText } from "@/components/help/HelpParts";
import { MyCertificates } from "@/components/wrapup/MyCertificates";
import { CalendarFeedCard } from "@/components/calendar/CalendarFeedCard";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { fill } from "@/lib/i18n/fill";
import { staffEventId } from "@/lib/participantEvent";
import { useEventZone } from "@/lib/useEventZone";
import {
  PRESENCES, helpErrorWords, normalizeSlots, normalizeTickets,
  type HelpTicket, type MentorSlot, type Presence,
} from "@/lib/helpQueue";

interface Profile { userId: number; skills: string[]; bio: string; location: string; availability: string; presence: Presence }

export default function MentorHomePage() {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const [eventId, setEventId] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "no_event" | "failed">("loading");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [slots, setSlots] = useState<MentorSlot[]>([]);
  const [tickets, setTickets] = useState<HelpTicket[]>([]);
  const [busy, setBusy] = useState(false);
  const [slotForm, setSlotForm] = useState<{ startsAt: string | null; endsAt: string | null; mode: "onsite" | "online"; note: string }>({ startsAt: null, endsAt: null, mode: "onsite", note: "" });
  const [slotError, setSlotError] = useState<{ startsAt?: string; endsAt?: string } | null>(null);
  const { timeZone, zone } = useEventZone(eventId);

  const load = useCallback(async (eid: number) => {
    try {
      const [me, rows] = await Promise.all([
        apiGet<Record<string, unknown>>(`/api/events/${eid}/mentors/me`),
        apiGet<unknown[]>(`/api/tickets?eventId=${eid}`).catch(() => []),
      ]);
      const p: Profile = {
        userId: Number(me.user_id),
        skills: Array.isArray(me.skills) ? me.skills.map(String) : [],
        bio: String(me.bio ?? ""),
        location: String(me.location ?? ""),
        availability: String(me.availability ?? ""),
        presence: (PRESENCES as string[]).includes(String(me.presence)) ? (me.presence as Presence) : "available",
      };
      setProfile(p);
      setSlots(normalizeSlots(me.slots));
      setTickets(normalizeTickets(rows));
      setState("ready");
    } catch (err) {
      setState(err instanceof ApiError && err.status === 403 ? "no_event" : "failed");
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

  const counts = useMemo(() => {
    const me = profile?.userId ?? -1;
    return {
      open: tickets.filter((x) => x.status === "open").length,
      forMe: tickets.filter((x) => x.status === "open" && x.preferredMentorId === me).length,
      mine: tickets.filter((x) => x.status === "in-progress" && x.mentorId === me).length,
      resolved: tickets.filter((x) => x.closedReason === "resolved" && x.mentorId === me).length,
    };
  }, [tickets, profile]);

  const save = async (patch: Partial<Profile>, okKey = "hq.saved") => {
    if (eventId == null) return;
    setBusy(true);
    try {
      await apiPatch(`/api/events/${eventId}/mentors/me`, patch);
      toast(t(okKey), "success");
      setDraft(null);
      await load(eventId);
    } catch (err) {
      toast(helpErrorWords(err, t), "error");
    } finally {
      setBusy(false);
    }
  };

  const addSlot = async () => {
    if (eventId == null) return;
    const errs: { startsAt?: string; endsAt?: string } = {};
    if (!slotForm.startsAt) errs.startsAt = t("hq.f.required");
    if (!slotForm.endsAt) errs.endsAt = t("hq.f.required");
    setSlotError(Object.keys(errs).length ? errs : null);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await apiPost(`/api/events/${eventId}/mentors/slots`, { startsAt: slotForm.startsAt, endsAt: slotForm.endsAt, mode: slotForm.mode, note: slotForm.note.trim() || undefined });
      toast(t("hq.slot_added"), "success");
      setSlotForm({ startsAt: null, endsAt: null, mode: slotForm.mode, note: "" });
      await load(eventId);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length) {
        const fe: { startsAt?: string; endsAt?: string } = {};
        for (const f of err.fieldErrors) {
          const key = f.code ? `hq.slot_err.${f.code}` : "";
          const words = key ? t(key) : "";
          if (f.field === "startsAt" || f.field === "endsAt") fe[f.field] = words && words !== key ? words : f.message;
        }
        setSlotError(fe);
      } else {
        toast(helpErrorWords(err, t), "error");
      }
    } finally {
      setBusy(false);
    }
  };

  const removeSlot = async (s: MentorSlot) => {
    if (eventId == null) return;
    try {
      await apiDelete(`/api/events/${eventId}/mentors/slots/${s.id}`);
      toast(t("hq.slot_removed"), "success");
      await load(eventId);
    } catch (err) {
      toast(helpErrorWords(err, t), "error");
    }
  };

  if (state === "loading") return <BrandLoader message={t("Loading")} fullMinHeight />;

  const header = (
    <div>
      <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("mt.home_title")}</h1>
      <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>{t("mt.home_subtitle")}</p>
    </div>
  );
  if (state !== "ready" || !profile) {
    return (
      <div className="space-y-6">
        {header}
        {state === "failed"
          ? <LoadFailure message={t("hq.load_failed")} onRetry={() => eventId != null && void load(eventId)} />
          : <Notice tone="info" icon={<Lock size={15} />}>{t("hq.no_event_staff")}</Notice>}
      </div>
    );
  }

  const d = draft ?? profile;
  const card = "rounded-[var(--radius)] border p-5";
  const cardStyle = { borderColor: "var(--line)", background: "var(--surface)" };
  const stats = [
    { label: t("mt.stat.open"), value: counts.open, href: "/mentor/help-queue" },
    { label: t("mt.stat.for_me"), value: counts.forMe, href: "/mentor/help-queue" },
    { label: t("mt.stat.mine"), value: counts.mine, href: "/mentor/my-tickets" },
    { label: t("mt.stat.resolved"), value: counts.resolved, href: "/mentor/my-tickets" },
  ];

  return (
    <div className="space-y-6">
      {header}

      <section className={card} style={cardStyle} aria-label={t("mt.presence")}>
        <Segmented label={t("mt.presence")} value={profile.presence} onChange={(v) => void save({ presence: v }, "mt.presence_saved")}
          options={PRESENCES.map((p) => ({ value: p, label: t(`hq.presence_set.${p}`), hint: t(`mt.presence_hint.${p}`) }))} columns={3} />
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="rounded-[var(--radius)] border px-4 py-3.5 transition-colors hover:opacity-90" style={cardStyle}>
            <p className="text-[12px] font-medium uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{s.label}</p>
            <p className="mt-1 text-[24px] font-bold tabular-nums" style={{ color: "var(--ink)" }}>{s.value}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className={`${card} space-y-4`} style={cardStyle} aria-label={t("mt.profile")}>
          <h2 className="text-[16px] font-semibold" style={{ color: "var(--ink)" }}>{t("mt.profile")}</h2>
          <ChipsInput label={t("mt.skills")} values={d.skills} max={20} placeholder={t("mt.skills_ph")} help={t("mt.skills_help")}
            onChange={(v) => setDraft({ ...d, skills: v })} />
          <TextArea label={t("mt.bio")} value={d.bio} onChange={(v) => setDraft({ ...d, bio: v })} rows={3} maxLength={600} placeholder={t("mt.bio_ph")} />
          <TextInput label={t("mt.location")} value={d.location} onChange={(v) => setDraft({ ...d, location: v })} maxLength={120} placeholder={t("mt.location_ph")} />
          <TextInput label={t("mt.availability")} value={d.availability} onChange={(v) => setDraft({ ...d, availability: v })} maxLength={255} placeholder={t("mt.availability_ph")} help={t("mt.availability_help")} />
          <div className="flex justify-end">
            <Button variant="primary" size="sm" disabled={!draft || busy} loading={busy && Boolean(draft)}
              onClick={() => void save({ skills: d.skills, bio: d.bio, location: d.location, availability: d.availability })}>{t("hq.save")}</Button>
          </div>
        </section>

        <section className={`${card} space-y-4`} style={cardStyle} aria-label={t("mt.hours")}>
          <div>
            <h2 className="text-[16px] font-semibold" style={{ color: "var(--ink)" }}>{t("mt.hours")}</h2>
            <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>{t("mt.hours_help")}</p>
          </div>
          {slots.length ? (
            <ul className="divide-y rounded-[var(--radius-sm)] border" style={{ borderColor: "var(--line)" }}>
              {slots.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[13.5px]" style={{ borderColor: "var(--line)" }}>
                  <span className="flex min-w-0 items-center gap-1.5" style={{ color: "var(--ink)" }}>
                    <Clock size={13} aria-hidden="true" style={{ color: "var(--ink-3)" }} />
                    <span className="truncate">{slotText(s, timeZone, lang, t)}{s.note ? ` · ${s.note}` : ""}</span>
                  </span>
                  <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} aria-label={t("hq.slot_remove")} title={t("hq.slot_remove")} onClick={() => void removeSlot(s)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13.5px]" style={{ color: "var(--ink-3)" }}>{t("mt.no_hours")}</p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DateTimeInput label={t("mt.from")} value={slotForm.startsAt} onChange={(v) => setSlotForm({ ...slotForm, startsAt: v })} timeZone={timeZone} zoneLabel={fill(t("an.zone"), { zone })} error={slotError?.startsAt} />
            <DateTimeInput label={t("mt.to")} value={slotForm.endsAt} onChange={(v) => setSlotForm({ ...slotForm, endsAt: v })} timeZone={timeZone} zoneLabel={fill(t("an.zone"), { zone })} error={slotError?.endsAt} />
          </div>
          <Segmented value={slotForm.mode} onChange={(v) => setSlotForm({ ...slotForm, mode: v })}
            options={[{ value: "onsite", label: t("hq.mode.onsite") }, { value: "online", label: t("hq.mode.online") }]} />
          <TextInput label={t("mt.note")} value={slotForm.note} onChange={(v) => setSlotForm({ ...slotForm, note: v })} maxLength={200} placeholder={t("mt.note_ph")} optional={t("Optional")} />
          <div className="flex justify-end">
            <Button size="sm" icon={<Plus size={13} />} onClick={() => void addSlot()} disabled={busy}>{t("mt.add_hours")}</Button>
          </div>
        </section>
      </div>

      {/* Appears once certificates are issued. */}
      <MyCertificates />

      <CalendarFeedCard />
    </div>
  );
}
