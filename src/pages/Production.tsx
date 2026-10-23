import React, { Suspense, lazy, useCallback, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Box, CheckCircle2, Columns3, Droplets, Factory, History, TrendingUp } from 'lucide-react';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { ProductionStage, type ItemDefinition, type ProductionBatch } from '../types';
import { cleanNumber, formatQty } from '../lib/formatters';
import { businessDate } from '../lib/dashboardAnalytics';
import { BREAKPOINTS, useMediaQuery } from '../hooks/useMediaQuery';
import { Badge, Card, Money, PageHeader, SegmentedControl, Skeleton, StatCard } from '../components/ui';
import { cn } from '../lib/cn';
import { BatchCard } from '../components/milk-ops/BatchCard';
import { BOARD_STAGES, stageLabel } from '../components/milk-ops/productionStages';
import { pkDay } from '../components/milk-ops/milkOps';
import type { BatchCompletion } from '../components/milk-ops/BatchDetailModal';

const BatchDetailModal = lazy(() => import('../components/milk-ops/BatchDetailModal'));
const ProductionHistory = lazy(() => import('../components/milk-ops/ProductionHistory'));

type View = 'board' | 'history';
const viewFromSearch = (search: string): View => (new URLSearchParams(search).get('view') === 'history' ? 'history' : 'board');

const Production: React.FC = () => {
  const { productionBatches, updateBatchStage, cancelBatch, items, settings, isDayLocked, getBusinessDate, canPerform } = useDairy();
  const { showToast } = useToast();
  const canEdit = canPerform('production', 'edit');
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktopBoard = useMediaQuery(BREAKPOINTS.md);

  const today = (getBusinessDate && getBusinessDate()) || businessDate();
  const isTodayLocked = Boolean(isDayLocked && getBusinessDate && isDayLocked(getBusinessDate()));

  // The view follows the URL (?view=history).
  const [activeView, setActiveView] = useState<View>(() => viewFromSearch(window.location.search));
  const urlView = viewFromSearch(location.search);
  const [lastUrlView, setLastUrlView] = useState(urlView);
  if (urlView !== lastUrlView) {
    setLastUrlView(urlView);
    if (urlView !== activeView) setActiveView(urlView);
  }

  const selectView = (view: View) => {
    setActiveView(view);
    const sp = new URLSearchParams(location.search);
    if (view === 'history') sp.set('view', 'history');
    else sp.delete('view');
    const query = sp.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ''}`, { replace: true });
  };

  const [mobileStage, setMobileStage] = useState<string>(ProductionStage.PROCESSING);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [draggedBatchId, setDraggedBatchId] = useState<string | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const pendingRef = useRef(new Set<string>());

  const itemsById = useMemo(() => new Map<string, ItemDefinition>(items.map(item => [item.id, item])), [items]);
  const itemsByName = useMemo(() => {
    const map = new Map<string, ItemDefinition>();
    for (const item of items) if (!map.has(item.name)) map.set(item.name, item);
    return map;
  }, [items]);
  const unitByProduct = useMemo(() => {
    const map = new Map<string, string>();
    for (const [name, item] of itemsByName) map.set(name, item.unit || 'kg');
    return map;
  }, [itemsByName]);

  const batchesById = useMemo(() => new Map<string, ProductionBatch>(productionBatches.map(b => [b.id, b])), [productionBatches]);

  const board = useMemo(() => {
    const byStage: Record<string, ProductionBatch[]> = {
      [ProductionStage.PROCESSING]: [],
      [ProductionStage.QUALITY]: [],
      [ProductionStage.PACKAGING]: [],
    };
    let milkInProcess = 0;
    let completedToday = 0;
    let milkUsedToday = 0;
    let profitToday = 0;
    for (const batch of productionBatches) {
      if (batch.status === ProductionStage.COMPLETED) {
        if (pkDay(batch.completed_date || batch.start_date) === today) {
          completedToday += 1;
          milkUsedToday += Number(batch.quantity_input) || 0;
          profitToday += Number(batch.financials?.gross_profit) || 0;
        }
        continue;
      }
      if (batch.status === ProductionStage.CANCELLED) continue;
      if (byStage[batch.status]) {
        byStage[batch.status].push(batch);
        milkInProcess += Number(batch.quantity_input) || 0;
      }
    }
    const active = byStage[ProductionStage.PROCESSING].length + byStage[ProductionStage.QUALITY].length + byStage[ProductionStage.PACKAGING].length;
    return {
      byStage, active, milkInProcess: cleanNumber(milkInProcess, 3), completedToday, milkUsedToday: cleanNumber(milkUsedToday, 3), profitToday,
    };
  }, [productionBatches, today]);

  // Latest values for the stable card callbacks below.
  const latest = useRef({ canEdit, batchesById, dragOverColumnId, draggedBatchId });
  latest.current = { canEdit, batchesById, dragOverColumnId, draggedBatchId };

  const toggleCard = useCallback((id: string) => setExpandedCards(prev => ({ ...prev, [id]: !prev[id] })), []);
  const openBatch = useCallback((batch: ProductionBatch) => setSelectedBatchId(batch.id), []);

  const moveBatch = useCallback(async (batch: ProductionBatch, nextStage: ProductionStage) => {
    if (!latest.current.canEdit) {
      showToast('Aap ko is kaam ki ijazat nahi hai.', 'warning');
      return;
    }
    if (nextStage === ProductionStage.COMPLETED) {
      setSelectedBatchId(batch.id);
      return;
    }
    // One stage change at a time per batch: a double click must not skip a stage.
    if (pendingRef.current.has(batch.id)) return;
    pendingRef.current.add(batch.id);
    setPendingIds(prev => ({ ...prev, [batch.id]: true }));
    try {
      const ok = await updateBatchStage(batch.id, nextStage, `Moved to ${nextStage}`);
      if (ok) showToast(`Batch moved to "${stageLabel(nextStage)}"`, 'success');
    } finally {
      pendingRef.current.delete(batch.id);
      setPendingIds(prev => {
        const next = { ...prev };
        delete next[batch.id];
        return next;
      });
    }
  }, [showToast, updateBatchStage]);

  const endDrag = useCallback(() => {
    setDraggedBatchId(null);
    setDragOverColumnId(null);
  }, []);

  const dropOnColumn = useCallback((targetStageId: string) => {
    const { draggedBatchId: draggedId, batchesById: byId } = latest.current;
    const batch = draggedId ? byId.get(draggedId) : undefined;
    endDrag();
    if (!batch || batch.status === targetStageId) return;
    void moveBatch(batch, targetStageId as ProductionStage);
  }, [endDrag, moveBatch]);

  const handleTouchMove = useCallback((event: React.TouchEvent) => {
    const touch = event.touches[0];
    const column = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('[data-column-id]');
    const columnId = column?.getAttribute('data-column-id');
    if (columnId && columnId !== latest.current.dragOverColumnId) setDragOverColumnId(columnId);
  }, []);

  const handleTouchEnd = useCallback(() => {
    const target = latest.current.dragOverColumnId;
    if (target) dropOnColumn(target);
    else endDrag();
  }, [dropOnColumn, endDrag]);

  const selectedBatch = selectedBatchId ? batchesById.get(selectedBatchId) : undefined;
  const closeModal = useCallback(() => setSelectedBatchId(null), []);

  const completeBatch = useCallback(async (completion: BatchCompletion) => {
    if (!selectedBatchId) return false;
    if (!latest.current.canEdit) {
      showToast('Aap ko is kaam ki ijazat nahi hai.', 'warning');
      return false;
    }
    try {
      const success = await updateBatchStage(selectedBatchId, ProductionStage.COMPLETED, completion.message, {
        variants: completion.variants,
        looseQty: completion.looseQty,
      });
      if (success) {
        setSelectedBatchId(null);
        showToast('Batch completed & added to inventory!', 'success');
      }
      return Boolean(success);
    } catch (err: any) {
      showToast('Failed to complete batch: ' + (err?.message || 'Error'), 'error');
      return false;
    }
  }, [selectedBatchId, showToast, updateBatchStage]);

  const cancelSelectedBatch = useCallback(async (reason: string) => {
    if (!selectedBatchId) return false;
    if (!latest.current.canEdit) {
      showToast('Aap ko is kaam ki ijazat nahi hai.', 'warning');
      return false;
    }
    try {
      // A refused cancel (e.g. a completed batch) must not close the sheet and report success.
      const ok = await cancelBatch(selectedBatchId, reason);
      if (!ok) {
        showToast('Batch cancel nahi hua.', 'error');
        return false;
      }
      setSelectedBatchId(null);
      showToast('Batch cancelled', 'info');
      return true;
    } catch (err: any) {
      showToast('Failed to cancel batch: ' + (err?.message || 'Error'), 'error');
      return false;
    }
  }, [selectedBatchId, showToast, cancelBatch]);

  const visibleStages = isDesktopBoard ? BOARD_STAGES : BOARD_STAGES.filter(stage => stage.id === mobileStage);

  return (
    <div className="flex flex-col gap-4 pb-8 lg:gap-6">
      <PageHeader
        eyebrow="Dairy operations"
        description="Doodh se dahi, ghee aur baqi products ke batches: Start se Finish tak, phir stock mein."
        actions={
          <SegmentedControl
            aria-label="Production view"
            value={activeView}
            onChange={selectView}
            options={[
              { value: 'board', label: 'Pipeline board', icon: <Columns3 />, count: board.active },
              { value: 'history', label: 'History & log', icon: <History /> },
            ]}
          />
        }
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Production summary">
        <StatCard
          label="Active batches"
          value={board.active}
          icon={<Factory />}
          tone="brand"
          hint={board.byStage[ProductionStage.PACKAGING].length > 0 ? `${board.byStage[ProductionStage.PACKAGING].length} finish par` : undefined}
          onClick={activeView === 'board' ? undefined : () => selectView('board')}
        />
        <StatCard label="Doodh process mein" value={`${formatQty(board.milkInProcess)} L`} icon={<Droplets />} tone="info" />
        <StatCard
          label="Aaj complete"
          value={board.completedToday}
          icon={<CheckCircle2 />}
          tone="success"
          hint={board.completedToday > 0 ? `${formatQty(board.milkUsedToday)} L doodh` : undefined}
          onClick={activeView === 'history' ? undefined : () => selectView('history')}
        />
        <StatCard
          label="Aaj ka profit"
          value={<Money amount={board.profitToday} compact />}
          icon={<TrendingUp />}
          tone={board.profitToday < 0 ? 'danger' : board.profitToday > 0 ? 'success' : 'neutral'}
          hint="Complete batches"
        />
      </section>

      {activeView === 'board' ? (
        <>
          {!isDesktopBoard && (
            <SegmentedControl
              aria-label="Stage"
              fullWidth
              value={mobileStage}
              onChange={setMobileStage}
              options={BOARD_STAGES.map(stage => ({
                value: stage.id,
                label: stage.label,
                count: board.byStage[stage.id].length,
              }))}
            />
          )}

          <div className="grid items-start gap-3 md:grid-cols-3 lg:gap-4">
            {visibleStages.map(stage => {
              const batches = board.byStage[stage.id];
              const isDragOver = dragOverColumnId === stage.id;
              const Icon = stage.icon;
              return (
                <Card
                  key={stage.id}
                  data-column-id={stage.id}
                  onDragOver={event => {
                    event.preventDefault();
                    if (dragOverColumnId !== stage.id) setDragOverColumnId(stage.id);
                  }}
                  onDragLeave={() => { if (dragOverColumnId === stage.id) setDragOverColumnId(null); }}
                  onDrop={event => {
                    event.preventDefault();
                    dropOnColumn(stage.id);
                  }}
                  className={cn(
                    'flex min-h-[260px] flex-col overflow-hidden transition-[border-color,box-shadow] duration-150',
                    isDragOver && 'border-brand-accent ring-4 ring-ring/15',
                  )}
                >
                  <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
                    <h3 className="flex items-center gap-2 text-sm font-bold text-fg">
                      <Icon className="size-4 text-fg-subtle" aria-hidden="true" />
                      {stage.label}
                    </h3>
                    <Badge tone={batches.length > 0 ? 'brand' : 'neutral'}>{batches.length}</Badge>
                  </div>
                  <div className="flex flex-1 flex-col gap-2.5 bg-surface-2/40 p-2.5">
                    {batches.map(batch => (
                      <BatchCard
                        key={batch.id}
                        batch={batch}
                        outputUnit={unitByProduct.get(batch.product_name) || 'kg'}
                        canEdit={canEdit}
                        expanded={Boolean(expandedCards[batch.id])}
                        dragging={draggedBatchId === batch.id}
                        pending={Boolean(pendingIds[batch.id])}
                        onToggle={toggleCard}
                        onMove={moveBatch}
                        onOpen={openBatch}
                        onDragStart={setDraggedBatchId}
                        onDragEnd={endDrag}
                        onTouchMove={handleTouchMove}
                        onTouchEnd={handleTouchEnd}
                      />
                    ))}
                    {batches.length === 0 && (
                      <div
                        className={cn(
                          'flex flex-1 flex-col items-center justify-center gap-1.5 rounded-control border border-dashed px-4 py-10 text-center text-xs transition-colors',
                          isDragOver ? 'border-brand-accent bg-brand-soft/60 font-semibold text-brand-fg' : 'border-line text-fg-subtle',
                        )}
                      >
                        <Box className={cn('size-5', isDragOver ? 'text-brand-fg' : 'text-fg-faint')} aria-hidden="true" />
                        {isDragOver
                          ? `"${stage.label}" mein chhorein`
                          : stage.id === ProductionStage.PROCESSING
                            ? 'Naya batch Milk Allocation se shuru hota hai'
                            : 'Batch card yahan drag karein'}
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          {board.active === 0 && isDesktopBoard && (
            <p className="text-center text-xs text-fg-subtle">Abhi koi batch chal nahi raha. Milk Allocation mein "Production" chun kar batch shuru karein.</p>
          )}
        </>
      ) : (
        <Suspense fallback={<HistorySkeleton />}>
          <ProductionHistory batches={productionBatches} unitByProduct={unitByProduct} />
        </Suspense>
      )}

      {selectedBatch && (
        <Suspense fallback={null}>
          <BatchDetailModal
            key={selectedBatch.id}
            batch={selectedBatch}
            productDef={itemsByName.get(selectedBatch.product_name)}
            itemsById={itemsById}
            customUnits={settings.inventory?.customUnits || []}
            canEdit={canEdit}
            isTodayLocked={isTodayLocked}
            lockedDate={today}
            onClose={closeModal}
            onComplete={completeBatch}
            onCancel={cancelSelectedBatch}
          />
        </Suspense>
      )}
    </div>
  );
};

function HistorySkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <Skeleton className="h-14 w-full rounded-card" />
      {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-[72px] w-full rounded-card" />)}
    </div>
  );
}

export default Production;
