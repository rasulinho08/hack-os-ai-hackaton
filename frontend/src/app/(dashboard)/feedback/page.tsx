"use client";

/**
 * What participants said.
 *
 * On top, the recommendation question (NPS): asked once the event ends,
 * answered 0–10, the score is the share of promoters (9–10) minus the share
 * of detractors (0–6). Answers and comments come without names — people are
 * told so, and say more because of it. Below, the written feedback people
 * send from their dashboard, with a rating from 1 to 5.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquareQuote, RefreshCw, Star, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, Skeleton, type Tone } from "@/components/ds/primitives";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LoadFailure } from "@/components/LoadFailure";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { DemoReadOnlyError, apiDelete, apiGet } from "@/lib/api";
import { formatDate } from "@/lib/i18n/dates";
import { fill } from "@/lib/i18n/fill";
import {
  NPS_BANDS, bandOf, normalizeNpsSummary, scorePosition, scoreTone, shares, signed,
  type NpsBand, type NpsSummary,
} from "@/lib/nps";

interface FeedbackEntry {
  id: number;
  name: string;
  rating: number;
  type: string;
  comment: string;
  createdAt: string | null;
}

/** The categories the participant form stores (in Azerbaijani), with their words. */
const CATEGORY_KEYS: Record<string, string> = {
  Ümumi: "hacker.feedback.cat_general",
  Təşkilat: "hacker.feedback.cat_organization",
  Texniki: "hacker.feedback.cat_technical",
  Mentorluq: "hacker.feedback.cat_mentoring",
  Hakimlik: "hacker.feedback.cat_judging",
  Digər: "hacker.feedback.cat_other",
  general: "hacker.feedback.cat_general",
};

const BAND_TONE: Record<NpsBand, Tone> = { promoter: "ok", passive: "warn", detractor: "danger" };
const BAND_FILL: Record<NpsBand, string> = { promoter: "var(--ok)", passive: "var(--warn)", detractor: "var(--danger)" };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

function normalizeFeedback(raw: unknown): FeedbackEntry[] {
  const rows = Array.isArray(raw) ? raw : Array.isArray(obj(raw).data) ? (obj(raw).data as unknown[]) : [];
  const out: FeedbackEntry[] = [];
  for (const r of rows) {
    const o = obj(r);
    const id = Number(o.id);
    if (!Number.isFinite(id) || String(o.type ?? "") === "nps") continue;
    out.push({
      id,
      name: String(o.full_name ?? o.author ?? (o.user_id != null ? `#${o.user_id}` : "")),
      rating: Math.max(0, Math.min(5, Number(o.rating) || 0)),
      type: String(o.type ?? "general"),
      comment: String(o.comment ?? ""),
      createdAt: o.created_at ? String(o.created_at) : null,
    });
  }
  return out;
}

interface Loaded { eventId: number; nps: NpsSummary | null; npsFailed: boolean; feedback: FeedbackEntry[]; feedbackFailed: boolean }

async function fetchFeedback(eventId: number): Promise<Loaded> {
  const [nps, written] = await Promise.allSettled([
    apiGet<unknown>(`/api/events/${eventId}/feedback/nps`),
    apiGet<unknown>(`/api/events/${eventId}/feedback`),
  ]);
  return {
    eventId,
    nps: nps.status === "fulfilled" ? normalizeNpsSummary(nps.value) : null,
    npsFailed: nps.status === "rejected",
    feedback: written.status === "fulfilled" ? normalizeFeedback(written.value) : [],
    feedbackFailed: written.status === "rejected",
  };
}

export default function FeedbackPage() {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const { activeEventId, loading: eventLoading } = useActiveEvent();
  const [data, setData] = useState<Loaded | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FeedbackEntry | null>(null);

  useEffect(() => {
    if (activeEventId == null) return;
    let cancelled = false;
    void fetchFeedback(activeEventId).then((d) => { if (!cancelled) setData(d); });
    return () => { cancelled = true; };
  }, [activeEventId]);

  const reload = useCallback(async () => {
    if (activeEventId == null) return;
    setRefreshing(true);
    try {
      setData(await fetchFeedback(activeEventId));
    } finally {
      setRefreshing(false);
    }
  }, [activeEventId]);

  const current = data && data.eventId === activeEventId ? data : null;
  const loading = eventLoading || (activeEventId != null && !current);
  const feedback = useMemo(() => current?.feedback ?? [], [current]);

  const remove = async (f: FeedbackEntry) => {
    if (activeEventId == null) return;
    try {
      await apiDelete(`/api/events/${activeEventId}/feedback/${f.id}`);
      setData((d) => (d ? { ...d, feedback: d.feedback.filter((x) => x.id !== f.id) } : d));
      toast(t("fb.deleted"), "success");
    } catch (err) {
      if (!(err instanceof DemoReadOnlyError)) toast(t("fb.delete_failed"), "error");
    }
  };

  if (activeEventId == null && !eventLoading) {
    return <p className="py-10 text-center text-[15px]" style={{ color: "var(--ink-3)" }}>{t("fb.no_event")}</p>;
  }

  const avg = feedback.length ? feedback.reduce((s, f) => s + f.rating, 0) / feedback.length : null;
  const positive = feedback.filter((f) => f.rating >= 4).length;
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{t("fb.title")}</h1>
          <p className="mt-1 max-w-2xl text-[15px]" style={{ color: "var(--ink-2)" }}>{t("fb.subtitle")}</p>
        </div>
        <Button size="sm" variant="ghost" icon={<RefreshCw size={14} className={refreshing ? "animate-spin" : undefined} />} onClick={() => void reload()} disabled={refreshing || loading}>
          {t("fb.refresh")}
        </Button>
      </div>

      {loading ? (
        <Card><Skeleton className="h-5 w-56" /><Skeleton className="mt-5 h-24 w-full" /></Card>
      ) : current?.npsFailed ? (
        <LoadFailure message={t("np.load_failed")} onRetry={() => void reload()} retrying={refreshing} />
      ) : current?.nps ? (
        <NpsSection nps={current.nps} when={when} />
      ) : null}

      <section aria-labelledby="fb-written-h" className="space-y-3">
        <h2 id="fb-written-h" className="text-[18px] font-semibold" style={{ color: "var(--ink)" }}>{t("fb.written_title")}</h2>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: t("fb.stat.count"), value: loading ? "—" : String(feedback.length) },
            { label: t("fb.stat.average"), value: avg == null ? "—" : avg.toFixed(1) },
            { label: t("fb.stat.positive"), value: loading ? "—" : String(positive) },
          ].map((s) => (
            <div key={s.label} className="rounded-[var(--radius)] border px-4 py-3.5" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
              <p className="text-[12px] font-medium uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{s.label}</p>
              <p className="mt-1 text-[24px] font-bold tabular-nums" style={{ color: "var(--ink)" }}>{s.value}</p>
            </div>
          ))}
        </div>
        <Card padded={false}>
          {loading ? (
            <div className="space-y-3 p-5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : current?.feedbackFailed && feedback.length === 0 ? (
            <LoadFailure compact message={t("fb.load_failed")} onRetry={() => void reload()} retrying={refreshing} />
          ) : feedback.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-[14px] font-medium" style={{ color: "var(--ink)" }}>{t("fb.empty")}</p>
              <p className="mt-1 text-[13px]" style={{ color: "var(--ink-3)" }}>{t("fb.empty_hint")}</p>
            </div>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
              {feedback.map((f) => (
                <li key={f.id} className="group px-5 py-4" style={{ borderColor: "var(--line)" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate text-[14px] font-medium" style={{ color: "var(--ink)" }}>{f.name || t("fb.someone")}</span>
                      <Badge>{CATEGORY_KEYS[f.type] ? t(CATEGORY_KEYS[f.type]) : f.type}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-0.5" role="img" aria-label={fill(t("fb.stars"), { n: f.rating })}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Star key={n} size={13} aria-hidden="true" style={n <= f.rating ? { color: "var(--warn)", fill: "var(--warn)" } : { color: "var(--line-strong)" }} />
                        ))}
                      </span>
                      <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} aria-label={t("fb.delete")} title={t("fb.delete")}
                        style={{ color: "var(--danger)" }} onClick={() => setConfirmDelete(f)} />
                    </div>
                  </div>
                  {f.comment ? <p className="mt-1.5 whitespace-pre-line text-[13.5px]" style={{ color: "var(--ink-2)" }}>{f.comment}</p> : null}
                  <p className="mt-1 text-[12px]" style={{ color: "var(--ink-3)" }}>{when(f.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title={t("fb.delete_t")}
        message={confirmDelete ? fill(t("fb.delete_b"), { text: confirmDelete.comment.slice(0, 80) || "—" }) : ""}
        confirmLabel={t("fb.delete")}
        cancelLabel={t("fb.keep")}
        variant="danger"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => { const f = confirmDelete; setConfirmDelete(null); if (f) void remove(f); }}
      />
    </div>
  );
}

/* ── The recommendation question ─────────────────────────────────────────── */

function NpsSection({ nps, when }: { nps: NpsSummary; when: (iso: string | null) => string }) {
  const { t } = useTranslation();
  const [allComments, setAllComments] = useState(false);
  const counts = [nps.promoters, nps.passives, nps.detractors];
  const pct = shares(counts);
  const max = Math.max(1, ...nps.distribution);
  const tone = scoreTone(nps.score);
  const comments = allComments ? nps.comments : nps.comments.slice(0, 6);

  return (
    <Card>
      <CardHeader title={t("np.org_title")} hint={t("np.org_hint")} />
      {nps.responses === 0 ? (
        <div className="flex items-start gap-3 rounded-[var(--radius-sm)] border px-4 py-4" style={{ borderColor: "var(--line)", background: "var(--surface-sunken)" }}>
          <MessageSquareQuote size={18} className="mt-0.5 shrink-0" aria-hidden="true" style={{ color: "var(--ink-3)" }} />
          <div className="text-[13.5px]" style={{ color: "var(--ink-2)" }}>
            <p className="font-medium" style={{ color: "var(--ink)" }}>{t("np.none_yet")}</p>
            <p className="mt-0.5">{nps.eligible ? fill(t("np.none_yet_hint"), { n: nps.eligible }) : t("np.none_eligible")}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
            <div>
              <p className="text-[12px] font-medium uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{t("np.score")}</p>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="text-[44px] font-bold leading-none tabular-nums" style={{ color: "var(--ink)" }}>{nps.score == null ? "—" : signed(nps.score)}</span>
                {nps.score != null ? <Badge tone={tone}>{t(`np.tone.${tone}`)}</Badge> : null}
              </p>
              <p className="mt-2 text-[13px]" style={{ color: "var(--ink-2)" }}>
                {fill(t(nps.responseRate != null ? "np.responses_rate" : "np.responses"), { n: nps.responses, of: nps.eligible, rate: nps.responseRate ?? 0 })}
              </p>
              {nps.average != null ? <p className="mt-0.5 text-[13px]" style={{ color: "var(--ink-3)" }}>{fill(t("np.average"), { avg: nps.average.toFixed(1) })}</p> : null}
            </div>
            <div className="min-w-0 space-y-5">
              {nps.score != null ? (
                <div>
                  <div className="relative h-2 rounded-full" style={{ background: "linear-gradient(90deg, var(--danger) 0%, var(--warn) 50%, var(--ok) 100%)", opacity: 0.85 }} aria-hidden="true">
                    <span className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2" style={{ left: `${scorePosition(nps.score)}%`, background: "var(--surface)", borderColor: "var(--ink)" }} />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[11.5px] tabular-nums" style={{ color: "var(--ink-3)" }} aria-hidden="true">
                    <span>−100</span><span>0</span><span>+100</span>
                  </div>
                </div>
              ) : null}
              <div>
                <div className="flex h-3 overflow-hidden rounded-full" style={{ background: "var(--tint)" }} role="img"
                  aria-label={fill(t("np.split_label"), { p: pct[0], s: pct[1], d: pct[2] })}>
                  {NPS_BANDS.map((b, i) => (pct[i] ? <span key={b} style={{ width: `${pct[i]}%`, background: BAND_FILL[b] }} /> : null))}
                </div>
                <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px]">
                  {NPS_BANDS.map((b, i) => (
                    <li key={b} className="inline-flex items-center gap-1.5" style={{ color: "var(--ink-2)" }}>
                      <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: BAND_FILL[b] }} />
                      {fill(t(`np.band.${b}`), { n: counts[i], pct: pct[i] })}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div>
            <p className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{t("np.distribution")}</p>
            <ol className="grid grid-cols-11 items-end gap-1 sm:gap-1.5" style={{ height: 120 }}>
              {nps.distribution.map((n, i) => (
                <li key={i} className="flex h-full flex-col items-center justify-end gap-1" aria-label={fill(t("np.bar_label"), { score: i, n })}>
                  <span className="text-[11px] tabular-nums" style={{ color: "var(--ink-3)" }} aria-hidden="true">{n || ""}</span>
                  <span className="w-full rounded-t-[4px]" aria-hidden="true"
                    style={{ height: `${Math.max(n ? 6 : 2, (n / max) * 80)}px`, background: n ? BAND_FILL[bandOf(i)] : "var(--tint)" }} />
                  <span className="text-[11.5px] font-medium tabular-nums" style={{ color: "var(--ink-2)" }} aria-hidden="true">{i}</span>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <p className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{fill(t("np.comments"), { n: nps.comments.length })}</p>
            {nps.comments.length === 0 ? (
              <p className="text-[13px]" style={{ color: "var(--ink-3)" }}>{t("np.no_comments")}</p>
            ) : (
              <>
                <ul className="space-y-2">
                  {comments.map((c, i) => (
                    <li key={`${c.at}-${i}`} className="rounded-[var(--radius-sm)] border px-3.5 py-3" style={{ borderColor: "var(--line)", background: "var(--surface-sunken)" }}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={BAND_TONE[bandOf(c.score)]}>{fill(t("np.answered"), { score: c.score })}</Badge>
                        <span className="text-[12px]" style={{ color: "var(--ink-3)" }}>{when(c.at)}</span>
                      </div>
                      <p className="mt-1.5 whitespace-pre-line text-[13.5px]" style={{ color: "var(--ink-2)" }}>{c.comment}</p>
                    </li>
                  ))}
                </ul>
                {nps.comments.length > comments.length || allComments ? (
                  <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAllComments((v) => !v)} aria-expanded={allComments}>
                    {allComments ? t("np.fewer_comments") : fill(t("np.all_comments"), { n: nps.comments.length })}
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
