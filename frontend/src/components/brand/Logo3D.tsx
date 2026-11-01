"use client";

/**
 * The HackOS mark in 3D.
 *
 * What paints first is the flat mark, inline SVG at the final size, so the
 * layout never moves and nothing waits on WebGL. Once the page has loaded,
 * the browser is idle and the mark is on screen, the renderer (a few KB, see
 * logo3dScene.ts) is fetched with a dynamic import and draws into a canvas
 * laid over the SVG. Its first frame is the mark seen face-on, exactly the
 * SVG, so the hand-over is invisible; it then turns into its resting pose.
 *
 * With reduced motion the renderer draws one lit still and stops. Without
 * WebGL, or if the GPU drops the context, the flat mark simply stays.
 *
 * Size it with `className` (width and height); the canvas overhangs the box
 * by 35% on every side for the turn and the shadow, without taking space.
 */

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { BrandMarkSvg } from "./BrandMarkSvg";
import { isOnDarkGround } from "./groundTone";
import type { LogoScene } from "./logo3dScene";

/** (LOGO_FRAME - 1) / 2, as a percentage of the box: kept here so the scene stays out of the page bundle. */
const OVERHANG = 35;

function afterLoadAndIdle(): Promise<void> {
  const loaded =
    document.readyState === "complete"
      ? Promise.resolve()
      : new Promise<void>((r) => window.addEventListener("load", () => r(), { once: true }));
  return loaded.then(
    () =>
      new Promise<void>((r) => {
        if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => r(), { timeout: 2000 });
        else setTimeout(r, 300);
      }),
  );
}

export function Logo3D({
  className = "",
  label,
  interactive = true,
}: {
  className?: string;
  /** Accessible name; leave empty where the mark is decorative. */
  label?: string;
  /** Lean toward the pointer. */
  interactive?: boolean;
}) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<LogoScene | null>(null);
  const reduced = usePrefersReducedMotion();
  const reducedRef = useRef(reduced);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    reducedRef.current = reduced;
    sceneRef.current?.setReducedMotion(reduced);
  }, [reduced]);

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas || typeof IntersectionObserver === "undefined") return;
    let cancelled = false;
    let mo: MutationObserver | null = null;
    let toneFrame = 0;
    const cleanups: Array<() => void> = [];

    const onScreen = new Promise<void>((resolve) => {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io.disconnect();
            resolve();
          }
        },
        { rootMargin: "200px" },
      );
      io.observe(box);
      cleanups.push(() => io.disconnect());
    });

    Promise.all([afterLoadAndIdle(), onScreen])
      .then(() => import("./logo3dScene"))
      .then(({ createLogoScene }) => {
        if (cancelled) return;
        let dark = isOnDarkGround(box);
        const scene = createLogoScene(canvas, {
          reducedMotion: reducedRef.current,
          dark,
          interactive,
          onReady: () => {
            if (!cancelled) setReady(true);
          },
          onLost: () => {
            if (!cancelled) setReady(false);
          },
        });
        if (!scene) return;
        sceneRef.current = scene;
        // Follow theme switches: the site and the console flip a class or a
        // data attribute somewhere above the mark.
        mo = new MutationObserver(() => {
          if (toneFrame) return;
          toneFrame = requestAnimationFrame(() => {
            toneFrame = 0;
            const next = isOnDarkGround(box);
            if (next !== dark) {
              dark = next;
              scene.setDark(dark);
            }
          });
        });
        mo.observe(document.documentElement, {
          attributes: true,
          subtree: true,
          attributeFilter: ["class", "data-theme"],
        });
      })
      .catch(() => {
        // No renderer: the flat mark stays, which is a complete logo.
      });

    return () => {
      cancelled = true;
      cleanups.forEach((c) => c());
      mo?.disconnect();
      if (toneFrame) cancelAnimationFrame(toneFrame);
      sceneRef.current?.destroy();
      sceneRef.current = null;
    };
  }, [interactive]);

  return (
    <span
      ref={boxRef}
      className={`relative inline-block shrink-0 align-middle ${className}`}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    >
      <BrandMarkSvg
        className="block h-full w-full"
        // Hidden only once the canvas has fully faded in over it.
        style={{ opacity: ready ? 0 : 1, transition: ready ? "opacity 0s linear 0.35s" : "none" }}
      />
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          left: `-${OVERHANG}%`,
          top: `-${OVERHANG}%`,
          width: `${100 + 2 * OVERHANG}%`,
          height: `${100 + 2 * OVERHANG}%`,
          opacity: ready ? 1 : 0,
          transition: "opacity 0.35s ease-out",
        }}
      />
    </span>
  );
}
