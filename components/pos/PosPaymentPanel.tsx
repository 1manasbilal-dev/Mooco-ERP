import React from 'react';
import { Banknote, Wallet, ChevronDown, Check, Tag, Loader2, BookOpen } from 'lucide-react';
import { SmartNumberInput } from '../SmartNumberInput';
import { formatCurrency } from '../../lib/formatters';

interface PosPaymentPanelProps {
  cart: any[];
  paymentMode: string;
  setPaymentMode: (mode: string) => void;
  selectedCustomerId: string;
  customerPaidAmount: string;
  setCustomerPaidAmount: (amt: string) => void;
  customerDueAmount: number;
  customerChangeReturn: number;
  cashReceived: string;
  setCashReceived: (val: string) => void;
  cashGiven: number;
  discountType: 'flat' | 'percent';
  setDiscountType: (type: 'flat' | 'percent') => void;
  discountValue: string;
  setDiscountValue: (val: string) => void;
  subtotal: number;
  discountAmount: number;
  totalItemDiscount: number;
  grandTotal: number;
  isSubmitting: boolean;
  activeShiftSession: any;
  handleCheckout: () => void;
  lockDiscount?: boolean;
}

export const PosPaymentPanel: React.FC<PosPaymentPanelProps> = ({
  cart,
  paymentMode,
  setPaymentMode,
  selectedCustomerId,
  customerPaidAmount,
  setCustomerPaidAmount,
  customerDueAmount,
  customerChangeReturn,
  cashReceived,
  setCashReceived,
  cashGiven,
  discountType,
  setDiscountType,
  discountValue,
  setDiscountValue,
  subtotal,
  discountAmount,
  totalItemDiscount,
  grandTotal,
  isSubmitting,
  activeShiftSession,
  handleCheckout,
  lockDiscount = false
}) => {
  // A walk-in has no khata to carry the unpaid part, so a short cash payment cannot be completed.
  const walkInShort = !selectedCustomerId && paymentMode === 'Cash' && cashGiven > 0 && cashGiven < grandTotal
    ? Math.round((grandTotal - cashGiven) * 100) / 100
    : 0;

  return (
    <div className="pos-payment-panel p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 space-y-2.5 shrink-0 shadow-lg z-10">
      
      {/* Mobile Payment Mode & Discount */}
      <div className="md:hidden space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="relative">
            <select
              value={paymentMode}
              onChange={e => {
                const newMode = e.target.value;
                setPaymentMode(newMode);
                if (newMode === 'Credit') {
                  setCustomerPaidAmount('0');
                } else if (customerPaidAmount === '0') {
                  setCustomerPaidAmount('');
                }
              }}
              className="w-full pl-2.5 pr-7 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/70 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-slate-100 outline-none focus:border-lime-500 appearance-none transition-colors cursor-pointer"
            >
              <option value="Cash">💵 Cash</option>
              <option value="Online">💳 Online / Bank</option>
              {selectedCustomerId && <option value="Credit">📒 Khata / Credit (Udhar)</option>}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>

          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-2 py-1">
            <button 
              type="button"
              onClick={() => setDiscountType(discountType === 'flat' ? 'percent' : 'flat')}
              disabled={lockDiscount}
              className="px-1.5 py-0.5 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded text-[10px] font-bold shadow-xs shrink-0 cursor-pointer"
              title="Toggle Rs / % Discount"
            >
              {discountType === 'flat' ? 'Rs' : '%'}
            </button>
            <SmartNumberInput 
              placeholder="0"
              aria-label="Sale discount" value={discountValue}
              disabled={lockDiscount}
              onChange={setDiscountValue}
              className="w-full text-right font-mono font-bold text-xs bg-transparent outline-none text-slate-900 dark:text-slate-100"
            />
          </div>
        </div>

        {/* Mobile Cash Received (When Cash mode is active & walk-in) */}
        {!selectedCustomerId && paymentMode === 'Cash' && cart.length > 0 && (
          <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-600 dark:text-slate-400">Cash Received:</span>
              <div className="flex items-center gap-1">
                <span className="text-xs font-bold text-slate-400">Rs</span>
                <SmartNumberInput
                  placeholder="0.00"
                  aria-label="Cash received" value={cashReceived}
                  onChange={setCashReceived}
                  className="w-28 px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-right font-mono font-bold text-slate-900 dark:text-slate-100 text-xs outline-none focus:border-lime-500 shadow-inner"
                  wrapperClassName="w-auto"
                />
              </div>
            </div>
            {cashGiven > 0 && (
              <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-200 dark:border-slate-700">
                <span className="font-semibold text-slate-500 dark:text-slate-400">Change:</span>
                <span className={`font-mono font-bold ${cashGiven >= grandTotal ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                  {cashGiven >= grandTotal ? `${formatCurrency(Math.abs(cashGiven - grandTotal))}` : `Short ${formatCurrency(Math.abs(cashGiven - grandTotal))}`}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Mobile Customer Paid Amount Input */}
        {selectedCustomerId && cart.length > 0 && (
          <div className="p-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl space-y-1.5 animate-in fade-in">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                <Banknote size={13} className={paymentMode === 'Credit' ? 'text-amber-600' : 'text-emerald-600'} /> 
                {paymentMode === 'Credit' ? 'Paid (Optional):' : 'Paid Amount:'}
              </span>
              <div className="flex items-center gap-1">
                <span className="text-xs font-mono text-slate-400">Rs</span>
                <SmartNumberInput
                  step="any"
                  placeholder={paymentMode === 'Credit' ? '0' : grandTotal.toString()}
                  aria-label="Customer payment received" value={customerPaidAmount}
                  onChange={setCustomerPaidAmount}
                  className="w-28 px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-right font-mono font-black text-slate-900 dark:text-slate-100 text-xs outline-none focus:border-lime-500 shadow-inner"
                  wrapperClassName="w-auto"
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px] pt-1 border-t border-slate-200/60 dark:border-slate-700 font-semibold">
              {customerDueAmount > 0 ? (
                <span className="text-amber-700 dark:text-amber-400 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                  Khata / Due: <strong className="font-mono text-amber-900 dark:text-amber-200 font-black">{formatCurrency(customerDueAmount)}</strong>
                </span>
              ) : customerChangeReturn > 0 ? (
                <span className="text-emerald-700 dark:text-emerald-400 font-bold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  Change: <strong className="font-mono text-emerald-900 dark:text-emerald-200 font-black">{formatCurrency(customerChangeReturn)}</strong>
                </span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                  <Check size={11} /> Fully Paid (Rs 0 Due)
                </span>
              )}

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setPaymentMode('Credit');
                    setCustomerPaidAmount('0');
                  }}
                  className="text-[10px] text-amber-700 dark:text-amber-400 font-bold hover:underline cursor-pointer"
                >
                  Full Khata
                </button>
                <span className="text-slate-300 dark:text-slate-600">|</span>
                <button
                  type="button"
                  onClick={() => {
                    if (paymentMode === 'Credit') setPaymentMode('Cash');
                    setCustomerPaidAmount(grandTotal.toString());
                  }}
                  className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer"
                >
                  Full (Rs {grandTotal})
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Desktop Payment Method Selector & Paid/Cash Calculator */}
      <div className="hidden md:block space-y-2.5">
        <div className={`grid ${selectedCustomerId ? 'grid-cols-3' : 'grid-cols-2'} gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700`}>
          {[
            { id: 'Cash', label: 'Cash Payment', icon: Banknote, color: 'text-emerald-600' },
            { id: 'Online', label: 'Online / Bank', icon: Wallet, color: 'text-blue-600' },
            ...(selectedCustomerId ? [{ id: 'Credit', label: 'Khata / Credit', icon: BookOpen, color: 'text-amber-600' }] : [])
          ].map(mode => {
            const isSelected = paymentMode === mode.id;
            const Icon = mode.icon;
            
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => {
                  setPaymentMode(mode.id);
                  if (mode.id === 'Credit') {
                    setCustomerPaidAmount('0');
                  } else if (customerPaidAmount === '0') {
                    setCustomerPaidAmount('');
                  }
                }}
                className={`
                  py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer
                  ${isSelected 
                    ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-sm ring-1 ring-black/5 dark:ring-white/10' 
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'}
                `}
              >
                <Icon size={14} className={isSelected ? mode.color : 'text-slate-400'} />
                {mode.label}
              </button>
            );
          })}
        </div>

        {/* If Customer is Selected on Desktop */}
        {selectedCustomerId && cart.length > 0 ? (
          <div className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2 animate-in fade-in">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                <Banknote size={14} className={paymentMode === 'Credit' ? 'text-amber-600' : 'text-emerald-600'} /> 
                {paymentMode === 'Credit' ? 'Paid Now (Optional):' : 'Amount Paid Now:'}
              </span>
              <div className="flex items-center gap-1 max-w-[170px]">
                <span className="text-xs font-bold text-slate-400 font-mono">Rs</span>
                <SmartNumberInput 
                  step="any"
                  placeholder={paymentMode === 'Credit' ? '0' : grandTotal.toString()}
                  className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-right font-mono font-black text-slate-900 dark:text-slate-100 text-xs outline-none focus:border-lime-500 shadow-inner"
                  aria-label="Customer payment received" value={customerPaidAmount}
                  onChange={setCustomerPaidAmount}
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-xs pt-1.5 border-t border-slate-200/70 dark:border-slate-700">
              {customerDueAmount > 0 ? (
                <span className="text-amber-700 dark:text-amber-400 font-bold flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                  Added to Customer Ledger: <strong className="font-mono text-amber-900 dark:text-amber-200 font-black">{formatCurrency(customerDueAmount)}</strong>
                </span>
              ) : customerChangeReturn > 0 ? (
                <span className="text-emerald-700 dark:text-emerald-400 font-bold flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  Cash Change to Return: <strong className="font-mono text-emerald-900 dark:text-emerald-200 font-black">{formatCurrency(customerChangeReturn)}</strong>
                </span>
              ) : (
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                  <Check size={13} /> Fully Settled (Rs 0 Added to Ledger)
                </span>
              )}

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setPaymentMode('Credit');
                    setCustomerPaidAmount('0');
                  }}
                  className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 hover:bg-amber-200 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 transition-colors cursor-pointer"
                  title="Zero payment received - Add full bill to Khata ledger"
                >
                  Full Khata (Rs 0)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (paymentMode === 'Credit') setPaymentMode('Cash');
                    setCustomerPaidAmount(grandTotal.toString());
                  }}
                  className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 hover:bg-emerald-200 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 transition-colors cursor-pointer"
                  title="Full payment received"
                >
                  Full Paid
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Walk-in Customer Cash Calculator */
          paymentMode === 'Cash' && cart.length > 0 && (
            <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 shrink-0">Cash In:</span>
                <div className="flex items-center gap-1 flex-1 max-w-[150px]">
                  <span className="text-xs font-bold text-slate-400">Rs</span>
                  <SmartNumberInput 
                    placeholder="0.00"
                    className="w-full px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-right font-mono font-bold text-slate-800 dark:text-slate-100 text-xs outline-none focus:border-lime-500 shadow-inner"
                    aria-label="Cash received" value={cashReceived}
                    onChange={setCashReceived}
                  />
                </div>
                
                {cashGiven > 0 && (
                  <div className={`px-2 py-0.5 rounded-md text-xs font-bold font-mono shrink-0 border ${cashGiven >= grandTotal ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800'}`}>
                    {cashGiven >= grandTotal ? `Change: ${formatCurrency(Math.abs(cashGiven - grandTotal))}` : `Short: ${formatCurrency(Math.abs(cashGiven - grandTotal))}`}
                  </div>
                )}
              </div>

              {/* Quick Cash Chips */}
              <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-hide">
                <button onClick={() => setCashReceived(grandTotal.toString())} className="px-2 py-0.5 bg-white dark:bg-slate-700 hover:bg-lime-50 hover:border-lime-400 text-slate-700 dark:text-slate-200 rounded text-[10px] font-bold border border-slate-200 dark:border-slate-600 transition-colors shrink-0 cursor-pointer">Exact</button>
                <button onClick={() => setCashReceived('500')} className="px-2 py-0.5 bg-white dark:bg-slate-700 hover:bg-lime-50 hover:border-lime-400 text-slate-700 dark:text-slate-200 rounded text-[10px] font-bold border border-slate-200 dark:border-slate-600 transition-colors shrink-0 cursor-pointer">500</button>
                <button onClick={() => setCashReceived('1000')} className="px-2 py-0.5 bg-white dark:bg-slate-700 hover:bg-lime-50 hover:border-lime-400 text-slate-700 dark:text-slate-200 rounded text-[10px] font-bold border border-slate-200 dark:border-slate-600 transition-colors shrink-0 cursor-pointer">1000</button>
                <button onClick={() => setCashReceived('2000')} className="px-2 py-0.5 bg-white dark:bg-slate-700 hover:bg-lime-50 hover:border-lime-400 text-slate-700 dark:text-slate-200 rounded text-[10px] font-bold border border-slate-200 dark:border-slate-600 transition-colors shrink-0 cursor-pointer">2000</button>
                <button onClick={() => setCashReceived('5000')} className="px-2 py-0.5 bg-white dark:bg-slate-700 hover:bg-lime-50 hover:border-lime-400 text-slate-700 dark:text-slate-200 rounded text-[10px] font-bold border border-slate-200 dark:border-slate-600 transition-colors shrink-0 cursor-pointer">5000</button>
              </div>
            </div>
          )
        )}

        {/* Desktop Discount Row */}
        {cart.length > 0 && (
          <div className="flex items-center justify-between text-xs px-1">
            <span className="text-slate-500 dark:text-slate-400 font-semibold flex items-center gap-1"><Tag size={12}/> Discount:</span>
            <div className="flex items-center gap-1">
              <button 
                onClick={() => setDiscountType(discountType === 'flat' ? 'percent' : 'flat')}
                disabled={lockDiscount}
                className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded text-[10px] font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              >
                {discountType === 'flat' ? 'Rs' : '%'}
              </button>
              <SmartNumberInput 
                placeholder="0"
                className="w-16 px-1.5 py-0.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md text-right font-mono font-bold text-slate-800 dark:text-slate-100 text-xs outline-none focus:border-lime-500"
                aria-label="Sale discount" value={discountValue}
                disabled={lockDiscount}
                onChange={setDiscountValue}
                wrapperClassName="w-auto"
              />
            </div>
          </div>
        )}
      </div>

      {/* Line item discount indicator */}
      {totalItemDiscount > 0 && (
        <div className="flex items-center justify-between text-xs px-2 py-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800 rounded-lg font-semibold">
          <span className="flex items-center gap-1"><Tag size={11} /> Item Discounts:</span>
          <span className="font-mono font-bold">-{formatCurrency(totalItemDiscount)}</span>
        </div>
      )}

      {/* Totals Summary Row */}
      <div className="flex items-baseline justify-between border-t border-slate-100 dark:border-slate-800 pt-1.5 px-1">
        <div>
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide block">Grand Total</span>
          {(discountAmount > 0 || totalItemDiscount > 0) && (
            <span className="text-xs text-slate-400 line-through font-mono">
              {formatCurrency((subtotal + totalItemDiscount))}
            </span>
          )}
        </div>
        <div className="text-right">
          <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100 font-mono tracking-tight">{formatCurrency(grandTotal)}</span>
        </div>
      </div>
      
      {/* A blank or 0 qty line blocks checkout; handleCheckout shows the same message as a toast. */}
      {cart.some(line => !(Number(line.qty) > 0)) && (
        <p role="status" className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-2 py-1">
          Qty 0 wali line hata dein ya qty likhein
        </p>
      )}

      {walkInShort > 0 && (
        <p role="status" className="text-xs font-semibold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg px-2 py-1">
          {formatCurrency(walkInShort)} kam hain. Poori raqam lein, ya customer select karein taake baqi khaate mein jaye.
        </p>
      )}

      {/* Confirm & Pay Action Button */}
      <button
        type="button" aria-label="Complete sale"
        onClick={handleCheckout}
        disabled={cart.length === 0 || isSubmitting || walkInShort > 0 || !activeShiftSession || activeShiftSession.status !== 'Active'}
        className={`
          w-full py-3.5 rounded-xl font-black text-xs sm:text-sm text-white flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.98]
          ${cart.length > 0 && !isSubmitting && walkInShort === 0 && activeShiftSession && activeShiftSession.status === 'Active'
            ? 'bg-lime-600 hover:bg-lime-700 shadow-lime-600/25 cursor-pointer'
            : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed shadow-none'}
        `}
      >
        {isSubmitting ? (
          <>
            <Loader2 size={17} className="animate-spin" /> Saving Sale to Database...
          </>
        ) : (
          <>
            {paymentMode === 'Online' ? <Wallet size={17} /> : <Banknote size={17} />}
            <span>
              {!activeShiftSession || activeShiftSession.status !== 'Active'
                ? 'Start Shift First — Sale Blocked'
                : selectedCustomerId && customerDueAmount > 0
                ? `Confirm & Post to Ledger (${paymentMode})`
                : `Confirm & Pay (${paymentMode})`}
              <span className="hidden md:inline"> [F9]</span>
            </span>
          </>
        )}
      </button>
    </div>
  );
};
