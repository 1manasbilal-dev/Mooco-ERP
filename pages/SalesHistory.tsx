import React, { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { POSBill } from '../types';
import { 
  Search, Printer, RotateCcw, 
  CheckCircle2, XCircle, DollarSign, CreditCard, ShoppingBag, 
  User, ChevronDown, Clock, Wallet, X, Check, Eye, FileText, Calendar, ArrowLeftRight,
  Copy, Sparkles, Filter
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { isDateOnlyOrMidnight, formatCurrency, formatMoneyRaw } from '../lib/formatters';
import { saleLineStock } from '../lib/sellUnits';
import { useManagerApproval } from '../components/ui/ManagerApproval';

const MotionDiv = motion.div as any;

interface ReturnItemSelection {
  itemId?: string;
  name: string;
  soldQty: number;
  remainingQty: number;
  returnQty: number;
  price: number;
  unit?: string;
  variantId?: string;
  isSelected: boolean;
  /** Position of the bill line, saved with the return so later returns match the exact line. */
  lineIndex?: number;
  /** Bill snapshot, passed through so the return restocks the pile the sale used. */
  lineUnit?: string;
  baseUnit?: string;
  stockDeduction?: number;
  deductFromBase?: boolean;
  isLoose?: boolean;
  /** Pre-packed lines go back in whole packs. */
  wholeOnly?: boolean;
}

const formatSaleDateTime = (dateStr?: string, fallbackTime?: string) => {
  if (!dateStr) return { date: 'N/A', time: fallbackTime || '' };
  try {
    const safeStr = typeof dateStr === 'string' ? dateStr.trim().replace(' ', 'T') : dateStr;
    const d = new Date(safeStr);
    if (isNaN(d.getTime())) {
      const fallbackDate = new Date(dateStr);
      if (isNaN(fallbackDate.getTime())) return { date: dateStr, time: fallbackTime || '' };
      const dateFormatted = fallbackDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      const isMidnight = isDateOnlyOrMidnight(dateStr);
      const timeFormatted = isMidnight ? (fallbackTime || '') : fallbackDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      return { date: dateFormatted, time: timeFormatted };
    }
    const dateFormatted = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const isMidnight = isDateOnlyOrMidnight(dateStr);
    let timeFormatted = isMidnight ? '' : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    if (!timeFormatted && fallbackTime) {
      timeFormatted = fallbackTime;
    }
    return { date: dateFormatted, time: timeFormatted };
  } catch {
    return { date: dateStr, time: fallbackTime || '' };
  }
};

const getLocalDateString = (dStr?: string | Date): string => {
  if (!dStr) return '';
  try {
    const d = typeof dStr === 'string' ? new Date(dStr) : dStr;
    if (isNaN(d.getTime())) {
      return typeof dStr === 'string' ? (dStr.includes('T') ? dStr.split('T')[0] : dStr) : '';
    }
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch {
    return typeof dStr === 'string' ? (dStr.includes('T') ? dStr.split('T')[0] : dStr) : '';
  }
};

const normalizeSearchToken = (str: string): string => {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
};

const checkSaleDateMatches = (saleDateStr?: string, range: string = 'today', customD: string = ''): boolean => {
  if (!saleDateStr) return true;
  if (range === 'all') return true;

  const saleIsoDate = saleDateStr.includes('T') ? saleDateStr.split('T')[0] : saleDateStr;
  const saleLocalDate = getLocalDateString(saleDateStr);

  const now = new Date();
  const todayIso = now.toISOString().split('T')[0];
  const todayLocal = getLocalDateString(now);

  if (range === 'today') {
    return saleLocalDate === todayLocal || saleIsoDate === todayIso || saleLocalDate === todayIso;
  }
  if (range === 'month') {
    const currentMonthLocal = todayLocal.slice(0, 7);
    const currentMonthIso = todayIso.slice(0, 7);
    return saleLocalDate.startsWith(currentMonthLocal) || saleIsoDate.startsWith(currentMonthIso);
  }
  if (range === 'custom' && customD) {
    return saleLocalDate === customD || saleIsoDate === customD;
  }
  return true;
};

const matchSaleWithToken = (
  sale: POSBill,
  token: string,
  customerMap: Map<string, { phone: string; name: string }>
): boolean => {
  const tok = token.toLowerCase();
  const cleanTok = tok.replace(/^[#\s]+/, '').trim();
  const alphaTok = tok.replace(/[^a-z0-9]/g, '');

  // 1. Invoice Number & System Identifiers
  const billNum = (sale.bill_number || '').toLowerCase();
  const saleId = (sale.id || '').toLowerCase();
  const fallbackBill5 = `inv-${saleId.slice(-5)}`;
  const fallbackBill6 = `inv-${saleId.slice(-6)}`;
  const orderNum = (sale.details?.order_number || sale.details?.customer_order_id || '').toString().toLowerCase();

  // Substring matching with or without hash prefix
  if (cleanTok) {
    if (billNum && (billNum.includes(cleanTok) || cleanTok.includes(billNum))) return true;
    if (fallbackBill5.includes(cleanTok) || fallbackBill6.includes(cleanTok)) return true;
    if (saleId.includes(cleanTok)) return true;
    if (orderNum && (orderNum.includes(cleanTok) || cleanTok.includes(orderNum))) return true;
  }

  // Alphanumeric matching (ignores dashes, spaces, e.g. "INV2610083E3CE7" or "2610083E3CE7" or "3E3CE7")
  if (alphaTok.length >= 2) {
    const alphaBill = billNum.replace(/[^a-z0-9]/g, '');
    const alphaId = saleId.replace(/[^a-z0-9]/g, '');
    const alphaOrder = orderNum.replace(/[^a-z0-9]/g, '');

    if (alphaBill && (alphaBill.includes(alphaTok) || alphaTok.includes(alphaBill))) return true;
    if (alphaId && alphaId.includes(alphaTok)) return true;
    if (alphaOrder && alphaOrder.includes(alphaTok)) return true;
    if (alphaBill && alphaBill.endsWith(alphaTok)) return true;
  }

  // Suffix matching (e.g. typing the 4-6 char hash suffix of an invoice)
  if (cleanTok.length >= 3 && billNum.endsWith(cleanTok)) return true;

  // 2. Customer Name & Linked Customer Profile
  if (sale.customer_name && sale.customer_name.toLowerCase().includes(tok)) return true;
  const linkedCustomer = sale.customer_id ? customerMap.get(sale.customer_id) : undefined;
  if (linkedCustomer?.name && linkedCustomer.name.toLowerCase().includes(tok)) return true;

  // 3. Customer Phone Numbers
  const phoneDigits = alphaTok.replace(/\D/g, '');
  if (phoneDigits.length >= 3) {
    const salePhone = (sale.details?.customer_phone || '').replace(/\D/g, '');
    if (salePhone && salePhone.includes(phoneDigits)) return true;
    const linkedPhone = (linkedCustomer?.phone || '').replace(/\D/g, '');
    if (linkedPhone && linkedPhone.includes(phoneDigits)) return true;
  }

  // 4. Billed Items (Name, Variant, Unit)
  if (sale.items && sale.items.length > 0) {
    const itemMatch = sale.items.some(it => {
      const itName = (it.name || '').toLowerCase();
      const variant = ((it as any).variantName || '').toLowerCase();
      const unit = ((it as any).unit || '').toLowerCase();
      if (itName.includes(tok) || variant.includes(tok) || unit.includes(tok)) return true;
      if (alphaTok.length >= 2 && itName.replace(/[^a-z0-9]/g, '').includes(alphaTok)) return true;
      return false;
    });
    if (itemMatch) return true;
  }

  // 5. Total, Subtotal, Discount & Prices
  const numericToken = tok.replace(/^(rs\.?|pkr)\s*/i, '').replace(/,/g, '').trim();
  const parsedNum = parseFloat(numericToken);
  if (!isNaN(parsedNum) && parsedNum > 0) {
    if (Math.abs((sale.total || 0) - parsedNum) < 0.01) return true;
    if (Math.abs((sale.subtotal || 0) - parsedNum) < 0.01) return true;
    if (sale.discount && Math.abs(sale.discount - parsedNum) < 0.01) return true;
    if (sale.refund_amount && Math.abs(sale.refund_amount - parsedNum) < 0.01) return true;
    if (sale.items?.some(it => Math.abs(it.price - parsedNum) < 0.01 || Math.abs((it.total || 0) - parsedNum) < 0.01)) {
      return true;
    }
  }
  if (numericToken.length >= 2 && sale.total?.toString().includes(numericToken)) return true;

  // 6. Payment Mode & Khata
  const modeStr = (sale.payment_mode || '').toLowerCase();
  if (modeStr.includes(tok)) return true;
  if ((tok === 'credit' || tok === 'khata' || tok === 'udhaar' || tok === 'due') && (sale.payment_mode === 'Credit' || Boolean(sale.customer_id))) {
    return true;
  }
  if ((tok === 'cash' || tok === 'nagad') && sale.payment_mode === 'Cash') return true;
  if ((tok === 'online' || tok === 'bank' || tok === 'digital') && sale.payment_mode === 'Online') return true;

  // 7. Status & Returns
  const statusStr = (sale.status || '').toLowerCase();
  if (statusStr.includes(tok)) return true;
  if ((tok === 'return' || tok === 'returned' || tok === 'wapsi') && (sale.status === 'Returned' || (sale as any).status === 'Partially Returned')) {
    return true;
  }
  if (sale.return_reason && sale.return_reason.toLowerCase().includes(tok)) return true;

  // 8. Date & Time String Matches
  const { date: formattedDate, time: formattedTime } = formatSaleDateTime(sale.date || (sale as any).created_at, (sale as any).time || sale.details?.time);
  if (formattedDate.toLowerCase().includes(tok)) return true;
  if (formattedTime && formattedTime.toLowerCase().includes(tok)) return true;
  if (sale.date && sale.date.toLowerCase().includes(tok)) return true;

  // 9. Staff / Shift / Notes
  if (sale.cashier_name && sale.cashier_name.toLowerCase().includes(tok)) return true;
  if (sale.shift_name && sale.shift_name.toLowerCase().includes(tok)) return true;
  if (sale.details?.notes && typeof sale.details.notes === 'string' && sale.details.notes.toLowerCase().includes(tok)) return true;

  return false;
};

const SalesHistory: React.FC = () => {
  const { sales, customers, accounts, settings, items, processSalesReturn, updateSalePaymentMode, canPerform, activeShiftSession, cashDrawers, currentUser } = useDairy();
  const { showToast } = useToast();
  const { requestApproval, approvalDialog } = useManagerApproval();
  const location = useLocation();
  const navigate = useNavigate();

  const canReturn = canPerform('sales_history', 'return');
  const canDelete = canPerform('sales_history', 'delete');
  const canChangeMode = canPerform('sales_history', 'edit');

  // Customer map for rapid phone & name lookups
  const customerMap = useMemo(() => {
    const map = new Map<string, { phone: string; name: string }>();
    (customers || []).forEach(c => {
      if (c?.id) {
        map.set(c.id, {
          phone: c.phone || c.whatsapp || '',
          name: c.name || ''
        });
      }
    });
    return map;
  }, [customers]);

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('search') || sp.get('q') || '';
  });
  const [searchAcrossAllDates, setSearchAcrossAllDates] = useState<boolean>(true);
  const [filterMode, setFilterMode] = useState<string>(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('mode') || 'All';
  });
  const [filterStatus, setFilterStatus] = useState<string>(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('status') || 'All';
  });
  const [filterDateRange, setFilterDateRange] = useState<string>(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get('range') || 'today';
  });
  const [customDate, setCustomDate] = useState<string>('');
  const [visibleCount, setVisibleCount] = useState<number>(50);

  // Expandable Rows State (Stores map of expanded sale IDs)
  const [expandedSaleIds, setExpandedSaleIds] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) => {
    setExpandedSaleIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Selected Sale for Details / Receipt / Return
  const [selectedDetailSale, setSelectedDetailSale] = useState<POSBill | null>(null);
  const [selectedReceiptSale, setSelectedReceiptSale] = useState<POSBill | null>(null);
  const [returnModalSale, setReturnModalSale] = useState<POSBill | null>(null);

  // Sync modal selections & filters from URL
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const detailId = sp.get('id');
    const receiptId = sp.get('receipt');

    if (detailId && sales.length > 0) {
      const found = sales.find(s => s.id === detailId);
      if (found && selectedDetailSale?.id !== detailId) {
        setSelectedDetailSale(found);
      }
    } else if (!detailId && selectedDetailSale) {
      setSelectedDetailSale(null);
    }

    if (receiptId && sales.length > 0) {
      const found = sales.find(s => s.id === receiptId);
      if (found && selectedReceiptSale?.id !== receiptId) {
        setSelectedReceiptSale(found);
      }
    } else if (!receiptId && selectedReceiptSale) {
      setSelectedReceiptSale(null);
    }

    const rangeParam = sp.get('range');
    if (rangeParam && rangeParam !== filterDateRange) setFilterDateRange(rangeParam);

    const modeParam = sp.get('mode');
    if (modeParam && modeParam !== filterMode) setFilterMode(modeParam);

    const statusParam = sp.get('status');
    if (statusParam && statusParam !== filterStatus) setFilterStatus(statusParam);
  }, [location.search, sales]);

  const openDetailSale = (sale: POSBill | null) => {
    setSelectedDetailSale(sale);
    const sp = new URLSearchParams(location.search);
    if (sale) sp.set('id', sale.id); else sp.delete('id');
    const q = sp.toString();
    navigate(`${location.pathname}${q ? `?${q}` : ''}`, { replace: true });
  };

  const openReceiptSale = (sale: POSBill | null) => {
    setSelectedReceiptSale(sale);
    const sp = new URLSearchParams(location.search);
    if (sale) sp.set('receipt', sale.id); else sp.delete('receipt');
    const q = sp.toString();
    navigate(`${location.pathname}${q ? `?${q}` : ''}`, { replace: true });
  };

  const updateFilters = (updates: { range?: string; mode?: string; status?: string }) => {
    const sp = new URLSearchParams(location.search);
    if (updates.range !== undefined) {
      setFilterDateRange(updates.range);
      if (updates.range !== 'today') sp.set('range', updates.range); else sp.delete('range');
    }
    if (updates.mode !== undefined) {
      setFilterMode(updates.mode);
      if (updates.mode !== 'All') sp.set('mode', updates.mode); else sp.delete('mode');
    }
    if (updates.status !== undefined) {
      setFilterStatus(updates.status);
      if (updates.status !== 'All') sp.set('status', updates.status); else sp.delete('status');
    }
    const q = sp.toString();
    navigate(`${location.pathname}${q ? `?${q}` : ''}`, { replace: true });
  };
  const [returnReason, setReturnReason] = useState('Customer Changed Mind');
  const [customReturnReason, setCustomReturnReason] = useState('');
  const [returnAction, setReturnAction] = useState<'refund' | 'replace'>('refund');
  const [restockOption, setRestockOption] = useState<'restock' | 'scrap_spoilage'>('restock');
  const [refundAccountId, setRefundAccountId] = useState('');
  const [refundPaymentMode, setRefundPaymentMode] = useState<'Cash' | 'Online'>('Cash');
  const [correctOriginalSaleMode, setCorrectOriginalSaleMode] = useState<boolean>(false);
  const [isProcessingReturn, setIsProcessingReturn] = useState(false);

  // Payment Mode Quick Switch Modal State
  const [modeEditSale, setModeEditSale] = useState<POSBill | null>(null);
  const [targetMode, setTargetMode] = useState<'Cash' | 'Online'>('Online');
  const [targetAccountId, setTargetAccountId] = useState<string>('');
  const [isUpdatingMode, setIsUpdatingMode] = useState(false);

  // Partial / Item-Level Return State
  const [returnItems, setReturnItems] = useState<ReturnItemSelection[]>([]);

  // Open Return Modal with individual item selection
  const openReturnModal = (sale: POSBill) => {
    setReturnModalSale(sale);
    setReturnReason('Customer Changed Mind');
    setCustomReturnReason('');
    setReturnAction('refund');
    setRestockOption('restock');
    setCorrectOriginalSaleMode(false);

    const initialRefundMode = sale.payment_mode === 'Online' ? 'Online' : 'Cash';
    setRefundPaymentMode(initialRefundMode);

    const previouslyReturned = ((sale as any).returned_items || (sale as any).details?.returned_items || []) as Array<{ name: string; qty: number; itemId?: string; variantId?: string; lineIndex?: number }>;

    // Give each earlier return to exactly one bill line. Two lines of the same item and pack
    // share a key, so a return without a saved line index fills them in order and is never counted twice.
    const saleLines = sale.items || [];
    const returnedByLine = saleLines.map(() => 0);
    const sameLine = (r: { name: string; itemId?: string; variantId?: string }, it: any) => (r.itemId && it.itemId)
      ? r.itemId === it.itemId && (r.variantId || '') === (it.variantId || '')
      : (r.name || '').toLowerCase() === (it.name || '').toLowerCase();
    const indexed = previouslyReturned.filter(r => Number.isInteger(r.lineIndex) && saleLines[r.lineIndex as number]);
    indexed.forEach(r => { returnedByLine[r.lineIndex as number] += Number(r.qty) || 0; });
    previouslyReturned.filter(r => !indexed.includes(r)).forEach(r => {
      let left = Number(r.qty) || 0;
      saleLines.forEach((it, index) => {
        if (left <= 0 || !sameLine(r, it)) return;
        const take = Math.min(left, Math.max(0, (Number(it.qty) || 0) - returnedByLine[index]));
        returnedByLine[index] += take;
        left -= take;
      });
    });

    const itemsList: ReturnItemSelection[] = saleLines.map((it, index) => {
      const remainingQty = Math.max(0, it.qty - returnedByLine[index]);
      const line: any = it;
      const itemDef = (items || []).find(i => i.id === it.itemId);
      const wholeOnly = saleLineStock(line, itemDef as any).fromBase === false;

      return {
        itemId: it.itemId,
        name: it.name,
        soldQty: it.qty,
        remainingQty,
        returnQty: remainingQty > 0 ? remainingQty : 0,
        price: it.price,
        unit: line.variantName ? line.variantName : (line.unit || 'Unit'),
        variantId: it.variantId,
        isSelected: remainingQty > 0,
        lineIndex: index,
        lineUnit: line.unit,
        baseUnit: line.baseUnit,
        stockDeduction: line.stockDeduction,
        deductFromBase: line.deductFromBase,
        isLoose: line.isLoose,
        wholeOnly
      };
    });

    setReturnItems(itemsList);
    setRefundAccountId(defaultRefundAccount(initialRefundMode));
  };

  // Cash refunds leave the drawer that is open now; head cash is a deliberate manual choice.
  const drawerAccountFor = (drawerId?: string | null) => {
    if (!drawerId) return '';
    if (accounts.some(a => a.id === drawerId)) return drawerId;
    return cashDrawers.find(d => d.id === drawerId)?.account_id || '';
  };
  const digitalAccountDefault = () => settings.financial?.defaultDigitalAccountId || accounts.find(a => (a.type === 'Bank' || a.type === 'Wallet') && a.isActive !== false)?.id || accounts.find(a => a.type === 'Bank' || a.type === 'Wallet')?.id || '';
  const defaultRefundAccount = (mode: 'Cash' | 'Online') => {
    if (mode === 'Online') return digitalAccountDefault();
    const shift = activeShiftSession?.status === 'Active' ? activeShiftSession : null;
    return (shift && (shift.account_id || drawerAccountFor(shift.drawer_id))) || '';
  };

  const handleRefundModeChange = (mode: 'Cash' | 'Online') => {
    setRefundPaymentMode(mode);
    setRefundAccountId(defaultRefundAccount(mode));
  };

  // Cash -> the drawer that took the bill, so the money moves back into the till it is sitting in.
  const modeTargetDefault = (sale: POSBill, mode: 'Cash' | 'Online') =>
    mode === 'Online' ? digitalAccountDefault() : (drawerAccountFor(sale.drawer_id) || defaultRefundAccount('Cash'));

  const openModeEditModal = (sale: POSBill) => {
    setModeEditSale(sale);
    const newMode: 'Cash' | 'Online' = sale.payment_mode === 'Cash' ? 'Online' : 'Cash';
    setTargetMode(newMode);
    setTargetAccountId(modeTargetDefault(sale, newMode));
  };

  const handleTargetModeChange = (mode: 'Cash' | 'Online') => {
    setTargetMode(mode);
    if (modeEditSale) setTargetAccountId(modeTargetDefault(modeEditSale, mode));
  };

  const handleConfirmModeChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modeEditSale) return;
    setIsUpdatingMode(true);
    const success = await updateSalePaymentMode(modeEditSale.id, targetMode, targetAccountId || undefined);
    setIsUpdatingMode(false);
    if (success) {
      setModeEditSale(null);
    }
  };

  // Toggle item selection
  const toggleItemSelection = (index: number) => {
    setReturnItems(prev => prev.map((item, idx) => {
      if (idx === index) {
        const nextSelected = !item.isSelected;
        const maxQty = item.remainingQty !== undefined ? item.remainingQty : item.soldQty;
        return {
          ...item,
          isSelected: nextSelected,
          returnQty: nextSelected && item.returnQty === 0 ? maxQty : item.returnQty
        };
      }
      return item;
    }));
  };

  // Update return quantity for a specific item
  const updateItemReturnQty = (index: number, newQty: number) => {
    setReturnItems(prev => prev.map((item, idx) => {
      if (idx === index) {
        const maxQty = item.remainingQty !== undefined ? item.remainingQty : item.soldQty;
        const clamped = isNaN(newQty) ? 0 : Math.min(maxQty, Math.max(0, newQty));
        const validated = item.wholeOnly ? Math.floor(clamped + 1e-9) : clamped;
        return {
          ...item,
          returnQty: validated,
          isSelected: validated > 0
        };
      }
      return item;
    }));
  };

  // Select / Deselect all items
  const selectAllReturnItems = (select: boolean) => {
    setReturnItems(prev => prev.map(item => ({
      ...item,
      isSelected: select,
      returnQty: select ? (item.remainingQty !== undefined ? item.remainingQty : item.soldQty) : 0
    })));
  };

  // Active items being returned and calculated total
  const activeReturnItems = useMemo(() => {
    return returnItems.filter(i => i.isSelected && i.returnQty > 0);
  }, [returnItems]);

  const currentRefundAmount = useMemo(() => {
    return activeReturnItems.reduce((sum, i) => sum + (i.returnQty * i.price), 0);
  }, [activeReturnItems]);

  // Tokenized search query
  const searchTokens = useMemo(() => {
    return searchTerm.trim().toLowerCase().split(/\s+/).filter(Boolean);
  }, [searchTerm]);

  // Statistics & Match Counters across dates
  const { matchingAllDatesCount, matchingCurrentDateCount } = useMemo(() => {
    if (searchTokens.length === 0) {
      return { matchingAllDatesCount: sales.length, matchingCurrentDateCount: 0 };
    }
    let allCount = 0;
    let dateCount = 0;
    for (const s of sales) {
      const sMatchesSearch = searchTokens.every(tok => matchSaleWithToken(s, tok, customerMap));
      const sMatchesMode = filterMode === 'All' || s.payment_mode === filterMode;
      const sMatchesStatus = filterStatus === 'All' || s.status === filterStatus;
      if (sMatchesSearch && sMatchesMode && sMatchesStatus) {
        allCount++;
        if (checkSaleDateMatches(s.date, filterDateRange, customDate)) {
          dateCount++;
        }
      }
    }
    return { matchingAllDatesCount: allCount, matchingCurrentDateCount: dateCount };
  }, [sales, searchTokens, customerMap, filterMode, filterStatus, filterDateRange, customDate]);

  // Copy invoice number to clipboard helper
  const copyInvoiceNumber = (e: React.MouseEvent, billNumber: string) => {
    e.stopPropagation();
    const clean = billNumber.startsWith('#') ? billNumber : `#${billNumber}`;
    try {
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(clean);
      }
      showToast(`Copied ${clean} to clipboard!`, 'success');
    } catch {
      showToast(`Invoice: ${clean}`, 'info');
    }
  };

  // Filtered Sales Logic
  const filteredSales = useMemo(() => {
    const isSearching = searchTokens.length > 0;

    return sales.filter(sale => {
      // 1. Search Query with Multi-Token & Universal Match
      if (isSearching) {
        const matchesAllTokens = searchTokens.every(tok => matchSaleWithToken(sale, tok, customerMap));
        if (!matchesAllTokens) return false;
      }

      // 2. Payment Mode Filter
      if (filterMode !== 'All' && sale.payment_mode !== filterMode) return false;

      // 3. Status Filter
      if (filterStatus !== 'All' && sale.status !== filterStatus) return false;

      // 4. Date Filter: If searching and searchAcrossAllDates is true, search scans ALL dates!
      if (!isSearching || !searchAcrossAllDates) {
        const matchesDate = checkSaleDateMatches(sale.date, filterDateRange, customDate);
        if (!matchesDate) return false;
      }

      return true;
    }).sort((a, b) => {
      // Sort newest first
      return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime() || b.id.localeCompare(a.id);
    });
  }, [sales, searchTokens, searchAcrossAllDates, customerMap, filterMode, filterStatus, filterDateRange, customDate]);

  const displayedSales = useMemo(() => {
    return filteredSales.slice(0, visibleCount);
  }, [filteredSales, visibleCount]);

  // Statistics
  const validSales = filteredSales.filter(s => s.status !== 'Cancelled');
  const totalSalesCount = validSales.length;
  const completedSales = validSales.filter(s => s.status !== 'Returned');
  const returnedSales = validSales.filter(s => s.status === 'Returned' || (s as any).status === 'Partially Returned');
  
  const grossRevenue = validSales.reduce((acc, s) => acc + (s.total || 0), 0);
  const totalReturnedAmount = validSales.reduce((acc, s) => {
    if (s.status === 'Returned') return acc + (Number(s.total) || Number(s.refund_amount) || 0);
    if ((s as any).status === 'Partially Returned') return acc + Number(s.refund_amount || 0);
    return acc;
  }, 0);
  const netRevenue = Math.max(0, grossRevenue - totalReturnedAmount);

  // Counts for date filter options
  const { todayCount, monthCount } = useMemo(() => {
    const now = new Date();
    const todayIso = now.toISOString().split('T')[0];
    const todayLocal = getLocalDateString(now);
    const monthLocal = todayLocal.slice(0, 7);
    const monthIso = todayIso.slice(0, 7);

    let todayC = 0;
    let monthC = 0;

    for (const s of sales) {
      if (!s.date) continue;
      const sIso = s.date.includes('T') ? s.date.split('T')[0] : s.date;
      const sLocal = getLocalDateString(s.date);
      if (sLocal === todayLocal || sIso === todayIso || sLocal === todayIso) {
        todayC++;
      }
      if (sLocal.startsWith(monthLocal) || sIso.startsWith(monthIso)) {
        monthC++;
      }
    }
    return { todayCount: todayC, monthCount: monthC };
  }, [sales]);

  // Handle Process Return Submit
  const handleConfirmReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnModalSale) return;

    const selectedToReturn = returnItems
      .filter(it => it.isSelected && it.returnQty > 0)
      .map(it => ({
        itemId: it.itemId,
        name: it.name,
        qty: it.returnQty,
        price: it.price,
        unit: it.lineUnit ?? it.unit,
        variantId: it.variantId,
        // The bill's own snapshot, so the context restocks the pile and size the sale used.
        lineIndex: it.lineIndex,
        baseUnit: it.baseUnit,
        stockDeduction: it.stockDeduction,
        deductFromBase: it.deductFromBase,
        isLoose: it.isLoose
      }));

    if (selectedToReturn.length === 0) {
      showToast("Please select at least one item to return", "warning");
      return;
    }

    const finalReason = returnReason === 'Other' 
      ? (customReturnReason.trim() || 'Other return') 
      : returnReason;

    // Staff without the return right, or every return when the owner asks for it, needs a manager PIN.
    const isApprover = currentUser?.role_id === 'role_super_admin' || canPerform('approvals', 'return');
    if (!isApprover && (!canReturn || settings.security?.returnNeedsApproval)) {
      const approvedBy = await requestApproval({
        permission: 'approvals:return',
        title: 'Return ke liye manager approval',
        reason: `Bill ${returnModalSale.bill_number || ''} — ${finalReason}`,
      });
      if (!approvedBy) return;
      showToast(`Return ${approvedBy} ne approve kiya.`, 'success');
    }

    setIsProcessingReturn(true);
    const success = await processSalesReturn(
      returnModalSale.id, 
      finalReason, 
      refundAccountId || undefined,
      returnAction,
      restockOption,
      selectedToReturn,
      refundPaymentMode,
      correctOriginalSaleMode
    );
    setIsProcessingReturn(false);

    if (success) {
      setReturnModalSale(null);
      setReturnReason('Customer Changed Mind');
      setCustomReturnReason('');
      setReturnAction('refund');
      setRestockOption('restock');
      setRefundAccountId('');
      setRefundPaymentMode('Cash');
      setCorrectOriginalSaleMode(false);
      setReturnItems([]);
    }
  };

  const handlePrintReceipt = () => {
    window.print();
  };

  return (
    <div className="space-y-3 sm:space-y-4 pb-20 max-w-7xl mx-auto">
      {approvalDialog}
      
      {/* 1. Micro KPI Stats Overview - Exactly 1 Single Row on Mobile */}
      <div className="grid grid-cols-4 gap-1.5 sm:gap-3">
        {/* Card 1: Total Invoices */}
        <div className="bg-white p-2 sm:p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-semibold text-slate-400 truncate">Invoices</span>
            <div className="w-5 h-5 rounded-md bg-lime-50 text-lime-700 hidden sm:flex items-center justify-center">
              <ShoppingBag size={12} />
            </div>
          </div>
          <p className="text-xs sm:text-lg font-bold font-mono text-slate-900 mt-1 truncate">
            {totalSalesCount}
          </p>
          <span className="text-[9px] text-slate-400 truncate hidden sm:block">
            {completedSales.length} Active / {returnedSales.length} Ret
          </span>
        </div>

        {/* Card 2: Gross Revenue */}
        <div className="bg-white p-2 sm:p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-semibold text-slate-400 truncate">Gross</span>
            <div className="w-5 h-5 rounded-md bg-emerald-50 text-emerald-700 hidden sm:flex items-center justify-center">
              <DollarSign size={12} />
            </div>
          </div>
          <p className="text-xs sm:text-lg font-bold font-mono text-emerald-700 mt-1 truncate">
            <span className="text-[9px] sm:text-xs font-normal">Rs </span>{formatMoneyRaw(grossRevenue)}
          </p>
          <span className="text-[9px] text-emerald-600 truncate hidden sm:block">Active Sales</span>
        </div>

        {/* Card 3: Returned Amount */}
        <div className="bg-white p-2 sm:p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-semibold text-slate-400 truncate">Refunded</span>
            <div className="w-5 h-5 rounded-md bg-red-50 text-red-600 hidden sm:flex items-center justify-center">
              <RotateCcw size={12} />
            </div>
          </div>
          <p className="text-xs sm:text-lg font-bold font-mono text-red-600 mt-1 truncate">
            <span className="text-[9px] sm:text-xs font-normal">Rs </span>{formatMoneyRaw(totalReturnedAmount)}
          </p>
          <span className="text-[9px] text-red-500 truncate hidden sm:block">{returnedSales.length} Returned</span>
        </div>

        {/* Card 4: Net Revenue */}
        <div className="bg-white p-2 sm:p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-semibold text-slate-400 truncate">Net</span>
            <div className="w-5 h-5 rounded-md bg-blue-50 text-blue-700 hidden sm:flex items-center justify-center">
              <Wallet size={12} />
            </div>
          </div>
          <p className="text-xs sm:text-lg font-bold font-mono text-blue-700 mt-1 truncate">
            <span className="text-[9px] sm:text-xs font-normal">Rs </span>{formatMoneyRaw(netRevenue)}
          </p>
          <span className="text-[9px] text-blue-600 truncate hidden sm:block">Net Turnover</span>
        </div>
      </div>

      {/* 2. Filter & Search Toolbar */}
      <div className="bg-white p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border border-slate-200 shadow-2xs space-y-2.5">
        <div className="flex flex-col md:flex-row gap-2.5 items-stretch md:items-center justify-between">
          
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <input 
              type="text"
              placeholder="Search invoice # (e.g. #INV-..., 3E3CE7), customer, item, phone, amount (Rs 780)..."
              className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-lime-500 transition-all"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button aria-label="Clear Search" 
                onClick={() => setSearchTerm('')} 
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                title="Clear Search"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Filter Dropdowns Grid */}
          <div className="grid grid-cols-3 sm:flex sm:flex-wrap items-center gap-1.5 sm:gap-2">
            {/* Date Range Picker */}
            <select
              className="px-2 sm:px-3 py-1.5 sm:py-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] sm:text-xs font-semibold text-slate-700 outline-none focus:border-lime-500"
              value={filterDateRange}
              onChange={e => updateFilters({ range: e.target.value })}
            >
              <option value="today">Today ({todayCount})</option>
              <option value="all">All Dates ({sales.length})</option>
              <option value="month">This Month ({monthCount})</option>
              <option value="custom">Custom Date...</option>
            </select>

            {/* Payment Mode */}
            <select
              className="px-2 sm:px-3 py-1.5 sm:py-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] sm:text-xs font-semibold text-slate-700 outline-none focus:border-lime-500"
              value={filterMode}
              onChange={e => updateFilters({ mode: e.target.value })}
            >
              <option value="All">All Modes</option>
              <option value="Cash">Cash</option>
              <option value="Online">Online</option>
              <option value="Credit">Credit</option>
            </select>

            {/* Status */}
            <select
              className="px-2 sm:px-3 py-1.5 sm:py-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] sm:text-xs font-semibold text-slate-700 outline-none focus:border-lime-500"
              value={filterStatus}
              onChange={e => updateFilters({ status: e.target.value })}
            >
              <option value="All">All Status</option>
              <option value="Completed">Completed</option>
              <option value="Partially Returned">Partially Returned</option>
              <option value="Returned">Returned</option>
            </select>

            {filterDateRange === 'custom' && (
              <input 
                type="date"
                className="col-span-3 sm:col-span-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 outline-none focus:border-lime-500"
                value={customDate}
                onChange={e => setCustomDate(e.target.value)}
              />
            )}
          </div>

        </div>

        {/* Smart Search Scope & Status Banner */}
        {searchTerm.trim() ? (
          <div className="flex items-center justify-between flex-wrap gap-2 px-3 py-2 bg-gradient-to-r from-lime-50/90 to-emerald-50/90 border border-lime-200/90 rounded-xl text-xs animate-in fade-in duration-150">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-lime-600 text-white flex items-center justify-center shrink-0">
                <Search size={11} />
              </span>
              <span className="text-slate-700">
                Results for <strong className="font-mono text-slate-900 bg-white px-1.5 py-0.5 rounded border border-slate-200 font-bold">&quot;{searchTerm.trim()}&quot;</strong>:
                <strong className="text-lime-800 ml-1.5 font-bold font-mono text-sm">{filteredSales.length}</strong> {filteredSales.length === 1 ? 'sale' : 'sales'}
              </span>
            </div>

            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="text-slate-500 font-medium">Search Scope:</span>
              <button
                type="button"
                onClick={() => setSearchAcrossAllDates(true)}
                className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                  searchAcrossAllDates
                    ? 'bg-lime-600 text-white shadow-2xs'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
                title="Search across all historical invoices"
              >
                All Dates ({matchingAllDatesCount})
              </button>
              <button
                type="button"
                onClick={() => setSearchAcrossAllDates(false)}
                className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                  !searchAcrossAllDates
                    ? 'bg-lime-600 text-white shadow-2xs'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
                title={`Restrict search to ${filterDateRange === 'today' ? 'Today' : filterDateRange === 'month' ? 'This Month' : 'Selected Date'}`}
              >
                Only {filterDateRange === 'today' ? 'Today' : filterDateRange === 'month' ? 'This Month' : filterDateRange === 'custom' ? (customDate || 'Custom') : 'Filtered'} ({matchingCurrentDateCount})
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between flex-wrap gap-2 pt-0.5 border-t border-slate-100">
            <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-slate-500">
              <span className="font-semibold text-slate-400">Quick Filters:</span>
              <button
                type="button"
                onClick={() => updateFilters({ range: 'today', mode: 'All', status: 'All' })}
                className={`px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer ${filterDateRange === 'today' && filterMode === 'All' ? 'bg-lime-100 text-lime-800 font-bold' : 'hover:bg-slate-100 text-slate-600'}`}
              >
                Today ({todayCount})
              </button>
              <button
                type="button"
                onClick={() => updateFilters({ range: 'all', mode: 'All', status: 'All' })}
                className={`px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer ${filterDateRange === 'all' && filterMode === 'All' ? 'bg-lime-100 text-lime-800 font-bold' : 'hover:bg-slate-100 text-slate-600'}`}
              >
                All Invoices ({sales.length})
              </button>
              <button
                type="button"
                onClick={() => updateFilters({ mode: 'Credit' })}
                className={`px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer ${filterMode === 'Credit' ? 'bg-purple-100 text-purple-800 font-bold' : 'hover:bg-slate-100 text-slate-600'}`}
              >
                Credit / Khata
              </button>
              <button
                type="button"
                onClick={() => updateFilters({ mode: 'Online' })}
                className={`px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer ${filterMode === 'Online' ? 'bg-blue-100 text-blue-800 font-bold' : 'hover:bg-slate-100 text-slate-600'}`}
              >
                Online
              </button>
              <button
                type="button"
                onClick={() => updateFilters({ status: 'Returned' })}
                className={`px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer ${filterStatus === 'Returned' ? 'bg-red-100 text-red-800 font-bold' : 'hover:bg-slate-100 text-slate-600'}`}
              >
                Returns
              </button>
            </div>
            <span className="text-[10px] text-slate-400 italic hidden lg:inline">
              Tip: Search by #INV, customer, item, phone, or amount across all dates.
            </span>
          </div>
        )}
      </div>

      {/* 3. MOBILE VIEW: EXPANDABLE INVOICE CARDS */}
      <div className="space-y-2 md:hidden">
        {displayedSales.map((sale) => {
          const isExpanded = !!expandedSaleIds[sale.id];
          const isReturned = sale.status === 'Returned';
          const isPartiallyReturned = (sale as any).status === 'Partially Returned';
          const { date, time } = formatSaleDateTime(sale.date || (sale as any).created_at, (sale as any).time || sale.details?.time);

          return (
            <div 
              key={sale.id}
              className={`bg-white rounded-xl border transition-all overflow-hidden ${
                isReturned 
                  ? 'border-red-200 bg-red-50/20' 
                  : isPartiallyReturned
                    ? 'border-amber-200 bg-amber-50/20'
                    : isExpanded 
                      ? 'border-lime-500 shadow-xs ring-1 ring-lime-500/20' 
                      : 'border-slate-200 shadow-2xs'
              }`}
            >
              {/* Header Row (Tap to expand) */}
              <div 
                onClick={() => toggleExpand(sale.id)}
                className="p-3 flex items-center justify-between gap-2 cursor-pointer active:bg-slate-50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span 
                      onClick={(e) => copyInvoiceNumber(e, sale.bill_number || `INV-${sale.id.slice(-6)}`)}
                      className="font-mono font-bold text-[11px] text-slate-900 bg-slate-100 hover:bg-lime-100 hover:text-lime-900 hover:border-lime-300 px-1.5 py-0.5 rounded border border-slate-200 shrink-0 inline-flex items-center gap-1 transition-colors cursor-pointer"
                      title="Click to copy invoice number"
                    >
                      #{sale.bill_number ? sale.bill_number.replace(/^#/, '') : `INV-${sale.id.slice(-6)}`}
                      <Copy size={9} className="opacity-40" />
                    </span>
                    <span className="font-bold text-xs text-slate-800 truncate max-w-[150px]">
                      {sale.customer_name || 'Walk-in'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-slate-500 font-medium flex-wrap">
                    <span className="font-semibold text-slate-800">{date}</span>
                    {time && (
                      <>
                        <span className="text-slate-300">•</span>
                        <span className="text-slate-600 font-mono inline-flex items-center gap-0.5">
                          <Clock size={10} className="text-slate-400 shrink-0" />
                          {time}
                        </span>
                      </>
                    )}
                    <span className="text-slate-300">•</span>
                    {sale.payment_mode !== 'Credit' && sale.status !== 'Returned' && sale.status !== 'Partially Returned' && !(Number(sale.refund_amount || 0) > 0) && canChangeMode ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openModeEditModal(sale); }}
                        className={`px-1.5 py-0.5 rounded font-bold text-[11px] inline-flex items-center gap-1 active:scale-95 transition-transform cursor-pointer ${
                          sale.payment_mode === 'Cash'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-blue-50 text-blue-700 border border-blue-200'
                        }`}
                        title="Payment mode badlein (Cash ⇄ Online)"
                        aria-label={`Payment mode ${sale.payment_mode} — badlein`}
                      >
                        {sale.payment_mode}
                        <ArrowLeftRight size={10} className="opacity-50" />
                      </button>
                    ) : (
                      <span
                        className={`px-1.5 py-0.5 rounded font-bold text-[11px] ${sale.payment_mode === 'Credit' ? 'bg-purple-50 text-purple-700' : sale.payment_mode === 'Cash' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}
                        title={sale.payment_mode === 'Credit' ? 'Udhaar bill — payment khaate se lein' : 'Returned bill ka mode nahi badla ja sakta'}
                      >
                        {sale.payment_mode}
                      </span>
                    )}
                    {sale.items && (
                      <>
                        <span className="text-slate-300">•</span>
                        <span className="text-slate-400">{sale.items.length} {sale.items.length === 1 ? 'item' : 'items'}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <span className={`font-mono font-bold text-xs block ${isReturned ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                      {formatCurrency((sale.total || 0))}
                    </span>
                    {isReturned ? (
                      <span className="text-[9px] font-bold text-red-600 uppercase">Returned</span>
                    ) : isPartiallyReturned ? (
                      <span className="text-[9px] font-bold text-amber-600 uppercase">Partial Ret</span>
                    ) : (
                      <span className="text-[9px] font-bold text-emerald-600 uppercase">Paid</span>
                    )}
                  </div>

                  <div className={`w-6 h-6 rounded-md bg-slate-100 text-slate-500 flex items-center justify-center transition-transform duration-200 ${
                    isExpanded ? 'rotate-180 bg-lime-100 text-lime-800' : ''
                  }`}>
                    <ChevronDown size={14} />
                  </div>
                </div>
              </div>

              {/* Expanded Itemized Breakdown & Actions */}
              <AnimatePresence>
                {isExpanded && (
                  <MotionDiv
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="border-t border-slate-100 bg-slate-50/60 p-3 space-y-2.5"
                  >
                    {/* Date & Time info badge for quick reference */}
                    <div className="flex items-center justify-between bg-white px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs">
                      <div className="flex items-center gap-1.5 text-slate-700 font-semibold">
                        <Calendar size={12} className="text-lime-600 shrink-0" />
                        <span>{date}</span>
                      </div>
                      {time && (
                        <div className="flex items-center gap-1 text-slate-600 font-mono text-[11px]">
                          <Clock size={11} className="text-slate-400 shrink-0" />
                          <span>{time}</span>
                        </div>
                      )}
                    </div>

                    {/* Itemized Items */}
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                        Sold Items
                      </span>
                      <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100">
                        {sale.items && sale.items.length > 0 ? (
                          sale.items.map((it, idx) => (
                            <div key={idx} className="p-2 flex justify-between items-center text-xs">
                              <div>
                                <span className="font-semibold text-slate-800">{it.name}</span>
                                <span className="text-[10px] text-slate-400 block">
                                  {it.qty} {it.unit || 'qty'} @ Rs {it.price}
                                </span>
                              </div>
                              <span className="font-mono font-bold text-slate-900">
                                {formatCurrency((it.total || (it.qty * it.price)))}
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="p-2 text-xs text-slate-400 italic">No item details</div>
                        )}
                      </div>
                    </div>

                    {/* Financial Summary */}
                    <div className="bg-white p-2.5 rounded-lg border border-slate-200 space-y-1 text-xs">
                      <div className="flex justify-between text-slate-500 text-[11px]">
                        <span>Subtotal:</span>
                        <span className="font-mono">{formatCurrency((sale.subtotal || sale.total))}</span>
                      </div>
                      {sale.discount > 0 && (
                        <div className="flex justify-between text-emerald-600 text-[11px] font-semibold">
                          <span>Discount:</span>
                          <span className="font-mono">- {formatCurrency(sale.discount)}</span>
                        </div>
                      )}
                      {sale.refund_amount && sale.refund_amount > 0 && (
                        <div className="flex justify-between text-red-600 text-[11px] font-semibold">
                          <span>Refunded Amount:</span>
                          <span className="font-mono">- {formatCurrency(sale.refund_amount)}</span>
                        </div>
                      )}
                      <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-slate-100 text-xs">
                        <span>Grand Total:</span>
                        <span className="font-mono text-sm">{formatCurrency((sale.total || 0))}</span>
                      </div>
                      {sale.return_reason && (
                        <div className="p-1.5 bg-red-50 text-red-700 rounded text-[10px] mt-1">
                          <strong>Return Reason:</strong> {sale.return_reason}
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => openDetailSale(sale)}
                        className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold flex items-center justify-center gap-1 shadow-2xs transition-all cursor-pointer"
                        title="View Full Details"
                      >
                        <Eye size={13} />
                        <span className="hidden xs:inline">Details</span>
                      </button>

                      <button
                        onClick={() => openReceiptSale(sale)}
                        className="flex-1 py-2 bg-white hover:bg-slate-100 text-slate-800 border border-slate-200 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer"
                      >
                        <Printer size={13} /> View Receipt
                      </button>

                      {sale.payment_mode !== 'Credit' && !isReturned && (
                        <button
                          onClick={() => openModeEditModal(sale)}
                          className="px-2.5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 rounded-lg text-xs font-bold flex items-center justify-center gap-1 shadow-2xs transition-all cursor-pointer"
                          title="Payment Mode Tabdeel Karein"
                        >
                          <ArrowLeftRight size={13} /> Pay Mode
                        </button>
                      )}

                      {!isReturned && (
                        <button
                          onClick={() => openReturnModal(sale)}
                          className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer"
                        >
                          <RotateCcw size={13} /> Return / Refund
                        </button>
                      )}
                    </div>
                  </MotionDiv>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {filteredSales.length > displayedSales.length && (
          <div className="text-center pt-2">
            <button
              onClick={() => setVisibleCount(prev => prev + 50)}
              className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors shadow-2xs"
            >
              Load More Invoices ({displayedSales.length} of {filteredSales.length})
            </button>
          </div>
        )}

        {filteredSales.length === 0 && (
          <div className="bg-white p-8 rounded-xl border border-slate-200 text-center text-slate-400">
            <ShoppingBag size={36} className="mx-auto mb-2 opacity-30 text-slate-400" />
            <p className="text-sm font-bold text-slate-700">
              {searchTerm.trim() ? `No Invoices Found for "${searchTerm.trim()}"` : 'No Sales Invoices Found'}
            </p>
            {searchTerm.trim() ? (
              <div className="mt-2 space-y-2.5">
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  {matchingAllDatesCount > 0 && !searchAcrossAllDates
                    ? `Found ${matchingAllDatesCount} matching invoice(s) across other dates. Click below to view them.`
                    : 'Check the invoice number (e.g. #INV-..., 3E3CE7), customer name, item, or amount.'}
                </p>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  {matchingAllDatesCount > 0 && !searchAcrossAllDates && (
                    <button
                      type="button"
                      onClick={() => setSearchAcrossAllDates(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-lime-600 hover:bg-lime-700 text-white transition-colors shadow-xs cursor-pointer"
                    >
                      View in All Dates ({matchingAllDatesCount})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSearchTerm('');
                      setSearchAcrossAllDates(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                  >
                    Clear Search
                  </button>
                </div>
              </div>
            ) : sales.length > 0 ? (
              <div className="mt-1.5 space-y-3">
                <p className="text-xs text-slate-400">
                  No invoices match the current {filterDateRange === 'today' ? 'Today' : filterDateRange === 'month' ? 'This Month' : 'selected'} filter ({sales.length} total in system).
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setFilterDateRange('all');
                    setFilterMode('All');
                    setFilterStatus('All');
                    setSearchTerm('');
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-lime-500 hover:bg-lime-600 text-slate-900 transition-colors shadow-xs cursor-pointer"
                >
                  View All Invoices ({sales.length})
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-400 mt-1">Try adjusting your search filters or record sales at POS.</p>
            )}
          </div>
        )}
      </div>

      {/* 4. DESKTOP VIEW: TABULAR FORMAT */}
      <div className="hidden md:block bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 text-[11px] uppercase font-bold text-slate-500 tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Invoice #</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-center">Payment</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {displayedSales.map((sale) => {
                const isReturned = sale.status === 'Returned';
                const isPartiallyReturned = (sale as any).status === 'Partially Returned';
                const { date, time } = formatSaleDateTime(sale.date || (sale as any).created_at, (sale as any).time || sale.details?.time);

                return (
                  <tr 
                    key={sale.id} 
                    onClick={() => openDetailSale(sale)}
                    className={`cursor-pointer hover:bg-lime-50/60 transition-colors group ${
                      isReturned ? 'bg-red-50/30' : isPartiallyReturned ? 'bg-amber-50/30' : ''
                    }`}
                  >
                    
                    {/* Invoice # */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span 
                        onClick={(e) => copyInvoiceNumber(e, sale.bill_number || `INV-${sale.id.slice(-6)}`)}
                        className="font-mono font-bold text-slate-900 bg-slate-100 group-hover:bg-white group-hover:border-lime-300 px-2 py-0.5 rounded border border-slate-200 transition-colors inline-flex items-center gap-1.5 hover:bg-lime-50 hover:text-lime-900 cursor-pointer"
                        title="Click to copy Invoice Number"
                      >
                        #{sale.bill_number ? sale.bill_number.replace(/^#/, '') : `INV-${sale.id.slice(-6)}`}
                        <Copy size={11} className="opacity-40 group-hover:opacity-80" />
                      </span>
                    </td>

                    {/* Date */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-slate-800 font-semibold">{date}</span>
                        {time && (
                          <span className="text-[10px] text-slate-400 flex items-center gap-1 font-mono">
                            <Clock size={10} /> {time}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Customer */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-xs shrink-0">
                          {(sale.customer_name || 'W').charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-800 truncate max-w-[160px]">{sale.customer_name || 'Walk-in'}</p>
                          {sale.customer_id && (
                            <span className="text-[10px] text-purple-600 font-semibold">Khata Customer</span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Amount */}
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex flex-col items-end">
                        <span className={`font-mono font-bold text-xs sm:text-sm ${isReturned ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                          {formatCurrency((sale.total || 0))}
                        </span>
                        {sale.discount > 0 && (
                          <span className="text-xs text-emerald-600 font-semibold font-mono">
                            Disc: {formatCurrency(sale.discount)}
                          </span>
                        )}
                        {sale.refund_amount && sale.refund_amount > 0 && (
                          <span className="text-xs text-red-600 font-semibold font-mono">
                            Ref: {formatCurrency(sale.refund_amount)}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Payment Mode */}
                    <td className="px-4 py-3 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      {sale.payment_mode !== 'Credit' ? (
                        <button
                          type="button"
                          onClick={() => openModeEditModal(sale)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold transition-all hover:scale-105 cursor-pointer shadow-2xs group ${
                            sale.payment_mode === 'Cash' 
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300'
                              : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 hover:border-blue-300'
                          }`}
                          title="Payment Mode tabdeel karne ke liye click karein (Cash ⇄ Online)"
                        >
                          {sale.payment_mode === 'Cash' && <DollarSign size={10} />}
                          {sale.payment_mode === 'Online' && <Wallet size={10} />}
                          <span>{sale.payment_mode}</span>
                          <ArrowLeftRight size={9} className="opacity-40 group-hover:opacity-100 transition-opacity ml-0.5" />
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                          <CreditCard size={10} />
                          {sale.payment_mode}
                        </span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      {isReturned ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-200">
                          <XCircle size={11} /> Returned
                        </span>
                      ) : isPartiallyReturned ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                          <RotateCcw size={11} /> Partial Ret
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-lime-100 text-lime-800 border border-lime-200">
                          <CheckCircle2 size={11} /> Completed
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1.5">
                        <button aria-label="View Invoice Details"
                          onClick={() => openDetailSale(sale)}
                          className="p-1.5 bg-slate-100 hover:bg-lime-100 text-slate-700 hover:text-lime-800 rounded-lg transition-colors"
                          title="View Invoice Details"
                        >
                          <Eye size={13} />
                        </button>
                        <button aria-label="View / Print Receipt"
                          onClick={() => openReceiptSale(sale)}
                          className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
                          title="View / Print Receipt"
                        >
                          <Printer size={13} />
                        </button>

                        {sale.payment_mode !== 'Credit' && !isReturned && (
                          <button aria-label="Payment Mode Tabdeel Karein (Cash ⇄ Online)"
                            onClick={() => openModeEditModal(sale)}
                            className="p-1.5 bg-slate-100 hover:bg-blue-100 text-slate-700 hover:text-blue-800 rounded-lg transition-colors border border-transparent hover:border-blue-200"
                            title="Payment Mode Tabdeel Karein (Cash ⇄ Online)"
                          >
                            <ArrowLeftRight size={13} />
                          </button>
                        )}

                        {!isReturned && (
                          <button
                            onClick={() => openReturnModal(sale)}
                            className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors"
                            title="Process Return & Refund"
                          >
                            <RotateCcw size={11} /> Return
                          </button>
                        )}
                      </div>
                    </td>

                  </tr>
                );
              })}

              {filteredSales.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-slate-400">
                    <ShoppingBag size={36} className="mx-auto mb-2 opacity-30 text-slate-400" />
                    <p className="text-sm font-bold text-slate-700">
                      {searchTerm.trim() ? `No Invoices Found for "${searchTerm.trim()}"` : 'No Sales Invoices Found'}
                    </p>
                    {searchTerm.trim() ? (
                      <div className="mt-2 space-y-2.5">
                        <p className="text-xs text-slate-500 max-w-sm mx-auto">
                          {matchingAllDatesCount > 0 && !searchAcrossAllDates
                            ? `Found ${matchingAllDatesCount} matching invoice(s) across other dates. Click below to view them.`
                            : 'Check invoice number (e.g. #INV-..., 3E3CE7), customer name, item, or amount.'}
                        </p>
                        <div className="flex items-center justify-center gap-2 flex-wrap">
                          {matchingAllDatesCount > 0 && !searchAcrossAllDates && (
                            <button
                              type="button"
                              onClick={() => setSearchAcrossAllDates(true)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-lime-600 hover:bg-lime-700 text-white transition-colors shadow-xs cursor-pointer"
                            >
                              View in All Dates ({matchingAllDatesCount})
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setSearchTerm('');
                              setSearchAcrossAllDates(true);
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                          >
                            Clear Search
                          </button>
                        </div>
                      </div>
                    ) : sales.length > 0 ? (
                      <div className="mt-1.5 space-y-3">
                        <p className="text-xs text-slate-400">
                          No invoices match the current {filterDateRange === 'today' ? 'Today' : filterDateRange === 'month' ? 'This Month' : 'selected'} filter ({sales.length} total in system).
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setFilterDateRange('all');
                            setFilterMode('All');
                            setFilterStatus('All');
                            setSearchTerm('');
                          }}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-lime-500 hover:bg-lime-600 text-slate-900 transition-colors shadow-xs cursor-pointer"
                        >
                          View All Invoices ({sales.length})
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 mt-1">Try adjusting your search filters or record sales at POS.</p>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {filteredSales.length > displayedSales.length && (
          <div className="p-3 bg-slate-50 border-t border-slate-200 text-center">
            <button
              onClick={() => setVisibleCount(prev => prev + 50)}
              className="px-6 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition-colors shadow-2xs"
            >
              Load More Invoices ({displayedSales.length} of {filteredSales.length})
            </button>
          </div>
        )}
      </div>

      {/* --- MODAL 0: INVOICE / SALE DETAILS DIALOG --- */}
      {selectedDetailSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-xs">
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
            
            {/* Modal Header */}
            <div className="px-5 py-4 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white flex justify-between items-center border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-lime-100 dark:bg-lime-950/40 text-lime-700 dark:text-lime-300 flex items-center justify-center font-bold border border-lime-200 dark:border-lime-800/40">
                  <FileText size={16} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 
                      onClick={(e) => copyInvoiceNumber(e, selectedDetailSale.bill_number || `INV-${selectedDetailSale.id.slice(-6)}`)}
                      className="font-bold text-sm sm:text-base text-slate-900 dark:text-white font-mono cursor-pointer hover:text-lime-600 flex items-center gap-1.5 transition-colors"
                      title="Click to copy Invoice Number"
                    >
                      #{selectedDetailSale.bill_number ? selectedDetailSale.bill_number.replace(/^#/, '') : `INV-${selectedDetailSale.id.slice(-6)}`}
                      <Copy size={12} className="opacity-50" />
                    </h3>
                    <span className={`text-[10px] font-bold px-2 py-0.2 rounded-full ${
                      selectedDetailSale.status === 'Returned'
                        ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                        : (selectedDetailSale as any).status === 'Partially Returned'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'bg-lime-500/20 text-lime-300 border border-lime-500/30'
                    }`}>
                      {selectedDetailSale.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-mono">
                    {formatSaleDateTime(selectedDetailSale.date).date} • {formatSaleDateTime(selectedDetailSale.date).time}
                  </p>
                </div>
              </div>
              <button aria-label="Band karein" 
                onClick={() => openDetailSale(null)} 
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              
              {/* Customer & Payment Info Banner */}
              <div className="grid grid-cols-2 gap-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200/80 text-xs">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">Customer</span>
                  <span className="font-bold text-slate-900 block truncate">
                    {selectedDetailSale.customer_name || 'Walk-in Customer'}
                  </span>
                  {selectedDetailSale.customer_id && (
                    <span className="text-[10px] text-purple-700 font-semibold">Khata Account</span>
                  )}
                </div>

                <div className="text-right">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">Payment Mode</span>
                  <div className="flex items-center gap-1.5 justify-end">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                      selectedDetailSale.payment_mode === 'Cash'
                        ? 'bg-emerald-100 text-emerald-800'
                        : selectedDetailSale.payment_mode === 'Online'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-purple-100 text-purple-800'
                    }`}>
                      {selectedDetailSale.payment_mode}
                    </span>
                    {selectedDetailSale.payment_mode !== 'Credit' && selectedDetailSale.status !== 'Returned' && (
                      <button
                        type="button"
                        onClick={() => {
                          const s = selectedDetailSale;
                          openDetailSale(null);
                          openModeEditModal(s);
                        }}
                        className="px-2 py-0.5 text-[10px] font-bold text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 rounded-md border border-blue-200 transition-colors inline-flex items-center gap-1 cursor-pointer"
                        title="Payment mode tabdeel karein"
                      >
                        <ArrowLeftRight size={10} /> Change
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Sold Items Table */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                    Sold Items ({selectedDetailSale.items?.length || 0})
                  </span>
                </div>
                
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 tracking-wider border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2">Item</th>
                        <th className="px-2 py-2 text-center">Qty</th>
                        <th className="px-2 py-2 text-right">Price</th>
                        <th className="px-3 py-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedDetailSale.items && selectedDetailSale.items.length > 0 ? (
                        selectedDetailSale.items.map((it, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/50">
                            <td className="px-3 py-2.5">
                              <span className="font-bold text-slate-900 block">{it.name}</span>
                              {(it as any).variantName && (
                                <span className="text-[10px] text-slate-400 block">{(it as any).variantName}</span>
                              )}
                            </td>
                            <td className="px-2 py-2.5 text-center font-bold text-slate-800">
                              {it.qty} <span className="text-[10px] font-normal text-slate-400">{(it as any).variantName || (it as any).unit || 'Unit'}</span>
                            </td>
                            <td className="px-2 py-2.5 text-right font-mono text-slate-600">
                              {formatCurrency(it.price)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono font-bold text-slate-900">
                              {formatCurrency((it.total || (it.qty * it.price)))}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4} className="p-4 text-center text-slate-400 italic">No item details recorded</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Financial Calculation Breakdown */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal:</span>
                  <span className="font-mono font-semibold">{formatCurrency((selectedDetailSale.subtotal || selectedDetailSale.total))}</span>
                </div>
                {selectedDetailSale.discount > 0 && (
                  <div className="flex justify-between text-emerald-600 font-semibold">
                    <span>Discount:</span>
                    <span className="font-mono">- {formatCurrency(selectedDetailSale.discount)}</span>
                  </div>
                )}
                {selectedDetailSale.refund_amount && selectedDetailSale.refund_amount > 0 && (
                  <div className="flex justify-between text-red-600 font-semibold">
                    <span>Refunded Amount:</span>
                    <span className="font-mono">- {formatCurrency(selectedDetailSale.refund_amount)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center font-black text-slate-900 pt-2 border-t border-slate-200">
                  <span className="text-sm">Grand Total:</span>
                  <span className="text-base font-mono text-lime-700">{formatCurrency((selectedDetailSale.total || 0))}</span>
                </div>

                {selectedDetailSale.return_reason && (
                  <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-[11px] mt-2">
                    <strong>Return Reason:</strong> {selectedDetailSale.return_reason}
                  </div>
                )}
              </div>

            </div>

            {/* Modal Footer Actions */}
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => openDetailSale(null)}
                className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-semibold rounded-xl text-xs border border-slate-200 transition-colors"
              >
                Close
              </button>

              <div className="flex items-center gap-2">
                {selectedDetailSale.status !== 'Returned' && (
                  <button
                    type="button"
                    onClick={() => {
                      const s = selectedDetailSale;
                      openDetailSale(null);
                      openReturnModal(s);
                    }}
                    className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors"
                  >
                    <RotateCcw size={13} /> Return
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    const s = selectedDetailSale;
                    openDetailSale(null);
                    openReceiptSale(s);
                  }}
                  className="px-4 py-2 bg-lime-600 hover:bg-lime-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                >
                  <Printer size={13} /> Print Receipt
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* --- MODAL 1: ITEM-LEVEL RETURN / REFUND MODAL --- */}
      {returnModalSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-xs">
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
            
            {/* Header */}
            <div className="px-5 py-4 border-b bg-amber-500/10 border-amber-100 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold">
                  <RotateCcw size={16} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Return & Refund</h3>
                  <p className="text-[11px] text-slate-500 font-mono">Bill: {returnModalSale.bill_number}</p>
                </div>
              </div>
              <button aria-label="Band karein" onClick={() => setReturnModalSale(null)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmReturn} className="p-4 sm:p-5 space-y-3.5 max-h-[82vh] overflow-y-auto">
              
              {/* 1. Item-Level Selection Section */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700">
                    Select Items to Return
                  </label>
                  <button
                    type="button"
                    onClick={() => selectAllReturnItems(returnItems.some(i => !i.isSelected))}
                    className="text-[10px] font-bold text-lime-700 hover:text-lime-800 bg-lime-50 px-2 py-0.5 rounded border border-lime-200 cursor-pointer"
                  >
                    {returnItems.every(i => i.isSelected) ? 'Deselect All' : 'Select All'}
                  </button>
                </div>

                <div className="bg-slate-50 rounded-xl border border-slate-200 divide-y divide-slate-200/80 max-h-44 overflow-y-auto">
                  {returnItems.map((item, idx) => {
                    return (
                      <div key={idx} className={`p-2.5 flex items-center justify-between gap-2 transition-colors ${item.isSelected ? 'bg-white' : 'opacity-60'}`}>
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <input
                            type="checkbox"
                            checked={item.isSelected}
                            onChange={() => toggleItemSelection(idx)}
                            className="w-4 h-4 rounded text-lime-600 focus:ring-lime-500 cursor-pointer"
                          />
                          <div className="min-w-0">
                            <span className="font-bold text-xs text-slate-800 block truncate">{item.name}</span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              Sold: {item.soldQty} {item.unit || 'L'} • Rs {item.price}/{item.unit || 'L'}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <div className="flex items-center bg-slate-50 rounded-lg border border-slate-200 px-1.5 py-0.5 focus-within:border-lime-500 focus-within:bg-white transition-all">
                            <input
                              type="number"
                              step={item.wholeOnly ? 1 : 'any'}
                              min="0"
                              max={item.soldQty}
                              value={item.returnQty === 0 ? '' : item.returnQty}
                              onChange={(e) => updateItemReturnQty(idx, parseFloat(e.target.value))}
                              disabled={!item.isSelected}
                              className="w-12 bg-transparent text-right font-bold font-mono text-xs text-slate-800 outline-none"
                              placeholder="0"
                            />
                            <span className="text-[10px] text-slate-400 font-semibold pl-1">{item.unit || 'L'}</span>
                          </div>

                          <div className="text-right w-16">
                            <span className="font-mono font-bold text-xs text-slate-900 block">
                              {formatCurrency(((item.isSelected ? item.returnQty : 0) * item.price))}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 2. Resolution Method */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Resolution Method</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setReturnAction('refund')}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      returnAction === 'refund' 
                        ? 'border-red-500 bg-red-50 text-red-900 ring-1 ring-red-500 font-bold' 
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs">
                      <DollarSign size={14} className={returnAction === 'refund' ? 'text-red-600' : 'text-slate-400'} />
                      <span>Refund Money</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setReturnAction('replace');
                      setRestockOption('scrap_spoilage');
                    }}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      returnAction === 'replace' 
                        ? 'border-blue-500 bg-blue-50 text-blue-900 ring-1 ring-blue-500 font-bold' 
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs">
                      <RotateCcw size={14} className={returnAction === 'replace' ? 'text-blue-600' : 'text-slate-400'} />
                      <span>Replace Milk</span>
                    </div>
                  </button>
                </div>
              </div>

              {/* 3. Calculated Amount Banner */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex justify-between items-center">
                <div>
                  <span className="text-xs text-slate-500 font-semibold block">
                    {returnAction === 'replace' ? 'Replacement Value' : 'Total Refund Amount'}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Selected: <strong className="text-slate-700">{activeReturnItems.length} item(s)</strong> • Mode: <strong className="text-slate-700">{returnModalSale.payment_mode}</strong>
                  </span>
                </div>
                <div className="text-right">
                  <span className={`text-base font-bold font-mono ${returnAction === 'replace' ? 'text-blue-600' : 'text-red-600'}`}>
                    {returnAction === 'replace' ? 'Rs 0.00' : `${formatCurrency(currentRefundAmount)}`}
                  </span>
                  {returnAction === 'replace' && (
                    <span className="text-xs text-slate-400 block">(Fresh stock worth {formatCurrency(currentRefundAmount)} issued)</span>
                  )}
                </div>
              </div>

              {/* 4. Reason */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Return Reason *</label>
                <select
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-lime-500"
                  value={returnReason}
                  onChange={e => {
                    const r = e.target.value;
                    setReturnReason(r);
                    if (r === 'Defective / Spoiled Product') {
                      setRestockOption('scrap_spoilage');
                    }
                  }}
                >
                  <option value="Customer Changed Mind">Customer Changed Mind</option>
                  <option value="Defective / Spoiled Product">Defective / Spoiled Product</option>
                  <option value="Wrong Item Billed">Wrong Item Billed</option>
                  <option value="Packaging Damaged">Packaging Damaged</option>
                  <option value="Other">Other Reason...</option>
                </select>
              </div>

              {returnReason === 'Other' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Reason Description</label>
                  <input
                    type="text"
                    required
                    placeholder="Describe reason..."
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-lime-500"
                    value={customReturnReason}
                    onChange={e => setCustomReturnReason(e.target.value)}
                  />
                </div>
              )}

              {/* 5. Stock Disposal */}
              {returnAction === 'refund' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Stock Disposal</label>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <label className={`flex items-start gap-1.5 p-2 rounded-xl border cursor-pointer ${
                      restockOption === 'scrap_spoilage' ? 'border-amber-500 bg-amber-50/60 text-amber-900 font-semibold' : 'border-slate-200'
                    }`}>
                      <input 
                        type="radio" 
                        name="restockOption" 
                        className="mt-0.5" 
                        checked={restockOption === 'scrap_spoilage'} 
                        onChange={() => setRestockOption('scrap_spoilage')}
                      />
                      <span>Dump as Spoilage</span>
                    </label>

                    <label className={`flex items-start gap-1.5 p-2 rounded-xl border cursor-pointer ${
                      restockOption === 'restock' ? 'border-lime-500 bg-lime-50/60 text-lime-900 font-semibold' : 'border-slate-200'
                    }`}>
                      <input 
                        type="radio" 
                        name="restockOption" 
                        className="mt-0.5" 
                        checked={restockOption === 'restock'} 
                        onChange={() => setRestockOption('restock')}
                      />
                      <span>Restock to Counter</span>
                    </label>
                  </div>
                </div>
              )}

              {/* 6. Refund Payment Mode & Accidental Cash Correction */}
              {returnAction === 'refund' && returnModalSale.payment_mode !== 'Credit' && (
                <div className="space-y-2.5 pt-1">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Refund Kis Tarah Dena Hy? (Payment Mode)
                    </label>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => handleRefundModeChange('Cash')}
                        className={`p-2.5 rounded-xl border flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                          refundPaymentMode === 'Cash'
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-900 font-bold ring-1 ring-emerald-500'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <DollarSign size={13} className={refundPaymentMode === 'Cash' ? 'text-emerald-600' : 'text-slate-400'} />
                        <span>Cash (Drawer)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRefundModeChange('Online')}
                        className={`p-2.5 rounded-xl border flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                          refundPaymentMode === 'Online'
                            ? 'border-blue-500 bg-blue-50 text-blue-900 font-bold ring-1 ring-blue-500'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <Wallet size={13} className={refundPaymentMode === 'Online' ? 'text-blue-600' : 'text-slate-400'} />
                        <span>Online / Bank Transfer</span>
                      </button>
                    </div>
                  </div>

                  {/* Accidental Cash Selection Fix Option */}
                  {returnModalSale.payment_mode === 'Cash' && (
                    <div className="p-3 bg-amber-50/90 border border-amber-200 rounded-xl space-y-1">
                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={correctOriginalSaleMode}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setCorrectOriginalSaleMode(checked);
                            if (checked) {
                              handleRefundModeChange('Online');
                            }
                          }}
                          className="mt-0.5 rounded text-amber-600 focus:ring-amber-500 w-4 h-4 cursor-pointer"
                        />
                        <div className="text-left">
                          <span className="text-xs font-bold text-amber-900 block">
                            Ghalati se Cash select hua tha? Original sale ko "Online" mark karein
                          </span>
                          <span className="text-[11px] text-amber-700 leading-snug block mt-0.5">
                            Customer ne online pay kiya tha lekin sale Cash par cut gayi thi? Is option ko tick karein taake sale "Online" me convert ho jaye aur Cash Drawer ka balance theek rahe.
                          </span>
                        </div>
                      </label>
                    </div>
                  )}

                  {/* Account selection */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {refundPaymentMode === 'Cash' ? 'Deduct From Cash Account' : 'Deduct From Bank / Digital Account'}
                    </label>
                    <select
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 outline-none focus:border-lime-500"
                      value={refundAccountId}
                      onChange={e => setRefundAccountId(e.target.value)}
                    >
                      <option value="">Auto-Detect Default Account</option>
                      {accounts
                        .filter(a => a.isActive !== false)
                        .filter(a => refundPaymentMode === 'Cash' ? (a.type === 'Cash' || a.type === 'Drawer') : (a.type === 'Bank' || a.type === 'Wallet'))
                        .map(acc => (
                          <option key={acc.id} value={acc.id}>
                            {acc.name} ({acc.type}) - Bal: {formatCurrency(acc.balance)}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setReturnModalSale(null)}
                  className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isProcessingReturn || activeReturnItems.length === 0}
                  className={`flex-1 py-2 font-bold rounded-xl text-xs text-white shadow-xs transition-all flex items-center justify-center gap-1.5 ${
                    activeReturnItems.length === 0 || isProcessingReturn
                      ? 'bg-slate-300 cursor-not-allowed'
                      : returnAction === 'replace' 
                        ? 'bg-blue-600 hover:bg-blue-700' 
                        : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  <RotateCcw size={14} /> {isProcessingReturn ? 'Processing...' : `Confirm Return (${activeReturnItems.length})`}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* --- MODAL 2: VIEW / PRINT THERMAL RECEIPT --- */}
      {selectedReceiptSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-xs print:p-0 print:bg-white">
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 print:shadow-none print:w-full print:max-w-none">
            
            {/* Header */}
            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white flex justify-between items-center border-b border-slate-200 dark:border-slate-700 print:hidden">
              <div className="flex items-center gap-2">
                <Printer size={15} className="text-lime-600 dark:text-lime-400" />
                <span className="font-bold text-xs">Receipt Preview</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrintReceipt}
                  className="px-2.5 py-1 bg-lime-600 hover:bg-lime-700 text-white font-bold rounded-lg text-xs flex items-center gap-1 transition-all shadow-xs cursor-pointer"
                >
                  <Printer size={12} /> Print
                </button>
                <button aria-label="Band karein" onClick={() => openReceiptSale(null)} className="text-slate-400 hover:text-white p-1 rounded-lg">
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Receipt Body */}
            <div className="p-5 font-mono text-slate-800 text-xs space-y-2.5 bg-white" id="printable-receipt">
              
              {/* Brand Header */}
              <div className="text-center space-y-0.5 pb-2.5 border-b border-dashed border-slate-300">
                <h2 className="font-black text-sm tracking-tight text-slate-900">{settings.general?.companyName || 'MOOCO DAIRY'}</h2>
                <p className="text-[10px] text-slate-500">{settings.general?.address || 'Fresh & Pure Farm Dairy'}</p>
                <p className="text-[10px] text-slate-500">Tel: {settings.general?.phone || '0300-1234567'}</p>
                {settings.general?.taxId && <p className="text-[10px] text-slate-500">NTN: {settings.general.taxId}</p>}
                {selectedReceiptSale.status === 'Returned' && (
                  <div className="inline-block mt-1 px-2 py-0.5 bg-red-100 text-red-700 font-bold rounded text-[9px] uppercase">
                    *** RETURNED ***
                  </div>
                )}
              </div>

              {/* Invoice Meta */}
              <div className="text-[10px] space-y-0.5 border-b border-dashed border-slate-300 pb-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Invoice:</span>
                  <span className="font-bold">{selectedReceiptSale.bill_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Date:</span>
                  <span className="font-bold">{formatSaleDateTime(selectedReceiptSale.date || (selectedReceiptSale as any).created_at, (selectedReceiptSale as any).time || selectedReceiptSale.details?.time).date}</span>
                </div>
                {formatSaleDateTime(selectedReceiptSale.date || (selectedReceiptSale as any).created_at, (selectedReceiptSale as any).time || selectedReceiptSale.details?.time).time && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Time:</span>
                    <span className="font-bold font-mono">{formatSaleDateTime(selectedReceiptSale.date || (selectedReceiptSale as any).created_at, (selectedReceiptSale as any).time || selectedReceiptSale.details?.time).time}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">Customer:</span>
                  <span className="font-bold">{selectedReceiptSale.customer_name || 'Walk-in'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Payment:</span>
                  <span className="font-bold">{selectedReceiptSale.payment_mode}</span>
                </div>
              </div>

              {/* Itemized Table */}
              <div className="space-y-1 border-b border-dashed border-slate-300 pb-2">
                <div className="flex justify-between font-bold text-[9px] text-slate-400 uppercase">
                  <span>Item</span>
                  <span className="text-right">Qty x Rate = Total</span>
                </div>
                {selectedReceiptSale.items?.map((it, idx) => (
                  <div key={idx} className="flex justify-between items-baseline text-[10px]">
                    <span className="font-semibold">{it.name}</span>
                    <span className="font-bold text-right shrink-0">
                      {it.qty} x {it.price} = {formatCurrency((it.total || it.qty * it.price))}
                    </span>
                  </div>
                ))}
              </div>

              {/* Totals */}
              <div className="space-y-0.5 text-[10px] pt-0.5">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal:</span>
                  <span>{formatCurrency((selectedReceiptSale.subtotal || selectedReceiptSale.total))}</span>
                </div>
                {selectedReceiptSale.discount > 0 && (
                  <div className="flex justify-between text-emerald-600 font-semibold">
                    <span>Discount:</span>
                    <span>- {formatCurrency(selectedReceiptSale.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-black text-xs pt-1 border-t border-slate-900 text-slate-900">
                  <span>TOTAL:</span>
                  <span>{formatCurrency((selectedReceiptSale.total || 0))}</span>
                </div>
              </div>

              {/* Footer */}
              <div className="text-center pt-2.5 text-[9px] text-slate-400 border-t border-dashed border-slate-300">
                <p className="font-bold text-slate-700">{settings.sales?.invoiceFooter || 'Thank you for your purchase!'}</p>
                <p>Pure Milk & Dairy Essentials</p>
              </div>

            </div>

          </div>
        </div>
      )}

      {/* --- MODAL 3: QUICK CHANGE PAYMENT MODE (CASH <-> ONLINE) --- */}
      {modeEditSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-100 dark:border-slate-800 animate-in zoom-in-95 duration-150">
            
            {/* Header */}
            <div className="px-5 py-4 bg-linear-to-r from-blue-600 to-indigo-700 text-white flex justify-between items-center">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-xs">
                  <ArrowLeftRight size={18} className="text-white" />
                </div>
                <div>
                  <h3 className="font-black text-sm tracking-tight">Payment Mode Tabdeel Karein</h3>
                  <p className="text-xs text-blue-100">Bill #{modeEditSale.bill_number} • {formatCurrency((modeEditSale.total || 0))}</p>
                </div>
              </div>
              <button aria-label="Band karein"
                onClick={() => setModeEditSale(null)}
                className="text-white/80 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleConfirmModeChange} className="p-5 space-y-4">
              {/* Info card */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-700 text-xs space-y-1.5">
                <div className="flex justify-between items-center text-slate-500 dark:text-slate-400">
                  <span>Customer:</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{modeEditSale.customer_name || 'Walk-in Customer'}</span>
                </div>
                <div className="flex justify-between items-center text-slate-500 dark:text-slate-400">
                  <span>Current Mode:</span>
                  <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                    modeEditSale.payment_mode === 'Cash' 
                      ? 'bg-emerald-100 text-emerald-800' 
                      : 'bg-blue-100 text-blue-800'
                  }`}>
                    {modeEditSale.payment_mode}
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200 dark:border-slate-700">
                  <span>Bill Amount:</span>
                  <span className="font-mono font-black text-sm text-slate-900 dark:text-white">
                    {formatCurrency((modeEditSale.total || 0))}
                  </span>
                </div>
              </div>

              {/* Target Mode Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                  Naya Payment Mode Muntakhib Karein
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => handleTargetModeChange('Cash')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      targetMode === 'Cash'
                        ? 'border-emerald-500 bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-300 ring-2 ring-emerald-500 font-bold'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <DollarSign size={16} className={targetMode === 'Cash' ? 'text-emerald-600' : 'text-slate-400'} />
                      <span className="text-xs">Cash (Drawer)</span>
                    </div>
                    <p className="text-[10px] font-normal opacity-80">Physical drawer me jama hoga</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleTargetModeChange('Online')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      targetMode === 'Online'
                        ? 'border-blue-500 bg-blue-50/80 dark:bg-blue-950/40 text-blue-900 dark:text-blue-300 ring-2 ring-blue-500 font-bold'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Wallet size={16} className={targetMode === 'Online' ? 'text-blue-600' : 'text-slate-400'} />
                      <span className="text-xs">Online Transfer</span>
                    </div>
                    <p className="text-[10px] font-normal opacity-80">Bank / Digital Wallet me jama</p>
                  </button>
                </div>
              </div>

              {/* Account Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  {targetMode === 'Online' ? 'Muntakhib Bank / Digital Wallet Account' : 'Muntakhib Cash Account'}
                </label>
                <select
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2.5 text-xs font-medium text-slate-800 dark:text-slate-100 outline-none focus:border-blue-500"
                  value={targetAccountId}
                  onChange={e => setTargetAccountId(e.target.value)}
                  required
                >
                  <option value="">-- Account Select Karein --</option>
                  {accounts
                    .filter(a => a.isActive !== false)
                    .filter(a => targetMode === 'Online' ? (a.type === 'Bank' || a.type === 'Wallet') : (a.type === 'Cash' || a.type === 'Drawer'))
                    .map(acc => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} ({acc.type}) - Balance: {formatCurrency(acc.balance)}
                      </option>
                    ))}
                </select>
              </div>

              {/* Automated Balancing Note */}
              <div className="p-3 bg-blue-50/70 dark:bg-blue-950/30 rounded-xl border border-blue-200/80 dark:border-blue-900 text-[11px] text-blue-800 dark:text-blue-300 flex items-start gap-2">
                <CheckCircle2 size={15} className="text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <strong>Automatic Financial Balancing:</strong>
                  <p className="mt-0.5 text-blue-700 dark:text-blue-300/90 leading-tight">
                    {modeEditSale.payment_mode === 'Cash' && targetMode === 'Online'
                      ? "Cash Drawer se yeh raqam nikaal kar muntakhib Bank Account me credit ho jayegi. Drawer closing bilkul exact aur barabar rahegi."
                      : "Bank account se raqam nikaal kar Cash Drawer me add ho jayegi."}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setModeEditSale(null)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingMode || !targetAccountId}
                  className={`flex-1 py-2.5 font-bold rounded-xl text-xs text-white shadow-xs transition-all flex items-center justify-center gap-1.5 ${
                    isUpdatingMode || !targetAccountId
                      ? 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 cursor-pointer'
                  }`}
                >
                  <ArrowLeftRight size={14} />
                  {isUpdatingMode ? 'Tabdeel Ho Raha Hy...' : `Tabdeel Karein (${targetMode})`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default SalesHistory;
