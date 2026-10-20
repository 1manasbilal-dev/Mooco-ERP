import { formatCurrency, formatPercent, formatQty } from '../formatters';
import { prettyDate } from './presets';
import type { ColumnFormat, ReportColumn, ReportRow, ReportTable } from './types';

const timeFormatter = new Intl.DateTimeFormat('en-PK', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: true });
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' });

export function formatDateTime(value: unknown): string {
  const text = String(value ?? '');
  if (!text) return '';
  if (!text.includes('T')) return prettyDate(text);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return text;
  return `${prettyDate(dayFormatter.format(date))}, ${timeFormatter.format(date)}`;
}

export function formatValue(value: unknown, format: ColumnFormat | 'money' | 'qty' | 'number' | 'percent' = 'text', unit?: string): string {
  if (value === null || value === undefined || value === '') return format === 'money' || format === 'qty' || format === 'number' ? '—' : '';
  switch (format) {
    case 'money': return formatCurrency(Number(value));
    case 'qty': return `${formatQty(Number(value), 3)}${unit ? ` ${unit}` : ''}`;
    case 'number': return Number(value).toLocaleString('en-PK', { maximumFractionDigits: 2 });
    case 'percent': return formatPercent(Number(value));
    case 'date': {
      const text = String(value);
      const date = text.includes('T') ? new Date(text) : null;
      return prettyDate(date && Number.isFinite(date.getTime()) ? dayFormatter.format(date) : text.slice(0, 10));
    }
    case 'datetime': return formatDateTime(value);
    default: return String(value);
  }
}

export const isNumericFormat = (format?: ColumnFormat) => format === 'money' || format === 'qty' || format === 'number' || format === 'percent';

/** Plain text of a cell, as printed and exported. */
export const cellText = (row: ReportRow, column: ReportColumn) => formatValue(row[column.key], column.format, column.unit);

/** Totals row for the columns marked `total`. */
export function tableTotals(table: Pick<ReportTable, 'columns'>, rows: ReportRow[]): ReportRow {
  const totals: ReportRow = { _strong: true };
  table.columns.forEach((column, index) => {
    if (column.total) totals[column.key] = Math.round(rows.reduce((sum, row) => sum + (Number(row[column.key]) || 0), 0) * 1000) / 1000;
    else if (index === 0) totals[column.key] = 'Total';
  });
  return totals;
}

/** Stable, type-aware comparison for column sorting. */
export function compareCells(a: unknown, b: unknown): number {
  const na = typeof a === 'number' ? a : Number.NaN;
  const nb = typeof b === 'number' ? b : Number.NaN;
  if (!Number.isNaN(na) || !Number.isNaN(nb)) return (Number.isNaN(na) ? -Infinity : na) - (Number.isNaN(nb) ? -Infinity : nb);
  return String(a ?? '').localeCompare(String(b ?? ''), 'en', { numeric: true, sensitivity: 'base' });
}
