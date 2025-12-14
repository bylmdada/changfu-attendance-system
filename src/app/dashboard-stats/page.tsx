'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { 
  BarChart3, Users, Clock, Calendar, TrendingUp, 
  AlertCircle, CheckCircle, XCircle, ArrowLeft, RefreshCw
} from 'lucide-react';

interface DashboardStats {
  period: { year: number; month: number; workDays: number };
  summary: {
    totalEmployees: number;
    attendanceRate: number;
    totalOvertimeHours: number;
    avgOvertimePerEmployee: number;
    pendingApprovals: number;
  };
  today: {
    date: string;
    clockedIn: number;
    clockedOut: number;
    notClockedIn: number;
  };
  overtime: {
    totalHours: number;
    requestCount: number;
    avgPerEmployee: number;
  };
  leave: {
    totalRequests: number;
    byType: Record<string, number>;
    pending: number;
  };
  trends: {
    dailyAttendance: Array<{ date: string; count: number; total: number }>;
  };
  departments: Array<{
    department: string;
    total: number;
    attended: number;
    rate: number;
  }>;
}

const leaveTypeNames: Record<string, string> = {
  ANNUAL: '特休假',
  SICK: '病假',
  PERSONAL: '事假',
  MARRIAGE: '婚假',
  MATERNITY: '產假',
  BEREAVEMENT: '喪假',
  COMP_LEAVE: '補休',
  OTHER: '其他'
};

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const getAuthHeaders = (): HeadersInit => {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError('');
    
    try {
      const [year, month] = selectedMonth.split('-');
      const response = await fetch(
        `/api/dashboard-stats?year=${year}&month=${month}`,
        { credentials: 'include', headers: getAuthHeaders() }
      );

      if (response.ok) {
        const data = await response.json();
        setStats(data.data);
      } else if (response.status === 401 || response.status === 403) {
        router.push('/login');
      } else {
        setError('載入統計資料失敗');
      }
    } catch (err) {
      console.error('載入失敗:', err);
      setError('系統錯誤');
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, router]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 頂部導航 */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.push('/dashboard')}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <BarChart3 className="w-6 h-6 text-blue-600" />
                管理儀表板
              </h1>
              <p className="text-sm text-gray-500">出勤率、加班統計、假期使用總覽</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={fetchStats}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <RefreshCw className="w-4 h-4" />
              重新整理
            </button>
          </div>
        </div>
      </header>

      {/* 主內容 */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg border border-red-200">
            {error}
          </div>
        )}

        {stats && (
          <>
            {/* 今日概覽 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">今日已打卡</p>
                    <p className="text-3xl font-bold text-green-600">{stats.today.clockedIn}</p>
                  </div>
                  <CheckCircle className="w-10 h-10 text-green-200" />
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  / {stats.summary.totalEmployees} 人
                </p>
              </div>

              <div className="bg-white rounded-xl shadow-sm border p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">未打卡</p>
                    <p className="text-3xl font-bold text-yellow-600">{stats.today.notClockedIn}</p>
                  </div>
                  <AlertCircle className="w-10 h-10 text-yellow-200" />
                </div>
                <p className="text-xs text-gray-400 mt-2">待追蹤</p>
              </div>

              <div className="bg-white rounded-xl shadow-sm border p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">月出勤率</p>
                    <p className="text-3xl font-bold text-blue-600">{stats.summary.attendanceRate}%</p>
                  </div>
                  <TrendingUp className="w-10 h-10 text-blue-200" />
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  {stats.period.month} 月
                </p>
              </div>

              <div className="bg-white rounded-xl shadow-sm border p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">待審核</p>
                    <p className="text-3xl font-bold text-purple-600">{stats.summary.pendingApprovals}</p>
                  </div>
                  <XCircle className="w-10 h-10 text-purple-200" />
                </div>
                <p className="text-xs text-gray-400 mt-2">請假 + 加班</p>
              </div>
            </div>

            {/* 加班和請假統計 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              {/* 加班統計 */}
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-orange-600" />
                  加班統計
                </h2>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-4 bg-orange-50 rounded-lg">
                    <p className="text-2xl font-bold text-orange-600">{stats.overtime.totalHours}</p>
                    <p className="text-sm text-gray-500">總時數</p>
                  </div>
                  <div className="text-center p-4 bg-orange-50 rounded-lg">
                    <p className="text-2xl font-bold text-orange-600">{stats.overtime.requestCount}</p>
                    <p className="text-sm text-gray-500">申請數</p>
                  </div>
                  <div className="text-center p-4 bg-orange-50 rounded-lg">
                    <p className="text-2xl font-bold text-orange-600">{stats.overtime.avgPerEmployee}</p>
                    <p className="text-sm text-gray-500">人均時數</p>
                  </div>
                </div>
              </div>

              {/* 請假統計 */}
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-green-600" />
                  請假統計
                </h2>
                <div className="space-y-2">
                  {Object.entries(stats.leave.byType).length > 0 ? (
                    Object.entries(stats.leave.byType).map(([type, count]) => (
                      <div key={type} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                        <span className="text-sm text-gray-700">
                          {leaveTypeNames[type] || type}
                        </span>
                        <span className="font-semibold text-gray-900">{count} 件</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-gray-500 text-center py-4">本月無請假記錄</p>
                  )}
                </div>
              </div>
            </div>

            {/* 部門出勤統計 */}
            <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                部門出勤統計
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">部門</th>
                      <th className="text-center py-3 px-4 text-sm font-medium text-gray-500">人數</th>
                      <th className="text-center py-3 px-4 text-sm font-medium text-gray-500">出勤次數</th>
                      <th className="text-center py-3 px-4 text-sm font-medium text-gray-500">出勤率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.departments.map((dept, index) => (
                      <tr key={index} className="border-b hover:bg-gray-50">
                        <td className="py-3 px-4 text-sm text-gray-900">{dept.department}</td>
                        <td className="py-3 px-4 text-sm text-center text-gray-600">{dept.total}</td>
                        <td className="py-3 px-4 text-sm text-center text-gray-600">{dept.attended}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={`px-2 py-1 rounded text-sm font-medium ${
                            dept.rate >= 90 ? 'bg-green-100 text-green-700' :
                            dept.rate >= 70 ? 'bg-yellow-100 text-yellow-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {dept.rate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 每日出勤趨勢 */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-indigo-600" />
                每日出勤趨勢
              </h2>
              <div className="h-48 flex items-end gap-1 overflow-x-auto pb-4">
                {stats.trends.dailyAttendance.map((day, index) => {
                  const percentage = day.total > 0 ? (day.count / day.total) * 100 : 0;
                  return (
                    <div key={index} className="flex flex-col items-center min-w-[40px]">
                      <div 
                        className="w-8 bg-blue-500 rounded-t transition-all hover:bg-blue-600"
                        style={{ height: `${percentage * 1.5}px` }}
                        title={`${day.date}: ${day.count}/${day.total}`}
                      />
                      <span className="text-xs text-gray-400 mt-1 rotate-45 origin-left">
                        {day.date.slice(5)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
