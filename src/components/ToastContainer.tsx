import React, { memo } from 'react';
import { useToast, useToastNotifications, ToastType } from '../context/ToastContext';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

const TOAST_ICON: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 size={18} />,
  error: <AlertCircle size={18} />,
  info: <Info size={18} />,
  warning: <AlertTriangle size={18} />,
};

const TOAST_TONE: Record<ToastType, string> = {
  success: 'bg-success-soft text-success-fg',
  error: 'bg-danger-soft text-danger-fg',
  info: 'bg-info-soft text-info-fg',
  warning: 'bg-warning-soft text-warning-fg',
};

const ToastContainer: React.FC = () => {
  const { removeToast } = useToast();
  const toasts = useToastNotifications();

  return (
    <div
      className="pointer-events-none fixed inset-x-3 top-[3.75rem] z-[220] flex flex-col items-center gap-2 print:hidden sm:inset-x-auto sm:right-4 sm:top-[4.5rem] sm:w-[360px] sm:items-stretch"
      aria-label="Notifications"
    >
      {toasts.map(toast => (
        <ToastItem key={toast.id} id={toast.id} type={toast.type} message={toast.message} onDismiss={removeToast} />
      ))}
    </div>
  );
};

const ToastItem = memo(({ id, type, message, onDismiss }: { id: string; type: ToastType; message: string; onDismiss: (id: string) => void }) => (
  <div
    role={type === 'error' || type === 'warning' ? 'alert' : 'status'}
    className="pointer-events-auto flex w-full max-w-[420px] items-start gap-3 rounded-control bg-surface p-3 pr-2 text-fg shadow-e2 ring-1 ring-inset ring-line animate-in fade-in slide-in-from-top-2 duration-200 sm:slide-in-from-top-0 sm:slide-in-from-right-4 motion-reduce:animate-none"
  >
    <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${TOAST_TONE[type]}`} aria-hidden="true">{TOAST_ICON[type]}</span>
    <p className="min-w-0 flex-1 self-center break-words text-[13px] font-medium leading-snug">{message}</p>
    <button
      type="button"
      aria-label="Dismiss notification"
      onClick={() => onDismiss(id)}
      className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <X size={15} />
    </button>
  </div>
));
ToastItem.displayName = 'ToastItem';

export default ToastContainer;
