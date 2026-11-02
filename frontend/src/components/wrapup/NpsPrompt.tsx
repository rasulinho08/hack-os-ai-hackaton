"use client";

/**
 * "How likely are you to recommend this event to a friend?" — asked of
 * admitted participants once the event has ended, one answer each that they
 * may change until the event is archived. The organiser sees the spread and
 * the comments, never who said what.
 *
 * Renders nothing for people who are not asked (staff, pending or rejected
 * registrations) and before the event ends.
 */

import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import { Button, cx } from "@/components/ds/primitives";
import { TextArea } from "@/components/builder/ui";
import { useTranslation } from "@/contexts/LanguageContext";
import { DemoReadOnlyError, apiGet, apiPost } from "@/lib/api";
import { fill } from "@/lib/i18n/fill";
import { NPS_COMMENT_MAX, bandOf, normalizeNpsState, npsErrorKey, type NpsBand, type NpsState } from "@/lib/nps";

const BAND_COLOUR: Record<NpsBand, string> = { promoter: "var(--ok)", passive: "var(--warn)", detractor: "var(--danger)" };

export function NpsPrompt({ eventId, className }: { eventId: number; className?: string }) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<{ eventId: number; state: NpsState } | null>(null);
  const [editing, setEditing] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qid = useId();

  useEffect(() => {
    let cancelled = false;
    apiGet<unknown>(`/api/events/${eventId}/feedback/nps/mine`).then(
      (raw) => { if (!cancelled) setLoaded({ eventId, state: normalizeNpsState(raw) }); },
      // An optional question: when it cannot be loaded it is simply not asked.
      () => { if (!cancelled) setLoaded(null); },
    );
    return () => { cancelled = true; };
  }, [eventId]);

  const state = loaded && loaded.eventId === eventId ? loaded.state : null;
  if (!state || !state.eligible) return null;
  if (!state.open && !state.answer) return null;

  const answer = state.answer;
  const showForm = state.open && (!answer || editing);

  const startEditing = () => {
    setScore(answer?.score ?? null);
    setComment(answer?.comment ?? "");
    setError(null);
    setEditing(true);
  };

  const submit = async () => {
    if (score == null) {
      setError(t("np.pick_score"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await apiPost<{ score?: number; comment?: string | null; at?: string | null }>(`/api/events/${eventId}/feedback/nps`, {
        score,
        comment: comment.trim() || undefined,
      });
      setLoaded({
        eventId,
        state: { ...state, answer: { score: Number(out?.score ?? score), comment: out?.comment ?? (comment.trim() || null), at: out?.at ?? null } },
      });
      setEditing(false);
    } catch (err) {
      if (!(err instanceof DemoReadOnlyError)) setError(t(npsErrorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const frame = cx("rounded-[var(--radius)] border p-5", className);
  const frameStyle = { borderColor: "var(--line)", background: "var(--surface)" };

  if (!showForm && answer) {
    return (
      <section className={frame} style={frameStyle} aria-live="polite">
        <div className="flex items-start gap-3">
          <CheckCircle2 size={20} className="mt-0.5 shrink-0" aria-hidden="true" style={{ color: "var(--ok)" }} />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>{t("np.thanks")}</p>
            <p className="mt-0.5 text-[13.5px]" style={{ color: "var(--ink-2)" }}>{fill(t("np.your_answer"), { score: answer.score })}</p>
            {answer.comment ? <p className="mt-2 whitespace-pre-line text-[13.5px]" style={{ color: "var(--ink-2)" }}>“{answer.comment}”</p> : null}
          </div>
          {state.open ? <Button size="sm" variant="ghost" onClick={startEditing}>{t("np.change")}</Button> : null}
        </div>
      </section>
    );
  }

  const band = score == null ? null : bandOf(score);
  return (
    <section className={frame} style={frameStyle} aria-labelledby={`${qid}-q`}>
      <h2 id={`${qid}-q`} className="text-[16px] font-semibold" style={{ color: "var(--ink)" }}>{t("np.question")}</h2>
      <p className="mt-1 text-[13px]" style={{ color: "var(--ink-3)" }}>{t("np.question_hint")}</p>
      <div className="mt-4">
        <ScoreScale value={score} onChange={(v) => { setScore(v); setError(null); }} labelledBy={`${qid}-q`} />
        <div className="mt-1.5 flex justify-between gap-3 text-[12px]" style={{ color: "var(--ink-3)" }} aria-hidden="true">
          <span>{t("np.low")}</span>
          <span>{t("np.high")}</span>
        </div>
      </div>
      {band ? (
        <div className="mt-4">
          <TextArea label={t(`np.comment.${band}`)} value={comment} onChange={setComment} rows={3} maxLength={NPS_COMMENT_MAX} optional={t("Optional")} />
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-3 text-[13px]" style={{ color: "var(--danger)" }}>{error}</p> : null}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {editing ? <Button size="sm" onClick={() => setEditing(false)} disabled={busy}>{t("Cancel")}</Button> : null}
        <Button size="sm" variant="primary" icon={<Send size={13} />} loading={busy} disabled={busy} onClick={() => void submit()}>{t("np.send")}</Button>
      </div>
    </section>
  );
}

/** Eleven choices, 0 to 10, one radio group: arrow keys move, Home/End jump. */
function ScoreScale({ value, onChange, labelledBy }: { value: number | null; onChange: (v: number) => void; labelledBy: string }) {
  const { t } = useTranslation();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (e: React.KeyboardEvent, i: number) => {
    let n: number;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") n = Math.min(10, i + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") n = Math.max(0, i - 1);
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = 10;
    else return;
    e.preventDefault();
    onChange(n);
    refs.current[n]?.focus();
  };
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid grid-cols-6 gap-1.5 sm:grid-cols-11">
      {Array.from({ length: 11 }, (_, i) => {
        const on = value === i;
        const colour = BAND_COLOUR[bandOf(i)];
        return (
          <button
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={fill(t("np.score_label"), { n: i })}
            tabIndex={on || (value == null && i === 0) ? 0 : -1}
            onClick={() => onChange(i)}
            onKeyDown={(e) => move(e, i)}
            className="min-h-10 rounded-[var(--radius-sm)] border text-[14px] font-semibold tabular-nums transition-[background,border-color,color] duration-150"
            // A tint of the band's colour under the ink, not white on the colour:
            // the dark theme's green and amber are too light for white text.
            style={{
              borderColor: on ? colour : "var(--line-strong)",
              background: on ? `color-mix(in srgb, ${colour} 22%, var(--surface))` : "var(--surface)",
              boxShadow: on ? `inset 0 0 0 1px ${colour}` : "none",
              color: "var(--ink)",
            }}
          >
            {i}
          </button>
        );
      })}
    </div>
  );
}
