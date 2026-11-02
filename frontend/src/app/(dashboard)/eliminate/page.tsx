"use client";

/**
 * Elimination in named rounds ("Round 1 — the best 12 go on").
 *
 * The organiser makes a round, lets the live ranking suggest the cut (keep
 * the best N; teams tied at the cut all stay; teams without scores or
 * without a project go), adjusts it, gives a reason and eliminates. The
 * members of an eliminated team then see only the elimination page with the
 * reason — no announcement goes out (decision E9) — and their team is no
 * longer judged or ranked. Any team can be brought back.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Pencil, Plus, RefreshCw, RotateCcw, Scissors, Trash2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from "@/components/ds/primitives";
import { Drawer, Modal } from "@/components/ds/overlays";
import { Notice, NumberStepper, TextArea, TextInput } from "@/components/builder/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { ApiError, DemoReadOnlyError, apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { fill } from "@/lib/i18n/fill";
import { formatDate } from "@/lib/i18n/dates";
import {
  buildCandidates, eliminationErrorKey, keptBy, normalizeOutcome, normalizeRounds, suggestCut,
  type Candidate, type EliminatedTeam, type Round, type RoundsPayload,
} from "@/lib/elimination";
import { formatScore } from "@/lib/results";

type Load = "loading" | "ready" | "failed" | "locked";
type Confirm = { kind: "delete"; round: Round } | null;

const ink = (n: "" | "-2" | "-3" = "") => ({ color: `var(--ink${n})` });

export default function EliminatePage() {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const { activeEventId, loading: eventLoading } = useActiveEvent();
  const [state, setState] = useState<Load>("loading");
  const [rounds, setRounds] = useState<RoundsPayload>({ rounds: [], outsideRounds: [] });
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [editing, setEditing] = useState<Round | "new" | null>(null);
  const [cutting, setCutting] = useState<Round | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);

  const words = useCallback((err: unknown, fallback: string) => {
    if (err instanceof ApiError) {
      const key = eliminationErrorKey(err.code);
      if (key) return t(key);
      if (err.summary) return err.summary;
    }
    return t(fallback);
  }, [t]);

  const load = useCallback(async (opts: { quiet?: boolean } = {}) => {
    if (activeEventId == null) return;
    try {
      const [r, s, teams] = await Promise.all([
        apiGet<unknown>(`/api/events/${activeEventId}/elimination/rounds`),
        apiGet<unknown>(`/api/events/${activeEventId}/elimination/suggest?keep=0`),
        apiGet<unknown[]>(`/api/teams?eventId=${activeEventId}`),
      ]);
      setRounds(normalizeRounds(r));
      setCandidates(buildCandidates(s, teams));
      setState("ready");
    } catch (err) {
      if (err instanceof ApiError && err.code === "MODULE_DISABLED") setState("locked");
      else if (opts.quiet) toast(t("el.refresh_failed"), "error");
      else setState("failed");
    }
  }, [activeEventId, t, toast]);

  useEffect(() => {
    if (eventLoading || activeEventId == null) return;
    void load();
  }, [activeEventId, eventLoading, load]);

  const saveRound = async (name: string, note: string) => {
    if (activeEventId == null || editing == null) return;
    setBusy(true);
    try {
      if (editing === "new") {
        await apiPost(`/api/events/${activeEventId}/elimination/rounds`, { name, note: note || null });
        toast(t("el.round_created"), "success");
      } else {
        await apiPatch(`/api/events/${activeEventId}/elimination/rounds/${editing.id}`, { name, note: note || null });
        toast(t("el.round_saved"), "success");
      }
      setEditing(null);
      await load({ quiet: true });
    } catch (err) {
      if (!(err instanceof DemoReadOnlyError)) toast(words(err, "el.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const deleteRound = async (round: Round) => {
    if (activeEventId == null) return;
    try {
      await apiDelete(`/api/events/${activeEventId}/elimination/rounds/${round.id}`);
      toast(t("el.round_deleted"), "success");
      await load({ quiet: true });
    } catch (err) {
      if (!(err instanceof DemoReadOnlyError)) toast(words(err, "el.failed"), "error");
    }
  };

  const eliminate = async (round: Round, teamIds: number[], reason: string) => {
    if (activeEventId == null) return;
    setBusy(true);
    try {
      const out = normalizeOutcome(await apiPost<unknown>(`/api/events/${activeEventId}/elimination/rounds/${round.id}/eliminate`, { teamIds, reason }));
      toast(fill(t("el.done"), { n: out.eliminated.length }), "success");
      if (out.skipped.length) {
        const names = new Map(candidates.map((c) => [c.teamId, c.teamName]));
        toast(fill(t("el.skipped"), { list: out.skipped.map((s) => `${names.get(s.teamId) ?? `#${s.teamId}`} (${t(`el.skip.${s.reason}`)})`).join(", ") }), "info");
      }
      setCutting(null);
      await load({ quiet: true });
    } catch (err) {
      if (!(err instanceof DemoReadOnlyError)) toast(words(err, "el.failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const restore = async (team: EliminatedTeam) => {
    if (activeEventId == null) return;
    setRestoring(team.teamId);
    try {
      await apiPost(`/api/events/${activeEventId}/elimination/teams/${team.teamId}/restore`, {});
      toast(fill(t("el.restored"), { team: team.teamName }), "success");
      await load({ quiet: true });
    } catch (err) {
      if (!(err instanceof DemoReadOnlyError)) toast(words(err, "el.failed"), "error");
    } finally {
      setRestoring(null);
    }
  };

  const eliminatedCount = rounds.rounds.reduce((n, r) => n + r.teams.length, 0) + rounds.outsideRounds.length;

  if (activeEventId == null && !eventLoading) {
    return <p className="py-10 text-center text-[15px]" style={ink("-3")}>{t("rs.no_event")}</p>;
  }

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={ink()}>{t("el.title")}</h1>
        <p className="mt-1 max-w-2xl text-[15px]" style={ink("-2")}>{t("el.subtitle")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void load({ quiet: true })} disabled={state !== "ready"}>{t("el.refresh")}</Button>
        <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setEditing("new")} disabled={state !== "ready"}>{t("el.new_round")}</Button>
      </div>
    </div>
  );

  if (state === "loading" || eventLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        {header}
        <Skeleton className="h-16 rounded-[var(--radius)]" />
        <Skeleton className="h-48 rounded-[var(--radius)]" />
      </div>
    );
  }
  if (state === "locked") {
    return <div className="space-y-6">{header}<Notice tone="info">{t("el.err.MODULE_DISABLED")}</Notice></div>;
  }
  if (state === "failed") {
    return <div className="space-y-6">{header}<ErrorState title={t("common.load_failed_title")} body={t("el.load_failed")} onRetry={() => { setState("loading"); void load(); }} /></div>;
  }

  return (
    <div className="space-y-6">
      {header}

      <Notice tone="info" icon={<Ban size={15} />}>{t("el.e9")}</Notice>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: t("el.stat.in"), value: candidates.length },
          { label: t("el.stat.out"), value: eliminatedCount },
          { label: t("el.stat.rounds"), value: rounds.rounds.length },
        ].map((s) => (
          <div key={s.label} className="rounded-[var(--radius)] border px-4 py-3.5" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
            <p className="text-[12px] font-medium uppercase tracking-[0.06em]" style={ink("-3")}>{s.label}</p>
            <p className="mt-1 text-[24px] font-bold tabular-nums" style={ink()}>{s.value}</p>
          </div>
        ))}
      </div>

      {rounds.rounds.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Scissors size={19} />}
            title={t("el.empty")}
            body={t("el.empty_hint")}
            action={<Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setEditing("new")}>{t("el.new_round")}</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {rounds.rounds.map((round, i) => (
            <Card key={round.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em]" style={ink("-3")}>{fill(t("el.round_n"), { n: i + 1 })}</p>
                  <h2 className="mt-0.5 text-[16px] font-semibold" style={ink()}>{round.name}</h2>
                  {round.note ? <p className="mt-1 max-w-2xl whitespace-pre-line text-[13px]" style={ink("-2")}>{round.note}</p> : null}
                  {round.createdAt ? <p className="mt-1 text-[12px]" style={ink("-3")}>{fill(t("el.created"), { when: formatDate(round.createdAt, lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) })}</p> : null}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="primary" icon={<Scissors size={14} />} onClick={() => setCutting(round)} disabled={candidates.length === 0}>{t("el.cut")}</Button>
                  <Button size="sm" variant="ghost" icon={<Pencil size={14} />} aria-label={fill(t("el.rename_n"), { name: round.name })} title={t("el.rename")} onClick={() => setEditing(round)} />
                  <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={fill(t("el.delete_n"), { name: round.name })} title={t("el.delete")} style={{ color: "var(--danger)" }} onClick={() => setConfirm({ kind: "delete", round })} />
                </div>
              </div>
              <div className="mt-4">
                {round.teams.length === 0 ? (
                  <p className="text-[13px]" style={ink("-3")}>{t("el.round_empty")}</p>
                ) : (
                  <EliminatedList teams={round.teams} restoring={restoring} onRestore={(x) => void restore(x)} />
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {rounds.outsideRounds.length ? (
        <Card>
          <h2 className="text-[15px] font-semibold" style={ink()}>{t("el.outside")}</h2>
          <p className="mt-0.5 text-[12.5px]" style={ink("-3")}>{t("el.outside_hint")}</p>
          <div className="mt-3">
            <EliminatedList teams={rounds.outsideRounds} restoring={restoring} onRestore={(x) => void restore(x)} />
          </div>
        </Card>
      ) : null}

      {editing ? (
        <RoundModal
          key={editing === "new" ? "new" : editing.id}
          round={editing === "new" ? null : editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(name, note) => void saveRound(name, note)}
        />
      ) : null}

      {cutting ? (
        <CutDrawer
          key={cutting.id}
          round={cutting}
          candidates={candidates}
          busy={busy}
          onClose={() => setCutting(null)}
          onEliminate={(ids, reason) => void eliminate(cutting, ids, reason)}
        />
      ) : null}

      <ConfirmDialog
        open={confirm?.kind === "delete"}
        title={confirm ? fill(t("el.delete_t"), { name: confirm.round.name }) : ""}
        message={t("el.delete_b")}
        confirmLabel={t("el.delete")}
        cancelLabel={t("rs.cancel")}
        variant="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => { const c = confirm; setConfirm(null); if (c) void deleteRound(c.round); }}
      />
    </div>
  );
}

function EliminatedList({ teams, restoring, onRestore }: { teams: EliminatedTeam[]; restoring: number | null; onRestore: (team: EliminatedTeam) => void }) {
  const { t, lang } = useTranslation();
  return (
    <ul className="divide-y rounded-[12px] border" style={{ borderColor: "var(--line)" }}>
      {teams.map((x) => (
        <li key={x.teamId} className="flex flex-wrap items-start justify-between gap-3 px-3.5 py-3" style={{ borderColor: "var(--line)" }}>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 font-medium" style={ink()}>
              {x.teamName}
              <Badge tone="danger">{t("el.badge")}</Badge>
            </p>
            <p className="mt-0.5 text-[12.5px]" style={ink("-3")}>
              {[fill(t("el.members"), { n: x.members }), x.eliminatedAt ? formatDate(x.eliminatedAt, lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : null].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-1 text-[13px]" style={ink("-2")}>{x.reason ? `“${x.reason}”` : <span style={ink("-3")}>{t("el.no_reason")}</span>}</p>
          </div>
          <Button size="sm" variant="secondary" icon={<RotateCcw size={13} />} loading={restoring === x.teamId} disabled={restoring != null} onClick={() => onRestore(x)}>
            {t("el.restore")}
          </Button>
        </li>
      ))}
    </ul>
  );
}

function RoundModal({ round, busy, onClose, onSave }: { round: Round | null; busy: boolean; onClose: () => void; onSave: (name: string, note: string) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(round?.name ?? "");
  const [note, setNote] = useState(round?.note ?? "");
  const [tried, setTried] = useState(false);
  const missing = !name.trim();
  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title={t(round ? "el.rename" : "el.new_round")}
      description={t("el.round_hint")}
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>{t("rs.cancel")}</Button>
          <Button size="sm" variant="primary" loading={busy} disabled={busy} onClick={() => { setTried(true); if (!missing) onSave(name.trim(), note.trim()); }}>
            {t(round ? "el.save" : "el.create")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <TextInput label={t("el.f_name")} value={name} onChange={setName} required maxLength={120} placeholder={t("el.f_name_ph")} error={tried && missing ? t("el.f_name_req") : null} />
        <TextArea label={t("el.f_note")} value={note} onChange={setNote} rows={3} maxLength={2000} optional={t("Optional")} placeholder={t("el.f_note_ph")} />
      </div>
    </Modal>
  );
}

function CutDrawer({ round, candidates, busy, onClose, onEliminate }: {
  round: Round;
  candidates: Candidate[];
  busy: boolean;
  onClose: () => void;
  onEliminate: (teamIds: number[], reason: string) => void;
}) {
  const { t } = useTranslation();
  const ranked = candidates.filter((c) => c.state === "ranked").length;
  const [keep, setKeep] = useState<number | null>(ranked > 1 ? Math.ceil(ranked / 2) : ranked);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [reason, setReason] = useState("");
  const [asking, setAsking] = useState(false);
  const kept = useMemo(() => (keep == null ? null : keptBy(candidates, keep)), [candidates, keep]);

  const flip = (id: number) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const applyCut = () => { if (keep != null) setPicked(new Set(suggestCut(candidates, keep))); };
  const ids = candidates.filter((c) => picked.has(c.teamId)).map((c) => c.teamId);

  return (
    <Drawer
      open
      onClose={() => !busy && onClose()}
      title={fill(t("el.cut_title"), { name: round.name })}
      description={t("el.cut_hint")}
      width={560}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-[12.5px]" style={ink("-3")} aria-live="polite">{fill(t("el.selected"), { n: ids.length, total: candidates.length })}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>{t("rs.cancel")}</Button>
            <Button size="sm" variant="danger" icon={<Ban size={14} />} loading={busy} disabled={busy || ids.length === 0} onClick={() => setAsking(true)}>
              {fill(t("el.eliminate_n"), { n: ids.length })}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <section className="rounded-[12px] border p-3.5" style={{ borderColor: "var(--line)", background: "var(--surface-sunken)" }}>
          <NumberStepper label={t("el.keep")} value={keep} onChange={setKeep} min={0} max={Math.max(0, ranked)} help={t("el.keep_hint")} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button size="sm" variant="secondary" icon={<Scissors size={14} />} onClick={applyCut} disabled={keep == null}>{t("el.suggest")}</Button>
            {kept != null && keep != null && kept !== keep ? <span className="text-[12.5px]" style={ink("-2")}>{fill(t("el.ties_stay"), { n: kept })}</span> : null}
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em]" style={ink("-3")}>{t("el.teams")}</h3>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(candidates.map((c) => c.teamId)))}>{t("el.all")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>{t("el.none")}</Button>
          </div>
        </div>

        {candidates.length === 0 ? <p className="text-[13px]" style={ink("-3")}>{t("el.no_candidates")}</p> : (
          <ul className="divide-y rounded-[12px] border" style={{ borderColor: "var(--line)" }}>
            {candidates.map((c) => {
              const id = `el-c-${c.teamId}`;
              return (
                <li key={c.teamId} style={{ borderColor: "var(--line)" }}>
                  <label htmlFor={id} className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5">
                    <input
                      id={id}
                      type="checkbox"
                      checked={picked.has(c.teamId)}
                      onChange={() => flip(c.teamId)}
                      className="h-4 w-4 shrink-0"
                      style={{ accentColor: "var(--danger)" }}
                    />
                    <span className="w-8 shrink-0 text-right text-[13px] font-semibold tabular-nums" style={ink(c.place == null ? "-3" : "")}>{c.place ?? "—"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium" style={ink()}>{c.teamName}</span>
                      <span className="block text-[12px]" style={ink("-3")}>{fill(t("el.members"), { n: c.members })}</span>
                    </span>
                    {c.state === "ranked" ? (
                      <span className="text-[13px] font-semibold tabular-nums" style={ink("-2")}>{formatScore(c.score)}</span>
                    ) : (
                      <Badge tone={c.state === "unscored" ? "warn" : "neutral"}>{t(`el.state.${c.state}`)}</Badge>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        <TextArea label={t("el.reason")} value={reason} onChange={setReason} rows={3} maxLength={500} optional={t("Optional")} help={t("el.reason_hint")} placeholder={t("el.reason_ph")} />
      </div>

      <ConfirmDialog
        open={asking}
        title={fill(t("el.confirm_t"), { n: ids.length })}
        message={t("el.confirm_b")}
        confirmLabel={fill(t("el.eliminate_n"), { n: ids.length })}
        cancelLabel={t("rs.cancel")}
        variant="danger"
        onCancel={() => setAsking(false)}
        onConfirm={() => { setAsking(false); onEliminate(ids, reason.trim()); }}
      />
    </Drawer>
  );
}
