"use client";

import { useEffect } from "react";
import { Check, X, AlertCircle, Info } from "lucide-react";
import { useToast, type Toast } from "@/contexts/ToastContext";
import { useTranslation } from "@/contexts/LanguageContext";

const icons = {
  success: Check,
  error: X,
  warning: AlertCircle,
  info: Info,
};

/*
 * A toast is read over whatever is under it, so it sits on a solid surface
 * (the old see-through tints left page text showing through the message) and
 * carries its kind in the icon and a coloured edge. On phones it stays above
 * the bottom navigation instead of covering it.
 */
const accent = {
  success: "var(--ok)",
  error: "var(--danger)",
  warning: "var(--warn)",
  info: "var(--info)",
};

export function ToastContainer() {
  const { toasts, removeToast } = useToast();

  return (
    <div
      className="toast-stack pointer-events-none fixed z-[130] flex flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} item={t} onClose={() => removeToast(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({
  item,
  onClose,
}: {
  item: Toast;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const Icon = icons[item.type];
  const color = accent[item.type];

  useEffect(() => {
    if (item.duration && item.duration > 0) {
      const timer = setTimeout(onClose, item.duration);
      return () => clearTimeout(timer);
    }
  }, [item.duration, onClose]);

  return (
    <div
      className="pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg animate-fade-in-up"
      style={{ background: "var(--surface)", borderColor: "var(--line-strong)", borderLeft: `4px solid ${color}`, color: "var(--ink)" }}
      role={item.type === "error" ? "alert" : "status"}
    >
      <Icon size={18} className="mt-0.5 shrink-0" style={{ color }} aria-hidden="true" />
      <span className="min-w-0 flex-1 text-[14.5px] font-medium leading-snug">{item.message}</span>
      <button
        onClick={onClose}
        className="-mr-1 shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
        style={{ color: "var(--ink-2)" }}
        aria-label={t("Close")}
      >
        <X size={14} />
      </button>
    </div>
  );
}
