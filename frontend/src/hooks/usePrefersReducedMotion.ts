"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the visitor asked the system for less motion.
 *
 * Read through useSyncExternalStore with a `false` server snapshot, so the
 * first client render matches the server markup, and kept live: switching the
 * setting while the page is open takes effect without a reload.
 *
 * The store functions are exported on their own so they can be tested
 * without a DOM.
 */

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

type MatchMedia = (query: string) => Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">;

function defaultMatchMedia(): MatchMedia | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? (q) => window.matchMedia(q)
    : null;
}

export function readReducedMotion(matchMedia: MatchMedia | null = defaultMatchMedia()): boolean {
  if (!matchMedia) return false;
  try {
    return matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

export function subscribeReducedMotion(
  onChange: () => void,
  matchMedia: MatchMedia | null = defaultMatchMedia(),
): () => void {
  if (!matchMedia) return () => {};
  const mql = matchMedia(REDUCED_MOTION_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => subscribeReducedMotion(cb),
    () => readReducedMotion(),
    () => false,
  );
}
