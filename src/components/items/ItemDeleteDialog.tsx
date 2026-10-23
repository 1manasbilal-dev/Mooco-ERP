import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Archive, PackageX, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import { useDairy } from '../../context/DairyContext';
import type { ItemDefinition } from '../../types';
import { Button, Modal, Money } from '../ui';
import { cn } from '../../lib/cn';
import { formatQty } from '../../lib/formatters';
import { sellUnitContains } from '../../lib/sellUnits';

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
  const stock = Number(assessment.stock) || 0;
  const recipesUsing = details.recipesUsing || [];

  // Write-off only clears loose stock (safeDeleteItem), so ready-made packs must be counted out first.
  const packsOnShelf = useMemo(() => {
    const inv = inventory?.find(i => i.item_id === item.id);
    const counts = (inv?.variant_stocks || item.variant_stocks || {}) as Record<string, number>;
    return (item.variants || [])
      .filter(v => v.deduct_from_base !== true)
      .map(v => ({ name: v.name, count: Number(counts[v.id]) || 0, contains: sellUnitContains(v) }))
      .filter(p => Math.abs(p.count) > 0.0001);
  }, [inventory, item]);
  const looseStock = stock - packsOnShelf.reduce((sum, p) => sum + p.count * p.contains, 0);

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

  if (stock > 0) {
    const value = Math.max(0, looseStock) * (Number(item.cost_price) || 0)
      + packsOnShelf.reduce((sum, p) => sum + Math.max(0, p.count) * p.contains * (Number(item.cost_price) || 0), 0);
    const blockedByPacks = packsOnShelf.some(p => p.count > 0);
    return (
      <Modal
        {...common}
        icon={<DialogIcon tone="warning"><AlertTriangle /></DialogIcon>}
        title="Stock abhi baqi hai"
        description="Stock wala product seedha delete karne se stock value ka hisaab bigar jata hai. Write off karne se stock spoilage mein jayega aur product inactive ho jayega. Agar stock bechna hai to wapas jayen."
        footer={<>
          {cancel()}
          <Button
            variant="danger"
            leftIcon={<PackageX />}
            loading={busy === 'write_off_spoilage'}
            disabled={blockedByPacks}
            onClick={() => run('write_off_spoilage')}
          >
            Write off karein
          </Button>
        </>}
      >
        <div className="space-y-3">
          <Facts rows={[
            ['Loose stock', `${formatQty(looseStock, 3)} ${item.unit}`],
            ...packsOnShelf.map(p => [p.name, `${formatQty(p.count, 3)} packs`] as [string, React.ReactNode]),
            ['Value at cost', <Money key="v" amount={value} />],
          ]} />
          {blockedByPacks && (
            <p className="flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2 text-xs font-medium text-warning-fg">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              Ready-made packs ka stock write off yahan se nahi hota. Pehle Inventory mein packs count karke 0 karein.
            </p>
          )}
        </div>
      </Modal>
    );
  }

  if (assessment.hasHistory || stock < 0) {
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
          ['Current stock', `${formatQty(stock, 3)} ${item.unit}`],
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
