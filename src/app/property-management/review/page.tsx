'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import { useLocalToast, SimpleToast } from '@/components/Toast';
import { fmtDate } from '@/lib/property-status-ui';

interface Rec {
  recordId: string;
  assetCode: string;
  dueDate: string | null;
  completedDate: string | null;
  maintainerRaw: string | null;
  inventoryResult: string | null;
  assetCondition: string | null;
  maintenanceItem: string | null;
  maintainerEmployeeId: number | null;
  otherNote: string | null;
  photoPath: string | null;
  signaturePath: string | null;
  asset?: { name: string };
}

export default function ReviewPage() {
  const { showToast, toast, clearToast } = useLocalToast();
  const [rows, setRows] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejecting, setRejecting] = useState<Rec | null>(null);
  const [reason, setReason] = useState('');
  const [currentEmployeeId, setCurrentEmployeeId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [recordsRes, meRes] = await Promise.all([
        fetch(
          '/api/property-maintenance/records?audit=' +
            encodeURIComponent('待主管稽核') +
            '&pageSize=200',
          { credentials: 'include' }
        ),
        fetch('/api/auth/me', { credentials: 'include' }),
      ]);
      const recordsJson = await recordsRes.json();
      const meJson = await meRes.json().catch(() => ({}));
      if (meRes.ok) {
        setCurrentEmployeeId((meJson.user || meJson).employeeId ?? null);
      }
      if (recordsRes.ok) setRows(recordsJson.data.items);
      else showToast('error', recordsJson.error || '載入失敗');
    } catch {
      showToast('error', '載入失敗');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (rec: Rec, decision: 'APPROVE' | 'REJECT', rejectReason?: string) => {
    try {
      const res = await fetchJSONWithCSRF(
        `/api/property-maintenance/records/${encodeURIComponent(rec.recordId)}/audit`,
        { method: 'POST', body: { decision, rejectReason } }
      );
      const json = await res.json();
      if (res.ok) {
        showToast('success', json.message || '已處理');
        setRejecting(null);
        setReason('');
        load();
      } else {
        showToast('error', json.error || '處理失敗');
      }
    } catch {
      showToast('error', '處理失敗');
    }
  };

  return (
    <AuthenticatedLayout backUrl="/property-management" backLabel="返回首頁">
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">維護審核</h1>
        <p className="text-sm text-gray-600 mb-4">待主管稽核的已提交維護紀錄</p>

        <div className="bg-white rounded-xl border border-gray-200">
          {loading ? (
            <div className="p-8 text-center text-gray-600">載入中…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-gray-600">沒有待審核紀錄 🎉</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map((r) => {
                const isSelfSubmitted =
                  !!currentEmployeeId && r.maintainerEmployeeId === currentEmployeeId;
                return (
                <li key={r.recordId} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900">
                        {r.assetCode}　{r.asset?.name}
                      </p>
                      <p className="text-xs text-gray-600 mt-0.5">
                        維護人員 {r.maintainerRaw || '—'}・完成 {fmtDate(r.completedDate)}・應維護{' '}
                        {fmtDate(r.dueDate)}
                      </p>
                      <p className="text-xs text-gray-600 mt-1">
                        盤點：{r.inventoryResult || '—'}　財產狀態：{r.assetCondition || '—'}
                        項目：{r.maintenanceItem || '—'}
                      </p>
                      {r.otherNote && (
                        <p className="text-xs text-gray-600 mt-0.5">說明：{r.otherNote}</p>
                      )}
                      {isSelfSubmitted && (
                        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          此紀錄由你提交，須由其他主管/稽核人員審核。
                        </p>
                      )}
                      <div className="flex gap-3 mt-0.5">
                        {r.photoPath && (
                          <a
                            href={`/api/property-maintenance/records/${encodeURIComponent(
                              r.recordId
                            )}/attachment?field=photo`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-blue-600 hover:underline"
                          >
                            檢視維護照片
                          </a>
                        )}
                        {r.signaturePath && (
                          <a
                            href={`/api/property-maintenance/records/${encodeURIComponent(
                              r.recordId
                            )}/attachment?field=signature`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-blue-600 hover:underline"
                          >
                            檢視維護人簽章
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <button
                        onClick={() => decide(r, 'APPROVE')}
                        disabled={isSelfSubmitted}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Check className="w-4 h-4" /> 核准
                      </button>
                      <button
                        onClick={() => setRejecting(r)}
                        disabled={isSelfSubmitted}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <RotateCcw className="w-4 h-4" /> 退回
                      </button>
                    </div>
                  </div>
                </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {rejecting && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full">
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <h2 className="font-bold text-gray-900">退回補正</h2>
              <button
                onClick={() => setRejecting(null)}
                aria-label="關閉退回補正視窗"
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-gray-600">
                {rejecting.assetCode} {rejecting.asset?.name}
              </p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="請填寫不通過原因"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
              />
              <button
                onClick={() => reason.trim() && decide(rejecting, 'REJECT', reason.trim())}
                disabled={!reason.trim()}
                className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                確認退回
              </button>
            </div>
          </div>
        </div>
      )}
      <SimpleToast toast={toast} onClose={clearToast} />
    </AuthenticatedLayout>
  );
}
