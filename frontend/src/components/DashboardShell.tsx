 "use client";

import { useState, useRef, useEffect } from "react";
import { useActiveEvent } from "@/contexts/ActiveEventContext";
import { eventPhaseOf, phaseLabelKey } from "@/lib/eventPhase";
import { isLivePhase, phaseTone } from "@/lib/eventOverview";
import { Badge } from "@/components/ds/primitives";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ApiError, apiGet } from "@/lib/api";
import { redirectPathForRole } from "@/lib/roleRedirect";
import {
  Megaphone,
  Settings,
  X,
  Menu,
  ChevronDown,
  LogOut,
  Sun,
  Moon,
  Plus,
  Pencil,
  Lock,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useTranslation } from "@/contexts/LanguageContext";
import { NotificationsBell } from "@/components/NotificationsBell";
import { ShellNotices } from "@/components/notices/ShellNotices";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { EventCreatorChatbot } from "@/components/EventCreatorChatbot";
import { GlobalSearch } from "@/components/GlobalSearch";
import { adminSidebarGroups, adminSidebarHome, sidebarPageFor, type SidebarMenuItem } from "@/lib/sidebarMenu";
import { WorkspaceSwitchLink } from "@/components/WorkspaceSwitch";
import { useEventModulesState } from "@/lib/eventModules";
import { clearWorkspace } from "@/lib/workspaces";

/* ── Menu items ───────────────────────────────── */
// Shared with GlobalSearch (lib/sidebarMenu) so the ⌘K palette is always in
// lock-step with the rendered sidebar.

/* ══════════════════════════════════════════════════
   Dashboard Shell — single client component that
   owns the sidebar toggle state + renders nav/sidebar
   ══════════════════════════════════════════════════ */
/** Roles allowed to render the admin/event-creator dashboard shell. */
const ADMIN_SHELL_ROLES = new Set(["superadmin", "admin", "org_admin"]);

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const target = `${name}=`;
  const parts = document.cookie.split(";");
  for (const raw of parts) {
    const c = raw.trim();
    if (c.startsWith(target)) {
      try {
        return decodeURIComponent(c.slice(target.length));
      } catch {
        return c.slice(target.length);
      }
    }
  }
  return "";
}

/** One sidebar entry: current, locked by the plan, or plain. */
function NavLink({ item, href, active, isLocked, onNavigate, t }: {
  item: SidebarMenuItem; href: string; active: boolean; isLocked: boolean; onNavigate: () => void; t: (k: string) => string;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={href}
      title={isLocked ? t("modules.nav_locked") : undefined}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14.5px] lg:py-1.5 font-medium transition-all duration-200 cursor-pointer hover:translate-x-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E1003C]/60 ${
        active ? "bg-[#E1003C]/15 text-[#E1003C]" : "theme-text-muted hover:opacity-100"
      }`}
    >
      <Icon size={18} aria-hidden="true" className={`shrink-0 transition-colors ${active ? "text-[#E1003C]" : "theme-text-muted group-hover:opacity-100"}`} />
      <span className={isLocked ? "opacity-60" : undefined}>{t(item.labelKey)}</span>
      {isLocked ? (
        <Lock size={14} className="ml-auto shrink-0 opacity-60" aria-label={t("modules.nav_locked")} />
      ) : active ? (
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#E1003C]" aria-hidden="true" />
      ) : null}
    </Link>
  );
}

/**
 * `basePath` mounts the whole shell under a prefix. The signed-in console
 * passes nothing and behaves exactly as before; the public walkthrough passes
 * "/demo" so every nav link stays inside the walkthrough instead of landing on
 * an auth-guarded route and bouncing the visitor to the login page.
 *
 * `demo` additionally swaps the affordances that assume a session — creating
 * an event, editing it, signing out — for a way back to the marketing site.
 */
export function DashboardShell({
  children,
  basePath = "",
  demo = false,
}: {
  children: React.ReactNode;
  basePath?: string;
  demo?: boolean;
}) {
  const withBase = (href: string) =>
    basePath ? `${basePath}${href === "/" ? "" : href}` || "/" : href;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const {
    events,
    primaryEvent,
    setActiveEventId,
    loading: eventLoading,
  } = useActiveEvent();
  const [eventMenuOpen, setEventMenuOpen] = useState(false);
  const eventMenuRef = useRef<HTMLDivElement>(null);
  // The walkthrough has every module; only a real event is asked.
  const { modules, ready: modulesReady } = useEventModulesState(primaryEvent?.id, !demo);
  const locked = (module?: string) => Boolean(module && modules && !modules.has(module));
  // The page an address belongs to (for its plan module) and the sidebar
  // entry marked current: the big screen belongs to Results, elimination to Teams.
  const { page: currentItem, current: currentHref } = sidebarPageFor(pathname, basePath);
  const pageLocked = locked(currentItem?.module);
  // A page that belongs to a module waits for the answer, so it does not
  // fire requests the API is about to refuse.
  const pageWaiting = Boolean(currentItem?.module) && !modulesReady;

  // ── Client-side role safety net ──────────────────────────────
  // SSR layout already guards this route group, but on flaky mobile
  // networks the SSR /me check can fall back to the "network" path
  // and let a non-admin through. Re-check role on the client and
  // bounce judges/mentors/hackers to their own portals so they never
  // see the full admin sidebar (problem: judge/mentor sees admin
  // panel on mobile).
  const [roleChecked, setRoleChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;

    const cookieRole = String(readCookie("hh_role") ?? "")
      .trim()
      .toLowerCase();
    if (cookieRole && !ADMIN_SHELL_ROLES.has(cookieRole)) {
      router.replace(redirectPathForRole(cookieRole));
      return;
    }

    // Only a real "signed out" answer (401/403) sends someone to /login. A
    // throttled (429), failing (5xx) or unreachable API is asked again a few
    // times instead — logging people out because the auth limiter was busy
    // lost their place mid-event.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = (attempt: number) => {
      apiGet<{ role?: string }>("/api/auth/me")
        .then((me) => {
          if (cancelled) return;
          const r = String(me?.role ?? "").trim().toLowerCase();
          if (r && !ADMIN_SHELL_ROLES.has(r)) {
            router.replace(redirectPathForRole(r));
            return;
          }
          setRoleChecked(true);
        })
        .catch((err) => {
          if (cancelled) return;
          const status = err instanceof ApiError ? err.status : 0;
          if (status === 401 || status === 403) {
            router.replace("/login");
            return;
          }
          if (attempt < 3) {
            timer = setTimeout(() => check(attempt + 1), 1500 * 2 ** attempt);
            return;
          }
          // Still no answer: with a trusted admin cookie, carry on (every API
          // call is checked server-side anyway); without one, the session
          // cannot be confirmed, so sign in again.
          if (!cookieRole) {
            router.replace("/login");
            return;
          }
          setRoleChecked(true);
        });
    };
    check(0);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [router]);

  useEffect(() => {
    if (!eventMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (eventMenuRef.current?.contains(e.target as Node)) return;
      setEventMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [eventMenuOpen]);
  // One word per phase, the same as the event home's (see lib/eventPhase).
  const phase = eventPhaseOf(primaryEvent);
  const phaseLabel = phase ? t(phaseLabelKey(phase)) : "";

  const eventDisplayName =
    primaryEvent?.name?.trim() ||
    primaryEvent?.event_code?.trim() ||
    "";
  const eventSubtitle =
    primaryEvent?.name?.trim() && primaryEvent?.event_code
      ? primaryEvent.event_code
      : null;

  const logout = async () => {
    try { await fetch("/api/auth/logout", { method: "POST", credentials: "include" }); } catch { /* ignore */ }
    document.cookie = "hh_role=; Path=/; Max-Age=0; SameSite=Lax";
    document.cookie = "hh_email=; Path=/; Max-Age=0; SameSite=Lax";
    clearWorkspace();
    router.replace("/login");
  };

  // While the client-side role check is in flight, don't flash the admin
  // sidebar to a non-admin user. Show a tiny placeholder instead so the
  // judge/mentor never sees admin nav (even for a frame) before the
  // redirect fires.
  if (!roleChecked) {
    return (
      <div className="theme-bg-page flex h-[100dvh] items-center justify-center">
        <div className="theme-text-muted text-[15px] opacity-60">…</div>
      </div>
    );
  }

  return (
    <div className="theme-bg-page flex h-[100dvh] flex-col overflow-hidden">
      {/* ── Top Navigation Bar ─────────────────── */}
      <header className="theme-bg-page theme-text theme-border relative z-50 flex h-[60px] shrink-0 items-center justify-between gap-2 border-b px-3 sm:h-[70px] sm:gap-3 sm:px-4 lg:px-6">
        {/* Left */}
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="theme-text-muted tap shrink-0 rounded-lg p-2 opacity-80 hover:opacity-100 lg:hidden"
            aria-label={t("nav.menu")}
            aria-expanded={sidebarOpen}
          >
            <Menu size={22} />
          </button>

          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Image
              src="/logo.svg"
              alt="HackOS logo"
              width={36}
              height={36}
              className="h-8 w-8 rounded-lg object-contain bg-white/5 sm:h-9 sm:w-9"
              priority
            />
            <div className="hidden min-w-0 sm:block">
              <h1 className="theme-text truncate text-[15px] font-semibold leading-tight">
                {eventDisplayName ? eventDisplayName : t("shell.app_title")}
              </h1>
              <p className="theme-text-muted truncate text-[12px]">
                {eventSubtitle ?? t("shell.app_subtitle")}
              </p>
            </div>
          </div>

          {!eventLoading && phase ? (
            // Laptops and wider: on tablets and phones the phase rides on the
            // event switcher as a dot (and in its menu), so nothing overlaps.
            <span className="ml-1 hidden shrink-0 lg:inline-flex">
              <Badge tone={phaseTone(phase)} dot={isLivePhase(phase)} className="text-[12px]">
                {phaseLabel}
              </Badge>
            </span>
          ) : null}
        </div>

        {/* Right */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <GlobalSearch compact />
          <div className="hidden sm:block">
            <LanguageSwitcher compact />
          </div>
          <button
            onClick={toggleTheme}
            className="theme-text-muted tap hidden rounded-lg p-2 opacity-70 transition-colors hover:opacity-100 sm:inline-flex"
            title={theme === "dark" ? t("shell.theme_light") : t("shell.theme_dark")}
            aria-label={theme === "dark" ? t("shell.theme_light") : t("shell.theme_dark")}
          >
            {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <NotificationsBell />

          {events.length > 0 ? (
            <div className="relative hidden sm:block" ref={eventMenuRef}>
              <button
                type="button"
                onClick={() => setEventMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={eventMenuOpen}
                className="theme-text flex max-w-[9.5rem] items-center gap-2 truncate rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2 text-[14px] font-medium transition-colors hover:bg-white/[0.08] xl:max-w-[14rem] xl:px-4 xl:text-[15px]"
                title={phaseLabel ? `${t("shell.switch_event")} · ${phaseLabel}` : t("shell.switch_event")}
              >
                {phase ? (
                  <span className="lg:hidden" aria-hidden="true">
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: `var(--${phaseTone(phase) === "neutral" ? "ink-3" : phaseTone(phase) === "brand" ? "accent" : phaseTone(phase)})` }} />
                  </span>
                ) : null}
                <span className="truncate">
                  {eventDisplayName || t("shell.app_title")}
                </span>
                {phaseLabel ? <span className="sr-only lg:hidden">{` · ${phaseLabel}`}</span> : null}
                <ChevronDown size={16} className="shrink-0 opacity-60" />
              </button>
              {eventMenuOpen && (
                <div className="theme-bg-card theme-border absolute right-0 top-full z-[60] mt-1 min-w-[240px] max-w-[90vw] rounded-xl border py-1 shadow-xl">
                  {phase ? (
                    <div className="flex items-center gap-2 px-3 pb-1 pt-2.5 lg:hidden">
                      <span className="theme-text-muted text-[11px] font-semibold uppercase tracking-wide">{t("shell.phase_now")}</span>
                      <Badge tone={phaseTone(phase)} dot={isLivePhase(phase)}>{phaseLabel}</Badge>
                    </div>
                  ) : null}
                  <p className="theme-text-muted px-3 py-2 text-[11px] font-semibold uppercase tracking-wide">
                    {t("shell.your_events")}
                  </p>
                  <div className="max-h-[min(50vh,22rem)] overflow-y-auto">
                  {events.map((e) => {
                    const label =
                      e.name?.trim() || e.event_code?.trim() || `#${e.id}`;
                    const selected = primaryEvent?.id === e.id;
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => {
                          setActiveEventId(e.id);
                          setEventMenuOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[15px] ${
                          selected
                            ? "bg-[#E1003C]/15 text-[#E1003C]"
                            : "theme-text hover:bg-white/5"
                        }`}
                      >
                        <span className="truncate">{label}</span>
                      </button>
                    );
                  })}
                  </div>
                  {!demo && <div className="theme-border my-1 border-t" />}
                  {!demo && (
                  <Link
                    href="/create-event?new=1"
                    className="flex items-center gap-2 px-3 py-2 text-[15px] text-[#E1003C] hover:bg-white/5"
                    onClick={() => setEventMenuOpen(false)}
                  >
                    <Plus size={16} />
                    {t("shell.new_event")}
                  </Link>
                  )}
                  {!demo && (
                  <Link
                    href="/edit-event"
                    className="theme-text flex items-center gap-2 px-3 py-2 text-[15px] hover:bg-white/5"
                    onClick={() => setEventMenuOpen(false)}
                  >
                    <Pencil size={16} />
                    {t("shell.edit_event")}
                  </Link>
                  )}
                  <Link
                    href={withBase("/settings")}
                    className="theme-text-muted flex items-center gap-2 px-3 py-2 text-[15px] hover:bg-white/5"
                    onClick={() => setEventMenuOpen(false)}
                  >
                    <Settings size={16} />
                    {t("shell.manage_event")}
                  </Link>
                  {!demo && (
                    <WorkspaceSwitchLink
                      iconSize={16}
                      onClick={() => setEventMenuOpen(false)}
                      className="theme-text-muted flex items-center gap-2 px-3 py-2 text-[15px] hover:bg-white/5 xl:hidden"
                    />
                  )}
                </div>
              )}
            </div>
          ) : !eventLoading ? (
            <Link
              href="/create-event"
              className="hidden items-center gap-2 rounded-lg bg-[#E1003C] px-4 py-2 text-[15px] font-medium text-white transition-colors hover:bg-[#C00035] sm:inline-flex"
            >
              <Plus size={16} />
              {t("shell.create_event")}
            </Link>
          ) : null}
          <Link
            href={withBase("/announcements")}
            aria-label={t("shell.announcements")}
            title={t("shell.announcements")}
            className="theme-text hidden items-center gap-2 rounded-lg border border-white/20 p-2 text-[15px] font-medium transition-colors hover:bg-white/5 sm:inline-flex xl:px-4"
          >
            <Megaphone size={16} />
            <span className="hidden xl:inline">{t("shell.announcements")}</span>
          </Link>

          {demo ? (
            <Link
              href="/"
              className="theme-text-muted theme-border hidden cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[15px] font-medium transition-colors hover:opacity-100 sm:inline-flex"
            >
              <LogOut size={16} />
              Back to hack-os.app
            </Link>
          ) : (
            <>
              <WorkspaceSwitchLink
                iconSize={16}
                className="theme-text-muted theme-border hidden items-center gap-2 rounded-lg border px-3 py-2 text-[15px] font-medium transition-colors hover:opacity-100 xl:inline-flex"
              />
              <button
                type="button"
                onClick={logout}
                className="theme-text-muted theme-border hidden cursor-pointer items-center gap-2 rounded-lg border p-2 text-[15px] font-medium transition-colors hover:opacity-100 sm:inline-flex xl:px-3"
                title={t("shell.logout")}
                aria-label={t("shell.logout")}
              >
                <LogOut size={16} />
                <span className="hidden xl:inline">{t("shell.logout")}</span>
              </button>
            </>
          )}
        </div>
      </header>

      {/* ── Body ───────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="hh-shell-overlay-in fixed inset-0 z-30 bg-black/60 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={`
            theme-bg-card theme-border theme-text fixed inset-y-0 left-0 z-40 mt-[60px] flex w-[85vw] max-w-[280px] shrink-0 flex-col border-r
            transition-transform duration-300 sm:mt-[70px] sm:w-[260px]
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
            lg:relative lg:mt-0 lg:translate-x-0
          `}
        >
          {/* Close (mobile) */}
          <div className="flex items-center justify-end p-3 lg:hidden">
            <button
              onClick={() => setSidebarOpen(false)}
              className="theme-text-muted rounded-lg p-1.5 opacity-60 hover:opacity-100"
              aria-label={t("Close")}
            >
              <X size={20} />
            </button>
          </div>

          {/* Nav links, grouped by where the event is (as the builder groups its sections) */}
          <nav aria-label={t("nav.menu")} className="flex-1 overflow-y-auto px-3 py-3">
            <NavLink item={adminSidebarHome} href={withBase(adminSidebarHome.href)} active={currentHref === "/"} isLocked={false} onNavigate={() => setSidebarOpen(false)} t={t} />
            {adminSidebarGroups.map((g) => (
              <div key={g.key} className="mt-2.5" role="group" aria-labelledby={`nav-group-${g.key}`}>
                <p id={`nav-group-${g.key}`} className="theme-text-muted px-3 pb-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] opacity-70">
                  {t(g.labelKey)}
                </p>
                <ul className="space-y-0.5">
                  {g.items.map((item) => (
                    <li key={item.href}><NavLink item={item} href={withBase(item.href)} active={currentHref === item.href} isLocked={locked(item.module)} onNavigate={() => setSidebarOpen(false)} t={t} /></li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          {events.length > 0 && (
            <div className="theme-border border-t px-3 py-3 lg:hidden">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label htmlFor="shell-event-pick" className="theme-text-muted block text-[11px] font-semibold uppercase tracking-wide">
                  {t("shell.switch_event")}
                </label>
                {phase ? <Badge tone={phaseTone(phase)} dot={isLivePhase(phase)}>{phaseLabel}</Badge> : null}
              </div>
              <select
                id="shell-event-pick"
                value={primaryEvent?.id ?? ""}
                onChange={(e) => setActiveEventId(Number(e.target.value))}
                className="theme-bg-card theme-border theme-text w-full rounded-lg border px-2 py-2 text-[15px]"
              >
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name?.trim() || e.event_code?.trim() || `#${e.id}`}
                  </option>
                ))}
              </select>
              {!demo && (
                <Link
                  href="/create-event?new=1"
                  className="mt-2 flex items-center gap-1.5 text-[13px] font-medium text-[#E1003C]"
                >
                  <Plus size={14} />
                  {t("shell.new_event")}
                </Link>
              )}
            </div>
          )}

          {/*
           * Problem 10: on phones the header-level logout is hidden
           * (`sm:inline-flex`), leaving the admin with no way out.
           * Mirror the staff shells and expose a drawer-level button.
           */}
          <div className="theme-border flex flex-col gap-2 border-t p-3 lg:hidden">
            {demo ? null : (
              <WorkspaceSwitchLink
                onClick={() => setSidebarOpen(false)}
                className="theme-text-muted theme-border flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[15px] font-medium transition-colors hover:opacity-100"
              />
            )}
            {demo ? (
              <Link
                href="/"
                className="theme-text-muted theme-border flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[15px] font-medium transition-colors hover:opacity-100"
              >
                <LogOut size={14} />
                Back to hack-os.app
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSidebarOpen(false);
                  void logout();
                }}
                className="theme-text-muted theme-border flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[15px] font-medium transition-colors hover:opacity-100"
              >
                <LogOut size={14} />
                {t("shell.logout")}
              </button>
            )}
          </div>

          <div className="theme-border theme-text-muted flex items-center gap-2 border-t px-4 py-3">
            <Image
              src="/logo.svg"
              alt="HackOS logo"
              width={20}
              height={20}
              className="rounded-md object-contain bg-white/5"
            />
            <p className="theme-text-muted text-[12px] opacity-50">
              {t("shell.version")}
            </p>
          </div>
        </aside>

        {/* Main content */}
        <main className="theme-bg-page theme-text relative z-10 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-4 pb-24 md:p-6 md:pb-24 lg:p-8">
          <div
            key={`${pathname}-${primaryEvent?.id ?? "none"}`}
            className="hh-page-enter min-h-full"
          >
            <ShellNotices />
            {pageWaiting ? (
              <div className="mx-auto mt-10 h-40 max-w-lg animate-pulse rounded-2xl theme-border border" style={{ background: "var(--app-surface)" }} />
            ) : pageLocked ? (
              <div className="mx-auto mt-10 max-w-lg rounded-2xl border p-7 text-center theme-border" style={{ background: "var(--app-surface)" }}>
                <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: "rgba(225,0,60,0.12)", color: "#E1003C" }}>
                  <Lock size={20} />
                </span>
                <h2 className="mt-4 text-lg font-semibold theme-text">{t("modules.locked_title")}</h2>
                <p className="mt-2 text-sm leading-relaxed theme-text-muted">{t("modules.locked_body")}</p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <a href="/pricing" className="inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold text-white" style={{ background: "#E1003C" }}>
                    {t("modules.upgrade")}
                  </a>
                  <a href="/contact" className="inline-flex h-10 items-center rounded-xl border px-4 text-sm font-medium theme-border theme-text">
                    {t("modules.contact")}
                  </a>
                </div>
              </div>
            ) : (
              children
            )}
          </div>
        </main>
      </div>

      <EventCreatorChatbot />
    </div>
  );
}
