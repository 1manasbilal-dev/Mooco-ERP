import { memo } from 'react';
import { Layers } from 'lucide-react';
import type { FinancialAccount } from '../../types';
import { Badge, Money, Skeleton } from '../ui';
import { cn } from '../../lib/cn';
import { ACCOUNT_ICON } from './ledger';

const CARD =
  'group flex w-full min-w-0 cursor-pointer flex-col gap-3 rounded-card border bg-surface p-4 text-left shadow-e1 ' +
  'transition-[box-shadow,border-color,transform] duration-200 ease-out-expo hover:-translate-y-px hover:shadow-e2 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const SELECTED = 'border-brand-accent ring-2 ring-brand-accent/25';
const RESTING = 'border-line hover:border-line-strong';

interface AccountCardProps {
  account: FinancialAccount;
  entryCount: number;
  selected: boolean;
  isDefault: boolean;
  onSelect: (id: string) => void;
  className?: string;
}

/** One cash / bank / wallet account with its balance. Selecting it opens its statement below. */
export const AccountCard = memo(function AccountCard({ account, entryCount, selected, isDefault, onSelect, className }: AccountCardProps) {
  const Icon = ACCOUNT_ICON[account.type] || ACCOUNT_ICON.Bank;
  const inactive = account.isActive === false;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(account.id)}
      className={cn(CARD, selected ? SELECTED : RESTING, inactive && !selected && 'opacity-70', className)}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-[18px]',
            selected ? 'bg-brand-soft text-brand-fg' : 'bg-surface-2 text-fg-muted',
          )}
        >
          <Icon aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-fg" title={account.name}>{account.name}</p>
          <p className="truncate text-xs text-fg-subtle">
            {account.type}
            {account.bank_name ? ` · ${account.bank_name}` : ''}
            {account.account_number ? ` · ${account.account_number}` : ''}
          </p>
        </div>
      </div>
      <div className="flex min-w-0 items-end justify-between gap-2">
        <Money
          amount={account.balance}
          className={cn('truncate text-xl font-bold leading-none tracking-tight', account.balance < 0 ? 'text-danger-fg' : 'text-fg')}
        />
        <span className="shrink-0 text-[11px] font-medium tabular-nums text-fg-subtle">{entryCount} entries</span>
      </div>
      {(isDefault || inactive || (account.type === 'Cash' && account.isDrawer)) && (
        <div className="flex flex-wrap gap-1.5">
          {isDefault && <Badge tone="brand">Default</Badge>}
          {account.type === 'Cash' && account.isDrawer && <Badge tone="info">Drawer</Badge>}
          {inactive && <Badge tone="neutral" dot>Inactive</Badge>}
        </div>
      )}
    </button>
  );
});

interface AllAccountsCardProps {
  total: number;
  accountCount: number;
  selected: boolean;
  onSelect: (id: string) => void;
  className?: string;
}

/** The consolidated view across every account. */
export const AllAccountsCard = memo(function AllAccountsCard({ total, accountCount, selected, onSelect, className }: AllAccountsCardProps) {
  return (
    <button type="button" aria-pressed={selected} onClick={() => onSelect('all')} className={cn(CARD, selected ? SELECTED : RESTING, className)}>
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-[18px]',
            selected ? 'bg-brand-soft text-brand-fg' : 'bg-surface-2 text-fg-muted',
          )}
        >
          <Layers aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-fg">All accounts</p>
          <p className="truncate text-xs text-fg-subtle">Consolidated statement</p>
        </div>
      </div>
      <div className="flex min-w-0 items-end justify-between gap-2">
        <Money amount={total} className={cn('truncate text-xl font-bold leading-none tracking-tight', total < 0 ? 'text-danger-fg' : 'text-fg')} />
        <span className="shrink-0 text-[11px] font-medium tabular-nums text-fg-subtle">{accountCount} accounts</span>
      </div>
    </button>
  );
});

export function AccountCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-e1", className)} aria-hidden="true">
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 rounded-xl" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <Skeleton className="h-6 w-32" />
    </div>
  );
}
