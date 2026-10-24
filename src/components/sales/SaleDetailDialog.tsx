import React, { useRef } from 'react';
import { ArrowLeftRight, Copy, FileText, Printer, RotateCcw } from 'lucide-react';
import type { POSBill } from '../../types';
import { Button, Modal, Money, TBody, TD, TH, THead, TR, Table, TableContainer } from '../ui';
import { BillTotals, PaymentModeBadge, SaleStatusBadge } from './SalesBits';
import { billCopyValue, billLabel, saleDateTime } from './salesHistoryUtils';

export interface SaleDetailDialogProps {
  sale: POSBill;
  /** From saleModeLockReason: null when the bill may switch Cash ⇄ Online. */
  modeLock: string | null;
  onClose: () => void;
  onCopy: (event: React.MouseEvent, billNumber: string) => void;
  onChangeMode: (sale: POSBill) => void;
  onReturn: (sale: POSBill) => void;
  onReceipt: (sale: POSBill) => void;
}

/** Full invoice view: customer, payment mode, lines and totals. Lazy-loaded by Sales History. */
export default function SaleDetailDialog({ sale, modeLock, onClose, onCopy, onChangeMode, onReturn, onReceipt }: SaleDetailDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { date, time } = saleDateTime(sale);
  const lines = sale.items || [];
  const isReturned = sale.status === 'Returned';

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      initialFocusRef={closeRef}
      icon={
        <span className="flex size-10 items-center justify-center rounded-control bg-brand-soft text-brand-fg">
          <FileText className="size-5" aria-hidden="true" />
        </span>
      }
      title={
        <span className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={event => onCopy(event, billCopyValue(sale))}
            title="Click to copy Invoice Number"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md font-mono transition-colors hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            #{billLabel(sale)}
            <Copy aria-hidden="true" className="size-3.5 opacity-50" />
          </button>
          <SaleStatusBadge status={sale.status} />
        </span>
      }
      description={<span className="tabular-nums">{date}{time ? ` • ${time}` : ''}</span>}
      footer={
        <>
          <Button ref={closeRef} variant="secondary" onClick={onClose} className="sm:mr-auto">Close</Button>
          {!isReturned && (
            <Button variant="secondary" leftIcon={<RotateCcw />} onClick={() => onReturn(sale)}>Return</Button>
          )}
          <Button leftIcon={<Printer />} onClick={() => onReceipt(sale)}>Print Receipt</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 rounded-control bg-surface-2 p-3 text-sm ring-1 ring-inset ring-line/70">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Customer</p>
            <p className="mt-0.5 truncate font-semibold text-fg">{sale.customer_name || 'Walk-in Customer'}</p>
            {sale.customer_id && <p className="text-xs font-medium text-fg-subtle">Ledger Account</p>}
          </div>
          <div className="min-w-0 text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Payment Mode</p>
            <div className="mt-1 flex flex-wrap items-center justify-end gap-1.5">
              <PaymentModeBadge mode={sale.payment_mode} title={modeLock || undefined} />
              {!modeLock && (
                <Button size="sm" variant="ghost" leftIcon={<ArrowLeftRight />} onClick={() => onChangeMode(sale)} title="Change payment mode">
                  Change
                </Button>
              )}
            </div>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-fg-muted">Sold Items ({lines.length})</p>
          <TableContainer className="shadow-none">
            <Table className="text-[13px]">
              <THead>
                <tr>
                  <TH>Item</TH>
                  <TH className="text-center">Qty</TH>
                  <TH numeric>Price</TH>
                  <TH numeric>Total</TH>
                </tr>
              </THead>
              <TBody>
                {lines.length > 0 ? (
                  lines.map((it, idx) => {
                    const line: any = it;
                    return (
                      <TR key={idx}>
                        <TD className="py-2.5">
                          <span className="block font-semibold text-fg">{it.name}</span>
                          {line.variantName && <span className="block text-xs text-fg-subtle">{line.variantName}</span>}
                        </TD>
                        <TD className="whitespace-nowrap py-2.5 text-center font-semibold tabular-nums">
                          {it.qty} <span className="text-xs font-normal text-fg-subtle">{line.variantName || line.unit || 'Unit'}</span>
                        </TD>
                        <TD numeric className="py-2.5 font-medium text-fg-muted"><Money amount={it.price} /></TD>
                        <TD numeric className="py-2.5"><Money amount={it.total || it.qty * it.price} /></TD>
                      </TR>
                    );
                  })
                ) : (
                  <tr>
                    <TD colSpan={4} className="py-6 text-center italic text-fg-subtle">No item details recorded</TD>
                  </tr>
                )}
              </TBody>
            </Table>
          </TableContainer>
        </div>

        <BillTotals sale={sale} className="bg-surface-2" />
      </div>
    </Modal>
  );
}
