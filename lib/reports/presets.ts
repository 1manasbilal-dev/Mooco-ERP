import { offsetDate } from '../dashboardAnalytics';

export interface DatePreset {
  id: string;
  label: string;
  range: (today: string) => { from: string; to: string };
}

const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
const monthEnd = (date: string) => {
  const d = new Date(`${monthStart(date)}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
};
const addMonths = (date: string, months: number) => {
  const d = new Date(`${monthStart(date)}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};
const quarterStart = (date: string) => {
  const m = Number(date.slice(5, 7));
  return `${date.slice(0, 4)}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
};
const weekStart = (date: string) => offsetDate(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
/** Pakistan's financial year runs 1 July – 30 June. */
const fiscalStart = (date: string) => {
  const y = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 7 ? `${y}-07-01` : `${y - 1}-07-01`;
};

export const DATE_PRESETS: DatePreset[] = [
  { id: 'today', label: 'Today', range: t => ({ from: t, to: t }) },
  { id: 'yesterday', label: 'Yesterday', range: t => ({ from: offsetDate(t, -1), to: offsetDate(t, -1) }) },
  { id: 'this_week', label: 'This week', range: t => ({ from: weekStart(t), to: t }) },
  { id: 'last_7', label: 'Last 7 days', range: t => ({ from: offsetDate(t, -6), to: t }) },
  { id: 'this_month', label: 'This month', range: t => ({ from: monthStart(t), to: t }) },
  { id: 'last_month', label: 'Last month', range: t => { const s = addMonths(t, -1); return { from: s, to: monthEnd(s) }; } },
  { id: 'last_30', label: 'Last 30 days', range: t => ({ from: offsetDate(t, -29), to: t }) },
  { id: 'this_quarter', label: 'This quarter', range: t => ({ from: quarterStart(t), to: t }) },
  { id: 'last_quarter', label: 'Last quarter', range: t => { const s = addMonths(quarterStart(t), -3); return { from: s, to: offsetDate(quarterStart(t), -1) }; } },
  { id: 'last_90', label: 'Last 90 days', range: t => ({ from: offsetDate(t, -89), to: t }) },
  { id: 'this_year', label: 'This year', range: t => ({ from: `${t.slice(0, 4)}-01-01`, to: t }) },
  { id: 'this_fy', label: 'Financial year (Jul–Jun)', range: t => ({ from: fiscalStart(t), to: t }) },
  { id: 'last_fy', label: 'Last financial year', range: t => { const s = fiscalStart(t); return { from: `${Number(s.slice(0, 4)) - 1}-07-01`, to: offsetDate(s, -1) }; } },
  { id: 'all', label: 'All time', range: t => ({ from: '2000-01-01', to: t }) },
];

export const presetRange = (id: string, today: string) =>
  (DATE_PRESETS.find(p => p.id === id) || DATE_PRESETS[4]).range(today);

export const presetLabel = (id: string) => DATE_PRESETS.find(p => p.id === id)?.label || 'Custom range';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const prettyDate = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}/.test(date || '')) return date || '';
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
};
export const rangeText = (from: string, to: string) =>
  from === to ? prettyDate(from) : from <= '2000-01-01' ? `Up to ${prettyDate(to)}` : `${prettyDate(from)} – ${prettyDate(to)}`;
