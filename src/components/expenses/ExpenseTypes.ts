export type ExpenseDateFilterMode = 
  | 'today' 
  | 'yesterday' 
  | '7days' 
  | '30days' 
  | 'this_month' 
  | 'last_month' 
  | 'single_date' 
  | 'custom_range' 
  | 'all';

export interface SubcategoryStructure {
  name: string;
  originalName?: string;
  isCustom: boolean;
  accountId?: string;
  isActive: boolean;
}

export interface CategoryStructure {
  name: string;
  originalName?: string;
  isCustom: boolean;
  accountId?: string;
  isActive: boolean;
  subcategories: SubcategoryStructure[];
}

export interface LedgerRow {
  id: string;
  date: string;
  type: 'Opening Balance' | 'Bill' | 'Payment' | 'Refund';
  description: string;
  modeAccount: string;
  refNo: string;
  debit: number;   // Bill amount (increases dues)
  credit: number;  // Paid amount (decreases dues)
  runningBalance: number;
}

export type KhataDateRangeType = 
  | 'today' 
  | 'yesterday' 
  | '7days' 
  | '30days' 
  | 'last_30_days'
  | 'this_month' 
  | 'last_month' 
  | 'single_date' 
  | 'custom' 
  | 'all';

export interface VendorPaymentLogRow {
  id: string;
  sourceType: 'vendor_tx' | 'expense_bill';
  date: string;
  vendorId: string;
  vendorName: string;
  vendorServiceType?: string;
  vendorPhone?: string;
  actionType: 'Payment' | 'Refund' | 'Bill';
  direction: 'out' | 'in'; // 'out' = payment made (paid), 'in' = payment / refund received
  amount: number;
  paidAmount?: number;
  paymentMode: string;
  accountName: string;
  description: string;
  referenceNo?: string;
  note?: string;
  isDeletable?: boolean;
}

export const SERVICE_TYPES = [
  'Staff / Employee',
  'Staff Salary & Advance',
  'Electricity & Utility', 
  'Rent Landlord', 
  'Fuel & Transport', 
  'Packaging Supplier', 
  'Maintenance & Repairs', 
  'Staff Food & Welfare', 
  'Stationery & Supplies', 
  'General Vendor', 
  'Other'
];

export const DEFAULT_EXPENSE_STRUCTURE: Record<string, string[]> = {
  'Staff & Salaries': ['Staff Monthly Salary', 'Staff Daily Wages', 'Staff Advance / Loan', 'Staff Food & Welfare', 'Staff Medical & Bonus'],
  'Rent & Premises': ['Shop Rent', 'Plant / Processing Unit Rent', 'Storage / Godown Rent'],
  'Electricity & Utilities': ['Electricity / WAPDA Bill', 'Gas Bill', 'Water Tanker / Borewell', 'Internet & Phone Bill'],
  'Fuel & Logistics': ['Generator Diesel', 'Delivery Bike Fuel', 'Vehicle Transport Fuel', 'Mobil Oil & Maintenance'],
  'Packaging Material': ['Dahi Cups & Lids', 'Milk Bottles & Pouches', 'Shoppers & Bags', 'Tape, Labels & Stickers'],
  'Staff Food & Welfare': ['Daily Staff Tea & Refreshments', 'Staff Meals', 'Medical & First Aid'],
  'Repair & Maintenance': ['Chiller & Deep Freezer Repair', 'Motor & Water Pump', 'Electrical Wiring & Lights', 'Sanitary & Plumbing'],
  'Stationery & Office': ['POS Thermal Rolls', 'Bills & Registers', 'Office Cleaning Items'],
  'Marketing & Branding': ['Banners & Signboards', 'Flyers & Pamphlets', 'Social Media Ads'],
  'General Overhead': ['Ice Blocks for Cooling', 'Cleaning Chemicals & Detergents', 'Miscellaneous Overhead']
};
