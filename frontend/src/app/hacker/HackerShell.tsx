"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BookOpen,
  FolderGit2,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessageSquareHeart,
  MessagesSquare,
  Send,
  Trophy,
  User,
  Users,
  UsersRound,
  X,
  Sun,
  Moon,
  Clock,
  ShieldCheck,
  History,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { NotificationsBell } from "@/components/NotificationsBell";
import { ShellNotices } from "@/components/notices/ShellNotices";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { TelegramLinkButton } from "@/components/TelegramLinkButton";
import { useTranslation } from "@/contexts/LanguageContext";
import { RoleShellGuard } from "@/components/RoleShellGuard";
import { WorkspaceSwitchLink } from "@/components/WorkspaceSwitch";
import { useEventModules } from "@/lib/eventModules";
import { teamFormationOpen } from "@/lib/eventPhase";
import { clearWorkspace } from "@/lib/workspaces";
import { MobileBottomNav } from "@/components/MobileBottomNav";

const menu = [
  { labelKey: "nav.hacker_dashboard", href: "/hacker", icon: LayoutDashboard },
  { labelKey: "nav.my_team", href: "/hacker/team", icon: Users },
  { labelKey: "hacker.nav.team_lobby", href: "/hacker/lobby", icon: UsersRound },
  { labelKey: "hacker.nav.submit_project", href: "/hacker/submit", icon: Send },
  { labelKey: "nav.results", href: "/hacker/results", icon: Trophy },
  { labelKey: "pf.nav", href: "/hacker/hackathons", icon: History },
  { labelKey: "nav.help_queue", href: "/hacker/help", icon: HelpCircle, module: "mentors" },
  { labelKey: "nav.chat", href: "/hacker/chat", icon: MessagesSquare, module: "chat" },
  { labelKey: "nav.announcements", href: "/hacker/announcements", icon: Megaphone },
  { labelKey: "nav.resources", href: "/hacker/resources", icon: BookOpen, module: "resources" },
  { labelKey: "nav.feedback", href: "/hacker/feedback", icon: MessageSquareHeart },
  { labelKey: "nav.profile", href: "/hacker/profile", icon: User },
];

export default function HackerShell({
  children,
  initialStatus = "approved",
}: {
  children: React.ReactNode;
  /** The status the server saw (layout.tsx), so the first paint matches it. */
  initialStatus?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const [status, setStatus] = useState(initialStatus);

  /*
   * Always re-fetch the current status on mount. Cookie is a nice
   * first-paint optimisation but it can lag behind reality — e.g.
   * admin eliminates a team mid-session (problem 11), the middleware
   * starts redirecting API/page requests, but the client still shows
   * the old "approved" navigation. Refreshing status from the backend
   * on every page load keeps the shell honest.
   */
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((user) => {
        const payload =
          user && typeof user === "object" && "data" in user
            ? (user as { data?: unknown }).data
            : user;
        const next =
          payload && typeof payload === "object" && "status" in payload
            ? String(
                (payload as { status?: unknown }).status ?? "",
              ).toLowerCase()
            : "";
        if (next && next !== status) {
          setStatus(next);
          document.cookie = `hh_status=${encodeURIComponent(next)}; Path=/; Max-Age=${14 * 24 * 60 * 60}; SameSite=Lax`;
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * Problem 11: once the admin eliminates a team we also don't want
   * the eliminated hacker to click around the sidebar — every link
   * would immediately bounce them back to /hacker/eliminated via the
   * middleware, which looks buggy. Empty the menu so the shell just
   * shows the logo + logout + the eliminated page content.
   */
  // The event chosen in the workspace picker decides which modules exist;
  // a feature its plan does not include is not offered.
  const [eventId, setEventId] = useState<number | null>(null);
  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )hh_event=(\d+)/);
    if (m) setEventId(Number(m[1]));
  }, []);
  const modules = useEventModules(eventId);
  // Once teams can no longer form or change, "Find a team" has nothing to offer.
  const [formationOpen, setFormationOpen] = useState(true);
  useEffect(() => {
    let live = true;
    fetch("/api/events/active", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        const ev = json && typeof json === "object" && "data" in json ? (json as { data?: Record<string, unknown> }).data : null;
        if (live && ev) setFormationOpen(teamFormationOpen(ev as Parameters<typeof teamFormationOpen>[0]));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [eventId]);
  const offered = menu.filter((m) => !("module" in m && m.module && modules && !modules.has(m.module)))
    .filter((m) => formationOpen || m.href !== "/hacker/lobby");
  // Someone still waiting (for review or on the waiting list) reaches only
  // the chat, for their thread with the organisers (middleware.ts).
  const waiting = status === "pending" || status === "waitlisted";
  const visibleMenu =
    status === "eliminated"
      ? []
      : waiting
        ? offered.filter((m) => m.href === "/hacker/chat")
        : offered;
  const isEliminated = status === "eliminated";

  const logout = async () => {
    try { await fetch("/api/auth/logout", { method: "POST", credentials: "include" }); } catch { /* ignore */ }
    document.cookie = "hh_role=; Path=/; Max-Age=0; SameSite=Lax";
    document.cookie = "hh_email=; Path=/; Max-Age=0; SameSite=Lax";
    clearWorkspace();
    router.replace("/login");
  };

  return (
    <div className="theme-bg-page flex h-[100dvh] flex-col overflow-hidden">
      <RoleShellGuard prefix="/hacker" />
      {/* Top bar */}
      <header className="theme-bg-page theme-text theme-border relative z-50 flex h-[56px] shrink-0 items-center justify-between gap-2 border-b px-3 sm:h-[64px] sm:px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="theme-text-muted tap rounded-lg p-2 opacity-80 hover:opacity-100 lg:hidden"
            aria-label={t("shell.toggle_menu")}
          >
            <Menu size={20} />
          </button>
          <Image
            src="/logo.svg"
            alt={t("shell.logo_alt")}
            width={32}
            height={32}
            className="h-7 w-7 shrink-0 rounded-lg bg-white/5 object-contain sm:h-8 sm:w-8"
          />
          {/* The event's real phase and the person's stage are on the dashboard
              itself; a fixed "Hacking" badge here said so in every phase. */}
          <h1 className="theme-text flex min-w-0 items-center gap-2 text-[15px] font-semibold">
            <span className="truncate">{t("shell.app_title")}</span>
          </h1>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <div className="hidden sm:block">
            <LanguageSwitcher />
          </div>
          <button
            onClick={toggleTheme}
            className="theme-text-muted tap hidden rounded-lg p-2 opacity-70 transition-colors hover:opacity-100 sm:inline-flex"
            title={theme === "dark" ? t("shell.theme_light") : t("shell.theme_dark")}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <div className="hidden sm:block">
            <TelegramLinkButton title={t("hacker.telegram_title")} />
          </div>
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
          <div className="theme-border flex items-center justify-between border-b px-4 py-3 lg:justify-start">
            <div className="flex items-center gap-2">
              <FolderGit2 size={14} className="text-[#E1003C]" />
              <p className="theme-text-muted text-[12px] font-semibold uppercase tracking-wide opacity-70">
                {t("hacker.menu_title")}
              </p>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="theme-text-muted rounded-lg p-1 opacity-60 hover:opacity-100 lg:hidden"
            >
              <X size={16} />
            </button>
          </div>

          <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
            {visibleMenu.map(({ labelKey, href, icon: Icon }) => {
              const active =
                href === "/hacker"
                  ? pathname === "/hacker"
                  : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setSidebarOpen(false)}
                  className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all ${active
                      ? "bg-[#E1003C]/15 theme-text"
                      : "theme-text-muted hover:opacity-100"
                    }`}
                >
                  {active && (
                    <span className="absolute bottom-2 left-0 top-2 w-1 rounded-r-full bg-[#E1003C]" />
                  )}
                  <Icon
                    size={17}
                    className={
                      active
                        ? "text-[#E1003C]"
                        : "theme-text-muted group-hover:opacity-100"
                    }
                  />
                  {t(labelKey)}
                </Link>
              );
            })}
          </nav>

          {/*
           * Problem 10: the header logout is `hidden sm:inline-flex`, so
           * on phones hackers had no way to sign out. Expose the same
           * action at the bottom of the drawer on mobile.
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

          <div className="theme-border theme-text-muted border-t p-4 text-[12px] opacity-50">
            {t("hacker.footer_tag")}
          </div>
        </aside>

        {/* Main */}
        <main className="theme-bg-page theme-text has-mobile-nav min-w-0 flex-1 overflow-y-auto overflow-x-hidden shell-gutter py-3 pl-safe pr-safe sm:py-4 md:py-6 lg:py-8 lg:pb-8">
          <div
            key={pathname}
            className="animate-fade-in mx-auto min-h-full min-w-0 w-full max-w-5xl"
          >
            <ShellNotices />
            {/*
             * Problem 11: when the user is eliminated the route is
             * locked to /hacker/eliminated by the middleware, so just
             * render whatever that page returns — no pending/profile
             * fallback treatment.
             */}
            {waiting && pathname === "/hacker/chat" ? (
              <div className="mb-4 rounded-[var(--radius-sm,8px)] border border-[#FFC107]/30 bg-[#FFC107]/10 px-4 py-3 text-[13px] leading-relaxed text-[var(--app-warn)]" role="status">
                {t("hacker.pending.chat_notice")}
              </div>
            ) : null}
            {isEliminated ? (
              children
            ) : status === "pending" && pathname !== "/hacker/profile" && pathname !== "/hacker/chat" ? (
              <div className="flex min-h-[60vh] flex-col items-center justify-center text-center px-4">
                <div className="relative">
                  <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#FFC107]/15">
                    <Clock size={36} className="text-[var(--app-warn)]" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--app-surface)] ring-2 ring-[#FFC107]/30">
                    <ShieldCheck size={16} className="text-[var(--app-warn)]" />
                  </div>
                </div>

                <h2 className="mt-6 text-xl font-bold text-white">
                  {t("hacker.pending.title")}
                </h2>
                <p className="mt-2 max-w-md text-[15px] leading-relaxed text-[var(--app-muted)]">
                  {t("hacker.pending.description")}
                </p>

                <div className="mt-6 flex items-center gap-2 rounded-full bg-[#FFC107]/10 px-4 py-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[#FFC107]" />
                  <span className="text-[13px] font-medium text-[var(--app-warn)]">
                    {t("hacker.pending.badge")}
                  </span>
                </div>

                <div className="mt-8 space-y-2 rounded-xl border border-white/5 bg-white/[0.02] p-4 max-w-sm w-full">
                  <p className="text-[12px] text-[var(--app-muted-2)]">
                    {t("hacker.pending.meanwhile")}
                  </p>
                  <ul className="space-y-1.5 text-left text-[13px] text-[var(--app-muted)]">
                    <li className="flex items-center gap-2">
                      <span className="h-1 w-1 rounded-full bg-[#b3b3b3]" />
                      {t("hacker.pending.tip_profile")}
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="h-1 w-1 rounded-full bg-[#b3b3b3]" />
                      {t("hacker.pending.tip_email")}
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="h-1 w-1 rounded-full bg-[#b3b3b3]" />
                      {t("hacker.pending.tip_admin")}
                    </li>
                  </ul>
                </div>
              </div>
            ) : (
              children
            )}
          </div>
        </main>

        {/* Mobile Bottom Navigation */}
        <MobileBottomNav
          basePath="/hacker"
          items={[
            { href: "/hacker", icon: LayoutDashboard, labelKey: "mobile_nav.dashboard" },
            { href: "/hacker/team", icon: Users, labelKey: "mobile_nav.team" },
            formationOpen
              ? { href: "/hacker/lobby", icon: UsersRound, labelKey: "mobile_nav.lobby" }
              : { href: "/hacker/results", icon: Trophy, labelKey: "mobile_nav.results" },
            { href: "/hacker/submit", icon: Send, labelKey: "mobile_nav.submit" },
            { href: "/hacker/profile", icon: User, labelKey: "mobile_nav.profile" },
          ]}
        />
      </div>
    </div>
  );
}
