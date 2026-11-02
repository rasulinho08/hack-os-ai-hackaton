"use client";

/**
 * A photo over the whole screen, one at a time: ← / → (or a swipe) for the
 * others, Escape or the backdrop to close. Focus stays inside while it is
 * open and goes back to the thumbnail that opened it. Used by the stories
 * and by the event galleries; the words come from the page (props), so it
 * works with the site's copy objects and with t() alike.
 */

import { useCallback, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { Portal } from "@/components/ds/overlays";

export interface LightboxPhoto {
  url: string;
  /** What the photo shows (its caption, or a fallback such as "Photo 3"). */
  alt: string;
  caption?: string | null;
  /** Offer a download link for this photo. */
  download?: boolean;
  /** The name to save it under; without one the file keeps the name it was uploaded with. */
  downloadName?: string;
}

export interface LightboxLabels {
  dialog: string;
  close: string;
  prev: string;
  next: string;
  /** "{i} of {n}" */
  position: string;
  download?: string;
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function PhotoLightbox({
  photos,
  index,
  onIndex,
  onClose,
  labels,
}: {
  photos: LightboxPhoto[];
  /** The photo shown; null when closed. */
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  labels: LightboxLabels;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchX = useRef<number | null>(null);
  const n = photos.length;
  const open = index != null && index >= 0 && index < n;
  const photo = open ? photos[index] : null;

  const go = useCallback(
    (dir: -1 | 1) => {
      if (index == null || n < 2) return;
      onIndex((index + dir + n) % n);
    },
    [index, n, onIndex],
  );

  // Opening: no page scroll behind it, focus on Close; closing: focus back where it was.
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      } else if (e.key === "Tab" && dialogRef.current) {
        const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        const inside = dialogRef.current.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === first || !inside)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, go, onClose]);

  // The neighbours load while this one is looked at.
  useEffect(() => {
    if (index == null || n < 2) return;
    for (const j of [(index + 1) % n, (index - 1 + n) % n]) {
      const img = new Image();
      img.src = photos[j].url;
    }
  }, [index, n, photos]);

  if (!open || !photo) return null;
  const position = labels.position.replace("{i}", String(index + 1)).replace("{n}", String(n));

  return (
    <Portal>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={labels.dialog}
        className="fixed inset-0 flex flex-col"
        style={{ zIndex: 140, background: "rgba(8, 9, 12, 0.94)", color: "#F4F2EE" }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        onTouchStart={(e) => {
          touchX.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          const start = touchX.current;
          touchX.current = null;
          const end = e.changedTouches[0]?.clientX;
          if (start == null || end == null) return;
          if (Math.abs(end - start) > 50) go(end < start ? 1 : -1);
        }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6" onClick={(e) => e.stopPropagation()}>
          <p className="text-[13px] tabular-nums opacity-80" aria-live="polite">{position}</p>
          <div className="flex items-center gap-1.5">
            {photo.download && labels.download ? (
              <a
                href={photo.url}
                download={photo.downloadName ?? ""}
                className="inline-flex h-10 items-center gap-2 rounded-full px-3.5 text-[13px] font-medium transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <Download size={16} aria-hidden="true" />
                <span>{labels.download}</span>
              </a>
            ) : null}
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label={labels.close}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div
          className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img key={photo.url} src={photo.url} alt={photo.alt} className="max-h-full max-w-full select-none object-contain" draggable={false} />
          {n > 1 ? (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label={labels.prev}
                className="absolute left-2 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:left-4"
              >
                <ChevronLeft size={22} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label={labels.next}
                className="absolute right-2 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:right-4"
              >
                <ChevronRight size={22} aria-hidden="true" />
              </button>
            </>
          ) : null}
        </div>

        <div className="min-h-[56px] px-4 pb-5 pt-3 text-center sm:px-6" onClick={(e) => e.stopPropagation()}>
          {photo.caption ? <p className="mx-auto max-w-3xl text-[14.5px] leading-relaxed opacity-90">{photo.caption}</p> : null}
        </div>
      </div>
    </Portal>
  );
}
