"use client";

/**
 * Chart wrappers over recharts, so every chart in the workspace shares one
 * palette, one grid weight, one tooltip and one set of type tokens.
 *
 * The categorical hues are the validated eight-slot order, in fixed slot order
 * and never cycled. Three of the light-mode slots sit under 3:1 against the card
 * surface, which obliges relief: every categorical chart here ships a legend
 * carrying its own values, so a series is never identified by colour alone.
 *
 * Two rules worth stating because they are easy to break later: one y-axis per
 * chart, never two; and colour follows the entity, not its rank, so filtering a
 * series out never repaints the ones that remain.
 */

import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Validated categorical order — assign by slot, never cycle. Each slot is a
 * token (globals.css, `--viz-1…8`) with its own step for the light and the dark
 * surface, so a chart follows the theme it is drawn in.
 */
export const SERIES = [
  "var(--viz-1)", // 1 blue
  "var(--viz-2)", // 2 orange
  "var(--viz-3)", // 3 aqua
  "var(--viz-4)", // 4 yellow
  "var(--viz-5)", // 5 magenta
  "var(--viz-6)", // 6 green
  "var(--viz-7)", // 7 violet
  "var(--viz-8)", // 8 red
] as const;

/** Single hue, light → dark, for magnitude (funnels, ramps). */
const BLUE_RAMP = ["#9dc2ef", "#6ea6e6", "#4a8fdd", "#2a78d6", "#1f5da8", "#17457c"];

const INK = "var(--hs-ink)";
const INK_2 = "var(--hs-ink-2)";
const INK_3 = "var(--hs-ink-3)";
const GRID = "var(--viz-grid, rgba(20,22,28,0.08))";

const axisTick = { fill: INK_3, fontSize: 11 };
// Long counts are shortened on the axis (12K) so the labels fit its width; the tooltip keeps the exact figure.
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const axisNumber = (v: unknown) => (typeof v === "number" && Math.abs(v) >= 10000 ? compact.format(v) : String(v));

function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string; dataKey?: string }[];
  label?: string | number;
  formatter?: (v: number | string, name?: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-[var(--hs-radius-sm)] border px-3 py-2 shadow-lg"
      style={{ background: "var(--hs-surface)", borderColor: "var(--hs-line-2)" }}
    >
      {label !== undefined && (
        <p className="mb-1 text-[11px] font-medium" style={{ color: INK_3 }}>
          {label}
        </p>
      )}
      {payload.map((p, i) => (
        <p
          key={i}
          className="flex items-center gap-2 text-xs"
          style={{ color: INK, fontVariantNumeric: "tabular-nums" }}
        >
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full"
            style={{ background: p.color }}
          />
          <span style={{ color: INK_2 }}>{p.name}</span>
          <span className="ml-auto font-medium">
            {formatter && p.value !== undefined
              ? formatter(p.value, p.name)
              : p.value}
          </span>
        </p>
      ))}
    </div>
  );
}

export function ChartFrame({
  height = 240,
  children,
}: {
  height?: number;
  children: ReactNode;
}) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );
}

/* ── Area: one series over time ────────────────────────────────────────── */

export function AreaTrend<T extends object>({
  data,
  xKey,
  yKey,
  name,
  color = SERIES[0],
  height = 240,
  format,
}: {
  data: T[];
  xKey: string;
  yKey: string;
  name: string;
  color?: string;
  height?: number;
  format?: (v: number | string) => string;
}) {
  const gid = `grad-${yKey}`;
  return (
    <ChartFrame height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -14 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} width={54} tickFormatter={axisNumber} />
        <Tooltip content={<ChartTooltip formatter={format} />} cursor={{ stroke: GRID }} />
        <Area
          type="monotone"
          dataKey={yKey}
          name={name}
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gid})`}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--hs-surface)" }}
        />
      </AreaChart>
    </ChartFrame>
  );
}

/* ── Bars: one or two series ───────────────────────────────────────────── */

export function BarSeries<T extends object>({
  data,
  xKey,
  bars,
  height = 240,
  format,
}: {
  data: T[];
  xKey: string;
  bars: { key: string; name: string; slot?: number }[];
  height?: number;
  format?: (v: number | string) => string;
}) {
  return (
    <ChartFrame height={height}>
      <BarChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -14 }} barGap={2}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} width={54} tickFormatter={axisNumber} />
        <Tooltip
          content={<ChartTooltip formatter={format} />}
          cursor={{ fill: "var(--viz-cursor, rgba(20,22,28,0.04))" }}
        />
        {bars.length > 1 && (
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, color: INK_2, paddingTop: 8 }}
          />
        )}
        {bars.map((b, i) => (
          <Bar
            key={b.key}
            dataKey={b.key}
            name={b.name}
            fill={SERIES[b.slot ?? i]}
            radius={[4, 4, 0, 0]}
            maxBarSize={34}
          />
        ))}
      </BarChart>
    </ChartFrame>
  );
}

/* ── Line: comparison over time ────────────────────────────────────────── */

export function LineSeries<T extends object>({
  data,
  xKey,
  lines,
  height = 240,
}: {
  data: T[];
  xKey: string;
  lines: { key: string; name: string; slot?: number }[];
  height?: number;
}) {
  return (
    <ChartFrame height={height}>
      <LineChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -14 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} width={54} tickFormatter={axisNumber} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: GRID }} />
        {lines.length > 1 && (
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, color: INK_2, paddingTop: 8 }}
          />
        )}
        {lines.map((l, i) => (
          <Line
            key={l.key}
            type="monotone"
            dataKey={l.key}
            name={l.name}
            stroke={SERIES[l.slot ?? i]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--hs-surface)" }}
          />
        ))}
      </LineChart>
    </ChartFrame>
  );
}

/* ── Donut: composition, with the legend carrying the values ───────────── */

export function DonutSplit({
  data,
  height = 240,
  total,
  totalLabel,
}: {
  data: { name: string; value: number }[];
  height?: number;
  total?: number;
  totalLabel?: string;
}) {
  const sum = total ?? data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ChartFrame height={height}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={2}
              stroke="var(--hs-surface)"
              strokeWidth={2}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={SERIES[i]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ChartFrame>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="text-2xl font-semibold"
            style={{ color: INK, fontVariantNumeric: "tabular-nums" }}
          >
            {sum}
          </span>
          {totalLabel && (
            <span className="text-[10px] uppercase tracking-[0.1em]" style={{ color: INK_3 }}>
              {totalLabel}
            </span>
          )}
        </div>
      </div>

      {/* The legend is the relief the palette's contrast warning requires:
          identity is carried by a written label and a number, not a hue. */}
      <ul className="w-full min-w-0 flex-1 space-y-2">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2.5 text-xs">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: SERIES[i] }}
            />
            <span className="min-w-0 flex-1 truncate" style={{ color: INK_2 }}>
              {d.name}
            </span>
            <span
              className="font-medium"
              style={{ color: INK, fontVariantNumeric: "tabular-nums" }}
            >
              {d.value}
            </span>
            <span className="w-10 text-right" style={{ color: INK_3 }}>
              {sum ? Math.round((d.value / sum) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Funnel: magnitude down a sequence, one hue ────────────────────────── */

export function FunnelBars({
  steps,
}: {
  steps: { label: string; value: number; hint?: string }[];
}) {
  const max = Math.max(...steps.map((s) => s.value), 1);
  return (
    <ol className="space-y-2.5">
      {steps.map((s, i) => {
        const pct = Math.round((s.value / max) * 100);
        const prev = i > 0 ? steps[i - 1].value : null;
        const drop = prev && prev > 0 ? Math.round((s.value / prev) * 100) : null;
        return (
          <li key={s.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
              <span style={{ color: INK_2 }}>{s.label}</span>
              <span className="flex items-baseline gap-2">
                <span
                  className="font-medium"
                  style={{ color: INK, fontVariantNumeric: "tabular-nums" }}
                >
                  {s.value}
                </span>
                {drop !== null && (
                  <span style={{ color: INK_3, fontVariantNumeric: "tabular-nums" }}>
                    {drop}%
                  </span>
                )}
              </span>
            </div>
            <div
              className="h-7 w-full overflow-hidden rounded-[5px]"
              style={{ background: "var(--hs-tint, rgba(20,22,28,0.05))" }}
            >
              <div
                className="h-full rounded-[5px] transition-[width] duration-700 ease-out motion-reduce:transition-none"
                style={{
                  width: `${Math.max(pct, 4)}%`,
                  background: BLUE_RAMP[Math.min(i, BLUE_RAMP.length - 1)],
                }}
              />
            </div>
            {s.hint && (
              <p className="mt-1 text-[11px]" style={{ color: INK_3 }}>
                {s.hint}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ── Sparkline: shape only, no axes ────────────────────────────────────── */

export function Sparkline({
  data,
  dataKey,
  color = SERIES[0],
  height = 40,
}: {
  data: object[];
  dataKey: string;
  color?: string;
  height?: number;
}) {
  return (
    <ChartFrame height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`spark-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.24} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={1.75}
          fill={`url(#spark-${dataKey})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartFrame>
  );
}
