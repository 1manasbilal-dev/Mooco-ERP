import React, { memo } from 'react';
import { Archive, ArrowUpDown, FileText, MessageCircle, Pencil, Trash2, UserCheck, UserPlus, Users, Wallet, WalletCards } from 'lucide-react';
import {
  Badge, Button, EmptyState, IconButton, LoadMoreRow, Money, SearchInput, SegmentedControl, Select, Skeleton, StatCard, StatGrid,
  TBody, TD, TH, THead, TR, Table, TableContainer, Toolbar,
} from '../ui';
import { cn } from '../../lib/cn';
import type { Customer } from '../../types';
import { CustomerAvatar, KhataBalance } from './CustomerBits';
import { customerPhones, hasWhatsApp } from './customerUtils';

export type BalanceFilter = 'All' | 'Due' | 'Advance' | 'Settled';
export type StatusFilter = 'Active' | 'Inactive' | 'All';
/** `default` keeps the order the customers were loaded in. */
export type CustomerSort = 'default' | 'name' | 'balance';

const SortHeader = ({
  label, value, sort, onSortChange, numeric, className,
}: { label: string; value: Exclude<CustomerSort, 'default'>; sort: CustomerSort; onSortChange: (sort: CustomerSort) => void; numeric?: boolean; className?: string }) => {
  const active = sort === value;
  return (
    <TH numeric={numeric} className={className} aria-sort={active ? (value === 'name' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSortChange(active ? 'default' : value)}
        title={active ? 'Back to the original order' : value === 'name' ? 'Sort by name (A-Z)' : 'Highest balance due first'}
        className={cn('inline-flex cursor-pointer items-center gap-1 uppercase tracking-wider hover:text-fg', active && 'text-brand-fg')}
      >
        {label}
        <ArrowUpDown className={cn('size-3', active ? 'opacity-100' : 'opacity-40')} aria-hidden="true" />
      </button>
    </TH>
  );
};

export interface CustomerStatsData {
  total: number;
  active: number;
  inactive: number;
  dueTotal: number;
  dueCount: number;
  advanceTotal: number;
  advanceCount: number;
}

/** Short label on phones, where two tiles share 390px, the full one from `sm` up. */
const tileLabel = (short: string, full: string) => <><span className="sm:hidden">{short}</span><span className="hidden sm:inline">{full}</span></>;

export const CustomerStats = ({
  stats, loading, compact, onPick,
}: { stats: CustomerStatsData; loading: boolean; compact: boolean; onPick: (balance: BalanceFilter, status: StatusFilter) => void }) => (
  <StatGrid
    label="Customer summary"
    storageKey="customers"
    className="print:hidden"
    peek={loading ? undefined : [
      { value: <Money amount={stats.dueTotal} compact />, label: 'due', tone: stats.dueTotal > 0.5 ? 'danger' : undefined },
      { value: <Money amount={stats.advanceTotal} compact />, label: 'advance', tone: stats.advanceTotal > 0.5 ? 'success' : undefined },
    ]}
  >
    <StatCard
      label={tileLabel('Clients', 'Total clients')}
      value={stats.total.toLocaleString('en-PK')}
      icon={<Users />}
      hint={!loading && stats.inactive > 0 ? `${stats.inactive} inactive` : undefined}
      loading={loading}
      onClick={() => onPick('All', 'All')}
    />
    <StatCard
      label={tileLabel('Due', 'Due receivables')}
      value={<Money amount={stats.dueTotal} compact={compact} />}
      icon={<Wallet />}
      tone="danger"
      hint={!loading ? `${stats.dueCount} customers` : undefined}
      loading={loading}
      onClick={() => onPick('Due', 'All')}
    />
    <StatCard
      label={tileLabel('Active', 'Active accounts')}
      value={stats.active.toLocaleString('en-PK')}
      icon={<UserCheck />}
      tone="brand"
      loading={loading}
      onClick={() => onPick('All', 'Active')}
    />
    <StatCard
      label={tileLabel('Advance', 'Advance prepaid')}
      value={<Money amount={stats.advanceTotal} compact={compact} />}
      icon={<WalletCards />}
      tone="success"
      hint={!loading ? `${stats.advanceCount} customers` : undefined}
      loading={loading}
      onClick={() => onPick('Advance', 'All')}
    />
  </StatGrid>
);

interface RowHandlers {
  onOpen: (id: string) => void;
  onEdit: (customer: Customer) => void;
  onDelete: (customer: Customer) => void;
  onToggle: (id: string) => void;
}

interface RowProps extends RowHandlers {
  customer: Customer;
  selected: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

const stop = (event: React.SyntheticEvent) => event.stopPropagation();

const CustomerTableRow = memo(function CustomerTableRow({ customer: c, selected, canEdit, canDelete, onOpen, onEdit, onDelete, onToggle }: RowProps) {
  const extraPhones = customerPhones(c);
  return (
    <TR interactive selected={selected} onClick={() => onOpen(c.id)}>
      {canDelete && (
        <TD className="w-10" onClick={stop}>
          <input
            type="checkbox"
            aria-label={`Select ${c.name}`}
            className="size-4 cursor-pointer rounded accent-brand"
            checked={selected}
            onChange={() => onToggle(c.id)}
          />
        </TD>
      )}
      <TD>
        <div className="flex min-w-0 items-center gap-3">
          <CustomerAvatar name={c.name} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold text-fg">{c.name}</span>
              {c.isActive === false && <Badge>Inactive</Badge>}
            </div>
            <p className="truncate text-xs text-fg-subtle">{c.city || 'Client'}</p>
          </div>
        </div>
      </TD>
      <TD>
        <div className="flex items-center gap-1.5 tabular-nums text-fg-muted">
          <span>{c.phone || '—'}</span>
          {hasWhatsApp(c) && <Badge tone="success" icon={<MessageCircle aria-hidden="true" />} title="WhatsApp">WA</Badge>}
        </div>
        {extraPhones.length > 0 && (
          <p className="mt-0.5 text-xs tabular-nums text-fg-subtle">
            {extraPhones[0].phone}{extraPhones[0].label ? ` (${extraPhones[0].label})` : ''}
          </p>
        )}
      </TD>
      <TD className="hidden max-w-[220px] lg:table-cell">
        <p className="truncate font-medium text-fg-muted">{c.city || '—'}</p>
        <p className="truncate text-xs text-fg-subtle">{c.address || 'No street address'}</p>
      </TD>
      <TD numeric>
        <KhataBalance balance={c.balance} stacked />
      </TD>
      <TD onClick={stop}>
        <div className="flex justify-end gap-1">
          <IconButton size="sm" aria-label="View ledger" icon={<FileText />} onClick={() => onOpen(c.id)} />
          {canEdit && <IconButton size="sm" aria-label="Edit customer" icon={<Pencil />} onClick={() => onEdit(c)} />}
          {canDelete && (
            <IconButton
              size="sm"
              aria-label="Delete / archive customer"
              icon={<Trash2 />}
              className="hover:bg-danger-soft hover:text-danger-fg"
              onClick={() => onDelete(c)}
            />
          )}
        </div>
      </TD>
    </TR>
  );
});

const CustomerCard = memo(function CustomerCard({ customer: c, onOpen }: { customer: Customer; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(c.id)}
      className="flex w-full cursor-pointer items-center gap-3 rounded-card border border-line bg-surface p-3 text-left shadow-e1 transition-colors duration-150 active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CustomerAvatar name={c.name} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-fg">{c.name}</span>
          {c.isActive === false && <Badge>Inactive</Badge>}
        </span>
        <span className="mt-0.5 block truncate text-xs text-fg-subtle">
          <span className="tabular-nums">{c.phone || 'No phone'}</span>
          {c.city ? ` · ${c.city}` : ''}
        </span>
      </span>
      <KhataBalance balance={c.balance} stacked className="shrink-0 text-sm" />
    </button>
  );
});

const LoadingRows = ({ table }: { table: boolean }) => (
  <div className={cn(table ? 'divide-y divide-line/70' : 'space-y-2.5')} aria-hidden="true">
    {Array.from({ length: 6 }, (_, i) => (
      <div key={i} className={cn('flex items-center gap-3', table ? 'px-5 py-3.5' : 'rounded-card border border-line bg-surface p-3')}>
        <Skeleton className="size-9 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-40 max-w-full" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-4 w-20" />
      </div>
    ))}
  </div>
);

export interface CustomerListProps extends RowHandlers {
  customers: Customer[];
  totalMatching: number;
  hasAnyCustomer: boolean;
  loading: boolean;
  isTable: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  balanceFilter: BalanceFilter;
  onBalanceFilterChange: (value: BalanceFilter) => void;
  balanceCounts: Record<BalanceFilter, number>;
  statusFilter: StatusFilter;
  onStatusFilterChange: (value: StatusFilter) => void;
  statusCounts: Record<StatusFilter, number>;
  sort: CustomerSort;
  onSortChange: (sort: CustomerSort) => void;
  selectedIds: Set<string>;
  selectedCount: number;
  allSelected: boolean;
  onToggleAll: (checked: boolean) => void;
  onBulkArchive: () => void;
  onClearFilters: () => void;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onAdd: () => void;
  window: { sentinelRef: (el: Element | null) => void; hiddenCount: number; showMore: () => void; showAll: () => void };
}

export function CustomerList(props: CustomerListProps) {
  const {
    customers, totalMatching, hasAnyCustomer, loading, isTable, search, onSearchChange, balanceFilter, onBalanceFilterChange, balanceCounts,
    statusFilter, onStatusFilterChange, statusCounts, sort, onSortChange, selectedIds, selectedCount, allSelected, onToggleAll, onBulkArchive, onClearFilters,
    canCreate, canEdit, canDelete, onAdd, onOpen, onEdit, onDelete, onToggle, window: listWindow,
  } = props;

  const empty = !loading && totalMatching === 0;
  const emptyState = !hasAnyCustomer ? (
    <EmptyState
      icon={<Users />}
      title="No customers yet"
      description="Add your first customer and their ledger will show here."
      action={canCreate ? <Button leftIcon={<UserPlus />} onClick={onAdd}>Add customer</Button> : undefined}
    />
  ) : (
    <EmptyState
      icon={<Users />}
      title="No customers found"
      description="Try a different search or filter."
      action={<Button variant="secondary" onClick={onClearFilters}>Clear filters</Button>}
    />
  );

  return (
    <section className="flex flex-col gap-3" aria-label="Customers">
      <Toolbar>
        <SearchInput
          value={search}
          onChange={onSearchChange}
          placeholder="Name, phone, city or bill # ..."
          aria-label="Search customers"
          className="flex-1 sm:w-72 sm:flex-none"
        />
        {/* Phones: the primary action sits next to search so it never wraps out of reach. */}
        {canCreate && <IconButton variant="primary" aria-label="Add customer" icon={<UserPlus />} onClick={onAdd} className="sm:hidden" />}
        <SegmentedControl<BalanceFilter>
          aria-label="Balance filter"
          size="sm"
          value={balanceFilter}
          onChange={onBalanceFilterChange}
          className="w-full sm:w-fit"
          options={[
            { value: 'All', label: 'All', count: balanceCounts.All },
            { value: 'Due', label: 'Due', count: balanceCounts.Due },
            { value: 'Advance', label: <><span className="sm:hidden">Adv.</span><span className="hidden sm:inline">Advance</span></>, count: balanceCounts.Advance },
            { value: 'Settled', label: 'Settled', count: balanceCounts.Settled },
          ]}
        />
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          <Select
            aria-label="Customer status"
            value={statusFilter}
            onChange={e => onStatusFilterChange(e.target.value as StatusFilter)}
            className="sm:w-auto sm:min-w-[9.5rem]"
          >
            <option value="Active">Active ({statusCounts.Active})</option>
            <option value="Inactive">Inactive / archived ({statusCounts.Inactive})</option>
            <option value="All">All customers ({statusCounts.All})</option>
          </Select>
          {!isTable && (
            <Select aria-label="Sort" value={sort} onChange={e => onSortChange(e.target.value as CustomerSort)} className="sm:w-auto">
              <option value="default">Original order</option>
              <option value="name">Name (A-Z)</option>
              <option value="balance">Highest due first</option>
            </Select>
          )}
        </div>
        {((canDelete && selectedCount > 0) || canCreate) && (
          <div className="ml-auto hidden items-center gap-2 sm:flex">
            {canDelete && selectedCount > 0 && (
              <Button variant="danger-soft" size="sm" leftIcon={<Archive />} onClick={onBulkArchive}>
                Archive {selectedCount}
              </Button>
            )}
            {canCreate && <Button leftIcon={<UserPlus />} onClick={onAdd}>Add customer</Button>}
          </div>
        )}
      </Toolbar>

      {isTable ? (
        <TableContainer>
          {loading ? <LoadingRows table /> : empty ? emptyState : (
            <Table>
              <THead>
                <tr>
                  {canDelete && (
                    <TH className="w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all customers"
                        className="size-4 cursor-pointer rounded accent-brand"
                        checked={allSelected}
                        onChange={e => onToggleAll(e.target.checked)}
                      />
                    </TH>
                  )}
                  <SortHeader label="Customer" value="name" sort={sort} onSortChange={onSortChange} />
                  <TH>Contact</TH>
                  <TH className="hidden lg:table-cell">City & area</TH>
                  <SortHeader label="Balance" value="balance" sort={sort} onSortChange={onSortChange} numeric />
                  <TH className="w-32 text-right">Actions</TH>
                </tr>
              </THead>
              <TBody>
                {customers.map(c => (
                  <CustomerTableRow
                    key={c.id}
                    customer={c}
                    selected={selectedIds.has(c.id)}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    onOpen={onOpen}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onToggle={onToggle}
                  />
                ))}
                <LoadMoreRow colSpan={canDelete ? 6 : 5} sentinelRef={listWindow.sentinelRef} hiddenCount={listWindow.hiddenCount} onShowMore={listWindow.showMore} onShowAll={listWindow.showAll} />
              </TBody>
            </Table>
          )}
        </TableContainer>
      ) : loading ? (
        <LoadingRows table={false} />
      ) : empty ? (
        <div className="rounded-card border border-line bg-surface shadow-e1">{emptyState}</div>
      ) : (
        <div className="space-y-2.5">
          {customers.map(c => <CustomerCard key={c.id} customer={c} onOpen={onOpen} />)}
          <LoadMoreRow sentinelRef={listWindow.sentinelRef} hiddenCount={listWindow.hiddenCount} onShowMore={listWindow.showMore} onShowAll={listWindow.showAll} />
        </div>
      )}
    </section>
  );
}
