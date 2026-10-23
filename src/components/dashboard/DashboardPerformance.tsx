import React, { memo, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowUpRight, BarChart3 } from 'lucide-react';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { POSBill, PurchaseEntry, ExpenseEntry } from '../../types';
import { offsetDate, type DashboardRange } from '../../lib/dashboardAnalytics';
import { buildPerformanceSeries, performanceProductName, type PerformanceMetric, type PerformanceSupply } from '../../lib/dashboardPerformanceData';
import { formatCompactValue, formatCurrency, formatQty } from '../../lib/formatters';
import { Card, CardHeader, IconButton, SegmentedControl, Select } from '../ui';
import { cn } from '../../lib/cn';
import type { DashboardPeriod } from './dashboardData';
import { shortDay } from './dashboardData';
import SwipeRegion from './SwipeRegion';
import '../../styles/dashboard.css';

const METRICS: { value: PerformanceMetric; label: string }[] = [
  { value: 'sales', label: 'Sales' },
  { value: 'milk', label: 'Milk intake' },
  { value: 'expenses', label: 'Expenses' },
  { value: 'products', label: 'Products' },
];

/** One highlighted series per metric (validated against both surfaces); the previous period stays neutral grey. */
const SERIES: Record<PerformanceMetric, { stroke: string; swatch: string }> = {
  sales: { stroke: 'rgb(var(--brand-accent))', swatch: 'bg-brand-accent' },
  milk: { stroke: 'rgb(var(--info))', swatch: 'bg-info' },
  expenses: { stroke: 'var(--glass-rose)', swatch: 'bg-[color:var(--glass-rose)]' },
  products: { stroke: 'var(--glass-violet)', swatch: 'bg-[color:var(--glass-violet)]' },
};

const METRIC_TITLE: Record<PerformanceMetric, string> = { sales: 'Total sales', milk: 'Milk collected', expenses: 'Operating expenses', products: 'Product revenue' };

interface Props {
  /** Already narrowed to the selected period plus its previous window. */
  sales: POSBill[];
  purchases: PurchaseEntry[];
  expenses: ExpenseEntry[];
  range: DashboardRange;
  period: DashboardPeriod;
  /** Delivery supply slips for the same window; the sales series counts them, like the Total sales card. */
  supplies: PerformanceSupply[];
  /** Half-hour slot of "now" when the selected day is today; later slots have not happened yet. */
  liveSlot: number | null;
  onDetails: (metric: PerformanceMetric) => void;
}

type Row = ReturnType<typeof buildPerformanceSeries>[number];

function ChartTooltip({ active, payload, label, intraday, display, currentName, previousName, stroke }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as Row;
  return (
    <div className="min-w-48 rounded-control border border-line bg-surface p-3 text-xs shadow-e2">
      <p className="mb-2 font-bold text-fg">{label}<span className="ml-1 font-normal text-fg-subtle">{intraday ? '· 30 min' : ''}</span></p>
      <div className="space-y-1">
        <p className="flex items-center justify-between gap-4"><span className="flex items-center gap-2 text-fg-subtle"><i className="h-0.5 w-3 rounded-full" style={{ background: stroke }} />{currentName}</span><strong className="tabular-nums text-fg">{display(point.current)}</strong></p>
        <p className="flex items-center justify-between gap-4"><span className="flex items-center gap-2 text-fg-subtle"><i className="dash-prev-key h-0.5 w-3 rounded-full" />{previousName}</span><strong className="tabular-nums text-fg-muted">{display(point.previous)}</strong></p>
      </div>
      <p className="mb-1 mt-2 border-t border-line pt-2 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">{intraday ? 'Until this time' : 'Through this day'}</p>
      <div className="space-y-1">
        <p className="flex justify-between gap-4"><span className="text-fg-subtle">{currentName}</span><span className="font-semibold tabular-nums text-fg">{display(point.currentTotal)}</span></p>
        <p className="flex justify-between gap-4"><span className="text-fg-subtle">{previousName}</span><span className="font-semibold tabular-nums text-fg-muted">{display(point.previousTotal)}</span></p>
      </div>
    </div>
  );
}

function DashboardPerformance({ sales, purchases, expenses, range, period, supplies, liveSlot, onDetails }: Props) {
  const [metric, setMetric] = useState<PerformanceMetric>('sales');
  const [product, setProduct] = useState('');
  const reducedMotion = useReducedMotion();
  const intraday = period.days === 1;

  // Only products sold in these two periods can draw a line; best sellers first. Pack sizes of one product chart together.
  const products = useMemo(() => {
    const revenue = new Map<string, number>();
    for (const sale of sales) for (const line of sale.items || []) {
      const name = performanceProductName(line);
      if (!name) continue;
      revenue.set(name, (revenue.get(name) || 0) + (Number(line.total) || Number(line.qty) * Number(line.price) || 0));
    }
    return [...revenue.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [sales]);
  const selectedProduct = products.includes(product) ? product : products[0] || '';

  const data = useMemo(() => buildPerformanceSeries({ sales, purchases, expenses, supplies, metric, selectedProduct, period, range }),
    [sales, purchases, expenses, supplies, metric, selectedProduct, period, range]);
  const total = data.length ? data[data.length - 1].currentTotal : 0;
  const previousTotal = data.length ? data[data.length - 1].previousTotal : 0;
  const hasData = data.some(row => row.current !== 0 || row.previous !== 0);
  const display = (value: number | null) => value === null ? '—' : metric === 'milk' ? `${formatQty(value)} L` : formatCurrency(Math.round(value));
  const axisValue = (value: number) => Math.abs(value) >= 1000 ? formatCompactValue(value) : formatQty(value, 0);

  const currentName = range === 'today' ? 'Today' : range === 'yesterday' ? 'Yesterday' : range === '7days' ? 'Last 7 days' : 'This month';
  const previousName = range === 'today' ? 'Yesterday' : range === 'yesterday' ? 'Day before' : `Previous ${period.days} days`;
  const series = SERIES[metric];
  const moveMetric = (step: number) => {
    const index = METRICS.findIndex(option => option.value === metric);
    setMetric(METRICS[(index + step + METRICS.length) % METRICS.length].value);
  };
  // Daily rows are labelled from the Pakistan business day itself ("17 Oct"), never the device clock.
  // Today's line stops at the current half hour instead of drawing a fall to zero into the future.
  const rows = useMemo(() => data.map((row, index) => {
    const future = intraday && liveSlot !== null && index > liveSlot;
    return {
      ...row,
      current: future ? null : row.current,
      currentTotal: future ? null : row.currentTotal,
      axis: intraday ? row.label : shortDay(offsetDate(period.start, index)),
    };
  }), [data, intraday, liveSlot, period.start]);

  return (
    <Card className="flex min-w-0 flex-col" aria-label="Business performance">
      <CardHeader
        eyebrow="The big picture"
        title="Business performance"
        description={intraday ? 'Pakistan time · 30-minute intervals' : 'Pakistan time · daily totals'}
        actions={<IconButton size="sm" variant="soft" icon={<ArrowUpRight />} aria-label={`Open ${METRICS.find(m => m.value === metric)?.label.toLowerCase()} details`} onClick={() => onDetails(metric)} />}
      />
      <SwipeRegion label="Performance chart navigation" onNext={() => moveMetric(1)} onPrevious={() => moveMetric(-1)} className="flex flex-1 flex-col px-5 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedControl aria-label="Performance metric" size="sm" value={metric} onChange={setMetric} options={METRICS} className="max-sm:w-full" />
          {metric === 'products' && (
            <Select aria-label="Product to chart" value={selectedProduct} onChange={event => setProduct(event.target.value)} className="h-8 w-full max-w-56 text-xs sm:w-56">
              {!products.length && <option value="">No products sold</option>}
              {products.map(name => <option key={name} value={name}>{name}</option>)}
            </Select>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-fg-subtle">{metric === 'products' ? selectedProduct || METRIC_TITLE.products : METRIC_TITLE[metric]}</p>
            <p className="text-[28px] font-bold leading-tight tracking-tight text-fg">{display(total)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-fg-subtle">{previousName} · full {period.days === 1 ? 'day' : 'period'}</p>
            <p className="text-sm font-semibold tabular-nums text-fg-muted">{display(previousTotal)}</p>
          </div>
        </div>
        {/* data-no-swipe: scrubbing the tooltip sideways must not switch the metric. */}
        <div
          data-no-swipe
          className="dash-chart relative mt-3 h-60 min-w-0 sm:h-72 2xl:h-80"
          role="img"
          aria-label={`${METRIC_TITLE[metric]} chart, ${intraday ? '30-minute intervals' : 'daily totals'}. ${currentName} ${display(total)}. ${previousName} ${display(previousTotal)}.`}
        >
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <AreaChart data={rows} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="axis" axisLine={false} tickLine={false} minTickGap={24} tickMargin={8} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis axisLine={false} tickLine={false} width={48} tick={{ fontSize: 11 }} tickFormatter={axisValue} allowDecimals={false} />
              <Tooltip
                cursor={{ strokeWidth: 1 }}
                isAnimationActive={false}
                content={<ChartTooltip intraday={intraday} display={display} currentName={currentName} previousName={previousName} stroke={series.stroke} />}
              />
              <Area type="monotone" dataKey="previous" className="dash-prev-line" fill="transparent" strokeWidth={1.5} dot={false} activeDot={false} isAnimationActive={false} />
              <Area
                type="monotone" dataKey="current" stroke={series.stroke} strokeWidth={2} fill={series.stroke} fillOpacity={0.1}
                dot={false} activeDot={{ r: 4, strokeWidth: 2, className: 'dash-active-dot' }}
                isAnimationActive={!reducedMotion} animationDuration={500} animationEasing="ease-out"
              />
            </AreaChart>
          </ResponsiveContainer>
          {!hasData && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
              <span className="flex size-10 items-center justify-center rounded-xl bg-surface-2 text-fg-faint ring-1 ring-inset ring-line"><BarChart3 className="size-5" aria-hidden="true" /></span>
              <p className="text-sm font-bold text-fg">No activity in these periods</p>
              <p className="max-w-xs text-xs text-fg-subtle">Choose another range or record your first transaction.</p>
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-subtle">
          <span className="flex items-center gap-2"><i className={cn('h-0.5 w-4 rounded-full', series.swatch)} aria-hidden="true" />{currentName}</span>
          <span className="flex items-center gap-2"><i className="dash-prev-key h-0.5 w-4 rounded-full" aria-hidden="true" />{previousName}</span>
        </div>

        {/* The same numbers as a table for screen readers. */}
        <table className="sr-only">
          <caption>{METRIC_TITLE[metric]} by {intraday ? 'half hour' : 'day'}</caption>
          <thead><tr><th scope="col">{intraday ? 'Time' : 'Day'}</th><th scope="col">{currentName}</th><th scope="col">{previousName}</th></tr></thead>
          <tbody>{rows.filter(row => row.current || row.previous).map(row => <tr key={row.label}><th scope="row">{row.axis}</th><td>{display(row.current)}</td><td>{display(row.previous)}</td></tr>)}</tbody>
        </table>
      </SwipeRegion>
    </Card>
  );
}

export default memo(DashboardPerformance);
