import React from 'react';
import { Calendar, ImageDown, Printer, Receipt, Trash2 } from 'lucide-react';
import { CashDay, CashLine, DatePreset, formatLedgerDate, formatMoney } from '../../lib/supplierStatement';
import { formatCurrency } from '../../lib/formatters';

const PRESETS: { id: DatePreset; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'tendays', label: '10 Days' },
  { id: 'fifteendays', label: '15 Days' },
  { id: 'month', label: 'Month' },
  { id: 'lastmonth', label: 'Last Mo' },
  { id: 'custom', label: 'Custom' }
];

export function BalanceAmount({ value, className = '' }: { value: number; className?: string }) {
  const settled = Math.abs(value) < 0.5;
  const payable = value > 0.5;
  return (
    <span className={`${className} ${settled ? 'text-slate-700' : payable ? 'text-amber-600' : 'text-emerald-600'}`}>
      {formatCurrency(Math.abs(value))}
      {!settled && <span className="ml-1 text-[9px] font-black uppercase">{payable ? ' Pay' : ' Adv'}</span>}
    </span>
  );
}

export function LedgerRangeBar(props: {
  preset: DatePreset;
  from: string;
  to: string;
  onPreset: (preset: DatePreset) => void;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  view?: 'statement' | 'milk' | 'payments';
  onView?: (view: 'statement' | 'milk' | 'payments') => void;
  onPrint: () => void;
  onOpenPrintModal?: () => void;
  printLabel: string;
  onShare?: () => void;
  shareLabel?: string;
  sharing?: boolean;
  rangeLabel: string;
}) {
  const views = [
    { id: 'statement' as const, label: 'Ledger' },
    { id: 'milk' as const, label: 'Milk' },
    { id: 'payments' as const, label: 'Payments' }
  ];
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-2.5 shadow-2xs space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          {props.onView && (
            <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-[11px] font-bold text-slate-600 mr-1">
              {views.map(view => (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => props.onView?.(view.id)}
                  className={`px-2.5 py-1.5 rounded-lg cursor-pointer ${props.view === view.id ? 'bg-white text-slate-900 shadow-2xs' : 'hover:text-slate-900'}`}
                >
                  {view.label}
                </button>
              ))}
            </div>
          )}
          {PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              onClick={() => props.onPreset(preset.id)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer ${
                props.preset === preset.id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {props.onShare && (
            <button
              type="button"
              onClick={props.onShare}
              disabled={props.sharing}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-xl text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <ImageDown size={13} />
              <span>{props.sharing ? 'Saving...' : (props.shareLabel || 'Send Image')}</span>
            </button>
          )}
          {props.onOpenPrintModal && props.view === 'statement' ? (
            <button
              type="button"
              onClick={props.onOpenPrintModal}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-[11px] font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs"
              title="Print with Custom Filters & Options"
            >
              <Printer size={13} />
              <span>{props.printLabel}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={props.onPrint}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Printer size={13} />
              <span>{props.printLabel}</span>
            </button>
          )}
        </div>
      </div>
      {props.preset === 'custom' && (
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
            From
            <input type="date" value={props.from} onChange={event => props.onFrom(event.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-800" />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
            To
            <input type="date" value={props.to} onChange={event => props.onTo(event.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-800" />
          </label>
        </div>
      )}
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
        <Calendar size={12} />
        <span>{props.rangeLabel}</span>
      </div>
    </div>
  );
}

export function CashPaymentDays(props: {
  days: CashDay[];
  onDelete?: (id: string) => void;
  onVoucher?: (line: CashLine) => void;
  onOpenSupplier?: (id: string) => void;
  showSupplier?: boolean;
  emptyText?: string;
}) {
  if (props.days.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-2xs">
        <Receipt size={28} className="mx-auto text-slate-300 mb-2" />
        <p className="font-bold text-sm text-slate-700">{props.emptyText || 'No payments in this period'}</p>
        <p className="text-[11px] text-slate-400 mt-1">Change the date or record a supplier payment.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {props.days.map(day => (
        <div key={day.date} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
            <span className="text-xs font-black text-slate-800">{formatLedgerDate(day.date, true)}</span>
            <span className="text-[11px] font-bold text-slate-500">
              Paid {formatMoney(day.paid)}
              {day.refunded > 0 ? ` · Refund ${formatMoney(day.refunded)}` : ''}
              <span className="text-slate-900"> · Net {day.net < -0.5 ? '-' : ''}{formatMoney(day.net)}</span>
            </span>
          </div>
          <div className="divide-y divide-slate-100">
            {day.rows.map(row => (
              <div key={row.id} className="px-4 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {props.showSupplier && (
                    <button
                      type="button"
                      onClick={() => props.onOpenSupplier?.(row.supplierId)}
                      className="font-bold text-sm text-slate-900 hover:text-lime-700 cursor-pointer text-left"
                    >
                      {row.supplierName}
                    </button>
                  )}
                  <p className="text-xs font-semibold text-slate-700">
                    {row.subtype} · {row.mode}{row.accountName ? ` · ${row.accountName}` : ''}
                  </p>
                  {row.note && <p className="text-[11px] text-slate-400 mt-0.5">{row.note}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`font-mono font-black text-sm ${row.direction === 'in' ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {row.direction === 'in' ? '-' : ''}{formatMoney(row.amount)}
                  </span>
                  {props.onVoucher && (
                    <button aria-label="Print voucher" type="button" onClick={() => props.onVoucher?.(row)} className="p-1.5 text-slate-400 hover:text-slate-800 cursor-pointer" title="Print voucher">
                      <Printer size={14} />
                    </button>
                  )}
                  {row.canDelete && props.onDelete && (
                    <button aria-label="Delete payment" type="button" onClick={() => props.onDelete?.(row.id)} className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer" title="Delete payment">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
