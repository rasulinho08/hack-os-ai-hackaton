/**
 * The presentation timer, as plain data and functions.
 *
 * One clock per slot runs through the pitch and then the questions: the
 * time on stage is what was banked before the last start plus, while
 * running, the time since. Because it is anchored to the wall clock, the
 * state can be saved (localStorage, per event) and a reload — or a second
 * look from another tab of the same browser — shows the same seconds.
 */

export interface TimerConfig {
  /** Pitch length in seconds. */
  talkSec: number;
  /** Questions after the pitch, in seconds (0 for none). */
  qaSec: number;
  /** Warn this many seconds before a phase ends (0 for never). */
  warnSec: number;
}

export interface TimerState {
  /** The presentation on stage; null when nobody is. */
  slotId: number | null;
  running: boolean;
  /** When the current run started (ms since epoch); null while paused. */
  anchor: number | null;
  /** Milliseconds on stage before the current run. */
  banked: number;
}

export type TimerPhase = "ready" | "talk" | "qa" | "over";

export interface TimerView {
  phase: TimerPhase;
  /** Whole seconds left in the phase (0 when over). */
  remaining: number;
  /** Whole seconds past the end (only when over). */
  overtime: number;
  /** Near the end of the phase. */
  warn: boolean;
  /** 0–1 through the whole slot (pitch and questions). */
  progress: number;
  elapsed: number;
}

export const IDLE: TimerState = { slotId: null, running: false, anchor: null, banked: 0 };

export function configFrom(s: { slotMinutes: number; qaMinutes: number; warnSeconds: number }): TimerConfig {
  const minutes = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  return {
    talkSec: Math.max(60, Math.round(minutes(s.slotMinutes) * 60)),
    qaSec: Math.round(minutes(s.qaMinutes) * 60),
    warnSec: Number.isFinite(s.warnSeconds) && s.warnSeconds > 0 ? Math.round(s.warnSeconds) : 0,
  };
}

export function elapsedMs(state: TimerState, now: number): number {
  const live = state.running && state.anchor != null ? Math.max(0, now - state.anchor) : 0;
  return Math.max(0, state.banked) + live;
}

export function viewOf(state: TimerState, cfg: TimerConfig, now: number): TimerView {
  const elapsed = Math.floor(elapsedMs(state, now) / 1000);
  const total = cfg.talkSec + cfg.qaSec;
  const progress = total > 0 ? Math.min(1, elapsed / total) : 0;
  if (!state.running && state.banked <= 0) {
    return { phase: "ready", remaining: cfg.talkSec, overtime: 0, warn: false, progress: 0, elapsed: 0 };
  }
  if (elapsed < cfg.talkSec) {
    const remaining = cfg.talkSec - elapsed;
    return { phase: "talk", remaining, overtime: 0, warn: cfg.warnSec > 0 && remaining <= cfg.warnSec, progress, elapsed };
  }
  if (elapsed < total) {
    const remaining = total - elapsed;
    // Questions are short: warn at the organiser's threshold or at half of them, whichever is sooner.
    const threshold = Math.min(cfg.warnSec, Math.floor(cfg.qaSec / 2));
    return { phase: "qa", remaining, overtime: 0, warn: threshold > 0 && remaining <= threshold, progress, elapsed };
  }
  return { phase: "over", remaining: 0, overtime: elapsed - total, warn: true, progress: 1, elapsed };
}

export function start(state: TimerState, now: number): TimerState {
  if (state.running) return state;
  return { ...state, running: true, anchor: now };
}

export function pause(state: TimerState, now: number): TimerState {
  if (!state.running) return state;
  return { ...state, running: false, anchor: null, banked: elapsedMs(state, now) };
}

export function toggle(state: TimerState, now: number): TimerState {
  return state.running ? pause(state, now) : start(state, now);
}

export function reset(state: TimerState): TimerState {
  return { ...state, running: false, anchor: null, banked: 0 };
}

/** Put another presentation on stage, with a fresh clock that waits for Start. */
export function onStage(slotId: number | null): TimerState {
  return { slotId, running: false, anchor: null, banked: 0 };
}

/** Jump the clock to the questions (the pitch ended early). */
export function skipToQa(state: TimerState, cfg: TimerConfig, now: number): TimerState {
  return { ...state, banked: cfg.talkSec * 1000, anchor: state.running ? now : null };
}

/** "04:59", "1:02:03" for long ones. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(r)}` : `${two(m)}:${two(r)}`;
}

/* ── Keeping it across reloads ───────────────────────────────────────────── */

export const storageKey = (eventId: number) => `hackos:presenter:${eventId}`;

export interface SavedPresenter {
  timer: TimerState;
  /** The presenter screen was open. */
  open: boolean;
}

export function parseSaved(raw: string | null): SavedPresenter | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const t = (v && typeof v === "object" ? v.timer : null) as Record<string, unknown> | null;
    if (!t || typeof t !== "object") return null;
    const slotId = t.slotId == null ? null : Number(t.slotId);
    const anchor = t.anchor == null ? null : Number(t.anchor);
    const banked = Number(t.banked);
    if ((slotId != null && !Number.isFinite(slotId)) || (anchor != null && !Number.isFinite(anchor)) || !Number.isFinite(banked) || banked < 0) return null;
    const running = Boolean(t.running) && anchor != null;
    return { timer: { slotId, running, anchor: running ? anchor : null, banked }, open: Boolean(v.open) };
  } catch {
    return null;
  }
}

export function loadSaved(eventId: number): SavedPresenter | null {
  try {
    return parseSaved(window.localStorage.getItem(storageKey(eventId)));
  } catch {
    return null;
  }
}

export function save(eventId: number, saved: SavedPresenter): void {
  try {
    window.localStorage.setItem(storageKey(eventId), JSON.stringify(saved));
  } catch {
    /* private mode or full storage: the timer still works, it just will not survive a reload */
  }
}
