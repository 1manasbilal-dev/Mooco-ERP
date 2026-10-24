import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Archive, PackageX, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import { useDairy } from '../../context/DairyContext';
import type { ItemDefinition } from '../../types';
import { Button, Modal, Money } from '../ui';
import { cn } from '../../lib/cn';
import { formatQty } from '../../lib/formatters';
import type { StockPile } from '../../lib/sellUnits';
import { formatBaseQty, pileBreakdown, readStock } from '../../lib/stockRules';

interface Props {
  item: ItemDefinition;
  onClose: () => void;
  /** Called after the product was deleted or deactivated. */
  onDone: (itemId: string) => void;
}

type Action = 'hard_delete' | 'deactivate' | 'write_off_spoilage' | 'reactivate';

const ICON_TONE = {
  warning: 'bg-warning-soft text-warning-fg',
  danger: 'bg-danger-soft text-danger-fg',
  info: 'bg-info-soft text-info-fg',
} as const;

function DialogIcon({ tone, children }: { tone: keyof typeof ICON_TONE; children: React.ReactNode }) {
  return <div className={cn('flex size-10 items-center justify-center rounded-xl [&_svg]:size-5', ICON_TONE[tone])}>{children}</div>;
}

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-line/70 rounded-control border border-line bg-surface-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
          <dt className="text-fg-subtle">{label}</dt>
          <dd className="text-right font-semibold tabular-nums text-fg">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The one way to remove a product. It picks the safe action from what the product still has:
 * system items and products with history are deactivated, stock is written off first, and only a
 * product with no stock and no history is deleted for good.
 */
export default function ItemDeleteDialog({ item, onClose, onDone }: Props) {
  const { getDeleteAssessment, safeDeleteItem, reactivateEntity, inventory } = useDairy();
  const [busy, setBusy] = useState<Action | null>(null);
  const busyRef = useRef(false);

  // Read once when the dialog opens, so the choice does not change under the user's finger.
  const assessment = useMemo(() => getDeleteAssessment('item', item.id), []); // eslint-disable-line react-hooks/exhaustive-deps
  const details = (assessment.details || {}) as { isSystem?: boolean; recipesUsing?: string[]; salesCount?: number; purCount?: number };
  const recipesUsing = details.recipesUsing || [];

  // Live piles, read with the shared rules (docs/stock-model.md) so this dialog, the catalog and Inventory agree.
  const reading = useMemo(() => {
    const inv = inventory?.find(i => i.item_id === item.id);
    const loose = Number(inv?.quantity ?? item.stock ?? 0) || 0;
    return readStock(item, loose, (inv?.variant_stocks || item.variant_stocks) as Record<string, number> | undefined);
  }, [inventory, item]);
  // Write-off (safeDeleteItem) zeroes every pile above 0: loose, each ready-made pack (hidden ones too) and stray counts.
  const toClear = reading.piles.filter(p => p.kind !== 'multi' && p.count > 0);
  const hasStock = toClear.some(p => p.kind === 'loose' || p.kind === 'packed');
  const minusPiles = reading.piles.filter(p => (p.kind === 'loose' || p.kind === 'packed') && p.count < 0);
  const pileRow = (p: StockPile): [string, React.ReactNode] => {
    if (p.kind === 'loose') return ['Loose', formatBaseQty(p.count, reading.unit)];
    if (p.kind === 'orphan') return [`Old count: ${p.name}`, formatQty(p.count, 3)];
    return [`${p.name}${p.isActive ? '' : ' (hidden)'}`, `${formatQty(p.count, 3)} × ${formatBaseQty(p.contains, reading.unit)} = ${formatBaseQty(p.baseQty, reading.unit)}`];
  };

  const run = async (action: Action) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(action);
    try {
      const ok = action === 'reactivate' ? await reactivateEntity('item', item.id) : await safeDeleteItem(item.id, action);
      if (ok) {
        if (action === 'reactivate') onClose();
        else onDone(item.id);
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const cancel = (label = 'Go back') => (
    <Button variant="secondary" onClick={onClose} disabled={Boolean(busy)}>{label}</Button>
  );
  const common = { open: true, onClose, size: 'sm' as const, dismissible: !busy, role: 'alertdialog' as const };

  if (details.isSystem) {
    return (
      <Modal
        {...common}
        icon={<DialogIcon tone="info"><ShieldAlert /></DialogIcon>}
        title="System product protected"
        description={<><strong className="text-fg">{item.name}</strong> is a core milk variety, so it can't be deleted. If made inactive it stays in the catalog, but won't show for selling or buying.</>}
        footer={<>
          {cancel('Close')}
          {item.isActive ? (
            <Button variant="danger-soft" leftIcon={<Archive />} loading={busy === 'deactivate'} onClick={() => run('deactivate')}>Make inactive</Button>
          ) : (
            <Button leftIcon={<RotateCcw />} loading={busy === 'reactivate'} onClick={() => run('reactivate')}>Reactivate</Button>
          )}
        </>}
      />
    );
  }

  if (recipesUsing.length > 0) {
    return (
      <Modal
        {...common}
        icon={<DialogIcon tone="warning"><ShieldAlert /></DialogIcon>}
        title="Remove from recipes first"
        description={<><strong className="text-fg">{item.name}</strong> is used in the recipes of these products. It can't be deleted or made inactive until those recipes change.</>}
        footer={cancel('OK')}
      >
        <ul className="max-h-48 divide-y divide-line/70 overflow-y-auto rounded-control border border-line bg-surface-2 text-sm">
          {recipesUsing.map(name => (
            <li key={name} className="flex items-center gap-2 px-3.5 py-2.5 font-medium text-fg">
              <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />{name}
            </li>
          ))}
        </ul>
      </Modal>
    );
  }

  if (hasStock) {
    return (
      <Modal
        {...common}
        icon={<DialogIcon tone="warning"><AlertTriangle /></DialogIcon>}
        title="Stock still on hand"
        description="Deleting a product that still has stock throws off the stock value. Writing off sets every stock below to 0, moves it to spoilage and makes the product inactive. To sell the stock instead, go back."
        footer={<>
          {cancel()}
          <Button variant="danger" leftIcon={<PackageX />} loading={busy === 'write_off_spoilage'} onClick={() => run('write_off_spoilage')}>
            Write off
          </Button>
        </>}
      >
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">This stock goes to 0</p>
          <Facts rows={[
            ...toClear.map(pileRow),
            ['Value at cost', <Money key="v" amount={reading.costValue} />],
          ]} />
          {minusPiles.length > 0 && (
            <p className="flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2 text-xs font-medium text-warning-fg">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Minus stock ({minusPiles.map(p => pileRow(p).join(' ')).join(', ')}) isn't fixed by a write-off. Set it to 0 with a stock count in Inventory.
            </p>
          )}
        </div>
      </Modal>
    );
  }

  if (assessment.hasHistory || reading.status === 'minus') {
    return (
      <Modal
        {...common}
        icon={<DialogIcon tone="warning"><Archive /></DialogIcon>}
        title={item.isActive ? 'Make product inactive' : 'Product is already inactive'}
        description="This product has past sales or stock history, so it won't be deleted. An inactive product leaves the POS; old bills and reports stay as they are."
        footer={<>
          {cancel()}
          {item.isActive ? (
            <Button variant="danger-soft" leftIcon={<Archive />} loading={busy === 'deactivate'} onClick={() => run('deactivate')}>Make inactive</Button>
          ) : (
            <Button leftIcon={<RotateCcw />} loading={busy === 'reactivate'} onClick={() => run('reactivate')}>Reactivate</Button>
          )}
        </>}
      >
        <Facts rows={[
          ['Product', item.name],
          ['Current stock', pileBreakdown(reading).join(' · ') || formatBaseQty(0, reading.unit)],
          ['History', `${details.salesCount || 0} bills · ${details.purCount || 0} purchases`],
        ]} />
      </Modal>
    );
  }

  return (
    <Modal
      {...common}
      icon={<DialogIcon tone="danger"><Trash2 /></DialogIcon>}
      title={`Delete ${item.name}?`}
      description="This product has no stock, bills or purchases."
      footer={<>
        {cancel()}
        <Button variant="danger" leftIcon={<Trash2 />} loading={busy === 'hard_delete'} onClick={() => run('hard_delete')}>Yes, delete</Button>
      </>}
    >
      <ul className="space-y-1.5 text-sm text-fg-muted">
        <li className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-danger" aria-hidden="true" />The product is removed from the catalog and POS for good.</li>
        <li className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-danger" aria-hidden="true" />This can't be undone.</li>
      </ul>
    </Modal>
  );
}
