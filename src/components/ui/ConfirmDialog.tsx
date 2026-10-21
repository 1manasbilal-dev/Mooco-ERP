import React, { useRef, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, Info, Trash2 } from 'lucide-react';
import { Modal } from './Modal';

export type ConfirmTone = 'danger' | 'warning' | 'info';

export interface ConfirmOptions {
  title: React.ReactNode;
  /** One or two plain sentences on what is about to happen. */
  message?: React.ReactNode;
  /** What will change if the user goes ahead, one item per line. */
  consequences?: React.ReactNode[];
  confirmLabel?: string;
  /** Pass null for a single-button notice. */
  cancelLabel?: string | null;
  tone?: ConfirmTone;
}

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

const TONE = {
  danger: {
    icon: <Trash2 size={20} />,
    iconClass: 'bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400',
    buttonClass: 'bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-500 text-white',
    defaultLabel: 'Haan, delete karein',
  },
  warning: {
    icon: <AlertTriangle size={20} />,
    iconClass: 'bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400',
    buttonClass: 'bg-amber-600 hover:bg-amber-700 focus-visible:ring-amber-500 text-white',
    defaultLabel: 'Haan, aage barhein',
  },
  info: {
    icon: <Info size={20} />,
    iconClass: 'bg-sky-100 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400',
    buttonClass: 'bg-slate-900 hover:bg-slate-800 focus-visible:ring-slate-500 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white',
    defaultLabel: 'Theek hai',
  },
} as const;

/** Confirmation dialog with a consequences list and a clearly marked danger button. */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open, title, message, consequences, confirmLabel, cancelLabel = 'Wapas jayen', tone = 'danger', onConfirm, onCancel, busy = false,
}) => {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const style = TONE[tone];
  const hasCancel = cancelLabel !== null;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      role="alertdialog"
      size="sm"
      title={title}
      description={message}
      dismissible={!busy}
      // Risky actions start on the safe button, so a stray Enter never deletes anything.
      initialFocusRef={hasCancel && tone !== 'info' ? cancelRef : confirmRef}
      icon={<div className={`flex h-10 w-10 items-center justify-center rounded-xl ${style.iconClass}`}>{style.icon}</div>}
      footer={<>
        {hasCancel && (
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {cancelLabel}
          </button>
        )}
        <button
          ref={confirmRef}
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={`rounded-xl px-4 py-2.5 text-sm font-bold shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60 dark:focus-visible:ring-offset-slate-900 ${style.buttonClass}`}
        >
          {busy ? 'Ho raha hai…' : (confirmLabel || style.defaultLabel)}
        </button>
      </>}
    >
      {consequences && consequences.length > 0 && (
        <ul className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
          {consequences.map((line, index) => (
            <li key={index} className="flex gap-2">
              <span aria-hidden="true" className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${tone === 'danger' ? 'bg-rose-500' : tone === 'warning' ? 'bg-amber-500' : 'bg-sky-500'}`} />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
};

// Promise-based API: `if (!(await confirmAction({...}))) return;`
// A drop-in replacement for window.confirm that needs no provider or state.

interface PendingConfirm { id: number; options: ConfirmOptions; resolve: (value: boolean) => void }

let nextId = 1;

let queue: PendingConfirm[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getCurrent = () => queue[0] ?? null;

const settle = (value: boolean) => {
  const [current, ...rest] = queue;
  if (!current) return;
  queue = rest;
  emit();
  current.resolve(value);
};

const ConfirmHost: React.FC = () => {
  const current = useSyncExternalStore(subscribe, getCurrent, getCurrent);
  if (!current) return null;
  return (
    <ConfirmDialog
      key={current.id}
      open
      {...current.options}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
};

let hostMounted = false;
const ensureHost = () => {
  if (hostMounted || typeof document === 'undefined') return;
  hostMounted = true;
  const container = document.createElement('div');
  container.setAttribute('data-confirm-host', '');
  document.body.appendChild(container);
  createRoot(container).render(<ConfirmHost />);
};

/**
 * Opens the shared confirmation dialog and resolves true when the user confirms.
 * window.confirm blocked the page, so a double click could never ask twice. To keep
 * that guarantee, a second request while a dialog is already open resolves false.
 */
export const confirmAction = (options: ConfirmOptions): Promise<boolean> => {
  ensureHost();
  if (queue.length > 0) return Promise.resolve(false);
  return new Promise(resolve => {
    queue = [...queue, { id: nextId++, options, resolve }];
    emit();
  });
};

/** True while any shared dialog is open; lets capture-phase Esc handlers stand aside. */
export const isConfirmOpen = () => queue.length > 0;
