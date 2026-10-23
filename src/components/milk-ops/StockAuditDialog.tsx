import React, { useDeferredValue, useMemo, useRef, useState } from 'react';
import { ClipboardCheck, History as HistoryIcon, Info } from 'lucide-react';
import {
  Badge, Button, EmptyState, Field, Input, LoadMoreRow, Modal, SearchInput, SegmentedControl, Select, Textarea,
} from '../ui';
import { cn } from '../../lib/cn';
import { formatQty } from '../../lib/formatters';
import { useProgressiveList } from '../../hooks/useProgressiveList';
import { AdjustmentReason, type InventoryLog } from '../../types';
import { formatPkDay, formatPkTime, parseQty } from './milkOps';
import type { StockRow } from './inventoryStock';

export type AuditTab = 'adjust' | 'history';

export interface StockAdjustment {
  itemId: string;
  variantId: string;
  newQty: number;
  reason: AdjustmentReason;
  notes: string;
  targetName: string;
}

interface StockAuditDialogProps {
  tab: AuditTab;
  onTabChange: (tab: AuditTab) => void;
  itemId: string;
  onItemChange: (itemId: string) => void;
  /** Pack to count when the dialog opens ('loose' for loose stock). */
  initialVariantId: string;
  /** Every catalogue item, never the filtered list, so a linked item always resolves. */
  rows: StockRow[];
  logs: InventoryLog[];
  canEdit: boolean;
  onSubmit: (adjustment: StockAdjustment) => Promise<boolean>;
  onClose: () => void;
}

/** Stock count / adjustment form and the audit log. Lazy-loaded by the Inventory screen. */
export default function StockAuditDialog({
  tab, onTabChange, itemId, onItemChange, initialVariantId, rows, logs, canEdit, onSubmit, onClose,
}: StockAuditDialogProps) {
  const countRef = useRef<HTMLInputElement>(null);
  const [variantId, setVariantId] = useState(initialVariantId || 'loose');
  const [physicalCount, setPhysicalCount] = useState('');
  const [reason, setReason] = useState<AdjustmentReason>(AdjustmentReason.DATA_ENTRY_ERROR);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const busyRef = useRef(false);

  const row = useMemo(() => rows.find(r => r.item.id === itemId), [rows, itemId]);
  const pack = variantId !== 'loose' ? row?.packaged.find(v => v.id === variantId) : undefined;
  const isPack = Boolean(pack);
  const systemQty = row ? (pack ? Number(row.variantStocks[pack.id]) || 0 : row.quantity) : 0;
  const systemUnit = pack ? 'packs' : row?.item.unit || '';
  const targetName = pack ? `${pack.name} (Packaged Variant)` : 'Loose / Bulk Stock';

  const typed = physicalCount.trim();
  const counted = parseQty(typed);
  const countError = !typed ? 'Ginti likhein.'
    : counted < 0 ? 'Minus ginti nahi ho sakti.'
    : isPack && !Number.isInteger(counted) ? 'Packs poore number mein likhein.'
    : '';
  const difference = typed && !countError ? Math.round((counted - systemQty) * 1000) / 1000 : null;

  const chooseItem = (id: string) => {
    onItemChange(id);
    // A different item starts on its loose stock with an empty count.
    setVariantId('loose');
    setPhysicalCount('');
    setTouched(false);
  };

  const chooseScope = (id: string) => {
    setVariantId(id);
    setPhysicalCount('');
    setTouched(false);
  };

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setTouched(true);
    if (!canEdit || !row || busy || busyRef.current) return;
    if (countError) {
      countRef.current?.focus();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      await onSubmit({ itemId: row.item.id, variantId: pack ? pack.id : 'loose', newQty: counted, reason, notes, targetName });
    } finally {
      setBusy(false);
      window.setTimeout(() => { busyRef.current = false; }, 400);
    }
  };

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      dismissible={!busy}
      title="Inventory audit & adjustment"
      description="Shelf par asal ginti ko system stock se milayein."
      initialFocusRef={countRef}
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
            disabled={!canEdit || !row}
            title={!canEdit ? 'Aap ko stock adjust karne ki ijazat nahi hai' : undefined}
          >
            {busy ? 'Saving stock...' : 'Confirm stock adjustment'}
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
            { value: 'adjust', label: 'New adjustment', disabled: !canEdit },
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
                    <option key={r.item.id} value={r.item.id}>{r.item.name} ({r.item.unit})</option>
                  ))}
                </Select>
              )}
            </Field>

            {row && (
              <>
                {row.packaged.length > 0 && (
                  <fieldset className="space-y-2">
                    <legend className="mb-1.5 text-xs font-semibold text-fg-muted">Kaunsa stock gin rahe hain</legend>
                    <ScopeOption
                      selected={variantId === 'loose'}
                      onSelect={() => chooseScope('loose')}
                      title="Loose / bulk stock"
                      detail={`${formatQty(row.quantity, 3)} ${row.item.unit}`}
                    />
                    {row.packaged.map(v => (
                      <ScopeOption
                        key={v.id}
                        selected={variantId === v.id}
                        onSelect={() => chooseScope(v.id)}
                        title={`${v.name} (pre-packed)`}
                        detail={`${formatQty(Number(row.variantStocks[v.id]) || 0)} packs · ${formatQty(v.quantity_in_base_unit, 3)} ${row.item.unit} har pack`}
                      />
                    ))}
                  </fieldset>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-control border border-line bg-surface-2 px-3 py-2.5">
                    <p className="text-[11px] font-semibold text-fg-subtle">System stock</p>
                    <p className={cn('mt-1 text-xl font-bold tabular-nums', systemQty < 0 ? 'text-danger-fg' : 'text-fg')}>
                      {formatQty(systemQty, 3)} <span className="text-xs font-semibold text-fg-subtle">{systemUnit}</span>
                    </p>
                  </div>
                  <div
                    className={cn(
                      'rounded-control border px-3 py-2.5 text-right',
                      difference === null || difference === 0 ? 'border-line bg-surface-2'
                        : difference > 0 ? 'border-success/25 bg-success-soft' : 'border-danger/25 bg-danger-soft',
                    )}
                  >
                    <p className="text-[11px] font-semibold text-fg-subtle">Farq</p>
                    <p
                      className={cn(
                        'mt-1 text-xl font-bold tabular-nums',
                        difference === null || difference === 0 ? 'text-fg-subtle' : difference > 0 ? 'text-success-fg' : 'text-danger-fg',
                      )}
                    >
                      {difference === null ? '—' : `${difference > 0 ? '+' : ''}${formatQty(difference, 3)}`}
                      <span className="ml-1 text-xs font-semibold text-fg-subtle">{difference === null ? '' : systemUnit}</span>
                    </p>
                  </div>
                </div>

                <Field
                  label={`Shelf par asal ginti (${pack ? pack.name : 'loose'})`}
                  required
                  error={touched ? countError || undefined : undefined}
                  hint={<span className="inline-flex items-center gap-1"><Info className="size-3" aria-hidden="true" /> Jo physically gina hai wahi likhein; system usi ke barabar ho jayega.</span>}
                >
                  {control => (
                    <Input
                      {...control}
                      ref={countRef}
                      inputSize="lg"
                      inputMode={isPack ? 'numeric' : 'decimal'}
                      autoComplete="off"
                      placeholder="0"
                      value={physicalCount}
                      onChange={event => setPhysicalCount(event.target.value.replace(isPack ? /[^\d]/g : /[^\d.]/g, ''))}
                      suffix={systemUnit}
                      className="text-xl font-bold tabular-nums"
                    />
                  )}
                </Field>

                <Field label="Adjustment ki wajah">
                  {control => (
                    <Select {...control} value={reason} onChange={event => setReason(event.target.value as AdjustmentReason)}>
                      {Object.values(AdjustmentReason).map(r => <option key={r} value={r}>{r}</option>)}
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

const ScopeOption: React.FC<{ selected: boolean; onSelect: () => void; title: string; detail: string }> = ({ selected, onSelect, title, detail }) => {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center justify-between gap-3 rounded-control border px-3 py-2.5 transition-colors duration-150',
        selected ? 'border-brand-accent bg-brand-soft/60' : 'border-line bg-surface hover:bg-surface-2',
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-fg">{title}</span>
        <span className="block text-[11px] tabular-nums text-fg-subtle">{detail}</span>
      </span>
      <input type="radio" name="audit-scope" checked={selected} onChange={onSelect} className="size-4 shrink-0 accent-[rgb(var(--brand-accent))]" />
    </label>
  );
};

function AuditHistory({ logs, rows }: { logs: InventoryLog[]; rows: StockRow[] }) {
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search);
  const unitById = useMemo(() => new Map<string, string>(rows.map(r => [r.item.id, r.item.unit])), [rows]);
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
              // Pack movements keep loose `difference` at 0 and carry the pack count in details.
              const packDelta = Number((log as any).details?.variant_delta) || 0;
              const isPackMove = !Number(log.difference) && Boolean(packDelta);
              const diff = Number(log.difference) || packDelta;
              const unit = isPackMove ? 'packs' : unitById.get(log.item_id) || '';
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
                    <p className={cn('text-sm font-bold tabular-nums', diff > 0 ? 'text-success-fg' : diff < 0 ? 'text-danger-fg' : 'text-fg-subtle')}>
                      {diff > 0 ? '+' : ''}{formatQty(diff, 3)} <span className="text-[11px] font-semibold">{unit}</span>
                    </p>
                    {!isPackMove && (
                      <p className="text-[11px] tabular-nums text-fg-subtle">{formatQty(log.old_quantity, 3)} → {formatQty(log.new_quantity, 3)}</p>
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
