import type { ReportCategory, ReportDefinition } from './types';
import { salesReports } from './definitions/sales';
import { financialReports } from './definitions/financial';
import { cashReports } from './definitions/cash';
import { customerReports } from './definitions/customers';
import { milkReports } from './definitions/milk';
import { supplierReports } from './definitions/suppliers';
import { inventoryReports } from './definitions/inventory';
import { productionReports } from './definitions/production';
import { expenseReports } from './definitions/expenses';

export const REPORT_CATEGORIES: { id: ReportCategory; label: string; icon: string; accent: string }[] = [
  { id: 'overview', label: 'Overview', icon: 'Sparkles', accent: 'lime' },
  { id: 'sales', label: 'Sales', icon: 'ShoppingCart', accent: 'lime' },
  { id: 'financial', label: 'Accounts & Profit', icon: 'Landmark', accent: 'violet' },
  { id: 'customers', label: 'Customers', icon: 'Users', accent: 'amber' },
  { id: 'milk', label: 'Milk Collection', icon: 'Droplets', accent: 'cyan' },
  { id: 'suppliers', label: 'Suppliers & Purchases', icon: 'Truck', accent: 'cyan' },
  { id: 'inventory', label: 'Stock', icon: 'Boxes', accent: 'violet' },
  { id: 'production', label: 'Production', icon: 'Factory', accent: 'violet' },
  { id: 'expenses', label: 'Expenses', icon: 'Receipt', accent: 'rose' },
  { id: 'cash', label: 'Shifts & Cash', icon: 'Wallet', accent: 'amber' },
];

export const REPORTS: ReportDefinition[] = [
  ...financialReports.filter(r => r.category === 'overview'),
  ...salesReports,
  ...financialReports.filter(r => r.category !== 'overview'),
  ...customerReports,
  ...milkReports,
  ...supplierReports,
  ...inventoryReports,
  ...productionReports,
  ...expenseReports,
  ...cashReports,
];

const byId = new Map(REPORTS.map(report => [report.id, report]));
export const getReport = (id?: string | null) => (id ? byId.get(id) : undefined);

/** Loose search over title, subtitle and keywords; every word must match somewhere. */
export function searchReports(reports: ReportDefinition[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return reports;
  return reports.filter(report => {
    const hay = [report.title, report.subtitle, report.category, ...(report.keywords || [])].join(' ').toLowerCase();
    return words.every(word => hay.includes(word));
  });
}
