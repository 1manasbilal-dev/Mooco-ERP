import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ClipboardCheck, Plus, Search, CalendarDays, Clock, Truck, ShoppingBag, X, Trash2, Pencil, ArrowRight, RefreshCw, CheckCircle2, Package, Printer, Phone, MapPin, AlertCircle, Loader2, ChevronDown, User, Banknote, CreditCard } from 'lucide-react';
import { useDairy } from '../context/DairyContext';
import { useTabs } from '../context/TabContext';
import { useToast } from '../context/ToastContext';
import { CustomerOrder, CustomerOrderLine, CustomerOrderStatus, CustomerOrderPaymentStatus } from '../types';
import { generateInvoiceNumber, generateUUID, roundCurrency, roundQuantity } from '../lib/db';
import { changeCustomerOrderStatus, listCustomerOrders, localOrderDate, orderAmounts, orderIsOpen, postCustomerOrderAdvance, saveCustomerOrder, unpostedAdvance } from '../lib/customerOrders';
import { RichSelect, RichSelectOption } from '../components/RichSelect';
import { availableSellUnits, oneUnitLabel, sellUnitContains, sellUnitPrice } from '../lib/sellUnits';
import { formatQty, formatCurrency } from '../lib/formatters';
import { confirmAction } from '../components/ui/ConfirmDialog';

const input = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 shadow-sm outline-none transition-all placeholder:text-slate-400 hover:border-slate-300 focus:border-lime-500 focus:ring-2 focus:ring-lime-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600';
const select = 'w-full appearance-none rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 pr-10 text-sm font-semibold text-slate-900 shadow-sm outline-none transition-all hover:border-slate-300 focus:border-lime-500 focus:ring-2 focus:ring-lime-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 cursor-pointer';
const button = 'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:border-slate-300 active:scale-95 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer';
const primary = 'inline-flex items-center justify-center gap-2 rounded-xl bg-lime-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-lime-600/25 transition-all hover:bg-lime-700 active:scale-95 disabled:opacity-50 cursor-pointer';
const statusStyles: Record<CustomerOrderStatus, string> = {
  Pending: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  Confirmed: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  Ready: 'bg-lime-50 text-lime-700 dark:bg-lime-950/40 dark:text-lime-300',
  Completed: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  Cancelled: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
};
const prettyDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });

function OrderDialog({ title, onClose, children, busy = false }: { title: string; onClose: () => void; children: React.ReactNode; busy?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, button, select')?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-2 backdrop-blur-sm sm:p-6" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="customer-order-dialog-title" className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950" onKeyDown={e => {
      if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); }
      if (e.key !== 'Tab') return;
      const nodes = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') || [])].filter(node => node.getClientRects().length);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }}>
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-6 py-4.5 dark:border-slate-800/80 dark:bg-slate-900/60">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-lime-100 text-lime-700 shadow-sm dark:bg-lime-950/80 dark:text-lime-400">
            <ClipboardCheck size={20} />
          </div>
          <h2 id="customer-order-dialog-title" className="text-lg font-black tracking-tight text-slate-900 dark:text-white">{title}</h2>
        </div>
        <button type="button" aria-label="Close order dialog" className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-all hover:bg-slate-100 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white cursor-pointer" disabled={busy} onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="overflow-y-auto p-5 sm:p-6">{children}</div>
    </div>
  </div>;
}

const CustomerOrders: React.FC = () => {
  const { customers, items, inventory, settings, accounts, activeShiftSession, currentUser, hasPermission, canPerform, retryLoading } = useDairy();
  const { openTab } = useTabs();
  const { showToast } = useToast();
  const location = useLocation();
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('Active');
  const [dateFilter, setDateFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState(() => new URLSearchParams(location.search).get('customer') || '');
  const [editor, setEditor] = useState<{ existing?: CustomerOrder } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<CustomerOrder>>({});
  const [productKey, setProductKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const busyRef = useRef(false);
  const loadCounter = useRef(0);
  const today = localOrderDate();
  const money = (value: number) => formatCurrency(value, `${settings.general.currencySymbol || 'Rs'} `);
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
    void refresh();
    const update = () => void refresh();
    const focus = () => { if (document.visibilityState === 'visible') update(); };
    window.addEventListener('mooco-customer-orders-changed', update);
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', focus);
    return () => { ++loadCounter.current; window.removeEventListener('mooco-customer-orders-changed', update); window.removeEventListener('online', update); document.removeEventListener('visibilitychange', focus); };
  }, [refresh]);
  useEffect(() => { setCustomerFilter(new URLSearchParams(location.search).get('customer') || ''); }, [location.search]);

  const catalog = useMemo(() => items.filter(item => item.isActive && item.item_type?.includes('Sale product') && !item.item_type.includes('Packaging material')).flatMap(item => [
    ...(item.allow_loose_sale !== false ? [{ key: `${item.id}|base`, item, variant: undefined, label: `${item.name} · ${item.unit}`, price: item.selling_price }] : []),
    ...(item.variants || []).filter(variant => variant.isActive).map(variant => ({ key: `${item.id}|${variant.id}`, item, variant, label: `${item.name} · ${oneUnitLabel(variant.name, sellUnitContains(variant), item.unit)}`, price: sellUnitPrice(item.selling_price, sellUnitContains(variant), variant.selling_price) }))
  ]), [items]);

  const customerOptions: RichSelectOption[] = useMemo(() => {
    return customers
      .filter(customer => customer.isActive || customer.id === draft.customer_id)
      .map(customer => {
        const bal = Number(customer.balance || 0);
        let badge: RichSelectOption['badge'] = undefined;
        if (!customer.isActive) {
          badge = { text: 'Inactive', variant: 'slate' };
        } else if (bal > 0) {
          badge = { text: `Due ${formatCurrency(bal)}`, variant: 'red' };
        } else if (bal < 0) {
          badge = { text: `Adv ${formatCurrency(Math.abs(bal))}`, variant: 'green' };
        }

        return {
          value: customer.id,
          label: customer.name,
          subLabel: customer.phone ? `Ph: ${customer.phone}${customer.city ? ` · ${customer.city}` : ''}` : (customer.city || 'No phone number'),
          avatarLetter: (customer.name || 'C').charAt(0).toUpperCase(),
          avatarBg: 'bg-lime-100 dark:bg-lime-950 text-lime-800 dark:text-lime-300 border border-lime-200 dark:border-lime-800',
          badge,
          disabled: !customer.isActive && customer.id !== draft.customer_id
        };
      });
  }, [customers, draft.customer_id]);

  const fulfillmentOptions: RichSelectOption[] = useMemo(() => [
    {
      value: 'Pickup',
      label: 'Pickup (Takeaway)',
      subLabel: 'Customer collects items from shop / farm',
      icon: <ShoppingBag size={16} className="text-lime-600 dark:text-lime-400" />,
      badge: { text: 'Store', variant: 'green' }
    },
    {
      value: 'Delivery',
      label: 'Delivery (Home / Site)',
      subLabel: 'Delivered directly to customer address',
      icon: <Truck size={16} className="text-blue-600 dark:text-blue-400" />,
      badge: { text: 'Rider / Van', variant: 'blue' }
    }
  ], []);

  const paymentModeOptions: RichSelectOption[] = useMemo(() => [
    {
      value: 'Cash',
      label: 'Cash',
      icon: <Banknote size={16} className="text-emerald-600 dark:text-emerald-400" />
    },
    {
      value: 'Online',
      label: 'Online / Bank',
      icon: <CreditCard size={16} className="text-blue-600 dark:text-blue-400" />
    }
  ], []);

  const productOptions: RichSelectOption[] = useMemo(() => {
    return catalog.map(row => {
      const stock = inventory.find(inv => inv.item_id === row.item.id);
      const available = availableSellUnits(Number(stock?.quantity) || 0, Number(stock?.variant_stocks?.[row.variant?.id || ''] || 0), row.variant);

      const customer = customers.find(c => c.id === draft.customer_id);
      const price = row.variant ? row.price : (customer?.custom_prices?.[row.item.id] ?? row.price);
      const isOutOfStock = available <= 0;

      return {
        value: row.key,
        label: row.item.name,
        subLabel: `${row.variant ? oneUnitLabel(row.variant.name, sellUnitContains(row.variant), row.item.unit) : `1 ${row.item.unit}`} · ${formatQty(available, 3)} ready`,
        icon: <Package size={16} className={isOutOfStock ? 'text-amber-500' : 'text-lime-600 dark:text-lime-400'} />,
        badge: {
          text: money(price),
          variant: isOutOfStock ? 'amber' : 'green'
        }
      };
    });
  }, [catalog, inventory, customers, draft.customer_id, settings.general.currencySymbol]);
  const amounts = orderAmounts(draft.items || [], Number(draft.discount) || 0, Number(draft.advance_paid) || 0);
  const customerRows = customerFilter ? orders.filter(order => order.customer_id === customerFilter) : orders;
  const openOrders = customerRows.filter(orderIsOpen);
  const filtered = customerRows.filter(order => {
    const matchesStatus = filter === 'All' || (filter === 'Active' ? orderIsOpen(order) : order.status === filter);
    const query = search.trim().toLowerCase();
    return matchesStatus && (!dateFilter || order.due_date === dateFilter) && (!query || `${order.order_number} ${order.customer_name} ${order.customer_phone} ${order.address} ${order.items.map(line => line.name).join(' ')}`.toLowerCase().includes(query));
  }).sort((a, b) => {
    if (orderIsOpen(a) !== orderIsOpen(b)) return orderIsOpen(a) ? -1 : 1;
    return orderIsOpen(a) ? `${a.due_date} ${a.due_time}`.localeCompare(`${b.due_date} ${b.due_time}`) : b.created_at.localeCompare(a.created_at);
  });
  const detail = orders.find(order => order.id === detailId);

  const startEdit = (existing?: CustomerOrder) => {
    const customer = customers.find(row => row.id === customerFilter);
    setDraft(existing ? { ...existing, items: existing.items.map(line => ({ ...line })) } : {
      id: generateUUID(),
      order_number: generateInvoiceNumber('ORD-'),
      customer_id: customer?.id || '',
      fulfillment: 'Pickup',
      due_date: today,
      due_time: '',
      address: customer?.address || '',
      notes: '',
      discount: 0,
      advance_paid: 0,
      payment_mode: 'Cash',
      payment_notes: '',
      status: 'Pending',
      items: []
    });
    setEditor({ existing }); setDetailId(null); setFormError(''); setProductKey('');
  };
  const changeCustomer = (id: string) => {
    const customer = customers.find(row => row.id === id);
    setDraft(previous => ({ ...previous, customer_id: id, address: customer?.address || '' }));
  };
  const addProduct = () => {
    const product = catalog.find(row => row.key === productKey);
    if (!product) return;
    const customer = customers.find(row => row.id === draft.customer_id);
    const price = product.variant ? product.price : (customer?.custom_prices?.[product.item.id] ?? product.price);
    setDraft(previous => {
      const lines = [...(previous.items || [])];
      const index = lines.findIndex(line => line.itemId === product.item.id && line.variantId === product.variant?.id);
      if (index >= 0) lines[index] = { ...lines[index], qty: roundQuantity(lines[index].qty + 1) };
      else lines.push({ itemId: product.item.id, name: product.item.name, unit: product.variant?.name || product.item.unit, variantId: product.variant?.id, variantName: product.variant?.name, qty: 1, price });
      return { ...previous, items: lines };
    }); setProductKey('');
  };
  const updateLine = (index: number, patch: Partial<CustomerOrderLine>) => setDraft(previous => ({ ...previous, items: previous.items?.map((line, idx) => idx === index ? { ...line, ...patch } : line) }));
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (busyRef.current) return;
    if (editor?.existing ? !canEdit : !canCreate) return;
    busyRef.current = true; setBusy(true); setFormError('');
    try {
      if (!draft.customer_id) throw new Error('Select a customer for this order.');
      const customer = customers.find(row => row.id === draft.customer_id);
      if (!customer || customer.isActive === false) throw new Error('Select an active customer.');
      const lines = (draft.items || []).map(line => ({ ...line, qty: roundQuantity(line.qty), price: roundCurrency(line.price) }));
      if (!lines.length) throw new Error('Add at least one product to the order.');
      if (lines.some(line => !catalog.some(row => row.item.id === line.itemId && row.variant?.id === line.variantId))) throw new Error('An ordered product is inactive or unavailable. Replace it before saving.');
      const calculated = orderAmounts(lines, Number(draft.discount) || 0, Number(draft.advance_paid) || 0);
      const payload = {
        customer_id: customer.id,
        customer_name: customer.name,
        customer_phone: customer.phone || '',
        fulfillment: draft.fulfillment,
        due_date: draft.due_date,
        due_time: draft.due_time || '',
        address: draft.address?.trim() || '',
        notes: draft.notes?.trim() || '',
        status: draft.status,
        items: lines,
        advance_paid: calculated.advance_paid,
        payment_mode: calculated.advance_paid > 0 ? (draft.payment_mode || 'Cash') : 'Unpaid',
        payment_status: calculated.payment_status as CustomerOrderPaymentStatus,
        payment_notes: draft.payment_notes?.trim() || '',
        subtotal: calculated.subtotal,
        discount: calculated.discount,
        total: calculated.total
      };
      let saved = await saveCustomerOrder(editor?.existing ? payload : { ...payload, id: draft.id, order_number: draft.order_number, created_by: currentUser.id }, editor?.existing);
      // The advance is real money received now: post it to the customer khata and the receiving account.
      if (unpostedAdvance(saved) > 0) {
        try {
          saved = await postAdvance(saved);
        } catch (postErr: any) {
          const unposted = saved;
          setOrders(previous => [unposted, ...previous.filter(order => order.id !== unposted.id)]);
          setEditor({ existing: unposted });
          throw new Error(`Order save ho gaya, lekin advance khaate mein post nahi hua: ${postErr.message} Dobara Save dabayein.`);
        }
      }
      setOrders(previous => [saved, ...previous.filter(order => order.id !== saved.id)]); setEditor(null); setDetailId(saved.id); showToast(editor?.existing ? 'Customer order updated' : 'Customer order booked', 'success');
    } catch (err: any) { setFormError(err.message); }
    finally { busyRef.current = false; setBusy(false); }
  };
  // Cash advance goes into the open drawer (so the booking shift counts it), else the default cash
  // account. Online advance goes to the default digital account.
  const postAdvance = async (order: CustomerOrder) => {
    const online = order.payment_mode === 'Online';
    const drawerAccount = activeShiftSession?.status === 'Active' ? (activeShiftSession.account_id || activeShiftSession.drawer_id) : null;
    const accountId = online
      ? (settings.financial?.defaultDigitalAccountId || accounts.find(account => account.type === 'Bank' || account.type === 'Wallet')?.id)
      : (drawerAccount || settings.financial?.defaultCashAccountId || accounts.find(account => account.type === 'Cash')?.id);
    if (!accountId) throw new Error(online ? 'Koi Bank/Wallet account nahi mila.' : 'Koi Cash account nahi mila.');
    const inShift = !online && !!drawerAccount;
    const posted = await postCustomerOrderAdvance(order, {
      // One id per advance level, so a retry after a lost response never posts the same money twice.
      tx_id: `ctx_adv_${order.id}_${Math.round(Number(order.advance_paid || 0) * 100)}`,
      account_id: accountId,
      business_day_id: inShift ? activeShiftSession?.business_day_id : null,
      shift_session_id: inShift ? activeShiftSession?.id : null,
      drawer_id: inShift ? activeShiftSession?.drawer_id : null,
      cashier_id: currentUser?.id || null
    });
    void retryLoading().catch(() => {});
    return posted;
  };
  const updateStatus = async (order: CustomerOrder, status: CustomerOrderStatus) => {
    if (busyRef.current || (status === 'Cancelled' ? !canCancel : !canEdit)) return;
    const postedAdvance = Number(order.advance_posted || 0);
    const cancelNote = postedAdvance > 0
      ? `Advance ${money(postedAdvance)} customer ke khaate mein credit rahega. Wapas karna ho to customer khaate se refund karein.`
      : 'Is order ka koi stock ya payment post nahi hua.';
    if (status === 'Cancelled' && !(await confirmAction({
      tone: 'warning',
      title: `Order ${order.order_number} cancel karein?`,
      consequences: [cancelNote],
      confirmLabel: 'Haan, cancel karein',
    }))) return;
    busyRef.current = true; setBusy(true);
    try { const saved = await changeCustomerOrderStatus(order, status); setOrders(previous => previous.map(row => row.id === saved.id ? saved : row)); showToast(`Order ${status.toLowerCase()}`, 'success'); }
    catch (err: any) { showToast(err.message, 'error'); void refresh(); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const printOrder = (order: CustomerOrder) => {
    const popup = window.open('', '_blank', 'width=760,height=800');
    if (!popup) { showToast('Allow popups to print this order.', 'warning'); return; }
    const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
    const advance = Number(order.advance_paid || 0);
    const balance = Math.max(0, Number(order.total || 0) - advance);
    popup.document.write(`<!doctype html><html><head><title>${escape(order.order_number)}</title><style>body{font:14px Arial;color:#17202a;padding:32px}h1{font-size:24px}table{width:100%;border-collapse:collapse;margin:24px 0}td,th{text-align:left;padding:12px 6px;border-bottom:1px solid #ddd}.total{text-align:right;font-size:16px;line-height:1.6}.notes{white-space:pre-wrap}@media print{button{display:none}}</style></head><body><h1>${escape(settings.general.companyName || 'Mooco Dairy')}</h1><h2>Customer order · ${escape(order.order_number)}</h2><p>${escape(order.customer_name)} · ${escape(order.customer_phone)}</p><p>${escape(order.fulfillment)} · ${escape(prettyDate(order.due_date))} ${escape(order.due_time)} · ${escape(order.status)}</p><p>${escape(order.address)}</p><table><thead><tr><th>Product</th><th>Quantity</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${order.items.map(line => `<tr><td>${escape(line.name)} ${escape(line.variantName || '')}</td><td>${line.qty} ${escape(line.unit)}</td><td>${escape(money(line.price))}</td><td>${escape(money(roundCurrency(line.qty * line.price)))}</td></tr>`).join('')}</tbody></table><div class="total"><p>Subtotal: ${escape(money(order.subtotal))}<br>Discount: ${escape(money(order.discount))}<br><b>Total: ${escape(money(order.total))}</b></p>${advance > 0 ? `<p style="color:#059669"><b>Advance Paid (${escape(order.payment_mode || 'Cash')}): -${escape(money(advance))}</b>${order.payment_notes ? `<br><small style="color:#64748b">Ref: ${escape(order.payment_notes)}</small>` : ''}</p><p style="font-size:18px;color:#d97706"><b>Balance Due: ${escape(money(balance))}</b></p>` : `<p style="color:#64748b">Payment Status: Unpaid (Due on collection)</p>`}</div><p class="notes">${escape(order.notes)}</p><p>Booking summary. Final payment and stock posted through POS.</p><button onclick="window.print()">Print order</button></body></html>`);
    popup.document.close(); popup.focus(); popup.print();
  };

  return <div className="space-y-5 py-4 text-slate-900 dark:text-slate-100">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-lime-700 dark:text-lime-400"><ClipboardCheck size={15} /> Plan ahead. Serve on time.</div><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Customer Orders</h1><p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Book dairy products for pickup or delivery. Track every order through to billing.</p></div>
      <div className="flex gap-2"><button type="button" className={button} disabled={loading} onClick={() => void refresh()} aria-label="Refresh customer orders"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>{canCreate && <button type="button" className={primary} onClick={() => startEdit()}><Plus size={18} />New Order</button>}</div>
    </div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
      { label: 'Active orders', value: openOrders.length, icon: ClipboardCheck, caption: 'Pending, confirmed & ready' },
      { label: 'Due today', value: openOrders.filter(order => order.due_date === today).length, icon: CalendarDays, caption: 'Pickup & delivery' },
      { label: 'Ready to serve', value: openOrders.filter(order => order.status === 'Ready').length, icon: Package, caption: 'Finish billing in POS' },
      { label: 'Open order value', value: money(openOrders.reduce((sum, order) => sum + Number(order.total), 0)), icon: ShoppingBag, caption: 'Bookings awaiting billing' }
    ].map(stat => <div key={stat.label} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">{stat.label}<stat.icon size={17} className="text-lime-600" /></div><div className="my-2 break-words text-xl font-black sm:text-2xl">{loading && !orders.length ? '—' : stat.value}</div><p className="text-[11px] text-slate-400">{stat.caption}</p></div>)}</div>
    {error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"><AlertCircle size={18} /><span className="flex-1">{error}</span><button type="button" className={button} onClick={() => void refresh()}>Try again</button></div>}
    <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="space-y-3 border-b border-slate-200 p-4 dark:border-slate-800">
        <div className="flex flex-wrap gap-3"><div className="relative min-w-[190px] flex-1"><Search size={17} className="absolute left-3 top-3 text-slate-400" /><input aria-label="Search customer orders" className={`${input} pl-10`} placeholder="Search order, customer, phone or product…" value={search} onChange={e => setSearch(e.target.value)} /></div><input type="date" aria-label="Filter by due date" className={`${input} !w-auto max-w-full`} value={dateFilter} onChange={e => setDateFilter(e.target.value)} />{dateFilter && <button type="button" className={button} onClick={() => setDateFilter('')}>Clear date</button>}</div>
        <div className="flex flex-wrap items-center gap-2">{['Active', 'All', 'Pending', 'Confirmed', 'Ready', 'Completed', 'Cancelled'].map(status => <button type="button" key={status} aria-pressed={filter === status} onClick={() => setFilter(status)} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${filter === status ? 'bg-slate-900 text-white dark:bg-lime-400 dark:text-slate-950' : 'bg-slate-50 text-slate-500 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}`}>{status}</button>)}<span className="ml-auto text-xs text-slate-400">{filtered.length} orders</span></div>
        {customerFilter && <div className="flex items-center gap-2 text-xs text-lime-700 dark:text-lime-300">Showing orders for {customers.find(row => row.id === customerFilter)?.name || 'selected customer'}<button type="button" className="underline" onClick={() => { setCustomerFilter(''); openTab('/customer-orders'); }}>Show all customers</button></div>}
      </div>
      {loading && !orders.length ? <div role="status" className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500"><Loader2 size={20} className="animate-spin" />Loading orders…</div> : filtered.length === 0 ? <div className="p-10 text-center"><div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-lime-50 text-lime-600 dark:bg-lime-950/40"><ClipboardCheck size={26} /></div><h2 className="font-bold">{orders.length ? 'No matching orders' : 'Your next order starts here'}</h2><p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">{orders.length ? 'Try another search, date or status filter.' : 'Book a customer’s products, choose pickup or delivery, and keep preparation on track.'}</p>{canCreate && !orders.length && <button type="button" className={`${primary} mt-5`} onClick={() => startEdit()}><Plus size={16} />Book first order</button>}</div> : <div className="divide-y divide-slate-100 dark:divide-slate-800">{filtered.map(order => <button type="button" key={order.id} onClick={() => setDetailId(order.id)} className="grid w-full grid-cols-1 gap-3 px-4 py-5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40 sm:grid-cols-[1.3fr_1fr_1fr_auto] sm:items-center sm:px-5">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-slate-500">{order.order_number}</span><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${statusStyles[order.status]}`}>{order.status}</span>{Number(order.advance_paid || 0) > 0 && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold font-mono ${Number(order.advance_paid || 0) >= Number(order.total || 0) ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-300'}`}>Adv: {money(Number(order.advance_paid))}</span>}</div><p className="mt-2 truncate font-bold">{order.customer_name}</p><p className="mt-1 truncate text-xs text-slate-400">{order.items.map(line => `${line.qty} ${line.unit} ${line.name}`).join(' · ')}</p></div>
        <div className="text-xs"><div className="flex items-center gap-1.5 font-semibold"><CalendarDays size={14} />{prettyDate(order.due_date)}{order.due_time && ` · ${order.due_time.slice(0, 5)}`}</div><p className="mt-1.5 flex items-center gap-1.5 text-slate-400">{order.fulfillment === 'Delivery' ? <Truck size={14} /> : <ShoppingBag size={14} />}{order.fulfillment}{orderIsOpen(order) && order.due_date < today && <span className="font-bold text-rose-500">· Overdue</span>}</p></div>
        <div className="text-sm font-black sm:text-right">{money(order.total)}{Number(order.advance_paid || 0) > 0 && Number(order.advance_paid || 0) < Number(order.total || 0) && <p className="mt-0.5 text-[11px] font-bold font-mono text-amber-600 dark:text-amber-400">Bal: {money(Math.max(0, Number(order.total) - Number(order.advance_paid)))}</p>}<p className="mt-1 text-[11px] font-normal text-slate-400">{order.items.length} product{order.items.length !== 1 ? 's' : ''}</p></div><ArrowRight size={17} className="hidden text-slate-400 sm:block" />
      </button>)}</div>}
    </div>
    <p className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400"><CheckCircle2 size={15} className="shrink-0 text-lime-600" />Orders are bookings. Stock, payment and customer khata update together when you complete billing in POS. Internet is required for orders.</p>

    {editor && <OrderDialog title={editor.existing ? `Edit ${editor.existing.order_number}` : 'New Customer Order'} busy={busy} onClose={() => setEditor(null)}><form onSubmit={save} className="space-y-5">
      <fieldset disabled={busy} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 relative z-30">
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
              <User size={14} className="text-lime-600 dark:text-lime-400" />
              Customer <span className="text-rose-500">*</span>
            </span>
            <RichSelect
              options={customerOptions}
              value={draft.customer_id || ''}
              onChange={changeCustomer}
              placeholder="Choose a customer..."
              searchPlaceholder="Search customer by name, phone or khata..."
              required
              enableSearch
              emptyText="No customer found"
              buttonClassName="!rounded-xl !py-2.5 !px-3.5 font-semibold text-sm dark:!bg-slate-900 shadow-sm"
            />
          </div>
          <div className="space-y-1.5 relative z-20">
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
              {draft.fulfillment === 'Delivery' ? <Truck size={14} className="text-lime-600 dark:text-lime-400" /> : <ShoppingBag size={14} className="text-lime-600 dark:text-lime-400" />}
              Fulfillment
            </span>
            <RichSelect
              options={fulfillmentOptions}
              value={draft.fulfillment || 'Pickup'}
              onChange={val => setDraft(previous => ({ ...previous, fulfillment: (val as 'Pickup' | 'Delivery') || 'Pickup' }))}
              placeholder="Select fulfillment"
              allowClear={false}
              enableSearch={false}
              buttonClassName="!rounded-xl !py-2.5 !px-3.5 font-semibold text-sm dark:!bg-slate-900 shadow-sm"
            />
          </div>
          <label className="block space-y-1.5">
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
              <CalendarDays size={14} className="text-lime-600 dark:text-lime-400" />
              Due date <span className="text-rose-500">*</span>
            </span>
            <input required type="date" className={input} value={draft.due_date} onChange={e => setDraft(previous => ({ ...previous, due_date: e.target.value }))} />
          </label>
          <label className="block space-y-1.5">
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
              <Clock size={14} className="text-lime-600 dark:text-lime-400" />
              Time (optional)
            </span>
            <input type="time" className={input} value={draft.due_time} onChange={e => setDraft(previous => ({ ...previous, due_time: e.target.value }))} />
          </label>
        </div>
        {hasPermission('customers') && (
          <div className="-mt-1 flex items-center gap-1.5 text-xs">
            <span className="text-slate-400">Need a new customer?</span>
            <button type="button" className="inline-flex items-center gap-1 font-bold text-lime-600 hover:text-lime-700 dark:text-lime-400 dark:hover:text-lime-300 hover:underline" onClick={() => openTab('/customers')}>
              Manage / add customers <ArrowRight size={12} />
            </button>
          </div>
        )}
        {draft.fulfillment === 'Delivery' && (
          <label className="block space-y-1.5">
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
              <MapPin size={14} className="text-lime-600 dark:text-lime-400" />
              Delivery address <span className="text-rose-500">*</span>
            </span>
            <textarea required rows={2} className={`${input} resize-none`} placeholder="Enter delivery address, area, or landmark…" value={draft.address} onChange={e => setDraft(previous => ({ ...previous, address: e.target.value }))} />
          </label>
        )}
        <div className="rounded-2xl border border-slate-200/90 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/40 relative z-10">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-lime-100 text-lime-700 dark:bg-lime-950/80 dark:text-lime-400">
                <Package size={15} />
              </div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Order Products</h3>
            </div>
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {(draft.items || []).length} {draft.items?.length === 1 ? 'item' : 'items'}
            </span>
          </div>
          <div className="flex gap-2.5 items-center">
            <div className="relative min-w-0 flex-1">
              <RichSelect
                options={productOptions}
                value={productKey}
                onChange={setProductKey}
                placeholder="Choose a product or pack..."
                searchPlaceholder="Search product by name or pack..."
                enableSearch={true}
                allowClear={true}
                emptyText="No products found"
                buttonClassName="!rounded-xl !py-2.5 !px-3.5 font-semibold text-sm dark:!bg-slate-900 shadow-sm"
              />
            </div>
            <button type="button" aria-label="Add product to order" className={`${primary} !h-[44px] px-4 shrink-0`} disabled={!productKey} onClick={addProduct}>
              <Plus size={18} /><span className="hidden sm:inline text-xs font-bold">Add</span>
            </button>
          </div>
          <div className="mt-3.5 space-y-3">
            {(draft.items || []).map((line, index) => {
              const stock = inventory.find(row => row.item_id === line.itemId);
              const product = items.find(row => row.id === line.itemId);
              const variant = line.variantId ? product?.variants?.find(row => row.id === line.variantId) : undefined;
              const available = availableSellUnits(Number(stock?.quantity) || 0, Number(stock?.variant_stocks?.[line.variantId || ''] || 0), variant);
              return <div key={`${line.itemId}-${line.variantId || 'base'}`} className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{line.name}</p>
                      {line.variantName && <span className="rounded-md border border-lime-200 bg-lime-50 px-2 py-0.5 text-[11px] font-bold text-lime-700 dark:border-lime-800 dark:bg-lime-950/60 dark:text-lime-300">{line.variantName}</span>}
                    </div>
                    <p className={`mt-1 flex items-center gap-1.5 text-[11px] font-medium ${line.qty > available ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'}`}>
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${line.qty > available ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                      {formatQty(available, 3)} {line.unit} available now{variant?.deduct_from_base ? ` · ${oneUnitLabel(variant.name, sellUnitContains(variant), product?.unit || line.unit)}` : ''}{line.qty > available ? ' · Prepare stock before billing' : ''}
                    </p>
                  </div>
                  <button type="button" className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400" aria-label={`Remove ${line.name}`} onClick={() => setDraft(previous => ({ ...previous, items: previous.items?.filter((_, idx) => idx !== index) }))}>
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-12 gap-3 items-end border-t border-slate-100 pt-2.5 dark:border-slate-800">
                  <div className="col-span-4">
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">Qty ({line.unit})</label>
                    <input required type="number" step={line.variantId ? '1' : '0.001'} min={line.variantId ? '1' : '0.001'} aria-label={`Quantity for ${line.name}`} className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm font-bold text-slate-900 shadow-inner outline-none transition-all focus:border-lime-500 focus:bg-white focus:ring-2 focus:ring-lime-500/20 dark:border-slate-700 dark:bg-slate-800/70 dark:text-white dark:focus:bg-slate-900 font-mono" value={Number.isNaN(line.qty) ? '' : line.qty} onChange={e => updateLine(index, { qty: e.target.value === '' ? NaN : Number(e.target.value) })} />
                  </div>
                  <div className="col-span-4">
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">Rate (Rs)</label>
                    <input required type="number" min="0" step="0.01" aria-label={`Rate for ${line.name}`} className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm font-bold text-slate-900 shadow-inner outline-none transition-all focus:border-lime-500 focus:bg-white focus:ring-2 focus:ring-lime-500/20 dark:border-slate-700 dark:bg-slate-800/70 dark:text-white dark:focus:bg-slate-900 font-mono" value={Number.isNaN(line.price) ? '' : line.price} onChange={e => updateLine(index, { price: e.target.value === '' ? NaN : Number(e.target.value) })} />
                  </div>
                  <div className="col-span-4 text-right">
                    <span className="block text-[10.5px] font-bold uppercase tracking-wider text-slate-400 mb-1">Line total</span>
                    <span className="text-base font-black font-mono text-slate-900 dark:text-slate-100">{money(roundCurrency(line.qty * line.price))}</span>
                  </div>
                </div>
              </div>;
            })}
          </div>
          {!draft.items?.length && (
            <div className="mt-3.5 rounded-xl border border-dashed border-slate-200/90 bg-white/60 py-6 text-center dark:border-slate-800 dark:bg-slate-900/30">
              <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                <ShoppingBag size={18} />
              </div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">No products added yet</p>
              <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">Select dairy products from the dropdown above to build this booking.</p>
            </div>
          )}
        </div>
        {/* Advanced Payment */}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
              <Banknote size={14} className="text-lime-600 dark:text-lime-400" />
              Advanced Payment
            </span>
            <input
              type="number"
              min="0"
              max={amounts.total || undefined}
              step="0.01"
              placeholder="0.00"
              className={input}
              value={draft.advance_paid === 0 ? '' : draft.advance_paid}
              onChange={e => {
                const val = e.target.value === '' ? 0 : Number(e.target.value);
                setDraft(prev => ({ ...prev, advance_paid: val }));
              }}
            />
          </label>
          <div className="space-y-1.5 relative z-10">
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
              <CreditCard size={14} className="text-lime-600 dark:text-lime-400" />
              Payment Mode
            </span>
            <RichSelect
              options={paymentModeOptions}
              value={draft.payment_mode || 'Cash'}
              onChange={val => setDraft(prev => ({ ...prev, payment_mode: (val as any) || 'Cash' }))}
              placeholder="Select payment mode"
              allowClear={false}
              enableSearch={false}
              buttonClassName="!rounded-xl !py-2.5 !px-3.5 font-semibold text-sm dark:!bg-slate-900 shadow-sm"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col space-y-1.5">
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
              <ClipboardCheck size={14} className="text-lime-600 dark:text-lime-400" />
              Notes / instructions
            </span>
            <textarea rows={3} className={`${input} flex-1 resize-none`} placeholder="Packing, delivery or preparation instructions…" value={draft.notes} onChange={e => setDraft(previous => ({ ...previous, notes: e.target.value }))} />
          </label>
          <div className="space-y-2.5 rounded-2xl border border-slate-200/90 bg-gradient-to-br from-slate-50/80 to-slate-100/60 p-4 shadow-sm dark:border-slate-800 dark:from-slate-900/90 dark:to-slate-950/80">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
              <span>Subtotal</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{money(amounts.subtotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-slate-200/60 pt-2 dark:border-slate-800">
              <label htmlFor="order-discount-input" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Discount ({settings.general.currencySymbol || 'Rs'})
              </label>
              <input id="order-discount-input" type="number" min="0" max={amounts.subtotal} step="0.01" className="w-28 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-right font-mono text-sm font-bold text-slate-900 shadow-sm outline-none transition-all focus:border-lime-500 focus:ring-2 focus:ring-lime-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white" value={draft.discount} onChange={e => setDraft(previous => ({ ...previous, discount: e.target.value === '' ? 0 : Number(e.target.value) }))} />
            </div>
            <div className="flex items-center justify-between border-t-2 border-slate-200 pt-2.5 dark:border-slate-700">
              <span className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">Order Total</span>
              <span className="font-mono text-lg font-black text-slate-900 dark:text-white">{money(amounts.total)}</span>
            </div>
            {amounts.advance_paid > 0 && (
              <div className="flex items-center justify-between border-t border-slate-200/80 pt-2 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                <span className="flex items-center gap-1.5"><Banknote size={14} /> Advanced Payment</span>
                <span className="font-mono font-black text-sm">-{money(amounts.advance_paid)}</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t-2 border-slate-200/80 pt-2.5 dark:border-slate-700">
              <span className="text-sm font-black text-slate-900 dark:text-white">Balance Due</span>
              <span className={`font-mono text-xl font-black ${amounts.remaining > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {money(amounts.remaining)}
              </span>
            </div>
          </div>
        </div>
      </fieldset>
      {formError && (
        <div role="alert" className="flex items-center gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertCircle size={18} className="shrink-0 text-rose-600" />
          <span>{formError}</span>
        </div>
      )}
      <div className="flex justify-end gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
        <button type="button" className={button} disabled={busy} onClick={() => setEditor(null)}>Cancel</button>
        <button type="submit" disabled={busy} className={primary}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <ClipboardCheck size={16} />}
          {busy ? 'Saving…' : editor.existing ? 'Save changes' : 'Book order'}
        </button>
      </div>
    </form></OrderDialog>}

    {detail && <OrderDialog title={detail.order_number} busy={busy} onClose={() => setDetailId(null)}><div className="space-y-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-black">{detail.customer_name}</h3><p className="mt-2 flex items-center gap-2 text-sm text-slate-500"><Phone size={14} />{detail.customer_phone || 'No phone saved'}</p></div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-3 py-1.5 text-xs font-bold ${statusStyles[detail.status]}`}>{detail.status}</span><span className={`rounded-full px-3 py-1.5 text-xs font-bold font-mono ${Number(detail.advance_paid || 0) >= Number(detail.total || 0) && Number(detail.total || 0) > 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : Number(detail.advance_paid || 0) > 0 ? 'bg-lime-50 text-lime-700 dark:bg-lime-950/40 dark:text-lime-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>{Number(detail.advance_paid || 0) >= Number(detail.total || 0) && Number(detail.total || 0) > 0 ? 'Fully Paid' : Number(detail.advance_paid || 0) > 0 ? `Adv: ${money(Number(detail.advance_paid))}` : 'Unpaid'}</span></div></div><div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-900 sm:grid-cols-2"><p className="flex items-center gap-2"><CalendarDays size={16} />{prettyDate(detail.due_date)} {detail.due_time.slice(0, 5)}</p><p className="flex items-center gap-2"><Truck size={16} />{detail.fulfillment}</p>{detail.fulfillment === 'Delivery' && <p className="flex items-start gap-2 sm:col-span-2"><MapPin size={16} className="shrink-0" />{detail.address}</p>}</div><div className="divide-y divide-slate-100 dark:divide-slate-800">{detail.items.map((line, index) => <div key={index} className="flex items-center justify-between gap-3 py-3"><div><p className="text-sm font-bold">{line.name}{line.variantName && ` · ${line.variantName}`}</p><p className="mt-1 text-xs text-slate-500">{line.qty} {line.unit} × {money(line.price)}</p></div><span className="text-sm font-bold">{money(roundCurrency(line.qty * line.price))}</span></div>)}</div><div className="space-y-2 rounded-xl bg-lime-50 p-4 dark:bg-lime-950/30"><p className="flex justify-between text-xs text-slate-500"><span>Subtotal</span><span>{money(detail.subtotal)}</span></p><p className="flex justify-between text-xs text-slate-500"><span>Discount</span><span>{money(detail.discount)}</span></p><p className="flex justify-between border-t border-lime-200/60 pt-2 text-sm font-bold text-slate-900 dark:text-white"><span>Order Total</span><span>{money(detail.total)}</span></p>{Number(detail.advance_paid || 0) > 0 && <p className="flex justify-between text-xs font-bold text-emerald-700 dark:text-emerald-400"><span>Advance Paid ({detail.payment_mode || 'Cash'}){detail.payment_notes ? ` · ${detail.payment_notes}` : ''}</span><span className="font-mono">-{money(Number(detail.advance_paid))}</span></p>}<p className="flex justify-between border-t-2 border-lime-200 pt-2 text-lg font-black text-slate-900 dark:text-white"><span>Balance Payable</span><span className="font-mono text-lime-700 dark:text-lime-400">{money(Math.max(0, Number(detail.total) - Number(detail.advance_paid || 0)))}</span></p></div>{detail.notes && <div><h4 className="text-xs font-bold text-slate-400">INSTRUCTIONS</h4><p className="mt-2 whitespace-pre-wrap text-sm">{detail.notes}</p></div>}<p className="flex items-center gap-2 text-[11px] text-slate-400"><Clock size={13} />Booked {new Date(detail.created_at).toLocaleString('en-PK')}</p><div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4 dark:border-slate-800"><button type="button" className={button} onClick={() => printOrder(detail)}><Printer size={15} />Print</button>{hasPermission('customers') && <button type="button" className={button} onClick={() => { setDetailId(null); openTab(`/customers?id=${encodeURIComponent(detail.customer_id)}`); }}>Customer khata</button>}{orderIsOpen(detail) && <>{canEdit && <button type="button" className={button} disabled={busy} onClick={() => startEdit(detail)}><Pencil size={15} />Edit</button>}{canCancel && <button type="button" className={`${button} !text-rose-600`} disabled={busy} onClick={() => void updateStatus(detail, 'Cancelled')}>Cancel order</button>}{canEdit && detail.status === 'Pending' && <button type="button" className={primary} disabled={busy} onClick={() => void updateStatus(detail, 'Confirmed')}>Confirm order<ArrowRight size={15} /></button>}{canEdit && detail.status === 'Confirmed' && <button type="button" className={primary} disabled={busy} onClick={() => void updateStatus(detail, 'Ready')}><Package size={15} />Mark ready</button>}{['Confirmed', 'Ready'].includes(detail.status) && canPerform('pos', 'create') && <button type="button" className={primary} onClick={() => { setDetailId(null); openTab(`/pos?order=${encodeURIComponent(detail.id)}`); }}>Bill in POS<ArrowRight size={15} /></button>}</>}{detail.sale_id && hasPermission('sales_history') && <button type="button" className={primary} onClick={() => { setDetailId(null); openTab(`/sales-history?id=${encodeURIComponent(detail.sale_id!)}`); }}>View invoice<ArrowRight size={15} /></button>}</div></div></OrderDialog>}
  </div>;
};
export default CustomerOrders;
