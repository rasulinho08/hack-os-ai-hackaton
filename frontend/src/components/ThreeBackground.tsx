"use client";

/**
 * A faint field of drifting points behind the organiser dashboard.
 *
 * This used to be three.js through react-three-fiber: some 870 KB of
 * JavaScript for two hundred dots shown at 12% opacity. The same picture is a
 * 2D canvas — points in a cube turning slowly, projected the way the old
 * camera did (60° field of view, five units back). It pauses while the tab is
 * hidden and holds still for people who ask for reduced motion.
 */

import { useEffect, useRef } from "react";

const COUNT = 200;
const FOV = (60 * Math.PI) / 180;
const CAMERA_Z = 5;

const POINTS = Array.from({ length: COUNT }, () => ({
  x: (Math.random() - 0.5) * 20,
  y: (Math.random() - 0.5) * 20,
  z: (Math.random() - 0.5) * 20,
  red: Math.random() > 0.7,
}));

export default function ThreeBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let raf = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      const ry = t * 0.02;
      const rx = Math.sin(t * 0.01) * 0.1;
      const focal = height / 2 / Math.tan(FOV / 2);
      ctx.clearRect(0, 0, width, height);
      for (const p of POINTS) {
        const x = p.x * Math.cos(ry) + p.z * Math.sin(ry);
        const z1 = -p.x * Math.sin(ry) + p.z * Math.cos(ry);
        const y = p.y * Math.cos(rx) - z1 * Math.sin(rx);
        const z = p.y * Math.sin(rx) + z1 * Math.cos(rx);
        const depth = CAMERA_Z - z;
        if (depth < 0.2) continue;
        const r = Math.min(3, Math.max(0.6, (0.04 * focal) / depth / 2));
        ctx.fillStyle = p.red ? "rgba(225, 0, 60, 0.4)" : "rgba(255, 255, 255, 0.4)";
        ctx.beginPath();
        ctx.arc(width / 2 + (x * focal) / depth, height / 2 - (y * focal) / depth, r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!still && !document.hidden) raf = requestAnimationFrame(draw);
    };

    const onVisible = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(draw);
    };

    const onResize = () => {
      resize();
      if (still) draw(performance.now());
    };

    resize();
    raf = requestAnimationFrame(draw);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 opacity-30" aria-hidden="true">
      <canvas ref={ref} />
    </div>
  );
}
