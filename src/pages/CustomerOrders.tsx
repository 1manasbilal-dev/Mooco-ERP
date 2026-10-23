import React, { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertCircle, ArrowRight, CalendarDays, CheckCircle2, ClipboardCheck, Loader2, Package, Plus, RefreshCw, ShoppingBag, Truck, WifiOff, X } from 'lucide-react';
import { useDairy } from '../context/DairyContext';
import { useTabs } from '../context/TabContext';
import { useToast } from '../context/ToastContext';
import { CustomerOrder, CustomerOrderStatus } from '../types';
import { changeCustomerOrderStatus, listCustomerOrders, localOrderDate, orderIsOpen } from '../lib/customerOrders';
import { useProgressiveList } from '../hooks/useProgressiveList';
import { confirmAction } from '../components/ui/ConfirmDialog';
import { Badge, Button, Card, EmptyState, IconButton, Input, LoadMoreRow, Money, PageHeader, SearchInput, SegmentedControl, Skeleton, StatCard, Toolbar } from '../components/ui';
import { STATUS_FILTERS, STATUS_TONE, StatusFilter, orderAdvance, orderBalance, orderMoney, prettyDate } from '../components/customer-orders/orderUi';

// The booking form and the detail view are separate chunks, so the list paints sooner. They are
// prefetched once the page is idle, and a failed fetch is retried once.
const retryOnce = <T,>(load: () => Promise<T>) => () => load().catch(() => new Promise<T>((resolve, reject) => {
  window.setTimeout(() => { load().then(resolve, reject); }, 800);
}));
const loadOrderForm = () => import('../components/customer-orders/CustomerOrderForm');
const loadOrderDetail = () => import('../components/customer-orders/CustomerOrderDetail');
const CustomerOrderForm = lazy(retryOnce(loadOrderForm));
const CustomerOrderDetail = lazy(retryOnce(loadOrderDetail));

const subscribeOnline = (callback: () => void) => {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
};
const readOnline = () => navigator.onLine;

function DialogFallback() {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50" role="status">
      <span className="flex items-center gap-2 rounded-card border border-line bg-surface px-4 py-3 text-sm font-semibold text-fg-muted shadow-e3">
        <Loader2 size={18} className="animate-spin" aria-hidden="true" />
        Loading…
      </span>
    </div>
  );
}

const OrderRow = memo(function OrderRow({ order, today, onOpen }: { order: CustomerOrder; today: string; onOpen: (id: string) => void }) {
  const advance = orderAdvance(order);
  const total = Number(order.total || 0);
  const open = orderIsOpen(order);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(order.id)}
        className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2.5 px-4 py-4 text-left transition-colors duration-100 hover:bg-surface-2/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] sm:items-center sm:px-5"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold tabular-nums text-fg-subtle">{order.order_number}</span>
            <Badge tone={STATUS_TONE[order.status]} dot>{order.status}</Badge>
            {advance > 0 && <Badge tone="success" className="tabular-nums">Adv: {orderMoney(advance)}</Badge>}
          </div>
          <p className="mt-1.5 truncate font-bold text-fg">{order.customer_name}</p>
          <p className="mt-0.5 truncate text-xs text-fg-subtle">{order.items.map(line => `${line.qty} ${line.unit} ${line.name}`).join(' · ')}</p>
        </div>

        <div className="col-start-1 row-start-2 text-xs sm:col-start-auto sm:row-start-auto">
          <p className="flex items-center gap-1.5 font-semibold tabular-nums text-fg-muted">
            <CalendarDays size={14} className="shrink-0 text-fg-subtle" aria-hidden="true" />
            {prettyDate(order.due_date)}{order.due_time && ` · ${order.due_time.slice(0, 5)}`}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-fg-subtle">
            {order.fulfillment === 'Delivery' ? <Truck size={14} aria-hidden="true" /> : <ShoppingBag size={14} aria-hidden="true" />}
            {order.fulfillment}
            {open && order.due_date < today && <Badge tone="danger">Overdue</Badge>}
          </p>
        </div>

        <div className="row-span-2 text-right sm:row-span-1">
          <Money amount={order.total} className="text-sm font-bold text-fg sm:text-base" />
          {advance > 0 && advance < total && (
            <p className="mt-0.5 text-[11px] font-semibold text-warning-fg">Bal: <Money amount={orderBalance(order)} /></p>
          )}
          <p className="mt-0.5 text-[11px] text-fg-subtle">{order.items.length} product{order.items.length !== 1 ? 's' : ''}</p>
        </div>

        <ArrowRight size={17} className="hidden text-fg-faint sm:block" aria-hidden="true" />
      </button>
    </li>
  );
});

function OrderListSkeleton() {
  return (
    <ul className="divide-y divide-line" aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => (
        <li key={index} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)] sm:px-5">
          <div className="space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
          <div className="hidden space-y-2 sm:block">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="flex flex-col items-end gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-14" />
          </div>
        </li>
      ))}
    </ul>
  );
}

const CustomerOrders: React.FC = () => {
  const { customers, canPerform } = useDairy();
  const { openTab } = useTabs();
  const { showToast } = useToast();
  const location = useLocation();
  const online = useSyncExternalStore(subscribeOnline, readOnline, () => true);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('Active');
  const [dateFilter, setDateFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState(() => new URLSearchParams(location.search).get('customer') || '');
  const [editor, setEditor] = useState<{ existing?: CustomerOrder } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const loadCounter = useRef(0);
  const today = localOrderDate();
  const canCreate = canPerform('customer_orders', 'create');
  const canEdit = canPerform('customer_orders', 'edit');
  const canCancel = canPerform('customer_orders', 'cancel');

  const refresh = useCallback(async () => {
    const request = ++loadCounter.current;
    setLoading(true);
    try { const rows = await listCustomerOrders(); if (request === loadCounter.current) { setOrders(rows); setError(''); } }
    catch (err: any) { if (request === loadCounter.current) setError(err.message); }
    finally { if (request === loadCounter.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const counter = loadCounter;
    void refresh();
    const update = () => void refresh();
    const focus = () => { if (document.visibilityState === 'visible') update(); };
    window.addEventListener('mooco-customer-orders-changed', update);
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', focus);
    return () => { ++counter.current; window.removeEventListener('mooco-customer-orders-changed', update); window.removeEventListener('online', update); document.removeEventListener('visibilitychange', focus); };
  }, [refresh]);
  useEffect(() => { setCustomerFilter(new URLSearchParams(location.search).get('customer') || ''); }, [location.search]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadOrderDetail().catch(() => {});
      void loadOrderForm().catch(() => {});
    }, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  const customerRows = useMemo(
    () => (customerFilter ? orders.filter(order => order.customer_id === customerFilter) : orders),
    [orders, customerFilter]
  );
  const openOrders = useMemo(() => customerRows.filter(orderIsOpen), [customerRows]);
  const stats = useMemo(() => ({
    active: openOrders.length,
    dueToday: openOrders.filter(order => order.due_date === today).length,
    ready: openOrders.filter(order => order.status === 'Ready').length,
    openValue: openOrders.reduce((sum, order) => sum + Number(order.total), 0),
  }), [openOrders, today]);
  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = { Active: openOrders.length, All: customerRows.length, Pending: 0, Confirmed: 0, Ready: 0, Completed: 0, Cancelled: 0 };
    customerRows.forEach(order => { counts[order.status] += 1; });
    return counts;
  }, [customerRows, openOrders]);
  // Search text per order, built once per data change instead of on every keystroke.
  const searchText = useMemo(() => new Map(customerRows.map(order => [
    order.id,
    `${order.order_number} ${order.customer_name} ${order.customer_phone} ${order.address} ${order.items.map(line => line.name).join(' ')}`.toLowerCase(),
  ])), [customerRows]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return customerRows.filter(order => {
      const matchesStatus = filter === 'All' || (filter === 'Active' ? orderIsOpen(order) : order.status === filter);
      return matchesStatus && (!dateFilter || order.due_date === dateFilter) && (!query || (searchText.get(order.id) || '').includes(query));
    }).sort((a, b) => {
      if (orderIsOpen(a) !== orderIsOpen(b)) return orderIsOpen(a) ? -1 : 1;
      return orderIsOpen(a) ? `${a.due_date} ${a.due_time}`.localeCompare(`${b.due_date} ${b.due_time}`) : b.created_at.localeCompare(a.created_at);
    });
  }, [customerRows, filter, dateFilter, search, searchText]);
  const { visibleItems, hiddenCount, sentinelRef, showMore, showAll } = useProgressiveList<CustomerOrder>(filtered, 50, `${filter}|${dateFilter}|${search}|${customerFilter}`);
  const detail = detailId ? orders.find(order => order.id === detailId) : undefined;
  const filterCustomerName = customerFilter ? (customers.find(row => row.id === customerFilter)?.name || 'selected customer') : '';
  const statusOptions = useMemo(
    () => STATUS_FILTERS.map(status => ({ value: status, label: status, count: statusCounts[status] })),
    [statusCounts]
  );

  const openDetail = useCallback((id: string) => setDetailId(id), []);
  const startEdit = useCallback((existing?: CustomerOrder) => {
    setEditor({ existing }); setDetailId(null);
  }, []);
  const closeEditor = useCallback(() => setEditor(null), []);
  const handleSaved = useCallback((saved: CustomerOrder, wasEdit: boolean) => {
    setOrders(previous => [saved, ...previous.filter(order => order.id !== saved.id)]);
    setEditor(null); setDetailId(saved.id);
    showToast(wasEdit ? 'Customer order updated' : 'Customer order booked', 'success');
  }, [showToast]);
  // Saved but the advance did not post: keep the form open on the saved order so Save retries the posting.
  const handleUnposted = useCallback((unposted: CustomerOrder) => {
    setOrders(previous => [unposted, ...previous.filter(order => order.id !== unposted.id)]);
    setEditor({ existing: unposted });
  }, []);

  const updateStatus = async (order: CustomerOrder, status: CustomerOrderStatus) => {
    if (busyRef.current || (status === 'Cancelled' ? !canCancel : !canEdit)) return;
    const postedAdvance = Number(order.advance_posted || 0);
    const cancelNote = postedAdvance > 0
      ? `Advance ${orderMoney(postedAdvance)} customer ke khaate mein credit rahega. Wapas karna ho to customer khaate se refund karein.`
      : 'Is order ka koi stock ya payment post nahi hua.';
    if (status === 'Cancelled' && !(await confirmAction({
      tone: 'warning',
      title: `Order ${order.order_number} cancel karein?`,
      consequences: [cancelNote],
      confirmLabel: 'Haan, cancel karein',
    }))) return;
    // Something else may have started while the confirmation was open.
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { const saved = await changeCustomerOrderStatus(order, status); setOrders(previous => previous.map(row => row.id === saved.id ? saved : row)); showToast(`Order ${status.toLowerCase()}`, 'success'); }
    catch (err: any) { showToast(err.message, 'error'); void refresh(); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const initialLoading = loading && !orders.length;

  return <div className="space-y-5 py-4 text-fg">
    <PageHeader
      eyebrow="Plan ahead. Serve on time."
      title="Customer Orders"
      description="Book dairy products for pickup or delivery. Track every order through to billing."
      actions={<>
        {!online && <Badge tone="warning" size="md" icon={<WifiOff />}>Offline</Badge>}
        <IconButton variant="secondary" aria-label="Refresh customer orders" icon={<RefreshCw className={loading ? 'animate-spin' : undefined} />} disabled={loading} onClick={() => void refresh()} />
        {canCreate && <Button leftIcon={<Plus />} onClick={() => startEdit()}>New Order</Button>}
      </>}
    />

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard label="Active orders" value={stats.active} icon={<ClipboardCheck />} tone="brand" hint="Pending, confirmed & ready" loading={initialLoading} />
      <StatCard label="Due today" value={stats.dueToday} icon={<CalendarDays />} tone={stats.dueToday > 0 ? 'warning' : 'neutral'} hint="Pickup & delivery" loading={initialLoading} />
      <StatCard label="Ready to serve" value={stats.ready} icon={<Package />} hint="Finish billing in POS" loading={initialLoading} />
      <StatCard label="Open order value" value={<Money amount={stats.openValue} compact />} icon={<ShoppingBag />} hint="Bookings awaiting billing" loading={initialLoading} />
    </div>

    {!online && !error && (
      <div role="status" className="flex items-center gap-3 rounded-card border border-warning/30 bg-warning-soft p-4 text-sm font-medium text-warning-fg">
        <WifiOff size={18} className="shrink-0" aria-hidden="true" />
        <span>Internet nahi hai. Orders dekhne aur save karne ke liye internet chahiye.</span>
      </div>
    )}
    {error && (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-card border border-warning/30 bg-warning-soft p-4 text-sm text-warning-fg">
        <AlertCircle size={18} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">{error}</span>
        <Button variant="secondary" onClick={() => void refresh()}>Try again</Button>
      </div>
    )}

    <div className="space-y-3">
      <Toolbar>
        <SearchInput
          aria-label="Search customer orders"
          placeholder="Search order, customer, phone or product…"
          value={search}
          onChange={setSearch}
          className="w-full sm:min-w-[220px] sm:flex-1"
        />
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Input type="date" aria-label="Filter by due date" className="w-full sm:w-44" value={dateFilter} onChange={event => setDateFilter(event.target.value)} />
          {dateFilter && <IconButton variant="ghost" aria-label="Clear date" icon={<X />} onClick={() => setDateFilter('')} />}
        </div>
        <div className="flex w-full min-w-0 items-center gap-2">
          <SegmentedControl<StatusFilter> aria-label="Order status" value={filter} onChange={setFilter} options={statusOptions} className="min-w-0" />
          <span className="ml-auto shrink-0 pr-1 text-xs tabular-nums text-fg-subtle">{filtered.length} orders</span>
        </div>
      </Toolbar>

      {customerFilter && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-control border border-brand/20 bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand-fg">
          <span className="min-w-0">Showing orders for {filterCustomerName}</span>
          <Button variant="ghost" size="sm" className="-mr-1 ml-auto text-brand-fg underline hover:text-brand-fg" onClick={() => { setCustomerFilter(''); openTab('/customer-orders'); }}>
            Show all customers
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        {initialLoading ? (
          <div role="status" aria-label="Loading orders">
            <OrderListSkeleton />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck />}
            title={orders.length ? 'No matching orders' : 'Your next order starts here'}
            description={orders.length ? 'Try another search, date or status filter.' : 'Book a customer’s products, choose pickup or delivery, and keep preparation on track.'}
            action={canCreate && !orders.length ? <Button leftIcon={<Plus />} onClick={() => startEdit()}>Book first order</Button> : undefined}
          />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {visibleItems.map(order => <OrderRow key={order.id} order={order} today={today} onOpen={openDetail} />)}
            </ul>
            <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} />
          </>
        )}
      </Card>
    </div>

    <p className="flex items-start gap-2 text-xs text-fg-subtle">
      <CheckCircle2 size={15} className="mt-px shrink-0 text-brand-accent" aria-hidden="true" />
      Orders are bookings. Stock, payment and customer khata update together when you complete billing in POS. Internet is required for orders.
    </p>

    {editor && (
      <Suspense fallback={<DialogFallback />}>
        <CustomerOrderForm
          existing={editor.existing}
          presetCustomerId={customerFilter}
          onClose={closeEditor}
          onSaved={handleSaved}
          onUnposted={handleUnposted}
        />
      </Suspense>
    )}

    {detail && (
      <Suspense fallback={<DialogFallback />}>
        <CustomerOrderDetail
          order={detail}
          busy={busy}
          onClose={() => setDetailId(null)}
          onEdit={startEdit}
          onStatus={(order, status) => void updateStatus(order, status)}
        />
      </Suspense>
    )}
  </div>;
};
export default CustomerOrders;
