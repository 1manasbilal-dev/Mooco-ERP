import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, Factory, Package, Receipt } from 'lucide-react';
import { Badge, Button, Field, Input, Modal, Money, Textarea } from '../ui';
import { cn } from '../../lib/cn';
import { formatQty } from '../../lib/formatters';
import { convertQuantity } from '../../lib/unitConversion';
import { ProductionStage, type ItemDefinition, type ProductionBatch } from '../../types';
import { formatPkDay, formatPkTime, parseQty, qtyInputValue } from './milkOps';
import { batchYield, estimatedOutputOf, stageLabel } from './productionStages';

export interface BatchCompletion {
  variants: { variantId: string; count: number; variant_name: string; base_qty_each: number; total_base_qty: number }[];
  looseQty: number;
  message: string;
}

interface BatchDetailModalProps {
  batch: ProductionBatch;
  productDef?: ItemDefinition;
  itemsById: Map<string, ItemDefinition>;
  customUnits: any[];
  canEdit: boolean;
  isTodayLocked: boolean;
  lockedDate: string;
  onClose: () => void;
  onComplete: (completion: BatchCompletion) => Promise<boolean>;
  onCancel: (reason: string) => Promise<boolean>;
}

interface CostLine { name: string; qty: number; unit: string; total: number }

/** Batch details, cost preview and the completion / cancel forms. Lazy-loaded by the Production screen. */
export default function BatchDetailModal({
  batch, productDef, itemsById, customUnits, canEdit, isTodayLocked, lockedDate, onClose, onComplete, onCancel,
}: BatchDetailModalProps) {
  const unit = productDef?.unit || 'kg';
  const estimate = estimatedOutputOf(batch);
  const variants = useMemo(
    () => (productDef?.variants || []).filter(v => v.isActive !== false && v.deduct_from_base !== true),
    [productDef],
  );

  const [looseText, setLooseText] = useState(() => qtyInputValue(Math.round(estimate * 100) / 100));
  // Until the user types a loose figure, loose = estimate minus what went into packs, so packs are never counted twice.
  const looseEditedRef = useRef(false);
  const [packCounts, setPackCounts] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState('');
  const [mode, setMode] = useState<'details' | 'cancel'>('details');
  const [cancelReason, setCancelReason] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [zeroConfirmed, setZeroConfirmed] = useState(false);

  const loose = parseQty(looseText);
  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const v of variants) result[v.id] = Math.max(0, Math.floor(parseQty(packCounts[v.id])));
    return result;
  }, [packCounts, variants]);

  const output = useMemo(() => {
    const packed = variants.reduce((sum, v) => sum + (counts[v.id] || 0) * (v.quantity_in_base_unit || 0), 0);
    return { packed, total: Math.max(0, loose) + packed };
  }, [variants, counts, loose]);

  const finance = useMemo(() => {
    if (!productDef) return null;
    const inputQty = Number(batch.quantity_input) || 0;
    // Same rate the completion posts to stock cost; a missing rate shows as Rs 0 instead of a made-up figure.
    const milkRate = Number(batch.input_cost_per_unit || batch.details?.input_cost_per_unit || 0);
    const lines: CostLine[] = [{ name: 'Raw milk base', qty: inputQty, unit: 'L', total: inputQty * milkRate }];
    let total = inputQty * milkRate;

    if (productDef.recipe && productDef.recipe_base_quantity) {
      const scale = inputQty / productDef.recipe_base_quantity;
      for (const ing of productDef.recipe) {
        const material = itemsById.get(ing.item_id);
        // Priced and deducted in the material's own stock unit, exactly as completion posts it.
        const recipeQty = ing.quantity * scale;
        const stockUnit = material?.unit || ing.unit;
        const qty = (ing.unit && stockUnit ? convertQuantity(recipeQty, ing.unit, stockUnit, customUnits) : recipeQty) ?? recipeQty;
        const cost = qty * (material?.cost_price || 0);
        total += cost;
        lines.push({ name: material?.name || ing.item_name, qty: Math.round(qty * 1000) / 1000, unit: stockUnit, total: cost });
      }
    }

    for (const v of variants) {
      const count = counts[v.id] || 0;
      const packItem = v.packaging_item_id ? itemsById.get(v.packaging_item_id) : undefined;
      if (count > 0 && packItem) {
        const used = count * (Number(v.packaging_qty) || 0);
        const cost = used * (packItem.cost_price || 0);
        total += cost;
        lines.push({ name: `${v.name} packaging (${packItem.name})`, qty: used, unit: packItem.unit, total: cost });
      }
    }

    // Sales value of what was actually entered. A batch entered as 0 output (spoilt) is worth 0,
    // not the estimate the old screen fell back to.
    let revenue = Math.max(0, loose) * (productDef.selling_price || 0);
    for (const v of variants) {
      const each = v.selling_price || (productDef.selling_price || 0) * (v.quantity_in_base_unit || 0);
      revenue += (counts[v.id] || 0) * each;
    }
    return { lines, total, revenue, profit: revenue - total };
  }, [productDef, batch, itemsById, customUnits, variants, counts, loose]);

  const yieldInfo = batchYield(output.total, Number(batch.quantity_input) || 0, estimate);
  const isOpen = batch.status !== ProductionStage.COMPLETED && batch.status !== ProductionStage.CANCELLED;
  const canFinish = canEdit && isOpen && batch.status === ProductionStage.PACKAGING;
  const looseError = loose < 0 ? 'Minus qty nahi ho sakti.' : '';
  const zeroOutputPending = zeroConfirmed && output.total <= 0;

  const setPackCount = (variantId: string, text: string) => {
    const clean = text.replace(/\D/g, '');
    const next = { ...packCounts, [variantId]: clean };
    setPackCounts(next);
    if (!looseEditedRef.current) {
      const packed = variants.reduce((sum, v) => sum + Math.max(0, Math.floor(parseQty(next[v.id]))) * (v.quantity_in_base_unit || 0), 0);
      setLooseText(qtyInputValue(Math.round(Math.max(0, estimate - packed) * 1000) / 1000));
    }
  };

  const complete = async () => {
    if (!canFinish || busy || busyRef.current || isTodayLocked || looseError) return;
    // A zero output (spoilt batch) needs a second, deliberate click. Asked inline: a shared
    // confirm dialog opened from inside this modal can end up underneath it.
    if (output.total <= 0 && !zeroConfirmed) {
      setZeroConfirmed(true);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const completion: BatchCompletion = {
        variants: variants
          .filter(v => (counts[v.id] || 0) > 0)
          .map(v => ({
            variantId: v.id,
            count: counts[v.id],
            variant_name: v.name || 'Unknown',
            base_qty_each: v.quantity_in_base_unit || 0,
            total_base_qty: (v.quantity_in_base_unit || 0) * counts[v.id],
          })),
        // What the user sees is what gets stocked, including a zero for a spoilt batch.
        looseQty: parseFloat(Math.max(0, loose).toFixed(2)),
        message: remarks.trim() || 'Batch Completed',
      };
      await onComplete(completion);
    } finally {
      setBusy(false);
      window.setTimeout(() => { busyRef.current = false; }, 500);
    }
  };

  const cancel = async () => {
    const reason = cancelReason.trim();
    if (!reason || busy || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await onCancel(reason);
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };

  const started = formatPkTime(batch.start_date);

  const footer = mode === 'cancel' ? (
    <>
      <Button variant="secondary" onClick={() => setMode('details')} disabled={busy}>Wapas</Button>
      <Button variant="danger" leftIcon={<Ban />} loading={busy} disabled={!cancelReason.trim()} onClick={cancel}>Batch cancel karein</Button>
    </>
  ) : (
    <>
      {canEdit && isOpen && (
        <Button variant="danger-soft" leftIcon={<Ban />} onClick={() => setMode('cancel')} disabled={busy} className="sm:mr-auto">
          Cancel batch
        </Button>
      )}
      {canFinish ? (
        <Button
          variant={zeroOutputPending ? 'danger' : 'primary'}
          leftIcon={<CheckCircle2 />}
          loading={busy}
          disabled={isTodayLocked || Boolean(looseError)}
          title={isTodayLocked ? `Day ${lockedDate} is closed & locked` : undefined}
          onClick={complete}
        >
          {busy ? 'Processing...' : zeroOutputPending ? 'Haan, zero output ke sath complete' : 'Mark batch completed'}
        </Button>
      ) : (
        <Button variant="secondary" onClick={onClose}>Band karein</Button>
      )}
    </>
  );

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      dismissible={!busy}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {batch.product_name}
          <Badge className="font-mono">{batch.batch_number}</Badge>
        </span>
      }
      description={`Shuru: ${formatPkDay(batch.start_date, 'full')}${started ? `, ${started}` : ''} · Stage: ${stageLabel(batch.status)}`}
      icon={
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft text-brand-fg">
          <Factory className="size-5" aria-hidden="true" />
        </span>
      }
      footer={footer}
    >
      {mode === 'cancel' ? (
        <div className="space-y-3 pb-1">
          <p className="rounded-control border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm text-danger-fg">
            Batch cancel hone par is ka doodh ({formatQty(batch.quantity_input || 0)} L) wapas pool / counter mein chala jayega.
          </p>
          <Field label="Cancel karne ki wajah" required>
            {control => (
              <Textarea
                {...control}
                autoFocus
                rows={3}
                placeholder="Masalan: doodh kharab ho gaya, machine kharab..."
                value={cancelReason}
                onChange={event => setCancelReason(event.target.value)}
              />
            )}
          </Field>
        </div>
      ) : (
        <div className="space-y-4 pb-1">
          {isTodayLocked && canFinish && (
            <div className="flex items-start gap-2.5 rounded-control border border-warning/30 bg-warning-soft p-3 text-xs font-medium text-warning-fg" role="alert">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span><strong>Day locked ({lockedDate}):</strong> aaj ka business day band hai, is liye batch complete karke stock mein nahi dala ja sakta.</span>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <Metric label="Doodh in" value={`${formatQty(batch.quantity_input || 0)} L`} />
            <Metric label="Target" value={`${formatQty(batch.quantity_output_estimated || 0)} ${unit}`} />
            <Metric
              label="Est. profit"
              tone={finance ? (finance.profit >= 0 ? 'success' : 'danger') : undefined}
              value={finance ? <Money amount={finance.profit} compact /> : '—'}
            />
          </div>

          {finance && (
            <section className="overflow-hidden rounded-control border border-line">
              <h4 className="flex items-center gap-1.5 border-b border-line bg-surface-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                <Receipt className="size-3.5" aria-hidden="true" /> Cost analysis
              </h4>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-line">
                  {finance.lines.map((line, index) => (
                    <tr key={index}>
                      <td className="px-3 py-2 font-medium text-fg-muted">{line.name}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-fg-subtle">{formatQty(line.qty, 3)} {line.unit}</td>
                      <td className="px-3 py-2 text-right font-semibold text-fg"><Money amount={line.total} /></td>
                    </tr>
                  ))}
                  <tr className="bg-surface-2/70">
                    <td className="px-3 py-2 font-bold text-fg">Total est. cost</td>
                    <td />
                    <td className="px-3 py-2 text-right font-bold text-fg"><Money amount={finance.total} /></td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium text-fg-muted">Sales value (output)</td>
                    <td />
                    <td className="px-3 py-2 text-right font-semibold text-fg"><Money amount={finance.revenue} /></td>
                  </tr>
                </tbody>
              </table>
            </section>
          )}

          {canFinish && (
            <section className="space-y-3 rounded-control border border-brand-accent/30 bg-brand-soft/40 p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="flex items-center gap-1.5 text-sm font-bold text-fg">
                  <Package className="size-4 text-brand-fg" aria-hidden="true" /> Final output
                </h4>
                <Badge tone="brand" size="md">Total {formatQty(output.total, 3)} {unit}</Badge>
              </div>

              <Field label={`Loose quantity (${unit})`} error={looseError || undefined}>
                {control => (
                  <Input
                    {...control}
                    inputMode="decimal"
                    autoComplete="off"
                    value={looseText}
                    onChange={event => { looseEditedRef.current = true; setLooseText(event.target.value.replace(/[^\d.-]/g, '')); }}
                    onFocus={event => event.target.select()}
                    suffix={unit}
                    className="font-semibold tabular-nums"
                  />
                )}
              </Field>

              {variants.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-fg-muted">Packed variants</p>
                  {variants.map(v => (
                    <div key={v.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-fg">{v.name}</p>
                        <p className="text-[11px] text-fg-subtle">{formatQty(v.quantity_in_base_unit)} {unit} har pack</p>
                      </div>
                      <div className="w-28 shrink-0">
                        <Input
                          inputSize="sm"
                          inputMode="numeric"
                          autoComplete="off"
                          placeholder="0"
                          aria-label={`${v.name} packs`}
                          value={packCounts[v.id] || ''}
                          onChange={event => setPackCount(v.id, event.target.value)}
                          suffix="packs"
                          className="text-right font-semibold tabular-nums"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-surface px-3 py-2">
                  <dt className="text-fg-subtle">Yield (per litre)</dt>
                  <dd className="mt-0.5 font-bold tabular-nums text-fg">
                    {yieldInfo.perLitre === null ? '—' : `${formatQty(yieldInfo.perLitre, 3)} ${unit}/L`}
                  </dd>
                </div>
                <div className="rounded-lg bg-surface px-3 py-2 text-right">
                  <dt className="text-fg-subtle">Target ka</dt>
                  <dd className={cn('mt-0.5 font-bold tabular-nums', TONE_TEXT[yieldInfo.tone])}>
                    {yieldInfo.ofTarget === null ? '—' : `${formatQty(yieldInfo.ofTarget, 1)}%`}
                  </dd>
                </div>
              </dl>

              {zeroOutputPending && (
                <p className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-soft px-3 py-2 text-xs font-medium text-danger-fg" role="alert">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  Output zero hai: is batch ka koi maal stock mein nahi jayega (kharab batch). Dobara click karke confirm karein.
                </p>
              )}

              <Field label="Production remarks">
                {control => (
                  <Input {...control} placeholder="Optional batch remarks..." value={remarks} onChange={event => setRemarks(event.target.value)} />
                )}
              </Field>
            </section>
          )}

          {canEdit && isOpen && !canFinish && (
            <p className="text-xs text-fg-subtle">Batch ko "Finish" column tak le jayen (card ka Advance button ya drag), phir yahan output likh kar complete karein.</p>
          )}
        </div>
      )}
    </Modal>
  );
}

const TONE_TEXT: Record<string, string> = {
  neutral: 'text-fg',
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
};

function Metric({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'success' | 'danger' }) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-control border px-3 py-2.5',
        tone === 'success' ? 'border-success/25 bg-success-soft' : tone === 'danger' ? 'border-danger/25 bg-danger-soft' : 'border-line bg-surface-2',
      )}
    >
      <p className={cn('text-[11px] font-semibold', tone ? TONE_TEXT[tone] : 'text-fg-subtle')}>{label}</p>
      <p className={cn('mt-1 truncate text-base font-bold tabular-nums sm:text-lg', tone ? TONE_TEXT[tone] : 'text-fg')}>{value}</p>
    </div>
  );
}
