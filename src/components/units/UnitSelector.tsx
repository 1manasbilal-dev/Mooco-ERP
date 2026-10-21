import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useDairy } from '../../context/DairyContext';
import { 
  baseUnitWarning,
  getAllAvailableUnits, 
  detectUnitGroupId 
} from '../../lib/unitConversion';
import { Check, Plus, ChevronDown, Search, Scale, Droplets, Package, Sparkles } from 'lucide-react';

interface UnitSelectorProps {
  value: string;
  onChange: (unitSymbol: string, unitGroupId: string) => void;
  disabled?: boolean;
  labelClass?: string;
}

export const UnitSelector: React.FC<UnitSelectorProps> = ({
  value,
  onChange,
  disabled = false,
  labelClass = 'text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1'
}) => {
  const { settings } = useDairy();
  const customUnits = settings?.inventory?.customUnits || [];

  const allUnits = useMemo(() => getAllAvailableUnits(customUnits), [customUnits]);

  const volumeUnits = useMemo(() => allUnits.filter(u => u.type === 'Volume'), [allUnits]);
  const massUnits = useMemo(() => allUnits.filter(u => u.type === 'Mass'), [allUnits]);
  const countUnits = useMemo(() => allUnits.filter(u => u.type === 'Count'), [allUnits]);
  const userCustomUnits = useMemo(() => allUnits.filter(u => !u.isSystem), [allUnits]);

  const isExistingUnit = useMemo(() => {
    if (!value) return false;
    const clean = value.toLowerCase().trim();
    return allUnits.some(u => u.symbol.toLowerCase() === clean);
  }, [value, allUnits]);

  const selectedUnitDef = useMemo(() => {
    if (!value) return null;
    const clean = value.toLowerCase().trim();
    return allUnits.find(u => u.symbol.toLowerCase() === clean);
  }, [value, allUnits]);

  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCustomMode, setIsCustomMode] = useState<boolean>(Boolean(value && !isExistingUnit));
  const [customInputValue, setCustomInputValue] = useState<string>(value || '');

  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({
    mass: false,
    volume: false,
    count: false,
    custom: false
  });

  const toggleCategory = (catKey: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedCategories(prev => ({ ...prev, [catKey]: !prev[catKey] }));
  };

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isOpen]);

  useEffect(() => {
    if (value) {
      const match = allUnits.some(u => u.symbol.toLowerCase() === value.toLowerCase().trim());
      if (!match) {
        setIsCustomMode(true);
        setCustomInputValue(value);
      }
    }
  }, [value, allUnits]);

  const handleSelectUnit = (symbol: string) => {
    if (disabled) return;
    setIsCustomMode(false);
    setIsOpen(false);
    setSearchTerm('');
    const detectedGroup = detectUnitGroupId(symbol, customUnits);
    onChange(symbol, detectedGroup);
  };

  const handleCustomInputChange = (typed: string) => {
    if (disabled) return;
    setCustomInputValue(typed);
    const clean = typed.trim();
    if (clean) {
      const detectedGroup = detectUnitGroupId(clean, customUnits);
      onChange(clean, detectedGroup);
    }
  };

  const filterList = (list: typeof allUnits) => {
    if (!searchTerm.trim()) return list;
    const q = searchTerm.toLowerCase().trim();
    return list.filter(u => 
      u.name.toLowerCase().includes(q) || 
      u.symbol.toLowerCase().includes(q) ||
      (u.description && u.description.toLowerCase().includes(q))
    );
  };

  const filteredMass = filterList(massUnits);
  const filteredVolume = filterList(volumeUnits);
  const filteredCount = filterList(countUnits);
  const filteredCustom = filterList(userCustomUnits);

  return (
    <div className="space-y-1.5" ref={containerRef}>
      <div className="flex items-center justify-between">
        <label className={labelClass}>
          Base Measurement Unit *
        </label>
        {isCustomMode && (
          <button
            type="button"
            onClick={() => {
              setIsCustomMode(false);
              handleSelectUnit('pcs');
            }}
            className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
          >
            ← Standard Units
          </button>
        )}
      </div>

      {!isCustomMode ? (
        <div className="relative">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setIsOpen(!isOpen)}
              className={`flex-1 flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-xs sm:text-sm font-semibold transition-all cursor-pointer text-left shadow-2xs ${
                isOpen
                  ? 'border-lime-500 ring-2 ring-lime-500/20 bg-white dark:bg-slate-800 text-slate-900 dark:text-white'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600 text-slate-800 dark:text-white'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {selectedUnitDef ? (
                  <>
                    <span className="px-2 py-0.5 rounded-md bg-lime-100 dark:bg-lime-950/70 text-lime-800 dark:text-lime-300 font-mono font-bold text-xs shrink-0">
                      {selectedUnitDef.symbol}
                    </span>
                    <span className="font-bold truncate text-slate-800 dark:text-slate-100">
                      {selectedUnitDef.name}
                    </span>
                  </>
                ) : value ? (
                  <>
                    <span className="px-2 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-300 font-mono font-bold text-xs shrink-0">
                      {value}
                    </span>
                    <span className="font-bold truncate text-slate-800 dark:text-slate-100">
                      Custom: {value}
                    </span>
                  </>
                ) : (
                  <span className="text-slate-400 dark:text-slate-500">
                    Choose measurement unit (Weight, Liquid, Count)...
                  </span>
                )}
              </div>
              <ChevronDown 
                size={16} 
                className={`text-slate-400 transition-transform duration-200 shrink-0 ml-2 ${
                  isOpen ? 'rotate-180 text-lime-600 dark:text-lime-400' : ''
                }`} 
              />
            </button>

            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setIsOpen(false);
                setIsCustomMode(true);
                setCustomInputValue('');
              }}
              className="px-3.5 py-2.5 rounded-xl border border-dashed border-indigo-300 dark:border-indigo-700 hover:border-indigo-500 bg-indigo-50/70 hover:bg-indigo-100/80 dark:bg-indigo-950/40 dark:hover:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shrink-0 active:scale-95 shadow-2xs"
              title="Create custom unit"
            >
              <Plus size={14} className="stroke-[2.5]" />
              <span>+ Custom</span>
            </button>
          </div>

          {isOpen && (
            <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl rounded-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="p-2.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-850">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Search unit (e.g. kg, liter, dozen)..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-800 dark:text-white outline-none focus:border-lime-500"
                    autoFocus
                  />
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 p-1.5">
                {filteredMass.length > 0 && (
                  <div className="py-1">
                    <button
                      type="button"
                      onClick={(e) => toggleCategory('mass', e)}
                      className="w-full px-2.5 py-1.5 flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-lg transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <Scale size={13} className="text-amber-600 dark:text-amber-400" />
                        Weight & Mass ({filteredMass.length})
                      </span>
                      <ChevronDown 
                        size={13} 
                        className={`transition-transform ${collapsedCategories.mass && !searchTerm ? '-rotate-90' : ''}`} 
                      />
                    </button>

                    {(!collapsedCategories.mass || searchTerm) && (
                      <div className="mt-1 space-y-0.5">
                        {filteredMass.map(u => {
                          const isSelected = (value || '').toLowerCase().trim() === u.symbol.toLowerCase();
                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => handleSelectUnit(u.symbol)}
                              className={`w-full px-3 py-2 rounded-xl text-left text-xs flex items-center justify-between transition-colors cursor-pointer ${
                                isSelected
                                  ? 'bg-lime-50 dark:bg-lime-950/60 text-lime-900 dark:text-lime-200 font-bold border border-lime-200 dark:border-lime-800/60'
                                  : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[11px]">
                                  {u.symbol}
                                </span>
                                <span>{u.name}</span>
                              </div>
                              {isSelected && <Check size={14} className="text-lime-600 dark:text-lime-400 stroke-[3]" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {filteredVolume.length > 0 && (
                  <div className="py-1">
                    <button
                      type="button"
                      onClick={(e) => toggleCategory('volume', e)}
                      className="w-full px-2.5 py-1.5 flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-lg transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <Droplets size={13} className="text-blue-600 dark:text-blue-400" />
                        Liquids & Volume ({filteredVolume.length})
                      </span>
                      <ChevronDown 
                        size={13} 
                        className={`transition-transform ${collapsedCategories.volume && !searchTerm ? '-rotate-90' : ''}`} 
                      />
                    </button>

                    {(!collapsedCategories.volume || searchTerm) && (
                      <div className="mt-1 space-y-0.5">
                        {filteredVolume.map(u => {
                          const isSelected = (value || '').toLowerCase().trim() === u.symbol.toLowerCase();
                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => handleSelectUnit(u.symbol)}
                              className={`w-full px-3 py-2 rounded-xl text-left text-xs flex items-center justify-between transition-colors cursor-pointer ${
                                isSelected
                                  ? 'bg-lime-50 dark:bg-lime-950/60 text-lime-900 dark:text-lime-200 font-bold border border-lime-200 dark:border-lime-800/60'
                                  : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[11px]">
                                  {u.symbol}
                                </span>
                                <span>{u.name}</span>
                              </div>
                              {isSelected && <Check size={14} className="text-lime-600 dark:text-lime-400 stroke-[3]" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {filteredCount.length > 0 && (
                  <div className="py-1">
                    <button
                      type="button"
                      onClick={(e) => toggleCategory('count', e)}
                      className="w-full px-2.5 py-1.5 flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-lg transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <Package size={13} className="text-emerald-600 dark:text-emerald-400" />
                        Count & Packaging ({filteredCount.length})
                      </span>
                      <ChevronDown 
                        size={13} 
                        className={`transition-transform ${collapsedCategories.count && !searchTerm ? '-rotate-90' : ''}`} 
                      />
                    </button>

                    {(!collapsedCategories.count || searchTerm) && (
                      <div className="mt-1 space-y-0.5">
                        {filteredCount.map(u => {
                          const isSelected = (value || '').toLowerCase().trim() === u.symbol.toLowerCase();
                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => handleSelectUnit(u.symbol)}
                              className={`w-full px-3 py-2 rounded-xl text-left text-xs flex items-center justify-between transition-colors cursor-pointer ${
                                isSelected
                                  ? 'bg-lime-50 dark:bg-lime-950/60 text-lime-900 dark:text-lime-200 font-bold border border-lime-200 dark:border-lime-800/60'
                                  : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[11px]">
                                  {u.symbol}
                                </span>
                                <span>{u.name}</span>
                              </div>
                              {isSelected && <Check size={14} className="text-lime-600 dark:text-lime-400 stroke-[3]" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {filteredCustom.length > 0 && (
                  <div className="py-1">
                    <button
                      type="button"
                      onClick={(e) => toggleCategory('custom', e)}
                      className="w-full px-2.5 py-1.5 flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-lg transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5">
                        <Sparkles size={13} className="text-purple-600 dark:text-purple-400" />
                        Custom Store Units ({filteredCustom.length})
                      </span>
                      <ChevronDown 
                        size={13} 
                        className={`transition-transform ${collapsedCategories.custom && !searchTerm ? '-rotate-90' : ''}`} 
                      />
                    </button>

                    {(!collapsedCategories.custom || searchTerm) && (
                      <div className="mt-1 space-y-0.5">
                        {filteredCustom.map(u => {
                          const isSelected = (value || '').toLowerCase().trim() === u.symbol.toLowerCase();
                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => handleSelectUnit(u.symbol)}
                              className={`w-full px-3 py-2 rounded-xl text-left text-xs flex items-center justify-between transition-colors cursor-pointer ${
                                isSelected
                                  ? 'bg-lime-50 dark:bg-lime-950/60 text-lime-900 dark:text-lime-200 font-bold border border-lime-200 dark:border-lime-800/60'
                                  : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[11px]">
                                  {u.symbol}
                                </span>
                                <span>{u.name}</span>
                              </div>
                              {isSelected && <Check size={14} className="text-lime-600 dark:text-lime-400 stroke-[3]" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="p-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-850">
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    setIsCustomMode(true);
                    setCustomInputValue('');
                  }}
                  className="w-full py-2 px-3 rounded-xl text-xs font-bold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus size={14} className="stroke-[2.5]" />
                  <span>+ Create Custom Unit...</span>
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 animate-in fade-in duration-150">
          <div className="relative flex-1">
            <input
              type="text"
              disabled={disabled}
              value={customInputValue}
              onChange={e => handleCustomInputChange(e.target.value)}
              placeholder="Type custom unit (e.g. egg, plate, tray, cup, bori)..."
              className="w-full rounded-xl border-2 border-indigo-500 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs sm:text-sm font-bold text-slate-900 dark:text-white shadow-2xs outline-none focus:ring-2 focus:ring-indigo-500/20"
              autoFocus
            />
          </div>
          <button
            type="button"
            onClick={() => {
              if (!customInputValue.trim()) {
                setIsCustomMode(false);
                handleSelectUnit('pcs');
              } else {
                setIsCustomMode(false);
              }
            }}
            className="px-3.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center gap-1 shadow-xs cursor-pointer shrink-0 active:scale-95"
          >
            <Check size={14} className="stroke-[3]" />
            <span>Done</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setIsCustomMode(false);
              handleSelectUnit('pcs');
            }}
            className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 text-slate-600 dark:text-slate-300 font-semibold text-xs cursor-pointer shrink-0"
          >
            Cancel
          </button>
        </div>
      )}

      {value && baseUnitWarning(value, customUnits) && (
        <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
          {baseUnitWarning(value, customUnits)}
        </p>
      )}
      <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">
        {isCustomMode 
          ? 'Pack sizes go in the Units & Packaging tab.'
          : 'The smallest unit you count or weigh, e.g. kg, L or pcs.'}
      </p>
    </div>
  );
};
