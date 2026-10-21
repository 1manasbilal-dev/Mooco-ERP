import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { AllocationStatus, DestinationType } from '../types';
import { 
  Factory, Plus, X, ShoppingCart, 
  Droplets, Calculator, Store, ArrowRight, RotateCcw,
  Refrigerator, Search, Trash2, Check, Layers, RefreshCw,
  Sliders, Edit3
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatQty, formatCurrency, formatRate, cleanNumber } from '../lib/formatters';

const MotionDiv = motion.div as any;

interface CartItem {
  allocationId: string;
  quantity: number;
  maxQty: number;
  supplierName: string;
  milkType: string;
  rate: number;
  source: 'fresh' | 'retail';
}

interface AllocateModalData {
  id: string;
  name: string;
  milkType: string;
  rate: number;
  maxQty: number;
  source: 'fresh' | 'retail';
  initialQty: number;
}

const Allocation: React.FC = () => {
  const { allocations, purchases, allocateBulkMilk, allocateFromRetailStock, createBatch, discardBatch, trimBatchToSource, items, inventory, suppliers, canPerform } = useDairy();
  const { showToast } = useToast();
  const canCreate = canPerform('allocation', 'create');
  const canStartBatch = canPerform('production', 'create');
  const location = useLocation();
  const navigate = useNavigate();
  
  // View & Mobile Tab State
  const [activeSource, setActiveSource] = useState<'fresh' | 'retail'>(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('source') === 'retail' ? 'retail' : 'fresh';
  });
  const [mobileTab, setMobileTab] = useState<'source' | 'cart'>('source');
  const [searchQuery, setSearchQuery] = useState('');

  // Cart State
  const [cart, setCart] = useState<CartItem[]>([]);
  
  // Quantity Selection Modal State
  const [modalData, setModalData] = useState<AllocateModalData | null>(null);
  const [modalQty, setModalQty] = useState<number | string>('');

  // Destination State (Retail Counter and Production)
  const [destination, setDestination] = useState<string>(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('source') === 'retail' ? DestinationType.PRODUCTION : DestinationType.RETAIL;
  });
  const [selectedProduct, setSelectedProduct] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const srcParam = sp.get('source');
    const targetSource = srcParam === 'retail' ? 'retail' : 'fresh';
    if (targetSource !== activeSource) {
      setActiveSource(targetSource);
      setDestination(targetSource === 'retail' ? DestinationType.PRODUCTION : DestinationType.RETAIL);
    }
  }, [location.search]);

  const switchSource = (source: 'fresh' | 'retail') => {
    setActiveSource(source);
    setDestination(source === 'retail' ? DestinationType.PRODUCTION : DestinationType.RETAIL);
    const sp = new URLSearchParams(location.search);
    if (source === 'retail') {
      sp.set('source', 'retail');
    } else {
      sp.delete('source');
    }
    const q = sp.toString();
    navigate(`${location.pathname}${q ? `?${q}` : ''}`, { replace: true });
  };

  // 1. Get Source Allocations (Unallocated Pool)
  const sourceAllocations = useMemo(() => {
    return allocations.filter(a => {
      const status = a.status || AllocationStatus.UNALLOCATED;
      const qty = (a.remaining_quantity !== null && a.remaining_quantity !== undefined) 
        ? Number(a.remaining_quantity) 
        : (Number(a.original_quantity || 0) - Number(a.allocated_quantity || 0));
      
      const isTerminalStatus = 
        status === AllocationStatus.FULLY_ALLOCATED || 
        status === AllocationStatus.ALLOCATED_FOR_SUPPLY || 
        status === AllocationStatus.COMPLETED;

      // As long as it is not in terminal status and has remaining milk available (> 0.001 L), it stays in unallocated pool
      return !isTerminalStatus && qty > 0.001;
    });
  }, [allocations]);

  // 2. Get Retail Stock Items
  const retailMilkItems = useMemo(() => {
    return inventory.filter(i => {
      const hasQty = (i.quantity || 0) > 0;
      if (!hasQty) return false;

      const isMilkCategory = Array.isArray(i.category)
        ? (i.category as string[]).some((c: string) => String(c).toLowerCase().includes('milk'))
        : (typeof i.category === 'string' && i.category.toLowerCase().includes('milk'));

      const nameLower = (i.name || '').toLowerCase();
      const isMilkName = 
        nameLower.includes('milk') ||
        nameLower.includes('buffalo') ||
        nameLower.includes('cow') ||
        nameLower.includes('doodh') ||
        nameLower.includes('mixed');

      return isMilkCategory || isMilkName;
    });
  }, [inventory]);

  // Helper to get rate for an allocation
  const getRate = (alloc: any) => {
    if (alloc.average_rate !== undefined && alloc.average_rate !== null && alloc.average_rate > 0) {
       return alloc.average_rate;
    }
    const purchase = purchases.find(p => p.id === alloc.purchase_id);
    return purchase ? purchase.rate : 0;
  };

  // Helper to get robust display name
  const getDisplayName = (alloc: any) => {
     if (alloc.supplier_name && alloc.supplier_name !== 'Unknown') {
        return alloc.supplier_name;
     }
     const purchase = purchases.find(p => p.id === alloc.purchase_id);
     if (purchase) {
        const supplier = suppliers.find(s => s.id === purchase.supplier_id);
        if (supplier) return supplier.name;
     }
     return "Unknown Supplier";
  };

  // Filtered Source Lists based on search query
  const filteredSourceAllocations = useMemo(() => {
    if (!searchQuery.trim()) return sourceAllocations;
    const q = searchQuery.toLowerCase();
    return sourceAllocations.filter(alloc => {
      const name = getDisplayName(alloc).toLowerCase();
      const type = (alloc.milk_type || '').toLowerCase();
      return name.includes(q) || type.includes(q);
    });
  }, [sourceAllocations, searchQuery, suppliers, purchases]);

  const filteredRetailMilkItems = useMemo(() => {
    if (!searchQuery.trim()) return retailMilkItems;
    const q = searchQuery.toLowerCase();
    return retailMilkItems.filter(item => item.name.toLowerCase().includes(q));
  }, [retailMilkItems, searchQuery]);

  // Open Quantity Selection Modal
  const openAllocateModal = (item: any, source: 'fresh' | 'retail') => {
    let id: string, maxQty: number, name: string, milkType: string, rate: number;

    if (source === 'fresh') {
       id = item.id;
       maxQty = (item.remaining_quantity !== null && item.remaining_quantity !== undefined) ? item.remaining_quantity : item.original_quantity;
       name = getDisplayName(item);
       milkType = item.milk_type || 'Mixed';
       rate = getRate(item);
    } else {
       id = item.item_id || (item.id && typeof item.id === 'string' && item.id.startsWith('inv_') ? item.id.replace('inv_', '') : item.id);
       maxQty = item.quantity;
       name = item.name;
       
       const n = item.name.toLowerCase();
       if (n.includes('buffalo')) milkType = 'Buffalo';
       else if (n.includes('cow')) milkType = 'Cow';
       else milkType = 'Mixed';

       const itemDef = items.find(def => def.id === id || def.name === item.name);
       rate = itemDef?.cost_price || item.price || 0;
    }

    const existingInCart = cart.find(ci => ci.allocationId === id);
    const initialQty = existingInCart ? existingInCart.quantity : maxQty;

    setModalData({
      id,
      name,
      milkType,
      rate,
      maxQty,
      source,
      initialQty
    });
    setModalQty(initialQty);
  };

  const handleConfirmModalAllocation = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!modalData) return;

    const numQty = parseFloat(modalQty.toString()) || 0;
    if (numQty <= 0) {
      showToast("Please enter a valid quantity greater than 0", "warning");
      return;
    }

    if (numQty > modalData.maxQty) {
      showToast(`Quantity cannot exceed available ${modalData.maxQty} L`, "warning");
      return;
    }

    const existing = cart.find(ci => ci.allocationId === modalData.id);
    if (existing) {
      setCart(prev => prev.map(ci => ci.allocationId === modalData.id ? { ...ci, quantity: numQty } : ci));
      showToast(`Updated ${modalData.name} allocation to ${numQty} L`, 'success');
    } else {
      setCart(prev => [...prev, {
        allocationId: modalData.id,
        quantity: numQty,
        maxQty: modalData.maxQty,
        supplierName: modalData.name,
        milkType: modalData.milkType,
        rate: modalData.rate,
        source: modalData.source
      }]);
      showToast(`Added ${numQty} L from ${modalData.name} to cart`, 'success');
    }

    setModalData(null);
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(item => item.allocationId !== id));
  };

  const updateCartQty = (id: string, qty: number) => {
    setCart(prev => prev.map(item => {
      if (item.allocationId === id) {
        const validated = isNaN(qty) ? 0 : Math.min(item.maxQty, Math.max(0, qty));
        return { ...item, quantity: validated };
      }
      return item;
    }));
  };

  const clearCart = () => {
    setCart([]);
  };

  // Calculations
  const totalVolume = useMemo(() => cart.reduce((sum, item) => sum + (item.quantity || 0), 0), [cart]);
  const totalValue = useMemo(() => cart.reduce((sum, item) => sum + ((item.quantity || 0) * (item.rate || 0)), 0), [cart]);
  const averageRate = totalVolume > 0 ? (totalValue / totalVolume) : 0;

  // Filter ONLY products that are produced/manufactured in-house
  const producibleItems = useMemo(() => {
    return items.filter(i => {
      if (i.isActive === false) return false;
      const isProductionSource = i.source === 'Production' || i.source === 'Both';
      if (!isProductionSource) return false;

      const nameLower = (i.name || '').toLowerCase().trim();
      if (
        ['buffalo milk', 'cow milk', 'mixed milk', 'raw milk'].includes(nameLower) ||
        ['item_buffalo_milk', 'item_cow_milk', 'item_mixed_milk'].includes(i.id)
      ) {
        return false;
      }

      const types = Array.isArray(i.item_type) ? i.item_type : [i.item_type || ''];
      const isSolelyMaterial = types.length > 0 && types.every(t => t === 'Raw material' || t === 'Packaging material');
      if (isSolelyMaterial) return false;

      const categories = Array.isArray(i.category) ? i.category : [i.category || ''];
      const isMaterialCategory = categories.some(c => typeof c === 'string' && ['packaging', 'raw material', 'raw materials'].includes(c.toLowerCase()));
      if (isMaterialCategory) return false;

      return true;
    });
  }, [items]);

  // Handling Allocation
  const isSubmittingAllocRef = useRef(false);

  const handleProcessAllocation = async () => {
    if (!canCreate) {
      showToast("Aap ko is kaam ki ijazat nahi hai.", "warning");
      return;
    }
    if (cart.length === 0 || isSubmitting || isSubmittingAllocRef.current) {
      if (cart.length === 0) showToast("Allocation cart is empty", "warning");
      return;
    }

    if (totalVolume <= 0) {
      showToast("Please specify a valid allocation quantity greater than 0", "warning");
      return;
    }

    if (activeSource === 'retail' && destination === DestinationType.RETAIL) {
      showToast("Cannot allocate from Retail Stock back to Retail Counter.", "warning");
      return;
    }

    if (destination === DestinationType.PRODUCTION && !canStartBatch) {
      showToast("Aap ko production batch shuru karne ki ijazat nahi hai.", "warning");
      return;
    }

    // Check every line against live stock before anything is written. The batch is created first,
    // so a line that the allocation step later rejects (milk used meanwhile) left a batch whose
    // milk was never taken out of the pool or the counter.
    const emptyLine = cart.find(item => !(Number(item.quantity) > 0));
    if (emptyLine) {
      showToast(`${emptyLine.supplierName}: qty 0 hai. Qty likhein ya line hata dein.`, "warning");
      return;
    }
    for (const item of cart) {
      const qty = Number(item.quantity) || 0;
      let left = Infinity;
      if (item.source === 'fresh') {
        const pool = allocations.find(a => a.id === item.allocationId || a.purchase_id === item.allocationId);
        if (pool) {
          left = (pool.remaining_quantity !== null && pool.remaining_quantity !== undefined)
            ? Number(pool.remaining_quantity)
            : (Number(pool.original_quantity || 0) - Number(pool.allocated_quantity || 0));
        } else {
          left = 0;
        }
      } else {
        const stockRow = inventory.find(inv => inv.item_id === item.allocationId || inv.id === item.allocationId || inv.id === `inv_${item.allocationId}`);
        left = stockRow ? Number(stockRow.quantity) || 0 : 0;
      }
      if (qty > Math.max(0, left) + 0.001) {
        showToast(`${item.supplierName}: sirf ${cleanNumber(Math.max(0, left))} L baqi hai, ${cleanNumber(qty)} L allocate nahi ho sakta.`, "error");
        return;
      }
    }

    isSubmittingAllocRef.current = true;
    setIsSubmitting(true);

    let createdBatchId: string | null = null;
    try {
      if (destination === DestinationType.PRODUCTION) {
        if (!selectedProduct) {
          showToast("Please select a product to manufacture first!", "warning");
          setIsSubmitting(false);
          isSubmittingAllocRef.current = false;
          return;
        }
        const prodName = selectedProduct;

        // Determine milk composition from cart:
        // If all items are Cow -> 'Cow'
        // If all items are Buffalo -> 'Buffalo'
        // If items are mixed or both Cow & Buffalo -> 'Mixed'
        const distinctTypes = Array.from(new Set(cart.map(c => (c.milkType || 'Mixed').trim())));
        let batchMilkType = 'Mixed';
        if (distinctTypes.length === 1) {
          const t = String(distinctTypes[0] || '').toLowerCase();
          if (t.includes('buffalo')) batchMilkType = 'Buffalo';
          else if (t.includes('cow')) batchMilkType = 'Cow';
          else batchMilkType = 'Mixed';
        } else {
          batchMilkType = 'Mixed';
        }

        const batchDetails = {
          milk_type: batchMilkType,
          milk_breakdown: cart.map(c => ({
            allocationId: c.allocationId,
            milkType: c.milkType,
            quantity: c.quantity,
            supplierName: c.supplierName,
            rate: c.rate,
            source: c.source
          }))
        };

        const batchCreated = await createBatch(prodName, totalVolume, undefined, undefined, averageRate, undefined, batchDetails);
        if (!batchCreated) {
          setIsSubmitting(false);
          return;
        }
        createdBatchId = batchCreated;
      }

      // Split Cart items by Source
      const freshItems = cart.filter(i => i.source === 'fresh').map(i => ({ allocationId: i.allocationId, quantity: i.quantity }));
      const retailItems = cart.filter(i => i.source === 'retail').map(i => ({ itemId: i.allocationId, quantity: i.quantity, rate: i.rate }));

      let success = true;
      let anyDeducted = false;
      let freshDeducted = false;
      if (freshItems.length > 0) {
        const res = await allocateBulkMilk(freshItems, destination, { rate: averageRate });
        if (!res) success = false; else { anyDeducted = true; freshDeducted = true; }
      }

      if (retailItems.length > 0) {
        const res = await allocateFromRetailStock(retailItems, destination, { rate: averageRate });
        if (!res) success = false; else anyDeducted = true;
      }

      // No milk left stock, so the batch created above is a phantom: remove it.
      if (createdBatchId && !anyDeducted) {
        await discardBatch(createdBatchId);
      } else if (createdBatchId && !success) {
        // Only one source went through: keep just its lines on the batch, or a later cancel would
        // return milk (pool or counter) that never left.
        await trimBatchToSource(createdBatchId, freshDeducted ? 'fresh' : 'retail');
      }

      if (success) {
        setCart([]);
        setSelectedProduct('');
        showToast(`Successfully allocated ${totalVolume.toFixed(2)} L to ${destination}`, "success");
        setMobileTab('source');
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to process allocation', 'error');
    } finally {
      setIsSubmitting(false);
      setTimeout(() => {
        isSubmittingAllocRef.current = false;
      }, 400);
    }
  };

  const getDestinationIcon = (type: string) => {
    switch(type) {
      case DestinationType.PRODUCTION: return <Factory size={16} />;
      default: return <Store size={16} />;
    }
  };

  const getMilkTypeStyle = (type: string) => {
    switch(type) {
      case 'Buffalo': return 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700';
      case 'Cow': return 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
      default: return 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800';
    }
  };

  const inputClass = "w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-xs sm:text-sm font-medium text-slate-900 dark:text-slate-100 outline-none focus:border-lime-500 focus:ring-1 focus:ring-lime-500 transition-all";

  const totalFreshVolume = useMemo(() => {
    return sourceAllocations.reduce((sum, a) => {
      const q = (a.remaining_quantity !== null && a.remaining_quantity !== undefined) 
        ? Number(a.remaining_quantity) 
        : (Number(a.original_quantity || 0) - Number(a.allocated_quantity || 0));
      return sum + Math.max(0, q || 0);
    }, 0);
  }, [sourceAllocations]);

  return (
    <div className="space-y-3 pb-8 h-full flex flex-col min-h-0">
      
      {/* 1. MOBILE ONLY TAB SWITCHER (Hidden on Desktop) */}
      <div className="lg:hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-1.5 shadow-xs flex items-center justify-between gap-2 shrink-0">
        <div className="bg-slate-100 dark:bg-slate-800 p-1 rounded-xl flex gap-1 w-full">
          <button
            onClick={() => setMobileTab('source')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg transition-all ${
              mobileTab === 'source'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Droplets size={14} className={mobileTab === 'source' ? 'text-lime-600 dark:text-lime-400' : 'text-slate-400'} />
            <span>Batches</span>
            <span className="bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold">
              {activeSource === 'fresh' ? sourceAllocations.length : retailMilkItems.length}
            </span>
          </button>

          <button
            onClick={() => setMobileTab('cart')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg transition-all ${
              mobileTab === 'cart'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ShoppingCart size={14} className={mobileTab === 'cart' ? 'text-lime-600 dark:text-lime-400' : 'text-slate-400'} />
            <span>Cart</span>
            {cart.length > 0 ? (
              <span className="bg-lime-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold">
                {cart.length}
              </span>
            ) : (
              <span className="bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold">
                0
              </span>
            )}
          </button>
        </div>
      </div>

      {/* 2. MAIN 2-COLUMN WORKSPACE (SPLIT DESKTOP / ADAPTIVE MOBILE) */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0 gap-3 lg:gap-4 overflow-hidden relative">
        
        {/* LEFT COLUMN: SOURCE SELECTION (Unallocated & Retail) */}
        <div className={`flex-[1.3] flex-col bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden h-full min-h-0 ${
          mobileTab === 'source' ? 'flex' : 'hidden lg:flex'
        }`}>
          
          {/* Source Controls Header */}
          <div className="p-3 sm:p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 shrink-0 space-y-2.5">
            
            {/* Top Source Switcher Buttons */}
            <div className="grid grid-cols-2 gap-1.5 bg-slate-200/60 dark:bg-slate-800 p-1 rounded-xl">
              <button 
                onClick={() => switchSource('fresh')}
                className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeSource === 'fresh' 
                    ? 'bg-white dark:bg-slate-900 text-lime-700 dark:text-lime-400 shadow-xs' 
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Droplets size={14} className="text-lime-600 dark:text-lime-400" />
                <span className="truncate">Unallocated ({sourceAllocations.length})</span>
              </button>

              <button 
                onClick={() => switchSource('retail')}
                className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeSource === 'retail' 
                    ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-400 shadow-xs' 
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <Refrigerator size={14} className="text-indigo-600 dark:text-indigo-400" />
                <span className="truncate">Retail Stock ({retailMilkItems.length})</span>
              </button>
            </div>

            {/* Search Input */}
            <div className="flex items-center gap-2 bg-white dark:bg-slate-800/80 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 focus-within:border-lime-500 focus-within:ring-1 focus-within:ring-lime-500/20 transition-all shadow-2xs">
              <Search className="text-slate-400 shrink-0" size={14} />
              <input
                type="text"
                placeholder={activeSource === 'fresh' ? "Search by gwala / supplier name..." : "Search retail milk..."}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="bg-transparent outline-none text-xs font-medium w-full text-slate-800 dark:text-slate-200 placeholder:text-slate-400"
              />
              {searchQuery && (
                <button aria-label="Hatayen" onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-0.5 shrink-0 cursor-pointer">
                  <X size={13} />
                </button>
              )}
            </div>

          </div>

          {/* Scrollable Batches List */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5 bg-slate-50/40 dark:bg-slate-950/40">
            
            {/* VIEW 1: FRESH COLLECTION (UNALLOCATED) */}
            {activeSource === 'fresh' && (
              filteredSourceAllocations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[220px] text-slate-400 text-center p-6">
                  <Droplets size={40} className="mb-2 opacity-25 text-slate-400" />
                  <p className="font-semibold text-xs sm:text-sm text-slate-600 dark:text-slate-400">No unallocated fresh milk available</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Record milk intake in Purchase or switch to Retail Stock.</p>
                </div>
              ) : (
                filteredSourceAllocations.map(alloc => {
                  const inCartItem = cart.find(i => i.allocationId === alloc.id);
                  const isInCart = !!inCartItem;
                  const rate = getRate(alloc);
                  const displaySupplierName = getDisplayName(alloc);
                  const isReturn = displaySupplierName.startsWith('Return:');
                  const displayName = isReturn ? displaySupplierName.replace('Return:', '').trim() : displaySupplierName;
                  const currentQty = (alloc.remaining_quantity !== null && alloc.remaining_quantity !== undefined) 
                    ? Number(alloc.remaining_quantity) 
                    : (Number(alloc.original_quantity || 0) - Number(alloc.allocated_quantity || 0));
                  const isPartiallyAllocated = 
                    alloc.status === AllocationStatus.PARTIALLY_ALLOCATED || 
                    ((Number(alloc.allocated_quantity) || 0) > 0 && currentQty > 0.001);

                  return (
                    <div 
                      key={alloc.id} 
                      onClick={() => openAllocateModal(alloc, 'fresh')}
                      className={`relative flex items-center justify-between p-3 sm:p-3.5 rounded-xl border transition-all cursor-pointer group ${
                        isInCart 
                          ? 'bg-lime-50/70 dark:bg-lime-950/40 border-lime-300 dark:border-lime-700/80 shadow-2xs hover:border-lime-400' 
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-lime-300 dark:hover:border-lime-700/60 hover:shadow-xs'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <h4 className={`font-bold text-xs sm:text-sm truncate ${isInCart ? 'text-lime-950 dark:text-lime-300' : 'text-slate-800 dark:text-slate-100'}`}>
                            {displayName}
                          </h4>
                          {isInCart && (
                            <span className="text-[10px] font-bold bg-lime-600 text-white px-1.5 py-0.2 rounded-md shrink-0">
                              {formatQty(inCartItem.quantity)}L in Cart
                            </span>
                          )}
                        </div>
                        
                        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                          {!isReturn && (
                            <span className={`text-[10px] px-1.5 py-0.2 rounded border uppercase font-bold tracking-wide ${getMilkTypeStyle(alloc.milk_type || 'Mixed')}`}>
                              {alloc.milk_type || 'Mixed'}
                            </span>
                          )}
                          {isReturn && (
                            <span className="text-[10px] bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 px-1.5 py-0.2 rounded border border-amber-200 dark:border-amber-800 uppercase tracking-wide font-bold">
                              Return
                            </span>
                          )}
                          {isPartiallyAllocated && (
                            <span className="text-[10px] bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 px-1.5 py-0.2 rounded border border-amber-200 dark:border-amber-800 font-semibold">
                              Partial ({formatQty(currentQty)} / {formatQty(alloc.original_quantity)}L)
                            </span>
                          )}
                          <span className="text-[11px] text-slate-400 dark:text-slate-400 font-mono">
                            Rs {rate.toFixed(0)}/L
                          </span>
                          <span className="text-slate-300 dark:text-slate-600 hidden sm:inline">•</span>
                          <span className="text-[11px] text-slate-400 dark:text-slate-400 hidden sm:inline">
                            {new Date(alloc.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                        <div className="text-right">
                          <p className="text-[10px] text-slate-400 uppercase font-semibold">Avail</p>
                          <p className="text-sm sm:text-base font-bold font-mono text-slate-800 dark:text-slate-100 leading-tight">
                            {formatQty(currentQty)} <span className="text-[11px] font-normal text-slate-400">L</span>
                          </p>
                        </div>

                        <button aria-label={isInCart ? 'Edit quantity' : 'Add to cart'} 
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openAllocateModal(alloc, 'fresh');
                          }}
                          className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                            isInCart 
                              ? 'bg-lime-600 text-white shadow-xs hover:bg-lime-700' 
                              : 'bg-lime-50 dark:bg-lime-950/40 text-lime-700 dark:text-lime-300 hover:bg-lime-600 hover:text-white border border-lime-200 dark:border-lime-800 shadow-2xs'
                          }`}
                          title={isInCart ? 'Edit quantity' : 'Add to cart'}
                        >
                          {isInCart ? <Check size={16} /> : <Plus size={16} />}
                        </button>
                      </div>
                    </div>
                  );
                })
              )
            )}

            {/* VIEW 2: RETAIL STOCK */}
            {activeSource === 'retail' && (
              filteredRetailMilkItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[220px] text-slate-400 text-center p-6">
                  <Refrigerator size={40} className="mb-2 opacity-25 text-slate-400" />
                  <p className="font-semibold text-xs sm:text-sm text-slate-600 dark:text-slate-400">No milk available in retail counter</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Ensure milk items exist in Items and have stock in POS.</p>
                </div>
              ) : (
                filteredRetailMilkItems.map(item => {
                  const itemId = item.item_id || item.id;
                  const inCartItem = cart.find(i => i.allocationId === itemId);
                  const isInCart = !!inCartItem;
                  const itemDef = items.find(d => d.name === item.name);
                  const displayRate = itemDef?.cost_price || item.price || 0;

                  return (
                    <div 
                      key={item.id} 
                      onClick={() => openAllocateModal(item, 'retail')}
                      className={`relative flex items-center justify-between p-3 sm:p-3.5 rounded-xl border transition-all cursor-pointer group ${
                        isInCart 
                          ? 'bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700/80 shadow-2xs hover:border-indigo-400' 
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700/60 hover:shadow-xs'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <h4 className={`font-bold text-xs sm:text-sm truncate ${isInCart ? 'text-indigo-950 dark:text-indigo-300' : 'text-slate-800 dark:text-slate-100'}`}>
                            {item.name}
                          </h4>
                          {isInCart && (
                            <span className="text-[10px] font-bold bg-indigo-600 text-white px-1.5 py-0.2 rounded-md shrink-0">
                              {formatQty(inCartItem.quantity)}L in Cart
                            </span>
                          )}
                        </div>
                        
                        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.2 rounded border border-indigo-100 dark:border-indigo-800 font-bold uppercase tracking-wide flex items-center gap-1">
                            <Refrigerator size={10}/> Retail
                          </span>
                          <span className="text-[11px] text-slate-400 dark:text-slate-400 font-mono">
                            Ref Cost: Rs {displayRate.toFixed(0)}/{item.unit || 'L'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                        <div className="text-right">
                          <p className="text-[10px] text-slate-400 uppercase font-semibold">Avail</p>
                          <p className="text-sm sm:text-base font-bold font-mono text-slate-800 dark:text-slate-100 leading-tight">
                            {formatQty(item.quantity)} <span className="text-[11px] font-normal text-slate-400">{item.unit || 'L'}</span>
                          </p>
                        </div>

                        <button aria-label={isInCart ? 'Edit quantity' : 'Add to cart'} 
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openAllocateModal(item, 'retail');
                          }}
                          className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                            isInCart 
                              ? 'bg-indigo-600 text-white shadow-xs hover:bg-indigo-700' 
                              : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-600 hover:text-white border border-indigo-200 dark:border-indigo-800 shadow-2xs'
                          }`}
                          title={isInCart ? 'Edit quantity' : 'Add to cart'}
                        >
                          {isInCart ? <Check size={16} /> : <Plus size={16} />}
                        </button>
                      </div>
                    </div>
                  );
                })
              )
            )}

          </div>

          {/* Floating Mobile Cart Banner (Visible on mobile when items are in cart) */}
          <AnimatePresence>
            {mobileTab === 'source' && cart.length > 0 && (
              <MotionDiv 
                initial={{ y: 50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 50, opacity: 0 }}
                className="p-2.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-white sm:hidden flex items-center justify-between gap-2 border-t border-slate-200 dark:border-slate-800 shadow-xl"
              >
                <div className="min-w-0">
                  <span className="text-xs font-bold block truncate text-slate-900 dark:text-white">
                    {cart.length} Batches • {totalVolume.toFixed(1)} L
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-mono">
                    Avg Rs {averageRate.toFixed(1)}/L
                  </span>
                </div>

                <button
                  onClick={() => setMobileTab('cart')}
                  className="px-3.5 py-1.5 bg-lime-600 hover:bg-lime-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all shrink-0 active:scale-95 shadow-xs cursor-pointer"
                >
                  <span>Review Cart</span>
                  <ArrowRight size={13} />
                </button>
              </MotionDiv>
            )}
          </AnimatePresence>

        </div>

        {/* RIGHT COLUMN: ALLOCATION CART & EXECUTION */}
        <div className={`flex-[1.1] flex-col bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden h-full min-h-0 ${
          mobileTab === 'cart' ? 'flex' : 'hidden lg:flex'
        }`}>
          
          {/* Cart Header */}
          <div className="p-3 sm:px-4 sm:py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 flex items-center justify-between shrink-0">
            <h3 className="font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <ShoppingCart className="text-lime-600 dark:text-lime-400" size={16} /> 
              <span>Allocation Cart</span>
              <span className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold">
                {cart.length}
              </span>
            </h3>

            {cart.length > 0 && (
              <button 
                onClick={clearCart}
                className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40 px-2 py-1 rounded-md transition-colors flex items-center gap-1 font-semibold cursor-pointer"
              >
                <Trash2 size={12} /> Clear
              </button>
            )}
          </div>

          {/* Cart Items List */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2 bg-white dark:bg-slate-900/60">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[180px] text-slate-400 text-center p-6">
                <ShoppingCart size={36} className="mb-2 opacity-30 text-slate-400" />
                <p className="font-semibold text-xs sm:text-sm text-slate-600 dark:text-slate-400">Cart is empty</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Select milk batches from the left panel to begin allocation.</p>
                <button
                  onClick={() => setMobileTab('source')}
                  className="mt-3 text-xs font-bold text-lime-700 dark:text-lime-400 bg-lime-50 dark:bg-lime-950/40 border border-lime-200 dark:border-lime-800 px-3 py-1.5 rounded-lg sm:hidden cursor-pointer"
                >
                  Browse Batches
                </button>
              </div>
            ) : (
              cart.map(item => {
                const isReturn = (item.supplierName || '').startsWith('Return:');
                const displayCartName = isReturn ? (item.supplierName || '').replace('Return:', '').trim() : (item.supplierName || 'Unknown');
                const isRetail = item.source === 'retail';

                return (
                  <div 
                    key={item.allocationId} 
                    className={`p-2.5 sm:p-3 rounded-xl border flex items-center justify-between gap-2.5 transition-all ${
                      isRetail ? 'border-indigo-200 dark:border-indigo-800/80 bg-indigo-50/20 dark:bg-indigo-950/30' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <button aria-label="Remove" 
                        onClick={() => removeFromCart(item.allocationId)}
                        className="text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 p-1 rounded-md transition-colors shrink-0 cursor-pointer"
                        title="Remove"
                      >
                        <X size={14} />
                      </button>
                      
                      <div className="min-w-0">
                        <p className="font-bold text-xs sm:text-sm text-slate-800 dark:text-slate-100 truncate flex items-center gap-1.5">
                          {isRetail && <Refrigerator size={12} className="text-indigo-600 dark:text-indigo-400 shrink-0"/>}
                          <span>{displayCartName}</span>
                          {!isRetail && !isReturn && (
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1 py-0.2 rounded font-medium">
                              {item.milkType}
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-slate-400 font-mono truncate">
                          Rs {item.rate.toFixed(0)}/L • Max: {formatQty(item.maxQty)}L
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="flex items-center bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 px-1.5 py-1 focus-within:border-lime-500 focus-within:ring-1 focus-within:ring-lime-500 transition-all">
                        <input 
                          type="number"
                          step="any"
                          min="0"
                          max={item.maxQty}
                          className="w-14 sm:w-16 bg-transparent text-right font-bold font-mono text-slate-800 dark:text-slate-100 text-xs sm:text-sm outline-none"
                          value={item.quantity === 0 ? '' : item.quantity}
                          onChange={(e) => updateCartQty(item.allocationId, parseFloat(e.target.value))}
                        />
                        <span className="text-[11px] font-semibold text-slate-400 pl-1">L</span>
                      </div>

                      {item.quantity < item.maxQty && (
                        <button
                          type="button"
                          onClick={() => updateCartQty(item.allocationId, item.maxQty)}
                          className="text-[9px] font-bold text-lime-700 dark:text-lime-400 bg-lime-50 dark:bg-lime-950/40 border border-lime-200 dark:border-lime-800 px-1.5 py-1 rounded hover:bg-lime-100 dark:hover:bg-lime-900/50 cursor-pointer"
                          title="Set max volume"
                        >
                          Max
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Cart Footer: Summary, Destination & Submit */}
          <div className="p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/90 shrink-0 space-y-3">
            
            {/* Stats Overview */}
            <div className="grid grid-cols-2 gap-2 bg-white dark:bg-slate-900 p-2.5 sm:p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
              <div>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Volume</p>
                <p className="text-base sm:text-xl font-bold font-mono text-lime-700 dark:text-lime-400 leading-tight mt-0.5">
                  {totalVolume.toFixed(1)} <span className="text-xs font-normal text-slate-400">L</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center justify-end gap-1">
                  <Calculator size={10} /> Avg Cost
                </p>
                <p className="text-base sm:text-xl font-bold font-mono text-slate-800 dark:text-slate-100 leading-tight mt-0.5">
                  Rs {averageRate.toFixed(1)}
                </p>
              </div>
            </div>

            {/* Destination Switcher */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Allocation Destination
              </label>
              <div className="grid grid-cols-2 gap-1.5 bg-slate-200/60 dark:bg-slate-800 p-1 rounded-xl">
                {[DestinationType.RETAIL, DestinationType.PRODUCTION].map(type => {
                  if (activeSource === 'retail' && type === DestinationType.RETAIL) return null;
                  
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setDestination(type)}
                      className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        destination === type 
                          ? 'bg-white dark:bg-slate-900 text-lime-700 dark:text-lime-400 shadow-xs' 
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      {getDestinationIcon(type)}
                      <span>{type}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dynamic Destination Options */}
            <div>
              {destination === DestinationType.PRODUCTION && (
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                    Product to Manufacture *
                  </label>
                  <select
                    className={`${inputClass} ${
                      !selectedProduct ? 'border-amber-400 dark:border-amber-500 ring-1 ring-amber-400/20' : ''
                    }`}
                    value={selectedProduct}
                    onChange={(e) => setSelectedProduct(e.target.value)}
                  >
                    <option value="">Select Product...</option>
                    {producibleItems.map(p => (
                      <option key={p.id} value={p.name}>Make: {p.name}</option>
                    ))}
                    {producibleItems.length === 0 && (
                      <option value="" disabled>No production items defined (Set source to Production in Items)</option>
                    )}
                  </select>
                  {!selectedProduct && (
                    <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      ⚠️ Please select a product to enable allocation confirmation
                    </p>
                  )}
                </div>
              )}
              
              {destination === DestinationType.RETAIL && (
                <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900/80 p-2 rounded-lg border border-slate-200 dark:border-slate-800 text-center italic">
                  Milk will be transferred directly into POS Retail Counter stock.
                </div>
              )}
            </div>

            {/* Main Action Button */}
            {(() => {
              const isInvalidProduction = destination === DestinationType.PRODUCTION && !selectedProduct;
              const isInvalidRetail = activeSource === 'retail' && destination === DestinationType.RETAIL;
              const isBatchBlocked = destination === DestinationType.PRODUCTION && !canStartBatch;
              const canConfirm = canCreate && !isBatchBlocked && cart.length > 0 && !isSubmitting && totalVolume > 0 && !isInvalidProduction && !isInvalidRetail;

              return (
                <button 
                  onClick={handleProcessAllocation}
                  disabled={!canConfirm}
                  title={!canCreate ? 'Aap ko allocation ki ijazat nahi hai' : isBatchBlocked ? 'Aap ko production batch shuru karne ki ijazat nahi hai' : undefined}
                  className={`w-full py-3 rounded-xl font-bold text-xs sm:text-sm text-white flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.98] ${
                    canConfirm
                      ? 'bg-lime-600 hover:bg-lime-700 shadow-lime-200 cursor-pointer' 
                      : 'bg-slate-300 dark:bg-slate-800 text-slate-500 dark:text-slate-600 cursor-not-allowed opacity-60'
                  }`}
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw size={15} className="animate-spin" /> Processing...
                    </>
                  ) : (
                    <>
                      Confirm Allocation <ArrowRight size={16} />
                    </>
                  )}
                </button>
              );
            })()}

          </div>

        </div>

      </div>

      {/* 3. QUANTITY SELECTION POPUP MODAL */}
      <AnimatePresence>
        {modalData && (
          <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <MotionDiv
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-md overflow-hidden"
            >
              {/* Modal Header */}
              <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/90 flex justify-between items-center">
                <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Sliders size={16} className="text-lime-600 dark:text-lime-400" />
                  <span>Allocate Milk Volume</span>
                </h3>
                <button aria-label="Band karein" 
                  onClick={() => setModalData(null)} 
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 p-1 rounded-lg transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Modal Body / Form */}
              <form onSubmit={handleConfirmModalAllocation} className="p-4 sm:p-5 space-y-4">
                
                {/* Batch Info Card */}
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl space-y-2 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 dark:text-slate-400">Source:</span>
                    <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">{modalData.name}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 dark:text-slate-400">Milk Type / Cost:</span>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[10px] px-1.5 py-0.2 rounded font-bold uppercase ${getMilkTypeStyle(modalData.milkType)}`}>
                        {modalData.milkType}
                      </span>
                      <span className="font-bold font-mono text-slate-700 dark:text-slate-300">Rs {modalData.rate.toFixed(0)}/L</span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center pt-1 border-t border-slate-200 dark:border-slate-700">
                    <span className="text-slate-500 dark:text-slate-400">Max Available Stock:</span>
                    <span className="font-bold font-mono text-lime-700 dark:text-lime-400 text-sm">{formatQty(modalData.maxQty)} Liters</span>
                  </div>
                </div>

                {/* Quantity Input Field */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Quantity to Allocate (Liters) *
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      min="0.1"
                      max={modalData.maxQty}
                      required
                      autoFocus
                      className="w-full h-12 pl-4 pr-12 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-lg font-bold font-mono text-slate-900 dark:text-slate-100 outline-none focus:border-lime-500 focus:ring-2 focus:ring-lime-500/20 transition-all shadow-xs"
                      placeholder="0.0"
                      value={modalQty}
                      onChange={(e) => setModalQty(e.target.value)}
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-sm">
                      L
                    </span>
                  </div>
                </div>

                {/* Quick Presets Buttons */}
                <div>
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                    Quick Volume Presets
                  </span>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[
                      { label: '5L', val: 5 },
                      { label: '10L', val: 10 },
                      { label: '50% (Half)', val: cleanNumber(modalData.maxQty / 2) },
                      { label: `100% (${formatQty(modalData.maxQty)}L)`, val: modalData.maxQty }
                    ].map(p => {
                      if (p.val > modalData.maxQty && p.val !== modalData.maxQty) return null;
                      return (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => setModalQty(p.val)}
                          className={`py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                            parseFloat(modalQty.toString()) === p.val
                              ? 'bg-lime-600 text-white border-lime-600 font-bold'
                              : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                          }`}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Summary calculation */}
                <div className="flex justify-between items-center pt-2 text-xs">
                  <span className="text-slate-500 dark:text-slate-400">Estimated Value:</span>
                  <span className="font-bold font-mono text-slate-900 dark:text-slate-100 text-sm">
                    {formatCurrency((parseFloat(modalQty.toString()) || 0) * modalData.rate)}
                  </span>
                </div>

                {/* Action Buttons */}
                <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800">
                  {cart.some(ci => ci.allocationId === modalData.id) ? (
                    <button
                      type="button"
                      onClick={() => {
                        removeFromCart(modalData.id);
                        setModalData(null);
                        showToast(`Removed ${modalData.name} from cart`, 'info');
                      }}
                      className="px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl transition-colors border border-red-200 dark:border-red-800 cursor-pointer"
                    >
                      Remove from Cart
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setModalData(null)}
                      className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  )}

                  <button
                    type="submit"
                    className="flex-1 bg-lime-600 hover:bg-lime-700 text-white font-bold text-xs sm:text-sm py-2.5 px-4 rounded-xl shadow-xs transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Check size={16} />
                    <span>
                      {cart.some(ci => ci.allocationId === modalData.id) ? 'Update Cart' : 'Add to Cart'}
                    </span>
                  </button>
                </div>

              </form>

            </MotionDiv>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};

export default Allocation;
