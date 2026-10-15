/**
 * MOOCO DAIRY APP - CENTRALIZED GLOBAL DESIGN SYSTEM & THEME TOKENS
 * 
 * ⚠️ STRICT RULE:
 * This file is the SINGLE SOURCE OF TRUTH for all visual styling,
 * brand colors, components, buttons, tabs, inputs, and tables across Mooco Dairy.
 * Do not introduce conflicting ad-hoc color schemes or overwrite brand tokens.
 */

export const BRAND_COLORS = {
  // Signature Mooco Lime Palette
  primary: '#65a30d',      // lime-600 (Main Buttons & Highlights)
  primaryLight: '#84cc16', // lime-500 (Active Hover & Focus Rings)
  primaryDark: '#4d7c0f',  // lime-700 (Active Press)
  primaryBg: '#f7fee7',    // lime-50 (Pills & Light Accents)
  primaryBadge: '#ecfccb', // lime-100 (Badges)
  primaryText: '#365314',  // lime-900 (High contrast text on lime)

  // Slate Neutral Hierarchy
  slate900: '#0f172a',     // Dark Headers & Titles
  slate800: '#1e293b',     // Subheadings & Modal Headers
  slate700: '#334155',     // Body text & Labels
  slate500: '#64748b',     // Micro-text & Muted details
  slate400: '#94a3b8',     // Placeholders & Disabled Icons
  slate200: '#e2e8f0',     // Standard Borders & Dividers
  slate100: '#f1f5f9',     // Panels & Input Insets
  slate50: '#f8fafc',      // Canvas Backgrounds & Table Headers

  // Financial & Operational Status Colors
  dueRed: '#dc2626',       // red-600 (Payables / Due Khata)
  dueRedBg: '#fef2f2',     // red-50 (Due Badges)
  advanceGreen: '#15803d', // emerald-700 (Prepaid / Advance)
  advanceGreenBg: '#f0fdf4', // emerald-50 (Advance Badges)
  warningAmber: '#d97706', // amber-600 (Alerts / Fixed Rates)
  warningAmberBg: '#fffbeb', // amber-50 (Warning Badges)
  infoBlue: '#2563eb',     // blue-600 (General Materials / Stats)
  infoBlueBg: '#eff6ff',   // blue-50 (Info Badges)
} as const;

// Workspace accents extend the core brand; financial statuses keep their semantic colors.
export const WORKSPACE_COLORS = {
  sales: BRAND_COLORS.primary,
  milk: '#0891b2',
  expenses: '#e11d48',
  products: '#7c3aed',
} as const;

export const DASHBOARD_COLORS = WORKSPACE_COLORS;

export const MOOCO_THEME = {
  // Standard Action Buttons
  button: {
    primary: "mooco-button mooco-button-primary bg-lime-600 hover:bg-lime-700 text-white font-bold px-4 py-2.5 rounded-xl shadow-lg shadow-lime-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer",
    secondary: "mooco-button mooco-button-secondary bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold px-4 py-2.5 rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer",
    danger: "mooco-button mooco-button-danger bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-2.5 rounded-xl shadow-lg shadow-red-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer",
    icon: "p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer",
    iconDanger: "p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer",
  },

  // Standard Segmented Tabs / Switchers
  tab: {
    container: "mooco-tabs bg-slate-100 p-1 rounded-xl flex gap-1 border border-slate-200/80",
    item: (isActive: boolean) => 
      `mooco-tab flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
        isActive 
          ? 'bg-lime-600 text-white shadow-md shadow-lime-200 font-extrabold' 
          : 'bg-white text-slate-500 hover:text-slate-700 hover:bg-slate-50 border border-transparent'
      }`,
    pill: (isActive: boolean) =>
      `mooco-pill px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
        isActive 
          ? 'bg-slate-900 text-white shadow-md shadow-slate-900/10' 
          : 'text-slate-600 hover:bg-slate-100'
      }`
  },

  // Containers, Cards & Panels
  card: {
    base: "mooco-card bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden",
    panel: "mooco-panel bg-slate-50 rounded-xl border border-slate-200/80 p-4",
    stat: "mooco-card mooco-stat bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group hover:border-slate-300 transition-all",
  },

  // Form Elements & Inputs
  input: {
    base: "mooco-input w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 shadow-sm focus:border-lime-500 focus:ring-2 focus:ring-lime-500/20 outline-none transition-all",
    label: "block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5",
    search: "mooco-input w-full h-11 pl-10 pr-10 rounded-xl border border-slate-200 bg-white text-sm font-medium focus:ring-2 focus:ring-lime-500/20 focus:border-lime-500 outline-none transition-all placeholder:text-slate-400",
    largeAmount: "mooco-input w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-2xl font-black text-slate-900 shadow-sm focus:border-lime-500 focus:ring-2 focus:ring-lime-500/20 outline-none transition-all",
  },

  // Data Tables
  table: {
    container: "mooco-card mooco-table bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm",
    thead: "mooco-table-head bg-slate-50 border-b border-slate-200 text-[11px] uppercase font-bold text-slate-500 tracking-wider",
    th: "px-6 py-4",
    tr: "hover:bg-slate-50 group transition-colors border-b border-slate-100 last:border-0",
    td: "px-6 py-4 text-sm text-slate-800 font-medium",
  },

  // Financial Badges & Status Indicators
  badge: {
    due: "inline-flex items-center gap-1 bg-red-50 text-red-600 border border-red-200 font-bold px-2.5 py-1 rounded-lg text-xs",
    advance: "inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold px-2.5 py-1 rounded-lg text-xs",
    settled: "inline-flex items-center gap-1 bg-slate-100 text-slate-500 border border-slate-200 font-semibold px-2.5 py-1 rounded-lg text-xs",
    active: "bg-lime-100 text-lime-800 font-extrabold px-2.5 py-0.5 rounded-full text-[11px]",
    neutral: "bg-slate-100 text-slate-700 font-bold px-2.5 py-0.5 rounded-md text-[11px] border border-slate-200",
  },

  // Dialog & Modal Windows
  modal: {
    overlay: "fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm overflow-hidden",
    box: "mooco-modal relative bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200",
    header: "bg-slate-900 text-white px-6 py-4 flex justify-between items-center shrink-0",
    body: "p-6 space-y-4 overflow-y-auto",
    footer: "p-6 border-t border-slate-100 bg-white flex gap-3",
  }
} as const;

export default MOOCO_THEME;
