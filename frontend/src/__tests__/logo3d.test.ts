import { describe, expect, it, vi } from "vitest";
import {
  FRONT_POSE,
  INTRO_SECONDS,
  POINTER_TILT,
  STILL_POSE,
  damp,
  idlePose,
  livePose,
  pointerTilt,
  rotationMatrix,
  transpose3,
} from "@/components/brand/logo3dMotion";
import { DARK_LUMINANCE, parseRgb, relativeLuminance } from "@/components/brand/groundTone";
import {
  REDUCED_MOTION_QUERY,
  readReducedMotion,
  subscribeReducedMotion,
} from "@/hooks/usePrefersReducedMotion";

/* ── Reduced motion ─────────────────────────────────────────────────── */

function fakeMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches,
    addEventListener: vi.fn((_: string, cb: () => void) => listeners.add(cb)),
    removeEventListener: vi.fn((_: string, cb: () => void) => listeners.delete(cb)),
  };
  const matchMedia = vi.fn(() => mql);
  return { matchMedia, mql, listeners };
}

describe("prefers-reduced-motion store", () => {
  it("reads the media query", () => {
    expect(readReducedMotion(fakeMatchMedia(true).matchMedia)).toBe(true);
    expect(readReducedMotion(fakeMatchMedia(false).matchMedia)).toBe(false);
    const { matchMedia } = fakeMatchMedia(true);
    readReducedMotion(matchMedia);
    expect(matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);
  });

  it("is false where there is no matchMedia (the server, old browsers)", () => {
    expect(readReducedMotion(null)).toBe(false);
    expect(() => subscribeReducedMotion(() => {}, null)()).not.toThrow();
  });

  it("is false when matchMedia throws", () => {
    expect(readReducedMotion(() => { throw new Error("nope"); })).toBe(false);
  });

  it("subscribes to changes and unsubscribes the same listener", () => {
    const { matchMedia, mql, listeners } = fakeMatchMedia(false);
    const cb = vi.fn();
    const off = subscribeReducedMotion(cb, matchMedia);
    expect(listeners.size).toBe(1);
    listeners.forEach((l) => l());
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    expect(mql.removeEventListener).toHaveBeenCalledWith("change", cb);
    expect(listeners.size).toBe(0);
  });
});

/* ── Motion ─────────────────────────────────────────────────────────── */

describe("3D mark motion", () => {
  const none = { rx: 0, ry: 0, rz: 0 };

  it("starts face-on, so the first frame matches the flat SVG", () => {
    expect(livePose(0, none)).toEqual(FRONT_POSE);
  });

  it("has settled into the idle drift once the intro is over", () => {
    const t = INTRO_SECONDS + 3;
    const p = livePose(t, none);
    const idle = idlePose(t);
    expect(p.rx).toBeCloseTo(idle.rx, 10);
    expect(p.ry).toBeCloseTo(idle.ry, 10);
  });

  it("drifts gently around the resting pose and never spins", () => {
    for (let t = 0; t < 120; t += 0.37) {
      const p = idlePose(t);
      expect(Math.abs(p.rx - STILL_POSE.rx)).toBeLessThanOrEqual(0.08);
      expect(Math.abs(p.ry - STILL_POSE.ry)).toBeLessThanOrEqual(0.25);
      expect(Math.abs(p.rz - STILL_POSE.rz)).toBeLessThanOrEqual(0.03);
    }
  });

  it("leans toward the pointer, clamped at the viewport's edge", () => {
    const viewport = { width: 1000, height: 800 };
    const center = { x: 500, y: 400 };
    const still = pointerTilt(center, center, viewport);
    expect(Math.abs(still.rx) + Math.abs(still.ry) + Math.abs(still.rz)).toBe(0);
    const right = pointerTilt({ x: 1000, y: 400 }, center, viewport);
    expect(right.ry).toBeCloseTo(POINTER_TILT.y);
    const far = pointerTilt({ x: 99999, y: -99999 }, center, viewport);
    expect(far.ry).toBeCloseTo(POINTER_TILT.y);
    expect(far.rx).toBeCloseTo(-POINTER_TILT.x);
  });

  it("damps the same whatever the frame rate", () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = damp(a, 1, 3, 1 / 60);
    let b = 0;
    for (let i = 0; i < 144; i++) b = damp(b, 1, 3, 1 / 144);
    expect(a).toBeCloseTo(1 - Math.exp(-3), 6);
    expect(b).toBeCloseTo(a, 6);
  });

  it("builds a proper rotation whose transpose is its inverse", () => {
    const r = rotationMatrix({ rx: 0.3, ry: -0.5, rz: 0.1 });
    const t = transpose3(r);
    // column-major multiply r * t
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += r[k * 3 + i] * t[j * 3 + k];
        expect(s).toBeCloseTo(i === j ? 1 : 0, 6);
      }
    }
    // Turning right (positive ry) points the face toward +x.
    const turn = rotationMatrix({ rx: 0, ry: 0.5, rz: 0 });
    expect(turn[6]).toBeCloseTo(Math.sin(0.5), 6);
  });
});

/* ── Ground tone ────────────────────────────────────────────────────── */

describe("ground tone", () => {
  it("parses computed rgb() and rgba() colours", () => {
    expect(parseRgb("rgb(10, 11, 15)")).toEqual({ r: 10, g: 11, b: 15, a: 1 });
    expect(parseRgb("rgba(251, 250, 248, 0.9)")).toEqual({ r: 251, g: 250, b: 248, a: 0.9 });
    expect(parseRgb("rgb(0 0 0 / 50%)")).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseRgb("oklch(0.2 0 0)")).toBeNull();
  });

  it("tells the site's dark ground from its light one", () => {
    expect(relativeLuminance({ r: 10, g: 11, b: 15 })).toBeLessThan(DARK_LUMINANCE);
    expect(relativeLuminance({ r: 20, g: 24, b: 31 })).toBeLessThan(DARK_LUMINANCE);
    expect(relativeLuminance({ r: 251, g: 250, b: 248 })).toBeGreaterThan(DARK_LUMINANCE);
    expect(relativeLuminance({ r: 243, g: 244, b: 246 })).toBeGreaterThan(DARK_LUMINANCE);
  });
});
