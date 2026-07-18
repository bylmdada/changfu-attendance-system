'use client';

import { useEffect, useState } from 'react';
import { FileSpreadsheet, Download, Loader2 } from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import fetchWithCSRF from '@/lib/fetchWithCSRF';
import { useLocalToast, SimpleToast } from '@/components/Toast';

interface Site {
  id: number;
  name: string;
}

export default function ReportsPage() {
  const { showToast, toast, clearToast } = useLocalToast();
  const now = new Date();
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [assetCode, setAssetCode] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/property-maintenance/sites', { credentials: 'include' });
      const json = await res.json();
      if (res.ok && json.data.length) {
        setSites(json.data);
        setSiteId(json.data[0].id);
      }
    })();
  }, []);

  const downloadGet = (url: string, label: string) => {
    if (siteId === null) return;
    setBusy(label);
    // 透過隱藏連結觸發下載（GET，帶 cookie）
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => setBusy(''), 1200);
  };

  const downloadBatch = async () => {
    if (siteId === null) return;
    setBusy('batch');
    try {
      const res = await fetchWithCSRF('/api/property-maintenance/reports/evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        showToast('error', j.error || '產生失敗');
        return;
      }
      const blob = await res.blob();
      const dispo = res.headers.get('Content-Disposition') || '';
      const m = dispo.match(/filename\*=UTF-8''([^;]+)/);
      const fname = m ? decodeURIComponent(m[1]) : 'evidence_batch.xlsx';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast('success', '批次佐證已下載');
    } finally {
      setBusy('');
    }
  };

  const base = (path: string) =>
    `/api/property-maintenance/reports/${path}?siteId=${siteId}&year=${year}&month=${month}`;

  return (
    <AuthenticatedLayout backUrl="/property-management" backLabel="返回首頁">
      <div className="max-w-2xl mx-auto p-4 sm:p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
          <FileSpreadsheet className="w-6 h-6 text-blue-600" /> 維護報表
        </h1>

        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 grid grid-cols-3 gap-3">
          <div className="col-span-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">據點</label>
            <select
              value={siteId ?? ''}
              onChange={(e) => setSiteId(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">年</label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">月</label>
            <input
              type="number"
              min={1}
              max={12}
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 space-y-3">
          <h2 className="font-semibold text-gray-900">月份報表</h2>
          <div className="flex gap-2">
            <button
              onClick={() => downloadGet(base('monthly'), 'monthly')}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              {busy === 'monthly' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
              每月維護報表
            </button>
            <button
              onClick={() => downloadGet(base('summary'), 'summary')}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              {busy === 'summary' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
              評鑑總表
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h2 className="font-semibold text-gray-900">評鑑佐證報表</h2>
          <div className="flex gap-2">
            <input
              value={assetCode}
              onChange={(e) => setAssetCode(e.target.value)}
              placeholder="財產編號（單一佐證）"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            />
            <button
              disabled={!assetCode.trim()}
              onClick={() =>
                downloadGet(
                  `/api/property-maintenance/reports/evidence?siteId=${siteId}&assetCode=${encodeURIComponent(
                    assetCode.trim()
                  )}`,
                  'ev1'
                )
              }
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              單一佐證
            </button>
          </div>
          <button
            onClick={downloadBatch}
            disabled={busy === 'batch'}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-green-700 text-white rounded-lg hover:bg-green-800 disabled:opacity-50"
          >
            {busy === 'batch' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
            批次產生全部輔具佐證
          </button>
        </div>
      </div>
      <SimpleToast toast={toast} onClose={clearToast} />
    </AuthenticatedLayout>
  );
}
