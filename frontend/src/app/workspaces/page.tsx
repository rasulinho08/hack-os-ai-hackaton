"use client";

/**
 * My workspaces — where a signed-in person chooses what to work on.
 *
 * Organisations they manage open the organiser dashboard; events open the
 * portal for their role in that event (participant, judge, mentor,
 * volunteer). The platform owner also gets the owner console. With exactly
 * one place to go and `?auto=1` (set by the sign-in flow), the page enters it
 * straight away.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Building2, CalendarDays, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ShellNotices } from "@/components/notices/ShellNotices";
import {
  type WorkspaceEntry,
  type Workspaces,
  entriesFrom,
  enterWorkspace,
  fetchWorkspaces,
  isEnterable,
  signOut,
} from "@/lib/workspaces";
import { formatDate } from "@/lib/i18n/dates";

type State = { phase: "loading" } | { phase: "error" } | { phase: "ready"; ws: Workspaces };

function formatRange(start: string | null, end: string | null, lang: string): string {
  const fmt = (v: string | null) => formatDate(v, lang, { day: "numeric", month: "short", year: "numeric" });
  const a = fmt(start);
  const b = fmt(end);
  return a && b && a !== b ? `${a} – ${b}` : a || b;
}

function WorkspacesInner() {
  const { t, lang } = useTranslation();
  const params = useSearchParams();
  const auto = params.get("auto") === "1";
  const [state, setState] = useState<State>({ phase: "loading" });
  const [entering, setEntering] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  const go = useCallback(async (entry: WorkspaceEntry, key: string) => {
    setEntering(key);
    try {
      const dest = await enterWorkspace(entry);
      window.location.assign(dest);
    } catch {
      setEntering(null);
      setState({ phase: "error" });
    }
  }, []);

  const apply = useCallback(
    (request: Promise<Workspaces>) => {
      request
        .then((ws) => {
          try {
            const m = document.cookie.match(/(?:^|; )hh_email=([^;]*)/);
            if (m) setEmail(decodeURIComponent(m[1]));
          } catch {
            /* no cookie access */
          }
          setState({ phase: "ready", ws });
          const entries = entriesFrom(ws).filter(isEnterable);
          if (auto && entries.length === 1) void go(entries[0], "auto");
        })
        .catch(() => setState({ phase: "error" }));
    },
    [auto, go],
  );

  useEffect(() => {
    apply(fetchWorkspaces());
  }, [apply]);

  const load = () => {
    setState({ phase: "loading" });
    apply(fetchWorkspaces());
  };

  const roleLabel = (r: string) => t(`workspaces.role.${r}`);
  const statusLabel = (s: string | null) => (s ? t(`workspaces.status.${s}`) : "");

  const card = (key: string, entry: WorkspaceEntry, icon: React.ReactNode, title: string, meta: React.ReactNode, note?: string) => {
    const enterable = isEnterable(entry);
    const busy = entering === key || (entering === "auto" && auto);
    return (
      <li key={key}>
        <button
          type="button"
          disabled={!enterable || entering !== null}
          onClick={() => go(entry, key)}
          className="group flex h-full w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors disabled:cursor-not-allowed"
          style={{
            background: "var(--app-surface)",
            borderColor: "var(--app-card-line)",
            opacity: enterable ? 1 : 0.72,
          }}
        >
          <span
            className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{ background: "rgba(225,0,60,0.12)", color: "var(--app-brand-text)" }}
          >
            {icon}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-[15px] font-semibold" style={{ color: "var(--app-heading)" }}>
              {title}
            </span>
            <span className="flex flex-wrap items-center gap-2 text-[13px]" style={{ color: "var(--app-muted)" }}>
              {meta}
            </span>
            {note ? (
              <span className="text-[12.5px]" style={{ color: "var(--app-warn)" }}>
                {note}
              </span>
            ) : null}
          </span>
          {enterable ? (
            <span className="mt-2 shrink-0" style={{ color: "var(--app-muted-2)" }}>
              {busy ? <RefreshCw size={16} className="animate-spin" /> : <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />}
            </span>
          ) : null}
        </button>
      </li>
    );
  };

  const badge = (text: string) => (
    <span
      className="rounded-full px-2 py-0.5 text-[11.5px] font-medium"
      style={{ background: "rgba(255,255,255,0.06)", color: "var(--app-heading)", border: "1px solid var(--app-card-line)" }}
    >
      {text}
    </span>
  );

  let body: React.ReactNode;
  if (state.phase === "loading") {
    body = (
      <p className="text-sm" style={{ color: "var(--app-muted)" }}>
        {t("Loading")}
      </p>
    );
  } else if (state.phase === "error") {
    body = (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm" style={{ color: "var(--app-danger)" }}>
          {t("workspaces.load_error")}
        </p>
        <button type="button" onClick={load} className="rounded-xl border px-4 py-2 text-sm font-medium" style={{ borderColor: "var(--app-card-line)", color: "var(--app-heading)" }}>
          {t("workspaces.retry")}
        </button>
      </div>
    );
  } else {
    const entries = entriesFrom(state.ws);
    const consoleEntry = entries.find((e) => e.kind === "console");
    const orgs = entries.filter((e): e is Extract<WorkspaceEntry, { kind: "org" }> => e.kind === "org");
    const events = entries.filter((e): e is Extract<WorkspaceEntry, { kind: "event" }> => e.kind === "event");
    body =
      entries.length === 0 ? (
        <div className="rounded-2xl border p-6" style={{ background: "var(--app-surface)", borderColor: "var(--app-card-line)" }}>
          <h2 className="text-base font-semibold" style={{ color: "var(--app-heading)" }}>
            {t("workspaces.empty_title")}
          </h2>
          <p className="mt-1 text-sm" style={{ color: "var(--app-muted)" }}>
            {t("workspaces.empty_body")}
          </p>
          <form
            className="mt-4 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const c = code.trim();
              if (c) window.location.assign(`/join/${encodeURIComponent(c)}`);
            }}
          >
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              aria-label={t("workspaces.code_label")}
              placeholder={t("workspaces.code_placeholder")}
              autoCapitalize="characters"
              className="h-10 min-w-0 flex-1 rounded-xl border px-3 font-mono text-sm uppercase outline-none sm:max-w-[220px]"
              style={{ background: "var(--app-surface-2)", borderColor: "var(--app-card-line)", color: "var(--app-heading)" }}
            />
            <button
              type="submit"
              disabled={!code.trim()}
              className="h-10 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "#E1003C" }}
            >
              {t("workspaces.join_event")}
            </button>
            <a href="/pricing" className="inline-flex h-10 items-center rounded-xl border px-4 text-sm font-medium" style={{ borderColor: "var(--app-card-line)", color: "var(--app-heading)" }}>
              {t("workspaces.buy")}
            </a>
          </form>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {consoleEntry ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--app-muted-2)" }}>
                {t("workspaces.platform")}
              </h2>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {card("console", consoleEntry, <ShieldCheck size={18} />, t("workspaces.console"), <span>{t("workspaces.console_desc")}</span>)}
              </ul>
            </section>
          ) : null}
          {orgs.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--app-muted-2)" }}>
                {t("workspaces.organizations")}
              </h2>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {orgs.map((e) =>
                  card(
                    `org-${e.org.id}`,
                    e,
                    <Building2 size={18} />,
                    e.org.name,
                    <>{badge(roleLabel(e.org.role))}</>,
                    isEnterable(e) ? undefined : t("workspaces.status.org_pending"),
                  ),
                )}
              </ul>
            </section>
          ) : null}
          {events.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--app-muted-2)" }}>
                {t("workspaces.events")}
              </h2>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {events.map((e) => {
                  const ev = e.event;
                  const range = formatRange(ev.start_date, ev.end_date, lang);
                  const pendingNote =
                    ev.role === "participant" && !isEnterable(e) ? statusLabel(ev.participant_status) : undefined;
                  return card(
                    `event-${ev.id}`,
                    e,
                    <CalendarDays size={18} />,
                    ev.name,
                    <>
                      {badge(roleLabel(ev.role))}
                      {range ? <span className="tabular-nums">{range}</span> : null}
                    </>,
                    pendingNote,
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      );
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--app-surface-2)", color: "var(--app-heading)" }}>
      <header className="border-b" style={{ borderColor: "var(--app-card-line)" }}>
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <span className="flex items-center gap-2">
            <Image src="/logo.svg" alt="" width={28} height={28} />
            <span className="text-[15px] font-semibold">HackOS</span>
          </span>
          <span className="flex items-center gap-2">
            {email ? (
              <span className="hidden truncate text-[13px] sm:inline" style={{ color: "var(--app-muted)", maxWidth: 220 }}>
                {email}
              </span>
            ) : null}
            <LanguageSwitcher />
            <button
              type="button"
              onClick={async () => {
                await signOut();
                window.location.assign("/login");
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[13px] font-medium"
              style={{ borderColor: "var(--app-card-line)", color: "var(--app-heading)" }}
            >
              <LogOut size={14} /> {t("workspaces.sign_out")}
            </button>
          </span>
        </div>
      </header>
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        {/* Where someone invited but not yet confirmed lands: the request to
            confirm (and what it opens) belongs here more than anywhere. */}
        <ShellNotices />
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("workspaces.title")}</h1>
          <p className="text-sm" style={{ color: "var(--app-muted)" }}>
            {t("workspaces.subtitle")}
          </p>
        </div>
        {body}
      </main>
    </div>
  );
}

export default function WorkspacesPage() {
  return (
    <Suspense fallback={null}>
      <WorkspacesInner />
    </Suspense>
  );
}
