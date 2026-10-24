import { memo, useState } from 'react';
import { Archive, ChevronDown, MessageCircle, Pencil, Phone, RotateCcw, Truck, Wallet } from 'lucide-react';
import { Supplier } from '../../types';
import { BREAKPOINTS, useMediaQuery } from '../../hooks/useMediaQuery';
import { Badge, Button, Card } from '../ui';
import { cn } from '../../lib/cn';
import { InfoRow, SupplierBalance, SupplierBalanceBadge, balanceState } from './supplierUi';

const BALANCE_HELP = {
  payable: 'You owe this amount to the supplier.',
  advance: 'You have paid the supplier ahead.',
  settled: 'The balance is settled.',
} as const;

/** Supplier identity, live ledger balance and the main actions (left column of the ledger screen). */
export const SupplierProfileCard = memo(function SupplierProfileCard({
  supplier: s, canPay, canEdit, canDelete, onPay, onEdit, onDelete, onReactivate, onWhatsApp,
}: {
  supplier: Supplier;
  canPay: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onPay: (supplier: Supplier) => void;
  onEdit: (supplier: Supplier) => void;
  onDelete: (supplier: Supplier) => void;
  onReactivate: (supplier: Supplier) => void;
  onWhatsApp: (supplier: Supplier) => void;
}) {
  const isWide = useMediaQuery(BREAKPOINTS.lg);
  const [showDetails, setShowDetails] = useState(false);
  const balance = Number(s.pending_balance) || 0;
  const state = balanceState(balance);
  const inactive = s.isActive === false;
  const types = s.supplier_types?.length ? s.supplier_types : ['Milk'];
  const location = [s.village, s.city].filter(Boolean).join(' · ');
  const whatsapp = s.whatsapp && s.whatsapp !== s.phone ? s.whatsapp : '';
  const detailsOpen = isWide || showDetails;

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand-fg" aria-hidden="true">
          <Truck className="size-[22px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-lg font-bold leading-tight tracking-tight text-fg">{s.name}</h2>
          <p className="mt-0.5 truncate text-[13px] text-fg-subtle">{location || 'Dairy supplier'}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone={inactive ? 'neutral' : 'success'} dot>{inactive ? 'Inactive' : 'Active'}</Badge>
            {types.map(t => <Badge key={t} tone={t === 'Milk' ? 'info' : 'neutral'}>{t === 'Finished Products' ? 'Finished goods' : t}</Badge>)}
          </div>
        </div>
      </div>

      <div
        className={cn(
          'rounded-control border px-4 py-3.5',
          state === 'payable' ? 'border-danger/20 bg-danger-soft' : state === 'advance' ? 'border-success/20 bg-success-soft' : 'border-line bg-surface-2'
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-fg-muted">Ledger balance</span>
          <SupplierBalanceBadge value={balance} long />
        </div>
        <SupplierBalance value={balance} label="none" className="mt-1.5 text-[28px] font-bold leading-none tracking-tight" />
        <p className="mt-1.5 text-xs text-fg-muted">{BALANCE_HELP[state]}</p>
      </div>

      <div className="flex flex-col gap-2">
        {canPay && (
          <Button size="lg" fullWidth leftIcon={<Wallet />} onClick={() => onPay(s)}>Record payment</Button>
        )}
        <div className="grid grid-cols-2 gap-2">
          {canEdit && <Button variant="secondary" leftIcon={<Pencil />} onClick={() => onEdit(s)}>Edit</Button>}
          <Button variant="secondary" leftIcon={<MessageCircle />} onClick={() => onWhatsApp(s)}>WhatsApp</Button>
          {inactive && (canEdit || canDelete) && (
            <Button variant="soft" leftIcon={<RotateCcw />} onClick={() => onReactivate(s)}>Reactivate</Button>
          )}
          {canDelete && (
            <Button variant="danger-soft" leftIcon={<Archive />} onClick={() => onDelete(s)}>
              {inactive ? 'Delete' : 'Archive'}
            </Button>
          )}
        </div>
      </div>

      {!isWide && (
        <button
          type="button"
          aria-expanded={showDetails}
          onClick={() => setShowDetails(v => !v)}
          className="-mx-1 flex cursor-pointer items-center justify-between rounded-lg px-1 py-1 text-xs font-semibold text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Contact and terms
          <ChevronDown className={cn('size-4 transition-transform duration-150', showDetails && 'rotate-180')} aria-hidden="true" />
        </button>
      )}

      {detailsOpen && (
        <div className="divide-y divide-line/70 border-t border-line">
          <InfoRow label="Phone">
            {s.phone ? (
              <a href={`tel:${s.phone}`} className="inline-flex items-center gap-1.5 tabular-nums hover:text-brand-fg">
                <Phone className="size-3.5 text-fg-faint" aria-hidden="true" />
                {s.phone}
              </a>
            ) : <span className="text-fg-faint">—</span>}
          </InfoRow>
          {whatsapp && <InfoRow label="WhatsApp"><span className="tabular-nums">{whatsapp}</span></InfoRow>}
          <InfoRow label="Rate">{s.default_rate ? `Rs ${s.default_rate}/L` : 'FAT/SNF chart'}</InfoRow>
          {s.default_milk_type && <InfoRow label="Milk">{s.default_milk_type}</InfoRow>}
          {(s.village || s.city || s.address) && (
            <InfoRow label="Location"><span className="break-words">{[s.village, s.city, s.address].filter(Boolean).join(', ')}</span></InfoRow>
          )}
          {s.notes && <p className="py-2 text-xs italic text-fg-subtle break-words">“{s.notes}”</p>}
        </div>
      )}
    </Card>
  );
});
