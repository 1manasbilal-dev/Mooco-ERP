import React from 'react';
import { User, UserPlus, X, ChevronDown, Check, PauseCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatCurrency } from '../../lib/formatters';

const MotionDiv = motion.div as any;

interface PosCustomerSelectProps {
  customerContainerRef: React.RefObject<HTMLDivElement | null>;
  customerSearchInputRef: React.RefObject<HTMLInputElement | null>;
  customerSearch: string;
  setCustomerSearch: (val: string) => void;
  customerDropdownOpen: boolean;
  setCustomerDropdownOpen: (open: boolean) => void;
  selectedCustomerId: string;
  setSelectedCustomerId: (id: string) => void;
  customers: any[];
  filteredCustomers: any[];
  setNewCustomerModalOpen: (open: boolean) => void;
  cartLength: number;
  handleHoldOrder: () => void;
  paymentMode?: string;
}

export const PosCustomerSelect: React.FC<PosCustomerSelectProps> = ({
  customerContainerRef,
  customerSearchInputRef,
  customerSearch,
  setCustomerSearch,
  customerDropdownOpen,
  setCustomerDropdownOpen,
  selectedCustomerId,
  setSelectedCustomerId,
  customers,
  filteredCustomers,
  setNewCustomerModalOpen,
  cartLength,
  handleHoldOrder,
  paymentMode
}) => {
  const selectedCustomer = (customers || []).find(c => c.id === selectedCustomerId);

  return (
    <div className="pos-customer-select p-2.5 bg-slate-50/70 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2" ref={customerContainerRef}>
      <div className="relative flex-1">
        <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
          <User size={15} />
        </div>
        <input
          ref={customerSearchInputRef}
          type="text"
          aria-label="Search or select customer"
          placeholder="Select or Search Customer... [F4]"
          className="w-full pl-8 pr-7 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-lime-500/20 focus:border-lime-500 transition-all shadow-sm"
          value={customerDropdownOpen ? customerSearch : (selectedCustomer ? selectedCustomer.name : 'Walk-in Customer')}
          onFocus={() => {
            setCustomerDropdownOpen(true);
            if (!selectedCustomerId) {
              setCustomerSearch('');
            } else {
              setCustomerSearch(selectedCustomer?.name || '');
            }
          }}
          onChange={e => {
            setCustomerSearch(e.target.value);
            setCustomerDropdownOpen(true);
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (filteredCustomers.length > 0) {
                setSelectedCustomerId(filteredCustomers[0].id);
                setCustomerSearch('');
                setCustomerDropdownOpen(false);
              }
            }
          }}
        />
        {selectedCustomerId ? (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 z-10">
            {paymentMode === 'Credit' && (
              <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded text-[10px] font-bold tracking-wide">
                📒 Khata
              </span>
            )}
            <button aria-label="Reset to Walk-in Customer"
              type="button"
              onClick={() => {
                setSelectedCustomerId('');
                setCustomerSearch('');
              }}
              className="text-slate-400 hover:text-red-500 transition-colors p-0.5 cursor-pointer"
              title="Reset to Walk-in Customer"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
            <ChevronDown size={14} />
          </div>
        )}

        <AnimatePresence>
          {customerDropdownOpen && (
            <MotionDiv
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="absolute left-0 right-0 z-50 mt-1 bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden max-h-56 overflow-y-auto"
            >
              <div className="p-1">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCustomerId('');
                    setCustomerSearch('');
                    setCustomerDropdownOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors cursor-pointer ${
                    !selectedCustomerId 
                      ? 'bg-lime-50 dark:bg-lime-950/40 text-lime-700 dark:text-lime-300 font-bold' 
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                    Walk-in Customer (General)
                  </span>
                  {!selectedCustomerId && <Check size={13} className="text-lime-600 dark:text-lime-400" />}
                </button>

                {filteredCustomers.length > 0 ? (
                  filteredCustomers.map(c => {
                    const isSelected = selectedCustomerId === c.id;
                    const bal = Number(c.balance || 0);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedCustomerId(c.id);
                          setCustomerSearch('');
                          setCustomerDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs text-left transition-colors cursor-pointer ${
                          isSelected 
                            ? 'bg-lime-50 dark:bg-lime-950/40 text-lime-700 dark:text-lime-300 font-bold' 
                            : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-800 dark:text-slate-100 truncate">
                              {c.name}
                            </span>
                            {bal > 0 ? (
                              <span className="text-xs font-bold px-1.5 py-0.2 rounded bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 font-mono">
                                Due {formatCurrency(bal)}
                              </span>
                            ) : bal < 0 ? (
                              <span className="text-xs font-bold px-1.5 py-0.2 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-mono">
                                Adv {formatCurrency(Math.abs(bal))}
                              </span>
                            ) : null}
                          </div>
                          <span className="text-[10px] text-slate-400 truncate">Ph: {c.phone || 'N/A'}{c.city ? ` • ${c.city}` : ''}</span>
                        </div>
                        {isSelected && <Check size={13} className="text-lime-600 dark:text-lime-400 shrink-0" />}
                      </button>
                    );
                  })
                ) : (
                  <div className="p-3 text-center text-xs text-slate-400">
                    No customer found matching "{customerSearch}"
                  </div>
                )}
              </div>
            </MotionDiv>
          )}
        </AnimatePresence>
      </div>

      <button aria-label="Quick Add Customer"
        type="button"
        onClick={() => setNewCustomerModalOpen(true)}
        className="p-1.5 bg-lime-600 hover:bg-lime-700 text-white rounded-lg shadow-sm transition-all active:scale-95 flex items-center justify-center shrink-0 cursor-pointer"
        title="Quick Add Customer"
      >
        <UserPlus size={15} />
      </button>

      {cartLength > 0 && (
        <button 
          onClick={handleHoldOrder} 
          className="px-2 py-1.5 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded-lg text-xs font-bold hover:bg-amber-100 dark:hover:bg-amber-900/50 flex items-center gap-1 transition-all shrink-0 shadow-sm cursor-pointer"
          title="Hold Current Order (F8)"
        >
          <PauseCircle size={13} /> Hold
        </button>
      )}
    </div>
  );
};
