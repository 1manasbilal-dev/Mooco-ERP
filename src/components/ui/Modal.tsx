import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { IconButton } from './Button';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  /** Short line under the title; also used as the dialog's accessible description. */
  description?: React.ReactNode;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** `xl` is for wide forms and tables. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Element to focus when the dialog opens (defaults to the first focusable one). */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Block Esc / backdrop / close button while something is saving. */
  dismissible?: boolean;
  role?: 'dialog' | 'alertdialog';
  /** Stack above other open modals (confirmations opened from inside a dialog use this). */
  elevated?: boolean;
}

const SIZE_CLASS = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' } as const;

// Layers: page < quick search (150) < modal (200) < elevated modal / confirm (210) < toasts (220) < lock screen (250).
const LAYER_CLASS = { base: 'z-[200]', elevated: 'z-[210]' } as const;

/** Focusable elements that are actually on screen (offsetParent is null inside fixed parents, so use client rects). */
const visibleFocusable = (panel: HTMLElement) =>
  (Array.from(panel.querySelectorAll(FOCUSABLE)) as HTMLElement[]).filter(el => el.getClientRects().length > 0);

/**
 * Shared accessible modal: role="dialog", aria-modal, focus trap, Esc to close,
 * focus goes back to whatever opened it. A bottom sheet on phones, centred from `sm` up.
 */
export const Modal: React.FC<ModalProps> = ({
  open, onClose, title, description, icon, children, footer, size = 'md', initialFocusRef, dismissible = true, role = 'dialog', elevated = false,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      const target = initialFocusRef?.current || (panel && visibleFocusable(panel)[0]) || panel;
      target?.focus({ preventScroll: true });
    }, 0);
    return () => {
      window.clearTimeout(focusTimer);
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus({ preventScroll: true });
    };
  }, [open, initialFocusRef]);

  if (!open) return null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Keys typed inside a dialog belong to it, never to page shortcuts behind it.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (dismissibleRef.current) onCloseRef.current();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const focusable = visibleFocusable(panelRef.current);
    if (focusable.length === 0) { event.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    // Focus on the panel itself (or anything not in the list) would otherwise tab out of the dialog.
    const outside = !active || !focusable.includes(active);
    if (event.shiftKey && (active === first || outside)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (active === last || outside)) { event.preventDefault(); first.focus(); }
  };

  return createPortal(
    <div className={cn('fixed inset-0 flex items-end justify-center sm:items-center sm:p-4', LAYER_CLASS[elevated ? 'elevated' : 'base'])} data-app-modal="true" onKeyDown={handleKeyDown}>
      <div
        className="absolute inset-0 bg-[rgb(2_6_23/0.5)] animate-in fade-in duration-150"
        aria-hidden="true"
        onClick={() => { if (dismissible) onClose(); }}
      />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-card border border-line bg-surface text-fg shadow-e3 outline-none',
          'animate-in fade-in slide-in-from-bottom-4 duration-200 ease-out-expo sm:max-h-[90vh] sm:rounded-card sm:slide-in-from-bottom-0 sm:zoom-in-95',
          SIZE_CLASS[size],
        )}
      >
        <div className="flex shrink-0 items-start gap-3 px-5 pt-5">
          {icon && <div className="shrink-0">{icon}</div>}
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 id={titleId} className="text-[17px] font-bold leading-snug tracking-tight text-fg">{title}</h2>
            {description && <div id={descriptionId} className="mt-1 text-sm text-fg-subtle">{description}</div>}
          </div>
          {dismissible && (
            <IconButton size="sm" variant="ghost" aria-label="Band karein" icon={<X />} onClick={onClose} className="-mr-1.5 -mt-1 shrink-0" />
          )}
        </div>
        {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2 pt-4">{children}</div>}
        {footer ? (
          <div className="flex shrink-0 flex-col-reverse gap-2 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:flex-row sm:justify-end sm:pb-5">{footer}</div>
        ) : (
          <div className="shrink-0 pb-5" />
        )}
      </div>
    </div>,
    document.body,
  );
};
