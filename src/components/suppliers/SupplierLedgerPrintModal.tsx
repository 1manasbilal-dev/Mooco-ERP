import React, { useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, Filter, Layers, MessageCircle, Printer } from 'lucide-react';
import {
  DatePreset,
  LedgerTypeFilter,
  StatementCompany,
  SupplierStatement,
  buildSupplierStatement,
  printSupplierLedger,
  rangeForPreset
} from '../../lib/supplierStatement';
import { formatQty } from '../../lib/formatters';
import { Supplier } from '../../types';
import { Badge, Button, Input, Modal, Money } from '../ui';
import { cn } from '../../lib/cn';
import { SupplierBalance, toStatementSupplier } from './supplierUi';

interface RawPurchase {
  id: string;
  supplier_id?: string;
  date?: string;
  quantity?: number;
  milk_type?: string;
  shift?: string;
  rate?: number;
  fat?: number;
  snf?: number;
  total_amount?: number;
  paid_amount?: number;
  status?: string;
  details?: { paid_amount?: number; due_amount?: number };
}

interface RawMaterial {
  id: string;
  supplier_id?: string;
  date?: string;
  item_name?: string;
  quantity?: number;
  unit?: string;
  total_amount?: number;
  paid_amount?: number;
  status?: string;
  details?: { paid_amount?: number };
}

interface RawTx {
  id: string;
  supplier_id?: string;
  date?: string;
  type?: string;
  amount?: number;
  mode?: string;
  note?: string;
  account_id?: string;
  details?: {
    mode?: string;
    note?: string;
    purchase_id?: string;
    cash_refund?: number;
    account_id?: string;
  };
}

export interface SupplierLedgerPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  supplier: Supplier;
  company: StatementCompany;
  purchases: RawPurchase[];
  materialPurchases: RawMaterial[];
  transactions: RawTx[];
  accountNames: Record<string, string>;
  initialPreset?: DatePreset;
  initialFrom?: string;
  initialTo?: string;
  initialType?: LedgerTypeFilter;
  onSendWhatsApp?: (supplier: Supplier, statement: SupplierStatement) => void;
}

const MODAL_PRESETS: { id: DatePreset; label: string; desc: string }[] = [
  { id: 'all', label: 'All time', desc: 'Poori history' },
  { id: 'today', label: 'Today', desc: 'Sirf aaj' },
  { id: 'week', label: 'This week', desc: 'Monday se aaj tak' },
  { id: 'tendays', label: '10 days cycle', desc: 'Dahha billing' },
  { id: 'fifteendays', label: '15 days cycle', desc: 'Fortnightly' },
  { id: 'month', label: 'This month', desc: 'Is mahine' },
  { id: 'lastmonth', label: 'Last month', desc: 'Pichla mahina' },
  { id: 'custom', label: 'Custom range', desc: 'Apni tareekhein' }
];

const TYPE_OPTIONS: { id: LedgerTypeFilter; title: string; desc: string }[] = [
  { id: 'All', title: 'All records', desc: 'Poora ledger' },
  { id: 'Milk', title: 'Milk only', desc: 'Milk supply' },
  { id: 'Payment', title: 'Payments only', desc: 'Cash & bank' },
  { id: 'Material', title: 'Materials / feed', desc: 'Feed & items' }
];

const LAYOUTS: { id: 'detailed' | 'daily_summary'; title: string; desc: string }[] = [
  { id: 'detailed', title: 'Detailed ledger', desc: 'Har purchase, material aur payment voucher tareekh ke hisaab se' },
  { id: 'daily_summary', title: 'Daily summary', desc: 'Har din ki ek line, subah + shaam ka milk mila kar (aksar 1 page)' }
];

/** Selectable tile used for the preset, type and layout choices. */
const OptionTile: React.FC<{ active: boolean; title: string; desc: string; onClick: () => void }> = ({ active, title, desc, onClick }) => {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'cursor-pointer rounded-control border p-2.5 text-left transition-[border-color,background-color,box-shadow] duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-brand-accent bg-brand-soft text-brand-fg shadow-e1'
          : 'border-line bg-surface text-fg hover:border-line-strong hover:bg-surface-2'
      )}
    >
      <span className="block text-xs font-bold">{title}</span>
      <span className={cn('mt-0.5 block text-[11px] leading-snug', active ? 'text-brand-fg/80' : 'text-fg-subtle')}>{desc}</span>
    </button>
  );
};

function StepLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-fg-muted [&_svg]:size-3.5 [&_svg]:text-fg-faint">
      {icon}
      {children}
    </p>
  );
}

export function SupplierLedgerPrintModal(props: SupplierLedgerPrintModalProps) {
  // Hooks run on every render; returning before them breaks React when isOpen changes.
  const [preset, setPreset] = useState<DatePreset>(props.initialPreset || 'all');
  const [from, setFrom] = useState<string>(() => props.initialFrom || rangeForPreset(props.initialPreset || 'all').from);
  const [to, setTo] = useState<string>(() => props.initialTo || rangeForPreset(props.initialPreset || 'all').to);
  const [typeFilter, setTypeFilter] = useState<LedgerTypeFilter>(props.initialType || 'All');
  const [viewMode, setViewMode] = useState<'detailed' | 'daily_summary'>('detailed');
  const [blocked, setBlocked] = useState(false);

  const handleSelectPreset = (newPreset: DatePreset) => {
    setPreset(newPreset);
    if (newPreset !== 'custom') {
      const range = rangeForPreset(newPreset);
      setFrom(range.from);
      setTo(range.to);
    }
  };

  const statementSupplier = useMemo(() => toStatementSupplier(props.supplier), [props.supplier]);

  // A reversed custom range (To before From) is swapped, the same way the page does it.
  const range = useMemo(() => (preset === 'custom' ? rangeForPreset('custom', from, to) : { from, to }), [preset, from, to]);

  const statement = useMemo(() => buildSupplierStatement({
    supplier: statementSupplier,
    purchases: props.purchases,
    materialPurchases: props.materialPurchases,
    transactions: props.transactions,
    from: range.from,
    to: range.to,
    kind: typeFilter,
    accountNames: props.accountNames
  }), [statementSupplier, props.purchases, props.materialPurchases, props.transactions, range, typeFilter, props.accountNames]);

  const handlePrint = () => {
    const opened = printSupplierLedger({
      company: props.company,
      supplier: statementSupplier,
      statement,
      typeFilter,
      viewMode
    });
    // Keep the dialog (and the user's choices) when the browser blocked the print window.
    if (!opened) {
      setBlocked(true);
      return;
    }
    props.onClose();
  };

  const milk = statement.milkStats;

  return (
    <Modal
      open={props.isOpen}
      onClose={props.onClose}
      size="lg"
      icon={<span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand-fg"><Printer className="size-5" /></span>}
      title="Ledger print / share"
      description={`${props.supplier.name}${props.supplier.phone ? ` · ${props.supplier.phone}` : ''}`}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
          {props.onSendWhatsApp && (
            <Button variant="secondary" leftIcon={<MessageCircle />} onClick={() => props.onSendWhatsApp?.(props.supplier, statement)}>
              WhatsApp
            </Button>
          )}
          <Button leftIcon={<Printer />} onClick={handlePrint}>Print ledger</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 text-fg">
        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <StepLabel icon={<CalendarDays />}>1. Tareekh chunein</StepLabel>
            <Badge tone="brand" className="-mt-2">{statement.rangeLabel}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MODAL_PRESETS.map(p => (
              <OptionTile key={p.id} active={preset === p.id} title={p.label} desc={p.desc} onClick={() => handleSelectPreset(p.id)} />
            ))}
          </div>
          {preset === 'custom' && (
            <div className="mt-3 grid grid-cols-2 gap-3 rounded-control border border-line bg-surface-2 p-3">
              <label className="text-xs font-semibold text-fg-muted">
                From
                <Input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} className="mt-1" />
              </label>
              <label className="text-xs font-semibold text-fg-muted">
                To
                <Input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} className="mt-1" />
              </label>
              <p className="col-span-2 text-[11px] text-fg-subtle">Dono tareekhein statement mein shamil hongi.</p>
            </div>
          )}
        </section>

        <section>
          <StepLabel icon={<Filter />}>2. Record type</StepLabel>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {TYPE_OPTIONS.map(t => (
              <OptionTile key={t.id} active={typeFilter === t.id} title={t.title} desc={t.desc} onClick={() => setTypeFilter(t.id)} />
            ))}
          </div>
        </section>

        <section>
          <StepLabel icon={<Layers />}>3. Print layout</StepLabel>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {LAYOUTS.map(layout => (
              <OptionTile key={layout.id} active={viewMode === layout.id} title={layout.title} desc={layout.desc} onClick={() => setViewMode(layout.id)} />
            ))}
          </div>
        </section>

        <section className="rounded-card border border-line bg-surface-2 p-4">
          <div className="mb-3 flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-fg-muted">Preview</span>
            <span className="text-fg-subtle">{statement.printRows.length} entries print hongi</span>
          </div>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-control border border-line bg-surface p-2.5">
              <dt className="text-[11px] font-semibold text-fg-subtle">Opening</dt>
              <dd className="mt-0.5 text-sm font-bold"><SupplierBalance value={statement.openingBalance} /></dd>
            </div>
            <div className="rounded-control border border-line bg-surface p-2.5">
              <dt className="text-[11px] font-semibold text-fg-subtle">Supplies (Cr)</dt>
              <dd className="mt-0.5 text-sm font-bold"><Money amount={statement.totalCredit} /></dd>
            </div>
            <div className="rounded-control border border-line bg-surface p-2.5">
              <dt className="text-[11px] font-semibold text-fg-subtle">Paid (Dr)</dt>
              <dd className="mt-0.5 text-sm font-bold text-success-fg"><Money amount={statement.netPaid} /></dd>
            </div>
            <div className="rounded-control border border-line bg-surface p-2.5">
              <dt className="text-[11px] font-semibold text-fg-subtle">Closing</dt>
              <dd className="mt-0.5 text-sm font-bold"><SupplierBalance value={statement.closingBalance} /></dd>
            </div>
          </dl>
          {milk && milk.totalLitres > 0 && (
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-fg-muted">
              <span>Milk <strong className="tabular-nums text-fg">{formatQty(milk.totalLitres)} L</strong></span>
              <span>Morning <strong className="tabular-nums text-fg">{formatQty(milk.morningLitres)} L</strong></span>
              <span>Evening <strong className="tabular-nums text-fg">{formatQty(milk.eveningLitres)} L</strong></span>
              <span>Avg rate <strong className="tabular-nums text-fg"><Money amount={milk.avgRate} />/L</strong></span>
            </p>
          )}
        </section>

        {blocked && (
          <p role="alert" className="flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2.5 text-xs font-medium text-warning-fg">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Browser ne print window rok di. Address bar mein popups allow karein, phir dobara Print dabayein.
          </p>
        )}
      </div>
    </Modal>
  );
}

export default SupplierLedgerPrintModal;
