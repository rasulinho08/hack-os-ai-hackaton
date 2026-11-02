/**
 * The presentation timer: one clock through the pitch and then the
 * questions, warnings near each end, overtime, pausing and resuming against
 * the wall clock, and the saved state surviving a reload (and nothing worse
 * than "no saved state" from a broken one).
 */
import { describe, expect, it } from "vitest";
import {
  IDLE, clock, configFrom, elapsedMs, onStage, parseSaved, pause, reset, skipToQa, start, toggle, viewOf,
} from "@/lib/presenterTimer";

const cfg = configFrom({ slotMinutes: 3, qaMinutes: 2, warnSeconds: 60 });
const T0 = 1_760_000_000_000;
const s = (sec: number) => sec * 1000;

describe("the clock", () => {
  it("reads the organiser's settings", () => {
    expect(cfg).toEqual({ talkSec: 180, qaSec: 120, warnSec: 60 });
    expect(configFrom({ slotMinutes: 0, qaMinutes: -1, warnSeconds: Number.NaN })).toEqual({ talkSec: 60, qaSec: 0, warnSec: 0 });
  });

  it("waits, ready, before it starts", () => {
    expect(viewOf(onStage(5), cfg, T0)).toMatchObject({ phase: "ready", remaining: 180, warn: false, progress: 0 });
  });

  it("runs through the pitch, warns near its end, then the questions, then overtime", () => {
    const running = start(onStage(5), T0);
    expect(viewOf(running, cfg, T0 + s(10))).toMatchObject({ phase: "talk", remaining: 170, warn: false });
    expect(viewOf(running, cfg, T0 + s(120))).toMatchObject({ phase: "talk", remaining: 60, warn: true });
    expect(viewOf(running, cfg, T0 + s(180))).toMatchObject({ phase: "qa", remaining: 120, warn: false });
    // Questions warn at the threshold or at half of them, whichever is sooner: 60 s here.
    expect(viewOf(running, cfg, T0 + s(240))).toMatchObject({ phase: "qa", remaining: 60, warn: true });
    expect(viewOf(running, cfg, T0 + s(330))).toMatchObject({ phase: "over", remaining: 0, overtime: 30, warn: true, progress: 1 });
  });

  it("stops counting while paused and goes on from there", () => {
    let st = start(onStage(5), T0);
    st = pause(st, T0 + s(30));
    expect(elapsedMs(st, T0 + s(500))).toBe(s(30));
    expect(viewOf(st, cfg, T0 + s(500))).toMatchObject({ phase: "talk", remaining: 150 });
    st = start(st, T0 + s(600));
    expect(viewOf(st, cfg, T0 + s(610))).toMatchObject({ phase: "talk", remaining: 140 });
    expect(start(st, T0 + s(700)), "starting twice changes nothing").toBe(st);
    expect(toggle(st, T0 + s(620)).running).toBe(false);
  });

  it("resets, and moves on to the questions early", () => {
    const st = start(onStage(5), T0);
    expect(viewOf(reset(st), cfg, T0 + s(50)).phase).toBe("ready");
    expect(reset(st).slotId).toBe(5);
    const qa = skipToQa(st, cfg, T0 + s(40));
    expect(viewOf(qa, cfg, T0 + s(40))).toMatchObject({ phase: "qa", remaining: 120 });
    expect(viewOf(qa, cfg, T0 + s(50))).toMatchObject({ phase: "qa", remaining: 110 });
  });

  it("has no questions phase when there are none", () => {
    const noQa = configFrom({ slotMinutes: 1, qaMinutes: 0, warnSeconds: 10 });
    const st = start(onStage(1), T0);
    expect(viewOf(st, noQa, T0 + s(59))).toMatchObject({ phase: "talk", remaining: 1, warn: true });
    expect(viewOf(st, noQa, T0 + s(61))).toMatchObject({ phase: "over", overtime: 1 });
  });

  it("writes minutes and seconds, and hours for long ones", () => {
    expect(clock(0)).toBe("00:00");
    expect(clock(299)).toBe("04:59");
    expect(clock(3723)).toBe("1:02:03");
    expect(clock(-5)).toBe("00:00");
  });
});

describe("the saved state", () => {
  it("comes back as it was", () => {
    const st = start(onStage(12), T0);
    expect(parseSaved(JSON.stringify({ timer: st, open: true }))).toEqual({ timer: st, open: true });
    const paused = pause(st, T0 + s(42));
    expect(parseSaved(JSON.stringify({ timer: paused, open: false }))).toEqual({ timer: paused, open: false });
  });

  it("is ignored when broken", () => {
    expect(parseSaved(null)).toBeNull();
    expect(parseSaved("{not json")).toBeNull();
    expect(parseSaved(JSON.stringify({ timer: { slotId: "x", banked: 0 } }))).toBeNull();
    expect(parseSaved(JSON.stringify({ timer: { slotId: 1, banked: -5 } }))).toBeNull();
    expect(parseSaved(JSON.stringify({ open: true }))).toBeNull();
  });

  it("never claims to run without knowing since when", () => {
    expect(parseSaved(JSON.stringify({ timer: { slotId: 1, running: true, anchor: null, banked: 0 }, open: true }))).toEqual({
      timer: { slotId: 1, running: false, anchor: null, banked: 0 }, open: true,
    });
    expect(IDLE).toEqual({ slotId: null, running: false, anchor: null, banked: 0 });
  });
});
