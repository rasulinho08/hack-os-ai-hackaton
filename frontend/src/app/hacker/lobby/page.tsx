"use client";

/**
 * Find a team. Without a team: say you are looking (with a line about
 * yourself), join with a team's code, answer invitations, ask teams with room
 * to take you (ranked by what your skills add to them) or invite someone else
 * who is looking to start a team together. In a team: people who would add
 * the most, ranked for your team; the lead also answers join requests and
 * says which skills the team is after.
 *
 * Everything is decided by the API (approval, the team deadline, room in a
 * team); this page says what it answered, in the reader's language.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Crown, KeyRound, Lock, Mail, Search, Send, UserPlus, Users, X } from "lucide-react";
import { Badge, Button } from "@/components/ds/primitives";
import { Modal } from "@/components/ds/overlays";
import { ChipsInput, Notice, TextArea, TextInput, Toggle } from "@/components/builder/ui";
import { LoadFailure } from "@/components/LoadFailure";
import { BrandLoader } from "@/components/BrandLoader";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { fill } from "@/lib/i18n/fill";
import {
  errorWords, isFormationClosed, normalizeIncoming, normalizeMyRequests, normalizeOverview,
  type IncomingRequest, type MmPerson, type MmTeam, type MyRequest, type Overview,
} from "@/lib/matchmaking";
import { participantEventId } from "@/lib/participantEvent";
import { acceptTeamInvite, declineTeamInvite, getIncomingInvites, getOutgoingInvites, sendTeamInvite, type TeamInvite } from "@/lib/teamInvites";

const card = "rounded-[var(--radius)] border p-5";
const cardStyle: React.CSSProperties = { borderColor: "var(--line)", background: "var(--surface)" };

function Chips({ items, strong = [] }: { items: string[]; strong?: string[] }) {
  if (!items.length) return null;
  const on = new Set(strong.map((s) => s.toLowerCase()));
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((s) => (
        <span key={s} className="rounded-full px-2 py-0.5 text-[12px]"
          style={on.has(s.toLowerCase())
            ? { background: "var(--accent-weak)", color: "var(--ink)", fontWeight: 600 }
            : { background: "var(--tint)", color: "var(--ink-2)" }}>
          {s}
        </span>
      ))}
    </div>
  );
}

function SectionTitle({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <h2 className="flex items-center gap-2 text-[16px] font-semibold" style={{ color: "var(--ink)" }}>
      {children}
      {count != null ? <span className="text-[13px] font-medium tabular-nums" style={{ color: "var(--ink-3)" }}>{count}</span> : null}
    </h2>
  );
}

export default function FindTeamPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const router = useRouter();
  const [eventId, setEventId] = useState<number | null>(null);
  const [data, setData] = useState<Overview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "not_approved" | "no_event" | "failed">("loading");
  const [myRequests, setMyRequests] = useState<MyRequest[]>([]);
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [invitesIn, setInvitesIn] = useState<TeamInvite[]>([]);
  const [invitedIds, setInvitedIds] = useState<Set<number>>(new Set());
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [ask, setAsk] = useState<MmTeam | null>(null);
  const [askMessage, setAskMessage] = useState("");
  const [code, setCode] = useState("");
  // Drafts of the two settings forms; null = not edited, show what the API has.
  const [lookingDraft, setLookingDraft] = useState<{ looking: boolean; note: string } | null>(null);
  const [recruitDraft, setRecruitDraft] = useState<{ recruiting: boolean; note: string; wanted: string[] } | null>(null);

  const load = useCallback(async (eid: number) => {
    try {
      const overview = normalizeOverview(await apiGet<unknown>(`/api/events/${eid}/matchmaking`));
      const [mine, invIn, invOut, reqIn] = await Promise.allSettled([
        apiGet<unknown[]>(`/api/teams/requests/mine?eventId=${eid}`),
        getIncomingInvites(eid),
        getOutgoingInvites(eid),
        overview.mode === "team" ? apiGet<unknown[]>(`/api/teams/${overview.team.id}/requests`) : Promise.resolve([]),
      ]);
      // All at once, so the team, its requests and the invitations never disagree on screen.
      setData(overview);
      setClosed(!overview.formation.open);
      setMyRequests(mine.status === "fulfilled" ? normalizeMyRequests(mine.value) : []);
      setInvitesIn(invIn.status === "fulfilled" && Array.isArray(invIn.value) ? invIn.value.filter((i) => i.status === "pending") : []);
      setInvitedIds(new Set(invOut.status === "fulfilled" && Array.isArray(invOut.value) ? invOut.value.filter((i) => i.status === "pending").map((i) => Number(i.to_user_id)) : []));
      setIncoming(reqIn.status === "fulfilled" ? normalizeIncoming(reqIn.value) : []);
      setState("ready");
    } catch (err) {
      if (err instanceof ApiError && err.code === "HACKER_NOT_APPROVED") setState("not_approved");
      else setState("failed");
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
    }, 30_000);
    return () => clearInterval(timer);
  }, [eventId, load]);

  /**
   * Run an action; on success say so, let the caller close its form, then
   * reload. On failure say why (and notice when teams can no longer change).
   */
  const act = async (key: string, fn: () => Promise<unknown>, okKey: string | null, onDone?: () => void) => {
    if (eventId == null) return;
    setBusy(key);
    let ok = false;
    try {
      await fn();
      ok = true;
    } catch (err) {
      if (isFormationClosed(err)) setClosed(true);
      toast(errorWords(err, t), "error");
    } finally {
      setBusy(null);
    }
    if (!ok) return;
    if (okKey) toast(t(okKey), "success");
    onDone?.();
    await load(eventId);
  };

  const pendingTo = useMemo(() => new Map(myRequests.filter((r) => r.status === "pending").map((r) => [r.teamId, r])), [myRequests]);

  const match = useCallback((text: string) => {
    const q = query.trim().toLowerCase();
    return !q || text.toLowerCase().includes(q);
  }, [query]);

  if (state === "loading") return <BrandLoader message={t("Loading")} fullMinHeight />;

  const header = (
    <div>
      <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("mm.title")}</h1>
      <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>
        {data?.mode === "team" ? t("mm.subtitle_team") : t("mm.subtitle_solo")}
      </p>
    </div>
  );

  if (state === "no_event" || state === "not_approved" || state === "failed") {
    return (
      <div className="space-y-6">
        {header}
        {state === "failed" ? (
          <LoadFailure message={t("mm.load_failed")} onRetry={() => eventId != null && void load(eventId)} />
        ) : (
          <Notice tone="info" icon={<Lock size={15} />}>{state === "no_event" ? t("mm.no_event") : t("mm.not_approved")}</Notice>
        )}
      </div>
    );
  }
  if (!data) return null;

  const canChange = !closed;

  const personCard = (p: MmPerson, mode: "solo" | "team") => {
    const invited = invitedIds.has(p.userId);
    const full = data.mode === "team" && data.team.size >= data.teamSize;
    return (
      <li key={p.userId} className={`${card} flex flex-col gap-3`} style={cardStyle}>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
            {p.name}
            {p.looking ? <Badge tone="info">{t("pt.looking")}</Badge> : null}
          </p>
          {[p.university, p.experience].filter(Boolean).length ? (
            <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>{[p.university, p.experience].filter(Boolean).join(" · ")}</p>
          ) : null}
        </div>
        {p.note ? <p className="text-[13.5px]" style={{ color: "var(--ink-2)" }}>“{p.note}”</p> : null}
        <Chips items={p.skills} strong={p.matched} />
        {mode === "team" && (p.matched.length || p.brings.length) ? (
          <p className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>{fill(t("mm.brings"), { skills: [...p.matched, ...p.brings].join(", ") })}</p>
        ) : null}
        <div className="mt-auto pt-1">
          <Button size="sm" variant={invited ? "ghost" : "secondary"} className="w-full"
            icon={invited ? <Check size={13} /> : <UserPlus size={13} />}
            disabled={invited || !canChange || full || busy != null}
            title={!canChange ? t("mm.closed") : full ? t("mm.team_full") : undefined}
            onClick={() => void act(`inv-${p.userId}`, () => sendTeamInvite(p.userId, eventId!), "mm.invited")}>
            {invited ? t("mm.invited") : t("mm.invite")}
          </Button>
        </div>
      </li>
    );
  };

  const teamCard = (x: MmTeam) => {
    const req = pendingTo.get(x.id);
    return (
      <li key={x.id} className={`${card} flex flex-col gap-3`} style={cardStyle}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold" style={{ color: "var(--ink)" }}>
              {x.name}
              {x.recruiting ? <Badge tone="info">{t("tm.recruiting")}</Badge> : null}
            </p>
            <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
              {[x.leadName ? fill(t("mm.lead"), { name: x.leadName }) : null, x.track ? fill(t("mm.track"), { track: x.track }) : null, fill(t("mm.members_line"), { n: x.size })].filter(Boolean).join(" · ")}
            </p>
          </div>
          <Badge tone="ok">{fill(t("mm.open_spots"), { n: x.openSpots })}</Badge>
        </div>
        {x.note ? <p className="text-[13.5px]" style={{ color: "var(--ink-2)" }}>“{x.note}”</p> : null}
        {x.wantedSkills.length ? (
          <div>
            <p className="mb-1 text-[12px] font-medium uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{t("mm.wanted")}</p>
            <Chips items={x.wantedSkills} strong={x.matched} />
          </div>
        ) : null}
        {x.matched.length ? <p className="text-[12.5px]" style={{ color: "var(--ok)" }}>{fill(t("mm.matched"), { skills: x.matched.join(", ") })}</p> : null}
        <div className="mt-auto flex gap-2 pt-1">
          {req ? (
            <>
              <Badge tone="warn" dot>{t("mm.asked")}</Badge>
              <Button size="sm" variant="ghost" disabled={busy != null} onClick={() => void act(`wd-${req.id}`, () => apiDelete(`/api/teams/requests/${req.id}`), "mm.withdrawn")}>{t("mm.withdraw")}</Button>
            </>
          ) : (
            <Button size="sm" variant="primary" className="w-full" icon={<Send size={13} />} disabled={!canChange || busy != null}
              title={!canChange ? t("mm.closed") : undefined}
              onClick={() => { setAskMessage(""); setAsk(x); }}>
              {t("mm.ask")}
            </Button>
          )}
        </div>
      </li>
    );
  };

  const search = (
    <label className="relative block w-full sm:w-80">
      <span className="sr-only">{t("mm.search_ph")}</span>
      <Search size={14} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--ink-3)" }} />
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("mm.search_ph")}
        className="h-9 w-full rounded-[var(--radius-sm)] border pl-8 pr-3 text-[13px] outline-none"
        style={{ borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink)" }} />
    </label>
  );

  const invitationsSection = invitesIn.length ? (
    <section className={card} style={{ ...cardStyle, borderColor: "var(--warn)" }} aria-label={t("mm.invites_in")}>
      <SectionTitle count={invitesIn.length}><Mail size={16} aria-hidden="true" style={{ color: "var(--warn)" }} />{t("mm.invites_in")}</SectionTitle>
      <ul className="mt-3 space-y-2">
        {invitesIn.map((inv) => (
          <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] px-3 py-2.5" style={{ background: "var(--tint)" }}>
            <p className="text-[13.5px]" style={{ color: "var(--ink)" }}>{fill(t("mm.invite_from"), { name: inv.from_name || inv.from_email || "—" })}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" icon={<Check size={13} />} disabled={!canChange || busy != null}
                onClick={() => void act(`ia-${inv.id}`, () => acceptTeamInvite(inv.id), "mm.invite_accepted", () => router.push("/hacker/team"))}>
                {t("mm.invite_join")}
              </Button>
              <Button size="sm" variant="ghost" icon={<X size={13} />} disabled={busy != null}
                onClick={() => void act(`id-${inv.id}`, () => declineTeamInvite(inv.id), "mm.invite_declined")}>
                {t("mm.decline")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  ) : null;

  // ── In a team ──────────────────────────────────────────────────────────
  if (data.mode === "team") {
    const tm = data.team;
    const draft = recruitDraft ?? { recruiting: tm.recruiting, note: tm.note || "", wanted: tm.wantedSkills };
    const people = data.people.filter((p) => match(`${p.name} ${p.skills.join(" ")} ${p.note || ""}`));
    return (
      <div className="space-y-6">
        {header}
        {closed ? <Notice tone="warn" icon={<Lock size={15} />}>{t("mm.closed")}</Notice> : null}

        <section className={`${card} flex flex-wrap items-center justify-between gap-3`} style={cardStyle}>
          <div className="min-w-0">
            <p className="text-[12px] font-medium uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{t("mm.your_team")}</p>
            <p className="mt-0.5 flex items-center gap-2 text-[18px] font-semibold" style={{ color: "var(--ink)" }}>
              {tm.isLead ? <Crown size={15} aria-label={t("pt.lead")} style={{ color: "var(--warn)" }} /> : <Users size={15} aria-hidden="true" />}
              {tm.name}
            </p>
            <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>
              {fill(t("mm.size"), { n: tm.size, max: data.teamSize })}{tm.size >= data.teamSize ? ` · ${t("mm.team_full")}` : ""}
            </p>
          </div>
          <Link href="/hacker/team" className="inline-flex min-h-9 items-center rounded-[var(--radius-sm)] border px-3 text-[13px] font-medium"
            style={{ borderColor: "var(--line-strong)", color: "var(--ink)" }}>
            {t("mm.open_team")}
          </Link>
        </section>

        {tm.isLead ? (
          <section className={card} style={cardStyle} aria-label={t("mm.requests_in")}>
            <SectionTitle count={incoming.length}>{t("mm.requests_in")}</SectionTitle>
            {incoming.length ? (
              <ul className="mt-3 space-y-2">
                {incoming.map((r) => (
                  <li key={r.id} className="rounded-[var(--radius-sm)] border px-3 py-2.5" style={{ borderColor: "var(--line)" }}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium" style={{ color: "var(--ink)" }}>{r.name}</p>
                        {[r.university, r.experience].filter(Boolean).length ? (
                          <p className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>{[r.university, r.experience].filter(Boolean).join(" · ")}</p>
                        ) : null}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="primary" icon={<Check size={13} />} disabled={!canChange || busy != null || tm.size >= data.teamSize}
                          onClick={() => void act(`ra-${r.id}`, () => apiPost(`/api/teams/requests/${r.id}/accept`, {}), "mm.accepted")}>
                          {t("mm.accept")}
                        </Button>
                        <Button size="sm" variant="ghost" icon={<X size={13} />} disabled={busy != null}
                          onClick={() => void act(`rd-${r.id}`, () => apiPost(`/api/teams/requests/${r.id}/decline`, {}), "mm.declined")}>
                          {t("mm.decline")}
                        </Button>
                      </div>
                    </div>
                    {r.message ? <p className="mt-2 text-[13.5px]" style={{ color: "var(--ink-2)" }}>“{r.message}”</p> : null}
                    <div className="mt-2"><Chips items={r.skills} strong={tm.wantedSkills} /></div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[13.5px]" style={{ color: "var(--ink-3)" }}>{t("mm.requests_none")}</p>
            )}
          </section>
        ) : null}

        {/* Recruiting means nothing once teams can no longer change. */}
        {closed ? null : (
        <section className={card} style={cardStyle}>
          <SectionTitle>{t("mm.recruiting")}</SectionTitle>
          {tm.isLead ? (
            <div className="mt-2 space-y-4">
              <Toggle label={t("mm.recruiting")} help={t("mm.recruiting_hint")} checked={draft.recruiting}
                onChange={(v) => setRecruitDraft({ ...draft, recruiting: v })} />
              <ChipsInput label={t("mm.wanted_skills")} values={draft.wanted} max={12} placeholder={t("mm.wanted_ph")}
                onChange={(v) => setRecruitDraft({ ...draft, wanted: v })} />
              <TextInput label={t("mm.team_note")} value={draft.note} maxLength={280} placeholder={t("mm.team_note_ph")}
                onChange={(v) => setRecruitDraft({ ...draft, note: v })} />
              <div className="flex justify-end">
                <Button size="sm" variant="primary" disabled={!recruitDraft || busy != null} loading={busy === "recruit"}
                  onClick={() => void act("recruit", () => apiPatch(`/api/teams/${tm.id}/recruiting`, { recruiting: draft.recruiting, note: draft.note, wantedSkills: draft.wanted }), "mm.saved", () => setRecruitDraft(null))}>
                  {t("mm.save")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-2 space-y-2 text-[13.5px]">
              <Chips items={tm.wantedSkills} />
              {tm.note ? <p style={{ color: "var(--ink-2)" }}>“{tm.note}”</p> : null}
              <p style={{ color: "var(--ink-3)" }}>{t("mm.only_lead")}</p>
            </div>
          )}
        </section>
        )}

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionTitle count={people.length}>{t("mm.suggested")}</SectionTitle>
            {search}
          </div>
          {people.length ? (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{people.map((p) => personCard(p, "team"))}</ul>
          ) : (
            <p className="text-[13.5px]" style={{ color: "var(--ink-3)" }}>{t("mm.no_people")}</p>
          )}
        </section>
      </div>
    );
  }

  // ── Without a team ─────────────────────────────────────────────────────
  const me = data.me;
  const lookDraft = lookingDraft ?? { looking: me.looking, note: me.note || "" };
  const teams = data.teams.filter((x) => match(`${x.name} ${x.wantedSkills.join(" ")} ${x.note || ""} ${x.leadName || ""}`));
  const people = data.people.filter((p) => match(`${p.name} ${p.skills.join(" ")} ${p.note || ""}`));
  const shownRequests = myRequests.filter((r) => r.status !== "cancelled").slice(0, 10);

  return (
    <div className="space-y-6">
      {header}
      {closed ? <Notice tone="warn" icon={<Lock size={15} />}>{t("mm.closed")}</Notice> : null}
      {!me.skills.length ? (
        <Notice tone="info">
          {t("mm.no_skills")}{" "}
          <Link href="/hacker/profile" className="font-medium underline underline-offset-2" style={{ color: "var(--accent)" }}>{t("mm.edit_profile")}</Link>
        </Notice>
      ) : null}
      {invitationsSection}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className={card} style={cardStyle}>
          <Toggle label={t("mm.looking")} help={lookDraft.looking ? t("mm.looking_on") : t("mm.looking_hint")} checked={lookDraft.looking}
            disabled={!canChange} onChange={(v) => setLookingDraft({ ...lookDraft, looking: v })} />
          <div className="mt-3">
            <TextInput label={t("mm.note")} value={lookDraft.note} maxLength={280} placeholder={t("mm.note_ph")}
              onChange={(v) => setLookingDraft({ ...lookDraft, note: v })} />
          </div>
          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="primary" disabled={!lookingDraft || busy != null} loading={busy === "looking"}
              onClick={() => void act("looking", () => apiPatch(`/api/events/${eventId}/matchmaking/me`, lookDraft), "mm.saved", () => setLookingDraft(null))}>
              {t("mm.save")}
            </Button>
          </div>
        </section>

        <section className={card} style={cardStyle}>
          <SectionTitle><KeyRound size={15} aria-hidden="true" />{t("mm.code_title")}</SectionTitle>
          <p className="mt-1 text-[12.5px]" style={{ color: "var(--ink-3)" }}>{t("mm.code_hint")}</p>
          <form className="mt-3 flex gap-2" onSubmit={(e) => {
            e.preventDefault();
            const c = code.trim();
            if (!c) return;
            void act("code", () => apiPost("/api/teams/join", { joinCode: c }), "mm.joined", () => router.push("/hacker/team"));
          }}>
            <label className="min-w-0 flex-1">
              <span className="sr-only">{t("mm.code_title")}</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("mm.code_ph")} maxLength={32} autoComplete="off"
                className="h-9 w-full rounded-[var(--radius-sm)] border px-3 font-mono text-[13px] outline-none"
                style={{ borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink)" }} />
            </label>
            <Button type="submit" size="sm" variant="secondary" disabled={!code.trim() || !canChange || busy != null}>{t("mm.code_join")}</Button>
          </form>
          <p className="mt-4 text-[13px]" style={{ color: "var(--ink-2)" }}>
            <Link href="/hacker/team" className="font-medium underline underline-offset-2" style={{ color: "var(--accent)" }}>{t("mm.start_team")}</Link>
          </p>
        </section>
      </div>

      {shownRequests.length ? (
        <section className={card} style={cardStyle} aria-label={t("mm.my_requests")}>
          <SectionTitle count={shownRequests.length}>{t("mm.my_requests")}</SectionTitle>
          <ul className="mt-3 divide-y" style={{ borderColor: "var(--line)" }}>
            {shownRequests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-medium" style={{ color: "var(--ink)" }}>{r.teamName}</span>
                <span className="flex items-center gap-2">
                  <Badge tone={r.status === "accepted" ? "ok" : r.status === "declined" ? "danger" : "warn"} dot>{t(`mm.req.${r.status}`)}</Badge>
                  {r.status === "pending" ? (
                    <Button size="sm" variant="ghost" disabled={busy != null} onClick={() => void act(`wd-${r.id}`, () => apiDelete(`/api/teams/requests/${r.id}`), "mm.withdrawn")}>{t("mm.withdraw")}</Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle count={teams.length}>{t("mm.teams")}</SectionTitle>
          {search}
        </div>
        {teams.length ? (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{teams.map(teamCard)}</ul>
        ) : (
          <p className="text-[13.5px]" style={{ color: "var(--ink-3)" }}>{t("mm.no_teams")}</p>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle count={people.length}>{t("mm.people")}</SectionTitle>
        <p className="-mt-2 text-[13px]" style={{ color: "var(--ink-3)" }}>{t("mm.invite_hint")}</p>
        {people.length ? (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{people.map((p) => personCard(p, "solo"))}</ul>
        ) : (
          <p className="text-[13.5px]" style={{ color: "var(--ink-3)" }}>{t("mm.no_people")}</p>
        )}
      </section>

      {ask ? (
        <Modal
          open
          onClose={() => busy == null && setAsk(null)}
          title={fill(t("mm.ask_title"), { team: ask.name })}
          footer={
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setAsk(null)} disabled={busy != null}>{t("mm.close")}</Button>
              <Button size="sm" variant="primary" icon={<Send size={13} />} loading={busy === "ask"} disabled={busy != null}
                onClick={() => void act("ask", () => apiPost(`/api/teams/${ask.id}/requests`, { message: askMessage.trim() || undefined }), "mm.sent", () => setAsk(null))}>
                {t("mm.send")}
              </Button>
            </div>
          }
        >
          <TextArea label={t("mm.ask_message")} value={askMessage} onChange={setAskMessage} rows={4} maxLength={500} placeholder={t("mm.ask_ph")} />
        </Modal>
      ) : null}
    </div>
  );
}
