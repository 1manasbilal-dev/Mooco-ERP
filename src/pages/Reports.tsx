import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ChevronDown, FileSpreadsheet, FileText, Link2, ListTree, Loader2, Lock, MessageCircle,
  Printer, RefreshCw, Star, X, AlertTriangle, ChevronRight
} from 'lucide-react';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { ReportCatalog } from '../components/reports/ReportCatalog';
import { ReportToolbar, FilterOptions } from '../components/reports/ReportToolbar';
import { ReportTable } from '../components/reports/ReportTable';
import { ReportChart } from '../components/reports/ReportChart';
import { Insights, KpiGrid, NotesList, StatementCard } from '../components/reports/ReportBlocks';
import { ReportIcon } from '../components/reports/ReportIcon';
import { getReport, REPORT_CATEGORIES, REPORTS } from '../lib/reports/registry';
import { presetLabel, presetRange, rangeText } from '../lib/reports/presets';
import { businessDate, itemCategory, previousRange } from '../lib/reports/helpers';
import { exportCsv, exportXlsx, ExportInput, printReport, shareText } from '../lib/reports/export';
import type { FilterKey, GroupBy, ReportColumn, ReportData, ReportDefinition, ReportFilters, ReportResult, ReportRow } from '../lib/reports/types';

const FILTER_KEYS: Exclude<FilterKey, 'groupBy'>[] = ['customerId', 'supplierId', 'itemId', 'accountId', 'category', 'paymentMode', 'cashierId', 'milkType', 'shift'];

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

const Reports: React.FC = () => {
  const dairy = useDairy();
  const { canPerform, currentUser, settings, isDataLoading, dataLoadError, retryLoading } = dairy;
  const { showToast } = useToast();
  const [params, setParams] = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);
  const viewsRef = useRef<ExportInput['views']>({});
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
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
  const exportInput = (): ExportInput | null => (report && result ? {
    report, result, filters, rangeLabel, company: settings.general, generatedBy: currentUser?.name, views: viewsRef.current,
  } : null);

  const doExport = (kind: 'xlsx' | 'csv' | 'print' | 'share' | 'link') => {
    setExportOpen(false);
    if (kind === 'link') {
      navigator.clipboard?.writeText(window.location.href).then(() => showToast('Report link copied', 'success'), () => showToast('Could not copy the link', 'error'));
      return;
    }
    const input = exportInput();
    if (!input) return;
    if (!canExport) { showToast('Aap ko reports export karne ki ijazat nahi hai.', 'warning'); return; }
    try {
      if (kind === 'xlsx') { exportXlsx(input); showToast('Excel file downloaded', 'success'); }
      if (kind === 'csv') { exportCsv(input); showToast('CSV file downloaded', 'success'); }
      if (kind === 'print' && !printReport(input)) showToast('Pop-up blocked. Allow pop-ups to print or save PDF.', 'warning');
      if (kind === 'share') {
        const text = shareText(input);
        if (navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) void navigator.share({ title: report!.title, text }).catch(() => {});
        else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      }
    } catch (error) {
      console.error('[Reports] export failed', error);
      showToast('Export could not be completed', 'error');
    }
  };

  useEffect(() => {
    if (!exportOpen) return;
    const close = (e: MouseEvent) => { if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [exportOpen]);

  // "/" jumps to report search, like most dashboards.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const input = searchRef.current;
      if (!input || input.offsetParent === null) { if (!report) return; setCatalogOpen(true); return; }
      e.preventDefault();
      input.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [report]);

  const toggleFavourite = useCallback((id: string) => {
    setFavourites(favourites.includes(id) ? favourites.filter(x => x !== id) : [id, ...favourites]);
  }, [favourites, setFavourites]);

  const onDrill = useCallback((row: ReportRow) => { if (row._drill) openReport(row._drill.report, row._drill.filters); }, [openReport]);
  const onCopied = useCallback(() => showToast('Table copied — paste it into Excel', 'success'), [showToast]);

  const catalog = (
    <ReportCatalog reports={REPORTS} activeId={report?.id} favourites={favourites} recent={recent} isLocked={isLocked}
      onOpen={id => openReport(id)} onToggleFavourite={toggleFavourite} searchRef={searchRef} />
  );

  const category = REPORT_CATEGORIES.find(c => c.id === report?.category);
  const canGoBack = (window.history.state?.idx ?? 0) > 0;

  return (
    <div className="flex gap-5 pb-6">
      {/* Catalog: docked on large screens, a drawer on phones and tablets */}
      <aside className="sticky top-4 hidden h-[calc(100dvh-7.5rem)] w-72 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white/80 shadow-xs backdrop-blur lg:block dark:border-slate-800 print:hidden">
        {catalog}
      </aside>
      {catalogOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="All reports">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setCatalogOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(22rem,88vw)] flex-col bg-white shadow-2xl dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <span className="text-sm font-bold text-slate-800 dark:text-slate-100">All reports</span>
              <button type="button" onClick={() => setCatalogOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={16} /></button>
            </div>
            <div className="min-h-0 flex-1">{catalog}</div>
          </div>
        </div>
      )}

      <div className="min-w-0 flex-1 space-y-4">
        {(isDataLoading || dataLoadError) && (
          <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium ${dataLoadError ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200' : 'border-slate-200 bg-white text-slate-500 dark:border-slate-800'}`}>
            {dataLoadError ? <AlertTriangle size={14} /> : <Loader2 size={14} className="animate-spin" />}
            <span className="flex-1">{dataLoadError ? `${dataLoadError} Reports may be incomplete.` : 'Loading the latest records — figures will refresh automatically.'}</span>
            {dataLoadError && !isDataLoading && <button type="button" onClick={() => void retryLoading()} className="inline-flex items-center gap-1 font-bold underline"><RefreshCw size={12} />Retry</button>}
          </div>
        )}

        {!report ? (
          <ReportsHome favourites={favourites} recent={recent} overview={overview} isLocked={isLocked} onOpen={id => openReport(id)} onBrowse={() => setCatalogOpen(true)} />
        ) : (
          <>
            <div className="flex flex-wrap items-start gap-3">
              <button type="button" onClick={() => (canGoBack ? window.history.back() : goHome())} aria-label="Back"
                className="mt-1 rounded-xl border border-slate-200 bg-white p-2 text-slate-500 shadow-xs hover:text-slate-900 dark:border-slate-700 dark:hover:text-white print:hidden">
                <ArrowLeft size={16} />
              </button>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-lime-500 to-lime-700 text-white shadow-lg shadow-lime-600/20">
                <ReportIcon name={report.icon} size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <nav className="flex items-center gap-1 text-[11px] font-semibold text-slate-400" aria-label="Breadcrumb">
                  <button type="button" onClick={goHome} className="hover:text-lime-700">Reports</button>
                  <ChevronRight size={11} />
                  <span>{category?.label}</span>
                </nav>
                <h2 className="flex items-center gap-2 text-lg font-black tracking-tight text-slate-900 sm:text-xl dark:text-white">
                  <span className="truncate">{report.title}</span>
                  <button type="button" onClick={() => toggleFavourite(report.id)} aria-pressed={favourites.includes(report.id)} aria-label="Favourite"
                    className={favourites.includes(report.id) ? 'text-amber-500' : 'text-slate-300 hover:text-amber-500'}>
                    <Star size={17} fill={favourites.includes(report.id) ? 'currentColor' : 'none'} />
                  </button>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {report.subtitle} · <span className="font-semibold text-slate-700 dark:text-slate-200">{rangeLabel}</span>
                  {!report.snapshot && preset !== 'custom' && <span className="text-slate-400"> ({presetLabel(preset)})</span>}
                </p>
              </div>
              <div className="flex items-center gap-2 print:hidden">
                <button type="button" onClick={() => setCatalogOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 shadow-xs hover:bg-slate-50 lg:hidden dark:border-slate-700 dark:text-slate-300">
                  <ListTree size={14} />Reports
                </button>
                <div ref={exportRef} className="relative">
                  <button type="button" onClick={() => setExportOpen(v => !v)} disabled={!result} aria-expanded={exportOpen}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-lime-600 px-3.5 text-xs font-bold text-white shadow-lg shadow-lime-600/20 hover:bg-lime-700 disabled:opacity-50">
                    <FileSpreadsheet size={14} />Export<ChevronDown size={13} />
                  </button>
                  {exportOpen && (
                    <div className="absolute right-0 top-11 z-40 w-60 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl dark:border-slate-700">
                      {[
                        { kind: 'xlsx' as const, icon: FileSpreadsheet, label: 'Excel workbook (.xlsx)', hint: 'Every table on its own sheet', color: 'text-emerald-600' },
                        { kind: 'print' as const, icon: Printer, label: 'Print / Save as PDF', hint: 'Letterhead, A4 ready', color: 'text-slate-700 dark:text-slate-200' },
                        { kind: 'csv' as const, icon: FileText, label: 'CSV file', hint: 'For any spreadsheet app', color: 'text-blue-600' },
                        { kind: 'share' as const, icon: MessageCircle, label: 'Share on WhatsApp', hint: 'Summary as a message', color: 'text-green-600' },
                        { kind: 'link' as const, icon: Link2, label: 'Copy report link', hint: 'Same report, dates & filters', color: 'text-violet-600' },
                      ].map(o => (
                        <button key={o.kind} type="button" onClick={() => doExport(o.kind)} disabled={o.kind !== 'link' && !canExport}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-slate-800">
                          <o.icon size={16} className={o.color} />
                          <span><span className="block text-xs font-bold text-slate-800 dark:text-slate-100">{o.label}</span><span className="block text-[10.5px] text-slate-400">{o.hint}</span></span>
                        </button>
                      ))}
                      {!canExport && <p className="px-3 pb-1 pt-1.5 text-[10.5px] text-amber-600">Export needs the “Export reports” permission.</p>}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <ReportToolbar
              report={report} filters={filters} preset={preset} today={today} compare={compare} options={options}
              onPreset={id => update({ p: id, from: null, to: null })}
              onRange={(from, to) => update({ p: 'custom', from, to })}
              onFilter={(key, value) => update({ [key === 'groupBy' ? 'g' : key]: value || null })}
              onCompare={on => update({ cmp: on ? '1' : null })}
              onReset={() => update(Object.fromEntries(FILTER_KEYS.map(k => [k, null])))}
            />

            {locked ? (
              <EmptyState icon={<Lock size={22} />} title="This report shows profit and balances" text="Ask the owner to give you the “View profit & financial reports” permission." />
            ) : missingRequired ? (
              <EmptyState icon={<ReportIcon name={report.icon} size={22} />} title={`Choose a ${report.requires === 'customerId' ? 'customer' : report.requires === 'supplierId' ? 'supplier' : report.requires === 'itemId' ? 'product' : 'account'} above`}
                text="This report is prepared for one record at a time." />
            ) : result ? (
              <div className={`space-y-4 transition-opacity ${isStale ? 'opacity-60' : ''}`} aria-busy={isStale}>
                {result.kpis?.length ? <KpiGrid kpis={result.kpis} previous={previous?.kpis} previousLabel={rangeText(prevRange.from, prevRange.to)} /> : null}
                {compare && previous && <p className="-mt-2 text-[11px] text-slate-400">Compared with {rangeText(prevRange.from, prevRange.to)}</p>}
                {result.insights?.length ? <Insights items={result.insights} /> : null}
                {result.notes?.length ? <NotesList notes={result.notes} /> : null}
                {result.statements?.length ? <div className="grid gap-4 xl:grid-cols-2">{result.statements.map(s => <StatementCard key={s.id} statement={s} />)}</div> : null}
                {result.charts?.length ? <div className="grid gap-4 lg:grid-cols-2">{result.charts.map(c => <ReportChart key={c.id} spec={c} />)}</div> : null}
                {result.tables?.map(t => <ReportTable key={`${report.id}:${t.id}`} table={t} onDrill={onDrill} onViewChange={onViewChange} onCopied={onCopied} />)}
                {!result.kpis?.length && !result.tables?.length && !result.statements?.length && !result.notes?.length && (
                  <EmptyState icon={<ReportIcon name={report.icon} size={22} />} title="Nothing to show" text="Try a wider date range or clear the filters." />
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400"><Loader2 size={16} className="animate-spin" />Preparing report…</div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const EmptyState = ({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) => (
  <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-14 text-center dark:border-slate-700">
    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800">{icon}</div>
    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h3>
    <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">{text}</p>
  </div>
);

const ReportsHome = ({ favourites, recent, overview, isLocked, onOpen, onBrowse }: {
  favourites: string[]; recent: string[]; overview: ReportResult['kpis'] | null;
  isLocked: (r: ReportDefinition) => boolean; onOpen: (id: string) => void; onBrowse: () => void;
}) => {
  const quick = [...new Set([...favourites, ...recent])].map(id => getReport(id)).filter(Boolean).slice(0, 6) as ReportDefinition[];
  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-lime-600 via-lime-700 to-emerald-800 p-5 text-white shadow-xl shadow-lime-900/10 sm:p-7">
        <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-lime-100/80">Reports centre</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">{REPORTS.length} live reports for your dairy</h2>
            <p className="mt-1 max-w-xl text-sm text-lime-50/90">Sales, profit, khata, milk, stock and cash — every figure from your live records, with compare, drill-down and one-click Excel / PDF.</p>
          </div>
          <button type="button" onClick={onBrowse} className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2.5 text-sm font-bold backdrop-blur hover:bg-white/25 lg:hidden">
            <ListTree size={16} />Browse reports
          </button>
        </div>
        {overview?.length ? (
          <div className="relative mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {overview.map(k => (
              <div key={k.key} className="rounded-2xl bg-white/12 px-3 py-2.5 ring-1 ring-white/15 backdrop-blur" style={{ background: 'rgba(255,255,255,0.12)' }}>
                <div className="text-[10px] font-bold uppercase tracking-wide text-lime-100/80">Today · {k.label}</div>
                <div className="mt-0.5 truncate text-lg font-black tabular-nums">{k.format === 'money' ? `Rs ${Math.round(k.value).toLocaleString('en-PK')}` : Math.round(k.value).toLocaleString('en-PK')}{k.unit ? ` ${k.unit}` : ''}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {quick.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400"><Star size={12} />Your reports</h3>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {quick.map(r => <ReportCard key={r.id} report={r} locked={isLocked(r)} onOpen={() => onOpen(r.id)} />)}
          </div>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {REPORT_CATEGORIES.map(cat => {
          const list = REPORTS.filter(r => r.category === cat.id);
          if (!list.length) return null;
          return (
            <section key={cat.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-lime-50 text-lime-700 dark:bg-lime-950/40 dark:text-lime-400"><ReportIcon name={cat.icon} size={14} /></span>
                {cat.label}<span className="ml-auto text-[11px] font-semibold text-slate-400">{list.length}</span>
              </h3>
              <div className="space-y-0.5">
                {list.map(r => (
                  <button key={r.id} type="button" onClick={() => onOpen(r.id)} className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <ReportIcon name={r.icon} size={13} className="shrink-0 text-slate-400 group-hover:text-lime-600" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-700 dark:text-slate-200">{r.title}</span>
                    {isLocked(r) ? <Lock size={11} className="text-slate-300" /> : <ChevronRight size={13} className="text-slate-300 group-hover:text-lime-600" />}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-slate-400">Tip: press <kbd className="rounded border border-slate-200 px-1 dark:border-slate-700">/</kbd> to search reports. Click any highlighted row to drill down.</p>
    </div>
  );
};

const ReportCard: React.FC<{ report: ReportDefinition; locked: boolean; onOpen: () => void }> = ({ report, locked, onOpen }) => (
  <button type="button" onClick={onOpen} className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-xs transition hover:-translate-y-0.5 hover:border-lime-400 hover:shadow-md dark:border-slate-800">
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-lime-50 text-lime-700 group-hover:bg-lime-600 group-hover:text-white dark:bg-lime-950/40 dark:text-lime-400"><ReportIcon name={report.icon} size={18} /></span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-bold text-slate-800 dark:text-slate-100">{report.title}</span>
      <span className="block truncate text-[11px] text-slate-500">{report.subtitle}</span>
    </span>
    {locked && <Lock size={13} className="text-slate-300" />}
  </button>
);

export default Reports;
