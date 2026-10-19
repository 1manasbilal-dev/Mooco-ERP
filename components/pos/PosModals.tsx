import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, Check, ShoppingCart, Scale, Zap, PauseCircle, PlayCircle, Trash2, 
  Keyboard, CheckCircle2, Printer, UserPlus, User, Phone, MessageCircle, 
  MapPin, Edit3, Tag, Package, DollarSign, Minus, Plus, Box, ChevronDown 
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { HeldOrder, PosNewCustomerData, LastCompletedSale } from './PosTypes';
import { formatQty, formatCurrency, cleanNumber, cleanQty } from '../../lib/formatters';
import { SmartNumberInput } from '../SmartNumberInput';
import { stepQuickQuantity, stepWholeQuantity } from '../../lib/posQuickEntry';
import { oneUnitLabel, sellLineCaption, sellUnitContains, sellUnitPrice } from '../../lib/sellUnits';

const MotionDiv = motion.div as any;

// ============================================================================
// 1. QUICK AMOUNT & PORTION MODAL
// ============================================================================
export { PosQuickAmountModal } from './PosQuickAmountModal';

// ============================================================================
// 2. HELD ORDERS MODAL
// ============================================================================
interface PosHeldOrdersModalProps {
  open: boolean;
  onClose: () => void;
  heldOrders: HeldOrder[];
  handleRecallOrder: (held: HeldOrder) => void;
  handleDeleteHeldOrder: (heldId: string) => void;
}

export const PosHeldOrdersModal: React.FC<PosHeldOrdersModalProps> = ({
  open,
  onClose,
  heldOrders,
  handleRecallOrder,
  handleDeleteHeldOrder
}) => {
  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
        <MotionDiv initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }} className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden border border-slate-200 dark:border-slate-800 z-[105]">
          <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-between items-center">
            <div>
              <h3 className="font-bold text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <PauseCircle size={20} className="text-amber-500"/> Held / Parked Bills
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Recall parked orders back to POS cart</p>
            </div>
            <button onClick={onClose} className="bg-white dark:bg-slate-800 p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 cursor-pointer">
              <X size={18} className="text-slate-500 dark:text-slate-400"/>
            </button>
          </div>

          <div className="p-6 max-h-[60vh] overflow-y-auto space-y-3">
            {heldOrders.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">
                No orders currently on hold.
              </div>
            ) : (
              heldOrders.map(held => (
                <div key={held.id} className="p-4 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between gap-4 hover:border-amber-400 transition-all">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800 dark:text-slate-100 text-sm">{held.customerName}</span>
                      <span className="text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded font-mono">{held.timestamp}</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{held.cart.length} item(s) • Total: <strong className="text-slate-800 dark:text-slate-100 font-mono">{formatCurrency(held.grandTotal)}</strong></p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => handleRecallOrder(held)}
                      className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded-lg shadow-sm flex items-center gap-1 transition-all cursor-pointer"
                    >
                      <PlayCircle size={14} /> Recall
                    </button>
                    <button 
                      onClick={() => handleDeleteHeldOrder(held.id)}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </MotionDiv>
      </div>
    </AnimatePresence>
  );
};

// ============================================================================
// 3. SHORTCUTS MODAL
// ============================================================================
interface PosShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

export const PosShortcutsModal: React.FC<PosShortcutsModalProps> = ({ open, onClose }) => {
  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
        <MotionDiv initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }} className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-800 z-[105]">
          <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-between items-center">
            <div>
              <h3 className="font-bold text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Keyboard size={20} className="text-lime-600 dark:text-lime-400"/> POS Keyboard Shortcuts
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Fast hands-free counter hotkeys</p>
            </div>
            <button onClick={onClose} className="bg-white dark:bg-slate-800 p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 cursor-pointer">
              <X size={18} className="text-slate-500 dark:text-slate-400"/>
            </button>
          </div>

          <div className="p-6 space-y-3">
            {[
              { key: 'F2', action: 'Focus Product Search' },
              { key: 'F4', action: 'Focus Customer Search / Selector' },
              { key: 'F8', action: 'Hold / Park Current Order' },
              { key: 'F9', action: 'Confirm Sale & Complete Payment' },
              { key: 'Esc', action: 'Close Any Open Modal or Popup' }
            ].map(sc => (
              <div key={sc.key} className="flex justify-between items-center p-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{sc.action}</span>
                <kbd className="px-2.5 py-1 bg-slate-900 text-white font-mono text-xs font-bold rounded-lg shadow-sm">{sc.key}</kbd>
              </div>
            ))}
          </div>
        </MotionDiv>
      </div>
    </AnimatePresence>
  );
};

// ============================================================================
// 4. THERMAL RECEIPT MODAL
// ============================================================================
interface PosReceiptModalProps {
  open: boolean;
  onClose: () => void;
  lastCompletedSale: LastCompletedSale | null;
  settings: any;
}

export const PosReceiptModal: React.FC<PosReceiptModalProps> = ({
  open,
  onClose,
  lastCompletedSale,
  settings
}) => {
  if (!open || !lastCompletedSale) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
        <MotionDiv initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }} className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-200 dark:border-slate-800 z-[105]">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-between items-center">
            <span className="font-bold text-slate-800 dark:text-slate-100 text-sm flex items-center gap-1.5">
              <CheckCircle2 className="text-emerald-600" size={18}/> Sale Completed
            </span>
            <button onClick={onClose} className="bg-white dark:bg-slate-800 p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 cursor-pointer">
              <X size={16} className="text-slate-500 dark:text-slate-400"/>
            </button>
          </div>

          {/* Receipt Paper Card */}
          <div className="p-6 font-mono text-xs space-y-4 max-h-[65vh] overflow-y-auto bg-white text-slate-800" id="printable-pos-receipt">
            <div className="text-center space-y-1 border-b border-dashed border-slate-300 pb-3">
              <h2 className="font-black text-base uppercase tracking-tight">{settings?.general?.companyName || 'Mooco Dairy'}</h2>
              <p className="text-[10px] text-slate-500">{settings?.general?.address || 'Counter POS'}</p>
              <p className="text-[10px] text-slate-500">Ph: {settings?.general?.phone || 'N/A'}</p>
            </div>

            <div className="space-y-1 text-[11px] border-b border-dashed border-slate-300 pb-3">
              <div className="flex justify-between"><span>Inv #:</span><strong>{lastCompletedSale.invoiceNo}</strong></div>
              <div className="flex justify-between"><span>Date:</span><span>{lastCompletedSale.date} {lastCompletedSale.time}</span></div>
              <div className="flex justify-between"><span>Customer:</span><strong>{lastCompletedSale.customerName}</strong></div>
              <div className="flex justify-between"><span>Payment:</span><strong>{lastCompletedSale.paymentMode}</strong></div>
            </div>

            <table className="w-full text-left text-[11px] border-b border-dashed border-slate-300 pb-3">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="py-1">Item</th>
                  <th className="py-1 text-center">Qty</th>
                  <th className="py-1 text-right">Amt</th>
                </tr>
              </thead>
              <tbody>
                {lastCompletedSale.items.map((item: any, idx: number) => (
                  <tr key={idx} className="border-b border-slate-100 last:border-0">
                    <td className="py-1 pr-1 truncate max-w-[120px]">{item.name} {item.variantName ? `(${item.variantName})` : ''}</td>
                    <td className="py-1 text-center">{formatQty(item.qty)}</td>
                    <td className="py-1 text-right">{formatCurrency(item.price * item.qty, '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="space-y-1 text-right text-[11px] font-bold">
              <div className="flex justify-between"><span>Subtotal:</span><span>{formatCurrency(lastCompletedSale.subtotal)}</span></div>
              {lastCompletedSale.discountAmount > 0 && (
                <div className="flex justify-between text-emerald-600"><span>Discount:</span><span>- {formatCurrency(lastCompletedSale.discountAmount)}</span></div>
              )}
              <div className="flex justify-between text-sm border-t border-slate-300 pt-1 font-extrabold text-slate-900">
                <span>TOTAL:</span><span>{formatCurrency(lastCompletedSale.grandTotal)}</span>
              </div>
              <div className="flex justify-between"><span>Paid:</span><span>{formatCurrency(lastCompletedSale.paidAmount)}</span></div>
              {lastCompletedSale.dueAmount > 0 && <div className="flex justify-between text-amber-700"><span>Khata / Due:</span><span>{formatCurrency(lastCompletedSale.dueAmount)}</span></div>}
              {lastCompletedSale.paymentMode === 'Cash' && lastCompletedSale.cashGiven > 0 && (
                <>
                  <div className="flex justify-between text-[10px] text-slate-500 font-normal"><span>Cash Received:</span><span>{formatCurrency(lastCompletedSale.cashGiven)}</span></div>
                  <div className="flex justify-between text-[10px] text-slate-500 font-normal"><span>Change Returned:</span><span>{formatCurrency(lastCompletedSale.changeReturn)}</span></div>
                </>
              )}
            </div>

            <div className="text-center pt-2 border-t border-dashed border-slate-300 text-[10px] text-slate-500">
              Thank you for your visit!
            </div>
          </div>

          <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 flex gap-3">
            <button 
              onClick={() => window.print()}
              className="flex-1 py-2.5 bg-lime-600 hover:bg-lime-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer"
            >
              <Printer size={16} /> Print Receipt
            </button>
            <button 
              onClick={onClose}
              className="py-2.5 px-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs hover:bg-slate-100 cursor-pointer"
            >
              Close
            </button>
          </div>
        </MotionDiv>
      </div>
    </AnimatePresence>
  );
};

// ============================================================================
// 5. QUICK REGISTER CUSTOMER MODAL
// ============================================================================
interface PosNewCustomerModalProps {
  open: boolean;
  onClose: () => void;
  newCustomer: PosNewCustomerData;
  setNewCustomer: React.Dispatch<React.SetStateAction<PosNewCustomerData>>;
  handleCreateCustomer: (e: React.FormEvent) => void;
  isCreatingCustomer: boolean;
}

export const PosNewCustomerModal: React.FC<PosNewCustomerModalProps> = ({
  open,
  onClose,
  newCustomer,
  setNewCustomer,
  handleCreateCustomer,
  isCreatingCustomer
}) => {
  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <MotionDiv 
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          exit={{ opacity: 0 }} 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" 
          onClick={onClose} 
        />
        <MotionDiv 
          initial={{ scale: 0.95, opacity: 0, y: 20 }} 
          animate={{ scale: 1, opacity: 1, y: 0 }} 
          exit={{ scale: 0.95, opacity: 0, y: 20 }} 
          className="relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 dark:border-slate-800 z-[105] max-h-[90vh] flex flex-col"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b bg-gradient-to-r from-lime-50 to-emerald-50 dark:from-slate-800 dark:to-slate-800 border-lime-100 dark:border-slate-750 flex justify-between items-center shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-lime-600 text-white flex items-center justify-center shadow-md shadow-lime-600/20">
                <UserPlus size={20} />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">Quick Register Customer</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Register new customer and auto-select in active bill</p>
              </div>
            </div>
            <button 
              onClick={onClose} 
              className="p-1.5 rounded-full hover:bg-slate-200/80 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
          
          {/* Form */}
          <form onSubmit={handleCreateCustomer} className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                Customer Full Name *
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input 
                  type="text" 
                  required 
                  autoFocus
                  placeholder="e.g. Haji Muhammad Aslam" 
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-800 dark:text-slate-100 outline-none focus:border-lime-500 focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-lime-500/20 transition-all placeholder:text-slate-400 shadow-sm"
                  value={newCustomer.name}
                  onChange={e => setNewCustomer({ ...newCustomer, name: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Phone Number
                </label>
                <div className="relative">
                  <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
                  <input 
                    type="tel" 
                    placeholder="0300-1234567" 
                    className="w-full pl-10 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-slate-800 dark:text-slate-100 outline-none focus:border-lime-500 focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-lime-500/20 transition-all"
                    value={newCustomer.phone}
                    onChange={e => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between p-2.5 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-800/40 rounded-xl">
                <label className="flex items-center gap-2 cursor-pointer text-[11px] font-semibold text-emerald-900 dark:text-emerald-300 select-none">
                  <input 
                    type="checkbox" 
                    checked={newCustomer.is_phone_whatsapp}
                    onChange={e => setNewCustomer({ ...newCustomer, is_phone_whatsapp: e.target.checked })}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300"
                  />
                  <MessageCircle size={14} className="text-emerald-600 dark:text-emerald-400" />
                  <span>Phone number is also WhatsApp</span>
                </label>
              </div>

              {!newCustomer.is_phone_whatsapp && (
                <div className="animate-in fade-in">
                  <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    WhatsApp Number
                  </label>
                  <div className="relative">
                    <MessageCircle className="absolute left-3.5 top-1/2 -translate-y-1/2 text-emerald-500" size={15} />
                    <input 
                      type="tel" 
                      placeholder="e.g. 0321-7654321" 
                      className="w-full pl-10 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-slate-800 dark:text-slate-100 outline-none focus:border-lime-500 focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-lime-500/20 transition-all"
                      value={newCustomer.whatsapp}
                      onChange={e => setNewCustomer({ ...newCustomer, whatsapp: e.target.value })}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  City
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                  <input 
                    type="text" 
                    placeholder="e.g. Shorkot" 
                    className="w-full pl-8 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-slate-100 outline-none focus:border-lime-500 focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-lime-500/20 transition-all shadow-sm"
                    value={newCustomer.city}
                    onChange={e => setNewCustomer({ ...newCustomer, city: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Street / Shop Address
                </label>
                <input 
                  type="text" 
                  placeholder="House #, Mohallah, Road..." 
                  className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-800 dark:text-slate-100 outline-none focus:border-lime-500 focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-lime-500/20 transition-all placeholder:text-slate-400 shadow-sm"
                  value={newCustomer.address}
                  onChange={e => setNewCustomer({ ...newCustomer, address: e.target.value })}
                />
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2.5">
              <label className="font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
                Opening Balance (Starting Khata)
              </label>

              <div className="grid grid-cols-3 gap-1.5 p-1 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setNewCustomer({ ...newCustomer, balanceType: 'None', balanceAmount: '' })}
                  className={`py-1.5 rounded-lg font-bold text-[11px] transition-all cursor-pointer ${
                    newCustomer.balanceType === 'None'
                      ? 'bg-lime-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  Clean (0)
                </button>

                <button
                  type="button"
                  onClick={() => setNewCustomer({ ...newCustomer, balanceType: 'Due' })}
                  className={`py-1.5 rounded-lg font-bold text-[11px] transition-all cursor-pointer ${
                    newCustomer.balanceType === 'Due'
                      ? 'bg-red-600 text-white shadow-sm'
                      : 'text-red-700 dark:text-red-400 hover:bg-red-50'
                  }`}
                >
                  Due (Receivable)
                </button>

                <button
                  type="button"
                  onClick={() => setNewCustomer({ ...newCustomer, balanceType: 'Advance' })}
                  className={`py-1.5 rounded-lg font-bold text-[11px] transition-all cursor-pointer ${
                    newCustomer.balanceType === 'Advance'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50'
                  }`}
                >
                  Advance (Credit)
                </button>
              </div>

              {newCustomer.balanceType !== 'None' && (
                <div className="relative animate-in fade-in">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 pointer-events-none z-10">Rs</span>
                  <SmartNumberInput 
                    min="0"
                    step="any"
                    required
                    placeholder="Enter initial balance amount..." 
                    className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-black text-slate-900 dark:text-slate-100 outline-none focus:border-lime-500 font-mono shadow-sm"
                    value={newCustomer.balanceAmount}
                    onChange={val => setNewCustomer({ ...newCustomer, balanceAmount: val })}
                  />
                </div>
              )}
            </div>

            <div className="pt-2 flex gap-3">
              <button 
                type="button" 
                onClick={onClose}
                className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 font-bold rounded-xl border border-slate-200 dark:border-slate-700 transition-all text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button 
                type="submit"
                disabled={isCreatingCustomer}
                className="flex-[2] py-3 bg-lime-600 hover:bg-lime-700 text-white font-bold rounded-xl shadow-lg shadow-lime-600/20 transition-all text-xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
              >
                <UserPlus size={16} /> Register & Select in Cart
              </button>
            </div>
          </form>
        </MotionDiv>
      </div>
    </AnimatePresence>
  );
};

// ============================================================================
// 6. EDIT CART ITEM MODAL
// ============================================================================
interface PosEditItemModalProps {
  editingCartItem: any;
  setEditingCartItem: (item: any) => void;
  editRate: string;
  handleEditRateChange: (val: string) => void;
  editQty: string;
  handleEditQtyChange: (val: string) => void;
  editTotal: string;
  handleEditTotalChange: (val: string) => void;
  editVariantId: string;
  setEditVariantId: (vId: string) => void;
  onSellUnitChange: (variantId: string) => void;
  items: any[];
  cart: any[];
  setCart: React.Dispatch<React.SetStateAction<any[]>>;
  handleSaveEditItem: () => void;
  showToast: (msg: string, type: any) => void;
}

export const PosEditItemModal: React.FC<PosEditItemModalProps> = ({
  editingCartItem,
  setEditingCartItem,
  editRate,
  handleEditRateChange,
  editQty,
  handleEditQtyChange,
  editTotal,
  handleEditTotalChange,
  editVariantId,
  onSellUnitChange,
  items,
  cart,
  setCart,
  handleSaveEditItem,
  showToast
}) => {
  if (!editingCartItem) return null;

  const productDef = (items || []).find(i => i.id === editingCartItem.id);
  const variants = (productDef?.variants || []).filter((v: any) => v.isActive !== false);
  const baseUnit = productDef?.unit || editingCartItem.baseUnit || editingCartItem.unit || 'Unit';
  const selectedVariant = editVariantId !== 'base' ? variants.find((v: any) => v.id === editVariantId) : null;
  const looseEdit = !selectedVariant;
  const editContains = selectedVariant ? sellUnitContains(selectedVariant) : 1;
  // Labels follow the unit picked in this dialog, not the line's unit before the change.
  const selectedUnitName = looseEdit ? baseUnit : (selectedVariant.name || 'Pack');
  const editCaption = sellLineCaption({
    qty: parseFloat(editQty) || 0,
    unit: looseEdit ? baseUnit : selectedVariant.name,
    baseUnit,
    variantName: selectedVariant?.name,
    stockDeduction: editContains,
    isLoose: looseEdit
  });

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <MotionDiv 
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          exit={{ opacity: 0 }} 
          className="absolute inset-0 bg-black/40 backdrop-blur-sm" 
          onClick={() => setEditingCartItem(null)} 
        />
        <MotionDiv 
          initial={{ scale: 0.95, opacity: 0, y: 15 }} 
          animate={{ scale: 1, opacity: 1, y: 0 }} 
          exit={{ scale: 0.95, opacity: 0, y: 15 }} 
          className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-800 z-[105]"
        >
          <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 flex justify-between items-center">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-lime-100 dark:bg-lime-950/60 border border-lime-200 dark:border-lime-800 flex items-center justify-center text-lime-700 dark:text-lime-300 font-bold">
                <Edit3 size={18} />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-800 dark:text-slate-100 leading-tight">{editingCartItem.name}</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  Unit: {editingCartItem.unit} • Base Rate: {formatCurrency(editingCartItem.originalPrice || editingCartItem.price)}
                </p>
              </div>
            </div>
            <button 
              type="button" 
              onClick={() => setEditingCartItem(null)} 
              className="bg-white dark:bg-slate-800 p-1.5 rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-700 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
            {/* 1. Unit & Packaging Selection (Piece, Dozen, Tray, etc.) */}
            {variants.length > 0 && (
              <div className="space-y-2 pb-3 border-b border-slate-100 dark:border-slate-800">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Box size={14} className="text-indigo-600 dark:text-indigo-400" /> Choose Unit / Packaging
                  </span>
                  <span className="text-[10px] text-slate-400">Current: {editingCartItem.unit}</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {productDef?.allow_loose_sale !== false && (
                    <button
                      type="button"
                      onClick={() => onSellUnitChange('base')}
                      className={`p-2.5 rounded-xl text-left border transition-all cursor-pointer active:scale-95 ${
                        editVariantId === 'base'
                          ? 'bg-lime-600 text-white border-lime-600 shadow-sm ring-2 ring-lime-600/30'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 border-slate-200 dark:border-slate-700 hover:border-lime-500'
                      }`}
                    >
                      <div className="text-xs font-bold truncate">1 {baseUnit}</div>
                      <div className={`text-[11px] font-mono font-bold mt-0.5 ${editVariantId === 'base' ? 'text-lime-100' : 'text-lime-600 dark:text-lime-400'}`}>
                        Rs {formatCurrency(productDef?.selling_price || 0)}
                      </div>
                    </button>
                  )}
                  {variants.map((v: any) => {
                    const contains = sellUnitContains(v);
                    const price = sellUnitPrice(productDef?.selling_price || 0, contains, v.selling_price);
                    const isSelected = editVariantId === v.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => onSellUnitChange(v.id)}
                        className={`p-2.5 rounded-xl text-left border transition-all cursor-pointer active:scale-95 ${
                          isSelected
                            ? 'bg-lime-600 text-white border-lime-600 shadow-sm ring-2 ring-lime-600/30'
                            : 'bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 border-slate-200 dark:border-slate-700 hover:border-lime-500'
                        }`}
                      >
                        <div className="text-xs font-bold truncate">{v.name} ({contains} {baseUnit})</div>
                        <div className={`text-[11px] font-mono font-bold mt-0.5 ${isSelected ? 'text-lime-100' : 'text-lime-600 dark:text-lime-400'}`}>
                          Rs {formatCurrency(price)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 2. Unit Rate */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Tag size={13} className="text-lime-600" /> Rate / Price (Per {selectedUnitName})
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 font-mono pointer-events-none z-10">Rs</span>
                <SmartNumberInput
                  step="any"
                  value={editRate}
                  onChange={handleEditRateChange}
                  placeholder="0.00"
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:border-lime-500 focus:ring-2 focus:ring-lime-500/20 rounded-xl text-sm font-black font-mono text-slate-900 dark:text-slate-100 outline-none transition-all"
                />
              </div>
            </div>

            {/* 3. Quantity Stepper */}
            <div className="space-y-1.5 pt-1 border-t border-slate-100 dark:border-slate-800">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Package size={13} className="text-blue-600" /> Quantity ({selectedUnitName})
              </label>
              <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-xl p-1 border border-slate-200 dark:border-slate-700">
                <button 
                  type="button"
                  aria-label="Decrease edited quantity" 
                  disabled={looseEdit ? Number(editQty) <= (['kg'].includes(baseUnit.toLowerCase()) ? 0.25 : ['l', 'liter', 'liters'].includes(baseUnit.toLowerCase()) ? 0.5 : 1) : Number(editQty) <= 1}
                  onClick={() => {
                    const cur = parseFloat(editQty) || 0;
                    const next = looseEdit ? stepQuickQuantity(cur, -1, baseUnit, false) : stepWholeQuantity(cur, -1, 1);
                    const formatted = cleanQty(next).toString();
                    handleEditQtyChange(formatted);
                  }} 
                  className="w-9 h-9 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 active:scale-90 flex items-center justify-center transition-all shadow-xs cursor-pointer"
                >
                  <Minus size={15} />
                </button>
                <SmartNumberInput 
                  step="any"
                  aria-label="Edited quantity"
                  value={editQty}
                  onChange={handleEditQtyChange}
                  placeholder="1"
                  className="w-full text-center text-sm font-black font-mono text-slate-900 dark:text-slate-100 bg-transparent outline-none"
                />
                <button 
                  type="button" 
                  aria-label="Increase edited quantity"
                  onClick={() => {
                    const cur = parseFloat(editQty) || 0;
                    const next = looseEdit ? stepQuickQuantity(cur, 1, baseUnit, false) : stepWholeQuantity(cur, 1, 1);
                    const formatted = cleanQty(next).toString();
                    handleEditQtyChange(formatted);
                  }} 
                  className="w-9 h-9 rounded-lg hover:bg-white dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 active:scale-90 flex items-center justify-center transition-all shadow-xs cursor-pointer"
                >
                  <Plus size={15} />
                </button>
              </div>
            </div>

            {/* 4. Total Price */}
            <div className="space-y-1.5 pt-1 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <DollarSign size={13} className="text-emerald-600" /> Total Price (Rs)
                </label>
                {parseFloat(editRate) > 0 && (
                  <span className="text-[10px] font-mono text-slate-400">
                    Rate: Rs {parseFloat(editRate).toFixed(1)}/{selectedUnitName}
                  </span>
                )}
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 font-mono pointer-events-none z-10">Rs</span>
                <SmartNumberInput
                  step="any"
                  value={editTotal}
                  onChange={handleEditTotalChange}
                  placeholder="0.00"
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:border-lime-500 focus:ring-2 focus:ring-lime-500/20 rounded-xl text-sm font-black font-mono text-slate-900 dark:text-slate-100 outline-none transition-all"
                />
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">{editCaption}</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                {looseEdit || selectedVariant?.deduct_from_base ? `Changing the total changes how many ${looseEdit ? baseUnit : selectedVariant.name} you sell. The price of one stays.` : 'Changing the total changes the rate. The packed count stays.'}
              </p>
            </div>
          </div>

          <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-855 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                setCart(cart.filter(c => c.cartItemId !== editingCartItem.cartItemId));
                showToast(`${editingCartItem.name} removed from cart`, 'info');
                setEditingCartItem(null);
              }}
              className="px-3 py-2.5 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 text-red-600 dark:text-red-400 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer active:scale-95"
            >
              <Trash2 size={14} /> Remove
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditingCartItem(null)}
                className="px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 text-slate-700 dark:text-slate-200 text-xs font-bold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEditItem}
                className="px-4 py-2.5 rounded-xl bg-lime-600 hover:bg-lime-700 text-white text-xs font-bold transition-all shadow-md shadow-lime-600/20 flex items-center gap-1.5 active:scale-95 cursor-pointer"
              >
                <Check size={14} /> Save Changes
              </button>
            </div>
          </div>
        </MotionDiv>
      </div>
    </AnimatePresence>
  );
};
