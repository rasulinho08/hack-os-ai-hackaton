"use client";

/**
 * Shared primitives for the HackOS site and workspace demo.
 *
 * Everything here reads the --hs-* tokens from globals.css, so a colour is
 * declared once and the whole surface moves together. Components take a
 * `className` so callers can position them without reaching inside.
 */

import { forwardRef, useId, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Loader2, RefreshCw } from "lucide-react";

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

/* ── Button ────────────────────────────────────────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dark";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_BASE =
  "inline-flex select-none items-center justify-center gap-2 rounded-[var(--radius-sm)] font-medium " +
  "transition-[background,color,border-color,transform,opacity] duration-150 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-55 " +
  "active:translate-y-px motion-reduce:active:translate-y-0";

const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 text-[13px]",
  md: "min-h-10 px-4 text-sm",
  lg: "min-h-11 px-5 text-sm",
};

function variantStyle(v: ButtonVariant): React.CSSProperties {
  switch (v) {
    case "primary":
      return { background: "var(--accent-solid)", color: "#fff", outlineColor: "var(--accent)" };
    case "dark":
      return { background: "var(--ink)", color: "var(--surface-sunken)", outlineColor: "var(--ink)" };
    case "secondary":
      return {
        background: "var(--surface)",
        color: "var(--ink)",
        border: "1px solid var(--line-strong)",
        outlineColor: "var(--ink)",
      };
    case "danger":
      return { background: "var(--danger-solid, var(--danger))", color: "#fff", outlineColor: "var(--danger)" };
    case "ghost":
    default:
      return { background: "transparent", color: "var(--ink-2)", outlineColor: "var(--ink)" };
  }
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", loading, icon, className, children, style, ...rest }, ref) => (
    <button
      ref={ref}
      className={cx(BUTTON_BASE, SIZES[size], className)}
      style={{ ...variantStyle(variant), ...style }}
      {...rest}
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : icon}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

/** The look of a Button for a link the page renders itself (a Next.js Link, an <a>). */
export function buttonLook(variant: ButtonVariant = "secondary", size: ButtonSize = "md") {
  return { className: cx(BUTTON_BASE, SIZES[size]), style: variantStyle(variant) };
}

export function LinkButton({
  href,
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  ...rest
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
} & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={href}
      className={cx(BUTTON_BASE, SIZES[size], className)}
      style={variantStyle(variant)}
      {...rest}
    >
      {icon}
      {children}
    </a>
  );
}

/* ── Card ──────────────────────────────────────────────────────────────── */

export function Card({
  className,
  children,
  padded = true,
  lift = false,
  style,
}: {
  className?: string;
  children: ReactNode;
  padded?: boolean;
  lift?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={cx(
        "rounded-[var(--radius)] border",
        padded && "p-5",
        lift && "hs-lift hs-lit",
        className,
      )}
      style={{
        background: "var(--surface)",
        borderColor: "var(--line)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  hint,
  action,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("mb-4 flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
          {title}
        </h3>
        {hint ? (
          <p className="mt-0.5 text-xs" style={{ color: "var(--ink-3)" }}>
            {hint}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/* ── Badge / status ────────────────────────────────────────────────────── */

export type Tone = "neutral" | "brand" | "ok" | "warn" | "info" | "danger";

const TONE: Record<Tone, { fg: string; bg: string }> = {
  neutral: { fg: "var(--ink-2)", bg: "var(--tint)" },
  brand: { fg: "var(--accent)", bg: "var(--accent-weak)" },
  ok: { fg: "var(--ok)", bg: "var(--ok-weak)" },
  warn: { fg: "var(--warn)", bg: "var(--warn-weak)" },
  info: { fg: "var(--info)", bg: "var(--info-weak)" },
  danger: { fg: "var(--danger)", bg: "var(--danger-weak)" },
};

export function Badge({
  tone = "neutral",
  children,
  className,
  dot = false,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  const t = TONE[tone];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium",
        className,
      )}
      style={{ color: t.fg, background: t.bg }}
    >
      {dot && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: t.fg }}
        />
      )}
      {children}
    </span>
  );
}

/* ── Avatar ────────────────────────────────────────────────────────────── */

export function Avatar({
  initials,
  size = 32,
  tone = "neutral",
  title,
}: {
  initials: string;
  size?: number;
  tone?: Tone;
  title?: string;
}) {
  const t = TONE[tone];
  return (
    <span
      title={title}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        color: t.fg,
        background: t.bg,
      }}
    >
      {initials}
    </span>
  );
}

/* ── Stat ──────────────────────────────────────────────────────────────── */

export function Stat({
  label,
  value,
  delta,
  hint,
  icon,
  className,
}: {
  label: string;
  value: ReactNode;
  delta?: { value: string; positive?: boolean };
  hint?: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cx("relative overflow-hidden", className)} lift>
      <div className="flex items-start justify-between gap-3">
        <p
          className="text-[11px] font-medium uppercase tracking-[0.1em]"
          style={{ color: "var(--ink-3)" }}
        >
          {label}
        </p>
        {icon ? <span style={{ color: "var(--ink-3)" }}>{icon}</span> : null}
      </div>
      <p
        className="mt-3 text-2xl font-semibold tracking-[-0.02em] sm:text-[1.75rem]"
        style={{ color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {delta ? (
          <Badge tone={delta.positive === false ? "danger" : "ok"}>
            {delta.value}
          </Badge>
        ) : null}
        {hint ? (
          <span className="text-xs" style={{ color: "var(--ink-3)" }}>
            {hint}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

/* ── Tabs ──────────────────────────────────────────────────────────────── */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cx("hs-scroll-x flex items-center gap-1 border-b", className)}
      style={{ borderColor: "var(--line)" }}
    >
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className="relative min-h-10 whitespace-nowrap px-3 text-sm font-medium transition-colors"
            style={{ color: active ? "var(--ink)" : "var(--ink-3)" }}
          >
            <span className="inline-flex items-center gap-2">
              {t.label}
              {typeof t.count === "number" && (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px]"
                  style={{
                    background: active ? "var(--accent-weak)" : "var(--tint)",
                    color: active ? "var(--accent)" : "var(--ink-3)",
                  }}
                >
                  {t.count}
                </span>
              )}
            </span>
            {active && (
              <span
                aria-hidden="true"
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full"
                style={{ background: "var(--accent-solid)" }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── Progress ──────────────────────────────────────────────────────────── */

export function Progress({
  value,
  tone = "brand",
  className,
  label,
}: {
  value: number;
  tone?: Tone;
  className?: string;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={className}>
      {label ? (
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span style={{ color: "var(--ink-2)" }}>{label}</span>
          <span style={{ color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
            {pct}%
          </span>
        </div>
      ) : null}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: "var(--tint)" }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%`, background: TONE[tone].fg }}
        />
      </div>
    </div>
  );
}

/* ── Tooltip ───────────────────────────────────────────────────────────── */

export function Tooltip({
  label,
  children,
  side = "top",
}: {
  label: string;
  children: ReactNode;
  side?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined}>{children}</span>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={cx(
            "hs-fade pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[11px]",
            side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
          )}
          style={{ background: "var(--inverse)", color: "var(--on-inverse)" }}
        >
          {label}
        </span>
      )}
    </span>
  );
}

/* ── States ────────────────────────────────────────────────────────────── */

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cx("hs-skeleton", className)} style={style} aria-hidden="true" />;
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton
              key={c}
              className="h-4 flex-1"
              style={{ opacity: 1 - r * 0.08, maxWidth: c === 0 ? 220 : undefined }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="px-6 py-14 text-center">
      <span
        className="mx-auto mb-3 inline-flex h-11 w-11 items-center justify-center rounded-full"
        style={{ background: "var(--tint)", color: "var(--ink-3)" }}
      >
        {icon ?? <Inbox size={19} />}
      </span>
      <p className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
        {title}
      </p>
      {body ? (
        <p
          className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed"
          style={{ color: "var(--ink-3)" }}
        >
          {body}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "This did not load",
  body = "The request did not reach the server, so nothing here is up to date.",
  onRetry,
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="status"
      className="rounded-[var(--radius)] border px-6 py-12 text-center"
      style={{ borderColor: "var(--warn-weak)", background: "var(--warn-weak)" }}
    >
      <AlertTriangle size={20} className="mx-auto mb-2.5" style={{ color: "var(--warn)" }} />
      <p className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
        {title}
      </p>
      <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed" style={{ color: "var(--ink-2)" }}>
        {body}
      </p>
      {onRetry ? (
        <Button className="mt-5" size="sm" icon={<RefreshCw size={14} />} onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/* ── Section scaffolding for the public site ───────────────────────────── */

export function Eyebrow({ n, children }: { n?: string; children: ReactNode }) {
  return (
    <p
      className="mb-3.5 flex items-center gap-2.5 text-[12px] font-medium uppercase tracking-[0.16em]"
      style={{ fontFamily: "var(--font-mono-ui)", color: "var(--accent)" }}
    >
      {n ? <span>{n}</span> : null}
      {n ? (
        <span
          aria-hidden="true"
          style={{ width: 22, height: 1, background: "var(--accent-solid)", opacity: 0.5 }}
        />
      ) : null}
      <span style={{ color: "var(--ink-2)" }}>{children}</span>
    </p>
  );
}

export function SectionTitle({
  children,
  light = false,
  as: Tag = "h2",
}: {
  children: ReactNode;
  light?: boolean;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <Tag
      className="text-balance text-[2rem] font-semibold leading-[1.08] tracking-[-0.025em] sm:text-[2.75rem] lg:text-[3rem]"
      style={{
        fontFamily: "var(--font-display)",
        color: light ? "var(--on-inverse)" : "var(--ink)",
      }}
    >
      {children}
    </Tag>
  );
}

export function Lead({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return (
    <p
      className="mt-5 max-w-2xl text-[17px] leading-[1.65] sm:text-[18px]"
      style={{ color: light ? "var(--on-inverse-2)" : "var(--ink-2)" }}
    >
      {children}
    </p>
  );
}
