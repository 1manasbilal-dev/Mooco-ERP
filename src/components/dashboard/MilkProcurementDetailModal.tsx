import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, ChevronDown, Droplets, ExternalLink, FileText, MapPin, Moon, Sun, Users, X } from 'lucide-react';
import { formatCurrency, formatQty, cleanNumber } from '../../lib/formatters';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import type { PurchaseEntry, Supplier } from '../../types';
import {
  Badge, Button, EmptyState, IconButton, LoadMoreRow, Money, SearchInput, SegmentedControl, TBody, TD, TH, THead, TR, Table,
} from '../ui';
import { cn } from '../../lib/cn';
import { milkVariety } from './dashboardData';

interface MilkProcurementDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  purchases: PurchaseEntry[];
  suppliers: Supplier[];
  periodLabel: string;
  dateRangeText?: string;
  totalMilkLiters: number;
  totalMilkCost: number;
  avgMilkRate: number;
  buffaloLiters: number;
  cowLiters: number;
  onOpenProcurement?: () => void;
  onNavigateToSupplier?: (supplierId: string) => void;
  layout?: 'dialog' | 'page';
}

interface SupplierSummary {
  supplierId: string;
  supplierName: string;
  phone: string;
  village: string;
  city: string;
  totalLiters: number;
  totalAmount: number;
  avgRate: number;
  buffaloLiters: number;
  cowLiters: number;
  mixedLiters: number;
  entriesCount: number;
  sharePercent: number;
  entries: PurchaseEntry[];
}

type Slip = PurchaseEntry & { supplierName: string; supplierVillage: string };
type Variety = 'all' | 'buffalo' | 'cow' | 'mixed';
type ShiftFilter = 'all' | 'morning' | 'evening';
type ViewMode = 'by_supplier' | 'all_slips';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Slips are shown in Pakistan time whatever the device clock zone. Date-only slips have
// no recorded time, so none is shown (they used to read "05:00 AM", UTC midnight in PKT).
const slipDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', year: 'numeric' });
const slipClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function slipWhen(value: string): { day: string; time: string } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
    return { day: new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), time: '' };
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { day: value || '', time: '' };
  return { day: slipDay.format(date), time: slipClock.format(date) };
}
const slipTime = (slip: PurchaseEntry) => { const t = new Date(slip.date).getTime(); return Number.isFinite(t) ? t : 0; };
const isMorning = (slip: PurchaseEntry) => (slip.shift || '').toLowerCase().includes('morning');
const rateText = (rate: number) => `Rs ${cleanNumber(rate, 1).toFixed(1)}`;

function ShiftBadge({ slip }: { slip: PurchaseEntry }) {
  const morning = isMorning(slip);
  return <Badge tone={morning ? 'warning' : 'info'} icon={morning ? <Sun /> : <Moon />}>{slip.shift || 'General'}</Badge>;
}

const SupplierRow: React.FC<{
  sup: SupplierSummary; rank: number; expanded: boolean; onToggle: () => void; onOpenKhata?: () => void;
}> = ({ sup, rank, expanded, onToggle, onOpenKhata }) => {
  const panelId = useId();
  return (
    <li className="overflow-hidden rounded-card border border-line bg-surface shadow-e1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full cursor-pointer flex-col gap-3 p-3.5 text-left transition-colors hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between sm:p-4"
      >
        <span className="flex min-w-0 items-start gap-3 sm:items-center">
          <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums', rank === 1 ? 'bg-brand-soft text-brand-fg' : 'bg-surface-2 text-fg-subtle')}>{rank}</span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-bold text-fg sm:text-[15px]">{sup.supplierName}</span>
              {sup.sharePercent > 0 && <Badge tone="brand">{sup.sharePercent}% share</Badge>}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-subtle">
              {sup.village && <span className="inline-flex items-center gap-1"><MapPin className="size-3" aria-hidden="true" />{sup.village}{sup.city ? `, ${sup.city}` : ''}</span>}
              {sup.phone && <span className="tabular-nums">{sup.phone}</span>}
              <span>{sup.entriesCount} delivery {sup.entriesCount === 1 ? 'slip' : 'slips'}</span>
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center justify-between gap-4 pl-10 sm:justify-end sm:pl-0">
          <span className="hidden items-center gap-1.5 md:flex">
            {sup.buffaloLiters > 0 && <Badge>Buffalo {formatQty(sup.buffaloLiters)} L</Badge>}
            {sup.cowLiters > 0 && <Badge>Cow {formatQty(sup.cowLiters)} L</Badge>}
            {sup.mixedLiters > 0 && <Badge>Mixed {formatQty(sup.mixedLiters)} L</Badge>}
          </span>
          <span className="text-right">
            <span className="block text-base font-bold tabular-nums text-fg sm:text-lg">{formatQty(sup.totalLiters)} <span className="text-xs font-semibold text-fg-subtle">L</span></span>
            <span className="block text-xs text-fg-subtle"><Money amount={sup.totalAmount} className="font-semibold text-fg-muted" /> · @ {rateText(sup.avgRate)}/L</span>
          </span>
          <ChevronDown className={cn('size-4 shrink-0 text-fg-faint transition-transform duration-150', expanded && 'rotate-180')} aria-hidden="true" />
        </span>
      </button>
      <div className="h-1 bg-surface-2" aria-hidden="true"><div className="h-full bg-info" style={{ width: `${Math.min(100, sup.sharePercent)}%` }} /></div>
      {expanded && (
        <div id={panelId} className="border-t border-line bg-surface-2/50 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3 border-b border-line pb-2 text-xs font-semibold text-fg-subtle">
            <span>Delivery history ({sup.entries.length} inward {sup.entries.length === 1 ? 'slip' : 'slips'})</span>
            {onOpenKhata && <Button variant="ghost" size="sm" rightIcon={<ExternalLink />} onClick={onOpenKhata}>Open supplier khata</Button>}
          </div>
          <ul className="divide-y divide-line">
            {sup.entries.map((slip, index) => {
              const when = slipWhen(slip.date);
              return (
                <li key={slip.id || index} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-fg">{when.day}</span>
                      {when.time && <span className="tabular-nums text-fg-subtle">{when.time}</span>}
                      <ShiftBadge slip={slip} />
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
                      <span className="font-semibold text-fg-muted">{slip.milk_type || 'Milk'}</span>
                      {Number(slip.fat) > 0 && <span>Fat {slip.fat}%</span>}
                      {Number(slip.snf) > 0 && <span>SNF {slip.snf}</span>}
                    </span>
                  </span>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="block font-bold text-fg">{formatQty(slip.quantity)} L @ {rateText(slip.rate)}</span>
                    <Money amount={slip.total_amount} className="font-semibold text-fg-muted" />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </li>
  );
};

const MilkProcurementDetailModal: React.FC<MilkProcurementDetailModalProps> = ({
  isOpen,
  onClose,
  purchases = [],
  suppliers = [],
  periodLabel,
  dateRangeText = '',
  totalMilkLiters,
  totalMilkCost,
  avgMilkRate,
  buffaloLiters,
  cowLiters,
  onOpenProcurement,
  onNavigateToSupplier,
  layout = 'dialog',
}) => {
  const isPage = layout === 'page';
  const titleId = useId();
  const [searchQuery, setSearchQuery] = useState('');
  const [varietyFilter, setVarietyFilter] = useState<Variety>('all');
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('by_supplier');
  const [expandedSupplierIds, setExpandedSupplierIds] = useState<Set<string>>(() => new Set());
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (isPage || !isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => { if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); };
  }, [isOpen, isPage]);

  const supplierById = useMemo(() => new Map(suppliers.map(s => [s.id, s])), [suppliers]);
  const livePurchases = useMemo(() => purchases.filter(p => p.date && p.status !== 'Cancelled' && p.status !== 'Returned'), [purchases]);

  const supplierSummaries = useMemo(() => {
    const map: Record<string, SupplierSummary> = {};
    for (const p of livePurchases) {
      const supId = p.supplier_id || 'unknown';
      const sup = supplierById.get(supId);
      const row = map[supId] || (map[supId] = {
        supplierId: supId,
        supplierName: sup?.name || p.supplier_name || 'Walk-in Farmer',
        phone: sup?.phone || '',
        village: sup?.village || '',
        city: sup?.city || '',
        totalLiters: 0, totalAmount: 0, avgRate: 0, buffaloLiters: 0, cowLiters: 0, mixedLiters: 0, entriesCount: 0, sharePercent: 0, entries: [],
      });
      const qty = Number(p.quantity) || 0;
      row.totalLiters += qty;
      row.totalAmount += Number(p.total_amount) || 0;
      row.entriesCount += 1;
      row.entries.push(p);
      const variety = milkVariety(p.milk_type);
      if (variety === 'buffalo') row.buffaloLiters += qty;
      else if (variety === 'cow') row.cowLiters += qty;
      else row.mixedLiters += qty;
    }
    return Object.values(map).map(sup => {
      sup.avgRate = sup.totalLiters > 0 ? sup.totalAmount / sup.totalLiters : 0;
      sup.sharePercent = totalMilkLiters > 0 ? Math.round((sup.totalLiters / totalMilkLiters) * 100) : 0;
      sup.entries.sort((a, b) => slipTime(b) - slipTime(a));
      return sup;
    }).sort((a, b) => b.totalLiters - a.totalLiters);
  }, [livePurchases, supplierById, totalMilkLiters]);

  const query = searchQuery.toLowerCase().trim();
  const filteredSuppliers = useMemo(() => supplierSummaries.filter(sup => {
    if (query && ![sup.supplierName, sup.phone, sup.village, sup.city].some(field => field.toLowerCase().includes(query))) return false;
    if (varietyFilter === 'buffalo' && sup.buffaloLiters <= 0) return false;
    if (varietyFilter === 'cow' && sup.cowLiters <= 0) return false;
    if (varietyFilter === 'mixed' && sup.mixedLiters <= 0) return false;
    if (shiftFilter !== 'all' && !sup.entries.some(e => (e.shift || '').toLowerCase().includes(shiftFilter))) return false;
    return true;
  }), [supplierSummaries, query, varietyFilter, shiftFilter]);

  // Same variety split as the supplier view: anything that is not buffalo or cow counts as mixed.
  const filteredSlips: Slip[] = useMemo(() => livePurchases.flatMap((p: PurchaseEntry): Slip[] => {
    const sup = supplierById.get(p.supplier_id);
    const supplierName = sup?.name || p.supplier_name || 'Walk-in Farmer';
    if (query && ![supplierName, sup?.phone || '', sup?.village || '', sup?.city || ''].some(field => field.toLowerCase().includes(query))) return [];
    if (varietyFilter !== 'all' && milkVariety(p.milk_type) !== varietyFilter) return [];
    if (shiftFilter !== 'all' && !(p.shift || '').toLowerCase().includes(shiftFilter)) return [];
    return [{ ...p, supplierName, supplierVillage: sup?.village || '' }];
  }).sort((a, b) => slipTime(b) - slipTime(a)), [livePurchases, supplierById, query, varietyFilter, shiftFilter]);

  const filterKey = `${query}|${varietyFilter}|${shiftFilter}|${viewMode}`;
  const supplierList = useProgressiveList<SupplierSummary>(filteredSuppliers, 40, filterKey);
  const slipList = useProgressiveList<Slip>(filteredSlips, 60, filterKey);

  const toggleSupplier = (id: string) => setExpandedSupplierIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (!isPage && !isOpen) return null;

  const openProcurement = onOpenProcurement ? () => { if (!isPage) onClose(); onOpenProcurement(); } : undefined;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isPage) return;
    // Keys typed inside the dialog belong to it, never to page shortcuts behind it.
    event.stopPropagation();
    // The search box clears itself on the first Esc (and marks the event handled).
    if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onCloseRef.current(); return; }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const controls = (Array.from(dialogRef.current.querySelectorAll(FOCUSABLE)) as HTMLElement[]).filter(el => el.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const summary = [
    { label: 'Total milk inward', value: <>{formatQty(totalMilkLiters)}<span className="ml-1 text-xs font-semibold text-fg-subtle">L</span></>, note: `Buffalo ${formatQty(buffaloLiters)} L · Cow ${formatQty(cowLiters)} L` },
    { label: 'Procurement cost', value: <Money amount={totalMilkCost} />, note: 'Kul khareedari raqam' },
    { label: 'Weighted avg rate', value: <>{rateText(avgMilkRate)}<span className="ml-1 text-xs font-semibold text-fg-subtle">/L</span></>, note: 'Average rate per litre' },
    { label: 'Active suppliers', value: <>{supplierSummaries.length}<span className="ml-1 text-xs font-semibold text-fg-subtle">farmers</span></>, note: `${livePurchases.length} delivery slips` },
  ];

  const panel = (
    <div
      ref={dialogRef}
      role={isPage ? 'region' : 'dialog'}
      aria-modal={isPage ? undefined : true}
      aria-labelledby={titleId}
      tabIndex={-1}
      className={isPage
        ? 'relative flex w-full flex-col overflow-hidden rounded-card border border-line bg-surface shadow-e1'
        : 'relative flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-card border border-line bg-surface shadow-e3 outline-none animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none'}
      onClick={event => event.stopPropagation()}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-info-soft text-info-fg"><Droplets className="size-5" aria-hidden="true" /></span>
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-base font-bold tracking-tight text-fg sm:text-lg">Milk procurement breakdown</h2>
            <p className="truncate text-xs text-fg-subtle">
              <span className="font-semibold text-fg-muted">{periodLabel}</span>
              {dateRangeText && <span> ({dateRangeText})</span>}
              <span> · {supplierSummaries.length} farmers / suppliers contributed</span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {openProcurement && <Button variant="soft" size="sm" rightIcon={<ArrowUpRight />} onClick={openProcurement} className="hidden sm:inline-flex">Milk intake counter</Button>}
          {!isPage && <IconButton icon={<X />} aria-label="Close (Esc)" onClick={onClose} />}
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-2.5 border-b border-line bg-surface-2/60 px-4 py-4 sm:grid-cols-4 sm:px-6">
        {summary.map(tile => (
          <div key={tile.label} className="min-w-0 rounded-control border border-line bg-surface p-3 shadow-e1">
            <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{tile.label}</p>
            <p className="mt-1 truncate text-lg font-bold tabular-nums text-fg sm:text-xl">{tile.value}</p>
            <p className="mt-0.5 truncate text-[11px] text-fg-subtle">{tile.note}</p>
          </div>
        ))}
      </div>

      <div className="flex shrink-0 flex-col gap-2.5 border-b border-line px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search farmer name, village or phone..." className="w-full lg:max-w-xs" />
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl<Variety> aria-label="Milk variety" size="sm" value={varietyFilter} onChange={setVarietyFilter}
            options={[{ value: 'all', label: 'All' }, { value: 'buffalo', label: 'Buffalo' }, { value: 'cow', label: 'Cow' }, { value: 'mixed', label: 'Mixed' }]} />
          <SegmentedControl<ShiftFilter> aria-label="Shift" size="sm" value={shiftFilter} onChange={setShiftFilter}
            options={[{ value: 'all', label: 'All shifts' }, { value: 'morning', label: 'Morning', icon: <Sun /> }, { value: 'evening', label: 'Evening', icon: <Moon /> }]} />
          <SegmentedControl<ViewMode> aria-label="View" size="sm" value={viewMode} onChange={setViewMode}
            options={[{ value: 'by_supplier', label: 'By farmer', icon: <Users /> }, { value: 'all_slips', label: 'All slips', icon: <FileText />, count: filteredSlips.length }]} />
        </div>
      </div>

      <div className={cn('space-y-3 bg-canvas/60 px-4 py-4 sm:px-6', !isPage && 'min-h-0 flex-1 overflow-y-auto overscroll-contain')}>
        {viewMode === 'by_supplier' ? (
          <>
            <div className="flex items-center justify-between gap-3 px-1 text-xs text-fg-subtle">
              <span>Showing <strong className="text-fg">{filteredSuppliers.length}</strong> farmers in this period</span>
              {filteredSuppliers.length > 0 && (
                <span className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setExpandedSupplierIds(new Set(filteredSuppliers.map(s => s.supplierId)))}>Expand all</Button>
                  <Button variant="ghost" size="sm" onClick={() => setExpandedSupplierIds(new Set())}>Collapse all</Button>
                </span>
              )}
            </div>
            {filteredSuppliers.length === 0 ? (
              <EmptyState icon={<Droplets />} title="No milk procurement records found" description="No farmers supplied milk matching the selected filters for this time window." />
            ) : (
              <>
                <ul className="space-y-3">
                  {supplierList.visibleItems.map((sup, index) => (
                    <SupplierRow
                      key={sup.supplierId}
                      sup={sup}
                      rank={index + 1}
                      expanded={expandedSupplierIds.has(sup.supplierId)}
                      onToggle={() => toggleSupplier(sup.supplierId)}
                      onOpenKhata={onNavigateToSupplier && sup.supplierId !== 'unknown' ? () => { onClose(); onNavigateToSupplier(sup.supplierId); } : undefined}
                    />
                  ))}
                </ul>
                <LoadMoreRow sentinelRef={supplierList.sentinelRef} hiddenCount={supplierList.hiddenCount} onShowMore={supplierList.showMore} onShowAll={supplierList.showAll} />
              </>
            )}
          </>
        ) : (
          <div className="overflow-hidden rounded-card border border-line bg-surface shadow-e1">
            <Table className="text-xs">
              <THead>
                <tr>
                  <TH>Date & time</TH>
                  <TH>Farmer / supplier</TH>
                  <TH>Shift</TH>
                  <TH>Variety</TH>
                  <TH numeric>Qty (L)</TH>
                  <TH numeric>Fat / SNF</TH>
                  <TH numeric>Rate (Rs)</TH>
                  <TH numeric>Amount (Rs)</TH>
                </tr>
              </THead>
              <TBody>
                {filteredSlips.length === 0 ? (
                  <tr><td colSpan={8}><EmptyState size="compact" icon={<FileText />} title="No delivery slips match these filters" /></td></tr>
                ) : slipList.visibleItems.map((slip, index) => {
                  const when = slipWhen(slip.date);
                  return (
                    <TR key={slip.id || index}>
                      <TD className="whitespace-nowrap py-2.5"><span className="block font-semibold">{when.day}</span>{when.time && <span className="text-[11px] tabular-nums text-fg-subtle">{when.time}</span>}</TD>
                      <TD className="py-2.5"><span className="block font-semibold">{slip.supplierName}</span>{slip.supplierVillage && <span className="text-[11px] text-fg-subtle">{slip.supplierVillage}</span>}</TD>
                      <TD className="whitespace-nowrap py-2.5"><ShiftBadge slip={slip} /></TD>
                      <TD className="whitespace-nowrap py-2.5 text-fg-muted">{slip.milk_type || 'Milk'}</TD>
                      <TD numeric className="py-2.5">{formatQty(slip.quantity)}</TD>
                      <TD numeric className="py-2.5 font-normal text-fg-subtle">{slip.fat ? `${slip.fat}%` : '—'}{slip.snf ? ` / ${slip.snf}` : ''}</TD>
                      <TD numeric className="py-2.5 font-medium text-fg-muted">{cleanNumber(slip.rate, 1).toFixed(1)}</TD>
                      <TD numeric className="py-2.5">{formatCurrency(slip.total_amount, '')}</TD>
                    </TR>
                  );
                })}
                <LoadMoreRow colSpan={8} sentinelRef={slipList.sentinelRef} hiddenCount={slipList.hiddenCount} onShowMore={slipList.showMore} onShowAll={slipList.showAll} />
              </TBody>
            </Table>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-3 border-t border-line bg-surface-2/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-xs text-fg-subtle">Total for selected period: <strong className="tabular-nums text-fg">{formatQty(totalMilkLiters)} L</strong> ({formatCurrency(totalMilkCost)})</p>
        <div className="flex items-center gap-2">
          {openProcurement && <Button size="sm" rightIcon={<ArrowUpRight />} onClick={openProcurement}>Record new milk intake</Button>}
          {!isPage && <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>}
        </div>
      </div>
    </div>
  );

  if (isPage) return panel;
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4" data-app-modal="true" onKeyDown={handleKeyDown}>
      <div className="absolute inset-0 bg-slate-950/60 animate-in fade-in duration-150 motion-reduce:animate-none" aria-hidden="true" onClick={onClose} />
      {panel}
    </div>,
    document.body,
  );
};

export default MilkProcurementDetailModal;
