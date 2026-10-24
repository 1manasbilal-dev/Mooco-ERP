// Shared design tokens (colours, surfaces, component class strings) used across the app.

const BRAND_COLORS = {
  primary: '#65a30d',      // lime-600 (Main Buttons & Highlights)
  primaryLight: '#84cc16', // lime-500 (Active Hover & Focus Rings)
  primaryDark: '#4d7c0f',  // lime-700 (Active Press)
  primaryBg: '#f7fee7',    // lime-50 (Pills & Light Accents)
  primaryBadge: '#ecfccb', // lime-100 (Badges)
  primaryText: '#365314',  // lime-900 (High contrast text on lime)

  slate900: '#0f172a',     // Dark Headers & Titles
  slate800: '#1e293b',     // Subheadings & Modal Headers
  slate700: '#334155',     // Body text & Labels
  slate500: '#64748b',     // Micro-text & Muted details
  slate400: '#94a3b8',     // Placeholders & Disabled Icons
  slate200: '#e2e8f0',     // Standard Borders & Dividers
  slate100: '#f1f5f9',     // Panels & Input Insets
  slate50: '#f8fafc',      // Canvas Backgrounds & Table Headers

  dueRed: '#dc2626',       // red-600 (Payables / Due Balances)
  dueRedBg: '#fef2f2',     // red-50 (Due Badges)
  advanceGreen: '#15803d', // emerald-700 (Prepaid / Advance)
  advanceGreenBg: '#f0fdf4', // emerald-50 (Advance Badges)
  warningAmber: '#d97706', // amber-600 (Alerts / Fixed Rates)
  warningAmberBg: '#fffbeb', // amber-50 (Warning Badges)
  infoBlue: '#2563eb',     // blue-600 (General Materials / Stats)
  infoBlueBg: '#eff6ff',   // blue-50 (Info Badges)
} as const;

// Workspace accents extend the core brand; financial statuses keep their semantic colors.
const WORKSPACE_COLORS = {
  sales: BRAND_COLORS.primary,
  milk: '#0891b2',
  expenses: '#e11d48',
  products: '#7c3aed',
} as const;

export const DASHBOARD_COLORS = WORKSPACE_COLORS;

/**
 * Legacy class strings for screens not yet on src/components/ui. They now use the design tokens,
 * so they match the new primitives in both themes; new code should use the components instead.
 */
export const MOOCO_THEME = {
  button: {
    primary: "mooco-button mooco-button-primary bg-brand hover:bg-brand-hover text-brand-on font-bold px-4 py-2.5 rounded-control shadow-e1-lit active:scale-[.98] transition-all flex items-center justify-center gap-2 cursor-pointer",
    secondary: "mooco-button mooco-button-secondary bg-surface hover:bg-surface-2 border border-line hover:border-line-strong text-fg font-bold px-4 py-2.5 rounded-control shadow-e1 transition-all flex items-center justify-center gap-2 cursor-pointer",
    danger: "mooco-button mooco-button-danger bg-danger hover:bg-danger/90 text-white font-bold px-4 py-2.5 rounded-control shadow-e1 active:scale-[.98] transition-all flex items-center justify-center gap-2 cursor-pointer",
    icon: "p-2 rounded-control text-fg-faint hover:text-fg hover:bg-surface-2 transition-colors cursor-pointer",
    iconDanger: "p-2 rounded-control text-fg-faint hover:text-danger-fg hover:bg-danger-soft transition-colors cursor-pointer",
  },

  tab: {
    container: "mooco-tabs bg-surface-2 p-1 rounded-control flex gap-1 ring-1 ring-inset ring-line",
    item: (isActive: boolean) =>
      `mooco-tab flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${
        isActive
          ? 'bg-brand text-brand-on shadow-e1 font-extrabold'
          : 'text-fg-subtle hover:text-fg hover:bg-surface'
      }`,
    pill: (isActive: boolean) =>
      `mooco-pill px-3.5 py-1.5 rounded-control text-xs font-bold transition-all ${
        isActive
          ? 'bg-fg text-surface shadow-e1'
          : 'text-fg-muted hover:bg-surface-2'
      }`
  },

  card: {
    base: "mooco-card bg-surface rounded-card border border-line shadow-e1 overflow-hidden",
    panel: "mooco-panel bg-surface-2 rounded-control border border-line p-4",
    stat: "mooco-card mooco-stat bg-surface p-5 rounded-card border border-line shadow-e1 relative overflow-hidden group hover:border-line-strong transition-all",
  },

  input: {
    base: "mooco-input ds-control w-full rounded-control border border-line bg-surface px-3.5 py-2.5 text-sm font-semibold text-fg shadow-e1 focus:border-brand-accent focus:ring-4 focus:ring-ring/20 outline-none transition-all",
    label: "block text-[11px] font-bold text-fg-subtle uppercase tracking-wider mb-1.5",
    search: "mooco-input ds-control w-full h-11 pl-10 pr-10 rounded-control border border-line bg-surface text-sm font-medium text-fg focus:ring-4 focus:ring-ring/20 focus:border-brand-accent outline-none transition-all placeholder:text-fg-faint",
    largeAmount: "mooco-input ds-control w-full rounded-control border border-line bg-surface px-4 py-3 text-2xl font-black text-fg shadow-e1 focus:border-brand-accent focus:ring-4 focus:ring-ring/20 outline-none transition-all",
  },

  table: {
    container: "mooco-card mooco-table bg-surface border border-line rounded-card overflow-hidden shadow-e1",
    thead: "mooco-table-head bg-surface-2 border-b border-line text-[11px] uppercase font-bold text-fg-subtle tracking-wider",
    th: "px-6 py-4",
    tr: "hover:bg-surface-2 group transition-colors border-b border-line last:border-0",
    td: "px-6 py-4 text-sm text-fg font-medium",
  },

  badge: {
    due: "inline-flex items-center gap-1 bg-danger-soft text-danger-fg ring-1 ring-inset ring-danger/20 font-bold px-2.5 py-1 rounded-lg text-xs",
    advance: "inline-flex items-center gap-1 bg-success-soft text-success-fg ring-1 ring-inset ring-success/20 font-bold px-2.5 py-1 rounded-lg text-xs",
    settled: "inline-flex items-center gap-1 bg-surface-2 text-fg-subtle ring-1 ring-inset ring-line font-semibold px-2.5 py-1 rounded-lg text-xs",
    active: "bg-brand-soft text-brand-fg font-extrabold px-2.5 py-0.5 rounded-full text-[11px]",
    neutral: "bg-surface-2 text-fg-muted font-bold px-2.5 py-0.5 rounded-md text-[11px] ring-1 ring-inset ring-line",
  },

  modal: {
    overlay: "fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgb(2_6_23/0.5)] overflow-hidden",
    box: "mooco-modal relative bg-surface rounded-card shadow-e3 w-full max-w-lg overflow-hidden border border-line animate-in zoom-in-95 duration-200",
    header: "bg-surface-2 text-fg border-b border-line px-6 py-4 flex justify-between items-center shrink-0",
    body: "p-6 space-y-4 overflow-y-auto",
    footer: "p-6 border-t border-line bg-surface flex gap-3",
  }
} as const;
