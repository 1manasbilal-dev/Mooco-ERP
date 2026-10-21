export interface HeldOrder {
  id: string;
  cart: any[];
  selectedCustomerId: string;
  customerName: string;
  paymentMode: string;
  discountType: 'flat' | 'percent';
  discountValue: string;
  timestamp: string;
  subtotal: number;
  grandTotal: number;
}

export interface AvailableProduct {
  id: string;
  name: string;
  price: number;
  unit: string;
  category: string[];
  stock: number;
  variants: any[];
  variant_stocks: Record<string, number>;
  total_variant_stock: number;
  is_available: boolean;
  quick_amounts: number[];
  pos_primary_mode?: 'amount' | 'qty';
  allow_loose_sale: boolean;
  image_url?: string;
  sort_order?: number;
}

export interface PosNewCustomerData {
  name: string;
  phone: string;
  is_phone_whatsapp: boolean;
  whatsapp: string;
  city: string;
  address: string;
  balanceType: 'None' | 'Due' | 'Advance';
  balanceAmount: string;
  notes: string;
}

export interface LastCompletedSale {
  invoiceNo: string;
  date: string;
  time: string;
  customerName: string;
  customerPhone: string;
  items: any[];
  subtotal: number;
  discountAmount: number;
  grandTotal: number;
  paidAmount: number;
  dueAmount: number;
  paymentMode: string;
  cashGiven: number;
  changeReturn: number;
}
