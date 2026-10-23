import React, { useRef } from 'react';
import { Printer } from 'lucide-react';
import type { POSBill } from '../../types';
import { cleanQty, formatCurrency, formatMoneyRaw } from '../../lib/formatters';
import { printReceipt } from '../pos/printReceipt';
import { Button, Modal } from '../ui';
import { saleDateTime } from './salesHistoryUtils';

export interface SaleReceiptDialogProps {
  sale: POSBill;
  settings: any;
  onClose: () => void;
}

/**
 * Receipt preview. The paper is a `.receipt-paper` element (white in both themes): inside it only
 * layout/typography utilities and the receipt-* colour classes from styles/receipt.css are used,
 * and Print hands it to printReceipt() so only the receipt prints, not the screen behind it.
 */
export default function SaleReceiptDialog({ sale, settings, onClose }: SaleReceiptDialogProps) {
  const paperRef = useRef<HTMLDivElement>(null);
  const printRef = useRef<HTMLButtonElement>(null);
  const { date, time } = saleDateTime(sale);

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Receipt Preview"
      initialFocusRef={printRef}
      icon={
        <span className="flex size-10 items-center justify-center rounded-control bg-surface-2 text-fg-muted">
          <Printer className="size-5" aria-hidden="true" />
        </span>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button ref={printRef} leftIcon={<Printer />} onClick={() => printReceipt(paperRef.current)}>Print</Button>
        </>
      }
    >
      <div className="overflow-hidden rounded-control shadow-e1 ring-1 ring-line">
        <div ref={paperRef} className="receipt-paper space-y-2.5 p-5 font-mono text-xs">
          <div className="receipt-rule space-y-0.5 border-b pb-2.5 text-center">
            <h2 className="receipt-strong text-sm font-black tracking-tight">{settings.general?.companyName || 'MOOCO DAIRY'}</h2>
            <p className="receipt-muted text-[10px]">{settings.general?.address || 'Fresh & Pure Farm Dairy'}</p>
            <p className="receipt-muted text-[10px]">Tel: {settings.general?.phone || '0300-1234567'}</p>
            {settings.general?.taxId && <p className="receipt-muted text-[10px]">NTN: {settings.general.taxId}</p>}
            {sale.status === 'Returned' && (
              <div className="receipt-stamp mt-1 text-[9px]">*** RETURNED ***</div>
            )}
          </div>

          <div className="receipt-rule space-y-0.5 border-b pb-2 text-[10px]">
            <div className="flex justify-between gap-3">
              <span className="receipt-muted">Invoice:</span>
              <span className="font-bold">{sale.bill_number}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="receipt-muted">Date:</span>
              <span className="font-bold">{date}</span>
            </div>
            {time && (
              <div className="flex justify-between gap-3">
                <span className="receipt-muted">Time:</span>
                <span className="font-mono font-bold">{time}</span>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <span className="receipt-muted">Customer:</span>
              <span className="text-right font-bold">{sale.customer_name || 'Walk-in'}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="receipt-muted">Payment:</span>
              <span className="font-bold">{sale.payment_mode}</span>
            </div>
          </div>

          <div className="receipt-rule space-y-1 border-b pb-2">
            <div className="receipt-faint flex justify-between text-[9px] font-bold uppercase">
              <span>Item</span>
              <span className="text-right">Qty x Rate = Total</span>
            </div>
            {sale.items?.map((it, idx) => (
              <div key={idx} className="flex items-baseline justify-between gap-2 text-[10px]">
                <span className="font-semibold">{it.name}</span>
                <span className="shrink-0 text-right font-bold">
                  {cleanQty(it.qty)} x {formatMoneyRaw(it.price)} = {formatCurrency(it.total || it.qty * it.price)}
                </span>
              </div>
            ))}
          </div>

          <div className="space-y-0.5 pt-0.5 text-[10px]">
            <div className="receipt-muted flex justify-between">
              <span>Subtotal:</span>
              <span>{formatCurrency(sale.subtotal || sale.total)}</span>
            </div>
            {sale.discount > 0 && (
              <div className="receipt-good flex justify-between font-semibold">
                <span>Discount:</span>
                <span>- {formatCurrency(sale.discount)}</span>
              </div>
            )}
            {/* Solid rule in the text colour (#0f172a from receipt-strong), as on the printed slip before. */}
            <div className="receipt-strong receipt-strong-rule flex justify-between border-t pt-1 text-xs font-black">
              <span>TOTAL:</span>
              <span>{formatCurrency(sale.total || 0)}</span>
            </div>
          </div>

          <div className="receipt-rule receipt-faint border-t pt-2.5 text-center text-[9px]">
            <p className="receipt-strong font-bold">{settings.sales?.invoiceFooter || 'Thank you for your purchase!'}</p>
            <p>Pure Milk & Dairy Essentials</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}
