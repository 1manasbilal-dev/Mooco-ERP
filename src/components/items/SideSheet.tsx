import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface SideSheetProps {
  onClose: () => void;
  /** id of the heading inside, for the dialog's accessible name. */
  labelledBy?: string;
  label?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Right-hand panel for product details and the product form. Esc and the backdrop call `onClose`
 * (the form uses that to ask about unsaved changes). Keys pressed inside a Modal opened on top never
 * reach it, because Modal stops them.
 */
export function SideSheet({ onClose, labelledBy, label, children, className }: SideSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Read during render, before an autoFocus field inside can move focus.
  const [previouslyFocused] = useState(() => document.activeElement as HTMLElement | null);

  useEffect(() => {
    // Leave focus alone when a field inside already took it (autoFocus).
    const timer = window.setTimeout(() => {
      if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus({ preventScroll: true });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus({ preventScroll: true });
    };
  }, [previouslyFocused]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const focusable = (Array.from(panelRef.current.querySelectorAll(FOCUSABLE)) as HTMLElement[]).filter(el => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex justify-end" onKeyDown={onKeyDown}>
      <div
        className="absolute inset-0 bg-slate-950/45 animate-in fade-in duration-200 motion-reduce:animate-none"
        aria-hidden="true"
        onClick={() => onCloseRef.current()}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        tabIndex={-1}
        className={cn(
          'relative flex h-full w-full max-w-xl flex-col border-l border-line bg-surface text-fg shadow-e3 outline-none',
          'animate-in slide-in-from-right-8 fade-in duration-200 ease-out motion-reduce:animate-none',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
