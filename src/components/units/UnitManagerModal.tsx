import React, { useState, useMemo } from 'react';
import { useDairy } from '../../context/DairyContext';
import { useToast } from '../../context/ToastContext';
import { UnitDefinition } from '../../types';
import { 
  describeUnitRole,
  getAllAvailableUnits, 
  getUnitFactorDescription 
} from '../../lib/unitConversion';
import { 
  X, Plus, Trash2, Edit3, Search, Scale, Droplet, Boxes, 
  Layers, Lock, SlidersHorizontal, Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { confirmAction } from '../ui/ConfirmDialog';

const MotionDiv = motion.div as any;

interface UnitManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectUnit?: (unitSymbol: string) => void;
  initialCategory?: 'All' | 'Volume' | 'Mass' | 'Count' | 'Custom';
}

export const UnitManagerModal: React.FC<UnitManagerModalProps> = ({
  isOpen,
  onClose,
  onSelectUnit,
  initialCategory = 'All'
}) => {
  const { addUnit, updateUnit, deleteUnit, items, settings } = useDairy();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'All' | 'Volume' | 'Mass' | 'Count' | 'Custom'>(initialCategory);
  const [searchQuery, setSearchQuery] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);

  const [formData, setFormData] = useState<{
    name: string;
    symbol: string;
    type: 'Volume' | 'Mass' | 'Count';
    factor: string;
    urduName: string;
    description: string;
  }>({
    name: '',
    symbol: '',
    type: 'Count',
    factor: '1',
    urduName: '',
    description: ''
  });

  const customUnits = settings.inventory?.customUnits || [];
  const allUnits = useMemo(() => getAllAvailableUnits(customUnits), [customUnits]);

  // Unit symbol -> number of products using it
  const usageMap = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach(item => {
      const u = (item.unit || '').trim().toLowerCase();
      if (u) {
        map[u] = (map[u] || 0) + 1;
      }
    });
    return map;
  }, [items]);

  const filteredUnits = useMemo(() => {
    let list = allUnits;

    if (activeTab === 'Volume') {
      list = list.filter(u => u.type === 'Volume');
    } else if (activeTab === 'Mass') {
      list = list.filter(u => u.type === 'Mass');
    } else if (activeTab === 'Count') {
      list = list.filter(u => u.type === 'Count');
    } else if (activeTab === 'Custom') {
      list = list.filter(u => !u.isSystem);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(u => 
        u.name.toLowerCase().includes(q) ||
        u.symbol.toLowerCase().includes(q) ||
        (u.urduName && u.urduName.includes(q)) ||
        (u.description && u.description.toLowerCase().includes(q))
      );
    }

    return list;
  }, [allUnits, activeTab, searchQuery]);

  const resetForm = () => {
    setFormData({
      name: '',
      symbol: '',
      type: 'Count',
      factor: '1',
      urduName: '',
      description: ''
    });
    setEditingUnitId(null);
    setIsFormOpen(false);
  };

  const handleStartEdit = (unit: UnitDefinition) => {
    setEditingUnitId(unit.id);
    setFormData({
      name: unit.name,
      symbol: unit.symbol,
      type: unit.type || 'Count',
      factor: String(unit.factor || 1),
      urduName: unit.urduName || '',
      description: unit.description || ''
    });
    setIsFormOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = formData.name.trim();
    const symbol = formData.symbol.trim();
    const factorNum = parseFloat(formData.factor);

    if (!name || !symbol) {
      showToast("Unit ka naam aur symbol zaroori hain", "warning");
      return;
    }

    if (isNaN(factorNum) || factorNum <= 0) {
      showToast("Conversion factor 0 se bara number hona chahiye", "warning");
      return;
    }

    if (editingUnitId) {
      const original = allUnits.find(u => u.id === editingUnitId);
      const inUse = Boolean(original && (usageMap[original.symbol.toLowerCase()] || 0) > 0);
      if (original && inUse && (symbol !== original.symbol || formData.type !== (original.type || 'Count') || factorNum !== Number(original.factor))) {
        showToast(`"${original.symbol}" products mein istemal ho raha hai. Sirf naam aur note badal sakte hain.`, "warning");
        return;
      }
      const ok = await updateUnit(editingUnitId, {
        name,
        symbol,
        type: formData.type,
        factor: factorNum,
        urduName: formData.urduName.trim(),
        description: formData.description.trim()
      });
      if (ok) {
        resetForm();
      }
    } else {
      const ok = await addUnit({
        name,
        symbol,
        type: formData.type,
        factor: factorNum,
        urduName: formData.urduName.trim(),
        description: formData.description.trim(),
        isBase: false,
        isSystem: false
      });
      if (ok) {
        if (onSelectUnit) {
          onSelectUnit(symbol);
        }
        resetForm();
      }
    }
  };

  const handleDelete = async (unit: UnitDefinition) => {
    const usageCount = usageMap[unit.symbol.toLowerCase()] || 0;
    if (usageCount > 0) {
      showToast(`Delete nahi ho sakta: ${usageCount} product(s) "${unit.symbol}" istemal kar rahe hain. Pehle un products ka unit badlein.`, "warning");
      return;
    }

    if (await confirmAction({
      title: `Unit "${unit.name} (${unit.symbol})" delete karein?`,
      message: 'Koi product yeh unit istemal nahi kar raha.',
      consequences: ['Yeh unit list se hat jayega.', 'Yeh kaam wapas nahi ho sakta.'],
    })) {
      await deleteUnit(unit.id);
    }
  };

  if (!isOpen) return null;

  const baseSymbolForType = formData.type === 'Volume' ? 'L' : formData.type === 'Mass' ? 'kg' : 'pcs';
  // Products store the unit by its symbol; renaming or resizing one in use would silently change their stock meaning.
  const editingUnit = editingUnitId ? allUnits.find(u => u.id === editingUnitId) : undefined;
  const editingInUse = Boolean(editingUnit && (usageMap[editingUnit.symbol.toLowerCase()] || 0) > 0);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4">
      <MotionDiv 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        exit={{ opacity: 0 }} 
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" 
        onClick={onClose} 
      />

      <MotionDiv 
        initial={{ scale: 0.97, opacity: 0, y: 10 }} 
        animate={{ scale: 1, opacity: 1, y: 0 }} 
        exit={{ scale: 0.97, opacity: 0, y: 10 }}
        transition={{ type: "spring", stiffness: 350, damping: 28 }}
        className="relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] border border-slate-200/90 dark:border-slate-800"
      >
        <div className="px-5 py-4 sm:px-6 sm:py-4.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-850 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-slate-900 text-white dark:bg-lime-500 dark:text-slate-950 flex items-center justify-center shadow-xs">
              <Scale size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-base sm:text-lg text-slate-900 dark:text-white tracking-tight">
                  Measurement Unit Manager
                </h3>
                <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  {allUnits.length}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Base and conversion units for weight, volume and count.
              </p>
            </div>
          </div>
          <button aria-label="Band karein" 
            type="button"
            onClick={onClose} 
            className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={19} />
          </button>
        </div>

        <div className="p-4 sm:p-6 flex-1 overflow-y-auto space-y-4">
          
          <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search unit by name, symbol, or Urdu text..."
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 rounded-xl pl-9 pr-3.5 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-slate-900 dark:focus:border-lime-500 focus:ring-1 focus:ring-slate-900 dark:focus:ring-lime-500 transition-all placeholder:text-slate-400"
              />
              {searchQuery && (
                <button aria-label="Hatayen" 
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <button 
              type="button"
              onClick={() => {
                if (isFormOpen && !editingUnitId) {
                  setIsFormOpen(false);
                } else {
                  resetForm();
                  setIsFormOpen(true);
                }
              }}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer ${
                isFormOpen && !editingUnitId
                  ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                  : 'bg-slate-900 hover:bg-slate-800 text-white dark:bg-lime-500 dark:hover:bg-lime-400 dark:text-slate-950 active:scale-95'
              }`}
            >
              <Plus size={16} />
              {isFormOpen && !editingUnitId ? 'Close Form' : 'New Custom Unit'}
            </button>
          </div>

          {/* Pack sizes live on the product, not here */}
          <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Info size={13} className="shrink-0" />
            Add product pack sizes (dozen, tray, cup) in that product's Units &amp; Packaging tab.
          </p>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none border-b border-slate-100 dark:border-slate-800">
            {[
              { id: 'All', label: 'All Units', icon: SlidersHorizontal, count: allUnits.length },
              { id: 'Volume', label: 'Volume (Liquid)', icon: Droplet, count: allUnits.filter(u => u.type === 'Volume').length },
              { id: 'Mass', label: 'Weight & Mass', icon: Scale, count: allUnits.filter(u => u.type === 'Mass').length },
              { id: 'Count', label: 'Count & Packaging', icon: Boxes, count: allUnits.filter(u => u.type === 'Count').length },
              { id: 'Custom', label: 'Custom Defined', icon: Layers, count: customUnits.length }
            ].map(tab => {
              const TabIcon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                    isActive
                      ? 'bg-slate-900 text-white dark:bg-lime-500 dark:text-slate-950 font-bold shadow-2xs'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900'
                  }`}
                >
                  <TabIcon size={13} className={isActive ? 'opacity-100' : 'opacity-70'} />
                  <span>{tab.label}</span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                    isActive
                      ? 'bg-white/20 text-white dark:bg-black/20 dark:text-slate-900'
                      : 'bg-slate-200/80 dark:bg-slate-800 text-slate-500'
                  }`}>
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          <AnimatePresence>
            {isFormOpen && (
              <MotionDiv
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <form 
                  onSubmit={handleSubmit}
                  className="bg-slate-50 dark:bg-slate-850 p-4 sm:p-5 rounded-2xl border border-slate-200/90 dark:border-slate-700/80 space-y-4"
                >
                  <div className="flex justify-between items-center border-b border-slate-200/70 dark:border-slate-700 pb-2.5">
                    <h4 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white flex items-center gap-2">
                      {editingUnitId ? <Edit3 size={15} /> : <Plus size={15} />}
                      {editingUnitId ? 'Edit Custom Unit' : 'Define New Measurement Scale'}
                    </h4>
                    <button 
                      type="button" 
                      onClick={resetForm}
                      className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 font-medium"
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">
                        Unit Name *
                      </label>
                      <input 
                        type="text" 
                        required
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        placeholder="e.g. Maund, Gallon, Master Carton"
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-slate-900 dark:focus:ring-lime-500 font-medium shadow-2xs"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">
                        Symbol / Code *
                      </label>
                      <input 
                        type="text" 
                        required
                        value={formData.symbol}
                        disabled={editingInUse}
                        onChange={e => setFormData({ ...formData, symbol: e.target.value })}
                        placeholder="e.g. maund, gal, ctn"
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs sm:text-sm font-mono font-bold text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-slate-900 dark:focus:ring-lime-500 shadow-2xs"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">
                        Measurement Scale *
                      </label>
                      <select
                        value={formData.type}
                        disabled={editingInUse}
                        onChange={e => setFormData({ ...formData, type: e.target.value as any })}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-slate-900 dark:focus:ring-lime-500 font-medium shadow-2xs"
                      >
                        <option value="Count">Count & Packaging (Pieces, Packs, Dozens)</option>
                        <option value="Mass">Weight & Mass (Kilograms, Grams, Pao)</option>
                        <option value="Volume">Volume & Liquid (Litres, Millilitres)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">
                        Base Multiplier ({baseSymbolForType}) *
                      </label>
                      <div className="relative">
                        <input 
                          type="number" 
                          step="any"
                          min="0.0001"
                          required
                          value={formData.factor}
                          disabled={editingInUse}
                          onChange={e => setFormData({ ...formData, factor: e.target.value })}
                          placeholder="e.g. 40, 24, 0.25"
                          className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl pl-3 pr-12 py-2 text-xs sm:text-sm font-mono font-bold text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-slate-900 dark:focus:ring-lime-500 shadow-2xs"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono font-bold text-slate-400">
                          {baseSymbolForType}
                        </span>
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">
                        Urdu Script (Optional)
                      </label>
                      <input 
                        type="text" 
                        value={formData.urduName}
                        onChange={e => setFormData({ ...formData, urduName: e.target.value })}
                        placeholder="   "
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-slate-900 dark:focus:ring-lime-500 shadow-2xs font-sans"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">
                        Memo / Description
                      </label>
                      <input 
                        type="text" 
                        value={formData.description}
                        onChange={e => setFormData({ ...formData, description: e.target.value })}
                        placeholder="e.g. Master carton containing 24 packs"
                        className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-slate-900 dark:focus:ring-lime-500 shadow-2xs"
                      />
                    </div>
                  </div>

                  {editingInUse && (
                    <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5"><Lock size={12} />In use by products: symbol, type and size are locked.</p>
                  )}

                  <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5 font-medium">
                      <Info size={14} className="text-slate-400" />
                      Calculated Relationship:
                    </span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      1 {formData.symbol || 'unit'} = {formData.factor || '1'} {baseSymbolForType}
                    </span>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button 
                      type="button" 
                      onClick={resetForm}
                      className="px-4 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      className="px-5 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white dark:bg-lime-500 dark:hover:bg-lime-400 dark:text-slate-950 shadow-xs active:scale-95 transition-all"
                    >
                      {editingUnitId ? 'Update Scale' : 'Save Unit'}
                    </button>
                  </div>
                </form>
              </MotionDiv>
            )}
          </AnimatePresence>

          <div className="space-y-2">
            {filteredUnits.length === 0 ? (
              <div className="text-center py-10 bg-slate-50 dark:bg-slate-850 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
                <Scale size={28} className="mx-auto text-slate-300 dark:text-slate-600 mb-2" />
                <p className="text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-300">
                  No matching measurement units found
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Adjust your search filter or define a new unit using the button above.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {filteredUnits.map(unit => {
                  const usageCount = usageMap[unit.symbol.toLowerCase()] || 0;
                  const isSystem = Boolean(unit.isSystem);
                  const formula = getUnitFactorDescription(unit);
                  const unitRole = describeUnitRole(unit);
                  const typeIcon = unit.type === 'Volume' ? Droplet : unit.type === 'Mass' ? Scale : Boxes;
                  const IconComponent = typeIcon;

                  return (
                    <div 
                      key={unit.id}
                      className="p-3.5 bg-white dark:bg-slate-850 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-2xs hover:border-slate-400 dark:hover:border-slate-600 transition-all flex flex-col justify-between gap-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white truncate">
                              {unit.name}
                            </span>
                            {unit.urduName && (
                              <span className="text-[11px] font-medium text-slate-400 dark:text-slate-400">
                                ({unit.urduName})
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                            {unit.description || (isSystem ? 'Standard Built-in System Unit' : 'Custom Defined Business Unit')}
                          </p>
                          <span title={unitRole.hint} className={`inline-block mt-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md cursor-help ${unitRole.role === 'base' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : unitRole.role === 'convertible' ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{unitRole.label}</span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <span className="font-mono font-bold text-xs px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                            {unit.symbol}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2.5 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5 font-medium">
                            <IconComponent size={12} className="text-slate-400" />
                            <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                              {formula}
                            </span>
                          </span>

                          {usageCount > 0 && (
                            <span className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-mono font-semibold">
                              {usageCount} {usageCount === 1 ? 'item' : 'items'}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {onSelectUnit && (
                            <button
                              type="button"
                              onClick={() => {
                                onSelectUnit(unit.symbol);
                                onClose();
                              }}
                              className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-900 hover:text-white text-slate-700 text-[10px] font-bold transition-all cursor-pointer"
                            >
                              Select
                            </button>
                          )}

                          {isSystem ? (
                            <span 
                              title="Standard System Unit (Protected)"
                              className="p-1 text-slate-300 dark:text-slate-600"
                            >
                              <Lock size={13} />
                            </span>
                          ) : (
                            <div className="flex items-center gap-0.5">
                              <button aria-label="Edit unit definition"
                                type="button"
                                onClick={() => handleStartEdit(unit)}
                                title="Edit unit definition"
                                className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                              >
                                <Edit3 size={13} />
                              </button>
                              <button aria-label={usageCount > 0 ? "Unit in use" : "Delete custom unit"}
                                type="button"
                                onClick={() => handleDelete(unit)}
                                title={usageCount > 0 ? "Unit in use" : "Delete custom unit"}
                                className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 sm:px-6 sm:py-3.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-850 flex justify-between items-center shrink-0">
          <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">
            Units used by products can't change symbol, type or size.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </MotionDiv>
    </div>
  );
};
