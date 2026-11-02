"use client";

/**
 * The owner console shell.
 *
 * Every destination here is backed by something the API actually returns. The
 * sales sections this console started with — pipeline, organisations, deals,
 * revenue — are gone, because the database has no table behind any of them and
 * an administration screen that reports invented figures is worse than one that
 * reports nothing: sooner or later someone acts on the number.
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgePercent,
  BarChart3,
  CalendarDays,
  HeartPulse,
  LayoutDashboard,
  LifeBuoy,
  Receipt,
  Building2,
  MessageSquareQuote,
  Scale,
  ScrollText,
  Settings,
  Trophy,
  Users,
  Menu,
  ExternalLink,
} from "lucide-react";
import { PlatformNotice } from "@/components/notices/PlatformNotice";
import { ToastHost } from "@/components/ds/overlays";
import { GlobalSearch } from "./_search";
import { ThemeToggle } from "./_theme";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  hint: string;
}

const NAV: NavItem[] = [
  { href: "/workspace", label: "Overview", icon: LayoutDashboard, hint: "Everything at once" },
  { href: "/workspace/orders", label: "Orders", icon: Receipt, hint: "What was sold and delivered" },
  { href: "/workspace/pricing", label: "Prices & discounts", icon: BadgePercent, hint: "Plan prices, discount codes and campaigns" },
  { href: "/workspace/customers", label: "Customers", icon: Building2, hint: "Accounts, seats and plans" },
  { href: "/workspace/events", label: "Events", icon: Trophy, hint: "Every event on the platform" },
  { href: "/workspace/people", label: "People", icon: Users, hint: "All accounts and roles" },
  { href: "/workspace/judging", label: "Judging", icon: Scale, hint: "Scoring coverage per event" },
  { href: "/workspace/support", label: "Support", icon: LifeBuoy, hint: "Help queue across events" },
  { href: "/workspace/feedback", label: "Feedback", icon: MessageSquareQuote, hint: "What participants said" },
  { href: "/workspace/calendar", label: "Calendar", icon: CalendarDays, hint: "Events on a timeline" },
  { href: "/workspace/analytics", label: "Analytics", icon: BarChart3, hint: "Totals over time" },
  { href: "/workspace/health", label: "Health", icon: HeartPulse, hint: "Database, jobs, requests, integrations" },
  { href: "/workspace/audit", label: "Audit trail", icon: ScrollText, hint: "Who did what, searchable" },
  { href: "/workspace/settings", label: "Settings", icon: Settings, hint: "The notice on every page" },
];

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);

  const active = (href: string) =>
    href === "/workspace" ? pathname === href : pathname.startsWith(href);

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div
        className="flex items-center gap-2.5 border-b px-5 py-4"
        style={{ borderColor: "var(--hs-line)" }}
      >
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] text-[13px] font-bold"
          style={{ background: "var(--hs-brand-solid)", color: "#fff" }}
        >
          H
        </span>
        <div className="min-w-0">
          <p
            className="truncate text-sm font-semibold"
            style={{ fontFamily: "var(--font-display)", color: "var(--hs-ink)" }}
          >
            HackOS
          </p>
          <p className="text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--hs-ink-3)" }}>
            Owner console
          </p>
        </div>
      </div>

      <ul className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {NAV.map(({ href, label, icon: Icon }) => {
          const on = active(href);
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={() => setDrawer(false)}
                className="flex min-h-10 items-center gap-2.5 rounded-[8px] px-3 text-sm transition-colors"
                style={{
                  background: on ? "var(--hs-brand-weak)" : "transparent",
                  color: on ? "var(--hs-brand)" : "var(--hs-ink-2)",
                  fontWeight: on ? 600 : 400,
                }}
              >
                <Icon size={16} className="shrink-0" />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="border-t px-3 py-3" style={{ borderColor: "var(--hs-line)" }}>
        <Link
          href="/"
          className="flex min-h-10 items-center gap-2.5 rounded-[8px] px-3 text-sm"
          style={{ color: "var(--hs-ink-3)" }}
        >
          <ExternalLink size={15} /> hack-os.app
        </Link>
      </div>
    </nav>
  );

  return (
    <ToastHost>
    <div className="flex min-h-screen" style={{ background: "var(--hs-bg)" }}>
      <aside
        className="hidden w-[232px] shrink-0 border-r lg:block"
        style={{ borderColor: "var(--hs-line)", background: "var(--hs-surface)" }}
      >
        <div className="sticky top-0 h-screen">{sidebar}</div>
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0"
            style={{ background: "var(--scrim)" }}
            onClick={() => setDrawer(false)}
          />
          <div
            className="absolute inset-y-0 left-0 w-[260px] border-r"
            style={{ borderColor: "var(--hs-line)", background: "var(--hs-surface)" }}
          >
            {sidebar}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-30 flex items-center gap-3 border-b px-4 py-3"
          style={{ borderColor: "var(--hs-line)", background: "var(--hs-surface)" }}
        >
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Open navigation"
            className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border lg:hidden"
            style={{ borderColor: "var(--hs-line-2)", color: "var(--hs-ink-2)" }}
          >
            <Menu size={16} />
          </button>

          <GlobalSearch pages={NAV.map(({ href, label, hint }) => ({ href, label, hint }))} />

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span
              className="hidden rounded-full px-2.5 py-1 text-[11px] font-medium md:inline"
              style={{ background: "var(--hs-raised)", color: "var(--hs-ink-2)" }}
            >
              Live data
            </span>
            <ThemeToggle />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {/* One measure for every page: wide screens keep a readable grid. */}
          <div className="mx-auto w-full max-w-[1600px]">
            <PlatformNotice />
            {children}
          </div>
        </main>
      </div>

    </div>
    </ToastHost>
  );
}

/** Page heading used by every screen in this console. */
export function PageHead({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1
          className="text-2xl font-semibold tracking-[-0.015em]"
          style={{ fontFamily: "var(--font-display)", color: "var(--hs-ink)" }}
        >
          {title}
        </h1>
        {sub && (
          <p className="mt-1 text-sm" style={{ color: "var(--hs-ink-2)" }}>
            {sub}
          </p>
        )}
      </div>
      {actions}
    </div>
  );
}
