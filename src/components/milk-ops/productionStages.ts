import { CheckSquare, Cpu, Play } from 'lucide-react';
import { PriorityLevel, ProductionStage, type ProductionBatch } from '../../types';
import type { Tone } from '../ui';
import { formatQty } from '../../lib/formatters';

/** The three working columns of the production board, in order. */
export const BOARD_STAGES = [
  { id: ProductionStage.PROCESSING, label: 'Start', icon: Play },
  { id: ProductionStage.QUALITY, label: 'Processing', icon: Cpu },
  { id: ProductionStage.PACKAGING, label: 'Finish', icon: CheckSquare },
] as const;

export const stageLabel = (stage: ProductionStage | string) =>
  stage === ProductionStage.PROCESSING ? 'Start'
  : stage === ProductionStage.QUALITY ? 'Processing'
  : stage === ProductionStage.PACKAGING ? 'Finish'
  : String(stage);

export const nextStageOf = (current: ProductionStage | string): ProductionStage | null =>
  current === ProductionStage.PROCESSING ? ProductionStage.QUALITY
  : current === ProductionStage.QUALITY ? ProductionStage.PACKAGING
  : current === ProductionStage.PACKAGING ? ProductionStage.COMPLETED
  : null;

export const PRIORITY_TONE: Record<string, Tone> = {
  [PriorityLevel.LOW]: 'neutral',
  [PriorityLevel.MEDIUM]: 'info',
  [PriorityLevel.HIGH]: 'warning',
  [PriorityLevel.URGENT]: 'danger',
};

/** Estimate used when a batch has none: 85% of the milk, the same default as batch creation. */
export const estimatedOutputOf = (batch: Pick<ProductionBatch, 'quantity_output_estimated' | 'quantity_input'>) =>
  Number(batch.quantity_output_estimated) || (batch.quantity_input ? Number(batch.quantity_input) * 0.85 : 0);

/**
 * Yield of a batch, shown two ways: output per litre of milk, and the share of the target reached.
 * The old screen called "output / target" the yield; the target share is now labelled as such.
 */
export function batchYield(output: number, inputLitres: number, target: number) {
  const perLitre = inputLitres > 0 ? output / inputLitres : null;
  const ofTarget = target > 0 ? (output / target) * 100 : null;
  const tone: Tone = ofTarget === null ? 'neutral' : ofTarget >= 95 ? 'success' : ofTarget >= 85 ? 'warning' : 'danger';
  return { perLitre, ofTarget, tone };
}

/** The same two yield labels (with their explanation) on the batch sheet and in history. */
export const YIELD_COPY = {
  perLitre: { label: 'Yield / litre', hint: '1 litre doodh se kitna maal bana' },
  ofTarget: { label: 'Target ka %', hint: 'Batch ke target (andaza output) ka kitna hissa bana' },
} as const;

export const formatYieldPerLitre = (perLitre: number | null, unit: string) =>
  perLitre === null ? '—' : `${formatQty(perLitre, 3)} ${unit}/L`;

export const formatOfTarget = (ofTarget: number | null) => (ofTarget === null ? '—' : `${formatQty(ofTarget, 1)}%`);
