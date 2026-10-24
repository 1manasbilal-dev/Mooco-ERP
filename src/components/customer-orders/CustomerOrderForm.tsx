import React, { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AlertCircle, ArrowRight, Banknote, ClipboardCheck, Package, Plus, ShoppingBag, Trash2, User, WifiOff } from 'lucide-react';
import { useDairy } from '../../context/DairyContext';
import { useTabs } from '../../context/TabContext';
import { CustomerOrder, CustomerOrderLine, CustomerOrderPaymentStatus, ItemDefinition } from '../../types';
import { generateInvoiceNumber, generateUUID, roundCurrency, roundQuantity } from '../../lib/db';
import { localOrderDate, orderAmounts, postCustomerOrderAdvance, saveCustomerOrder, unpostedAdvance } from '../../lib/customerOrders';
import { availableSellUnits, oneUnitLabel, sellUnitContains, sellUnitPrice } from '../../lib/sellUnits';
import { orderPileLines, pileShortages, shortageText, sumByPile } from '../pos/posStock';
import { formatCurrency, formatQty } from '../../lib/formatters';
import { cn } from '../../lib/cn';
import { RichSelect, RichSelectOption } from '../RichSelect';
import { Badge, Button, Card, Field, IconButton, Input, Money, Select, Textarea } from '../ui';
import { OrderDialog } from './OrderDialog';
import { orderMoney } from './orderUi';

const FORM_ID = 'customer-order-form';
const RICH_SELECT_BUTTON = '!min-h-10 !rounded-control !px-3 text-sm font-semibold';

const subscribeOnline = (callback: () => void) => {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
};

function FieldCaption({ icon, children, required }: { icon: React.ReactNode; children: React.ReactNode; required?: boolean }) {
  return (
    <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-fg-muted [&_svg]:size-3.5 [&_svg]:text-fg-subtle">
      {icon}
      {children}
      {required && <span className="text-danger" aria-hidden="true">*</span>}
    </span>
  );
}

export interface CustomerOrderFormProps {
  /** The order being edited; undefined books a new one. */
  existing?: CustomerOrder;
  /** Customer pre-selected for a new order (the page's customer filter). */
  presetCustomerId?: string;
  onClose: () => void;
  onSaved: (order: CustomerOrder, wasEdit: boolean) => void;
  /** The order was saved but its advance could not be posted yet; the form stays open to retry. */
  onUnposted: (order: CustomerOrder) => void;
}

/** Booking form for a customer order. Lazy-loaded by the Customer Orders page. */
export default function CustomerOrderForm({ existing, presetCustomerId = '', onClose, onSaved, onUnposted }: CustomerOrderFormProps) {
  const { customers, items, inventory, settings, accounts, activeShiftSession, currentUser, hasPermission, canPerform, retryLoading } = useDairy();
  const { openTab } = useTabs();
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const canCreate = canPerform('customer_orders', 'create');
  const canEdit = canPerform('customer_orders', 'edit');

  const [draft, setDraft] = useState<Partial<CustomerOrder>>(() => {
    if (existing) return { ...existing, items: existing.items.map(line => ({ ...line })) };
    const customer = presetCustomerId ? customers.find(row => row.id === presetCustomerId) : undefined;
    return {
      id: generateUUID(),
      order_number: generateInvoiceNumber('ORD-'),
      customer_id: customer?.id || '',
      fulfillment: 'Pickup',
      due_date: localOrderDate(),
      due_time: '',
      address: customer?.address || '',
      notes: '',
      discount: 0,
      advance_paid: 0,
      payment_mode: 'Cash',
      payment_notes: '',
      status: 'Pending',
      items: []
    };
  });
  const [productKey, setProductKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const busyRef = useRef(false);

  const catalog = useMemo(() => items.filter(item => item.isActive && item.item_type?.includes('Sale product') && !item.item_type.includes('Packaging material')).flatMap(item => [
    ...(item.allow_loose_sale !== false ? [{ key: `${item.id}|base`, item, variant: undefined, label: `${item.name} · ${item.unit}`, price: item.selling_price }] : []),
    // A variant saved without the flag is active, as checkout_customer_order reads it.
    ...(item.variants || []).filter(variant => variant.isActive !== false).map(variant =>({ key: `${item.id}|${variant.id}`, item, variant, label: `${item.name} · ${oneUnitLabel(variant.name, sellUnitContains(variant), item.unit)}`, price: sellUnitPrice(item.selling_price, sellUnitContains(variant), variant.selling_price) }))
  ]), [items]);

  // One lookup table instead of a scan of the whole inventory for every product and line.
  const stockByItem = useMemo(() => {
    const map = new Map<string, (typeof inventory)[number]>();
    inventory.forEach(row => { if (!map.has(row.item_id)) map.set(row.item_id, row); });
    return map;
  }, [inventory]);
  const itemById = useMemo(() => new Map<string, ItemDefinition>(items.map(item => [item.id, item])), [items]);
  // Loose pile and pack counts; the catalog row's copy stands in when a product has no inventory row yet.
  const stockOf = useCallback((itemId: string) => {
    const row = stockByItem.get(itemId);
    const item = itemById.get(itemId);
    return { loose: Number(row ? row.quantity : item?.stock) || 0, packs: (row ? row.variant_stocks : item?.variant_stocks) || {} };
  }, [stockByItem, itemById]);

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
          avatarBg: 'bg-brand-soft text-brand-fg ring-1 ring-inset ring-brand/20',
          badge,
          disabled: !customer.isActive && customer.id !== draft.customer_id
        };
      });
  }, [customers, draft.customer_id]);

  const productOptions: RichSelectOption[] = useMemo(() => {
    const customer = customers.find(c => c.id === draft.customer_id);
    return catalog.map(row => {
      const stock = stockOf(row.item.id);
      const available = availableSellUnits(stock.loose, Number(stock.packs[row.variant?.id || ''] || 0), row.variant);
      const price = row.variant ? row.price : (customer?.custom_prices?.[row.item.id] ?? row.price);
      const isOutOfStock = available <= 0;

      return {
        value: row.key,
        label: row.item.name,
        subLabel: `${row.variant ? oneUnitLabel(row.variant.name, sellUnitContains(row.variant), row.item.unit) : `1 ${row.item.unit}`} · ${formatQty(available, 3)} ready`,
        icon: <Package size={16} className={isOutOfStock ? 'text-warning-fg' : 'text-brand-fg'} />,
        badge: {
          text: orderMoney(price),
          variant: isOutOfStock ? 'amber' : 'green'
        }
      };
    });
  }, [catalog, stockOf, customers, draft.customer_id]);

  const amounts = orderAmounts(draft.items || [], Number(draft.discount) || 0, Number(draft.advance_paid) || 0);
  // orderAmounts quietly caps the advance at the order total. Money must never change silently, so an
  // advance above the total, or below what is already posted to the customer ledger, is shown and blocks saving.
  const typedAdvance = roundCurrency(Number(draft.advance_paid) || 0);
  const postedAdvance = existing ? roundCurrency(Number(existing.advance_posted || 0)) : 0;
  const advanceProblem = typedAdvance < 0
    ? "The advance can't be negative."
    : postedAdvance > 0 && amounts.total < postedAdvance
      ? `The order total is now ${formatCurrency(amounts.total)}, but an advance of ${formatCurrency(postedAdvance)} is already posted to the customer's ledger. The total can't go that low: fix the products or discount. The app can't refund extra advance yet.`
      : postedAdvance > 0 && typedAdvance < postedAdvance
        ? `An advance of ${formatCurrency(postedAdvance)} is already posted to the customer's ledger. The advance can't be less than that.`
        : typedAdvance > amounts.total
          ? `The advance ${formatCurrency(typedAdvance)} is more than the order total ${formatCurrency(amounts.total)}. Lower the advance or add products; the extra amount won't be reduced automatically.`
          : '';

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
  const removeLine = (index: number) => setDraft(previous => ({ ...previous, items: previous.items?.filter((_, idx) => idx !== index) }));

  // Cash advance goes into the open drawer (so the booking shift counts it), else the default cash
  // account. Online advance goes to the default digital account.
  const postAdvance = async (order: CustomerOrder) => {
    const isOnline = order.payment_mode === 'Online';
    const drawerAccount = activeShiftSession?.status === 'Active' ? (activeShiftSession.account_id || activeShiftSession.drawer_id) : null;
    const accountId = isOnline
      ? (settings.financial?.defaultDigitalAccountId || accounts.find(account => account.type === 'Bank' || account.type === 'Wallet')?.id)
      : (drawerAccount || settings.financial?.defaultCashAccountId || accounts.find(account => account.type === 'Cash')?.id);
    if (!accountId) throw new Error(isOnline ? 'No bank / wallet account found.' : 'No cash account found.');
    const inShift = !isOnline && !!drawerAccount;
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

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (busyRef.current) return;
    if (existing ? !canEdit : !canCreate) {
      // Used to return silently, which looked like a dead Save button.
      setFormError(existing ? "You don't have permission to edit orders." : "You don't have permission to book orders.");
      return;
    }
    busyRef.current = true; setBusy(true); setFormError('');
    try {
      if (!draft.customer_id) throw new Error('Select a customer for this order.');
      const customer = customers.find(row => row.id === draft.customer_id);
      if (!customer || customer.isActive === false) throw new Error('Select an active customer.');
      const lines = (draft.items || []).map(line => ({ ...line, qty: roundQuantity(line.qty), price: roundCurrency(line.price) }));
      if (!lines.length) throw new Error('Add at least one product to the order.');
      if (lines.some(line => !catalog.some(row => row.item.id === line.itemId && row.variant?.id === line.variantId))) throw new Error('An ordered product is inactive or unavailable. Replace it before saving.');
      if (advanceProblem) throw new Error(advanceProblem);
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
      let saved = await saveCustomerOrder(existing ? payload : { ...payload, id: draft.id, order_number: draft.order_number, created_by: currentUser.id }, existing);
      // The advance is real money received now: post it to the customer ledger and the receiving account.
      if (unpostedAdvance(saved) > 0) {
        try {
          saved = await postAdvance(saved);
        } catch (postErr: any) {
          onUnposted(saved);
          throw new Error(`The order was saved, but the advance couldn't be posted to the ledger: ${postErr.message} Press Save again.`);
        }
      }
      onSaved(saved, Boolean(existing));
    } catch (err: any) { setFormError(err.message); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const lines = draft.items || [];
  // Stock is judged per pile with every line added up, as checkout_customer_order does at billing:
  // 2 Dozen + 1 Dozen + 6 loose eggs all come out of the loose pile (42 eggs).
  const pileLines = orderPileLines(lines, id => itemById.get(id));
  const pileNeeds = sumByPile(pileLines);
  const shortages = pileShortages(pileLines, stockOf);

  return (
    <OrderDialog
      title={existing ? `Edit ${existing.order_number}` : 'New Customer Order'}
      description={existing ? existing.customer_name : 'Book products for pickup or delivery'}
      busy={busy}
      onClose={onClose}
      initialFocus="body"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button variant="secondary" size="lg" className="sm:h-10 sm:text-sm" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button type="submit" form={FORM_ID} size="lg" className="sm:h-10 sm:text-sm" loading={busy} leftIcon={<ClipboardCheck />}>
            {busy ? 'Saving…' : existing ? 'Save changes' : 'Book order'}
          </Button>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={save} className="space-y-5">
        <fieldset disabled={busy} className="min-w-0 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="relative z-30">
              <FieldCaption icon={<User />} required>Customer</FieldCaption>
              <RichSelect
                options={customerOptions}
                value={draft.customer_id || ''}
                onChange={changeCustomer}
                placeholder="Choose a customer..."
                searchPlaceholder="Search customer by name or phone..."
                required
                enableSearch
                emptyText="No customer found"
                buttonClassName={RICH_SELECT_BUTTON}
              />
            </div>
            <Field label="Fulfillment" hint={draft.fulfillment === 'Delivery' ? 'Delivered directly to customer address' : 'Customer collects items from shop / farm'}>
              {control => (
                <Select
                  {...control}
                  value={draft.fulfillment || 'Pickup'}
                  onChange={event => setDraft(previous => ({ ...previous, fulfillment: (event.target.value as 'Pickup' | 'Delivery') || 'Pickup' }))}
                >
                  <option value="Pickup">Pickup (Takeaway)</option>
                  <option value="Delivery">Delivery (Home / Site)</option>
                </Select>
              )}
            </Field>
            <Field label="Due date" required>
              {control => (
                <Input {...control} required type="date" value={draft.due_date} onChange={event => setDraft(previous => ({ ...previous, due_date: event.target.value }))} />
              )}
            </Field>
            <Field label="Time (optional)">
              {control => (
                <Input {...control} type="time" value={draft.due_time} onChange={event => setDraft(previous => ({ ...previous, due_time: event.target.value }))} />
              )}
            </Field>
          </div>

          {hasPermission('customers') && (
            <div className="-mt-1 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-fg-subtle">Need a new customer?</span>
              <button type="button" className="inline-flex cursor-pointer items-center gap-1 rounded font-semibold text-brand-fg hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => openTab('/customers')}>
                Manage / add customers <ArrowRight size={12} />
              </button>
            </div>
          )}

          {draft.fulfillment === 'Delivery' && (
            <Field label="Delivery address" required>
              {control => (
                <Textarea {...control} required rows={2} className="min-h-0 resize-none" placeholder="Enter delivery address, area, or landmark…" value={draft.address} onChange={event => setDraft(previous => ({ ...previous, address: event.target.value }))} />
              )}
            </Field>
          )}

          <Card variant="inset" className="relative z-10 p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-brand-soft text-brand-fg" aria-hidden="true">
                  <Package size={16} />
                </span>
                <h3 className="text-[15px] font-bold text-fg">Order Products</h3>
              </div>
              <span className="text-xs font-semibold tabular-nums text-fg-subtle">
                {lines.length} {lines.length === 1 ? 'item' : 'items'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <RichSelect
                  options={productOptions}
                  value={productKey}
                  onChange={setProductKey}
                  placeholder="Choose a product or pack..."
                  searchPlaceholder="Search product by name or pack..."
                  enableSearch
                  allowClear
                  emptyText="No products found"
                  buttonClassName={RICH_SELECT_BUTTON}
                />
              </div>
              <Button variant="soft" aria-label="Add product to order" leftIcon={<Plus />} className="shrink-0 px-3 sm:px-4" disabled={!productKey} onClick={addProduct}>
                <span className="hidden sm:inline">Add</span>
              </Button>
            </div>

            {shortages.length > 0 && (
              <div role="status" className="mt-3 flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2 text-xs font-semibold text-warning-fg ring-1 ring-inset ring-warning/25">
                <AlertCircle size={14} className="mt-px shrink-0" aria-hidden="true" />
                <span>
                  Not enough stock right now — {shortages.map(row => shortageText(row, itemById.get(row.itemId))).join('; ')}.
                  {' '}The order will be booked, but get the stock ready before billing.
                </span>
              </div>
            )}

            {lines.length > 0 ? (
              <ul className="mt-3 space-y-2.5">
                {lines.map((line, index) => {
                  const stock = stockOf(line.itemId);
                  const product = itemById.get(line.itemId);
                  const variant = line.variantId ? product?.variants?.find(row => row.id === line.variantId) : undefined;
                  const available = availableSellUnits(stock.loose, Number(stock.packs[line.variantId || ''] || 0), variant);
                  const pile = pileLines[index];
                  const pileId = pile.fromBase ? 'loose' : (pile.variantId || 'loose');
                  const pileNeed = pileNeeds.find(row => row.itemId === line.itemId && row.pileId === pileId);
                  const short = shortages.some(row => row.itemId === line.itemId && row.pileId === pileId);
                  const sharedNote = pileNeed && pileNeed.lines > 1
                    ? ` · ${pileNeed.lines} lines together: ${formatQty(pileNeed.need, 3)} ${pileId === 'loose' ? (product?.unit || '') : (variant?.name || line.unit)}`
                    : '';
                  return (
                    <li key={`${line.itemId}-${line.variantId || 'base'}`} className="rounded-control border border-line bg-surface p-3 shadow-e1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-bold text-fg">{line.name}</p>
                            {line.variantName && <Badge tone="brand">{line.variantName}</Badge>}
                          </div>
                          <p className={cn('mt-1 flex items-center gap-1.5 text-[11px] font-medium', short ? 'text-warning-fg' : 'text-fg-subtle')}>
                            <span className={cn('inline-block size-1.5 shrink-0 rounded-full', short ? 'bg-warning' : 'bg-success')} aria-hidden="true" />
                            {formatQty(available, 3)} {line.unit} available now{variant?.deduct_from_base ? ` · ${oneUnitLabel(variant.name, sellUnitContains(variant), product?.unit || line.unit)}` : ''}{sharedNote}{short ? ' · Prepare stock before billing' : ''}
                          </p>
                        </div>
                        <IconButton
                          aria-label={`Remove ${line.name}`}
                          icon={<Trash2 />}
                          className="-mr-1 -mt-1 shrink-0 text-fg-faint hover:bg-danger-soft hover:text-danger-fg"
                          onClick={() => removeLine(index)}
                        />
                      </div>
                      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-end gap-3 border-t border-line pt-3 sm:grid-cols-3">
                        <Field label={`Qty (${line.unit})`}>
                          {control => (
                            <Input
                              {...control}
                              required
                              type="number"
                              inputMode="decimal"
                              step={line.variantId ? '1' : '0.001'}
                              min={line.variantId ? '1' : '0.001'}
                              aria-label={`Quantity for ${line.name}`}
                              className="font-bold tabular-nums"
                              value={Number.isNaN(line.qty) ? '' : line.qty}
                              onChange={event => updateLine(index, { qty: event.target.value === '' ? NaN : Number(event.target.value) })}
                            />
                          )}
                        </Field>
                        <Field label="Rate (Rs)">
                          {control => (
                            <Input
                              {...control}
                              required
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="0.01"
                              aria-label={`Rate for ${line.name}`}
                              className="font-bold tabular-nums"
                              value={Number.isNaN(line.price) ? '' : line.price}
                              onChange={event => updateLine(index, { price: event.target.value === '' ? NaN : Number(event.target.value) })}
                            />
                          )}
                        </Field>
                        <div className="col-span-2 flex items-center justify-between sm:col-span-1 sm:block sm:text-right">
                          <span className="block text-[11px] font-semibold uppercase tracking-wider text-fg-subtle sm:mb-2">Line total</span>
                          <Money amount={roundCurrency(line.qty * line.price)} className="text-base font-bold text-fg" />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="mt-3 rounded-control border border-dashed border-line bg-surface/60 px-4 py-6 text-center">
                <span className="mx-auto mb-2 flex size-9 items-center justify-center rounded-control bg-surface-2 text-fg-faint" aria-hidden="true">
                  <ShoppingBag size={18} />
                </span>
                <p className="text-xs font-semibold text-fg-muted">No products added yet</p>
                <p className="mt-0.5 text-[11px] text-fg-subtle">Select dairy products from the dropdown above to build this booking.</p>
              </div>
            )}
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Advanced Payment"
              error={advanceProblem || undefined}
              hint={!advanceProblem && postedAdvance > 0 ? `${formatCurrency(postedAdvance)} already posted to the ledger.` : undefined}
            >
              {control => (
                <Input
                  {...control}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  suffix="Rs"
                  className="tabular-nums"
                  value={draft.advance_paid === 0 ? '' : draft.advance_paid}
                  onChange={event => {
                    const val = event.target.value === '' ? 0 : Number(event.target.value);
                    setDraft(previous => ({ ...previous, advance_paid: val }));
                  }}
                />
              )}
            </Field>
            <Field label="Payment Mode">
              {control => (
                <Select
                  {...control}
                  value={draft.payment_mode === 'Online' ? 'Online' : 'Cash'}
                  onChange={event => setDraft(previous => ({ ...previous, payment_mode: (event.target.value as any) || 'Cash' }))}
                >
                  <option value="Cash">Cash</option>
                  <option value="Online">Online / Bank</option>
                </Select>
              )}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Notes / instructions" className="flex flex-col">
              {control => (
                <Textarea {...control} rows={3} className="flex-1 resize-none" placeholder="Packing, delivery or preparation instructions…" value={draft.notes} onChange={event => setDraft(previous => ({ ...previous, notes: event.target.value }))} />
              )}
            </Field>
            <Card variant="inset" className="space-y-2.5 p-4">
              <div className="flex items-center justify-between text-xs font-semibold text-fg-subtle">
                <span>Subtotal</span>
                <Money amount={amounts.subtotal} className="font-bold text-fg-muted" />
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-line pt-2">
                <label htmlFor="order-discount-input" className="text-xs font-semibold text-fg-muted">
                  Discount (Rs)
                </label>
                <Input
                  id="order-discount-input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max={amounts.subtotal}
                  step="0.01"
                  className="w-32 text-right font-bold tabular-nums"
                  value={draft.discount}
                  onChange={event => setDraft(previous => ({ ...previous, discount: event.target.value === '' ? 0 : Number(event.target.value) }))}
                />
              </div>
              <div className="flex items-center justify-between border-t border-line-strong pt-2.5">
                <span className="text-xs font-bold uppercase tracking-wider text-fg">Order Total</span>
                <Money amount={amounts.total} className="text-lg font-bold text-fg" />
              </div>
              {typedAdvance > 0 && (
                <div className={cn('flex items-center justify-between border-t border-line pt-2 text-xs font-semibold', advanceProblem ? 'text-danger-fg' : 'text-success-fg')}>
                  <span className="flex items-center gap-1.5">
                    {advanceProblem ? <AlertCircle size={14} aria-hidden="true" /> : <Banknote size={14} aria-hidden="true" />} Advanced Payment
                  </span>
                  <Money amount={-typedAdvance} className="text-sm font-bold" />
                </div>
              )}
              <div className="flex items-center justify-between border-t border-line-strong pt-2.5">
                <span className="text-sm font-bold text-fg">Balance Due</span>
                <Money amount={amounts.remaining} className={cn('text-xl font-bold', amounts.remaining > 0 ? 'text-warning-fg' : 'text-success-fg')} />
              </div>
            </Card>
          </div>
        </fieldset>

        {!online && (
          <div role="status" className="flex items-center gap-2.5 rounded-control border border-warning/30 bg-warning-soft p-3 text-sm font-semibold text-warning-fg">
            <WifiOff size={18} className="shrink-0" aria-hidden="true" />
            <span>No internet. Saving an order needs the internet.</span>
          </div>
        )}
        {formError && (
          <div role="alert" className="flex items-center gap-2.5 rounded-control border border-danger/25 bg-danger-soft p-3 text-sm font-semibold text-danger-fg">
            <AlertCircle size={18} className="shrink-0" aria-hidden="true" />
            <span>{formError}</span>
          </div>
        )}
      </form>
    </OrderDialog>
  );
}
