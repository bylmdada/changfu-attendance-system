'use client';

import { useState } from 'react';
import { CheckCircle, XCircle, Loader2, AlertTriangle, X } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import { SimpleToast, useLocalToast } from '@/components/Toast';

export interface BatchApproveItemSummary {
  id: number;
  label: string;
  sublabel?: string;
}

interface BatchApproveBarProps {
  selectedIds: number[];
  apiEndpoint: string;
  onSuccess: () => void;
  onClear: () => void;
  onSelectionChange?: (ids: number[]) => void;
  itemName?: string;
  requireRejectReason?: boolean;
  itemSummaries?: BatchApproveItemSummary[];
  allowApproveNote?: boolean;
  extraBody?: Record<string, unknown>;
  disabledReason?: string;
}

function extractFailedIds(payload: unknown): number[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const data = payload as {
    failedIds?: unknown;
    errors?: unknown;
  };

  if (Array.isArray(data.failedIds)) {
    return data.failedIds
      .map((id) => (typeof id === 'number' && Number.isInteger(id) ? id : Number(id)))
      .filter((id): id is number => Number.isInteger(id) && id > 0);
  }

  if (!Array.isArray(data.errors)) {
    return [];
  }

  return data.errors
    .flatMap((error) => {
      if (typeof error !== 'string') {
        return [];
      }

      const match = error.match(/ID\s+(\d+):/i);
      return match ? [Number(match[1])] : [];
    })
    .filter((id) => Number.isInteger(id) && id > 0);
}

export default function BatchApproveBar({
  selectedIds,
  apiEndpoint,
  onSuccess,
  onClear,
  onSelectionChange,
  itemName = '申請',
  requireRejectReason = true,
  itemSummaries = [],
  allowApproveNote = false,
  extraBody,
  disabledReason,
}: BatchApproveBarProps) {
  const [loading, setLoading] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [approveNote, setApproveNote] = useState('');
  const [showRemarks, setShowRemarks] = useState(false);
  const [pendingAction, setPendingAction] = useState<'APPROVED' | 'REJECTED' | null>(null);
  const [pendingIds, setPendingIds] = useState<number[]>([]);
  const { toast, showToast, clearToast } = useLocalToast();

  if (selectedIds.length === 0) {
    return <SimpleToast toast={toast} onClose={clearToast} />;
  }

  const requestBatchAction = (action: 'APPROVED' | 'REJECTED') => {
    if (loading) return;

    if (disabledReason) {
      showToast('warning', disabledReason);
      return;
    }
    
    if (action === 'REJECTED' && requireRejectReason && !remarks.trim()) {
      setShowRemarks(true);
      showToast('warning', '請先輸入拒絕原因');
      return;
    }

    setPendingAction(action);
    setPendingIds(selectedIds);
  };

  const handleBatchAction = async (action: 'APPROVED' | 'REJECTED') => {
    if (loading) return;

    const actionIds = pendingAction ? pendingIds : selectedIds;
    if (actionIds.length === 0) {
      showToast('warning', '請至少保留 1 筆要處理的項目');
      return;
    }

    setLoading(true);
    try {
      const note = action === 'APPROVED' ? approveNote.trim() : remarks.trim();
      const response = await fetchJSONWithCSRF(apiEndpoint, {
        method: 'POST',
        body: { 
          ...(extraBody || {}),
          ids: actionIds, 
          action,
          reason: action === 'REJECTED' && note ? note : undefined,
          remarks: note || undefined,
          notes: note || undefined,
        }
      });

      if (response.ok) {
        const data = await response.json();
        const failedIds = extractFailedIds(data);
        const rawSuccessCount =
          typeof data.successCount === 'number'
            ? data.successCount
            : typeof data.count === 'number'
              ? data.count
              : actionIds.length - failedIds.length;
        const successCount = Math.max(0, rawSuccessCount);

        if (successCount === 0) {
          showToast('error', data.error || '批次操作失敗');
          return;
        }

        const message = data.message || `已${action === 'APPROVED' ? '批准' : '拒絕'} ${successCount} 筆${itemName}`;
        showToast(
          failedIds.length > 0 ? 'warning' : 'success',
          failedIds.length > 0 ? `${message}；${failedIds.length} 筆失敗已保留選取` : message,
          failedIds.length > 0 ? 5000 : 3000
        );
        setRemarks('');
        setApproveNote('');
        setShowRemarks(false);
        setPendingAction(null);
        setPendingIds([]);
        onSuccess();

        if (failedIds.length > 0 && onSelectionChange) {
          onSelectionChange(failedIds);
        } else {
          onClear();
        }
      } else {
        const error = await response.json();
        showToast('error', error.error || '操作失敗');
      }
    } catch (error) {
      console.error('批次審核失敗:', error);
      showToast('error', '操作失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  const summaryById = new Map(itemSummaries.map((item) => [item.id, item]));
  const activeIds = pendingAction ? pendingIds : selectedIds;
  const pendingSummaries = activeIds.map((id) => {
    return summaryById.get(id) ?? { id, label: `${itemName} #${id}` };
  });
  const hasSummaries = itemSummaries.length > 0;

  const removePendingId = (id: number) => {
    setPendingIds((current) => current.filter((selectedId) => selectedId !== id));
  };

  const closePendingDialog = () => {
    if (loading) return;
    setPendingAction(null);
    setPendingIds([]);
    setApproveNote('');
  };

  return (
    <>
      <SimpleToast toast={toast} onClose={clearToast} />
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-700">
                已選擇 <span className="text-blue-600 font-bold">{selectedIds.length}</span> 筆{itemName}
              </span>
              <button
                onClick={onClear}
                className="text-sm text-gray-500 hover:text-gray-700 underline"
              >
                取消選擇
              </button>
            </div>

          {showRemarks ? (
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                拒絕原因
              </div>
              <input
                type="text"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="請輸入拒絕原因..."
                className="min-h-11 w-full rounded-lg border px-3 py-2 text-sm sm:w-80"
                autoFocus
              />
              <button
                onClick={() => requestBatchAction('REJECTED')}
                disabled={loading || !remarks.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" />
                批次拒絕
              </button>
              <button
                onClick={() => {
                  setShowRemarks(false);
                  setPendingAction(null);
                }}
                className="px-3 py-2 text-gray-600 hover:text-gray-800"
              >
                取消
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={() => requestBatchAction('APPROVED')}
                disabled={loading || Boolean(disabledReason)}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                title={disabledReason}
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                批次批准
              </button>
              <button
                onClick={() => requireRejectReason ? setShowRemarks(true) : requestBatchAction('REJECTED')}
                disabled={loading || Boolean(disabledReason)}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                title={disabledReason}
              >
                <XCircle className="w-4 h-4" />
                批次拒絕
              </button>
            </div>
          )}
          </div>
          {disabledReason && (
            <p className="mt-2 text-sm text-amber-700">
              {disabledReason}
            </p>
          )}
        </div>
      </div>
      {pendingAction && (
        <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/50 px-4 py-4 sm:items-center sm:py-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="batch-approve-dialog-title"
            className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
              <div>
                <h2 id="batch-approve-dialog-title" className="text-lg font-semibold text-gray-900">
                  批次{pendingAction === 'APPROVED' ? '批准' : '拒絕'}{itemName}
                </h2>
                <p className="mt-1 text-sm text-gray-600">
                  將處理 {pendingSummaries.length} 筆{itemName}；送出前可再次確認或剔除誤選項目。
                </p>
              </div>
              <button
                type="button"
                onClick={closePendingDialog}
                disabled={loading}
                className="rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
                aria-label="關閉批次確認"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="rounded-lg border border-gray-200">
                <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3">
                  <span className="text-sm font-medium text-gray-700">本次處理項目</span>
                  <span className="text-sm text-gray-500">{pendingSummaries.length} 筆</span>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {pendingSummaries.length > 0 ? (
                    pendingSummaries.map((item) => (
                      <div key={item.id} className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-gray-900">{item.label}</p>
                          {item.sublabel && (
                            <p className="mt-1 truncate text-xs text-gray-500">{item.sublabel}</p>
                          )}
                          {!hasSummaries && (
                            <p className="mt-1 text-xs text-gray-500">未提供摘要資料，依 ID 顯示。</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removePendingId(item.id)}
                          disabled={loading}
                          className="min-h-9 shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                        >
                          剔除
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="px-4 py-8 text-center text-sm text-gray-500">
                      已無可處理項目，請返回重新選取。
                    </div>
                  )}
                </div>
              </div>

              {pendingAction === 'REJECTED' && remarks.trim() && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                  <p className="text-sm font-medium text-red-800">拒絕原因</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-red-700">{remarks.trim()}</p>
                </div>
              )}

              {pendingAction === 'APPROVED' && allowApproveNote && (
                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700">核准備註（選填）</label>
                  <textarea
                    value={approveNote}
                    onChange={(event) => setApproveNote(event.target.value)}
                    rows={3}
                    className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    placeholder="可補充本次批次核准備註"
                    disabled={loading}
                  />
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-gray-200 px-5 py-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closePendingDialog}
                disabled={loading}
                className="min-h-11 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleBatchAction(pendingAction)}
                disabled={loading || pendingSummaries.length === 0}
                className={`min-h-11 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  pendingAction === 'REJECTED' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                <span className="inline-flex items-center justify-center gap-2">
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {loading ? '處理中...' : `確認${pendingAction === 'APPROVED' ? '批准' : '拒絕'} ${pendingSummaries.length} 筆`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
