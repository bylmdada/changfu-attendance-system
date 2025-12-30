'use client';

import { useState, useEffect, useCallback } from 'react';
import { Calendar, Plus, Search, Users, Clock, X, RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react';
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSetupForm, setShowSetupForm] = useState(false);
  const [filters, setFilters] = useState({
    year: new Date().getFullYear().toString(),
    search: '',
    department: ''
  });

  // 特休假設定表單
  const [setupForm, setSetupForm] = useState({
    employeeId: '',
    year: new Date().getFullYear().toString(),
    yearsOfService: ''
  });

  // 批量設定相關
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchYear, setBatchYear] = useState(new Date().getFullYear().toString());
  const [batchDepartment, setBatchDepartment] = useState('');
  const [batchEmployees, setBatchEmployees] = useState<{
    id: number;
    employeeId: string;
    name: string;
    department: string;
    hireDate: string;
    yearsOfService: number;
    monthsOfService: number;
    suggestedDays: number;
    status: string;
    hasExisting: boolean;
    existingDays: number;
  }[]>([]);
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<number>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [excludeExisting, setExcludeExisting] = useState(true);
  const [departments, setDepartments] = useState<string[]>([]);

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
          // 從員工資料中提取部門列表
          const deptList = [...new Set(employeesData.employees.map((e: Employee) => e.department))] as string[];
          setDepartments(deptList.sort());
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

  // 獲取批量計算結果
  const fetchBatchCalculation = useCallback(async () => {
    setBatchLoading(true);
    try {
      const token = localStorage.getItem('token');
      const url = new URL('/api/annual-leaves/batch', window.location.origin);
      url.searchParams.set('year', batchYear);
      if (batchDepartment) {
        url.searchParams.set('department', batchDepartment);
      }

      const response = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${token}` },
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setBatchEmployees(data.employees);
        
        // 取得部門列表
        const depts = [...new Set(data.employees.map((e: { department: string }) => e.department))] as string[];
        setDepartments(depts);
        
        // 預設選取「未設定」的員工
        const notSetIds = data.employees
          .filter((e: { status: string }) => e.status === 'NOT_SET')
          .map((e: { id: number }) => e.id);
        setSelectedBatchIds(new Set(notSetIds));
      }
    } catch (error) {
      console.error('獲取批量計算失敗:', error);
    } finally {
      setBatchLoading(false);
    }
  }, [batchYear, batchDepartment]);

  // 處理批量設定
  const handleBatchSetup = async () => {
    if (selectedBatchIds.size === 0) {
      alert('請選擇至少一位員工');
      return;
    }

    if (!confirm(`確定要為 ${selectedBatchIds.size} 位員工設定特休假嗎？`)) {
      return;
    }

    setBatchLoading(true);
    try {
      const response = await fetchJSONWithCSRF('/api/annual-leaves/batch', {
        method: 'POST',
        body: {
          year: parseInt(batchYear),
          employeeIds: Array.from(selectedBatchIds)
        }
      });

      if (response.ok) {
        const data = await response.json();
        alert(data.message);
        setShowBatchModal(false);
        setSelectedBatchIds(new Set());
        fetchAnnualLeaves();
      } else {
        const error = await response.json();
        alert(error.error || '批量設定失敗');
      }
    } catch (error) {
      console.error('批量設定失敗:', error);
      alert('批量設定失敗，請稍後再試');
    } finally {
      setBatchLoading(false);
    }
  };

  // 開啟批量設定模態框
  const openBatchModal = () => {
    setShowBatchModal(true);
    fetchBatchCalculation();
  };

  // 切換全選
  const toggleSelectAll = () => {
    const eligibleEmployees = batchEmployees.filter(e => 
      e.status !== 'NOT_ELIGIBLE' && (!excludeExisting || e.status !== 'ALREADY_SET')
    );
    
    if (selectedBatchIds.size === eligibleEmployees.length) {
      setSelectedBatchIds(new Set());
    } else {
      setSelectedBatchIds(new Set(eligibleEmployees.map(e => e.id)));
    }
  };

  // 切換單一選擇
  const toggleSelect = (id: number) => {
    const newSet = new Set(selectedBatchIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedBatchIds(newSet);
  };

  // 篩選批量員工
  const filteredBatchEmployees = batchEmployees.filter(e => {
    if (excludeExisting && e.status === 'ALREADY_SET') return false;
    return true;
  });

  // 計算統計
  const batchStats = {
    selected: selectedBatchIds.size,
    totalDays: batchEmployees
      .filter(e => selectedBatchIds.has(e.id))
      .reduce((sum, e) => sum + e.suggestedDays, 0)
  };

  const filteredAnnualLeaves = annualLeaves.filter(leave => {
    // 部門篩選
    if (filters.department && leave.employee.department !== filters.department) {
      return false;
    }
    // 搜尋篩選
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      return (
        leave.employee.name.toLowerCase().includes(searchLower) ||
        leave.employee.employeeId.toLowerCase().includes(searchLower) ||
        leave.employee.department.toLowerCase().includes(searchLower)
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
              <div className="flex items-center gap-3">
                <button
                  onClick={openBatchModal}
                  className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                >
                  <Users className="h-5 w-5" />
                  批量設定
                </button>
                <button
                  onClick={() => setShowSetupForm(true)}
                  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Plus className="h-5 w-5" />
                  設定特休假
                </button>
              </div>
            </div>
          </div>

          {/* 篩選區域 */}
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
              <label className="block text-sm font-medium text-gray-700 mb-2">部門</label>
              <select
                value={filters.department}
                onChange={(e) => setFilters({ ...filters, department: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
              >
                <option value="">全部部門</option>
                {departments.map(dept => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">搜尋</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="員工姓名或工號"
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                  className="pl-10 w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
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
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">設定特休假</h3>
              <button
                onClick={() => {
                  setShowSetupForm(false);
                  setSetupForm({ employeeId: '', year: new Date().getFullYear().toString(), yearsOfService: '' });
                }}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
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
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
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
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
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
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
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

      {/* 批量設定模態框 */}
      {showBatchModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] flex flex-col">
            {/* 標題 */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">批量設定特休假</h3>
                <p className="text-sm text-gray-500 mt-1">依據勞基法自動計算員工特休假天數</p>
              </div>
              <button
                onClick={() => {
                  setShowBatchModal(false);
                  setSelectedBatchIds(new Set());
                }}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* 篩選區域 */}
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">設定年度</label>
                  <select
                    value={batchYear}
                    onChange={(e) => {
                      setBatchYear(e.target.value);
                      fetchBatchCalculation();
                    }}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                  >
                    {Array.from({ length: 5 }, (_, i) => {
                      const year = new Date().getFullYear() - 2 + i;
                      return <option key={year} value={year}>{year}年</option>;
                    })}
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">部門篩選</label>
                  <select
                    value={batchDepartment}
                    onChange={(e) => {
                      setBatchDepartment(e.target.value);
                      fetchBatchCalculation();
                    }}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                  >
                    <option value="">全部部門</option>
                    {departments.map(dept => (
                      <option key={dept} value={dept}>{dept}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2 ml-4">
                  <input
                    type="checkbox"
                    id="excludeExisting"
                    checked={excludeExisting}
                    onChange={(e) => setExcludeExisting(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600"
                  />
                  <label htmlFor="excludeExisting" className="text-sm text-gray-700">
                    排除已設定員工
                  </label>
                </div>

                <button
                  onClick={fetchBatchCalculation}
                  disabled={batchLoading}
                  className="ml-auto flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${batchLoading ? 'animate-spin' : ''}`} />
                  重新計算
                </button>
              </div>
            </div>

            {/* 員工列表 */}
            <div className="flex-1 overflow-auto p-4">
              {batchLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <span className="ml-3 text-gray-600">計算中...</span>
                </div>
              ) : (
                <>
                  {/* 全選 */}
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-200">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedBatchIds.size > 0 && 
                          selectedBatchIds.size === filteredBatchEmployees.filter(e => e.status !== 'NOT_ELIGIBLE').length}
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300 text-blue-600"
                      />
                      <span className="text-sm font-medium text-gray-700">
                        全選 ({selectedBatchIds.size}/{filteredBatchEmployees.filter(e => e.status !== 'NOT_ELIGIBLE').length})
                      </span>
                    </label>
                    <div className="text-sm text-gray-500">
                      共 {batchEmployees.length} 位員工
                    </div>
                  </div>

                  {/* 員工列表 */}
                  <div className="space-y-2">
                    {filteredBatchEmployees.map(emp => (
                      <div
                        key={emp.id}
                        className={`flex items-center gap-4 p-3 rounded-lg border ${
                          selectedBatchIds.has(emp.id) 
                            ? 'border-blue-300 bg-blue-50' 
                            : emp.status === 'NOT_ELIGIBLE'
                              ? 'border-gray-200 bg-gray-50 opacity-50'
                              : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedBatchIds.has(emp.id)}
                          onChange={() => toggleSelect(emp.id)}
                          disabled={emp.status === 'NOT_ELIGIBLE'}
                          className="rounded border-gray-300 text-blue-600 disabled:opacity-50"
                        />
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">{emp.name}</span>
                            <span className="text-sm text-gray-500">{emp.employeeId}</span>
                            <span className="text-sm text-gray-500">• {emp.department}</span>
                          </div>
                          <div className="text-sm text-gray-500">
                            到職日：{new Date(emp.hireDate).toLocaleDateString('zh-TW')} · 
                            年資：{emp.yearsOfService}年{emp.monthsOfService}月
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-lg font-bold text-blue-600">
                            {emp.suggestedDays} 天
                          </div>
                          <div className="text-xs">
                            {emp.status === 'NOT_SET' && (
                              <span className="text-orange-600 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                未設定
                              </span>
                            )}
                            {emp.status === 'ALREADY_SET' && (
                              <span className="text-green-600 flex items-center gap-1">
                                <CheckCircle className="h-3 w-3" />
                                已設定 ({emp.existingDays}天)
                              </span>
                            )}
                            {emp.status === 'NOT_ELIGIBLE' && (
                              <span className="text-gray-500">未滿半年</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {filteredBatchEmployees.length === 0 && (
                    <div className="text-center py-12 text-gray-500">
                      <Users className="h-12 w-12 mx-auto mb-2 opacity-30" />
                      <p>沒有符合條件的員工</p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 底部操作區 */}
            <div className="p-4 border-t border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  📊 已選擇 <span className="font-bold text-blue-600">{batchStats.selected}</span> 人，
                  共計 <span className="font-bold text-blue-600">{batchStats.totalDays}</span> 天特休假
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowBatchModal(false);
                      setSelectedBatchIds(new Set());
                    }}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleBatchSetup}
                    disabled={batchLoading || selectedBatchIds.size === 0}
                    className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {batchLoading ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        處理中...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4" />
                        確認批量設定
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* 勞基法說明 */}
            <div className="p-4 bg-blue-50 border-t border-blue-100">
              <div className="text-sm text-blue-800">
                <strong>📖 勞基法特休假規則：</strong>
                <span className="ml-2">
                  6個月→3天 | 1年→7天 | 2年→10天 | 3年→14天 | 5年→15天 | 10年以上→每年加1天(最高30天)
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </AuthenticatedLayout>
  );
}
