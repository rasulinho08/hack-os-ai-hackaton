"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useDemoBasePath } from "@/lib/demoPath";
import {
  Trash2,
  AlertTriangle,
  Pencil,
  Calendar,
  ArrowRight,
  LogOut,
  Loader2,
  Mail,
  type LucideIcon,
} from "lucide-react";
import { BrandLoader } from "@/components/BrandLoader";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CalendarFeedCard } from "@/components/calendar/CalendarFeedCard";
import { ApiError, apiGet, apiPost, apiDelete } from "@/lib/api";
import { useActiveEvent } from "@/contexts/ActiveEventContext";

/* ────────────────────────────────────────────────────────────────────────────
   Settings has its own surface — the --set-* tokens in globals.css. The
   dashboard is crimson on near-black and everything there competes for
   attention; here the ground is a cooler slate, teal marks anything
   interactive, and crimson appears only on destructive controls, so red on
   this screen always means "this cannot be undone" rather than "this is a
   button".

   Every colour comes from a token, so the section follows the light/dark
   switch. The previous version hard-coded white text, which left the event
   card at a contrast ratio of 1.09 — invisible — once light mode was on.
   ──────────────────────────────────────────────────────────────────────── */

const SECTIONS: { id: string; labelKey: string; icon: LucideIcon }[] = [
  { id: "event", labelKey: "settings.section_event", icon: Pencil },
  { id: "email", labelKey: "settings.section_email", icon: Mail },
  { id: "session", labelKey: "settings.section_session", icon: LogOut },
  {
    id: "danger",
    labelKey: "settings.delete_event_section",
    icon: AlertTriangle,
  },
];

function Panel({
  id,
  title,
  icon: Icon,
  description,
  tone = "default",
  children,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  description?: string;
  tone?: "default" | "danger";
  children: React.ReactNode;
}) {
  const isDanger = tone === "danger";
  const accent = isDanger ? "var(--set-danger)" : "var(--set-accent)";
  const weak = isDanger ? "var(--set-danger-weak)" : "var(--set-accent-weak)";
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="scroll-mt-24 overflow-hidden rounded-xl border"
      style={{
        background: "var(--set-panel)",
        borderColor: isDanger ? "var(--set-danger)" : "var(--set-line)",
      }}
    >
      <header
        className="flex items-start gap-3 border-b px-5 py-4"
        style={{ borderColor: "var(--set-line)" }}
      >
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{ background: weak }}
        >
          <Icon size={16} style={{ color: accent }} />
        </span>
        <div className="min-w-0">
          <h2
            id={`${id}-heading`}
            className="text-[15px] font-semibold"
            style={{ color: "var(--set-text)" }}
          >
            {title}
          </h2>
          {description ? (
            <p
              className="mt-0.5 text-[13px] leading-relaxed"
              style={{ color: "var(--set-text-faint)" }}
            >
              {description}
            </p>
          ) : null}
        </div>
      </header>
      {children}
    </section>
  );
}

interface MailReadiness {
  configured: boolean;
  provider: string | null;
  fromEmail: string | null;
  problem: string | null;
}

/**
 * Whether the API can send e-mail, and a button that proves it end to end.
 * The status comes from the API itself, so it reflects the deployed
 * environment rather than anything configured on this host.
 */
function EmailDeliveryPanel({ t }: { t: (k: string) => string }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<MailReadiness | null>(null);
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiGet<MailReadiness>("/api/mail/status")
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sendTest = async () => {
    setSending(true);
    try {
      const res = await apiPost<{ to?: string }>("/api/mail/test", {});
      toast(`${t("settings.email_test_sent")} ${res?.to ?? ""}`.trim(), "success");
    } catch (e) {
      toast(e instanceof ApiError || e instanceof Error ? e.message : "E-mail not sent", "error");
    } finally {
      setSending(false);
    }
  };

  const ok = Boolean(status?.configured);
  return (
    <Panel
      id="email"
      title={t("settings.section_email")}
      icon={Mail}
      description={t("settings.email_panel_desc")}
    >
      <div className="space-y-3 border-b px-5 py-4" style={{ borderColor: "var(--set-line)" }}>
        {failed ? (
          <p className="text-[13px]" style={{ color: "var(--set-danger)" }}>
            {t("settings.email_status_unavailable")}
          </p>
        ) : !status ? (
          <Loader2 size={16} className="animate-spin" style={{ color: "var(--set-text-faint)" }} />
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[13px]">
            <dt style={{ color: "var(--set-text-faint)" }}>Status</dt>
            <dd className="font-medium" style={{ color: ok ? "var(--set-accent)" : "var(--set-danger)" }}>
              {ok ? t("settings.email_status_ok") : t("settings.email_status_off")}
            </dd>
            <dt style={{ color: "var(--set-text-faint)" }}>{t("settings.email_provider")}</dt>
            <dd style={{ color: "var(--set-text)" }}>{status.provider ?? "—"}</dd>
            <dt style={{ color: "var(--set-text-faint)" }}>{t("settings.email_sender")}</dt>
            <dd className="break-all" style={{ color: "var(--set-text)" }}>{status.fromEmail ?? "—"}</dd>
            {status.problem ? (
              <dd className="col-span-2 mt-1" style={{ color: "var(--set-danger)" }}>
                {status.problem}
              </dd>
            ) : null}
          </dl>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <p className="max-w-prose text-[13px] leading-relaxed" style={{ color: "var(--set-text-faint)" }}>
          {t("settings.email_test_help")}
        </p>
        <button
          type="button"
          onClick={sendTest}
          disabled={sending || !ok}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border px-3.5 py-2 text-[15px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
          style={{ borderColor: "var(--set-line-strong)", color: "var(--set-text-soft)" }}
        >
          {sending ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />}
          {t("settings.email_test_button")}
        </button>
      </div>
    </Panel>
  );
}

export default function SettingsPage() {
  const demoBase = useDemoBasePath();
  const { t } = useTranslation();
  const router = useRouter();
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [showDeleteEventConfirm, setShowDeleteEventConfirm] = useState(false);
  const [deletingEvent, setDeletingEvent] = useState(false);
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);
  const contentRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const {
    activeEventId,
    primaryEvent,
    loading: eventLoading,
    refetch: refetchEvents,
  } = useActiveEvent();

  /*
   * The per-event switches that used to live here (e-mail notifications,
   * Slack, SMS, auto-approve, e-mail verification) were saved and then read
   * by nothing: no Slack or SMS code exists, and registration never looked
   * at auto-approve. They are gone until each one does something.
   */
  const loading = eventLoading;

  const activeEventLabel =
    primaryEvent?.name?.trim() ||
    primaryEvent?.event_code?.trim() ||
    (activeEventId != null ? `#${activeEventId}` : "");

  /*
   * Keep the rail in step with whichever section is on screen.
   *
   * The dashboard scrolls inside <main>, not the document, and the last two
   * sections are short enough that they never reach the top of the viewport —
   * an IntersectionObserver band left the rail stuck on "Access" for the whole
   * bottom of the page. Measuring against the scroll container instead, and
   * treating "scrolled to the end" as "the last section", tracks every section.
   */
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    let scroller: HTMLElement | null = root.parentElement;
    while (scroller) {
      const overflow = getComputedStyle(scroller).overflowY;
      if (/auto|scroll/.test(overflow)) break;
      scroller = scroller.parentElement;
    }
    const target: HTMLElement | Window = scroller ?? window;

    const update = () => {
      const sections = Array.from(
        root.querySelectorAll<HTMLElement>("section[id]"),
      );
      if (sections.length === 0) return;

      if (scroller) {
        const atEnd =
          scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8;
        if (atEnd) {
          setActiveSection(sections[sections.length - 1].id);
          return;
        }
      }
      const line = (scroller?.getBoundingClientRect().top ?? 0) + 120;
      let current = sections[0].id;
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= line) current = section.id;
      }
      setActiveSection(current);
    };

    update();
    target.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      target.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [loading, activeEventId]);

  /**
   * Signs this browser out. It used to be labelled "Clear all data" and warned
   * that every participant, team and submission would be deleted — while doing
   * exactly this and nothing more. Nothing on this screen removes event data
   * except the danger zone.
   */
  const signOutThisDevice = async () => {
    try {
      await apiPost("/api/auth/logout", {});
    } catch {
      /* the cookies below are cleared either way */
    }
    for (const c of ["hh_role", "hh_email", "hh_event"]) {
      document.cookie = `${c}=; Path=/; Max-Age=0; SameSite=Lax`;
    }
    window.location.href = "/login";
  };

  const deleteCurrentEvent = async () => {
    if (activeEventId == null || deletingEvent) return;
    setDeletingEvent(true);
    try {
      await apiDelete(`/api/events/${activeEventId}`);
      toast(t("settings.delete_event_success"), "success");
      await refetchEvents();
      router.push("/");
    } catch (err) {
      toast(
        err instanceof ApiError ? err.message : t("settings.delete_event_error"),
        "error",
      );
    } finally {
      setDeletingEvent(false);
      setShowDeleteEventConfirm(false);
    }
  };

  if (loading) {
    return <BrandLoader message={t("Loading")} fullMinHeight />;
  }

  /* No event selected — say so plainly instead of showing dead switches. */
  if (activeEventId == null) {
    return (
      <div
        className="rounded-xl border px-6 py-14 text-center"
        style={{
          background: "var(--set-panel)",
          borderColor: "var(--set-line)",
        }}
      >
        <Calendar
          size={26}
          className="mx-auto mb-3"
          style={{ color: "var(--set-text-faint)" }}
        />
        <h1
          className="text-base font-semibold"
          style={{ color: "var(--set-text)" }}
        >
          {t("settings.no_event_title")}
        </h1>
        <p
          className="mx-auto mt-1 max-w-sm text-[15px]"
          style={{ color: "var(--set-text-faint)" }}
        >
          {t("settings.no_event_desc")}
        </p>
        <Link
          href="/create-event?new=1"
          className="mt-5 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[15px] font-medium"
          style={{
            background: "var(--set-accent)",
            color: "var(--set-accent-ink)",
          }}
        >
          {t("settings.no_event_cta")} <ArrowRight size={15} />
        </Link>
      </div>
    );
  }

  return (
    <div style={{ color: "var(--set-text)" }}>
      <header className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "var(--set-text)" }}>
          {t("settings.title")}
        </h1>
        <p className="mt-1 text-[15px]" style={{ color: "var(--set-text-soft)" }}>
          {t("settings.subtitle")}{" "}
          <span className="font-medium" style={{ color: "var(--set-text)" }}>
            {activeEventLabel}
          </span>
        </p>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Section rail — a settings screen, not another stack of cards. */}
        {/*
          Sticky sits on the <nav>, not the <ul>: the nav is a flex item under
          lg:items-start, so its height is exactly its content and it has room
          to stick inside the tall row. On the <ul> it had none and scrolled
          straight off the top.
        */}
        <nav
          aria-label={t("settings.sections_nav")}
          className="hidden shrink-0 lg:sticky lg:top-6 lg:block lg:w-52"
        >
          <ul className="space-y-0.5">
            {SECTIONS.map(({ id, labelKey, icon: Icon }) => {
              const current = activeSection === id;
              return (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    aria-current={current ? "true" : undefined}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[15px] transition-colors"
                    style={{
                      background: current
                        ? "var(--set-accent-weak)"
                        : "transparent",
                      color: current
                        ? "var(--set-accent)"
                        : "var(--set-text-soft)",
                      fontWeight: current ? 600 : 400,
                    }}
                  >
                    <Icon size={15} />
                    {t(labelKey)}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <div ref={contentRef} className="min-w-0 flex-1 space-y-5">
          <Panel
            id="event"
            title={t("settings.event_panel_title")}
            icon={Pencil}
            description={t("settings.event_panel_desc")}
          >
            <Link
              href={demoBase ? `${demoBase}/settings` : "/edit-event"}
              className="group flex items-center justify-between gap-4 px-5 py-4"
              style={{ color: "var(--set-text)" }}
            >
              <span className="min-w-0">
                <span className="block text-[15px] font-medium">
                  {activeEventLabel}
                </span>
                <span
                  className="mt-1 flex flex-wrap items-center gap-2 text-[12px]"
                  style={{ color: "var(--set-text-soft)" }}
                >
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                    style={{ background: "var(--set-line)" }}
                  >
                    <Calendar size={10} /> {t("settings.event_tag_scheduling")}
                  </span>
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
                    style={{ background: "var(--set-line)" }}
                  >
                    <Pencil size={10} /> {t("settings.event_tag_details")}
                  </span>
                </span>
              </span>
              <ArrowRight
                size={17}
                className="shrink-0 transition-transform group-hover:translate-x-1 motion-reduce:transition-none"
                style={{ color: "var(--set-accent)" }}
              />
            </Link>
          </Panel>

          <EmailDeliveryPanel t={t} />

          <Panel
            id="session"
            title={t("settings.section_session")}
            icon={LogOut}
            description={t("settings.session_panel_desc")}
          >
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <p
                className="max-w-prose text-[13px] leading-relaxed"
                style={{ color: "var(--set-text-faint)" }}
              >
                {t("settings.session_help")}
              </p>
              <button
                type="button"
                onClick={() => setShowSignOutConfirm(true)}
                className="inline-flex shrink-0 items-center gap-2 rounded-lg border px-3.5 py-2 text-[15px] font-medium"
                style={{
                  borderColor: "var(--set-line-strong)",
                  color: "var(--set-text-soft)",
                }}
              >
                <LogOut size={15} />
                {t("settings.session_button")}
              </button>
            </div>
          </Panel>

          <CalendarFeedCard />

          <Panel
            id="danger"
            title={t("settings.delete_event_section")}
            icon={AlertTriangle}
            tone="danger"
            description={t("settings.danger_panel_desc")}
          >
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <p
                className="max-w-prose text-[13px] leading-relaxed"
                style={{ color: "var(--set-text-faint)" }}
              >
                {t("settings.danger_scope").replace(
                  "{name}",
                  activeEventLabel || "—",
                )}
              </p>
              <button
                type="button"
                disabled={deletingEvent}
                onClick={() => setShowDeleteEventConfirm(true)}
                className="inline-flex shrink-0 items-center gap-2 rounded-lg border px-3.5 py-2 text-[15px] font-medium disabled:opacity-50"
                style={{
                  borderColor: "var(--set-danger)",
                  background: "var(--set-danger-weak)",
                  color: "var(--set-danger)",
                }}
              >
                {deletingEvent ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Trash2 size={15} />
                )}
                {t("settings.delete_event_button")}
              </button>
            </div>
          </Panel>

          <div className="h-16 lg:h-4" />
        </div>
      </div>

      <ConfirmDialog
        open={showSignOutConfirm}
        title={t("settings.session_confirm_title")}
        message={t("settings.session_confirm_message")}
        confirmLabel={t("settings.session_confirm_button")}
        cancelLabel={t("Cancel")}
        onConfirm={() => {
          setShowSignOutConfirm(false);
          void signOutThisDevice();
        }}
        onCancel={() => setShowSignOutConfirm(false)}
      />

      <ConfirmDialog
        open={showDeleteEventConfirm}
        title={t("settings.delete_event_confirm_title")}
        message={t("settings.delete_event_confirm_message").replace(
          "{name}",
          activeEventLabel || "—",
        )}
        confirmLabel={t("Delete")}
        cancelLabel={t("Cancel")}
        variant="danger"
        onConfirm={() => {
          void deleteCurrentEvent();
        }}
        onCancel={() => setShowDeleteEventConfirm(false)}
      />
    </div>
  );
}
