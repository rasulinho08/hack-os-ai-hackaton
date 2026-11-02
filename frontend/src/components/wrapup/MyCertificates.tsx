"use client";

/**
 * The signed-in person's certificates: each one to download, to open on its
 * public page, to copy the link of and to add to LinkedIn. Every certificate
 * carries a code anyone can check at /verify/<code>.
 *
 * With `eventId` it shows that event's certificates only. Renders nothing
 * until there is something to show (and while loading), so it can sit on a
 * portal page through the whole event and appear when certificates are
 * issued; a failed load says so instead of looking empty.
 */

import { useCallback, useEffect, useState } from "react";
import { Copy, Download, ExternalLink, Linkedin, RefreshCw } from "lucide-react";
import { Button, buttonLook, cx } from "@/components/ds/primitives";
import { KindIcon, certificateTitle } from "@/components/wrapup/CertificateParts";
import { useTranslation } from "@/contexts/LanguageContext";
import { useToast } from "@/contexts/ToastContext";
import { apiGet } from "@/lib/api";
import { linkedInAddUrl, normalizeMine, publicPdfPath, verifyPath, verifyUrl, type MyCertificate } from "@/lib/certificates";
import { formatDate } from "@/lib/i18n/dates";
import { fill } from "@/lib/i18n/fill";

export function MyCertificates({ eventId, title, className }: { eventId?: number | null; title?: string; className?: string }) {
  const { t, lang } = useTranslation();
  const { toast } = useToast();
  const [state, setState] = useState<{ rows: MyCertificate[] } | "failed" | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(() => apiGet<unknown>("/api/me/certificates").then((raw) => ({ rows: normalizeMine(raw) })), []);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (s) => { if (!cancelled) setState(s); },
      () => { if (!cancelled) setState("failed"); },
    );
    return () => { cancelled = true; };
  }, [load]);

  const retry = async () => {
    setRetrying(true);
    try {
      setState(await load());
    } catch {
      setState("failed");
    } finally {
      setRetrying(false);
    }
  };

  const frame = cx("rounded-[var(--radius)] border p-5", className);
  const frameStyle = { borderColor: "var(--line)", background: "var(--surface)" };
  const heading = (
    <h2 className="text-[16px] font-semibold" style={{ color: "var(--ink)" }}>{title ?? t("mc.title")}</h2>
  );

  if (state === null) return null;
  if (state === "failed") {
    return (
      <section className={frame} style={frameStyle}>
        {heading}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13.5px]" style={{ color: "var(--ink-2)" }}>{t("mc.load_failed")}</p>
          <Button size="sm" icon={<RefreshCw size={13} className={retrying ? "animate-spin" : undefined} />} onClick={() => void retry()} disabled={retrying}>
            {t("mc.retry")}
          </Button>
        </div>
      </section>
    );
  }

  const rows = eventId != null ? state.rows.filter((c) => c.eventId === eventId) : state.rows;
  if (!rows.length) return null;

  const copy = async (c: MyCertificate) => {
    const url = verifyUrl(c.code);
    try {
      await navigator.clipboard.writeText(url);
      toast(t("mc.copied"), "success");
    } catch {
      toast(url, "info", 12000);
    }
  };

  return (
    <section className={frame} style={frameStyle} aria-label={title ?? t("mc.title")}>
      {heading}
      <p className="mt-0.5 text-[13px]" style={{ color: "var(--ink-3)" }}>{t("mc.hint")}</p>
      <ul className="mt-4 space-y-3">
        {rows.map((c) => {
          const name = certificateTitle(t, lang, c);
          const issued = c.issuedAt ? formatDate(c.issuedAt, lang, { day: "numeric", month: "long", year: "numeric" }) : "";
          return (
            <li key={c.code} className="rounded-[var(--radius-sm)] border p-4" style={{ borderColor: "var(--line)", background: "var(--surface-sunken)" }}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--accent-weak)", color: "var(--accent)" }}>
                  <KindIcon kind={c.kind} size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-semibold" style={{ color: "var(--ink)" }}>{name}</p>
                  <p className="mt-0.5 text-[13px]" style={{ color: "var(--ink-2)" }}>
                    {[c.eventName, c.teamName ? fill(t("mc.team"), { team: c.teamName }) : null, issued].filter(Boolean).join(" · ")}
                  </p>
                  {c.kind === "winner" && c.title ? <p className="mt-0.5 text-[13px]" style={{ color: "var(--ink-2)" }}>{c.title}</p> : null}
                  <p className="mt-1 font-mono text-[12px] tracking-[0.08em]" style={{ color: "var(--ink-3)" }}>{c.code}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <a href={publicPdfPath(c.code)} download {...buttonLook("primary", "sm")}>
                  <Download size={13} aria-hidden="true" /> {t("mc.download")}
                </a>
                <a href={verifyPath(c.code)} target="_blank" rel="noopener noreferrer" {...buttonLook("secondary", "sm")}>
                  <ExternalLink size={13} aria-hidden="true" /> {t("mc.open")}
                </a>
                <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => void copy(c)}>{t("mc.copy")}</Button>
                <a
                  href={linkedInAddUrl({ name: `${name} — ${c.eventName}`, organisation: c.eventName, issuedAt: c.issuedAt, code: c.code, url: verifyUrl(c.code) })}
                  target="_blank"
                  rel="noopener noreferrer"
                  {...buttonLook("ghost", "sm")}
                >
                  <Linkedin size={13} aria-hidden="true" /> {t("mc.linkedin")}
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
