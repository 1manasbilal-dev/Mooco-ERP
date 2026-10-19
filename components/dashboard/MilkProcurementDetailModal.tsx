import React, { useState, useMemo } from 'react';
import { 
  Droplets, X, Search, Filter, Calendar, Users, ArrowUpRight, 
  ChevronDown, ChevronUp, ChevronRight, Phone, MessageSquare, 
  Clock, Sun, Moon, DollarSign, Scale, ExternalLink, CheckCircle2,
  FileText, ArrowDownToLine, Layers, TrendingUp
} from 'lucide-react';
import { formatCurrency, formatQty, cleanNumber } from '../../lib/formatters';
import { PurchaseEntry, Supplier } from '../../types';

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

export interface SupplierSummary {
  supplierId: string;
  supplierName: string;
  phone: string;
  whatsapp?: string;
  village: string;
  city: string;
  pendingBalance: number;
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

export const MilkProcurementDetailModal: React.FC<MilkProcurementDetailModalProps> = ({
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
  layout = 'dialog'
}) => {
  const isPage = layout === 'page';
  const [searchQuery, setSearchQuery] = useState('');
  const [varietyFilter, setVarietyFilter] = useState<'all' | 'buffalo' | 'cow' | 'mixed'>('all');
  const [shiftFilter, setShiftFilter] = useState<'all' | 'morning' | 'evening'>('all');
  const [viewMode, setViewMode] = useState<'by_supplier' | 'all_slips'>('by_supplier');
  const [expandedSupplierIds, setExpandedSupplierIds] = useState<Set<string>>(new Set());
  const dialogRef = React.useRef<HTMLDivElement>(null);

  // Close on ESC key
  React.useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab') return;
      const controls = Array.from<HTMLElement>(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') || []).filter(el => el.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { e.preventDefault(); return; }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => { window.removeEventListener('keydown', handleKeyDown); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); };
  }, [isOpen, onClose]);

  // Aggregate supplier-wise data
  const supplierSummaries = useMemo(() => {
    const map: Record<string, SupplierSummary> = {};

    purchases.forEach(p => {
      if (!p.date || p.status === 'Cancelled' || p.status === 'Returned') return;

      const supId = p.supplier_id || 'unknown';
      const supObj = suppliers.find(s => s.id === supId);
      const supName = supObj?.name || p.supplier_name || 'Walk-in Farmer';

      if (!map[supId]) {
        map[supId] = {
          supplierId: supId,
          supplierName: supName,
          phone: supObj?.phone || '',
          whatsapp: supObj?.whatsapp,
          village: supObj?.village || '',
          city: supObj?.city || '',
          pendingBalance: cleanNumber(supObj?.pending_balance ?? (supObj as any)?.total_due ?? supObj?.balance ?? 0),
          totalLiters: 0,
          totalAmount: 0,
          avgRate: 0,
          buffaloLiters: 0,
          cowLiters: 0,
          mixedLiters: 0,
          entriesCount: 0,
          sharePercent: 0,
          entries: []
        };
      }

      const qty = Number(p.quantity) || 0;
      const amt = Number(p.total_amount) || 0;
      const type = (p.milk_type || '').toLowerCase();

      map[supId].totalLiters += qty;
      map[supId].totalAmount += amt;
      map[supId].entriesCount += 1;
      map[supId].entries.push(p);

      if (type.includes('buffalo')) map[supId].buffaloLiters += qty;
      else if (type.includes('cow')) map[supId].cowLiters += qty;
      else map[supId].mixedLiters += qty;
    });

    // Calculate rates, shares and sort entries
    const list = Object.values(map).map(sup => {
      sup.avgRate = sup.totalLiters > 0 ? (sup.totalAmount / sup.totalLiters) : 0;
      sup.sharePercent = totalMilkLiters > 0 ? Math.round((sup.totalLiters / totalMilkLiters) * 100) : 0;
      // Sort individual entries by date descending
      sup.entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      return sup;
    });

    // Sort suppliers by highest volume supplied descending
    list.sort((a, b) => b.totalLiters - a.totalLiters);
    return list;
  }, [purchases, suppliers, totalMilkLiters]);

  // Filtered suppliers
  const filteredSuppliers = useMemo(() => {
    return supplierSummaries.filter(sup => {
      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = sup.supplierName.toLowerCase().includes(q);
        const matchesPhone = sup.phone.toLowerCase().includes(q);
        const matchesVillage = sup.village.toLowerCase().includes(q);
        const matchesCity = sup.city.toLowerCase().includes(q);
        if (!matchesName && !matchesPhone && !matchesVillage && !matchesCity) return false;
      }

      // Variety filter
      if (varietyFilter === 'buffalo' && sup.buffaloLiters <= 0) return false;
      if (varietyFilter === 'cow' && sup.cowLiters <= 0) return false;
      if (varietyFilter === 'mixed' && sup.mixedLiters <= 0) return false;

      // Shift filter
      if (shiftFilter !== 'all') {
        const hasShift = sup.entries.some(e => 
          (e.shift || '').toLowerCase().includes(shiftFilter)
        );
        if (!hasShift) return false;
      }

      return true;
    });
  }, [supplierSummaries, searchQuery, varietyFilter, shiftFilter]);

  // All individual slips list filtered
  const filteredSlips = useMemo(() => {
    const list: (PurchaseEntry & { supplierName: string; supplierPhone: string; supplierVillage: string })[] = [];

    purchases.forEach(p => {
      if (!p.date || p.status === 'Cancelled' || p.status === 'Returned') return;
      const sup = suppliers.find(s => s.id === p.supplier_id);
      const supName = sup?.name || p.supplier_name || 'Walk-in Farmer';

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = supName.toLowerCase().includes(q);
        const matchesPhone = (sup?.phone || '').toLowerCase().includes(q);
        const matchesVillage = (sup?.village || '').toLowerCase().includes(q);
        if (!matchesName && !matchesPhone && !matchesVillage) return false;
      }

      // Variety filter
      const type = (p.milk_type || '').toLowerCase();
      if (varietyFilter === 'buffalo' && !type.includes('buffalo')) return false;
      if (varietyFilter === 'cow' && !type.includes('cow')) return false;
      if (varietyFilter === 'mixed' && !type.includes('mixed')) return false;

      // Shift filter
      if (shiftFilter !== 'all') {
        const s = (p.shift || '').toLowerCase();
        if (!s.includes(shiftFilter)) return false;
      }

      list.push({
        ...p,
        supplierName: supName,
        supplierPhone: sup?.phone || '',
        supplierVillage: sup?.village || ''
      });
    });

    list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return list;
  }, [purchases, suppliers, searchQuery, varietyFilter, shiftFilter]);

  // Expand / collapse all suppliers
  const toggleSupplierExpand = (id: string) => {
    setExpandedSupplierIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedSupplierIds(new Set(filteredSuppliers.map(s => s.supplierId)));
  };

  const collapseAll = () => {
    setExpandedSupplierIds(new Set());
  };

  if (!isPage && !isOpen) return null;

  return (
    <div className={isPage ? 'w-full' : 'fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200'}>
      <div 
        ref={dialogRef}
        role={isPage ? 'region' : 'dialog'}
        aria-modal={isPage ? undefined : true}
        aria-labelledby="milk-procurement-title"
        tabIndex={-1}
        className={isPage
          ? 'relative bg-white dark:bg-slate-900 rounded-2xl shadow-sm w-full flex flex-col border border-slate-200/90 dark:border-slate-800 overflow-hidden'
          : 'relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col border border-slate-200/90 dark:border-slate-800 overflow-hidden animate-in zoom-in-95 duration-200'}
        onClick={e => e.stopPropagation()}
      >
        {/* ========================================================================= */}
        {/* MODAL HEADER                                                              */}
        {/* ========================================================================= */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-850/60 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-lime-500/10 dark:bg-lime-500/20 text-lime-600 dark:text-lime-400 flex items-center justify-center shrink-0 border border-lime-500/20 shadow-xs">
              <Droplets size={22} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 id="milk-procurement-title" className="font-black text-base sm:text-lg text-slate-900 dark:text-white truncate">
                  Milk Procurement Breakdown
                </h3>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-lime-50 dark:bg-lime-950/60 text-lime-700 dark:text-lime-300 border border-lime-200 dark:border-lime-800">
                  Milk Collection Summary
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                <span className="font-semibold text-slate-700 dark:text-slate-200">{periodLabel}</span>
                {dateRangeText && <span className="ml-1 text-slate-400">({dateRangeText})</span>}
                <span className="mx-1.5">•</span>
                <span>{supplierSummaries.length} Farmers / Suppliers contributed</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onOpenProcurement && (
              <button
                type="button"
                onClick={() => {
                  if (!isPage) onClose();
                  onOpenProcurement();
                }}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-lime-50 dark:bg-lime-950/50 hover:bg-lime-100 dark:hover:bg-lime-900/60 text-lime-700 dark:text-lime-300 rounded-xl text-xs font-bold transition-colors cursor-pointer border border-lime-200/60 dark:border-lime-800/60"
              >
                <span>Milk Intake Counter</span>
                <ArrowUpRight size={14} />
              </button>
            )}
            {!isPage && (
            <button aria-label="Close modal (Esc)"
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Close modal (Esc)"
            >
              <X size={20} />
            </button>
            )}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* KPI SUMMARY RIBBON                                                        */}
        {/* ========================================================================= */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-4 sm:px-6 bg-slate-50/50 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-800 shrink-0">
          {/* Card 1: Total Volume */}
          <div className="p-3 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/70 dark:border-slate-700/60 shadow-2xs">
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Total Milk Inward</span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-lg sm:text-xl font-black text-slate-900 dark:text-white font-mono">
                {formatQty(totalMilkLiters)}
              </span>
              <span className="text-xs font-bold text-slate-400">L</span>
            </div>
            <div className="flex items-center gap-2 mt-1 text-[11px] font-semibold text-slate-500">
              <span className="text-lime-600 dark:text-lime-400">B: {formatQty(buffaloLiters)}L</span>
              <span>•</span>
              <span className="text-sky-600 dark:text-sky-400">C: {formatQty(cowLiters)}L</span>
            </div>
          </div>

          {/* Card 2: Total Cost */}
          <div className="p-3 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/70 dark:border-slate-700/60 shadow-2xs">
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Procurement Cost</span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-lg sm:text-xl font-black text-lime-600 dark:text-lime-400 font-mono">
                {formatCurrency(totalMilkCost)}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1 font-medium">
              Kul Khareedari Raqam
            </div>
          </div>

          {/* Card 3: Average Rate */}
          <div className="p-3 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/70 dark:border-slate-700/60 shadow-2xs">
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Weighted Avg Rate</span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-lg sm:text-xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
                Rs {cleanNumber(avgMilkRate, 1).toFixed(1)}
              </span>
              <span className="text-xs font-bold text-slate-400">/L</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1 font-medium">
              Average Rate per Liter
            </div>
          </div>

          {/* Card 4: Supplier Count */}
          <div className="p-3 rounded-2xl bg-white dark:bg-slate-800/80 border border-slate-200/70 dark:border-slate-700/60 shadow-2xs">
            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Active Suppliers</span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-lg sm:text-xl font-black text-amber-600 dark:text-amber-400 font-mono">
                {supplierSummaries.length}
              </span>
              <span className="text-xs font-bold text-slate-400">Farmers</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1 font-medium">
              {purchases.length} Delivery Slips
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* CONTROLS BAR: SEARCH, VARIETY, SHIFT, VIEW SWITCHER                       */}
        {/* ========================================================================= */}
        <div className="p-3 sm:px-6 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0 bg-white dark:bg-slate-900">
          {/* Left: Search input */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search farmer name, village, or phone..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-lime-500/20 focus:border-lime-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
              >
                ×
              </button>
            )}
          </div>

          {/* Right: Filters & Mode toggle */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Variety Selector */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200/80 dark:border-slate-700/60 text-xs font-semibold">
              <button
                onClick={() => setVarietyFilter('all')}
                className={`px-2 py-1 rounded-lg transition-all ${
                  varietyFilter === 'all'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-bold'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setVarietyFilter('buffalo')}
                className={`px-2 py-1 rounded-lg transition-all ${
                  varietyFilter === 'buffalo'
                    ? 'bg-lime-600 text-white shadow-2xs font-bold'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Buffalo
              </button>
              <button
                onClick={() => setVarietyFilter('cow')}
                className={`px-2 py-1 rounded-lg transition-all ${
                  varietyFilter === 'cow'
                    ? 'bg-sky-500 text-white shadow-2xs font-bold'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Cow
              </button>
              <button
                onClick={() => setVarietyFilter('mixed')}
                className={`px-2 py-1 rounded-lg transition-all ${
                  varietyFilter === 'mixed'
                    ? 'bg-emerald-600 text-white shadow-2xs font-bold'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Mixed
              </button>
            </div>

            {/* Shift Selector */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200/80 dark:border-slate-700/60 text-xs font-semibold">
              <button
                onClick={() => setShiftFilter('all')}
                className={`px-2 py-1 rounded-lg transition-all ${
                  shiftFilter === 'all'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-bold'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                All Shifts
              </button>
              <button
                onClick={() => setShiftFilter('morning')}
                className={`px-2 py-1 rounded-lg transition-all flex items-center gap-1 ${
                  shiftFilter === 'morning'
                    ? 'bg-amber-500 text-white shadow-2xs font-bold'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Sun size={11} />
                <span>Morning</span>
              </button>
              <button
                onClick={() => setShiftFilter('evening')}
                className={`px-2 py-1 rounded-lg transition-all flex items-center gap-1 ${
                  shiftFilter === 'evening'
                    ? 'bg-indigo-600 text-white shadow-2xs font-bold'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Moon size={11} />
                <span>Evening</span>
              </button>
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200/80 dark:border-slate-700/60 text-xs font-semibold">
              <button
                onClick={() => setViewMode('by_supplier')}
                className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
                  viewMode === 'by_supplier'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-bold'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Users size={12} />
                <span>By Farmer</span>
              </button>
              <button
                onClick={() => setViewMode('all_slips')}
                className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
                  viewMode === 'all_slips'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs font-bold'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <FileText size={12} />
                <span>All Slips ({filteredSlips.length})</span>
              </button>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* MODAL BODY (SCROLLABLE)                                                   */}
        {/* ========================================================================= */}
        <div className={`${isPage ? '' : 'flex-1 overflow-y-auto'} p-4 sm:p-6 space-y-3 bg-slate-50/40 dark:bg-slate-950/30`}>
          {viewMode === 'by_supplier' ? (
            /* ========================================================================= */
            /* VIEW 1: FARMER / SUPPLIER SUMMARY CARDS                                   */
            /* ========================================================================= */
            <>
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1">
                <span>
                  Showing <strong>{filteredSuppliers.length}</strong> farmers contributing in this period
                </span>
                {filteredSuppliers.length > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={expandAll}
                      className="text-lime-600 dark:text-lime-400 hover:underline font-bold text-[11px] cursor-pointer"
                    >
                      Expand All
                    </button>
                    <span>•</span>
                    <button
                      type="button"
                      onClick={collapseAll}
                      className="text-slate-500 hover:underline font-medium text-[11px] cursor-pointer"
                    >
                      Collapse All
                    </button>
                  </div>
                )}
              </div>

              {filteredSuppliers.length === 0 ? (
                <div className="py-16 text-center space-y-3">
                  <div className="w-14 h-14 mx-auto rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                    <Droplets size={26} />
                  </div>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    No milk procurement records found
                  </p>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    No farmers supplied milk matching the selected filters for this time window.
                  </p>
                </div>
              ) : (
                filteredSuppliers.map((sup, idx) => {
                  const isExpanded = expandedSupplierIds.has(sup.supplierId);

                  return (
                    <div 
                      key={sup.supplierId}
                      className="bg-white dark:bg-slate-850 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xs hover:border-lime-500/40 transition-all overflow-hidden"
                    >
                      {/* Supplier Summary Header Row */}
                      <div 
                        onClick={() => toggleSupplierExpand(sup.supplierId)}
                        className="p-3.5 sm:p-4.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        {/* Left: Supplier Info */}
                        <div className="flex items-start sm:items-center gap-3 min-w-0">
                          <span className={`w-7 h-7 rounded-xl flex items-center justify-center font-black text-xs shrink-0 ${
                            idx === 0 ? 'bg-amber-400 text-slate-950 shadow-2xs' :
                            idx === 1 ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200' :
                            idx === 2 ? 'bg-amber-700/20 text-amber-700 dark:text-amber-400' :
                            'bg-slate-100 dark:bg-slate-800 text-slate-500'
                          }`}>
                            {idx + 1}
                          </span>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-black text-sm sm:text-base text-slate-900 dark:text-white truncate">
                                {sup.supplierName}
                              </h4>
                              {sup.sharePercent > 0 && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-lime-50 dark:bg-lime-950/50 text-lime-700 dark:text-lime-300 border border-lime-200/60 dark:border-lime-800/60">
                                  {sup.sharePercent}% Share
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400 flex-wrap">
                              {sup.village && (
                                <span className="truncate">📍 {sup.village}{sup.city ? `, ${sup.city}` : ''}</span>
                              )}
                              {sup.phone && (
                                <>
                                  <span>•</span>
                                  <span className="font-mono">{sup.phone}</span>
                                </>
                              )}
                              <span>•</span>
                              <span className="font-medium text-slate-500 dark:text-slate-400">
                                {sup.entriesCount} delivery {sup.entriesCount === 1 ? 'slip' : 'slips'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Right: Liters, Rate, Amount & Expand indicator */}
                        <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0 pl-10 sm:pl-0">
                          {/* Milk Variety Badges */}
                          <div className="hidden md:flex items-center gap-1.5 text-[11px] font-semibold">
                            {sup.buffaloLiters > 0 && (
                              <span className="px-2 py-0.5 rounded-lg bg-lime-50 dark:bg-lime-950/40 text-lime-700 dark:text-lime-300 border border-lime-200/60 dark:border-lime-800/60">
                                Buffalo: <strong>{formatQty(sup.buffaloLiters)}L</strong>
                              </span>
                            )}
                            {sup.cowLiters > 0 && (
                              <span className="px-2 py-0.5 rounded-lg bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200/60 dark:border-sky-800/60">
                                Cow: <strong>{formatQty(sup.cowLiters)}L</strong>
                              </span>
                            )}
                          </div>

                          {/* Liters & Amount */}
                          <div className="text-right">
                            <div className="flex items-baseline gap-1 justify-end">
                              <span className="text-base sm:text-lg font-black text-slate-900 dark:text-white font-mono">
                                {formatQty(sup.totalLiters)}
                              </span>
                              <span className="text-xs font-bold text-slate-400">L</span>
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                              <strong className="text-lime-600 dark:text-lime-400 font-bold">{formatCurrency(sup.totalAmount)}</strong>
                              <span className="ml-1 text-[10px]">(@ Rs {cleanNumber(sup.avgRate, 1).toFixed(1)}/L)</span>
                            </div>
                          </div>

                          {/* Accordion Chevron */}
                          <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 flex items-center justify-center shrink-0">
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </div>
                        </div>
                      </div>

                      {/* Share progress bar */}
                      <div className="w-full h-1 bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-lime-500 to-sky-400 transition-all duration-300"
                          style={{ width: `${Math.min(100, sup.sharePercent)}%` }}
                        />
                      </div>

                      {/* Expandable Individual Delivery Slips */}
                      {isExpanded && (
                        <div className="p-3 sm:p-4 bg-slate-50/70 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800 space-y-2">
                          <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 pb-1 border-b border-slate-200/60 dark:border-slate-800">
                            <span>Delivery History ({sup.entries.length} Inward Slips)</span>
                            {onNavigateToSupplier && sup.supplierId !== 'unknown' && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onClose();
                                  onNavigateToSupplier(sup.supplierId);
                                }}
                                className="text-lime-600 dark:text-lime-400 hover:underline flex items-center gap-1 font-bold cursor-pointer"
                              >
                                <span>Open Full Supplier Khata</span>
                                <ExternalLink size={11} />
                              </button>
                            )}
                          </div>

                          {/* Individual Slips List */}
                          <div className="divide-y divide-slate-200/60 dark:divide-slate-800">
                            {sup.entries.map((slip, slipIdx) => {
                              const slipDate = new Date(slip.date);
                              const dateFormatted = slipDate.toLocaleDateString(undefined, { 
                                month: 'short', 
                                day: 'numeric', 
                                year: 'numeric' 
                              });
                              const timeFormatted = slipDate.toLocaleTimeString(undefined, { 
                                hour: '2-digit', 
                                minute: '2-digit' 
                              });
                              const isMorning = (slip.shift || '').toLowerCase().includes('morning');

                              return (
                                <div 
                                  key={slip.id || slipIdx}
                                  className="py-2.5 flex items-center justify-between gap-3 text-xs"
                                >
                                  {/* Left: Time & Shift */}
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] shrink-0 font-bold ${
                                      isMorning ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' :
                                      'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300'
                                    }`}>
                                      {isMorning ? <Sun size={12} /> : <Moon size={12} />}
                                    </div>

                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="font-bold text-slate-800 dark:text-slate-200">
                                          {dateFormatted}
                                        </span>
                                        <span className="text-[11px] text-slate-400 font-mono">
                                          {timeFormatted}
                                        </span>
                                        <span className="text-[10px] uppercase font-bold text-slate-500">
                                          ({slip.shift || 'General'})
                                        </span>
                                      </div>

                                      {/* Milk type & Quality parameters */}
                                      <div className="flex items-center gap-2 text-[11px] text-slate-400 font-medium">
                                        <span className="text-lime-600 dark:text-lime-400 font-bold">
                                          {slip.milk_type || 'Milk'}
                                        </span>
                                        {slip.fat && Number(slip.fat) > 0 && (
                                          <span>Fat: <strong className="text-slate-600 dark:text-slate-300">{slip.fat}%</strong></span>
                                        )}
                                        {slip.snf && Number(slip.snf) > 0 && (
                                          <span>SNF: <strong className="text-slate-600 dark:text-slate-300">{slip.snf}</strong></span>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Right: Quantity, Rate & Amount */}
                                  <div className="text-right shrink-0">
                                    <div className="font-mono font-black text-slate-900 dark:text-white">
                                      {formatQty(slip.quantity)} L @ Rs {cleanNumber(slip.rate, 1).toFixed(1)}
                                    </div>
                                    <div className="text-xs font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                                      Total: {formatCurrency(slip.total_amount)}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </>
          ) : (
            /* ========================================================================= */
            /* VIEW 2: ALL INDIVIDUAL DELIVERY SLIPS (AUDIT TABLE)                       */
            /* ========================================================================= */
            <div className="bg-white dark:bg-slate-850 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 uppercase font-bold border-b border-slate-200/80 dark:border-slate-700/80 text-[10px] tracking-wider">
                    <tr>
                      <th className="py-3 px-3.5">Date & Time</th>
                      <th className="py-3 px-3.5">Farmer / Supplier</th>
                      <th className="py-3 px-3.5">Shift</th>
                      <th className="py-3 px-3.5">Variety</th>
                      <th className="py-3 px-3.5 text-right">Qty (L)</th>
                      <th className="py-3 px-3.5 text-right">Fat / SNF</th>
                      <th className="py-3 px-3.5 text-right">Rate (Rs)</th>
                      <th className="py-3 px-3.5 text-right">Amount (Rs)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredSlips.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-slate-400">
                          No delivery slips found matching the current filters.
                        </td>
                      </tr>
                    ) : (
                      filteredSlips.map((slip, idx) => {
                        const d = new Date(slip.date);
                        const isMorning = (slip.shift || '').toLowerCase().includes('morning');

                        return (
                          <tr 
                            key={slip.id || idx}
                            className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                          >
                            <td className="py-2.5 px-3.5 whitespace-nowrap font-medium text-slate-800 dark:text-slate-200">
                              <div>{d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
                              <div className="text-[10px] text-slate-400 font-mono">{d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                            </td>

                            <td className="py-2.5 px-3.5 font-bold text-slate-900 dark:text-white">
                              <div>{slip.supplierName}</div>
                              {slip.supplierVillage && (
                                <div className="text-[10px] text-slate-400 font-normal">📍 {slip.supplierVillage}</div>
                              )}
                            </td>

                            <td className="py-2.5 px-3.5 whitespace-nowrap">
                              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                isMorning ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' :
                                'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300'
                              }`}>
                                {isMorning ? <Sun size={10} /> : <Moon size={10} />}
                                {slip.shift || 'General'}
                              </span>
                            </td>

                            <td className="py-2.5 px-3.5 whitespace-nowrap">
                              <span className="font-semibold text-lime-600 dark:text-lime-400">
                                {slip.milk_type || 'Milk'}
                              </span>
                            </td>

                            <td className="py-2.5 px-3.5 text-right font-mono font-black text-slate-900 dark:text-white">
                              {formatQty(slip.quantity)} L
                            </td>

                            <td className="py-2.5 px-3.5 text-right font-mono text-[11px] text-slate-500">
                              {slip.fat ? `${slip.fat}%` : '—'}{slip.snf ? ` / ${slip.snf}` : ''}
                            </td>

                            <td className="py-2.5 px-3.5 text-right font-mono font-medium text-slate-700 dark:text-slate-300">
                              Rs {cleanNumber(slip.rate, 1).toFixed(1)}
                            </td>

                            <td className="py-2.5 px-3.5 text-right font-mono font-black text-emerald-600 dark:text-emerald-400">
                              {formatCurrency(slip.total_amount)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* MODAL FOOTER                                                              */}
        {/* ========================================================================= */}
        <div className="p-3.5 sm:px-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/60 flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500 font-medium">
            Total for selected period: <strong className="text-slate-900 dark:text-white font-mono">{formatQty(totalMilkLiters)} L</strong> ({formatCurrency(totalMilkCost)})
          </div>

          <div className="flex items-center gap-2">
            {onOpenProcurement && (
              <button
                type="button"
                onClick={() => {
                  if (!isPage) onClose();
                  onOpenProcurement();
                }}
                className="px-3.5 py-2 bg-lime-600 hover:bg-lime-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm shadow-lime-500/20 flex items-center gap-1.5 cursor-pointer"
              >
                <span>Record New Milk Intake</span>
                <ArrowUpRight size={14} />
              </button>
            )}
            {!isPage && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              Close
            </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default MilkProcurementDetailModal;
