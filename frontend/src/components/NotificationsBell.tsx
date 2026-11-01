"use client";

/**
 * The bell: what happened that the signed-in person should know about —
 * announcements, their registration, team requests, help requests, replies
 * in their chat threads, results and certificates — from the server
 * (GET /api/me/notifications), across every event they are part of.
 *
 * The badge polls the unread count once a minute while the tab is visible;
 * opening the bell fetches the list. A row opens the screen it is about for
 * the reader's role in that event, entering that event's workspace first
 * when it is not the one on screen.
 *
 * This replaced a bell that assembled itself in the browser (announcements
 * of the event on screen, and escalated tickets for organisers by polling
 * the help queue): it saw one event at a time and nothing else.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, Award, Bell, CheckCheck, HelpCircle, Info, Scale, Loader2, Megaphone, MessagesSquare, RefreshCw, Trophy, UserCheck, Users,
  Webhook, type LucideIcon,
} from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { apiGet, apiPost, isDemoApiEnabled } from "@/lib/api";
import { readActiveEventIdFromStorage } from "@/lib/activeEventStorage";
import { useDemoBasePath } from "@/lib/demoPath";
import { fill } from "@/lib/i18n/fill";
import {
  badgeText, describe, groupOf, normalizeList, normalizeUnread, pathFor, roleFor,
  type AppNotification, type NotificationGroup, type NotificationList,
} from "@/lib/notifications";
import { formatRelativeTime } from "@/lib/relativeTime";
import { enterEventWorkspace, enteredEventId } from "@/lib/workspaces";

const POLL_MS = 60_000;

const GROUP_ICON: Record<NotificationGroup, LucideIcon> = {
  announcement: Megaphone,
  registration: UserCheck,
  team: Users,
  help: HelpCircle,
  chat: MessagesSquare,
  judging: Scale,
  results: Trophy,
  certificate: Award,
  webhooks: Webhook,
  other: Info,
};

/** The organiser pages the walkthrough has (it re-exports the console under /demo). */
const DEMO_PAGES = new Set(["/", "/announcements", "/help-queue", "/results", "/certificates", "/chat"]);

export function NotificationsBell() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const demoBase = useDemoBasePath();
  const panelId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [list, setList] = useState<NotificationList | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const [busyId, setBusyId] = useState<number | null>(null);

  /* The badge: once now, then every minute while the tab is in front. */
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      apiGet<unknown>("/api/me/notifications/unread")
        .then((raw) => { if (!cancelled) setUnread(normalizeUnread(raw).unread); })
        .catch(() => { /* the badge stays as it was; the next tick tries again */ });
    };
    tick();
    const timer = window.setInterval(tick, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  /* Closes on a click outside and on Escape. */
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const next = normalizeList(await apiGet<unknown>("/api/me/notifications?limit=30"));
      setList(next);
      setUnread(next.unread);
      setState("idle");
    } catch {
      setState("failed");
    }
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void load();
  };

  const markLocally = (ids: number[] | "all") => {
    setList((l) => {
      if (!l) return l;
      const items = l.items.map((x) => (ids === "all" || ids.includes(x.id) ? { ...x, read: true } : x));
      return { ...l, items, unread: items.filter((x) => !x.read).length };
    });
    setUnread((u) => (ids === "all" ? 0 : Math.max(0, u - ids.length)));
  };

  const markAll = async () => {
    markLocally("all");
    // The walkthrough writes nothing.
    if (!isDemoApiEnabled()) await apiPost("/api/me/notifications/read", { all: true }).catch(() => {});
  };

  const openItem = async (n: AppNotification) => {
    if (busyId != null) return;
    const role = list ? roleFor(list, n) : null;
    const path = pathFor(n, role);
    if (isDemoApiEnabled()) {
      markLocally([n.id]);
      setOpen(false);
      if (DEMO_PAGES.has(path)) router.push(path === "/" ? demoBase || "/" : `${demoBase}${path}`);
      return;
    }
    setBusyId(n.id);
    try {
      if (!n.read) {
        markLocally([n.id]);
        await apiPost("/api/me/notifications/read", { ids: [n.id] }).catch(() => {});
      }
      setOpen(false);
      // Another event than the one on screen: enter its workspace first, so
      // the page opens on that event and with the role it has there.
      const current = enteredEventId() ?? readActiveEventIdFromStorage();
      if (n.eventId != null && role && n.eventId !== current) {
        await enterEventWorkspace(n.eventId);
        window.location.assign(path);
        return;
      }
      router.push(path);
    } finally {
      setBusyId(null);
    }
  };

  const badge = badgeText(unread);
  const items = list?.items ?? [];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={unread > 0 ? fill(t("nt.unread_aria"), { n: unread }) : t("nt.title")}
        title={t("nt.title")}
        className="theme-text-muted relative rounded-lg p-2 opacity-70 transition-colors hover:opacity-100"
      >
        <Bell size={20} aria-hidden="true" />
        {badge ? (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9.5px] font-bold leading-none text-white"
            style={{ background: "var(--accent-solid)" }}
          >
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={t("nt.title")}
          className="absolute right-0 top-full z-50 mt-1 flex max-h-[min(32rem,calc(100dvh-5rem))] w-[min(23rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[var(--radius)] border shadow-xl"
          style={{ background: "var(--surface)", borderColor: "var(--line)", color: "var(--ink)" }}
        >
          <div className="flex items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: "var(--line)" }}>
            <p className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>{t("nt.title")}</p>
            {items.some((x) => !x.read) ? (
              <button
                type="button"
                onClick={() => void markAll()}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-medium transition-colors hover:bg-[var(--tint)]"
                style={{ color: "var(--accent)" }}
              >
                <CheckCheck size={14} aria-hidden="true" /> {t("nt.mark_all")}
              </button>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5" aria-live="polite">
            {state === "loading" && !list ? (
              <p role="status" className="flex items-center justify-center gap-2 py-8 text-[13px]" style={{ color: "var(--ink-3)" }}>
                <Loader2 size={15} className="animate-spin" aria-hidden="true" /> {t("nt.loading")}
              </p>
            ) : state === "failed" && !list ? (
              <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
                <p className="flex items-center gap-1.5 text-[13px]" style={{ color: "var(--ink-2)" }}>
                  <AlertTriangle size={14} aria-hidden="true" style={{ color: "var(--warn)" }} /> {t("nt.load_failed")}
                </p>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 py-1.5 text-[12.5px] font-medium"
                  style={{ borderColor: "var(--line-strong)", color: "var(--ink)" }}
                >
                  <RefreshCw size={13} aria-hidden="true" /> {t("nt.retry")}
                </button>
              </div>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px]" style={{ color: "var(--ink-3)" }}>{t("nt.empty")}</p>
            ) : (
              <ul className="space-y-0.5">
                {items.map((n) => {
                  const role = list ? roleFor(list, n) : null;
                  const group = groupOf(n.kind);
                  const Icon = GROUP_ICON[group];
                  const { line, detail } = describe(n, t, role);
                  const when = n.createdAt ? formatRelativeTime(n.createdAt, lang) : "";
                  const label = [t(`nt.group.${group}`), n.eventName].filter(Boolean).join(" · ");
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => void openItem(n)}
                        disabled={busyId != null}
                        className="flex w-full items-start gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--tint)] disabled:cursor-wait"
                        style={n.read ? undefined : { background: "color-mix(in srgb, var(--accent) 7%, transparent)" }}
                      >
                        <span
                          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                          style={{ background: n.read ? "var(--surface-sunken)" : "var(--accent-weak)", color: n.read ? "var(--ink-3)" : "var(--accent)" }}
                          aria-hidden="true"
                        >
                          {busyId === n.id ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color: "var(--ink-3)" }}>{label}</span>
                          <span className={`mt-0.5 block text-[13.5px] leading-snug ${n.read ? "font-normal" : "font-semibold"}`} style={{ color: "var(--ink)" }}>{line}</span>
                          {detail ? <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug" style={{ color: "var(--ink-2)" }}>{detail}</span> : null}
                          {when ? <span className="mt-1 block text-[11.5px] tabular-nums" style={{ color: "var(--ink-3)" }}>{when}</span> : null}
                        </span>
                        {n.read ? null : (
                          <span className="mt-2 h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--accent-solid)" }}>
                            <span className="sr-only">{t("nt.unread_dot")}</span>
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
