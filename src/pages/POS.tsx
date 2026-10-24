import React, { Suspense, lazy, useState, useMemo, useEffect, useRef, useCallback, useDeferredValue } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDairy } from '../context/DairyContext';
import { useToast } from '../context/ToastContext';
import { useTabs } from '../context/TabContext';
import { roundCurrency } from '../lib/db';
import { cleanNumber, cleanQty, formatQty, formatCurrency } from '../lib/formatters';
import { checkoutCustomerOrder, getCustomerOrder } from '../lib/customerOrders';
import { CustomerOrder } from '../types';
import { stepWholeQuantity } from '../lib/posQuickEntry';
import { cartLineContains, cartLineUsesMainStock, qtyAfterUnitSwitch, sellUnitContains, sellUnitPrice } from '../lib/sellUnits';
import { cartPileLines, pileShortages, posSellOptions, posStockView, sellQtyProblem, shortageText, type PosSellProduct } from '../components/pos/posStock';
import { ShoppingCart, ClipboardCheck, ArrowLeft, AlertCircle, Banknote, Lock, Clock, Printer, ArrowRight, RefreshCw } from 'lucide-react';
import { HeldOrder, AvailableProduct, PosNewCustomerData, LastCompletedSale } from '../components/pos/PosTypes';
import { PosHeaderAnalytics } from '../components/pos/PosHeaderAnalytics';
import { PosProductGrid } from '../components/pos/PosProductGrid';
import { PosCustomerSelect } from '../components/pos/PosCustomerSelect';
import { PosCart } from '../components/pos/PosCart';
import { PosPaymentPanel } from '../components/pos/PosPaymentPanel';
import { confirmAction } from '../components/ui/ConfirmDialog';
import { useManagerApproval } from '../components/ui/ManagerApproval';
import { Button, Card, Money, Skeleton } from '../components/ui';
import '../styles/pos.css';

// Dialogs load after the counter is on screen (and are fetched while the cashier is idle),
// so they are not part of the POS first chunk. A failed fetch is retried once.
const lazyRetry = <T,>(load: () => Promise<T>) => () => load().catch(() => new Promise<T>((resolve, reject) => {
  window.setTimeout(() => { load().then(resolve, reject); }, 800);
}));
const loadQuickModal = () => import('../components/pos/PosQuickAmountModal');
const loadPosModals = () => import('../components/pos/PosModals');
const loadShiftModal = () => import('../components/PosShiftModal');
const PosQuickAmountModal = lazy(lazyRetry(loadQuickModal));
const PosHeldOrdersModal = lazy(lazyRetry(() => loadPosModals().then(m => ({ default: m.PosHeldOrdersModal }))));
const PosShortcutsModal = lazy(lazyRetry(() => loadPosModals().then(m => ({ default: m.PosShortcutsModal }))));
const PosReceiptModal = lazy(lazyRetry(() => loadPosModals().then(m => ({ default: m.PosReceiptModal }))));
const PosNewCustomerModal = lazy(lazyRetry(() => loadPosModals().then(m => ({ default: m.PosNewCustomerModal }))));
const PosEditItemModal = lazy(lazyRetry(() => loadPosModals().then(m => ({ default: m.PosEditItemModal }))));
const PosShiftModal = lazy(lazyRetry(() => loadShiftModal().then(m => ({ default: m.PosShiftModal }))));

const getLineTotal = (item: any) => {
  if (item.customTotal !== undefined && item.customTotal !== null && !isNaN(item.customTotal)) {
    return roundCurrency(item.customTotal);
  }
  return roundCurrency(item.price * item.qty);
};

// Pre-packed piles are counted, so their quantity is a whole number. Multi-unit packs may be 0.5 Dozen.
const packedQtyIsWhole = (qty: number) => Math.abs(qty - Math.round(qty)) < 0.001;

// Bill timestamps are UTC; "today" is the Pakistan day they were punched. One formatter, reused for every bill.
const pakistanDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' });

const readDraft = (): any => {
  try {
    const draft = sessionStorage.getItem('mooco_pos_cart_draft');
    return draft ? JSON.parse(draft) : null;
  } catch {
    return null;
  }
};

const isCounterDesktop = () => window.matchMedia('(min-width: 1024px) and (pointer: fine)').matches;

/** Stable function identity that always runs the latest render's handler, so memoised children are not re-rendered. */
function useLatestCallback<T extends (...args: any[]) => any>(handler: T): T {
  const ref = useRef(handler);
  ref.current = handler;
  const [stable] = useState(() => ((...args: any[]) => ref.current(...args)) as T);
  return stable;
}

const EMPTY_CUSTOMER: PosNewCustomerData = {
  name: '',
  phone: '',
  is_phone_whatsapp: true,
  whatsapp: '',
  city: '',
  address: '',
  balanceType: 'None',
  balanceAmount: '',
  notes: ''
};

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
    const draft = readDraft();
    return Array.isArray(draft?.cart) ? draft.cart : [];
  });
  cartRef.current = cart;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(() => readDraft()?.selectedCustomerId || '');
  const [paymentMode, setPaymentMode] = useState<string>(() => readDraft()?.paymentMode || 'Cash');
  const [searchProduct, setSearchProduct] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [mobileTab, setMobileTab] = useState<'catalog' | 'cart'>('catalog');
  const showProductSearch = settings.sales?.showPosSearch !== false;
  const showProductCategories = settings.sales?.showPosCategories !== false;
  useEffect(() => { if (!showProductSearch) setSearchProduct(''); }, [showProductSearch]);
  useEffect(() => { if (!showProductCategories) setSelectedCategories([]); }, [showProductCategories]);

  // Default payment mode: Always default to 'Cash' on every new entry or customer selection.
  // If the user explicitly selects Online or Credit, it only applies to that current bill.
  // A restored bill (parked, booking, counter cart) keeps its own customer and mode; the flag is only
  // raised when that restore really changes them, so a stale flag never skips a later reset.
  const prevCustomerIdRef = useRef<string>(selectedCustomerId);
  const isRecallingRef = useRef(false);
  const currentSelection = useRef({ customerId: selectedCustomerId, paymentMode });
  currentSelection.current = { customerId: selectedCustomerId, paymentMode };
  const markRestoring = (customerId: string, mode: string) => {
    isRecallingRef.current = customerId !== currentSelection.current.customerId || mode !== currentSelection.current.paymentMode;
  };

  const [quickModalOpen, setQuickModalOpen] = useState(false);
  const [quickProduct, setQuickProduct] = useState<any | null>(null);
  const [pendingQuick, setPendingQuick] = useState<{ id: string; initial: { mode: 'amount' | 'qty'; value: string; variantId?: string } | null } | null>(null);
  const [quickInitial, setQuickInitial] = useState<{ mode: 'amount' | 'qty'; value: string; variantId?: string } | null>(null);

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

  const [discountType, setDiscountType] = useState<'flat' | 'percent'>(() => readDraft()?.discountType || 'flat');
  const [discountValue, setDiscountValue] = useState<string>(() => readDraft()?.discountValue || '');
  const [cashReceived, setCashReceived] = useState<string>(() => readDraft()?.cashReceived || '');
  const [customerPaidAmount, setCustomerPaidAmount] = useState<string>(() => readDraft()?.customerPaidAmount || '');

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
        markRestoring(saved.customerId, saved.paymentMode);
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
      const bookingMode = remainingDue === 0 ? 'Cash' : 'Credit';
      // Keep the booking's payment defaults: the customer-change effect would reset them to Cash / blank.
      markRestoring(order.customer_id, bookingMode);
      setBooking(order); setSelectedCustomerId(order.customer_id); setPaymentMode(bookingMode); setCustomerPaidAmount(remainingDue === 0 ? '0' : String(remainingDue));
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
  // The shift dialog keeps its own form state, so once loaded it stays mounted (it renders nothing while closed).
  const [shiftModalLoaded, setShiftModalLoaded] = useState(false);
  useEffect(() => { if (isShiftModalOpen) setShiftModalLoaded(true); }, [isShiftModalOpen]);

  const [completedSaleModalOpen, setCompletedSaleModalOpen] = useState(false);
  const [lastCompletedSale, setLastCompletedSale] = useState<LastCompletedSale | null>(null);

  const [customerSearch, setCustomerSearch] = useState('');
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [newCustomerModalOpen, setNewCustomerModalOpen] = useState(false);

  const productSearchInputRef = useRef<HTMLInputElement>(null);
  const customerSearchInputRef = useRef<HTMLInputElement>(null);
  const customerContainerRef = useRef<HTMLDivElement>(null);

  const [newCustomer, setNewCustomer] = useState<PosNewCustomerData>(EMPTY_CUSTOMER);

  const [editingCartItem, setEditingCartItem] = useState<any | null>(null);
  const [editRate, setEditRate] = useState<string>('');
  const [editQty, setEditQty] = useState<string>('');
  const [editTotal, setEditTotal] = useState<string>('');
  const [editVariantId, setEditVariantId] = useState<string>('base');

  // Fetch the dialog chunks while the counter is idle, so the first tap on a product opens instantly.
  useEffect(() => {
    const preload = () => { void loadQuickModal().catch(() => {}); void loadPosModals().catch(() => {}); void loadShiftModal().catch(() => {}); };
    const idle = window as any;
    if (typeof idle.requestIdleCallback === 'function') {
      const id = idle.requestIdleCallback(preload, { timeout: 2500 });
      return () => idle.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(preload, 1200);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!customerDropdownOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (customerContainerRef.current && !customerContainerRef.current.contains(event.target as Node)) {
        setCustomerDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [customerDropdownOpen]);

  useEffect(() => {
    try {
      localStorage.setItem('pos_held_orders', JSON.stringify(heldOrders));
    } catch (e) {
      console.error('Failed to save held orders', e);
    }
  }, [heldOrders]);

  const deferredCustomerSearch = useDeferredValue(customerSearch);
  const filteredCustomers = useMemo(() => {
    if (!customers || !Array.isArray(customers)) return [];
    const query = (deferredCustomerSearch || '').toLowerCase().trim();
    return customers.filter(c => {
      if (!c || c.isActive === false) return false;
      if (!query) return true;
      const nameMatch = (c.name || '').toLowerCase().includes(query);
      const phoneMatch = Boolean(c.phone && String(c.phone).includes(query));
      const routeMatch = (c.route || '').toLowerCase().includes(query);
      return nameMatch || phoneMatch || routeMatch;
    });
  }, [customers, deferredCustomerSearch]);

  // Today's counter sales, excluding returns and net of refunds
  const todaySummary = useMemo(() => {
    const todayStr = pakistanDay.format(new Date());
    let totalRevenue = 0;
    let totalCount = 0;
    let cashTotal = 0;
    let onlineTotal = 0;
    let creditTotal = 0;
    let returnedTotal = 0;
    let returnedCount = 0;

    (sales || []).forEach(s => {
      if (typeof s?.date !== 'string') return;
      const saleDate = new Date(s.date);
      if (Number.isNaN(saleDate.getTime()) || pakistanDay.format(saleDate) !== todayStr) return;

      const isFullReturn = s?.status === 'Returned';
      const refundAmt = Number(s?.refund_amount) || 0;
      const billTotal = Number((s as any)?.total_amount || s?.total || 0);
      const mode = s?.payment_mode || (s as any)?.payment_method || 'Cash';

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

  const handleSelectCustomer = useCallback((customerId: string) => {
    setSelectedCustomerId(customerId);
    setPaymentMode('Cash');
    setCustomerPaidAmount('');
  }, []);

  useEffect(() => {
    if (isRecallingRef.current) {
      isRecallingRef.current = false;
      prevCustomerIdRef.current = selectedCustomerId;
      return;
    }

    const prev = prevCustomerIdRef.current;
    if (selectedCustomerId && selectedCustomerId !== prev) {
      setPaymentMode('Cash');
      setCustomerPaidAmount('');
    } else if (!selectedCustomerId && prev) {
      setPaymentMode('Cash');
      setCustomerPaidAmount('');
    } else if (!selectedCustomerId && paymentMode === 'Credit') {
      // A walk-in customer cannot be on Credit
      setPaymentMode('Cash');
      setCustomerPaidAmount('');
    }
    prevCustomerIdRef.current = selectedCustomerId;
  }, [selectedCustomerId, paymentMode]);

  // Last built card per product, so unchanged products keep their identity between catalog updates.
  const productCache = useRef(new Map<string, { itemDef: unknown; stockItem: unknown; allowNegative: boolean; product: AvailableProduct }>());
  const allAvailableProducts: AvailableProduct[] = useMemo(() => {
    const sellableItems = (items || []).filter(i =>
      i && i.isActive &&
      Array.isArray(i.item_type) && i.item_type.includes('Sale product') &&
      !i.item_type.includes('Packaging material')
    );

    // First inventory row matching by item id or by name, as a linear find would return, without an O(n²) scan.
    const firstById = new Map<string, number>();
    const firstByName = new Map<string, number>();
    (inventory || []).forEach((inv: any, index) => {
      if (!inv) return;
      if (inv.item_id !== undefined && !firstById.has(inv.item_id)) firstById.set(inv.item_id, index);
      if (inv.name !== undefined && !firstByName.has(inv.name)) firstByName.set(inv.name, index);
    });

    const allowNegative = Boolean(settings.inventory.allowNegativeStock);
    const previous = productCache.current;
    const next = new Map<string, { itemDef: unknown; stockItem: unknown; allowNegative: boolean; product: AvailableProduct }>();
    const products = sellableItems.map(itemDef => {
      const byId = firstById.get(itemDef.id);
      const byName = firstByName.get(itemDef.name);
      const stockIndex = byId === undefined ? byName : byName === undefined ? byId : Math.min(byId, byName);
      const stockItem: any = stockIndex === undefined ? undefined : (inventory || [])[stockIndex];
      // A sale changes one or two rows; every other card keeps its product object, so it does not re-render.
      const cached = previous.get(itemDef.id);
      if (cached && cached.itemDef === itemDef && cached.stockItem === stockItem && cached.allowNegative === allowNegative) {
        next.set(itemDef.id, cached);
        return cached.product;
      }
      const vStocks = stockItem?.variant_stocks || itemDef.variant_stocks || {};
      const looseStock = stockItem ? (stockItem.quantity || 0) : (itemDef.stock || 0);
      const isLooseAllowed = itemDef.allow_loose_sale !== false;
      const stockView = posStockView(itemDef, looseStock, vStocks);
      // Sellable now: loose (when loose sale or a dozen/tray sells it) and active packs. Hidden packs and
      // stray multi-unit counts never make a card tappable. "Allow negative stock" sells past zero.
      const isAvailable = stockView.hasSellUnit && (stockView.reading.sellableBase > 0 || allowNegative);

      const product: AvailableProduct = {
        id: itemDef.id,
        name: itemDef.name,
        price: itemDef.selling_price || 0,
        unit: itemDef.unit || 'Unit',
        category: Array.isArray(itemDef.category) ? itemDef.category : [],
        stock: looseStock,
        variants: itemDef.variants || [],
        variant_stocks: vStocks,
        stock_view: stockView,
        is_available: isAvailable,
        quick_amounts: itemDef.quick_amounts || [],
        pos_primary_mode: itemDef.pos_primary_mode || (isLooseAllowed ? 'amount' : 'qty'),
        allow_loose_sale: isLooseAllowed,
        image_url: itemDef.image_url,
        sort_order: itemDef.sort_order !== undefined && itemDef.sort_order !== null ? Number(itemDef.sort_order) : 999
      };
      next.set(itemDef.id, { itemDef, stockItem, allowNegative, product });
      return product;
    });
    productCache.current = next;
    return products.sort((a, b) => {
      const orderA = a.sort_order ?? 999;
      const orderB = b.sort_order ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });
  }, [items, inventory, settings.inventory.allowNegativeStock]);

  // The catalog filters on a deferred copy of the search text, so typing stays instant with hundreds of products.
  // allAvailableProducts is already in display order, so filtering keeps that order.
  const filterCatalog = useCallback((search: string) => {
    const query = (search || '').toLowerCase();
    return allAvailableProducts.filter(p => {
      const matchesSearch = !showProductSearch || (p.name || '').toLowerCase().includes(query);
      const matchesCategory = !showProductCategories || selectedCategories.length === 0 || (Array.isArray(p.category) && p.category.some(cat => selectedCategories.includes(cat)));
      return matchesSearch && matchesCategory;
    });
  }, [allAvailableProducts, selectedCategories, showProductSearch, showProductCategories]);
  const deferredProductSearch = useDeferredValue(searchProduct);
  const availableProducts = useMemo(() => filterCatalog(deferredProductSearch), [filterCatalog, deferredProductSearch]);
  // Enter in the search box uses the text as typed, not the deferred list.
  const findFirstMatch = useLatestCallback((search: string) => filterCatalog(search).find(item => item.is_available));

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

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allAvailableProducts.forEach(p => p.category.forEach(cat => { counts[cat] = (counts[cat] || 0) + 1; }));
    return counts;
  }, [allAvailableProducts]);

  useEffect(() => {
    setSelectedCategories(previous => {
      const next = previous.filter(category => validCategories.includes(category));
      return next.length === previous.length ? previous : next;
    });
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

  // Counted in base units, so 2 Dozen + 3 pcs reads 27 pcs, not 5. Keeps its identity while the counts are
  // unchanged (rate or total edits), so the product grid does not re-render for them.
  const previousCartQty = useRef<Record<string, number>>({});
  const cartQtyByProductId = useMemo(() => {
    const map: Record<string, number> = {};
    cart.forEach(item => {
      const qty = typeof item.qty === 'number' ? item.qty : 1;
      map[item.id] = cleanQty((map[item.id] || 0) + qty * cartLineContains(item));
    });
    const previous = previousCartQty.current;
    const keys = Object.keys(map);
    if (keys.length === Object.keys(previous).length && keys.every(key => previous[key] === map[key])) return previous;
    previousCartQty.current = map;
    return map;
  }, [cart]);

  const productById = useMemo(() => new Map(allAvailableProducts.map(p => [p.id, p])), [allAvailableProducts]);

  // Live stock and sell units for a product. A cart line's own copy is from add time and goes stale after other sales.
  const liveProduct = (line: any): PosSellProduct => {
    const live: any = productById.get(line.id) || (items || []).find(i => i.id === line.id);
    return {
      id: line.id,
      unit: live?.unit || line.baseUnit || line.unit,
      price: Number(live?.price ?? live?.selling_price ?? line.price) || 0,
      allow_loose_sale: live ? live.allow_loose_sale : line.allow_loose_sale,
      variants: live?.variants || line.variants || [],
      stock: Number(live?.stock ?? line.stock) || 0,
      variant_stocks: live?.variant_stocks || line.variant_stocks || {},
    };
  };

  /**
   * Why `qty` of this unit can't go on the bill (null when it can). `qty` is the whole line when
   * `exceptCartItemId` is that line, else the amount being added on top of the cart.
   * Hidden packs and loose sale off are refused; the "allow negative stock" setting skips the stock check.
   */
  const sellCheck = (line: any, variantId: string | undefined, exceptCartItemId?: string) => {
    const product = liveProduct(line);
    const optionId = variantId && variantId !== 'base' ? variantId : 'base';
    const option = posSellOptions(product, cart, exceptCartItemId).find(o => o.id === optionId);
    const name = line.name || 'Product';
    let unitProblem: string | null = null;
    if (!option) {
      const variant = (product.variants || []).find(v => v.id === optionId);
      unitProblem = optionId === 'base'
        ? `${name}: loose sale band hai. Pack ya unit chunein.`
        : variant
          ? `${name}: ${variant.name || 'ye pack'} hidden hai, is liye bik nahi sakta. Unit badlein ya line hata dein.`
          : `${name}: ye pack ab catalog mein nahi hai. Unit badlein ya line hata dein.`;
    }
    return { product, option, name, unitProblem };
  };
  const sellProblem = (line: any, variantId: string | undefined, qty: number, exceptCartItemId?: string): string | null => {
    const { product, option, name, unitProblem } = sellCheck(line, variantId, exceptCartItemId);
    if (!option) return unitProblem;
    return sellQtyProblem(name, option, qty, Boolean(settings.inventory.allowNegativeStock), product.unit || 'unit');
  };

  /** Last check before saving: every line still sellable and, all lines added up per pile, enough stock. */
  const cartStockProblem = (): string | null => {
    for (const line of cart) {
      const { unitProblem } = sellCheck(line, line.variantId, line.cartItemId);
      if (unitProblem) return unitProblem;
    }
    if (settings.inventory.allowNegativeStock) return null;
    const short = pileShortages(cartPileLines(cart), id => {
      const product = liveProduct({ id });
      return { loose: Number(product.stock) || 0, packs: product.variant_stocks };
    });
    if (short.length === 0) return null;
    const lines = short.map(row => shortageText(row, (items || []).find(i => i.id === row.itemId)));
    return `Stock kam hai — ${lines.join('; ')}. Qty kam karein ya stock theek karein.`;
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

  // A booking's advance was already collected, so it reduces what the customer still owes on this bill.
  const bookingAdvance = booking ? Number(booking.advance_paid || 0) : 0;
  const customerPaidVal = useMemo(() => {
    if (!selectedCustomerId) return grandTotal;
    if (paymentMode === 'Credit') {
      if (customerPaidAmount === '') return 0;
      const parsed = parseFloat(customerPaidAmount);
      return isNaN(parsed) ? 0 : roundCurrency(Math.max(0, parsed));
    }
    // A blank amount means "paid in full": what is still owed after any booking advance, as checkout records it.
    if (customerPaidAmount === '') return roundCurrency(Math.max(0, grandTotal - bookingAdvance));
    const parsed = parseFloat(customerPaidAmount);
    return isNaN(parsed) ? 0 : roundCurrency(Math.max(0, parsed));
  }, [selectedCustomerId, paymentMode, customerPaidAmount, grandTotal, bookingAdvance]);

  const customerDueAmount = useMemo(() => {
    if (!selectedCustomerId) return 0;
    return roundCurrency(Math.max(0, grandTotal - customerPaidVal - bookingAdvance));
  }, [selectedCustomerId, grandTotal, customerPaidVal, bookingAdvance]);

  const customerChangeReturn = useMemo(() => {
    if (!selectedCustomerId || paymentMode !== 'Cash') return 0;
    return roundCurrency(Math.max(0, customerPaidVal - Math.max(0, grandTotal - bookingAdvance)));
  }, [selectedCustomerId, paymentMode, customerPaidVal, grandTotal, bookingAdvance]);

  // Recently used pages stay mounted but hidden, so shortcuts must only act while POS is on screen.
  // The listener is bound once and calls the latest handler, so F9 never submits stale amounts
  // (e.g. a partial payment typed just before the key press).
  const { activeTabId } = useTabs();
  const pageActiveRef = useRef(true);
  pageActiveRef.current = activeTabId === 'pos';
  const checkoutRef = useRef<() => Promise<boolean>>(async () => false);
  const holdOrderRef = useRef<() => void>(() => {});

  const handleShortcut = (e: KeyboardEvent) => {
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
      // A held-down key must not fire the sale again and again.
      if (e.repeat) return;
      if (!isSubmittingRef.current) {
        // A typed sum (e.g. paid "500+200") is applied only when its field loses focus.
        // Blur first and read the sale after that update renders, or the bill saves 500.
        const active = document.activeElement as HTMLElement | null;
        if (active && active.tagName === 'INPUT') {
          active.blur();
          setTimeout(() => { if (!isSubmittingRef.current) void checkoutRef.current(); }, 0);
        } else {
          void checkoutRef.current();
        }
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
  const shortcutRef = useRef(handleShortcut);
  shortcutRef.current = handleShortcut;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => shortcutRef.current(e);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const addToCart = useLatestCallback((product: any, qty = 1, variantName?: string, priceOverride?: number, stockDeduction?: number, variantId?: string, customTotal?: number): boolean => {
    const matched = variantId && variantId !== 'base' ? (product.variants || []).find((v: any) => v.id === variantId) : null;
    const contains = matched ? sellUnitContains(matched) : (stockDeduction !== undefined ? stockDeduction : 1);
    const fromBase = !matched || matched.deduct_from_base === true;
    const cartItemId = `${product.id}_${variantId || 'base'}_${priceOverride}`;
    const existing = cart.find(item => item.cartItemId === cartItemId);
    const finalPrice = priceOverride !== undefined ? priceOverride : product.price;
    const finalDeduction = contains;

    const problem = sellProblem(product, variantId, qty);
    if (problem) {
      showToast(problem, 'warning');
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
  });

  const enoughStock = (item: any, nextQty: number) => {
    // Lowering a line is always allowed, even when stock has run short since it was added.
    if (nextQty <= (Number(item.qty) || 0)) return true;
    const problem = sellProblem(item, item.variantId, nextQty, item.cartItemId);
    if (problem) {
      showToast(problem, 'warning');
      return false;
    }
    return true;
  };

  const updateQty = useLatestCallback((cartItemId: string, delta: number) => {
    setCart(cart.map(item => {
      if (item.cartItemId === cartItemId) {
        const newQty = stepWholeQuantity(item.qty, delta);
        if (newQty <= 0) return null;
        if (!enoughStock(item, newQty)) return item;
        return { ...item, qty: newQty, customTotal: undefined };
      }
      return item;
    }).filter(Boolean));
  });

  const setDirectQty = useLatestCallback((cartItemId: string, rawVal: string) => {
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
  });

  const updateRate = useLatestCallback((cartItemId: string, rawVal: string) => {
    const parsed = parseFloat(rawVal);
    setCart(cart.map(item => {
      if (item.cartItemId === cartItemId) {
        const finalRate = isNaN(parsed) || parsed < 0 ? 0 : parsed;
        return { ...item, price: finalRate, customTotal: undefined };
      }
      return item;
    }));
  });

  const updateLineTotal = useLatestCallback((cartItemId: string, rawVal: string) => {
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
  });

  const removeLine = useCallback((cartItemId: string) => {
    setCart(previous => previous.filter(line => line.cartItemId !== cartItemId));
  }, []);

  const swipeRemoveLine = useLatestCallback((item: any) => {
    removeLine(item.cartItemId);
    showToast(`${item.name} cart se hata diya`, 'info');
  });

  // Quick entry keeps its draft local so changing amounts does not rerender the catalog.
  const openQuickModal = useCallback((product: AvailableProduct) => {
    setQuickInitial(null);
    setQuickProduct(product);
    setQuickModalOpen(true);
  }, []);

  const openEditItemModal = useLatestCallback((item: any) => {
    setEditingCartItem(item);
    setEditRate(item.price.toString());
    setEditQty(item.qty.toString());
    const initialTotal = item.customTotal !== undefined ? item.customTotal : getLineTotal(item);
    setEditTotal(initialTotal.toString());
    setEditVariantId(item.variantId || 'base');
  });

  const handleEditRateChange = (newRateStr: string) => {
    setEditRate(newRateStr);
    const r = parseFloat(newRateStr);
    const q = parseFloat(editQty);
    if (!isNaN(r) && !isNaN(q)) {
      setEditTotal(roundCurrency(r * q).toString());
    }
  };

  const handleEditQtyChange = (newQtyStr: string) => {
    setEditQty(newQtyStr);
    const q = parseFloat(newQtyStr);
    const r = parseFloat(editRate);
    if (!isNaN(r) && !isNaN(q)) {
      setEditTotal(roundCurrency(r * q).toString());
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
    // Same unit, same or lower quantity: nothing more leaves the shelf, so only the unit itself is checked.
    const sameUnit = (editingCartItem.variantId || 'base') === (variant ? variant.id : 'base');
    const lowering = sameUnit && parsedQty <= (Number(editingCartItem.qty) || 0);
    const stockProblem = lowering
      ? sellCheck(editingCartItem, variant?.id, editingCartItem.cartItemId).unitProblem
      : sellProblem(editingCartItem, variant?.id, parsedQty, editingCartItem.cartItemId);
    if (stockProblem) {
      showToast(stockProblem, "warning");
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

  const handleRemoveEditedItem = (item: any) => {
    removeLine(item.cartItemId);
    showToast(`${item.name} removed from cart`, 'info');
    setEditingCartItem(null);
  };

  const handleHoldOrder = useLatestCallback(() => {
    if (bookingId) { showToast('Customer orders remain saved in Customer Orders. Finish billing or return to orders.', 'info'); return; }
    // F8 while a sale is saving would park a copy of a bill that is being sold.
    if (isSubmittingRef.current) return;
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
  });

  const handleClearCart = useCallback(() => {
    setCart([]);
    setSelectedCustomerId('');
    setPaymentMode('Cash');
    setDiscountValue('');
    setCashReceived('');
    setCustomerPaidAmount('');
  }, []);

  const handleRecallOrder = async (held: HeldOrder) => {
    if (bookingId || isSubmittingRef.current) return;
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
    markRestoring(held.selectedCustomerId, held.paymentMode);
    setCart(held.cart);
    setSelectedCustomerId(held.selectedCustomerId);
    setPaymentMode(held.paymentMode);
    setDiscountType(held.discountType);
    setDiscountValue(held.discountValue);
    // Money typed for the replaced cart belongs to that bill, never to the recalled one.
    setCashReceived('');
    setCustomerPaidAmount('');
    setHeldOrders(prev => prev.filter(h => h.id !== held.id));
    setHeldOrdersModalOpen(false);
    showToast(`Recalled held order`, "info");
  };

  const handleDeleteHeldOrder = (heldId: string) => {
    setHeldOrders(prev => prev.filter(h => h.id !== heldId));
    showToast("Held order removed", "info");
  };

  const runCheckout = async (): Promise<boolean> => {
    if (cart.length === 0) return false;
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
    // A restored draft or parked bill was checked against the stock of its own time.
    const stockProblem = bookingId ? null : cartStockProblem();
    if (stockProblem) {
      showToast(stockProblem, 'warning');
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

    // A deleted customer (restored draft or parked bill) would save as a walk-in Credit bill with the
    // unpaid amount on no khata.
    if (!bookingId && selectedCustomerId && !(customers || []).some(c => c.id === selectedCustomerId)) {
      showToast('Ye customer ab list mein nahi hai. Customer dobara select karein ya Walk-in karein.', 'warning');
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
    }
  };

  // One sale at a time: the guard is taken before validation, so a second click or F9 while the
  // discount approval PIN is open cannot start another save of the same cart.
  const handleCheckout = async (): Promise<boolean> => {
    if (isSubmittingRef.current || isSubmitting) return false;
    isSubmittingRef.current = true;
    try {
      return await runCheckout();
    } finally {
      window.setTimeout(() => { isSubmittingRef.current = false; }, 350);
    }
  };
  checkoutRef.current = handleCheckout;
  holdOrderRef.current = handleHoldOrder;

  const handleOpenSaleReceipt = useCallback((sale: any) => {
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

    setLastCompletedSale({
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
    });
    setCompletedSaleModalOpen(true);
  }, []);

  // After the receipt, the counter is ready for the next customer.
  const closeReceipt = () => {
    setCompletedSaleModalOpen(false);
    if (!bookingId && showProductSearch && isCounterDesktop()) {
      requestAnimationFrame(() => productSearchInputRef.current?.focus());
    }
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingCustomer) return;
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
        setNewCustomer(EMPTY_CUSTOMER);
      }
    } catch (err: any) {
      showToast("Error creating customer: " + (err?.message || "Failed"), "error");
    } finally {
      setIsCreatingCustomer(false);
    }
  };

  const closeShiftModal = useCallback(() => setIsShiftModalOpen(false), []);
  const openShiftModal = useCallback(() => setIsShiftModalOpen(true), []);
  const shiftModal = shiftModalLoaded && (
    <Suspense fallback={null}>
      <PosShiftModal isOpen={isShiftModalOpen} onClose={closeShiftModal} />
    </Suspense>
  );
  const receiptModal = completedSaleModalOpen && (
    <Suspense fallback={null}>
      <PosReceiptModal open onClose={closeReceipt} lastCompletedSale={lastCompletedSale} settings={settings} />
    </Suspense>
  );
  const noOpenShift = !activeShiftSession || activeShiftSession.status !== 'Active';

  if (bookingId) {
    const advance = Number(booking?.advance_paid || 0);
    return (
      <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3 text-fg sm:p-5">
        {approvalDialog}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-fg">
              <span className="flex size-8 items-center justify-center rounded-lg bg-brand-soft text-brand-fg"><ClipboardCheck className="size-[18px]" aria-hidden="true" /></span>
              Customer order billing
            </h2>
            <p className="mt-1 text-xs text-fg-subtle">
              <span className="font-mono font-semibold text-fg-muted">{booking?.order_number || 'Loading booking'}</span> · Products and prices are saved with the order.
            </p>
          </div>
          <Button variant="secondary" leftIcon={<ArrowLeft />} disabled={isSubmitting} onClick={() => { setCompletedSaleModalOpen(false); navigate('/customer-orders'); }}>
            Customer Orders
          </Button>
        </div>

        {bookingLoading ? (
          <Card className="space-y-3 p-5" role="status" aria-label="Loading order">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </Card>
        ) : bookingError ? (
          <div role="alert" className="rounded-card border border-warning/30 bg-warning-soft p-5 text-sm text-warning-fg">
            <p className="flex items-center gap-2 font-semibold"><AlertCircle className="size-[18px] shrink-0" aria-hidden="true" />{bookingError}</p>
            <Button variant="secondary" size="sm" className="mt-4" leftIcon={<RefreshCw />} onClick={() => setBookingReload(value => value + 1)}>Reload order</Button>
          </div>
        ) : booking && (
          <>
            <Card className="p-4 sm:p-5">
              <h3 className="text-[15px] font-bold text-fg">{booking.customer_name}</h3>
              <p className="mt-1 text-xs text-fg-subtle">{booking.customer_phone} · {booking.fulfillment} · {booking.due_date} {booking.due_time}</p>
              {booking.fulfillment === 'Delivery' && <p className="mt-2 text-xs text-fg-subtle">{booking.address}</p>}
              {booking.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-fg-muted">{booking.notes}</p>}
              {advance > 0 && (
                <div className="mt-3 space-y-1 rounded-control bg-success-soft p-3 text-xs ring-1 ring-inset ring-success/20">
                  <div className="flex items-center justify-between gap-3 font-semibold text-success-fg">
                    <span className="flex items-center gap-1.5"><Banknote className="size-4" aria-hidden="true" /> Advance paid on booking ({booking.payment_mode || 'Cash'}){booking.payment_notes ? ` · ${booking.payment_notes}` : ''}</span>
                    <Money amount={advance} className="text-sm font-bold" />
                  </div>
                  <div className="flex items-center justify-between gap-3 text-fg-muted">
                    <span>Remaining balance to collect</span>
                    <Money amount={Math.max(0, Number(booking.total) - advance)} className="font-bold text-warning-fg" />
                  </div>
                </div>
              )}
              <ul className="mt-3 divide-y divide-line">
                {booking.items.map((line, index) => (
                  <li key={index} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-fg">{line.name}{line.variantName ? ` · ${line.variantName}` : ''}</p>
                      <p className="mt-0.5 text-xs tabular-nums text-fg-subtle">{formatQty(line.qty, 3)} {line.unit} × {formatCurrency(line.price)}</p>
                    </div>
                    <Money amount={roundCurrency(line.qty * line.price)} className="text-sm font-bold text-fg" />
                  </li>
                ))}
              </ul>
            </Card>
            {booking.status === 'Completed' ? (
              <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-success-soft p-5 text-sm font-semibold text-success-fg ring-1 ring-inset ring-success/20">
                <span>Order billed successfully. Invoice, stock, cash and khata are saved.</span>
                <Button variant="secondary" size="sm" leftIcon={<Printer />} onClick={() => setCompletedSaleModalOpen(true)}>Print receipt</Button>
              </div>
            ) : (
              <Card className="pos-checkout-section overflow-hidden">
                <p className="border-b border-line bg-surface-2 px-4 py-3 text-xs text-fg-subtle">Choose payment below. Edit products or discount from Customer Orders before billing.</p>
                <PosPaymentPanel cart={cart} paymentMode={paymentMode} setPaymentMode={setPaymentMode} selectedCustomerId={selectedCustomerId} customerPaidAmount={customerPaidAmount} setCustomerPaidAmount={setCustomerPaidAmount} customerDueAmount={customerDueAmount} customerChangeReturn={customerChangeReturn} cashReceived={cashReceived} setCashReceived={setCashReceived} cashGiven={cashGiven} discountType={discountType} setDiscountType={() => {}} discountValue={discountValue} setDiscountValue={() => {}} subtotal={subtotal} discountAmount={discountAmount} totalItemDiscount={totalItemDiscount} grandTotal={grandTotal} isSubmitting={isSubmitting} activeShiftSession={activeShiftSession} handleCheckout={handleCheckout} amountDue={roundCurrency(Math.max(0, grandTotal - bookingAdvance))} lockDiscount onStartShift={openShiftModal} isDayLocked={isTodayLocked} />
              </Card>
            )}
          </>
        )}
        {receiptModal}
        {shiftModal}
      </div>
    );
  }

  return (
    <div data-pos-view={mobileTab} className="pos-workspace relative flex h-full flex-col gap-3 overflow-hidden pb-2">
      {approvalDialog}
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
        sales={sales}
        onOpenReceipt={handleOpenSaleReceipt}
      />

      {/* Selling needs an open shift; say so before the cashier builds a cart, not at checkout. */}
      {(isTodayLocked || noOpenShift) && (
        <div
          role="status"
          className={`${mobileTab === 'cart' ? 'hidden lg:flex' : 'flex'} shrink-0 items-center justify-between gap-3 rounded-control px-3 py-2 text-xs ring-1 ring-inset ${isTodayLocked ? 'bg-danger-soft text-danger-fg ring-danger/20' : 'bg-warning-soft text-warning-fg ring-warning/25'}`}
        >
          <span className="flex items-center gap-2 font-semibold">
            {isTodayLocked ? <Lock className="size-4 shrink-0" aria-hidden="true" /> : <Clock className="size-4 shrink-0" aria-hidden="true" />}
            {isTodayLocked
              ? `Business day ${getBusinessDate()} band ho chuka hai — sale nahi ho sakti. Owner se day reopen karwayein.`
              : 'Shift start nahi hui. Sale se pehle drawer ki cash gin kar shift start karein.'}
          </span>
          {!isTodayLocked && (
            <button
              type="button"
              onClick={openShiftModal}
              className="h-9 shrink-0 cursor-pointer rounded-lg bg-warning px-3 font-bold text-white shadow-e1 transition-colors hover:bg-warning/90"
            >
              Start Shift
            </button>
          )}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-hidden lg:flex-row">
        <PosProductGrid
          searchProduct={searchProduct}
          setSearchProduct={setSearchProduct}
          productSearchInputRef={productSearchInputRef}
          selectedCategories={selectedCategories}
          setSelectedCategories={setSelectedCategories}
          validCategories={validCategories}
          categoryCounts={categoryCounts}
          allCount={allAvailableProducts.length}
          availableProducts={availableProducts}
          findFirstMatch={findFirstMatch}
          cartQtyByProductId={cartQtyByProductId}
          openQuickModal={openQuickModal}
          addToCart={addToCart}
          mobileTab={mobileTab}
          showSearch={showProductSearch}
          showCategories={showProductCategories}
        />

        <section
          aria-label="Bill"
          className={`pos-checkout-panel pos-checkout-section h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-e1 ${
            mobileTab === 'cart' ? 'flex lg:flex-1' : 'hidden lg:flex lg:w-[44%] lg:min-w-[400px] lg:max-w-[580px] lg:shrink-0'
          }`}
        >
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
            locked={isSubmitting}
          />

          <PosCart
            expanded={mobileTab === 'cart'}
            cart={cart}
            onClearCart={handleClearCart}
            onSwipeRemove={swipeRemoveLine}
            setMobileTab={setMobileTab}
            updateQty={updateQty}
            setDirectQty={setDirectQty}
            updateRate={updateRate}
            updateLineTotal={updateLineTotal}
            openEditItemModal={openEditItemModal}
            removeLine={removeLine}
            getLineTotal={getLineTotal}
            locked={isSubmitting}
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
            onStartShift={openShiftModal}
            isDayLocked={isTodayLocked}
          />
        </section>
      </div>

      {cart.length > 0 && mobileTab === 'catalog' && (
        <div className="pos-mobile-cart-pill fixed inset-x-3 bottom-3 z-40 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileTab('cart')}
            className="flex h-16 w-full cursor-pointer items-center justify-between gap-3 rounded-card bg-brand px-3 text-brand-on shadow-e3 transition-transform active:scale-[.99]"
          >
            <span className="flex items-center gap-2.5">
              <span className="flex size-10 items-center justify-center rounded-control bg-brand-on/15" aria-hidden="true"><ShoppingCart className="size-5" /></span>
              <span className="text-left">
                <span className="block text-sm font-bold leading-tight">View cart</span>
                <span className="text-xs opacity-80">{cart.length} item{cart.length !== 1 ? 's' : ''} added</span>
              </span>
            </span>
            <span className="flex items-center gap-2 text-right">
              <Money amount={grandTotal} className="text-lg font-bold" />
              <ArrowRight className="size-5" aria-hidden="true" />
            </span>
          </button>
        </div>
      )}

      {quickModalOpen && quickProduct && (
        <Suspense fallback={null}>
          <PosQuickAmountModal
            open
            onClose={() => setQuickModalOpen(false)}
            quickProduct={quickProduct}
            initialEntry={quickInitial}
            cart={cart}
            allowNegativeStock={settings.inventory.allowNegativeStock}
            addToCart={addToCart}
            showToast={showToast}
            onAdded={() => { if (isCounterDesktop()) { productSearchInputRef.current?.focus(); productSearchInputRef.current?.select(); } }}
          />
        </Suspense>
      )}

      {heldOrdersModalOpen && (
        <Suspense fallback={null}>
          <PosHeldOrdersModal
            open
            onClose={() => setHeldOrdersModalOpen(false)}
            heldOrders={heldOrders}
            handleRecallOrder={handleRecallOrder}
            handleDeleteHeldOrder={handleDeleteHeldOrder}
          />
        </Suspense>
      )}

      {shortcutsModalOpen && (
        <Suspense fallback={null}>
          <PosShortcutsModal open onClose={() => setShortcutsModalOpen(false)} />
        </Suspense>
      )}

      {receiptModal}

      {newCustomerModalOpen && (
        <Suspense fallback={null}>
          <PosNewCustomerModal
            open
            onClose={() => setNewCustomerModalOpen(false)}
            newCustomer={newCustomer}
            setNewCustomer={setNewCustomer}
            handleCreateCustomer={handleCreateCustomer}
            isCreatingCustomer={isCreatingCustomer}
          />
        </Suspense>
      )}

      {editingCartItem && (
        <Suspense fallback={null}>
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
            onSellUnitChange={applySellUnit}
            items={items || []}
            sellOptions={posSellOptions(liveProduct(editingCartItem), cart, editingCartItem.cartItemId)}
            allowNegativeStock={Boolean(settings.inventory.allowNegativeStock)}
            onRemove={handleRemoveEditedItem}
            handleSaveEditItem={handleSaveEditItem}
          />
        </Suspense>
      )}

      {shiftModal}
    </div>
  );
};

export default POS;
