"use client";

/**
 * The owner console's theme.
 *
 * The console follows the platform's theme switch (`hh_theme`, the same one
 * the organiser dashboard flips), so the owner chooses light or dark once. Its
 * root carries `.hs .hs-console` and, in dark, `.hs-night`; every colour on
 * the console is a token those classes set (globals.css).
 *
 * The stored choice is only known in the browser, and the server renders the
 * dark default. A tiny script inside the root corrects the class before the
 * first paint, so a light-mode owner never sees the console flash dark; React
 * then takes over from the same store.
 */

import type { ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { OverlayScope } from "@/components/ds/overlays";

/** Runs while the page is parsed, before anything is painted. */
const PRE_PAINT = `(function(){try{var el=document.currentScript&&document.currentScript.parentElement;if(!el)return;var t=localStorage.getItem("hh_theme");if(t==="light"){el.classList.remove("hs-night")}else{el.classList.add("hs-night")}}catch(e){}})();`;

export function ConsoleRoot({ fonts, children }: { fonts: string; children: ReactNode }) {
  const { theme } = useTheme();
  const scope = `hs hs-console${theme === "dark" ? " hs-night" : ""} ${fonts}`;
  return (
    <OverlayScope.Provider value={scope}>
      <div className={scope} data-console-root="" suppressHydrationWarning style={{ minHeight: "100vh" }}>
        <script dangerouslySetInnerHTML={{ __html: PRE_PAINT }} />
        {children}
      </div>
    </OverlayScope.Provider>
  );
}

/** The light/dark switch in the console's top bar. */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to the ${next} theme`}
      title={`Switch to the ${next} theme`}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border transition-colors"
      style={{ borderColor: "var(--hs-line-2)", color: "var(--hs-ink-2)", background: "var(--hs-surface)" }}
    >
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
