import React, { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, FileSpreadsheet, FileText, Link2, ListTree, Loader2, Lock, MessageCircle,
  Printer, RefreshCw, Star, X
} from 'lucide-react';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { ReportCard, ReportCatalog, ReportCatalogGrid } from '../components/reports/ReportCatalog';
import { ReportToolbar, FilterOptions } from '../components/reports/ReportToolbar';
import { ReportTable } from '../components/reports/ReportTable';
import { Insights, KPI_TONE, KpiGrid, NotesList, StatementCard } from '../components/reports/ReportBlocks';
import { ReportIcon } from '../components/reports/ReportIcon';
import { loadedExport, preloadExport } from '../components/reports/exportLoader';
import { Button, Card, EmptyState, IconButton, Kbd, PageHeader, SearchInput, Skeleton, StatCard, StatGrid } from '../components/ui';
import { cn } from '../lib/cn';
import { getReport, REPORT_CATEGORIES, REPORTS } from '../lib/reports/registry';
import { presetLabel, presetRange, rangeText } from '../lib/reports/presets';
import { businessDate, itemCategory, previousRange } from '../lib/reports/helpers';
import { formatValue } from '../lib/reports/format';
import type { ExportInput } from '../lib/reports/export';
import type { FilterKey, GroupBy, ReportChart as ChartSpec, ReportColumn, ReportData, ReportDefinition, ReportFilters, ReportResult, ReportRow } from '../lib/reports/types';
import '../styles/reports.css';

// Recharts is only needed once a report with charts is open.
const ReportChart = lazy(() => import('../components/reports/ReportChart'));

const FILTER_KEYS: Exclude<FilterKey, 'groupBy'>[] = ['customerId', 'supplierId', 'itemId', 'accountId', 'category', 'paymentMode', 'cashierId', 'milkType', 'shift'];

type ExportKind = 'xlsx' | 'csv' | 'print' | 'share' | 'link';
const EXPORTS: { kind: ExportKind; icon: React.ElementType; label: string; hint: string; needsPermission: boolean }[] = [
  { kind: 'xlsx', icon: FileSpreadsheet, label: 'Excel workbook (.xlsx)', hint: 'Every table on its own sheet', needsPermission: true },
  { kind: 'print', icon: Printer, label: 'Print / Save as PDF', hint: 'Letterhead, A4 ready', needsPermission: true },
  { kind: 'csv', icon: FileText, label: 'CSV file', hint: 'For any spreadsheet app', needsPermission: true },
  { kind: 'share', icon: MessageCircle, label: 'Share on WhatsApp', hint: 'Summary as a message', needsPermission: true },
  { kind: 'link', icon: Link2, label: 'Copy report link', hint: 'Same report, dates & filters', needsPermission: false },
];

function runReport(report: ReportDefinition, data: ReportData, filters: ReportFilters): ReportResult {
  try {
    return report.build(data, filters);
  } catch (error) {
    console.error(`[Reports] ${report.id} failed`, error);
    return { notes: [{ tone: 'bad', text: `This report could not be prepared: ${error instanceof Error ? error.message : String(error)}` }] };
  }
}

/** Per-operator list (favourites, recent) kept on this device. */
function useStoredList(key: string, limit = 30) {
  const read = () => {
    try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; } catch { return []; }
  };
  const [list, setList] = useState<string[]>(read);
  useEffect(() => { setList(read()); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useCallback((next: string[]) => {
    const trimmed = next.slice(0, limit);
    setList(trimmed);
    try { localStorage.setItem(key, JSON.stringify(trimmed)); } catch { /* storage full or blocked */ }
  }, [key, limit]);
  return [list, save] as const;
}

const visibleInput = (...inputs: (HTMLInputElement | null)[]) => inputs.find(el => el && el.offsetParent !== null) || null;

const Reports: React.FC = () => {
  const dairy = useDairy();
  const { canPerform, currentUser, settings, isDataLoading, dataLoadError, retryLoading } = dairy;
  const { showToast } = useToast();
  const [params, setParams] = useSearchParams();
  const homeSearchRef = useRef<HTMLInputElement>(null);
  const catalogSearchRef = useRef<HTMLInputElement>(null);
  const viewsRef = useRef<ExportInput['views']>({});
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [homeQuery, setHomeQuery] = useState('');
  const exportRef = useRef<HTMLDivElement>(null);

  const today = dairy.getBusinessDate?.() || businessDate();
  const canFinancial = canPerform('reports', 'financial');
  const canExport = canPerform('reports', 'export');
  const isLocked = useCallback((r: ReportDefinition) => Boolean(r.financial && !canFinancial), [canFinancial]);

  const userKey = currentUser?.id || 'anon';
  const [favourites, setFavourites] = useStoredList(`mooco_report_favs_${userKey}`);
  const [recent, setRecent] = useStoredList(`mooco_report_recent_${userKey}`, 8);

  const report = getReport(params.get('r'));
  const preset = params.get('p') || report?.defaultPreset || 'this_month';
  const compare = params.get('cmp') === '1';
  const filters: ReportFilters = useMemo(() => {
    const range = preset === 'custom'
      ? { from: params.get('from') || presetRange('this_month', today).from, to: params.get('to') || today }
      : presetRange(preset, today);
    // A hand-typed or edited link can carry the dates the wrong way round.
    if (range.from > range.to) [range.from, range.to] = [range.to, range.from];
    const f: ReportFilters = { ...range, groupBy: (params.get('g') as GroupBy) || 'day' };
    FILTER_KEYS.forEach(k => { const v = params.get(k); if (v) f[k] = v; });
    return f;
  }, [params, preset, today]);

  const update = useCallback((changes: Record<string, string | null | undefined>, push = false) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: !push });
  }, [params, setParams]);

  const openReport = useCallback((id: string, extra?: Partial<ReportFilters>) => {
    const target = getReport(id);
    if (!target) return;
    const next = new URLSearchParams();
    next.set('r', id);
    // Keep the dates the viewer is looking at; a report with its own default only applies it when fresh.
    if (extra?.from || extra?.to) {
      next.set('p', 'custom'); next.set('from', extra.from || filters.from); next.set('to', extra.to || filters.to);
    } else if (params.get('p')) {
      next.set('p', preset);
      if (preset === 'custom') { next.set('from', filters.from); next.set('to', filters.to); }
    } else if (target.defaultPreset) next.set('p', target.defaultPreset);
    if (compare) next.set('cmp', '1');
    FILTER_KEYS.forEach(k => { const v = extra?.[k]; if (v) next.set(k, String(v)); });
    if (extra?.groupBy) next.set('g', extra.groupBy);
    setParams(next);
    setRecent([id, ...recent.filter(x => x !== id)]);
    setCatalogOpen(false);
    setExportOpen(false);
    viewsRef.current = {};
  }, [filters.from, filters.to, params, preset, compare, setParams, recent, setRecent]);

  const goHome = () => setParams(new URLSearchParams(params.get('p') ? { p: preset, ...(preset === 'custom' ? { from: filters.from, to: filters.to } : {}) } : {}));

  const data: ReportData = useMemo(() => ({
    sales: dairy.sales, purchases: dairy.purchases, materialPurchases: dairy.materialPurchases, suppliers: dairy.suppliers,
    supplierTransactions: dairy.supplierTransactions, allocations: dairy.allocations, inventory: dairy.inventory, items: dairy.items,
    customers: dairy.customers, customerTransactions: dairy.customerTransactions, dailySupplyEntries: dairy.dailySupplyEntries,
    productionBatches: dairy.productionBatches, expenses: dairy.expenses, expenseVendors: dairy.expenseVendors,
    expenseVendorTransactions: dairy.expenseVendorTransactions, accounts: dairy.accounts, bankTransactions: dairy.bankTransactions,
    inventoryLogs: dairy.inventoryLogs, retailClosings: dairy.retailClosings, shiftSessions: dairy.shiftSessions,
    cashVariances: dairy.cashVariances, cashRemittances: dairy.cashRemittances, settings: dairy.settings, today,
  }), [
    dairy.sales, dairy.purchases, dairy.materialPurchases, dairy.suppliers, dairy.supplierTransactions, dairy.allocations,
    dairy.inventory, dairy.items, dairy.customers, dairy.customerTransactions, dairy.dailySupplyEntries, dairy.productionBatches,
    dairy.expenses, dairy.expenseVendors, dairy.expenseVendorTransactions, dairy.accounts, dairy.bankTransactions,
    dairy.inventoryLogs, dairy.retailClosings, dairy.shiftSessions, dairy.cashVariances, dairy.cashRemittances, dairy.settings, today,
  ]);

  // Heavy reports recalculate in the background so typing dates or switching filters stays smooth.
  const deferredData = useDeferredValue(data);
  const deferredFilters = useDeferredValue(filters);
  const filtersKey = JSON.stringify(deferredFilters);
  const missingRequired = Boolean(report?.requires && report.requires !== 'groupBy' && !filters[report.requires]);
  const locked = report ? isLocked(report) : false;

  const result = useMemo(() => (report && !locked && !missingRequired ? runReport(report, deferredData, deferredFilters) : null),
    [report, locked, missingRequired, deferredData, filtersKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const prevRange = useMemo(() => previousRange(deferredFilters.from, deferredFilters.to), [deferredFilters.from, deferredFilters.to]);
  const previous = useMemo(() => (result && compare && report?.comparable && !report.snapshot ? runReport(report, deferredData, { ...deferredFilters, ...prevRange }) : null),
    [result, compare, report, deferredData, filtersKey, prevRange]); // eslint-disable-line react-hooks/exhaustive-deps
  const isStale = deferredFilters !== filters || deferredData !== data;

  const overview = useMemo(() => {
    if (report || !canFinancial) return null;
    const def = getReport('business_overview');
    if (!def) return null;
    const range = presetRange('today', today);
    return runReport(def, deferredData, { ...range, groupBy: 'day' })?.kpis?.slice(0, 4) || null;
  }, [report, canFinancial, deferredData, today]);

  const options: FilterOptions = useMemo(() => {
    if (!report?.filters?.length) return {};
    const need = new Set(report.filters);
    const o: FilterOptions = {};
    if (need.has('customerId')) o.customerId = [...data.customers].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name))
      .map(c => ({ value: c.id, label: c.name, subLabel: [c.phone, c.route].filter(Boolean).join(' · '), badge: c.balance ? { text: `Rs ${Math.round(c.balance).toLocaleString('en-PK')}`, variant: c.balance > 0 ? 'red' : 'green' } : undefined, avatarLetter: c.name.charAt(0) }));
    if (need.has('supplierId')) o.supplierId = [...data.suppliers].sort((a, b) => a.name.localeCompare(b.name))
      .map(s => ({ value: s.id, label: s.name, subLabel: [s.phone, s.village].filter(Boolean).join(' · '), avatarLetter: s.name.charAt(0) }));
    if (need.has('itemId')) o.itemId = [...data.items].sort((a, b) => a.name.localeCompare(b.name)).map(i => ({ value: i.id, label: i.name, subLabel: `${itemCategory(i)} · ${i.unit}` }));
    if (need.has('accountId')) o.accountId = data.accounts.map(a => ({ value: a.id, label: a.name, subLabel: a.type, badge: { text: `Rs ${Math.round(a.balance || 0).toLocaleString('en-PK')}`, variant: 'slate' } }));
    if (need.has('category')) {
      const cats = report.category === 'expenses'
        ? [...new Set(data.expenses.map(e => e.category).filter(Boolean))]
        : [...new Set(data.items.map(itemCategory))];
      o.category = cats.sort().map(c => ({ value: c, label: c }));
    }
    if (need.has('paymentMode')) o.paymentMode = ['Cash', 'Online', 'Credit'].map(m => ({ value: m, label: m }));
    if (need.has('cashierId')) {
      const map = new Map<string, string>();
      dairy.users.forEach(u => map.set(u.id, u.name));
      data.shiftSessions.forEach(s => s.user_id && !map.has(s.user_id) && map.set(s.user_id, s.user_name));
      o.cashierId = [...map.entries()].map(([value, label]) => ({ value, label }));
    }
    if (need.has('milkType')) o.milkType = [...new Set(['Buffalo', 'Cow', 'Mixed', ...data.purchases.map(p => String(p.milk_type || '')).filter(Boolean)])].map(m => ({ value: m, label: m }));
    if (need.has('shift')) o.shift = (settings.general.shifts?.length ? settings.general.shifts : ['Morning', 'Evening']).map(s => ({ value: s, label: s }));
    return o;
  }, [report, data, dairy.users, settings.general.shifts]);

  const rangeLabel = report?.snapshot ? `As of ${rangeText(today, today)}` : rangeText(filters.from, filters.to);
  const onViewChange = useCallback((id: string, view: { rows: ReportRow[]; columns: ReportColumn[] }) => { viewsRef.current = { ...viewsRef.current, [id]: view }; }, []);
  const hasContent = Boolean(result && (result.kpis?.length || result.tables?.length || result.statements?.length || result.charts?.length));
  // Exports describe what is on screen: the result's own (deferred) dates, never dates still being calculated.
  const exportInput = (): ExportInput | null => (report && result && hasContent ? {
    report, result, filters: deferredFilters, generatedBy: currentUser?.name, views: viewsRef.current, company: settings.general,
    rangeLabel: report.snapshot ? `As of ${rangeText(today, today)}` : rangeText(deferredFilters.from, deferredFilters.to),
  } : null);

  const copyLink = () => {
    const done = (ok: boolean) => showToast(ok ? 'Report link copied' : 'Could not copy the link', ok ? 'success' : 'error');
    if (!navigator.clipboard?.writeText) { done(false); return; }
    navigator.clipboard.writeText(window.location.href).then(() => done(true), () => done(false));
  };

  const runExport = (mod: typeof import('../lib/reports/export'), kind: ExportKind, input: ExportInput) => {
    try {
      if (kind === 'xlsx') { mod.exportXlsx(input); showToast('Excel file downloaded', 'success'); }
      if (kind === 'csv') { mod.exportCsv(input); showToast('CSV file downloaded', 'success'); }
      if (kind === 'print' && !mod.printReport(input)) showToast('Pop-up blocked. Allow pop-ups to print or save PDF.', 'warning');
      if (kind === 'share') {
        const text = mod.shareText(input);
        const whatsapp = () => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
        if (navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
          navigator.share({ title: input.report.title, text }).catch((error: unknown) => { if ((error as Error)?.name !== 'AbortError') whatsapp(); });
        } else whatsapp();
      }
    } catch (error) {
      console.error('[Reports] export failed', error);
      showToast('Export could not be completed', 'error');
    }
  };

  const doExport = (kind: ExportKind) => {
    setExportOpen(false);
    if (kind === 'link') { copyLink(); return; }
    if (!canExport) { showToast("You don't have permission to export reports.", 'warning'); return; }
    if (exporting) return;
    const input = exportInput();
    if (!input) return;
    const mod = loadedExport();
    // Print and share open windows, which browsers allow only inside the click itself.
    if (mod && (kind === 'print' || kind === 'share')) { runExport(mod, kind, input); return; }
    setExporting(kind);
    preloadExport()
      // A frame for the spinner to paint before a large workbook is built.
      .then(m => new Promise<void>(resolve => setTimeout(() => { runExport(m, kind, input); resolve(); }, 30)))
      .catch(() => showToast('Export could not be loaded. Check the connection and try again.', 'error'))
      .finally(() => setExporting(null));
  };

  useEffect(() => {
    if (!exportOpen) return;
    const close = (e: MouseEvent) => { if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setExportOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [exportOpen]);

  useEffect(() => {
    if (!catalogOpen) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setCatalogOpen(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [catalogOpen]);

  // "/" jumps to report search, like most dashboards.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const input = visibleInput(homeSearchRef.current, catalogSearchRef.current);
      e.preventDefault();
      if (input) input.focus();
      else if (report) setCatalogOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [report]);

  const toggleFavourite = useCallback((id: string) => {
    setFavourites(favourites.includes(id) ? favourites.filter(x => x !== id) : [id, ...favourites]);
  }, [favourites, setFavourites]);

  const openById = useCallback((id: string) => openReport(id), [openReport]);
  const onDrill = useCallback((row: ReportRow) => { if (row._drill) openReport(row._drill.report, row._drill.filters); }, [openReport]);
  const onCopied = useCallback((ok: boolean) => showToast(ok ? 'Table copied — paste it into Excel' : 'Could not copy the table', ok ? 'success' : 'error'), [showToast]);

  const catalog = (
    <ReportCatalog reports={REPORTS} activeId={report?.id} favourites={favourites} recent={recent} isLocked={isLocked}
      onOpen={openById} onToggleFavourite={toggleFavourite} searchRef={catalogSearchRef} />
  );

  const category = REPORT_CATEGORIES.find(c => c.id === report?.category);
  const canGoBack = (window.history.state?.idx ?? 0) > 0;
  const isFavourite = report ? favourites.includes(report.id) : false;
  const exportBlocked = !hasContent || isStale;

  return (
    <div className="flex gap-5 pb-6">
      {/* Catalogue: docked beside an open report on large screens, a drawer on phones and tablets */}
      {report && (
        <aside className="sticky top-4 hidden h-[calc(100dvh-7.5rem)] w-72 shrink-0 overflow-hidden rounded-card border border-line bg-surface shadow-e1 lg:block print:hidden">
          {catalog}
        </aside>
      )}
      {catalogOpen && (
        <div className="fixed inset-0 z-50 lg:hidden print:hidden" role="dialog" aria-modal="true" aria-label="All reports">
          <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-slate-950/50" onClick={() => setCatalogOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(22rem,88vw)] flex-col bg-surface shadow-e3 animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="text-sm font-bold text-fg">All reports</span>
              <IconButton size="sm" icon={<X />} aria-label="Close" onClick={() => setCatalogOpen(false)} />
            </div>
            <div className="min-h-0 flex-1">{catalog}</div>
          </div>
        </div>
      )}

      <div className="min-w-0 flex-1 space-y-4">
        {(isDataLoading || dataLoadError) && (
          <div role="status" className={cn('flex items-center gap-2 rounded-control px-3 py-2 text-xs font-medium ring-1 ring-inset print:hidden',
            dataLoadError ? 'bg-warning-soft text-warning-fg ring-warning/25' : 'bg-surface text-fg-subtle ring-line')}>
            {dataLoadError ? <AlertTriangle size={14} aria-hidden="true" /> : <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            <span className="flex-1">{dataLoadError ? `${dataLoadError} Reports may be incomplete.` : 'Loading the latest records — figures will refresh automatically.'}</span>
            {dataLoadError && !isDataLoading && <Button variant="ghost" size="sm" leftIcon={<RefreshCw />} onClick={() => void retryLoading()}>Retry</Button>}
          </div>
        )}

        {!report ? (
          <ReportsHome favourites={favourites} recent={recent} overview={overview} isLocked={isLocked} onOpen={openById}
            onToggleFavourite={toggleFavourite} query={homeQuery} onQuery={setHomeQuery} searchRef={homeSearchRef} />
        ) : (
          <>
            <div className="flex flex-wrap items-start gap-3">
              <IconButton variant="secondary" icon={<ArrowLeft />} aria-label="Back" onClick={() => (canGoBack ? window.history.back() : goHome())} className="mt-0.5 print:hidden" />
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-fg">
                <ReportIcon name={report.icon} size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <nav className="flex items-center gap-1 text-[11px] font-semibold text-fg-subtle print:hidden" aria-label="Breadcrumb">
                  <button type="button" onClick={goHome} className="rounded hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Reports</button>
                  <ChevronRight size={11} aria-hidden="true" />
                  <span>{category?.label}</span>
                </nav>
                <h2 className="flex items-center gap-1 text-xl font-bold tracking-tight text-fg sm:text-2xl">
                  <span className="truncate">{report.title}</span>
                  <IconButton size="sm" onClick={() => toggleFavourite(report.id)} aria-pressed={isFavourite} aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
                    icon={<Star fill={isFavourite ? 'currentColor' : 'none'} />} className={cn('print:hidden', isFavourite ? 'text-warning hover:text-warning' : 'text-fg-faint hover:text-warning')} />
                </h2>
                <p className="text-[13px] text-fg-subtle">
                  {report.subtitle} · <span className="font-semibold text-fg-muted">{rangeLabel}</span>
                  {!report.snapshot && preset !== 'custom' && <span> ({presetLabel(preset)})</span>}
                </p>
              </div>
              <div className="flex w-full items-center gap-2 sm:w-auto print:hidden">
                <Button variant="secondary" leftIcon={<ListTree />} onClick={() => setCatalogOpen(true)} className="lg:hidden">Reports</Button>
                <div ref={exportRef} className="relative ml-auto sm:ml-0">
                  <Button leftIcon={<FileSpreadsheet />} rightIcon={<ChevronDown />} loading={Boolean(exporting)}
                    onClick={() => setExportOpen(v => !v)} onPointerEnter={() => void preloadExport().catch(() => {})} onFocus={() => void preloadExport().catch(() => {})}
                    disabled={!hasContent} aria-expanded={exportOpen} aria-haspopup="menu"
                    title={!hasContent ? 'Nothing to export yet' : undefined}>
                    {exporting ? 'Exporting…' : 'Export'}
                  </Button>
                  {exportOpen && (
                    <div role="menu" aria-label="Export" className="absolute right-0 top-12 z-40 w-64 rounded-card border border-line bg-surface p-1.5 shadow-e2 animate-fade-up">
                      {EXPORTS.map(o => {
                        const disabled = (o.needsPermission && !canExport) || (o.kind !== 'link' && exportBlocked);
                        return (
                          <button key={o.kind} type="button" role="menuitem" onClick={() => doExport(o.kind)} disabled={disabled}
                            className="flex w-full items-center gap-3 rounded-control px-3 py-2 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg-muted"><o.icon size={16} aria-hidden="true" /></span>
                            <span className="min-w-0"><span className="block text-[13px] font-semibold text-fg">{o.label}</span><span className="block text-[11px] text-fg-subtle">{o.hint}</span></span>
                          </button>
                        );
                      })}
                      {!canExport && <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-warning-fg">Export needs the “Export reports” permission.</p>}
                      {canExport && isStale && <p className="flex items-center gap-1.5 px-3 pb-1 pt-1.5 text-[11px] text-fg-subtle"><Loader2 size={11} className="animate-spin" aria-hidden="true" />Updating figures — export in a moment.</p>}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <ReportToolbar
              report={report} filters={filters} preset={preset} today={today} compare={compare} options={options}
              onPreset={id => update({ p: id, from: null, to: null })}
              onRange={(from, to) => update({ p: 'custom', from: from <= to ? from : to, to: from <= to ? to : from })}
              onFilter={(key, value) => update({ [key === 'groupBy' ? 'g' : key]: value || null })}
              onCompare={on => update({ cmp: on ? '1' : null })}
              onReset={() => update(Object.fromEntries(FILTER_KEYS.map(k => [k, null])))}
            />

            {locked ? (
              <Card><EmptyState icon={<Lock />} title="This report shows profit and balances" description="Ask the owner to give you the “View profit & financial reports” permission." /></Card>
            ) : missingRequired ? (
              <Card>
                <EmptyState icon={<ReportIcon name={report.icon} />}
                  title={`Choose a ${report.requires === 'customerId' ? 'customer' : report.requires === 'supplierId' ? 'supplier' : report.requires === 'itemId' ? 'product' : 'account'} above`}
                  description="This report is prepared for one record at a time." />
              </Card>
            ) : result ? (
              <div className={cn('space-y-4 transition-opacity duration-150', isStale && 'opacity-60')} aria-busy={isStale}>
                {result.kpis?.length ? <KpiGrid kpis={result.kpis} previous={previous?.kpis} previousLabel={rangeText(prevRange.from, prevRange.to)} /> : null}
                {compare && previous && <p className="-mt-1 text-xs text-fg-subtle">Compared with {rangeText(prevRange.from, prevRange.to)}</p>}
                {result.insights?.length ? <Insights items={result.insights} /> : null}
                {result.notes?.length ? <NotesList notes={result.notes} /> : null}
                {result.statements?.length ? <div className="grid gap-4 xl:grid-cols-2">{result.statements.map(s => <StatementCard key={s.id} statement={s} />)}</div> : null}
                {result.charts?.length ? (
                  <div className="grid gap-4 lg:grid-cols-2 print:grid-cols-2">
                    <Suspense fallback={result.charts.map(c => <ChartSkeleton key={c.id} spec={c} />)}>
                      {result.charts.map(c => <ReportChart key={c.id} spec={c} />)}
                    </Suspense>
                  </div>
                ) : null}
                {result.tables?.map(t => <ReportTable key={`${report.id}:${t.id}`} table={t} onDrill={onDrill} onViewChange={onViewChange} onCopied={onCopied} />)}
                {!hasContent && !result.notes?.length && (
                  <Card><EmptyState icon={<ReportIcon name={report.icon} />} title="Nothing to show" description="Try a wider date range or clear the filters." /></Card>
                )}
              </div>
            ) : (
              <ReportSkeleton />
            )}
          </>
        )}
      </div>
    </div>
  );
};

const ChartSkeleton: React.FC<{ spec: ChartSpec }> = ({ spec }) => (
  <Card className={cn('p-5', spec.wide && 'lg:col-span-2')}>
    <p className="mb-4 text-[15px] font-bold text-fg">{spec.title}</p>
    <Skeleton className="h-64 w-full" />
  </Card>
);

const ReportSkeleton = () => (
  <div className="space-y-4" aria-busy="true" aria-label="Preparing report">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
      {[0, 1, 2, 3].map(i => <div key={i} className="min-w-0"><StatCard label="" value="" loading className="h-full" /></div>)}
    </div>
    <Card className="space-y-3 p-5"><Skeleton className="h-4 w-40" />{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-8 w-full" />)}</Card>
  </div>
);

const ReportsHome = ({ favourites, recent, overview, isLocked, onOpen, onToggleFavourite, query, onQuery, searchRef }: {
  favourites: string[]; recent: string[]; overview: ReportResult['kpis'] | null;
  isLocked: (r: ReportDefinition) => boolean; onOpen: (id: string) => void; onToggleFavourite: (id: string) => void;
  query: string; onQuery: (q: string) => void; searchRef: React.Ref<HTMLInputElement>;
}) => {
  const quick = useMemo(() => [...new Set([...favourites, ...recent])].map(id => getReport(id)).filter(Boolean).slice(0, 6) as ReportDefinition[], [favourites, recent]);
  const favouriteSet = useMemo(() => new Set(favourites), [favourites]);
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reports centre"
        title={`${REPORTS.length} live reports for your dairy`}
        description="Sales, profit, ledgers, milk, stock and cash — every figure from your live records, with compare, drill-down and one-click Excel / PDF."
      />

      {overview?.length ? (
        <div className="space-y-2">
          <h3 className="hidden text-xs font-semibold text-fg-muted md:block">Today</h3>
          <StatGrid
            label="Today at a glance"
            storageKey="reports-today"
            peek={overview.slice(0, 2).map(k => {
              const tone = KPI_TONE[k.tone || 'neutral'];
              return {
                value: formatValue(k.value, k.format || 'number', k.unit),
                label: k.label.toLowerCase(),
                tone: tone === 'danger' || tone === 'warning' ? tone : undefined,
              };
            })}
          >
            {overview.map(k => {
              const text = formatValue(k.value, k.format || 'number', k.unit);
              return (
                <div key={k.key} className="min-w-0">
                  <StatCard label={k.label} value={<span title={text}>{text}</span>} tone={KPI_TONE[k.tone || 'neutral']} hint={k.hint} className="h-full" />
                </div>
              );
            })}
          </StatGrid>
        </div>
      ) : null}

      <SearchInput ref={searchRef as any} value={query} onChange={onQuery} placeholder="Find a report — sales, ledger, milk, stock, profit…" aria-label="Find a report" shortcut="/" className="max-w-xl" />

      {!query && quick.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted"><Star size={12} aria-hidden="true" />Your reports</h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {quick.map(r => <ReportCard key={r.id} report={r} locked={isLocked(r)} favourite={favouriteSet.has(r.id)} onOpen={onOpen} onToggleFavourite={onToggleFavourite} />)}
          </div>
        </section>
      )}

      <ReportCatalogGrid reports={REPORTS} query={query} isLocked={isLocked} onOpen={onOpen} />

      <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">Tip: press <Kbd>/</Kbd> to search reports. Click any highlighted row to drill down.</p>
    </div>
  );
};

export default Reports;
