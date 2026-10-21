import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

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
  size?: 'sm' | 'md' | 'lg';
  /** Element to focus when the dialog opens (defaults to the first focusable one). */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Block Esc / backdrop / close button while something is saving. */
  dismissible?: boolean;
  role?: 'dialog' | 'alertdialog';
}

const SIZE_CLASS = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl' } as const;

/**
 * Shared accessible modal: role="dialog", aria-modal, focus trap, Esc to close,
 * focus goes back to whatever opened it.
 */
export const Modal: React.FC<ModalProps> = ({
  open, onClose, title, description, icon, children, footer, size = 'md', initialFocusRef, dismissible = true, role = 'dialog',
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
      const target = initialFocusRef?.current || panelRef.current?.querySelector<HTMLElement>(FOCUSABLE) || panelRef.current;
      target?.focus();
    }, 0);
    return () => {
      window.clearTimeout(focusTimer);
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
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
    const focusable = (Array.from(panelRef.current.querySelectorAll(FOCUSABLE)) as HTMLElement[]).filter(el => el.offsetParent !== null);
    if (focusable.length === 0) { event.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" data-app-modal="true" onKeyDown={handleKeyDown}>
      <div
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px] animate-in fade-in duration-150"
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
        className={`relative w-full ${SIZE_CLASS[size]} max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none animate-in fade-in zoom-in-95 duration-150 dark:border-slate-700 dark:bg-slate-900`}
      >
        <div className="flex items-start gap-3 px-5 pt-5">
          {icon && <div className="shrink-0">{icon}</div>}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-bold text-slate-900 dark:text-white">{title}</h2>
            {description && <div id={descriptionId} className="mt-1 text-sm text-slate-600 dark:text-slate-300">{description}</div>}
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Band karein"
              className="-mr-1 -mt-1 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X size={18} />
            </button>
          )}
        </div>
        {children && <div className="px-5 pt-4">{children}</div>}
        {footer && <div className="flex flex-col-reverse gap-2 px-5 pb-5 pt-5 sm:flex-row sm:justify-end">{footer}</div>}
        {!footer && <div className="pb-5" />}
      </div>
    </div>,
    document.body,
  );
};
