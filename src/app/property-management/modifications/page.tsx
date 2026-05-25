'use client';

import { useCallback, useEffect, useState } from 'react';
import { X, Plus, Check, RotateCcw } from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import { useLocalToast, SimpleToast } from '@/components/Toast';
import { fmtDate } from '@/lib/property-status-ui';

interface MR {
  id: number;
  requestCode: string;
  assetCode: string;
  field: string;
  fieldLabel: string;
  originalValue: string | null;
  proposedValue: string | null;
  reason: string | null;
  requesterName: string | null;
  requestedAt: string;
  reviewStatus: string;
  reviewNote: string | null;
  asset?: { name: string };
}

const FIELD_OPTS = [
  { v: 'name', t: '財產名稱' },
  { v: 'location', t: '放置地點' },
  { v: 'managerName', t: '財產管理人' },
  { v: 'maintenanceFrequency', t: '應維護頻率' },
  { v: 'nextMaintenanceDate', t: '應維護日期 (YYYY-MM-DD)' },
  { v: 'photoPath', t: '財產照片路徑' },
];
const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-800',
};

export default function ModificationsPage() {
  const { showToast, toast, clearToast } = useLocalToast();
  const [tab, setTab] = useState<'mine' | 'pending'>('mine');
  const [rows, setRows] = useState<MR[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ assetCode: '', field: 'name', proposedValue: '', reason: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = tab === 'mine' ? 'mine=1' : 'status=PENDING';
      const res = await fetch(`/api/property-maintenance/modification-requests?${qs}`, {
        credentials: 'include',
      });
      const json = await res.json();
      if (res.ok) setRows(json.data);
      else showToast('error', json.error || '載入失敗');
    } finally {
      setLoading(false);
    }
  }, [tab, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!form.assetCode.trim() || !form.proposedValue.trim()) {
      showToast('error', '請填寫財產編號與建議值');
      return;
    }
    const res = await fetchJSONWithCSRF('/api/property-maintenance/modification-requests', {
      method: 'POST',
      body: form,
    });
    const json = await res.json();
    if (res.ok) {
      showToast('success', json.message || '已送出');
      setShowForm(false);
      setForm({ assetCode: '', field: 'name', proposedValue: '', reason: '' });
      load();
    } else {
      showToast('error', json.error || '送出失敗');
    }
  };

  const review = async (id: number, decision: 'APPROVE' | 'REJECT') => {
    let reviewNote: string | null = null;
    if (decision === 'REJECT') {
      reviewNote = window.prompt('退回原因（可留空）') ?? '';
    }
    const res = await fetchJSONWithCSRF(
      `/api/property-maintenance/modification-requests/${id}`,
      { method: 'PUT', body: { decision, reviewNote } }
    );
    const json = await res.json();
    if (res.ok) {
      showToast('success', json.message || '已處理');
      load();
    } else {
      showToast('error', json.error || '處理失敗');
    }
  };

  return (
    <AuthenticatedLayout backUrl="/property-management" backLabel="返回首頁">
      <div className="max-w-4xl mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-gray-900">財產資料修改申請</h1>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" /> 新增申請
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          {[
            { k: 'mine', t: '我的申請' },
            { k: 'pending', t: '待審核' },
          ].map((x) => (
            <button
              key={x.k}
              onClick={() => setTab(x.k as typeof tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                tab === x.k
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-gray-300 text-gray-700'
              }`}
            >
              {x.t}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-gray-200">
          {loading ? (
            <div className="p-8 text-center text-gray-600">載入中…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-gray-600">沒有資料</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map((r) => (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900">
                        {r.assetCode}　{r.asset?.name}
                        <span className="text-sm text-blue-700">[{r.fieldLabel}]</span>
                      </p>
                      <p className="text-sm text-gray-600 mt-0.5">
                        「{r.originalValue || '—'}」→「{r.proposedValue || '—'}」
                      </p>
                      <p className="text-xs text-gray-600 mt-0.5">
                        申請人 {r.requesterName || '—'}・{fmtDate(r.requestedAt)}
                        {r.reason ? `・原因：${r.reason}` : ''}
                        {r.reviewNote ? `・審核註記：${r.reviewNote}` : ''}
                      </p>
                    </div>
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${
                        STATUS_BADGE[r.reviewStatus] ?? 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {r.reviewStatus === 'PENDING'
                        ? '待審核'
                        : r.reviewStatus === 'APPROVED'
                          ? '已核准'
                          : '已退回'}
                    </span>
                    {tab === 'pending' && r.reviewStatus === 'PENDING' && (
                      <div className="flex flex-col gap-1 shrink-0">
                        <button
                          onClick={() => review(r.id, 'APPROVE')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700"
                        >
                          <Check className="w-3.5 h-3.5" /> 核准
                        </button>
                        <button
                          onClick={() => review(r.id, 'REJECT')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> 退回
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full">
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <h2 className="font-bold text-gray-900">新增修改申請</h2>
                <button
                  onClick={() => setShowForm(false)}
                  aria-label="關閉修改申請表單"
                  className="text-gray-400 hover:text-gray-600"
                >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">財產編號</label>
                <input
                  value={form.assetCode}
                  onChange={(e) => setForm({ ...form, assetCode: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">修改欄位</label>
                <select
                  value={form.field}
                  onChange={(e) => setForm({ ...form, field: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
                >
                  {FIELD_OPTS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">建議修改為</label>
                <input
                  value={form.proposedValue}
                  onChange={(e) => setForm({ ...form, proposedValue: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">修改原因</label>
                <textarea
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                />
              </div>
              <button
                onClick={submit}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                送出申請
              </button>
            </div>
          </div>
        </div>
      )}
      <SimpleToast toast={toast} onClose={clearToast} />
    </AuthenticatedLayout>
  );
}
