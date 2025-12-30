'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  Calendar, 
  Clock, 
  User, 
  CalendarDays,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Gift,
  TrendingUp,
  FileText,
  Users,
  Filter
} from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';

interface Employee {
  id: number;
  employeeId: string;
  name: string;
  department: string;
  position: string;
  hireDate: string;
  yearsOfService: number;
  grantDate?: string;
  legalDays: number;
}

interface LeaveData {
  totalDays: number;
  usedDays: number;
  remainingDays: number;
  expiryDate: string;
  daysToExpiry: number | null;
  isExpired?: boolean;
}

interface LeaveRequest {
  id: number;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string | null;
  status: string;
  createdAt: string;
}

interface LegalReference {
  years: string;
  days: number | string;
}

interface EmployeeWithLeave extends Employee {
  currentYear: {
    totalDays: number;
    usedDays: number;
    remainingDays: number;
    expiryDate: string;
    daysToExpiry: number | null;
  } | null;
  lastYear: {
    remainingDays: number;
    expiryDate: string;
  } | null;
}

interface PersonalData {
  success: boolean;
  isAdmin: boolean;
  employee: Employee;
  currentYear: {
    year: number;
    data: LeaveData | null;
  };
  lastYear: {
    year: number;
    data: LeaveData | null;
  };
  recentLeaveRequests: LeaveRequest[];
  legalReference: LegalReference[];
}

interface AdminData {
  success: boolean;
  isAdmin: true;
  departments: string[];
  employees: EmployeeWithLeave[];
  currentYear: number;
  lastYear: number;
}

export default function MyAnnualLeavePage() {
  const [personalData, setPersonalData] = useState<PersonalData | null>(null);
  const [adminData, setAdminData] = useState<AdminData | null>(null);
  const [viewMode, setViewMode] = useState<'personal' | 'all'>('personal');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const fetchPersonalData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/my-annual-leave', {
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error('無法取得特休假資料');
      }

      const result = await response.json();
      setPersonalData(result);
      setIsAdmin(result.isAdmin || false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '系統錯誤');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAdminData = useCallback(async (dept: string) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ mode: 'all' });
      if (dept !== 'all') {
        params.set('department', dept);
      }
      
      const response = await fetch(`/api/my-annual-leave?${params}`, {
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error('無法取得員工特休假資料');
      }

      const result = await response.json();
      setAdminData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '系統錯誤');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = '特休假查詢 - 長福會考勤系統';
    fetchPersonalData();
  }, [fetchPersonalData]);

  useEffect(() => {
    if (viewMode === 'all' && isAdmin) {
      fetchAdminData(selectedDepartment);
    }
  }, [viewMode, selectedDepartment, isAdmin, fetchAdminData]);

  const handleRefresh = () => {
    if (viewMode === 'personal') {
      fetchPersonalData();
    } else {
      fetchAdminData(selectedDepartment);
    }
  };

  if (loading && !personalData && !adminData) {
    return (
      <AuthenticatedLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="flex flex-col items-center gap-4">
            <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
            <p className="text-gray-600">載入特休假資料中...</p>
          </div>
        </div>
      </AuthenticatedLayout>
    );
  }

  if (error) {
    return (
      <AuthenticatedLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <p className="text-gray-600">{error}</p>
            <button 
              onClick={handleRefresh}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              重試
            </button>
          </div>
        </div>
      </AuthenticatedLayout>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 頁面標題 */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-blue-100 rounded-lg">
            <Calendar className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">特休假查詢</h1>
            <p className="text-gray-600">
              {viewMode === 'personal' ? '查看您的年度特休假狀況' : '查看全部員工特休假狀況'}
            </p>
          </div>
          
          {/* 管理員視圖切換 */}
          {isAdmin && (
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setViewMode('personal')}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                  viewMode === 'personal'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <User className="w-4 h-4" />
                個人
              </button>
              <button
                onClick={() => setViewMode('all')}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                  viewMode === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Users className="w-4 h-4" />
                全部員工
              </button>
            </div>
          )}
          
          <button 
            onClick={handleRefresh}
            className={`p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors ${!isAdmin ? 'ml-auto' : ''}`}
            title="重新整理"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* 管理員全部員工視圖 */}
        {viewMode === 'all' && isAdmin && adminData && (
          <>
            {/* 部門篩選器 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-gray-600">
                  <Filter className="w-5 h-5" />
                  <span className="font-medium">部門篩選：</span>
                </div>
                <select
                  value={selectedDepartment}
                  onChange={(e) => setSelectedDepartment(e.target.value)}
                  className="px-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="all">全部部門</option>
                  {adminData.departments.map((dept) => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
                <span className="text-gray-500 text-sm">
                  共 {adminData.employees.length} 位員工
                </span>
              </div>
            </div>

            {/* 員工列表表格 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">員工</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">部門</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">到職日</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">年資</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                        {adminData.currentYear}年度
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                        應給/已用/剩餘
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                        延休({adminData.lastYear}年)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {adminData.employees.map((emp) => (
                      <tr key={emp.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div>
                            <div className="font-medium text-gray-900">{emp.name}</div>
                            <div className="text-xs text-gray-500">{emp.employeeId}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{emp.department || '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {new Date(emp.hireDate).toLocaleDateString('zh-TW')}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-gray-900">{emp.yearsOfService} 年</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {emp.currentYear ? (
                            <span className={`inline-flex items-center gap-1 ${
                              emp.currentYear.daysToExpiry !== null && emp.currentYear.daysToExpiry <= 30
                                ? 'text-orange-600'
                                : 'text-gray-600'
                            }`}>
                              {emp.currentYear.daysToExpiry !== null && emp.currentYear.daysToExpiry <= 30 && (
                                <AlertTriangle className="w-3 h-3" />
                              )}
                              {new Date(emp.currentYear.expiryDate).toLocaleDateString('zh-TW')}
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {emp.currentYear ? (
                            <div className="flex items-center justify-center gap-1 text-sm">
                              <span className="text-gray-600">{emp.currentYear.totalDays}</span>
                              <span className="text-gray-400">/</span>
                              <span className="text-blue-600">{emp.currentYear.usedDays}</span>
                              <span className="text-gray-400">/</span>
                              <span className={`font-bold ${emp.currentYear.remainingDays > 0 ? 'text-green-600' : 'text-gray-500'}`}>
                                {emp.currentYear.remainingDays}
                              </span>
                            </div>
                          ) : (
                            <span className="text-gray-400">未設定</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {emp.lastYear ? (
                            <span className="font-medium text-orange-600">{emp.lastYear.remainingDays} 天</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* 個人視圖 */}
        {viewMode === 'personal' && personalData && (
          <>
            {/* 基本資訊卡片 */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 text-white mb-8">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div>
                  <div className="flex items-center gap-2 text-blue-100 text-sm mb-1">
                    <User className="w-4 h-4" />
                    <span>員工姓名</span>
                  </div>
                  <p className="text-xl font-bold">{personalData.employee.name}</p>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-blue-100 text-sm mb-1">
                    <CalendarDays className="w-4 h-4" />
                    <span>到職日</span>
                  </div>
                  <p className="text-xl font-bold">{new Date(personalData.employee.hireDate).toLocaleDateString('zh-TW')}</p>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-blue-100 text-sm mb-1">
                    <TrendingUp className="w-4 h-4" />
                    <span>年資</span>
                  </div>
                  <p className="text-xl font-bold">{personalData.employee.yearsOfService} 年</p>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-blue-100 text-sm mb-1">
                    <Gift className="w-4 h-4" />
                    <span>本年度給假日</span>
                  </div>
                  <p className="text-xl font-bold">
                    {personalData.employee.grantDate 
                      ? new Date(personalData.employee.grantDate).toLocaleDateString('zh-TW')
                      : '-'}
                  </p>
                </div>
              </div>
            </div>

            {/* 特休假卡片區 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {/* 本年度特休 */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="bg-green-50 px-6 py-4 border-b border-green-100">
                  <h2 className="text-lg font-bold text-green-900 flex items-center gap-2">
                    <Calendar className="w-5 h-5" />
                    {personalData.currentYear.year}年度 特休假
                  </h2>
                </div>
                <div className="p-6">
                  {personalData.currentYear.data ? (
                    <>
                      <div className="flex items-center justify-center mb-6">
                        <div className="relative w-32 h-32">
                          <svg className="w-full h-full transform -rotate-90">
                            <circle cx="64" cy="64" r="56" stroke="#e5e7eb" strokeWidth="12" fill="none" />
                            <circle
                              cx="64" cy="64" r="56"
                              stroke="#22c55e"
                              strokeWidth="12"
                              fill="none"
                              strokeDasharray={`${(personalData.currentYear.data.usedDays / personalData.currentYear.data.totalDays) * 352} 352`}
                              strokeLinecap="round"
                            />
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-3xl font-bold text-gray-900">{personalData.currentYear.data.remainingDays}</span>
                            <span className="text-sm text-gray-500">剩餘天數</span>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div className="flex justify-between"><span className="text-gray-600">應給天數</span><span className="font-bold text-gray-900">{personalData.currentYear.data.totalDays} 天</span></div>
                        <div className="flex justify-between"><span className="text-gray-600">已使用</span><span className="font-bold text-blue-600">{personalData.currentYear.data.usedDays} 天</span></div>
                        <div className="flex justify-between"><span className="text-gray-600">剩餘可休</span><span className="font-bold text-green-600">{personalData.currentYear.data.remainingDays} 天</span></div>
                        <div className="border-t pt-3">
                          <div className="flex justify-between"><span className="text-gray-600">到期日</span><span className="font-medium text-gray-900">{new Date(personalData.currentYear.data.expiryDate).toLocaleDateString('zh-TW')}</span></div>
                          {personalData.currentYear.data.daysToExpiry !== null && personalData.currentYear.data.daysToExpiry <= 90 && (
                            <div className="mt-2 p-2 bg-yellow-50 rounded-lg text-sm text-yellow-800 flex items-center gap-2">
                              <AlertTriangle className="w-4 h-4" />還有 {personalData.currentYear.data.daysToExpiry} 天到期
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <Calendar className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                      <p>本年度尚未設定特休假額度</p>
                    </div>
                  )}
                </div>
              </div>

              {/* 去年延休 */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="bg-orange-50 px-6 py-4 border-b border-orange-100">
                  <h2 className="text-lg font-bold text-orange-900 flex items-center gap-2">
                    <Clock className="w-5 h-5" />
                    {personalData.lastYear.year}年度 延休
                  </h2>
                </div>
                <div className="p-6">
                  {personalData.lastYear.data ? (
                    personalData.lastYear.data.isExpired ? (
                      <div className="text-center py-8">
                        <CheckCircle className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                        <p className="text-gray-500">延休已過期</p>
                      </div>
                    ) : (
                      <>
                        <div className="text-center mb-6">
                          <div className="inline-flex items-center justify-center w-24 h-24 bg-orange-100 rounded-full">
                            <span className="text-3xl font-bold text-orange-600">{personalData.lastYear.data.remainingDays}</span>
                          </div>
                          <p className="mt-2 text-gray-600">延休剩餘天數</p>
                        </div>
                        <div className="space-y-3">
                          <div className="flex justify-between"><span className="text-gray-600">原始應給</span><span>{personalData.lastYear.data.totalDays} 天</span></div>
                          <div className="flex justify-between"><span className="text-gray-600">已使用</span><span className="text-blue-600">{personalData.lastYear.data.usedDays} 天</span></div>
                          <div className="border-t pt-3">
                            <div className="flex justify-between"><span className="text-gray-600">延休到期日</span><span>{new Date(personalData.lastYear.data.expiryDate).toLocaleDateString('zh-TW')}</span></div>
                          </div>
                        </div>
                      </>
                    )
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <Clock className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                      <p>無延休額度</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 近期請假紀錄 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-8">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <FileText className="w-5 h-5" />近期特休請假紀錄
                </h2>
              </div>
              <div className="overflow-x-auto">
                {personalData.recentLeaveRequests.length > 0 ? (
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">日期區間</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">天數</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">事由</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">狀態</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {personalData.recentLeaveRequests.map((req) => (
                        <tr key={req.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 text-sm text-gray-900">
                            {new Date(req.startDate).toLocaleDateString('zh-TW')} ~ {new Date(req.endDate).toLocaleDateString('zh-TW')}
                          </td>
                          <td className="px-6 py-4 text-sm font-medium">{req.totalDays} 天</td>
                          <td className="px-6 py-4 text-sm text-gray-600">{req.reason || '-'}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                              req.status === 'APPROVED' ? 'bg-green-100 text-green-800' : 
                              req.status === 'PENDING' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'
                            }`}>
                              {req.status === 'APPROVED' ? '已核准' : req.status === 'PENDING' ? '待審核' : req.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p>暫無特休請假紀錄</p>
                  </div>
                )}
              </div>
            </div>

            {/* 勞基法參考 */}
            <div className="bg-gray-50 rounded-xl p-6">
              <h3 className="font-bold text-gray-900 mb-4">📚 勞基法特休假規定（年資對照表）</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {personalData.legalReference.map((ref, index) => (
                  <div key={index} className="bg-white rounded-lg p-4 border border-gray-200">
                    <p className="text-sm text-gray-600">{ref.years}</p>
                    <p className="text-lg font-bold text-blue-600">{ref.days} 天</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-4">
                ※ 依據勞動基準法第38條規定，特休假未休完得遞延至次一年度實施。
              </p>
            </div>
          </>
        )}
      </div>
    </AuthenticatedLayout>
  );
}
