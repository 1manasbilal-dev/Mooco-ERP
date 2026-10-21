import React, { useId, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowUpRight, BarChart3, ChevronDown, MoveHorizontal } from 'lucide-react';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { POSBill, PurchaseEntry, ExpenseEntry } from '../../types';
import { getDashboardPeriod, DashboardRange } from '../../lib/dashboardAnalytics';
import { buildPerformanceSeries, PerformanceMetric } from '../../lib/dashboardPerformanceData';
import { formatCurrency, formatQty } from '../../lib/formatters';
import { DASHBOARD_COLORS } from '../../theme';
import SwipeRegion from './SwipeRegion';

const METRICS = ['sales', 'milk', 'expenses', 'products'] as const;
type Metric = PerformanceMetric;
interface Props {
  sales: POSBill[];
  purchases: PurchaseEntry[];
  expenses: ExpenseEntry[];
  range: DashboardRange;
  period: ReturnType<typeof getDashboardPeriod>;
  onDetails: (metric: Metric) => void;
}

export default function DashboardPerformance({ sales, purchases, expenses, range, period, onDetails }: Props) {
  const [metric, setMetric] = useState<Metric>('sales');
  const [direction, setDirection] = useState(1);
  const [product, setProduct] = useState('');
  const reducedMotion = useReducedMotion();
  const changeMetric = (next: Metric, swipeDirection?: number) => {
    setDirection(swipeDirection ?? (METRICS.indexOf(next) >= METRICS.indexOf(metric) ? 1 : -1));
    setMetric(next);
  };
  const moveMetric = (direction: number) => changeMetric(METRICS[(METRICS.indexOf(metric) + direction + METRICS.length) % METRICS.length], direction);
  const id = useId().replace(/:/g, '');
  const products = useMemo(() => [...new Set(sales.filter(s => s.status !== 'Returned').flatMap(s => (s.items || []).map(i => i.name)))].sort(), [sales]);
  const selectedProduct = products.includes(product) ? product : products[0] || '';
  const intraday = period.days === 1;
  const data = useMemo(() => buildPerformanceSeries({ sales, purchases, expenses, metric, selectedProduct, period, range }),
    [sales, purchases, expenses, metric, selectedProduct, period, range]);
  const total = data.reduce((sum, row) => sum + row.current, 0);
  const previousTotal = data.reduce((sum, row) => sum + row.previous, 0);
  const display = (value: number) => metric === 'milk' ? `${formatQty(value)} L` : formatCurrency(value);
  const hasData = data.some(row => row.current !== 0 || row.previous !== 0);
  return <section className="overview-panel performance-panel" data-metric={metric} aria-label="Business performance">
    <div className="overview-panel-heading">
      <div><span className="overview-eyebrow">THE BIG PICTURE</span><h2>Business performance</h2></div>
      <button className="overview-icon-button" onClick={() => onDetails(metric)} aria-label={`View ${metric} details`}><ArrowUpRight size={18} /></button>
    </div>
    <SwipeRegion label="Performance chart navigation" onNext={() => moveMetric(1)} onPrevious={() => moveMetric(-1)}>
    <div className="performance-controls">
      <div className="overview-segments" role="group" aria-label="Performance metric">
        {METRICS.map(key => <button key={key} aria-pressed={metric === key} onClick={() => changeMetric(key)}>{key === 'milk' ? 'Milk intake' : key.charAt(0).toUpperCase() + key.slice(1)}</button>)}
      </div>
      {metric === 'products' && <label className="overview-select"><span className="sr-only">Product to chart</span><select value={selectedProduct} onChange={e => setProduct(e.target.value)}><option value="" disabled>{products.length ? 'Choose product' : 'No products sold'}</option>{products.map(name => <option key={name}>{name}</option>)}</select><ChevronDown size={14} /></label>}
    </div>
    <div key={`${metric}-${range}-${metric === 'products' ? selectedProduct : ''}`} style={{ '--chart-direction': direction } as React.CSSProperties} className="performance-animated-view">
    <div className="performance-totals"><div><strong>{display(total)}</strong><span>{metric === 'milk' ? 'Milk collected' : metric === 'expenses' ? 'Operating expenses' : metric === 'products' ? selectedProduct || 'Product revenue' : 'Total sales'}</span></div><div className="performance-previous"><span>Previous {period.days === 1 ? 'day' : `${period.days} days`}</span><b>{display(previousTotal)}</b></div></div>
    <div className="performance-chart" role="img" aria-label={`${metric} chart. ${intraday ? '30-minute intervals' : 'Daily totals'}. Selected period ${display(total)}. Previous period ${display(previousTotal)}.`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart data={data} margin={{ top: 12, right: 5, left: -22, bottom: 0 }}>
          <defs><linearGradient id={`performance-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={DASHBOARD_COLORS[metric]} stopOpacity={0.32} /><stop offset="100%" stopColor={DASHBOARD_COLORS[metric]} stopOpacity={0.02} /></linearGradient></defs>
          <CartesianGrid vertical={false} stroke="var(--border-color)" strokeDasharray="3 5" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={30} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} dy={9} />
          <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickFormatter={v => Math.abs(v) >= 1000 ? `${formatQty(v / 1000, 1)}k` : formatQty(v)} />
          <Tooltip content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const point = payload[0].payload as { current: number; previous: number; currentTotal: number; previousTotal: number };
            return <div className="overview-chart-tooltip">
              <b>{label}</b>
              <small>{intraday ? 'This interval' : 'This day'}</small>
              <span>Selected period <strong>{display(point.current)}</strong></span>
              <span>Previous period <strong>{display(point.previous)}</strong></span>
              <small>{intraday ? 'Until this time' : 'Through this day'}</small>
              <span>Selected period <strong>{display(point.currentTotal)}</strong></span>
              <span>Previous period <strong>{display(point.previousTotal)}</strong></span>
            </div>;
          }} />
          <Area type="monotone" dataKey="previous" stroke="var(--text-dimmed)" strokeWidth={1.6} strokeDasharray="5 5" fill="transparent" isAnimationActive={false} />
          <Area type="monotone" dataKey="current" stroke={DASHBOARD_COLORS[metric]} strokeWidth={3} fill={`url(#performance-${id})`} isAnimationActive={!reducedMotion} animationBegin={180} animationDuration={900} animationEasing="ease-out" />
        </AreaChart>
      </ResponsiveContainer>
      {!hasData && <div className="performance-empty"><BarChart3 size={25} /><strong>No activity in these periods</strong><span>Choose another range or record your first transaction.</span></div>}
    </div>
    </div>
    <div className="performance-legend"><span><i />Selected period</span><span><i />Previous period</span><span className="performance-note">{intraday ? 'Pakistan time · 30-minute intervals' : 'Daily totals · Pakistan time'}</span></div>
    <div className="overview-chart-swipe-hint"><MoveHorizontal size={14} /><span>Swipe left or right to change the chart</span></div>
    </SwipeRegion>
  </section>;
}
