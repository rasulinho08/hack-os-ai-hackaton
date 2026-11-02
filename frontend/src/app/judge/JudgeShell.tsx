"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  ClipboardList,
  Gauge,
  HelpCircle,
  ListChecks,
  Megaphone,
  MessagesSquare,
  Scale,
  LogOut,
  Menu,
  X,
  Sun,
  Moon,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { NotificationsBell } from "@/components/NotificationsBell";
import { ShellNotices } from "@/components/notices/ShellNotices";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useTranslation } from "@/contexts/LanguageContext";
import { RoleShellGuard } from "@/components/RoleShellGuard";
import { WorkspaceSwitchLink } from "@/components/WorkspaceSwitch";
import { clearWorkspace } from "@/lib/workspaces";
import { MobileBottomNav } from "@/components/MobileBottomNav";

const menu = [
  {
    key: "assigned",
    labelKey: "judge.nav.assigned",
    targetId: null,
    icon: ClipboardList,
  },
  {
    key: "queue",
    labelKey: "judge.nav.queue",
    targetId: "queue",
    icon: ListChecks,
  },
  {
    key: "scores",
    labelKey: "judge.nav.scores",
    targetId: "scores",
    icon: Gauge,
  },
  {
    key: "announcements",
    labelKey: "judge.nav.announcements",
    targetId: "announcements",
    icon: Megaphone,
  },
  { key: "help", labelKey: "judge.nav.help", targetId: "help", icon: HelpCircle },
];

/** Pages of their own, after the sections of the scoring page. */
const pages = [{ key: "chat", labelKey: "nav.chat", href: "/judge/chat", icon: MessagesSquare }];

export default function JudgeShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [activeKey, setActiveKey] = useState<string>("assigned");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();

  const logout = async () => {
    try { await fetch("/api/auth/logout", { method: "POST", credentials: "include" }); } catch { /* ignore */ }
    document.cookie = "hh_role=; Path=/; Max-Age=0; SameSite=Lax";
    document.cookie = "hh_email=; Path=/; Max-Age=0; SameSite=Lax";
    clearWorkspace();
    router.replace("/login");
  };

  const scrollToSection = (key: string, targetId: string | null) => {
    setActiveKey(key);
    // From another page (the chat), a section is on the scoring page.
    if (pathname !== "/judge") {
      router.push(targetId ? `/judge#${targetId}` : "/judge");
      return;
    }
    if (!targetId) {
      // just scroll to top
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const el = document.getElementById(targetId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      router.push(`/judge#${targetId}`);
    }
  };

  return (
    <div className="theme-bg-page flex h-[100dvh] flex-col overflow-hidden">
      <RoleShellGuard prefix="/judge" />
      {/* Top bar */}
      <header className="theme-bg-page theme-text theme-border relative z-50 flex h-[56px] shrink-0 items-center justify-between gap-2 border-b px-3 sm:h-[64px] sm:px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="theme-text-muted tap rounded-lg p-2 opacity-80 hover:opacity-100 lg:hidden"
            aria-label="Toggle menu"
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
          <div className="min-w-0">
            <h1 className="theme-text flex min-w-0 items-center gap-2 text-[15px] font-semibold leading-tight">
              <span className="truncate">{t("shell.app_title")}</span>
              <span className="hidden shrink-0 items-center gap-1 rounded-full bg-[#E1003C]/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#E1003C] sm:inline-flex">
                <Scale size={10} />
                {t("judge.badge")}
              </span>
            </h1>
            <p className="theme-text-muted mt-0.5 hidden truncate text-[12px] sm:block">
              {t("judge.header_subtitle")}
            </p>
          </div>
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
          <WorkspaceSwitchLink className="theme-text-muted theme-border hidden items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors hover:opacity-100 md:inline-flex" />
          <button
            type="button"
            onClick={logout}
            className="theme-text-muted theme-border hidden cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors hover:opacity-100 sm:inline-flex"
          >
            <LogOut size={14} />
            {t("shell.logout")}
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/60 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={`
            theme-bg-sidebar theme-border theme-text fixed inset-y-0 left-0 z-40 mt-[56px] flex w-[80vw] max-w-[260px] shrink-0 flex-col border-r
            transition-transform duration-300 sm:mt-[64px] sm:w-[232px]
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
            lg:relative lg:mt-0 lg:translate-x-0
          `}
        >
          {/* Close (mobile) */}
          <div className="flex items-center justify-end p-3 lg:hidden">
            <button
              onClick={() => setSidebarOpen(false)}
              className="theme-text-muted rounded-lg p-1.5 opacity-60 hover:opacity-100"
            >
              <X size={20} />
            </button>
          </div>
          <div className="theme-border border-b px-4 py-4">
            <p className="theme-text-muted text-[12px] font-semibold uppercase tracking-wide opacity-70">
              {t("shell.nav_section")}
            </p>
          </div>
          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
            {menu.map(({ key, labelKey, targetId, icon: Icon }) => {
              const active = pathname === "/judge" && activeKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    scrollToSection(key, targetId);
                    setSidebarOpen(false);
                  }}
                  className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium text-left transition-all ${
                    active
                      ? "bg-[#E1003C]/18 theme-text"
                      : "theme-text-muted hover:opacity-100"
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-[#E1003C]" />
                  )}
                  <Icon
                    size={18}
                    className={
                      active
                        ? "text-[#E1003C]"
                        : "theme-text-muted group-hover:opacity-100"
                    }
                  />
                  {t(labelKey)}
                </button>
              );
            })}
            {pages.map(({ key, labelKey, href, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={key}
                  href={href}
                  onClick={() => setSidebarOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium text-left transition-all ${
                    active ? "bg-[#E1003C]/18 theme-text" : "theme-text-muted hover:opacity-100"
                  }`}
                >
                  {active && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-[#E1003C]" />}
                  <Icon size={18} className={active ? "text-[#E1003C]" : "theme-text-muted group-hover:opacity-100"} />
                  {t(labelKey)}
                </Link>
              );
            })}
          </nav>
          {/*
           * Problem 10: the top-right logout button is `hidden sm:inline-flex`
           * so judges on a phone couldn't sign out at all. Expose it here
           * inside the drawer on mobile.
           */}
          <div className="theme-border flex flex-col gap-2 border-t p-3 lg:hidden">
            <WorkspaceSwitchLink
              onClick={() => setSidebarOpen(false)}
              className="theme-text-muted theme-border flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors hover:opacity-100"
            />
            <button
              type="button"
              onClick={() => {
                setSidebarOpen(false);
                void logout();
              }}
              className="theme-text-muted theme-border flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors hover:opacity-100"
            >
              <LogOut size={14} />
              {t("shell.logout")}
            </button>
          </div>
          <div className="theme-border theme-text-muted border-t p-4 text-[12px] opacity-60">
            {t("judge.footer_tag")}
          </div>
        </aside>

        {/* Main */}
        <main className="theme-bg-page theme-text has-mobile-nav min-w-0 flex-1 overflow-y-auto overflow-x-hidden shell-gutter py-3 pl-safe pr-safe sm:py-4 md:py-6 lg:py-8">
          <div
            key={pathname}
            className="animate-fade-in mx-auto min-h-full min-w-0 w-full max-w-[100vw]"
          >
            <ShellNotices />
            {children}
          </div>
        </main>

        {/* Mobile bottom navigation */}
        <MobileBottomNav
          basePath="/judge"
          items={[
            { href: "/judge", icon: ClipboardList, labelKey: "mobile_nav.assigned" },
            { href: "/judge#queue", icon: ListChecks, labelKey: "mobile_nav.queue" },
            { href: "/judge#scores", icon: Gauge, labelKey: "mobile_nav.scores" },
            { href: "/judge#announcements", icon: Megaphone, labelKey: "mobile_nav.news" },
            { href: "/judge#help", icon: HelpCircle, labelKey: "mobile_nav.help" },
          ]}
        />
      </div>
    </div>
  );
}

