import React, { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Eye, FileText, MapPin, MessageCircle, Pencil, Phone, Plus, Printer, RotateCcw, ShoppingCart, Trash2,
  ChevronDown, ReceiptText, Wallet, CalendarClock, ListOrdered,
} from 'lucide-react';
import {
  Badge, Button, Card, EmptyState, IconButton, LoadMoreRow, Money, SearchInput, SegmentedControl, StatCard,
  TBody, TD, TH, THead, TR, Table, TableContainer, Toolbar,
} from '../ui';
import { cn } from '../../lib/cn';
import { formatCurrency } from '../../lib/formatters';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import type { Customer } from '../../types';
import { BalanceBadge, CustomerAvatar, EntryTypeBadge, KhataBalance, usePrintMode } from './CustomerBits';
import {
  balanceState, customerPhones, filterLedger, formatDay, hasWhatsApp, isReturnEntry, matchesLedgerType,
  type LedgerEntry, type LedgerFilter, type LedgerSummary,
} from './customerUtils';
import type { ShopInfo } from './printDocs';

// A4 portrait leaves about 700px: printed cells drop the screen padding so all six columns fit.
const PRINT_CELL = 'print:px-1.5 print:py-1 print:first:pl-0';

const isBillEntry =(entry: LedgerEntry) => Boolean(entry.sale) || entry.type === 'Sale' || entry.description.includes('POS Bill');

const FILTER_LABELS: Record<LedgerFilter, string> = {
  All: 'All', Sale: 'Invoices', Payment: 'Payments', Charge: 'Charges', Return: 'Returns',
};

const SHORT_FILTER_LABELS: Record<LedgerFilter, string> = {
  All: 'All', Sale: 'Bills', Payment: 'Paid', Charge: 'Charge', Return: 'Return',
};

const tileLabel = (short: string, full: string) => <><span className="sm:hidden">{short}</span><span className="hidden sm:inline">{full}</span></>;

interface EntryHandlers {
  onOpen: (entry: LedgerEntry) => void;
  onDelete: (entry: LedgerEntry) => void;
}

const EntryDetails = ({ entry }: { entry: LedgerEntry }) => {
  const ret = isReturnEntry(entry);
  return (
    <>
      <span className={cn('font-semibold', ret ? 'text-fg-subtle line-through' : 'text-fg')}>{entry.description}</span>
      {entry.return_reason && (
        <span className="mt-1 block text-xs font-medium text-danger-fg">
          <span className="font-bold">Reason:</span> {entry.return_reason}
        </span>
      )}
      {entry.refund_amount !== undefined && entry.refund_amount > 0 && (
        <span className="mt-0.5 block text-xs font-semibold tabular-nums text-danger-fg">Refund: {formatCurrency(entry.refund_amount)}</span>
      )}
      {entry.note && !entry.description.includes(entry.note) && <span className="mt-0.5 block text-xs italic text-fg-subtle">Note: {entry.note}</span>}
    </>
  );
};

const amountCell = (value: number, tone: string, struck: boolean) =>
  value > 0 ? <span className={cn(struck ? 'text-fg-faint line-through' : tone)}>{formatCurrency(value)}</span> : <span className="text-fg-faint">—</span>;

const LedgerTableRow = memo(function LedgerTableRow({ entry, onOpen, onDelete }: { entry: LedgerEntry } & EntryHandlers) {
  const ret = isReturnEntry(entry);
  const bill = isBillEntry(entry);
  return (
    <TR className={cn(ret && 'bg-danger-soft/40', entry.isPartiallyReturned && 'bg-warning-soft/40')}>
      <TD className={cn('whitespace-nowrap tabular-nums text-fg-muted', PRINT_CELL)}>{entry.dateLabel}</TD>
      <TD className={cn('min-w-[240px] print:min-w-0', PRINT_CELL)}>
        <button type="button" onClick={() => onOpen(entry)} className="w-full cursor-pointer rounded-md text-left text-[13px] hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring print:text-[11px]" title="View details">
          <EntryDetails entry={entry} />
        </button>
      </TD>
      <TD className={cn('text-center', PRINT_CELL)}><EntryTypeBadge entry={entry} /></TD>
      <TD numeric className={PRINT_CELL}>{amountCell(entry.debit, 'text-danger-fg', ret)}</TD>
      <TD numeric className={PRINT_CELL}>{amountCell(entry.credit, 'text-success-fg', ret)}</TD>
      <TD numeric className={cn('whitespace-nowrap bg-surface-2/50', PRINT_CELL)}><KhataBalance balance={entry.runningBalance} label="drcr" /></TD>
      <TD className="print:hidden">
        <div className="flex items-center justify-end gap-1">
          {bill ? (
            <Button variant="soft" size="sm" leftIcon={<FileText />} onClick={() => onOpen(entry)}>Bill</Button>
          ) : (
            <IconButton size="sm" aria-label="View voucher" icon={<Eye />} onClick={() => onOpen(entry)} />
          )}
          {entry.canDelete && (
            <IconButton size="sm" aria-label="Delete entry" icon={<Trash2 />} className="hover:bg-danger-soft hover:text-danger-fg" onClick={() => onDelete(entry)} />
          )}
        </div>
      </TD>
    </TR>
  );
});

const LedgerCard = memo(function LedgerCard({ entry, onOpen, onDelete }: { entry: LedgerEntry } & EntryHandlers) {
  const ret = isReturnEntry(entry);
  return (
    <div
      className={cn(
        'space-y-2.5 rounded-card border bg-surface p-3 shadow-e1',
        ret ? 'border-danger/30 bg-danger-soft/30' : entry.isPartiallyReturned ? 'border-warning/30 bg-warning-soft/30' : 'border-line',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-semibold tabular-nums text-fg-subtle">{entry.dateLabel}</span>
          <EntryTypeBadge entry={entry} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="soft" size="sm" leftIcon={<Eye />} onClick={() => onOpen(entry)}>{isBillEntry(entry) ? 'Bill' : 'Voucher'}</Button>
          {entry.canDelete && (
            <IconButton size="sm" aria-label="Delete entry" icon={<Trash2 />} className="hover:bg-danger-soft hover:text-danger-fg" onClick={() => onDelete(entry)} />
          )}
        </div>
      </div>
      <button type="button" onClick={() => onOpen(entry)} className="block w-full cursor-pointer text-left text-[13px] leading-snug">
        <EntryDetails entry={entry} />
      </button>
      <div className="grid grid-cols-3 gap-1 rounded-control bg-surface-2 p-2 text-center text-xs font-semibold tabular-nums">
        <div>
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Debit</span>
          {amountCell(entry.debit, 'text-danger-fg', ret)}
        </div>
        <div>
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Credit</span>
          {amountCell(entry.credit, 'text-success-fg', ret)}
        </div>
        <div>
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">Balance</span>
          <KhataBalance balance={entry.runningBalance} label="drcr" />
        </div>
      </div>
    </div>
  );
});

/** Statement letterhead: only on paper, where the screen's profile card and buttons are hidden. */
const StatementPrintHeader = ({
  customer, ledger, shop, filter, search, shownCount,
}: { customer: Customer; ledger: LedgerSummary; shop: ShopInfo; filter: LedgerFilter; search: string; shownCount: number }) => {
  const today = formatDay(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }));
  const state = balanceState(customer.balance);
  const filtered = filter !== 'All' || search.trim() !== '';
  return (
    <div className="hidden text-black print:block">
      <div className="flex items-start justify-between border-b-2 border-black pb-3">
        <div>
          <h1 className="text-xl font-black tracking-tight">{shop.companyName}</h1>
          {shop.address && <p className="text-xs">{shop.address}</p>}
          {shop.phone && <p className="text-xs">Tel: {shop.phone}</p>}
        </div>
        <div className="text-right">
          <p className="text-base font-bold uppercase tracking-wider">Ledger Statement</p>
          <p className="text-xs">Date: {today}</p>
        </div>
      </div>
      <div className="flex items-start justify-between gap-6 py-3 text-xs">
        <div>
          <p className="text-sm font-bold">{customer.name}</p>
          {customer.phone && <p>Phone: {customer.phone}</p>}
          {(customer.city || customer.address) && <p>{[customer.city, customer.address].filter(Boolean).join(' — ')}</p>}
        </div>
        <table className="text-right text-xs">
          <tbody>
            <tr><td className="pr-3">Total billed</td><td className="font-bold">{formatCurrency(ledger.totalDebit)}</td></tr>
            <tr><td className="pr-3">Total received</td><td className="font-bold">{formatCurrency(ledger.totalCredit)}</td></tr>
            <tr>
              <td className="pr-3">Current balance</td>
              <td className="font-black">
                {formatCurrency(Math.abs(customer.balance || 0))} {state === 'due' ? 'Due (Dr)' : state === 'advance' ? 'Advance (Cr)' : 'Settled'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {filtered && (
        <p className="mb-2 border border-black px-2 py-1 text-[11px]">
          Filtered statement: {FILTER_LABELS[filter]}{search.trim() ? `, search "${search.trim()}"` : ''} — {shownCount} of {ledger.entries.length} entries.
        </p>
      )}
    </div>
  );
};

export interface CustomerDetailProps {
  customer: Customer;
  ledger: LedgerSummary;
  shop: ShopInfo;
  isMdScreen: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canPay: boolean;
  canOrders: boolean;
  onBack: () => void;
  onEdit: (customer: Customer) => void;
  onDelete: (customer: Customer) => void;
  onReactivate: (customer: Customer) => void;
  onRecordPayment: (customer: Customer) => void;
  onWhatsApp: (customer: Customer) => void;
  onOpenOrders: (customer: Customer) => void;
  onOpenEntry: (entry: LedgerEntry) => void;
  onDeleteEntry: (entry: LedgerEntry) => void;
}

export const CustomerDetail: React.FC<CustomerDetailProps> = function CustomerDetail({
  customer, ledger, shop, isMdScreen, canEdit, canDelete, canPay, canOrders,
  onBack, onEdit, onDelete, onReactivate, onRecordPayment, onWhatsApp, onOpenOrders, onOpenEntry, onDeleteEntry,
}: CustomerDetailProps) {
  const [filter, setFilter] = useState<LedgerFilter>('All');
  const [search, setSearch] = useState('');
  const [showContact, setShowContact] = useState(false);
  const deferredSearch = useDeferredValue(search);
  const printing = usePrintMode();
  const rootRef = useRef<HTMLDivElement>(null);

  // Opening a ledger from far down the list used to land in the middle of it.
  useEffect(() => {
    rootRef.current?.closest('.workspace-pane')?.scrollTo({ top: 0 });
  }, []);

  const entries = useMemo(() => filterLedger(ledger.entries, filter, deferredSearch), [ledger.entries, filter, deferredSearch]);
  const typeCounts = useMemo(() => {
    const counts: Record<LedgerFilter, number> = { All: ledger.entries.length, Sale: 0, Payment: 0, Charge: 0, Return: 0 };
    for (const entry of ledger.entries) {
      (['Sale', 'Payment', 'Charge', 'Return'] as const).forEach(type => { if (matchesLedgerType(entry, type)) counts[type] += 1; });
    }
    return counts;
  }, [ledger.entries]);
  const lastPayment = useMemo(() => ledger.entries.find(e => e.type === 'Payment' && e.credit > 0), [ledger.entries]);

  const ledgerWindow = useProgressiveList<LedgerEntry>(entries, 60, `${filter}|${deferredSearch}`);
  const phones = customerPhones(customer);
  const wa = hasWhatsApp(customer);
  const isActive = customer.isActive !== false;
  const state = balanceState(customer.balance);
  const showTable = isMdScreen || printing;
  const contactOpen = isMdScreen || showContact;
  const gap = Math.abs(ledger.ledgerGap || 0) >= 1;

  return (
    <div ref={rootRef} className="flex flex-col gap-4 animate-fade-up">
      <StatementPrintHeader customer={customer} ledger={ledger} shop={shop} filter={filter} search={deferredSearch} shownCount={entries.length} />

      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button variant="ghost" leftIcon={<ArrowLeft />} onClick={onBack}>All customers</Button>
        <div className="flex items-center gap-1.5">
          {canOrders && <IconButton variant="secondary" aria-label="Customer orders" icon={<ShoppingCart />} onClick={() => onOpenOrders(customer)} />}
          {wa && <IconButton variant="secondary" aria-label="Send statement on WhatsApp" icon={<MessageCircle />} onClick={() => onWhatsApp(customer)} />}
          <IconButton variant="secondary" aria-label="Print statement" icon={<Printer />} onClick={() => window.print()} />
          {canEdit && <IconButton variant="secondary" aria-label="Edit customer" icon={<Pencil />} onClick={() => onEdit(customer)} />}
        </div>
      </div>

      {/* Side by side only on very wide screens; below that the ledger gets the full width it needs. */}
      <div className="grid items-start gap-4 2xl:grid-cols-[320px_minmax(0,1fr)] print:block">
        <Card className="overflow-hidden print:hidden 2xl:sticky 2xl:top-4">
          <div className="grid md:grid-cols-2 2xl:block">
            <div className="pb-4 sm:pb-5">
              <div className="flex items-start gap-3 p-4 sm:p-5">
                <CustomerAvatar name={customer.name} size="lg" />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-bold tracking-tight text-fg">{customer.name}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone={isActive ? 'success' : 'neutral'} dot>{isActive ? 'Active' : 'Inactive'}</Badge>
                    <span className="truncate text-xs text-fg-subtle">{customer.city || 'Dairy client'}</span>
                  </div>
                </div>
              </div>

              <div className={cn('mx-4 rounded-control p-4 sm:mx-5', state === 'due' ? 'bg-danger-soft' : state === 'advance' ? 'bg-success-soft' : 'bg-surface-2')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-fg-muted">Current balance</span>
                  <BalanceBadge balance={customer.balance} />
                </div>
                <KhataBalance balance={customer.balance} label="none" className="mt-2" amountClassName="text-3xl font-bold tracking-tight" />
                {canPay && (
                  <Button fullWidth className="mt-3" leftIcon={<Plus />} onClick={() => onRecordPayment(customer)}>Record payment</Button>
                )}
              </div>
            </div>

            <div className="border-t border-line md:border-l md:border-t-0 2xl:border-l-0 2xl:border-t">
              {!isMdScreen && (
                <button
                  type="button"
                  onClick={() => setShowContact(v => !v)}
                  aria-expanded={showContact}
                  className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left text-[13px] font-semibold text-fg-muted hover:bg-surface-2"
                >
                  Contact & details
                  <ChevronDown className={cn('size-4 transition-transform duration-150', showContact && 'rotate-180')} aria-hidden="true" />
                </button>
              )}

              {contactOpen && (
                <div className="space-y-2 px-4 pb-4 text-[13px] sm:px-5 md:pt-5">
                  <p className="hidden text-[11px] font-semibold uppercase tracking-wider text-fg-subtle md:block">Contact & details</p>
                  {customer.phone ? (
                    <a href={`tel:${customer.phone}`} className="flex items-center justify-between gap-2 rounded-control bg-surface-2 px-3 py-2 hover:bg-surface-3">
                      <span className="flex items-center gap-2 font-semibold tabular-nums text-fg"><Phone className="size-3.5 text-fg-subtle" aria-hidden="true" />{customer.phone}</span>
                      {wa && <Badge tone="success">WhatsApp</Badge>}
                    </a>
                  ) : (
                    <p className="text-xs italic text-fg-subtle">No primary phone on record</p>
                  )}
                  {customer.whatsapp && customer.whatsapp !== customer.phone && (
                    <a href={`tel:${customer.whatsapp}`} className="flex items-center justify-between gap-2 rounded-control bg-surface-2 px-3 py-2 hover:bg-surface-3">
                      <span className="flex items-center gap-2 tabular-nums text-fg-muted"><MessageCircle className="size-3.5 text-fg-subtle" aria-hidden="true" />{customer.whatsapp}</span>
                      <span className="text-xs text-fg-subtle">WhatsApp</span>
                    </a>
                  )}
                  {phones.map((p, idx) => (
                    <a key={idx} href={`tel:${p.phone}`} className="flex items-center justify-between gap-2 rounded-control bg-surface-2 px-3 py-2 hover:bg-surface-3">
                      <span className="flex items-center gap-2 tabular-nums text-fg-muted"><Phone className="size-3.5 text-fg-subtle" aria-hidden="true" />{p.phone}</span>
                      <span className="text-xs text-fg-subtle">{p.label || 'Secondary'}{p.is_whatsapp ? ' · WA' : ''}</span>
                    </a>
                  ))}
                  {(customer.city || customer.address) && (
                    <div className="rounded-control bg-surface-2 px-3 py-2">
                      <span className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-fg-subtle"><MapPin className="size-3" aria-hidden="true" /> Delivery address</span>
                      <p className="leading-snug text-fg-muted">
                        {customer.city && <strong className="text-fg">{customer.city}</strong>}
                        {customer.city && customer.address ? ' — ' : ''}
                        {customer.address}
                      </p>
                    </div>
                  )}
                  {customer.notes && (
                    <div className="rounded-control bg-surface-2 px-3 py-2">
                      <span className="mb-0.5 block text-[11px] font-semibold text-fg-subtle">Remarks</span>
                      <p className="italic leading-snug text-fg-muted">{customer.notes}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {(canEdit || canDelete) && (
            <div className="flex gap-2 border-t border-line bg-surface-2/60 px-4 py-3 sm:px-5">
              {canEdit && <Button variant="secondary" size="sm" className="flex-1 md:flex-none 2xl:flex-1" leftIcon={<Pencil />} onClick={() => onEdit(customer)}>Edit customer</Button>}
              {canEdit && !isActive && (
                <Button variant="soft" size="sm" leftIcon={<RotateCcw />} onClick={() => onReactivate(customer)}>Reactivate</Button>
              )}
              {canDelete && (
                <IconButton variant="danger-soft" size="sm" aria-label="Delete / archive customer" icon={<Trash2 />} onClick={() => onDelete(customer)} className="md:ml-auto 2xl:ml-0" />
              )}
            </div>
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          {gap && (
            <div role="status" className="flex items-start gap-2 rounded-control border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs text-warning-fg">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                The ledger balance ({formatCurrency(Number(customer.balance || 0))}) is {formatCurrency(Math.abs(ledger.ledgerGap || 0))}{' '}
                {(ledger.ledgerGap || 0) > 0 ? 'more' : 'less'} than the total of the entries below. Older entries didn't load or an entry is wrong. Check before you rely on this report.
              </span>
            </div>
          )}

          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4 print:hidden" aria-label="Ledger summary">
            <StatCard
              label={tileLabel('Billed', 'Total billed')}
              value={<Money amount={ledger.totalDebit} compact={!isMdScreen} />}
              icon={<ReceiptText />}
              hint={ledger.returnedAmount > 0 ? `${formatCurrency(ledger.returnedAmount)} returned` : 'Total debit'}
            />
            <StatCard label={tileLabel('Received', 'Total received')} value={<Money amount={ledger.totalCredit} compact={!isMdScreen} />} icon={<Wallet />} tone="success" hint="Total credit" />
            <StatCard
              label="Entries"
              value={ledger.entries.length.toLocaleString('en-PK')}
              icon={<ListOrdered />}
              hint={entries.length !== ledger.entries.length ? `${entries.length} shown` : undefined}
            />
            <StatCard
              label={tileLabel('Last paid', 'Last payment')}
              value={lastPayment ? <Money amount={lastPayment.credit} compact={!isMdScreen} /> : '—'}
              icon={<CalendarClock />}
              hint={lastPayment ? lastPayment.dateLabel : 'None yet'}
            />
          </section>

          <Toolbar className="print:hidden">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Entries, bill #, note, amount..."
              aria-label="Search ledger entries"
              className="w-full sm:w-64"
            />
            {/* Phones get short labels without counts so all five types fit in 390px. */}
            <SegmentedControl<LedgerFilter>
              aria-label="Entry type filter"
              size="sm"
              value={filter}
              onChange={setFilter}
              className="w-full sm:w-fit"
              fullWidth={!isMdScreen}
              options={(Object.keys(FILTER_LABELS) as LedgerFilter[]).map(key => ({
                value: key,
                label: isMdScreen ? FILTER_LABELS[key] : SHORT_FILTER_LABELS[key],
                count: isMdScreen ? typeCounts[key] : undefined,
              }))}
            />
            <div className="ml-auto hidden sm:block">
              <Button variant="secondary" size="sm" leftIcon={<Printer />} onClick={() => window.print()}>Print</Button>
            </div>
          </Toolbar>

          {showTable ? (
            <TableContainer className="print:border-0 print:shadow-none">
              {entries.length === 0 ? (
                <EmptyState
                  size="compact"
                  icon={<FileText />}
                  title={ledger.entries.length === 0 ? 'No entries yet' : 'No entries match this filter'}
                  description={ledger.entries.length === 0 ? 'The ledger starts with a payment or a POS bill.' : 'Try a different search or filter.'}
                />
              ) : (
                <Table>
                  <THead>
                    <tr>
                      <TH className={PRINT_CELL}>Date</TH>
                      <TH className={PRINT_CELL}>Description / items</TH>
                      <TH className={cn('text-center', PRINT_CELL)}>Type</TH>
                      <TH numeric className={PRINT_CELL}>Debit (sale)</TH>
                      <TH numeric className={PRINT_CELL}>Credit (paid)</TH>
                      <TH numeric className={PRINT_CELL}>Running balance</TH>
                      <TH className="w-24 text-right print:hidden">Action</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {ledgerWindow.visibleItems.map(entry => (
                      <LedgerTableRow key={entry.id} entry={entry} onOpen={onOpenEntry} onDelete={onDeleteEntry} />
                    ))}
                    <LoadMoreRow colSpan={7} sentinelRef={ledgerWindow.sentinelRef} hiddenCount={ledgerWindow.hiddenCount} onShowMore={ledgerWindow.showMore} onShowAll={ledgerWindow.showAll} />
                  </TBody>
                </Table>
              )}
            </TableContainer>
          ) : (
            <div className="space-y-2.5">
              {entries.length === 0 ? (
                <div className="rounded-card border border-line bg-surface shadow-e1">
                  <EmptyState
                    size="compact"
                    icon={<FileText />}
                    title={ledger.entries.length === 0 ? 'No entries yet' : 'No entries match this filter'}
                    description={ledger.entries.length === 0 ? 'The ledger starts with a payment or a POS bill.' : 'Try a different search or filter.'}
                  />
                </div>
              ) : (
                ledgerWindow.visibleItems.map(entry => <LedgerCard key={entry.id} entry={entry} onOpen={onOpenEntry} onDelete={onDeleteEntry} />)
              )}
              <LoadMoreRow sentinelRef={ledgerWindow.sentinelRef} hiddenCount={ledgerWindow.hiddenCount} onShowMore={ledgerWindow.showMore} onShowAll={ledgerWindow.showAll} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
