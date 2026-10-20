import React, { memo } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import { formatCompactValue } from '../../lib/formatters';
import { formatValue } from '../../lib/reports/format';
import { CHART_COLORS } from '../../lib/reports/helpers';
import type { ReportChart as ChartSpec } from '../../lib/reports/types';

const axisTick = { fontSize: 10, fill: '#94a3b8' };

const ChartTooltip = ({ active, payload, label, format }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      {label !== undefined && <div className="mb-1 font-bold text-slate-800 dark:text-slate-100">{label}</div>}
      {payload.map((p: any) => (
        <div key={p.dataKey ?? p.name} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />{p.name}
          </span>
          <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-50">{formatValue(p.value, format || 'number')}</span>
        </div>
      ))}
    </div>
  );
};

const hasValues = (spec: ChartSpec) => spec.data.some(row => spec.series.some(s => Number(row[s.key]) !== 0 && Number.isFinite(Number(row[s.key]))));

export const ReportChart = memo(({ spec }: { spec: ChartSpec }) => {
  const color = (i: number, own?: string) => own || CHART_COLORS[i % CHART_COLORS.length];
  const tickFormatter = (v: number) => (spec.format === 'percent' ? `${v}%` : formatCompactValue(v));
  const common = { data: spec.data, margin: { top: 8, right: 8, left: -12, bottom: 0 } };
  const many = spec.data.length > 12;
  // Tilt the labels when they would not fit side by side (long names, or many points).
  const longest = spec.data.reduce((max, row) => Math.max(max, String(row[spec.xKey] ?? '').length), 0);
  const tilt = many || spec.data.length * longest > (spec.wide ? 90 : 42);
  const xAxis = <XAxis dataKey={spec.xKey} tick={axisTick} tickLine={false} axisLine={false} interval={many ? 'preserveStartEnd' : 0} angle={tilt ? -28 : 0} textAnchor={tilt ? 'end' : 'middle'} height={tilt ? Math.min(80, 24 + longest * 3.6) : 30} minTickGap={6}
    tickFormatter={(v: unknown) => { const s = String(v ?? ''); return s.length > 18 ? `${s.slice(0, 17)}…` : s; }} />;
  const yAxis = <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={tickFormatter} width={56} />;
  const grid = <CartesianGrid vertical={false} stroke="currentColor" className="text-slate-200 dark:text-slate-800" strokeDasharray="3 5" />;
  const tooltip = <Tooltip content={<ChartTooltip format={spec.format} />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />;
  const legend = spec.series.length > 1 ? <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 4 }} /> : null;

  let chart: React.ReactElement;
  if (spec.type === 'pie') {
    const valueKey = spec.series[0]?.key || 'value';
    const total = spec.data.reduce((s, row) => s + (Number(row[valueKey]) || 0), 0);
    chart = (
      <PieChart>
        <Pie data={spec.data} dataKey={valueKey} nameKey={spec.xKey} innerRadius="55%" outerRadius="85%" paddingAngle={2} stroke="none">
          {spec.data.map((_, i) => <Cell key={i} fill={color(i)} />)}
        </Pie>
        <Tooltip content={<ChartTooltip format={spec.format} />} />
        <Legend layout="vertical" align="right" verticalAlign="middle" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, maxWidth: '45%' }}
          formatter={(value: string, entry: any) => {
            const v = Number(entry?.payload?.[valueKey]) || 0;
            return <span className="text-slate-600 dark:text-slate-300">{value} <b>{total ? Math.round((v / total) * 100) : 0}%</b></span>;
          }} />
      </PieChart>
    );
  } else if (spec.type === 'line') {
    chart = <LineChart {...common}>{grid}{xAxis}{yAxis}{tooltip}{legend}{spec.series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={color(i, s.color)} strokeWidth={2.2} dot={spec.data.length < 32 ? { r: 2.5 } : false} />)}</LineChart>;
  } else if (spec.type === 'area') {
    chart = (
      <AreaChart {...common}>
        <defs>{spec.series.map((s, i) => <linearGradient key={s.key} id={`rg-${spec.id}-${s.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color(i, s.color)} stopOpacity={0.35} /><stop offset="100%" stopColor={color(i, s.color)} stopOpacity={0.02} /></linearGradient>)}</defs>
        {grid}{xAxis}{yAxis}{tooltip}{legend}
        {spec.series.map((s, i) => <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={color(i, s.color)} strokeWidth={2.2} fill={`url(#rg-${spec.id}-${s.key})`} />)}
      </AreaChart>
    );
  } else if (spec.type === 'combo') {
    chart = (
      <ComposedChart {...common}>{grid}{xAxis}{yAxis}{tooltip}{legend}
        {spec.series.map((s, i) => s.asLine
          ? <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={color(i, s.color)} strokeWidth={2.4} dot={false} />
          : <Bar key={s.key} dataKey={s.key} name={s.label} fill={color(i, s.color)} radius={[4, 4, 0, 0]} maxBarSize={28} />)}
      </ComposedChart>
    );
  } else {
    const stacked = spec.type === 'stacked';
    chart = (
      <BarChart {...common}>{grid}{xAxis}{yAxis}{tooltip}{legend}
        {spec.series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} stackId={stacked ? 'a' : undefined} fill={color(i, s.color)} radius={stacked ? (i === spec.series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]) : [4, 4, 0, 0]} maxBarSize={stacked ? 34 : 26} />)}
      </BarChart>
    );
  }

  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 ${spec.wide ? 'lg:col-span-2' : ''}`}>
      <h3 className="mb-2 text-sm font-bold text-slate-800 dark:text-slate-100">{spec.title}</h3>
      <div className="relative h-64 text-slate-500">
        {hasValues(spec) ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>{chart}</ResponsiveContainer>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
            <BarChart3 size={26} />
            <span className="text-xs font-medium">No data to chart in this period</span>
          </div>
        )}
      </div>
    </div>
  );
});
