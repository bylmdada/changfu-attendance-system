'use client';

import { useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';

interface PromptDialogProps {
  open: boolean;
  title: string;
  message?: string;
  label?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  initialValue?: string;
  required?: boolean;
  loading?: boolean;
  tone?: 'default' | 'danger';
  onConfirm: (value: string) => void | Promise<void>;
  onCancel: () => void;
}

export default function PromptDialog({
  open,
  title,
  message,
  label = '原因',
  placeholder = '請輸入原因',
  confirmLabel = '確認',
  cancelLabel = '取消',
  initialValue = '',
  required = true,
  loading = false,
  tone = 'default',
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) setValue(initialValue);
  }, [initialValue, open]);

  if (!open) return null;

  const canConfirm = !loading && (!required || value.trim().length > 0);
  const isDanger = tone === 'danger';

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-dialog-title"
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 rounded-full p-2 ${isDanger ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
            <FileText className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="prompt-dialog-title" className="text-lg font-semibold text-gray-900">
              {title}
            </h2>
            {message && (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-600">
                {message}
              </p>
            )}
          </div>
        </div>

        <div className="mt-5">
          <label className="block text-sm font-medium text-gray-700">
            {label}{required && <span className="ml-1 text-red-600">*</span>}
          </label>
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="mt-2 min-h-28 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            placeholder={placeholder}
            disabled={loading}
            autoFocus
          />
          {required && value.trim().length === 0 && (
            <p className="mt-2 text-xs text-gray-500">請填寫原因後再送出。</p>
          )}
        </div>

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
              if (canConfirm) void onConfirm(value.trim());
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
