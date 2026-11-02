"use client";

/**
 * The platform owner's notice for every page — maintenance tonight, an
 * incident being worked on (GET /api/public/notice; the owner writes it in
 * the console under Settings).
 *
 * Read with a plain fetch rather than the API client: the notice is public
 * and needs no session, so it also shows on the walkthrough, whose client
 * answers reads from sample data. Kept for a minute in sessionStorage, so
 * moving between pages does not ask again. Any failure shows nothing — a
 * notice that cannot be read must never break the page under it.
 *
 * Info and warning notices can be dismissed for the rest of the session
 * (until the owner changes the notice); a critical one stays.
 */

import { useEffect, useState } from "react";
import { AlertOctagon, AlertTriangle, Info, X } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { resolve, type Lang } from "@/lib/i18n";
import { formatDate } from "@/lib/i18n/dates";
import { fill } from "@/lib/i18n/fill";
import { noticeText, parsePublicNotice as parseNotice, type NoticeLevel, type PublicNotice } from "@/lib/superadmin/owner";

const CACHE_KEY = "hh_platform_notice";
const DISMISS_KEY = "hh_platform_notice_dismissed";
const CACHE_MS = 60_000;

function readCache(): { notice: PublicNotice | null } | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at?: number; notice?: unknown };
    if (!v || typeof v.at !== "number" || Date.now() - v.at > CACHE_MS) return null;
    return { notice: parseNotice(v.notice) };
  } catch {
    return null;
  }
}

function writeCache(notice: PublicNotice | null) {
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), notice }));
  } catch {
    /* private mode: ask again next time */
  }
}

const CHANGED = "hackos:notice-changed";

/**
 * The console's settings page calls this after saving: the kept copy is
 * dropped and the banners on the page read the notice again, so the owner
 * sees the change at once.
 */
export function forgetNoticeCache() {
  try {
    window.sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* nothing kept */
  }
  window.dispatchEvent(new Event(CHANGED));
}

let inFlight: Promise<PublicNotice | null> | null = null;

async function fetchNotice(): Promise<PublicNotice | null> {
  const cached = readCache();
  if (cached) return cached.notice;
  if (!inFlight) {
    inFlight = fetch("/api/public/notice", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return null;
        const body = (await res.json().catch(() => null)) as { success?: boolean; data?: unknown } | null;
        const notice = body?.success ? parseNotice(body.data) : null;
        writeCache(notice);
        return notice;
      })
      .catch(() => null)
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

const dismissKeyOf = (n: PublicNotice) => `${n.level}:${n.updatedAt ?? ""}`;

function readDismissed(): string | null {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

const LOOK: Record<NoticeLevel, { fg: string; bg: string; Icon: typeof Info }> = {
  info: { fg: "var(--info)", bg: "var(--info-weak)", Icon: Info },
  warning: { fg: "var(--warn)", bg: "var(--warn-weak)", Icon: AlertTriangle },
  critical: { fg: "var(--danger)", bg: "var(--danger-weak)", Icon: AlertOctagon },
};

const asLang = (lang: string): Lang => (lang === "az" || lang === "ru" ? lang : "en");

/**
 * What the notice looks like, on its own: the page banner and the console's
 * preview share it. Its own words follow `lang`, so the preview reads the
 * way the page will in the language being previewed.
 */
export function NoticeBanner({
  level,
  text,
  endsAt,
  lang,
  onDismiss,
  className = "",
}: {
  level: NoticeLevel;
  text: string;
  endsAt?: string | null;
  lang: string;
  onDismiss?: () => void;
  className?: string;
}) {
  const t = (key: string) => resolve(asLang(lang), key);
  const look = LOOK[level];
  const Icon = look.Icon;
  const until = endsAt
    ? formatDate(endsAt, lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    : "";
  return (
    <div
      role={level === "critical" ? "alert" : "status"}
      className={`flex w-full items-start gap-3 rounded-[var(--radius-sm)] border px-4 py-3 text-[13.5px] leading-relaxed ${className}`}
      style={{ background: look.bg, borderColor: `color-mix(in srgb, ${look.fg} 35%, transparent)`, color: "var(--ink)" }}
    >
      <Icon size={17} className="mt-0.5 shrink-0" style={{ color: look.fg }} aria-hidden="true" />
      <p className="min-w-0 flex-1 break-words">
        <span className="sr-only">{t(`pn.label.${level}`)}: </span>
        {text}
        {until ? (
          <span className="ml-1.5 whitespace-nowrap text-[12.5px]" style={{ color: "var(--ink-2)" }}>
            · {fill(t("pn.until"), { time: until })}
          </span>
        ) : null}
      </p>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="-m-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--tint)]"
          style={{ color: "var(--ink-2)" }}
          aria-label={t("pn.dismiss")}
          title={t("pn.dismiss")}
        >
          <X size={15} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * The live notice, or nothing. `className` places the banner in the page
 * around it (a shell's content column); `frame`, when given, is a wrapper
 * drawn only while there is a notice (the site's gutters above its header),
 * so an empty notice never leaves a gap.
 */
export function PlatformNotice({ className = "mb-4", frame }: { className?: string; frame?: string }) {
  const { lang } = useTranslation();
  const [notice, setNotice] = useState<PublicNotice | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const read = () => {
      void fetchNotice().then((n) => {
        if (cancelled) return;
        setDismissed(readDismissed());
        setNotice(n);
      });
    };
    read();
    window.addEventListener(CHANGED, read);
    return () => {
      cancelled = true;
      window.removeEventListener(CHANGED, read);
    };
  }, []);

  if (!notice) return null;
  const key = dismissKeyOf(notice);
  if (notice.level !== "critical" && dismissed === key) return null;
  const text = noticeText(notice.message, lang);
  if (!text) return null;

  const dismiss =
    notice.level === "critical"
      ? undefined
      : () => {
          setDismissed(key);
          try {
            window.sessionStorage.setItem(DISMISS_KEY, key);
          } catch {
            /* dismissed for this page only */
          }
        };

  const banner = (
    <NoticeBanner
      level={notice.level}
      text={text}
      endsAt={notice.endsAt}
      lang={lang}
      onDismiss={dismiss}
      className={className}
    />
  );
  return frame ? <div className={frame}>{banner}</div> : banner;
}
