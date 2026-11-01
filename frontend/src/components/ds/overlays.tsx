"use client";

/**
 * Overlays: modal, side drawer, confirm dialog and toasts.
 *
 * All four share the same rules — Escape closes, the backdrop closes, focus is
 * trapped inside while open, the page behind stops scrolling, and every one of
 * them announces itself to a screen reader. Getting that right once is the
 * reason they live together.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { Button, cx } from "./primitives";

/* ── Shared behaviour ──────────────────────────────────────────────────── */

/*
 * Overlays render into <body>. Inside the page they inherited its containing
 * block: an animated (transformed) wrapper turned `position: fixed` into
 * "fixed to the wrapper", so a drawer stopped short of the screen edges and
 * the backdrop left the navigation uncovered.
 */
/** The class names an overlay should be painted under, set by a surface with its own theme. */
export const OverlayScope = createContext<string>("");

export function Portal({ children }: { children: ReactNode }) {
  const scope = useContext(OverlayScope);
  if (typeof document === "undefined") return null;
  // Outside the page's own tree, an overlay would lose the theme the page is
  // painted in (the owner console's tokens live on its root, not on <body>).
  // A `display: contents` wrapper carries the scope without adding a box.
  return createPortal(
    scope ? <div className={scope} style={{ display: "contents" }}>{children}</div> : children,
    document.body,
  );
}

/** Stacking order: chat button 100 < modal / drawer 110 < confirm 120 < toasts 130. */
export const Z = { overlay: 110, confirm: 120, toast: 130 } as const;

function useDismissable(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab" || !ref.current) return;
      const focusables = ref.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // move focus in so keyboard users are not left behind the overlay
    window.setTimeout(() => {
      ref.current?.querySelector<HTMLElement>(
        'button,a[href],input,[tabindex]:not([tabindex="-1"])',
      )?.focus();
    }, 20);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return ref;
}

function Backdrop({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="hs-fade absolute inset-0"
      style={{ background: "var(--scrim, rgba(12, 14, 18, 0.45))" }}
      onClick={onClose}
      aria-hidden="true"
    />
  );
}

/* ── Modal ─────────────────────────────────────────────────────────────── */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const ref = useDismissable(open, onClose);
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <Portal>
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: Z.overlay }}>
      <Backdrop onClose={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="hs-scale-in relative w-full overflow-hidden rounded-[var(--radius)] border shadow-2xl"
        style={{
          maxWidth: width,
          background: "var(--surface)",
          borderColor: "var(--line-strong)",
        }}
      >
        <div
          className="flex items-start justify-between gap-4 border-b px-5 py-4"
          style={{ borderColor: "var(--line)" }}
        >
          <div className="min-w-0">
            <h2 className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-xs" style={{ color: "var(--ink-3)" }}>
                {description}
              </p>
            ) : null}
          </div>
          <button
            onClick={onClose}
            aria-label={t("Close")}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
            style={{ color: "var(--ink-3)" }}
          >
            <X size={16} />
          </button>
        </div>
        {children ? <div className="max-h-[62vh] overflow-y-auto px-5 py-4">{children}</div> : null}
        {footer ? (
          <div
            className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3.5"
            style={{ borderColor: "var(--line)", background: "var(--surface-sunken)" }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
    </Portal>
  );
}

/* ── Drawer ────────────────────────────────────────────────────────────── */

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 460,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const ref = useDismissable(open, onClose);
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <Portal>
    <div className="fixed inset-0" style={{ zIndex: Z.overlay }}>
      <Backdrop onClose={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="hs-slide-left absolute inset-y-0 right-0 flex w-full flex-col border-l shadow-2xl"
        style={{
          maxWidth: width,
          background: "var(--surface)",
          borderColor: "var(--line-strong)",
        }}
      >
        <div
          className="flex items-start justify-between gap-4 border-b px-5 py-4"
          style={{ borderColor: "var(--line)" }}
        >
          <div className="min-w-0">
            <h2 className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-xs" style={{ color: "var(--ink-3)" }}>
                {description}
              </p>
            ) : null}
          </div>
          <button
            onClick={onClose}
            aria-label={t("Close")}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
            style={{ color: "var(--ink-3)" }}
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div
            className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3.5"
            style={{ borderColor: "var(--line)", background: "var(--surface-sunken)" }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
    </Portal>
  );
}

/* ── Confirm ───────────────────────────────────────────────────────────── */

export function Confirm({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = "Confirm",
  destructive = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: string;
  confirmLabel?: string;
  destructive?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={440}
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={destructive ? "danger" : "primary"}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed" style={{ color: "var(--ink-2)" }}>
        {body}
      </p>
    </Modal>
  );
}

/* ── Toasts ────────────────────────────────────────────────────────────── */

type ToastTone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

const ToastCtx = createContext<{ push: (m: string, tone?: ToastTone) => void }>({
  push: () => {},
});

export const useToasts = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const push = useCallback((message: string, tone: ToastTone = "success") => {
    const id = ++seq.current;
    setItems((s) => [...s, { id, tone, message }]);
    window.setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 3600);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div
        className="toast-stack pointer-events-none fixed flex flex-col gap-2"
        style={{ zIndex: Z.toast }}
        aria-live="polite"
      >
        {items.map((t) => {
          const tone =
            t.tone === "error"
              ? { fg: "var(--danger)", bg: "var(--danger-weak)", Icon: AlertTriangle }
              : t.tone === "info"
                ? { fg: "var(--info)", bg: "var(--info-weak)", Icon: Info }
                : { fg: "var(--ok)", bg: "var(--ok-weak)", Icon: Check };
          const Icon = tone.Icon;
          return (
            <div
              key={t.id}
              className={cx(
                "hs-slide-left pointer-events-auto flex items-start gap-2.5 rounded-[var(--radius)] border px-3.5 py-3 shadow-lg",
              )}
              style={{ background: "var(--surface)", borderColor: "var(--line-strong)" }}
            >
              <span
                className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                style={{ background: tone.bg, color: tone.fg }}
              >
                <Icon size={12} />
              </span>
              <p className="text-sm" style={{ color: "var(--ink)" }}>
                {t.message}
              </p>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
