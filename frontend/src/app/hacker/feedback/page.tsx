"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Star,
  Send,
  Loader2,
  RefreshCw,
  CheckCircle2,
  MessageSquare,
} from "lucide-react";
import { BrandLoader } from "@/components/BrandLoader";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { apiGet, apiPost } from "@/lib/api";
import { resolveActiveEventId } from "@/lib/resolveEventId";
import { participantEventId } from "@/lib/participantEvent";
import { normalizeTeamMine } from "@/lib/teamNormalize";
import { formatDate } from "@/lib/i18n/dates";
import { NpsPrompt } from "@/components/wrapup/NpsPrompt";

interface FeedbackEntry {
  id: number;
  rating: number;
  type: string;
  comment: string;
  created_at?: string;
}

const CATEGORIES = [
  { value: "Ümumi", key: "hacker.feedback.cat_general" },
  { value: "Təşkilat", key: "hacker.feedback.cat_organization" },
  { value: "Texniki", key: "hacker.feedback.cat_technical" },
  { value: "Mentorluq", key: "hacker.feedback.cat_mentoring" },
  { value: "Hakimlik", key: "hacker.feedback.cat_judging" },
  { value: "Digər", key: "hacker.feedback.cat_other" },
] as const;

function fmtDate(raw: string | undefined, lang: string) {
  if (!raw) return "";
  return formatDate(raw, lang, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) || raw;
}

function unwrapFeedbackRows(raw: unknown): FeedbackEntry[] {
  if (Array.isArray(raw)) return raw as FeedbackEntry[];
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const inner =
      o.feedbacks ??
      o.data ??
      o.items ??
      o.rows ??
      (Array.isArray(o.results) ? o.results : null);
    if (Array.isArray(inner)) return inner as FeedbackEntry[];
  }
  return [];
}

export default function HackerFeedbackPage() {
  const { t, lang } = useTranslation();
  const { toast } = useToast();

  const [eventId, setEventId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [rating, setRating] = useState(0);
  const [category, setCategory] = useState("Ümumi");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const [myFeedbacks, setMyFeedbacks] = useState<FeedbackEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Same idea as My Team: bind feedback to the hackathon the hacker is
        // working in (the one they entered) — not resolveActiveEventId alone,
        // which can pick a different "newest" row than the user's team
        // (feedback saved to event A while the dashboard lists event B).
        const hint = await participantEventId();
        const mineUrl =
          hint != null ? `/api/teams/mine?eventId=${hint}` : "/api/teams/mine";
        let resolved: number | null = null;
        try {
          const mineRaw = await apiGet<unknown>(mineUrl);
          const team = normalizeTeamMine(mineRaw);
          const tid = team?.event_id;
          if (tid != null && Number(tid) > 0) resolved = Number(tid);
        } catch {
          /* solo or no team row */
        }
        if (resolved == null && hint != null && hint > 0) resolved = hint;
        if (resolved == null) {
          const fb = await resolveActiveEventId({ ignoreStored: true });
          if (Number.isFinite(fb) && fb > 0) resolved = fb;
        }
        if (!cancelled) setEventId(resolved);
      } catch {
        if (!cancelled) setEventId(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMyFeedbacks = useCallback(
    async (silent = false) => {
      if (eventId == null) return;
      if (silent) setRefreshing(true);
      try {
        const raw = await apiGet<unknown>(
          `/api/events/${eventId}/feedback/mine`,
        );
        setMyFeedbacks(unwrapFeedbackRows(raw));
      } catch {
        /* user may not have read access — ignore */
      } finally {
        setRefreshing(false);
      }
    },
    [eventId],
  );

  useEffect(() => {
    if (eventId != null) void loadMyFeedbacks();
  }, [eventId, loadMyFeedbacks]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) {
      toast(t("hacker.feedback.toast_msg"), "error");
      return;
    }
    if (rating === 0) {
      toast(t("hacker.feedback.toast_rating"), "error");
      return;
    }
    if (eventId == null) return;
    setSubmitting(true);
    try {
      await apiPost(`/api/events/${eventId}/feedback`, {
        rating,
        comment: message.trim(),
        type: category,
      });
      setMessage("");
      setRating(0);
      setCategory("Ümumi");
      setSent(true);
      toast(t("hacker.feedback.toast_sent"), "success");
      void loadMyFeedbacks(true);
      setTimeout(() => setSent(false), 4000);
    } catch {
      toast(t("hacker.feedback.toast_failed"), "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <BrandLoader message={t("Loading")} fullMinHeight />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-[28px] font-bold tracking-[-0.02em] text-[var(--app-heading)]">
          {t("hacker.feedback.title")}
        </h1>
        <p className="mt-1 text-[15px] text-[var(--app-muted)]">
          {t("hacker.feedback.subtitle")}
        </p>
      </div>

      {/* The recommendation question, once the event is over (renders nothing before). */}
      {eventId != null ? <NpsPrompt eventId={eventId} /> : null}

      {/* Form */}
      <section className="card-shadow rounded-xl border border-white/5 bg-[var(--app-surface)] p-5">
        {sent ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <CheckCircle2 size={40} className="text-emerald-400" />
            <p className="text-[15px] font-medium text-white">
              {t("hacker.feedback.sent")}
            </p>
            <p className="text-[13px] text-[var(--app-muted)]">
              {t("hacker.feedback.thanks")}
            </p>
            <button
              onClick={() => setSent(false)}
              className="mt-2 rounded-lg border border-white/10 px-4 py-1.5 text-[13px] text-[var(--app-muted)] transition-colors hover:text-white"
            >
              {t("hacker.feedback.send_another")}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {/* Rating */}
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-[var(--app-muted)]">
                {t("hacker.feedback.rating")}
              </label>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    className="transition-transform hover:scale-110"
                  >
                    <Star
                      size={28}
                      className={
                        n <= rating
                          ? "fill-[#FFC107] text-[var(--app-warn)]"
                          : "text-white/20 hover:text-white/40"
                      }
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Category */}
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-[var(--app-muted)]">
                {t("hacker.feedback.category")}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCategory(c.value)}
                    className={`rounded-full px-3 py-1 text-[12px] font-medium transition-all ${
                      category === c.value
                        ? "bg-[#E1003C] text-white"
                        : "bg-white/[0.05] text-[var(--app-muted)] hover:bg-white/[0.1]"
                    }`}
                  >
                    {t(c.key)}
                  </button>
                ))}
              </div>
            </div>

            {/* Message */}
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-[var(--app-muted)]">
                {t("hacker.feedback.message")}
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                placeholder={t("hacker.feedback.message_ph")}
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-[15px] text-white outline-none placeholder:text-[var(--app-muted-2)] focus:border-[#E1003C]/50"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#E1003C] text-[15px] font-semibold text-white transition-colors hover:bg-[#C00035] disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              {t("hacker.feedback.send")}
            </button>
          </form>
        )}
      </section>

      {/* Previous feedbacks */}
      {myFeedbacks.length > 0 && (
        <section className="card-shadow rounded-xl border border-white/5 bg-[var(--app-surface)] p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-white">
              <MessageSquare size={14} className="text-[#E1003C]" />
              {t("hacker.feedback.your_submissions")}
            </h2>
            <button
              onClick={() => void loadMyFeedbacks(true)}
              disabled={refreshing}
              className="rounded p-1 text-[var(--app-muted)] transition-colors hover:text-white disabled:opacity-50"
            >
              <RefreshCw
                size={13}
                className={refreshing ? "animate-spin" : ""}
              />
            </button>
          </div>
          <div className="space-y-2">
            {myFeedbacks.map((f) => (
              <div
                key={f.id}
                className="rounded-lg bg-white/[0.03] px-4 py-3"
              >
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] text-[var(--app-muted)]">
                    {(() => {
                      // Map the stored category value (always written in
                      // Azerbaijani by the form) back to a translated
                      // label so the chip respects the active language.
                      const match = CATEGORIES.find((c) => c.value === f.type);
                      return match ? t(match.key) : f.type;
                    })()}
                  </span>
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star
                        key={n}
                        size={11}
                        className={
                          n <= f.rating
                            ? "fill-[#FFC107] text-[var(--app-warn)]"
                            : "text-white/20"
                        }
                      />
                    ))}
                  </div>
                </div>
                <p className="mt-1.5 text-[13px] text-[var(--app-muted)]">{f.comment}</p>
                <p className="mt-1 text-[11px] text-[var(--app-muted-2)]">
                  {fmtDate(f.created_at, lang)}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
