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
    if (p.kind === 'orphan') return [`Purana count: ${p.name}`, formatQty(p.count, 3)];
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

  const cancel = (label = 'Wapas jayen') => (
    <Button variant="secondary" onClick={onClose} disabled={Boolean(busy)}>{label}</Button>
  );
  const common = { open: true, onClose, size: 'sm' as const, dismissible: !busy, role: 'alertdialog' as const };

  if (details.isSystem) {
    return (
      <Modal
        {...common}
        icon={<DialogIcon tone="info"><ShieldAlert /></DialogIcon>}
        title="System product protected"
        description={<><strong className="text-fg">{item.name}</strong> core milk variety hai, isko delete nahi kar sakte. Inactive karne se yeh catalog mein rahega lekin bechne aur khareedne mein nahi aayega.</>}
        footer={<>
          {cancel('Band karein')}
          {item.isActive ? (
            <Button variant="danger-soft" leftIcon={<Archive />} loading={busy === 'deactivate'} onClick={() => run('deactivate')}>Inactive karein</Button>
          ) : (
            <Button leftIcon={<RotateCcw />} loading={busy === 'reactivate'} onClick={() => run('reactivate')}>Reactivate karein</Button>
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
        title="Pehle recipes se hatayen"
        description={<><strong className="text-fg">{item.name}</strong> in products ki recipe mein istemal ho raha hai. Recipe badle baghair isko delete ya inactive nahi kar sakte.</>}
        footer={cancel('Theek hai')}
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
        title="Stock abhi baqi hai"
        description="Stock wala product seedha delete karne se stock value ka hisaab bigar jata hai. Write off karne se neeche ka har stock 0 ho kar spoilage mein jayega aur product inactive ho jayega. Agar stock bechna hai to wapas jayen."
        footer={<>
          {cancel()}
          <Button variant="danger" leftIcon={<PackageX />} loading={busy === 'write_off_spoilage'} onClick={() => run('write_off_spoilage')}>
            Write off karein
          </Button>
        </>}
      >
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">Yeh stock 0 hoga</p>
          <Facts rows={[
            ...toClear.map(pileRow),
            ['Value at cost', <Money key="v" amount={reading.costValue} />],
          ]} />
          {minusPiles.length > 0 && (
            <p className="flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2 text-xs font-medium text-warning-fg">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Minus stock ({minusPiles.map(p => pileRow(p).join(' ')).join(', ')}) write off se theek nahi hota. Usko Inventory mein stock count se 0 karein.
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
        title={item.isActive ? 'Product inactive karein' : 'Product pehle se inactive hai'}
        description="Is product ki purani sales ya stock history hai, is liye yeh delete nahi hoga. Inactive product POS se hat jata hai, purane bills aur reports wese hi rehte hain."
        footer={<>
          {cancel()}
          {item.isActive ? (
            <Button variant="danger-soft" leftIcon={<Archive />} loading={busy === 'deactivate'} onClick={() => run('deactivate')}>Inactive karein</Button>
          ) : (
            <Button leftIcon={<RotateCcw />} loading={busy === 'reactivate'} onClick={() => run('reactivate')}>Reactivate karein</Button>
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
      title={`${item.name} delete karein?`}
      description="Is product ka koi stock, bill ya purchase nahi hai."
      footer={<>
        {cancel()}
        <Button variant="danger" leftIcon={<Trash2 />} loading={busy === 'hard_delete'} onClick={() => run('hard_delete')}>Haan, delete karein</Button>
      </>}
    >
      <ul className="space-y-1.5 text-sm text-fg-muted">
        <li className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-danger" aria-hidden="true" />Product catalog aur POS se hamesha ke liye hat jayega.</li>
        <li className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-danger" aria-hidden="true" />Yeh kaam wapas nahi ho sakta.</li>
      </ul>
    </Modal>
  );
}
