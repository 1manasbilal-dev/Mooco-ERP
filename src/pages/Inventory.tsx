import React, { Suspense, lazy, useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, ClipboardCheck, History as HistoryIcon, Layers, Package, PackageX } from 'lucide-react';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { BREAKPOINTS, useMediaQuery } from '../hooks/useMediaQuery';
import { useProgressiveList } from '../hooks/useProgressiveList';
import {
  Button, Card, EmptyState, LoadMoreRow, Money, PageHeader, SearchInput, SegmentedControl, StatCard, TBody, TH, THead, Table,
  TableContainer, Toolbar,
} from '../components/ui';
import { buildStockRows, type StockRow } from '../components/milk-ops/inventoryStock';
import { StockCard, StockTableRows } from '../components/milk-ops/StockRows';
import type { AuditTab, StockAdjustment } from '../components/milk-ops/StockAuditDialog';

const StockAuditDialog = lazy(() => import('../components/milk-ops/StockAuditDialog'));

type TypeFilter = 'All' | 'Sale product' | 'Raw material' | 'Packaging material';
type StatusFilter = 'all' | 'low' | 'out';

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'All', label: 'All items' },
  { value: 'Sale product', label: 'Sale products' },
  { value: 'Raw material', label: 'Raw materials' },
  { value: 'Packaging material', label: 'Packaging' },
];

interface AuditState { open: boolean; tab: AuditTab; itemId: string }

const auditFromSearch = (search: string): AuditState => {
  const sp = new URLSearchParams(search);
  return {
    open: sp.get('audit') === 'true' || sp.has('tab') || sp.has('item'),
    tab: sp.get('tab') === 'history' ? 'history' : 'adjust',
    itemId: sp.get('item') || '',
  };
};

const Inventory: React.FC = () => {
  const { inventory, inventoryLogs, adjustStock, items, canPerform } = useDairy();
  const { showToast } = useToast();
  const canEdit = canPerform('inventory', 'edit');
  const location = useLocation();
  const navigate = useNavigate();
  const isWide = useMediaQuery(BREAKPOINTS.md);

  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearch = useDeferredValue(searchTerm);
  const [filterType, setFilterType] = useState<TypeFilter>('All');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Audit dialog state mirrors the URL (?audit=true&tab=history&item=...), so it can be linked to.
  const [audit, setAudit] = useState<AuditState>(() => auditFromSearch(window.location.search));
  const [auditVariant, setAuditVariant] = useState('loose');
  const [auditSession, setAuditSession] = useState(0);
  const [lastSearch, setLastSearch] = useState(location.search);
  if (location.search !== lastSearch) {
    setLastSearch(location.search);
    const next = auditFromSearch(location.search);
    if (next.open !== audit.open || next.tab !== audit.tab || next.itemId !== audit.itemId) setAudit(next);
  }

  const writeAuditUrl = useCallback((next: AuditState) => {
    const sp = new URLSearchParams(location.search);
    if (next.open) {
      sp.set('audit', 'true');
      sp.set('tab', next.tab);
      if (next.itemId) sp.set('item', next.itemId); else sp.delete('item');
    } else {
      sp.delete('audit');
      sp.delete('tab');
      sp.delete('item');
    }
    const q = sp.toString();
    navigate(`${location.pathname}${q ? `?${q}` : ''}`, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const openAudit = useCallback((tab: AuditTab = 'adjust', itemId = '', variantId = 'loose') => {
    const next: AuditState = { open: true, tab: canEdit ? tab : 'history', itemId };
    setAudit(next);
    setAuditVariant(variantId);
    setAuditSession(session => session + 1);
    writeAuditUrl(next);
  }, [canEdit, writeAuditUrl]);

  const closeAudit = useCallback(() => {
    const next: AuditState = { open: false, tab: 'adjust', itemId: '' };
    setAudit(next);
    writeAuditUrl(next);
  }, [writeAuditUrl]);

  const changeAuditTab = (tab: AuditTab) => {
    const next = { ...audit, tab };
    setAudit(next);
    writeAuditUrl(next);
  };

  const changeAuditItem = (itemId: string) => {
    const next = { ...audit, itemId };
    setAudit(next);
    writeAuditUrl(next);
  };

  // Stock, value and status for every item, worked out once per data change rather than per keystroke.
  const allRows = useMemo(() => buildStockRows(items, inventory), [items, inventory]);

  const scopedRows = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return allRows.filter(row =>
      (!q || row.search.includes(q))
      && (filterType === 'All' || (row.item.item_type || []).some(t => t === filterType)));
  }, [allRows, deferredSearch, filterType]);

  // Header totals equal the sum of the listed rows (search and type filters apply, status filter does not).
  const stats = useMemo(() => {
    let totalValue = 0;
    let low = 0;
    let out = 0;
    for (const row of scopedRows) {
      totalValue += row.valuation.costValue;
      if (row.status === 'low') low += 1;
      else if (row.status === 'out' || row.status === 'negative') out += 1;
    }
    return { totalItems: scopedRows.length, totalValue, low, out };
  }, [scopedRows]);

  const visibleRows = useMemo(() => (
    statusFilter === 'all' ? scopedRows
      : scopedRows.filter(row => (statusFilter === 'low' ? row.status === 'low' : row.status === 'out' || row.status === 'negative'))
  ), [scopedRows, statusFilter]);

  const list = useProgressiveList<StockRow>(visibleRows, 50, `${deferredSearch}|${filterType}|${statusFilter}`);

  const quickAudit = useCallback((itemId: string, variantId: string) => openAudit('adjust', itemId, variantId), [openAudit]);

  const submittingRef = useRef(false);
  const handleAdjust = async (adjustment: StockAdjustment) => {
    if (!canEdit) {
      showToast('Aap ko is kaam ki ijazat nahi hai.', 'warning');
      return false;
    }
    if (submittingRef.current) return false;
    if (Number.isNaN(adjustment.newQty) || adjustment.newQty < 0) {
      showToast('Invalid quantity', 'error');
      return false;
    }
    const row = allRows.find(r => r.item.id === adjustment.itemId);
    const invRecord = inventory.find(i => i.item_id === adjustment.itemId || (row && i.name.toLowerCase() === row.item.name.toLowerCase()));
    if (!invRecord) {
      showToast('Critical Error: Link to inventory ledger missing.', 'error');
      return false;
    }
    submittingRef.current = true;
    try {
      const ok = await adjustStock(invRecord.id, adjustment.newQty, adjustment.reason, adjustment.notes, adjustment.variantId);
      if (!ok) {
        showToast('Failed to adjust stock — system stock unchanged.', 'error');
        return false;
      }
      showToast(`Stock synchronized for ${adjustment.targetName}`, 'success');
      closeAudit();
      return true;
    } catch (err: any) {
      showToast('Failed to adjust stock: ' + (err?.message || 'Error'), 'error');
      return false;
    } finally {
      submittingRef.current = false;
    }
  };

  const typeCounts = useMemo(() => {
    const counts: Record<TypeFilter, number> = { All: allRows.length, 'Sale product': 0, 'Raw material': 0, 'Packaging material': 0 };
    for (const row of allRows) {
      for (const type of row.item.item_type || []) if (type in counts && type !== 'All') counts[type as TypeFilter] += 1;
    }
    return counts;
  }, [allRows]);

  const hasFilters = Boolean(searchTerm || filterType !== 'All' || statusFilter !== 'all');
  const clearFilters = () => { setSearchTerm(''); setFilterType('All'); setStatusFilter('all'); };

  return (
    <div className="flex flex-col gap-4 pb-8 lg:gap-6">
      <PageHeader
        eyebrow="Dairy operations"
        description="Live physical stock: sales, purchases aur production se khud update hota hai."
        actions={
          <>
            <Button variant="secondary" leftIcon={<HistoryIcon />} onClick={() => openAudit('history')}>Audit history</Button>
            <Button leftIcon={<ClipboardCheck />} onClick={() => openAudit('adjust')}>Audit stock</Button>
          </>
        }
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Stock summary">
        <StatCard label="Total items" value={stats.totalItems} icon={<Package />} hint={hasFilters ? 'Filter ke mutabiq' : undefined} />
        <StatCard label="Stock value (cost)" value={<Money amount={stats.totalValue} compact />} icon={<Layers />} tone="brand" />
        <StatCard
          label="Low stock"
          value={stats.low}
          icon={<AlertTriangle />}
          tone={stats.low > 0 ? 'warning' : 'neutral'}
          hint={statusFilter === 'low' ? 'Filter laga hai' : stats.low > 0 ? 'Dekhein' : undefined}
          onClick={() => setStatusFilter(current => (current === 'low' ? 'all' : 'low'))}
        />
        <StatCard
          label="Out / minus stock"
          value={stats.out}
          icon={<PackageX />}
          tone={stats.out > 0 ? 'danger' : 'neutral'}
          hint={statusFilter === 'out' ? 'Filter laga hai' : stats.out > 0 ? 'Dekhein' : undefined}
          onClick={() => setStatusFilter(current => (current === 'out' ? 'all' : 'out'))}
        />
      </section>

      <div className="flex flex-col gap-3">
        <Toolbar>
          <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Item ya category search karein..." className="w-full sm:w-72" aria-label="Search inventory" />
          <SegmentedControl
            aria-label="Item type"
            size="sm"
            value={filterType}
            onChange={setFilterType}
            options={TYPE_FILTERS.map(filter => ({ value: filter.value, label: filter.label, count: typeCounts[filter.value] }))}
          />
          <SegmentedControl
            aria-label="Stock status"
            size="sm"
            className="sm:ml-auto"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: 'Sab' },
              { value: 'low', label: 'Low', count: stats.low },
              { value: 'out', label: 'Out', count: stats.out },
            ]}
          />
        </Toolbar>

        {visibleRows.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Package />}
              title={allRows.length === 0 ? 'Abhi koi item nahi' : 'Is filter mein koi item nahi'}
              description={allRows.length === 0 ? 'Items screen mein products aur materials add karein; un ka stock yahan nazar aayega.' : 'Search ya filter badal kar dekhein.'}
              action={hasFilters ? <Button variant="secondary" size="sm" onClick={clearFilters}>Filters hatayen</Button> : undefined}
            />
          </Card>
        ) : isWide ? (
          <TableContainer>
            <Table>
              <THead>
                <tr>
                  <TH>Item</TH>
                  <TH>Category</TH>
                  <TH numeric>Stock</TH>
                  <TH numeric>Rate</TH>
                  <TH numeric>Value (cost)</TH>
                  <TH className="text-center">Status</TH>
                  <TH className="w-16 text-right"><span className="sr-only">Audit</span></TH>
                </tr>
              </THead>
              <TBody>
                {list.visibleItems.map(row => <StockTableRows key={row.item.id} row={row} onAudit={quickAudit} />)}
                <LoadMoreRow sentinelRef={list.sentinelRef} hiddenCount={list.hiddenCount} onShowMore={list.showMore} onShowAll={list.showAll} colSpan={7} />
              </TBody>
            </Table>
          </TableContainer>
        ) : (
          <>
            <ul className="flex flex-col gap-2.5">
              {list.visibleItems.map(row => <StockCard key={row.item.id} row={row} onAudit={quickAudit} />)}
            </ul>
            <LoadMoreRow sentinelRef={list.sentinelRef} hiddenCount={list.hiddenCount} onShowMore={list.showMore} onShowAll={list.showAll} />
          </>
        )}
      </div>

      {audit.open && (
        <Suspense fallback={null}>
          <StockAuditDialog
            key={auditSession}
            tab={canEdit ? audit.tab : 'history'}
            onTabChange={changeAuditTab}
            itemId={audit.itemId}
            onItemChange={changeAuditItem}
            initialVariantId={auditVariant}
            rows={allRows}
            logs={inventoryLogs}
            canEdit={canEdit}
            onSubmit={handleAdjust}
            onClose={closeAudit}
          />
        </Suspense>
      )}
    </div>
  );
};

export default Inventory;
