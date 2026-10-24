import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton, controlClass } from '../ui';
import type { Tone } from '../ui';
import { cn } from '../../lib/cn';

/**
 * Dialog-only building blocks for the expense forms. Only ExpenseModals imports this file,
 * so it ships in the lazy dialogs chunk.
 */

/** Text input look shared by plain inputs and SmartNumberInput. */
export const fieldClass = cn(controlClass, 'h-10 px-3');

export const FieldLabel: React.FC<{ children: React.ReactNode; aside?: React.ReactNode; htmlFor?: string }> = ({ children, aside, htmlFor }) => (
  <div className="mb-1.5 flex min-h-5 items-center justify-between gap-2">
    <label htmlFor={htmlFor} className="text-xs font-semibold text-fg-muted">{children}</label>
    {aside}
  </div>
);

/** Small text action next to a field label, e.g. "+ New". */
export const LinkButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className, children, ...rest }) => (
  <button
    type="button"
    {...rest}
    className={cn(
      'flex cursor-pointer items-center gap-0.5 rounded-md px-1 text-[11px] font-bold text-brand-fg hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
      className,
    )}
  >
    {children}
  </button>
);

/** Tiny toggle chip for quick picks next to a label (Today / Yesterday, Full / Half). */
export const QuickPick: React.FC<{ selected: boolean; onClick: () => void; children: React.ReactNode }> = ({ selected, onClick, children }) => (
  <button
    type="button"
    aria-pressed={selected}
    onClick={onClick}
    className={cn(
      'cursor-pointer rounded-md px-1.5 py-0.5 text-[10px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      selected ? 'bg-brand text-brand-on' : 'bg-surface-2 text-fg-subtle hover:text-fg',
    )}
  >
    {children}
  </button>
);

/** Choice chip used for quick picks inside forms. */
export const ChoiceChip: React.FC<{ selected: boolean; onClick: () => void; children: React.ReactNode; className?: string }> = ({ selected, onClick, children, className }) => (
  <button
    type="button"
    aria-pressed={selected}
    onClick={onClick}
    className={cn(
      'flex min-h-8 cursor-pointer items-center gap-1.5 rounded-control border px-2.5 py-1.5 text-xs font-semibold transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      selected
        ? 'border-brand-accent bg-brand-soft text-brand-fg ring-2 ring-brand/15'
        : 'border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg',
      className,
    )}
  >
    {children}
  </button>
);

/** Big two-line option card (payment status, pay / receive). */
export const OptionCard: React.FC<{
  selected: boolean;
  onClick: () => void;
  tone: 'success' | 'warning' | 'danger' | 'info' | 'brand';
  icon: React.ElementType;
  label: string;
  hint?: string;
  hintClassName?: string;
}> = ({ selected, onClick, tone, icon: Icon, label, hint, hintClassName }) => {
  const on = {
    success: 'border-success bg-success-soft text-success-fg ring-success/15',
    warning: 'border-warning bg-warning-soft text-warning-fg ring-warning/15',
    danger: 'border-danger bg-danger-soft text-danger-fg ring-danger/15',
    info: 'border-info bg-info-soft text-info-fg ring-info/15',
    brand: 'border-brand-accent bg-brand-soft text-brand-fg ring-brand/15',
  }[tone];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'min-h-11 cursor-pointer rounded-control border px-2.5 py-2 text-left transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? cn(on, 'ring-4') : 'border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg',
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-bold"><Icon size={14} />{label}</span>
      {hint && <span className={cn('mt-0.5 block text-[10px] font-medium opacity-80', hintClassName)}>{hint}</span>}
    </button>
  );
};

export const Switch: React.FC<{ checked: boolean; onChange: (value: boolean) => void; label: string; size?: 'sm' | 'md' }> = ({ checked, onChange, label, size = 'md' }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    title={label}
    onClick={() => onChange(!checked)}
    className={cn(
      'relative inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
      size === 'sm' ? 'h-4 w-7' : 'h-5 w-9',
      checked ? 'bg-brand' : 'bg-surface-3 ring-1 ring-inset ring-line-strong',
    )}
  >
    <span className={cn(
      'inline-block rounded-full bg-white shadow-e1 transition-transform duration-150 ease-out-expo',
      size === 'sm' ? 'size-3' : 'size-4',
      checked ? (size === 'sm' ? 'translate-x-3.5' : 'translate-x-[18px]') : 'translate-x-0.5',
    )} />
  </button>
);

const ICON_TONE: Record<Tone | 'expense', string> = {
  neutral: 'bg-surface-2 text-fg-muted',
  brand: 'bg-brand-soft text-brand-fg',
  success: 'bg-success-soft text-success-fg',
  danger: 'bg-danger-soft text-danger-fg',
  warning: 'bg-warning-soft text-warning-fg',
  info: 'bg-info-soft text-info-fg',
  // Workspace identity touch for the expenses area (design-system.md: page icon chips only).
  expense: 'bg-rose-500/15 text-rose-500',
};

export const SheetIcon: React.FC<{ icon: React.ElementType; tone?: Tone | 'expense' }> = ({ icon: Icon, tone = 'brand' }) => (
  <span className={cn('flex size-10 items-center justify-center rounded-control', ICON_TONE[tone])} aria-hidden="true">
    <Icon size={18} />
  </span>
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
  children: React.ReactNode;
}> = ({ open, onClose, title, subtitle, icon, size = 'lg', dismissible = true, children }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

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
        className="absolute inset-0 bg-slate-950/55 backdrop-blur-[2px] animate-in fade-in duration-150"
        aria-hidden="true"
        onClick={() => { if (dismissible) onClose(); }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-[22px] border border-line bg-surface text-fg shadow-e3 outline-none',
          'animate-in fade-in slide-in-from-bottom-6 duration-200 sm:max-h-[90vh] sm:rounded-card sm:zoom-in-95 sm:slide-in-from-bottom-0',
          SHEET_SIZE[size],
        )}
      >
        <div className="relative shrink-0 border-b border-line px-5 pb-3.5 pt-4">
          <span className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-line-strong sm:hidden" aria-hidden="true" />
          <div className="flex items-start gap-3">
            {icon && <div className="shrink-0">{icon}</div>}
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="truncate text-base font-bold tracking-tight text-fg">{title}</h2>
              {subtitle && <div className="mt-0.5 text-xs text-fg-subtle">{subtitle}</div>}
            </div>
            {dismissible && (
              <IconButton size="sm" aria-label="Close" icon={<X />} onClick={onClose} className="-mr-1.5 -mt-1" />
            )}
          </div>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
};

export const SheetBody: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4', className)}>{children}</div>
);

export const SheetFooter: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn('flex shrink-0 items-center gap-2 border-t border-line bg-surface-2/60 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]', className)}>
    {children}
  </div>
);
