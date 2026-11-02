"use client";

/**
 * Form controls, panels and dialogs for the owner console's editors (the
 * event page and the stories), so every field has the same height, border,
 * label, hint, error and focus ring, in light and dark.
 *
 *   Section      a titled block of fields: description on the left on a
 *                wide screen, the fields on the right; stacked on a phone
 *   Field        label + control + hint or error (the error is announced)
 *   TextInput / TextArea / SelectInput / Toggle / Segmented
 *   SaveBar      sticky at the bottom while there are unsaved changes
 *   TypedConfirm a confirmation that asks for the event's name (or another
 *                phrase) before something that is hard to take back
 */

import { forwardRef, useId, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Button, cx } from "@/components/ds/primitives";
import { Modal } from "@/components/ds/overlays";

/* ── Layout ────────────────────────────────────────────────────────────── */

export function Section({
  id,
  title,
  description,
  children,
  aside,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-h` : undefined}
      className="scroll-mt-24 rounded-[var(--radius)] border"
      style={{ borderColor: "var(--line)", background: "var(--surface)" }}
    >
      <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:gap-10">
        <div className="min-w-0">
          <h2 id={id ? `${id}-h` : undefined} className="text-[15px] font-semibold tracking-[-0.01em]" style={{ color: "var(--ink)", fontFamily: "var(--font-display)" }}>
            {title}
          </h2>
          {description ? <div className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--ink-3)" }}>{description}</div> : null}
          {aside ? <div className="mt-3">{aside}</div> : null}
        </div>
        <div className="min-w-0 space-y-5">{children}</div>
      </div>
    </section>
  );
}

/** Two fields side by side from `sm` up. */
export function Pair({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">{children}</div>;
}

/* ── Fields ────────────────────────────────────────────────────────────── */

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  counter,
  optional = false,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  htmlFor: string;
  children: ReactNode;
  counter?: { value: number; max: number };
  optional?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-[13px] font-medium" style={{ color: "var(--ink)" }}>
          {label}
          {optional ? <span className="ml-1.5 text-[12px] font-normal" style={{ color: "var(--ink-3)" }}>optional</span> : null}
        </label>
        {counter ? (
          <span className="shrink-0 text-[11px] tabular-nums" style={{ color: counter.value > counter.max ? "var(--danger)" : "var(--ink-3)" }}>
            {counter.value}/{counter.max}
          </span>
        ) : null}
      </div>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="mt-1.5 flex items-start gap-1.5 text-[12.5px]" style={{ color: "var(--danger)" }}>
          <AlertTriangle size={13} className="mt-[2px] shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: "var(--ink-3)" }}>{hint}</p>
      ) : null}
    </div>
  );
}

const CONTROL =
  "w-full rounded-[var(--radius-sm)] border px-3 text-sm transition-[border-color,box-shadow] duration-150 " +
  "placeholder:text-[var(--ink-3)] hover:border-[var(--ink-3)] disabled:cursor-not-allowed disabled:opacity-60";

const controlStyle = (invalid?: boolean): React.CSSProperties => ({
  background: "var(--surface-sunken)",
  borderColor: invalid ? "var(--danger)" : "var(--line-strong)",
  color: "var(--ink)",
});

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; prefix?: string };

export const TextInput = forwardRef<HTMLInputElement, InputProps>(({ invalid, prefix, className, style, ...rest }, ref) => {
  const input = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      aria-describedby={rest.id ? `${rest.id}-${invalid ? "error" : "hint"}` : undefined}
      className={cx(CONTROL, "min-h-10", prefix ? "rounded-l-none" : "", className)}
      style={{ ...controlStyle(invalid), ...style }}
      {...rest}
    />
  );
  if (!prefix) return input;
  return (
    <div className="flex min-w-0">
      <span
        className="inline-flex shrink-0 items-center rounded-l-[var(--radius-sm)] border border-r-0 px-2.5 text-[13px]"
        style={{ borderColor: "var(--line-strong)", color: "var(--ink-3)", background: "var(--tint)", fontFamily: "var(--font-mono-ui)" }}
      >
        {prefix}
      </span>
      {input}
    </div>
  );
});
TextInput.displayName = "TextInput";

type AreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export const TextArea = forwardRef<HTMLTextAreaElement, AreaProps>(({ invalid, className, style, ...rest }, ref) => (
  <textarea
    ref={ref}
    aria-invalid={invalid || undefined}
    aria-describedby={rest.id ? `${rest.id}-${invalid ? "error" : "hint"}` : undefined}
    className={cx(CONTROL, "py-2.5 leading-relaxed", className)}
    style={{ ...controlStyle(invalid), ...style }}
    {...rest}
  />
));
TextArea.displayName = "TextArea";

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };

export const SelectInput = forwardRef<HTMLSelectElement, SelectProps>(({ invalid, className, style, children, ...rest }, ref) => (
  <select
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cx(CONTROL, "min-h-10 pr-8", className)}
    style={{ ...controlStyle(invalid), ...style }}
    {...rest}
  >
    {children}
  </select>
));
SelectInput.displayName = "SelectInput";

/** An on/off switch with its label and a line about what it does. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  id,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  const auto = useId();
  const labelId = `${id ?? auto}-label`;
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p id={labelId} className="text-[13.5px] font-medium" style={{ color: "var(--ink)" }}>{label}</p>
        {description ? <div className="mt-0.5 text-[12.5px] leading-relaxed" style={{ color: "var(--ink-3)" }}>{description}</div> : null}
      </div>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: checked ? "var(--accent-solid)" : "var(--line-strong)" }}
      >
        <span
          className="inline-block h-5 w-5 rounded-full shadow transition-transform duration-150 motion-reduce:transition-none"
          style={{ background: "#fff", transform: `translateX(${checked ? 22 : 2}px)` }}
        />
      </button>
    </div>
  );
}

/** One choice of a few, as a row of buttons (a radio group). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; hint?: string }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 3)}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className="min-h-10 rounded-[var(--radius-sm)] border px-3 py-2 text-left transition-colors"
            style={{
              borderColor: on ? "var(--accent)" : "var(--line-strong)",
              background: on ? "var(--accent-weak)" : "var(--surface-sunken)",
              color: "var(--ink)",
            }}
          >
            <span className="block text-[13px] font-medium">{o.label}</span>
            {o.hint ? <span className="mt-0.5 block text-[11.5px] leading-snug" style={{ color: "var(--ink-3)" }}>{o.hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/* ── Saving ────────────────────────────────────────────────────────────── */

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * The bar under an editor: what state the form is in and the buttons to
 * save or discard. Sticky at the bottom of the screen while there are
 * changes, so the owner never scrolls back up to save.
 */
export function SaveBar({
  state,
  onSave,
  onDiscard,
  message,
  saveLabel = "Save changes",
  count,
}: {
  state: SaveState;
  onSave: () => void;
  onDiscard: () => void;
  message?: string | null;
  saveLabel?: string;
  count?: number;
}) {
  const dirty = state === "dirty" || state === "saving" || state === "error";
  return (
    <div
      className={cx(
        "z-20 -mx-4 mt-6 border-t px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8",
        // Only in the way while there is something to save.
        dirty ? "sticky bottom-0 shadow-[0_-8px_24px_-16px_rgba(0,0,0,0.35)]" : "",
      )}
      style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--surface) 94%, transparent)", backdropFilter: "blur(8px)" }}
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-[13px]" style={{ color: state === "error" ? "var(--danger)" : "var(--ink-2)" }}>
          {state === "saving" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            : state === "saved" || state === "idle" ? <Check size={14} aria-hidden="true" style={{ color: "var(--ok)" }} />
              : state === "error" ? <AlertTriangle size={14} aria-hidden="true" />
                : <span className="h-2 w-2 rounded-full" style={{ background: "var(--warn)" }} aria-hidden="true" />}
          <span className="truncate">
            {message ?? (state === "saving" ? "Saving…"
              : state === "dirty" ? `Unsaved changes${count ? ` · ${count} field${count === 1 ? "" : "s"}` : ""}`
                : state === "error" ? "Not saved"
                  : "All changes saved")}
          </span>
        </p>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="ghost" onClick={onDiscard} disabled={!dirty || state === "saving"}>Discard</Button>
          <Button size="sm" variant="primary" onClick={onSave} loading={state === "saving"} disabled={!dirty || state === "saving"}>
            {saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Confirming ────────────────────────────────────────────────────────── */

/**
 * "Type the event's name to archive it." The button stays off until the
 * phrase matches (spaces at the ends and letter case do not matter). Without
 * `phrase` it is a plain, clearly worded confirmation.
 */
export function TypedConfirm(props: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: ReactNode;
  phrase?: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
}) {
  // Mounted only while open, so the typed phrase starts empty every time.
  return props.open ? <ConfirmDialog {...props} /> : null;
}

function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  phrase,
  confirmLabel,
  destructive = false,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: ReactNode;
  phrase?: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
}) {
  const [typed, setTyped] = useState("");
  const id = useId();
  const matches = !phrase || typed.trim().toLowerCase() === phrase.trim().toLowerCase();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={480}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" variant={destructive ? "danger" : "primary"} disabled={!matches || busy} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm leading-relaxed" style={{ color: "var(--ink-2)" }}>
        <div>{body}</div>
        {phrase ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (matches && !busy) onConfirm();
            }}
          >
            <label htmlFor={id} className="mb-1.5 block text-[13px]" style={{ color: "var(--ink)" }}>
              Type <strong className="select-all font-semibold">{phrase}</strong> to confirm
            </label>
            <TextInput id={id} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
          </form>
        ) : null}
      </div>
    </Modal>
  );
}
