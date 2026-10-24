import React, { useState, useRef, useEffect, useId, useMemo } from 'react';
import { ChevronDown, Search, X, Check } from 'lucide-react';
import { cn } from '../lib/cn';

export interface RichSelectOption {
  value: string;
  label: string;
  subLabel?: string;
  badge?: {
    text: string;
    variant?: 'red' | 'green' | 'blue' | 'amber' | 'slate';
  };
  icon?: React.ReactNode;
  avatarLetter?: string;
  avatarBg?: string;
  disabled?: boolean;
}

interface RichSelectProps {
  options: RichSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
  enableSearch?: boolean;
  emptyText?: string;
  compact?: boolean;
  buttonClassName?: string;
}

// Rings, not borders: the legacy dark layer in index.css repaints every `.border` and would hide the tones.
const BADGE_STYLE: Record<NonNullable<NonNullable<RichSelectOption['badge']>['variant']>, string> = {
  red: 'bg-danger-soft text-danger-fg ring-danger/20',
  green: 'bg-success-soft text-success-fg ring-success/20',
  blue: 'bg-info-soft text-info-fg ring-info/20',
  amber: 'bg-warning-soft text-warning-fg ring-warning/25',
  slate: 'bg-surface-2 text-fg-muted ring-line',
};
const badgeStyle = (variant?: keyof typeof BADGE_STYLE) => BADGE_STYLE[variant || 'slate'];

export const RichSelect: React.FC<RichSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select option...',
  searchPlaceholder = 'Search...',
  required = false,
  disabled = false,
  allowClear = true,
  className = '',
  enableSearch = true,
  emptyText = 'No options found',
  compact = false,
  buttonClassName = ''
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selectedOption = options.find(o => o.value === value);
  const canClear = allowClear && !required && !disabled && Boolean(value);

  const close = (restoreFocus = false) => {
    setIsOpen(false);
    setSearchTerm('');
    // Focus was on the option that is about to disappear: hand it back to the trigger,
    // unless the parent's onChange already moved it on to the next field.
    const active = document.activeElement;
    if (restoreFocus && (!active || active === document.body || dropdownRef.current?.contains(active))) {
      triggerRef.current?.focus({ preventScroll: true });
    }
  };

  // Listen only while open: a form can hold many selects, and each one used to watch every click.
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Closes this list only, never the dialog it sits in.
        e.stopPropagation();
        const hadFocus = dropdownRef.current?.contains(document.activeElement);
        setIsOpen(false);
        setSearchTerm('');
        if (hadFocus) triggerRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return options;
    return options.filter(option => (
      option.label.toLowerCase().includes(term) ||
      (option.subLabel && option.subLabel.toLowerCase().includes(term)) ||
      (option.badge?.text && option.badge.text.toLowerCase().includes(term))
    ));
  }, [options, searchTerm]);

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setSearchTerm('');
  };

  // Up / Down move between the options (and back to the search box); Enter picks as before.
  const moveFocus = (step: 1 | -1) => {
    const items: HTMLButtonElement[] = Array.from((listRef.current as HTMLDivElement | null)?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) { (step === 1 ? items[0] : items[items.length - 1]).focus(); return; }
    const next = index + step;
    if (next < 0) {
      const search = (dropdownRef.current as HTMLDivElement | null)?.querySelector<HTMLInputElement>('input[type="text"]');
      (search || items[items.length - 1]).focus();
    } else {
      items[Math.min(next, items.length - 1)].focus();
    }
  };
  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1); }
  };

  const showSearch = enableSearch && options.length > 4;

  return (
    <div className={cn('relative w-full', className)} ref={dropdownRef}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        onClick={() => {
          if (!disabled) {
            setIsOpen(!isOpen);
            setSearchTerm('');
          }
        }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' && !disabled) {
            e.preventDefault();
            if (!isOpen) setIsOpen(true);
            else moveFocus(1);
          }
        }}
        className={cn(
          // `ds-control` keeps the legacy dark-mode border repaint off this control.
          'ds-control group flex w-full cursor-pointer items-center justify-between gap-2 border bg-surface text-left text-xs shadow-e1 outline-none transition-[border-color,box-shadow] duration-150 sm:text-sm',
          compact ? 'min-h-[38px] rounded-lg px-3 py-1.5' : 'min-h-[42px] rounded-control px-3 py-2',
          canClear && 'pr-9',
          disabled
            ? 'cursor-not-allowed border-line bg-surface-2 opacity-60'
            : isOpen
              ? 'border-brand-accent ring-4 ring-ring/20'
              : 'border-line hover:border-line-strong focus-visible:border-brand-accent focus-visible:ring-4 focus-visible:ring-ring/20',
          buttonClassName,
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {selectedOption?.icon ? (
            <div className="shrink-0 text-fg-subtle">{selectedOption.icon}</div>
          ) : selectedOption?.avatarLetter ? (
            <div className={cn('flex size-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold', selectedOption.avatarBg || 'bg-brand-soft text-brand-fg')}>
              {selectedOption.avatarLetter}
            </div>
          ) : null}

          {selectedOption ? (
            <div className="flex min-w-0 flex-1 items-center justify-between gap-1.5">
              <div className="min-w-0">
                <span className="block truncate font-semibold text-fg">
                  {selectedOption.label}
                </span>
                {selectedOption.subLabel && (
                  <span className="block truncate text-[10px] text-fg-subtle sm:text-[11px]">
                    {selectedOption.subLabel}
                  </span>
                )}
              </div>
              {selectedOption.badge && (
                <span className={cn('hidden shrink-0 rounded-md px-1.5 py-px font-mono text-[10px] font-bold ring-1 ring-inset sm:inline-block sm:text-[11px]', badgeStyle(selectedOption.badge.variant))}>
                  {selectedOption.badge.text}
                </span>
              )}
            </div>
          ) : (
            <span className="truncate font-medium text-fg-faint">{placeholder}</span>
          )}
        </div>

        <ChevronDown size={14} aria-hidden="true" className={cn('shrink-0 text-fg-faint transition-transform duration-200', isOpen && 'rotate-180 text-brand-accent')} />
      </button>

      {/* A real button beside the trigger (not nested in it), so Enter / Space clear from the keyboard too. */}
      {canClear && (
        <button
          type="button"
          title="Deselect / Clear"
          aria-label="Deselect / Clear"
          onClick={handleClear}
          className="absolute right-7 top-1/2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-danger-soft hover:text-danger-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X size={14} />
        </button>
      )}

      {isOpen && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-card border border-line bg-surface shadow-e2 animate-in fade-in zoom-in-95 duration-150">
          {showSearch && (
            <div className="border-b border-line bg-surface-2/60 p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint" size={14} aria-hidden="true" />
                <input
                  type="text"
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  aria-controls={listId}
                  className="ds-control w-full rounded-lg border border-line bg-surface py-1.5 pl-8 pr-7 text-xs font-medium text-fg outline-none transition-[border-color,box-shadow] placeholder:text-fg-faint focus:border-brand-accent focus:ring-2 focus:ring-ring/20"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); } }}
                  autoFocus
                />
                {searchTerm && (
                  <button aria-label="Clear search"
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-fg-faint hover:text-fg"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
          )}

          <div ref={listRef} id={listId} role="listbox" onKeyDown={onListKeyDown} className="max-h-56 space-y-px overflow-y-auto overscroll-contain p-1">
            {canClear && (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  close(true);
                }}
                className="mb-0.5 flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs text-fg-subtle transition-colors hover:bg-danger-soft hover:text-danger-fg focus-visible:bg-danger-soft focus-visible:text-danger-fg focus-visible:outline-none"
              >
                <X size={13} aria-hidden="true" />
                <span className="text-[11px] font-semibold">Deselect / None</span>
              </button>
            )}

            {filteredOptions.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs italic text-fg-faint">
                {emptyText}
              </div>
            ) : (
              filteredOptions.map(option => {
                const isSelected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={option.disabled}
                    onClick={() => {
                      if (!option.disabled) {
                        if (isSelected && canClear) {
                          onChange('');
                        } else {
                          onChange(option.value);
                        }
                        close(true);
                      }
                    }}
                    className={cn(
                      'flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none',
                      option.disabled
                        ? 'cursor-not-allowed opacity-40'
                        : isSelected
                          ? 'bg-brand-soft text-brand-fg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
                          : 'text-fg-muted hover:bg-surface-2 focus-visible:bg-surface-2'
                    )}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      {option.icon ? (
                        <div className={cn('shrink-0', isSelected ? 'text-brand-accent' : 'text-fg-subtle')}>
                          {option.icon}
                        </div>
                      ) : option.avatarLetter ? (
                        <div className={cn('flex size-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold', option.avatarBg || 'bg-surface-2 text-fg-muted')}>
                          {option.avatarLetter}
                        </div>
                      ) : null}

                      <div className="min-w-0 flex-1">
                        <span className={cn('block truncate', isSelected ? 'font-bold text-fg' : 'font-medium text-fg')}>
                          {option.label}
                        </span>
                        {option.subLabel && (
                          <span className="mt-0.5 block truncate text-[10px] text-fg-subtle">
                            {option.subLabel}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {option.badge && (
                        <span className={cn('rounded-md px-2 py-0.5 font-mono text-[10px] font-bold ring-1 ring-inset', badgeStyle(option.badge.variant))}>
                          {option.badge.text}
                        </span>
                      )}
                      {isSelected && (
                        <Check size={14} className="ml-1 shrink-0 text-brand-accent" aria-hidden="true" />
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
