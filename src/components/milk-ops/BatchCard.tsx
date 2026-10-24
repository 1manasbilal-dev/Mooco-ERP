import React, { memo } from 'react';
import { ArrowRight, ChevronDown, ChevronUp, GripVertical, Package } from 'lucide-react';
import { Badge, Button, IconButton } from '../ui';
import { cn } from '../../lib/cn';
import { formatQty } from '../../lib/formatters';
import { ProductionStage, type ProductionBatch } from '../../types';
import { formatPkDay, formatPkTime } from './milkOps';
import { BOARD_STAGES, PRIORITY_TONE, nextStageOf, stageLabel } from './productionStages';

export interface BatchCardProps {
  batch: ProductionBatch;
  outputUnit: string;
  canEdit: boolean;
  expanded: boolean;
  dragging: boolean;
  /** A stage change for this batch is being saved. */
  pending: boolean;
  onToggle: (id: string) => void;
  onMove: (batch: ProductionBatch, stage: ProductionStage) => void;
  onOpen: (batch: ProductionBatch) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onTouchMove: (event: React.TouchEvent) => void;
  onTouchEnd: () => void;
}

/** One batch on the production board. Memoised: the board re-renders only the card that changed. */
export const BatchCard = memo(function BatchCard({
  batch, outputUnit, canEdit, expanded, dragging, pending, onToggle, onMove, onOpen, onDragStart, onDragEnd, onTouchMove, onTouchEnd,
}: BatchCardProps) {
  const next = nextStageOf(batch.status);
  const priority = batch.priority || 'Medium';
  const started = formatPkTime(batch.start_date);

  return (
    <article
      draggable={canEdit}
      onDragStart={event => {
        event.dataTransfer.setData('text/plain', batch.id);
        onDragStart(batch.id);
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'select-none overflow-hidden rounded-control border bg-surface shadow-e1 transition-[border-color,box-shadow,opacity] duration-150',
        dragging ? 'border-brand-accent opacity-50 ring-2 ring-ring/40' : 'border-line hover:border-line-strong hover:shadow-e2',
      )}
    >
      <div className="cursor-pointer space-y-2.5 p-3" onClick={() => onToggle(batch.id)}>
        <div className="flex items-center gap-1.5">
          {canEdit && (
            <span
              onTouchStart={() => onDragStart(batch.id)}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              onClick={event => event.stopPropagation()}
              title="Drag to change column"
              aria-hidden="true"
              className="-ml-1 flex size-7 cursor-grab touch-none items-center justify-center rounded-md text-fg-faint hover:bg-surface-2 hover:text-fg-muted active:cursor-grabbing"
            >
              <GripVertical className="size-4" />
            </span>
          )}
          <Badge tone={PRIORITY_TONE[priority] || 'neutral'}>{priority}</Badge>
          <span className="ml-auto font-mono text-[11px] font-semibold text-fg-subtle">{batch.batch_number}</span>
          <IconButton
            size="sm"
            aria-label={expanded ? 'Collapse card' : 'Expand card'}
            aria-expanded={expanded}
            icon={expanded ? <ChevronUp /> : <ChevronDown />}
            onClick={event => { event.stopPropagation(); onToggle(batch.id); }}
            className="-mr-1"
          />
        </div>

        <h4 className="text-sm font-bold leading-snug text-fg">{batch.product_name}</h4>

        <dl className="grid grid-cols-2 gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs">
          <div>
            <dt className="text-fg-subtle">Milk in</dt>
            <dd className="mt-0.5 font-bold tabular-nums text-fg">{formatQty(batch.quantity_input || 0, 3)} L</dd>
          </div>
          <div className="text-right">
            <dt className="text-fg-subtle">Target</dt>
            <dd className="mt-0.5 font-bold tabular-nums text-fg">{formatQty(batch.quantity_output_estimated || 0, 3)} {outputUnit}</dd>
          </div>
        </dl>

        <p className="text-[11px] text-fg-subtle">
          Started: {formatPkDay(batch.start_date)}{started ? `, ${started}` : ''}
        </p>
      </div>

      {expanded ? (
        <div className="space-y-2.5 border-t border-line bg-surface-2/60 p-3 animate-fade-up">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Change stage</p>
          <div className="grid grid-cols-3 gap-1" role="group" aria-label="Move to stage">
            {BOARD_STAGES.map(stage => {
              const isCurrent = batch.status === stage.id;
              return (
                <button
                  key={stage.id}
                  type="button"
                  aria-pressed={isCurrent}
                  disabled={(!canEdit && !isCurrent) || pending}
                  title={!canEdit ? "You don't have permission to change the batch stage" : undefined}
                  onClick={() => { if (!isCurrent) onMove(batch, stage.id); }}
                  className={cn(
                    'h-8 cursor-pointer rounded-lg text-[11px] font-semibold ring-1 ring-inset transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
                    isCurrent ? 'bg-fg text-surface ring-transparent' : 'bg-surface text-fg-muted ring-line hover:bg-surface-3 hover:text-fg',
                  )}
                >
                  {stage.label}
                </button>
              );
            })}
          </div>
          <Button size="sm" fullWidth leftIcon={<Package />} onClick={() => onOpen(batch)}>
            {canEdit && batch.status === ProductionStage.PACKAGING ? 'Complete batch' : 'Batch details'}
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{stageLabel(batch.status)}</span>
          {next && canEdit && (
            <Button
              size="sm"
              variant={next === ProductionStage.COMPLETED ? 'primary' : 'soft'}
              rightIcon={<ArrowRight />}
              loading={pending}
              onClick={() => onMove(batch, next)}
            >
              {next === ProductionStage.COMPLETED ? 'Finish' : 'Advance'}
            </Button>
          )}
        </div>
      )}
    </article>
  );
});
