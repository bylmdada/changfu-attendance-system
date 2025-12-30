'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Search, Filter, Monitor, Smartphone, Globe, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import SystemNavbar from '@/components/SystemNavbar';

interface User {
  id: number;
  username: string;
  role: string;
  employee: {
    id: number;
    employeeId: string;
    name: string;
    department: string;
    position: string;
  };
}

interface LoginLog {
  id: number;
  username: string;
  employeeName: string | null;
  department: string | null;
  ipAddress: string;
  device: string | null;
  browser: string | null;
  os: string | null;
  status: string;
  failReason: string | null;
  createdAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const STATUS_LABELS: Record<string, string> = {
  SUCCESS: '成功',
  FAILED_PASSWORD: '密碼錯誤',
  FAILED_NOT_FOUND: '帳號不存在',
  FAILED_INACTIVE: '帳號停用',
  FAILED_LOCKED: '帳號鎖定',
  FAILED_2FA: '2FA 驗證失敗',
};

const STATUS_COLORS: Record<string, string> = {
  SUCCESS: 'bg-green-100 text-green-800',
  FAILED_PASSWORD: 'bg-red-100 text-red-800',
  FAILED_NOT_FOUND: 'bg-yellow-100 text-yellow-800',
  FAILED_INACTIVE: 'bg-gray-100 text-gray-800',
  FAILED_LOCKED: 'bg-orange-100 text-orange-800',
  FAILED_2FA: 'bg-purple-100 text-purple-800',
};

export default function LoginLogsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [logs, setLogs] = useState<LoginLog[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  
  // 篩選狀態
  const [filters, setFilters] = useState({
    username: '',
    status: '',
    startDate: '',
    endDate: '',
  });

  const fetchLogs = useCallback(async (page = 1) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page: page.toString(), limit: '50' });
      
      if (filters.username) params.set('username', filters.username);
      if (filters.status) params.set('status', filters.status);
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);

      const response = await fetch(`/api/system-settings/login-logs?${params}`, {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setLogs(data.logs || []);
        setPagination(data.pagination || { page: 1, limit: 50, total: 0, totalPages: 0 });
        setStats(data.stats || {});
      }
    } catch (error) {
      console.error('載入登入日誌失敗:', error);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/auth/me', { credentials: 'include' });
        if (response.ok) {
          const userData = await response.json();
          const currentUser = userData.user || userData;
          if (currentUser.role !== 'ADMIN') {
            router.push('/dashboard');
            return;
          }
          setUser(currentUser);
          fetchLogs();
        } else {
          router.push('/login');
        }
      } catch {
        router.push('/login');
      }
    };
    checkAuth();
  }, [router, fetchLogs]);

  const handleSearch = () => {
    fetchLogs(1);
  };

  const handleClearFilters = () => {
    setFilters({ username: '', status: '', startDate: '', endDate: '' });
  };

  const getDeviceIcon = (device: string | null) => {
    if (!device) return <Monitor className="w-4 h-4 text-gray-400" />;
    if (device === '手機') return <Smartphone className="w-4 h-4 text-blue-500" />;
    if (device === '平板') return <Smartphone className="w-4 h-4 text-purple-500" />;
    return <Monitor className="w-4 h-4 text-gray-600" />;
  };

  const getStatusIcon = (status: string) => {
    if (status === 'SUCCESS') return <CheckCircle className="w-4 h-4 text-green-600" />;
    if (status.startsWith('FAILED_')) return <XCircle className="w-4 h-4 text-red-600" />;
    return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
  };

  if (loading && logs.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-900">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 標題 */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <FileText className="w-8 h-8 text-blue-600 mr-3" />
            登入日誌
          </h1>
          <p className="text-gray-600 mt-2">查看系統登入記錄，監控帳號安全</p>
        </div>

        {/* 統計卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">成功登入</p>
                <p className="text-2xl font-bold text-green-600">{stats.SUCCESS || 0}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <p className="text-xs text-gray-400 mt-1">最近 7 天</p>
          </div>
          
          <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">密碼錯誤</p>
                <p className="text-2xl font-bold text-red-600">{stats.FAILED_PASSWORD || 0}</p>
              </div>
              <XCircle className="w-8 h-8 text-red-500" />
            </div>
            <p className="text-xs text-gray-400 mt-1">最近 7 天</p>
          </div>
          
          <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">帳號不存在</p>
                <p className="text-2xl font-bold text-yellow-600">{stats.FAILED_NOT_FOUND || 0}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-yellow-500" />
            </div>
            <p className="text-xs text-gray-400 mt-1">最近 7 天</p>
          </div>
          
          <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">帳號停用</p>
                <p className="text-2xl font-bold text-gray-600">{stats.FAILED_INACTIVE || 0}</p>
              </div>
              <Globe className="w-8 h-8 text-gray-500" />
            </div>
            <p className="text-xs text-gray-400 mt-1">最近 7 天</p>
          </div>
        </div>

        {/* 篩選區 */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-6 border border-gray-200">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">帳號</label>
              <input
                type="text"
                value={filters.username}
                onChange={(e) => setFilters({ ...filters, username: e.target.value })}
                placeholder="搜尋帳號..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">狀態</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-gray-900"
              >
                <option value="">全部</option>
                <option value="SUCCESS">成功</option>
                <option value="FAILED_PASSWORD">密碼錯誤</option>
                <option value="FAILED_NOT_FOUND">帳號不存在</option>
                <option value="FAILED_INACTIVE">帳號停用</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">開始日期</label>
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">結束日期</label>
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-gray-900"
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                onClick={handleSearch}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center justify-center gap-2"
              >
                <Search className="w-4 h-4" />
                查詢
              </button>
              <button
                onClick={handleClearFilters}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
              >
                <Filter className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* 日誌列表 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-lg font-medium text-gray-900">
              登入記錄 ({pagination.total} 筆)
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">時間</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">帳號</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">員工</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">IP 位址</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">裝置</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">狀態</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">原因</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {new Date(log.createdAt).toLocaleString('zh-TW')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {log.username}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {log.employeeName ? (
                        <span>{log.employeeName} ({log.department})</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 font-mono">
                      {log.ipAddress}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      <div className="flex items-center gap-2">
                        {getDeviceIcon(log.device)}
                        <span>{log.device || '未知'}</span>
                        {log.browser && <span className="text-gray-400">/ {log.browser}</span>}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(log.status)}
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[log.status] || 'bg-gray-100 text-gray-800'}`}>
                          {STATUS_LABELS[log.status] || log.status}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {log.failReason || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {logs.length === 0 && (
              <div className="text-center py-12">
                <FileText className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">無登入記錄</h3>
                <p className="mt-1 text-sm text-gray-500">目前沒有符合條件的登入記錄</p>
              </div>
            )}
          </div>

          {/* 分頁 */}
          {pagination.totalPages > 1 && (
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <p className="text-sm text-gray-600">
                第 {pagination.page} 頁，共 {pagination.totalPages} 頁
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => fetchLogs(pagination.page - 1)}
                  disabled={pagination.page <= 1}
                  className="px-3 py-1 border border-gray-300 rounded-md disabled:opacity-50 text-gray-700 hover:bg-gray-50"
                >
                  上一頁
                </button>
                <button
                  onClick={() => fetchLogs(pagination.page + 1)}
                  disabled={pagination.page >= pagination.totalPages}
                  className="px-3 py-1 border border-gray-300 rounded-md disabled:opacity-50 text-gray-700 hover:bg-gray-50"
                >
                  下一頁
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
