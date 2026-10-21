import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDairy } from '../context/DairyContext';
import { ItemDefinition, RecipeIngredient, ItemType, ItemVariant } from '../types';
import { 
  Search, Plus, Edit, Trash2, X, 
  Save,
  Tag, Lock, CheckSquare, Square,
  ChevronDown, Check, Truck, Factory, Briefcase,
  ChefHat, Boxes, FlaskConical,
  AlertTriangle, ShieldAlert, Ruler,
  ArrowUpDown, ArrowUp, ArrowDown, Package,
  Sparkles, Loader2, Archive, RotateCcw,
  Upload, Image as ImageIcon, Zap, GripVertical, Scale
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { MODULE_METADATA, useTabs } from '../context/TabContext';
import { motion, AnimatePresence } from 'framer-motion';
import { formatQty, formatCurrency, cleanQty } from '../lib/formatters';
import { optimizeImage, OptimizationResult } from '../lib/imageOptimizer';
import { UnitSelector } from '../components/units/UnitSelector';
import { UnitManagerModal } from '../components/units/UnitManagerModal';
import { detectUnitGroupId } from '../lib/unitConversion';
import { SellUnitsTab, sellUnitDraftIssues } from '../components/items/SellUnitsTab';
import { ItemDetailView, SellInPosEntry } from '../components/items/ItemDetailView';

const MotionDiv = motion.div as any;

type SortField = 'name' | 'category' | 'item_type' | 'cost_price' | 'selling_price' | 'unit' | 'stock' | 'sort_order';
type SortOrder = 'asc' | 'desc';
type DrawerMode = 'view' | 'edit' | 'create';

const MultiSelect: React.FC<{
  label: string;
  options: string[];
  selected: string[];
  onToggle: (option: string) => void;
  placeholder?: string;
  disabled?: boolean;
}> = ({ label, options, selected, onToggle, placeholder = "Select options...", disabled = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const validSelected = Array.from(new Set(selected)).filter(s => options.includes(s));
  const displayValue = validSelected.length === 0 ? placeholder : validSelected.length === 1 ? validSelected[0] : `${validSelected.length} selected`;

  return (
    <div className="relative" ref={containerRef}>
      <label className="block text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">{label}</label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border bg-white dark:bg-slate-800 text-xs sm:text-sm font-medium transition-all shadow-sm focus:ring-2 focus:ring-lime-500/20 ${disabled ? 'bg-slate-50 dark:bg-slate-900 cursor-not-allowed border-slate-200 dark:border-slate-800 text-slate-400' : isOpen ? 'border-lime-500 ring-2 ring-lime-500/10' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-800 dark:text-slate-200'}`}
      >
        <span className={validSelected.length === 0 ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-white font-semibold'}>{displayValue}</span>
        <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <MotionDiv
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="absolute z-50 w-full mt-1.5 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden max-h-60 overflow-y-auto"
          >
            <div className="p-1">
              {options.map(option => {
                const isChecked = selected.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => onToggle(option)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs sm:text-sm transition-colors ${isChecked ? 'bg-lime-50 dark:bg-lime-950/40 text-lime-700 dark:text-lime-300 font-semibold' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${isChecked ? 'bg-lime-600 border-lime-600' : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900'}`}>
                        {isChecked && <Check size={10} className="text-white" strokeWidth={4} />}
                      </div>
                      {option}
                    </div>
                  </button>
                );
              })}
            </div>
          </MotionDiv>
        )}
      </AnimatePresence>
    </div>
  );
};

const Items: React.FC = () => {
  const { 
    items, addItem, updateItem, reorderItems,
    categories, addCategory, removeCategory,
    unitGroups, inventoryLogs, materialPurchases, inventory,
    canPerform,
    getDeleteAssessment,
    safeDeleteItem,
    reactivateEntity,
    hasPermission,
    settings
  } = useDairy();
  const { showToast } = useToast();
  const { openTab } = useTabs();
  const canOpenPos = hasPermission ? hasPermission(MODULE_METADATA['pos']?.module || 'pos') : true;
  const location = useLocation();
  const navigate = useNavigate();

  const canCreate = canPerform('items', 'create');
  const canEdit = canPerform('items', 'edit');
  const canDelete = canPerform('items', 'delete');
  
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('edit');
  const [selectedItem, setSelectedItem] = useState<ItemDefinition | null>(null);

  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isUnitManagerOpen, setIsUnitManagerOpen] = useState(false);
  const [activeFormTab, setActiveFormTab] = useState<'details' | 'recipe' | 'variants'>('details');
  
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('All');
  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [filterActiveStatus, setFilterActiveStatus] = useState<'Active' | 'Inactive' | 'All'>('All');
  const [newCatName, setNewCatName] = useState('');
  
  // Default to sort_order so the catalog matches the POS sequence.
  const [sortField, setSortField] = useState<SortField>('sort_order');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<'above' | 'below' | null>(null);

  const [deleteAudit, setDeleteAudit] = useState<{
    isOpen: boolean;
    item: ItemDefinition | null;
    blockedBy: string[];
    logCount: number;
    purchaseCount: number;
  }>({
    isOpen: false,
    item: null,
    blockedBy: [],
    logCount: 0,
    purchaseCount: 0
  });

  const [formData, setFormData] = useState<Partial<ItemDefinition>>({
    name: '', category: [], item_type: ['Sale product'], unit: '', unit_group_id: '', 
    source: 'Both', cost_price: 0, selling_price: 0, isActive: true, 
    recipe: [], variants: [], recipe_base_item_id: 'MILK_BASE', recipe_base_quantity: 0,
    recipe_expected_output: 0, quick_amounts: [], allow_loose_sale: true,
    pos_primary_mode: 'amount',
    image_url: '', sort_order: 999
  });

  const [isOptimizingImage, setIsOptimizingImage] = useState(false);
  const [imageOptimizationInfo, setImageOptimizationInfo] = useState<OptimizationResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast("Please select a valid image file (PNG, JPG, WebP)", "warning");
      return;
    }

    try {
      setIsOptimizingImage(true);
      const result = await optimizeImage(file, {
        maxDimension: 500,
        quality: 0.82,
        preferredFormat: 'image/webp'
      });

      setFormData(prev => ({ ...prev, image_url: result.dataUrl }));
      setImageOptimizationInfo(result);
      showToast(`Image optimized: ${result.originalSizeFormatted} ➔ ${result.optimizedSizeFormatted} (${result.savedPercentage}% saved)`, "success");
    } catch (err: any) {
      console.error("Image optimization error:", err);
      showToast("Failed to process image: " + (err?.message || "Unknown error"), "error");
    } finally {
      setIsOptimizingImage(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveImage = () => {
    setFormData(prev => ({ ...prev, image_url: '' }));
    setImageOptimizationInfo(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const [quickAmountsRaw, setQuickAmountsRaw] = useState<string>('');
  const [newIngredient, setNewIngredient] = useState<{itemId: string, qty: string}>({ itemId: '', qty: '' });
  
  const [editingVariantIndex, setEditingVariantIndex] = useState<number>(-1);
  const [variantSubTab, setVariantSubTab] = useState<'multi_unit' | 'packaging'>('multi_unit');
  const [newVariant, setNewVariant] = useState<{name: string, packId: string, packQty: string, productQty: string, price: string, fromBase: boolean}>({ name: '', packId: '', packQty: '1', productQty: '', price: '', fromBase: true });

  const ITEM_TYPES: ItemType[] = ['Raw material', 'Packaging material', 'Sale product'];

  // Base unit is how stock, cost and every pack size are measured. Once stock exists it cannot be relabelled.
  const unitLocked = useMemo(() => {
    if (drawerMode !== 'edit' || !selectedItem) return false;
    const inv = inventory?.find(i => i.item_id === selectedItem.id);
    const loose = Math.abs(Number(inv?.quantity ?? (selectedItem as any).stock ?? 0)) > 0.0001;
    const packs = Object.values(inv?.variant_stocks || selectedItem.variant_stocks || {}).some(v => Math.abs(Number(v) || 0) > 0.0001);
    return loose || packs;
  }, [drawerMode, selectedItem, inventory]);


  const saleProductsCount = items.filter(i => i.item_type.includes('Sale product')).length;
  const rawMaterialsCount = items.filter(i => i.item_type.includes('Raw material')).length;
  const packagingCount = items.filter(i => i.item_type.includes('Packaging material')).length;



  const getItemStock = (item: ItemDefinition) => {
    const inv = inventory?.find(i => i.item_id === item.id) || inventory?.find(i => !i.item_id && i.name.toLowerCase() === item.name.toLowerCase());
    const rawStock = inv?.quantity !== undefined ? inv.quantity : ((item as any).stock || 0);
    return cleanQty(rawStock);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const filteredItems = useMemo(() => {
    const list = items.filter(item => {
      const matchesSearch = 
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.category.some(c => c.toLowerCase().includes(searchTerm.toLowerCase()));
      
      const matchesType = filterType === 'All' || item.item_type.includes(filterType as any);
      const matchesCat = filterCategory === 'All' || item.category.includes(filterCategory);

      if (filterActiveStatus === 'Active' && item.isActive === false) return false;
      if (filterActiveStatus === 'Inactive' && item.isActive !== false) return false;

      return matchesSearch && matchesType && matchesCat;
    });

    return list.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'category': {
          const catA = (a.category && a.category[0]) || '';
          const catB = (b.category && b.category[0]) || '';
          comparison = catA.localeCompare(catB);
          break;
        }
        case 'item_type': {
          const typeA = (a.item_type && a.item_type[0]) || '';
          const typeB = (b.item_type && b.item_type[0]) || '';
          comparison = typeA.localeCompare(typeB);
          break;
        }
        case 'sort_order': {
          const orderA = a.sort_order ?? 999;
          const orderB = b.sort_order ?? 999;
          comparison = orderA !== orderB ? orderA - orderB : a.name.localeCompare(b.name);
          break;
        }
        case 'cost_price':
          comparison = (a.cost_price || 0) - (b.cost_price || 0);
          break;
        case 'selling_price':
          comparison = (a.selling_price || 0) - (b.selling_price || 0);
          break;
        case 'stock':
          comparison = getItemStock(a) - getItemStock(b);
          break;
        case 'unit':
          comparison = (a.unit || '').localeCompare(b.unit || '');
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [items, inventory, searchTerm, filterType, filterCategory, sortField, sortOrder, filterActiveStatus]);

  const rawMaterials = items.filter(i => i.item_type.includes('Raw material'));
  const packagingMaterials = items.filter(i => i.item_type.includes('Packaging material'));

  const handleOpenEditInternal = (item: ItemDefinition) => {
    setSelectedItem(item);
    setImageOptimizationInfo(null);
    const cleanData = JSON.parse(JSON.stringify(item));
    if (cleanData.item_type) {
        const validTypes = cleanData.item_type.filter((t: string) => ITEM_TYPES.includes(t as ItemType));
        cleanData.item_type = Array.from(new Set(validTypes));
    }
    
    let groupId = cleanData.unit_group_id;
    if (!groupId && cleanData.unit) {
       groupId = unitGroups.find(g => g.units.some(u => u.symbol === cleanData.unit))?.id || '';
    }

    setFormData({
      ...cleanData,
      sort_order: cleanData.sort_order !== undefined && cleanData.sort_order !== null ? Number(cleanData.sort_order) : 999,
      unit_group_id: groupId,
      recipe: cleanData.recipe || [],
      variants: cleanData.variants || [],
      recipe_base_item_id: cleanData.recipe_base_item_id || 'MILK_BASE',
      recipe_base_quantity: cleanData.recipe_base_quantity || 0,
      recipe_expected_output: cleanData.recipe_expected_output || 0,
      quick_amounts: cleanData.quick_amounts || [],
      allow_loose_sale: cleanData.allow_loose_sale !== false,
      pos_primary_mode: cleanData.pos_primary_mode || 'amount',
      image_url: cleanData.image_url || ''
    }); 
    setQuickAmountsRaw(Array.isArray(cleanData.quick_amounts) && cleanData.quick_amounts.length > 0 ? cleanData.quick_amounts.join(', ') : '');
    setActiveFormTab('details');
    setDrawerMode('edit');
    setIsDrawerOpen(true);
  };

  const handleOpenAddInternal = () => {
    setSelectedItem(null); 
    setImageOptimizationInfo(null);
    const nextSortOrder = (items.filter(i => i.item_type?.includes('Sale product')).length + 1) || 1;
    setFormData({ 
      name: '', category: [], item_type: ['Sale product'], unit: '', unit_group_id: '', 
      source: 'Both', cost_price: 0, selling_price: 0, isActive: true, 
      recipe: [], variants: [], recipe_base_item_id: 'MILK_BASE', 
      recipe_base_quantity: 0, recipe_expected_output: 0, quick_amounts: [], allow_loose_sale: true,
      pos_primary_mode: 'amount',
      image_url: '', sort_order: nextSortOrder
    }); 
    setQuickAmountsRaw('');
    setActiveFormTab('details');
    setDrawerMode('create');
    setIsDrawerOpen(true);
  };

  // Read-only product page: stock by pile, packing, prices and warnings. Edit opens the form from there.
  const handleOpenViewInternal = (item: ItemDefinition) => {
    setSelectedItem(item);
    setDrawerMode('view');
    setIsDrawerOpen(true);
  };

  const handleOpenView = (item: ItemDefinition) => {
    handleOpenViewInternal(item);
    const sp = new URLSearchParams(location.search);
    sp.set('id', item.id);
    sp.set('mode', 'view');
    const q = sp.toString();
    navigate(`${location.pathname}${q ? `?${q}` : ''}`, { replace: true });
  };

  const handleOpenEdit = (item: ItemDefinition) => {
    handleOpenEditInternal(item);
    const sp = new URLSearchParams(location.search);
    sp.set('id', item.id);
    sp.set('mode', 'edit');
    const q = sp.toString();
    navigate(`${location.pathname}${q ? `?${q}` : ''}`, { replace: true });
  };

  const handleOpenAdd = () => {
    handleOpenAddInternal();
    const sp = new URLSearchParams(location.search);
    sp.delete('id');
    sp.set('mode', 'create');
    const q = sp.toString();
    navigate(`${location.pathname}${q ? `?${q}` : ''}`, { replace: true });
  };

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false);
    setSelectedItem(null);
    const sp = new URLSearchParams(location.search);
    sp.delete('id');
    sp.delete('mode');
    const q = sp.toString();
    navigate(`${location.pathname}${q ? `?${q}` : ''}`, { replace: true });
  };

  // Sync state if URL changes externally
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const idParam = sp.get('id');
    const modeParam = sp.get('mode') as DrawerMode | null;

    if (modeParam === 'create') {
      if (!isDrawerOpen || drawerMode !== 'create') {
        handleOpenAddInternal();
      }
    } else if (idParam && items.length > 0) {
      const match = items.find(i => i.id === idParam);
      if (match) {
        const wanted: DrawerMode = modeParam === 'view' ? 'view' : 'edit';
        if (!isDrawerOpen || selectedItem?.id !== idParam || drawerMode !== wanted) {
          if (wanted === 'view') handleOpenViewInternal(match);
          else handleOpenEditInternal(match);
        }
      }
    } else if (!idParam && isDrawerOpen) {
      setIsDrawerOpen(false);
      setSelectedItem(null);
    }
  }, [location.search, items]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    
    const errors: string[] = [];
    if (!formData.name) errors.push("Display Name is required");
    if (!formData.item_type?.length) errors.push("At least one Usage Class is required");
    if (!formData.unit) errors.push("Primary Base Unit is required");
    
    if (errors.length > 0) {
       showToast(errors.join(", "), "warning");
       return;
    }
    
    const parsedQuickAmounts = quickAmountsRaw
      .split(',')
      .map(s => parseFloat(s.trim()))
      .filter(n => !isNaN(n) && n > 0);

    const finalData = { 
        ...formData, 
        sort_order: formData.sort_order !== undefined && formData.sort_order !== null ? Number(formData.sort_order) : 999,
        pos_primary_mode: formData.pos_primary_mode || 'amount',
        quick_amounts: parsedQuickAmounts,
        item_type: Array.from(new Set(formData.item_type)) 
    };

    setIsSubmitting(true);
    try {
      let success = false;
      if (selectedItem && drawerMode === 'edit') {
        success = await updateItem(selectedItem.id, finalData);
        if (success) {
          handleCloseDrawer();
        }
      } else {
        success = await addItem(finalData as Omit<ItemDefinition, 'id'>);
        if (success) {
          handleCloseDrawer();
        }
      }
    } catch (err: any) {
      showToast("Error saving item: " + (err?.message || "Failed"), "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateCategory = () => { if (!newCatName) return; addCategory(newCatName); setNewCatName(''); };
  const toggleType = (type: any) => { const current = formData.item_type || []; const validCurrent = Array.from(new Set(current.filter((t: any) => ITEM_TYPES.includes(t)))); setFormData({ ...formData, item_type: validCurrent.includes(type) ? validCurrent.filter((t: any) => t !== type) : [...validCurrent, type] }); };
  const toggleCategory = (cat: string) => { const current = formData.category || []; setFormData({ ...formData, category: current.includes(cat) ? current.filter(c => c !== cat) : [...current, cat] }); };
  const addIngredient = () => { if (!newIngredient.itemId || !newIngredient.qty) return; const item = items.find(i => i.id === newIngredient.itemId); if (!item) return; const newRec = [...(formData.recipe || []), { item_id: item.id, item_name: item.name, quantity: parseFloat(newIngredient.qty), unit: item.unit, type: 'Ingredient' } as RecipeIngredient]; setFormData({ ...formData, recipe: newRec }); setNewIngredient({ itemId: '', qty: '' }); };
  const removeIngredient = (idx: number) => { const newRec = [...(formData.recipe || [])]; newRec.splice(idx, 1); setFormData({ ...formData, recipe: newRec }); };
  
  const handleVariantSubmit = () => {
    const contains = parseFloat(newVariant.productQty);
    if (!newVariant.name.trim() || !(contains > 0)) { 
      showToast(`Enter a name and the size in ${formData.unit || 'units'}`, "warning"); 
      return; 
    }
    const issues = sellUnitDraftIssues(newVariant, variantSubTab, formData.unit || '', formData.variants || [], editingVariantIndex);
    if (issues.length > 0) { showToast(issues[0], "warning"); return; }
    const isMultiUnit = variantSubTab === 'multi_unit';
    let packItemName = '';
    if (!isMultiUnit && newVariant.packId) { 
      const packItem = items.find(i => i.id === newVariant.packId); 
      packItemName = packItem?.name || ''; 
    }
    const variantData: ItemVariant = { 
      id: editingVariantIndex >= 0 && formData.variants ? formData.variants[editingVariantIndex].id : `var_${Date.now()}`, 
      name: newVariant.name.trim(), 
      packaging_item_id: isMultiUnit ? '' : (newVariant.packId || ''), 
      packaging_item_name: isMultiUnit ? '' : packItemName, 
      packaging_qty: isMultiUnit ? 0 : (newVariant.packId ? (parseFloat(newVariant.packQty) > 0 ? parseFloat(newVariant.packQty) : 1) : 0), 
      quantity_in_base_unit: contains, 
      selling_price: newVariant.price ? parseFloat(newVariant.price) : undefined, 
      deduct_from_base: isMultiUnit, 
      isActive: editingVariantIndex >= 0 && formData.variants ? formData.variants[editingVariantIndex].isActive !== false : true 
    };
    const updatedVariants = [...(formData.variants || [])];
    if (editingVariantIndex >= 0) { 
      updatedVariants[editingVariantIndex] = variantData; 
      showToast(isMultiUnit ? 'Multi-unit updated' : 'Pre-packaged variant updated', 'success'); 
    } else { 
      updatedVariants.push(variantData); 
      showToast(isMultiUnit ? 'Multi-unit added' : 'Pre-packaged variant added', 'success'); 
    }
    setFormData({ ...formData, variants: updatedVariants });
    resetVariantForm();
  }; 
  const editVariant = (index: number) => { 
    const v = formData.variants![index]; 
    const isMulti = v.deduct_from_base === true;
    setVariantSubTab(isMulti ? 'multi_unit' : 'packaging');
    setNewVariant({ 
      name: v.name, 
      packId: v.packaging_item_id || '', 
      packQty: String(v.packaging_qty ?? 0), 
      productQty: v.quantity_in_base_unit.toString(), 
      price: v.selling_price ? v.selling_price.toString() : '', 
      fromBase: isMulti 
    }); 
    setEditingVariantIndex(index);
    setActiveFormTab('variants');
  };
  const removeVariant = (index: number) => {
    const target = formData.variants?.[index];
    const onHand = target ? Number((inventory?.find(i => i.item_id === selectedItem?.id)?.variant_stocks || selectedItem?.variant_stocks || {})[target.id] || 0) : 0;
    if (target && target.deduct_from_base !== true && Math.abs(onHand) > 0.0001) {
      showToast(`${target.name} still has ${onHand} packs in stock. Count it to 0 first, or hide it instead.`, "warning");
      return;
    }
    const updated = [...(formData.variants || [])]; updated.splice(index, 1); setFormData({ ...formData, variants: updated }); if (editingVariantIndex === index) resetVariantForm();
  };
  // Hidden units stay on old bills and keep their stock; they just stop showing in POS.
  const toggleVariantActive = (index: number) => {
    const updated = [...(formData.variants || [])];
    if (!updated[index]) return;
    updated[index] = { ...updated[index], isActive: updated[index].isActive === false };
    setFormData({ ...formData, variants: updated });
  };
  const resetVariantForm = () => { setNewVariant({ name: '', packId: '', packQty: '1', productQty: '', price: '', fromBase: variantSubTab === 'multi_unit' }); setEditingVariantIndex(-1); };

  const checkDependencies = (itemId: string): string[] => { const dependants: string[] = []; items.forEach(otherItem => { if (otherItem.recipe && otherItem.recipe.length > 0) { const usesIt = otherItem.recipe.some(ing => ing.item_id === itemId); if (usesIt) dependants.push(otherItem.name); } }); return dependants; };
  const handleDeleteClick = (item: ItemDefinition) => { const blockedBy = checkDependencies(item.id); const logCount = inventoryLogs.filter(l => l.item_id === item.id).length; const purchaseCount = materialPurchases.filter(p => p.item_id === item.id).length; setDeleteAudit({ isOpen: true, item, blockedBy, logCount, purchaseCount }); };

  const handleSmartItemDelete = async (action: 'hard_delete' | 'deactivate' | 'write_off_spoilage') => {
    if (!deleteAudit.item) return;
    const targetId = deleteAudit.item.id;
    const success = await safeDeleteItem(targetId, action);
    if (success) {
      if (selectedItem && selectedItem.id === targetId) {
        setIsDrawerOpen(false);
        setSelectedItem(null);
      }
      setDeleteAudit({ isOpen: false, item: null, blockedBy: [], logCount: 0, purchaseCount: 0 });
    }
  };

  // POS positions for the reordered list. With a search or filter on, only the positions the visible
  // products already held are reshuffled, so hidden products keep their own POS numbers.
  const posOrderUpdates = (newOrderList: ItemDefinition[]): { id: string; sort_order: number }[] => {
    const visibleSale = newOrderList.filter(item => item.item_type?.includes('Sale product'));
    const allSaleCount = items.filter(item => item.item_type?.includes('Sale product')).length;
    if (visibleSale.length >= allSaleCount) return visibleSale.map((item, index) => ({ id: item.id, sort_order: index + 1 }));
    const slots = visibleSale.map(item => Number(item.sort_order ?? 999)).sort((a, b) => a - b);
    for (let i = 1; i < slots.length; i++) if (slots[i] <= slots[i - 1]) slots[i] = slots[i - 1] + 1;
    return visibleSale.map((item, index) => ({ id: item.id, sort_order: slots[index] }));
  };

  const handleDragStart =(e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedItemId(id);
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!draggedItemId || draggedItemId === targetId) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const isAbove = e.clientY < midY;
    
    setDragOverItemId(targetId);
    setDragPosition(isAbove ? 'above' : 'below');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverItemId(null);
      setDragPosition(null);
    }
  };

  const handleDragEnd = () => {
    setDraggedItemId(null);
    setDragOverItemId(null);
    setDragPosition(null);
  };

  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = draggedItemId || e.dataTransfer.getData('text/plain');
    if (!sourceId || sourceId === targetId) {
      handleDragEnd();
      return;
    }

    const fromIndex = filteredItems.findIndex(i => i.id === sourceId);
    const toIndex = filteredItems.findIndex(i => i.id === targetId);
    if (fromIndex === -1 || toIndex === -1) {
      handleDragEnd();
      return;
    }

    const newOrderList = [...filteredItems];
    const [movedItem] = newOrderList.splice(fromIndex, 1);

    const adjustedTargetIndex = newOrderList.findIndex(i => i.id === targetId);
    const insertIndex = dragPosition === 'below' ? adjustedTargetIndex + 1 : adjustedTargetIndex;
    newOrderList.splice(insertIndex, 0, movedItem);

    handleDragEnd();

    if (sortField !== 'sort_order' || sortOrder !== 'asc') {
      setSortField('sort_order');
      setSortOrder('asc');
    }

    const updates = posOrderUpdates(newOrderList);

    if (updates.length > 0) {
      await reorderItems(updates);
    }
  };

  const handleMoveStep = async (itemId: string, direction: 'up' | 'down') => {
    const currentIndex = filteredItems.findIndex(i => i.id === itemId);
    if (currentIndex === -1) return;
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= filteredItems.length) return;

    const newOrderList = [...filteredItems];
    const [movedItem] = newOrderList.splice(currentIndex, 1);
    newOrderList.splice(targetIndex, 0, movedItem);

    if (sortField !== 'sort_order' || sortOrder !== 'asc') {
      setSortField('sort_order');
      setSortOrder('asc');
    }

    const updates = posOrderUpdates(newOrderList);

    if (updates.length > 0) {
      await reorderItems(updates);
    }
  };

  const inputClass = "w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-xs sm:text-sm font-medium text-slate-900 dark:text-white shadow-xs focus:border-lime-500 dark:focus:border-lime-400 focus:ring-1 focus:ring-lime-500 outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500";
  const labelClass = "block text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5";

  return (
    <div className="space-y-4 sm:space-y-6 pb-20">
      <div className="space-y-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none w-full">
          {canCreate && (
            <button 
              onClick={handleOpenAdd} 
              className="bg-lime-600 hover:bg-lime-700 text-white px-4 sm:px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-md shadow-lime-500/20 transition-all active:scale-95 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus size={17} className="shrink-0" /> 
              <span>Add Product</span>
            </button>
          )}
          <button 
            onClick={() => setIsConfigOpen(true)} 
            className="bg-white hover:bg-slate-50 text-slate-700 px-3.5 py-2.5 rounded-xl font-bold text-xs sm:text-sm border border-slate-200/90 flex items-center justify-center gap-1.5 transition-all shadow-xs whitespace-nowrap shrink-0 cursor-pointer active:scale-95"
          >
            <Tag size={15} className="text-blue-500 shrink-0" /> 
            <span>Categories</span>
          </button>
          <button 
            onClick={() => setIsUnitManagerOpen(true)} 
            className="bg-white hover:bg-slate-50 text-slate-700 px-3.5 py-2.5 rounded-xl font-bold text-xs sm:text-sm border border-slate-200/90 flex items-center justify-center gap-1.5 transition-all shadow-xs whitespace-nowrap shrink-0 cursor-pointer active:scale-95"
          >
            <Ruler size={15} className="text-indigo-500 shrink-0" /> 
            <span>Units</span>
          </button>
        </div>

        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white p-2.5 sm:p-3 rounded-2xl border border-slate-200/80 shadow-sm">
           <div className="flex items-center gap-2 w-full md:w-auto">
              <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 w-full md:w-64 focus-within:border-lime-500 focus-within:bg-white transition-all shadow-inner">
                 <Search className="text-slate-400 shrink-0" size={15} />
                 <input 
                   type="text" 
                   placeholder="Search catalog..." 
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

              {categories.length > 0 && (
                 <select
                   className="text-xs font-semibold border border-slate-200 rounded-xl px-2.5 sm:px-3 py-2 bg-slate-50 text-slate-700 outline-none focus:border-lime-500 transition-all shrink-0 max-w-[130px] sm:max-w-none cursor-pointer"
                   value={filterCategory}
                   onChange={e => setFilterCategory(e.target.value)}
                 >
                    <option value="All">All Categories</option>
                    {categories.map(c => (
                       <option key={c} value={c}>{c}</option>
                    ))}
                 </select>
              )}

              <select
                className="text-xs font-semibold border border-slate-200 rounded-xl px-2.5 sm:px-3 py-2 bg-slate-50 text-slate-700 outline-none focus:border-lime-500 transition-all shrink-0 cursor-pointer"
                value={filterActiveStatus}
                onChange={e => setFilterActiveStatus(e.target.value as any)}
              >
                <option value="All">All Products (Active & Inactive)</option>
                <option value="Active">Active Products Only</option>
                <option value="Inactive">Inactive / Discontinued Only</option>
              </select>
           </div>

           <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
              {[
                 { key: 'All', label: 'All Items', count: items.length },
                 { key: 'Sale product', label: 'Sale Products', count: saleProductsCount },
                 { key: 'Raw material', label: 'Raw Materials', count: rawMaterialsCount },
                 { key: 'Packaging material', label: 'Packaging', count: packagingCount }
              ].map(tab => (
                 <button
                   key={tab.key}
                   type="button"
                   onClick={() => setFilterType(tab.key)}
                   className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                     filterType === tab.key
                       ? 'bg-lime-600 text-white shadow-xs'
                       : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                   }`}
                 >
                    <span>{tab.label}</span>
                    <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                      filterType === tab.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                    }`}>
                       {tab.count}
                    </span>
                 </button>
              ))}
           </div>
        </div>
      </div>

      <div className="block md:hidden space-y-2.5">
        {filteredItems.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-sm">
            <Boxes size={36} className="text-slate-300 mx-auto mb-2" />
            <p className="font-bold text-sm text-slate-700">No items found</p>
            <p className="text-xs text-slate-400 mt-0.5">Try adjusting your search or filters</p>
          </div>
        ) : (
          filteredItems.map((item, index) => {
            const stock = getItemStock(item);
            const isLowStock = stock <= (item.reorder_level || 5) && stock > 0;
            const isOutOfStock = stock <= 0;
            const hasVariants = item.variants && item.variants.length > 0;
            const margin = item.selling_price > item.cost_price ? item.selling_price - item.cost_price : 0;
            const marginPct = item.cost_price > 0 ? ((margin / item.cost_price) * 100).toFixed(0) : '0';

            const isSource = draggedItemId === item.id;
            const isTarget = dragOverItemId === item.id;
            const dropBorderClass = isTarget 
              ? (dragPosition === 'above' 
                  ? 'border-t-2 !border-t-lime-500 bg-lime-50/30 dark:bg-lime-950/40' 
                  : 'border-b-2 !border-b-lime-500 bg-lime-50/30 dark:bg-lime-950/40') 
              : '';

            return (
              <div 
                key={item.id} 
                draggable
                onDragStart={(e) => handleDragStart(e, item.id)}
                onDragOver={(e) => handleDragOver(e, item.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, item.id)}
                onDragEnd={handleDragEnd}
                onClick={() => handleOpenView(item)}
                className={`bg-white rounded-2xl border border-slate-200/80 p-3.5 shadow-sm active:bg-slate-50 transition-all cursor-pointer relative overflow-hidden ${dropBorderClass} ${isSource ? 'opacity-40 scale-[0.98]' : ''}`}
              >
                <div className="flex items-start justify-between gap-2.5 mb-2">
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700 font-bold text-sm shrink-0 overflow-hidden border border-slate-200/60">
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                      ) : (
                        item.name.charAt(0)
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`font-bold text-sm leading-snug ${item.isActive ? 'text-slate-900' : 'text-slate-400 line-through'}`}>
                          {item.name}
                        </span>
                      {item.item_type?.includes('Sale product') && (
                        <span className="pos-sort-badge text-[10px] px-1.5 py-0.5">
                          POS #{item.sort_order ?? 999}
                        </span>
                      )}
                      {item.isSystem && (
                        <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold border border-slate-200">
                          System
                        </span>
                      )}
                      {!item.isActive && (
                        <span className="text-[9px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-bold border border-red-200">
                          Inactive
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {item.category.length > 0 && (
                        <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                          {item.category.join(', ')}
                        </span>
                      )}
                      <span className="text-[10px] font-bold text-slate-400">
                        • {item.unit}
                      </span>
                      {hasVariants && (
                        <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded-md border border-indigo-100 flex items-center gap-0.5">
                          <Boxes size={10} /> {item.variants!.length} Units
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                  <div 
                    draggable
                    onDragStart={(e) => handleDragStart(e, item.id)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 cursor-grab active:cursor-grabbing hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                    title="Drag up or down to reorder"
                  >
                    <GripVertical size={16} />
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button aria-label="Move up"
                      type="button"
                      onClick={() => handleMoveStep(item.id, 'up')}
                      disabled={index === 0}
                      className="p-1 text-slate-400 hover:text-lime-600 dark:hover:text-lime-400 disabled:opacity-20 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      title="Move up"
                    >
                      <ArrowUp size={13} strokeWidth={2.5} />
                    </button>
                    <button aria-label="Move down"
                      type="button"
                      onClick={() => handleMoveStep(item.id, 'down')}
                      disabled={index === filteredItems.length - 1}
                      className="p-1 text-slate-400 hover:text-lime-600 dark:hover:text-lime-400 disabled:opacity-20 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      title="Move down"
                    >
                      <ArrowDown size={13} strokeWidth={2.5} />
                    </button>
                  </div>
                </div>

                <div className={`px-2.5 py-1 rounded-xl text-[11px] font-bold shrink-0 flex items-center gap-1 ${
                  isOutOfStock 
                    ? 'bg-rose-50 text-rose-700 border border-rose-200' 
                    : isLowStock 
                    ? 'bg-amber-50 text-amber-700 border border-amber-200' 
                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                }`}>
                  <Package size={12} />
                  <span>{formatQty(stock)} {item.unit}</span>
                </div>
              </div>

                <div className="grid grid-cols-3 gap-2 bg-slate-50/80 p-2 rounded-xl border border-slate-100 text-center">
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Cost</span>
                    <span className="text-xs font-bold text-slate-700 font-mono">{formatCurrency(item.cost_price)}</span>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Rate</span>
                    <span className="text-xs font-black text-slate-900 font-mono">
                      {item.item_type.includes('Sale product') ? formatCurrency(item.selling_price) : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Margin</span>
                    <span className="text-xs font-bold text-emerald-600 font-mono">
                      {item.item_type.includes('Sale product') && margin > 0 ? `+${marginPct}%` : '—'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="hidden md:block bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
         <div className="overflow-x-auto w-full min-h-[420px]">
            <table className="w-full text-left border-collapse table-auto">
               <thead className="bg-slate-50/90 text-[11px] uppercase font-bold text-slate-500 tracking-wider border-b border-slate-200 select-none">
                  <tr>
                     <th 
                       onClick={() => handleSort('sort_order')} 
                       className="px-3 py-3.5 text-center cursor-pointer select-none transition-colors hover:text-slate-900 group w-24"
                       title="Sort by POS Grid Order (or drag rows to reorder)"
                     >
                        <div className="flex items-center justify-center gap-1">
                           <span className={sortField === 'sort_order' ? 'text-slate-900 font-black' : ''}>POS #</span>
                           <span className={`transition-all ${sortField === 'sort_order' ? 'text-lime-600 opacity-100' : 'text-slate-300 opacity-0 group-hover:opacity-100'}`}>
                              {sortField === 'sort_order' ? (
                                 sortOrder === 'asc' ? <ArrowUp size={13} strokeWidth={2.5} /> : <ArrowDown size={13} strokeWidth={2.5} />
                              ) : (
                                 <ArrowUpDown size={12} />
                              )}
                           </span>
                        </div>
                     </th>

                     <th 
                       onClick={() => handleSort('name')} 
                       className="px-5 py-3.5 cursor-pointer select-none transition-colors hover:text-slate-900 group"
                       title="Sort by Item Name"
                     >
                        <div className="flex items-center gap-1.5">
                           <span className={sortField === 'name' ? 'text-slate-900 font-black' : ''}>Product Name</span>
                           <span className={`transition-all ${sortField === 'name' ? 'text-lime-600 opacity-100' : 'text-slate-300 opacity-0 group-hover:opacity-100'}`}>
                              {sortField === 'name' ? (
                                 sortOrder === 'asc' ? <ArrowUp size={13} strokeWidth={2.5} /> : <ArrowDown size={13} strokeWidth={2.5} />
                              ) : (
                                 <ArrowUpDown size={12} />
                              )}
                           </span>
                        </div>
                     </th>

                     <th 
                       onClick={() => handleSort('stock')} 
                       className="px-4 py-3.5 cursor-pointer select-none transition-colors hover:text-slate-900 group"
                       title="Sort by Stock Quantity"
                     >
                        <div className="flex items-center gap-1.5">
                           <span className={sortField === 'stock' ? 'text-slate-900 font-black' : ''}>Stock In Hand</span>
                           <span className={`transition-all ${sortField === 'stock' ? 'text-lime-600 opacity-100' : 'text-slate-300 opacity-0 group-hover:opacity-100'}`}>
                              {sortField === 'stock' ? (
                                 sortOrder === 'asc' ? <ArrowUp size={13} strokeWidth={2.5} /> : <ArrowDown size={13} strokeWidth={2.5} />
                              ) : (
                                 <ArrowUpDown size={12} />
                              )}
                           </span>
                        </div>
                     </th>

                     <th 
                       onClick={() => handleSort('cost_price')} 
                       className="px-4 py-3.5 text-right cursor-pointer select-none transition-colors hover:text-slate-900 group"
                       title="Sort by Cost Price"
                     >
                        <div className="flex items-center justify-end gap-1.5">
                           <span className={sortField === 'cost_price' ? 'text-slate-900 font-black' : ''}>Cost Price</span>
                           <span className={`transition-all ${sortField === 'cost_price' ? 'text-lime-600 opacity-100' : 'text-slate-300 opacity-0 group-hover:opacity-100'}`}>
                              {sortField === 'cost_price' ? (
                                 sortOrder === 'asc' ? <ArrowUp size={13} strokeWidth={2.5} /> : <ArrowDown size={13} strokeWidth={2.5} />
                              ) : (
                                 <ArrowUpDown size={12} />
                              )}
                           </span>
                        </div>
                     </th>

                     <th 
                       onClick={() => handleSort('selling_price')} 
                       className="px-4 py-3.5 text-right cursor-pointer select-none transition-colors hover:text-slate-900 group"
                       title="Sort by Selling Price"
                     >
                        <div className="flex items-center justify-end gap-1.5">
                           <span className={sortField === 'selling_price' ? 'text-slate-900 font-black' : ''}>Selling Rate</span>
                           <span className={`transition-all ${sortField === 'selling_price' ? 'text-lime-600 opacity-100' : 'text-slate-300 opacity-0 group-hover:opacity-100'}`}>
                              {sortField === 'selling_price' ? (
                                 sortOrder === 'asc' ? <ArrowUp size={13} strokeWidth={2.5} /> : <ArrowDown size={13} strokeWidth={2.5} />
                              ) : (
                                 <ArrowUpDown size={12} />
                              )}
                           </span>
                        </div>
                     </th>

                     <th className="px-5 py-3.5 text-center w-28">Status / Action</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredItems.length === 0 ? (
                     <tr>
                        <td colSpan={6} className="py-16 text-center">
                           <div className="flex flex-col items-center justify-center text-slate-400">
                              <Boxes size={40} className="text-slate-300 mb-2" />
                              <p className="font-bold text-sm text-slate-700">No items found</p>
                              <p className="text-xs text-slate-400 mt-0.5">Try adjusting your filters or search keywords</p>
                           </div>
                        </td>
                     </tr>
                  ) : (
                     filteredItems.map((item, index) => {
                        const stock = getItemStock(item);
                        const isLowStock = stock <= (item.reorder_level || 5) && stock > 0;
                        const isOutOfStock = stock <= 0;
                        const hasVariants = item.variants && item.variants.length > 0;
                        const margin = item.selling_price > item.cost_price ? item.selling_price - item.cost_price : 0;
                        const marginPct = item.cost_price > 0 ? ((margin / item.cost_price) * 100).toFixed(0) : '0';

                        const isSource = draggedItemId === item.id;
                        const isTarget = dragOverItemId === item.id;
                        const dropBorderClass = isTarget 
                          ? (dragPosition === 'above' 
                              ? 'border-t-2 !border-t-lime-500 bg-lime-50/30 dark:bg-lime-950/40' 
                              : 'border-b-2 !border-b-lime-500 bg-lime-50/30 dark:bg-lime-950/40') 
                          : '';

                        return (
                          <tr 
                            key={item.id} 
                            draggable
                            onDragStart={(e) => handleDragStart(e, item.id)}
                            onDragOver={(e) => handleDragOver(e, item.id)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, item.id)}
                            onDragEnd={handleDragEnd}
                            onClick={() => handleOpenView(item)}
                            className={`group transition-all hover:bg-lime-50/40 cursor-pointer ${dropBorderClass} ${isSource ? 'opacity-40 bg-slate-100 dark:bg-slate-800' : ''}`}
                          >
                             <td className="px-2 py-3 text-center">
                                <div className="flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                                   <div 
                                     draggable
                                     onDragStart={(e) => handleDragStart(e, item.id)}
                                     className="p-1 text-slate-300 hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-300 cursor-grab active:cursor-grabbing hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
                                     title="Drag up or down to reorder"
                                   >
                                     <GripVertical size={14} />
                                   </div>

                                   {item.item_type?.includes('Sale product') ? (
                                      <span className="pos-sort-badge min-w-7" title={`POS Display Order: ${item.sort_order ?? 999}`}>
                                         #{item.sort_order ?? 999}
                                      </span>
                                   ) : (
                                      <span className="text-slate-400 dark:text-slate-600 text-xs font-mono min-w-7">—</span>
                                   )}

                                   <div className="flex flex-col -my-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button aria-label="Move up"
                                        type="button"
                                        onClick={() => handleMoveStep(item.id, 'up')}
                                        disabled={index === 0}
                                        className="p-0.5 text-slate-400 hover:text-lime-600 dark:hover:text-lime-400 disabled:opacity-0 cursor-pointer transition-colors"
                                        title="Move up"
                                      >
                                        <ArrowUp size={11} strokeWidth={3} />
                                      </button>
                                      <button aria-label="Move down"
                                        type="button"
                                        onClick={() => handleMoveStep(item.id, 'down')}
                                        disabled={index === filteredItems.length - 1}
                                        className="p-0.5 text-slate-400 hover:text-lime-600 dark:hover:text-lime-400 disabled:opacity-0 cursor-pointer transition-colors"
                                        title="Move down"
                                      >
                                        <ArrowDown size={11} strokeWidth={3} />
                                      </button>
                                   </div>
                                </div>
                             </td>

                             <td className="px-5 py-3.5">
                                <div className="flex items-center gap-3">
                                   <div className="w-9 h-9 rounded-xl bg-slate-100 group-hover:bg-lime-100 flex items-center justify-center text-slate-600 group-hover:text-lime-700 transition-colors font-bold text-sm shrink-0 overflow-hidden border border-slate-200/50">
                                      {item.image_url ? (
                                         <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                                      ) : (
                                         item.name.charAt(0)
                                      )}
                                   </div>
                                   <div>
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                         <span className={`font-bold text-sm ${item.isActive ? 'text-slate-900' : 'text-slate-400 line-through'}`}>
                                            {item.name}
                                         </span>
                                         {item.isSystem && (
                                            <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold border border-slate-200">
                                               System
                                            </span>
                                         )}
                                         {hasVariants && (
                                            <span className="text-[9px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded-md border border-indigo-100 font-bold flex items-center gap-0.5">
                                               <Boxes size={10}/> {item.variants!.length} Units
                                            </span>
                                         )}
                                      </div>
                                      <div className="flex items-center gap-1.5 mt-0.5">
                                         {item.category.length > 0 && (
                                            <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                                               {item.category.join(', ')}
                                            </span>
                                         )}
                                         <span className="text-[10px] font-semibold text-slate-400">
                                            • {item.unit}
                                         </span>
                                         <span className="text-[10px] text-slate-400">
                                            ({item.source || 'Both'})
                                         </span>
                                      </div>
                                   </div>
                                </div>
                             </td>

                             <td className="px-4 py-3.5">
                                <div className="flex items-center gap-2">
                                   <div className={`w-2 h-2 rounded-full ${
                                      isOutOfStock ? 'bg-rose-500' : isLowStock ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'
                                   }`} />
                                   <span className="font-bold text-sm text-slate-800 font-mono">
                                      {formatQty(stock)} <span className="text-xs text-slate-400 font-sans">{item.unit}</span>
                                   </span>
                                   {isOutOfStock ? (
                                      <span className="text-[9px] font-bold bg-rose-50 text-rose-600 px-1.5 py-0.5 rounded border border-rose-200">Out</span>
                                   ) : isLowStock ? (
                                      <span className="text-[9px] font-bold bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded border border-amber-200">Low</span>
                                   ) : null}
                                </div>
                             </td>

                             <td className="px-4 py-3.5 text-right font-mono text-xs text-slate-600 font-bold">
                                {formatCurrency(item.cost_price)}
                             </td>

                             <td className="px-4 py-3.5 text-right">
                                {item.item_type.includes('Sale product') ? (
                                   <div>
                                      <span className="text-sm font-black text-slate-900 font-mono">
                                         {formatCurrency(item.selling_price)}
                                      </span>
                                      {margin > 0 && (
                                         <span className="ml-1.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/60 font-mono">
                                            +{marginPct}%
                                         </span>
                                      )}
                                   </div>
                                ) : (
                                   <span className="text-slate-400 text-xs font-normal">—</span>
                                )}
                             </td>

                             <td className="px-5 py-3.5 text-center">
                                <div className="flex items-center justify-center gap-1.5" onClick={e => e.stopPropagation()}>
                                   <button aria-label="Edit Product" 
                                     onClick={() => handleOpenEdit(item)}
                                     className="p-1.5 text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                     title="Edit Product"
                                   >
                                      <Edit size={16} />
                                   </button>
                                   {!item.isSystem ? (
                                      <button aria-label="Delete Product" 
                                         onClick={() => handleDeleteClick(item)}
                                         className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                                         title="Delete Product"
                                      >
                                         <Trash2 size={16} />
                                      </button>
                                   ) : (
                                      <button aria-label={item.isActive ? "System Protected (Click to Deactivate / Archive)" : "System Protected (Inactive)"} 
                                         onClick={() => handleDeleteClick(item)}
                                         className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                                         title={item.isActive ? "System Protected (Click to Deactivate / Archive)" : "System Protected (Inactive)"}
                                      >
                                         <ShieldAlert size={16} />
                                      </button>
                                   )}
                                </div>
                             </td>
                          </tr>
                        );
                     })
                  )}
               </tbody>
            </table>
         </div>
      </div>

      <AnimatePresence>
        {isDrawerOpen && drawerMode === 'view' && selectedItem && (() => {
          const liveItem = items.find(i => i.id === selectedItem.id) || selectedItem;
          const liveInv = inventory?.find(i => i.item_id === liveItem.id);
          const sellInPos = (entry?: SellInPosEntry) => {
            const sp = new URLSearchParams({ quick: liveItem.id });
            if (entry) {
              sp.set('quickMode', entry.mode);
              sp.set('quickValue', entry.value);
              if (entry.variantId) sp.set('quickVariant', entry.variantId);
            }
            handleCloseDrawer();
            openTab(`/pos?${sp.toString()}`);
          };
          return (
            <div className="fixed inset-0 z-[100] flex overflow-hidden">
              <MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={handleCloseDrawer} />
              <MotionDiv
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 220 }}
                className="relative ml-auto w-full max-w-xl bg-white dark:bg-slate-900 shadow-2xl flex flex-col h-full z-10 border-l border-slate-200 dark:border-slate-800"
              >
                <ItemDetailView
                  item={liveItem}
                  stock={Number(liveInv?.quantity ?? (liveItem as any).stock ?? 0)}
                  variantStocks={(liveInv?.variant_stocks || liveItem.variant_stocks || {}) as Record<string, number>}
                  allowNegativeStock={Boolean(settings?.inventory?.allowNegativeStock)}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  canOpenPos={canOpenPos}
                  materialName={id => items.find(i => i.id === id)?.name}
                  onClose={handleCloseDrawer}
                  onEdit={() => handleOpenEdit(liveItem)}
                  onDelete={() => handleDeleteClick(liveItem)}
                  onReactivate={() => reactivateEntity('item', liveItem.id)}
                  onDeactivate={() => handleDeleteClick(liveItem)}
                  onSellInPos={sellInPos}
                />
              </MotionDiv>
            </div>
          );
        })()}
        {isDrawerOpen && drawerMode !== 'view' && (
          <div className="fixed inset-0 z-[100] flex overflow-hidden">
            <MotionDiv 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" 
              onClick={handleCloseDrawer} 
            />

            <MotionDiv 
              initial={{ x: '100%' }} 
              animate={{ x: 0 }} 
              exit={{ x: '100%' }} 
              transition={{ type: 'spring', damping: 25, stiffness: 220 }} 
              className="relative ml-auto w-full max-w-xl bg-white dark:bg-slate-900 shadow-2xl flex flex-col h-full z-10 border-l border-slate-200 dark:border-slate-800"
            >
              <div className="flex flex-col h-full bg-white dark:bg-slate-900">
                <div className="px-4 py-4 sm:px-6 sm:py-5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
                   <div className="flex justify-between items-center mb-3 sm:mb-4">
                      <div className="flex items-center gap-2.5 sm:gap-3">
                          {formData.isSystem && <div className="h-9 w-9 sm:h-10 sm:w-10 bg-lime-100 dark:bg-lime-950/60 text-lime-700 dark:text-lime-400 rounded-xl flex items-center justify-center shrink-0"><Lock size={18}/></div>}
                          <div>
                             <h3 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white leading-tight">
                               {drawerMode === 'edit' ? 'Edit Product Master' : 'New Product Master'}
                             </h3>
                             <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium hidden sm:block">Configure basic parameters, prices, recipes & pack options</p>
                          </div>
                      </div>
                      
                      <div className="flex items-center gap-1.5">
                        {drawerMode === 'edit' && selectedItem && canDelete && !formData.isSystem && (
                          <button aria-label="Delete Product" 
                            type="button" 
                            onClick={() => handleDeleteClick(selectedItem)}
                            className="p-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl transition-all cursor-pointer"
                            title="Delete Product"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                        <button aria-label="Close" onClick={handleCloseDrawer} className="p-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-xl transition-all cursor-pointer" title="Close"><X size={18} /></button>
                      </div>
                   </div>
                     
                     <div className="flex gap-1.5 sm:gap-2 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
                        <button 
                          type="button" 
                          onClick={() => setActiveFormTab('details')} 
                          className={`px-3.5 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-semibold rounded-xl transition-all whitespace-nowrap cursor-pointer ${activeFormTab === 'details' ? 'bg-lime-600 dark:bg-lime-500 text-white dark:text-slate-950 font-bold shadow-xs' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                        >
                          Basic Info
                        </button>
                        {(formData.source === 'Production' || formData.source === 'Both') && (
                            <button 
                              type="button" 
                              onClick={() => setActiveFormTab('recipe')} 
                              className={`px-3.5 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${activeFormTab === 'recipe' ? 'bg-amber-500 text-white shadow-sm' : 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 hover:text-amber-600 dark:hover:text-amber-400'}`}
                            >
                              <ChefHat size={14}/> Recipe
                            </button>
                        )}
                        <button 
                          type="button" 
                          onClick={() => setActiveFormTab('variants')} 
                          className={`px-3.5 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-bold rounded-xl transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${activeFormTab === 'variants' ? 'bg-indigo-500 text-white shadow-sm' : 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:text-indigo-600 dark:hover:text-indigo-400'}`}
                        >
                          <Boxes size={14}/> Units & Packaging
                        </button>
                     </div>
                  </div>

                  <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex flex-col justify-between">
                     <div className="space-y-6">
                     {activeFormTab === 'details' && (
                        <div className="space-y-5 animate-in fade-in">
                           {formData.isSystem && (
                              <div className="bg-lime-50/70 border border-lime-100 rounded-2xl p-3.5 sm:p-4 flex items-start gap-3 shadow-sm animate-in slide-in-from-top-4 duration-300">
                                 <Lock className="text-lime-600 shrink-0 mt-0.5" size={16} />
                                 <div>
                                    <h5 className="text-xs font-bold text-lime-800">System Protected Milk Variety</h5>
                                    <p className="text-[10px] text-lime-600 mt-0.5 font-medium leading-relaxed">
                                       Core milk variety cannot be deleted to preserve accounting integrity. However, you can freely toggle its <strong>Active Status</strong> (to disable selling & purchasing), cost price, and selling price below.
                                    </p>
                                 </div>
                              </div>
                           )}

                           <div className="bg-slate-50/90 rounded-2xl p-4 border border-slate-200/90 space-y-3">
                              <div className="flex items-center justify-between">
                                 <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded-lg bg-lime-100 text-lime-700 flex items-center justify-center">
                                       <ImageIcon size={14} />
                                    </div>
                                    <div>
                                       <h5 className="text-xs font-bold text-slate-800">Product Photo</h5>
                                       <p className="text-[10px] text-slate-400 font-medium">Automatic resolution optimizer ensures instant loading</p>
                                    </div>
                                 </div>
                                 <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    <Zap size={10} /> Auto-Compress
                                 </span>
                              </div>

                              <input 
                                 type="file"
                                 ref={fileInputRef}
                                 accept="image/*"
                                 onChange={handleImageFileChange}
                                 className="hidden"
                              />

                              {formData.image_url ? (
                                 <div className="flex flex-col sm:flex-row items-center gap-3.5 bg-white rounded-xl p-3 border border-slate-200 shadow-2xs">
                                    <div className="relative w-20 h-20 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
                                       <img 
                                          src={formData.image_url} 
                                          alt={formData.name || 'Product preview'} 
                                          className="w-full h-full object-cover"
                                       />
                                    </div>
                                    <div className="flex-1 min-w-0 space-y-1.5 text-center sm:text-left">
                                       {imageOptimizationInfo ? (
                                          <div className="space-y-0.5">
                                             <div className="flex items-center justify-center sm:justify-start gap-1 text-xs font-bold text-emerald-600">
                                                <Sparkles size={12} />
                                                <span>Optimized to {imageOptimizationInfo.optimizedSizeFormatted}</span>
                                             </div>
                                             <p className="text-[10px] text-slate-500 font-medium">
                                                Reduced by <strong className="text-slate-700">{imageOptimizationInfo.savedPercentage}%</strong> ({imageOptimizationInfo.originalSizeFormatted} ➔ {imageOptimizationInfo.optimizedSizeFormatted}, {imageOptimizationInfo.width}×{imageOptimizationInfo.height}px)
                                             </p>
                                          </div>
                                       ) : (
                                          <div>
                                             <p className="text-xs font-bold text-slate-700">Photo Attached</p>
                                             <p className="text-[10px] text-slate-400">Ready for catalog and POS display</p>
                                          </div>
                                       )}
                                       <div className="flex items-center justify-center sm:justify-start gap-2 pt-0.5">
                                          <button
                                             type="button"
                                             disabled={isOptimizingImage}
                                             onClick={() => fileInputRef.current?.click()}
                                             className="px-2.5 py-1 text-xs font-semibold text-lime-700 bg-lime-50 hover:bg-lime-100 rounded-lg border border-lime-200 transition-colors flex items-center gap-1 cursor-pointer"
                                          >
                                             <Upload size={11} /> Change
                                          </button>
                                          <button
                                             type="button"
                                             disabled={isOptimizingImage}
                                             onClick={handleRemoveImage}
                                             className="px-2.5 py-1 text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg border border-rose-200 transition-colors flex items-center gap-1 cursor-pointer"
                                          >
                                             <Trash2 size={11} /> Remove
                                          </button>
                                       </div>
                                    </div>
                                 </div>
                              ) : (
                                 <div 
                                    onClick={() => !isOptimizingImage && fileInputRef.current?.click()}
                                    className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
                                       isOptimizingImage 
                                          ? 'border-lime-400 bg-lime-50/50 cursor-wait' 
                                          : 'border-slate-300 hover:border-lime-500 hover:bg-lime-50/20 bg-white'
                                    }`}
                                 >
                                    {isOptimizingImage ? (
                                       <div className="flex flex-col items-center justify-center gap-1.5 py-2">
                                          <Loader2 size={20} className="animate-spin text-lime-600" />
                                          <p className="text-xs font-bold text-slate-700">Compressing & optimizing image resolution...</p>
                                          <p className="text-[10px] text-slate-400">Reducing file size for lightning fast loading</p>
                                       </div>
                                    ) : (
                                       <div className="flex flex-col items-center justify-center gap-1">
                                          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 mb-0.5">
                                             <Upload size={14} />
                                          </div>
                                          <p className="text-xs font-bold text-slate-700">
                                             Click or drag to add product photo
                                          </p>
                                          <p className="text-[10px] text-slate-400 max-w-xs">
                                             High-res photos from your mobile camera or DSLR will automatically be downscaled to lightweight assets (~30-50KB).
                                          </p>
                                       </div>
                                    )}
                                 </div>
                              )}
                           </div>

                           <div>
                              <label className={labelClass}>Product Display Name *</label>
                              <div className="relative">
                                 <input 
                                    type="text" 
                                    required 
                                    disabled={formData.isSystem}
                                    className={`${inputClass} disabled:bg-slate-50 disabled:text-slate-500 disabled:border-slate-200 disabled:shadow-none`} 
                                    placeholder="e.g. Fresh Cream" 
                                    value={formData.name} 
                                    onChange={e => setFormData({...formData, name: e.target.value})}
                                 />
                              </div>
                              <p className="text-[10px] text-slate-400 mt-1">This name will appear in Inventory, POS, and Billing.</p>
                           </div>

                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <MultiSelect 
                                 label="Item Categories" 
                                 options={categories} 
                                 selected={formData.category || []} 
                                 onToggle={toggleCategory} 
                                 placeholder="Select groups..." 
                                 disabled={formData.isSystem}
                              />
                              <MultiSelect 
                                 label="Item Usage Class *" 
                                 options={[...ITEM_TYPES]} 
                                 selected={formData.item_type || []} 
                                 onToggle={toggleType} 
                                 placeholder="Select types..." 
                                 disabled={formData.isSystem}
                              />
                           </div>
                           
                           <div className="pt-4 border-t border-slate-100">
                              <UnitSelector
                                 value={formData.unit || ''}
                                 disabled={formData.isSystem || unitLocked}
                                 labelClass={labelClass}
                                 onChange={(symbol, groupId) => {
                                    setFormData(prev => ({
                                       ...prev,
                                       unit: symbol,
                                       unit_group_id: groupId
                                    }));
                                 }}
                                 onOpenManager={() => !formData.isSystem && setIsUnitManagerOpen(true)}
                              />
                              {unitLocked && (
                                 <p className="mt-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">Locked while stock exists.</p>
                              )}
                                                         </div>

                           <div className="grid grid-cols-1 gap-4 pt-4 border-t border-slate-100">
                              <div>
                                 <label className={labelClass}>Production & Supply Source</label>
                                 <div className="grid grid-cols-3 gap-2 bg-slate-50 p-1.5 rounded-2xl border border-slate-200">
                                    {[ 
                                       { id: 'Supplier', label: 'Vendor', icon: Truck }, 
                                       { id: 'Production', label: 'In-House', icon: Factory }, 
                                       { id: 'Both', label: 'Hybrid', icon: Briefcase } 
                                    ].map(src => (
                                       <button 
                                          key={src.id} 
                                          type="button" 
                                          disabled={formData.isSystem}
                                          onClick={() => !formData.isSystem && setFormData({...formData, source: src.id as any})} 
                                          className={`py-2 sm:py-2.5 rounded-xl transition-all flex flex-col items-center justify-center gap-1 ${
                                             formData.source === src.id 
                                                ? 'bg-white text-lime-700 shadow-md ring-1 ring-black/5 font-bold' 
                                                : 'text-slate-400 hover:text-slate-600'
                                          } ${formData.isSystem ? 'disabled:opacity-50 disabled:cursor-not-allowed' : ''}`}
                                       >
                                          <src.icon size={16}/>
                                          <span className="text-[10px] font-bold uppercase">{src.label}</span>
                                       </button>
                                    ))}
                                 </div>
                              </div>
                           </div>
                           
                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-5 border-t border-slate-100">
                              <div>
                                 <label className={labelClass}>Master Landed Cost (Rs)</label>
                                 <div className="relative">
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">Rs</span>
                                    <input 
                                       type="number" 
                                       step="any" 
                                       className={`${inputClass} pl-10 font-mono font-bold`} 
                                       value={formData.cost_price} 
                                       onChange={e => setFormData({...formData, cost_price: parseFloat(e.target.value) || 0})}
                                    />
                                 </div>
                              </div>
                              <div>
                                 <label className={labelClass}>Default Sales Rate (Rs)</label>
                                 <div className="relative">
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">Rs</span>
                                    <input 
                                       type="number" 
                                       step="any" 
                                       className={`${inputClass} pl-10 font-bold font-mono text-lime-700`} 
                                       value={formData.selling_price} 
                                       onChange={e => setFormData({...formData, selling_price: parseFloat(e.target.value) || 0})}
                                    />
                                 </div>
                              </div>
                           </div>


                           {formData.item_type?.includes('Sale product') && (
                              <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                                 <div className="flex items-center justify-between">
                                    <div>
                                       <label className={labelClass}>POS Screen Grid Order (Sort Number)</label>
                                       <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                                          POS screen per yeh product kis number per pehle show hogi (1 = Sabse pehle, 2 = Uske baad...)
                                       </p>
                                    </div>
                                    <span className="pos-sort-badge text-xs px-2.5 py-1">
                                       Position #{formData.sort_order ?? 999}
                                    </span>
                                 </div>

                                 <div className="flex items-center gap-3 flex-wrap">
                                    <div className="relative w-28">
                                       <input 
                                          type="number" 
                                          min="1"
                                          max="999"
                                          className={`${inputClass} font-mono font-black text-slate-900 dark:text-slate-100 text-center text-sm`} 
                                          placeholder="1" 
                                          value={formData.sort_order ?? ''} 
                                          onChange={e => {
                                             const val = parseInt(e.target.value, 10);
                                             setFormData({...formData, sort_order: isNaN(val) ? undefined : val});
                                          }}
                                       />
                                    </div>

                                    <div className="flex items-center gap-1.5 flex-wrap">
                                       <span className="text-[10px] font-bold text-slate-400 uppercase mr-0.5">Quick Set:</span>
                                       {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => (
                                          <button
                                             key={num}
                                             type="button"
                                             onClick={() => setFormData({ ...formData, sort_order: num })}
                                             className={`w-7 h-7 rounded-lg text-xs font-mono font-bold border transition-all cursor-pointer ${
                                                formData.sort_order === num
                                                   ? 'bg-lime-600 text-white border-lime-600 shadow-2xs scale-105'
                                                   : 'bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 active:scale-95'
                                             }`}
                                          >
                                             {num}
                                          </button>
                                       ))}
                                    </div>
                                 </div>
                              </div>
                           )}

                            {formData.item_type?.includes('Sale product') && (
                               <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3.5">
                                  <div className="space-y-2">
                                     <div className="flex items-center justify-between">
                                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                           <Zap size={14} className="text-amber-500" /> POS Primary Action Priority
                                        </label>
                                        <span className="text-[10px] font-semibold text-slate-400">Default Section in Modal</span>
                                     </div>

                                     <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <button
                                           type="button"
                                           onClick={() => setFormData({ ...formData, pos_primary_mode: 'amount' })}
                                           className={`p-3 rounded-2xl border text-left flex items-start gap-2.5 transition-all cursor-pointer ${
                                              (formData.pos_primary_mode || 'amount') === 'amount'
                                                 ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500 text-emerald-900 dark:text-emerald-200 ring-2 ring-emerald-500/20 shadow-sm'
                                                 : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50'
                                           }`}
                                        >
                                           <div className={`p-1.5 rounded-xl shrink-0 ${
                                              (formData.pos_primary_mode || 'amount') === 'amount' ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'
                                           }`}>
                                              <Zap size={16} />
                                           </div>
                                           <div>
                                              <div className="text-xs font-black flex items-center gap-1">
                                                 Rupee Cash First
                                                 <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-200 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-300 font-bold uppercase">
                                                    Hero
                                                 </span>
                                              </div>
                                              <div className="text-[11px] opacity-80 mt-0.5">
                                                 Direct cash buttons appear at the very top of POS modal (Best for Loose Milk / Dahi)
                                              </div>
                                           </div>
                                        </button>

                                        <button
                                           type="button"
                                           onClick={() => setFormData({ ...formData, pos_primary_mode: 'qty' })}
                                           className={`p-3 rounded-2xl border text-left flex items-start gap-2.5 transition-all cursor-pointer ${
                                              formData.pos_primary_mode === 'qty'
                                                 ? 'bg-lime-50 dark:bg-lime-950/40 border-lime-500 text-lime-900 dark:text-lime-200 ring-2 ring-lime-500/20 shadow-sm'
                                                 : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50'
                                           }`}
                                        >
                                           <div className={`p-1.5 rounded-xl shrink-0 ${
                                              formData.pos_primary_mode === 'qty' ? 'bg-lime-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'
                                           }`}>
                                              <Scale size={16} />
                                           </div>
                                           <div>
                                              <div className="text-xs font-black flex items-center gap-1">
                                                 Quantity / Volume First
                                              </div>
                                              <div className="text-[11px] opacity-80 mt-0.5">
                                                 Quantity stepper & volume chips appear at the top
                                              </div>
                                           </div>
                                        </button>
                                     </div>
                                  </div>

                                  <div className="space-y-2">
                                     <div className="flex items-center justify-between">
                                        <label className={labelClass}>POS Quick Cash Buttons (Rupees)</label>
                                        <span className="text-[11px] font-semibold text-slate-400">Comma-separated</span>
                                     </div>
                                     
                                     <div className="relative">
                                        <input 
                                           type="text" 
                                           className={`${inputClass} font-mono`} 
                                           placeholder="e.g. 50, 100, 150, 200, 250, 300" 
                                           value={quickAmountsRaw} 
                                           onChange={e => setQuickAmountsRaw(e.target.value)}
                                        />
                                     </div>

                                     <div className="space-y-1.5 pt-1">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                           <span className="text-[10px] font-bold text-slate-400 uppercase mr-1">Presets:</span>
                                           <button
                                              type="button"
                                              onClick={() => setQuickAmountsRaw('50, 100, 150, 200, 250, 300')}
                                              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 transition-all cursor-pointer"
                                           >
                                              Standard Dairy (50-300)
                                           </button>
                                           <button
                                              type="button"
                                              onClick={() => setQuickAmountsRaw('20, 30, 50, 70, 100')}
                                              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 transition-all cursor-pointer"
                                           >
                                              Small Cash (20-100)
                                           </button>
                                           {quickAmountsRaw && (
                                              <button
                                                 type="button"
                                                 onClick={() => setQuickAmountsRaw('')}
                                                 className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-lg text-xs font-bold border border-rose-200 dark:border-rose-900 transition-all ml-auto cursor-pointer"
                                              >
                                                 Clear
                                              </button>
                                           )}
                                        </div>

                                        <div className="flex items-center gap-1.5 flex-wrap">
                                           <span className="text-[10px] font-bold text-slate-400 uppercase mr-1">Quick Add:</span>
                                           {[20, 30, 50, 70, 100, 150, 200, 250, 300, 500].map(amt => (
                                              <button
                                                 key={amt}
                                                 type="button"
                                                 onClick={() => {
                                                    const currentArr = quickAmountsRaw
                                                       .split(',')
                                                       .map(s => s.trim())
                                                       .filter(Boolean);
                                                    if (!currentArr.includes(amt.toString())) {
                                                       const next = [...currentArr, amt.toString()].join(', ');
                                                       setQuickAmountsRaw(next);
                                                    }
                                                 }}
                                                 className="px-2 py-1 bg-slate-100 hover:bg-lime-100 hover:text-lime-800 hover:border-lime-300 dark:bg-slate-800 dark:hover:bg-lime-950/40 dark:hover:text-lime-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-mono font-bold border border-slate-200 transition-all active:scale-95 cursor-pointer"
                                              >
                                                 +{amt}
                                              </button>
                                           ))}
                                        </div>
                                     </div>
                                  </div>
                               </div>
                            )}
                           
                           <div className="flex items-center gap-5 pt-4 flex-wrap">
                               <button 
                                  type="button" 
                                  onClick={() => setFormData({...formData, isActive: !formData.isActive})} 
                                  className={`flex items-center gap-2.5 text-sm font-bold transition-colors cursor-pointer ${formData.isActive ? 'text-emerald-600' : 'text-slate-400'}`}
                               >
                                  {formData.isActive ? <CheckSquare size={20} className="fill-emerald-50 text-emerald-600"/> : <Square size={20}/>}
                                  <span>Active Status {!formData.isActive ? '(Inactive / Disabled)' : ''}</span>
                               </button>

                               {formData.item_type?.includes('Sale product') && (
                                  <button 
                                     type="button" 
                                     onClick={() => setFormData({...formData, allow_loose_sale: formData.allow_loose_sale === false ? true : false})} 
                                     className={`flex items-center gap-2.5 text-sm font-bold transition-colors ${formData.allow_loose_sale !== false ? 'text-blue-600' : 'text-slate-400'}`}
                                  >
                                     {formData.allow_loose_sale !== false ? <CheckSquare size={20} className="fill-blue-50 text-blue-600"/> : <Square size={20}/>}
                                     Allow Loose Sale
                                  </button>
                               )}
                           </div>
                        </div>
                     )}

                     {activeFormTab === 'recipe' && (
                       <div className="space-y-6 animate-in fade-in">
                          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200">
                             <div className="flex items-center gap-2 mb-4 border-b border-slate-200 pb-2"><FlaskConical className="text-lime-600" size={18}/><h4 className="font-bold text-slate-700 text-sm">Standard Batch Configuration</h4></div>
                             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                   <label className={labelClass}>Standard Input Quantity</label>
                                   <div className="relative">
                                      <input type="number" className="w-full bg-white border border-slate-300 rounded-xl pl-3 pr-12 py-2.5 text-sm font-bold text-slate-900 outline-none focus:ring-2 focus:ring-lime-500 transition-all shadow-sm" placeholder="e.g. 40" value={formData.recipe_base_quantity || ''} onChange={e => setFormData({...formData, recipe_base_quantity: parseFloat(e.target.value)})}/>
                                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-lg border border-slate-200">{formData.recipe_base_item_id && formData.recipe_base_item_id !== 'MILK_BASE' ? (items.find(i => i.id === formData.recipe_base_item_id)?.unit || 'units') : 'L'}</span>
                                    </div>
                                </div>
                                <div>
                                   <label className={labelClass}>Expected Output (Yield)</label>
                                   <div className="relative">
                                      <input type="number" className="w-full bg-white border border-slate-300 rounded-xl pl-3 pr-12 py-2.5 text-sm font-bold text-slate-900 outline-none focus:ring-2 focus:ring-lime-500 transition-all shadow-sm" placeholder="e.g. 8.5" value={formData.recipe_expected_output || ''} onChange={e => setFormData({...formData, recipe_expected_output: parseFloat(e.target.value)})}/>
                                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-lg border border-slate-200">{formData.unit || 'Kg'}</span>
                                    </div>
                                </div>
                             </div>
                          </div>
                          <div>
                             <label className={labelClass}>Additives & Ingredients</label>
                             <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 space-y-3">
                                <div className="flex flex-col sm:flex-row gap-2">
                                   <div className="flex-1">
                                      <select className={inputClass} value={newIngredient.itemId} onChange={e => setNewIngredient({...newIngredient, itemId: e.target.value})}>
                                         <option value="">Select Raw Material...</option>
                                         {rawMaterials.map(m => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
                                      </select>
                                   </div>
                                   <div className="flex gap-2">
                                      <input type="number" className={`${inputClass} w-28`} placeholder="Qty" value={newIngredient.qty} onChange={e => setNewIngredient({...newIngredient, qty: e.target.value})}/>
                                      <button aria-label="Naya add karein" type="button" onClick={addIngredient} className="bg-slate-800 text-white px-4 rounded-xl font-bold hover:bg-slate-700 transition-all flex items-center justify-center cursor-pointer"><Plus size={18}/></button>
                                   </div>
                                </div>
                                {formData.recipe && formData.recipe.length > 0 && (
                                   <div className="space-y-2 mt-2">
                                      {formData.recipe.map((ing, idx) => (
                                         <div key={idx} className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-200 shadow-sm">
                                            <div className="flex items-center gap-3">
                                               <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center font-bold text-xs">{idx + 1}</div>
                                               <div>
                                                  <p className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-200">{items.find(i => i.id === ing.item_id)?.name || ing.item_name}</p>
                                                  <p className="text-[10px] text-slate-400 font-medium">Type: {ing.type}</p>
                                               </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                               <span className="font-mono font-bold text-slate-600 text-xs sm:text-sm">{ing.quantity} {ing.unit}</span>
                                               <button aria-label="Band karein" type="button" onClick={() => removeIngredient(idx)} className="text-slate-300 hover:text-red-500 transition-colors p-1 cursor-pointer"><X size={16}/></button>
                                            </div>
                                         </div>
                                      ))}
                                   </div>
                                )}
                             </div>
                          </div>
                       </div>
                     )}

                     {activeFormTab === 'variants' && (() => {
                       const liveInv = selectedItem ? inventory?.find(i => i.item_id === selectedItem.id) : undefined;
                       return (
                         <SellUnitsTab
                           baseUnit={formData.unit || 'unit'}
                           looseRate={Number(formData.selling_price) || 0}
                           costRate={Number(formData.cost_price) || 0}
                           allowLoose={formData.allow_loose_sale !== false}
                           onToggleLoose={() => setFormData({ ...formData, allow_loose_sale: formData.allow_loose_sale === false })}
                           variants={formData.variants || []}
                           liveLoose={selectedItem ? Number(liveInv?.quantity ?? (selectedItem as any).stock ?? 0) : null}
                           liveVariantStocks={(liveInv?.variant_stocks || selectedItem?.variant_stocks || {}) as Record<string, number>}
                           packagingMaterials={packagingMaterials}
                           draft={newVariant}
                           setDraft={setNewVariant}
                           kind={variantSubTab}
                           onKindChange={next => { setVariantSubTab(next); setNewVariant({ ...newVariant, fromBase: next === 'multi_unit' }); }}
                           editingIndex={editingVariantIndex}
                           onSubmit={handleVariantSubmit}
                           onEdit={editVariant}
                           onRemove={removeVariant}
                           onToggleActive={toggleVariantActive}
                           onCancelEdit={resetVariantForm}
                           inputClass={inputClass}
                         />
                       );
                     })()}
                     </div>

                     <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 sticky bottom-0 bg-white dark:bg-slate-900 z-10">
                        <button 
                           type="button" 
                           onClick={handleCloseDrawer} 
                           className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs sm:text-sm font-bold transition-all cursor-pointer"
                        >
                           Cancel
                        </button>
                        <button 
                           type="submit" 
                           disabled={isSubmitting}
                           className={`flex-[2] sm:flex-none px-6 sm:px-8 py-2.5 sm:py-3 rounded-xl font-bold text-xs sm:text-sm shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer ${
                             isSubmitting ? 'bg-slate-400 text-white cursor-not-allowed shadow-none' : 'bg-lime-600 hover:bg-lime-700 text-white shadow-lime-600/20 active:scale-95'
                           }`}
                        >
                           {isSubmitting ? (
                             <>
                               <Loader2 size={16} className="animate-spin" /> Saving...
                             </>
                           ) : (
                             <>
                               <Save size={16} /> 
                               <span>Save Master Record</span>
                             </>
                           )}
                        </button>
                     </div>
                  </form>
                </div>
            </MotionDiv>
          </div>
        )}
      </AnimatePresence>

      {deleteAudit.isOpen && deleteAudit.item && (
         <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setDeleteAudit({...deleteAudit, isOpen: false})} />
            <MotionDiv 
               initial={{ scale: 0.95, opacity: 0, y: 10 }} 
               animate={{ scale: 1, opacity: 1, y: 0 }} 
               className="relative bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
               {(() => {
                 const assessment = getDeleteAssessment('item', deleteAudit.item.id);
                 const isSystem = assessment.details?.isSystem;
                 const recipesUsing = assessment.details?.recipesUsing || [];
                 const stock = assessment.stock || 0;

                 if (isSystem) {
                   return (
                     <div className="p-0">
                       <div className="bg-amber-50 p-6 flex flex-col items-center text-center border-b border-amber-100">
                         <div className="w-14 h-14 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mb-4 shadow-sm"><ShieldAlert size={32} /></div>
                         <h3 className="text-xl font-bold text-slate-900 mb-2">System Product Protected</h3>
                         <p className="text-sm text-slate-600 leading-relaxed"><strong className="text-slate-900">{deleteAudit.item.name}</strong> is a core dairy variety and cannot be permanently deleted. However, you can make it <strong>Inactive</strong> so it remains in the catalog but cannot be sold or purchased.</p>
                       </div>
                       <div className="p-6 space-y-3">
                         {deleteAudit.item.isActive ? (
                           <button 
                             onClick={() => handleSmartItemDelete('deactivate')} 
                             className="w-full py-3 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                           >
                             <Archive size={16} />
                             <span>Make Inactive (Archive)</span>
                           </button>
                         ) : (
                           <button 
                             onClick={() => {
                               reactivateEntity('item', deleteAudit.item!.id);
                               setDeleteAudit({...deleteAudit, isOpen: false});
                             }} 
                             className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
                           >
                             <RotateCcw size={16} />
                             <span>Reactivate Product</span>
                           </button>
                         )}
                         <button onClick={() => setDeleteAudit({...deleteAudit, isOpen: false})} className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-all cursor-pointer">Close</button>
                       </div>
                     </div>
                   );
                 }

                 if (recipesUsing.length > 0) {
                   return (
                     <div className="p-0">
                       <div className="bg-amber-50 p-6 flex flex-col items-center text-center border-b border-amber-100">
                         <div className="w-14 h-14 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mb-4 shadow-sm"><ShieldAlert size={32} /></div>
                         <h3 className="text-xl font-bold text-slate-900 mb-2">Action Blocked</h3>
                         <p className="text-sm text-slate-600"><strong className="text-slate-900">{deleteAudit.item.name}</strong> is a required recipe ingredient.</p>
                       </div>
                       <div className="p-6">
                         <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Used in recipes for:</p>
                         <div className="bg-slate-50 rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-40 overflow-y-auto">
                           {recipesUsing.map((name: string, idx: number) => (
                             <div key={idx} className="px-4 py-3 text-sm font-medium text-slate-700 flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div> {name}</div>
                           ))}
                         </div>
                         <div className="mt-6"><button onClick={() => setDeleteAudit({...deleteAudit, isOpen: false})} className="w-full py-3 bg-slate-800 text-white font-bold rounded-xl shadow-lg hover:bg-slate-700 transition-all">Close & Review Recipes</button></div>
                       </div>
                     </div>
                   );
                 }

                 if (stock > 0) {
                   const stockVal = stock * (deleteAudit.item.cost_price || deleteAudit.item.selling_price || 0);
                   return (
                     <div className="p-0">
                       <div className="bg-amber-50 p-6 flex flex-col items-center text-center border-b border-amber-100">
                         <div className="w-14 h-14 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mb-3 shadow-sm"><AlertTriangle size={32} /></div>
                         <h3 className="text-lg font-bold text-slate-900 mb-1">Stock on Hand Warning</h3>
                         <p className="text-xs text-slate-500">QuickBooks Rule: Cannot delete inventory without balancing assets</p>
                       </div>
                       <div className="p-6 space-y-4">
                         <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
                           <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 block">Current Stock Available</span>
                           <span className="text-2xl font-black font-mono text-amber-800 mt-1 block">
                             {stock} {deleteAudit.item.unit}
                           </span>
                           <span className="text-xs text-amber-700 font-medium block mt-0.5">
                             Inventory Valuation: {formatCurrency(stockVal)}
                           </span>
                           <p className="text-[11px] text-amber-600 mt-1">
                             Deleting directly without write-off will cause Balance Sheet discrepancy!
                           </p>
                         </div>

                         <div className="space-y-2.5">
                           <button
                             onClick={() => handleSmartItemDelete('write_off_spoilage')}
                             className="w-full py-3 px-4 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs flex flex-col items-center justify-center gap-0.5 shadow-md shadow-amber-200 cursor-pointer transition-all"
                           >
                             <span>Write Off Stock to Spoilage & Discontinue</span>
                             <span className="text-[10px] opacity-80 font-normal">Zeros stock, logs spoilage loss & preserves Balance Sheet</span>
                           </button>

                           <button
                             onClick={() => setDeleteAudit({ ...deleteAudit, isOpen: false })}
                             className="w-full py-2.5 bg-slate-100 text-slate-700 hover:bg-slate-200 font-bold rounded-xl text-xs cursor-pointer transition-all"
                           >
                             Cancel & Sell Remaining Stock
                           </button>
                         </div>
                       </div>
                     </div>
                   );
                 }

                 if (assessment.hasHistory) {
                   return (
                     <div className="p-0">
                       <div className="bg-amber-50 p-6 flex flex-col items-center text-center border-b border-amber-100">
                         <div className="w-14 h-14 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mb-3 shadow-sm"><Archive size={32} /></div>
                         <h3 className="text-lg font-bold text-slate-900 mb-1">Discontinue Product</h3>
                         <p className="text-xs text-slate-500">QuickBooks Rule: Preserve past sales bills and inventory logs</p>
                       </div>
                       <div className="p-6">
                         <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mb-4 text-xs space-y-1.5">
                           <div className="flex justify-between font-medium"><span>Product:</span><strong className="text-slate-800">{deleteAudit.item.name}</strong></div>
                           <div className="flex justify-between font-medium"><span>Current Stock:</span><span className="font-mono text-emerald-600 font-bold">0 {deleteAudit.item.unit}</span></div>
                           <div className="flex justify-between font-medium"><span>Past History:</span><span className="font-mono text-slate-700 font-bold">{assessment.details?.salesCount || 0} Bills, {deleteAudit.logCount} Logs</span></div>
                         </div>
                         <p className="text-xs text-slate-600 mb-5 leading-relaxed">
                           This product will be marked <strong>Inactive (Discontinued)</strong>. It will be hidden from the POS register, but past sales receipts and historical reports remain intact.
                         </p>
                         <div className="flex gap-2.5">
                           <button onClick={() => setDeleteAudit({...deleteAudit, isOpen: false})} className="flex-1 py-2.5 bg-slate-100 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-200 transition-all cursor-pointer">Cancel</button>
                           <button onClick={() => handleSmartItemDelete('deactivate')} className="flex-1 py-2.5 bg-amber-600 text-white font-bold rounded-xl text-xs shadow-md shadow-amber-200 hover:bg-amber-700 transition-all cursor-pointer">Make Inactive</button>
                         </div>
                       </div>
                     </div>
                   );
                 }

                 return (
                   <div className="p-0">
                      <div className="bg-red-50 p-6 flex flex-col items-center text-center border-b border-red-100">
                         <div className="w-14 h-14 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4 shadow-sm"><AlertTriangle size={32} /></div>
                         <h3 className="text-xl font-bold text-slate-900 mb-2">Permanent Deletion</h3>
                         <p className="text-xs text-emerald-600 font-bold mb-1">No transactions or stock found (Safe to delete)</p>
                         <p className="text-sm text-slate-600">You are about to permanently delete <strong className="text-slate-900">{deleteAudit.item.name}</strong>.</p>
                      </div>
                      <div className="p-6">
                         <div className="flex gap-3">
                            <button onClick={() => setDeleteAudit({...deleteAudit, isOpen: false})} className="flex-1 py-3 bg-white text-slate-700 font-bold rounded-xl border border-slate-200 hover:bg-slate-50 transition-all text-xs cursor-pointer">Cancel</button>
                            <button onClick={() => handleSmartItemDelete('hard_delete')} className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl shadow-lg shadow-red-200 hover:bg-red-700 transition-all text-xs cursor-pointer">Confirm Delete</button>
                         </div>
                      </div>
                   </div>
                 );
               })()}
            </MotionDiv>
         </div>
      )}

      <AnimatePresence>
        {isConfigOpen && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-4">
            <MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setIsConfigOpen(false)} />
            <MotionDiv initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-800">
               <div className="px-5 py-3.5 sm:px-6 sm:py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 flex justify-between items-center">
                  <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2 text-sm sm:text-base"><Tag size={17} className="text-blue-500"/> Item Categories</h3>
                  <button aria-label="Band karein" onClick={() => setIsConfigOpen(false)} className="text-slate-400 hover:text-slate-600 p-1"><X size={20}/></button>
               </div>
               <div className="p-4 sm:p-6 space-y-4 max-h-[500px] overflow-y-auto">
                  <div className="flex gap-2">
                     <input type="text" className={inputClass} placeholder="New Category..." value={newCatName} onChange={e => setNewCatName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreateCategory()}/>
                     <button onClick={handleCreateCategory} className="px-4 py-2 bg-lime-600 text-white rounded-xl font-bold text-xs sm:text-sm hover:bg-lime-700 cursor-pointer">Add</button>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                     {categories.map(cat => (
                        <div key={cat} className="flex items-center justify-between p-2.5 sm:p-3 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700 group">
                           <span className="text-xs sm:text-sm font-bold text-slate-700">{cat}</span>
                           <button aria-label="Band karein" onClick={() => removeCategory(cat)} className="text-slate-400 hover:text-red-500 p-1 transition-all"><X size={15}/></button>
                        </div>
                     ))}
                  </div>
               </div>
            </MotionDiv>
          </div>
        )}
      </AnimatePresence>

      <UnitManagerModal
         isOpen={isUnitManagerOpen}
         onClose={() => setIsUnitManagerOpen(false)}
         onSelectUnit={sym => {
            const detectedGroup = detectUnitGroupId(sym, settings.inventory?.customUnits || []);
            setFormData(prev => ({ ...prev, unit: sym, unit_group_id: detectedGroup }));
         }}
      />
    </div>
  );
};

export default Items;
