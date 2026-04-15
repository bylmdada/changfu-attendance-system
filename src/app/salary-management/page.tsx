'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { 
  DollarSign, 
  Users, 
  TrendingUp, 
  History, 
  Plus, 
  Search,
  Calendar,
  CheckCircle,
  X
} from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import {
  buildAuthMeRequest,
  buildSalaryManagementListRequest,
} from '@/lib/admin-session-client';
import SystemNavbar from '@/components/SystemNavbar';
import ResponsiveSidebar from '@/components/ResponsiveSidebar';

interface Employee {
  id: number;
  employeeId: string;
  name: string;
  department: string | null;
  position: string | null;
  baseSalary: number;
  hourlyRate: number;
  hireDate: string;
  lastAdjustment: {
    date: string;
    type: string;
    amount: number | null;
  } | null;
}

interface SalaryHistory {
  id: number;
  effectiveDate: string;
  baseSalary: number;
  hourlyRate: number;
  previousSalary: number | null;
  adjustmentAmount: number | null;
  adjustmentType: string;
  reason: string | null;
  notes: string | null;
  approvedBy: string;
  createdAt: string;
}

interface Stats {
  totalEmployees: number;
  avgSalary: number;
  recentAdjustments: number;
}

const ADJUSTMENT_TYPES = {
  INITIAL: { label: '初始', color: 'bg-gray-100 text-gray-800' },
  RAISE: { label: '調薪', color: 'bg-green-100 text-green-800' },
  PROMOTION: { label: '晉升', color: 'bg-blue-100 text-blue-800' },
  ADJUSTMENT: { label: '調整', color: 'bg-yellow-100 text-yellow-800' }
};

export default function SalaryManagementPage() {
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('');
  const [departments, setDepartments] = useState<string[]>([]);
  
  // 詳情視窗
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [salaryHistory, setSalaryHistory] = useState<SalaryHistory[]>([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  
  // 調薪視窗
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustForm, setAdjustForm] = useState({
    employeeId: 0,
    effectiveDate: new Date().toISOString().split('T')[0],
    newBaseSalary: '',
    adjustmentType: 'RAISE',
    reason: '',
    notes: ''
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const authMeRequest = buildAuthMeRequest(window.location.origin);
        const response = await fetch(authMeRequest.url, authMeRequest.options);
        
        if (response.ok) {
          const userData = await response.json();
          const currentUser = userData.user || userData;
          
          if (currentUser.role !== 'ADMIN') {
            router.push('/dashboard');
            return;
          }
          setUser(currentUser);
          loadEmployees();
        } else if (response.status === 401 || response.status === 403) {
          console.warn('Authentication failed, redirecting to login');
          router.push('/login');
        } else {
          router.push('/login');
        }
      } catch (error) {
        console.error('驗證失敗:', error);
        router.push('/login');
      }
    };

    fetchUser();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function loadEmployees() {
    try {
      setLoading(true);
      const request = buildSalaryManagementListRequest(window.location.origin);
      const res = await fetch(request.url, request.options);
      
      if (res.status === 401) {
        router.push('/login');
        return;
      }
      
      const data = await res.json();
      
      if (data.success) {
        setEmployees(data.employees);
        setStats(data.stats);
        
        // 提取部門列表
        const depts = [...new Set(data.employees.map((e: Employee) => e.department).filter(Boolean))] as string[];
        setDepartments(depts);
      }
    } catch (error) {
      console.error('載入員工資料失敗:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadSalaryHistory(employeeId: number) {
    try {
      const res = await fetch(`/api/salary-management?type=history&employeeId=${employeeId}`, {
        credentials: 'include'
      });
      const data = await res.json();
      
      if (data.success) {
        setSalaryHistory(data.history);
      }
    } catch (error) {
      console.error('載入薪資歷史失敗:', error);
    }
  }

  function openHistoryModal(employee: Employee) {
    setSelectedEmployee(employee);
    loadSalaryHistory(employee.id);
    setShowHistoryModal(true);
  }

  function openAdjustModal(employee: Employee) {
    setSelectedEmployee(employee);
    setAdjustForm({
      employeeId: employee.id,
      effectiveDate: new Date().toISOString().split('T')[0],
      newBaseSalary: String(employee.baseSalary),
      adjustmentType: 'RAISE',
      reason: '',
      notes: ''
    });
    setShowAdjustModal(true);
  }

  async function handleSaveAdjustment() {
    if (!adjustForm.newBaseSalary) {
      setMessage({ type: 'error', text: '請輸入新薪資' });
      return;
    }

    try {
      setSaving(true);
      const response = await fetchJSONWithCSRF('/api/salary-management', {
        method: 'POST',
        body: adjustForm
      });
      
      const res = await response.json();

      if (res.success) {
        setMessage({ type: 'success', text: res.message });
        setShowAdjustModal(false);
        loadEmployees();
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: res.error || '調薪失敗' });
      }
    } catch (error) {
      console.error('調薪失敗:', error);
      setMessage({ type: 'error', text: '系統錯誤' });
    } finally {
      setSaving(false);
    }
  }

  // 篩選員工
  const filteredEmployees = employees.filter(e => {
    const matchSearch = !searchTerm || 
      e.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.employeeId.toLowerCase().includes(searchTerm.toLowerCase());
    const matchDept = !filterDepartment || e.department === filterDepartment;
    return matchSearch && matchDept;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 響應式側邊欄 */}
      <ResponsiveSidebar user={user} />
      
      {/* 頂部導航 */}
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />
      
      {/* 主要內容 - 桌面版需偏移側邊欄寬度 */}
      <main className="lg:pl-64 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 標題區 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <DollarSign className="w-8 h-8 text-green-600 mr-3" />
            薪資管理
          </h1>
          <p className="text-gray-600 mt-2">員工薪資調整、薪資歷史查詢</p>
        </div>

        {/* 訊息 */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg ${
            message.type === 'success' 
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}>
            {message.text}
          </div>
        )}

        {/* 統計卡片 */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="flex items-center">
                <Users className="w-8 h-8 text-blue-500 mr-3" />
                <div>
                  <p className="text-sm text-gray-500">在職員工數</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.totalEmployees}</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="flex items-center">
                <DollarSign className="w-8 h-8 text-green-500 mr-3" />
                <div>
                  <p className="text-sm text-gray-500">平均月薪</p>
                  <p className="text-2xl font-bold text-gray-900">${stats.avgSalary.toLocaleString()}</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="flex items-center">
                <TrendingUp className="w-8 h-8 text-purple-500 mr-3" />
                <div>
                  <p className="text-sm text-gray-500">近30天調薪</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.recentAdjustments} 人</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 搜尋篩選 */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="搜尋員工姓名或工號..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
            <select
              value={filterDepartment}
              onChange={(e) => setFilterDepartment(e.target.value)}
              className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">全部部門</option>
              {departments.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 員工列表 */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  員工
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  部門/職位
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  月薪
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  時薪
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  最近調薪
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredEmployees.map((employee) => (
                <tr key={employee.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="font-medium text-gray-900">{employee.name}</div>
                    <div className="text-sm text-gray-500">{employee.employeeId}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{employee.department || '-'}</div>
                    <div className="text-sm text-gray-500">{employee.position || '-'}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <span className="text-lg font-semibold text-gray-900">
                      ${employee.baseSalary.toLocaleString()}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <span className="text-sm text-gray-600">
                      ${employee.hourlyRate.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {employee.lastAdjustment ? (
                      <div>
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          ADJUSTMENT_TYPES[employee.lastAdjustment.type as keyof typeof ADJUSTMENT_TYPES]?.color || 'bg-gray-100'
                        }`}>
                          {ADJUSTMENT_TYPES[employee.lastAdjustment.type as keyof typeof ADJUSTMENT_TYPES]?.label || employee.lastAdjustment.type}
                        </span>
                        <div className="text-xs text-gray-500 mt-1">
                          {employee.lastAdjustment.date}
                          {employee.lastAdjustment.amount && (
                            <span className={employee.lastAdjustment.amount > 0 ? 'text-green-600 ml-1' : 'text-red-600 ml-1'}>
                              {employee.lastAdjustment.amount > 0 ? '+' : ''}{employee.lastAdjustment.amount.toLocaleString()}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <button
                      onClick={() => openHistoryModal(employee)}
                      className="text-blue-600 hover:text-blue-800 mr-3"
                      title="查看歷史"
                    >
                      <History className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => openAdjustModal(employee)}
                      className="text-green-600 hover:text-green-800"
                      title="調薪"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {filteredEmployees.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              沒有符合條件的員工
            </div>
          )}
        </div>

        {/* 薪資歷史視窗 */}
        {showHistoryModal && selectedEmployee && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden m-4">
              <div className="flex justify-between items-center px-6 py-4 border-b">
                <h3 className="text-lg font-semibold text-gray-900">
                  {selectedEmployee.name} 的薪資歷史
                </h3>
                <button
                  onClick={() => setShowHistoryModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="px-6 py-4 bg-gray-50">
                <div className="flex justify-between">
                  <div>
                    <span className="text-gray-500">目前月薪：</span>
                    <span className="font-semibold text-gray-900 ml-2">${selectedEmployee.baseSalary.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">時薪：</span>
                    <span className="font-semibold text-gray-900 ml-2">${selectedEmployee.hourlyRate.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">入職日：</span>
                    <span className="text-gray-900 ml-2">{selectedEmployee.hireDate}</span>
                  </div>
                </div>
              </div>

              <div className="overflow-y-auto max-h-[50vh]">
                {salaryHistory.length > 0 ? (
                  <div className="divide-y">
                    {salaryHistory.map((h) => (
                      <div key={h.id} className="px-6 py-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              ADJUSTMENT_TYPES[h.adjustmentType as keyof typeof ADJUSTMENT_TYPES]?.color || 'bg-gray-100'
                            }`}>
                              {ADJUSTMENT_TYPES[h.adjustmentType as keyof typeof ADJUSTMENT_TYPES]?.label || h.adjustmentType}
                            </span>
                            <span className="text-sm text-gray-500 ml-2">
                              生效日期：{h.effectiveDate}
                            </span>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold">${h.baseSalary.toLocaleString()}</div>
                            {h.adjustmentAmount && (
                              <div className={`text-sm ${h.adjustmentAmount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {h.adjustmentAmount > 0 ? '+' : ''}{h.adjustmentAmount.toLocaleString()}
                              </div>
                            )}
                          </div>
                        </div>
                        {h.reason && (
                          <p className="text-sm text-gray-600 mt-2">{h.reason}</p>
                        )}
                        <div className="text-xs text-gray-400 mt-2">
                          核准人：{h.approvedBy} | 建立時間：{new Date(h.createdAt).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    尚無薪資歷史記錄
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 調薪視窗 */}
        {showAdjustModal && selectedEmployee && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full m-4">
              <div className="flex justify-between items-center px-6 py-4 border-b">
                <h3 className="text-lg font-semibold text-gray-900">
                  調整薪資 - {selectedEmployee.name}
                </h3>
                <button
                  onClick={() => setShowAdjustModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="px-6 py-4 space-y-4">
                <div className="bg-gray-50 rounded-lg p-3">
                  <span className="text-gray-500">目前月薪：</span>
                  <span className="font-semibold ml-2">${selectedEmployee.baseSalary.toLocaleString()}</span>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Calendar className="inline w-4 h-4 mr-1" />
                    生效日期
                  </label>
                  <input
                    type="date"
                    value={adjustForm.effectiveDate}
                    onChange={(e) => setAdjustForm({ ...adjustForm, effectiveDate: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <DollarSign className="inline w-4 h-4 mr-1" />
                    新月薪
                  </label>
                  <input
                    type="number"
                    value={adjustForm.newBaseSalary}
                    onChange={(e) => setAdjustForm({ ...adjustForm, newBaseSalary: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="輸入新月薪"
                  />
                  {adjustForm.newBaseSalary && (
                    <div className="text-sm text-gray-500 mt-1">
                      調整金額：
                      <span className={Number(adjustForm.newBaseSalary) > selectedEmployee.baseSalary ? 'text-green-600' : 'text-red-600'}>
                        {Number(adjustForm.newBaseSalary) > selectedEmployee.baseSalary ? '+' : ''}
                        {(Number(adjustForm.newBaseSalary) - selectedEmployee.baseSalary).toLocaleString()}
                      </span>
                      {' | 新時薪：$'}
                      {(Number(adjustForm.newBaseSalary) / 240).toFixed(2)}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    調整類型
                  </label>
                  <select
                    value={adjustForm.adjustmentType}
                    onChange={(e) => setAdjustForm({ ...adjustForm, adjustmentType: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="RAISE">調薪</option>
                    <option value="PROMOTION">晉升</option>
                    <option value="ADJUSTMENT">調整</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    調整原因
                  </label>
                  <input
                    type="text"
                    value={adjustForm.reason}
                    onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="例：年度調薪、表現優異"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    備註（選填）
                  </label>
                  <textarea
                    value={adjustForm.notes}
                    onChange={(e) => setAdjustForm({ ...adjustForm, notes: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    rows={2}
                    placeholder="其他備註..."
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 px-6 py-4 border-t">
                <button
                  onClick={() => setShowAdjustModal(false)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveAdjustment}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center"
                >
                  {saving ? (
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></span>
                  ) : (
                    <CheckCircle className="w-4 h-4 mr-2" />
                  )}
                  確認調薪
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
