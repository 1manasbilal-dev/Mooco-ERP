import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Coffee, FileText, Fuel, Home, Megaphone, Package, Receipt, Tag, Users, Wrench, X, Zap,
} from 'lucide-react';
import { businessDate, offsetDate } from '../../lib/dashboardAnalytics';

/** Shared building blocks for the Expenses & Vendors screens and their dialogs. */

export type ExpensesSection = 'transactions' | 'vendors';

const SECTIONS: { id: ExpensesSection; label: string; short: string; Icon: React.ElementType }[] = [
  { id: 'transactions', label: 'Expenses', short: 'Expenses', Icon: Receipt },
  { id: 'vendors', label: 'Vendors & Khata', short: 'Vendors', Icon: Users },
];

export const ExpensesHeader: React.FC<{
  active: ExpensesSection;
  onChange: (section: ExpensesSection) => void;
  subtitle: string;
  counts?: Partial<Record<ExpensesSection, number>>;
  actions?: React.ReactNode;
}> = ({ active, onChange, subtitle, counts, actions }) => {
  const ActiveIcon = SECTIONS.find(section => section.id === active)?.Icon || Receipt;
  return (
    <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between print:hidden">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-rose-400 to-rose-600 text-white shadow-md shadow-rose-600/25">
          <ActiveIcon size={20} strokeWidth={2.2} />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Parties &amp; Ledgers</p>
          <h1 className="truncate text-lg font-black leading-tight tracking-tight text-slate-900 sm:text-xl">Expenses &amp; Vendors</h1>
          <p className="truncate text-xs text-slate-500">{subtitle}</p>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <nav aria-label="Expenses sections" className="flex min-w-0 flex-1 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 lg:flex-initial">
          {SECTIONS.map(({ id, label, short, Icon }) => {
            const selected = id === active;
            const count = counts?.[id];
            return (
              <button
                key={id}
                type="button"
                aria-current={selected ? 'page' : undefined}
                onClick={() => !selected && onChange(id)}
                className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-all lg:flex-initial ${
                  selected ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-900/5' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Icon size={14} className={selected ? 'text-rose-500' : ''} />
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{label}</span>
                {count !== undefined && count > 0 && (
                  <span className={`hidden rounded-full px-1.5 text-[10px] font-bold tabular-nums sm:inline ${selected ? 'bg-rose-100 text-rose-700' : 'bg-slate-200 text-slate-600'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        {actions}
      </div>
    </header>
  );
};

export interface CategoryTone { tile: string; bar: string; text: string; }

const PALETTE: CategoryTone[] = [
  { tile: 'bg-lime-100 text-lime-700', bar: 'bg-lime-500', text: 'text-lime-700' },
  { tile: 'bg-sky-100 text-sky-700', bar: 'bg-sky-500', text: 'text-sky-700' },
  { tile: 'bg-amber-100 text-amber-700', bar: 'bg-amber-500', text: 'text-amber-700' },
  { tile: 'bg-rose-100 text-rose-700', bar: 'bg-rose-500', text: 'text-rose-700' },
  { tile: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500', text: 'text-emerald-700' },
  { tile: 'bg-indigo-100 text-indigo-700', bar: 'bg-indigo-500', text: 'text-indigo-700' },
  { tile: 'bg-orange-100 text-orange-700', bar: 'bg-orange-500', text: 'text-orange-700' },
  { tile: 'bg-cyan-100 text-cyan-700', bar: 'bg-cyan-500', text: 'text-cyan-700' },
  { tile: 'bg-purple-100 text-purple-700', bar: 'bg-purple-500', text: 'text-purple-700' },
  { tile: 'bg-blue-100 text-blue-700', bar: 'bg-blue-500', text: 'text-blue-700' },
];

/** Stable colour per category name, so a category looks the same everywhere. */
export function categoryTone(name?: string): CategoryTone {
  const value = (name || '').trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

const ICON_RULES: [RegExp, React.ElementType][] = [
  [/staff|salar|wage|employee/, Users],
  [/rent|premises|godown|shop/, Home],
  [/electric|utilit|gas|water|internet|bill/, Zap],
  [/fuel|diesel|petrol|logistic|transport|vehicle/, Fuel],
  [/packag|cup|bottle|pouch|shopper/, Package],
  [/food|welfare|tea|meal/, Coffee],
  [/repair|mainten|plumb|wiring/, Wrench],
  [/station|office|register|roll/, FileText],
  [/market|brand|banner|ads/, Megaphone],
];

function categoryIcon(name?: string): React.ElementType {
  const value = (name || '').toLowerCase();
  return ICON_RULES.find(([pattern]) => pattern.test(value))?.[1] || Tag;
}

export const CategoryBadge: React.FC<{ name?: string; size?: 'sm' | 'md' | 'lg' }> = ({ name, size = 'md' }) => {
  const Icon = categoryIcon(name);
  const tone = categoryTone(name);
  const box = size === 'lg' ? 'h-11 w-11 rounded-2xl' : size === 'sm' ? 'h-7 w-7 rounded-lg' : 'h-9 w-9 rounded-xl';
  return (
    <span className={`grid shrink-0 place-items-center ${box} ${tone.tile}`}>
      <Icon size={size === 'lg' ? 18 : size === 'sm' ? 13 : 15} />
    </span>
  );
};

export type PayStatus = 'Paid' | 'Partial' | 'Unpaid';

const STATUS_META: Record<PayStatus, { label: string; pill: string; dot: string }> = {
  Paid: { label: 'Paid', pill: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15', dot: 'bg-emerald-500' },
  Partial: { label: 'Partial', pill: 'bg-amber-50 text-amber-700 ring-amber-600/15', dot: 'bg-amber-500' },
  Unpaid: { label: 'On credit', pill: 'bg-rose-50 text-rose-700 ring-rose-600/15', dot: 'bg-rose-500' },
};

export const StatusPill: React.FC<{ status?: string; className?: string }> = ({ status, className = '' }) => {
  const meta = STATUS_META[(status as PayStatus) || 'Paid'] || STATUS_META.Paid;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${meta.pill} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
};

/** Amount actually paid on an expense, tolerating snake_case rows from the database. */
export function paidOf(expense: { amount?: number; paidAmount?: number; paymentStatus?: string } & Record<string, any>): number {
  const status = expense.paymentStatus || expense.payment_status;
  if (status === 'Unpaid') return 0;
  const raw = expense.paidAmount ?? expense.paid_amount;
  return raw !== undefined && raw !== null ? Number(raw) : Number(expense.amount || 0);
}

export const pkToday = () => businessDate();

export function dayKey(value?: string): string {
  if (!value) return '';
  return value.includes('T') ? businessDate(value) : value.slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Today", "Yesterday" or "Mon, 12 Oct 2026" for a YYYY-MM-DD day. */
export function dayHeading(day: string): { title: string; sub: string } {
  if (!day) return { title: 'No date', sub: '' };
  const today = pkToday();
  const [y, m, d] = day.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const full = `${d} ${MONTHS[m - 1]} ${y}`;
  if (day === today) return { title: 'Today', sub: `${weekday}, ${full}` };
  if (day === offsetDate(today, -1)) return { title: 'Yesterday', sub: `${weekday}, ${full}` };
  return { title: `${weekday}, ${d} ${MONTHS[m - 1]}`, sub: String(y) === today.slice(0, 4) ? '' : String(y) };
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m ? `${MONTHS[m - 1]} ${y}` : month;
}

export const ToolbarButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }> = ({ active, className = '', children, ...rest }) => (
  <button
    type="button"
    {...rest}
    className={`flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors disabled:opacity-50 ${
      active ? 'border-lime-300 bg-lime-50 text-lime-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
    } ${className}`}
  >
    {children}
  </button>
);

export const PrimaryButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'lime' | 'emerald' | 'sky' | 'rose' }> = ({ tone = 'lime', className = '', children, ...rest }) => {
  const toneClass = {
    lime: 'bg-lime-600 hover:bg-lime-700 shadow-lime-600/25',
    emerald: 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/25',
    sky: 'bg-sky-600 hover:bg-sky-700 shadow-sky-600/25',
    rose: 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/25',
  }[tone];
  return (
    <button
      type="button"
      {...rest}
      className={`flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3.5 text-xs font-bold text-white shadow-md transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-400 disabled:shadow-none ${toneClass} ${className}`}
    >
      {children}
    </button>
  );
};

export const EmptyState: React.FC<{ icon: React.ElementType; title: string; hint?: string; action?: React.ReactNode }> = ({ icon: Icon, title, hint, action }) => (
  <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
    <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
      <Icon size={22} />
    </span>
    <p className="text-sm font-bold text-slate-800">{title}</p>
    {hint && <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-500">{hint}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

/** Removable chip that shows one active filter. */
export const FilterChip: React.FC<{ label: string; onClear: () => void }> = ({ label, onClear }) => (
  <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-lime-200 bg-lime-50 py-0.5 pl-2.5 pr-1 text-[11px] font-semibold text-lime-800">
    <span className="truncate">{label}</span>
    <button type="button" onClick={onClear} aria-label={`${label} filter hatayen`} className="grid h-4 w-4 place-items-center rounded-full hover:bg-lime-200">
      <X size={10} />
    </button>
  </span>
);

export const fieldClass = 'h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 placeholder:font-medium placeholder:text-slate-400 outline-none transition-colors focus:border-lime-500 focus:ring-4 focus:ring-lime-500/10';

export const FieldLabel: React.FC<{ children: React.ReactNode; aside?: React.ReactNode; htmlFor?: string }> = ({ children, aside, htmlFor }) => (
  <div className="mb-1.5 flex items-center justify-between gap-2">
    <label htmlFor={htmlFor} className="text-xs font-bold text-slate-700">{children}</label>
    {aside}
  </div>
);

export const LinkButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className = '', children, ...rest }) => (
  <button type="button" {...rest} className={`flex items-center gap-0.5 text-[11px] font-bold text-lime-700 hover:text-lime-800 ${className}`}>
    {children}
  </button>
);

/** Two-line choice chip used for quick picks inside forms. */
export const ChoiceChip: React.FC<{ selected: boolean; onClick: () => void; children: React.ReactNode; className?: string }> = ({ selected, onClick, children, className = '' }) => (
  <button
    type="button"
    aria-pressed={selected}
    onClick={onClick}
    className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition-all ${
      selected ? 'border-lime-500 bg-lime-50 text-lime-800 ring-2 ring-lime-500/15' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
    } ${className}`}
  >
    {children}
  </button>
);

export const Switch: React.FC<{ checked: boolean; onChange: (value: boolean) => void; label: string; size?: 'sm' | 'md' }> = ({ checked, onChange, label, size = 'md' }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    title={label}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex shrink-0 items-center rounded-full transition-colors ${size === 'sm' ? 'h-4 w-7' : 'h-5 w-9'} ${checked ? 'bg-emerald-600' : 'bg-slate-300'}`}
  >
    <span className={`inline-block rounded-full bg-white shadow transition-transform ${size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'} ${
      checked ? (size === 'sm' ? 'translate-x-3.5' : 'translate-x-[18px]') : 'translate-x-0.5'
    }`} />
  </button>
);

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const SHEET_SIZE = { md: 'sm:max-w-md', lg: 'sm:max-w-xl', xl: 'sm:max-w-3xl' } as const;

/** Dialog shell with a sticky header and footer: a bottom sheet on phones, a centred card on larger screens. */
export const Sheet: React.FC<{
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  size?: keyof typeof SHEET_SIZE;
  /** Block Esc / backdrop while saving. */
  dismissible?: boolean;
  /** Tint behind the header, e.g. 'from-emerald-50'. */
  accent?: string;
  children: React.ReactNode;
}> = ({ open, onClose, title, subtitle, icon, size = 'lg', dismissible = true, accent = 'from-slate-50', children }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      const target = panel.querySelector<HTMLElement>('[data-autofocus]') || panel.querySelector<HTMLElement>(FOCUSABLE) || panel;
      target.focus();
    }, 30);
    return () => {
      window.clearTimeout(timer);
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      if (event.defaultPrevented) return;
      event.preventDefault();
      // First Esc leaves a text field (and its suggestion list); the next one closes the sheet.
      const target = event.target as HTMLElement;
      if (target !== panelRef.current && ['INPUT', 'TEXTAREA'].includes(target.tagName)) {
        target.blur();
        panelRef.current?.focus();
        return;
      }
      if (dismissibleRef.current) onCloseRef.current();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const focusable = (Array.from(panelRef.current.querySelectorAll(FOCUSABLE)) as HTMLElement[]).filter(el => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-end justify-center sm:items-center sm:p-4" data-app-modal="true" onKeyDown={handleKeyDown}>
      <div
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px] animate-in fade-in duration-150"
        aria-hidden="true"
        onClick={() => { if (dismissible) onClose(); }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl outline-none animate-in slide-in-from-bottom-6 fade-in duration-200 sm:max-h-[90vh] sm:rounded-2xl sm:zoom-in-95 sm:slide-in-from-bottom-0 ${SHEET_SIZE[size]}`}
      >
        <div className={`relative shrink-0 border-b border-slate-100 bg-gradient-to-b ${accent} to-white px-5 pb-3.5 pt-4 dark:from-slate-800/70 dark:to-slate-900`}>
          <span className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-slate-300 sm:hidden" aria-hidden="true" />
          <div className="flex items-start gap-3">
            {icon && <div className="shrink-0">{icon}</div>}
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="truncate text-base font-black tracking-tight text-slate-900">{title}</h2>
              {subtitle && <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>}
            </div>
            {dismissible && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Band karein"
                className="-mr-1.5 -mt-1 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
};

export const SheetBody: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 ${className}`}>{children}</div>
);

export const SheetFooter: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`flex shrink-0 items-center gap-2 border-t border-slate-100 bg-slate-50/80 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${className}`}>
    {children}
  </div>
);

export const SheetIcon: React.FC<{ icon: React.ElementType; tone?: string }> = ({ icon: Icon, tone = 'bg-lime-600 text-white shadow-lime-600/25' }) => (
  <span className={`grid h-10 w-10 place-items-center rounded-xl shadow-md ${tone}`}>
    <Icon size={18} />
  </span>
);
