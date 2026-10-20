import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Columns3, Copy, Search, X } from 'lucide-react';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import { LoadMoreRow } from '../ui/LoadMoreRow';
import { formatCompactValue } from '../../lib/formatters';
import { cellText, compareCells, isNumericFormat, tableTotals } from '../../lib/reports/format';
import { tableAsTsv } from '../../lib/reports/export';
import type { ReportColumn, ReportRow, ReportTable as TableSpec, Tone } from '../../lib/reports/types';

const TONE_BADGE: Record<Tone, string> = {
  good: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300',
  bad: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/40 dark:text-red-300',
  warn: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300',
  info: 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-950/40 dark:text-blue-300',
  neutral: 'bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300',
};
const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;
const ROW_TONE: Partial<Record<Tone, string>> = {
  bad: 'bg-red-50/60 dark:bg-red-950/20',
  warn: 'bg-amber-50/60 dark:bg-amber-950/20',
  good: 'bg-emerald-50/40 dark:bg-emerald-950/10',
};

interface Props {
  table: TableSpec;
  onDrill?: (row: ReportRow) => void;
  onViewChange?: (id: string, view: { rows: ReportRow[]; columns: ReportColumn[] }) => void;
  onCopied?: () => void;
}

export const ReportTable = memo(({ table, onDrill, onViewChange, onCopied }: Props) => {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | undefined>(table.sort);
  const [visible, setVisible] = useState<Set<string>>(() => new Set(table.columns.filter(c => !c.hidden).map(c => c.key)));
  const [showColumns, setShowColumns] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // A new result (other dates or filters) keeps the viewer's column choice but restores a valid sort.
  const columnSignature = table.columns.map(c => c.key).join('|');
  useEffect(() => {
    setVisible(prev => {
      const keys = new Set(table.columns.map(c => c.key));
      const kept = [...prev].filter(k => keys.has(k));
      return kept.length ? new Set(kept) : new Set(table.columns.filter(c => !c.hidden).map(c => c.key));
    });
    setSort(prev => (prev && table.columns.some(c => c.key === prev.key) ? prev : table.sort));
  }, [columnSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showColumns) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setShowColumns(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showColumns]);

  const columns = useMemo(() => table.columns.filter(c => visible.has(c.key)), [table.columns, visible]);

  const rows = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    let list = words.length
      ? table.rows.filter(row => {
        const hay = table.columns.map(c => cellText(row, c)).join(' ').toLowerCase();
        return words.every(w => hay.includes(w));
      })
      : table.rows;
    if (sort) {
      const dir = sort.dir === 'asc' ? 1 : -1;
      list = [...list].sort((a, b) => compareCells(a[sort.key], b[sort.key]) * dir);
    }
    return list;
  }, [table.rows, table.columns, query, sort]);

  useEffect(() => { onViewChange?.(table.id, { rows, columns }); }, [table.id, rows, columns, onViewChange]);

  const totals = useMemo(() => (table.showTotals && rows.length ? tableTotals(table, rows) : null), [table, rows]);
  const { visibleItems, hiddenCount, sentinelRef, showMore, showAll } = useProgressiveList<ReportRow>(rows, 150, `${table.id}:${query}:${sort?.key}:${sort?.dir}:${table.rows.length}`);

  const heatMax = useMemo(() => {
    if (!table.heat) return 0;
    let max = 0;
    table.rows.forEach(row => columns.forEach(c => { if (isNumericFormat(c.format) && c.key !== 'total') max = Math.max(max, Number(row[c.key]) || 0); }));
    return max;
  }, [table.heat, table.rows, columns]);

  const toggleSort = (key: string) => {
    setSort(prev => (prev?.key !== key ? { key, dir: 'desc' } : prev.dir === 'desc' ? { key, dir: 'asc' } : undefined));
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tableAsTsv(table, { rows, columns }));
      onCopied?.();
    } catch { /* clipboard blocked: nothing to do */ }
  };

  const renderCell = (row: ReportRow, column: ReportColumn) => {
    const value = row[column.key];
    if (column.format === 'badge' && value) {
      const tone = column.tones?.[String(value)] || 'neutral';
      return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${TONE_BADGE[tone]}`}>{String(value)}</span>;
    }
    if (table.heat && isNumericFormat(column.format) && column.key !== 'total') {
      const v = Number(value) || 0;
      const alpha = heatMax ? Math.min(1, v / heatMax) : 0;
      return <span className="block rounded-md px-1 py-0.5 text-center text-[10px] font-semibold" style={{ background: `rgba(101,163,13,${(alpha * 0.85).toFixed(2)})`, color: alpha > 0.55 ? '#fff' : undefined }}>{v ? formatCompactValue(v) : '·'}</span>;
    }
    const text = cellText(row, column);
    if (column.signed && Number(value) !== 0) {
      return <span className={Number(value) < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}>{text}</span>;
    }
    return text;
  };

  const align = (c: ReportColumn) => c.align || (isNumericFormat(c.format) ? 'right' : 'left');

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="min-w-0 flex-1">
          {table.title && <h3 className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{table.title}</h3>}
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {table.subtitle ? `${table.subtitle} · ` : ''}{rows.length.toLocaleString('en-PK')} {rows.length === 1 ? 'row' : 'rows'}
            {query && rows.length !== table.rows.length ? ` of ${table.rows.length.toLocaleString('en-PK')}` : ''}
          </p>
        </div>
        {table.rows.length > 6 && (
          <label className="relative flex items-center">
            <Search size={13} className="pointer-events-none absolute left-2.5 text-slate-400" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search rows…" aria-label="Search rows"
              className="h-8 w-40 rounded-lg border border-slate-200 bg-slate-50 pl-7 pr-7 text-xs outline-none focus:border-lime-500 focus:ring-2 focus:ring-lime-500/20 sm:w-52 dark:border-slate-700" />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-1.5 rounded p-0.5 text-slate-400 hover:text-slate-700"><X size={12} /></button>}
          </label>
        )}
        <div ref={menuRef} className="relative">
          <button type="button" onClick={() => setShowColumns(v => !v)} title="Choose columns" aria-label="Choose columns" aria-expanded={showColumns}
            className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            <Columns3 size={13} /><span className="hidden sm:inline">Columns</span>
          </button>
          {showColumns && (
            <div className="absolute right-0 top-9 z-30 max-h-72 w-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700">
              {table.columns.map(c => (
                <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
                  <input type="checkbox" className="accent-lime-600" checked={visible.has(c.key)} disabled={visible.has(c.key) && visible.size === 1}
                    onChange={() => setVisible(prev => { const next = new Set(prev); next.has(c.key) ? next.delete(c.key) : next.add(c.key); return next; })} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={copy} title="Copy table (paste into Excel)" aria-label="Copy table"
          className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
          <Copy size={13} /><span className="hidden sm:inline">Copy</span>
        </button>
      </div>

      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-900">
            <tr>
              {columns.map(c => {
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} scope="col" aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={`whitespace-nowrap border-b border-slate-200 px-3 py-2 font-bold text-slate-500 dark:border-slate-800 dark:text-slate-400 ${ALIGN[align(c)]}`}>
                    <button type="button" onClick={() => toggleSort(c.key)} className={`inline-flex items-center gap-1 uppercase tracking-wide text-[10px] hover:text-slate-900 dark:hover:text-white ${active ? 'text-lime-700 dark:text-lime-400' : ''} ${align(c) === 'right' ? 'flex-row-reverse' : ''}`}>
                      {c.label}{c.unit ? ` (${c.unit})` : ''}
                      {active ? (sort!.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUpDown size={11} className="opacity-30" />}
                    </button>
                  </th>
                );
              })}
              {onDrill && table.rows.some(r => r._drill) && <th className="w-6 border-b border-slate-200 dark:border-slate-800" aria-label="Open" />}
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((row, i) => {
              const drill = onDrill && row._drill;
              return (
                <tr key={i} onClick={drill ? () => onDrill!(row) : undefined} title={drill ? row._drill!.label || 'Open details' : undefined}
                  className={`border-b border-slate-100 last:border-0 dark:border-slate-800/70 ${row._tone ? ROW_TONE[row._tone] || '' : ''} ${row._strong ? 'bg-slate-50 font-bold dark:bg-slate-900' : ''} ${drill ? 'group cursor-pointer hover:bg-lime-50/70 dark:hover:bg-lime-950/20' : 'hover:bg-slate-50/70 dark:hover:bg-slate-900/40'}`}>
                  {columns.map(c => (
                    <td key={c.key} className={`px-3 py-2 text-slate-700 dark:text-slate-200 ${ALIGN[align(c)]} ${isNumericFormat(c.format) ? 'whitespace-nowrap tabular-nums' : ''} ${c.wrap ? 'min-w-[12rem] max-w-xs' : 'whitespace-nowrap'}`}>
                      {renderCell(row, c)}
                    </td>
                  ))}
                  {onDrill && table.rows.some(r => r._drill) && (
                    <td className="pr-2 text-slate-300 group-hover:text-lime-600">{drill ? <ChevronRight size={14} /> : null}</td>
                  )}
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={columns.length + 1} className="px-4 py-12 text-center text-sm text-slate-400">{query ? 'No row matches your search' : table.emptyText || 'No records in this period'}</td></tr>
            )}
            <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} colSpan={columns.length + 1} />
          </tbody>
          {(totals || table.footer?.length) && (
            <tfoot className="sticky bottom-0 z-10">
              {[...(totals ? [totals] : []), ...(table.footer || [])].map((row, i) => (
                <tr key={i} className="border-t-2 border-slate-300 bg-slate-100 font-bold dark:border-slate-700 dark:bg-slate-900">
                  {columns.map((c, ci) => (
                    <td key={c.key} className={`whitespace-nowrap px-3 py-2 text-slate-900 dark:text-slate-50 ${ALIGN[align(c)]} ${isNumericFormat(c.format) ? 'tabular-nums' : ''}`}>
                      {row[c.key] === undefined ? (ci === 0 && row === totals ? 'Total' : '') : renderCell(row, c)}
                    </td>
                  ))}
                  {onDrill && table.rows.some(r => r._drill) && <td />}
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
});
