"use client";

/**
 * "Are you sure?" before something that cannot be taken back. Rendered into
 * <body> above drawers and modals (it is often opened from one), closes on
 * Escape or the backdrop, and puts focus on the safe choice so a stray Enter
 * does not confirm.
 */

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Portal, Z } from "@/components/ds/overlays";
import { useTranslation } from "@/contexts/LanguageContext";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    // Capture phase: Escape closes this dialog, not the drawer under it.
    document.addEventListener("keydown", onKey, true);
    const timer = window.setTimeout(() => cancelRef.current?.focus(), 20);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      window.clearTimeout(timer);
    };
  }, [open, onCancel]);

  if (!open) return null;
  const isDanger = variant === "danger";

  return (
    <Portal>
      <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: Z.confirm }}>
        <div className="absolute inset-0" style={{ background: "rgba(12, 14, 18, 0.55)" }} onClick={onCancel} aria-hidden="true" />
        <div
          className="relative w-full max-w-sm rounded-2xl border p-6 shadow-xl"
          style={{ background: "var(--surface)", borderColor: "var(--line-strong)" }}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          aria-describedby="confirm-message"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <h3 id="confirm-title" className="text-base font-semibold" style={{ color: "var(--ink)" }}>
              {title}
            </h3>
            <button onClick={onCancel} className="rounded-lg p-1" style={{ color: "var(--ink-3)" }} aria-label={t("Close")}>
              <X size={18} />
            </button>
          </div>
          <p id="confirm-message" className="mb-6 text-[15px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{message}</p>
          <div className="flex gap-3">
            <button
              ref={cancelRef}
              onClick={onCancel}
              className="flex-1 rounded-lg border px-4 py-2.5 text-[15px] font-medium transition-colors"
              style={{ borderColor: "var(--line-strong)", color: "var(--ink)", background: "var(--surface)" }}
            >
              {cancelLabel ?? t("Cancel")}
            </button>
            <button
              onClick={() => {
                onConfirm();
                onCancel();
              }}
              className="flex-1 rounded-lg px-4 py-2.5 text-[15px] font-medium text-white transition-opacity hover:opacity-90"
              style={{ background: isDanger ? "var(--danger)" : "var(--accent-solid)" }}
            >
              {confirmLabel ?? t("Confirm")}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
