import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useDairy } from '../../context/DairyContext';
import {
  baseUnitWarning,
  getAllAvailableUnits,
  detectUnitGroupId
} from '../../lib/unitConversion';
import { Check, ChevronDown, Droplets, Package, Plus, Scale, Search, Sparkles } from 'lucide-react';
import type { UnitDefinition } from '../../types';
import { Button, Input } from '../ui';
import { cn } from '../../lib/cn';

interface UnitSelectorProps {
  value: string;
  onChange: (unitSymbol: string, unitGroupId: string) => void;
  disabled?: boolean;
  labelClass?: string;
}

type GroupKey = 'mass' | 'volume' | 'count' | 'custom';

const GROUPS: { key: GroupKey; label: string; icon: React.ReactNode; match: (u: UnitDefinition) => boolean }[] = [
  { key: 'mass', label: 'Weight', icon: <Scale />, match: u => u.type === 'Mass' },
  { key: 'volume', label: 'Liquid / volume', icon: <Droplets />, match: u => u.type === 'Volume' },
  { key: 'count', label: 'Count / packaging', icon: <Package />, match: u => u.type === 'Count' },
  { key: 'custom', label: 'Apne units', icon: <Sparkles />, match: u => !u.isSystem },
];

const EMPTY_UNITS: UnitDefinition[] = [];

/** Base unit picker: grouped standard units with search, or a typed custom unit. */
export const UnitSelector: React.FC<UnitSelectorProps> = ({
  value,
  onChange,
  disabled = false,
  labelClass = 'mb-1.5 block text-xs font-semibold text-fg-muted'
}) => {
  const { settings } = useDairy();
  const customUnits = settings?.inventory?.customUnits || EMPTY_UNITS;
  const allUnits = useMemo(() => getAllAvailableUnits(customUnits), [customUnits]);

  const clean = (value || '').toLowerCase().trim();
  const selectedUnitDef = useMemo(() => (clean ? allUnits.find(u => u.symbol.toLowerCase() === clean) : undefined), [clean, allUnits]);

  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCustomMode, setIsCustomMode] = useState<boolean>(Boolean(value && !selectedUnitDef));
  const [customInputValue, setCustomInputValue] = useState<string>(value || '');
  // What to go back to when a custom unit is cancelled.
  const beforeCustomRef = useRef<string>(value || '');
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isOpen]);

  useEffect(() => {
    if (value && !allUnits.some(u => u.symbol.toLowerCase() === value.toLowerCase().trim())) {
      setIsCustomMode(true);
      // Keep what is being typed (a trailing space before the next word), unless the value really changed.
      setCustomInputValue(prev => (prev.trim() === value.trim() ? prev : value));
    }
  }, [value, allUnits]);

  const emit = (symbol: string) => onChange(symbol, symbol ? detectUnitGroupId(symbol, customUnits) : '');

  const handleSelectUnit = (symbol: string) => {
    if (disabled) return;
    setIsCustomMode(false);
    setIsOpen(false);
    setSearchTerm('');
    emit(symbol);
  };

  const startCustom = () => {
    if (disabled) return;
    beforeCustomRef.current = value || '';
    setIsOpen(false);
    setIsCustomMode(true);
    setCustomInputValue('');
  };

  const leaveCustom = (restore: boolean) => {
    setIsCustomMode(false);
    if (restore) {
      const previous = beforeCustomRef.current;
      const previousIsStandard = allUnits.some(u => u.symbol.toLowerCase() === previous.toLowerCase().trim());
      emit(previousIsStandard ? previous : '');
    }
  };

  const handleCustomInputChange = (typed: string) => {
    if (disabled) return;
    setCustomInputValue(typed);
    // An emptied box clears the unit, so a stale first letter is never saved.
    emit(typed.trim());
  };

  const q = searchTerm.toLowerCase().trim();
  const groups = useMemo(() => GROUPS.map(group => ({
    ...group,
    units: allUnits.filter(group.match).filter(u => !q
      || u.name.toLowerCase().includes(q)
      || u.symbol.toLowerCase().includes(q)
      || (u.description || '').toLowerCase().includes(q)),
  })).filter(group => group.units.length > 0), [allUnits, q]);

  const warning = value ? baseUnitWarning(value, customUnits) : '';

  return (
    <div className="space-y-1.5" ref={containerRef}>
      <div className="flex items-center justify-between">
        <label className={labelClass}>
          Base unit<span className="ml-0.5 text-danger" aria-hidden="true">*</span>
        </label>
        {isCustomMode && !disabled && (
          <button type="button" onClick={() => leaveCustom(true)} className="cursor-pointer text-xs font-semibold text-brand-fg hover:underline">
            Standard units
          </button>
        )}
      </div>

      {!isCustomMode ? (
        <div
          className="relative"
          onKeyDown={event => {
            // Esc closes the list only; it must not close the form behind it.
            if (event.key === 'Escape' && isOpen) {
              event.preventDefault();
              event.stopPropagation();
              setIsOpen(false);
            }
          }}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={disabled}
              aria-haspopup="listbox"
              aria-expanded={isOpen}
              aria-controls={isOpen ? listId : undefined}
              onClick={() => setIsOpen(!isOpen)}
              className={cn(
                'ds-control flex h-10 min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 rounded-control border bg-surface px-3 text-left text-sm shadow-e1 transition-[border-color,box-shadow] duration-150',
                'hover:border-line-strong focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-subtle',
                isOpen ? 'border-brand-accent ring-4 ring-ring/20' : 'border-line',
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                {selectedUnitDef ? (
                  <>
                    <span className="shrink-0 rounded-md bg-brand-soft px-1.5 py-0.5 font-mono text-xs font-bold text-brand-fg">{selectedUnitDef.symbol}</span>
                    <span className="truncate font-semibold text-fg">{selectedUnitDef.name}</span>
                  </>
                ) : value ? (
                  <>
                    <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-xs font-bold text-fg">{value}</span>
                    <span className="truncate font-semibold text-fg">Custom: {value}</span>
                  </>
                ) : (
                  <span className="truncate text-fg-faint">Unit chunein (kg, L, pcs...)</span>
                )}
              </span>
              <ChevronDown className={cn('size-4 shrink-0 text-fg-faint transition-transform duration-150', isOpen && 'rotate-180')} />
            </button>
            <Button variant="secondary" leftIcon={<Plus />} disabled={disabled} onClick={startCustom} title="Apna unit likhein">
              Custom
            </Button>
          </div>

          {isOpen && (
            <div className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-card border border-line bg-surface shadow-e3 animate-in fade-in slide-in-from-top-1 duration-150">
              <div className="border-b border-line bg-surface-2/60 p-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-fg-faint" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Unit dhoondein (kg, liter, dozen)..."
                    aria-label="Unit dhoondein"
                    className="ds-control h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-3 text-sm text-fg outline-none placeholder:text-fg-faint focus:border-brand-accent"
                    autoFocus
                  />
                </div>
              </div>

              <div id={listId} role="listbox" aria-label="Units" className="max-h-72 overflow-y-auto p-1.5">
                {groups.length === 0 && (
                  <p className="px-3 py-6 text-center text-xs text-fg-subtle">Koi unit nahi mila. "Custom" se apna unit likhein.</p>
                )}
                {groups.map(group => (
                  <div key={group.key} role="group" aria-label={group.label} className="py-1">
                    <p className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle [&_svg]:size-3.5">
                      {group.icon}{group.label}
                    </p>
                    {group.units.map(u => {
                      const isSelected = clean === u.symbol.toLowerCase();
                      return (
                        <button
                          key={`${group.key}-${u.id}`}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => handleSelectUnit(u.symbol)}
                          className={cn(
                            'flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            isSelected ? 'bg-brand-soft font-semibold text-brand-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="w-12 shrink-0 font-mono text-xs font-bold text-fg">{u.symbol}</span>
                            <span className="truncate">{u.name}</span>
                          </span>
                          {isSelected && <Check className="size-4 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              <div className="border-t border-line p-1.5">
                <button
                  type="button"
                  onClick={startCustom}
                  className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-brand-fg transition-colors hover:bg-brand-soft"
                >
                  <Plus className="size-3.5" />Apna unit likhein...
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Input
              disabled={disabled}
              value={customInputValue}
              onChange={e => handleCustomInputChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); if (customInputValue.trim()) setIsCustomMode(false); }
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); leaveCustom(true); }
              }}
              placeholder="Unit likhein (egg, plate, tray, cup, bori)..."
              aria-label="Custom unit"
              maxLength={20}
              autoFocus={!disabled}
            />
          </div>
          {!disabled && (
            <>
              <Button
                leftIcon={<Check />}
                disabled={!customInputValue.trim()}
                onClick={() => setIsCustomMode(false)}
              >
                Done
              </Button>
              <Button variant="ghost" onClick={() => leaveCustom(true)}>Cancel</Button>
            </>
          )}
        </div>
      )}

      {warning && <p className="text-xs font-medium text-warning-fg">{warning}</p>}
      <p className="text-xs text-fg-subtle">
        {isCustomMode
          ? 'Pack sizes (dozen, cup) Sell units tab mein add karein.'
          : 'Sab se chhota unit jo aap ginte ya tolte hain, e.g. kg, L ya pcs.'}
      </p>
    </div>
  );
};
