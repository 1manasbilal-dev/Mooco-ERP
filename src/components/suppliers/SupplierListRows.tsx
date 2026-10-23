import React, { memo } from 'react';
import { ChevronRight, Pencil, Phone, Wallet } from 'lucide-react';
import { Supplier } from '../../types';
import { Badge, Card, IconButton, Skeleton, TD, TR } from '../ui';
import { cn } from '../../lib/cn';
import { SupplierAvatar, SupplierBalance, supplierPlace } from './supplierUi';

export interface SupplierRowProps {
  supplier: Supplier;
  selected: boolean;
  /** Bulk selection is only offered to users who may archive suppliers. */
  selectable: boolean;
  canPay: boolean;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onPay: (supplier: Supplier) => void;
  onEdit: (supplier: Supplier) => void;
}

const TYPE_TONE: Record<string, 'info' | 'neutral'> = { Milk: 'info' };

function TypeBadges({ supplier, limit }: { supplier: Supplier; limit?: number }) {
  const types = supplier.supplier_types?.length ? supplier.supplier_types : ['Milk'];
  return (
    <>
      {types.slice(0, limit ?? types.length).map(t => (
        <Badge key={t} tone={TYPE_TONE[t] || 'neutral'}>{t === 'Finished Products' ? 'Finished goods' : t}</Badge>
      ))}
    </>
  );
}

const stop = (event: React.SyntheticEvent) => event.stopPropagation();

export const SupplierTableRow = memo(function SupplierTableRow({
  supplier: s, selected, selectable, canPay, canEdit, onOpen, onToggle, onPay, onEdit,
}: SupplierRowProps) {
  const place = supplierPlace(s);
  return (
    <TR interactive selected={selected} onClick={() => onOpen(s.id)}>
      {selectable && (
        <TD className="w-12" onClick={stop}>
          <input
            type="checkbox"
            aria-label={`${s.name} select karein`}
            className="size-4 cursor-pointer accent-brand"
            checked={selected}
            onChange={() => onToggle(s.id)}
          />
        </TD>
      )}
      <TD>
        <div className="flex min-w-0 items-center gap-3">
          <SupplierAvatar name={s.name} />
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-semibold text-fg">
              <span className="truncate">{s.name}</span>
              {s.isActive === false && <Badge>Inactive</Badge>}
            </p>
            <p className="truncate text-xs text-fg-subtle">{place || '—'}</p>
          </div>
        </div>
      </TD>
      <TD className="whitespace-nowrap text-[13px] tabular-nums text-fg-muted">{s.phone || <span className="text-fg-faint">—</span>}</TD>
      <TD>
        <div className="flex flex-wrap items-center gap-1">
          <TypeBadges supplier={s} />
          {s.default_rate ? <Badge tone="brand" className="tabular-nums">Rs {s.default_rate}/L</Badge> : null}
        </div>
      </TD>
      <TD numeric><SupplierBalance value={Number(s.pending_balance) || 0} /></TD>
      <TD className="w-28" onClick={stop}>
        <div className="flex justify-end gap-1">
          {canPay && <IconButton size="sm" aria-label="Payment record karein" icon={<Wallet />} onClick={() => onPay(s)} />}
          {canEdit && <IconButton size="sm" aria-label="Profile edit karein" icon={<Pencil />} onClick={() => onEdit(s)} />}
          <IconButton size="sm" aria-label="Khata kholein" icon={<ChevronRight />} onClick={() => onOpen(s.id)} />
        </div>
      </TD>
    </TR>
  );
});

export const SupplierPhoneCard = memo(function SupplierPhoneCard({ supplier: s, onOpen }: Pick<SupplierRowProps, 'supplier' | 'onOpen'>) {
  const place = supplierPlace(s);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(s.id)}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-100 active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <SupplierAvatar name={s.name} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-fg">{s.name}</span>
            {s.isActive === false && <Badge>Inactive</Badge>}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-fg-subtle">
            {s.phone && <span className="inline-flex items-center gap-1 tabular-nums"><Phone className="size-3" aria-hidden="true" />{s.phone}</span>}
            {s.phone && place && <span aria-hidden="true">·</span>}
            {place && <span className="truncate">{place}</span>}
            {!s.phone && !place && <TypeBadges supplier={s} limit={2} />}
          </p>
        </div>
        <div className="shrink-0 text-right text-sm font-bold">
          <SupplierBalance value={Number(s.pending_balance) || 0} />
          {s.default_rate ? <p className="mt-0.5 text-[11px] font-medium tabular-nums text-fg-subtle">Rs {s.default_rate}/L</p> : null}
        </div>
      </button>
    </li>
  );
});

/** Loading placeholder shaped like the supplier list. */
export function SupplierListSkeleton({ wide }: { wide: boolean }) {
  return (
    <Card className="overflow-hidden" aria-busy="true" aria-label="Suppliers load ho rahe hain">
      <ul className="divide-y divide-line/70">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className={cn('flex items-center gap-3 px-4 py-3.5', wide && 'px-5')}>
            <Skeleton className="size-9 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
            {wide && <Skeleton className="h-3.5 w-28" />}
            <Skeleton className="h-4 w-20" />
          </li>
        ))}
      </ul>
    </Card>
  );
}
