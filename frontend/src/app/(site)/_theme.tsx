"use client";

/**
 * The public site's own light/dark switch.
 *
 * Light is the default (the marketing site reads like a document); visitors
 * can switch to dark and the choice is remembered. Stored separately from the
 * console's theme (`hh_theme`) because the two surfaces are designed apart.
 *
 * Read through useSyncExternalStore with a "light" server snapshot, so the
 * first client render matches the server markup and React does not flag a
 * hydration mismatch.
 */

import { useEffect, useSyncExternalStore, type ReactNode } from "react";

type SiteTheme = "light" | "dark";
const KEY = "hs_theme";
const listeners = new Set<() => void>();

function read(): SiteTheme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "dark" || v === "light") return v;
  } catch {}
  return "light";
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function useSiteTheme() {
  const theme = useSyncExternalStore(subscribe, read, () => "light" as SiteTheme);
  const toggle = () => {
    try {
      localStorage.setItem(KEY, read() === "dark" ? "light" : "dark");
    } catch {}
    listeners.forEach((l) => l());
  };
  return { theme, toggle };
}

export function SiteRoot({ className, children }: { className: string; children: ReactNode }) {
  const { theme } = useSiteTheme();

  // Reveal-on-scroll: mark the root once hydrated, then reveal each
  // `.hs-reveal` element the first time it enters the viewport.
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-site-root]");
    if (!root) return;
    root.classList.add("hs-js");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    const observe = () =>
      root.querySelectorAll(".hs-reveal:not(.is-in)").forEach((el) => io.observe(el));
    observe();
    // Pages render client-side; pick up sections that mount later.
    const mo = new MutationObserver(observe);
    mo.observe(root, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);

  return (
    <div data-site-root className={`hs hs-site ${theme === "dark" ? "hs-night" : ""} ${className}`}>
      {children}
    </div>
  );
}
