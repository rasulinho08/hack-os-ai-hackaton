/**
 * The "would you recommend it" question (Net Promoter Score): what the API
 * sends, and the arithmetic the organiser's page shows.
 *
 * Answers run 0–10. Promoters answer 9 or 10, passives 7 or 8, detractors
 * 0 to 6; the score is the share of promoters minus the share of detractors,
 * from −100 to 100. The organiser never sees who answered what.
 */

import { ApiError } from "@/lib/api";

export const NPS_BANDS = ["promoter", "passive", "detractor"] as const;
export type NpsBand = (typeof NPS_BANDS)[number];

/** Reasons the API gives for refusing an answer, each worded as np.err.*. */
export const NPS_ERRORS = ["NPS_NOT_OPEN", "EVENT_ARCHIVED", "NOT_PARTICIPANT", "VALIDATION_ERROR"] as const;

export const NPS_COMMENT_MAX = 1000;

export function bandOf(score: number): NpsBand {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

/** −100…100, rounded; null with no answers. */
export function npsScore(scores: number[]): number | null {
  const valid = scores.filter((s) => Number.isInteger(s) && s >= 0 && s <= 10);
  if (!valid.length) return null;
  const p = valid.filter((s) => s >= 9).length;
  const d = valid.filter((s) => s <= 6).length;
  return Math.round(((p - d) / valid.length) * 100);
}

/**
 * Whole-number percentages that add up to 100 (largest remainder), so the
 * split bar and its legend never show 33 + 33 + 33.
 */
export function shares(counts: number[]): number[] {
  const total = counts.reduce((s, n) => s + Math.max(0, n), 0);
  if (!total) return counts.map(() => 0);
  const raw = counts.map((n) => (Math.max(0, n) / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((s, n) => s + n, 0);
  const order = raw.map((r, i) => ({ i, rest: r - floors[i] })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

/** Where a score sits on a −100…100 line, as a percentage from the left. */
export const scorePosition = (score: number) => Math.max(0, Math.min(100, (score + 100) / 2));

/** How a score reads: below zero more detractors than promoters, 30 and up good. */
export function scoreTone(score: number | null): "neutral" | "danger" | "warn" | "ok" {
  if (score == null) return "neutral";
  if (score < 0) return "danger";
  if (score < 30) return "warn";
  return "ok";
}

/** "+42", "0", "−17" (a real minus sign). */
export function signed(score: number): string {
  if (score > 0) return `+${score}`;
  if (score < 0) return `−${Math.abs(score)}`;
  return "0";
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || v === "" || !Number.isFinite(n) ? null : n;
};

export interface NpsComment { score: number; comment: string; at: string | null }

export interface NpsSummary {
  responses: number;
  eligible: number;
  responseRate: number | null;
  promoters: number;
  passives: number;
  detractors: number;
  score: number | null;
  average: number | null;
  distribution: number[];
  comments: NpsComment[];
}

export function normalizeNpsSummary(raw: unknown): NpsSummary {
  const o = obj(raw);
  const dist = Array.from({ length: 11 }, (_, i) => Math.max(0, num(Array.isArray(o.distribution) ? o.distribution[i] : null) ?? 0));
  const responses = num(o.responses) ?? dist.reduce((s, n) => s + n, 0);
  const promoters = num(o.promoters) ?? dist[9] + dist[10];
  const detractors = num(o.detractors) ?? dist.slice(0, 7).reduce((s, n) => s + n, 0);
  const passives = num(o.passives) ?? Math.max(0, responses - promoters - detractors);
  const comments: NpsComment[] = [];
  for (const c of Array.isArray(o.comments) ? o.comments : []) {
    const x = obj(c);
    const score = num(x.score);
    const text = String(x.comment ?? "").trim();
    if (score == null || !text) continue;
    comments.push({ score, comment: text, at: x.at == null ? null : String(x.at) });
  }
  return {
    responses,
    eligible: num(o.eligible) ?? 0,
    responseRate: num(o.responseRate),
    promoters,
    passives,
    detractors,
    score: o.score === null ? null : num(o.score) ?? (responses ? Math.round(((promoters - detractors) / responses) * 100) : null),
    average: num(o.average),
    distribution: dist,
    comments,
  };
}

export interface NpsState {
  eligible: boolean;
  open: boolean;
  closed: boolean;
  opensAt: string | null;
  answer: { score: number; comment: string | null; at: string | null } | null;
}

export function normalizeNpsState(raw: unknown): NpsState {
  const o = obj(raw);
  const a = obj(o.answer);
  const score = num(a.score);
  return {
    eligible: Boolean(o.eligible),
    open: Boolean(o.open),
    closed: Boolean(o.closed),
    opensAt: o.opensAt == null ? null : String(o.opensAt),
    answer: o.answer && score != null ? { score, comment: a.comment == null ? null : String(a.comment), at: a.at == null ? null : String(a.at) } : null,
  };
}

/** The key of the sentence for a refused answer. */
export function npsErrorKey(err: unknown): string {
  if (err instanceof ApiError && err.code && (NPS_ERRORS as readonly string[]).includes(err.code)) return `np.err.${err.code}`;
  return "np.err.generic";
}
