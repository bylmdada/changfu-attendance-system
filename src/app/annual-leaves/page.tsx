'use client';

import { useState, useEffect } from 'react';
import { Calendar, Plus, Search, Users, Clock } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';

interface Employee {
  id: number;
  employeeId: string;
  name: string;
  department: string;
  position: string;
  hireDate: string;
}

interface AnnualLeave {
  id: number;
  employeeId: number;
  year: number;
  yearsOfService: number;
  totalDays: number;
  usedDays: number;
  remainingDays: number;
  expiryDate: string;
  createdAt: string;
  employee: Employee;
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

export default function AnnualLeaveManagementPage() {
  const [annualLeaves, setAnnualLeaves] = useState<AnnualLeave[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSetupForm, setShowSetupForm] = useState(false);
  const [filters, setFilters] = useState({
    year: new Date().getFullYear().toString(),
    search: ''
  });

  // 特休假設定表單
  const [setupForm, setSetupForm] = useState({
    employeeId: '',
    year: new Date().getFullYear().toString(),
    yearsOfService: ''
  });

  useEffect(() => {
    const fetchData = async () => {
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

        const token = localStorage.getItem('token');
        
        // 獲取特休假記錄
        const annualLeavesUrl = new URL('/api/annual-leaves', window.location.origin);
        if (filters.year) annualLeavesUrl.searchParams.set('year', filters.year);
        
        const [annualLeavesResponse, employeesResponse] = await Promise.all([
          fetch(annualLeavesUrl.toString(), {
            headers: { 'Authorization': `Bearer ${token}` }
          }),
          fetch('/api/employees', {
            headers: { 'Authorization': `Bearer ${token}` }
          })
        ]);

        if (annualLeavesResponse.ok) {
          const annualLeavesData = await annualLeavesResponse.json();
          setAnnualLeaves(annualLeavesData.annualLeaves);
        }

        if (employeesResponse.ok) {
          const employeesData = await employeesResponse.json();
          setEmployees(employeesData.employees);
        }
      } catch (error) {
        console.error('獲取數據失敗:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [filters.year]);

  const fetchAnnualLeaves = async () => {
    try {
      const token = localStorage.getItem('token');
      const url = new URL('/api/annual-leaves', window.location.origin);
      if (filters.year) url.searchParams.set('year', filters.year);
      
      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setAnnualLeaves(data.annualLeaves);
      }
    } catch (error) {
      console.error('獲取特休假記錄失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSetupAnnualLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetchJSONWithCSRF('/api/annual-leaves', {
        method: 'POST',
        body: {
          employeeId: parseInt(setupForm.employeeId),
          year: parseInt(setupForm.year),
          yearsOfService: parseInt(setupForm.yearsOfService)
        }
      });

      if (response.ok) {
        const data = await response.json();
        alert(data.message);
        setShowSetupForm(false);
        setSetupForm({ employeeId: '', year: new Date().getFullYear().toString(), yearsOfService: '' });
        fetchAnnualLeaves();
      } else {
        const error = await response.json();
        alert(error.error);
      }
    } catch {
      alert('設定失敗，請稍後再試');
    }
  };

  const calculateYearsOfService = (hireDate: string) => {
    const hire = new Date(hireDate);
    const now = new Date();
    const years = now.getFullYear() - hire.getFullYear();
    const monthDiff = now.getMonth() - hire.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < hire.getDate())) {
      return years - 1;
    }
    return years;
  };

  const getAnnualLeaveDays = (yearsOfService: number) => {
    if (yearsOfService < 1) return 0;
    if (yearsOfService < 3) return 7;
    if (yearsOfService < 5) return 10;
    if (yearsOfService < 10) return 14;
    return Math.min(30, 14 + Math.floor((yearsOfService - 10) / 2));
  };

  const filteredAnnualLeaves = annualLeaves.filter(leave => {
    if (filters.search) {
      return (
        leave.employee.name.toLowerCase().includes(filters.search.toLowerCase()) ||
        leave.employee.employeeId.toLowerCase().includes(filters.search.toLowerCase()) ||
        leave.employee.department.toLowerCase().includes(filters.search.toLowerCase())
      );
    }
    return true;
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('zh-TW');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* 頁面標題 */}
          <div className="mb-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Calendar className="h-8 w-8 text-blue-600" />
                <h1 className="text-3xl font-bold text-gray-900">特休假管理</h1>
              </div>
              <button
                onClick={() => setShowSetupForm(true)}
                className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-5 w-5" />
                設定特休假
              </button>
            </div>
          </div>

          {/* 篩選區域 */}
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">年份</label>
              <select
                value={filters.year}
                onChange={(e) => setFilters({ ...filters, year: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
              <label className="block text-sm font-medium text-gray-700 mb-2">搜尋</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="員工姓名、工號或部門"
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                  className="pl-10 w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="flex items-end">
              <div className="text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  共 {filteredAnnualLeaves.length} 位員工
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 特休假記錄列表 */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">
              {filters.year}年度特休假統計
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    員工資訊
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    到職日期
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    服務年資
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    特休假總天數
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    已使用
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    剩餘天數
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    到期日
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredAnnualLeaves.map((leave) => (
                  <tr key={leave.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {leave.employee.name}
                        </div>
                        <div className="text-sm text-gray-500">
                          {leave.employee.employeeId} • {leave.employee.department}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(leave.employee.hireDate)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {leave.yearsOfService} 年
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {leave.totalDays} 天
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {leave.usedDays} 天
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`text-sm font-medium ${
                        leave.remainingDays > 5 ? 'text-green-600' :
                        leave.remainingDays > 0 ? 'text-yellow-600' : 'text-red-600'
                      }`}>
                        {leave.remainingDays} 天
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(leave.expiryDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filteredAnnualLeaves.length === 0 && (
              <div className="text-center py-12">
                <Calendar className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <p className="text-gray-500">暫無特休假記錄</p>
              </div>
            )}
          </div>
        </div>

        {/* 統計卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-6">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Users className="h-8 w-8 text-blue-600" />
              </div>
              <div className="ml-4">
                <div className="text-sm font-medium text-gray-500">員工總數</div>
                <div className="text-2xl font-bold text-gray-900">
                  {filteredAnnualLeaves.length}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Calendar className="h-8 w-8 text-green-600" />
              </div>
              <div className="ml-4">
                <div className="text-sm font-medium text-gray-500">特休假總天數</div>
                <div className="text-2xl font-bold text-gray-900">
                  {filteredAnnualLeaves.reduce((sum, leave) => sum + leave.totalDays, 0)}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Clock className="h-8 w-8 text-yellow-600" />
              </div>
              <div className="ml-4">
                <div className="text-sm font-medium text-gray-500">已使用天數</div>
                <div className="text-2xl font-bold text-gray-900">
                  {filteredAnnualLeaves.reduce((sum, leave) => sum + leave.usedDays, 0)}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Calendar className="h-8 w-8 text-red-600" />
              </div>
              <div className="ml-4">
                <div className="text-sm font-medium text-gray-500">剩餘天數</div>
                <div className="text-2xl font-bold text-gray-900">
                  {filteredAnnualLeaves.reduce((sum, leave) => sum + leave.remainingDays, 0)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 特休假設定表單 */}
      {showSetupForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">設定特休假</h3>
            
            <form onSubmit={handleSetupAnnualLeave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  員工 *
                </label>
                <select
                  value={setupForm.employeeId}
                  onChange={(e) => {
                    const employee = employees.find(emp => emp.id === parseInt(e.target.value));
                    setSetupForm({ 
                      ...setupForm, 
                      employeeId: e.target.value,
                      yearsOfService: employee ? calculateYearsOfService(employee.hireDate).toString() : ''
                    });
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="">請選擇員工</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name} ({employee.employeeId}) - {employee.department}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  年份 *
                </label>
                <select
                  value={setupForm.year}
                  onChange={(e) => setSetupForm({ ...setupForm, year: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
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
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  服務年資 *
                </label>
                <input
                  type="number"
                  min="0"
                  value={setupForm.yearsOfService}
                  onChange={(e) => setSetupForm({ ...setupForm, yearsOfService: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
                {setupForm.yearsOfService && (
                  <div className="mt-2 text-sm text-gray-600">
                    特休假天數：{getAnnualLeaveDays(parseInt(setupForm.yearsOfService))} 天
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowSetupForm(false);
                    setSetupForm({ employeeId: '', year: new Date().getFullYear().toString(), yearsOfService: '' });
                  }}
                  className="flex-1 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  設定特休假
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
    </AuthenticatedLayout>
  );
}
