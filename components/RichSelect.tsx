import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, X, Check } from 'lucide-react';

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

  const selectedOption = options.find(o => o.value === value);
  const canClear = allowClear && !required && !disabled && Boolean(value);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        e.stopPropagation();
        setIsOpen(false);
        setSearchTerm('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown, true);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen]);

  const filteredOptions = options.filter(option => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      option.label.toLowerCase().includes(term) ||
      (option.subLabel && option.subLabel.toLowerCase().includes(term)) ||
      (option.badge?.text && option.badge.text.toLowerCase().includes(term))
    );
  });

  const getBadgeStyle = (variant?: 'red' | 'green' | 'blue' | 'amber' | 'slate') => {
    switch (variant) {
      case 'red':
        return 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800';
      case 'green':
        return 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
      case 'blue':
        return 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800';
      case 'amber':
        return 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
      default:
        return 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700';
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setSearchTerm('');
  };

  return (
    <div className={`relative w-full ${className}`} ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setIsOpen(!isOpen);
            setSearchTerm('');
          }
        }}
        className={`w-full ${compact ? 'min-h-[38px] py-1.5 px-3 rounded-lg text-xs sm:text-sm' : 'min-h-[42px] px-3 py-2 rounded-xl text-xs sm:text-sm'} bg-white dark:bg-slate-800 border flex items-center justify-between gap-2 text-left transition-all shadow-2xs outline-none group cursor-pointer ${disabled
            ? 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 opacity-60 cursor-not-allowed'
            : isOpen
              ? 'border-lime-500 dark:border-lime-400 ring-2 ring-lime-500/20 shadow-xs'
              : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
          } ${buttonClassName}`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {selectedOption?.icon ? (
            <div className="text-slate-500 dark:text-slate-400 shrink-0">{selectedOption.icon}</div>
          ) : selectedOption?.avatarLetter ? (
            <div className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${selectedOption.avatarBg || 'bg-lime-100 dark:bg-lime-900/50 text-lime-800 dark:text-lime-300'
              }`}>
              {selectedOption.avatarLetter}
            </div>
          ) : null}

          {selectedOption ? (
            <div className="min-w-0 flex-1 flex items-center justify-between gap-1.5">
              <div className="min-w-0">
                <span className="font-semibold text-slate-900 dark:text-slate-100 block truncate">
                  {selectedOption.label}
                </span>
                {selectedOption.subLabel && (
                  <span className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 block truncate">
                    {selectedOption.subLabel}
                  </span>
                )}
              </div>
              {selectedOption.badge && (
                <span className={`hidden sm:inline-block text-[10px] sm:text-[11px] font-bold font-mono px-1.5 py-0.2 rounded-md border shrink-0 ${getBadgeStyle(selectedOption.badge.variant)}`}>
                  {selectedOption.badge.text}
                </span>
              )}
            </div>
          ) : (
            <span className="text-slate-400 dark:text-slate-500 font-medium">{placeholder}</span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {canClear && (
            <span
              role="button"
              tabIndex={0}
              title="Deselect / Clear"
              onClick={handleClear}
              className="p-1 rounded-md text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
            >
              <X size={14} />
            </span>
          )}
          <ChevronDown size={14} className={`text-slate-400 dark:text-slate-400 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180 text-lime-600 dark:text-lime-400' : ''}`} />
        </div>
      </button>

      {/* Floating Dropdown Panel */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl dark:shadow-2xl dark:shadow-black/60 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {enableSearch && options.length > 4 && (
            <div className="p-2 border-b border-slate-100 dark:border-slate-700/80 bg-slate-50/70 dark:bg-slate-900/70">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input
                  type="text"
                  placeholder={searchPlaceholder}
                  className="w-full pl-8 pr-7 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-medium text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-lime-500 transition-all shadow-2xs"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  autoFocus
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Options List */}
          <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/50 p-1 scrollbar-thin">
            {canClear && (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setIsOpen(false);
                  setSearchTerm('');
                }}
                className="w-full text-left px-3 py-1.5 rounded-xl flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50/60 dark:hover:bg-rose-950/30 transition-all mb-0.5 cursor-pointer"
              >
                <X size={13} className="text-slate-400" />
                <span className="font-semibold text-[11px]">Deselect / None</span>
              </button>
            )}

            {filteredOptions.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-slate-400 dark:text-slate-500 italic">
                {emptyText}
              </div>
            ) : (
              filteredOptions.map(option => {
                const isSelected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={option.disabled}
                    onClick={() => {
                      if (!option.disabled) {
                        if (isSelected && canClear) {
                          onChange('');
                        } else {
                          onChange(option.value);
                        }
                        setIsOpen(false);
                        setSearchTerm('');
                      }
                    }}
                    className={`w-full text-left px-3 py-2 rounded-xl flex items-center justify-between gap-2 text-xs transition-all cursor-pointer ${option.disabled
                        ? 'opacity-40 cursor-not-allowed'
                        : isSelected
                          ? 'bg-lime-50/90 dark:bg-lime-950/60 text-lime-950 dark:text-lime-200 font-semibold'
                          : 'hover:bg-slate-100/80 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200'
                      }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      {option.icon ? (
                        <div className={`shrink-0 ${isSelected ? 'text-lime-700 dark:text-lime-400' : 'text-slate-500 dark:text-slate-400'}`}>
                          {option.icon}
                        </div>
                      ) : option.avatarLetter ? (
                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${option.avatarBg || 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                          }`}>
                          {option.avatarLetter}
                        </div>
                      ) : null}

                      <div className="min-w-0 flex-1">
                        <span className={`block truncate ${isSelected ? 'font-bold text-slate-900 dark:text-white' : 'font-medium text-slate-800 dark:text-slate-200'}`}>
                          {option.label}
                        </span>
                        {option.subLabel && (
                          <span className="block text-[10px] text-slate-400 dark:text-slate-400 truncate mt-0.5">
                            {option.subLabel}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {option.badge && (
                        <span className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded-md border ${getBadgeStyle(option.badge.variant)}`}>
                          {option.badge.text}
                        </span>
                      )}
                      {isSelected && (
                        <Check size={14} className="text-lime-700 dark:text-lime-400 shrink-0 ml-1" />
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

export default RichSelect;
