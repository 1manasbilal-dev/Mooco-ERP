import React, { Suspense, lazy, useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, ClipboardCheck, History as HistoryIcon, Layers, Package, PackageX } from 'lucide-react';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { BREAKPOINTS, useMediaQuery } from '../hooks/useMediaQuery';
import { useProgressiveList } from '../hooks/useProgressiveList';
import {
  Button, Card, EmptyState, LoadMoreRow, Money, PageHeader, SearchInput, SegmentedControl, StatCard, StatGrid, TBody, TH, THead, Table,
  TableContainer, Toolbar,
} from '../components/ui';
import { alertOf, buildStockRows, canSetOpening, type StockRow } from '../components/milk-ops/inventoryStock';
import { groupLogsByItem } from '../components/milk-ops/stockLog';
import { StockCard, StockTableRow, type RowAction } from '../components/milk-ops/StockRows';
import type { AuditTab, StockCountSubmission } from '../components/milk-ops/StockAuditDialog';
import type { InventoryLog, OpeningStockPiles } from '../types';

const StockAuditDialog = lazy(() => import('../components/milk-ops/StockAuditDialog'));
const StockHistoryDrawer = lazy(() => import('../components/milk-ops/StockHistoryDrawer'));
const OpeningStockDialog = lazy(() => import('../components/milk-ops/OpeningStockDialog'));

type TypeFilter = 'All' | 'Sale product' | 'Raw material' | 'Packaging material';
type StatusFilter = 'all' | 'low' | 'out' | 'fix';

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: 'All', label: 'All items' },
  { value: 'Sale product', label: 'Sale products' },
  { value: 'Raw material', label: 'Raw materials' },
  { value: 'Packaging material', label: 'Packaging' },
];

const NO_LOGS: InventoryLog[] = [];

interface AuditState { open: boolean; tab: AuditTab; itemId: string }

const auditFromSearch = (search: string): AuditState => {
  const sp = new URLSearchParams(search);
  return {
    open: sp.get('audit') === 'true' || sp.has('tab') || sp.has('item'),
    tab: sp.get('tab') === 'history' ? 'history' : 'adjust',
    itemId: sp.get('item') || '',
  };
};

const matchesStatus = (row: StockRow, filter: StatusFilter) =>
  filter === 'all' ? true : filter === 'fix' ? row.stray.length > 0 : alertOf(row) === filter;

const Inventory: React.FC = () => {
  const { inventory, inventoryLogs, adjustStock, setOpeningStock, items, canPerform } = useDairy();
  const { showToast } = useToast();
  const canEdit = canPerform('inventory', 'edit');
  const location = useLocation();
  const navigate = useNavigate();
  const isWide = useMediaQuery(BREAKPOINTS.md);

  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearch = useDeferredValue(searchTerm);
  const [filterType, setFilterType] = useState<TypeFilter>('All');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [historyItemId, setHistoryItemId] = useState('');
  const [openingItemId, setOpeningItemId] = useState('');

  // Audit dialog state mirrors the URL (?audit=true&tab=history&item=...), so it can be linked to.
  const [audit, setAudit] = useState<AuditState>(() => auditFromSearch(window.location.search));
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

  const openAudit = useCallback((tab: AuditTab = 'adjust', itemId = '') => {
    const next: AuditState = { open: true, tab: canEdit ? tab : 'history', itemId };
    setAudit(next);
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
  const rowsById = useMemo(() => new Map(allRows.map(row => [row.item.id, row])), [allRows]);
  const logsByItem = useMemo(() => groupLogsByItem(inventoryLogs), [inventoryLogs]);
  const canOpenItem = useCallback((row: StockRow) => canSetOpening(row, logsByItem.has(row.item.id)), [logsByItem]);

  const scopedRows = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return allRows.filter(row =>
      (!q || row.search.includes(q))
      && (filterType === 'All' || (row.item.item_type || []).some(t => t === filterType)));
  }, [allRows, deferredSearch, filterType]);

  // Header totals equal the sum of the listed rows (search and type filters apply, status filter does not).
  const stats = useMemo(() => {
    let totalValue = 0;
    let retailValue = 0;
    let low = 0;
    let out = 0;
    let fix = 0;
    for (const row of scopedRows) {
      totalValue += row.reading.costValue;
      retailValue += row.retailValue;
      const alert = alertOf(row);
      if (alert === 'low') low += 1;
      else if (alert === 'out') out += 1;
      if (row.stray.length > 0) fix += 1;
    }
    return { totalItems: scopedRows.length, totalValue, retailValue, low, out, fix };
  }, [scopedRows]);

  const visibleRows = useMemo(() => (
    statusFilter === 'all' ? scopedRows : scopedRows.filter(row => matchesStatus(row, statusFilter))
  ), [scopedRows, statusFilter]);

  const list = useProgressiveList<StockRow>(visibleRows, 50, `${deferredSearch}|${filterType}|${statusFilter}`);

  const onRowAction = useCallback((action: RowAction, itemId: string) => {
    if (action === 'count') openAudit('adjust', itemId);
    else if (action === 'history') setHistoryItemId(itemId);
    else setOpeningItemId(itemId);
  }, [openAudit]);

  const submittingRef = useRef(false);
  /** Saves each changed pile with its own `adjustStock` call; returns the piles that were saved. */
  const handleCount = async (count: StockCountSubmission): Promise<string[]> => {
    if (!canEdit) {
      showToast("You don't have permission to do this.", 'warning');
      return [];
    }
    if (submittingRef.current) return [];
    const row = rowsById.get(count.itemId);
    const invRecord = inventory.find(i => i.item_id === count.itemId || (row && i.name.toLowerCase() === row.item.name.toLowerCase()));
    if (!invRecord) {
      showToast("Couldn't find this item's stock record. Refresh the page and try again.", 'error');
      return [];
    }
    submittingRef.current = true;
    const saved: string[] = [];
    const failed: string[] = [];
    try {
      for (const change of count.changes) {
        let ok = false;
        try {
          ok = await adjustStock(invRecord.id, change.newQty, count.reason, count.notes, change.variantId);
        } catch {
          ok = false;
        }
        (ok ? saved : failed).push(ok ? change.variantId : change.name);
      }
    } finally {
      submittingRef.current = false;
    }
    if (failed.length === 0) {
      showToast(`${count.itemName}: stock count saved.`, 'success');
      closeAudit();
    } else if (saved.length > 0) {
      showToast(`${saved.length} ${saved.length > 1 ? 'piles' : 'pile'} saved, but these were not: ${failed.join(', ')}. Please try again.`, 'warning');
    } else {
      showToast(`Stock count couldn't be saved (${failed.join(', ')}). System stock is unchanged.`, 'error');
    }
    return saved;
  };

  const openingRow = openingItemId ? rowsById.get(openingItemId) : undefined;
  const handleOpening = async (piles: OpeningStockPiles, notes: string) => {
    if (!openingRow || !canEdit) return false;
    const ok = await setOpeningStock(openingRow.item.id, piles, notes || undefined);
    if (ok) {
      showToast(`${openingRow.item.name}: opening stock saved.`, 'success');
      setOpeningItemId('');
    }
    return ok;
  };

  const typeCounts = useMemo(() => {
    const counts: Record<TypeFilter, number> = { All: allRows.length, 'Sale product': 0, 'Raw material': 0, 'Packaging material': 0 };
    for (const row of allRows) {
      for (const type of row.item.item_type || []) {
        const key = type as TypeFilter;
        if (key in counts && key !== 'All') counts[key] += 1;
      }
    }
    return counts;
  }, [allRows]);

  const hasFilters = Boolean(searchTerm || filterType !== 'All' || statusFilter !== 'all');
  const clearFilters = () => { setSearchTerm(''); setFilterType('All'); setStatusFilter('all'); };
  const historyRow = historyItemId ? rowsById.get(historyItemId) : undefined;

  return (
    <div className="flex flex-col gap-4 pb-8 lg:gap-6">
      <PageHeader
        eyebrow="Dairy operations"
        description="Live physical stock: updates on its own from sales, purchases and production."
        actions={
          <>
            <Button variant="secondary" leftIcon={<HistoryIcon />} onClick={() => openAudit('history')}>Audit history</Button>
            {canEdit && <Button leftIcon={<ClipboardCheck />} onClick={() => openAudit('adjust')}>Stock count</Button>}
          </>
        }
      />

      <StatGrid
        label="Stock summary"
        storageKey="inventory"
        peek={[
          { value: <Money amount={stats.totalValue} compact />, label: 'at cost' },
          { value: stats.low, label: 'low', tone: stats.low > 0 ? 'warning' : undefined },
          { value: stats.out, label: 'out', tone: stats.out > 0 ? 'danger' : undefined },
        ]}
      >
        <StatCard label="Total items" value={stats.totalItems} icon={<Package />} hint={hasFilters ? 'Matching filters' : undefined} />
        <StatCard
          label="Stock value (cost)"
          value={<Money amount={stats.totalValue} compact />}
          icon={<Layers />}
          tone="brand"
          hint={stats.retailValue > 0 ? <>Retail <Money amount={stats.retailValue} compact /></> : undefined}
        />
        <StatCard
          label="Low stock"
          value={stats.low}
          icon={<AlertTriangle />}
          tone={stats.low > 0 ? 'warning' : 'neutral'}
          hint={statusFilter === 'low' ? 'Filter on' : stats.low > 0 ? 'At reorder level' : undefined}
          onClick={() => setStatusFilter(current => (current === 'low' ? 'all' : 'low'))}
        />
        <StatCard
          label="Out / minus stock"
          value={stats.out}
          icon={<PackageX />}
          tone={stats.out > 0 ? 'danger' : 'neutral'}
          hint={statusFilter === 'out' ? 'Filter on' : stats.out > 0 ? 'View' : undefined}
          onClick={() => setStatusFilter(current => (current === 'out' ? 'all' : 'out'))}
        />
      </StatGrid>

      {stats.fix > 0 && statusFilter !== 'fix' && (
        <p className="flex flex-wrap items-center gap-2 rounded-control bg-warning-soft px-3 py-2.5 text-[13px] font-semibold text-warning-fg ring-1 ring-inset ring-warning/25">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{stats.fix} product{stats.fix > 1 ? 's have' : ' has'} an old count left on a multi-unit or deleted pack. Set it to 0 in Stock count.</span>
          <Button size="sm" variant="secondary" onClick={() => setStatusFilter('fix')}>View</Button>
        </p>
      )}

      <div className="flex flex-col gap-3">
        <Toolbar>
          <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Search item or category..." className="w-full sm:w-72" aria-label="Search inventory" />
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
              { value: 'all', label: 'All' },
              { value: 'low', label: 'Low', count: stats.low },
              { value: 'out', label: 'Out', count: stats.out },
              ...(stats.fix > 0 || statusFilter === 'fix' ? [{ value: 'fix' as const, label: 'Fix', count: stats.fix }] : []),
            ]}
          />
        </Toolbar>

        {visibleRows.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Package />}
              title={allRows.length === 0 ? 'No items yet' : 'No items match this filter'}
              description={allRows.length === 0 ? 'Add products and materials on the Items screen; their stock will show here.' : 'Try a different search or filter.'}
              action={hasFilters ? <Button variant="secondary" size="sm" onClick={clearFilters}>Clear filters</Button> : undefined}
            />
          </Card>
        ) : isWide ? (
          <TableContainer>
            <Table>
              <THead>
                <tr>
                  <TH>Item</TH>
                  <TH>On hand</TH>
                  <TH numeric>Sellable</TH>
                  <TH numeric>Rate</TH>
                  <TH numeric>Value (cost)</TH>
                  <TH className="text-center">Status</TH>
                  <TH className="w-28 text-right"><span className="sr-only">Actions</span></TH>
                </tr>
              </THead>
              <TBody>
                {list.visibleItems.map(row => (
                  <StockTableRow key={row.item.id} row={row} canEdit={canEdit} canOpen={canOpenItem(row)} onAction={onRowAction} />
                ))}
                <LoadMoreRow sentinelRef={list.sentinelRef} hiddenCount={list.hiddenCount} onShowMore={list.showMore} onShowAll={list.showAll} colSpan={7} />
              </TBody>
            </Table>
          </TableContainer>
        ) : (
          <>
            <ul className="flex flex-col gap-2.5">
              {list.visibleItems.map(row => (
                <StockCard key={row.item.id} row={row} canEdit={canEdit} canOpen={canOpenItem(row)} onAction={onRowAction} />
              ))}
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
            rows={allRows}
            logs={inventoryLogs}
            canEdit={canEdit}
            onSubmit={handleCount}
            onClose={closeAudit}
          />
        </Suspense>
      )}

      {historyRow && (
        <Suspense fallback={null}>
          <StockHistoryDrawer
            key={historyRow.item.id}
            row={historyRow}
            logs={logsByItem.get(historyRow.item.id) || NO_LOGS}
            canEdit={canEdit}
            canOpen={canOpenItem(historyRow)}
            onCount={() => { setHistoryItemId(''); openAudit('adjust', historyRow.item.id); }}
            onOpening={() => { setHistoryItemId(''); setOpeningItemId(historyRow.item.id); }}
            onClose={() => setHistoryItemId('')}
          />
        </Suspense>
      )}

      {openingRow && canEdit && (
        <Suspense fallback={null}>
          <OpeningStockDialog key={openingRow.item.id} row={openingRow} onSubmit={handleOpening} onClose={() => setOpeningItemId('')} />
        </Suspense>
      )}
    </div>
  );
};

export default Inventory;
