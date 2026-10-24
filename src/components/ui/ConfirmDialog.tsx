import React, { useRef, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, Info, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { Button, type ButtonVariant } from './Button';

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

const TONE: Record<ConfirmTone, { icon: React.ReactNode; iconClass: string; dotClass: string; variant: ButtonVariant; buttonClass?: string; defaultLabel: string }> = {
  danger: {
    icon: <Trash2 />,
    iconClass: 'bg-danger-soft text-danger-fg ring-danger/20',
    dotClass: 'bg-danger',
    variant: 'danger',
    defaultLabel: 'Yes, delete',
  },
  warning: {
    icon: <AlertTriangle />,
    iconClass: 'bg-warning-soft text-warning-fg ring-warning/25',
    dotClass: 'bg-warning',
    variant: 'primary',
    buttonClass: 'bg-warning text-white hover:bg-warning/90',
    defaultLabel: 'Yes, continue',
  },
  info: {
    icon: <Info />,
    iconClass: 'bg-info-soft text-info-fg ring-info/20',
    dotClass: 'bg-info',
    variant: 'primary',
    defaultLabel: 'OK',
  },
};

/** Confirmation dialog with a consequences list and a clearly marked danger button. */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open, title, message, consequences, confirmLabel, cancelLabel = 'Go back', tone = 'danger', onConfirm, onCancel, busy = false,
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
      // Always above the dialog it was opened from.
      elevated
      title={title}
      description={message}
      dismissible={!busy}
      // Risky actions start on the safe button, so a stray Enter never deletes anything.
      initialFocusRef={hasCancel && tone !== 'info' ? cancelRef : confirmRef}
      icon={<div className={`flex size-10 items-center justify-center rounded-xl ring-1 ring-inset [&_svg]:size-5 ${style.iconClass}`}>{style.icon}</div>}
      footer={<>
        {hasCancel && (
          <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
        )}
        <Button ref={confirmRef} variant={style.variant} onClick={onConfirm} loading={busy} className={style.buttonClass}>
          {busy ? 'Working…' : (confirmLabel || style.defaultLabel)}
        </Button>
      </>}
    >
      {consequences && consequences.length > 0 && (
        <ul className="space-y-1.5 rounded-control bg-surface-2 p-3 text-sm text-fg-muted ring-1 ring-inset ring-line">
          {consequences.map((line, index) => (
            <li key={index} className="flex gap-2">
              <span aria-hidden="true" className={`mt-2 size-1.5 shrink-0 rounded-full ${style.dotClass}`} />
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
