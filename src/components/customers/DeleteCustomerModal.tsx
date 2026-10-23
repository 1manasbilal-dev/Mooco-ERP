import React from 'react';
import { AlertTriangle, Archive, Trash2 } from 'lucide-react';
import { Button, Modal } from '../ui';
import { cn } from '../../lib/cn';
import { formatCurrency } from '../../lib/formatters';

export type DeleteAction = 'hard_delete' | 'deactivate' | 'write_off_bad_debt';

export interface DeleteTarget {
  /** Null for a bulk archive of the selected customers. */
  id: string | null;
  name: string;
  count: number;
  balance: number;
  /** Bills, deliveries or khata rows exist (from the context's assessment or this screen's own ledger). */
  hasHistory: boolean;
  salesCount: number;
  txCount: number;
}

interface DeleteCustomerModalProps {
  target: DeleteTarget;
  busy: boolean;
  onClose: () => void;
  onAction: (action: DeleteAction) => void;
  onBulkArchive: () => void;
}

const IconChip = ({ tone, children }: { tone: 'danger' | 'warning'; children: React.ReactNode }) => (
  <span className={cn('flex size-10 items-center justify-center rounded-xl', tone === 'danger' ? 'bg-danger-soft text-danger-fg' : 'bg-warning-soft text-warning-fg')}>{children}</span>
);

const Facts = ({ rows }: { rows: [string, React.ReactNode][] }) => (
  <dl className="space-y-1.5 rounded-control border border-line bg-surface-2 p-3 text-xs">
    {rows.map(([label, value]) => (
      <div key={label} className="flex justify-between gap-3">
        <dt className="text-fg-subtle">{label}</dt>
        <dd className="text-right font-semibold text-fg">{value}</dd>
      </div>
    ))}
  </dl>
);

/**
 * QuickBooks-style delete: a customer with an open balance is written off or archived, one with history
 * is archived, and only a customer with neither can be removed for good.
 */
export default function DeleteCustomerModal({ target, busy, onClose, onAction, onBulkArchive }: DeleteCustomerModalProps) {
  if (target.id === null) {
    return (
      <Modal
        open
        onClose={onClose}
        dismissible={!busy}
        icon={<IconChip tone="warning"><Archive size={20} /></IconChip>}
        title={`${target.count} customers archive karein?`}
        description="Ye customers Inactive (archived) ho jayenge: POS aur daily routes se chhup jayenge, lekin unki khata history aur balance waise hi rahenge."
        footer={<>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" className="bg-warning hover:bg-warning/90" loading={busy} onClick={onBulkArchive}>Make inactive</Button>
        </>}
      />
    );
  }

  const balance = Number(target.balance) || 0;

  // The context refuses a hard delete for any non-zero balance, so this branch uses the same strict test.
  if (balance !== 0) {
    return (
      <Modal
        open
        onClose={onClose}
        dismissible={!busy}
        icon={<IconChip tone="danger"><AlertTriangle size={20} /></IconChip>}
        title="Open balance warning"
        description="Khula balance hote hue customer delete nahi ho sakta, warna balance sheet bigar jayegi."
      >
        <div className="space-y-3">
          <div className="rounded-control border border-danger/25 bg-danger-soft p-4 text-center">
            <span className="block text-xs font-semibold text-danger-fg">{balance > 0 ? 'Receivable khata (customer ne dena hai)' : 'Advance credit (Mooco ne dena hai)'}</span>
            <span className="mt-1 block text-2xl font-bold tabular-nums text-danger-fg">{formatCurrency(Math.abs(balance))}</span>
          </div>
          <Button variant="danger" fullWidth size="lg" loading={busy} onClick={() => onAction('write_off_bad_debt')} className="h-auto flex-col gap-0.5 py-2.5">
            <span>{balance > 0 ? 'Bad debt write off karein' : 'Advance forfeit karein'} & make inactive</span>
            <span className="text-[11px] font-normal opacity-85">
              {balance > 0 ? 'Loss expense post hoga, balance sheet barabar rahegi' : 'Advance khaate se khatam hoga, customer archive hoga'}
            </span>
          </Button>
          <Button variant="secondary" fullWidth leftIcon={<Archive />} disabled={busy} onClick={() => onAction('deactivate')}>
            Khata rakhein & make inactive (POS se chhupayein)
          </Button>
          <Button variant="ghost" fullWidth disabled={busy} onClick={onClose}>Cancel, active rehne dein</Button>
        </div>
      </Modal>
    );
  }

  if (target.hasHistory) {
    return (
      <Modal
        open
        onClose={onClose}
        dismissible={!busy}
        icon={<IconChip tone="warning"><Archive size={20} /></IconChip>}
        title="Customer archive karein"
        description="Purani sales aur khata ki history mehfooz rakhne ke liye ye customer delete nahi, sirf inactive hoga."
        footer={<>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" className="bg-warning hover:bg-warning/90" loading={busy} onClick={() => onAction('deactivate')}>Make inactive</Button>
        </>}
      >
        <Facts rows={[
          ['Customer', target.name],
          ['Khata balance', <span key="b" className="text-success-fg">Rs 0 (Settled)</span>],
          ['Past history', `${target.salesCount} bills, ${target.txCount} khata entries`],
        ]} />
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      role="alertdialog"
      icon={<IconChip tone="danger"><Trash2 size={20} /></IconChip>}
      title="Permanently delete karein?"
      description={<>Customer <strong>{target.name}</strong> ki koi sale, delivery ya balance nahi. Ye database se hamesha ke liye hat jayega.</>}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="danger" loading={busy} onClick={() => onAction('hard_delete')}>Delete permanently</Button>
      </>}
    />
  );
}
