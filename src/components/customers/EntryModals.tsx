import React from 'react';
import { Calendar, CheckCircle2, Clock, FileText, Layers, MessageCircle, Phone, Printer, Receipt, RotateCcw, Trash2 } from 'lucide-react';
import { Badge, Button, Modal, TBody, TD, TH, THead, TR, Table } from '../ui';
import { cn } from '../../lib/cn';
import { formatCurrency } from '../../lib/formatters';
import { salePaidAmount } from '../../lib/moneyFlow';
import { roundCurrency } from '../../lib/db';
import type { Customer, POSBill } from '../../types';
import { KhataBalance } from './CustomerBits';
import { formatSaleDateTime, type LedgerEntry } from './customerUtils';
import { printInvoiceReceipt, printVoucher, type ShopInfo } from './printDocs';

const SummaryRow = ({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) => (
  <div className={cn('flex justify-between gap-3', className)}>
    <span>{label}</span>
    <span className="font-semibold tabular-nums">{children}</span>
  </div>
);

interface InvoiceModalProps {
  sale: POSBill;
  customer: Customer | null;
  onClose: () => void;
  shop: ShopInfo;
  onWhatsApp: (sale: POSBill) => void;
}

export function InvoiceModal({ sale, customer, shop, onClose, onWhatsApp }: InvoiceModalProps) {
  const when = formatSaleDateTime(sale.date || (sale as any).created_at, (sale as any).time || sale.details?.time);
  const status = String(sale.status || '');
  const isCredit = sale.payment_mode === 'Credit';
  const paid = salePaidAmount(sale);
  const hasPhone = Boolean(customer?.whatsapp || customer?.phone);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={<span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand-fg"><Receipt size={20} /></span>}
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span className="tabular-nums">{sale.bill_number ? `#${sale.bill_number}` : `INV-${sale.id.slice(-6)}`}</span>
          {status === 'Returned' ? <Badge tone="danger" icon={<RotateCcw />}>Returned</Badge>
            : status === 'Partially Returned' ? <Badge tone="warning" icon={<RotateCcw />}>Partial return</Badge>
            : <Badge tone="success" icon={<CheckCircle2 />}>Completed</Badge>}
        </span>
      }
      description={
        <span className="flex items-center gap-1.5 text-xs tabular-nums">
          <Calendar className="size-3" aria-hidden="true" /> {when.date}
          {when.time && <><span aria-hidden="true">·</span><Clock className="size-3" aria-hidden="true" /> {when.time}</>}
        </span>
      }
      footer={<>
        <Button variant="secondary" onClick={onClose}>Close</Button>
        {hasPhone && <Button variant="secondary" leftIcon={<MessageCircle />} onClick={() => onWhatsApp(sale)}>WhatsApp</Button>}
        <Button leftIcon={<Printer />} onClick={() => printInvoiceReceipt(sale, shop, customer?.name)}>Print receipt</Button>
      </>}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 rounded-control border border-line bg-surface-2 p-3 text-xs">
          <div className="min-w-0">
            <span className="mb-0.5 block text-[11px] font-semibold text-fg-subtle">Customer</span>
            <span className="block truncate text-sm font-bold text-fg">{sale.customer_name || customer?.name || 'Customer'}</span>
            {customer?.phone && (
              <span className="mt-0.5 flex items-center gap-1 tabular-nums text-fg-subtle"><Phone className="size-3" aria-hidden="true" /> {customer.phone}</span>
            )}
          </div>
          <div className="text-right">
            <span className="mb-0.5 block text-[11px] font-semibold text-fg-subtle">Payment mode</span>
            <Badge tone={sale.payment_mode === 'Cash' ? 'success' : sale.payment_mode === 'Online' ? 'info' : 'warning'}>{sale.payment_mode}</Badge>
            <span className={cn('mt-1.5 block text-[11px] font-bold', isCredit ? 'text-danger-fg' : 'text-success-fg')}>
              {isCredit ? 'Charged to account (due)' : 'Paid on counter'}
            </span>
          </div>
        </div>

        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
            <Layers className="size-3.5 text-brand-accent" aria-hidden="true" /> Billed items ({sale.items?.length || 0})
          </p>
          <div className="overflow-hidden rounded-control border border-line">
            <Table className="text-xs">
              <THead>
                <tr>
                  <TH>Item</TH>
                  <TH className="text-center">Qty</TH>
                  <TH numeric>Rate</TH>
                  <TH numeric>Total</TH>
                </tr>
              </THead>
              <TBody>
                {sale.items && sale.items.length > 0 ? sale.items.map((it: any, idx) => (
                  <TR key={idx}>
                    <TD className="py-2.5">
                      <span className="block font-semibold">{it.name}</span>
                      {it.variantName && <span className="block text-[11px] text-fg-subtle">{it.variantName}</span>}
                    </TD>
                    <TD className="py-2.5 text-center tabular-nums">
                      {it.qty} <span className="text-[11px] text-fg-subtle">{it.variantName ? 'Pack' : (it.unit || 'Unit')}</span>
                    </TD>
                    <TD numeric className="py-2.5 font-medium text-fg-muted">{formatCurrency(it.price)}</TD>
                    <TD numeric className="py-2.5">{formatCurrency(it.total || (it.qty * it.price))}</TD>
                  </TR>
                )) : (
                  <tr><td colSpan={4} className="p-4 text-center italic text-fg-subtle">No item details on record</td></tr>
                )}
              </TBody>
            </Table>
          </div>
        </div>

        <div className="space-y-1.5 rounded-control border border-line bg-surface-2 p-3 text-xs text-fg-muted">
          <SummaryRow label="Subtotal">{formatCurrency(sale.subtotal || sale.total)}</SummaryRow>
          {sale.discount > 0 && <SummaryRow label="Discount" className="text-success-fg">- {formatCurrency(sale.discount)}</SummaryRow>}
          {sale.refund_amount !== undefined && sale.refund_amount > 0 && (
            <SummaryRow label="Refunded amount" className="text-danger-fg">- {formatCurrency(sale.refund_amount)}</SummaryRow>
          )}
          <div className="flex items-center justify-between border-t border-line pt-2 font-bold text-fg">
            <span className="text-sm">Grand total</span>
            <span className="text-lg tabular-nums">{formatCurrency(sale.total || 0)}</span>
          </div>
          {isCredit && paid > 0 && <SummaryRow label="Paid on bill" className="text-success-fg">{formatCurrency(paid)}</SummaryRow>}
          {isCredit && (
            <SummaryRow label="Charged to account" className="text-danger-fg">{formatCurrency(roundCurrency(Math.max(0, Number(sale.total || 0) - paid)))}</SummaryRow>
          )}
          {sale.return_reason && (
            <div className="mt-2 rounded-control border border-danger/25 bg-danger-soft p-2.5 text-danger-fg">
              <strong>Return reason:</strong> {sale.return_reason}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

interface VoucherModalProps {
  entry: LedgerEntry;
  customer: Customer | null;
  onClose: () => void;
  shop: ShopInfo;
  onDelete?: (entry: LedgerEntry) => void;
}

export function VoucherModal({ entry, customer, shop, onClose, onDelete }: VoucherModalProps) {
  const isCredit = entry.credit > 0;
  const title = entry.type === 'Payment' ? 'Payment receipt voucher' : entry.type === 'Return' ? 'Sales return voucher' : 'Ledger charge voucher';
  return (
    <Modal
      open
      onClose={onClose}
      icon={<span className={cn('flex size-10 items-center justify-center rounded-xl', isCredit ? 'bg-success-soft text-success-fg' : 'bg-warning-soft text-warning-fg')}><FileText size={18} /></span>}
      title={title}
      description={<span className="flex items-center gap-1.5 text-xs tabular-nums"><Calendar className="size-3" aria-hidden="true" /> {entry.dateLabel}</span>}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Close</Button>
        {entry.canDelete && onDelete && <Button variant="danger-soft" leftIcon={<Trash2 />} onClick={() => onDelete(entry)}>Delete</Button>}
        <Button leftIcon={<Printer />} onClick={() => printVoucher(entry, shop, customer?.name)}>Print voucher</Button>
      </>}
    >
      <div className="space-y-4">
        <div className="rounded-control border border-line bg-surface-2 p-4 text-center">
          <span className="block text-[11px] font-semibold text-fg-subtle">Voucher amount</span>
          <p className={cn('mt-1 text-2xl font-bold tabular-nums', isCredit ? 'text-success-fg' : 'text-danger-fg')}>
            {formatCurrency(entry.credit || entry.debit || 0)}
          </p>
          <Badge tone={isCredit ? 'success' : 'danger'} className="mt-1.5">{isCredit ? 'Credit (payment received)' : 'Debit (customer charge)'}</Badge>
        </div>
        <dl className="space-y-2 rounded-control border border-line p-3 text-xs">
          <div className="flex justify-between gap-3"><dt className="text-fg-subtle">Customer</dt><dd className="font-semibold text-fg">{customer?.name}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-fg-subtle">Payment mode</dt><dd className="font-semibold text-fg">{entry.mode || 'Cash'}</dd></div>
          <div className="flex justify-between gap-3"><dt className="shrink-0 text-fg-subtle">Description</dt><dd className="text-right font-semibold text-fg">{entry.description}</dd></div>
          {entry.note && (
            <div className="flex justify-between gap-3 border-t border-line pt-2"><dt className="shrink-0 text-fg-subtle">Note</dt><dd className="text-right italic text-fg-muted">{entry.note}</dd></div>
          )}
          <div className="flex justify-between gap-3 border-t border-line pt-2">
            <dt className="text-fg-subtle">Balance after entry</dt>
            <dd><KhataBalance balance={entry.runningBalance} label="drcr" /></dd>
          </div>
        </dl>
      </div>
    </Modal>
  );
}
