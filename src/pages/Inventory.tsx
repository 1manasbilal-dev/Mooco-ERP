import React, { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { AdjustmentReason } from '../types';
import { 
  Package, Search, X, ClipboardCheck, ArrowDownRight, 
  Layers, Lock, RotateCcw, Truck, Factory, Briefcase,
  AlertTriangle, History as HistoryIcon, Info,
  Archive, CheckCircle, ChevronDown, ChevronUp, Loader2, Boxes
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatQty, formatCurrency } from '../lib/formatters';
import { itemStockValue } from '../lib/stockProfit';

const MotionDiv = motion.div as any;

const Inventory: React.FC = () => {
  const { inventory, inventoryLogs, adjustStock, items, canPerform } = useDairy();
  const { showToast } = useToast();
  const canEdit = canPerform('inventory', 'edit');
  const location = useLocation();
  const navigate = useNavigate();
  
  const [isAuditOpen, setIsAuditOpen] = useState(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('audit') === 'true' || sp.has('tab') || sp.has('item');
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'adjust' | 'history'>(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('tab') === 'history' ? 'history' : 'adjust';
  });
  const [selectedItemId, setSelectedItemId] = useState(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('item') || '';
  });
  const [selectedVariantId, setSelectedVariantId] = useState<string>('loose');
  const [physicalCount, setPhysicalCount] = useState<string>('');
  const [reason, setReason] = useState<AdjustmentReason>(AdjustmentReason.DATA_ENTRY_ERROR);
  const [notes, setNotes] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('All');
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const hasAudit = sp.get('audit') === 'true' || sp.has('tab') || sp.has('item');
    if (hasAudit !== isAuditOpen) setIsAuditOpen(hasAudit);
    
    const tabParam = sp.get('tab');
    if (tabParam === 'history' && activeTab !== 'history') setActiveTab('history');
    if (tabParam === 'adjust' && activeTab !== 'adjust') setActiveTab('adjust');

    const itemParam = sp.get('item') || '';
    if (itemParam !== selectedItemId) setSelectedItemId(itemParam);
  }, [location.search]);

  const openAudit = (tab: 'adjust' | 'history' = 'adjust', itemId: string = '') => {
    if (!canEdit) tab = 'history';
    setIsAuditOpen(true);
    setActiveTab(tab);
    setSelectedItemId(itemId);
    const sp = new URLSearchParams(location.search);
    sp.set('audit', 'true');
    sp.set('tab', tab);
    if (itemId) sp.set('item', itemId); else sp.delete('item');
    navigate(`${location.pathname}?${sp.toString()}`, { replace: true });
  };

  const closeAudit = () => {
    setIsAuditOpen(false);
    setSelectedItemId('');
    const sp = new URLSearchParams(location.search);
    sp.delete('audit');
    sp.delete('tab');
    sp.delete('item');
    const q = sp.toString();
    navigate(`${location.pathname}${q ? `?${q}` : ''}`, { replace: true });
  };

  const switchAuditTab = (tab: 'adjust' | 'history') => {
    setActiveTab(tab);
    const sp = new URLSearchParams(location.search);
    sp.set('tab', tab);
    navigate(`${location.pathname}?${sp.toString()}`, { replace: true });
  };

  const selectItem = (itemId: string) => {
    setSelectedItemId(itemId);
    const sp = new URLSearchParams(location.search);
    if (itemId) sp.set('item', itemId); else sp.delete('item');
    navigate(`${location.pathname}?${sp.toString()}`, { replace: true });
  };

  useEffect(() => {
    setSelectedVariantId('loose');
    setPhysicalCount('');
  }, [selectedItemId]);

  const toggleExpand = (itemId: string) => {
    setExpandedItems(prev => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  const syncedInventory = useMemo(() => {
    return items.map(master => {
       const stockRecord = inventory.find(i => i.item_id === master.id || i.name.toLowerCase() === master.name.toLowerCase());
       // Pack counts come from the same live row as loose stock; returns and audits update that row first.
       const variantStocks = stockRecord?.variant_stocks || master.variant_stocks || {};
       
       return {
          ...master,
          quantity: stockRecord?.quantity !== undefined ? stockRecord.quantity : (master.stock || 0),
          variantStocks: variantStocks,
          invRecordId: stockRecord?.id || `temp_${master.id}`
       };
    }).filter(p => {
       const matchesSearch = 
         p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
         p.category.some(c => c.toLowerCase().includes(searchTerm.toLowerCase()));
       const matchesType = filterType === 'All' || p.item_type.some(t => t === filterType);
       return matchesSearch && matchesType;
    });
  }, [items, inventory, searchTerm, filterType]);

  const selectedItem = syncedInventory.find(i => i.id === selectedItemId);
  
  const stats = useMemo(() => {
    let totalValue = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    syncedInventory.forEach(item => {
      const packagedVariants = (item.variants || []).filter(v => v.isActive !== false && v.deduct_from_base !== true);
      const valuation = itemStockValue(item, item.quantity, item.variantStocks);
      const totalPackagedCount = valuation.packs.reduce((sum, p) => sum + p.count, 0);

      // Same cost valuation as each row, so the header equals the sum of the rows.
      totalValue += valuation.costValue;

      const isPackagedOnly = packagedVariants.length > 0 && item.allow_loose_sale === false;
      if (isPackagedOnly) {
        if (totalPackagedCount <= 0) {
          outOfStockCount++;
        } else if (totalPackagedCount <= (item.reorder_level || 5)) {
          lowStockCount++;
        }
      } else {
        const hasAnyStock = item.quantity > 0 || totalPackagedCount > 0;
        if (!hasAnyStock) {
          outOfStockCount++;
        } else if (item.quantity <= (item.reorder_level || 5) && totalPackagedCount <= 0) {
          lowStockCount++;
        }
      }
    });

    return {
      totalItems: syncedInventory.length,
      totalValue,
      lowStockCount,
      outOfStockCount
    };
  }, [syncedInventory]);

  let systemQty = 0;
  let systemUnit = selectedItem?.unit || '';
  let auditTargetName = 'Loose Stock';

  if (selectedItem) {
    if (selectedVariantId === 'loose') {
      systemQty = selectedItem.quantity;
      auditTargetName = 'Loose / Bulk Stock';
    } else {
      systemQty = selectedItem.variantStocks?.[selectedVariantId] || 0;
      systemUnit = 'units';
      const v = selectedItem.variants?.find(v => v.id === selectedVariantId);
      auditTargetName = v ? `${v.name} (Packaged Variant)` : 'Variant';
    }
  }

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      showToast("Aap ko is kaam ki ijazat nahi hai.", "warning");
      return;
    }
    if (!selectedItemId || physicalCount === '' || isSubmitting) return;
    const newQty = parseFloat(physicalCount);
    if (isNaN(newQty) || newQty < 0) {
      showToast('Invalid quantity', 'error');
      return;
    }

    const invRecord = inventory.find(i => i.item_id === selectedItemId || i.name.toLowerCase() === selectedItem?.name.toLowerCase());
    if (invRecord) {
       setIsSubmitting(true);
       try {
         const ok = await adjustStock(invRecord.id, newQty, reason, notes, selectedVariantId);
         if (!ok) {
           showToast('Failed to adjust stock — system stock unchanged.', 'error');
           return;
         }
         showToast(`Stock synchronized for ${auditTargetName}`, 'success');
         setPhysicalCount('');
         closeAudit();
       } catch (err: any) {
         showToast('Failed to adjust stock: ' + (err?.message || 'Error'), 'error');
       } finally {
         setIsSubmitting(false);
       }
    } else {
       showToast('Critical Error: Link to inventory ledger missing.', 'error');
    }
  };

  const handleQuickAudit = (item: any, variantId: string = 'loose') => {
    setSelectedVariantId(variantId);
    openAudit('adjust', item.id);
  };

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'Supplier': return <Truck size={13} className="text-blue-500" />;
      case 'Production': return <Factory size={13} className="text-amber-500" />;
      default: return <Briefcase size={13} className="text-emerald-500" />;
    }
  };

  const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs sm:text-sm font-medium text-slate-900 shadow-sm focus:border-lime-500 focus:ring-1 focus:ring-lime-500 outline-none transition-all placeholder:text-slate-400";

  return (
    <div className="space-y-4 sm:space-y-6 pb-20">
      <div className="flex items-center justify-between gap-2.5">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Master Inventory</h2>
          <p className="text-xs sm:text-sm text-slate-500 font-medium hidden sm:block">Live physical stock ledger across sales, purchases & production</p>
        </div>
        <button 
          onClick={() => openAudit('adjust', '')} 
          className="bg-lime-600 hover:bg-lime-700 text-white px-3.5 sm:px-5 py-2.5 rounded-xl font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xs transition-all active:scale-95 shrink-0 cursor-pointer"
        >
          <ClipboardCheck size={16} />
          <span>Audit Stock</span>
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
        <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100">
            <Package size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">Total Items</p>
            <p className="text-base sm:text-lg font-black text-slate-900 font-mono mt-0.5">{stats.totalItems}</p>
          </div>
        </div>

        <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100">
            <Layers size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">Asset Valuation (Cost)</p>
            <p className="text-base sm:text-lg font-black text-emerald-600 font-mono mt-0.5 truncate">
              Rs {(stats.totalValue / 1000).toFixed(1)}k
            </p>
          </div>
        </div>

        <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-100">
            <AlertTriangle size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">Low Stock</p>
            <p className="text-base sm:text-lg font-black text-amber-600 font-mono mt-0.5">{stats.lowStockCount}</p>
          </div>
        </div>

        <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200/90 shadow-2xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100">
            <ArrowDownRight size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">Out of Stock</p>
            <p className="text-base sm:text-lg font-black text-rose-600 font-mono mt-0.5">{stats.outOfStockCount}</p>
          </div>
        </div>
      </div>
      
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 bg-white p-2.5 sm:p-3 rounded-2xl border border-slate-200/80 shadow-2xs">
        <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 w-full sm:w-72 focus-within:border-lime-500 focus-within:bg-white transition-all shadow-inner">
          <Search className="text-slate-400 shrink-0" size={15} />
          <input 
            type="text" 
            placeholder="Search inventory items..." 
            className="bg-transparent outline-none text-xs font-semibold w-full py-1 text-slate-800 placeholder:text-slate-400" 
            value={searchTerm} 
            onChange={e => setSearchTerm(e.target.value)} 
          />
          {searchTerm && (
            <button aria-label="Hatayen" onClick={() => setSearchTerm('')} className="text-slate-400 hover:text-slate-600 cursor-pointer shrink-0">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {[
            { key: 'All', label: 'All Items' },
            { key: 'Sale product', label: 'Sale Products' },
            { key: 'Raw material', label: 'Raw Materials' },
            { key: 'Packaging material', label: 'Packaging' }
          ].map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilterType(tab.key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                filterType === tab.key
                  ? 'bg-lime-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="block md:hidden space-y-2.5">
        {syncedInventory.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-sm">
            <Package size={36} className="text-slate-300 mx-auto mb-2" />
            <p className="font-bold text-sm text-slate-700">No items found</p>
            <p className="text-xs text-slate-400 mt-0.5">Try adjusting your search or filters</p>
          </div>
        ) : (
          syncedInventory.map(item => {
            const isProduct = item.item_type.some(t => ['Sale product'].includes(t));
            const rate = isProduct ? item.selling_price : item.cost_price;

            const multiUnits = (item.variants || []).filter(v => v.isActive !== false && v.deduct_from_base === true);
            const packagedVariants = (item.variants || []).filter(v => v.isActive !== false && v.deduct_from_base !== true);

            // Asset value is at cost (loose + active packed counts); retail worth is shown as a hint.
            const valuation = itemStockValue(item, item.quantity, item.variantStocks);
            const totalPackagedCount = valuation.packs.reduce((sum, p) => sum + p.count, 0);
            const totalAssetValue = valuation.costValue;

            const isPackagedOnly = packagedVariants.length > 0 && item.allow_loose_sale === false;
            const isOut = isPackagedOnly ? totalPackagedCount <= 0 : (item.quantity <= 0 && totalPackagedCount <= 0);
            const isLow = isPackagedOnly 
              ? (totalPackagedCount > 0 && totalPackagedCount <= (item.reorder_level || 5))
              : (item.quantity > 0 && item.quantity <= (item.reorder_level || 5));
            const isExpanded = !!expandedItems[item.id];

            return (
              <div 
                key={item.id}
                className="bg-white rounded-2xl border border-slate-200/90 p-3.5 shadow-2xs transition-all space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-sm shrink-0 overflow-hidden border border-slate-200/60">
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                      ) : item.isSystem ? (
                        <Lock size={14} className="text-lime-600" />
                      ) : (
                        <Package size={16} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-sm text-slate-900 leading-snug">
                          {item.name}
                        </span>
                      {item.isSystem && (
                        <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold border border-slate-200">
                          System
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] font-semibold text-slate-400 flex-wrap">
                      <span>{item.category[0] || 'Uncategorized'}</span>
                      <span>•</span>
                      <span className="flex items-center gap-1 text-slate-600 font-bold">
                        {getSourceIcon(item.source)} {item.source}
                      </span>
                      {packagedVariants.length > 0 && (
                        <span className="text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded font-bold flex items-center gap-0.5">
                          <Archive size={10} /> Packaged Stock ({totalPackagedCount})
                        </span>
                      )}
                      {multiUnits.length > 0 && (
                        <span className="text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.2 rounded font-bold flex items-center gap-0.5">
                          <Boxes size={10} /> Multi-Unit
                        </span>
                      )}
                    </div>
                  </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase border ${
                      isOut ? 'bg-rose-50 text-rose-700 border-rose-200' :
                      isLow ? 'bg-amber-50 text-amber-700 border-amber-200' :
                      'bg-emerald-50 text-emerald-700 border-emerald-200'
                    }`}>
                      {isOut ? 'Out' : isLow ? 'Low' : 'In Stock'}
                    </span>
                    <button aria-label="Audit / Adjust Stock" 
                      onClick={() => handleQuickAudit(item, 'loose')}
                      className="p-1.5 text-blue-600 hover:bg-blue-50 bg-slate-50 border border-slate-200 rounded-lg transition-all active:scale-95 cursor-pointer"
                      title="Audit / Adjust Stock"
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-slate-50/90 p-2.5 rounded-xl border border-slate-100 text-center">
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">
                      {isPackagedOnly ? 'Packaged Stock' : 'Total Stock'}
                    </span>
                    {isPackagedOnly ? (
                      <span className={`text-xs font-black font-mono ${isOut ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-slate-800'}`}>
                        {formatQty(totalPackagedCount)} <span className="text-[10px] text-amber-600 font-bold uppercase">Packs</span>
                      </span>
                    ) : (
                      <span className={`text-xs font-black font-mono ${isOut ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-slate-800'}`}>
                        {formatQty(item.quantity)} <span className="text-[10px] text-slate-400 font-normal uppercase">{item.unit}</span>
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Rate</span>
                    <span className="text-xs font-bold text-slate-700 font-mono">
                      {isPackagedOnly && packagedVariants.length > 0 ? `From ${formatCurrency(Math.min(...packagedVariants.map(v => v.selling_price || rate)))}` : formatCurrency(rate)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Asset (Cost)</span>
                    <span className="text-xs font-black text-emerald-600 font-mono">
                      {formatCurrency(totalAssetValue)}
                    </span>
                    {valuation.costMissing ? (
                      <span className="text-[9px] font-bold text-amber-600 block">Cost not set</span>
                    ) : isProduct && valuation.retailValue > 0 ? (
                      <span className="text-xs font-semibold text-slate-400 block">Retail {formatCurrency(valuation.retailValue)}</span>
                    ) : null}
                  </div>
                </div>

                {multiUnits.length > 0 && !isPackagedOnly && (
                  <div className="pt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md flex items-center gap-1">
                      <Boxes size={11} /> Multi-Units:
                    </span>
                    {multiUnits.map(mu => {
                      const equiv = mu.quantity_in_base_unit > 0 ? (item.quantity / mu.quantity_in_base_unit) : 0;
                      return (
                        <span key={mu.id} className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200" title={`1 ${mu.name} = ${mu.quantity_in_base_unit} ${item.unit}`}>
                          {mu.name}: <strong className="text-slate-800">{formatQty(equiv, 1)}</strong> (1={mu.quantity_in_base_unit})
                        </span>
                      );
                    })}
                  </div>
                )}

                {packagedVariants.length > 0 && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => toggleExpand(item.id)}
                      className="w-full flex items-center justify-between p-2 rounded-xl bg-amber-50/70 border border-amber-200/80 text-amber-900 text-xs font-bold cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <Archive size={13} className="text-amber-600" />
                        <span>{packagedVariants.length} Pre-Packaged Variants ({totalPackagedCount} Units)</span>
                      </span>
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>

                    {isExpanded && (
                      <div className="mt-2 space-y-1.5 pl-2 border-l-2 border-amber-300">
                        {packagedVariants.map(v => {
                          const vStock = item.variantStocks[v.id] || 0;
                          const vPrice = v.selling_price || (rate * v.quantity_in_base_unit);
                          return (
                            <div key={v.id} className="p-2 rounded-lg bg-white border border-slate-200 flex items-center justify-between text-xs">
                              <div>
                                <span className="font-bold text-slate-800">{v.name}</span>
                                <span className="text-xs text-slate-400 block">{formatQty(v.quantity_in_base_unit)} {item.unit} · {formatCurrency(vPrice)}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`font-mono font-bold px-2 py-0.5 rounded border ${vStock > 0 ? 'text-amber-800 bg-amber-50 border-amber-200' : 'text-slate-400 bg-slate-50 border-slate-200'}`}>
                                  {formatQty(vStock)} Units
                                </span>
                                <button aria-label="Audit Packaged Stock" 
                                  onClick={() => handleQuickAudit(item, v.id)} 
                                  className="p-1 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded cursor-pointer"
                                  title="Audit Packaged Stock"
                                >
                                  <RotateCcw size={13} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="hidden md:block bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto min-h-[400px]">
           <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase font-bold text-slate-500 tracking-wider">
                 <tr>
                    <th className="px-6 py-4">Item Identity</th>
                    <th className="px-6 py-4">Category</th>
                    <th className="px-6 py-4 text-right">Loose Stock</th>
                    <th className="px-6 py-4 text-right">Unit Rate</th>
                    <th className="px-6 py-4 text-right">Asset Valuation</th>
                    <th className="px-6 py-4 text-center">Status</th>
                    <th className="px-5 py-4 text-center w-24">Action</th>
                 </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                 {syncedInventory.map(item => {
                    const isProduct = item.item_type.some(t => ['Sale product'].includes(t));
                    const rate = isProduct ? item.selling_price : item.cost_price;
                    
                    const multiUnits = (item.variants || []).filter(v => v.isActive !== false && v.deduct_from_base === true);
                    const packagedVariants = (item.variants || []).filter(v => v.isActive !== false && v.deduct_from_base !== true);

                    // Asset value is at cost (loose + active packed counts), matching the header total.
                    const valuation = itemStockValue(item, item.quantity, item.variantStocks);
                    const totalPackagedCount = valuation.packs.reduce((sum, p) => sum + p.count, 0);
                    const totalAssetValue = valuation.costValue;
                    
                    const isPackagedOnly = packagedVariants.length > 0 && item.allow_loose_sale === false;
                    const isOut = isPackagedOnly ? totalPackagedCount <= 0 : (item.quantity <= 0 && totalPackagedCount <= 0);
                    const isLow = isPackagedOnly 
                       ? (totalPackagedCount > 0 && totalPackagedCount <= (item.reorder_level || 5))
                       : (item.quantity > 0 && item.quantity <= (item.reorder_level || 5));
                    
                    const mainRow = (
                       <tr key={item.id} className={`hover:bg-slate-50/80 group transition-all ${item.isSystem ? 'bg-slate-50/30' : ''}`}>
                          <td className="px-6 py-4">
                             <div className="flex items-center gap-3">
                                 <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold border border-slate-200 transition-colors overflow-hidden ${item.isSystem ? 'bg-lime-50 text-lime-600' : 'bg-white text-slate-500 group-hover:bg-slate-50'}`}>
                                    {item.image_url ? (
                                       <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                                    ) : item.isSystem ? (
                                       <Lock size={14}/>
                                    ) : (
                                       <Package size={16}/>
                                    )}
                                 </div>
                                <div className="flex flex-col">
                                   <p className="font-bold text-slate-800 leading-none flex items-center gap-1.5">
                                      {item.name}
                                      {item.isSystem && <span className="text-[8px] bg-lime-100 text-lime-700 px-1 py-0.5 rounded font-black uppercase tracking-tighter shadow-sm border border-lime-200">System</span>}
                                   </p>
                                   <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-1 uppercase font-bold tracking-tighter flex-wrap">
                                      <span className="flex items-center gap-1 text-slate-500">{getSourceIcon(item.source)} {item.source}</span>
                                      {packagedVariants.length > 0 && (
                                         <span className="text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded flex items-center gap-0.5">
                                            <Archive size={10}/> Packaged Stock ({totalPackagedCount})
                                         </span>
                                      )}
                                      {multiUnits.length > 0 && (
                                         <span className="text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.2 rounded flex items-center gap-0.5">
                                            <Boxes size={10}/> Multi-Unit
                                         </span>
                                      )}
                                   </div>
                                </div>
                             </div>
                          </td>
                          <td className="px-6 py-4">
                             <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-bold border border-slate-200 whitespace-nowrap">
                                {item.category[0] || 'Uncategorized'}
                             </span>
                          </td>
                          <td className="px-6 py-4 text-right font-mono font-bold text-slate-700">
                             {isPackagedOnly ? (
                                <div className="flex flex-col items-end">
                                   <span className={isOut ? 'text-red-500' : isLow ? 'text-amber-600' : 'text-slate-800'}>
                                      {formatQty(totalPackagedCount)}
                                   </span>
                                   <span className="text-[10px] text-amber-600 font-bold uppercase">Packs</span>
                                </div>
                             ) : (
                                <div className="flex flex-col items-end">
                                   <div>
                                      <span className={isOut ? 'text-red-500' : isLow ? 'text-amber-600' : ''}>
                                         {formatQty(item.quantity)}
                                      </span>
                                      <span className="text-[10px] text-slate-400 font-normal uppercase ml-1">{item.unit}</span>
                                   </div>
                                   {multiUnits.length > 0 && (
                                      <span className="text-[10px] text-indigo-600 font-semibold font-sans">
                                         ≈ {multiUnits.map(mu => `${formatQty(mu.quantity_in_base_unit > 0 ? item.quantity / mu.quantity_in_base_unit : 0, 1)} ${mu.name}`).join(' · ')}
                                      </span>
                                   )}
                                </div>
                             )}
                          </td>
                          <td className="px-6 py-4 text-right text-slate-500 font-mono">
                             {isPackagedOnly && packagedVariants.length > 0 ? (
                                <span className="text-xs">From {formatCurrency(Math.min(...packagedVariants.map(v => v.selling_price || rate)))}</span>
                             ) : (
                                formatCurrency(rate)
                             )}
                          </td>
                          <td className="px-6 py-4 text-right font-bold text-emerald-600 font-mono">
                             {formatCurrency(totalAssetValue)}
                             {valuation.costMissing ? (
                                <span className="block text-[10px] font-bold text-amber-600 font-sans">Cost not set</span>
                             ) : isProduct && valuation.retailValue > 0 ? (
                                <span className="block text-xs font-semibold text-slate-400">Retail {formatCurrency(valuation.retailValue)}</span>
                             ) : null}
                          </td>
                          <td className="px-6 py-4 text-center">
                             <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase border shadow-sm ${
                                isOut ? 'bg-red-50 text-red-600 border-red-200' : 
                                isLow ? 'bg-amber-50 text-amber-600 border-amber-200' : 
                                'bg-emerald-50 text-emerald-600 border-emerald-200'
                             }`}>
                                {isOut ? 'Out' : isLow ? 'Low' : 'OK'}
                             </span>
                          </td>
                          <td className="px-5 py-4 text-center">
                             <button aria-label="Audit Stock"
                               onClick={() => handleQuickAudit(item, 'loose')}
                               className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                               title="Audit Stock"
                             >
                                <RotateCcw size={15} />
                             </button>
                          </td>
                       </tr>
                    );

                    const variantRows = packagedVariants.length > 0 ? packagedVariants.map(v => {
                        const actualStock = item.variantStocks[v.id] || 0;
                        const variantPrice = v.selling_price || (rate * v.quantity_in_base_unit);
                        // Pack value at cost, part of the item's asset value above.
                        const variantAssetValue = valuation.packs.find(p => p.id === v.id)?.costValue || 0;

                        return (
                           <tr key={v.id} className="bg-amber-50/20 border-b border-slate-50 hover:bg-amber-50/40 transition-all">
                              <td className="px-6 py-3.5 pl-12 relative">
                                 <div className="absolute left-8 top-1/2 -translate-y-1/2 w-3 h-3 border-l border-b border-slate-300 rounded-bl-lg"></div>
                                 <div className="flex items-center gap-3">
                                    <div className="w-7 h-7 rounded-lg bg-amber-100/70 flex items-center justify-center text-amber-700 border border-amber-200">
                                       <Archive size={13}/>
                                    </div>
                                    <div className="flex flex-col">
                                       <span className="font-bold text-slate-700 text-xs sm:text-sm">{v.name}</span>
                                       <span className="text-[10px] text-amber-600 font-medium">Pre-Packaged Variant</span>
                                    </div>
                                 </div>
                              </td>
                              <td className="px-6 py-3.5">
                                 <span className="text-[10px] text-slate-500 font-bold bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                                    {formatQty(v.quantity_in_base_unit)} {item.unit}
                                 </span>
                              </td>
                              <td className="px-6 py-3.5 text-right">
                                 <div className="flex items-center justify-end gap-1.5">
                                    <span className={`font-mono font-bold ${actualStock > 0 ? 'text-amber-800' : 'text-slate-400'}`}>
                                       {formatQty(actualStock)}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-normal uppercase">Units</span>
                                 </div>
                              </td>
                              <td className="px-6 py-3.5 text-right font-mono text-slate-500 text-xs">
                                 {formatCurrency(variantPrice)}
                              </td>
                              <td className="px-6 py-3.5 text-right font-mono text-slate-400 text-xs">
                                 ({formatCurrency(variantAssetValue)})
                              </td>
                              <td className="px-6 py-3.5 text-center">
                                 <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase border ${actualStock > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
                                    {actualStock > 0 ? 'In Stock' : 'Out'}
                                 </span>
                              </td>
                              <td className="px-5 py-3.5 text-center">
                                 <button aria-label="Audit Packaged Stock"
                                   onClick={() => handleQuickAudit(item, v.id)}
                                   className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                                   title="Audit Packaged Stock"
                                 >
                                    <RotateCcw size={14} />
                                 </button>
                              </td>
                           </tr>
                        );
                    }) : [];

                    return [mainRow, ...variantRows];
                 })}
                 
                 {syncedInventory.length === 0 && (
                    <tr><td colSpan={7} className="p-20 text-center text-slate-400 italic">No inventory matches found. Verify Item Master entries.</td></tr>
                 )}
              </tbody>
           </table>
        </div>
      </div>

      <AnimatePresence>
        {isAuditOpen && (
          <div className="fixed inset-0 z-50 overflow-hidden">
            <MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={closeAudit} />
            <MotionDiv initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 250 }} className="absolute inset-y-0 right-0 w-full max-w-lg bg-white shadow-2xl flex flex-col h-full z-10">
               <div className="bg-slate-50 px-5 py-4 sm:px-6 sm:py-5 border-b border-slate-200 flex justify-between items-center shrink-0">
                  <div>
                    <h3 className="font-black text-lg sm:text-xl text-slate-900 flex items-center gap-2">
                      <Layers size={20} className="text-blue-600"/> 
                      <span>Inventory Audit & Adjustment</span>
                    </h3>
                    <p className="text-xs text-slate-400 font-medium mt-0.5">Reconcile physical stock with system counts</p>
                  </div>
                  <button aria-label="Band karein" onClick={closeAudit} className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-white transition-all"><X size={20}/></button>
               </div>
               
               <div className="flex border-b border-slate-200 shrink-0 bg-white">
                  <button onClick={() => switchAuditTab('adjust')} disabled={!canEdit} title={!canEdit ? 'Aap ko stock adjust karne ki ijazat nahi hai' : undefined} className={`flex-1 py-3 text-xs sm:text-sm font-bold border-b-2 transition-all ${activeTab === 'adjust' ? 'border-blue-600 text-blue-700 bg-blue-50/40' : 'text-slate-400 hover:text-slate-600 border-transparent'}`}>New Adjustment</button>
                  <button onClick={() => switchAuditTab('history')} className={`flex-1 py-3 text-xs sm:text-sm font-bold border-b-2 transition-all ${activeTab === 'history' ? 'border-blue-600 text-blue-700 bg-blue-50/40' : 'text-slate-400 hover:text-slate-600 border-transparent'}`}>Audit History ({inventoryLogs.length})</button>
               </div>

               <div className="flex-1 overflow-y-auto bg-slate-50/40 p-4 sm:p-6">
                  {activeTab === 'adjust' ? (
                     <form onSubmit={handleAdjustSubmit} className="space-y-5">
                        <div>
                           <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5">Select Item to Synchronize *</label>
                           <select className={inputClass} value={selectedItemId} onChange={e => selectItem(e.target.value)}>
                              <option value="">-- Choose Item from Catalog --</option>
                              {syncedInventory.map(i => (<option key={i.id} value={i.id}>{i.name} ({i.unit})</option>))}
                           </select>
                        </div>
                        
                        <AnimatePresence>
                        {selectedItemId && (
                          <MotionDiv initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
                            
                            {selectedItem && (() => {
                              const packaged = (selectedItem.variants || []).filter(v => v.isActive !== false && v.deduct_from_base !== true);
                              if (packaged.length === 0) return null;
                              return (
                                <div className="bg-amber-50/70 p-3.5 sm:p-4 rounded-2xl border border-amber-200/80">
                                    <label className="block text-xs font-bold text-amber-900 uppercase mb-2">Target Stock Scope</label>
                                    <div className="space-y-2">
                                        <div 
                                            onClick={() => setSelectedVariantId('loose')}
                                            className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${selectedVariantId === 'loose' ? 'bg-white border-amber-500 ring-2 ring-amber-500/20 shadow-sm' : 'bg-white/60 border-amber-200 hover:bg-white'}`}
                                        >
                                            <div>
                                              <span className="text-xs sm:text-sm font-bold text-slate-800">Loose / Bulk Stock</span>
                                              <span className="text-[10px] text-slate-400 block font-mono">{formatQty(selectedItem.quantity)} {selectedItem.unit}</span>
                                            </div>
                                            {selectedVariantId === 'loose' && <CheckCircle size={16} className="text-amber-600"/>}
                                        </div>
                                        {packaged.map(v => {
                                            const vStock = selectedItem.variantStocks?.[v.id] || 0;
                                            return (
                                              <div 
                                                  key={v.id}
                                                  onClick={() => setSelectedVariantId(v.id)}
                                                  className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${selectedVariantId === v.id ? 'bg-white border-amber-500 ring-2 ring-amber-500/20 shadow-sm' : 'bg-white/60 border-amber-200 hover:bg-white'}`}
                                              >
                                                  <div>
                                                    <span className="text-xs sm:text-sm font-bold text-slate-800">{v.name} (Pre-Packaged)</span>
                                                    <span className="text-[10px] text-slate-400 block font-mono">{formatQty(vStock)} units in stock · {v.quantity_in_base_unit} {selectedItem.unit}</span>
                                                  </div>
                                                  {selectedVariantId === v.id && <CheckCircle size={16} className="text-amber-600"/>}
                                              </div>
                                            );
                                        })}
                                    </div>
                                </div>
                              );
                            })()}

                            <div className="bg-white p-4 rounded-2xl border border-slate-200 flex justify-between items-center shadow-2xs">
                               <div>
                                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">System Counter</p>
                                 <p className="text-xl sm:text-2xl font-black text-slate-800 mt-0.5 font-mono">{systemQty.toFixed(2)} {systemUnit}</p>
                               </div>
                               <div className="w-11 h-11 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 border border-blue-100"><RotateCcw size={20}/></div>
                            </div>
                            
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5">
                                  Actual Physical Shelf Count ({auditTargetName}) *
                                </label>
                                <input 
                                  type="number" 
                                  step="any"
                                  required 
                                  className={`${inputClass} text-lg sm:text-xl font-bold font-mono py-3 bg-white`} 
                                  placeholder="0.00" 
                                  value={physicalCount} 
                                  onChange={e => setPhysicalCount(e.target.value)} 
                                  autoFocus
                                />
                                <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                                    <Info size={12} className="shrink-0"/>
                                    <span>Enter the exact physically counted quantity.</span>
                                </div>
                            </div>
                            
                            <div>
                              <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5">Adjustment Reason</label>
                              <select className={inputClass} value={reason} onChange={e => setReason(e.target.value as AdjustmentReason)}>
                                {Object.values(AdjustmentReason).map(r => <option key={r} value={r}>{r}</option>)}
                              </select>
                            </div>

                            <div>
                              <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5">Audit Remarks / Notes</label>
                              <textarea rows={3} className={inputClass} placeholder="Provide explanation for discrepancy..." value={notes} onChange={e => setNotes(e.target.value)}/>
                            </div>
                          </MotionDiv>
                        )}
                        </AnimatePresence>
                     </form>
                  ) : (
                     <div className="divide-y divide-slate-100 bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
                        {inventoryLogs.length > 0 ? (
                           inventoryLogs.map(log => {
                              // Pack movements keep loose `difference` at 0 and carry the pack count in details.
                              const packDelta = Number((log as any).details?.variant_delta) || 0;
                              const diff = Number(log.difference) || packDelta;
                              return (
                              <div key={log.id} className="p-3.5 sm:p-4 hover:bg-slate-50 transition-colors">
                                 <div className="flex justify-between font-bold text-xs sm:text-sm">
                                    <span className="text-slate-800">{log.item_name}</span>
                                    <span className={`font-mono ${diff > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                      {diff > 0 ? '+' : ''}{diff.toFixed(2)}{!Number(log.difference) && packDelta ? ' packs' : ''}
                                    </span>
                                 </div>
                                 <div className="flex justify-between items-end mt-2">
                                    <div>
                                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{log.reason}</p>
                                      {log.notes && <p className="text-[10px] text-slate-400 italic mt-0.5 line-clamp-1">"{log.notes}"</p>}
                                    </div>
                                    <p className="text-[10px] text-slate-400 whitespace-nowrap bg-slate-50 px-2 py-0.5 rounded-md border border-slate-200 font-mono">
                                      {new Date(log.date).toLocaleDateString()}
                                    </p>
                                 </div>
                              </div>
                              );
                           })
                        ) : (
                          <div className="p-16 text-center flex flex-col items-center gap-2">
                            <HistoryIcon size={32} className="text-slate-300"/>
                            <p className="text-xs sm:text-sm text-slate-400 italic">No audit history entries found.</p>
                          </div>
                        )}
                     </div>
                  )}
               </div>

               {activeTab === 'adjust' && (
                  <div className="p-4 sm:p-6 border-t border-slate-100 bg-white shrink-0">
                     <button 
                       onClick={handleAdjustSubmit} 
                       disabled={!canEdit || !selectedItemId || physicalCount === '' || isSubmitting}
                       title={!canEdit ? 'Aap ko stock adjust karne ki ijazat nahi hai' : undefined}
                       className={`w-full py-3.5 rounded-xl font-bold text-xs sm:text-sm text-white shadow-lg transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2 ${
                         !canEdit || !selectedItemId || physicalCount === '' || isSubmitting
                           ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none' 
                           : 'bg-lime-600 hover:bg-lime-700 shadow-lime-600/20'
                       }`}
                     >
                       {isSubmitting ? (
                         <>
                           <Loader2 size={16} className="animate-spin" /> Saving Stock...
                         </>
                       ) : (
                         'Confirm Stock Adjustment'
                       )}
                     </button>
                  </div>
               )}
            </MotionDiv>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Inventory;
