import React, { useEffect, useId, useRef } from 'react';
import { ClipboardCheck, X } from 'lucide-react';
import { IconButton } from '../ui';
import { cn } from '../../lib/cn';

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

export interface OrderDialogProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Extra header buttons, left of the close button. */
  actions?: React.ReactNode;
  /** Sticky footer, so the main action stays reachable on phones. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  /** Blocks Esc, backdrop and the close button while something is saving. */
  busy?: boolean;
  size?: 'md' | 'lg';
  /** `body`: focus the first field (forms). `panel`: focus the dialog itself so a long view opens at the top. */
  initialFocus?: 'body' | 'panel';
}

/**
 * Shell for the order form and order detail. Wider than the shared Modal (max-w-3xl) and keeps
 * its footer outside the scroll area. Sits at z-[70]; confirmAction dialogs open above it.
 */
export function OrderDialog({
  title, description, actions, footer, children, onClose, busy = false, size = 'lg', initialFocus = 'panel',
}: OrderDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const field = initialFocus === 'body'
      ? bodyRef.current?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled), select:not(:disabled), textarea:not(:disabled)')
      : null;
    if (field) field.focus();
    else panelRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [initialFocus]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      // Esc belongs to the dialog even while it is saving, never to page shortcuts behind it.
      event.stopPropagation();
      if (!busy) onClose();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const nodes = (Array.from(panelRef.current.querySelectorAll(FOCUSABLE)) as HTMLElement[]).filter(node => node.getClientRects().length > 0);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-2 animate-in fade-in duration-150 sm:p-6"
      onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-card border border-line bg-surface shadow-e3 outline-none animate-in zoom-in-95 duration-150',
          size === 'lg' ? 'max-w-3xl' : 'max-w-2xl',
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-brand-soft text-brand-fg" aria-hidden="true">
              <ClipboardCheck size={20} />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="truncate text-base font-bold tracking-tight text-fg sm:text-lg">{title}</h2>
              {description && <p className="mt-0.5 truncate text-xs text-fg-subtle">{description}</p>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            <IconButton aria-label="Close order dialog" icon={<X />} disabled={busy} onClick={onClose} />
          </div>
        </div>
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">{children}</div>
        {footer && <div className="shrink-0 border-t border-line bg-surface-2/60 px-4 py-3 sm:px-6">{footer}</div>}
      </div>
    </div>
  );
}
