"use client";

/**
 * The page the shared link opens: an event's photos, for the people who
 * took part in it (approved participants, judges, mentors, volunteers).
 * Anyone signed out is asked to sign in and comes back here; anyone else is
 * told the gallery is only for the event's people — the API answers them
 * as if there were no such event, so this page never says whether one exists.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, ImageOff, Lock, LogIn, RefreshCw } from "lucide-react";
import { PhotoLightbox, type LightboxPhoto } from "@/components/site/PhotoLightbox";
import { useTranslation } from "@/contexts/LanguageContext";
import { ApiError } from "@/lib/api";
import { galleryApi, galleryPagePath, type GalleryView } from "@/lib/gallery";
import { LANGUAGES } from "@/lib/i18n";
import { fill } from "@/lib/i18n/fill";
import { formatDateRange } from "@/lib/showcase";

type State =
  | { kind: "loading" }
  | { kind: "ok"; view: GalleryView }
  | { kind: "signin" }
  | { kind: "not_member" }
  | { kind: "off" }
  | { kind: "failed" };

function stateFor(err: unknown): State {
  if (err instanceof ApiError) {
    if (err.status === 401) return { kind: "signin" };
    if (err.status === 404) return { kind: "not_member" };
    if (err.code === "MODULE_DISABLED") return { kind: "off" };
  }
  return { kind: "failed" };
}

export function GalleryMembersView({ slug }: { slug: string }) {
  const { t, lang, setLang } = useTranslation();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [viewing, setViewing] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    galleryApi.bySlug(slug).then(
      (view) => { if (!cancelled) setState(view ? { kind: "ok", view } : { kind: "failed" }); },
      (err) => { if (!cancelled) setState(stateFor(err)); },
    );
    return () => { cancelled = true; };
  }, [slug, attempt]);

  const retry = () => {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  };

  const view = state.kind === "ok" ? state.view : null;
  const eventHref = `/e/${encodeURIComponent(slug)}`;
  const items = view?.items ?? [];
  const alt = (i: number) => items[i]?.caption || fill(t("gl.photo_alt"), { i: i + 1, event: view?.eventName ?? "" });
  const photos: LightboxPhoto[] = items.map((p, i) => ({ url: p.url, alt: alt(i), caption: p.caption, download: true }));
  const dates = view ? formatDateRange(view.startDate?.slice(0, 10) ?? null, view.endDate?.slice(0, 10) ?? null, lang) : "";

  return (
    <div className="hs min-h-dvh" style={{ background: "var(--surface-sunken)", color: "var(--ink)" }}>
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-5 sm:px-6">
        <Link href={eventHref} className="inline-flex min-h-10 items-center gap-2 rounded-full px-1 text-[14px] font-medium" style={{ color: "var(--ink-2)" }}>
          <ArrowLeft size={16} aria-hidden="true" />
          <span className="truncate">{view?.eventName || t("gl.m.event_page")}</span>
        </Link>
        <div role="group" aria-label={t("ep.language")} className="inline-flex rounded-full p-0.5" style={{ background: "var(--tint)" }}>
          {LANGUAGES.map((l) => (
            <button key={l.code} type="button" onClick={() => setLang(l.code)} aria-pressed={lang === l.code} lang={l.code}
              className="min-h-8 rounded-full px-2.5 text-[11.5px] font-semibold uppercase"
              style={{ background: lang === l.code ? "var(--surface)" : "transparent", color: lang === l.code ? "var(--ink)" : "var(--ink-2)" }}>
              {l.code}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
        {state.kind === "loading" ? (
          <div aria-busy="true">
            <div className="hs-skeleton h-10 w-2/3 max-w-md rounded-lg" />
            <div className="hs-skeleton mt-3 h-4 w-1/3 max-w-xs rounded" />
            <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="hs-skeleton aspect-[4/3] rounded-[16px]" />)}
            </div>
          </div>
        ) : state.kind === "signin" ? (
          <Message icon={<Lock size={20} />} title={t("gl.m.signin_title")} body={t("gl.m.signin_body")}>
            <Link href={`/login?next=${encodeURIComponent(galleryPagePath(slug))}`} className="hs-pill hs-pill-primary">
              <LogIn size={17} aria-hidden="true" />
              {t("gl.m.signin")}
            </Link>
          </Message>
        ) : state.kind === "not_member" ? (
          <Message icon={<Lock size={20} />} title={t("gl.m.not_member_title")} body={t("gl.m.not_member_body")}>
            <Link href={eventHref} className="hs-pill hs-pill-ghost">{t("gl.m.event_page")}</Link>
          </Message>
        ) : state.kind === "off" ? (
          <Message icon={<ImageOff size={20} />} title={t("gl.m.off_title")} body={t("gl.m.off_body")}>
            <Link href={eventHref} className="hs-pill hs-pill-ghost">{t("gl.m.event_page")}</Link>
          </Message>
        ) : state.kind === "failed" ? (
          <Message icon={<RefreshCw size={20} />} title={t("gl.m.load_failed")}>
            <button type="button" onClick={retry} className="hs-pill hs-pill-ghost">{t("gl.m.retry")}</button>
          </Message>
        ) : view ? (
          <>
            <h1 className="text-[clamp(30px,4.2vw,52px)] font-semibold leading-[1.05] tracking-[-0.035em] [text-wrap:balance]" style={{ color: "var(--ink)" }}>
              {fill(t("gl.m.title"), { event: view.eventName })}
            </h1>
            <p className="mt-3 text-[15px]" style={{ color: "var(--ink-2)" }}>
              {[dates, items.length ? fill(t("gl.m.count"), { n: items.length }) : null].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-1 text-[13px]" style={{ color: "var(--ink-3)" }}>{t("gl.m.sub")}</p>

            {items.length === 0 ? (
              <div className="mt-10">
                <Message icon={<ImageOff size={20} />} title={t("gl.m.empty_title")} body={t("gl.m.empty_body")} />
              </div>
            ) : (
              <ul className="mt-10 columns-2 gap-3 sm:columns-3 lg:columns-4 [&>li]:mb-3">
                {items.map((p, i) => (
                  <li key={p.id} className="break-inside-avoid">
                    <figure className="group relative overflow-hidden rounded-[16px] border" style={{ borderColor: "var(--line)", background: "var(--surface)" }}>
                      <button type="button" onClick={() => setViewing(i)} aria-label={fill(t("gl.lb.open"), { i: i + 1 })}
                        className="block w-full focus-visible:outline-2 focus-visible:outline-offset-[-3px]" style={{ outlineColor: "var(--accent)" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt={alt(i)} loading="lazy" decoding="async" className="block h-auto w-full" style={{ background: "var(--tint)" }} />
                      </button>
                      <a href={p.url} download="" aria-label={`${t("gl.lb.download")}: ${alt(i)}`} title={t("gl.lb.download")}
                        className="absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-full opacity-90 transition-opacity hover:opacity-100 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                        style={{ background: "rgba(12,14,18,0.62)", color: "#fff" }}>
                        <Download size={16} aria-hidden="true" />
                      </a>
                      {p.caption ? (
                        <figcaption className="px-3 py-2 text-[13px] leading-snug" style={{ color: "var(--ink-2)" }}>{p.caption}</figcaption>
                      ) : null}
                    </figure>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </main>

      <PhotoLightbox
        photos={photos}
        index={viewing}
        onIndex={setViewing}
        onClose={() => setViewing(null)}
        labels={{
          dialog: t("gl.lb.dialog"), close: t("gl.lb.close"), prev: t("gl.lb.prev"), next: t("gl.lb.next"),
          position: t("gl.lb.position"), download: t("gl.lb.download"),
        }}
      />
    </div>
  );
}

function Message({ icon, title, body, children }: { icon: React.ReactNode; title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="hs-card mx-auto max-w-lg px-6 py-10 text-center sm:px-10">
      <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "var(--tint)", color: "var(--ink-2)" }}>
        {icon}
      </span>
      <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>{title}</h1>
      {body ? <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{body}</p> : null}
      {children ? <div className="mt-6 flex flex-wrap justify-center gap-3">{children}</div> : null}
    </div>
  );
}
