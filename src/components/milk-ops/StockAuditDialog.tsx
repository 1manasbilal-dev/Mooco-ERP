import React, { useDeferredValue, useMemo, useRef, useState } from 'react';
import { ClipboardCheck, History as HistoryIcon } from 'lucide-react';
import {
  Badge, Button, EmptyState, Field, LoadMoreRow, Modal, SearchInput, SegmentedControl, Select, Textarea,
} from '../ui';
import { cn } from '../../lib/cn';
import { formatBaseQty } from '../../lib/stockRules';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import { AdjustmentReason, type InventoryLog, type ItemDefinition } from '../../types';
import { formatPkDay, formatPkTime } from './milkOps';
import { COUNT_REASONS, countPiles, summarizeCounts, type StockRow } from './inventoryStock';
import { describeLog } from './stockLog';
import { StatusBadge } from './StockRows';
import { CountTotals, PileCountRow, diffTone, signedQty } from './StockCountParts';

export type AuditTab = 'adjust' | 'history';

export interface StockCountSubmission {
  itemId: string;
  itemName: string;
  /** One entry per pile whose count changed: 'loose' or a variant id, with the counted number. */
  changes: { variantId: string; newQty: number; name: string }[];
  reason: AdjustmentReason;
  notes: string;
}

interface StockAuditDialogProps {
  tab: AuditTab;
  onTabChange: (tab: AuditTab) => void;
  itemId: string;
  onItemChange: (itemId: string) => void;
  /** Every catalogue item, never the filtered list, so a linked item always resolves. */
  rows: StockRow[];
  logs: InventoryLog[];
  canEdit: boolean;
  /** Saves the changed piles and returns the ids that were saved. */
  onSubmit: (count: StockCountSubmission) => Promise<string[]>;
  onClose: () => void;
}

/** Stock count for one product, pile by pile, and the audit log. Lazy-loaded by the Inventory screen. */
export default function StockAuditDialog({
  tab, onTabChange, itemId, onItemChange, rows, logs, canEdit, onSubmit, onClose,
}: StockAuditDialogProps) {
  const firstInputRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<AdjustmentReason>(AdjustmentReason.STOCK_COUNT);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const busyRef = useRef(false);

  const row = useMemo(() => rows.find(r => r.item.id === itemId), [rows, itemId]);
  const piles = useMemo(() => (row ? countPiles(row.reading) : []), [row]);
  const summary = useMemo(() => summarizeCounts(piles, typed), [piles, typed]);
  const costRate = Number(row?.item.cost_price) || 0;
  const unit = row?.reading.unit || '';

  const chooseItem = (id: string) => {
    onItemChange(id);
    setTyped({});
    setTouched(false);
  };

  const setCount = (pileId: string, value: string) => setTyped(prev => ({ ...prev, [pileId]: value }));

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setTouched(true);
    if (!canEdit || !row || busy || busyRef.current || summary.errors > 0 || summary.changes.length === 0) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const saved = await onSubmit({
        itemId: row.item.id,
        itemName: row.item.name,
        changes: summary.changes.map(change => ({ variantId: change.pile.id, newQty: change.counted, name: change.pile.name })),
        reason,
        notes: notes.trim(),
      });
      // Saved piles leave the form; a pile that failed keeps its number so it can be tried again.
      if (saved.length) setTyped(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !saved.includes(id))));
    } finally {
      setBusy(false);
      window.setTimeout(() => { busyRef.current = false; }, 400);
    }
  };

  const changeCount = summary.changes.length;

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      dismissible={!busy}
      title="Stock count"
      description="Shelf par har pile gin kar likhein; system usi ginti ke barabar ho jayega."
      initialFocusRef={firstInputRef}
      icon={
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand-fg">
          <ClipboardCheck className="size-5" aria-hidden="true" />
        </span>
      }
      footer={tab === 'adjust' ? (
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Band karein</Button>
          <Button
            type="submit"
            form="stock-audit-form"
            loading={busy}
            disabled={!canEdit || !row || changeCount === 0}
            title={!canEdit ? 'Aap ko stock adjust karne ki ijazat nahi hai' : undefined}
          >
            {busy ? 'Saving...' : changeCount > 1 ? `${changeCount} piles save karein` : 'Count save karein'}
          </Button>
        </>
      ) : undefined}
    >
      <div className="space-y-4">
        <SegmentedControl
          aria-label="Audit section"
          variant="underline"
          value={tab}
          onChange={onTabChange}
          options={[
            { value: 'adjust', label: 'Stock count', disabled: !canEdit },
            { value: 'history', label: 'Audit history', count: logs.length },
          ]}
        />

        {tab === 'adjust' ? (
          <form id="stock-audit-form" onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Item chunein" required>
              {control => (
                <Select {...control} value={itemId} onChange={event => chooseItem(event.target.value)}>
                  <option value="">-- Catalog se item chunein --</option>
                  {rows.map(r => (
                    <option key={r.item.id} value={r.item.id}>{r.item.name} ({r.item.unit}){r.isActive ? '' : ' · inactive'}</option>
                  ))}
                </Select>
              )}
            </Field>

            {row && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-surface-2 px-3 py-2.5 text-xs">
                  <span className="text-fg-subtle">
                    System mein <span className="font-bold tabular-nums text-fg">{formatBaseQty(row.reading.totalBase, unit)}</span>
                    {row.pileDetail && <span className="tabular-nums"> · {row.piles.join(' · ')}</span>}
                  </span>
                  <StatusBadge row={row} />
                </div>

                <fieldset className="space-y-2">
                  <legend className="mb-1.5 text-xs font-semibold text-fg-muted">Har pile ki asal ginti (khali = koi tabdeeli nahi)</legend>
                  <ul className="divide-y divide-line overflow-hidden rounded-control border border-line">
                    {piles.map((pile, index) => (
                      <PileCountRow
                        key={pile.id}
                        pile={pile}
                        baseUnit={unit}
                        value={typed[pile.id] || ''}
                        onChange={value => setCount(pile.id, value)}
                        showError={touched}
                        inputRef={index === 0 ? firstInputRef : undefined}
                      />
                    ))}
                  </ul>
                </fieldset>

                <CountTotals changes={changeCount} baseDiff={summary.baseDiff} unit={unit} valueDiff={costRate > 0 ? summary.baseDiff * costRate : null} />

                <Field label="Wajah">
                  {control => (
                    <Select {...control} value={reason} onChange={event => setReason(event.target.value as AdjustmentReason)}>
                      {COUNT_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </Select>
                  )}
                </Field>

                <Field label="Remarks / notes">
                  {control => (
                    <Textarea {...control} rows={2} placeholder="Farq ki wajah likhein..." value={notes} onChange={event => setNotes(event.target.value)} />
                  )}
                </Field>
              </>
            )}
          </form>
        ) : (
          <AuditHistory logs={logs} rows={rows} />
        )}
      </div>
    </Modal>
  );
}

function AuditHistory({ logs, rows }: { logs: InventoryLog[]; rows: StockRow[] }) {
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search);
  const itemById = useMemo(() => new Map<string, ItemDefinition>(rows.map(r => [r.item.id, r.item])), [rows]);
  const filtered = useMemo(() => {
    const q = deferred.trim().toLowerCase();
    return q ? logs.filter(log => `${log.item_name} ${log.reason} ${log.notes || ''}`.toLowerCase().includes(q)) : logs;
  }, [logs, deferred]);
  const list = useProgressiveList<InventoryLog>(filtered, 40, deferred);

  return (
    <div className="space-y-3">
      <SearchInput value={search} onChange={setSearch} placeholder="Item, wajah ya note search karein..." aria-label="Search audit history" />
      {filtered.length === 0 ? (
        <EmptyState size="compact" icon={<HistoryIcon />} title={search ? 'Kuch nahi mila' : 'Abhi koi audit entry nahi'} />
      ) : (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-control border border-line">
            {list.visibleItems.map(log => {
              const item = itemById.get(log.item_id);
              const line = describeLog(log, item);
              const time = formatPkTime(log.date);
              return (
                <li key={log.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-fg">{log.item_name}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-subtle">
                      <Badge>{log.reason}</Badge>
                      <span className="tabular-nums">{formatPkDay(log.date, 'full')}{time ? `, ${time}` : ''}</span>
                    </div>
                    {log.notes && <p className="mt-1 line-clamp-2 text-xs text-fg-subtle">“{log.notes}”</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    {line.moves.length === 0 ? (
                      <p className="text-sm font-bold text-fg-subtle">0</p>
                    ) : line.moves.map(move => (
                      <p key={move.id} className={cn('text-sm font-bold tabular-nums', diffTone(move.delta))}>
                        {signedQty(move.delta)} <span className="text-[11px] font-semibold">{move.kind === 'loose' ? move.unit : move.name}</span>
                      </p>
                    ))}
                    {line.moves.some(move => move.kind !== 'loose') && (
                      <p className="text-[11px] tabular-nums text-fg-subtle">= {signedQty(line.baseDelta)} {item?.unit || ''}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <LoadMoreRow sentinelRef={list.sentinelRef} hiddenCount={list.hiddenCount} onShowMore={list.showMore} onShowAll={list.showAll} />
        </>
      )}
    </div>
  );
}
