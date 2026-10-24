import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Receipt,
  ArrowDownLeft,
  ArrowUpRight,
  ShoppingCart,
  User,
  Truck,
  Clock,
  Tag,
  Milk,
  Briefcase,
  Coffee,
  Package,
  Trash2
} from 'lucide-react';
import { formatTransactionTime } from '../lib/formatters';
import { useProgressiveList } from '../hooks/useProgressiveList';
import { confirmAction, isConfirmOpen } from './ui/ConfirmDialog';
import { Badge, Button, EmptyState, IconButton, LoadMoreRow, Money, SearchInput, SegmentedControl } from './ui';

export type ShiftActivityTab = 'bills' | 'sales' | 'collections' | 'expenses';

interface OutflowItem {
  id: string;
  referenceId?: string;
  title: string;
  amount: number;
  category: string;
  group?: string;
  partyName?: string;
  details?: string;
  time?: string;
}

interface CollectionItem {
  id: string;
  referenceId?: string;
  title: string;
  partyName?: string;
  amount: number;
  category: string;
  source: string;
  details?: string;
  time?: string;
}

interface CashSaleItem {
  id: string;
  invoice_no: string;
  customer_name?: string;
  total: number;
  cash_paid: number;
  refund_amount: number;
  net_cash: number;
  status: string;
  time?: string;
}

interface BillItem {
  id: string;
  invoice_no: string;
  customer_name?: string;
  total: number;
  payment_mode: string;
  status: string;
  time?: string;
}

interface PosShiftActivityDialogProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: ShiftActivityTab;
  onSelectTab: (tab: ShiftActivityTab) => void;
  initialCategory?: string;
  shiftTotals: {
    gross_sales: number;
    cash_sales: number;
    online_sales: number;
    credit_sales: number;
    cash_collections: number;
    cash_refunds: number;
    cash_expenses: number;
    cash_purchases: number;
    bills_count: number;
    expectedCash: number;
    drawer_outflows?: OutflowItem[];
    collections_list?: CollectionItem[];
    cash_sales_list?: CashSaleItem[];
    all_bills_list?: BillItem[];
  };
  canDelete?: boolean;
  onDeleteVendorTx?: (id: string) => Promise<boolean | void>;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const SEARCH_PLACEHOLDER: Record<ShiftActivityTab, string> = {
  expenses: 'Search expenses, payee, or milk supplier...',
  collections: 'Search customer name or collection note...',
  sales: 'Search invoice number or customer name...',
  bills: 'Search invoice number or customer name...',
};

const EMPTY_TEXT: Record<ShiftActivityTab, string> = {
  expenses: 'No payouts matching your search/filter',
  collections: 'No collections recorded in this shift',
  sales: 'No cash sales found',
  bills: 'No bills found',
};

const FOOTER_LABEL: Record<ShiftActivityTab, string> = {
  expenses: 'Total Shift Payouts',
  collections: 'Total Shift Collections',
  sales: 'Net POS Cash Sales',
  bills: 'Total Shift Bills',
};

const categoryIcon = (category: string) => {
  const c = category.toLowerCase();
  if (c.includes('milk')) return <Milk />;
  if (c.includes('vendor') || c.includes('staff')) return <Briefcase />;
  if (c.includes('hospitality') || c.includes('kheer') || c.includes('chai')) return <Coffee />;
  if (c.includes('material') || c.includes('raw')) return <Package />;
  return <Tag />;
};

const paymentModeTone = (mode: string) => {
  const m = String(mode).toLowerCase();
  return m === 'cash' ? 'success' : m === 'credit' ? 'warning' : 'info';
};

function Tile({ icon, label, children }: { icon?: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-control border border-line/70 bg-surface-2 px-3 py-2.5">
      <p className="flex items-center gap-1 truncate text-[11px] font-semibold text-fg-subtle [&_svg]:size-3 [&_svg]:shrink-0">
        {icon}
        {label}
      </p>
      <div className="mt-0.5 truncate text-base font-bold tabular-nums text-fg">{children}</div>
    </div>
  );
}

function TimeMeta({ time }: { time?: string }) {
  const text = time ? formatTransactionTime(time) : '';
  if (!text) return null;
  return (
    <span className="flex items-center gap-0.5 tabular-nums text-fg-faint">
      <Clock size={10} aria-hidden="true" />
      {text}
    </span>
  );
}

function RowShell({ icon, title, titleExtra, meta, amount, action }: {
  icon: React.ReactNode;
  title: React.ReactNode;
  titleExtra?: React.ReactNode;
  meta: React.ReactNode;
  amount: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 hidden size-9 shrink-0 items-center justify-center rounded-control bg-surface-2 text-fg-muted min-[400px]:flex [&_svg]:size-4" aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold text-fg">{title}</p>
            {titleExtra}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-fg-subtle">{meta}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <div className="text-right">{amount}</div>
        {action}
      </div>
    </li>
  );
}

const ExpenseRow = memo(function ExpenseRow({ item, canDelete, deleting, onDelete }: {
  item: OutflowItem;
  canDelete: boolean;
  deleting: boolean;
  onDelete: (referenceId: string, kind: 'payment' | 'refund') => void;
}) {
  const deletable = canDelete && Boolean(item.referenceId) && (item.category === 'Vendor / Staff Payment' || item.group === 'Vendor & Staff');
  return (
    <RowShell
      icon={categoryIcon(item.category)}
      title={item.title}
      meta={<>
        <Badge>{item.category}</Badge>
        {item.details && item.details !== item.category && <span className="min-w-0 truncate">· {item.details}</span>}
        <TimeMeta time={item.time} />
      </>}
      amount={<>
        <Money amount={-item.amount} className="block text-sm font-bold text-danger-fg sm:text-base" />
        <span className="block text-[10px] font-medium text-fg-faint">Drawer Cash</span>
      </>}
      action={deletable && (
        <IconButton
          aria-label="Delete Vendor Payment"
          icon={<Trash2 />}
          loading={deleting}
          className="text-fg-faint hover:bg-danger-soft hover:text-danger-fg"
          onClick={() => onDelete(item.referenceId!, 'payment')}
        />
      )}
    />
  );
});

const CollectionRow = memo(function CollectionRow({ item, canDelete, deleting, onDelete }: {
  item: CollectionItem;
  canDelete: boolean;
  deleting: boolean;
  onDelete: (referenceId: string, kind: 'payment' | 'refund') => void;
}) {
  const deletable = canDelete && Boolean(item.referenceId) && (item.category === 'Vendor Refund' || item.source === 'Vendor / Staff Refund');
  return (
    <RowShell
      icon={<ArrowDownLeft />}
      title={item.title}
      meta={<>
        <Badge tone="info">{item.source}</Badge>
        {item.details && item.details !== item.title && <span className="min-w-0 truncate">· {item.details}</span>}
        <TimeMeta time={item.time} />
      </>}
      amount={<>
        <span className="block text-sm font-bold tabular-nums text-success-fg sm:text-base">+<Money amount={item.amount} /></span>
        <span className="block text-[10px] font-medium text-fg-faint">Cash In</span>
      </>}
      action={deletable && (
        <IconButton
          aria-label="Delete Vendor Refund"
          icon={<Trash2 />}
          loading={deleting}
          className="text-fg-faint hover:bg-danger-soft hover:text-danger-fg"
          onClick={() => onDelete(item.referenceId!, 'refund')}
        />
      )}
    />
  );
});

const CashSaleRow = memo(function CashSaleRow({ item }: { item: CashSaleItem }) {
  return (
    <RowShell
      icon={<ShoppingCart />}
      title={<span className="tabular-nums">#{item.invoice_no}</span>}
      titleExtra={<Badge tone={item.status === 'Partially Returned' ? 'warning' : 'success'}>{item.status}</Badge>}
      meta={<>
        <span className="min-w-0 truncate">{item.customer_name || 'Walk-in Customer'}</span>
        <TimeMeta time={item.time} />
      </>}
      amount={<>
        <span className="block text-sm font-bold tabular-nums text-success-fg sm:text-base">+<Money amount={item.net_cash} /></span>
        {item.refund_amount > 0 && (
          <span className="block text-[10px] font-semibold text-warning-fg">Return: <Money amount={-item.refund_amount} /></span>
        )}
      </>}
    />
  );
});

const BillRow = memo(function BillRow({ item }: { item: BillItem }) {
  return (
    <RowShell
      icon={<Receipt />}
      title={<span className="tabular-nums">#{item.invoice_no}</span>}
      titleExtra={<Badge tone={paymentModeTone(item.payment_mode)}>{item.payment_mode}</Badge>}
      meta={<>
        <span className="min-w-0 truncate">{item.customer_name || 'Walk-in Customer'}</span>
        <TimeMeta time={item.time} />
      </>}
      amount={<>
        <Money amount={item.total} className="block text-sm font-bold text-fg sm:text-base" />
        <span className="block text-[10px] font-medium text-fg-faint">Total Bill</span>
      </>}
    />
  );
});

export const PosShiftActivityDialog: React.FC<PosShiftActivityDialogProps> = ({
  isOpen,
  onClose,
  activeTab,
  onSelectTab,
  initialCategory,
  shiftTotals,
  canDelete = false,
  onDeleteVendorTx
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(initialCategory || 'All');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const deletingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Every open starts from a clean filter. A category picked on the payouts tab would otherwise
  // carry over and hide every bill, sale and collection the next time the dialog opens.
  useEffect(() => {
    if (!isOpen) return;
    setSelectedCategory(initialCategory || 'All');
    setSearchTerm('');
  }, [initialCategory, isOpen]);

  const handleTabChange = (tab: ShiftActivityTab) => {
    setSelectedCategory('All');
    setSearchTerm('');
    onSelectTab(tab);
  };

  const query = searchTerm.trim().toLowerCase();
  const totalPayouts = Number(shiftTotals.cash_expenses || 0) + Number(shiftTotals.cash_purchases || 0);

  const outflows = useMemo(() => shiftTotals.drawer_outflows || [], [shiftTotals.drawer_outflows]);
  const collections = useMemo(() => shiftTotals.collections_list || [], [shiftTotals.collections_list]);
  const cashSalesList = useMemo(() => shiftTotals.cash_sales_list || [], [shiftTotals.cash_sales_list]);
  const allBillsList = useMemo(() => shiftTotals.all_bills_list || [], [shiftTotals.all_bills_list]);

  const expenseCategories = useMemo(() => {
    const cats = new Set<string>();
    outflows.forEach(item => {
      if (item.group) cats.add(item.group);
      else if (item.category) cats.add(item.category);
    });
    return ['All', ...Array.from(cats)];
  }, [outflows]);

  const filteredOutflows = useMemo(() => outflows.filter(item => {
    const matchesSearch =
      !query ||
      item.title.toLowerCase().includes(query) ||
      (item.partyName && item.partyName.toLowerCase().includes(query)) ||
      (item.details && item.details.toLowerCase().includes(query)) ||
      item.category.toLowerCase().includes(query);
    const matchesCat = selectedCategory === 'All' || item.group === selectedCategory || item.category === selectedCategory;
    return matchesSearch && matchesCat;
  }), [outflows, query, selectedCategory]);

  const expenseBreakdown = useMemo(() => {
    let milk = 0;
    let vendor = 0;
    let petty = 0;
    let material = 0;
    outflows.forEach(item => {
      if (item.category === 'Milk Purchase' || item.group === 'Milk Intake') milk += item.amount;
      else if (item.category === 'Vendor / Staff Payment' || item.group === 'Vendor & Staff') vendor += item.amount;
      else if (item.category === 'Purchase' || item.group === 'Material Purchases') material += item.amount;
      else petty += item.amount;
    });
    return { milk, vendor, petty, material };
  }, [outflows]);

  const filteredCollections = useMemo(() => collections.filter(item => {
    const matchesSearch =
      !query ||
      item.title.toLowerCase().includes(query) ||
      (item.partyName && item.partyName.toLowerCase().includes(query)) ||
      (item.details && item.details.toLowerCase().includes(query));
    const matchesCat = selectedCategory === 'All' || item.source === selectedCategory || item.category === selectedCategory;
    return matchesSearch && matchesCat;
  }), [collections, query, selectedCategory]);

  const collectionBreakdown = useMemo(() => {
    let ledger = 0;
    let delivery = 0;
    let refunds = 0;
    collections.forEach(item => {
      if (item.source === 'Customer Ledger' || item.category === 'Customer Ledger') ledger += item.amount;
      else if (item.source === 'Daily Delivery' || item.category === 'Daily Delivery') delivery += item.amount;
      else refunds += item.amount;
    });
    return { ledger, delivery, refunds };
  }, [collections]);

  const filteredCashSales = useMemo(() => cashSalesList.filter(item => {
    const matchesSearch =
      !query ||
      item.invoice_no.toLowerCase().includes(query) ||
      (item.customer_name && item.customer_name.toLowerCase().includes(query));
    const matchesCat =
      selectedCategory === 'All' ||
      (selectedCategory === 'Returns' && (item.refund_amount > 0 || item.status === 'Partially Returned')) ||
      (selectedCategory === 'Completed' && item.status === 'Completed' && item.refund_amount === 0);
    return matchesSearch && matchesCat;
  }), [cashSalesList, query, selectedCategory]);

  const filteredAllBills = useMemo(() => allBillsList.filter(item => {
    const matchesSearch =
      !query ||
      item.invoice_no.toLowerCase().includes(query) ||
      (item.customer_name && item.customer_name.toLowerCase().includes(query));
    const matchesCat = selectedCategory === 'All' || String(item.payment_mode).toLowerCase() === selectedCategory.toLowerCase();
    return matchesSearch && matchesCat;
  }), [allBillsList, query, selectedCategory]);

  const billModeCounts = useMemo(() => {
    const counts = { cash: 0, credit: 0, online: 0 };
    allBillsList.forEach(bill => {
      const mode = String(bill.payment_mode).toLowerCase();
      if (mode === 'cash' || mode === 'credit' || mode === 'online') counts[mode] += 1;
    });
    return counts;
  }, [allBillsList]);

  const activeRows: unknown[] =
    activeTab === 'expenses' ? filteredOutflows
      : activeTab === 'collections' ? filteredCollections
        : activeTab === 'sales' ? filteredCashSales
          : filteredAllBills;
  // Busy shifts have hundreds of bills: render a page at a time.
  const { visibleItems, hiddenCount, sentinelRef, showMore, showAll } = useProgressiveList(activeRows, 60, `${activeTab}|${query}|${selectedCategory}`);

  const canDeleteRows = canDelete && Boolean(onDeleteVendorTx);
  const handleDelete = useCallback(async (referenceId: string, kind: 'payment' | 'refund') => {
    if (!onDeleteVendorTx || deletingRef.current) return;
    const confirmed = await confirmAction(kind === 'payment'
      ? {
          title: 'Delete this vendor payment?',
          consequences: ['The payment amount goes back into the drawer / account.', "The vendor's balance due goes back to what it was.", "This can't be undone."],
        }
      : {
          title: 'Delete this vendor refund?',
          consequences: ['The refund amount is taken back out of the account.', "The vendor's balance due goes back to what it was.", "This can't be undone."],
        });
    if (!confirmed || deletingRef.current) return;
    // One delete at a time: a second click on the same row must not post the reversal twice.
    deletingRef.current = true;
    setDeletingId(referenceId);
    try {
      await onDeleteVendorTx(referenceId);
    } finally {
      deletingRef.current = false;
      setDeletingId(null);
    }
  }, [onDeleteVendorTx]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // A confirmation opened from this dialog handles its own Esc.
      if (e.key !== 'Escape' || isConfirmOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      // Esc in a filled search box clears it first (handled here: this capture listener runs before the field).
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLInputElement && target.type === 'search' && target.value) {
        setSearchTerm('');
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  // Focus moves into the dialog and returns to the link that opened it.
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => panelRef.current?.focus({ preventScroll: true }), 0);
    return () => {
      window.clearTimeout(timer);
      if (previous && previous !== document.body && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const nodes = (Array.from(panelRef.current.querySelectorAll(FOCUSABLE)) as HTMLElement[]).filter(node => node.getClientRects().length > 0);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const renderRows = () => {
    switch (activeTab) {
      case 'expenses':
        return (visibleItems as OutflowItem[]).map((item, idx) => (
          <ExpenseRow
            key={item.id || idx}
            item={item}
            canDelete={canDeleteRows}
            deleting={Boolean(item.referenceId) && deletingId === item.referenceId}
            onDelete={handleDelete}
          />
        ));
      case 'collections':
        return (visibleItems as CollectionItem[]).map((item, idx) => (
          <CollectionRow
            key={item.id || idx}
            item={item}
            canDelete={canDeleteRows}
            deleting={Boolean(item.referenceId) && deletingId === item.referenceId}
            onDelete={handleDelete}
          />
        ));
      case 'sales':
        return (visibleItems as CashSaleItem[]).map(item => <CashSaleRow key={item.id} item={item} />);
      default:
        return (visibleItems as BillItem[]).map(item => <BillRow key={item.id} item={item} />);
    }
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-150">
      <div className="absolute inset-0 bg-slate-950/50" aria-hidden="true" onClick={onClose} />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shift-activity-title"
        tabIndex={-1}
        onKeyDown={handlePanelKeyDown}
        className="relative flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-card border border-line bg-surface shadow-e3 outline-none animate-in zoom-in-95 duration-200"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-brand-soft text-brand-fg" aria-hidden="true">
              <Receipt size={18} />
            </span>
            <div className="min-w-0">
              <h2 id="shift-activity-title" className="text-base font-bold tracking-tight text-fg sm:text-lg">
                Shift Activity & Breakdown
              </h2>
              <p className="mt-0.5 text-xs text-fg-subtle">
                Complete audit of transactions recorded in this active shift session
              </p>
            </div>
          </div>
          <IconButton aria-label="Close dialog" icon={<X />} onClick={onClose} className="-mr-1 shrink-0" />
        </div>

        <div className="shrink-0 border-b border-line px-4 py-3 sm:px-5">
          <SegmentedControl<ShiftActivityTab>
            aria-label="Shift activity"
            value={activeTab}
            onChange={handleTabChange}
            fullWidth
            options={[
              { value: 'bills', label: 'Bills', count: shiftTotals.bills_count },
              { value: 'sales', label: 'Cash sales', count: cashSalesList.length },
              { value: 'collections', label: 'Collections', count: collections.length },
              { value: 'expenses', label: 'Expenses', count: outflows.length },
            ]}
          />
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          {activeTab === 'expenses' && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile icon={<Milk />} label="Milk Purchases"><Money amount={expenseBreakdown.milk} /></Tile>
              <Tile icon={<Briefcase />} label="Vendor & Staff"><Money amount={expenseBreakdown.vendor} /></Tile>
              <Tile icon={<Tag />} label="Petty Expenses"><Money amount={expenseBreakdown.petty} /></Tile>
              <Tile icon={<Package />} label="Materials"><Money amount={expenseBreakdown.material} /></Tile>
            </div>
          )}
          {activeTab === 'collections' && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Tile icon={<User />} label="Customer Ledger"><Money amount={collectionBreakdown.ledger} /></Tile>
              <Tile icon={<Truck />} label="Delivery Collections"><Money amount={collectionBreakdown.delivery} /></Tile>
              <Tile icon={<ArrowDownLeft />} label="Vendor Refunds"><Money amount={collectionBreakdown.refunds} /></Tile>
            </div>
          )}
          {activeTab === 'sales' && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Tile icon={<ShoppingCart />} label="Net Cash Sales"><span className="text-success-fg">+<Money amount={shiftTotals.cash_sales} /></span></Tile>
              <Tile icon={<ArrowUpRight />} label="Cash Returns Issued"><Money amount={-(shiftTotals.cash_refunds || 0)} className="text-warning-fg" /></Tile>
              <Tile icon={<Receipt />} label="Cash Bills">{cashSalesList.length} bills</Tile>
            </div>
          )}
          {activeTab === 'bills' && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile label="Total Bills">{allBillsList.length} bills</Tile>
              <Tile label="Cash Bills">{billModeCounts.cash}</Tile>
              <Tile label="Credit Bills">{billModeCounts.credit}</Tile>
              <Tile label="Online Bills">{billModeCounts.online}</Tile>
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder={SEARCH_PLACEHOLDER[activeTab]}
              aria-label="Search shift activity"
              className="w-full sm:flex-1"
            />
            {activeTab === 'expenses' && expenseCategories.length > 1 && (
              <SegmentedControl<string>
                aria-label="Expense category"
                size="sm"
                value={selectedCategory}
                onChange={setSelectedCategory}
                className="sm:max-w-[55%]"
                options={expenseCategories.map(cat => ({ value: cat, label: cat }))}
              />
            )}
          </div>

          {activeRows.length === 0 ? (
            <div className="rounded-card border border-dashed border-line">
              <EmptyState size="compact" icon={<Receipt />} title={EMPTY_TEXT[activeTab]} />
            </div>
          ) : (
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              <ul className="divide-y divide-line/70">{renderRows()}</ul>
              <LoadMoreRow sentinelRef={sentinelRef} hiddenCount={hiddenCount} onShowMore={showMore} onShowAll={showAll} />
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <span className="block text-[11px] font-semibold text-fg-subtle">{FOOTER_LABEL[activeTab]}</span>
            <span className="block text-base font-bold tabular-nums text-fg sm:text-lg">
              {activeTab === 'expenses' && <Money amount={-totalPayouts} />}
              {activeTab === 'collections' && <>+<Money amount={shiftTotals.cash_collections} /></>}
              {activeTab === 'sales' && <>+<Money amount={shiftTotals.cash_sales} /></>}
              {activeTab === 'bills' && `${shiftTotals.bills_count} bills`}
            </span>
          </div>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
