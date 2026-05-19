/**
 * Themed Recharts wrappers.
 *
 * Pages must use these instead of raw `recharts` primitives so every chart in
 * the dashboard shares the app's color tokens, dark mode, font and tooltip
 * styling. See the Recharts decision in the root CLAUDE.md.
 *
 * Colors are read from the app CSS variables (`--brand`, `--muted`,
 * `--border`, `--paper`, `--foreground`) so charts re-theme automatically.
 */
import React from 'react';
import {
  ResponsiveContainer,
  LineChart as RLineChart,
  Line,
  AreaChart as RAreaChart,
  Area,
  BarChart as RBarChart,
  Bar,
  PieChart as RPieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { cn } from '@/components/ui/core/styling';

/** Palette used for multi-series charts; first entry is the brand color. */
export const CHART_COLORS = [
  'var(--brand)',
  '#22c55e',
  '#f59e0b',
  '#06b6d4',
  '#a855f7',
  '#ef4444',
  '#ec4899',
  '#14b8a6',
];

const AXIS_PROPS = {
  stroke: 'var(--muted)',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

function ChartTooltip(props: any) {
  const { active, payload, label, valueFormatter } = props;
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[--border] bg-[--paper] px-3 py-2 text-xs shadow-xl">
      {label !== undefined && (
        <div className="mb-1 font-medium text-[--foreground]">{label}</div>
      )}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 tabular-nums">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: p.color || p.fill }}
          />
          <span className="text-[--muted]">{p.name}</span>
          <span className="ml-auto font-medium text-[--foreground]">
            {valueFormatter ? valueFormatter(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export interface Series {
  key: string;
  label?: string;
  color?: string;
}

interface BaseChartProps {
  data: Array<Record<string, any>>;
  xKey: string;
  series: Series[];
  height?: number;
  className?: string;
  stacked?: boolean;
  valueFormatter?: (v: any) => string;
  hideLegend?: boolean;
  hideGrid?: boolean;
}

function color(s: Series, i: number) {
  return s.color ?? CHART_COLORS[i % CHART_COLORS.length];
}

export function LineChart({
  data,
  xKey,
  series,
  height = 260,
  className,
  valueFormatter,
  hideLegend,
  hideGrid,
}: BaseChartProps) {
  return (
    <div className={cn('w-full', className)}>
      <ResponsiveContainer width="100%" height={height}>
        <RLineChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        >
          {!hideGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              vertical={false}
            />
          )}
          <XAxis dataKey={xKey} {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} width={40} />
          <Tooltip
            content={<ChartTooltip valueFormatter={valueFormatter} />}
            cursor={{ stroke: 'var(--border)' }}
          />
          {!hideLegend && series.length > 1 && (
            <Legend wrapperStyle={{ fontSize: 12 }} />
          )}
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label ?? s.key}
              stroke={color(s, i)}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </RLineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AreaChart({
  data,
  xKey,
  series,
  height = 260,
  className,
  stacked,
  valueFormatter,
  hideLegend,
  hideGrid,
}: BaseChartProps) {
  return (
    <div className={cn('w-full', className)}>
      <ResponsiveContainer width="100%" height={height}>
        <RAreaChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        >
          <defs>
            {series.map((s, i) => (
              <linearGradient
                key={s.key}
                id={`grad-${s.key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="5%" stopColor={color(s, i)} stopOpacity={0.35} />
                <stop offset="95%" stopColor={color(s, i)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {!hideGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              vertical={false}
            />
          )}
          <XAxis dataKey={xKey} {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} width={40} />
          <Tooltip
            content={<ChartTooltip valueFormatter={valueFormatter} />}
            cursor={{ stroke: 'var(--border)' }}
          />
          {!hideLegend && series.length > 1 && (
            <Legend wrapperStyle={{ fontSize: 12 }} />
          )}
          {series.map((s, i) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label ?? s.key}
              stackId={stacked ? 'stack' : undefined}
              stroke={color(s, i)}
              strokeWidth={2}
              fill={`url(#grad-${s.key})`}
            />
          ))}
        </RAreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarChart({
  data,
  xKey,
  series,
  height = 260,
  className,
  stacked,
  valueFormatter,
  hideLegend,
  hideGrid,
}: BaseChartProps) {
  return (
    <div className={cn('w-full', className)}>
      <ResponsiveContainer width="100%" height={height}>
        <RBarChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        >
          {!hideGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              vertical={false}
            />
          )}
          <XAxis dataKey={xKey} {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} width={40} />
          <Tooltip
            content={<ChartTooltip valueFormatter={valueFormatter} />}
            cursor={{ fill: 'var(--subtle)' }}
          />
          {!hideLegend && series.length > 1 && (
            <Legend wrapperStyle={{ fontSize: 12 }} />
          )}
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label ?? s.key}
              stackId={stacked ? 'stack' : undefined}
              fill={color(s, i)}
              radius={stacked ? 0 : [4, 4, 0, 0]}
            />
          ))}
        </RBarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface DonutDatum {
  name: string;
  value: number;
  color?: string;
}

export function DonutChart({
  data,
  height = 200,
  className,
  centerLabel,
  centerValue,
  valueFormatter,
}: {
  data: DonutDatum[];
  height?: number;
  className?: string;
  centerLabel?: string;
  centerValue?: string;
  valueFormatter?: (v: any) => string;
}) {
  return (
    <div className={cn('relative w-full', className)}>
      <ResponsiveContainer width="100%" height={height}>
        <RPieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="90%"
            paddingAngle={2}
            stroke="none"
          >
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={d.color ?? CHART_COLORS[i % CHART_COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip valueFormatter={valueFormatter} />} />
        </RPieChart>
      </ResponsiveContainer>
      {(centerValue || centerLabel) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {centerValue && (
            <span className="text-xl font-bold tabular-nums text-[--foreground]">
              {centerValue}
            </span>
          )}
          {centerLabel && (
            <span className="text-xs text-[--muted]">{centerLabel}</span>
          )}
        </div>
      )}
    </div>
  );
}

/** Tiny inline sparkline — for dense places (e.g. per-core CPU). */
export function Sparkline({
  data,
  color: c = 'var(--brand)',
  width = 80,
  height = 24,
  className,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  if (!data.length) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1 || 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      width={width}
      height={height}
      className={cn('overflow-visible', className)}
      preserveAspectRatio="none"
    >
      <polyline
        points={pts}
        fill="none"
        stroke={c}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Stat card — a big number with label, optional delta and sparkline. */
export function Stat({
  label,
  value,
  hint,
  delta,
  spark,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  delta?: { value: string; positive?: boolean };
  spark?: number[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[--border] bg-[--paper] p-4 flex flex-col gap-1',
        className
      )}
    >
      <span className="text-xs uppercase tracking-wide text-[--muted]">
        {label}
      </span>
      <div className="flex items-end justify-between gap-2">
        <span className="text-2xl font-bold tabular-nums text-[--foreground]">
          {value}
        </span>
        {spark && <Sparkline data={spark} />}
      </div>
      <div className="flex items-center gap-2">
        {delta && (
          <span
            className={cn(
              'text-xs font-medium',
              delta.positive ? 'text-emerald-500' : 'text-red-500'
            )}
          >
            {delta.value}
          </span>
        )}
        {hint && <span className="text-xs text-[--muted]">{hint}</span>}
      </div>
    </div>
  );
}
