"use client";

/**
 * The platform's status: one line for the whole, then each check with its
 * state in colour and what that means for someone using HackOS. The first
 * answer comes with the page; the browser asks again every minute while the
 * tab is open (and at once when it comes back after a while).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, CircleHelp, CircleMinus, CircleX, Database, Mail, RefreshCw, Server, Workflow } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { formatDate } from "@/lib/i18n/dates";
import { fill } from "@/lib/i18n/fill";
import {
  CHECK_KEYS, STATUS_REFRESH_MS, fetchStatus, lagParts, type CheckKey, type CheckState, type Overall, type PlatformStatus,
} from "@/lib/platformStatus";
import { checkSentence, statusCopy } from "./copy";

type Tone = "ok" | "warn" | "danger" | "mute";

const TONE: Record<Tone, { fg: string; bg: string }> = {
  ok: { fg: "var(--hs-ok)", bg: "var(--hs-ok-weak)" },
  warn: { fg: "var(--hs-warn)", bg: "var(--hs-warn-weak)" },
  danger: { fg: "var(--hs-danger)", bg: "var(--hs-danger-weak)" },
  mute: { fg: "var(--hs-ink-3)", bg: "var(--hs-tint)" },
};

const stateTone = (s: CheckState): Tone => (s === "ok" ? "ok" : s === "degraded" ? "warn" : s === "down" ? "danger" : "mute");
const overallTone = (s: Overall): Tone => (s === "ok" ? "ok" : s === "degraded" ? "warn" : "danger");
const ICON = { ok: CircleCheck, warn: CircleAlert, danger: CircleX, mute: CircleHelp } as const;
const CHECK_ICON: Record<CheckKey, typeof Server> = { api: Server, database: Database, jobs: Workflow, mail: Mail };

export function StatusView({ initial }: { initial: PlatformStatus }) {
  const { lang } = useTranslation();
  const copy = statusCopy(lang);
  const [data, setData] = useState<PlatformStatus>(initial);
  const [checking, setChecking] = useState(false);
  const seq = useRef(0);
  const lastAsked = useRef(0);

  const check = useCallback(async () => {
    const mine = ++seq.current;
    lastAsked.current = Date.now();
    setChecking(true);
    const next = await fetchStatus();
    // A slower, older answer never replaces a newer one.
    if (mine !== seq.current) return;
    setData(next);
    setChecking(false);
  }, []);

  useEffect(() => {
    lastAsked.current = Date.now();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, STATUS_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastAsked.current >= STATUS_REFRESH_MS) void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  const tone = TONE[overallTone(data.status)];
  const OverallIcon = ICON[overallTone(data.status)];
  // The viewer's own clock, so the server's rendering of it is replaced after hydration.
  const time = formatDate(data.time, lang, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const [updatedBefore, updatedAfter = ""] = copy.updated.split("{time}");

  return (
    <>
      <section className="border-b" style={{ borderColor: "var(--hs-line)" }}>
        <div className="mx-auto max-w-6xl px-5 pb-12 pt-14 sm:px-8 sm:pt-20">
          <p className="hs-chapter">{copy.chapter}</p>
          <h1 className="hs-display hs-h2 mt-5 max-w-[18ch] text-balance">{copy.title}</h1>
          <p className="hs-lead-lg mt-6 max-w-[40rem]">{copy.lead}</p>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
        <div role="status" aria-live="polite" className="flex items-start gap-4 rounded-[var(--hs-radius)] border px-5 py-5 sm:px-6"
          style={{ borderColor: tone.fg, background: tone.bg }}>
          <OverallIcon size={28} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: tone.fg }} />
          <div className="min-w-0">
            <h2 className="text-[20px] font-semibold tracking-[-0.01em] sm:text-[22px]" style={{ color: "var(--hs-ink)" }}>{copy.overall[data.status].title}</h2>
            <p className="mt-1 text-[15px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>{copy.overall[data.status].body}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[13.5px]" style={{ color: "var(--hs-ink-3)" }}>
          <p>
            {updatedBefore}
            <time dateTime={data.time} suppressHydrationWarning className="tabular-nums" style={{ color: "var(--hs-ink-2)" }}>{time}</time>
            {updatedAfter}
            <span aria-hidden="true"> · </span>
            {copy.auto}
          </p>
          <button type="button" onClick={() => void check()} disabled={checking} className="hs-pill hs-pill-ghost disabled:opacity-60">
            <RefreshCw size={15} aria-hidden="true" className={checking ? "animate-spin" : ""} />
            {checking ? copy.checking : copy.refresh}
          </button>
        </div>

        <ul aria-label={copy.checksLabel} className="mt-8 divide-y overflow-hidden rounded-[var(--hs-radius)] border"
          style={{ borderColor: "var(--hs-line)", background: "var(--hs-surface)" }}>
          {CHECK_KEYS.map((key) => {
            const c = data.checks[key];
            const ct = TONE[stateTone(c.state)];
            const StateIcon = c.state === "off" ? CircleMinus : ICON[stateTone(c.state)];
            const Icon = CHECK_ICON[key];
            const lag = key === "jobs" ? lagParts(c.lagSeconds) : null;
            const detail = key === "database" && c.latencyMs != null
              ? fill(copy.latency, { ms: Math.round(c.latencyMs * 10) / 10 })
              : lag ? fill(copy.lag[lag.unit], { n: lag.n }) : null;
            return (
              <li key={key} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:px-6" style={{ borderColor: "var(--hs-line)" }}>
                <div className="flex min-w-0 items-start gap-3">
                  <Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: "var(--hs-ink-3)" }} />
                  <div className="min-w-0">
                    <h3 className="text-[15.5px] font-semibold" style={{ color: "var(--hs-ink)" }}>{copy.checks[key].name}</h3>
                    <p className="mt-0.5 text-[13.5px] leading-relaxed" style={{ color: "var(--hs-ink-3)" }}>{copy.checks[key].what}</p>
                  </div>
                </div>
                <div className="pl-[30px] sm:max-w-[22rem] sm:shrink-0 sm:pl-0 sm:text-right">
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-semibold" style={{ color: ct.fg, background: ct.bg }}>
                    <StateIcon size={14} aria-hidden="true" />{copy.state[c.state]}
                  </span>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>{checkSentence(copy, key, c.state)}</p>
                  {detail ? <p className="mt-0.5 text-[12.5px] tabular-nums" style={{ color: "var(--hs-ink-3)" }}>{detail}</p> : null}
                </div>
              </li>
            );
          })}
        </ul>

        {data.version ? (
          <p className="mt-4 text-[12.5px]" style={{ color: "var(--hs-ink-3)" }}>{fill(copy.version, { v: data.version })}</p>
        ) : null}

        <div className="hs-card mt-10 flex flex-col gap-4 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="hs-h3" style={{ color: "var(--hs-ink)" }}>{copy.help.title}</h2>
            <p className="mt-1.5 max-w-[34rem] text-[15px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>{copy.help.body}</p>
          </div>
          <Link href="/contact" className="hs-pill hs-pill-ghost shrink-0">{copy.help.cta}</Link>
        </div>
      </section>
    </>
  );
}
