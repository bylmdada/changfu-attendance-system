'use client';

import { useState, useEffect } from 'react';
import { Calendar, Users, Download, Filter, CheckCircle, Clock, Gift } from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';

interface HolidayStats {
  total: number;
  taken: number;
  notRequired: number;
  pending: number;
  progress: number;
}

interface EmployeeHolidayCompensation {
  id: number;
  holidayName: string;
  holidayDate: string;
  status: string;
  compensationDate: string | null;
}

interface EmployeeStat {
  id: number;
  employeeId: string;
  name: string;
  department: string;
  stats: HolidayStats;
  compensations: EmployeeHolidayCompensation[];
}

interface Holiday {
  id: number;
  name: string;
  date: string;
}

export default function HolidayCompensationReport() {
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [department, setDepartment] = useState('');
  const [departments, setDepartments] = useState<string[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [employees, setEmployees] = useState<EmployeeStat[]>([]);
  const [overallStats, setOverallStats] = useState<{
    employeeCount: number;
    holidaysCount: number;
    totalTaken: number;
    totalNotRequired: number;
    totalPending: number;
  } | null>(null);

  useEffect(() => {
    document.title = '國定假日休假統計 - 長福會考勤系統';
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, department]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set('year', year.toString());
      if (department) {
        params.set('department', department);
      }

      const response = await fetch(`/api/holiday-compensations/stats?${params.toString()}`, {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        if (data.type === 'summary') {
          setHolidays(data.holidays || []);
          setEmployees(data.employees || []);
          setOverallStats(data.overallStats || null);
          setDepartments(data.departments || []);
        }
      }
    } catch (error) {
      console.error('獲取統計資料失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = () => {
    if (!employees.length) return;

    const headers = ['員工編號', '姓名', '部門', '應休', '已休', '當天休', '待休', '進度'];
    const rows = employees.map(emp => [
      emp.employeeId,
      emp.name,
      emp.department,
      emp.stats.total,
      emp.stats.taken,
      emp.stats.notRequired,
      emp.stats.pending,
      `${emp.stats.progress}%`
    ]);

    const csvContent = [
      `${year}年 國定假日休假統計報表`,
      '',
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `國定假日休假統計_${year}年.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Calendar className="w-12 h-12 text-blue-600 mx-auto mb-4 animate-pulse" />
          <p className="text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 標題區 */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center">
                <Gift className="w-8 h-8 text-red-600 mr-3" />
                國定假日休假統計
              </h1>
              <p className="text-gray-600 mt-2">檢視全員國定假日休假進度與補休狀態</p>
            </div>
            <button
              onClick={exportToCSV}
              className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors flex items-center"
            >
              <Download className="w-5 h-5 mr-2" />
              匯出報表
            </button>
          </div>
        </div>

        {/* 篩選區 */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5 text-gray-500" />
              <span className="font-medium text-gray-700">篩選條件</span>
            </div>
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-900"
            >
              {[2024, 2025, 2026].map(y => (
                <option key={y} value={y}>{y}年</option>
              ))}
            </select>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-900"
            >
              <option value="">全部部門</option>
              {departments.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 整體統計 */}
        {overallStats && (
          <div className="bg-gradient-to-r from-red-50 to-orange-50 rounded-lg shadow p-6 mb-6 border border-red-200">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Users className="w-5 h-5 mr-2 text-red-600" />
              {year}年 整體統計
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="text-center p-4 bg-white rounded-lg">
                <div className="text-3xl font-bold text-gray-900">{overallStats.employeeCount}</div>
                <div className="text-sm text-gray-600">員工人數</div>
              </div>
              <div className="text-center p-4 bg-white rounded-lg">
                <div className="text-3xl font-bold text-red-600">{overallStats.holidaysCount}</div>
                <div className="text-sm text-gray-600">國定假日數</div>
              </div>
              <div className="text-center p-4 bg-white rounded-lg">
                <div className="text-3xl font-bold text-green-600">{overallStats.totalTaken}</div>
                <div className="text-sm text-gray-600">已補休天次</div>
              </div>
              <div className="text-center p-4 bg-white rounded-lg">
                <div className="text-3xl font-bold text-blue-600">{overallStats.totalNotRequired}</div>
                <div className="text-sm text-gray-600">當天休天次</div>
              </div>
              <div className="text-center p-4 bg-white rounded-lg">
                <div className="text-3xl font-bold text-orange-600">{overallStats.totalPending}</div>
                <div className="text-sm text-gray-600">待補休天次</div>
              </div>
            </div>
          </div>
        )}

        {/* 假日列表 */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {year}年 國定假日一覽
          </h2>
          <div className="flex flex-wrap gap-2">
            {holidays.map(h => (
              <span
                key={h.id}
                className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm"
              >
                {h.date.split('T')[0]} {h.name}
              </span>
            ))}
            {holidays.length === 0 && (
              <span className="text-gray-500">尚未設定國定假日</span>
            )}
          </div>
        </div>

        {/* 員工列表 */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">員工休假進度</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">員工</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">部門</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">應休</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">已休</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">當天休</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">待休</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">進度</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {employees.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                      暫無資料
                    </td>
                  </tr>
                ) : (
                  employees.map(emp => (
                    <tr key={emp.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-medium text-gray-900">{emp.name}</div>
                        <div className="text-sm text-gray-500">{emp.employeeId}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {emp.department}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-medium text-gray-900">
                        {emp.stats.total}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          {emp.stats.taken}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          {emp.stats.notRequired}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                          <Clock className="w-3 h-3 mr-1" />
                          {emp.stats.pending}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-1 bg-gray-200 rounded-full h-2 mr-2">
                            <div
                              className={`h-2 rounded-full ${
                                emp.stats.progress >= 100 ? 'bg-green-500' :
                                emp.stats.progress >= 50 ? 'bg-blue-500' : 'bg-orange-500'
                              }`}
                              style={{ width: `${Math.min(emp.stats.progress, 100)}%` }}
                            />
                          </div>
                          <span className="text-sm font-medium text-gray-700">{emp.stats.progress}%</span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AuthenticatedLayout>
  );
}
