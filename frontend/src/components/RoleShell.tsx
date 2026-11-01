"use client";

/**
 * The frame every role portal sits in.
 *
 * The mentor and volunteer shells were 431 lines between them and differed on
 * 35: the nav list, the badge icon, and three translation keys. The judge and
 * hacker portals carry the same structure again. That duplication is not a
 * tidiness problem — it is why a fix lands in one portal and not the others,
 * and why the product feels different depending on which role you hold. The
 * mobile sign-out row in the drawer had to be added three separate times for
 * exactly that reason, and its comment in each file says so.
 *
 * Everything that was shared lives here. What differs is passed in.
 */

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu, Moon, Sun, X, type LucideIcon } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useTranslation } from "@/contexts/LanguageContext";
import { NotificationsBell } from "@/components/NotificationsBell";
import { ShellNotices } from "@/components/notices/ShellNotices";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { RoleShellGuard } from "@/components/RoleShellGuard";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { WorkspaceSwitchLink } from "@/components/WorkspaceSwitch";
import { clearWorkspace } from "@/lib/workspaces";

export interface RoleNavItem {
  labelKey: string;
  href: string;
  icon: LucideIcon;
}

export type RolePortalPath = "/hacker" | "/judge" | "/mentor" | "/volunteer";

export interface RoleShellProps {
  /** Route prefix owned by this portal. Also the guard's scope, which is why
   *  it is a closed union rather than a string. */
  basePath: RolePortalPath;
  nav: RoleNavItem[];
  /** Up to five destinations for the phone's bottom bar. */
  mobileNav: { href: string; icon: LucideIcon; labelKey: string }[];
  /** The pill beside the product name. */
  badge: { icon: LucideIcon; labelKey: string; tone?: "ok" | "brand" | "info" | "warn" };
  menuTitleKey: string;
  footerTagKey: string;
  /** Rendered instead of the sidebar and content — the eliminated-hacker case. */
  override?: React.ReactNode;
  children: React.ReactNode;
}

const BADGE_TONE: Record<string, { bg: string; fg: string }> = {
  ok:    { bg: "rgba(0,200,83,0.15)",  fg: "var(--app-ok)" },
  brand: { bg: "rgba(225,0,60,0.15)",  fg: "var(--app-brand-text, #E1003C)" },
  info:  { bg: "rgba(106,166,255,0.15)", fg: "var(--app-sky)" },
  warn:  { bg: "rgba(255,193,7,0.15)", fg: "var(--app-warn)" },
};

export function RoleShell({
  basePath,
  nav,
  mobileNav,
  badge,
  menuTitleKey,
  footerTagKey,
  override,
  children,
}: RoleShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      /* the cookies below are cleared either way */
    }
    for (const c of ["hh_role", "hh_email", "hh_status"]) {
      document.cookie = `${c}=; Path=/; Max-Age=0; SameSite=Lax`;
    }
    clearWorkspace();
    router.replace("/login");
  };

  const BadgeIcon = badge.icon;
  const tone = BADGE_TONE[badge.tone ?? "ok"];

  return (
    <div className="theme-bg-page flex h-[100dvh] flex-col overflow-hidden">
      <RoleShellGuard prefix={basePath} />

      <header className="theme-bg-page theme-text theme-border relative z-50 flex h-[60px] shrink-0 items-center justify-between gap-2 border-b px-3 sm:h-[70px] sm:px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="theme-text-muted tap rounded-lg p-2 opacity-80 hover:opacity-100 lg:hidden"
            aria-label="Toggle menu"
            aria-expanded={sidebarOpen}
          >
            <Menu size={22} />
          </button>
          <Image
            src="/logo.svg"
            alt="HackOS logo"
            width={36}
            height={36}
            className="h-8 w-8 shrink-0 rounded-lg bg-white/5 object-contain sm:h-9 sm:w-9"
          />
          <h1 className="theme-text flex min-w-0 items-center gap-2 text-[15px] font-semibold leading-tight">
            <span className="truncate">{t("shell.app_title")}</span>
            <span
              className="hidden shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide sm:inline-flex"
              style={{ background: tone.bg, color: tone.fg }}
            >
              <BadgeIcon size={10} />
              {t(badge.labelKey)}
            </span>
          </h1>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <div className="hidden sm:block">
            <LanguageSwitcher />
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className="theme-text-muted tap hidden rounded-lg p-2 opacity-70 transition-colors hover:opacity-100 sm:inline-flex"
            title={theme === "dark" ? t("shell.theme_light") : t("shell.theme_dark")}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <NotificationsBell />
          <WorkspaceSwitchLink className="theme-text-muted theme-border hidden items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:opacity-100 md:inline-flex" />
          <button
            type="button"
            onClick={logout}
            className="theme-text-muted theme-border hidden cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:opacity-100 sm:inline-flex"
          >
            <LogOut size={14} />
            {t("shell.logout")}
          </button>
        </div>
      </header>

      {override ?? (
        <div className="flex flex-1 overflow-hidden">
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-30 bg-black/60 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          <aside
            className={`
              theme-bg-sidebar theme-border theme-text fixed inset-y-0 left-0 z-40 mt-[60px] flex w-[80vw] max-w-[280px] shrink-0 flex-col border-r
              transition-transform duration-300 sm:mt-[70px] sm:w-[240px]
              ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
              lg:relative lg:mt-0 lg:translate-x-0
            `}
          >
            <div className="theme-border flex items-center justify-between border-b px-4 py-3 lg:justify-start">
              <p className="theme-text-muted text-[11px] font-semibold uppercase tracking-wide opacity-70">
                {t(menuTitleKey)}
              </p>
              <button
                onClick={() => setSidebarOpen(false)}
                className="theme-text-muted rounded-lg p-1 opacity-60 hover:opacity-100 lg:hidden"
                aria-label="Close menu"
              >
                <X size={16} />
              </button>
            </div>

            <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
              {nav.map(({ labelKey, href, icon: Icon }) => {
                const active = href === basePath ? pathname === basePath : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setSidebarOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                      active ? "bg-[#E1003C]/15 theme-text" : "theme-text-muted hover:opacity-100"
                    }`}
                  >
                    {active && (
                      <span className="absolute bottom-2 left-0 top-2 w-1 rounded-r-full bg-[#E1003C]" />
                    )}
                    <Icon
                      size={18}
                      className={active ? "text-[#E1003C]" : "theme-text-muted group-hover:opacity-100"}
                    />
                    {t(labelKey)}
                  </Link>
                );
              })}
            </nav>

            {/*
             * The header's sign-out is `sm:inline-flex`, so on a phone the
             * drawer is the only place to leave. This row had to be added to
             * three shells separately before they shared one.
             */}
            <div className="theme-border flex flex-col gap-2 border-t p-3 lg:hidden">
              <WorkspaceSwitchLink
                onClick={() => setSidebarOpen(false)}
                className="theme-text-muted theme-border flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors hover:opacity-100"
              />
              <button
                type="button"
                onClick={() => {
                  setSidebarOpen(false);
                  void logout();
                }}
                className="theme-text-muted theme-border flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors hover:opacity-100"
              >
                <LogOut size={14} />
                {t("shell.logout")}
              </button>
            </div>

            <div className="theme-border theme-text-muted border-t p-4 text-[11px] opacity-50">
              {t(footerTagKey)}
            </div>
          </aside>

          <main className="theme-bg-page theme-text has-mobile-nav min-w-0 flex-1 overflow-y-auto overflow-x-hidden shell-gutter py-3 pl-safe pr-safe sm:py-4 md:py-6 lg:py-8">
            <div key={pathname} className="animate-fade-in mx-auto min-h-full w-full min-w-0 max-w-5xl">
              <ShellNotices />
              {children}
            </div>
          </main>

          <MobileBottomNav basePath={basePath} items={mobileNav} />
        </div>
      )}
    </div>
  );
}
