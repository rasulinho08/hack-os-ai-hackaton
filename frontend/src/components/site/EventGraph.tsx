"use client";

/**
 * The hero visualisation: an event's own shape.
 *
 * Each outer point is a participant, each hub is a team, and every team links
 * back to a centre — the platform the judging and results run through. Rotate
 * it slowly and you are looking at the structure the product manages.
 *
 * This used to be three.js. The scene was fifty-four spheres and a line list,
 * and it cost 868 KB to draw them — most of a megabyte of renderer, scene
 * graph and material system for a decoration. Two-dimensional canvas draws the
 * same picture with a rotation done by hand, and the page now ships nothing
 * extra at all for it.
 *
 * It stops entirely when the reader asks for reduced motion, and it stops when
 * scrolled out of view so a background tab is not spending a phone's battery
 * on an animation nobody is looking at.
 */

import { useEffect, useRef } from "react";

const TEAMS = 9;
const PER_TEAM = 5;
const RING = 2.35;

const INK = "#9fb2c9";
const HUB = "#e0e6ef";
const BRAND = "#E1003C";
const LINE = "rgba(120, 138, 163, 0.42)";

/** Deterministic, so the layout is identical on every visit. */
function seeded(i: number) {
  const x = Math.sin(i * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

interface Point {
  x: number;
  y: number;
  z: number;
  r: number;
  hub: boolean;
}

function build() {
  const points: Point[] = [];
  const links: [number, number][] = [];
  const centre = points.push({ x: 0, y: 0, z: 0, r: 0.2, hub: true }) - 1;

  for (let t = 0; t < TEAMS; t++) {
    const a = (t / TEAMS) * Math.PI * 2;
    const hubIndex =
      points.push({
        x: Math.cos(a) * RING,
        y: (seeded(t) - 0.5) * 1.1,
        z: Math.sin(a) * RING,
        r: 0.1,
        hub: true,
      }) - 1;
    links.push([hubIndex, centre]);

    for (let p = 0; p < PER_TEAM; p++) {
      const i =
        points.push({
          x: points[hubIndex].x + (seeded(t * 31 + p * 7) - 0.5) * 1.25,
          y: points[hubIndex].y + (seeded(t * 17 + p * 13) - 0.5) * 1.25,
          z: points[hubIndex].z + (seeded(t * 53 + p * 3) - 0.5) * 1.25,
          r: 0.052,
          hub: false,
        }) - 1;
      links.push([i, hubIndex]);
    }
  }
  return { points, links, centre };
}

export default function EventGraph() {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = host.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const { points, links, centre } = build();
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let width = 0;
    let height = 0;
    const resize = () => {
      const box = el.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = box.width;
      height = box.height;
      cv.width = Math.round(width * dpr);
      cv.height = Math.round(height * dpr);
      cv.style.width = `${width}px`;
      cv.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    let angle = 0;
    let tilt = 0;
    let pointer = 0;
    let raf = 0;
    let running = true;

    const project = (p: Point) => {
      // Rotate about Y, then a small fixed tilt, then a simple perspective.
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const x = p.x * cos - p.z * sin;
      const z = p.x * sin + p.z * cos;
      const y = p.y * Math.cos(tilt) - z * Math.sin(tilt);
      const zz = p.y * Math.sin(tilt) + z * Math.cos(tilt);
      const depth = 6.2 + zz;
      const scale = (Math.min(width, height) * 1.05) / depth;
      return {
        sx: width / 2 + x * scale + pointer * 14,
        sy: height / 2 + y * scale,
        s: scale,
        depth,
      };
    };

    const frame = () => {
      if (!running) return;
      if (width === 0 || height === 0) resize();
      ctx.clearRect(0, 0, width, height);

      const flat = points.map(project);

      ctx.lineWidth = 1;
      ctx.strokeStyle = LINE;
      ctx.beginPath();
      for (const [a, b] of links) {
        ctx.moveTo(flat[a].sx, flat[a].sy);
        ctx.lineTo(flat[b].sx, flat[b].sy);
      }
      ctx.stroke();

      // Farthest first, so nearer points sit on top.
      const order = points.map((_, i) => i).sort((a, b) => flat[b].depth - flat[a].depth);
      for (const i of order) {
        const p = points[i];
        const f = flat[i];
        const radius = Math.max(1, p.r * f.s);

        if (i === centre) {
          const glow = ctx.createRadialGradient(f.sx, f.sy, 0, f.sx, f.sy, radius * 4.2);
          glow.addColorStop(0, "rgba(225, 0, 60, 0.42)");
          glow.addColorStop(1, "rgba(225, 0, 60, 0)");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(f.sx, f.sy, radius * 4.2, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = i === centre ? BRAND : p.hub ? HUB : INK;
        ctx.globalAlpha = i === centre ? 1 : Math.min(1, 7.4 / (f.depth * 1.35));
        ctx.beginPath();
        ctx.arc(f.sx, f.sy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      if (!still) {
        angle += 0.0022;
        tilt += (0.12 - tilt) * 0.02;
      }
      raf = requestAnimationFrame(frame);
    };

    frame();

    const onPointer = (e: PointerEvent) => {
      const box = el.getBoundingClientRect();
      pointer = ((e.clientX - box.left) / box.width - 0.5) * 2;
    };
    if (!still) window.addEventListener("pointermove", onPointer, { passive: true });

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(el);

    // A panel nobody is looking at should not be animating.
    const visibility =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              const on = entries.some((x) => x.isIntersecting);
              if (on === running) return;
              running = on;
              if (on) frame();
              else cancelAnimationFrame(raf);
            },
            { threshold: 0 },
          );
    visibility?.observe(el);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointer);
      observer?.disconnect();
      visibility?.disconnect();
    };
  }, []);

  return (
    <div ref={host} className="hs-canvas" aria-hidden="true">
      <canvas ref={canvas} style={{ display: "block" }} />
    </div>
  );
}
