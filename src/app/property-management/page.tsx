'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileText,
  Package,
  QrCode,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import { STATUS_UI, fmtDate, type DisplayStatus } from '@/lib/property-status-ui';

interface Task {
  recordId: string;
  assetCode: string;
  assetName: string;
  location: string;
  siteName: string;
  dueDate: string | null;
  maintainerRaw: string | null;
  displayStatus: DisplayStatus;
}

interface CurrentUser {
  canMaintainProperty?: boolean;
  isPropertySupervisor?: boolean;
  canManageProperty?: boolean;
}

export default function PropertyDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({ overdue: 0, today: 0, weekDone: 0 });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState('');
  const [currentUser, setCurrentUser] = useState<CurrentUser>({});
  const canMaintainProperty = !!currentUser.canMaintainProperty;
  const isPropertySupervisor = !!currentUser.isPropertySupervisor;
  const canManageProperty = !!currentUser.canManageProperty;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/property-maintenance/dashboard', { credentials: 'include' });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || '載入失敗');
        return;
      }
      setSummary(json.data.summary);
      setTasks(json.data.tasks);
      setError('');
    } catch {
      setError('載入失敗');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        const json = await res.json().catch(() => ({}));
        if (res.ok) setCurrentUser(json.user || json);
      } catch {
        setCurrentUser({});
      }
    };
    void Promise.all([load(), loadUser()]);
  }, [load]);

  const cards = [
    {
      label: '逾期未完成',
      value: summary.overdue,
      icon: AlertTriangle,
      cls: 'bg-red-50 border-red-200 text-red-700',
      iconCls: 'text-red-600 bg-red-100',
    },
    {
      label: '今日待維護',
      value: summary.today,
      icon: CalendarClock,
      cls: 'bg-orange-50 border-orange-200 text-orange-700',
      iconCls: 'text-orange-600 bg-orange-100',
    },
    {
      label: '本週已完成',
      value: summary.weekDone,
      icon: CheckCircle2,
      cls: 'bg-green-50 border-green-200 text-green-700',
      iconCls: 'text-green-600 bg-green-100',
    },
  ];
  const featureLinks = [
    {
      href: '/property-management/scan',
      label: '掃碼維護',
      desc: canMaintainProperty
        ? '掃描或輸入財產編號，立即查詢狀態並開始維護'
        : '掃描或輸入財產編號，查詢財產狀態與下次維護日',
      icon: QrCode,
      cls: 'text-blue-600 bg-blue-50',
    },
    {
      href: '/property-management/assets',
      label: '財產主檔／資產清冊',
      desc: canManageProperty
        ? '查詢、新增、編輯財產，並批量匯入財產盤點 .xlsx'
        : '查詢財產編號、名稱、放置地點、管理人與維護頻率',
      icon: Package,
      cls: 'text-emerald-600 bg-emerald-50',
    },
    {
      href: '/property-management/records',
      label: '維護執行紀錄',
      desc: canMaintainProperty
        ? '填寫維護結果、查看個人與歷史維護紀錄'
        : '檢視待維護、已完成與歷史維護紀錄',
      icon: ClipboardList,
      cls: 'text-purple-600 bg-purple-50',
    },
    {
      href: '/property-management/review',
      label: '主管稽核',
      desc: '審核已提交維護紀錄、追蹤退回補正',
      icon: ShieldCheck,
      cls: 'text-orange-600 bg-orange-50',
      supervisorOnly: true,
    },
    {
      href: '/property-management/reports',
      label: '月報／評鑑佐證',
      desc: '匯出每月維護報表與單一或批次佐證報表',
      icon: FileText,
      cls: 'text-indigo-600 bg-indigo-50',
      supervisorOnly: true,
    },
    {
      href: '/property-management/stats',
      label: '維護統計',
      desc: '查看完成率、逾期率與趨勢分析',
      icon: BarChart3,
      cls: 'text-cyan-600 bg-cyan-50',
      supervisorOnly: true,
    },
  ].filter((item) => !('supervisorOnly' in item) || isPropertySupervisor);

  return (
    <AuthenticatedLayout backUrl="/dashboard" backLabel="返回儀表板">
      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">財產管理</h1>
          <div className="flex gap-2">
            <Link
              href="/property-management/scan"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <QrCode className="w-5 h-5" /> {canMaintainProperty ? '掃碼維護' : '掃碼查詢'}
            </Link>
            <button
              onClick={load}
              className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-900 hover:bg-gray-50"
            >
              <RefreshCw className="w-4 h-4" /> 重新整理
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700">
            {error}
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-gray-900">財產管理功能</h2>
              <p className="text-sm text-gray-600">
                一般員工可查詢檢視；維護人員、主管/稽核與管理員依權限使用對應功能。
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {featureLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors group"
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${item.cls}`}>
                  <item.icon className="w-5 h-5" />
                </div>
                <h3 className="font-medium text-gray-900 group-hover:text-blue-700">{item.label}</h3>
                <p className="text-sm text-gray-600 mt-1">{item.desc}</p>
              </Link>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {cards.map((c) => (
            <div key={c.label} className={`rounded-xl border p-5 ${c.cls}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium opacity-80">{c.label}</p>
                  <p className="text-3xl font-bold mt-1">{c.value}</p>
                </div>
                <span className={`p-3 rounded-lg ${c.iconCls}`}>
                  <c.icon className="w-6 h-6" />
                </span>
              </div>
            </div>
          ))}
        </div>

        {summary.overdue > 0 && (
          <div className="mb-6 flex items-start gap-3 p-4 rounded-lg bg-red-50 border-l-4 border-red-500">
            <AlertTriangle className="w-6 h-6 text-red-500 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-800">需要注意</h3>
              <p className="text-red-700 text-sm mt-0.5">
                有 {summary.overdue} 筆逾期未完成維護任務，請優先處理。
              </p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-3 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">
              {canMaintainProperty ? '今日待辦任務（逾期優先）' : '待維護紀錄（逾期優先）'}
            </h2>
          </div>
          {loading ? (
            <div className="p-8 text-center text-gray-600">載入中…</div>
          ) : tasks.length === 0 ? (
            <div className="p-8 text-center text-gray-600">今日沒有待辦任務 🎉</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {tasks.map((t) => {
                const s = STATUS_UI[t.displayStatus];
                return (
                  <li key={t.recordId} className={`flex items-center gap-3 px-4 py-3 ${s.row}`}>
                    <span className={`w-2.5 h-2.5 rounded-full ${s.dot} shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">
                        {t.assetCode}　{t.assetName}
                      </p>
                      <p className="text-xs text-gray-600 truncate">
                        {t.siteName}・{t.location || '—'}・應維護 {fmtDate(t.dueDate)}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${s.badge}`}>{s.label}</span>
                    <Link
                      href={canMaintainProperty
                        ? `/property-management/scan?code=${encodeURIComponent(t.assetCode)}&recordId=${encodeURIComponent(t.recordId)}&assessment=1`
                        : `/property-management/records?focus=${encodeURIComponent(t.recordId)}`}
                      className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shrink-0"
                    >
                      {canMaintainProperty ? '開始維護' : '檢視'}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </AuthenticatedLayout>
  );
}
