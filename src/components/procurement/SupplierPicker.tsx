import React, { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, User, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { controlClass, Money } from '../ui';
import { Avatar } from './ProcurementUI';
import { balanceOf, formatRate } from './procurementData';

/** Longer lists are cut here; typing narrows them. Rendering 500 farmers on every key was slow. */
const MAX_RESULTS = 60;

interface SupplierPickerProps {
  value: string;
  onChange: (id: string) => void;
  suppliers: any[];
  placeholder: string;
  /** Bump to focus the field and open the list (e.g. after a save). */
  focusToken?: number;
  /** Called after a farmer is picked with Enter or a click, to move on to the next field. */
  onPicked?: (id: string) => void;
  id?: string;
  size?: 'md' | 'lg';
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

function rank(supplier: any, needle: string): number {
  const name = String(supplier.name || '').toLowerCase();
  if (name.startsWith(needle)) return 0;
  if (name.split(/\s+/).some(word => word.startsWith(needle))) return 1;
  if (name.includes(needle)) return 2;
  const other = `${supplier.village || supplier.city || ''} ${supplier.phone || ''} ${supplier.whatsapp || ''}`.toLowerCase();
  return other.includes(needle) ? 3 : -1;
}

/** Searchable farmer / vendor combobox: type, arrow keys, Enter. Shows each party's khata balance. */
export const SupplierPicker: React.FC<SupplierPickerProps> = ({
  value, onChange, suppliers, placeholder, focusToken = 0, onPicked, id, size = 'lg', ...aria
}) => {
  const fallbackId = useId();
  const inputId = id || fallbackId;
  const listId = `${inputId}-list`;
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => suppliers.find(s => s.id === value), [value, suppliers]);
  const selectedName = selected?.name || '';

  // Show the picked name; depends on the name only, so a balance refresh never wipes what is being typed.
  useEffect(() => { setSearch(selectedName); }, [value, selectedName]);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearch(selectedName);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isOpen, selectedName]);

  useEffect(() => {
    if (!focusToken) return;
    inputRef.current?.focus();
    setIsOpen(true);
  }, [focusToken]);

  const needle = search.trim().toLowerCase();
  const showAll = !needle || (selected && search === selectedName);
  const { results, total } = useMemo(() => {
    if (showAll) return { results: suppliers.slice(0, MAX_RESULTS), total: suppliers.length };
    const scored: { supplier: any; score: number }[] = [];
    suppliers.forEach(supplier => {
      const score = rank(supplier, needle);
      if (score >= 0) scored.push({ supplier, score });
    });
    scored.sort((a, b) => a.score - b.score || String(a.supplier.name).localeCompare(String(b.supplier.name)));
    return { results: scored.slice(0, MAX_RESULTS).map(item => item.supplier), total: scored.length };
  }, [suppliers, needle, showAll]);

  useEffect(() => { setHighlighted(0); }, [needle, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${highlighted}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlighted, isOpen]);

  const pick = (supplierId: string) => {
    const found = suppliers.find(s => s.id === supplierId);
    onChange(supplierId);
    setSearch(found?.name || '');
    setIsOpen(false);
    onPicked?.(supplierId);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (event.key === 'ArrowDown' || (event.key === 'Enter' && !value)) {
        event.preventDefault();
        setIsOpen(true);
      } else if (event.key === 'Enter' && value) {
        // Farmer already chosen: Enter moves on instead of reopening the list.
        event.preventDefault();
        onPicked?.(value);
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted(prev => (prev + 1 < results.length ? prev + 1 : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted(prev => (prev - 1 >= 0 ? prev - 1 : results.length - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const choice = results[highlighted];
      if (choice) pick(choice.id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      setSearch(selectedName);
    } else if (event.key === 'Tab') {
      setIsOpen(false);
      setSearch(selectedName);
    }
  };

  const activeId = isOpen && results[highlighted] ? `${listId}-${results[highlighted].id}` : undefined;

  return (
    <div className="relative w-full" ref={rootRef}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-faint" aria-hidden="true" />
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          spellCheck={false}
          className={cn(controlClass, size === 'lg' ? 'h-12 text-[15px]' : 'h-10', 'pl-10 pr-10 font-semibold')}
          placeholder={placeholder}
          value={search}
          onFocus={event => { setIsOpen(true); event.currentTarget.select(); }}
          onChange={event => { setSearch(event.target.value); setIsOpen(true); }}
          onKeyDown={onKeyDown}
          {...aria}
        />
        {value ? (
          <button
            type="button"
            aria-label="Chuna hua naam hatayen"
            title="Chuna hua naam hatayen"
            onClick={event => {
              event.stopPropagation();
              onChange('');
              setSearch('');
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-fg-faint transition-colors hover:bg-surface-2 hover:text-danger-fg"
          >
            <X size={15} />
          </button>
        ) : (
          <ChevronDown
            aria-hidden="true"
            className={cn('pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-faint transition-transform duration-200', isOpen && 'rotate-180 text-brand-fg')}
          />
        )}
      </div>

      {isOpen && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Suppliers"
          className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-72 overflow-y-auto rounded-card border border-line bg-surface p-1 shadow-e2"
        >
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-fg-subtle">
              <User className="mx-auto mb-1.5 text-fg-faint" size={20} aria-hidden="true" />
              <p className="font-semibold text-fg-muted">Koi supplier / gwala nahi mila</p>
              <p className="mt-0.5 text-[11px]">&ldquo;{search}&rdquo; se koi match nahi hua</p>
            </div>
          ) : (
            <>
              {results.map((supplier, index) => (
                <SupplierOption
                  key={supplier.id}
                  supplier={supplier}
                  optionId={`${listId}-${supplier.id}`}
                  index={index}
                  selected={supplier.id === value}
                  highlighted={index === highlighted}
                  onPick={pick}
                  onHover={setHighlighted}
                />
              ))}
              {total > results.length && (
                <p className="px-3 py-2 text-center text-[11px] text-fg-subtle">
                  {total - results.length} aur. Naam likh kar talaash chhoti karein.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

const SupplierOption = memo(function SupplierOption({
  supplier, optionId, index, selected, highlighted, onPick, onHover,
}: {
  supplier: any;
  optionId: string;
  index: number;
  selected: boolean;
  highlighted: boolean;
  onPick: (id: string) => void;
  onHover: (index: number) => void;
}) {
  const balance = balanceOf(supplier);
  const place = [supplier.village || supplier.city, supplier.phone].filter(Boolean).join(' · ');
  return (
    <div
      id={optionId}
      role="option"
      aria-selected={selected}
      data-index={index}
      // mousedown keeps focus in the input so Enter-to-continue still works after a click.
      onMouseDown={event => event.preventDefault()}
      onClick={() => onPick(supplier.id)}
      onMouseEnter={() => onHover(index)}
      className={cn(
        'flex cursor-pointer items-center justify-between gap-2.5 rounded-control px-2.5 py-2 text-xs transition-colors duration-100',
        highlighted ? 'bg-surface-2' : 'hover:bg-surface-2/60',
        selected && 'bg-brand-soft/70',
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        <Avatar name={supplier.name} owed={balance > 0} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[13px] font-bold text-fg">{supplier.name}</span>
            {supplier.default_milk_type && (
              <span className="rounded-md bg-surface-2 px-1.5 text-[10px] font-semibold text-fg-subtle ring-1 ring-inset ring-line">
                {supplier.default_milk_type}{Number(supplier.default_rate) > 0 ? ` @ Rs ${formatRate(supplier.default_rate)}` : ''}
              </span>
            )}
          </span>
          {place && <span className="mt-0.5 block truncate text-[11px] text-fg-subtle">{place}</span>}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {balance !== 0 ? (
          <span className={cn('text-[11px] font-bold', balance > 0 ? 'text-danger-fg' : 'text-success-fg')}>
            <Money amount={Math.abs(balance)} /> {balance > 0 ? 'Due' : 'Adv'}
          </span>
        ) : (
          <span className="text-[11px] font-semibold text-fg-faint">Clear</span>
        )}
        {selected && <Check size={14} className="text-brand-fg" aria-hidden="true" />}
      </span>
    </div>
  );
});
