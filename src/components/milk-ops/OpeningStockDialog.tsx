import React, { useMemo, useRef, useState } from 'react';
import { PackagePlus } from 'lucide-react';
import { Button, Field, Modal, Money, Textarea } from '../ui';
import { cleanNumber } from '../../lib/formatters';
import { formatBaseQty } from '../../lib/stockRules';
import type { OpeningStockPiles } from '../../types';
import { countPiles, summarizeCounts, type StockRow } from './inventoryStock';
import { PileCountRow } from './StockCountParts';

interface OpeningStockDialogProps {
  row: StockRow;
  onSubmit: (piles: OpeningStockPiles, notes: string) => Promise<boolean>;
  onClose: () => void;
}

/**
 * First stock of a product that has never moved: loose and each ready-made pack, saved in one
 * `setOpeningStock` call so reports see one Opening Stock intake. Lazy-loaded by Inventory.
 */
export default function OpeningStockDialog({ row, onSubmit, onClose }: OpeningStockDialogProps) {
  const firstInputRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const busyRef = useRef(false);

  // Hidden packs are not for sale, so a new product only opens with its active packs.
  const piles = useMemo(() => countPiles(row.reading).filter(p => p.kind === 'loose' || (p.kind === 'pack' && !p.hidden)), [row.reading]);
  const summary = useMemo(() => summarizeCounts(piles, typed), [piles, typed]);
  const unit = row.reading.unit;
  const cost = Number(row.item.cost_price) || 0;

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setTouched(true);
    if (busy || busyRef.current || summary.errors > 0 || summary.changes.length === 0) return;
    const opening: OpeningStockPiles = {};
    summary.changes.forEach(change => {
      if (change.pile.kind === 'loose') opening.loose = change.counted;
      else opening.packs = { ...(opening.packs || {}), [change.pile.id]: change.counted };
    });
    busyRef.current = true;
    setBusy(true);
    try {
      await onSubmit(opening, notes.trim());
    } finally {
      setBusy(false);
      window.setTimeout(() => { busyRef.current = false; }, 400);
    }
  };

  return (
    <Modal
      open
      size="md"
      onClose={onClose}
      dismissible={!busy}
      title={`Opening stock · ${row.item.name}`}
      description="Starting stock for a new product. This is a one-time step; later changes go through a stock count."
      initialFocusRef={firstInputRef}
      icon={<span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand-fg"><PackagePlus className="size-5" aria-hidden="true" /></span>}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
          <Button type="submit" form="opening-stock-form" loading={busy} disabled={summary.changes.length === 0}>
            {busy ? 'Saving...' : 'Save opening stock'}
          </Button>
        </>
      )}
    >
      <form id="opening-stock-form" onSubmit={submit} className="space-y-4" noValidate>
        <ul className="divide-y divide-line overflow-hidden rounded-control border border-line">
          {piles.map((pile, index) => (
            <PileCountRow
              key={pile.id}
              pile={pile}
              baseUnit={unit}
              idPrefix="opening"
              value={typed[pile.id] || ''}
              onChange={value => setTyped(prev => ({ ...prev, [pile.id]: value }))}
              showError={touched}
              inputRef={index === 0 ? firstInputRef : undefined}
            />
          ))}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-surface-2 px-3 py-2.5">
          <span className="text-xs font-semibold text-fg-muted">Total stock</span>
          <span className="text-right">
            <span className="text-lg font-bold tabular-nums text-fg">{formatBaseQty(summary.baseDiff, unit)}</span>
            {cost > 0 ? (
              <span className="block text-[11px] font-semibold text-fg-subtle">At cost <Money amount={cleanNumber(summary.baseDiff * cost)} /></span>
            ) : summary.baseDiff > 0 ? (
              <span className="block text-[11px] font-semibold text-warning-fg">No cost price set; value will show as 0</span>
            ) : null}
          </span>
        </div>

        <Field label="Notes (optional)">
          {control => <Textarea {...control} rows={2} placeholder="e.g. counted when the shop opened" value={notes} onChange={event => setNotes(event.target.value)} />}
        </Field>
      </form>
    </Modal>
  );
}
