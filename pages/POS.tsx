import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { useTabs } from '../context/TabContext';
import { roundCurrency, roundQuantity } from '../lib/db';
import { cleanNumber, cleanQty, formatQty, formatCurrency } from '../lib/formatters';
import { checkoutCustomerOrder, getCustomerOrder } from '../lib/customerOrders';
import { CustomerOrder } from '../types';
import { stepWholeQuantity } from '../lib/posQuickEntry';
import { cartLineContains, cartLineUsesMainStock, qtyAfterUnitSwitch, reservedBaseQty, sellUnitContains, sellUnitPrice } from '../lib/sellUnits';
import { ShoppingCart, ClipboardCheck, ArrowLeft, Loader2, AlertCircle, Banknote } from 'lucide-react';
import { PosShiftModal } from '../components/PosShiftModal';
import { HeldOrder, AvailableProduct, PosNewCustomerData, LastCompletedSale } from '../components/pos/PosTypes';
import { PosHeaderAnalytics } from '../components/pos/PosHeaderAnalytics';
import { PosProductGrid } from '../components/pos/PosProductGrid';
import { PosCustomerSelect } from '../components/pos/PosCustomerSelect';
import { PosCart } from '../components/pos/PosCart';
import { PosPaymentPanel } from '../components/pos/PosPaymentPanel';
import { 
  PosQuickAmountModal, 
  PosHeldOrdersModal, 
  PosShortcutsModal, 
  PosReceiptModal, 
  PosNewCustomerModal, 
  PosEditItemModal 
} from '../components/pos/PosModals';
import { confirmAction } from '../components/ui/ConfirmDialog';
import { useManagerApproval } from '../components/ui/ManagerApproval';

/** Packs of one packed variant already sitting in the cart, excluding one line. Packed twin of reservedBaseQty. */
const reservedPackedQty = (cart: any[], productId: string, variantId: string, exceptCartItemId?: string): number => cleanQty(cart
  .filter(line => line.id === productId && line.variantId === variantId && line.cartItemId !== exceptCartItemId && !cartLineUsesMainStock(line))
  .reduce((sum, line) => sum + (Number(line.qty) || 0), 0));

const POS: React.FC = () => {
  const {
    inventory, customers, addSale, addCustomer, items, sales, settings, accounts,
    currentUser, activeShiftSession, isDayLocked, getBusinessDate, setIsUserSwitcherOpen, retryLoading, canPerform, hasPermission
  } = useDairy();
  const { showToast } = useToast();
  const { requestApproval, approvalDialog } = useManagerApproval(); 
  const navigate = useNavigate(); 
  const location = useLocation();
  const bookingId = new URLSearchParams(location.search).get('order');
  const [booking, setBooking] = useState<CustomerOrder | null>(null);
  const [bookingError, setBookingError] = useState('');
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingReload, setBookingReload] = useState(0);

  // Booking checkout is a separate, read-only bill. It never overwrites a counter cart.
  const counterState = useRef<any>(null);
  const cartRef = useRef<any[]>([]);

  const isTodayLocked = isDayLocked(getBusinessDate()); 
  
  const [cart, setCart] = useState<any[]>(() => {
    try {
      const draft = sessionStorage.getItem('mooco_pos_cart_draft');
      if (draft) {
        const parsed = JSON.parse(draft);
        if (Array.isArray(parsed.cart)) return parsed.cart;
      }
    } catch {}
    return [];
  });
  cartRef.current = cart;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(() => {
    try {
      const draft = sessionStorage.getItem('mooco_pos_cart_draft');
      if (draft) {
        const parsed = JSON.parse(draft);
        if (parsed.selectedCustomerId) return parsed.selectedCustomerId;
      }
    } catch {}
    return '';
  });
  const [paymentMode, setPaymentMode] = useState<string>(() => {
    try {
      const draft = sessionStorage.getItem('mooco_pos_cart_draft');
      if (draft) {
        const parsed = JSON.parse(draft);
        if (parsed.paymentMode) return parsed.paymentMode;
      }
    } catch {}
    return 'Cash';
  });
  const [searchProduct, setSearchProduct] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [mobileTab, setMobileTab] = useState<'catalog' | 'cart'>('catalog');
  const showProductSearch = settings.sales?.showPosSearch !== false;
  const showProductCategories = settings.sales?.showPosCategories !== false;
  useEffect(() => { if (!showProductSearch) setSearchProduct(''); }, [showProductSearch]);
  useEffect(() => { if (!showProductCategories) setSelectedCategories([]); }, [showProductCategories]);

  // Direct product search or customer from Command Palette or URL
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const prodQuery = params.get('product');
    if (prodQuery) {
      setSearchProduct(prodQuery);
      setMobileTab('catalog');
    }
    // `quick=<productId>` (from the product detail page) opens that product's quick-entry dialog once the catalog is ready.
    const quickId = params.get('quick');
    if (quickId) {
      const quickMode = params.get('quickMode');
      const quickValue = params.get('quickValue');
      setPendingQuick({
        id: quickId,
        initial: (quickMode === 'amount' || quickMode === 'qty') && quickValue ? { mode: quickMode, value: quickValue, variantId: params.get('quickVariant') || undefined } : null,
      });
    }
    const custQuery = params.get('customer') || params.get('customerId');
    if (custQuery && custQuery !== selectedCustomerId) {
      setSelectedCustomerId(custQuery);
    }
  }, [location.search]);

  useEffect(() => {
    const handleSelectProduct = (e: any) => {
      const prod = e?.detail?.product;
      if (prod?.name) {
        setMobileTab('catalog');
        if (e.detail.openQuick && prod.id) setPendingQuick({ id: prod.id, initial: e.detail.initial || null });
        else setSearchProduct(prod.name);
      }
    };
    window.addEventListener('mooco-select-product', handleSelectProduct);
    return () => window.removeEventListener('mooco-select-product', handleSelectProduct);
  }, []);

  // Discount & Tendered Amount State
  const [discountType, setDiscountType] = useState<'flat' | 'percent'>(() => {
    try {
      const draft = sessionStorage.getItem('mooco_pos_cart_draft');
      if (draft) {
        const parsed = JSON.parse(draft);
        if (parsed.discountType) return parsed.discountType;
      }
    } catch {}
    return 'flat';
  });
  const [discountValue, setDiscountValue] = useState<string>(() => {
    try {
      const draft = sessionStorage.getItem('mooco_pos_cart_draft');
      if (draft) {
        const parsed = JSON.parse(draft);
        if (parsed.discountValue) return parsed.discountValue;
      }
    } catch {}
    return '';
  });
  const [cashReceived, setCashReceived] = useState<string>(() => {
    try {
      const draft = sessionStorage.getItem('mooco_pos_cart_draft');
      if (draft) {
        const parsed = JSON.parse(draft);
        if (parsed.cashReceived) return parsed.cashReceived;
      }
    } catch {}
    return '';
  });
  const [customerPaidAmount, setCustomerPaidAmount] = useState<string>(() => {
    try {
      const draft = sessionStorage.getItem('mooco_pos_cart_draft');
      if (draft) {
        const parsed = JSON.parse(draft);
        if (parsed.customerPaidAmount) return parsed.customerPaidAmount;
      }
    } catch {}
    return '';
  });

  // Sync active counter draft to sessionStorage so switching tabs never resets state
  useEffect(() => {
    if (bookingId) return;
    try {
      if (cart.length > 0 || selectedCustomerId || discountValue || cashReceived || customerPaidAmount) {
        sessionStorage.setItem('mooco_pos_cart_draft', JSON.stringify({
          cart,
          selectedCustomerId,
          paymentMode,
          discountType,
          discountValue,
          cashReceived,
          customerPaidAmount
        }));
      } else {
        sessionStorage.removeItem('mooco_pos_cart_draft');
      }
    } catch {}
  }, [cart, selectedCustomerId, paymentMode, discountType, discountValue, cashReceived, customerPaidAmount, bookingId]);

  useEffect(() => {
    if (!bookingId) {
      setBooking(null); setBookingError(''); setBookingLoading(false);
      if (counterState.current) {
        const saved = counterState.current; counterState.current = null;
        isRecallingRef.current = true;
        setCart(saved.cart); setSelectedCustomerId(saved.customerId); setPaymentMode(saved.paymentMode);
        setDiscountType(saved.discountType); setDiscountValue(saved.discountValue);
        setCashReceived(saved.cashReceived); setCustomerPaidAmount(saved.customerPaidAmount); setMobileTab(saved.mobileTab);
      }
      return;
    }
    let cancelled = false;
    setBooking(null); setBookingError(''); setBookingLoading(true);
    if (!counterState.current) counterState.current = { cart: [...cartRef.current], customerId: selectedCustomerId, paymentMode, discountType, discountValue, cashReceived, customerPaidAmount, mobileTab };
    if (!hasPermission('customer_orders') || !canPerform('pos', 'create')) {
      setBookingError('You need Customer Orders access and POS checkout permission to bill this order.'); setBookingLoading(false); return;
    }
    void getCustomerOrder(bookingId).then(order => {
      if (cancelled) return;
      if (!['Confirmed', 'Ready'].includes(order.status)) throw new Error(order.status === 'Completed' ? 'This order has already been billed. Open its invoice from Customer Orders.' : 'Confirm this order before billing. Cancelled orders cannot be billed.');
      const remainingDue = Math.max(0, order.total - Number(order.advance_paid || 0));
      setBooking(order); setSelectedCustomerId(order.customer_id); setPaymentMode(remainingDue === 0 ? 'Cash' : 'Credit'); setCustomerPaidAmount(remainingDue === 0 ? '0' : String(remainingDue));
      setDiscountType('flat'); setDiscountValue(String(order.discount)); setMobileTab('cart');
      setCart(order.items.map((line, index) => {
        const product = (items || []).find(i => i.id === line.itemId);
        const variant = line.variantId ? (product?.variants || []).find(v => v.id === line.variantId) : undefined;
        const contains = variant ? sellUnitContains(variant) : 1;
        const fromBase = !variant || variant.deduct_from_base === true;
        return { ...line, id: line.itemId, cartItemId: `booking_${index}`, originalPrice: line.price, isLoose: !variant, baseUnit: product?.unit || line.unit, unit: variant?.name || line.unit, variantName: variant?.name || line.variantName, stockDeduction: contains, deductFromBase: fromBase, customTotal: roundCurrency(line.qty * line.price) };
      }));
    }).catch(err => { if (!cancelled) setBookingError(err.message); }).finally(() => { if (!cancelled) setBookingLoading(false); });
    return () => { cancelled = true; };
  }, [bookingId, bookingReload]);

  // Held Orders State
  const [heldOrders, setHeldOrders] = useState<HeldOrder[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem('pos_held_orders');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [heldOrdersModalOpen, setHeldOrdersModalOpen] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);

  // Completed Sale Thermal Receipt Modal State
  const [completedSaleModalOpen, setCompletedSaleModalOpen] = useState(false);
  const [lastCompletedSale, setLastCompletedSale] = useState<LastCompletedSale | null>(null);

  // Customer Search & Dropdown states
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [newCustomerModalOpen, setNewCustomerModalOpen] = useState(false);
  
  // Input Refs for Keyboard Shortcuts
  const productSearchInputRef = useRef<HTMLInputElement>(null);
  const customerSearchInputRef = useRef<HTMLInputElement>(null);
  const customerContainerRef = useRef<HTMLDivElement>(null);

  // New Customer Form State
  const [newCustomer, setNewCustomer] = useState<PosNewCustomerData>({
    name: '',
    phone: '',
    is_phone_whatsapp: true,
    whatsapp: '',
    city: '',
    address: '',
    balanceType: 'None',
    balanceAmount: '',
    notes: ''
  });

  // Quick Amount Modal State
  const [quickModalOpen, setQuickModalOpen] = useState(false);
  const [quickProduct, setQuickProduct] = useState<any | null>(null);
  const [pendingQuick, setPendingQuick] = useState<{ id: string; initial: { mode: 'amount' | 'qty'; value: string; variantId?: string } | null } | null>(null);
  const [quickInitial, setQuickInitial] = useState<{ mode: 'amount' | 'qty'; value: string; variantId?: string } | null>(null);

  // Edit Cart Item Modal State
  const [editingCartItem, setEditingCartItem] = useState<any | null>(null);
  const [editRate, setEditRate] = useState<string>('');
  const [editQty, setEditQty] = useState<string>('');
  const [editTotal, setEditTotal] = useState<string>('');
  const [editVariantId, setEditVariantId] = useState<string>('base');

  // Click outside listener for customer search dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (customerContainerRef.current && !customerContainerRef.current.contains(event.target as Node)) {
        setCustomerDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Save held orders to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('pos_held_orders', JSON.stringify(heldOrders));
    } catch (e) {
      console.error('Failed to save held orders', e);
    }
  }, [heldOrders]);

  // Filter customers based on search query
  const filteredCustomers = useMemo(() => {
    if (!customers || !Array.isArray(customers)) return [];
    const query = (customerSearch || '').toLowerCase().trim();
    return customers.filter(c => {
      if (!c || c.isActive === false) return false;
      if (!query) return true;
      const nameMatch = (c.name || '').toLowerCase().includes(query);
      const phoneMatch = Boolean(c.phone && String(c.phone).includes(query));
      const routeMatch = (c.route || '').toLowerCase().includes(query);
      return nameMatch || phoneMatch || routeMatch;
    });
  }, [customers, customerSearch]);

  // Today's Counter Sales Analytics Summary (Excluding returns & deducting refunds)
  const todaySummary = useMemo(() => {
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
    // Bill timestamps are UTC; compare on the Pakistan day they were punched.
    const todaySales = (sales || []).filter(s => {
      const saleDate = typeof s?.date === 'string' ? new Date(s.date).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }) : '';
      return saleDate === todayStr;
    });

    let totalRevenue = 0;
    let totalCount = 0;
    let cashTotal = 0;
    let onlineTotal = 0;
    let creditTotal = 0;
    let returnedTotal = 0;
    let returnedCount = 0;

    todaySales.forEach(s => {
      const isFullReturn = s?.status === 'Returned';
      const refundAmt = Number(s?.refund_amount) || 0;
      const billTotal = Number(s?.total_amount || s?.total || 0);
      const mode = s?.payment_mode || s?.payment_method || 'Cash';

      if (isFullReturn) {
        returnedCount += 1;
        returnedTotal += (refundAmt > 0 ? refundAmt : billTotal);
        // Exclude fully returned sales from revenue and active bill count
        return;
      }

      // Net sale value for completed or partially returned sales
      const netBill = Math.max(0, billTotal - refundAmt);
      if (refundAmt > 0) {
        returnedTotal += refundAmt;
        returnedCount += 1;
      }

      totalCount += 1;
      totalRevenue += netBill;

      if (mode === 'Cash') {
        cashTotal += netBill;
      } else if (mode === 'Online') {
        onlineTotal += netBill;
      } else if (mode === 'Credit') {
        creditTotal += netBill;
      }
    });

    return {
      totalRevenue: roundCurrency(totalRevenue),
      totalCount,
      cashTotal: roundCurrency(cashTotal),
      onlineTotal: roundCurrency(onlineTotal),
      creditTotal: roundCurrency(creditTotal),
      returnedTotal: roundCurrency(returnedTotal),
      returnedCount
    };
  }, [sales]);

  // Default payment mode: Always default to 'Cash' on every new entry or customer selection.
  // If the user explicitly selects Online or Credit, it only applies to that current bill.
  const prevCustomerIdRef = useRef<string>(selectedCustomerId);
  const isRecallingRef = useRef(false);

  const handleSelectCustomer = (customerId: string) => {
    setSelectedCustomerId(customerId);
    setPaymentMode('Cash');
    setCustomerPaidAmount('');
  };

  useEffect(() => {
    if (isRecallingRef.current) {
      isRecallingRef.current = false;
      prevCustomerIdRef.current = selectedCustomerId;
      return;
    }

    const prev = prevCustomerIdRef.current;
    if (selectedCustomerId && selectedCustomerId !== prev) {
      // Customer selected or switched -> default to Cash
      setPaymentMode('Cash');
      setCustomerPaidAmount('');
    } else if (!selectedCustomerId && prev) {
      // Customer cleared / Walk-in -> revert back to Cash
      setPaymentMode('Cash');
      setCustomerPaidAmount('');
    } else if (!selectedCustomerId && paymentMode === 'Credit') {
      // Safety guard: Walk-in customer cannot be on Credit mode
      setPaymentMode('Cash');
      setCustomerPaidAmount('');
    }
    prevCustomerIdRef.current = selectedCustomerId;
  }, [selectedCustomerId, paymentMode]);

  // 1. Get Sellable Items from Master & Link Inventory
  const allAvailableProducts: AvailableProduct[] = useMemo(() => {
    const sellableItems = (items || []).filter(i => 
      i && i.isActive && 
      Array.isArray(i.item_type) && i.item_type.includes('Sale product') && 
      !i.item_type.includes('Packaging material')
    );

    return sellableItems.map(itemDef => {
      const stockItem = (inventory || []).find(inv => inv?.item_id === itemDef.id || inv?.name === itemDef.name);
      const vStocks = stockItem?.variant_stocks || itemDef.variant_stocks || {};
      const looseStock = stockItem ? (stockItem.quantity || 0) : (itemDef.stock || 0);
      const totalVariantStock = (itemDef.variants || []).reduce((sum: number, v: any) => sum + (Number(vStocks[v.id]) || 0), 0);
      const isLooseAllowed = itemDef.allow_loose_sale !== false;
      const sellsFromMainStock = (itemDef.variants || []).some((v: any) => v.isActive !== false && v.deduct_from_base === true);
      const isAvailable = (isLooseAllowed || sellsFromMainStock)
        ? (looseStock > 0 || totalVariantStock > 0 || settings.inventory.allowNegativeStock)
        : (totalVariantStock > 0 || settings.inventory.allowNegativeStock);

      return {
        id: itemDef.id, 
        name: itemDef.name, 
        price: itemDef.selling_price || 0, 
        unit: itemDef.unit || 'Unit', 
        category: Array.isArray(itemDef.category) ? itemDef.category : [],
        stock: looseStock,
        variants: itemDef.variants || [],
        variant_stocks: vStocks,
        total_variant_stock: totalVariantStock,
        is_available: isAvailable,
        quick_amounts: itemDef.quick_amounts || [],
        pos_primary_mode: itemDef.pos_primary_mode || (isLooseAllowed ? 'amount' : 'qty'),
        allow_loose_sale: isLooseAllowed,
        image_url: itemDef.image_url,
        sort_order: itemDef.sort_order !== undefined && itemDef.sort_order !== null ? Number(itemDef.sort_order) : 999
      };
    }).sort((a, b) => {
      const orderA = a.sort_order ?? 999;
      const orderB = b.sort_order ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });
  }, [items, inventory, settings.inventory.allowNegativeStock]);

  const availableProducts = useMemo(() => {
    return allAvailableProducts.filter(p => {
      const matchesSearch = !showProductSearch || (p.name || '').toLowerCase().includes((searchProduct || '').toLowerCase());
      const matchesCategory = !showProductCategories || selectedCategories.length === 0 || (Array.isArray(p.category) && p.category.some(cat => selectedCategories.includes(cat)));
      return matchesSearch && matchesCategory;
    }).sort((a, b) => {
      const orderA = a.sort_order ?? 999;
      const orderB = b.sort_order ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });
  }, [allAvailableProducts, searchProduct, selectedCategories, showProductSearch, showProductCategories]);

  // Categories for Filter
  const validCategories = useMemo(() => {
    const list = new Set<string>();
    (items || []).forEach(i => {
      if (i && i.isActive !== false && Array.isArray(i.item_type) && i.item_type.includes('Sale product') && !i.item_type.includes('Packaging material')) {
        if (Array.isArray(i.category)) {
          i.category.forEach(c => list.add(c));
        }
      }
    });
    return Array.from(list).sort();
  }, [items]);

  useEffect(() => {
    setSelectedCategories(previous => previous.filter(category => validCategories.includes(category)));
  }, [validCategories]);

  // Open the quick-entry dialog requested from the product detail page.
  useEffect(() => {
    if (!pendingQuick) return;
    const target = allAvailableProducts.find(p => p.id === pendingQuick.id);
    if (!target) return;
    setPendingQuick(null);
    if (!target.is_available) {
      showToast(`${target.name} is out of stock`, 'warning');
      return;
    }
    setQuickInitial(pendingQuick.initial);
    setQuickProduct(target);
    setQuickModalOpen(true);
  }, [pendingQuick, allAvailableProducts]);

  // Cart Quantities Lookup
  // Counted in base units, so 2 Dozen + 3 pcs reads 27 pcs, not 5.
  const cartQtyByProductId = useMemo(() => {
    const map: Record<string, number> = {};
    cart.forEach(item => {
      const qty = typeof item.qty === 'number' ? item.qty : 1;
      map[item.id] = cleanQty((map[item.id] || 0) + qty * cartLineContains(item));
    });
    return map;
  }, [cart]);

  // Live stock for a product. A cart line's own stock copy is from add time and goes stale after other sales.
  const liveStock = (line: any, variantId?: string) => {
    const live: any = allAvailableProducts.find(p => p.id === line.id) || (items || []).find(i => i.id === line.id);
    const main = live?.stock ?? line.stock;
    const packed = variantId ? (live?.variant_stocks?.[variantId] ?? line.variant_stocks?.[variantId]) : 0;
    return { main: Number(main) || 0, packed: Number(packed) || 0 };
  };

  // Pre-packed piles are counted, so their quantity is a whole number. Multi-unit packs may be 0.5 Dozen.
  const packedQtyIsWhole = (qty: number) => Math.abs(qty - Math.round(qty)) < 0.001;

  const getLineTotal = (item: any) => {
    if (item.customTotal !== undefined && item.customTotal !== null && !isNaN(item.customTotal)) {
      return roundCurrency(item.customTotal);
    }
    return roundCurrency(item.price * item.qty);
  };

  const subtotal = useMemo(() => {
    return roundCurrency(cart.reduce((sum, item) => sum + getLineTotal(item), 0));
  }, [cart]);

  const totalItemDiscount = useMemo(() => {
    return roundCurrency(cart.reduce((sum, item) => {
      const orig = item.originalPrice !== undefined ? item.originalPrice : item.price;
      const diff = Math.max(0, orig - item.price);
      return sum + (diff * item.qty);
    }, 0));
  }, [cart]);

  const discountAmount = useMemo(() => {
    const val = parseFloat(discountValue) || 0;
    if (val <= 0) return 0;
    if (discountType === 'percent') {
      return roundCurrency((subtotal * val) / 100);
    }
    return roundCurrency(val);
  }, [subtotal, discountValue, discountType]);

  const grandTotal = useMemo(() => {
    return roundCurrency(Math.max(0, subtotal - discountAmount));
  }, [subtotal, discountAmount]);

  const cashGiven = useMemo(() => {
    return roundCurrency(parseFloat(cashReceived) || 0);
  }, [cashReceived]);

  const changeReturn = useMemo(() => {
    if (paymentMode !== 'Cash' || cashGiven <= 0) return 0;
    return roundCurrency(Math.max(0, cashGiven - grandTotal));
  }, [paymentMode, cashGiven, grandTotal]);

  // A booking's advance was already collected, so it reduces what the customer still owes on this bill.
  const bookingAdvance = booking ? Number(booking.advance_paid || 0) : 0;
  const customerPaidVal = useMemo(() => {
    if (!selectedCustomerId) return grandTotal;
    if (paymentMode === 'Credit') {
      if (customerPaidAmount === '') return 0;
      const parsed = parseFloat(customerPaidAmount);
      return isNaN(parsed) ? 0 : roundCurrency(Math.max(0, parsed));
    }
    if (customerPaidAmount === '') return grandTotal;
    const parsed = parseFloat(customerPaidAmount);
    return isNaN(parsed) ? 0 : roundCurrency(Math.max(0, parsed));
  }, [selectedCustomerId, paymentMode, customerPaidAmount, grandTotal]);

  const customerDueAmount = useMemo(() => {
    if (!selectedCustomerId) return 0;
    return roundCurrency(Math.max(0, grandTotal - customerPaidVal - bookingAdvance));
  }, [selectedCustomerId, grandTotal, customerPaidVal, bookingAdvance]);

  const customerChangeReturn = useMemo(() => {
    if (!selectedCustomerId || paymentMode !== 'Cash') return 0;
    return roundCurrency(Math.max(0, customerPaidVal - Math.max(0, grandTotal - bookingAdvance)));
  }, [selectedCustomerId, paymentMode, customerPaidVal, grandTotal, bookingAdvance]);

  // Recently used pages stay mounted but hidden, so shortcuts must only act while POS is on screen.
  // The listener calls the latest checkout/hold handlers through refs, so F9 never submits stale
  // amounts (e.g. a partial payment typed just before the key press).
  const { activeTabId } = useTabs();
  const pageActiveRef = useRef(true);
  pageActiveRef.current = activeTabId === 'pos';
  const checkoutRef = useRef<() => Promise<boolean>>(async () => false);
  const holdOrderRef = useRef<() => void>(() => {});

  // Keyboard Shortcuts Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!pageActiveRef.current) return;
      // Dialogs own their keys; F8/F9 must not hold or submit the cart behind them.
      const target = e.target as HTMLElement | null;
      if (e.key !== 'Escape' && (quickModalOpen || newCustomerModalOpen || heldOrdersModalOpen || shortcutsModalOpen || completedSaleModalOpen || isShiftModalOpen || editingCartItem || target?.closest('[role="dialog"], [aria-modal="true"]'))) return;
      if (e.key === 'F2') {
        e.preventDefault();
        setMobileTab('catalog');
        requestAnimationFrame(() => {
          if (showProductSearch) { productSearchInputRef.current?.focus(); productSearchInputRef.current?.select(); }
          else document.querySelector<HTMLButtonElement>('.pos-catalog-panel [data-pos-product]:not(:disabled)')?.focus();
        });
      } else if (e.key === 'F4') {
        e.preventDefault();
        setMobileTab('cart');
        requestAnimationFrame(() => customerSearchInputRef.current?.focus());
        setCustomerDropdownOpen(true);
      } else if (e.key === 'F8') {
        e.preventDefault();
        holdOrderRef.current();
      } else if (e.key === 'F9') {
        e.preventDefault();
        if (!isSubmittingRef.current) {
          void checkoutRef.current();
        }
      } else if (e.key === 'Escape') {
        // A confirm dialog on top (e.g. "close shift?") handles its own Escape.
        if (document.querySelector('[data-app-modal="true"]')) return;
        if (customerDropdownOpen) {
          setCustomerDropdownOpen(false);
        } else if (editingCartItem) {
          setEditingCartItem(null);
        } else if (quickModalOpen) {
          setQuickModalOpen(false);
        } else if (newCustomerModalOpen) {
          setNewCustomerModalOpen(false);
        } else if (heldOrdersModalOpen) {
          setHeldOrdersModalOpen(false);
        } else if (shortcutsModalOpen) {
          setShortcutsModalOpen(false);
        } else if (isShiftModalOpen) {
          setIsShiftModalOpen(false);
        } else if (completedSaleModalOpen) {
          setCompletedSaleModalOpen(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, selectedCustomerId, paymentMode, discountType, discountValue, cashReceived, isSubmitting, quickModalOpen, newCustomerModalOpen, heldOrdersModalOpen, shortcutsModalOpen, completedSaleModalOpen, isShiftModalOpen, editingCartItem, showProductSearch]);

  // Cart Operations
  const addToCart = (product: any, qty = 1, variantName?: string, priceOverride?: number, stockDeduction?: number, variantId?: string, customTotal?: number): boolean => {
    const matched = variantId && variantId !== 'base' ? (product.variants || []).find((v: any) => v.id === variantId) : null;
    const contains = matched ? sellUnitContains(matched) : (stockDeduction !== undefined ? stockDeduction : 1);
    const fromBase = !matched || matched.deduct_from_base === true;
    const cartItemId = `${product.id}_${variantId || 'base'}_${priceOverride}`; 
    const existing = cart.find(item => item.cartItemId === cartItemId);
    const finalPrice = priceOverride !== undefined ? priceOverride : product.price;
    const finalDeduction = contains;

    if (!fromBase && !packedQtyIsWhole(qty)) {
      showToast(`${variantName || 'Packs'} must be sold in whole numbers`, 'warning');
      return false;
    }
    const stockNow = liveStock(product, variantId);
    const availableStock = fromBase ? stockNow.main : stockNow.packed;
    const requestedStock = fromBase
      ? reservedBaseQty(cart, product.id) + (qty * finalDeduction)
      : reservedPackedQty(cart, product.id, variantId!) + qty;

    if (!settings.inventory.allowNegativeStock && requestedStock > availableStock + 0.01) {
      showToast(`Insufficient stock for ${product.name}${variantName ? ` (${variantName})` : ''}`, 'warning');
      return false;
    }

    const itemUnit = variantId ? (variantName || 'Pack') : (product.unit || 'Unit');

    if (existing) {
      setCart(cart.map(item => item.cartItemId === cartItemId ? { 
        ...item, 
        qty: Number((item.qty + qty).toFixed(3)), 
        customTotal: customTotal !== undefined || item.customTotal !== undefined
          ? roundCurrency((item.customTotal ?? roundCurrency(item.price * item.qty)) + (customTotal ?? roundCurrency(finalPrice * qty)))
          : undefined
      } : item));
    } else {
      setCart([...cart, { 
        ...product, 
        cartItemId,
        qty: qty,
        originalPrice: finalPrice,
        price: finalPrice,
        unit: itemUnit,
        baseUnit: product.unit || 'Unit',
        variantName: variantName || '',
        stockDeduction: finalDeduction,
        deductFromBase: fromBase,
        variantId: variantId,
        isLoose: !matched,
        customTotal: customTotal
      }]);
    }
    return true;
  };

  const enoughStock = (item: any, nextQty: number) => {
    const fromBase = cartLineUsesMainStock(item);
    const stockNow = liveStock(item, fromBase ? undefined : item.variantId);
    const available = fromBase ? stockNow.main : stockNow.packed;
    const requested = fromBase
      ? reservedBaseQty(cart, item.id, item.cartItemId) + (nextQty * cartLineContains(item))
      : reservedPackedQty(cart, item.id, item.variantId, item.cartItemId) + nextQty;
    if (!settings.inventory.allowNegativeStock && requested > available + 0.01) {
      showToast('Max stock reached', 'warning');
      return false;
    }
    return true;
  };

  const updateQty = (cartItemId: string, delta: number) => {
    setCart(cart.map(item => {
      if (item.cartItemId === cartItemId) {
        const newQty = stepWholeQuantity(item.qty, delta);
        if (newQty <= 0) return null;
        if (!enoughStock(item, newQty)) return item;
        return { ...item, qty: newQty, customTotal: undefined };
      }
      return item;
    }).filter(Boolean));
  };

  const setDirectQty = (cartItemId: string, rawVal: string) => {
    const parsed = parseFloat(rawVal);
    setCart(cart.map(item => {
      if (item.cartItemId === cartItemId) {
        if (isNaN(parsed) || parsed <= 0) {
          return { ...item, qty: 0, customTotal: undefined };
        }
        if (!cartLineUsesMainStock(item) && !packedQtyIsWhole(parsed)) {
          showToast(`${item.variantName || 'Packs'} must be sold in whole numbers`, 'warning');
          return item;
        }
        if (!enoughStock(item, parsed)) return item;
        return { ...item, qty: parsed, customTotal: undefined };
      }
      return item;
    }));
  };

  const updateRate = (cartItemId: string, rawVal: string) => {
    const parsed = parseFloat(rawVal);
    setCart(cart.map(item => {
      if (item.cartItemId === cartItemId) {
        const finalRate = isNaN(parsed) || parsed < 0 ? 0 : parsed;
        return { ...item, price: finalRate, customTotal: undefined };
      }
      return item;
    }));
  };

  const updateLineTotal = (cartItemId: string, rawVal: string) => {
    const parsedTotal = parseFloat(rawVal);
    setCart(cart.map(item => {
      if (item.cartItemId === cartItemId) {
        if (rawVal === '' || isNaN(parsedTotal) || parsedTotal <= 0) {
          return { ...item, qty: 0, customTotal: rawVal === '' ? undefined : 0 };
        }
        // Packed piles keep their count and change the rate. Main-stock units keep their price and change the count.
        const packedPile = !cartLineUsesMainStock(item);
        if (packedPile) {
          // A blank count comes back as the nearest whole pack count, never 2.5 packs.
          const packs = item.qty > 0 ? item.qty : Math.max(1, Math.round(parsedTotal / (Number(item.price) || parsedTotal)));
          if (!(item.qty > 0) && !enoughStock(item, packs)) return item;
          const newRate = roundCurrency(parsedTotal / packs);
          return { ...item, qty: packs, price: newRate, customTotal: parsedTotal };
        }
        if (item.price > 0) {
          const newQty = cleanQty(parsedTotal / item.price);
          if (!enoughStock({ ...item, stockDeduction: cartLineContains(item) }, newQty)) return item;
          return { ...item, qty: newQty, customTotal: parsedTotal };
        }
        return { ...item, customTotal: parsedTotal };
      }
      return item;
    }));
  };

  const changeItemVariant = (cartItemId: string, targetVariantId: string) => {
    const current = cart.find(item => item.cartItemId === cartItemId);
    if (!current) return;
    const productDef = (items || []).find(i => i.id === current.id);
    if (!productDef) return;
    const loose = !targetVariantId || targetVariantId === 'base';
    const variant = loose ? null : (productDef.variants || []).find((v: any) => v.id === targetVariantId);
    if (!loose && !variant) return;
    const baseUnit = productDef.unit || 'Unit';
    const nextContains = loose ? 1 : sellUnitContains(variant);
    const fromBase = loose || variant.deduct_from_base === true;
    const switched = qtyAfterUnitSwitch(current.qty, cartLineContains(current), nextContains, !loose);
    const nextPrice = loose
      ? (productDef.selling_price || 0)
      : sellUnitPrice(productDef.selling_price || 0, nextContains, variant.selling_price);
    const nextName = loose ? baseUnit : (variant.name || 'Pack');
    const stockNow = liveStock(current, fromBase ? undefined : variant.id);
    const available = fromBase ? stockNow.main : stockNow.packed;
    const requested = fromBase
      ? reservedBaseQty(cart, current.id, current.cartItemId) + (switched.qty * nextContains)
      : reservedPackedQty(cart, current.id, variant.id, current.cartItemId) + switched.qty;
    if (!settings.inventory.allowNegativeStock && requested > available + 0.01) {
      showToast(`Not enough ${baseUnit} for ${switched.qty} ${nextName}`, 'warning');
      return;
    }
    const nextCartId = `${current.id}_${loose ? 'base' : variant.id}_${nextPrice}`;
    setCart(prev => {
      const twin = prev.find(line => line.cartItemId === nextCartId && line.cartItemId !== cartItemId);
      const qty = twin ? cleanQty((Number(twin.qty) || 0) + switched.qty) : switched.qty;
      const nextLine = {
        ...current,
        cartItemId: nextCartId,
        qty,
        variantId: loose ? undefined : variant.id,
        variantName: loose ? '' : variant.name,
        unit: nextName,
        baseUnit,
        stockDeduction: nextContains,
        deductFromBase: fromBase,
        originalPrice: nextPrice,
        price: nextPrice,
        isLoose: loose,
        customTotal: undefined
      };
      const rest = prev.filter(line => line.cartItemId !== cartItemId && line.cartItemId !== nextCartId);
      const index = prev.findIndex(line => line.cartItemId === cartItemId);
      rest.splice(Math.min(Math.max(index, 0), rest.length), 0, nextLine);
      return rest;
    });
    if (!switched.kept) showToast(`Quantity set to 1 ${nextName} (${formatQty(nextContains, 3)} ${baseUnit})`, 'info');
  };

  // Quick entry keeps its draft local so changing amounts does not rerender the catalog.
  const openQuickModal = (product: AvailableProduct) => {
    setQuickInitial(null);
    setQuickProduct(product);
    setQuickModalOpen(true);
  };
  // Edit Item Modal Handlers
  const openEditItemModal = (item: any) => {
    setEditingCartItem(item);
    setEditRate(item.price.toString());
    setEditQty(item.qty.toString());
    const initialTotal = item.customTotal !== undefined ? item.customTotal : getLineTotal(item);
    setEditTotal(initialTotal.toString());
    setEditVariantId(item.variantId || 'base');
  };

  const handleEditRateChange = (newRateStr: string) => {
    setEditRate(newRateStr);
    const r = parseFloat(newRateStr);
    const q = parseFloat(editQty);
    if (!isNaN(r) && !isNaN(q)) {
      setEditTotal(Number((r * q).toFixed(1)).toString());
    }
  };

  const handleEditQtyChange = (newQtyStr: string) => {
    setEditQty(newQtyStr);
    const q = parseFloat(newQtyStr);
    const r = parseFloat(editRate);
    if (!isNaN(r) && !isNaN(q)) {
      setEditTotal(Number((r * q).toFixed(1)).toString());
    }
  };

  const handleEditTotalChange = (newTotalStr: string) => {
    setEditTotal(newTotalStr);
    if (newTotalStr === '') {
      setEditQty('');
      return;
    }
    const tot = parseFloat(newTotalStr);
    const r = parseFloat(editRate) || Number(editingCartItem?.price) || 0;
    const productDef = editingCartItem ? (items || []).find(i => i.id === editingCartItem.id) : null;
    const variant = editVariantId && editVariantId !== 'base' ? (productDef?.variants || []).find((v: any) => v.id === editVariantId) : null;
    if (variant && variant.deduct_from_base !== true) {
      // Packed pile: the packed count stays and the rate changes.
      if (isNaN(tot) || tot <= 0) return;
      const q = parseFloat(editQty);
      const packs = q > 0 && packedQtyIsWhole(q) ? Math.round(q) : Math.max(1, Math.round(r > 0 ? tot / r : 1));
      setEditQty(String(packs));
      setEditRate(String(roundCurrency(tot / packs)));
      return;
    }
    if (!isNaN(tot) && r > 0) {
      const calculatedQty = cleanQty(tot / r);
      setEditQty(calculatedQty.toString());
    }
  };

  const applySellUnit = (nextVariantId: string) => {
    if (!editingCartItem) return;
    const productDef = (items || []).find(i => i.id === editingCartItem.id);
    if (!productDef) return;
    const loose = !nextVariantId || nextVariantId === 'base';
    const variant = loose ? null : (productDef.variants || []).find((v: any) => v.id === nextVariantId);
    if (!loose && !variant) return;
    const baseUnit = productDef.unit || editingCartItem.baseUnit || 'Unit';
    const currentVariant = editVariantId && editVariantId !== 'base' ? (productDef.variants || []).find((v: any) => v.id === editVariantId) : null;
    const currentContains = currentVariant ? sellUnitContains(currentVariant) : 1;
    const nextContains = loose ? 1 : sellUnitContains(variant);
    const switched = qtyAfterUnitSwitch(parseFloat(editQty) || editingCartItem.qty || 1, currentContains, nextContains, !loose);
    const nextPrice = loose
      ? (productDef.selling_price || 0)
      : sellUnitPrice(productDef.selling_price || 0, nextContains, variant.selling_price);
    setEditVariantId(loose ? 'base' : variant.id);
    setEditQty(String(switched.qty));
    setEditRate(String(nextPrice));
    setEditTotal(String(cleanNumber(nextPrice * switched.qty)));
    if (!switched.kept) showToast(`Quantity set to 1 ${loose ? baseUnit : variant.name} (${formatQty(nextContains, 3)} ${baseUnit})`, 'info');
  };

  const handleSaveEditItem = () => {
    if (!editingCartItem) return;
    const parsedRate = parseFloat(editRate);
    const parsedQty = parseFloat(editQty);
    const parsedTotal = parseFloat(editTotal);

    if (isNaN(parsedRate) || parsedRate < 0) {
      showToast("Please enter a valid rate/price", "warning");
      return;
    }
    if (isNaN(parsedQty) || parsedQty <= 0) {
      showToast("Please enter a valid quantity", "warning");
      return;
    }

    const productDef = (items || []).find(i => i.id === editingCartItem.id);
    const variant = editVariantId && editVariantId !== 'base' && productDef
      ? (productDef.variants || []).find((v: any) => v.id === editVariantId)
      : null;
    const isLoose = !variant;
    const newDeduction = variant ? sellUnitContains(variant) : 1;
    const fromBase = !variant || variant.deduct_from_base === true;
    const newVariantName = variant?.name || '';
    if (!fromBase && !packedQtyIsWhole(parsedQty)) {
      showToast(`${newVariantName || 'Packs'} must be sold in whole numbers`, "warning");
      return;
    }
    const stockNow = liveStock(editingCartItem, fromBase ? undefined : variant.id);
    const availableStock = fromBase ? stockNow.main : stockNow.packed;
    const totalDeduction = fromBase
      ? reservedBaseQty(cart, editingCartItem.id, editingCartItem.cartItemId) + (parsedQty * newDeduction)
      : reservedPackedQty(cart, editingCartItem.id, variant.id, editingCartItem.cartItemId) + parsedQty;
    if (!settings.inventory.allowNegativeStock && totalDeduction > availableStock + 0.01) {
      showToast("Insufficient stock for requested quantity", "warning");
      return;
    }

    const computedTotal = roundCurrency(parsedRate * parsedQty);
    const isCustom = !isNaN(parsedTotal) && parsedTotal > 0 && Math.abs(parsedTotal - computedTotal) > 0.05;

    const itemUnit = variant
      ? (newVariantName || 'Pack')
      : (productDef?.unit || editingCartItem.baseUnit || editingCartItem.unit || 'Unit');

    // A new sell unit gets the same line key addToCart and changeItemVariant build, so later
    // loose adds never land in a pack line. A same-unit twin at the same rate is merged.
    const unitChanged = (editingCartItem.variantId || 'base') !== (variant ? variant.id : 'base');
    const catalogPrice = variant
      ? sellUnitPrice(productDef?.selling_price || 0, newDeduction, variant.selling_price)
      : (productDef?.selling_price || 0);
    let nextCartId = unitChanged ? `${editingCartItem.id}_${variant ? variant.id : 'base'}_${catalogPrice}` : editingCartItem.cartItemId;
    let twin = unitChanged ? cart.find(line => line.cartItemId === nextCartId && line.cartItemId !== editingCartItem.cartItemId) : undefined;
    if (twin && Math.abs((Number(twin.price) || 0) - parsedRate) > 0.001) {
      nextCartId = `${nextCartId}_${parsedRate}`;
      twin = cart.find(line => line.cartItemId === nextCartId && line.cartItemId !== editingCartItem.cartItemId);
      if (twin && Math.abs((Number(twin.price) || 0) - parsedRate) > 0.001) { nextCartId = `${nextCartId}_${Date.now()}`; twin = undefined; }
    }
    const ownTotal = isCustom ? parsedTotal : computedTotal;
    const mergedQty = twin ? cleanQty((Number(twin.qty) || 0) + parsedQty) : parsedQty;
    const mergedCustom = twin
      ? (twin.customTotal !== undefined || isCustom ? roundCurrency((twin.customTotal ?? roundCurrency(twin.price * twin.qty)) + ownTotal) : undefined)
      : (isCustom ? parsedTotal : undefined);

    const currentLine = cart.find(line => line.cartItemId === editingCartItem.cartItemId) || editingCartItem;
    const nextLine = {
      ...currentLine,
      cartItemId: nextCartId,
      originalPrice: unitChanged ? catalogPrice : currentLine.originalPrice,
      price: parsedRate,
      qty: mergedQty,
      unit: itemUnit,
      baseUnit: productDef?.unit || editingCartItem.baseUnit || editingCartItem.unit || 'Unit',
      variantId: variant ? variant.id : undefined,
      variantName: newVariantName,
      stockDeduction: newDeduction,
      deductFromBase: fromBase,
      isLoose: isLoose,
      customTotal: mergedCustom
    };
    const rest = cart.filter(line => line.cartItemId !== editingCartItem.cartItemId && line !== twin);
    const index = cart.findIndex(line => line.cartItemId === editingCartItem.cartItemId);
    rest.splice(Math.min(Math.max(index, 0), rest.length), 0, nextLine);
    setCart(rest);

    showToast(`${editingCartItem.name} updated`, "success");
    setEditingCartItem(null);
  };

  // Hold / Recall Order Handlers
  const handleHoldOrder = () => {
    if (bookingId) { showToast('Customer orders remain saved in Customer Orders. Finish billing or return to orders.', 'info'); return; }
    if (cart.length === 0) {
      showToast("Cart is empty", "warning");
      return;
    }

    const customerObj = (customers || []).find(c => c.id === selectedCustomerId);
    const customerName = customerObj ? customerObj.name : 'Walk-in Customer';

    const newHold: HeldOrder = {
      id: `hold_${Date.now()}`,
      cart: [...cart],
      selectedCustomerId,
      customerName,
      paymentMode,
      discountType,
      discountValue,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      subtotal,
      grandTotal
    };

    setHeldOrders(prev => [newHold, ...prev]);
    setCart([]);
    setSelectedCustomerId('');
    setPaymentMode('Cash');
    setDiscountValue('');
    setCashReceived('');
    setCustomerPaidAmount('');
    showToast(`Order held for ${customerName}`, "success");
  };

  const handleClearCart = () => {
    setCart([]);
    setSelectedCustomerId('');
    setPaymentMode('Cash');
    setDiscountValue('');
    setCashReceived('');
    setCustomerPaidAmount('');
  };

  const handleRecallOrder = async (held: HeldOrder) => {
    if (bookingId) return;
    if (cart.length > 0) {
      const confirmReplace = await confirmAction({
        tone: 'warning',
        title: 'Cart mein pehle se items hain',
        message: 'Parked order wapas laane se abhi wali cart hat jayegi.',
        consequences: [`Cart ke ${cart.length} item(s) hat jayenge.`, 'Parked order ke items, customer aur payment wapas aa jayenge.'],
        confirmLabel: 'Haan, replace karein',
      });
      if (!confirmReplace) return;
    }
    isRecallingRef.current = true;
    setCart(held.cart);
    setSelectedCustomerId(held.selectedCustomerId);
    setPaymentMode(held.paymentMode);
    setDiscountType(held.discountType);
    setDiscountValue(held.discountValue);
    setHeldOrders(prev => prev.filter(h => h.id !== held.id));
    setHeldOrdersModalOpen(false);
    showToast(`Recalled held order`, "info");
  };

  const handleDeleteHeldOrder = (heldId: string) => {
    setHeldOrders(prev => prev.filter(h => h.id !== heldId));
    showToast("Held order removed", "info");
  };

  // Checkout Execution
  const handleCheckout = async (): Promise<boolean> => {
    if (cart.length === 0 || isSubmitting || isSubmittingRef.current) return false;
    if (bookingId && (!booking || !hasPermission('customer_orders') || !canPerform('pos', 'create'))) return false;
    if (cart.some(line => !(Number(line.qty) > 0))) {
      showToast('Qty 0 wali line hata dein ya qty likhein', 'warning');
      return false;
    }
    const brokenPack = !bookingId && cart.find(line => !cartLineUsesMainStock(line) && !packedQtyIsWhole(Number(line.qty) || 0));
    if (brokenPack) {
      showToast(`${brokenPack.name}: ${brokenPack.variantName || 'Packs'} must be sold in whole numbers`, 'warning');
      return false;
    }

    if (!activeShiftSession || activeShiftSession.status !== 'Active') {
      showToast("No active shift. Please start a shift first.", "warning");
      setIsShiftModalOpen(true);
      return false;
    }

    if (isTodayLocked) {
      showToast("Business Day has been closed & locked! Reopen day or contact Owner to punch bills.", "error");
      return false;
    }

    const discountInput = parseFloat(discountValue) || 0;
    if (discountInput < 0 || (discountType === 'percent' && discountInput > 100) || discountAmount > subtotal) {
      showToast('Discount bill ki raqam se zyada nahi ho sakta.', 'warning');
      return false;
    }

    // Discounts (bill discount plus line price cuts) need the discount right and stay within the
    // owner's limit; otherwise a manager approves with their PIN. Order discounts were set when booking.
    const billDiscount = roundCurrency(discountAmount + totalItemDiscount);
    if (!bookingId && billDiscount > 0 && currentUser?.role_id !== 'role_super_admin') {
      const gross = roundCurrency(subtotal + totalItemDiscount);
      const percent = gross > 0 ? (billDiscount / gross) * 100 : 0;
      const limit = settings.security?.maxDiscountPercent;
      const mayDiscount = canPerform('pos', 'discount');
      const overLimit = typeof limit === 'number' && percent > limit + 0.01;
      if (!mayDiscount || overLimit) {
        const summary = `Discount ${formatCurrency(billDiscount)} (${percent.toFixed(1)}%)`;
        const approvedBy = await requestApproval({
          permission: 'approvals:discount',
          title: 'Discount ke liye manager approval',
          reason: mayDiscount ? `${summary} — aap ki limit ${limit}% hai.` : `${summary} — aap ko discount dene ki ijazat nahi.`,
        });
        if (!approvedBy) return false;
        showToast(`Discount ${approvedBy} ne approve kiya.`, 'success');
      }
    }

    // A walk-in has no khata, so a short cash payment would leave the unpaid part recorded nowhere.
    if (!selectedCustomerId && paymentMode === 'Cash' && cashGiven > 0 && cashGiven < grandTotal) {
      showToast(`${formatCurrency(roundCurrency(grandTotal - cashGiven))} kam hain. Poori raqam lein ya customer select karein taake baqi khaate mein jaye.`, 'warning');
      return false;
    }

    // Only cash can be over-tendered (the excess is change). Online/credit money above the bill has nowhere to go.
    if (selectedCustomerId && paymentMode !== 'Cash' && customerPaidAmount !== '' && (parseFloat(customerPaidAmount) || 0) > roundCurrency(grandTotal - bookingAdvance)) {
      showToast('Received amount bill ki baqi raqam se zyada hai. Zyada raqam customer payment (khata) mein alag se lein.', 'warning');
      return false;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);

    const customer = (customers || []).find(c => c.id === selectedCustomerId);
    const customerName = customer ? customer.name : 'Walk-in Customer';
    let invoiceNo = `${settings.sales.invoicePrefix || 'INV-'}${Date.now().toString().slice(-5)}`;

    const advancePaidOnBooking = booking ? Number(booking.advance_paid || 0) : 0;
    const billBalance = roundCurrency(Math.max(0, grandTotal - advancePaidOnBooking));
    // Kept on the bill: never more than what is still owed on it. Extra cash is change, not revenue.
    const actualPaid = roundCurrency(Math.min(billBalance,
      selectedCustomerId
        ? (paymentMode === 'Credit'
            ? (customerPaidAmount !== '' ? Math.max(0, parseFloat(customerPaidAmount) || 0) : 0)
            : (customerPaidAmount !== '' ? Math.max(0, parseFloat(customerPaidAmount) || 0) : billBalance))
        : billBalance
    ));

    // Enforce 'Credit' mode when customer is selected and zero cash/online payment received
    let effectivePaymentMode: 'Cash' | 'Online' | 'Credit' = paymentMode as any;
    if (selectedCustomerId && actualPaid === 0) {
      effectivePaymentMode = 'Credit';
    }

    const dueAmount = roundCurrency(customer ? Math.max(0, billBalance - actualPaid) : 0);
    const finalChangeReturn = roundCurrency(
      effectivePaymentMode === 'Cash'
        ? (selectedCustomerId
            ? (customerPaidAmount !== '' && parseFloat(customerPaidAmount) > billBalance ? parseFloat(customerPaidAmount) - billBalance : 0)
            : (cashGiven > billBalance ? cashGiven - billBalance : 0))
        : 0
    );

    try {
      let bookingSale: any = null;
      if (booking) {
        const accountId = effectivePaymentMode === 'Online'
          ? (settings.financial?.defaultDigitalAccountId || accounts.find(account => account.type === 'Bank' || account.type === 'Wallet')?.id)
          : (activeShiftSession.account_id || activeShiftSession.drawer_id || settings.financial?.defaultCashAccountId);
        bookingSale = await checkoutCustomerOrder(booking, {
          payment_mode: effectivePaymentMode, paid_amount: actualPaid, advance_paid: advancePaidOnBooking, account_id: accountId || null,
          shift_session_id: activeShiftSession.id, cash_given: actualPaid + finalChangeReturn, change_return: finalChangeReturn
        });
        invoiceNo = bookingSale.bill_number;
        // The booking RPC committed sale, stock, cash and khata together. Never queue it again.
        void retryLoading().catch(() => {});
      }
      const savedBillNumber = bookingSale ? bookingSale.bill_number : await addSale(
        cart,
        customer ? { id: customer.id, name: customer.name, phone: customer.phone, cashGiven: actualPaid + finalChangeReturn, changeReturn: finalChangeReturn } : { name: 'Walk-in Customer', cashGiven: actualPaid + finalChangeReturn, changeReturn: finalChangeReturn },
        subtotal,
        discountAmount,
        grandTotal,
        effectivePaymentMode,
        actualPaid
      );

      if (!savedBillNumber) return false;
      invoiceNo = savedBillNumber;

      const completedRecord: LastCompletedSale = {
        invoiceNo,
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        customerName,
        customerPhone: customer?.phone || '',
        items: [...cart],
        subtotal,
        discountAmount,
        grandTotal,
        paidAmount: actualPaid,
        dueAmount,
        paymentMode: effectivePaymentMode,
        cashGiven: actualPaid + finalChangeReturn,
        changeReturn: finalChangeReturn
      };

      if (bookingSale) {
        const savedDate = new Date(bookingSale.date);
        completedRecord.date = savedDate.toLocaleDateString();
        completedRecord.time = savedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        completedRecord.customerName = bookingSale.customer_name;
        completedRecord.customerPhone = bookingSale.details?.customer_phone || '';
        completedRecord.items = bookingSale.items;
        completedRecord.subtotal = Number(bookingSale.subtotal);
        completedRecord.discountAmount = Number(bookingSale.discount);
        completedRecord.grandTotal = Number(bookingSale.total);
        // Receipt view: advance + counter money is what the customer has paid against this bill.
        const counterPaid = Number(bookingSale.details?.counter_paid ?? bookingSale.details?.paid_amount ?? 0);
        const advancePaid = Number(bookingSale.details?.advance_paid || 0);
        completedRecord.paidAmount = roundCurrency(counterPaid + advancePaid);
        completedRecord.dueAmount = roundCurrency(Math.max(0, Number(bookingSale.total || 0) - counterPaid - advancePaid));
        completedRecord.paymentMode = bookingSale.payment_mode;
        completedRecord.cashGiven = Number(bookingSale.details?.cash_given || 0);
        completedRecord.changeReturn = Number(bookingSale.details?.change_return || 0);
        setBooking(previous => previous ? { ...previous, status: 'Completed', sale_id: bookingSale.id } : previous);
      }

      setLastCompletedSale(completedRecord);
      setCompletedSaleModalOpen(true);
      
      if (dueAmount > 0) {
        showToast(`Sale completed! ${formatCurrency(actualPaid)} paid, ${formatCurrency(dueAmount)} added to ${customerName}'s ledger`, 'success');
      } else {
        showToast(`Sale completed! ${formatCurrency(grandTotal)}`, 'success');
      }

      setCart([]); 
      setSelectedCustomerId('');
      setPaymentMode('Cash');
      setDiscountValue('');
      setCashReceived('');
      setCustomerPaidAmount('');
      setMobileTab('catalog');
      return true;
    } catch (err: any) {
      showToast("Failed to complete sale: " + (err?.message || "Error"), "error");
      return false;
    } finally {
      setIsSubmitting(false);
      setTimeout(() => {
        isSubmittingRef.current = false;
      }, 350);
    }
  };
  checkoutRef.current = handleCheckout;
  holdOrderRef.current = handleHoldOrder;

  // Quick Open Receipt / Reprint for any completed or recent transaction
  const handleOpenSaleReceipt = (sale: any) => {
    if (!sale) return;
    if (sale.invoiceNo && sale.grandTotal !== undefined && sale.items) {
      setLastCompletedSale(sale);
      setCompletedSaleModalOpen(true);
      return;
    }

    const d = new Date(sale.date || sale.created_at || Date.now());
    const dateFormatted = isNaN(d.getTime()) ? (sale.date || new Date().toLocaleDateString()) : d.toLocaleDateString();
    const timeFormatted = isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const totalAmt = Number(sale.total ?? sale.total_amount ?? 0);
    const paidAmt = Number(sale.paid_amount ?? (sale.details?.paid_amount ?? totalAmt));
    const dueAmt = Number(sale.due_amount ?? (sale.details?.due_amount ?? 0));
    const cashGivenAmt = Number(sale.details?.cash_given ?? (sale.paid_amount ?? totalAmt));
    const changeReturnAmt = Number(sale.details?.change_return ?? 0);

    const completedRecord: LastCompletedSale = {
      invoiceNo: sale.bill_number || sale.invoice_no || sale.id || 'INV',
      date: dateFormatted,
      time: timeFormatted,
      customerName: sale.customer_name || 'Walk-in Customer',
      customerPhone: sale.details?.customer_phone || '',
      items: sale.items || [],
      subtotal: Number(sale.subtotal ?? totalAmt),
      discountAmount: Number(sale.discount ?? sale.discount_amount ?? 0),
      grandTotal: totalAmt,
      paidAmount: paidAmt,
      dueAmount: dueAmt,
      paymentMode: sale.payment_mode || sale.payment_method || 'Cash',
      cashGiven: cashGivenAmt,
      changeReturn: changeReturnAmt
    };

    setLastCompletedSale(completedRecord);
    setCompletedSaleModalOpen(true);
  };

  // Quick Customer Creation
  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomer.name.trim()) {
      showToast("Customer name is required", 'warning');
      return;
    }

    const finalWhatsApp = newCustomer.is_phone_whatsapp 
      ? newCustomer.phone.trim() 
      : newCustomer.whatsapp.trim();

    let finalBalance = 0;
    const parsedAmount = parseFloat(newCustomer.balanceAmount) || 0;
    if (newCustomer.balanceType === 'Due') {
      finalBalance = parsedAmount;
    } else if (newCustomer.balanceType === 'Advance') {
      finalBalance = -parsedAmount;
    }
    
    const customerPayload = {
      name: newCustomer.name.trim(),
      phone: newCustomer.phone.trim(),
      is_phone_whatsapp: newCustomer.is_phone_whatsapp,
      whatsapp: finalWhatsApp || undefined,
      city: newCustomer.city.trim() || undefined,
      address: newCustomer.address.trim() || undefined,
      balance: finalBalance,
      notes: newCustomer.notes.trim() || undefined,
      isActive: true
    };

    setIsCreatingCustomer(true);
    try {
      const newId = await addCustomer(customerPayload);
      if (newId) {
        if (typeof newId === 'string') {
          handleSelectCustomer(newId);
          setCustomerSearch('');
        }
        setNewCustomerModalOpen(false);
        showToast(`Customer "${newCustomer.name}" registered & selected in cart!`, 'success');
        
        setNewCustomer({
          name: '',
          phone: '',
          is_phone_whatsapp: true,
          whatsapp: '',
          city: '',
          address: '',
          balanceType: 'None',
          balanceAmount: '',
          notes: ''
        });
      }
    } catch (err: any) {
      showToast("Error creating customer: " + (err?.message || "Failed"), "error");
    } finally {
      setIsCreatingCustomer(false);
    }
  };

  if (bookingId) return <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 text-slate-900 dark:text-slate-100 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-black"><ClipboardCheck size={20} className="text-lime-600" />Customer Order Billing</h2><p className="mt-1 text-xs text-slate-500">{booking?.order_number || 'Loading booking'} · Products and prices are saved with the order.</p></div><button type="button" disabled={isSubmitting} onClick={() => { setCompletedSaleModalOpen(false); navigate('/customer-orders'); }} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold dark:border-slate-700 dark:bg-slate-900"><ArrowLeft size={16} />Customer Orders</button></div>
    {bookingLoading ? <div role="status" className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500"><Loader2 size={20} className="animate-spin" />Loading order…</div> : bookingError ? <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"><p className="flex items-center gap-2"><AlertCircle size={18} />{bookingError}</p><button type="button" onClick={() => setBookingReload(value => value + 1)} className="mt-4 font-bold underline">Reload order</button></div> : booking && <>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><h3 className="font-bold">{booking.customer_name}</h3><p className="mt-1 text-xs text-slate-500">{booking.customer_phone} · {booking.fulfillment} · {booking.due_date} {booking.due_time}</p>{booking.fulfillment === 'Delivery' && <p className="mt-2 text-xs text-slate-500">{booking.address}</p>}{booking.notes && <p className="mt-3 whitespace-pre-wrap text-sm">{booking.notes}</p>}{Number(booking.advance_paid || 0) > 0 && <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 text-xs dark:border-emerald-900/60 dark:bg-emerald-950/40"><div className="flex items-center justify-between font-bold text-emerald-800 dark:text-emerald-300"><span className="flex items-center gap-1.5"><Banknote size={15} /> Advance Paid on Booking ({booking.payment_mode || 'Cash'}){booking.payment_notes ? ` · ${booking.payment_notes}` : ''}</span><span className="font-mono text-sm font-black">{formatCurrency(Number(booking.advance_paid))}</span></div><div className="mt-1 flex items-center justify-between text-slate-600 dark:text-slate-300"><span>Remaining Balance to Collect:</span><span className="font-mono font-bold text-amber-700 dark:text-amber-400">{formatCurrency(Math.max(0, Number(booking.total) - Number(booking.advance_paid)))}</span></div></div>}<div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">{booking.items.map((line, index) => <div key={index} className="flex items-center justify-between gap-3 py-3"><div><p className="text-sm font-bold">{line.name}{line.variantName ? ` · ${line.variantName}` : ''}</p><p className="mt-1 text-xs text-slate-500">{line.qty} {line.unit} × {formatCurrency(line.price)}</p></div><span className="text-sm font-bold">{formatCurrency(roundCurrency(line.qty * line.price))}</span></div>)}</div></div>
      {booking.status === 'Completed' ? <div role="status" className="rounded-xl bg-lime-50 p-5 text-sm font-bold text-lime-800 dark:bg-lime-950/30 dark:text-lime-300">Order billed successfully. Invoice, stock, cash and khata are saved.<button type="button" className="ml-3 underline" onClick={() => setCompletedSaleModalOpen(true)}>Print receipt</button></div> : <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800"><p className="bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:bg-slate-900">Choose payment below. Edit products or discount from Customer Orders before billing.</p><PosPaymentPanel cart={cart} paymentMode={paymentMode} setPaymentMode={setPaymentMode} selectedCustomerId={selectedCustomerId} customerPaidAmount={customerPaidAmount} setCustomerPaidAmount={setCustomerPaidAmount} customerDueAmount={customerDueAmount} customerChangeReturn={customerChangeReturn} cashReceived={cashReceived} setCashReceived={setCashReceived} cashGiven={cashGiven} discountType={discountType} setDiscountType={() => {}} discountValue={discountValue} setDiscountValue={() => {}} subtotal={subtotal} discountAmount={discountAmount} totalItemDiscount={totalItemDiscount} grandTotal={grandTotal} isSubmitting={isSubmitting} activeShiftSession={activeShiftSession} handleCheckout={handleCheckout} lockDiscount onStartShift={() => setIsShiftModalOpen(true)} isDayLocked={isTodayLocked} /></div>}
    </>}
    <PosReceiptModal open={completedSaleModalOpen} onClose={() => setCompletedSaleModalOpen(false)} lastCompletedSale={lastCompletedSale} settings={settings} />
    <PosShiftModal isOpen={isShiftModalOpen} onClose={() => setIsShiftModalOpen(false)} />
  </div>;

  return (
    <div data-pos-view={mobileTab} className="pos-workspace flex flex-col h-full gap-3 pb-2 relative overflow-hidden">
      {approvalDialog}
      {/* Top Counter Shift Analytics Bar with Integrated Last Sales Dropdown */}
      <PosHeaderAnalytics
        todaySummary={todaySummary}
        activeShiftSession={activeShiftSession}
        setIsShiftModalOpen={setIsShiftModalOpen}
        heldOrdersCount={heldOrders.length}
        setHeldOrdersModalOpen={setHeldOrdersModalOpen}
        currentUser={currentUser}
        setIsUserSwitcherOpen={setIsUserSwitcherOpen}
        navigate={navigate}
        setShortcutsModalOpen={setShortcutsModalOpen}
        mobileTab={mobileTab}
        sales={sales || []}
        onOpenReceipt={handleOpenSaleReceipt}
      />

      {/* Selling needs an open shift; say so before the cashier builds a cart, not at checkout. */}
      {(isTodayLocked || !activeShiftSession || activeShiftSession.status !== 'Active') && (
        <div role="status" className={`${mobileTab === 'cart' ? 'hidden lg:flex' : 'flex'} items-center justify-between gap-3 rounded-xl border px-3 py-2 text-xs shrink-0 ${isTodayLocked ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300' : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}`}>
          <span className="flex items-center gap-2 font-semibold">
            <AlertCircle size={15} className="shrink-0" />
            {isTodayLocked
              ? `Business day ${getBusinessDate()} band ho chuka hai — sale nahi ho sakti. Owner se day reopen karwayein.`
              : 'Shift start nahi hui. Sale se pehle drawer ki cash gin kar shift start karein.'}
          </span>
          {!isTodayLocked && (
            <button
              type="button"
              onClick={() => setIsShiftModalOpen(true)}
              className="shrink-0 rounded-lg bg-amber-400 px-3 py-1.5 font-black text-slate-950 hover:bg-amber-300 cursor-pointer"
            >
              Start Shift
            </button>
          )}
        </div>
      )}

      {/* Main POS 2-Column Split */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0 gap-3 overflow-hidden relative">
        {/* Left Column: Products Catalog */}
        <PosProductGrid
          searchProduct={searchProduct}
          setSearchProduct={setSearchProduct}
          productSearchInputRef={productSearchInputRef}
          selectedCategories={selectedCategories}
          setSelectedCategories={setSelectedCategories}
          validCategories={validCategories}
          availableProducts={availableProducts}
          items={items || []}
          cartQtyByProductId={cartQtyByProductId}
          openQuickModal={openQuickModal}
          addToCart={addToCart}
          mobileTab={mobileTab}
          showSearch={showProductSearch}
          showCategories={showProductCategories}
        />

        {/* Right Column: Dedicated Cart & Checkout Panel */}
        <div className={`pos-checkout-panel flex-[1.1] w-full min-w-0 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xl flex-col h-full min-h-0 overflow-hidden ${
          mobileTab === 'cart' ? 'flex' : 'hidden lg:flex'
        }`}>
          <PosCustomerSelect
            customerContainerRef={customerContainerRef}
            customerSearchInputRef={customerSearchInputRef}
            customerSearch={customerSearch}
            setCustomerSearch={setCustomerSearch}
            customerDropdownOpen={customerDropdownOpen}
            setCustomerDropdownOpen={setCustomerDropdownOpen}
            selectedCustomerId={selectedCustomerId}
            setSelectedCustomerId={handleSelectCustomer}
            customers={customers || []}
            filteredCustomers={filteredCustomers}
            setNewCustomerModalOpen={setNewCustomerModalOpen}
            cartLength={cart.length}
            handleHoldOrder={handleHoldOrder}
            paymentMode={paymentMode}
          />

          <PosCart
            expanded={mobileTab === 'cart'}
            cart={cart}
            setCart={setCart}
            onClearCart={handleClearCart}
            setMobileTab={setMobileTab}
            items={items || []}
            updateQty={updateQty}
            setDirectQty={setDirectQty}
            updateRate={updateRate}
            updateLineTotal={updateLineTotal}
            changeItemVariant={changeItemVariant}
            openEditItemModal={openEditItemModal}
            getLineTotal={getLineTotal}
            showToast={showToast}
            lastCompletedSale={lastCompletedSale}
            onOpenReceipt={handleOpenSaleReceipt}
          />

          <PosPaymentPanel
            cart={cart}
            paymentMode={paymentMode}
            setPaymentMode={setPaymentMode}
            selectedCustomerId={selectedCustomerId}
            customerPaidAmount={customerPaidAmount}
            setCustomerPaidAmount={setCustomerPaidAmount}
            customerDueAmount={customerDueAmount}
            customerChangeReturn={customerChangeReturn}
            cashReceived={cashReceived}
            setCashReceived={setCashReceived}
            cashGiven={cashGiven}
            discountType={discountType}
            setDiscountType={setDiscountType}
            discountValue={discountValue}
            setDiscountValue={setDiscountValue}
            subtotal={subtotal}
            discountAmount={discountAmount}
            totalItemDiscount={totalItemDiscount}
            grandTotal={grandTotal}
            isSubmitting={isSubmitting}
            activeShiftSession={activeShiftSession}
            handleCheckout={handleCheckout}
            onStartShift={() => setIsShiftModalOpen(true)}
            isDayLocked={isTodayLocked}
          />
        </div>
      </div>

      {/* Mobile Floating Sticky Cart Pill */}
      {cart.length > 0 && mobileTab === 'catalog' && (
        <div className="pos-mobile-cart-pill lg:hidden fixed bottom-3 inset-x-3 z-40">
          <button
            type="button"
            onClick={() => setMobileTab('cart')}
            className="w-full bg-gradient-to-r from-lime-600 to-emerald-700 text-white rounded-2xl p-3 shadow-xl shadow-lime-600/25 flex items-center justify-between border border-lime-500/40 active:scale-[0.99] transition-all cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center font-bold">
                <ShoppingCart size={16} />
              </div>
              <div className="text-left">
                <span className="text-xs font-bold block leading-none">View Cart</span>
                <span className="text-[10px] text-lime-100">{cart.length} item{cart.length !== 1 ? 's' : ''} added</span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs font-mono font-black block">{formatCurrency(grandTotal)}</span>
              <span className="text-[10px] text-lime-100 uppercase tracking-wider font-bold">Checkout &rarr;</span>
            </div>
          </button>
        </div>
      )}

      {/* Modal Dialogs */}
      <PosQuickAmountModal
        open={quickModalOpen}
        onClose={() => setQuickModalOpen(false)}
        quickProduct={quickProduct}
        initialEntry={quickInitial}
        cart={cart}
        allowNegativeStock={settings.inventory.allowNegativeStock}
        addToCart={addToCart}
        showToast={showToast}
        onAdded={() => { if (window.matchMedia('(min-width: 1024px) and (pointer: fine)').matches) { productSearchInputRef.current?.focus(); productSearchInputRef.current?.select(); } }}
      />

      <PosHeldOrdersModal
        open={heldOrdersModalOpen}
        onClose={() => setHeldOrdersModalOpen(false)}
        heldOrders={heldOrders}
        handleRecallOrder={handleRecallOrder}
        handleDeleteHeldOrder={handleDeleteHeldOrder}
      />

      <PosShortcutsModal
        open={shortcutsModalOpen}
        onClose={() => setShortcutsModalOpen(false)}
      />

      <PosReceiptModal
        open={completedSaleModalOpen}
        onClose={() => setCompletedSaleModalOpen(false)}
        lastCompletedSale={lastCompletedSale}
        settings={settings}
      />

      <PosNewCustomerModal
        open={newCustomerModalOpen}
        onClose={() => setNewCustomerModalOpen(false)}
        newCustomer={newCustomer}
        setNewCustomer={setNewCustomer}
        handleCreateCustomer={handleCreateCustomer}
        isCreatingCustomer={isCreatingCustomer}
      />

      <PosEditItemModal
        editingCartItem={editingCartItem}
        setEditingCartItem={setEditingCartItem}
        editRate={editRate}
        handleEditRateChange={handleEditRateChange}
        editQty={editQty}
        handleEditQtyChange={handleEditQtyChange}
        editTotal={editTotal}
        handleEditTotalChange={handleEditTotalChange}
        editVariantId={editVariantId}
        setEditVariantId={setEditVariantId}
        onSellUnitChange={applySellUnit}
        items={items || []}
        cart={cart}
        setCart={setCart}
        handleSaveEditItem={handleSaveEditItem}
        showToast={showToast}
      />

      {/* Shift Start & Closing Modal */}
      <PosShiftModal
        isOpen={isShiftModalOpen}
        onClose={() => setIsShiftModalOpen(false)}
      />
    </div>
  );
};

export default POS;
