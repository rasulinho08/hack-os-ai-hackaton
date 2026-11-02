"use client";

/**
 * The public check of a certificate by its code — what anyone the holder
 * shows it to sees: whether it is genuine (or was revoked), whose it is,
 * for what, at which event, and the PDF. No e-mail address and no account
 * ids are ever on it (the API does not send them).
 *
 * Light by default like the rest of the public site, with the visitor's
 * theme and language switch.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, BadgeCheck, CalendarDays, Copy, Download, ExternalLink, MapPin, Moon, SearchX, ShieldX, Sun, Users,
} from "lucide-react";
import { buttonLook } from "@/components/ds/primitives";
import { KindIcon, certificateTitle } from "@/components/wrapup/CertificateParts";
import { useTranslation } from "@/contexts/LanguageContext";
import { useSiteTheme } from "@/app/(site)/_theme";
import { isCodeShape, normaliseCode, publicPdfPath, verifyPath, verifyUrl, type PublicCertificate } from "@/lib/certificates";
import { formatDate } from "@/lib/i18n/dates";
import { fill } from "@/lib/i18n/fill";
import type { Lang } from "@/lib/i18n";

export type VerifyResult = "ok" | "not_found" | "error";

const LANGS: { code: Lang; label: string }[] = [
  { code: "az", label: "AZ" },
  { code: "en", label: "EN" },
  { code: "ru", label: "RU" },
];

function dateRange(lang: string, start: string | null, end: string | null): string {
  const f = (iso: string) => formatDate(iso, lang, { day: "numeric", month: "long", year: "numeric" });
  if (start && end) {
    const a = f(start);
    const b = f(end);
    return a === b ? a : `${a} – ${b}`;
  }
  return start ? f(start) : end ? f(end) : "";
}

export function VerifyView({ code, result, cert }: { code: string; result: VerifyResult; cert: PublicCertificate | null }) {
  const { t, lang, setLang } = useTranslation();
  const { theme, toggle } = useSiteTheme();
  const dark = theme === "dark";
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(verifyUrl(code));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      /* the address bar holds the same link */
    }
  };

  const valid = result === "ok" && cert != null && !cert.revoked;
  const revoked = result === "ok" && cert != null && cert.revoked;

  return (
    <div className={`hs ${dark ? "hs-night" : ""} flex min-h-dvh flex-col`} style={{ background: "var(--surface-sunken)", color: "var(--ink)" }}>
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 pb-2 pt-5 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="HackOS">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={26} height={26} />
          <span className="text-[17px] font-semibold tracking-[-0.02em]">HackOS</span>
        </Link>
        <div className="flex items-center gap-1.5">
          <div role="group" aria-label={t("vf.language")} className="flex rounded-full border p-0.5" style={{ borderColor: "var(--line-strong)" }}>
            {LANGS.map((l) => (
              <button key={l.code} type="button" onClick={() => setLang(l.code)} aria-pressed={lang === l.code}
                className="min-h-8 rounded-full px-2.5 text-[12px] font-semibold transition-colors"
                style={{ background: lang === l.code ? "var(--ink)" : "transparent", color: lang === l.code ? "var(--surface)" : "var(--ink-2)" }}>
                {l.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={toggle} aria-label={dark ? t("vf.theme_light") : t("vf.theme_dark")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--tint)]" style={{ color: "var(--ink-2)" }}>
            {dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-12 pt-4 sm:px-6">
        <p className="text-[12px] font-medium uppercase tracking-[0.14em]" style={{ color: "var(--ink-3)" }}>{t("vf.eyebrow")}</p>
        <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.02em] sm:text-[34px]" style={{ textWrap: "balance" }}>
          {valid ? t("vf.valid_title") : revoked ? t("vf.revoked_title") : result === "error" ? t("vf.error_title") : t("vf.missing_title")}
        </h1>

        <section className="mt-6 overflow-hidden rounded-[var(--radius)] border" style={{ borderColor: "var(--line)", background: "var(--surface)" }} aria-live="polite">
          <StatusBand kind={valid ? "valid" : revoked ? "revoked" : result === "error" ? "error" : "missing"} code={code} />
          {cert && result === "ok" ? <Details cert={cert} code={code} valid={valid} copied={copied} onCopy={() => void copy()} /> : null}
        </section>

        <CheckAnother initial={result === "ok" ? "" : code} />

        <p className="mt-10 text-[12.5px] leading-relaxed" style={{ color: "var(--ink-3)" }}>{t("vf.footer")}</p>
      </main>
    </div>
  );
}

function StatusBand({ kind, code }: { kind: "valid" | "revoked" | "missing" | "error"; code: string }) {
  const { t } = useTranslation();
  const look = {
    valid: { icon: <BadgeCheck size={22} aria-hidden="true" />, fg: "var(--ok)", bg: "var(--ok-weak)", title: t("vf.valid"), body: t("vf.valid_body") },
    revoked: { icon: <ShieldX size={22} aria-hidden="true" />, fg: "var(--danger)", bg: "var(--danger-weak)", title: t("vf.revoked"), body: t("vf.revoked_body") },
    missing: { icon: <SearchX size={22} aria-hidden="true" />, fg: "var(--warn)", bg: "var(--warn-weak)", title: t("vf.missing"), body: fill(t("vf.missing_body"), { code: code || "—" }) },
    error: { icon: <AlertTriangle size={22} aria-hidden="true" />, fg: "var(--warn)", bg: "var(--warn-weak)", title: t("vf.error"), body: t("vf.error_body") },
  }[kind];
  return (
    <div className="flex items-start gap-3 px-5 py-4" style={{ background: look.bg }}>
      <span className="mt-0.5 shrink-0" style={{ color: look.fg }}>{look.icon}</span>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>{look.title}</p>
        <p className="mt-0.5 text-[13.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{look.body}</p>
      </div>
    </div>
  );
}

function Details({ cert, code, valid, copied, onCopy }: { cert: PublicCertificate; code: string; valid: boolean; copied: boolean; onCopy: () => void }) {
  const { t, lang } = useTranslation();
  const dates = dateRange(lang, cert.event.startDate, cert.event.endDate);
  const issued = cert.issuedAt ? formatDate(cert.issuedAt, lang, { day: "numeric", month: "long", year: "numeric" }) : "";
  const rows: { label: string; value: string; icon?: React.ReactNode }[] = [
    { label: t("vf.event"), value: cert.event.name },
    ...(dates ? [{ label: t("vf.dates"), value: dates, icon: <CalendarDays size={14} aria-hidden="true" /> }] : []),
    ...(cert.event.city ? [{ label: t("vf.city"), value: cert.event.city, icon: <MapPin size={14} aria-hidden="true" /> }] : []),
    ...(cert.team ? [{ label: t("vf.team"), value: cert.team, icon: <Users size={14} aria-hidden="true" /> }] : []),
    ...(cert.project ? [{ label: t("vf.project"), value: cert.project }] : []),
    ...(cert.kind === "winner" && cert.title ? [{ label: t("vf.prize"), value: cert.title }] : []),
    ...(issued ? [{ label: t("vf.issued"), value: issued }] : []),
  ];
  return (
    <div className="px-5 pb-5 pt-5" style={{ opacity: valid ? 1 : 0.75 }}>
      <div className="flex items-start gap-3.5">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--accent-weak)", color: "var(--accent)" }}>
          <KindIcon kind={cert.kind} size={20} />
        </span>
        <div className="min-w-0">
          <p className="text-[12px] font-medium uppercase tracking-[0.1em]" style={{ color: "var(--ink-3)" }}>{t("vf.holder")}</p>
          <p className="mt-0.5 text-[22px] font-semibold leading-tight" style={{ color: "var(--ink)", textDecoration: valid ? "none" : "line-through" }}>{cert.name}</p>
          <p className="mt-1 text-[14.5px] font-medium" style={{ color: "var(--ink-2)" }}>{certificateTitle(t, lang, cert)}</p>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="min-w-0">
            <dt className="text-[11.5px] font-medium uppercase tracking-[0.08em]" style={{ color: "var(--ink-3)" }}>{r.label}</dt>
            <dd className="mt-0.5 flex items-center gap-1.5 text-[14px]" style={{ color: "var(--ink)" }}>
              {r.icon ? <span style={{ color: "var(--ink-3)" }}>{r.icon}</span> : null}
              <span className="min-w-0 break-words">{r.value}</span>
            </dd>
          </div>
        ))}
        <div className="min-w-0">
          <dt className="text-[11.5px] font-medium uppercase tracking-[0.08em]" style={{ color: "var(--ink-3)" }}>{t("vf.code")}</dt>
          <dd className="mt-0.5 font-mono text-[14px] tracking-[0.08em]" style={{ color: "var(--ink)" }}>{code}</dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-wrap gap-2">
        {valid ? (
          <a href={publicPdfPath(code)} download {...buttonLook("primary", "md")}>
            <Download size={15} aria-hidden="true" /> {t("vf.download")}
          </a>
        ) : null}
        <button type="button" onClick={onCopy} {...buttonLook("secondary", "md")}>
          <Copy size={15} aria-hidden="true" /> {copied ? t("vf.copied") : t("vf.copy")}
        </button>
        {cert.event.slug ? (
          <Link href={`/e/${encodeURIComponent(cert.event.slug)}`} {...buttonLook("ghost", "md")}>
            <ExternalLink size={15} aria-hidden="true" /> {t("vf.event_page")}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function CheckAnother({ initial }: { initial: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const c = normaliseCode(value);
    if (!isCodeShape(c)) {
      setError(t("vf.bad_code"));
      return;
    }
    setError(null);
    router.push(verifyPath(c));
  };
  return (
    <form onSubmit={submit} className="mt-8 rounded-[var(--radius)] border p-5" style={{ borderColor: "var(--line)", background: "var(--surface)" }} noValidate>
      <label htmlFor="vf-code" className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{t("vf.check_another")}</label>
      <p className="mt-0.5 text-[13px]" style={{ color: "var(--ink-3)" }}>{t("vf.check_hint")}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          id="vf-code"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          placeholder="ABCD-EFGH-JKLM"
          autoComplete="off"
          spellCheck={false}
          maxLength={20}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "vf-code-err" : undefined}
          className="min-h-11 w-full min-w-0 rounded-[var(--radius-sm)] border px-3 font-mono text-[15px] uppercase tracking-[0.08em] outline-none focus:ring-2"
          style={{ background: "var(--surface)", color: "var(--ink)", borderColor: error ? "var(--danger)" : "var(--line-strong)", ["--tw-ring-color" as string]: "var(--accent-weak)" }}
        />
        <button type="submit" {...buttonLook("dark", "lg")}>{t("vf.check")}</button>
      </div>
      {error ? <p id="vf-code-err" role="alert" className="mt-2 text-[13px]" style={{ color: "var(--danger)" }}>{error}</p> : null}
    </form>
  );
}
