'use client';

import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, DollarSign, Users, PieChart } from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';

interface PayrollStatistics {
  overall: {
    totalRecords: number;
    totalGrossPay: number;
    totalNetPay: number;
    totalRegularHours: number;
    totalOvertimeHours: number;
    avgGrossPay: number;
    avgNetPay: number;
    avgRegularHours: number;
    avgOvertimeHours: number;
  };
  departmentStats: Array<{
    department: string;
    employeeCount: number;
    totalGrossPay: number;
    totalNetPay: number;
    totalRegularHours: number;
    totalOvertimeHours: number;
    avgGrossPay: number;
    avgNetPay: number;
  }>;
  monthlyTrends: Array<{
    month: number;
    employeeCount: number;
    totalGrossPay: number;
    totalNetPay: number;
    totalRegularHours: number;
    totalOvertimeHours: number;
  }>;
  salaryDistribution: Array<{
    label: string;
    count: number;
    min: number;
    max: number;
  }>;
}

interface User {
  id: number;
  username: string;
  role: string;
  employee?: {
    id: number;
    employeeId: string;
    name: string;
    department: string;
    position: string;
  };
}

const MONTHS = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月'
];

export default function PayrollStatisticsPage() {
  const [statistics, setStatistics] = useState<PayrollStatistics | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [filters, setFilters] = useState({
    year: new Date().getFullYear().toString(),
    month: '',
    department: '' // 新增部門篩選
  });
  const [activeTab, setActiveTab] = useState<'overview' | 'analysis' | 'trends'>('overview');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const loadStatistics = async () => {
      try {
        // 首先獲取用戶信息
        const authResponse = await fetch('/api/auth/me', {
          credentials: 'include'
        });
        
        if (!authResponse.ok) {
          window.location.href = '/login';
          return;
        }
        
        const userData = await authResponse.json();
        setUser(userData.user);

        // 獲取部門列表
        try {
          const deptResponse = await fetch('/api/departments', { credentials: 'include' });
          if (deptResponse.ok) {
            const deptData = await deptResponse.json();
            setDepartments(deptData.departments || []);
          }
        } catch (deptError) {
          console.error('獲取部門列表失敗:', deptError);
        }

        const token = localStorage.getItem('token');
        const url = new URL('/api/payroll/statistics', window.location.origin);
        if (filters.year) url.searchParams.set('year', filters.year);
        if (filters.month) url.searchParams.set('month', filters.month);
        if (filters.department) url.searchParams.set('department', filters.department);
        
        const response = await fetch(url.toString(), {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          setStatistics(data.statistics);
        }
      } catch (error) {
        console.error('獲取統計數據失敗:', error);
      } finally {
        setLoading(false);
      }
    };

    loadStatistics();
  }, [filters.year, filters.month, filters.department]);

  // 匯出報表功能
  const handleExportReport = async (format: 'excel' | 'pdf') => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      params.append('year', filters.year);
      if (filters.month) params.append('month', filters.month);
      if (filters.department) params.append('department', filters.department);
      params.append('format', format);

      const response = await fetch(`/api/reports/export?${params.toString()}`, {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('匯出失敗');
      }

      // 獲取 HTML 內容並在新窗口開啟
      const htmlContent = await response.text();
      const newWindow = window.open('', '_blank');
      if (newWindow) {
        newWindow.document.write(htmlContent);
        newWindow.document.close();
      }
    } catch (error) {
      console.error('匯出報表失敗:', error);
      alert('匯出報表失敗');
    } finally {
      setExporting(false);
    }
  };

  // 部門名稱列表
  const departmentNames = departments.map(d => d.name);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('zh-TW', {
      style: 'currency',
      currency: 'TWD',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const formatHours = (hours: number) => {
    return `${hours.toFixed(1)}h`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!statistics) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500">無法載入統計數據</p>
        </div>
      </div>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* 頁面標題 */}
          <div className="mb-8">
            <div className="flex items-center gap-3">
              <BarChart3 className="h-8 w-8 text-blue-600" />
              <h1 className="text-3xl font-bold text-gray-900">薪資統計</h1>
            </div>
          </div>

          {/* 篩選區域 */}
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">年份</label>
              <select
                value={filters.year}
                onChange={(e) => setFilters({ ...filters, year: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
              >
                {Array.from({ length: 5 }, (_, i) => {
                  const year = new Date().getFullYear() - 2 + i;
                  return (
                    <option key={year} value={year}>{year}年</option>
                  );
                })}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">月份</label>
              <select
                value={filters.month}
                onChange={(e) => setFilters({ ...filters, month: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
              >
                <option value="">全年統計</option>
                {MONTHS.map((month, index) => (
                  <option key={index + 1} value={index + 1}>{month}</option>
                ))}
              </select>
            </div>

            {/* 部門篩選 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">部門</label>
              <select
                value={filters.department}
                onChange={(e) => setFilters({ ...filters, department: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
              >
                <option value="">全部部門</option>
                {departmentNames.map((dept) => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <div className="text-sm text-gray-600">
                統計期間：{filters.year}年{filters.month ? `${filters.month}月` : '全年'}
                {filters.department && ` - ${filters.department}`}
              </div>
            </div>

            {/* 匯出按鈕 */}
            <div className="flex items-end gap-2">
              <button
                onClick={() => handleExportReport('excel')}
                disabled={exporting}
                className="flex items-center justify-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 text-sm"
              >
                {exporting ? '匯出中...' : '匯出報表'}
              </button>
              {/* 元大薪轉匯出 */}
              <button
                onClick={() => {
                  const params = new URLSearchParams();
                  params.append('year', filters.year);
                  if (filters.month) params.append('month', filters.month);
                  params.append('type', 'salary');
                  window.open(`/api/reports/yuanta-transfer?${params}`, '_blank');
                }}
                className="flex items-center justify-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                title="匯出元大銀行薪轉格式（依部門分頁）"
              >
                元大薪轉
              </button>
              <button
                onClick={() => {
                  const params = new URLSearchParams();
                  params.append('year', filters.year);
                  params.append('type', 'bonus');
                  window.open(`/api/reports/yuanta-transfer?${params}`, '_blank');
                }}
                className="flex items-center justify-center gap-1 px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
                title="匯出年終獎金元大薪轉格式（依部門分頁）"
              >
                年終薪轉
              </button>
            </div>
          </div>
        </div>

        {/* 標籤導航 */}
        <div className="bg-white rounded-lg shadow-sm mb-6">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8 px-6">
              <button
                onClick={() => setActiveTab('overview')}
                className={`${
                  activeTab === 'overview'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2`}
              >
                <BarChart3 className="w-4 h-4" />
                總覽統計
              </button>
              <button
                onClick={() => setActiveTab('analysis')}
                className={`${
                  activeTab === 'analysis'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2`}
              >
                <PieChart className="w-4 h-4" />
                薪資分析
              </button>
              <button
                onClick={() => setActiveTab('trends')}
                className={`${
                  activeTab === 'trends'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2`}
              >
                <TrendingUp className="w-4 h-4" />
                趨勢分析
              </button>
            </nav>
          </div>
        </div>

        {/* 根據活動標籤顯示內容 */}
        {activeTab === 'overview' && (
          <>
            {/* 總覽統計卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Users className="h-8 w-8 text-blue-600" />
              </div>
              <div className="ml-4">
                <div className="text-sm font-medium text-gray-500">薪資記錄數</div>
                <div className="text-2xl font-bold text-gray-900">
                  {statistics.overall.totalRecords}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <DollarSign className="h-8 w-8 text-green-600" />
              </div>
              <div className="ml-4">
                <div className="text-sm font-medium text-gray-500">總薪資支出</div>
                <div className="text-2xl font-bold text-gray-900">
                  {formatCurrency(statistics.overall.totalGrossPay)}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <TrendingUp className="h-8 w-8 text-yellow-600" />
              </div>
              <div className="ml-4">
                <div className="text-sm font-medium text-gray-500">平均薪資</div>
                <div className="text-2xl font-bold text-gray-900">
                  {formatCurrency(statistics.overall.avgGrossPay)}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <BarChart3 className="h-8 w-8 text-purple-600" />
              </div>
              <div className="ml-4">
                <div className="text-sm font-medium text-gray-500">實發薪資</div>
                <div className="text-2xl font-bold text-gray-900">
                  {formatCurrency(statistics.overall.totalNetPay)}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* 部門薪資統計 */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <PieChart className="h-5 w-5 mr-2 text-blue-600" />
              部門薪資統計
            </h3>
            <div className="space-y-4">
              {statistics.departmentStats.map((dept, index) => (
                <div key={index} className="border-b border-gray-200 pb-4 last:border-b-0">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-medium text-gray-900">{dept.department}</h4>
                    <span className="text-sm text-gray-500">{dept.employeeCount} 人</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="text-gray-600">
                      <span>總薪資：</span>
                      <span className="font-semibold text-gray-900">{formatCurrency(dept.totalGrossPay)}</span>
                    </div>
                    <div className="text-gray-600">
                      <span>平均薪資：</span>
                      <span className="font-semibold text-gray-900">{formatCurrency(dept.avgGrossPay)}</span>
                    </div>
                    <div className="text-gray-600">
                      <span>總工時：</span>
                      <span className="font-semibold text-gray-900">{formatHours(dept.totalRegularHours)}</span>
                    </div>
                    <div className="text-gray-600">
                      <span>加班時數：</span>
                      <span className="font-semibold text-gray-900">{formatHours(dept.totalOvertimeHours)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 薪資分布統計 */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <BarChart3 className="h-5 w-5 mr-2 text-green-600" />
              薪資分布統計
            </h3>
            <div className="space-y-4">
              {statistics.salaryDistribution.map((range, index) => {
                const percentage = statistics.overall.totalRecords > 0 
                  ? (range.count / statistics.overall.totalRecords * 100).toFixed(1)
                  : 0;
                
                return (
                  <div key={index} className="flex items-center">
                    <div className="w-20 text-sm text-gray-600">{range.label}</div>
                    <div className="flex-1 mx-4">
                      <div className="bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-blue-600 h-2 rounded-full" 
                          style={{ width: `${percentage}%` }}
                        ></div>
                      </div>
                    </div>
                    <div className="w-16 text-sm text-gray-900 text-right">
                      {range.count} 人 ({percentage}%)
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 月度趨勢圖 */}
        {!filters.month && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <TrendingUp className="h-5 w-5 mr-2 text-purple-600" />
              {filters.year}年月度薪資趨勢
            </h3>
            
            {/* 簡單的表格顯示趨勢數據 */}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      月份
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      員工數
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      總薪資
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      實發薪資
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      總工時
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      加班時數
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {statistics.monthlyTrends.map((trend, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {MONTHS[trend.month - 1]}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {trend.employeeCount}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatCurrency(trend.totalGrossPay)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatCurrency(trend.totalNetPay)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatHours(trend.totalRegularHours)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatHours(trend.totalOvertimeHours)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 工時統計 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">工時統計</h3>
            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-gray-600">總正常工時：</span>
                <span className="font-semibold text-gray-900">{formatHours(statistics.overall.totalRegularHours)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">總加班時數：</span>
                <span className="font-semibold text-gray-900">{formatHours(statistics.overall.totalOvertimeHours)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">平均正常工時：</span>
                <span className="font-semibold text-gray-900">{formatHours(statistics.overall.avgRegularHours)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">平均加班時數：</span>
                <span className="font-semibold text-gray-900">{formatHours(statistics.overall.avgOvertimeHours)}</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">薪資結構</h3>
            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-gray-600">應發薪資：</span>
                <span className="font-semibold text-gray-900">{formatCurrency(statistics.overall.totalGrossPay)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">實發薪資：</span>
                <span className="font-semibold text-gray-900">{formatCurrency(statistics.overall.totalNetPay)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">扣款金額：</span>
                <span className="font-semibold text-red-600">
                  {formatCurrency(statistics.overall.totalGrossPay - statistics.overall.totalNetPay)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">實發比率：</span>
                <span className="font-semibold text-green-600">
                  {statistics.overall.totalGrossPay > 0 
                    ? ((statistics.overall.totalNetPay / statistics.overall.totalGrossPay) * 100).toFixed(1)
                    : 0}%
                </span>
              </div>
            </div>
          </div>
        </div>
          </>
        )}

        {/* 薪資分析標籤內容 */}
        {activeTab === 'analysis' && (
          <div className="space-y-6">
            {/* 部門薪資比較 */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <PieChart className="h-5 w-5 mr-2 text-blue-600" />
                部門薪資比較分析
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">部門</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">人數</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">總薪資</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">平均薪資</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">占比</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">薪資占比</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {statistics.departmentStats.map((dept, index) => {
                      const percentage = statistics.overall.totalGrossPay > 0 
                        ? (dept.totalGrossPay / statistics.overall.totalGrossPay * 100)
                        : 0;
                      const colors = ['bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-red-500', 'bg-orange-500', 'bg-teal-500'];
                      return (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{dept.department}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{dept.employeeCount} 人</td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatCurrency(dept.totalGrossPay)}</td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatCurrency(dept.avgGrossPay)}</td>
                          <td className="px-4 py-3 text-sm text-gray-600 text-right">{percentage.toFixed(1)}%</td>
                          <td className="px-4 py-3">
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div className={`${colors[index % colors.length]} h-2 rounded-full`} style={{ width: `${Math.min(percentage, 100)}%` }}></div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 薪資級距分析 */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <BarChart3 className="h-5 w-5 mr-2 text-green-600" />
                薪資級距分析
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {statistics.salaryDistribution.map((range, index) => {
                  const percentage = statistics.overall.totalRecords > 0 
                    ? (range.count / statistics.overall.totalRecords * 100)
                    : 0;
                  return (
                    <div key={index} className="bg-gray-50 rounded-lg p-4">
                      <div className="text-sm font-medium text-gray-700 mb-2">{range.label}</div>
                      <div className="text-2xl font-bold text-gray-900">{range.count} 人</div>
                      <div className="text-sm text-gray-500">{percentage.toFixed(1)}%</div>
                      <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                        <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${percentage}%` }}></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 工時效率分析 */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <TrendingUp className="h-5 w-5 mr-2 text-purple-600" />
                工時效率分析
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center p-4 bg-blue-50 rounded-lg">
                  <div className="text-sm text-gray-600 mb-1">平均時薪（應發）</div>
                  <div className="text-2xl font-bold text-blue-600">
                    {statistics.overall.totalRegularHours > 0 
                      ? formatCurrency(statistics.overall.totalGrossPay / statistics.overall.totalRegularHours)
                      : 'N/A'}
                  </div>
                </div>
                <div className="text-center p-4 bg-green-50 rounded-lg">
                  <div className="text-sm text-gray-600 mb-1">加班費占比</div>
                  <div className="text-2xl font-bold text-green-600">
                    {statistics.overall.totalGrossPay > 0 
                      ? `${((statistics.overall.totalOvertimeHours * 200 / statistics.overall.totalGrossPay) * 100).toFixed(1)}%`
                      : '0%'}
                  </div>
                </div>
                <div className="text-center p-4 bg-purple-50 rounded-lg">
                  <div className="text-sm text-gray-600 mb-1">加班時數占比</div>
                  <div className="text-2xl font-bold text-purple-600">
                    {(statistics.overall.totalRegularHours + statistics.overall.totalOvertimeHours) > 0 
                      ? `${(statistics.overall.totalOvertimeHours / (statistics.overall.totalRegularHours + statistics.overall.totalOvertimeHours) * 100).toFixed(1)}%`
                      : '0%'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 趨勢分析標籤內容 */}
        {activeTab === 'trends' && (
          <div className="space-y-6">
            {/* 月度趨勢圖表 */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <TrendingUp className="h-5 w-5 mr-2 text-purple-600" />
                {filters.year}年月度薪資趨勢
              </h3>
              
              {/* 視覺化長條圖 */}
              <div className="mb-6">
                <div className="flex items-end justify-between h-48 gap-1 px-4">
                  {statistics.monthlyTrends.map((trend, index) => {
                    const maxPay = Math.max(...statistics.monthlyTrends.map(t => t.totalGrossPay));
                    const height = maxPay > 0 ? (trend.totalGrossPay / maxPay) * 100 : 0;
                    return (
                      <div key={index} className="flex-1 flex flex-col items-center">
                        <div className="w-full bg-blue-500 rounded-t hover:bg-blue-600 transition-colors relative group" style={{ height: `${height}%`, minHeight: trend.totalGrossPay > 0 ? '4px' : '0' }}>
                          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10">
                            {formatCurrency(trend.totalGrossPay)}
                          </div>
                        </div>
                        <div className="text-xs text-gray-500 mt-2">{MONTHS[trend.month - 1]}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 詳細數據表格 */}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">月份</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">員工數</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">總薪資</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">實發薪資</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">環比變化</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {statistics.monthlyTrends.map((trend, index) => {
                      const prevPay = index > 0 ? statistics.monthlyTrends[index - 1].totalGrossPay : trend.totalGrossPay;
                      const change = prevPay > 0 ? ((trend.totalGrossPay - prevPay) / prevPay * 100) : 0;
                      return (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{MONTHS[trend.month - 1]}</td>
                          <td className="px-4 py-3 text-sm text-gray-600 text-right">{trend.employeeCount}</td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatCurrency(trend.totalGrossPay)}</td>
                          <td className="px-4 py-3 text-sm text-gray-900 text-right">{formatCurrency(trend.totalNetPay)}</td>
                          <td className={`px-4 py-3 text-sm text-right ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {index > 0 ? `${change >= 0 ? '+' : ''}${change.toFixed(1)}%` : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 年度摘要 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h4 className="text-sm font-medium text-gray-500 mb-2">年度總支出</h4>
                <div className="text-2xl font-bold text-gray-900">{formatCurrency(statistics.overall.totalGrossPay)}</div>
                <div className="text-sm text-gray-500 mt-1">{statistics.overall.totalRecords} 筆薪資記錄</div>
              </div>
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h4 className="text-sm font-medium text-gray-500 mb-2">月均支出</h4>
                <div className="text-2xl font-bold text-gray-900">
                  {formatCurrency(statistics.monthlyTrends.length > 0 
                    ? statistics.overall.totalGrossPay / statistics.monthlyTrends.filter(t => t.totalGrossPay > 0).length
                    : 0)}
                </div>
                <div className="text-sm text-gray-500 mt-1">{statistics.monthlyTrends.filter(t => t.totalGrossPay > 0).length} 個月有記錄</div>
              </div>
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h4 className="text-sm font-medium text-gray-500 mb-2">最高月份</h4>
                {(() => {
                  const maxMonth = statistics.monthlyTrends.reduce((max, t) => t.totalGrossPay > max.totalGrossPay ? t : max, statistics.monthlyTrends[0] || { month: 0, totalGrossPay: 0 });
                  return (
                    <>
                      <div className="text-2xl font-bold text-gray-900">{maxMonth.month > 0 ? MONTHS[maxMonth.month - 1] : 'N/A'}</div>
                      <div className="text-sm text-gray-500 mt-1">{formatCurrency(maxMonth.totalGrossPay)}</div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        </div>
      </div>
    </AuthenticatedLayout>
  );
}
