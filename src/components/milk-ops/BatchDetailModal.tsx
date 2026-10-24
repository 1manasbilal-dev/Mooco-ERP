import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Ban, Boxes, CheckCircle2, Droplets, Factory, Package, Receipt, Refrigerator } from 'lucide-react';
import { Badge, Button, Field, Input, Modal, Money, Textarea, type Tone } from '../ui';
import { cn } from '../../lib/cn';
import { cleanQty, formatCurrency, formatQty } from '../../lib/formatters';
import { ProductionStage, type ItemDefinition, type ProductionBatch, type UnitDefinition } from '../../types';
import { formatPkDay, formatPkTime, parseQty, qtyInputValue } from './milkOps';
import { YIELD_COPY, batchYield, estimatedOutputOf, formatOfTarget, formatYieldPerLitre, stageLabel } from './productionStages';
import {
  batchCancelPlan, batchMaterialCheck, batchOutputPreview, outputPacksOf, type MaterialNeed, type OutputPileRow, type PileStock,
} from './batchStock';

export interface BatchCompletion {
  variants: { variantId: string; count: number; variant_name: string; base_qty_each: number; total_base_qty: number }[];
  looseQty: number;
  message: string;
}

interface BatchDetailModalProps {
  batch: ProductionBatch;
  productDef?: ItemDefinition;
  itemsById: Map<string, ItemDefinition>;
  /** Live loose and pack piles of an item (materials and the product). */
  stockOf: (itemId: string) => PileStock;
  customUnits: UnitDefinition[];
  canEdit: boolean;
  isTodayLocked: boolean;
  lockedDate: string;
  onClose: () => void;
  onComplete: (completion: BatchCompletion) => Promise<boolean>;
  onCancel: (reason: string) => Promise<boolean>;
}

/** Batch details, materials check, cost preview and the completion / cancel forms. Lazy-loaded by the Production screen. */
export default function BatchDetailModal({
  batch, productDef, itemsById, stockOf, customUnits, canEdit, isTodayLocked, lockedDate, onClose, onComplete, onCancel,
}: BatchDetailModalProps) {
  const unit = productDef?.unit || 'kg';
  const estimate = estimatedOutputOf(batch);
  const inputLitres = Number(batch.quantity_input) || 0;
  const variants = useMemo(() => outputPacksOf(productDef), [productDef]);

  const [looseText, setLooseText] = useState(() => qtyInputValue(estimate));
  // Until the user types a loose figure, loose = estimate minus what went into packs, so packs are never counted twice.
  const looseEditedRef = useRef(false);
  const [packCounts, setPackCounts] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState('');
  const [mode, setMode] = useState<'details' | 'cancel'>('details');
  const [cancelReason, setCancelReason] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [zeroConfirmed, setZeroConfirmed] = useState(false);

  const isOpen = batch.status !== ProductionStage.COMPLETED && batch.status !== ProductionStage.CANCELLED;
  const canFinish = canEdit && isOpen && batch.status === ProductionStage.PACKAGING;

  const loose = parseQty(looseText);
  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const v of variants) result[v.id] = Math.max(0, Math.floor(parseQty(packCounts[v.id])));
    return result;
  }, [packCounts, variants]);

  // Packaging is only used for packs entered here, so the check follows the form.
  const materials = useMemo(
    () => batchMaterialCheck({ product: productDef, inputLitres, packCounts: canFinish ? counts : {}, itemsById, stockOf, customUnits }),
    [productDef, inputLitres, canFinish, counts, itemsById, stockOf, customUnits],
  );
  const preview = useMemo(
    () => batchOutputPreview(productDef, productDef ? stockOf(productDef.id) : { loose: 0, packs: {} }, loose, counts),
    [productDef, stockOf, loose, counts],
  );
  const cancelPlan = useMemo(() => batchCancelPlan(batch, itemsById, customUnits), [batch, itemsById, customUnits]);

  const finance = useMemo(() => {
    if (!productDef) return null;
    // Same rate the completion posts to stock cost; a missing rate shows as Rs 0 instead of a made-up figure.
    const milkRate = Number(batch.input_cost_per_unit || batch.details?.input_cost_per_unit || 0);
    const milkCost = inputLitres * milkRate;
    const total = milkCost + materials.lines.reduce((sum, line) => sum + line.cost, 0);
    // Sales value of what was actually entered. A batch entered as 0 output (spoilt) is worth 0,
    // not the estimate the old screen fell back to.
    let revenue = Math.max(0, loose) * (productDef.selling_price || 0);
    for (const v of variants) {
      const each = v.selling_price || (productDef.selling_price || 0) * (v.quantity_in_base_unit || 0);
      revenue += (counts[v.id] || 0) * each;
    }
    return { milkCost, milkRate, total, revenue, profit: revenue - total };
  }, [productDef, batch, inputLitres, materials.lines, variants, counts, loose]);

  const yieldInfo = batchYield(preview.addedBase, inputLitres, estimate);
  const looseError = loose < 0 ? 'Minus qty nahi ho sakti.' : '';
  const zeroOutputPending = zeroConfirmed && preview.addedBase <= 0;
  const blocked = materials.blocking.length > 0;
  const completeBlockReason = isTodayLocked ? `Day ${lockedDate} band (locked) hai.`
    : blocked ? `${materials.blocking.length} ${materials.blocking.length === 1 ? 'material' : 'materials'} ki wajah se complete nahi ho sakta (upar dekhein).`
    : '';

  const setPackCount = (variantId: string, text: string) => {
    const clean = text.replace(/\D/g, '');
    const next = { ...packCounts, [variantId]: clean };
    setPackCounts(next);
    if (!looseEditedRef.current) {
      const packed = variants.reduce((sum, v) => sum + Math.max(0, Math.floor(parseQty(next[v.id]))) * (v.quantity_in_base_unit || 0), 0);
      setLooseText(qtyInputValue(Math.max(0, estimate - packed)));
    }
  };

  const complete = async () => {
    if (!canFinish || busy || busyRef.current || isTodayLocked || looseError || blocked) return;
    // A zero output (spoilt batch) needs a second, deliberate click. Asked inline: a shared
    // confirm dialog opened from inside this modal can end up underneath it.
    if (preview.addedBase <= 0 && !zeroConfirmed) {
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
            total_base_qty: cleanQty((v.quantity_in_base_unit || 0) * counts[v.id]),
          })),
        // What the user sees is what gets stocked, including a zero for a spoilt batch (3 decimals, like all stock).
        looseQty: cleanQty(Math.max(0, loose)),
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
          disabled={isTodayLocked || Boolean(looseError) || blocked}
          title={completeBlockReason || undefined}
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
          <CancelPreview plan={cancelPlan} inputLitres={inputLitres} />
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

          {!productDef && (
            <p className="flex items-start gap-2 rounded-control border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs font-medium text-warning-fg" role="alert">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              "{batch.product_name}" catalog mein nahi mila: recipe, packs aur stock preview nahi dikh sakte. Catalog mein isi naam ka product banayen.
            </p>
          )}

          <div className="grid grid-cols-3 gap-2">
            <Metric label="Doodh in" value={`${formatQty(inputLitres, 3)} L`} />
            <Metric label="Target" value={`${formatQty(batch.quantity_output_estimated || 0, 3)} ${unit}`} />
            <Metric
              label="Est. profit"
              tone={finance ? (finance.profit >= 0 ? 'success' : 'danger') : undefined}
              value={finance ? <Money amount={finance.profit} compact /> : '—'}
            />
          </div>

          {isOpen && (materials.needs.length > 0 || materials.warnings.length > 0) && (
            <MaterialsCheck needs={materials.needs} warnings={materials.warnings} blocking={blocked} canFinish={canFinish} />
          )}

          {finance && (
            <section className="overflow-hidden rounded-control border border-line">
              <h4 className="flex items-center gap-1.5 border-b border-line bg-surface-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                <Receipt className="size-3.5" aria-hidden="true" /> Cost analysis
              </h4>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-line">
                  <tr>
                    <td className="px-3 py-2 font-medium text-fg-muted">Raw milk base <span className="text-fg-subtle">@ {formatCurrency(finance.milkRate)}/L</span></td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-fg-subtle">{formatQty(inputLitres, 3)} L</td>
                    <td className="px-3 py-2 text-right font-semibold text-fg"><Money amount={finance.milkCost} /></td>
                  </tr>
                  {materials.lines.map((line, index) => (
                    <tr key={`${line.kind}-${line.itemId}-${index}`}>
                      <td className="px-3 py-2 font-medium text-fg-muted">{line.name}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-fg-subtle">
                        {line.qty === null ? <span className="font-semibold text-danger-fg">{formatQty(line.rawQty, 3)} {line.rawUnit}?</span> : `${formatQty(line.qty, 3)} ${line.unit}`}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-fg">{line.qty === null ? '—' : <Money amount={line.cost} />}</td>
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
                <Badge tone="brand" size="md">Total {formatQty(preview.addedBase, 3)} {unit}</Badge>
              </div>

              <Field label={`Loose quantity (${unit})`} error={looseError || undefined} hint={variants.length > 0 ? 'Packs ke ilawa jo khula maal bacha.' : undefined}>
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
                  <p className="text-xs font-semibold text-fg-muted">Ready-made packs</p>
                  {variants.map(v => (
                    <div key={v.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-fg">{v.name}</p>
                        <p className="text-[11px] text-fg-subtle">{formatQty(v.quantity_in_base_unit, 3)} {unit} har pack</p>
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

              {productDef && <StockPreview rows={preview.rows} unit={unit} totalBefore={preview.totalBefore} totalAfter={preview.totalAfter} />}

              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-surface px-3 py-2" title={YIELD_COPY.perLitre.hint}>
                  <dt className="text-fg-subtle">{YIELD_COPY.perLitre.label}</dt>
                  <dd className="mt-0.5 font-bold tabular-nums text-fg">{formatYieldPerLitre(yieldInfo.perLitre, unit)}</dd>
                  <dd className="mt-0.5 text-[11px] text-fg-subtle">{YIELD_COPY.perLitre.hint}</dd>
                </div>
                <div className="rounded-lg bg-surface px-3 py-2 text-right" title={YIELD_COPY.ofTarget.hint}>
                  <dt className="text-fg-subtle">{YIELD_COPY.ofTarget.label}</dt>
                  <dd className={cn('mt-0.5 font-bold tabular-nums', TONE_TEXT[yieldInfo.tone])}>{formatOfTarget(yieldInfo.ofTarget)}</dd>
                  <dd className="mt-0.5 text-[11px] text-fg-subtle">Target {formatQty(estimate, 3)} {unit}</dd>
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

              {completeBlockReason && (
                <p className="text-center text-xs font-semibold text-danger-fg" role="status">{completeBlockReason}</p>
              )}
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

const PROBLEM_BADGE: Record<NonNullable<MaterialNeed['problem']> | 'ok', { tone: Tone; label: string }> = {
  ok: { tone: 'success', label: 'Theek' },
  short: { tone: 'danger', label: 'Kam hai' },
  unit: { tone: 'danger', label: 'Unit ghalat' },
  missing: { tone: 'danger', label: 'Nahi mila' },
};

/** Each material the batch uses up on completion: needed vs on hand (loose + packs). */
function MaterialsCheck({ needs, warnings, blocking, canFinish }: { needs: MaterialNeed[]; warnings: string[]; blocking: boolean; canFinish: boolean }) {
  return (
    <section className={cn('overflow-hidden rounded-control border', blocking ? 'border-danger/40' : 'border-line')}>
      <h4 className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-3 py-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
          <Boxes className="size-3.5" aria-hidden="true" /> Materials
        </span>
        <span className="text-[11px] text-fg-subtle">{canFinish ? 'Complete karne par stock se katenge' : 'Batch complete hone par katenge'}</span>
      </h4>
      {needs.length > 0 && (
        <ul className="divide-y divide-line">
          {needs.map(need => {
            const badge = PROBLEM_BADGE[need.problem || 'ok'];
            return (
              <li key={need.itemId} className="px-3 py-2 text-xs">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-fg">{need.name}</p>
                    <p className="mt-0.5 text-fg-subtle">
                      Stock: {need.piles.length > 0 ? need.piles.join(' · ') : '—'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-bold tabular-nums text-fg">
                      {need.need === null ? '—' : `${formatQty(need.need, 3)} ${need.unit}`}
                      <span className="font-normal text-fg-subtle"> / {formatQty(need.available, 3)} {need.unit}</span>
                    </p>
                    <Badge tone={badge.tone} className="mt-1">{badge.label}</Badge>
                  </div>
                </div>
                {need.message && <p className="mt-1.5 font-medium text-danger-fg">{need.message}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {warnings.map(text => (
        <p key={text} className="flex items-start gap-2 border-t border-line bg-warning-soft px-3 py-2 text-xs font-medium text-warning-fg first:border-t-0">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {text}
        </p>
      ))}
      {needs.length > 0 && (
        <p className="border-t border-line px-3 py-1.5 text-[11px] text-fg-subtle">Chahiye / stock mein. Pehle loose stock katega, phir poore packs khulenge.</p>
      )}
    </section>
  );
}

/** Product stock per pile now and after this batch goes in. */
function StockPreview({ rows, unit, totalBefore, totalAfter }: { rows: OutputPileRow[]; unit: string; totalBefore: number; totalAfter: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <table className="w-full text-xs">
        <thead className="bg-surface-2 text-[11px] text-fg-subtle">
          <tr>
            <th className="px-3 py-1.5 text-left font-semibold">Stock preview</th>
            <th className="px-2 py-1.5 text-right font-semibold">Abhi</th>
            <th className="px-2 py-1.5 text-right font-semibold">Batch</th>
            <th className="px-3 py-1.5 text-right font-semibold">Baad mein</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line tabular-nums">
          {rows.map(row => {
            const suffix = row.kind === 'loose' ? ` ${unit}` : '';
            return (
              <tr key={row.id}>
                <td className="px-3 py-1.5 font-medium text-fg-muted">{row.kind === 'loose' ? `Loose (${unit})` : row.name}</td>
                <td className={cn('px-2 py-1.5 text-right', row.before < 0 ? 'text-danger-fg' : 'text-fg-subtle')}>{formatQty(row.before, 3)}{suffix}</td>
                <td className={cn('px-2 py-1.5 text-right', row.add > 0 ? 'font-semibold text-success-fg' : 'text-fg-faint')}>+{formatQty(row.add, 3)}</td>
                <td className="px-3 py-1.5 text-right font-bold text-fg">{formatQty(row.after, 3)}{suffix}</td>
              </tr>
            );
          })}
          <tr className="bg-surface-2/70">
            <td className="px-3 py-1.5 font-bold text-fg">Kul stock ({unit})</td>
            <td className="px-2 py-1.5 text-right text-fg-subtle">{formatQty(totalBefore, 3)}</td>
            <td />
            <td className="px-3 py-1.5 text-right font-bold text-fg">{formatQty(totalAfter, 3)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Where a cancelled batch's milk goes back to. */
function CancelPreview({ plan, inputLitres }: { plan: ReturnType<typeof batchCancelPlan>; inputLitres: number }) {
  return (
    <div className="space-y-2">
      <p className="rounded-control border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm text-danger-fg">
        Batch cancel hone par is ka {formatQty(inputLitres, 3)} L doodh wapas chala jayega:
      </p>
      <ul className="divide-y divide-line overflow-hidden rounded-control border border-line text-xs">
        {plan.poolLitres > 0 && (
          <li className="flex items-start gap-2.5 px-3 py-2.5">
            <Droplets className="mt-0.5 size-4 shrink-0 text-warning-fg" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-fg">Unallocated doodh (pool)</p>
              <p className="mt-0.5 text-fg-subtle">Naya lot "{plan.poolLotName}" · {plan.poolMilkType} · {formatCurrency(plan.poolRate)}/L</p>
            </div>
            <span className="flex shrink-0 items-center gap-1 font-bold tabular-nums text-fg"><ArrowRight className="size-3 text-fg-faint" aria-hidden="true" />{formatQty(plan.poolLitres, 3)} L</span>
          </li>
        )}
        {plan.counter.map(row => (
          <li key={row.itemId} className="flex items-start gap-2.5 px-3 py-2.5">
            <Refrigerator className="mt-0.5 size-4 shrink-0 text-info-fg" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-fg">{row.name} — counter (loose stock)</p>
              {row.stockUnit.toLowerCase() !== 'l' && (
                <p className={cn('mt-0.5', row.converted ? 'text-fg-subtle' : 'font-medium text-warning-fg')}>
                  {row.converted ? `Stock mein +${formatQty(row.stockQty, 3)} ${row.stockUnit}` : `Unit "${row.stockUnit}" litre mein nahi badalti: ${formatQty(row.litres, 3)} as it is jama hoga. Item ki unit check karein.`}
                </p>
              )}
            </div>
            <span className="flex shrink-0 items-center gap-1 font-bold tabular-nums text-fg"><ArrowRight className="size-3 text-fg-faint" aria-hidden="true" />{formatQty(row.litres, 3)} L</span>
          </li>
        ))}
      </ul>
      {plan.orphanCounterLitres > 0 && (
        <p className="text-xs text-warning-fg">{formatQty(plan.orphanCounterLitres, 3)} L counter milk ka item ab catalog mein nahi, is liye wo pool mein jayega.</p>
      )}
      <p className="text-xs text-fg-subtle">Materials (cheeni, cups waghaira) batch complete hone par katte hain, is liye cancel par kuch aur wapas nahi hota.</p>
    </div>
  );
}

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
