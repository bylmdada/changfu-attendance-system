'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';

// Toast 類型定義
export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  showToast: (type: ToastType, message: string, duration?: number) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// Toast 圖標配置
const TOAST_CONFIG = {
  success: {
    icon: CheckCircle,
    bgColor: 'bg-green-50',
    borderColor: 'border-green-500',
    textColor: 'text-green-800',
    iconColor: 'text-green-500'
  },
  error: {
    icon: XCircle,
    bgColor: 'bg-red-50',
    borderColor: 'border-red-500',
    textColor: 'text-red-800',
    iconColor: 'text-red-500'
  },
  warning: {
    icon: AlertCircle,
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-500',
    textColor: 'text-yellow-800',
    iconColor: 'text-yellow-500'
  },
  info: {
    icon: Info,
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-500',
    textColor: 'text-blue-800',
    iconColor: 'text-blue-500'
  }
};

// Toast 顯示元件
function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: () => void }) {
  const config = TOAST_CONFIG[toast.type];
  const Icon = config.icon;

  React.useEffect(() => {
    const timer = setTimeout(() => {
      onRemove();
    }, toast.duration || 3000);

    return () => clearTimeout(timer);
  }, [toast.duration, onRemove]);

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border-l-4 ${config.bgColor} ${config.borderColor} ${config.textColor} animate-slide-in-right`}
      role="alert"
    >
      <Icon className={`w-5 h-5 ${config.iconColor} flex-shrink-0`} />
      <p className="flex-1 text-sm font-medium">{toast.message}</p>
      <button
        onClick={onRemove}
        className="flex-shrink-0 p-1 rounded-full hover:bg-black/10 transition-colors"
        aria-label="關閉"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

// Toast 容器元件
export function ToastContainer() {
  const context = useContext(ToastContext);
  
  if (!context) {
    return null;
  }

  const { toasts, removeToast } = context;

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-md">
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onRemove={() => removeToast(toast.id)}
        />
      ))}
    </div>
  );
}

// Toast Provider
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((type: ToastType, message: string, duration = 3000) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newToast: Toast = { id, type, message, duration };
    
    setToasts((prev) => [...prev, newToast]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, showToast, removeToast }}>
      {children}
      <ToastContainer />
    </ToastContext.Provider>
  );
}

// Toast Hook - 必須在 ToastProvider 內使用
export function useToast() {
  const context = useContext(ToastContext);
  
  if (!context) {
    throw new Error('useToast 必須在 ToastProvider 內使用');
  }
  
  return {
    showToast: context.showToast,
    removeToast: context.removeToast
  };
}

// 獨立 Toast Hook - 適用於不使用 Provider 的頁面
export function useLocalToast() {
  const [toast, setToast] = useState<{ type: ToastType; message: string } | null>(null);
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  
  const showToast = useCallback((type: ToastType, message: string, duration = 5000) => {
    // 清除之前的 timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setToast({ type, message });
    timeoutRef.current = setTimeout(() => setToast(null), duration);
  }, []);

  const clearToast = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setToast(null);
  }, []);

  return { 
    showToast,
    toast,
    setToast,
    clearToast
  };
}

// 簡單 Toast 元件（適用於不使用 Provider 的頁面）
export function SimpleToast({ 
  toast, 
  onClose 
}: { 
  toast: { type: ToastType; message: string } | null;
  onClose: () => void;
}) {
  if (!toast) return null;

  const config = TOAST_CONFIG[toast.type];
  const Icon = config.icon;

  return (
    <div className="fixed top-20 right-4 z-[9999] min-w-[320px] max-w-lg animate-slide-in-right">
      <div
        className={`flex items-start gap-4 px-5 py-4 rounded-xl shadow-2xl border-l-4 ${config.bgColor} ${config.borderColor} ${config.textColor} ring-1 ring-black/5`}
        role="alert"
      >
        <Icon className={`w-6 h-6 ${config.iconColor} flex-shrink-0 mt-0.5`} />
        <p className="flex-1 text-base font-medium leading-relaxed whitespace-pre-wrap">{toast.message}</p>
        <button
          onClick={onClose}
          className="flex-shrink-0 p-1.5 rounded-full hover:bg-black/10 transition-colors"
          aria-label="關閉"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

export default ToastProvider;
