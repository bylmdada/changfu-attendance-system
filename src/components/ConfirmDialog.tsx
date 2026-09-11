'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  loading?: boolean;
  confirmationText?: string;
  confirmationPlaceholder?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '確認',
  cancelLabel = '取消',
  tone = 'default',
  loading = false,
  confirmationText,
  confirmationPlaceholder = '請輸入確認文字',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    if (!open) setInputValue('');
  }, [open]);

  if (!open) return null;

  const requiresText = Boolean(confirmationText);
  const canConfirm = !loading && (!requiresText || inputValue === confirmationText);
  const isDanger = tone === 'danger';

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 rounded-full p-2 ${isDanger ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="confirm-dialog-title" className="text-lg font-semibold text-gray-900">
              {title}
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-600">
              {message}
            </p>
          </div>
        </div>

        {requiresText && (
          <div className="mt-5">
            <label className="block text-sm font-medium text-gray-700">
              請輸入 <span className="font-semibold text-gray-900">{confirmationText}</span>
            </label>
            <input
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-black placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-gray-100"
              placeholder={confirmationPlaceholder}
              disabled={loading}
              autoFocus
            />
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="min-h-11 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => {
              if (canConfirm) void onConfirm();
            }}
            disabled={!canConfirm}
            className={`min-h-11 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            <span className="inline-flex items-center justify-center gap-2">
              {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {loading ? '處理中...' : confirmLabel}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
