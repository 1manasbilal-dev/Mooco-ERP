import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { ProductionStage, ProductionBatch, PriorityLevel } from '../types';
import { PRIORITY_COLORS } from '../constants';
import { 
  Clock, Factory, ArrowRight, CheckCircle, Package, 
  X, Box, Ban, Columns, History, 
  Search, Calendar, ChevronDown, ChevronUp, FileText, AlertTriangle,
  TrendingUp, DollarSign, Beaker, Scale, Receipt, Calculator,
  Layers, CheckCircle2, AlertCircle, ArrowUpRight, GripVertical, MoveRight,
  Maximize2, Minimize2, Play, Cpu, CheckSquare, Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatQty, formatCurrency, cleanNumber, cleanQty } from '../lib/formatters';

// --- Type Fix for Framer Motion ---
const MotionDiv = motion.div as any;

const Production: React.FC = () => {
  const { productionBatches, updateBatchStage, cancelBatch, items, allocations } = useDairy();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  
  // View State from URL
  const [activeView, setActiveView] = useState<'board' | 'history'>(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('view') === 'history' ? 'history' : 'board';
  });
  const [activeMobileColumn, setActiveMobileColumn] = useState<string>(ProductionStage.PROCESSING);

  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const viewParam = sp.get('view');
    const target = viewParam === 'history' ? 'history' : 'board';
    if (target !== activeView) {
      setActiveView(target);
    }
  }, [location.search]);

  const selectView = (view: 'board' | 'history') => {
    setActiveView(view);
    const sp = new URLSearchParams(location.search);
    if (view === 'history') {
      sp.set('view', 'history');
    } else {
      sp.delete('view');
    }
    const query = sp.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ''}`, { replace: true });
  };

  // Card Expansion State
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

  // Drag and Drop State
  const [draggedBatchId, setDraggedBatchId] = useState<string | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);

  // Completion Modal State
  const [selectedBatch, setSelectedBatch] = useState<ProductionBatch | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [logMessage, setLogMessage] = useState('');
  const [isCancelMode, setIsCancelMode] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [looseOutput, setLooseOutput] = useState<number>(0);
  const [variantOutputs, setVariantOutputs] = useState<Record<string, number>>({});

  // History State
  const [historySearch, setHistorySearch] = useState('');
  const [historyDate, setHistoryDate] = useState('');
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  // Column References for Mobile Scroll-to
  const columnRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Kanban Columns with User's Required Names: Start, Processing, Finish
  const columns = [
    { 
      id: ProductionStage.PROCESSING, 
      label: 'Start', 
      shortLabel: 'Start', 
      color: 'border-amber-500', 
      headerBg: 'bg-amber-500/10 text-amber-900', 
      badgeColor: 'bg-amber-50 text-amber-700 border-amber-200',
      icon: Play
    },
    { 
      id: ProductionStage.QUALITY, 
      label: 'Processing', 
      shortLabel: 'Processing', 
      color: 'border-blue-500', 
      headerBg: 'bg-blue-500/10 text-blue-900', 
      badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
      icon: Cpu
    },
    { 
      id: ProductionStage.PACKAGING, 
      label: 'Finish', 
      shortLabel: 'Finish', 
      color: 'border-emerald-500', 
      headerBg: 'bg-emerald-500/10 text-emerald-900', 
      badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      icon: CheckSquare
    },
  ];

  const toggleCardExpand = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedCards(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Scroll to column on mobile indicator click
  const scrollToColumn = (colId: string) => {
    setActiveMobileColumn(colId);
    const el = columnRefs.current[colId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  };

  // --- Derived Data ---

  // Helper: Get Product Definition
  const productDef = useMemo(() => {
      if (!selectedBatch) return null;
      return items.find(i => i.name === selectedBatch.product_name);
  }, [selectedBatch, items]);

  const variants = useMemo(() => {
    return (productDef?.variants || []).filter(v => v.isActive !== false && v.deduct_from_base !== true);
  }, [productDef]);

  // Live Calculation of Output
  const outputBreakdown = useMemo(() => {
      let variantTotal = 0;
      const variantDetails: {name: string, count: number, totalWeight: number, unit: string}[] = [];

      if (variants && variantOutputs) {
          variants.forEach(v => {
              const count = variantOutputs[v.id] || 0;
              if (count > 0) {
                  const weight = count * (v.quantity_in_base_unit || 0);
                  variantTotal += weight;
                  variantDetails.push({
                      name: v.name,
                      count,
                      totalWeight: weight,
                      unit: productDef?.unit || 'kg'
                  });
              }
          });
      }
      
      const loose = looseOutput || 0;
      const total = loose + variantTotal;
      
      return { loose, variantTotal, total, variantDetails };
  }, [looseOutput, variantOutputs, variants, productDef]);

  // Estimated Cost Calculation for Active Batch (Preview)
  const financialPreview = useMemo(() => {
     if (!selectedBatch || !productDef) return null;
     
     // 1. Milk Cost (Input)
     const avgMilkRate = allocations.length > 0 
        ? (allocations.reduce((sum, a) => sum + (a.average_rate || 0), 0) / allocations.length) 
        : 120; 
     const milkCost = (selectedBatch.quantity_input || 0) * avgMilkRate;

     // 2. Ingredients (Bill of Materials)
     let additiveCost = 0;
     const breakdown: {name: string, qty: number, unit: string, unitCost: number, total: number}[] = [];
     
     // Add Base Milk to breakdown
     breakdown.push({
        name: `Raw Milk Base`,
        qty: selectedBatch.quantity_input || 0,
        unit: 'L',
        unitCost: avgMilkRate,
        total: milkCost
     });

     if (productDef.recipe && productDef.recipe_base_quantity) {
        const scale = (selectedBatch.quantity_input || 0) / productDef.recipe_base_quantity;
        productDef.recipe.forEach(ing => {
           const item = items.find(i => i.id === ing.item_id);
           const qty = ing.quantity * scale;
           const unitCost = item?.cost_price || 0;
           const cost = qty * unitCost;
           additiveCost += cost;
           
           breakdown.push({
              name: ing.item_name,
              qty: parseFloat(qty.toFixed(2)),
              unit: ing.unit,
              unitCost: unitCost,
              total: cost
           });
        });
     }

     // 3. Packaging Cost
     let packagingCost = 0;
     if (variants.length > 0) {
         variants.forEach(v => {
             const count = variantOutputs[v.id] || 0;
             if (count > 0 && v.packaging_item_id) {
                 const packItem = items.find(i => i.id === v.packaging_item_id);
                 if (packItem) {
                     const packQtyUsed = count * v.packaging_qty;
                     const cost = packQtyUsed * (packItem.cost_price || 0);
                     packagingCost += cost;
                     breakdown.push({
                        name: `${v.name} Packaging (${packItem.name})`,
                        qty: packQtyUsed,
                        unit: packItem.unit,
                        unitCost: packItem.cost_price,
                        total: cost
                     });
                 }
             }
         });
     }

     const totalCost = milkCost + additiveCost + packagingCost;
     
     // 4. Est Revenue & Output
     const outputForCalc = outputBreakdown.total > 0 ? outputBreakdown.total : (selectedBatch.quantity_output_estimated || 0);
     
     // Revenue Calc
     let revenue = 0;
     variants.forEach(v => {
        const count = variantOutputs[v.id] || 0;
        const unitPrice = v.selling_price || (productDef.selling_price * v.quantity_in_base_unit);
        revenue += count * unitPrice;
     });
     revenue += looseOutput * productDef.selling_price;
     
     if (outputBreakdown.total === 0) {
        revenue = (selectedBatch.quantity_output_estimated || 0) * productDef.selling_price;
     }

     const profit = revenue - totalCost;
     const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
     
     const estimated = selectedBatch.quantity_output_estimated || 0;
     const yieldPercent = estimated > 0 
        ? (outputForCalc / estimated) * 100 
        : 0;

     return { 
        breakdown, 
        totalCost, 
        revenue, 
        profit, 
        margin, 
        totalActualOutput: outputForCalc,
        yieldPercent
     };
  }, [selectedBatch, productDef, allocations, items, looseOutput, variantOutputs, outputBreakdown]);

  // Filter Data for Views
  const activeBatches = productionBatches.filter(b => 
    b.status !== ProductionStage.COMPLETED && b.status !== ProductionStage.CANCELLED
  );

  const historyBatches = useMemo(() => {
    return productionBatches
      .filter(b => b.status === ProductionStage.COMPLETED || b.status === ProductionStage.CANCELLED)
      .filter(b => {
        const nameMatch = (b.product_name || '').toLowerCase().includes(historySearch.toLowerCase());
        const batchMatch = (b.batch_number || '').toLowerCase().includes(historySearch.toLowerCase());
        const matchesSearch = nameMatch || batchMatch;
        const dateStr = b.completed_date || b.start_date || '';
        const matchesDate = historyDate ? dateStr.startsWith(historyDate) : true;
        return matchesSearch && matchesDate;
      })
      .sort((a, b) => new Date(b.completed_date || b.start_date || 0).getTime() - new Date(a.completed_date || a.start_date || 0).getTime());
  }, [productionBatches, historySearch, historyDate]);

  // Group History by Date
  const groupedHistory = useMemo(() => {
    const groups: Record<string, ProductionBatch[]> = {};
    historyBatches.forEach(batch => {
      const d = batch.completed_date || batch.start_date;
      if (!d) return; 
      const date = new Date(d).toLocaleDateString(undefined, { 
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
      });
      if (!groups[date]) groups[date] = [];
      groups[date].push(batch);
    });
    return groups;
  }, [historyBatches]);

  // --- Effects & Handlers ---

  useEffect(() => {
    if (selectedBatch) {
       const defaultOutput = selectedBatch.quantity_output_estimated || (selectedBatch.quantity_input ? selectedBatch.quantity_input * 0.85 : 0);
       setLooseOutput(parseFloat(defaultOutput.toFixed(2)));
       setVariantOutputs({});
       setLogMessage('');
       setIsCancelMode(false);
       setCancelReason('');
    }
  }, [selectedBatch?.id]);

  const handleStageUpdate = (batch: ProductionBatch, nextStage: ProductionStage) => {
    if (nextStage === ProductionStage.COMPLETED) {
       setSelectedBatch(batch);
       return;
    }
    updateBatchStage(batch.id, nextStage, `Moved to ${nextStage}`);
    const stageName = nextStage === ProductionStage.PROCESSING ? 'Start' : nextStage === ProductionStage.QUALITY ? 'Processing' : 'Finish';
    showToast(`Batch moved to "${stageName}"`, "success");
  };

  const handleDropOnColumn = (targetStageId: string) => {
    if (!draggedBatchId) return;
    const batch = productionBatches.find(b => b.id === draggedBatchId);
    if (!batch) return;

    if (batch.status === targetStageId) {
      setDraggedBatchId(null);
      setDragOverColumnId(null);
      return;
    }

    if (targetStageId === ProductionStage.COMPLETED) {
      setSelectedBatch(batch);
    } else {
      updateBatchStage(batch.id, targetStageId as ProductionStage, `Dragged to ${targetStageId}`);
      const colObj = columns.find(c => c.id === targetStageId);
      showToast(`Batch moved to "${colObj?.label || targetStageId}"`, "success");
    }
    setDraggedBatchId(null);
    setDragOverColumnId(null);
  };

  // Touch Drag-and-Drop Handlers for Mobile Screens
  const handleTouchMove = (e: React.TouchEvent, batchId: string) => {
    const touch = e.touches[0];
    const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
    const colEl = targetEl?.closest('[data-column-id]') as HTMLElement | null;
    if (colEl) {
      const colId = colEl.getAttribute('data-column-id');
      if (colId && colId !== dragOverColumnId) {
        setDragOverColumnId(colId);
      }
    }
  };

  const handleTouchEnd = (batchId: string) => {
    if (dragOverColumnId) {
      handleDropOnColumn(dragOverColumnId);
    }
    setDraggedBatchId(null);
    setDragOverColumnId(null);
  };

  const isCompletingRef = useRef(false);

  const handleCompleteBatch = async () => {
    if (!selectedBatch || isSubmitting || isCompletingRef.current) return;
    
    isCompletingRef.current = true;
    setIsSubmitting(true);
    
    // Construct Variants Data Payload
    const variantsData = Object.entries(variantOutputs).map(([variantId, count]) => {
        const variantDef = productDef?.variants?.find(v => v.id === variantId);
        return {
            variantId,
            count: count as number,
            variant_name: variantDef?.name || 'Unknown',
            base_qty_each: variantDef?.quantity_in_base_unit || 0,
            total_base_qty: (variantDef?.quantity_in_base_unit || 0) * (count as number)
        };
    }).filter(v => v.count > 0);

    const hasVariants = variantsData.length > 0;
    const finalLooseQty = (looseOutput > 0 || !hasVariants) 
      ? (looseOutput > 0 ? looseOutput : (selectedBatch.quantity_output_estimated || (selectedBatch.quantity_input ? selectedBatch.quantity_input * 0.85 : 0))) 
      : 0;

    try {
      const success = await updateBatchStage(
         selectedBatch.id, 
         ProductionStage.COMPLETED, 
         logMessage || 'Batch Completed', 
         { variants: variantsData, looseQty: parseFloat((finalLooseQty || 0).toFixed(2)) }
      );
      if (success) {
        setSelectedBatch(null);
        showToast(`Batch completed & added to inventory!`, "success");
      }
    } catch (err: any) {
      showToast("Failed to complete batch: " + (err?.message || "Error"), "error");
    } finally {
      setIsSubmitting(false);
      setTimeout(() => {
        isCompletingRef.current = false;
      }, 500);
    }
  };

  const handleCancelBatch = async () => {
    if (!selectedBatch || !cancelReason || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await cancelBatch(selectedBatch.id, cancelReason);
      setSelectedBatch(null);
      showToast("Batch cancelled", "info");
    } catch (err: any) {
      showToast("Failed to cancel batch: " + (err?.message || "Error"), "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const getNextStage = (current: ProductionStage) => {
      if (current === ProductionStage.PROCESSING) return ProductionStage.QUALITY;
      if (current === ProductionStage.QUALITY) return ProductionStage.PACKAGING;
      if (current === ProductionStage.PACKAGING) return ProductionStage.COMPLETED;
      return null;
  };

  // Render Expandable Batch Card with Mobile & Desktop Drag and Drop
  const renderBatchCard = (batch: ProductionBatch) => {
    const nextStageId = getNextStage(batch.status);
    const isBeingDragged = draggedBatchId === batch.id;
    const isExpanded = !!expandedCards[batch.id];
    
    return (
      <div 
        key={batch.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', batch.id);
          setDraggedBatchId(batch.id);
        }}
        onDragEnd={() => {
          setDraggedBatchId(null);
          setDragOverColumnId(null);
        }}
        className={`bg-white rounded-2xl border transition-all select-none overflow-hidden ${
          isBeingDragged 
            ? 'opacity-40 scale-95 border-lime-500 shadow-xl ring-2 ring-lime-500' 
            : 'border-slate-200/90 shadow-2xs hover:border-lime-500/60 hover:shadow-sm'
        }`}
      >
        {/* Top Summary Bar (Collapsible Header) */}
        <div 
          onClick={() => toggleCardExpand(batch.id)}
          className="p-3 sm:p-3.5 cursor-pointer hover:bg-slate-50/50 transition-colors space-y-2"
        >
          {/* Row 1: Drag Handle + Priority + Batch Number + Expand Chevron */}
          <div className="flex justify-between items-center gap-1.5">
            <div className="flex items-center gap-1.5">
              {/* Touch & Mouse Drag Handle */}
              <div 
                onTouchStart={() => setDraggedBatchId(batch.id)}
                onTouchMove={(e) => handleTouchMove(e, batch.id)}
                onTouchEnd={() => handleTouchEnd(batch.id)}
                className="text-slate-400 hover:text-slate-600 p-1 -ml-1 rounded-md touch-none cursor-grab active:cursor-grabbing hover:bg-slate-100 transition-colors"
                title="Drag to move column"
                onClick={(e) => e.stopPropagation()}
              >
                <GripVertical size={15} />
              </div>

              <span className={`text-[9px] sm:text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider border ${PRIORITY_COLORS[batch.priority || 'Medium']}`}>
                {batch.priority || 'Medium'}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] sm:text-xs text-slate-400 font-mono font-bold">{batch.batch_number}</span>
              <button 
                onClick={(e) => toggleCardExpand(batch.id, e)} 
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                title={isExpanded ? "Collapse Card" : "Expand Card"}
              >
                {isExpanded ? <ChevronUp size={15}/> : <ChevronDown size={15}/>}
              </button>
            </div>
          </div>
          
          {/* Row 2: Product Name */}
          <h4 className="font-bold text-xs sm:text-sm text-slate-900 leading-snug">
            {batch.product_name}
          </h4>

          {/* Row 3: Compact Key Metrics */}
          <div className="flex items-center justify-between text-[11px] bg-slate-50 px-2.5 py-1.5 rounded-xl border border-slate-100 text-slate-600">
            <div>
              <span className="text-slate-400 font-semibold">In: </span>
              <span className="font-bold font-mono text-slate-800">{formatQty(batch.quantity_input || 0)} L</span>
            </div>
            <div>
              <span className="text-slate-400 font-semibold">Target: </span>
              <span className="font-bold font-mono text-emerald-700">{formatQty(batch.quantity_output_estimated || 0)} kg</span>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* --- EXPANDABLE BODY CONTENT ---                                           */}
        {/* ========================================================================= */}
        <AnimatePresence>
          {isExpanded && (
            <MotionDiv
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="border-t border-slate-100 bg-slate-50/50 p-3 sm:p-3.5 space-y-2.5"
            >
              {/* Detailed Metrics */}
              <div className="grid grid-cols-2 gap-2 text-center text-xs">
                <div className="bg-white p-2 rounded-xl border border-slate-200">
                  <p className="text-[9px] font-bold text-slate-400 uppercase">Start Date</p>
                  <p className="font-bold text-slate-700 mt-0.5">{new Date(batch.start_date).toLocaleDateString()}</p>
                </div>
                <div className="bg-white p-2 rounded-xl border border-slate-200">
                  <p className="text-[9px] font-bold text-slate-400 uppercase">Current Stage</p>
                  <p className="font-black text-slate-800 mt-0.5 uppercase text-[10px]">
                    {batch.status === ProductionStage.PROCESSING ? 'Start' : batch.status === ProductionStage.QUALITY ? 'Processing' : 'Finish'}
                  </p>
                </div>
              </div>

              {/* Quick Stage Switcher Pills (Mobile Touch Friendly) */}
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block ml-0.5">Move to Stage:</span>
                <div className="grid grid-cols-3 gap-1">
                  {columns.map(col => {
                    const isCurrent = batch.status === col.id;
                    return (
                      <button
                        key={col.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isCurrent) {
                            handleStageUpdate(batch, col.id as ProductionStage);
                          }
                        }}
                        className={`py-1.5 px-1 rounded-lg text-[10px] font-bold transition-all text-center border cursor-pointer ${
                          isCurrent 
                            ? 'bg-slate-900 text-white border-slate-900 shadow-2xs font-black' 
                            : 'bg-white hover:bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {col.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Bottom Card Actions (Finish Modal or Cancel) */}
              <div className="flex gap-2 pt-1 border-t border-slate-200/80">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedBatch(batch);
                  }}
                  className="flex-1 bg-lime-600 hover:bg-lime-700 text-white py-1.5 px-2 rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Package size={13} />
                  <span>{batch.status === ProductionStage.PACKAGING ? 'Complete Batch' : 'Batch Details'}</span>
                </button>
              </div>
            </MotionDiv>
          )}
        </AnimatePresence>

        {/* Card Footer Strip (When collapsed): Quick Advance Button */}
        {!isExpanded && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 bg-white">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              {batch.status === ProductionStage.PROCESSING ? 'Start' : batch.status === ProductionStage.QUALITY ? 'Processing' : 'Finish'}
            </span>

            {nextStageId && (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  if (nextStageId === ProductionStage.COMPLETED) {
                      setSelectedBatch(batch);
                  } else {
                      handleStageUpdate(batch, nextStageId);
                  }
                }}
                className="text-xs bg-lime-600 hover:bg-lime-700 active:scale-95 text-white px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition-all shadow-xs cursor-pointer"
                title="Advance to next stage"
              >
                <span>{nextStageId === ProductionStage.COMPLETED ? 'Finish' : 'Advance'}</span> 
                <ArrowRight size={12} />
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-[calc(100vh-5.5rem)] md:h-[calc(100vh-6.5rem)] gap-2.5 sm:gap-3.5 pb-2 overflow-hidden">
      
      {/* View Switcher Strip */}
      <div className="flex justify-end items-center bg-white p-2 rounded-2xl border border-slate-200/90 shadow-2xs shrink-0">
        <div className="flex p-1 bg-slate-100 rounded-xl w-full sm:w-auto">
           <button 
             onClick={() => selectView('board')} 
             className={`flex-1 sm:flex-initial px-4 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                activeView === 'board' ? 'bg-white text-slate-900 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
             }`}
           >
              <Columns size={14}/> <span>Pipeline Board</span>
           </button>
           <button 
             onClick={() => selectView('history')} 
             className={`flex-1 sm:flex-initial px-4 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                activeView === 'history' ? 'bg-white text-slate-900 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
             }`}
           >
              <History size={14}/> <span>History & Log</span>
           </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* --- VIEW: DRAG & DROP KANBAN PIPELINE (Start, Processing, Finish) ---      */}
      {/* ========================================================================= */}
      {activeView === 'board' && (
        <div className="flex-1 overflow-hidden flex flex-col gap-2 min-h-0">
          
          {/* Mobile Quick Stage Jump Tabs (Visible on Mobile < md) */}
          <div className="flex md:hidden items-center justify-between gap-1 bg-white p-1.5 rounded-xl border border-slate-200/90 shadow-2xs shrink-0">
            {columns.map(col => {
              const count = activeBatches.filter(b => b.status === col.id).length;
              const isActive = activeMobileColumn === col.id;
              const Icon = col.icon;
              return (
                <button
                  key={col.id}
                  onClick={() => scrollToColumn(col.id)}
                  className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    isActive
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Icon size={13} className={isActive ? 'text-lime-400' : 'text-slate-400'} />
                  <span className="truncate">{col.label}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${isActive ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* DRAG AND DROP KANBAN BOARD CONTAINER */}
          {/* On Mobile: Smooth Snap-Scrolling 3-Stage Pipeline | On Desktop: 3-Column Grid */}
          <div className="flex-1 overflow-x-auto overflow-y-hidden flex snap-x snap-mandatory md:snap-none gap-3 pb-1 min-h-0 scrollbar-thin">
            {columns.map(col => {
               const batchesInStage = activeBatches.filter(b => b.status === col.id);
               const isDragOver = dragOverColumnId === col.id;
               const Icon = col.icon;

               return (
                 <div 
                   key={col.id}
                   data-column-id={col.id}
                   ref={el => { columnRefs.current[col.id] = el; }}
                   onDragOver={(e) => {
                     e.preventDefault();
                     setDragOverColumnId(col.id);
                   }}
                   onDragLeave={() => {
                     if (dragOverColumnId === col.id) setDragOverColumnId(null);
                   }}
                   onDrop={(e) => {
                     e.preventDefault();
                     handleDropOnColumn(col.id);
                   }}
                   className={`w-[85vw] sm:w-[320px] md:w-auto md:flex-1 shrink-0 snap-center flex flex-col bg-white rounded-2xl border shadow-2xs overflow-hidden transition-all min-h-0 ${
                     isDragOver 
                       ? 'border-2 border-dashed border-lime-500 bg-lime-50/50 ring-4 ring-lime-500/10' 
                       : 'border-slate-200/90'
                   }`}
                 >
                   {/* Column Header */}
                   <div className={`flex items-center justify-between px-3.5 py-2.5 border-b-2 bg-slate-50/70 shrink-0 ${col.color}`}>
                     <div className="flex items-center gap-1.5">
                       <Icon size={15} className="text-slate-600" />
                       <h3 className="font-black text-xs text-slate-900 uppercase tracking-wider">{col.label}</h3>
                     </div>
                     <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${col.badgeColor}`}>
                       {batchesInStage.length}
                     </span>
                   </div>
                   
                   {/* Column Cards Drop Area */}
                   <div className="flex-1 bg-slate-50/30 p-2.5 space-y-2.5 overflow-y-auto min-h-0">
                     {batchesInStage.map(batch => renderBatchCard(batch))}
                     
                     {batchesInStage.length === 0 && (
                       <div className={`h-36 flex flex-col items-center justify-center text-xs border border-dashed rounded-2xl transition-all ${
                         isDragOver 
                           ? 'border-lime-500 bg-lime-100/60 text-lime-800 font-bold' 
                           : 'border-slate-200 bg-white/60 text-slate-400'
                       }`}>
                         <Box size={22} className={`mb-1.5 ${isDragOver ? 'text-lime-600 animate-bounce' : 'text-slate-300'}`} />
                         <span>{isDragOver ? `Drop to move to "${col.label}"` : `Drag & drop batches here`}</span>
                       </div>
                     )}
                   </div>
                 </div>
               );
            })}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* --- VIEW: HISTORY TIMELINE ---                                            */}
      {/* ========================================================================= */}
      {activeView === 'history' && (
        <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden min-h-0">
           {/* Filters Toolbar */}
           <div className="p-2.5 sm:p-3 border-b border-slate-100 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center bg-slate-50/60 shrink-0">
              <div className="relative flex-1">
                 <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14}/>
                 <input 
                   type="text" placeholder="Search batch # or product name..." 
                   className="w-full pl-8.5 pr-7 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-lime-500 transition-all shadow-inner"
                   value={historySearch} onChange={e => setHistorySearch(e.target.value)}
                 />
                 {historySearch && (
                   <button onClick={() => setHistorySearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer">
                     <X size={12} />
                   </button>
                 )}
              </div>
              <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 shadow-inner shrink-0">
                 <Calendar size={14} className="text-slate-400"/>
                 <input 
                   type="date" className="text-xs font-semibold text-slate-700 outline-none bg-transparent"
                   value={historyDate} onChange={e => setHistoryDate(e.target.value)}
                 />
                 {historyDate && (
                   <button onClick={() => setHistoryDate('')} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                     <X size={12} />
                   </button>
                 )}
              </div>
           </div>

           {/* Timeline History List */}
           <div className="flex-1 overflow-y-auto p-3 sm:p-4 bg-slate-50/40 space-y-4">
              {historyBatches.length === 0 ? (
                 <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                    <History size={36} className="mb-2 opacity-30"/>
                    <p className="text-xs font-bold text-slate-600">No production history records found.</p>
                 </div>
              ) : (
                 <div className="max-w-4xl mx-auto space-y-5">
                    {(Object.entries(groupedHistory) as [string, ProductionBatch[]][]).map(([dateLabel, batches]) => (
                       <div key={dateLabel} className="space-y-2">
                          <div className="sticky top-0 z-10">
                             <span className="bg-slate-200/90 backdrop-blur-xs text-slate-700 text-[10px] sm:text-xs font-bold px-2.5 py-1 rounded-full shadow-2xs border border-slate-300">
                                {dateLabel}
                             </span>
                          </div>

                          <div className="space-y-2.5">
                             {batches.map(batch => {
                                const isCompleted = batch.status === ProductionStage.COMPLETED;
                                const actualOutput = batch.quantity_output_actual || 0;
                                const estimated = batch.quantity_output_estimated || 0;
                                const yieldPercent = estimated > 0 ? (actualOutput / estimated) * 100 : 0;
                                const isExpanded = expandedHistoryId === batch.id;
                                const profit = batch.financials?.gross_profit;

                                return (
                                   <div 
                                      key={batch.id} 
                                      className={`bg-white rounded-2xl border transition-all overflow-hidden ${
                                        isExpanded ? 'shadow-sm border-slate-300 ring-2 ring-slate-200/50' : 'shadow-2xs border-slate-200 hover:border-slate-300'
                                      }`}
                                   >
                                      {/* History Item Header */}
                                      <div 
                                         className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer"
                                         onClick={() => setExpandedHistoryId(isExpanded ? null : batch.id)}
                                      >
                                         <div className="flex items-center gap-3">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                                              isCompleted ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'
                                            }`}>
                                               {isCompleted ? <Package size={18}/> : <Ban size={18}/>}
                                            </div>
                                            <div className="min-w-0">
                                               <div className="flex items-center gap-1.5 flex-wrap">
                                                  <h4 className="font-bold text-xs sm:text-sm text-slate-900">{batch.product_name}</h4>
                                                  <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded font-mono font-bold border border-slate-200">{batch.batch_number}</span>
                                               </div>
                                               <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2 font-medium">
                                                  <span><strong className="text-slate-700">In:</strong> {formatQty(batch.quantity_input || 0)} L</span>
                                                  <span>•</span>
                                                  {isCompleted ? <span><strong className="text-slate-700">Out:</strong> {formatQty(actualOutput)} kg</span> : <span className="text-rose-600 font-bold">Cancelled</span>}
                                               </div>
                                            </div>
                                         </div>

                                         <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100">
                                            {isCompleted ? (
                                               <div className="flex gap-3 text-right">
                                                  {profit !== undefined && (
                                                     <div>
                                                        <p className="text-[9px] font-bold text-slate-400 uppercase">Profit</p>
                                                        <p className={`font-mono font-bold text-xs sm:text-sm ${profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                                           Rs {profit.toFixed(0)}
                                                        </p>
                                                     </div>
                                                  )}
                                                  <div>
                                                     <p className="text-[9px] font-bold text-slate-400 uppercase">Yield</p>
                                                     <p className={`font-mono font-bold text-xs sm:text-sm ${yieldPercent >= 95 ? 'text-emerald-700' : yieldPercent >= 85 ? 'text-amber-700' : 'text-rose-700'}`}>
                                                        {yieldPercent.toFixed(1)}%
                                                     </p>
                                                  </div>
                                               </div>
                                            ) : (
                                               <span className="text-xs font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-lg border border-rose-200">Cancelled</span>
                                            )}
                                            
                                            <div className="text-slate-400 p-1">
                                               {isExpanded ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
                                            </div>
                                         </div>
                                      </div>

                                      {/* Expanded Details */}
                                      <AnimatePresence>
                                         {isExpanded && (
                                            <MotionDiv 
                                               initial={{ height: 0 }} 
                                               animate={{ height: 'auto' }} 
                                               exit={{ height: 0 }} 
                                               className="border-t border-slate-100 bg-slate-50/60 p-3 sm:p-4 space-y-3"
                                            >
                                               {batch.financials && (
                                                  <div className="grid grid-cols-3 gap-2 text-center bg-white p-2.5 rounded-xl border border-slate-200">
                                                     <div>
                                                       <p className="text-[9px] text-slate-400 uppercase font-bold">Total Cost</p>
                                                       <p className="font-bold text-xs font-mono text-slate-800">Rs {batch.financials.total_cost.toFixed(0)}</p>
                                                     </div>
                                                     <div>
                                                       <p className="text-[9px] text-slate-400 uppercase font-bold">Sales Value</p>
                                                       <p className="font-bold text-xs font-mono text-slate-800">Rs {batch.financials.sales_value.toFixed(0)}</p>
                                                     </div>
                                                     <div>
                                                       <p className="text-[9px] text-slate-400 uppercase font-bold">Additives Cost</p>
                                                       <p className="font-bold text-xs font-mono text-slate-800">Rs {batch.financials.additives_cost.toFixed(0)}</p>
                                                     </div>
                                                  </div>
                                               )}

                                               <div>
                                                  <h5 className="text-[10px] font-bold text-slate-500 uppercase mb-2 flex items-center gap-1.5">
                                                     <FileText size={12}/> Batch Lifecycle Logs
                                                  </h5>
                                                  <div className="space-y-2 border-l-2 border-slate-200 pl-3">
                                                     {(batch.logs || []).map((log, idx) => (
                                                        <div key={idx} className="text-xs space-y-0.5">
                                                           <div className="flex justify-between items-start gap-2">
                                                              <span className="font-semibold text-slate-700">{log.message}</span>
                                                              <span className="text-[10px] text-slate-400 shrink-0">{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                           </div>
                                                           <span className={`inline-block text-[9px] px-1.5 py-0.2 rounded font-bold ${
                                                              log.stage === ProductionStage.COMPLETED ? 'bg-emerald-100 text-emerald-800' : 
                                                              log.stage === ProductionStage.CANCELLED ? 'bg-red-100 text-red-800' : 
                                                              'bg-slate-200 text-slate-700'
                                                           }`}>
                                                              {log.stage}
                                                           </span>
                                                        </div>
                                                     ))}
                                                  </div>
                                               </div>
                                            </MotionDiv>
                                         )}
                                      </AnimatePresence>
                                   </div>
                                );
                             })}
                          </div>
                       </div>
                    ))}
                 </div>
              )}
           </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* --- BATCH ACTION MODAL (z-[100]) ---                                      */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {selectedBatch && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4">
            <MotionDiv 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs" 
              onClick={() => setSelectedBatch(null)} 
            />
            <MotionDiv 
              initial={{ scale: 0.95, opacity: 0, y: 15 }} 
              animate={{ scale: 1, opacity: 1, y: 0 }} 
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-hidden flex flex-col"
            >
              {/* Modal Header */}
              <div className="flex justify-between items-center px-4 sm:px-5 py-3.5 border-b border-slate-100 bg-slate-50 shrink-0">
                 <div>
                   <h3 className="text-sm sm:text-base font-black text-slate-900 flex items-center gap-1.5">
                     {selectedBatch.product_name} 
                     <span className="text-[10px] font-mono text-slate-500 bg-white px-1.5 py-0.5 rounded border border-slate-200 font-bold">{selectedBatch.batch_number}</span>
                   </h3>
                   <p className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1.5 font-semibold">
                      Started: {new Date(selectedBatch.start_date).toLocaleDateString()}
                      <span>•</span>
                      <span className="uppercase font-bold text-lime-700">
                        {selectedBatch.status === ProductionStage.PROCESSING ? 'Start' : selectedBatch.status === ProductionStage.QUALITY ? 'Processing' : 'Finish'}
                      </span>
                   </p>
                 </div>
                 <button onClick={() => setSelectedBatch(null)} className="p-1.5 bg-white rounded-full hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors border border-slate-200 cursor-pointer">
                     <X size={15}/>
                 </button>
              </div>

              {/* Modal Content */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
                  
                  {/* 1. Metrics Grid */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Input Milk</p>
                          <p className="text-sm sm:text-base font-black font-mono text-slate-900">{formatQty(selectedBatch.quantity_input || 0)} <span className="text-[10px] text-slate-400 font-normal">L</span></p>
                      </div>
                      <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Target Yield</p>
                          <p className="text-sm sm:text-base font-black font-mono text-slate-900">{formatQty(selectedBatch.quantity_output_estimated || 0)} <span className="text-[10px] text-slate-400 font-normal">kg</span></p>
                      </div>
                      <div className={`p-2.5 rounded-xl border ${financialPreview && financialPreview.profit >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
                          <p className={`text-[9px] font-bold uppercase tracking-wider ${financialPreview && financialPreview.profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>Est. Profit</p>
                          <p className={`text-sm sm:text-base font-black font-mono ${financialPreview && financialPreview.profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                              {financialPreview ? formatCurrency(financialPreview.profit) : '-'}
                          </p>
                      </div>
                  </div>

                  {/* 2. Recipe & Financials Breakdown */}
                  {financialPreview && (
                      <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
                          <div className="bg-slate-50 px-3 py-1.5 border-b border-slate-200">
                              <h4 className="font-bold text-[10px] text-slate-500 uppercase flex items-center gap-1.5"><Receipt size={13}/> Cost & Yield Analysis</h4>
                          </div>
                          <table className="w-full">
                              <tbody className="divide-y divide-slate-100">
                                  {financialPreview.breakdown.map((item, idx) => (
                                      <tr key={idx} className="hover:bg-slate-50/50">
                                          <td className="px-3 py-1.5 text-slate-700 font-medium">{item.name}</td>
                                          <td className="px-3 py-1.5 text-right text-[11px] text-slate-400 font-mono">{item.qty} {item.unit}</td>
                                          <td className="px-3 py-1.5 text-right font-bold font-mono text-slate-900">Rs {item.total.toFixed(0)}</td>
                                      </tr>
                                  ))}
                                  <tr className="bg-slate-50 font-black">
                                      <td className="px-3 py-2 text-slate-900">Total Est. Cost</td>
                                      <td className="px-3 py-2"></td>
                                      <td className="px-3 py-2 text-right text-rose-700 font-mono">Rs {financialPreview.totalCost.toFixed(0)}</td>
                                  </tr>
                              </tbody>
                          </table>
                      </div>
                  )}

                  {/* 3. Completion Controls */}
                  {selectedBatch.status !== ProductionStage.COMPLETED && selectedBatch.status !== ProductionStage.CANCELLED && (
                      <div className="space-y-3 pt-2 border-t border-slate-100">
                          {isCancelMode ? (
                              <div className="bg-rose-50 p-3.5 rounded-2xl border border-rose-200 space-y-2.5">
                                  <label className="block text-xs font-bold text-rose-800 uppercase">Reason for Cancellation</label>
                                  <textarea 
                                      className="w-full p-2.5 rounded-xl border border-rose-200 text-xs focus:outline-none focus:border-rose-400 bg-white font-medium"
                                      placeholder="e.g. Milk spoiled, machine error..."
                                      rows={2}
                                      value={cancelReason}
                                      onChange={e => setCancelReason(e.target.value)}
                                  />
                                  <div className="flex gap-2">
                                      <button onClick={handleCancelBatch} className="flex-1 bg-rose-600 text-white py-2 rounded-xl text-xs font-bold hover:bg-rose-700 cursor-pointer shadow-xs">Confirm Cancel</button>
                                      <button onClick={() => setIsCancelMode(false)} className="bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-xl text-xs font-bold hover:bg-slate-50 cursor-pointer">Back</button>
                                  </div>
                              </div>
                          ) : (
                              <>
                                  {/* Output Entry (Only if Finish / Packaging stage) */}
                                  {selectedBatch.status === ProductionStage.PACKAGING && (
                                      <div className="bg-lime-50/70 p-3.5 rounded-2xl border border-lime-200/80 space-y-3">
                                          <div className="flex justify-between items-center">
                                              <h4 className="font-black text-lime-900 text-xs flex items-center gap-1.5"><Package size={14}/> Final Production Output</h4>
                                              <div className="bg-white px-2.5 py-0.5 rounded-full border border-lime-300 text-xs font-black text-lime-800 font-mono shadow-2xs">
                                                  Yield: {outputBreakdown.total.toFixed(2)} {productDef?.unit || 'kg'}
                                              </div>
                                          </div>
                                          
                                          {/* Loose Output */}
                                          <div>
                                              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1 ml-0.5">Loose Quantity ({productDef?.unit || 'kg'})</label>
                                              <input 
                                                  type="number" 
                                                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-900 outline-none focus:ring-2 focus:ring-lime-500 shadow-inner"
                                                  value={looseOutput}
                                                  onChange={e => setLooseOutput(parseFloat(e.target.value) || 0)}
                                                  placeholder="0.00"
                                              />
                                          </div>

                                          {/* Variants */}
                                          {variants.length > 0 && (
                                              <div className="space-y-1.5">
                                                  <label className="block text-[10px] font-bold text-slate-500 uppercase ml-0.5">Packaged Variants</label>
                                                  {variants.map(v => (
                                                      <div key={v.id} className="flex items-center justify-between bg-white p-2 rounded-xl border border-lime-200 shadow-2xs">
                                                          <div className="min-w-0 pr-2">
                                                              <span className="text-xs font-bold text-slate-800 block truncate">{v.name}</span>
                                                              <span className="text-[10px] text-slate-400">({v.quantity_in_base_unit} {productDef?.unit} each)</span>
                                                          </div>
                                                          <div className="flex items-center gap-1.5 shrink-0">
                                                              <input 
                                                                  type="number" 
                                                                  className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-right font-black font-mono text-xs bg-slate-50 text-slate-900 outline-none focus:bg-white focus:ring-1 focus:ring-lime-500"
                                                                  placeholder="0"
                                                                  value={variantOutputs[v.id] || ''}
                                                                  onChange={e => setVariantOutputs(prev => ({ ...prev, [v.id]: parseFloat(e.target.value) || 0 }))}
                                                              />
                                                              <span className="text-[10px] font-bold text-slate-400">units</span>
                                                          </div>
                                                      </div>
                                                  ))}
                                              </div>
                                          )}

                                          <div>
                                              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1 ml-0.5">Production Remarks</label>
                                              <input 
                                                  type="text" 
                                                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-lime-500 shadow-inner"
                                                  placeholder="Optional batch remarks..."
                                                  value={logMessage}
                                                  onChange={e => setLogMessage(e.target.value)}
                                              />
                                          </div>

                                          <button 
                                              onClick={handleCompleteBatch}
                                              disabled={isSubmitting}
                                              className={`w-full py-2.5 rounded-xl font-bold shadow-md hover:bg-lime-700 active:scale-95 transition-all flex items-center justify-center gap-1.5 text-xs sm:text-sm cursor-pointer ${
                                                isSubmitting ? 'bg-slate-400 cursor-not-allowed shadow-none' : 'bg-lime-600 text-white'
                                              }`}
                                          >
                                              {isSubmitting ? (
                                                <>
                                                  <Loader2 size={16} className="animate-spin" /> Processing...
                                                </>
                                              ) : (
                                                <>
                                                  <CheckCircle size={16}/> Mark Batch Completed
                                                </>
                                              )}
                                          </button>
                                      </div>
                                  )}

                                  <div className="flex justify-between items-center pt-1">
                                      <button onClick={() => setIsCancelMode(true)} className="text-rose-600 text-xs font-bold hover:underline flex items-center gap-1 cursor-pointer">
                                          <Ban size={13}/> Cancel Batch
                                      </button>
                                      {selectedBatch.status !== ProductionStage.PACKAGING && (
                                          <div className="text-[10px] text-slate-400 italic">Drag card to column or use card Move buttons</div>
                                      )}
                                  </div>
                              </>
                          )}
                      </div>
                  )}
              </div>
            </MotionDiv>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Production;
