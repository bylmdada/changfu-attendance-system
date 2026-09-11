'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle,
  FileText,
  Filter,
  Search,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import SystemNavbar from '@/components/SystemNavbar';
import ResponsiveSidebar from '@/components/ResponsiveSidebar';
import EmptyState from '@/components/EmptyState';
import PageSkeleton from '@/components/PageSkeleton';

interface User {
  id: number;
  username: string;
  role: string;
  hasSchedulePermission?: boolean;
  hasPropertyAccess?: boolean;
  canMaintainProperty?: boolean;
  isPropertySupervisor?: boolean;
  canManageProperty?: boolean;
  employee?: {
    id: number;
    employeeId?: string;
    name: string;
    department?: string;
    position?: string;
  };
}

interface AuditLogEntry {
  id: number;
  action: string;
  targetType: string | null;
  targetId: number | null;
  oldValue: string | null;
  newValue: string | null;
  description: string | null;
  success: boolean;
  errorMsg: string | null;
  riskLevel: string;
  isFlagged: boolean;
  createdAt: string;
  employee?: {
    id: number;
    employeeId: string;
    name: string | null;
    department: string | null;
  } | null;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

type Filters = {
  startDate: string;
  endDate: string;
  action: string;
  targetType: string;
  employeeId: string;
  riskLevel: string;
  flaggedOnly: boolean;
};

const DEFAULT_FILTERS: Filters = {
  startDate: '',
  endDate: '',
  action: '',
  targetType: '',
  employeeId: '',
  riskLevel: '',
  flaggedOnly: false,
};

const ACTION_LABELS: Record<string, string> = {
  SETTINGS_UPDATE: '設定變更',
  LOGIN: '登入成功',
  LOGIN_FAILED: '登入失敗',
  LOGOUT: '登出',
  CLOCK_IN: '上班打卡',
  CLOCK_OUT: '下班打卡',
  ATTENDANCE_FREEZE: '考勤凍結',
  PAYROLL_GENERATE: '薪資計算',
  PAYROLL_EXPORT: '薪資匯出',
  EXPORT: '資料匯出',
  CREATE: '新增',
  UPDATE: '更新',
  DELETE: '刪除',
  VIEW: '檢視',
};

const TARGET_TYPE_LABELS: Record<string, string> = {
  SystemSettings: '系統設定',
  Employee: '員工',
  User: '使用者',
  AttendanceRecord: '考勤紀錄',
  Schedule: '班表',
  LeaveRequest: '請假單',
  OvertimeRequest: '加班單',
  PayrollRecord: '薪資紀錄',
  ShiftExchange: '調班',
  Announcement: '公告',
  Bonus: '獎金',
};

const ACTION_OPTIONS = [
  'SETTINGS_UPDATE',
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'CLOCK_IN',
  'CLOCK_OUT',
  'ATTENDANCE_FREEZE',
  'PAYROLL_GENERATE',
  'PAYROLL_EXPORT',
  'EXPORT',
  'CREATE',
  'UPDATE',
  'DELETE',
  'VIEW',
];

const TARGET_TYPE_OPTIONS = [
  'SystemSettings',
  'Employee',
  'User',
  'AttendanceRecord',
  'Schedule',
  'LeaveRequest',
  'OvertimeRequest',
  'PayrollRecord',
  'ShiftExchange',
  'Announcement',
  'Bonus',
];

function createFiltersFromSearchParams(searchParams: Pick<URLSearchParams, 'get'>): Filters {
  return {
    startDate: searchParams.get('startDate') || '',
    endDate: searchParams.get('endDate') || '',
    action: searchParams.get('action') || '',
    targetType: searchParams.get('targetType') || '',
    employeeId: searchParams.get('employeeId') || '',
    riskLevel: searchParams.get('riskLevel') || '',
    flaggedOnly: searchParams.get('flaggedOnly') === 'true',
  };
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour12: false,
  });
}

function parseAuditJson(value: string | null) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function renderAuditJson(value: string | null) {
  if (!value) return '無';
  const parsed = parseAuditJson(value);
  return typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
}

function getRiskBadgeClass(riskLevel: string) {
  if (riskLevel === 'CRITICAL') return 'bg-red-100 text-red-800';
  if (riskLevel === 'HIGH') return 'bg-orange-100 text-orange-800';
  if (riskLevel === 'MEDIUM') return 'bg-yellow-100 text-yellow-800';
  return 'bg-slate-100 text-slate-700';
}

function getResultBadgeClass(success: boolean) {
  return success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
}

function AuditLogsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: Number(searchParams.get('page') || '1'),
    pageSize: 50,
    total: 0,
    totalPages: 0,
  });
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(() => createFiltersFromSearchParams(searchParams));
  const [initialLoaded, setInitialLoaded] = useState(false);

  const fetchLogs = useCallback(async (page = 1, activeFilters = filters) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: '50',
      });

      if (activeFilters.startDate) params.set('startDate', activeFilters.startDate);
      if (activeFilters.endDate) params.set('endDate', activeFilters.endDate);
      if (activeFilters.action) params.set('action', activeFilters.action);
      if (activeFilters.targetType) params.set('targetType', activeFilters.targetType);
      if (activeFilters.employeeId) params.set('employeeId', activeFilters.employeeId);
      if (activeFilters.riskLevel) params.set('riskLevel', activeFilters.riskLevel);
      if (activeFilters.flaggedOnly) params.set('flaggedOnly', 'true');

      const response = await fetch(`/api/audit-logs?${params}`, {
        credentials: 'include',
      });

      if (response.status === 401) {
        router.push('/login');
        return;
      }

      if (response.status === 403) {
        router.push('/dashboard');
        return;
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || '載入稽核日誌失敗');
      }

      setLogs(data.logs || []);
      setPagination(data.pagination || { page: 1, pageSize: 50, total: 0, totalPages: 0 });
      setStats(data.stats?.riskLevels || {});
    } catch (error) {
      console.error('載入稽核日誌失敗:', error);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [filters, router]);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include',
        });

        if (!response.ok) {
          router.push('/login');
          return;
        }

        const data = await response.json();
        const currentUser = data.user || data;
        if (currentUser.role !== 'ADMIN') {
          router.push('/dashboard');
          return;
        }

        setUser(currentUser);
      } catch (error) {
        console.error('驗證稽核日誌權限失敗:', error);
        router.push('/login');
      }
    };

    void checkAuth();
  }, [router]);

  useEffect(() => {
    if (!user || initialLoaded) {
      return;
    }

    setInitialLoaded(true);
    void fetchLogs(pagination.page, filters);
  }, [fetchLogs, filters, initialLoaded, pagination.page, user]);

  const handleSearch = () => {
    void fetchLogs(1);
  };

  const handleClearFilters = () => {
    setFilters(DEFAULT_FILTERS);
    void fetchLogs(1, DEFAULT_FILTERS);
  };

  const pageTitle = filters.targetType === 'SystemSettings' && filters.action === 'SETTINGS_UPDATE'
    ? '設定變更紀錄'
    : '操作稽核日誌';

  if (loading && !user) {
    return <PageSkeleton title="稽核日誌載入中" />;
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />
      <ResponsiveSidebar user={user} />

      <main className="lg:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-6">
            <h1 className="flex items-center text-3xl font-bold text-gray-900">
              <FileText className="mr-3 h-8 w-8 text-blue-600" />
              {pageTitle}
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              查看系統敏感操作紀錄，支援依操作類型、目標類型與風險等級篩選。
            </p>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-gray-500">低風險</p>
              <p className="mt-2 text-2xl font-bold text-slate-700">{stats.LOW || 0}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-gray-500">中風險</p>
              <p className="mt-2 text-2xl font-bold text-yellow-700">{stats.MEDIUM || 0}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-gray-500">高風險</p>
              <p className="mt-2 text-2xl font-bold text-orange-700">{stats.HIGH || 0}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-gray-500">重大風險</p>
              <p className="mt-2 text-2xl font-bold text-red-700">{stats.CRITICAL || 0}</p>
            </div>
          </div>

          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">操作類型</label>
                <select
                  value={filters.action}
                  onChange={(e) => setFilters({ ...filters, action: e.target.value })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="">全部</option>
                  {ACTION_OPTIONS.map((action) => (
                    <option key={action} value={action}>{ACTION_LABELS[action] || action}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">目標類型</label>
                <select
                  value={filters.targetType}
                  onChange={(e) => setFilters({ ...filters, targetType: e.target.value })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="">全部</option>
                  {TARGET_TYPE_OPTIONS.map((targetType) => (
                    <option key={targetType} value={targetType}>{TARGET_TYPE_LABELS[targetType] || targetType}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">員工 ID</label>
                <input
                  type="text"
                  value={filters.employeeId}
                  onChange={(e) => setFilters({ ...filters, employeeId: e.target.value })}
                  placeholder="操作人員工 ID"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">風險等級</label>
                <select
                  value={filters.riskLevel}
                  onChange={(e) => setFilters({ ...filters, riskLevel: e.target.value })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="">全部</option>
                  <option value="LOW">低風險</option>
                  <option value="MEDIUM">中風險</option>
                  <option value="HIGH">高風險</option>
                  <option value="CRITICAL">重大風險</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">開始日期</label>
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">結束日期</label>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-blue-500"
                />
              </div>

              <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={filters.flaggedOnly}
                  onChange={(e) => setFilters({ ...filters, flaggedOnly: e.target.checked })}
                  className="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
                />
                只看標記紀錄
              </label>

              <div className="flex items-end gap-2">
                <button
                  onClick={handleSearch}
                  className="flex flex-1 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                >
                  <Search className="h-4 w-4" />
                  查詢
                </button>
                <button
                  onClick={handleClearFilters}
                  className="rounded-md bg-gray-100 px-4 py-2 text-gray-700 hover:bg-gray-200"
                  title="清除篩選"
                >
                  <Filter className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-medium text-gray-900">紀錄列表 ({pagination.total} 筆)</h2>
            </div>

            {logs.length === 0 && !loading ? (
              <div className="p-6">
                <EmptyState
                  icon={<FileText className="h-10 w-10" />}
                  title="沒有符合條件的稽核紀錄"
                  description="可以調整篩選條件後重新查詢。"
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">時間</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">操作人</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">操作</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">目標</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">說明</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">結果</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">風險</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">變更內容</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {logs.map((log) => (
                      <tr key={log.id} className="align-top hover:bg-gray-50">
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                          {formatDateTime(log.createdAt)}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700">
                          {log.employee ? (
                            <div>
                              <div className="font-medium text-gray-900">
                                {log.employee.name || '未命名員工'}
                              </div>
                              <div className="text-xs text-gray-500">
                                {log.employee.employeeId}
                                {log.employee.department ? ` / ${log.employee.department}` : ''}
                              </div>
                            </div>
                          ) : (
                            <span className="text-gray-400">系統 / 未綁定員工</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                          {ACTION_LABELS[log.action] || log.action}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-700">
                          {log.targetType ? (TARGET_TYPE_LABELS[log.targetType] || log.targetType) : '-'}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700">
                          {log.description || '-'}
                          {log.errorMsg ? (
                            <div className="mt-1 text-xs text-red-600">{log.errorMsg}</div>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${getResultBadgeClass(log.success)}`}>
                            {log.success ? <CheckCircle className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                            {log.success ? '成功' : '失敗'}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${getRiskBadgeClass(log.riskLevel)}`}>
                            {log.isFlagged ? <ShieldAlert className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                            {log.riskLevel}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700">
                          <details className="max-w-xl">
                            <summary className="cursor-pointer text-blue-600 hover:text-blue-800">查看</summary>
                            <div className="mt-3 space-y-3">
                              <div>
                                <div className="mb-1 text-xs font-medium text-gray-500">變更前</div>
                                <pre className="overflow-x-auto rounded bg-gray-50 p-3 text-xs text-gray-800 whitespace-pre-wrap break-all">
                                  {renderAuditJson(log.oldValue)}
                                </pre>
                              </div>
                              <div>
                                <div className="mb-1 text-xs font-medium text-gray-500">變更後</div>
                                <pre className="overflow-x-auto rounded bg-gray-50 p-3 text-xs text-gray-800 whitespace-pre-wrap break-all">
                                  {renderAuditJson(log.newValue)}
                                </pre>
                              </div>
                            </div>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {pagination.totalPages > 1 ? (
              <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4">
                <p className="text-sm text-gray-600">
                  第 {pagination.page} 頁，共 {pagination.totalPages} 頁
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => void fetchLogs(pagination.page - 1)}
                    disabled={pagination.page <= 1 || loading}
                    className="rounded-md border border-gray-300 px-3 py-1 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    上一頁
                  </button>
                  <button
                    onClick={() => void fetchLogs(pagination.page + 1)}
                    disabled={pagination.page >= pagination.totalPages || loading}
                    className="rounded-md border border-gray-300 px-3 py-1 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    下一頁
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function AuditLogsPage() {
  return (
    <Suspense fallback={<PageSkeleton title="稽核日誌載入中" />}>
      <AuditLogsPageContent />
    </Suspense>
  );
}
