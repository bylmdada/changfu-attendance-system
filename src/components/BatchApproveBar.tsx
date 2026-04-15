'use client';

import { useState } from 'react';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';

interface BatchApproveBarProps {
  selectedIds: number[];
  apiEndpoint: string;
  onSuccess: () => void;
  onClear: () => void;
  onSelectionChange?: (ids: number[]) => void;
  itemName?: string;
  requireRejectReason?: boolean;
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
}: BatchApproveBarProps) {
  const [loading, setLoading] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [showRemarks, setShowRemarks] = useState(false);

  if (selectedIds.length === 0) {
    return null;
  }

  const handleBatchAction = async (action: 'APPROVED' | 'REJECTED') => {
    if (loading) return;
    
    if (action === 'REJECTED' && requireRejectReason && !remarks.trim()) {
      setShowRemarks(true);
      return;
    }

    setLoading(true);
    try {
      const response = await fetchJSONWithCSRF(apiEndpoint, {
        method: 'POST',
        body: { 
          ids: selectedIds, 
          action,
          reason: action === 'REJECTED' && requireRejectReason ? remarks : undefined,
          remarks: action === 'REJECTED' && requireRejectReason ? remarks : undefined,
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
              : selectedIds.length - failedIds.length;
        const successCount = Math.max(0, rawSuccessCount);

        if (successCount === 0) {
          alert(data.error || '批次操作失敗');
          return;
        }

        alert(data.message || `已${action === 'APPROVED' ? '批准' : '拒絕'} ${successCount} 筆${itemName}`);
        setRemarks('');
        setShowRemarks(false);
        onSuccess();

        if (failedIds.length > 0 && onSelectionChange) {
          onSelectionChange(failedIds);
        } else {
          onClear();
        }
      } else {
        const error = await response.json();
        alert(error.error || '操作失敗');
      }
    } catch (error) {
      console.error('批次審核失敗:', error);
      alert('操作失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg z-50">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
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
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="請輸入拒絕原因..."
                className="px-3 py-2 border rounded-lg w-64 text-sm"
                autoFocus
              />
              <button
                onClick={() => handleBatchAction('REJECTED')}
                disabled={loading || !remarks.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                確認拒絕
              </button>
              <button
                onClick={() => setShowRemarks(false)}
                className="px-3 py-2 text-gray-600 hover:text-gray-800"
              >
                取消
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleBatchAction('APPROVED')}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                批次批准
              </button>
              <button
                onClick={() => requireRejectReason ? setShowRemarks(true) : handleBatchAction('REJECTED')}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" />
                批次拒絕
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
