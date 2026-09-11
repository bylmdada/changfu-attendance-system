'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Download } from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import { STATUS_UI, fmtDate, type DisplayStatus } from '@/lib/property-status-ui';
import { propertyAuditStatusLabel } from '@/lib/property-audit-status';

interface Detail {
  asset: {
    id: number;
    assetCode: string;
    name: string;
    location: string | null;
    managerName: string | null;
    maintenanceFrequency: string | null;
    acquiredDate: string | null;
    nextMaintenanceDate: string | null;
    site?: { name: string };
  };
  history: {
    recordId: string;
    dueDate: string | null;
    completedDate: string | null;
    status: string;
    displayStatus: DisplayStatus;
    maintainerRaw: string | null;
    inventoryResult: string | null;
    auditStatus: string | null;
    photoPath: string | null;
  }[];
}

export default function AssetDetailPage() {
  const params = useParams();
  const id = String(params.id ?? '');
  const [data, setData] = useState<Detail | null>(null);
  const [qr, setQr] = useState<{ loading: boolean; dataUrl?: string; error?: string }>({ loading: false });
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/property-maintenance/assets/${id}`, { credentials: 'include' });
        const json = await res.json();
        if (cancelled) return;
        if (res.ok) setData(json.data);
        else setErr(json.error || '載入失敗');
      } catch {
        if (!cancelled) setErr('載入失敗');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const toggleQr = async () => {
    if (qr.loading) return;
    if (qr.dataUrl) {
      setQr({ loading: false });
      return;
    }
    setQr({ loading: true });
    try {
      const res = await fetch(`/api/property-maintenance/assets/${id}/qr`, { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setQr({ loading: false, dataUrl: json.data.dataUrl });
      } else {
        setQr({ loading: false, error: json.error || 'QR 載入失敗' });
      }
    } catch {
      setQr({ loading: false, error: 'QR 載入失敗' });
    }
  };

  const historyExportHref = (format: 'csv' | 'xlsx') =>
    `/api/property-maintenance/reports/history?assetId=${encodeURIComponent(id)}&format=${format}`;
  const inventoryResultLabel = (value: string | null) => value?.replace(/帳物/g, '財產') || '—';

  if (err)
    return (
      <AuthenticatedLayout backUrl="/property-management/assets" backLabel="返回清冊">
        <div className="max-w-3xl mx-auto p-6 text-red-600">{err}</div>
      </AuthenticatedLayout>
    );

  return (
    <AuthenticatedLayout backUrl="/property-management/assets" backLabel="返回清冊">
      <div className="max-w-3xl mx-auto p-4 sm:p-6">
        {!data ? (
          <div className="p-8 text-center text-gray-600">載入中…</div>
        ) : (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4 flex gap-5">
              <div className="flex-1">
                <h1 className="text-2xl font-bold text-gray-900">
                  {data.asset.assetCode}
                </h1>
                <p className="text-lg text-gray-700">{data.asset.name}</p>
                <div className="mt-3 text-sm text-gray-600 space-y-1">
                  <p>據點：{data.asset.site?.name}</p>
                  <p>放置地點：{data.asset.location || '—'}</p>
                  <p>管理人：{data.asset.managerName || '—'}</p>
                  <p>維護頻率：{data.asset.maintenanceFrequency || '—'}</p>
                  <p>取得日期：{fmtDate(data.asset.acquiredDate)}</p>
                  <p>下次應維護：{fmtDate(data.asset.nextMaintenanceDate)}</p>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <a
                    href={historyExportHref('xlsx')}
                    className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
                  >
                    <Download className="h-4 w-4" /> 匯出單項維護歷程 .xlsx
                  </a>
                  <a
                    href={historyExportHref('csv')}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
                  >
                    <Download className="h-4 w-4" /> 匯出單項維護歷程 .csv
                  </a>
                </div>
              </div>
              <div className="text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/property-maintenance/assets/${data.asset.id}/barcode`}
                  alt={`CODE_128 財產條碼 ${data.asset.assetCode}`}
                  className="h-16 w-64 object-contain rounded border border-gray-200 bg-white"
                />
                <p className="mt-1 text-xs font-medium text-gray-900">CODE_128 一維條碼</p>
                <button
                  type="button"
                  onClick={toggleQr}
                  disabled={qr.loading}
                  className="mt-2 text-xs font-medium text-gray-900 underline underline-offset-2 hover:text-blue-700 disabled:no-underline disabled:opacity-70"
                >
                  {qr.loading ? 'QR Code 載入中' : qr.dataUrl ? '隱藏 QR Code' : '顯示 QR Code'}
                </button>
                {qr.loading && <p className="mt-1 text-xs text-gray-900">QR 載入中…</p>}
                {qr.error && <p className="mt-1 text-xs text-red-700">{qr.error}</p>}
                {qr.dataUrl && (
                  <div className="mt-2 inline-block rounded border border-gray-200 bg-white p-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qr.dataUrl} alt="QR" className="w-32 h-32" />
                    <p className="text-xs text-gray-900 mt-1">{data.asset.assetCode}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200">
              <div className="px-5 py-3 border-b font-semibold text-gray-900">
                維護歷程（{data.history.length}）
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-3 py-2 text-left">應維護</th>
                      <th className="px-3 py-2 text-left">完成</th>
                      <th className="px-3 py-2 text-left">狀態</th>
                      <th className="px-3 py-2 text-left">維護人員</th>
                      <th className="px-3 py-2 text-left">盤點</th>
                      <th className="px-3 py-2 text-left">稽核</th>
                      <th className="px-3 py-2 text-left">附件</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.history.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-8 text-center text-gray-600">
                          目前沒有維護歷程
                        </td>
                      </tr>
                    ) : data.history.map((h) => {
                      const s = STATUS_UI[h.displayStatus] ?? STATUS_UI.PENDING;
                      return (
                        <tr key={h.recordId}>
                          <td className="px-3 py-2">{fmtDate(h.dueDate)}</td>
                          <td className="px-3 py-2">{fmtDate(h.completedDate)}</td>
                          <td className="px-3 py-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${s.badge}`}>
                              {s.label}
                            </span>
                          </td>
                          <td className="px-3 py-2">{h.maintainerRaw || '—'}</td>
                          <td className="px-3 py-2">{inventoryResultLabel(h.inventoryResult)}</td>
                          <td className="px-3 py-2">{propertyAuditStatusLabel(h.auditStatus)}</td>
                          <td className="px-3 py-2">
                            {h.photoPath ? (
                              <a
                                href={`/api/property-maintenance/records/${encodeURIComponent(
                                  h.recordId
                                )}/attachment?field=photo`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                照片
                              </a>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </AuthenticatedLayout>
  );
}
