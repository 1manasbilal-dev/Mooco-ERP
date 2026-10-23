import React, { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronRight, Columns3, Copy, SearchX, Table2 } from 'lucide-react';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import { Badge, Button, EmptyState, LoadMoreRow, SearchInput, TableContainer, TBody, TD, TH, THead, TR } from '../ui';
import { cn } from '../../lib/cn';
import { formatCompactValue } from '../../lib/formatters';
import { cellText, compareCells, isNumericFormat, tableTotals } from '../../lib/reports/format';
import type { ReportColumn, ReportRow, ReportTable as TableSpec, Tone } from '../../lib/reports/types';
import { UI_TONE } from './ReportBlocks';
import { loadedExport, preloadExport } from './exportLoader';

const ROW_TONE: Partial<Record<Tone, string>> = {
  bad: 'bg-danger-soft/60',
  warn: 'bg-warning-soft/60',
  good: 'bg-success-soft/40',
};
const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;
const alignOf = (c: ReportColumn) => c.align || (isNumericFormat(c.format) ? 'right' : 'left');
// Dense cells: report tables often carry 8 to 12 columns.
const CELL = 'px-3 py-2 text-[13px]';

interface CellProps { row: ReportRow; column: ReportColumn; heat: boolean; heatMax: number }

const CellValue = ({ row, column, heat, heatMax }: CellProps) => {
  const value = row[column.key];
  if (column.format === 'badge' && value) {
    return <Badge tone={UI_TONE[column.tones?.[String(value)] || 'neutral']} className="h-5 px-2 text-[10.5px]">{String(value)}</Badge>;
  }
  if (heat && isNumericFormat(column.format) && column.key !== 'total') {
    const v = Number(value) || 0;
    const alpha = heatMax ? Math.min(1, v / heatMax) : 0;
    return (
      <span className="block rounded-md px-1 py-0.5 text-center text-[11px] font-semibold"
        style={{ background: `rgb(var(--brand) / ${(alpha * 0.85).toFixed(2)})`, color: alpha > 0.55 ? 'rgb(var(--brand-on))' : undefined }}>
        {v ? formatCompactValue(v) : '·'}
      </span>
    );
  }
  const text = cellText(row, column);
  if (column.signed && Number(value) !== 0) {
    return <span className={Number(value) < 0 ? 'text-danger-fg' : 'text-success-fg'}>{text}</span>;
  }
  return <>{text}</>;
};

interface RowProps {
  row: ReportRow;
  columns: ReportColumn[];
  heat: boolean;
  heatMax: number;
  drillColumn: boolean;
  onDrill?: (row: ReportRow) => void;
}

/** One body row. Memoised so opening a menu or typing in the search does not repaint hundreds of rows. */
const BodyRow = memo(({ row, columns, heat, heatMax, drillColumn, onDrill }: RowProps) => {
  const drill = onDrill && row._drill ? row._drill : null;
  const open = drill ? () => onDrill!(row) : undefined;
  return (
    <TR
      interactive={Boolean(drill)}
      onClick={open}
      onKeyDown={drill ? (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open!(); } } : undefined}
      tabIndex={drill ? 0 : undefined}
      title={drill ? drill.label || 'Open details' : undefined}
      className={cn(
        'group',
        row._tone && ROW_TONE[row._tone],
        row._strong && 'bg-surface-2 font-bold',
        drill && 'hover:bg-brand-soft/60 focus-visible:bg-brand-soft/60 focus-visible:outline-none',
        !drill && 'hover:bg-surface-2/60',
      )}
    >
      {columns.map(c => (
        <TD key={c.key} numeric={isNumericFormat(c.format)}
          className={cn(CELL, 'text-fg-muted', ALIGN[alignOf(c)], isNumericFormat(c.format) && 'font-medium text-fg', row._strong && 'font-bold text-fg', c.wrap ? 'min-w-[12rem] max-w-xs' : 'whitespace-nowrap')}>
          <CellValue row={row} column={c} heat={heat} heatMax={heatMax} />
        </TD>
      ))}
      {drillColumn && (
        <TD className="w-8 px-2 text-fg-faint group-hover:text-brand-fg print:hidden">{drill ? <ChevronRight size={15} aria-hidden="true" /> : null}</TD>
      )}
    </TR>
  );
});

interface Props {
  table: TableSpec;
  onDrill?: (row: ReportRow) => void;
  onViewChange?: (id: string, view: { rows: ReportRow[]; columns: ReportColumn[] }) => void;
  onCopied?: (ok: boolean) => void;
}

export const ReportTable = memo(({ table, onDrill, onViewChange, onCopied }: Props) => {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
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
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowColumns(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [showColumns]);

  const columns = useMemo(() => table.columns.filter(c => visible.has(c.key)), [table.columns, visible]);

  // Row text is built once per result, not on every keystroke.
  const haystack = useMemo(() => table.rows.map(row => table.columns.map(c => cellText(row, c)).join(' ').toLowerCase()), [table.rows, table.columns]);

  const rows = useMemo(() => {
    const words = deferredQuery.toLowerCase().split(/\s+/).filter(Boolean);
    let list = words.length ? table.rows.filter((_, i) => words.every(w => haystack[i].includes(w))) : table.rows;
    if (sort) {
      const dir = sort.dir === 'asc' ? 1 : -1;
      list = [...list].sort((a, b) => compareCells(a[sort.key], b[sort.key]) * dir);
    }
    return list;
  }, [table.rows, haystack, deferredQuery, sort]);

  useEffect(() => { onViewChange?.(table.id, { rows, columns }); }, [table.id, rows, columns, onViewChange]);

  const totals = useMemo(() => (table.showTotals && rows.length ? tableTotals(table, rows) : null), [table, rows]);
  const footerRows = useMemo(() => [...(totals ? [totals] : []), ...(table.footer || [])], [totals, table.footer]);
  const { visibleItems, hiddenCount, sentinelRef, showMore, showAll } = useProgressiveList<ReportRow>(rows, 150, `${table.id}:${deferredQuery}:${sort?.key}:${sort?.dir}:${table.rows.length}`);
  const drillColumn = useMemo(() => Boolean(onDrill) && table.rows.some(r => r._drill), [onDrill, table.rows]);

  const heat = Boolean(table.heat);
  const heatMax = useMemo(() => {
    if (!heat) return 0;
    let max = 0;
    table.rows.forEach(row => columns.forEach(c => { if (isNumericFormat(c.format) && c.key !== 'total') max = Math.max(max, Number(row[c.key]) || 0); }));
    return max;
  }, [heat, table.rows, columns]);

  const toggleSort = (key: string) => {
    setSort(prev => (prev?.key !== key ? { key, dir: 'desc' } : prev.dir === 'desc' ? { key, dir: 'asc' } : undefined));
  };

  const copy = useCallback(() => {
    const write = (tsv: string) => {
      if (!navigator.clipboard?.writeText) { onCopied?.(false); return; }
      navigator.clipboard.writeText(tsv).then(() => onCopied?.(true), () => onCopied?.(false));
    };
    const mod = loadedExport();
    if (mod) write(mod.tableAsTsv(table, { rows, columns }));
    else preloadExport().then(m => write(m.tableAsTsv(table, { rows, columns })), () => onCopied?.(false));
  }, [table, rows, columns, onCopied]);

  const colSpan = columns.length + (drillColumn ? 1 : 0);
  const filtered = Boolean(deferredQuery) && rows.length !== table.rows.length;

  return (
    <TableContainer className="break-inside-avoid-page print:overflow-visible print:shadow-none">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1">
          {table.title && <h3 className="truncate text-[15px] font-bold tracking-tight text-fg">{table.title}</h3>}
          <p className="text-xs text-fg-subtle">
            {table.subtitle ? `${table.subtitle} · ` : ''}
            <span className="tabular-nums">{rows.length.toLocaleString('en-PK')}</span> {rows.length === 1 ? 'row' : 'rows'}
            {filtered ? ` of ${table.rows.length.toLocaleString('en-PK')}` : ''}
          </p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto print:hidden">
          {table.rows.length > 6 && (
            <SearchInput value={query} onChange={setQuery} placeholder="Search rows…" aria-label={`Search ${table.title || 'table'} rows`} className="min-w-0 flex-1 sm:w-56 sm:flex-none" />
          )}
          <div ref={menuRef} className="relative">
            <Button variant="secondary" leftIcon={<Columns3 />} onClick={() => setShowColumns(v => !v)} aria-expanded={showColumns} aria-haspopup="true" aria-label="Choose columns" title="Choose columns" className="px-3">
              <span className="hidden md:inline">Columns</span>
            </Button>
            {showColumns && (
              <div className="absolute right-0 top-11 z-30 max-h-72 w-60 overflow-y-auto rounded-control border border-line bg-surface p-1.5 shadow-e2 animate-fade-up" role="group" aria-label="Visible columns">
                {table.columns.map(c => {
                  const on = visible.has(c.key);
                  return (
                    <label key={c.key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-fg-muted hover:bg-surface-2">
                      <input type="checkbox" className="ds-control size-4 accent-brand" checked={on} disabled={on && visible.size === 1}
                        onChange={() => setVisible(prev => { const next = new Set(prev); if (next.has(c.key)) next.delete(c.key); else next.add(c.key); return next; })} />
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      {on && <Check size={13} className="text-brand-fg" aria-hidden="true" />}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <Button variant="secondary" leftIcon={<Copy />} onClick={copy} onPointerEnter={() => void preloadExport().catch(() => {})} onFocus={() => void preloadExport().catch(() => {})}
            aria-label="Copy table (paste into Excel)" title="Copy table (paste into Excel)" className="px-3">
            <span className="hidden md:inline">Copy</span>
          </Button>
        </div>
      </div>

      <div className="report-print-flat max-h-[70vh] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <THead className="bg-surface-2 backdrop-blur-none">
            <tr>
              {columns.map(c => {
                const active = sort?.key === c.key;
                const align = alignOf(c);
                return (
                  <TH key={c.key} numeric={align === 'right'} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={cn('h-9 px-3 text-[10.5px]', ALIGN[align])}>
                    <button type="button" onClick={() => toggleSort(c.key)}
                      className={cn('inline-flex items-center gap-1 rounded uppercase tracking-wider hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', active && 'text-brand-fg', align === 'right' && 'flex-row-reverse')}>
                      {c.label}{c.unit ? ` (${c.unit})` : ''}
                      {active ? (sort!.dir === 'asc' ? <ArrowUp size={11} aria-hidden="true" /> : <ArrowDown size={11} aria-hidden="true" />) : <ArrowUpDown size={11} className="opacity-30 print:hidden" aria-hidden="true" />}
                    </button>
                  </TH>
                );
              })}
              {drillColumn && <TH className="w-8 px-2 print:hidden"><span className="sr-only">Open</span></TH>}
            </tr>
          </THead>
          <TBody>
            {visibleItems.map((row, i) => (
              <BodyRow key={i} row={row} columns={columns} heat={heat} heatMax={heatMax} drillColumn={drillColumn} onDrill={onDrill} />
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={colSpan}>
                  {deferredQuery
                    ? <EmptyState size="compact" icon={<SearchX />} title="No row matches your search" action={<Button variant="ghost" size="sm" onClick={() => setQuery('')}>Clear search</Button>} />
                    : <EmptyState size="compact" icon={<Table2 />} title={table.emptyText || 'No records in this period'} description="Try a wider date range or clear the filters." />}
                </td>
              </tr>
            )}
            <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} colSpan={colSpan} />
          </TBody>
          {footerRows.length > 0 && rows.length > 0 && (
            <tfoot className="sticky bottom-0 z-[1]">
              {footerRows.map((row, i) => (
                <tr key={i} className={cn('bg-surface-2 font-bold', i === 0 && 'border-t-2 border-line-strong')}>
                  {columns.map((c, ci) => (
                    <TD key={c.key} numeric={isNumericFormat(c.format)} className={cn(CELL, 'whitespace-nowrap font-bold text-fg', ALIGN[alignOf(c)])}>
                      {row[c.key] === undefined ? (ci === 0 && row === totals ? 'Total' : '') : <CellValue row={row} column={c} heat={false} heatMax={0} />}
                    </TD>
                  ))}
                  {drillColumn && <td className="print:hidden" />}
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>
    </TableContainer>
  );
});
