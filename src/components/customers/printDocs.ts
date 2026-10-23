// 80mm thermal receipts for the customer khata. Loaded on demand (import()) the first time someone
// prints, so the popup templates stay out of the Customers chunk.
import type { POSBill } from '../../types';
import { formatCurrency } from '../../lib/formatters';
import { salePaidAmount } from '../../lib/moneyFlow';
import { roundCurrency } from '../../lib/db';
import { escapeHtml as esc, formatSaleDateTime, type LedgerEntry } from './customerUtils';

export interface ShopInfo {
  companyName: string;
  address: string;
  phone: string;
  footer: string;
}

const openPopup = (height: number) => window.open('', '_blank', `width=420,height=${height}`);

const writeAndPrint = (popup: Window, html: string) => {
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  setTimeout(() => popup.print(), 250);
};

/** Thermal receipt of a POS bill. Every value is escaped: item and customer names come from user input. */
export function printInvoiceReceipt(sale: POSBill, shop: ShopInfo, customerName?: string) {
  const popup = openPopup(650);
  if (!popup) {
    window.print();
    return;
  }
  const dt = formatSaleDateTime(sale.date || (sale as any).created_at, (sale as any).time || sale.details?.time);
  const paid = salePaidAmount(sale);

  const itemsHtml = (sale.items || []).map((it: any) => {
    const lineTotal = it.total || (it.qty * it.price);
    const variantStr = it.variantName ? ` (${esc(it.variantName)})` : '';
    return `
        <tr>
          <td style="padding: 4px 0; border-bottom: 1px dashed #cbd5e1; font-size: 11px;"><strong>${esc(it.name)}${variantStr}</strong></td>
          <td style="padding: 4px 0; border-bottom: 1px dashed #cbd5e1; text-align: center; font-size: 11px;">${esc(it.qty)} ${esc(it.unit || '')}</td>
          <td style="padding: 4px 0; border-bottom: 1px dashed #cbd5e1; text-align: right; font-size: 11px;">${formatCurrency(Number(it.price || 0))}</td>
          <td style="padding: 4px 0; border-bottom: 1px dashed #cbd5e1; text-align: right; font-size: 11px; font-weight: bold;">${formatCurrency(Number(lineTotal || 0))}</td>
        </tr>`;
  }).join('');

  writeAndPrint(popup, `
      <!doctype html>
      <html>
        <head>
          <title>Receipt - ${esc(sale.bill_number || sale.id)}</title>
          <style>
            @page { size: 80mm auto; margin: 4mm; }
            body { font-family: 'Courier New', Courier, monospace; font-size: 12px; color: #0f172a; margin: 0; padding: 10px; background: #fff; }
            .text-center { text-align: center; }
            .divider { border-bottom: 1px dashed #64748b; margin: 8px 0; }
            .row { display: flex; justify-content: space-between; }
            table { width: 100%; border-collapse: collapse; }
            .btn-print { display: block; width: 100%; background: #65a30d; color: white; border: none; padding: 8px; font-size: 12px; font-weight: bold; border-radius: 6px; cursor: pointer; margin-top: 12px; }
            @media print { .btn-print { display: none; } }
          </style>
        </head>
        <body>
          <div class="text-center">
            <h2 style="margin: 0; font-size: 16px; font-weight: 900; letter-spacing: 1px;">${esc(shop.companyName)}</h2>
            <p style="margin: 2px 0; font-size: 10px; color: #475569;">${esc(shop.address)}</p>
            <p style="margin: 2px 0; font-size: 10px; color: #475569;">Tel: ${esc(shop.phone)}</p>
            ${sale.status === 'Returned' ? '<div style="margin: 4px auto; padding: 2px 6px; background: #fee2e2; color: #b91c1c; font-weight: bold; font-size: 10px; display: inline-block;">*** RETURNED (WAPAS) ***</div>' : ''}
          </div>
          <div class="divider"></div>
          <div style="font-size: 11px; line-height: 1.4;">
            <div class="row"><span>Inv #:</span> <strong>${esc(sale.bill_number || sale.id)}</strong></div>
            <div class="row"><span>Date:</span> <span>${esc(`${dt.date} ${dt.time}`.trim())}</span></div>
            <div class="row"><span>Customer:</span> <strong>${esc(sale.customer_name || customerName || 'Customer')}</strong></div>
            <div class="row"><span>Payment:</span> <strong>${esc(sale.payment_mode)}</strong></div>
          </div>
          <div class="divider"></div>
          <table>
            <thead>
              <tr style="border-bottom: 1px dashed #64748b; font-size: 10px; text-transform: uppercase;">
                <th style="text-align: left; padding-bottom: 4px;">Item</th>
                <th style="text-align: center; padding-bottom: 4px;">Qty</th>
                <th style="text-align: right; padding-bottom: 4px;">Rate</th>
                <th style="text-align: right; padding-bottom: 4px;">Total</th>
              </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
          </table>
          <div class="divider"></div>
          <div style="font-size: 11px; line-height: 1.5;">
            <div class="row"><span>Subtotal:</span> <span>${formatCurrency(Number(sale.subtotal || sale.total))}</span></div>
            ${sale.discount > 0 ? `<div class="row" style="color: #059669;"><span>Discount:</span> <span>- ${formatCurrency(Number(sale.discount))}</span></div>` : ''}
            ${sale.refund_amount && sale.refund_amount > 0 ? `<div class="row" style="color: #dc2626;"><span>Refunded:</span> <span>- ${formatCurrency(Number(sale.refund_amount))}</span></div>` : ''}
            <div class="row" style="font-size: 13px; font-weight: 900; margin-top: 4px; border-top: 1px solid #0f172a; padding-top: 4px;">
              <span>TOTAL:</span> <span>${formatCurrency(Number(sale.total || 0))}</span>
            </div>
            ${sale.payment_mode === 'Credit' && paid > 0 ? `<div class="row"><span>Paid:</span> <span>${formatCurrency(paid)}</span></div>` : ''}
            ${sale.payment_mode === 'Credit' ? `<div class="row" style="color: #d97706; font-weight: bold;"><span>Charged to Khata:</span> <span>${formatCurrency(roundCurrency(Math.max(0, Number(sale.total || 0) - paid)))}</span></div>` : ''}
            ${sale.return_reason ? `<div style="margin-top: 4px; padding: 4px; background: #fee2e2; color: #991b1b; font-size: 10px;"><strong>Reason:</strong> ${esc(sale.return_reason)}</div>` : ''}
          </div>
          <div class="divider"></div>
          <div class="text-center" style="font-size: 10px; color: #64748b; margin-top: 8px;">
            <p style="margin: 2px 0; font-weight: bold; color: #1e293b;">${esc(shop.footer)}</p>
            <p style="margin: 2px 0;">Mooco Dairy Accounting & POS</p>
          </div>
          <button class="btn-print" onclick="window.print()">Print Receipt</button>
        </body>
      </html>`);
}

/** Thermal voucher of a manual khata entry (payment, charge, return). */
export function printVoucher(entry: LedgerEntry, shop: ShopInfo, customerName?: string) {
  const popup = openPopup(550);
  if (!popup) return;
  const isCredit = (entry.credit || 0) > 0;
  const amount = isCredit ? entry.credit : entry.debit;
  const balance = entry.runningBalance;
  writeAndPrint(popup, `
      <!doctype html>
      <html>
        <head>
          <title>Voucher - ${esc(entry.id)}</title>
          <style>
            @page { size: 80mm auto; margin: 5mm; }
            body { font-family: 'Courier New', Courier, monospace; font-size: 12px; color: #0f172a; padding: 10px; }
            .text-center { text-align: center; }
            .divider { border-bottom: 1px dashed #64748b; margin: 8px 0; }
            table { width: 100%; border-collapse: collapse; }
            td { padding: 4px 0; font-size: 11px; }
            .btn-print { display: block; width: 100%; background: #65a30d; color: white; border: none; padding: 8px; font-weight: bold; border-radius: 6px; cursor: pointer; margin-top: 12px; }
            @media print { .btn-print { display: none; } }
          </style>
        </head>
        <body>
          <div class="text-center">
            <h2 style="margin: 0; font-size: 16px;">${esc(shop.companyName)}</h2>
            <p style="margin: 2px 0; font-size: 11px; font-weight: bold;">${entry.type === 'Payment' ? 'PAYMENT RECEIPT VOUCHER' : 'TRANSACTION VOUCHER'}</p>
          </div>
          <div class="divider"></div>
          <table>
            <tr><td>Date:</td><td style="text-align: right; font-weight: bold;">${esc(entry.date)}</td></tr>
            <tr><td>Customer:</td><td style="text-align: right; font-weight: bold;">${esc(customerName || '')}</td></tr>
            <tr><td>Mode:</td><td style="text-align: right;">${esc(entry.mode || 'Cash')}</td></tr>
            <tr><td>Type:</td><td style="text-align: right;">${esc(entry.type)}</td></tr>
          </table>
          <div class="divider"></div>
          <div style="font-size: 13px; font-weight: bold; display: flex; justify-content: space-between; padding: 6px 0;">
            <span>AMOUNT:</span>
            <span>${formatCurrency(Number(amount || 0))}</span>
          </div>
          ${entry.note ? `<div style="font-size: 10px; color: #475569; padding: 4px 0;">Note: ${esc(entry.note)}</div>` : ''}
          ${balance !== undefined ? `<div style="font-size: 11px; font-weight: bold; margin-top: 4px;">Balance after entry: ${formatCurrency(Math.abs(balance))} ${balance > 0 ? 'Dr' : balance < 0 ? 'Cr' : ''}</div>` : ''}
          <div class="divider"></div>
          <div class="text-center" style="font-size: 10px; color: #64748b; margin-top: 10px;">
            <p>Thank you for your transaction!</p>
          </div>
          <button class="btn-print" onclick="window.print()">Print Voucher</button>
        </body>
      </html>`);
}
