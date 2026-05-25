'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import fetchWithCSRF from '@/lib/fetchWithCSRF';
import { useLocalToast, SimpleToast } from '@/components/Toast';

const PropertyTrendChart = dynamic(() => import('./PropertyTrendChart'), {
  ssr: false,
  loading: () => <div className="py-10 text-center text-sm text-gray-600">圖表載入中…</div>,
});

interface Site {
  id: number;
  name: string;
}
interface Stats {
  summary: {
    total: number;
    done: number;
    pending: number;
    overdue: number;
    abnormal: number;
    completionRate: number;
    overdueRate: number;
    pendingRate: number;
  };
  trend: { ym: string; due: number; done: number }[];
}
interface SpotResult {
  assetCode: string;
  name: string;
  ok: boolean;
  records: number;
  error?: string;
}

export default function StatsPage() {
  const { showToast, toast, clearToast } = useLocalToast();
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [spotBusy, setSpotBusy] = useState(false);
  const [spot, setSpot] = useState<{ allOk: boolean; results: SpotResult[] } | null>(null);

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

  const loadStats = useCallback(async () => {
    if (siteId === null) return;
    const res = await fetch(`/api/property-maintenance/stats?siteId=${siteId}&months=6`, {
      credentials: 'include',
    });
    const json = await res.json();
    if (res.ok) setStats(json.data);
  }, [siteId]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const runSpotCheck = async () => {
    if (siteId === null) return;
    setSpotBusy(true);
    setSpot(null);
    try {
      const res = await fetchWithCSRF('/api/property-maintenance/spot-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, count: 3 }),
      });
      const json = await res.json();
      if (res.ok) {
        setSpot(json.data);
        showToast(json.data.allOk ? 'success' : 'error', json.message);
      } else {
        showToast('error', json.error || '抽查失敗');
      }
    } finally {
      setSpotBusy(false);
    }
  };

  const s = stats?.summary;
  const cards = s
    ? [
        { label: '完成率', value: `${s.completionRate}%`, cls: 'text-green-700 bg-green-50 border-green-200' },
        { label: '逾期率', value: `${s.overdueRate}%`, cls: 'text-red-700 bg-red-50 border-red-200' },
        { label: '未完成率', value: `${s.pendingRate}%`, cls: 'text-orange-700 bg-orange-50 border-orange-200' },
        { label: '總任務數', value: s.total, cls: 'text-gray-700 bg-gray-50 border-gray-200' },
      ]
    : [];

  return (
    <AuthenticatedLayout backUrl="/property-management" backLabel="返回首頁">
      <div className="max-w-3xl mx-auto p-4 sm:p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">維護統計</h1>

        <select
          value={siteId ?? ''}
          onChange={(e) => setSiteId(Number(e.target.value))}
          className="mb-4 w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900"
        >
          {sites.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {cards.map((c) => (
            <div key={c.label} className={`rounded-xl border p-4 ${c.cls}`}>
              <p className="text-sm opacity-80">{c.label}</p>
              <p className="text-2xl font-bold mt-1">{c.value}</p>
            </div>
          ))}
        </div>

        {stats && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5">
            <h2 className="font-semibold text-gray-900 mb-3">近 6 個月：應維護 vs 已完成</h2>
            <PropertyTrendChart trend={stats.trend} />
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-blue-600" /> 每月抽查（佐證可產生性）
            </h2>
            <button
              onClick={runSpotCheck}
              disabled={spotBusy}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {spotBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />}
              隨機抽查 3 筆
            </button>
          </div>
          <p className="text-xs text-gray-600 mb-3">
            隨機抽 3 筆資產，確認佐證報表可持續產生，結果寫入稽核日誌供評鑑查核（§24）。
          </p>
          {spot && (
            <ul className="divide-y divide-gray-100 text-sm">
              {spot.results.map((r) => (
                <li key={r.assetCode} className="flex items-center justify-between py-2">
                  <span>
                    {r.assetCode}　{r.name}（{r.records} 筆紀錄）
                  </span>
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      r.ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {r.ok ? '可產生 ✓' : `失敗 ${r.error ?? ''}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <SimpleToast toast={toast} onClose={clearToast} />
    </AuthenticatedLayout>
  );
}
