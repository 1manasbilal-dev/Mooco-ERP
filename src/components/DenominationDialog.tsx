import React from 'react';
import { createPortal } from 'react-dom';
import { Banknote, X, RotateCcw, Check } from 'lucide-react';
import { formatCurrency } from '../lib/formatters';

export const DENOMINATIONS = [5000, 1000, 500, 100, 50, 20, 10, 5, 1];

export const money = (value: number | undefined | null) =>
  formatCurrency(value);

export const splitDenominations = (source: Record<string | number, number>, requestedAmount: number) => {
  let remaining = Math.max(0, Math.round(requestedAmount * 100) / 100);
  const result: Record<string | number, number> = {};
  for (const denomination of DENOMINATIONS) {
    const available = Math.max(0, Number(source[denomination] || 0));
    const take = Math.min(available, Math.floor((remaining + 0.001) / denomination));
    if (take > 0) {
      result[denomination] = take;
      remaining = Math.round((remaining - take * denomination) * 100) / 100;
    }
  }
  return Math.abs(remaining) < 0.01 ? result : {};
};

export interface DenominationDialogProps {
  open: boolean;
  onClose: () => void;
  value: Record<string | number, number>;
  onChange: (next: Record<string | number, number>) => void;
  onApply: (total: number) => void;
  title?: string;
  subtitle?: string;
}

export const DenominationDialog: React.FC<DenominationDialogProps> = ({
  open,
  onClose,
  value,
  onChange,
  onApply,
  title = 'Cash Denomination Count',
  subtitle = 'Enter quantity for each currency note and coin'
}) => {
  // Hooks must run before the early return, otherwise the Escape listener is never cleaned up.
  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const total = DENOMINATIONS.reduce((sum, denomination) => sum + denomination * Number(value[denomination] || 0), 0);
  const totalNotes = DENOMINATIONS.reduce((sum, denomination) => sum + Number(value[denomination] || 0), 0);

  const handleClear = () => {
    onChange({});
  };

  const handleApply = () => {
    onApply(total);
    onClose();
  };

  const updateCount = (denomination: number, count: number) => {
    const next = { ...value };
    if (count > 0) {
      next[denomination] = count;
    } else {
      delete next[denomination];
    }
    onChange(next);
  };

  const dialogContent = (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-xs" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200">
        
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/40 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-lime-500/15 dark:bg-lime-950/60 text-lime-600 dark:text-lime-400 flex items-center justify-center font-bold shrink-0">
              <Banknote size={20} />
            </div>
            <div>
              <h4 className="font-black text-sm sm:text-base text-slate-900 dark:text-white flex items-center gap-2">
                {title}
              </h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {subtitle}
              </p>
            </div>
          </div>
          <button aria-label="Band karein" 
            type="button" 
            onClick={onClose} 
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 bg-gradient-to-r from-slate-900 to-slate-800 dark:from-slate-950 dark:to-slate-900 text-white shrink-0 border-b border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-black tracking-wider text-slate-400 block">
              Total Cash Count
            </span>
            <span className="text-xl sm:text-2xl font-black font-mono text-lime-400">
              {money(total)}
            </span>
          </div>
          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">
              Total Notes / Coins
            </span>
            <span className="text-xs sm:text-sm font-bold bg-white/10 px-2.5 py-1 rounded-lg inline-block mt-0.5">
              {totalNotes} {totalNotes === 1 ? 'Piece' : 'Pieces'}
            </span>
          </div>
        </div>

        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3">
            {DENOMINATIONS.map(denomination => {
              const qty = Number(value[denomination] || 0);
              const subtotal = denomination * qty;

              return (
                <div 
                  key={denomination} 
                  className={`p-3 rounded-2xl border transition-all ${
                    qty > 0 
                      ? 'border-lime-400 dark:border-lime-700/80 bg-lime-50/40 dark:bg-lime-950/20 shadow-2xs' 
                      : 'border-slate-200/90 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold mb-1.5">
                    <span className="text-slate-700 dark:text-slate-300 font-mono">
                      {formatCurrency(denomination)}
                    </span>
                    <span className={`text-[11px] font-mono ${qty > 0 ? 'text-lime-600 dark:text-lime-400 font-black' : 'text-slate-400'}`}>
                      {qty > 0 ? money(subtotal) : '—'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={qty > 0 ? qty : ''}
                      onChange={e => {
                        const val = parseInt(e.target.value, 10);
                        updateCount(denomination, isNaN(val) ? 0 : Math.max(0, val));
                      }}
                      placeholder="0"
                      className="w-full text-center font-bold text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl py-1.5 focus:border-lime-500 focus:ring-1 focus:ring-lime-500 outline-hidden"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-4 sm:p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 shrink-0 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleClear}
            disabled={total === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl transition-colors disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          >
            <RotateCcw size={14} /> Clear
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-black bg-lime-600 hover:bg-lime-500 dark:bg-lime-500 dark:hover:bg-lime-400 text-white dark:text-slate-950 shadow-md shadow-lime-600/20 cursor-pointer transition-all"
            >
              <Check size={15} /> Apply ({formatCurrency(total)})
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(dialogContent, document.body) : dialogContent;
};
