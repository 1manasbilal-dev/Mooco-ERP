
import React, { createContext, useContext, useState, ReactNode } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);
const ToastListContext = createContext<Toast[] | undefined>(undefined);

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = React.useCallback((message: string, type: ToastType = 'success', duration?: number) => {
    const id = Math.random().toString(36).substr(2, 9);
    const defaultDuration = duration || (type === 'error' || type === 'warning' ? 2500 : 1400);
    const newToast: Toast = { id, message, type, duration: defaultDuration };
    
    // Keep max 3 toasts at a time
    setToasts((prev) => [...prev.slice(-2), newToast]);

    setTimeout(() => {
      removeToast(id);
    }, defaultDuration);
  }, [removeToast]);

  // App commands stay stable when only the notification list changes.
  const commands = React.useMemo(() => ({ showToast, removeToast }), [showToast, removeToast]);
  return (
    <ToastContext.Provider value={commands}>
      <ToastListContext.Provider value={toasts}>{children}</ToastListContext.Provider>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

export const useToastNotifications = () => {
  const toasts = useContext(ToastListContext);
  if (toasts === undefined) throw new Error('useToastNotifications must be used within a ToastProvider');
  return toasts;
};
