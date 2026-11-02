"use client";

/**
 * Form pieces of the event builder. They read the shared design tokens
 * (--surface, --ink, --line, --accent-solid …) so the builder sits inside the
 * product's look, and every input carries its label, help and error so a
 * screen reader hears the same thing the eye sees.
 */

import { useId, useState, type ReactNode } from "react";
import { Lock, Minus, Plus, Sparkles, X } from "lucide-react";
import { cx } from "@/components/ds/primitives";
import { fromZonedInput, toZonedInput } from "@/lib/builder/datetime";

export const inputClass =
  "block w-full rounded-[10px] border px-3 py-2.5 text-[14px] outline-none transition-[border-color,box-shadow] duration-150 " +
  "focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60";
export const inputStyle = (error?: string | null): React.CSSProperties => ({
  background: "var(--surface)",
  color: "var(--ink)",
  borderColor: error ? "var(--danger)" : "var(--line-strong)",
  ["--tw-ring-color" as string]: error ? "var(--danger-weak)" : "var(--accent-weak)",
});

export function Field({
  label, help, error, required, optional, children, id, className, aside,
}: {
  label: ReactNode;
  help?: ReactNode;
  error?: string | null;
  required?: boolean;
  optional?: string;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
  id?: string;
  className?: string;
  aside?: ReactNode;
}) {
  const auto = useId();
  const fid = id || auto;
  const helpId = help ? `${fid}-help` : undefined;
  const errId = error ? `${fid}-err` : undefined;
  return (
    <div className={cx("min-w-0", className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={fid} className="text-[13px] font-medium" style={{ color: "var(--ink)" }}>
          {label}
          {required ? <span aria-hidden="true" style={{ color: "var(--accent)" }}> *</span> : null}
          {optional ? <span className="font-normal" style={{ color: "var(--ink-3)" }}> · {optional}</span> : null}
        </label>
        {aside}
      </div>
      {children({ id: fid, describedBy: [errId, helpId].filter(Boolean).join(" ") || undefined, invalid: Boolean(error) })}
      {error ? (
        <p id={errId} role="alert" className="mt-1.5 text-[12.5px]" style={{ color: "var(--danger)" }}>{error}</p>
      ) : help ? (
        <p id={helpId} className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: "var(--ink-3)" }}>{help}</p>
      ) : null}
    </div>
  );
}

export function TextInput({
  label, value, onChange, help, error, required, optional, placeholder, maxLength, type = "text", inputMode, autoComplete, className, prefix,
}: {
  label: ReactNode;
  value: string | null | undefined;
  onChange: (v: string) => void;
  help?: ReactNode;
  error?: string | null;
  required?: boolean;
  optional?: string;
  placeholder?: string;
  maxLength?: number;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  className?: string;
  prefix?: string;
}) {
  return (
    <Field label={label} help={help} error={error} required={required} optional={optional} className={className}
      aside={maxLength ? <span className="text-[11.5px] tabular-nums" style={{ color: "var(--ink-3)" }}>{(value || "").length}/{maxLength}</span> : undefined}>
      {({ id, describedBy, invalid }) => (
        <div className="flex items-stretch">
          {prefix ? (
            <span className="flex items-center rounded-l-[10px] border border-r-0 px-3 text-[13px]" style={{ borderColor: "var(--line-strong)", color: "var(--ink-3)", background: "var(--surface-sunken)" }}>
              {prefix}
            </span>
          ) : null}
          <input
            id={id}
            type={type}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            maxLength={maxLength}
            inputMode={inputMode}
            autoComplete={autoComplete}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cx(inputClass, prefix && "rounded-l-none")}
            style={inputStyle(error)}
          />
        </div>
      )}
    </Field>
  );
}

export function TextArea({
  label, value, onChange, help, error, required, optional, placeholder, rows = 5, maxLength, className,
}: {
  label: ReactNode;
  value: string | null | undefined;
  onChange: (v: string) => void;
  help?: ReactNode;
  error?: string | null;
  required?: boolean;
  optional?: string;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  className?: string;
}) {
  return (
    <Field label={label} help={help} error={error} required={required} optional={optional} className={className}
      aside={maxLength ? <span className="text-[11.5px] tabular-nums" style={{ color: "var(--ink-3)" }}>{(value || "").length}/{maxLength}</span> : undefined}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          maxLength={maxLength}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cx(inputClass, "resize-y leading-relaxed")}
          style={inputStyle(error)}
        />
      )}
    </Field>
  );
}

export function Select({
  label, value, onChange, options, help, error, required, optional, className, placeholder,
}: {
  label: ReactNode;
  value: string | null | undefined;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  help?: ReactNode;
  error?: string | null;
  required?: boolean;
  optional?: string;
  className?: string;
  placeholder?: string;
}) {
  return (
    <Field label={label} help={help} error={error} required={required} optional={optional} className={className}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cx(inputClass, "appearance-auto")}
          style={inputStyle(error)}
        >
          {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}

/** A row of mutually exclusive choices, each with an optional line of explanation. */
export function Segmented<T extends string>({
  label, value, onChange, options, help, error, columns,
}: {
  label?: ReactNode;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; hint?: string; icon?: ReactNode; disabled?: boolean }[];
  help?: ReactNode;
  error?: string | null;
  columns?: 2 | 3 | 4;
}) {
  const gid = useId();
  const cols = columns || (options.length >= 4 ? 4 : options.length === 3 ? 3 : 2);
  return (
    <div role="radiogroup" aria-labelledby={label ? `${gid}-l` : undefined} className="min-w-0">
      {label ? <p id={`${gid}-l`} className="mb-1.5 text-[13px] font-medium" style={{ color: "var(--ink)" }}>{label}</p> : null}
      <div className={cx("grid gap-2", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-3", cols === 4 && "sm:grid-cols-2 lg:grid-cols-4")}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={o.disabled}
              onClick={() => onChange(o.value)}
              className="flex min-h-11 flex-col items-start gap-1 rounded-[12px] border px-3.5 py-2.5 text-left transition-[border-color,box-shadow,background] duration-150 disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                borderColor: on ? "var(--accent-solid)" : "var(--line-strong)",
                background: on ? "var(--accent-weak)" : "var(--surface)",
                boxShadow: on ? "0 0 0 1px var(--accent-solid) inset" : "none",
              }}
            >
              <span className="flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>
                {o.icon}
                {o.label}
              </span>
              {o.hint ? <span className="text-[12px] leading-snug" style={{ color: "var(--ink-2)" }}>{o.hint}</span> : null}
            </button>
          );
        })}
      </div>
      {error ? <p role="alert" className="mt-1.5 text-[12.5px]" style={{ color: "var(--danger)" }}>{error}</p>
        : help ? <p className="mt-1.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>{help}</p> : null}
    </div>
  );
}

/** An on/off switch with a label and a line of explanation. */
export function Toggle({
  label, checked, onChange, help, disabled, compact,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  help?: ReactNode;
  disabled?: boolean;
  compact?: boolean;
}) {
  const id = useId();
  return (
    <div className={cx("flex items-start justify-between gap-4", compact ? "py-1" : "py-2")}>
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13.5px] font-medium" style={{ color: disabled ? "var(--ink-3)" : "var(--ink)" }}>{label}</label>
        {help ? <p className="mt-0.5 text-[12.5px] leading-relaxed" style={{ color: "var(--ink-3)" }}>{help}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative mt-0.5 shrink-0 rounded-full p-0 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        // Sized inline: the app gives every button in <main> a 40px minimum on phones.
        style={{ background: checked ? "var(--accent-solid)" : "var(--line-strong)", outlineColor: "var(--accent)", width: 44, height: 24, minHeight: 24 }}
      >
        <span
          aria-hidden="true"
          className="absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-150"
          style={{ transform: checked ? "translateX(22px)" : "translateX(2px)" }}
        />
      </button>
    </div>
  );
}

/** A whole number with − / + buttons; empty means "none" when `nullable`. */
export function NumberStepper({
  label, value, onChange, min, max, step = 1, help, error, nullable, nullLabel, suffix, className,
}: {
  label: ReactNode;
  value: number | null;
  onChange: (v: number | null) => void;
  min: number;
  max: number;
  step?: number;
  help?: ReactNode;
  error?: string | null;
  nullable?: boolean;
  nullLabel?: string;
  suffix?: string;
  className?: string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <Field label={label} help={help} error={error} className={className}>
      {({ id, describedBy, invalid }) => (
        <div className="flex items-center gap-2">
          <button type="button" aria-label="−" onClick={() => onChange(value == null ? min : clamp(value - step))}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border" style={{ borderColor: "var(--line-strong)", color: "var(--ink)" }}>
            <Minus size={15} />
          </button>
          <input
            id={id}
            inputMode="numeric"
            value={value == null ? "" : String(value)}
            placeholder={nullable ? nullLabel : undefined}
            onChange={(e) => {
              const raw = e.target.value.replace(/\D/g, "");
              if (!raw) { onChange(nullable ? null : min); return; }
              onChange(clamp(Number(raw)));
            }}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cx(inputClass, "w-28 text-center tabular-nums")}
            style={inputStyle(error)}
          />
          <button type="button" aria-label="+" onClick={() => onChange(value == null ? min : clamp(value + step))}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border" style={{ borderColor: "var(--line-strong)", color: "var(--ink)" }}>
            <Plus size={15} />
          </button>
          {suffix ? <span className="text-[13px]" style={{ color: "var(--ink-2)" }}>{suffix}</span> : null}
          {nullable && value != null ? (
            <button type="button" onClick={() => onChange(null)} className="ml-1 text-[12.5px] underline-offset-2 hover:underline" style={{ color: "var(--ink-3)" }}>
              {nullLabel}
            </button>
          ) : null}
        </div>
      )}
    </Field>
  );
}

/** A date and time on the event's own wall clock. */
export function DateTimeInput({
  label, value, onChange, timeZone, zoneLabel, help, error, required, optional, className, id,
}: {
  /** The input's id, for links to it (the publish checklist). */
  id?: string;
  label: ReactNode;
  value: string | null;
  onChange: (iso: string | null) => void;
  timeZone: string;
  zoneLabel: string;
  help?: ReactNode;
  error?: string | null;
  required?: boolean;
  optional?: string;
  className?: string;
}) {
  return (
    <Field label={label} help={help} error={error} required={required} optional={optional} className={className} id={id}
      aside={<span className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>{zoneLabel}</span>}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          type="datetime-local"
          value={toZonedInput(value, timeZone)}
          onChange={(e) => onChange(e.target.value ? fromZonedInput(e.target.value, timeZone) : null)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={inputClass}
          style={inputStyle(error)}
        />
      )}
    </Field>
  );
}

/** Free-form tags (cities, options): type and press Enter, click × to remove. */
export function ChipsInput({
  label, values, onChange, placeholder, help, error, max = 50,
}: {
  label: ReactNode;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  help?: ReactNode;
  error?: string | null;
  max?: number;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v || values.some((x) => x.toLowerCase() === v.toLowerCase()) || values.length >= max) { setDraft(""); return; }
    onChange([...values, v]);
    setDraft("");
  };
  return (
    <Field label={label} help={help} error={error}>
      {({ id, describedBy, invalid }) => (
        <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-[10px] border px-2 py-1.5" style={inputStyle(error)}>
          {values.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px]" style={{ background: "var(--tint)", color: "var(--ink)" }}>
              {v}
              <button type="button" aria-label={`× ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="opacity-70 hover:opacity-100">
                <X size={12} />
              </button>
            </span>
          ))}
          <input
            id={id}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
              if (e.key === "Backspace" && !draft && values.length) onChange(values.slice(0, -1));
            }}
            onBlur={add}
            placeholder={values.length ? "" : placeholder}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-[14px] outline-none"
            style={{ color: "var(--ink)" }}
          />
        </div>
      )}
    </Field>
  );
}

export function Card({ title, description, children, actions, tone }: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  tone?: "default" | "muted";
}) {
  return (
    <section className="rounded-[16px] border p-4 sm:p-5" style={{ borderColor: "var(--line)", background: tone === "muted" ? "var(--surface-sunken)" : "var(--surface)" }}>
      {title || actions ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? <h3 className="text-[15px] font-semibold" style={{ color: "var(--ink)" }}>{title}</h3> : null}
            {description ? <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{description}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function Notice({ tone = "info", children, icon }: { tone?: "info" | "warn" | "danger" | "ok"; children: ReactNode; icon?: ReactNode }) {
  const map = {
    info: ["var(--info-weak)", "var(--info)"],
    warn: ["var(--warn-weak)", "var(--warn)"],
    danger: ["var(--danger-weak)", "var(--danger)"],
    ok: ["var(--ok-weak)", "var(--ok)"],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <div className="flex items-start gap-2.5 rounded-[12px] px-3.5 py-3 text-[13px] leading-relaxed" style={{ background: bg, color: "var(--ink)" }}>
      {icon ? <span className="mt-0.5 shrink-0" style={{ color: fg }}>{icon}</span> : null}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Marks a setting that is stored now and acted on by a part of the product still being built. */
export function SoonBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: "var(--info-weak)", color: "var(--info)" }}>
      <Sparkles size={11} aria-hidden="true" />
      {children}
    </span>
  );
}

export function LockedPanel({ title, body, cta }: { title: string; body: string; cta?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-[16px] border border-dashed px-6 py-10 text-center" style={{ borderColor: "var(--line-strong)" }}>
      <span className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: "var(--tint)", color: "var(--ink-2)" }}>
        <Lock size={18} aria-hidden="true" />
      </span>
      <h3 className="mt-3 text-[15px] font-semibold" style={{ color: "var(--ink)" }}>{title}</h3>
      <p className="mt-1.5 max-w-md text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{body}</p>
      {cta ? <div className="mt-4">{cta}</div> : null}
    </div>
  );
}
