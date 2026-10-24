import React, { lazy, Suspense, useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Boxes, LayoutGrid, List, PackageX, Plus, Ruler, Tag, Wallet, X,
} from 'lucide-react';
import { useDairy } from '../context/DairyContext';
import { MODULE_METADATA, useTabs } from '../context/TabContext';
import {
  Badge, Button, EmptyState, LoadMoreRow, Money, PageHeader, SearchInput, SegmentedControl, Select, Skeleton, StatCard,
  TBody, TH, THead, Table, TableContainer, Toolbar,
} from '../components/ui';
import { useProgressiveList } from '../hooks/useProgressiveList';
import { BREAKPOINTS, useMediaQuery } from '../hooks/useMediaQuery';
import {
  buildCatalogRows, canTakeOpeningStock, categoryOptions, filterAndSort, posOrderUpdates,
  type CatalogRow, type SortField, type SortOrder, type StatusFilter, type StockFilter, type TypeFilter,
} from '../components/items/catalogModel';
import { CatalogSkeleton, ProductCard, ProductListItem, ProductTableRow, type DropPosition } from '../components/items/CatalogViews';
import { SideSheet } from '../components/items/SideSheet';
import type { SellInPosEntry } from '../components/items/ItemDetailView';

// Everything that opens on demand stays out of the catalog's first chunk.
const ItemDetailView = lazy(() => import('../components/items/ItemDetailView').then(m => ({ default: m.ItemDetailView })));
const ItemFormSheet = lazy(() => import('../components/items/ItemFormSheet'));
const ItemDeleteDialog = lazy(() => import('../components/items/ItemDeleteDialog'));
const CategoryManagerDialog = lazy(() => import('../components/items/CategoryManagerDialog'));
const UnitManagerModal = lazy(() => import('../components/units/UnitManagerModal').then(m => ({ default: m.UnitManagerModal })));

/** `focus: 'opening'` opens the edit form at its opening stock fields. */
type SheetState = { mode: 'view' | 'edit'; id: string; focus?: 'opening' } | { mode: 'create'; id: null };
type ViewMode = 'grid' | 'list';

const VIEW_KEY = 'mooco.catalog.view';
const readView = (): ViewMode => {
  try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'; } catch { return 'list'; }
};

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: 'All', label: 'All' },
  { value: 'Sale product', label: 'Sale products' },
  { value: 'Raw material', label: 'Raw materials' },
  { value: 'Packaging material', label: 'Packaging' },
];

const SORT_OPTIONS: { value: `${SortField}:${SortOrder}`; label: string }[] = [
  { value: 'sort_order:asc', label: 'POS order' },
  { value: 'name:asc', label: 'Naam A-Z' },
  { value: 'stock:asc', label: 'Kam stock pehle' },
  { value: 'stock:desc', label: 'Zyada stock pehle' },
  { value: 'selling_price:desc', label: 'Mehnga pehle' },
  { value: 'selling_price:asc', label: 'Sasta pehle' },
  { value: 'margin:asc', label: 'Kam margin pehle' },
  { value: 'margin:desc', label: 'Zyada margin pehle' },
];

function SheetLoading({ onClose }: { onClose: () => void }) {
  return (
    <SideSheet onClose={onClose} label="Loading">
      <div className="space-y-4 p-6" aria-busy="true">
        <div className="flex items-center gap-4">
          <Skeleton className="size-16 rounded-2xl" />
          <div className="flex-1 space-y-2"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-4 w-1/3" /></div>
        </div>
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-2 gap-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-40 w-full" />
      </div>
    </SideSheet>
  );
}

const Items: React.FC = () => {
  const {
    items, inventory, inventoryLogs, categories, reorderItems, canPerform, reactivateEntity, hasPermission, settings, hasLoadedData,
  } = useDairy();
  const { openTab } = useTabs();
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = useMediaQuery(BREAKPOINTS.md);
  const detailTitleId = useId();

  const canCreate = canPerform('items', 'create');
  const canEdit = canPerform('items', 'edit');
  const canDelete = canPerform('items', 'delete');
  const canAdjustStock = canPerform('inventory', 'edit');
  const canOpenPos = hasPermission ? hasPermission(MODULE_METADATA['pos']?.module || 'pos') : true;

  /* ---------- Filters ---------- */

  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [filterType, setFilterType] = useState<TypeFilter>('All');
  const [filterCategory, setFilterCategory] = useState('All');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('All');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  // Default to POS order so the catalog matches the POS grid.
  const [sortField, setSortField] = useState<SortField>('sort_order');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [view, setView] = useState<ViewMode>(readView);

  const changeView = (next: ViewMode) => {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch {}
  };

  const rowsById = useMemo(() => buildCatalogRows(items, inventory), [items, inventory]);
  const allRows = useMemo(() => Array.from(rowsById.values()), [rowsById]);

  const filteredRows = useMemo(
    () => filterAndSort(allRows, {
      search: deferredSearch, type: filterType, category: filterCategory, status: filterStatus, stock: stockFilter, sortField, sortOrder,
    }),
    [allRows, deferredSearch, filterType, filterCategory, filterStatus, stockFilter, sortField, sortOrder],
  );

  const stats = useMemo(() => {
    let active = 0, sale = 0, low = 0, out = 0, value = 0;
    const typeCounts: Record<string, number> = { All: allRows.length };
    allRows.forEach(row => {
      row.item.item_type?.forEach(t => { typeCounts[t] = (typeCounts[t] || 0) + 1; });
      value += row.costValue;
      if (row.item.isActive === false) return;
      active += 1;
      if (row.isSale) sale += 1;
      if (row.alert === 'low') low += 1;
      // Minus stock counts as out (docs/stock-model.md).
      if (row.alert === 'out' || row.alert === 'minus') out += 1;
    });
    return { active, sale, low, out, value, typeCounts };
  }, [allRows]);

  const categoryList = useMemo(() => categoryOptions(categories, items), [categories, items]);
  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach(i => (i.category || []).forEach(c => map.set(c, (map.get(c) || 0) + 1)));
    return map;
  }, [items]);
  // A category removed from the list must not leave the filter stuck on it.
  const activeCategory = filterCategory === 'All' || categoryList.includes(filterCategory) ? filterCategory : 'All';

  const filtersOn = Boolean(search.trim()) || filterType !== 'All' || activeCategory !== 'All' || filterStatus !== 'All' || stockFilter !== 'all';
  const clearFilters = () => {
    setSearch('');
    setFilterType('All');
    setFilterCategory('All');
    setFilterStatus('All');
    setStockFilter('all');
  };

  const listKey = `${deferredSearch}|${filterType}|${activeCategory}|${filterStatus}|${stockFilter}|${sortField}|${sortOrder}|${view}`;
  const { visibleItems, hiddenCount, sentinelRef, showMore, showAll } = useProgressiveList<CatalogRow>(filteredRows, view === 'grid' ? 40 : 60, listKey);

  /* ---------- Sheets (URL keeps ?id=&mode= for deep links from other screens) ---------- */

  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [ownPath] = useState(() => location.pathname);

  // Read through a ref so the open/close callbacks stay stable and memoised rows don't re-render on every URL change.
  const searchRef = useRef(location.search);
  searchRef.current = location.search;

  const writeUrl = useCallback((next: SheetState | null) => {
    const sp = new URLSearchParams(searchRef.current);
    sp.delete('id');
    sp.delete('mode');
    if (next) {
      if (next.id) sp.set('id', next.id);
      sp.set('mode', next.mode);
    }
    const q = sp.toString();
    navigate(`${ownPath}${q ? `?${q}` : ''}`, { replace: true });
  }, [navigate, ownPath]);

  const openSheet = useCallback((next: SheetState) => {
    setSheet(next);
    writeUrl(next);
  }, [writeUrl]);

  const closeSheet = useCallback(() => {
    setSheet(null);
    writeUrl(null);
  }, [writeUrl]);

  // Follow links like /items?id=x&mode=view. A URL without them leaves an open sheet alone, so moving to
  // another tab and back never throws away a half-filled form.
  useEffect(() => {
    if (location.pathname !== ownPath) return;
    const sp = new URLSearchParams(location.search);
    const mode = sp.get('mode');
    const id = sp.get('id');
    if (mode === 'create') {
      if (canCreate) setSheet(prev => (prev?.mode === 'create' ? prev : { mode: 'create', id: null }));
      return;
    }
    if (id && items.some(i => i.id === id)) {
      const wanted = mode === 'edit' && canEdit ? 'edit' : 'view';
      setSheet(prev => (prev?.id === id && prev.mode === wanted ? prev : { mode: wanted, id }));
    }
  }, [location.pathname, location.search, ownPath, items, canCreate, canEdit]);

  const openView = useCallback((id: string) => openSheet({ mode: 'view', id }), [openSheet]);
  const openEdit = useCallback((id: string) => openSheet(canEdit ? { mode: 'edit', id } : { mode: 'view', id }), [openSheet, canEdit]);
  const openDelete = useCallback((id: string) => setDeleteId(id), []);
  const openCreate = () => openSheet({ mode: 'create', id: null });

  const sheetItem = sheet?.id ? items.find(i => i.id === sheet.id) || null : null;
  // Opening stock is offered only before a product's first stock move (no stock log yet).
  const sheetHasStockLogs = useMemo(
    () => Boolean(sheetItem && sheet?.mode === 'view' && (inventoryLogs || []).some(log => log.item_id === sheetItem.id)),
    [inventoryLogs, sheetItem, sheet?.mode],
  );
  const deleteItem = deleteId ? items.find(i => i.id === deleteId) || null : null;

  const sellInPos = (itemId: string, entry?: SellInPosEntry) => {
    const sp = new URLSearchParams({ quick: itemId });
    if (entry) {
      sp.set('quickMode', entry.mode);
      sp.set('quickValue', entry.value);
      if (entry.variantId) sp.set('quickVariant', entry.variantId);
    }
    closeSheet();
    openTab(`/pos?${sp.toString()}`);
  };

  /* ---------- POS order: drag and drop or up/down ---------- */

  // Reordering is only safe in POS order: in any other sort the list order would be written as the POS order.
  const reorderEnabled = canEdit && sortField === 'sort_order' && sortOrder === 'asc';
  const listRef = useRef<CatalogRow[]>(filteredRows);
  listRef.current = filteredRows;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [drag, setDrag] = useState<{ source: string | null; overId: string | null; pos: DropPosition }>({ source: null, overId: null, pos: null });
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const commitOrder = useCallback(async (nextList: CatalogRow[]) => {
    const updates = posOrderUpdates(nextList.map(r => r.item), itemsRef.current);
    const changed = updates.filter(u => (itemsRef.current.find(i => i.id === u.id)?.sort_order ?? 999) !== u.sort_order);
    if (changed.length > 0) await reorderItems(changed);
  }, [reorderItems]);

  const moveStep = useCallback((id: string, direction: 'up' | 'down') => {
    const list = listRef.current;
    const from = list.findIndex(r => r.item.id === id);
    const to = direction === 'up' ? from - 1 : from + 1;
    if (from === -1 || to < 0 || to >= list.length) return;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void commitOrder(next);
  }, [commitOrder]);

  const resetDrag = useCallback(() => setDrag({ source: null, overId: null, pos: null }), []);

  const onDragStart = useCallback((event: React.DragEvent, id: string) => {
    event.dataTransfer.setData('text/plain', id);
    event.dataTransfer.effectAllowed = 'move';
    setDrag({ source: id, overId: null, pos: null });
  }, []);

  const onDragOver = useCallback((event: React.DragEvent, targetId: string) => {
    const { source, overId, pos } = dragRef.current;
    if (!source) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (source === targetId) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const nextPos: DropPosition = event.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
    if (overId !== targetId || pos !== nextPos) setDrag({ source, overId: targetId, pos: nextPos });
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) setDrag(prev => (prev.overId ? { ...prev, overId: null, pos: null } : prev));
  }, []);

  const onDrop = useCallback((event: React.DragEvent, targetId: string) => {
    event.preventDefault();
    const { source, pos } = dragRef.current;
    resetDrag();
    if (!source || source === targetId) return;
    const list = listRef.current;
    const from = list.findIndex(r => r.item.id === source);
    if (from === -1 || list.findIndex(r => r.item.id === targetId) === -1) return;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    const target = next.findIndex(r => r.item.id === targetId);
    next.splice(pos === 'below' ? target + 1 : target, 0, moved);
    void commitOrder(next);
  }, [commitOrder, resetDrag]);

  /* ---------- Render ---------- */

  const loading = !hasLoadedData && items.length === 0;
  const sortValue = `${sortField}:${sortOrder}` as const;
  const typeOptions = TYPE_OPTIONS.map(o => ({ ...o, count: stats.typeCounts[o.value] || 0 }));
  const categoryOptionsForFilter = [
    { value: 'All', label: 'All categories' },
    ...categoryList.map(c => ({ value: c, label: c, count: categoryCounts.get(c) || 0 })),
  ];

  const itemProps = { canEdit, canDelete, onOpen: openView, onEdit: openEdit, onDelete: openDelete };
  const reorderProps = (row: CatalogRow, index: number) => {
    const reorderable = reorderEnabled && row.isSale;
    return {
      reorderable,
      isFirst: index === 0,
      isLast: index === filteredRows.length - 1,
      isDragging: drag.source === row.item.id,
      dropPosition: drag.overId === row.item.id ? drag.pos : null,
      onMove: moveStep,
      onDragStart,
      onDragOver,
      onDragLeave,
      onDrop,
      onDragEnd: resetDrag,
    };
  };

  let content: React.ReactNode;
  if (loading) {
    content = <CatalogSkeleton view={view} />;
  } else if (items.length === 0) {
    content = (
      <div className="rounded-card border border-line bg-surface shadow-e1">
        <EmptyState
          icon={<Boxes />}
          title="Abhi koi product nahi"
          description="Doodh, dahi, packaging ya raw material: pehla product add karein, phir POS aur inventory mein dikhega."
          action={canCreate ? <Button leftIcon={<Plus />} onClick={openCreate}>Product add karein</Button> : undefined}
        />
      </div>
    );
  } else if (filteredRows.length === 0) {
    content = (
      <div className="rounded-card border border-line bg-surface shadow-e1">
        <EmptyState
          icon={<Boxes />}
          title="Koi product nahi mila"
          description={search.trim() ? `"${search.trim()}" se milta koi product in filters mein nahi.` : 'In filters mein koi product nahi.'}
          action={<Button variant="secondary" leftIcon={<X />} onClick={clearFilters}>Filters saaf karein</Button>}
        />
      </div>
    );
  } else if (view === 'grid') {
    content = (
      <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {visibleItems.map(row => <ProductCard key={row.item.id} row={row} {...itemProps} />)}
        </div>
        <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} />
      </>
    );
  } else if (isDesktop) {
    content = (
      <TableContainer>
        <Table>
          <THead>
            <tr>
              <TH className="w-28">POS #</TH>
              <TH>Product</TH>
              <TH>Stock</TH>
              <TH numeric>Cost</TH>
              <TH numeric>Selling rate</TH>
              <TH numeric>Margin</TH>
              <TH className="w-24"><span className="sr-only">Actions</span></TH>
            </tr>
          </THead>
          <TBody>
            {visibleItems.map((row, index) => (
              <ProductTableRow key={row.item.id} row={row} {...itemProps} {...reorderProps(row, index)} />
            ))}
            <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} colSpan={7} />
          </TBody>
        </Table>
      </TableContainer>
    );
  } else {
    content = (
      <div className="overflow-hidden rounded-card border border-line bg-surface shadow-e1">
        <ul className="divide-y divide-line/70">
          {visibleItems.map((row, index) => (
            <ProductListItem key={row.item.id} row={row} {...itemProps} {...reorderProps(row, index)} />
          ))}
        </ul>
        <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-20 sm:gap-5">
      <PageHeader
        eyebrow="Product catalog"
        description="Products, raw materials aur packaging: rate, cost, units aur POS order ek jagah."
        actions={<>
          <Button variant="secondary" leftIcon={<Tag />} onClick={() => setCategoriesOpen(true)}>Categories</Button>
          <Button variant="secondary" leftIcon={<Ruler />} onClick={() => setUnitsOpen(true)}>Units</Button>
          {canCreate && <Button leftIcon={<Plus />} onClick={openCreate}>Add product</Button>}
        </>}
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Catalog summary">
        <StatCard
          label="Active products"
          value={stats.active}
          icon={<Boxes />}
          tone="brand"
          hint={`${stats.sale} POS mein`}
          loading={loading}
          onClick={stockFilter !== 'all' ? () => setStockFilter('all') : undefined}
        />
        <StatCard label="Low stock" value={stats.low} icon={<AlertTriangle />} tone={stats.low ? 'warning' : 'neutral'} hint="alert se kam" loading={loading} onClick={() => setStockFilter(stockFilter === 'low' ? 'all' : 'low')} />
        <StatCard label="Out of stock" value={stats.out} icon={<PackageX />} tone={stats.out ? 'danger' : 'neutral'} hint="bik nahi sakte" loading={loading} onClick={() => setStockFilter(stockFilter === 'out' ? 'all' : 'out')} />
        <StatCard label="Stock value" value={<Money amount={stats.value} compact />} icon={<Wallet />} hint="cost par" loading={loading} />
      </section>

      <div className="flex flex-col gap-2">
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Product ya category dhoondein..." aria-label="Products search karein" className="w-full sm:w-64 lg:w-72" />
          <SegmentedControl aria-label="Product type" size="sm" value={filterType} onChange={setFilterType} options={typeOptions} />
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            <Select aria-label="Status" value={filterStatus} onChange={event => setFilterStatus(event.target.value as StatusFilter)} className="h-9 w-auto min-w-0 flex-1 text-xs sm:flex-none">
              <option value="All">All status</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </Select>
            <Select
              aria-label="Sort"
              value={sortValue}
              onChange={event => {
                const [field, order] = event.target.value.split(':') as [SortField, SortOrder];
                setSortField(field);
                setSortOrder(order);
              }}
              className="h-9 w-auto min-w-0 flex-1 text-xs sm:flex-none"
            >
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <SegmentedControl
              aria-label="View"
              size="sm"
              value={view}
              onChange={changeView}
              options={[
                { value: 'list', label: <span className="sr-only sm:not-sr-only">List</span>, icon: <List /> },
                { value: 'grid', label: <span className="sr-only sm:not-sr-only">Grid</span>, icon: <LayoutGrid /> },
              ]}
            />
          </div>
        </Toolbar>

        {categoryList.length > 0 && (
          <SegmentedControl aria-label="Category" size="sm" value={activeCategory} onChange={setFilterCategory} options={categoryOptionsForFilter} className="w-full sm:w-fit" />
        )}

        {(stockFilter !== 'all' || filtersOn || (view === 'list' && canEdit)) && (
          <div className="flex flex-wrap items-center gap-2 px-1 text-xs text-fg-subtle">
            <span className="font-semibold text-fg-muted">{filteredRows.length} of {items.length} products</span>
            {stockFilter !== 'all' && (
              <Badge tone={stockFilter === 'low' ? 'warning' : 'danger'}>
                {stockFilter === 'low' ? 'Sirf low stock' : 'Sirf out of stock'}
                <button type="button" aria-label="Stock filter hatayen" className="-mr-1 cursor-pointer rounded-full p-0.5 hover:bg-black/5" onClick={() => setStockFilter('all')}><X className="size-3" /></button>
              </Badge>
            )}
            {filtersOn && <Button size="sm" variant="ghost" onClick={clearFilters}>Filters saaf karein</Button>}
            {view === 'list' && canEdit && (
              <span className="ml-auto hidden sm:inline">
                {reorderEnabled ? 'Row khench kar ya ↑↓ se POS order badlein.' : 'POS order badalne ke liye sort "POS order" rakhein.'}
              </span>
            )}
          </div>
        )}
      </div>

      {content}

      {sheet?.mode === 'view' && sheetItem && (
        <SideSheet onClose={closeSheet} labelledBy={detailTitleId}>
          <Suspense fallback={<div className="space-y-3 p-6"><Skeleton className="h-16 w-full" /><Skeleton className="h-40 w-full" /></div>}>
            {(() => {
              const row = rowsById.get(sheetItem.id);
              return (
                <ItemDetailView
                  item={sheetItem}
                  titleId={detailTitleId}
                  stock={row?.loose ?? 0}
                  variantStocks={row?.variantStocks ?? {}}
                  allowNegativeStock={Boolean(settings?.inventory?.allowNegativeStock)}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  canOpenPos={canOpenPos}
                  materialName={id => items.find(i => i.id === id)?.name}
                  canSetOpeningStock={Boolean(canEdit && canAdjustStock && !sheetItem.isSystem && row && canTakeOpeningStock(row.reading, sheetHasStockLogs))}
                  onOpeningStock={() => openSheet({ mode: 'edit', id: sheetItem.id, focus: 'opening' })}
                  onClose={closeSheet}
                  onEdit={() => openEdit(sheetItem.id)}
                  onDelete={() => openDelete(sheetItem.id)}
                  onReactivate={() => { void reactivateEntity('item', sheetItem.id); }}
                  onDeactivate={() => openDelete(sheetItem.id)}
                  onSellInPos={entry => sellInPos(sheetItem.id, entry)}
                />
              );
            })()}
          </Suspense>
        </SideSheet>
      )}

      {sheet && sheet.mode !== 'view' && (sheet.mode === 'create' || sheetItem) && (
        <Suspense fallback={<SheetLoading onClose={closeSheet} />}>
          <ItemFormSheet
            key={sheet.mode === 'create' ? 'create' : `edit-${sheet.id}`}
            mode={sheet.mode}
            item={sheet.mode === 'edit' ? sheetItem : null}
            focusOpeningStock={sheet.mode === 'edit' && sheet.focus === 'opening'}
            canDelete={canDelete}
            onClose={closeSheet}
            onSaved={closeSheet}
            onDelete={openDelete}
          />
        </Suspense>
      )}

      {deleteItem && (
        <Suspense fallback={null}>
          <ItemDeleteDialog
            key={deleteItem.id}
            item={deleteItem}
            onClose={() => setDeleteId(null)}
            onDone={id => {
              setDeleteId(null);
              if (sheet?.id === id) closeSheet();
            }}
          />
        </Suspense>
      )}

      {categoriesOpen && (
        <Suspense fallback={null}>
          <CategoryManagerDialog canManage={canCreate || canEdit} onClose={() => setCategoriesOpen(false)} />
        </Suspense>
      )}

      {unitsOpen && (
        <Suspense fallback={null}>
          <UnitManagerModal isOpen onClose={() => setUnitsOpen(false)} />
        </Suspense>
      )}
    </div>
  );
};

export default Items;
