import React, { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Droplets, Factory, Refrigerator, ShoppingCart, Store, Trash2 } from 'lucide-react';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { AllocationStatus, DestinationType, type AllocationEntry, type InventoryItem, type ItemDefinition, type PurchaseEntry, type Supplier } from '../types';
import { cleanNumber, formatCurrency, formatQty } from '../lib/formatters';
import { getRetailMilkStock } from '../lib/retailMilkStock';
import { useProgressiveList } from '../hooks/useProgressiveList';
import {
  Badge, Button, Card, EmptyState, Field, LoadMoreRow, Money, PageHeader, SearchInput, SegmentedControl, Select, StatCard,
} from '../components/ui';
import {
  CartLine, SourceRow, cartLineError, displaySourceName, type CartItem, type MilkSource, type SourceEntry,
} from '../components/milk-ops/AllocationRows';
import { PoolSummary } from '../components/milk-ops/PoolSummary';
import { formatPkDay, isLitreUnit, parseQty, qtyInputValue, remainingOf } from '../components/milk-ops/milkOps';

const AllocateQtyModal = lazy(() => import('../components/milk-ops/AllocateQtyModal'));

const TERMINAL_STATUSES: string[] = [AllocationStatus.FULLY_ALLOCATED, AllocationStatus.ALLOCATED_FOR_SUPPLY, AllocationStatus.COMPLETED];
const sourceFromSearch = (search: string): MilkSource => (new URLSearchParams(search).get('source') === 'retail' ? 'retail' : 'fresh');
const defaultDestination = (source: MilkSource) => (source === 'retail' ? DestinationType.PRODUCTION : DestinationType.RETAIL);

const milkTypeFromName = (name: string) => {
  const lower = name.toLowerCase();
  if (lower.includes('buffalo')) return 'Buffalo';
  if (lower.includes('cow')) return 'Cow';
  return 'Mixed';
};

const Allocation: React.FC = () => {
  const { allocations, purchases, allocateBulkMilk, allocateFromRetailStock, createBatch, discardBatch, trimBatchToSource, items, inventory, suppliers, canPerform } = useDairy();
  const { showToast } = useToast();
  const canCreate = canPerform('allocation', 'create');
  const canStartBatch = canPerform('production', 'create');
  const location = useLocation();
  const navigate = useNavigate();

  const [activeSource, setActiveSource] = useState<MilkSource>(() => sourceFromSearch(window.location.search));
  const [destination, setDestination] = useState<string>(() => defaultDestination(sourceFromSearch(window.location.search)));
  const [mobileTab, setMobileTab] = useState<'source' | 'cart'>('source');
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearch = useDeferredValue(searchQuery);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [modalEntry, setModalEntry] = useState<SourceEntry | null>(null);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingAllocRef = useRef(false);

  // The source tab follows the URL (?source=retail), e.g. when another screen links here.
  const urlSource = sourceFromSearch(location.search);
  const [lastUrlSource, setLastUrlSource] = useState(urlSource);
  if (urlSource !== lastUrlSource) {
    setLastUrlSource(urlSource);
    if (urlSource !== activeSource) {
      setActiveSource(urlSource);
      setDestination(defaultDestination(urlSource));
    }
  }

  const switchSource = (source: MilkSource) => {
    setActiveSource(source);
    setDestination(defaultDestination(source));
    const sp = new URLSearchParams(location.search);
    if (source === 'retail') sp.set('source', 'retail');
    else sp.delete('source');
    const q = sp.toString();
    navigate(`${location.pathname}${q ? `?${q}` : ''}`, { replace: true });
  };

  const purchasesById = useMemo(() => new Map<string, PurchaseEntry>(purchases.map(p => [p.id, p])), [purchases]);
  const suppliersById = useMemo(() => new Map<string, Supplier>(suppliers.map(s => [s.id, s])), [suppliers]);

  // Open collection lots: not in a terminal status and with milk left (> 0.001 L).
  const freshEntries = useMemo<SourceEntry[]>(() => allocations.flatMap(alloc => {
    const status = alloc.status || AllocationStatus.UNALLOCATED;
    const available = remainingOf(alloc);
    if (TERMINAL_STATUSES.includes(status) || available <= 0.001) return [];
    const purchase = alloc.purchase_id ? purchasesById.get(alloc.purchase_id) : undefined;
    const rawName = alloc.supplier_name && alloc.supplier_name !== 'Unknown'
      ? alloc.supplier_name
      : (purchase && suppliersById.get(purchase.supplier_id)?.name) || 'Unknown Supplier';
    const isReturn = rawName.startsWith('Return:');
    const name = displaySourceName(rawName);
    const milkType = alloc.milk_type || 'Mixed';
    const original = Number(alloc.original_quantity) || 0;
    return [{
      id: alloc.id,
      source: 'fresh' as const,
      rawName,
      name,
      isReturn,
      milkType,
      rate: Number(alloc.average_rate) > 0 ? Number(alloc.average_rate) : Number(purchase?.rate) || 0,
      available,
      original,
      partial: alloc.status === AllocationStatus.PARTIALLY_ALLOCATED || (Number(alloc.allocated_quantity) || 0) > 0,
      day: formatPkDay(alloc.date),
      shift: purchase?.shift ? String(purchase.shift) : undefined,
      searchText: `${name} ${milkType}`.toLowerCase(),
    }];
  }), [allocations, purchasesById, suppliersById]);

  // Loose counter milk in litres. Same rule as the dashboard's counter stock, so shakes, ghee,
  // packs and kg items never show up as milk; ml stock is left out because batches are in litres.
  const retailEntries = useMemo<SourceEntry[]>(() => {
    const inventoryById = new Map<string, InventoryItem>(inventory.map(row => [row.id, row]));
    const itemsById = new Map<string, ItemDefinition>(items.map(item => [item.id, item]));
    return getRetailMilkStock(inventory, items).rows.flatMap(row => {
      const stock = inventoryById.get(row.id);
      if (!stock || !isLitreUnit(stock.unit) || !(Number(stock.quantity) > 0)) return [];
      const itemId = stock.item_id || (row.id.startsWith('inv_') ? row.id.replace('inv_', '') : row.id);
      const master = itemsById.get(itemId) || items.find(def => def.name === stock.name);
      return [{
        id: itemId,
        source: 'retail' as const,
        rawName: stock.name,
        name: stock.name,
        isReturn: false,
        milkType: milkTypeFromName(stock.name),
        rate: master?.cost_price || stock.price || 0,
        available: Number(stock.quantity) || 0,
        partial: false,
        searchText: stock.name.toLowerCase(),
      }];
    });
  }, [inventory, items]);

  const pool = useMemo(() => {
    let remaining = 0;
    let original = 0;
    for (const entry of freshEntries) {
      remaining += entry.available;
      original += Math.max(entry.original || 0, entry.available);
    }
    return { remaining: cleanNumber(remaining, 3), allocated: cleanNumber(original - remaining, 3) };
  }, [freshEntries]);
  const counterLitres = useMemo(() => cleanNumber(retailEntries.reduce((sum, e) => sum + e.available, 0), 3), [retailEntries]);

  const visibleSource = activeSource === 'fresh' ? freshEntries : retailEntries;
  const filteredEntries = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return q ? visibleSource.filter(entry => entry.searchText.includes(q)) : visibleSource;
  }, [visibleSource, deferredSearch]);
  const list = useProgressiveList<SourceEntry>(filteredEntries, 40, `${activeSource}|${deferredSearch}`);

  // Live litres left for every cart line, read from current data rather than when the line was added.
  const allocationsById = useMemo(() => {
    const map = new Map<string, AllocationEntry>();
    for (const alloc of allocations) {
      map.set(alloc.id, alloc);
      if (alloc.purchase_id && !map.has(alloc.purchase_id)) map.set(alloc.purchase_id, alloc);
    }
    return map;
  }, [allocations]);
  const counterStockById = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of inventory) {
      const qty = Number(row.quantity) || 0;
      map.set(row.id, qty);
      if (row.item_id) map.set(row.item_id, qty);
    }
    return map;
  }, [inventory]);
  const availableFor = useCallback((line: Pick<CartItem, 'allocationId' | 'source'>) => {
    if (line.source === 'fresh') {
      const lot = allocationsById.get(line.allocationId);
      return lot ? remainingOf(lot) : 0;
    }
    return counterStockById.get(line.allocationId) ?? counterStockById.get(`inv_${line.allocationId}`) ?? 0;
  }, [allocationsById, counterStockById]);

  const cartQtyById = useMemo(() => new Map<string, number>(cart.map(line => [line.allocationId, parseQty(line.qty)])), [cart]);

  // The open dialog reads the row's current litres, so milk used elsewhere meanwhile cannot be over-allocated.
  const liveModalEntry = useMemo(() => {
    if (!modalEntry) return null;
    const live = (modalEntry.source === 'fresh' ? freshEntries : retailEntries).find(entry => entry.id === modalEntry.id);
    return live || { ...modalEntry, available: 0 };
  }, [modalEntry, freshEntries, retailEntries]);

  const totals = useMemo(() => {
    let volume = 0;
    let value = 0;
    let fresh = 0;
    let invalid = 0;
    for (const line of cart) {
      const qty = parseQty(line.qty);
      volume += qty;
      value += qty * (line.rate || 0);
      if (line.source === 'fresh') fresh += qty;
      if (cartLineError(line, availableFor(line))) invalid += 1;
    }
    return { volume: cleanNumber(volume, 3), value, fresh: cleanNumber(fresh, 3), invalid, averageRate: volume > 0 ? value / volume : 0 };
  }, [cart, availableFor]);

  const retailInCart = cart.some(line => line.source === 'retail');
  // Counter milk can never go back to the counter; that would only write it off.
  const retailDestinationBlocked = retailInCart || activeSource === 'retail';
  useEffect(() => {
    if (retailDestinationBlocked && destination === DestinationType.RETAIL) setDestination(DestinationType.PRODUCTION);
  }, [retailDestinationBlocked, destination]);

  const producibleItems = useMemo(() => items.filter(i => {
    if (i.isActive === false) return false;
    if (i.source !== 'Production' && i.source !== 'Both') return false;
    const nameLower = (i.name || '').toLowerCase().trim();
    if (['buffalo milk', 'cow milk', 'mixed milk', 'raw milk'].includes(nameLower) || ['item_buffalo_milk', 'item_cow_milk', 'item_mixed_milk'].includes(i.id)) return false;
    const types = Array.isArray(i.item_type) ? i.item_type : [i.item_type || ''];
    if (types.length > 0 && types.every(t => t === 'Raw material' || t === 'Packaging material')) return false;
    const categories = Array.isArray(i.category) ? i.category : [i.category || ''];
    return !categories.some(c => typeof c === 'string' && ['packaging', 'raw material', 'raw materials'].includes(c.toLowerCase()));
  }), [items]);

  const openEntry = useCallback((entry: SourceEntry) => setModalEntry(entry), []);
  const closeModal = useCallback(() => setModalEntry(null), []);

  const handleModalSubmit = (litres: number) => {
    if (!modalEntry) return;
    const entry = modalEntry;
    const text = qtyInputValue(litres);
    if (cartQtyById.has(entry.id)) {
      setCart(prev => prev.map(line => (line.allocationId === entry.id ? { ...line, qty: text } : line)));
      showToast(`Updated ${entry.name} allocation to ${formatQty(litres)} L`, 'success');
    } else {
      setCart(prev => [...prev, { allocationId: entry.id, qty: text, supplierName: entry.rawName, milkType: entry.milkType, rate: entry.rate, source: entry.source }]);
      showToast(`Added ${formatQty(litres)} L from ${entry.name} to cart`, 'success');
    }
    setModalEntry(null);
  };

  const handleModalRemove = () => {
    if (!modalEntry) return;
    const entry = modalEntry;
    setCart(prev => prev.filter(line => line.allocationId !== entry.id));
    setModalEntry(null);
    showToast(`Removed ${entry.name} from cart`, 'info');
  };

  const updateCartQty = useCallback((id: string, text: string) => {
    setCart(prev => prev.map(line => (line.allocationId === id ? { ...line, qty: text } : line)));
  }, []);
  const removeFromCart = useCallback((id: string) => {
    setCart(prev => prev.filter(line => line.allocationId !== id));
  }, []);

  const blockReason = !canCreate ? 'Aap ko allocation ki ijazat nahi hai.'
    : cart.length === 0 ? ''
    : destination === DestinationType.PRODUCTION && !canStartBatch ? 'Aap ko production batch shuru karne ki ijazat nahi hai.'
    : retailInCart && destination === DestinationType.RETAIL ? 'Counter milk wapas counter par nahi ja sakta.'
    : totals.invalid > 0 ? `${totals.invalid} ${totals.invalid === 1 ? 'line ki' : 'lines ki'} qty theek karein.`
    : '';
  // Shown on the product field itself, so it is not repeated under the button.
  const productMissing = destination === DestinationType.PRODUCTION && !selectedProduct;
  const canConfirm = canCreate && cart.length > 0 && !blockReason && !productMissing && !isSubmitting && totals.volume > 0;

  const handleProcessAllocation = async () => {
    if (!canCreate) {
      showToast('Aap ko is kaam ki ijazat nahi hai.', 'warning');
      return;
    }
    if (cart.length === 0 || isSubmitting || isSubmittingAllocRef.current) {
      if (cart.length === 0) showToast('Allocation cart is empty', 'warning');
      return;
    }
    const lines = cart.map(line => ({ ...line, quantity: cleanNumber(parseQty(line.qty), 3) }));
    const totalVolume = cleanNumber(lines.reduce((sum, line) => sum + line.quantity, 0), 3);
    if (totalVolume <= 0) {
      showToast('Please specify a valid allocation quantity greater than 0', 'warning');
      return;
    }
    if (lines.some(line => line.source === 'retail') && destination === DestinationType.RETAIL) {
      showToast('Cannot allocate from Retail Stock back to Retail Counter.', 'warning');
      return;
    }
    if (destination === DestinationType.PRODUCTION && !canStartBatch) {
      showToast('Aap ko production batch shuru karne ki ijazat nahi hai.', 'warning');
      return;
    }
    if (destination === DestinationType.PRODUCTION && !selectedProduct) {
      showToast('Please select a product to manufacture first!', 'warning');
      return;
    }

    // Check every line against live stock before anything is written. The batch is created first,
    // so a line that the allocation step later rejects (milk used meanwhile) left a batch whose
    // milk was never taken out of the pool or the counter.
    const emptyLine = lines.find(line => !(line.quantity > 0));
    if (emptyLine) {
      showToast(`${displaySourceName(emptyLine.supplierName)}: qty 0 hai. Qty likhein ya line hata dein.`, 'warning');
      return;
    }
    for (const line of lines) {
      const left = Math.max(0, availableFor(line));
      if (line.quantity > left + 0.001) {
        showToast(`${displaySourceName(line.supplierName)}: sirf ${cleanNumber(left)} L baqi hai, ${cleanNumber(line.quantity)} L allocate nahi ho sakta.`, 'error');
        return;
      }
    }

    const value = lines.reduce((sum, line) => sum + line.quantity * (line.rate || 0), 0);
    const averageRate = totalVolume > 0 ? value / totalVolume : 0;

    isSubmittingAllocRef.current = true;
    setIsSubmitting(true);

    let createdBatchId: string | null = null;
    try {
      if (destination === DestinationType.PRODUCTION) {
        // One milk type across the whole cart keeps that type; anything else is 'Mixed'.
        const distinctTypes = Array.from(new Set(lines.map(line => (line.milkType || 'Mixed').trim())));
        let batchMilkType = 'Mixed';
        if (distinctTypes.length === 1) {
          const t = String(distinctTypes[0] || '').toLowerCase();
          if (t.includes('buffalo')) batchMilkType = 'Buffalo';
          else if (t.includes('cow')) batchMilkType = 'Cow';
        }
        const batchDetails = {
          milk_type: batchMilkType,
          milk_breakdown: lines.map(line => ({
            allocationId: line.allocationId,
            milkType: line.milkType,
            quantity: line.quantity,
            supplierName: line.supplierName,
            rate: line.rate,
            source: line.source,
          })),
        };
        const batchCreated = await createBatch(selectedProduct, totalVolume, undefined, undefined, averageRate, undefined, batchDetails);
        if (!batchCreated) return;
        createdBatchId = batchCreated;
      }

      const freshItems = lines.filter(line => line.source === 'fresh').map(line => ({ allocationId: line.allocationId, quantity: line.quantity }));
      const retailItems = lines.filter(line => line.source === 'retail').map(line => ({ itemId: line.allocationId, quantity: line.quantity, rate: line.rate }));

      let freshDeducted = false;
      let retailDeducted = false;
      if (freshItems.length > 0) freshDeducted = Boolean(await allocateBulkMilk(freshItems, destination, { rate: averageRate }));
      if (retailItems.length > 0) retailDeducted = Boolean(await allocateFromRetailStock(retailItems, destination, { rate: averageRate }));
      const success = (freshItems.length === 0 || freshDeducted) && (retailItems.length === 0 || retailDeducted);
      const anyDeducted = freshDeducted || retailDeducted;

      // No milk left stock, so the batch created above is a phantom: remove it.
      if (createdBatchId && !anyDeducted) {
        await discardBatch(createdBatchId);
      } else if (createdBatchId && !success) {
        // Only one source went through: keep just its lines on the batch, or a later cancel would
        // return milk (pool or counter) that never left.
        await trimBatchToSource(createdBatchId, freshDeducted ? 'fresh' : 'retail');
      }

      if (success) {
        setCart([]);
        setSelectedProduct('');
        showToast(`Successfully allocated ${formatQty(totalVolume)} L to ${destination}`, 'success');
        setMobileTab('source');
      } else if (anyDeducted) {
        // Lines that already left stock must leave the cart too, or confirming again allocates them twice.
        const done = freshDeducted ? 'fresh' : 'retail';
        setCart(prev => prev.filter(line => line.source !== done));
        showToast(`${done === 'fresh' ? 'Fresh doodh' : 'Counter milk'} allocate ho gaya; baqi lines cart mein hain, dobara check karein.`, 'warning');
      }
    } catch (err: any) {
      showToast(err?.message || 'Failed to process allocation', 'error');
    } finally {
      setIsSubmitting(false);
      window.setTimeout(() => { isSubmittingAllocRef.current = false; }, 400);
    }
  };

  const sourceCount = activeSource === 'fresh' ? freshEntries.length : retailEntries.length;

  return (
    <div className="flex flex-col gap-4 pb-8 lg:gap-6">
      <PageHeader
        eyebrow="Dairy operations"
        description="Collected doodh ko retail counter ya production mein bhejein. Har lot ka baqi doodh yahan nazar aata hai."
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Milk pool summary">
        <PoolSummary className="col-span-2" remaining={pool.remaining} allocated={pool.allocated} inCart={totals.fresh} lots={freshEntries.length} />
        <StatCard
          label="Counter milk"
          value={`${formatQty(counterLitres)} L`}
          icon={<Refrigerator />}
          tone="info"
          hint={`${retailEntries.length} ${retailEntries.length === 1 ? 'item' : 'items'}`}
          onClick={() => { switchSource('retail'); setMobileTab('source'); }}
        />
        <StatCard
          label="Allocation cart"
          value={`${formatQty(totals.volume)} L`}
          icon={<ShoppingCart />}
          tone="brand"
          hint={cart.length > 0 ? `Avg ${formatCurrency(cleanNumber(totals.averageRate, 1))}/L` : 'Khali'}
          onClick={() => setMobileTab('cart')}
        />
      </section>

      <SegmentedControl
        aria-label="Allocation panel"
        className="lg:hidden"
        fullWidth
        value={mobileTab}
        onChange={setMobileTab}
        options={[
          { value: 'source', label: 'Doodh lots', icon: <Droplets />, count: sourceCount },
          { value: 'cart', label: 'Cart', icon: <ShoppingCart />, count: cart.length },
        ]}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-6">
        <Card className={mobileTab === 'source' ? 'block' : 'hidden lg:block'}>
          <div className="flex flex-col gap-3 border-b border-line p-3 sm:p-4">
            <SegmentedControl
              aria-label="Milk source"
              fullWidth
              value={activeSource}
              onChange={switchSource}
              options={[
                { value: 'fresh', label: 'Unallocated', icon: <Droplets />, count: freshEntries.length },
                { value: 'retail', label: 'Retail stock', icon: <Refrigerator />, count: retailEntries.length },
              ]}
            />
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder={activeSource === 'fresh' ? 'Gwala / supplier ya milk type search karein...' : 'Counter milk search karein...'}
              aria-label="Search milk sources"
            />
          </div>

          {filteredEntries.length === 0 ? (
            activeSource === 'fresh' ? (
              <EmptyState
                icon={<Droplets />}
                title={searchQuery ? 'Koi lot nahi mila' : 'Unallocated doodh nahi hai'}
                description={searchQuery ? 'Search badal kar dekhein.' : 'Milk collection mein intake record karein, ya Retail stock se counter milk production mein bhejein.'}
              />
            ) : (
              <EmptyState
                icon={<Refrigerator />}
                title={searchQuery ? 'Koi item nahi mila' : 'Counter par milk stock nahi hai'}
                description={searchQuery ? 'Search badal kar dekhein.' : 'Litre wale milk items ka POS stock yahan nazar aata hai.'}
              />
            )
          ) : (
            <div className="p-3 sm:p-4">
              <ul className="flex flex-col gap-2">
                {list.visibleItems.map(entry => (
                  <SourceRow key={entry.id} entry={entry} inCartQty={cartQtyById.get(entry.id) ?? null} onOpen={openEntry} />
                ))}
              </ul>
              <LoadMoreRow sentinelRef={list.sentinelRef} hiddenCount={list.hiddenCount} onShowMore={list.showMore} onShowAll={list.showAll} />
            </div>
          )}
        </Card>

        <Card className={`${mobileTab === 'cart' ? 'flex' : 'hidden lg:flex'} flex-col lg:sticky lg:top-4`}>
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
            <h3 className="flex items-center gap-2 text-[15px] font-bold tracking-tight text-fg">
              <ShoppingCart className="size-4 text-brand-fg" aria-hidden="true" />
              Allocation cart
              <Badge tone={cart.length > 0 ? 'brand' : 'neutral'}>{cart.length}</Badge>
            </h3>
            {cart.length > 0 && (
              <Button variant="ghost" size="sm" leftIcon={<Trash2 />} onClick={() => setCart([])} className="text-danger-fg hover:bg-danger-soft hover:text-danger-fg">
                Clear
              </Button>
            )}
          </div>

          {cart.length === 0 ? (
            <EmptyState
              size="compact"
              icon={<ShoppingCart />}
              title="Cart khali hai"
              description="Baen taraf se doodh ka lot chunein aur qty likhein."
              action={<Button variant="soft" size="sm" className="lg:hidden" onClick={() => setMobileTab('source')}>Lots dekhein</Button>}
            />
          ) : (
            <ul className="flex flex-col gap-2 p-3 sm:p-4 lg:max-h-[38vh] lg:overflow-y-auto">
              {cart.map(line => (
                <CartLine key={line.allocationId} line={line} available={availableFor(line)} onQtyChange={updateCartQty} onRemove={removeFromCart} />
              ))}
            </ul>
          )}

          <div className="flex flex-col gap-4 border-t border-line bg-surface-2/60 p-4 sm:p-5">
            <dl className="grid grid-cols-3 gap-2">
              <div className="min-w-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Total</dt>
                <dd className="mt-1 text-xl font-bold leading-none tabular-nums text-fg">{formatQty(totals.volume)}<span className="ml-0.5 text-xs font-semibold text-fg-subtle">L</span></dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Avg cost</dt>
                <dd className="mt-1 text-xl font-bold leading-none tabular-nums text-fg">{formatCurrency(cleanNumber(totals.averageRate, 1))}</dd>
              </div>
              <div className="min-w-0 text-right">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Value</dt>
                <dd className="mt-1 text-xl font-bold leading-none text-fg"><Money amount={totals.value} compact /></dd>
              </div>
            </dl>

            <div>
              <p className="mb-1.5 text-xs font-semibold text-fg-muted">Kahan bhejna hai</p>
              <SegmentedControl
                aria-label="Allocation destination"
                fullWidth
                value={destination}
                onChange={setDestination}
                options={[
                  { value: DestinationType.RETAIL, label: 'Retail counter', icon: <Store />, disabled: retailDestinationBlocked },
                  { value: DestinationType.PRODUCTION, label: 'Production', icon: <Factory /> },
                ]}
              />
              {retailInCart && (
                <p className="mt-1.5 text-xs text-fg-subtle">Cart mein counter milk hai, is liye sirf production mein ja sakta hai.</p>
              )}
            </div>

            {destination === DestinationType.PRODUCTION ? (
              <Field
                label="Kya banana hai"
                required
                error={cart.length > 0 && !selectedProduct ? 'Confirm se pehle product chunein.' : undefined}
                hint={producibleItems.length === 0 ? 'Items mein product ka source "Production" set karein.' : undefined}
              >
                {control => (
                  <Select {...control} value={selectedProduct} onChange={event => setSelectedProduct(event.target.value)}>
                    <option value="">Product chunein...</option>
                    {producibleItems.map(product => (
                      <option key={product.id} value={product.name}>Make: {product.name}</option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : (
              <p className="rounded-control border border-line bg-surface px-3 py-2.5 text-xs text-fg-subtle">
                Doodh seedha POS retail counter ke stock mein chala jayega.
              </p>
            )}

            <div className="space-y-2">
              <Button size="lg" fullWidth loading={isSubmitting} disabled={!canConfirm} rightIcon={<ArrowRight />} onClick={handleProcessAllocation}>
                {isSubmitting ? 'Processing...' : `Confirm allocation${totals.volume > 0 ? ` · ${formatQty(totals.volume)} L` : ''}`}
              </Button>
              {blockReason && <p className="text-center text-xs font-semibold text-warning-fg" role="status">{blockReason}</p>}
            </div>
          </div>
        </Card>
      </div>

      {mobileTab === 'source' && cart.length > 0 && (
        <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 shadow-e2 animate-fade-up lg:hidden">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tabular-nums text-fg">{cart.length} {cart.length === 1 ? 'line' : 'lines'} · {formatQty(totals.volume)} L</p>
            <p className="text-xs tabular-nums text-fg-subtle">Avg {formatCurrency(cleanNumber(totals.averageRate, 1))}/L</p>
          </div>
          <Button size="md" rightIcon={<ArrowRight />} onClick={() => setMobileTab('cart')}>Review cart</Button>
        </div>
      )}

      {liveModalEntry && (
        <Suspense fallback={null}>
          <AllocateQtyModal
            entry={liveModalEntry}
            cartQty={cartQtyById.get(liveModalEntry.id) ?? null}
            onSubmit={handleModalSubmit}
            onRemove={handleModalRemove}
            onClose={closeModal}
          />
        </Suspense>
      )}
    </div>
  );
};

export default Allocation;
