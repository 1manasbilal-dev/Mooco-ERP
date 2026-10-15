
import React from 'react';
import { useToast, useToastNotifications, ToastType } from '../context/ToastContext';
import { CheckCircle, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

const toastStyles: Record<ToastType, string> = {
  success: 'border-l-4 border-lime-500 bg-white text-slate-800',
  error: 'border-l-4 border-red-500 bg-white text-slate-800',
  info: 'border-l-4 border-blue-500 bg-white text-slate-800',
  warning: 'border-l-4 border-amber-500 bg-white text-slate-800',
};

const toastIcons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={20} className="text-lime-500" />,
  error: <AlertCircle size={20} className="text-red-500" />,
  info: <Info size={20} className="text-blue-500" />,
  warning: <AlertTriangle size={20} className="text-amber-500" />,
};

const ToastContainer: React.FC = () => {
  const { removeToast } = useToast();
  const toasts = useToastNotifications();

  return (
    <div className="mooco-toast-stack fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none" aria-label="Notifications">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === 'error' || toast.type === 'warning' ? 'alert' : 'status'}
            className={`mooco-toast pointer-events-auto p-4 rounded-2xl shadow-lg flex items-start gap-3 ${toastStyles[toast.type]}`}
          >
            <div className="mt-0.5 shrink-0">{toastIcons[toast.type]}</div>
            <div className="flex-1">
              <p className="text-sm font-medium leading-tight">{toast.message}</p>
            </div>
            <button 
              type="button" aria-label="Dismiss notification"
              onClick={() => removeToast(toast.id)}
              className="text-slate-400 hover:text-slate-600 shrink-0"
            >
              <X size={16} />
            </button>
          </div>
        ))}
    </div>
  );
};

export default ToastContainer;
