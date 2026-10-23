import React, { memo, useMemo } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import { Card, CardHeader, EmptyState } from '../ui';
import { formatCompactValue } from '../../lib/formatters';
import { formatValue } from '../../lib/reports/format';
import { CHART_COLORS, COLOR } from '../../lib/reports/helpers';
import type { ReportChart as ChartSpec } from '../../lib/reports/types';

// Loaded on demand (Recharts is heavy). Colours come from the `--chart-*` tokens in
// src/styles/reports.css, validated for colour-blind separation in light and dark mode:
// a series keeps its business colour (sales, cash, online, ...) whatever chart it is in.
type Role = keyof typeof COLOR;
const CATEGORICAL: Role[] = ['sales', 'online', 'credit', 'profit', 'expense', 'purchase', 'returns'];
const ROLE_BY_HEX = new Map<string, Role>(Object.entries(COLOR).map(([role, hex]) => [hex.toLowerCase(), role as Role]));
CHART_COLORS.forEach((hex, i) => { if (!ROLE_BY_HEX.has(hex.toLowerCase())) ROLE_BY_HEX.set(hex.toLowerCase(), CATEGORICAL[i % CATEGORICAL.length]); });
/** Pie slices named after a payment mode keep that mode's colour. */
const ROLE_BY_NAME: Record<string, Role> = { cash: 'cash', online: 'online', credit: 'credit', others: 'neutral', other: 'neutral' };

const token = (role: Role) => `rgb(var(--chart-${role}))`;
const SURFACE = 'rgb(var(--surface))';
const seriesColor = (own: string | undefined, index: number) => {
  if (own) { const role = ROLE_BY_HEX.get(own.toLowerCase()); return role ? token(role) : own; }
  return token(CATEGORICAL[index % CATEGORICAL.length]);
};

const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const axisTick = { fontSize: 11, fill: 'rgb(var(--fg-subtle))' };

const ChartTooltip = ({ active, payload, label, format }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[10rem] rounded-control border border-line bg-surface px-3 py-2 text-xs shadow-e2">
      {label !== undefined && label !== '' && <div className="mb-1.5 font-bold text-fg">{label}</div>}
      <div className="space-y-1">
        {payload.map((p: any) => (
          <div key={p.dataKey ?? p.name} className="flex items-center justify-between gap-4">
            <span className="flex min-w-0 items-center gap-1.5 text-fg-muted">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: p.payload?.fill || p.color }} aria-hidden="true" />
              <span className="truncate">{p.name}</span>
            </span>
            <span className="font-semibold tabular-nums text-fg">{formatValue(p.value, format || 'number')}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Identity never rests on colour alone: every series is named next to its swatch. */
const LegendList = ({ items, vertical }: { items: { label: string; color: string; extra?: string }[]; vertical?: boolean }) => (
  <ul className={vertical ? 'min-w-0 space-y-1.5' : 'flex flex-wrap gap-x-4 gap-y-1'} aria-label="Legend">
    {items.map(item => (
      <li key={item.label} className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
        <span className="size-2.5 shrink-0 rounded-sm" style={{ background: item.color }} aria-hidden="true" />
        <span className="truncate">{item.label}</span>
        {item.extra && <span className="ml-auto pl-2 font-semibold tabular-nums text-fg">{item.extra}</span>}
      </li>
    ))}
  </ul>
);

const hasValues = (spec: ChartSpec) => spec.data.some(row => spec.series.some(s => Number(row[s.key]) !== 0 && Number.isFinite(Number(row[s.key]))));

const ReportChart = memo(({ spec }: { spec: ChartSpec }) => {
  const colors = useMemo(() => spec.series.map((s, i) => seriesColor(s.color, i)), [spec.series]);
  const empty = !hasValues(spec);
  const animate = !reducedMotion && spec.data.length <= 60;

  let chart: React.ReactElement | null = null;
  let legend: React.ReactNode = spec.series.length > 1
    ? <LegendList items={spec.series.map((s, i) => ({ label: s.label, color: colors[i] }))} />
    : null;

  if (!empty && spec.type === 'pie') {
    const valueKey = spec.series[0]?.key || 'value';
    const total = spec.data.reduce((s, row) => s + (Number(row[valueKey]) || 0), 0);
    const names = spec.data.map(row => String(row[spec.xKey] ?? ''));
    const semantic = names.every(n => ROLE_BY_NAME[n.toLowerCase()]);
    let slot = 0;
    const fills = names.map(n => {
      const role = semantic || ROLE_BY_NAME[n.toLowerCase()] === 'neutral' ? ROLE_BY_NAME[n.toLowerCase()] : CATEGORICAL[slot++ % CATEGORICAL.length];
      return token(role);
    });
    chart = (
      <PieChart>
        <Pie data={spec.data} dataKey={valueKey} nameKey={spec.xKey} innerRadius="58%" outerRadius="92%" stroke={SURFACE} strokeWidth={2}
          isAnimationActive={animate} animationDuration={500}>
          {spec.data.map((_, i) => <Cell key={i} fill={fills[i]} />)}
        </Pie>
        <Tooltip content={<ChartTooltip format={spec.format} />} />
      </PieChart>
    );
    legend = (
      <LegendList vertical items={names.map((n, i) => {
        const v = Number(spec.data[i]?.[valueKey]) || 0;
        return { label: n, color: fills[i], extra: `${total ? Math.round((v / total) * 100) : 0}%` };
      })} />
    );
  } else if (!empty) {
    const tickFormatter = (v: number) => (spec.format === 'percent' ? `${v}%` : formatCompactValue(v));
    const common = { data: spec.data, margin: { top: 8, right: 8, left: -8, bottom: 0 } };
    const many = spec.data.length > 12;
    // Tilt the labels when they would not fit side by side (long names, or many points).
    const longest = spec.data.reduce((max, row) => Math.max(max, String(row[spec.xKey] ?? '').length), 0);
    const tilt = many || spec.data.length * longest > (spec.wide ? 90 : 42);
    const xAxis = (
      <XAxis dataKey={spec.xKey} tick={axisTick} tickLine={false} axisLine={{ stroke: 'rgb(var(--line-strong))' }} interval={many ? 'preserveStartEnd' : 0}
        angle={tilt ? -28 : 0} textAnchor={tilt ? 'end' : 'middle'} height={tilt ? Math.min(80, 24 + longest * 3.6) : 30} minTickGap={6}
        tickFormatter={(v: unknown) => { const s = String(v ?? ''); return s.length > 18 ? `${s.slice(0, 17)}…` : s; }} />
    );
    const yAxis = <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={tickFormatter} width={56} />;
    const grid = <CartesianGrid vertical={false} stroke="rgb(var(--line))" />;
    const lineLike = spec.type === 'line' || spec.type === 'area';
    const tooltip = (
      <Tooltip content={<ChartTooltip format={spec.format} />}
        cursor={lineLike ? { stroke: 'rgb(var(--line-strong))', strokeWidth: 1 } : { fill: 'rgb(var(--fg-faint) / 0.12)' }} />
    );
    const dot = (color: string) => (spec.data.length < 32 ? { r: 4, fill: color, stroke: SURFACE, strokeWidth: 2 } : false);
    const activeDot = (color: string) => ({ r: 5, fill: color, stroke: SURFACE, strokeWidth: 2 });
    const motion = { isAnimationActive: animate, animationDuration: 500 };

    if (spec.type === 'line') {
      chart = (
        <LineChart {...common}>{grid}{xAxis}{yAxis}{tooltip}
          {spec.series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={colors[i]} strokeWidth={2} strokeLinecap="round" dot={dot(colors[i])} activeDot={activeDot(colors[i])} {...motion} />)}
        </LineChart>
      );
    } else if (spec.type === 'area') {
      chart = (
        <AreaChart {...common}>{grid}{xAxis}{yAxis}{tooltip}
          {spec.series.map((s, i) => <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={colors[i]} strokeWidth={2} fill={colors[i]} fillOpacity={0.1} activeDot={activeDot(colors[i])} {...motion} />)}
        </AreaChart>
      );
    } else if (spec.type === 'combo') {
      chart = (
        <ComposedChart {...common}>{grid}{xAxis}{yAxis}{tooltip}
          {spec.series.map((s, i) => s.asLine
            ? <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={colors[i]} strokeWidth={2} dot={false} activeDot={activeDot(colors[i])} {...motion} />
            : <Bar key={s.key} dataKey={s.key} name={s.label} fill={colors[i]} radius={[4, 4, 0, 0]} maxBarSize={24} {...motion} />)}
        </ComposedChart>
      );
    } else {
      const stacked = spec.type === 'stacked';
      chart = (
        <BarChart {...common} barGap={2}>{grid}{xAxis}{yAxis}{tooltip}
          {spec.series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} stackId={stacked ? 'a' : undefined} fill={colors[i]} maxBarSize={24}
              // A 2px surface-coloured edge keeps stacked segments apart without drawing borders.
              stroke={stacked ? SURFACE : undefined} strokeWidth={stacked ? 2 : 0}
              radius={stacked ? (i === spec.series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]) : [4, 4, 0, 0]} {...motion} />
          ))}
        </BarChart>
      );
    }
  }

  return (
    <Card className={`report-chart break-inside-avoid ${spec.wide ? 'lg:col-span-2' : ''}`}>
      <CardHeader title={spec.title} className="pb-2" />
      <figure className="px-4 pb-4 sm:px-5" aria-label={spec.title}>
        {empty ? (
          <EmptyState size="compact" icon={<BarChart3 />} title="No data to chart in this period" className="h-64" />
        ) : spec.type === 'pie' ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="h-56 min-w-0 sm:h-64 sm:flex-1">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>{chart!}</ResponsiveContainer>
            </div>
            <div className="sm:w-[45%]">{legend}</div>
          </div>
        ) : (
          <>
            {legend && <div className="mb-2">{legend}</div>}
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>{chart!}</ResponsiveContainer>
            </div>
          </>
        )}
      </figure>
    </Card>
  );
});

export default ReportChart;
export { ReportChart };
