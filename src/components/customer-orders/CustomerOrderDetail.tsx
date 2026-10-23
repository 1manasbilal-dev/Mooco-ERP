import React from 'react';
import { ArrowRight, CalendarDays, Clock, MapPin, Package, Pencil, Phone, Printer, ShoppingBag, Truck, Wallet, XCircle } from 'lucide-react';
import { useDairy } from '../../context/DairyContext';
import { useTabs } from '../../context/TabContext';
import { useToast } from '../../context/ToastContext';
import type { CustomerOrder, CustomerOrderStatus } from '../../types';
import { roundCurrency } from '../../lib/db';
import { orderIsOpen } from '../../lib/customerOrders';
import { cn } from '../../lib/cn';
import { Badge, Button, Card, IconButton, Money } from '../ui';
import { OrderDialog } from './OrderDialog';
import { STATUS_TONE, orderAdvance, orderBalance, orderMoney, prettyDate } from './orderUi';

export interface CustomerOrderDetailProps {
  order: CustomerOrder;
  /** A status change is in flight (owned by the page). */
  busy: boolean;
  onClose: () => void;
  onEdit: (order: CustomerOrder) => void;
  onStatus: (order: CustomerOrder, status: CustomerOrderStatus) => void;
}

/** Order summary with status actions. Lazy-loaded by the Customer Orders page. */
export default function CustomerOrderDetail({ order: detail, busy, onClose, onEdit, onStatus }: CustomerOrderDetailProps) {
  const { settings, hasPermission, canPerform } = useDairy();
  const { openTab } = useTabs();
  const { showToast } = useToast();
  const canEdit = canPerform('customer_orders', 'edit');
  const canCancel = canPerform('customer_orders', 'cancel');
  const canBill = canPerform('pos', 'create');
  const money = orderMoney;

  const printOrder = (order: CustomerOrder) => {
    const popup = window.open('', '_blank', 'width=760,height=800');
    if (!popup) { showToast('Allow popups to print this order.', 'warning'); return; }
    const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
    const advance = Number(order.advance_paid || 0);
    const balance = Math.max(0, Number(order.total || 0) - advance);
    popup.document.write(`<!doctype html><html><head><title>${escape(order.order_number)}</title><style>body{font:14px Arial;color:#17202a;padding:32px}h1{font-size:24px}table{width:100%;border-collapse:collapse;margin:24px 0}td,th{text-align:left;padding:12px 6px;border-bottom:1px solid #ddd}.total{text-align:right;font-size:16px;line-height:1.6}.notes{white-space:pre-wrap}@media print{button{display:none}}</style></head><body><h1>${escape(settings.general.companyName || 'Mooco Dairy')}</h1><h2>Customer order · ${escape(order.order_number)}</h2><p>${escape(order.customer_name)} · ${escape(order.customer_phone)}</p><p>${escape(order.fulfillment)} · ${escape(prettyDate(order.due_date))} ${escape(order.due_time)} · ${escape(order.status)}</p><p>${escape(order.address)}</p><table><thead><tr><th>Product</th><th>Quantity</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${order.items.map(line => `<tr><td>${escape(line.name)} ${escape(line.variantName || '')}</td><td>${line.qty} ${escape(line.unit)}</td><td>${escape(money(line.price))}</td><td>${escape(money(roundCurrency(line.qty * line.price)))}</td></tr>`).join('')}</tbody></table><div class="total"><p>Subtotal: ${escape(money(order.subtotal))}<br>Discount: ${escape(money(order.discount))}<br><b>Total: ${escape(money(order.total))}</b></p>${advance > 0 ? `<p style="color:#059669"><b>Advance Paid (${escape(order.payment_mode || 'Cash')}): -${escape(money(advance))}</b>${order.payment_notes ? `<br><small style="color:#64748b">Ref: ${escape(order.payment_notes)}</small>` : ''}</p><p style="font-size:18px;color:#d97706"><b>Balance Due: ${escape(money(balance))}</b></p>` : `<p style="color:#64748b">Payment Status: Unpaid (Due on collection)</p>`}</div><p class="notes">${escape(order.notes)}</p><p>Booking summary. Final payment and stock posted through POS.</p><button onclick="window.print()">Print order</button></body></html>`);
    popup.document.close(); popup.focus(); popup.print();
  };

  const advance = orderAdvance(detail);
  const total = Number(detail.total || 0);
  const fullyPaid = advance >= total && total > 0;
  const balance = orderBalance(detail);
  const open = orderIsOpen(detail);
  const showConfirm = open && canEdit && detail.status === 'Pending';
  const showReady = open && canEdit && detail.status === 'Confirmed';
  const showBill = open && ['Confirmed', 'Ready'].includes(detail.status) && canBill;
  const showInvoice = Boolean(detail.sale_id) && hasPermission('sales_history');

  // One primary action: the next step of the workflow. "Mark ready" steps aside when billing is possible.
  const primaryAction = showConfirm ? 'confirm' : showBill ? 'bill' : showReady ? 'ready' : showInvoice ? 'invoice' : null;
  const hasAnyAction = Boolean(primaryAction) || (open && (canCancel || canEdit));

  const goTo = (path: string) => { onClose(); openTab(path); };

  return (
    <OrderDialog
      title={detail.order_number}
      busy={busy}
      onClose={onClose}
      size="md"
      actions={<IconButton aria-label="Print order" icon={<Printer />} onClick={() => printOrder(detail)} />}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {open && canCancel && (
            <Button variant="danger-soft" leftIcon={<XCircle />} disabled={busy} onClick={() => onStatus(detail, 'Cancelled')}>Cancel order</Button>
          )}
          {open && canEdit && (
            <Button variant="secondary" leftIcon={<Pencil />} disabled={busy} onClick={() => onEdit(detail)}>Edit</Button>
          )}
          {showReady && (
            <Button
              variant={primaryAction === 'ready' ? 'primary' : 'soft'}
              leftIcon={<Package />}
              disabled={busy}
              className={cn(primaryAction === 'ready' && 'order-first w-full sm:order-none sm:w-auto')}
              onClick={() => onStatus(detail, 'Ready')}
            >
              Mark ready
            </Button>
          )}
          {showConfirm && (
            <Button
              rightIcon={<ArrowRight />}
              disabled={busy}
              className="order-first w-full sm:order-none sm:w-auto"
              onClick={() => onStatus(detail, 'Confirmed')}
            >
              Confirm order
            </Button>
          )}
          {showBill && (
            <Button
              variant={primaryAction === 'bill' ? 'primary' : 'soft'}
              rightIcon={<ArrowRight />}
              // Billing while a status change is saving would open the order at an old revision.
              disabled={busy}
              className={cn(primaryAction === 'bill' && 'order-first w-full sm:order-none sm:w-auto')}
              onClick={() => goTo(`/pos?order=${encodeURIComponent(detail.id)}`)}
            >
              Bill in POS
            </Button>
          )}
          {showInvoice && (
            <Button
              variant={primaryAction === 'invoice' ? 'primary' : 'secondary'}
              rightIcon={<ArrowRight />}
              className={cn(primaryAction === 'invoice' && 'order-first w-full sm:order-none sm:w-auto')}
              onClick={() => goTo(`/sales-history?id=${encodeURIComponent(detail.sale_id!)}`)}
            >
              View invoice
            </Button>
          )}
          {!hasAnyAction && (
            <Button variant="secondary" onClick={onClose}>Close</Button>
          )}
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-xl font-bold tracking-tight text-fg">{detail.customer_name}</h3>
            <p className="mt-1.5 flex items-center gap-2 text-sm tabular-nums text-fg-subtle">
              <Phone size={14} aria-hidden="true" />
              {detail.customer_phone || 'No phone saved'}
            </p>
            {hasPermission('customers') && (
              <Button variant="ghost" leftIcon={<Wallet />} className="-ml-3 mt-1 text-brand-fg hover:text-brand-fg" onClick={() => goTo(`/customers?id=${encodeURIComponent(detail.customer_id)}`)}>
                Customer khata
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[detail.status]} size="md" dot>{detail.status}</Badge>
            <Badge tone={advance > 0 ? 'success' : 'neutral'} size="md" className="tabular-nums">
              {fullyPaid ? 'Fully Paid' : advance > 0 ? `Adv: ${money(advance)}` : 'Unpaid'}
            </Badge>
          </div>
        </div>

        <Card variant="inset" className="grid gap-3 rounded-control p-4 text-sm text-fg-muted sm:grid-cols-2">
          <p className="flex items-center gap-2 tabular-nums">
            <CalendarDays size={16} className="shrink-0 text-fg-subtle" aria-hidden="true" />
            {prettyDate(detail.due_date)}{detail.due_time ? ` ${detail.due_time.slice(0, 5)}` : ''}
          </p>
          <p className="flex items-center gap-2">
            {detail.fulfillment === 'Delivery'
              ? <Truck size={16} className="shrink-0 text-fg-subtle" aria-hidden="true" />
              : <ShoppingBag size={16} className="shrink-0 text-fg-subtle" aria-hidden="true" />}
            {detail.fulfillment}
          </p>
          {detail.fulfillment === 'Delivery' && (
            <p className="flex items-start gap-2 sm:col-span-2">
              <MapPin size={16} className="mt-0.5 shrink-0 text-fg-subtle" aria-hidden="true" />
              {detail.address}
            </p>
          )}
        </Card>

        <ul className="divide-y divide-line">
          {detail.items.map((line, index) => (
            <li key={index} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-fg">{line.name}{line.variantName && ` · ${line.variantName}`}</p>
                <p className="mt-1 text-xs tabular-nums text-fg-subtle">{line.qty} {line.unit} × {money(line.price)}</p>
              </div>
              <Money amount={roundCurrency(line.qty * line.price)} className="shrink-0 text-sm font-bold text-fg" />
            </li>
          ))}
        </ul>

        <Card variant="inset" className="space-y-2 p-4">
          <p className="flex justify-between text-xs text-fg-subtle"><span>Subtotal</span><Money amount={detail.subtotal} /></p>
          <p className="flex justify-between text-xs text-fg-subtle"><span>Discount</span><Money amount={detail.discount} /></p>
          <p className="flex justify-between border-t border-line pt-2 text-sm font-bold text-fg"><span>Order Total</span><Money amount={detail.total} /></p>
          {advance > 0 && (
            <p className="flex justify-between gap-3 text-xs font-semibold text-success-fg">
              <span className="min-w-0">Advance Paid ({detail.payment_mode || 'Cash'}){detail.payment_notes ? ` · ${detail.payment_notes}` : ''}</span>
              <Money amount={-advance} className="shrink-0" />
            </p>
          )}
          <p className="flex items-center justify-between border-t border-line-strong pt-2.5 text-base font-bold text-fg">
            <span>Balance Payable</span>
            <Money amount={balance} className={cn('text-xl', balance > 0 ? 'text-warning-fg' : 'text-success-fg')} />
          </p>
        </Card>

        {detail.notes && (
          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Instructions</h4>
            <p className="mt-2 whitespace-pre-wrap text-sm text-fg">{detail.notes}</p>
          </div>
        )}

        <p className="flex items-center gap-2 text-[11px] text-fg-subtle">
          <Clock size={13} aria-hidden="true" />
          Booked {new Date(detail.created_at).toLocaleString('en-PK')}
        </p>
      </div>
    </OrderDialog>
  );
}
