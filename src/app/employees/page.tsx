'use client';

import { useState, useEffect, useRef } from 'react';
import { Users, Search, Plus, Edit, Trash2, Eye, Upload, Download, X, CheckCircle, XCircle } from 'lucide-react';
import { DEPARTMENT_OPTIONS, getPositionsByDepartment, type Department } from '@/constants/departments';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';

interface Employee {
  id: number;
  employeeId: string;
  name: string;
  birthday: string;
  phone: string;
  email: string;
  address: string;
  emergencyContact: string;
  emergencyPhone: string;
  hireDate: string;
  baseSalary: number;
  hourlyRate: number;
  department: string;
  position: string;
  isActive: boolean;
  employeeType?: string; // MONTHLY | HOURLY
  laborInsuranceActive?: boolean;
  user?: {
    username: string;
    role: string;
    isActive: boolean;
  };
  departmentManagers?: Array<{
    id: number;
    department: string;
    isPrimary: boolean;
  }>;
}

// 角色標籤
const ROLE_LABELS: Record<string, string> = {
  ADMIN: '管理員',
  HR: '人資',
  MANAGER: '主管',
  EMPLOYEE: '員工'
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    pages: 0
  });
  const [filters, setFilters] = useState({
    search: '',
    department: '',
    position: '',
    status: '',
    page: 1
  });
  const [showModal, setShowModal] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  useEffect(() => {
    // 設定頁面標題
    document.title = '員工管理 - 長福會考勤系統';
    loadUserAndEmployees();
  }, [filters.search, filters.department, filters.position, filters.status, filters.page]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadUserAndEmployees = async () => {
    try {
      // 載入員工數據
      await loadEmployees();
    } catch (error) {
      console.error('載入員工信息失敗:', error);
    }
  };

  const loadEmployees = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: filters.page.toString(),
        limit: '10'
      });
      
      if (filters.search) params.append('search', filters.search);
      if (filters.department) params.append('department', filters.department);
      if (filters.position) params.append('position', filters.position);
      if (filters.status) params.append('status', filters.status);

      const response = await fetch(`/api/employees?${params}`);
      if (response.ok) {
        const data = await response.json();
        setEmployees(data.employees);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('載入員工列表失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters(prev => ({ ...prev, page: 1 }));
  };

  const handleDelete = async (id: number) => {
    if (!confirm('確定要停用此員工嗎？')) return;

    try {
      const response = await fetchJSONWithCSRF(`/api/employees/${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        alert('員工已停用');
        loadEmployees();
      } else {
        alert('停用失敗');
      }
    } catch (error) {
      console.error('員工操作失敗:', error);
      alert('系統錯誤');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('zh-TW');
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('zh-TW', {
      style: 'currency',
      currency: 'TWD',
      minimumFractionDigits: 0
    }).format(amount);
  };

  return (
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* 頁面標題 */}
          <div className="mb-8 flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center">
                <Users className="mr-3 h-8 w-8" />
                員工管理
              </h1>
              <p className="mt-2 text-gray-600">管理公司員工資料</p>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={() => setShowBatchModal(true)}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg flex items-center transition-colors"
              >
                <Upload className="w-4 h-4 mr-2" />
                批量匯入
              </button>
              <button
                onClick={() => setShowModal(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center transition-colors"
              >
                <Plus className="w-4 h-4 mr-2" />
                新增員工
              </button>
            </div>
          </div>

          {/* 搜尋區域 */}
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="text"
                    value={filters.search}
                    onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                    placeholder="搜尋員工姓名、員工編號、部門或職位..."
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    suppressHydrationWarning
                  />
                </div>
              </div>
              <div className="w-full md:w-48">
                <select
                  value={filters.department}
                  onChange={(e) => setFilters(prev => ({ ...prev, department: e.target.value, page: 1 }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black bg-white"
                >
                  <option value="">所有部門</option>
                  {DEPARTMENT_OPTIONS.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-full md:w-40">
                <select
                  value={filters.position}
                  onChange={(e) => setFilters(prev => ({ ...prev, position: e.target.value, page: 1 }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black bg-white"
                >
                  <option value="">所有職位</option>
                  {filters.department && getPositionsByDepartment(filters.department as Department).map((pos) => (
                    <option key={pos} value={pos}>
                      {pos}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-full md:w-32">
                <select
                  value={filters.status}
                  onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value, page: 1 }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black bg-white"
                >
                  <option value="">所有狀態</option>
                  <option value="active">活躍</option>
                  <option value="inactive">停用</option>
                </select>
              </div>
              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition-colors"
              >
                搜尋
              </button>
            </form>
          </div>

          {/* 員工列表 */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">
                員工清單 ({pagination.total} 位員工)
              </h2>
            </div>

            {loading ? (
              <div className="p-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-2 text-gray-600">載入中...</p>
              </div>
            ) : employees.length === 0 ? (
              <div className="p-8 text-center">
                <Users className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">沒有找到員工</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          員工資訊
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          部門職位
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          角色
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          部門主管
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          到職日期
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          薪資
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          狀態
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          操作
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {employees.map((employee) => (
                        <tr key={employee.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="flex-shrink-0 h-10 w-10">
                                <div className="h-10 w-10 rounded-full bg-blue-600 flex items-center justify-center">
                                  <span className="text-white font-medium">
                                    {employee.name.charAt(0)}
                                  </span>
                                </div>
                              </div>
                              <div className="ml-4">
                                <div className="text-sm font-medium text-gray-900">
                                  {employee.name}
                                </div>
                                <div className="text-sm text-gray-500">
                                  {employee.employeeId}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{employee.department}</div>
                            <div className="text-sm text-gray-500">{employee.position}</div>
                          </td>
                          {/* 角色欄位 */}
                          <td className="px-6 py-4 whitespace-nowrap">
                            {employee.user ? (
                              <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                                employee.user.role === 'ADMIN' ? 'bg-purple-100 text-purple-800' :
                                employee.user.role === 'HR' ? 'bg-orange-100 text-orange-800' :
                                employee.user.role === 'MANAGER' ? 'bg-blue-100 text-blue-800' :
                                'bg-gray-100 text-gray-800'
                              }`}>
                                {ROLE_LABELS[employee.user.role] || employee.user.role}
                              </span>
                            ) : (
                              <span className="text-sm text-gray-400">無帳號</span>
                            )}
                          </td>
                          {/* 部門主管欄位 */}
                          <td className="px-6 py-4 whitespace-nowrap">
                            {employee.departmentManagers && employee.departmentManagers.length > 0 ? (
                              <div className="space-y-1">
                                {employee.departmentManagers.map((dm) => (
                                  <span key={dm.id} className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                                    dm.isPrimary ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                                  }`}>
                                    {dm.department} {dm.isPrimary ? '正' : '副'}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-sm text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {formatDate(employee.hireDate)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{formatCurrency(employee.baseSalary)}</div>
                            <div className="text-sm text-gray-500">時薪 {formatCurrency(employee.hourlyRate)}</div>
                          </td>
                          {/* 可編輯狀態 */}
                          <td className="px-6 py-4 whitespace-nowrap">
                            <select
                              value={employee.isActive ? 'active' : 'inactive'}
                              onChange={async (e) => {
                                const newStatus = e.target.value === 'active';
                                try {
                                  const response = await fetchJSONWithCSRF(`/api/employees/${employee.id}`, {
                                    method: 'PUT',
                                    body: { isActive: newStatus }
                                  });
                                  if (response.ok) {
                                    loadEmployees();
                                  } else {
                                    alert('更新狀態失敗');
                                  }
                                } catch {
                                  alert('系統錯誤');
                                }
                              }}
                              className={`text-xs font-medium rounded-full px-3 py-1 cursor-pointer ${
                                employee.isActive 
                                  ? 'bg-green-100 text-green-800' 
                                  : 'bg-red-100 text-red-800'
                              }`}
                            >
                              <option value="active">活躍</option>
                              <option value="inactive">停用</option>
                            </select>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                            <div className="flex space-x-2">
                              <button
                                onClick={() => setSelectedEmployee(employee)}
                                className="text-blue-600 hover:text-blue-900"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedEmployee(employee);
                                  setShowModal(true);
                                }}
                                className="text-green-600 hover:text-green-900"
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDelete(employee.id)}
                                className="text-red-600 hover:text-red-900"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 分頁 */}
                {pagination.pages > 1 && (
                  <div className="px-6 py-4 border-t border-gray-200">
                    <div className="flex items-center justify-between">
                      <div className="text-sm text-gray-700">
                        顯示第 {((pagination.page - 1) * pagination.limit) + 1} 到{' '}
                        {Math.min(pagination.page * pagination.limit, pagination.total)} 位員工，
                        共 {pagination.total} 位
                      </div>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => setFilters(prev => ({ ...prev, page: pagination.page - 1 }))}
                          disabled={pagination.page <= 1}
                          className="px-3 py-1 border border-gray-300 rounded text-sm text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                        >
                          上一頁
                        </button>
                        <span className="px-3 py-1 text-sm text-gray-700 bg-blue-50 border border-blue-200 rounded">
                          第 {pagination.page} 頁，共 {pagination.pages} 頁
                        </span>
                        <button
                          onClick={() => setFilters(prev => ({ ...prev, page: pagination.page + 1 }))}
                          disabled={pagination.page >= pagination.pages}
                          className="px-3 py-1 border border-gray-300 rounded text-sm text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                        >
                          下一頁
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* 員工詳情模態框 */}
      {selectedEmployee && !showModal && (
        <EmployeeDetailModal
          employee={selectedEmployee}
          onClose={() => setSelectedEmployee(null)}
        />
      )}

      {/* 新增/編輯員工模態框 */}
      {showModal && (
        <EmployeeModal
          employee={selectedEmployee}
          onClose={() => {
            setShowModal(false);
            setSelectedEmployee(null);
          }}
          onSave={loadEmployees}
        />
      )}

      {/* 批量匯入模態框 */}
      {showBatchModal && (
        <BatchImportModal
          onClose={() => setShowBatchModal(false)}
          onSuccess={loadEmployees}
        />
      )}
    </AuthenticatedLayout>
  );
}

// 員工詳情模態框組件
function EmployeeDetailModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('zh-TW');
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('zh-TW', {
      style: 'currency',
      currency: 'TWD',
      minimumFractionDigits: 0
    }).format(amount);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-gray-900">員工詳情</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4">基本資料</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700">員工編號</label>
                  <p className="text-sm text-gray-900">{employee.employeeId}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">姓名</label>
                  <p className="text-sm text-gray-900">{employee.name}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">生日</label>
                  <p className="text-sm text-gray-900">{formatDate(employee.birthday)}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">電話</label>
                  <p className="text-sm text-gray-900">{employee.phone}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">地址</label>
                  <p className="text-sm text-gray-900">{employee.address}</p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4">工作資訊</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700">部門</label>
                  <p className="text-sm text-gray-900">{employee.department}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">職位</label>
                  <p className="text-sm text-gray-900">{employee.position}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">到職日期</label>
                  <p className="text-sm text-gray-900">{formatDate(employee.hireDate)}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">底薪</label>
                  <p className="text-sm text-gray-900">{formatCurrency(employee.baseSalary)}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">時薪</label>
                  <p className="text-sm text-gray-900">{formatCurrency(employee.hourlyRate)}</p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4">緊急聯絡</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700">緊急聯絡人</label>
                  <p className="text-sm text-gray-900">{employee.emergencyContact}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">緊急聯絡電話</label>
                  <p className="text-sm text-gray-900">{employee.emergencyPhone}</p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4">帳號狀態</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700">員工狀態</label>
                  <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                    employee.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {employee.isActive ? '活躍' : '停用'}
                  </span>
                </div>
                {employee.user && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">系統帳號</label>
                      <p className="text-sm text-gray-900">{employee.user.username}</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">權限角色</label>
                      <p className="text-sm text-gray-900">{employee.user.role}</p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 新增/編輯員工模態框組件
function EmployeeModal({ employee, onClose, onSave }: { 
  employee: Employee | null; 
  onClose: () => void; 
  onSave: () => void; 
}) {
  // 生成員工編號的邏輯函數
  const generateEmployeeId = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    
    // 生成一個4位隨機數作為序號（實際應用中可能需要查詢數據庫來生成真正的序列號）
    const sequence = String(Math.floor(Math.random() * 9000) + 1000);
    
    return `${year}${month}${sequence}`;
  };

  // 生成默認密碼（員工編號 + 123）
  const generateDefaultPassword = (empId: string) => {
    return `${empId}123`;
  };

  const initialEmployeeId = employee?.employeeId || generateEmployeeId();
  
  const [formData, setFormData] = useState({
    employeeId: initialEmployeeId,
    name: employee?.name || '',
    birthday: employee?.birthday ? employee.birthday.split('T')[0] : '',
    phone: employee?.phone || '',
    email: employee?.email || '',
    address: employee?.address || '',
    emergencyContact: employee?.emergencyContact || '',
    emergencyPhone: employee?.emergencyPhone || '',
    hireDate: employee?.hireDate ? employee.hireDate.split('T')[0] : new Date().toISOString().split('T')[0],
    baseSalary: employee?.baseSalary?.toString() || '',
    hourlyRate: employee?.hourlyRate?.toString() || '',
    department: employee?.department || '',
    position: employee?.position || '',
    employeeType: employee?.employeeType || 'MONTHLY', // 月薪/計時
    laborInsuranceActive: employee?.laborInsuranceActive ?? true, // 勞保參加
    username: employee?.user?.username || initialEmployeeId,
    password: employee ? '' : generateDefaultPassword(initialEmployeeId),
    createAccount: !employee, // 新增員工時默認創建帳號
    role: employee?.user?.role || 'EMPLOYEE' // 角色欄位
  });
  const [saving, setSaving] = useState(false);
  const [availablePositions, setAvailablePositions] = useState<string[]>([]);
  const [autoCalculateHourlyRate, setAutoCalculateHourlyRate] = useState(!employee); // 新增時默認自動計算

  // 月基本工時（台灣勞基法：30天 x 8小時）
  const MONTHLY_BASE_HOURS = 240;

  // 自動計算時薪
  const calculateHourlyRate = (baseSalary: string) => {
    const salary = parseFloat(baseSalary);
    if (isNaN(salary) || salary <= 0) return '';
    return Math.round(salary / MONTHLY_BASE_HOURS).toString();
  };

  // 處理底薪變更
  const handleBaseSalaryChange = (value: string) => {
    setFormData(prev => ({
      ...prev,
      baseSalary: value,
      hourlyRate: autoCalculateHourlyRate ? calculateHourlyRate(value) : prev.hourlyRate
    }));
  };

  // 初始化職位選項
  useEffect(() => {
    if (formData.department) {
      const positions = getPositionsByDepartment(formData.department as Department);
      setAvailablePositions([...positions]);
    } else {
      setAvailablePositions([]);
    }
  }, [formData.department]);

  // 處理部門變更
  const handleDepartmentChange = (department: string) => {
    const positions = department ? getPositionsByDepartment(department as Department) : [];
    setAvailablePositions([...positions]);
    
    // 清空職位選擇（如果當前職位不在新部門的職位清單中）
    const currentPosition = formData.position;
    const isPositionValid = positions.includes(currentPosition);
    
    setFormData(prev => ({
      ...prev,
      department,
      position: isPositionValid ? currentPosition : ''
    }));
  };

  // 當員工編號改變時，自動更新默認密碼和用戶名
  const handleEmployeeIdChange = (value: string) => {
    setFormData(prev => ({
      ...prev,
      employeeId: value,
      username: !employee && (prev.username === prev.employeeId || !prev.username) ? value : prev.username,
      password: !employee ? generateDefaultPassword(value) : prev.password
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      // 獲取 CSRF token
      const csrfResponse = await fetch('/api/csrf-token', {
        credentials: 'include'
      });
      const csrfData = await csrfResponse.json();
      const csrfToken = csrfData.csrfToken;

      if (!csrfToken) {
        alert('無法獲取安全令牌，請刷新頁面重試');
        setSaving(false);
        return;
      }

      const url = employee ? `/api/employees/${employee.id}` : '/api/employees';
      const method = employee ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        credentials: 'include',
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        alert(employee ? '員工資料已更新' : '員工已新增');
        onSave();
        onClose();
      } else {
        const data = await response.json();
        alert(data.error || '操作失敗');
      }
    } catch (error) {
      console.error('操作失敗:', error);
      alert('系統錯誤');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-gray-900">
              {employee ? '編輯員工' : '新增員工'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {!employee && (
            <div className="mb-6 p-4 bg-green-50 rounded-lg border border-green-200">
              <h4 className="text-sm font-medium text-green-800 mb-2">📋 自動生成規則說明</h4>
              <ul className="text-xs text-green-700 space-y-1">
                <li>• <strong>員工編號</strong>：年月 + 4位隨機序號（如：202501{Math.floor(Math.random() * 1000 + 1000)}）</li>
                <li>• <strong>登入帳號</strong>：預設使用員工編號</li>
                <li>• <strong>預設密碼</strong>：員工編號 + &ldquo;123&rdquo;</li>
                <li>• <strong>到職日期</strong>：預設為今日</li>
              </ul>
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                員工編號 * 
                {!employee && <span className="text-xs text-gray-500 ml-2">(系統自動生成)</span>}
              </label>
              <input
                type="text"
                required
                value={formData.employeeId}
                onChange={(e) => handleEmployeeIdChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                placeholder="請輸入員工編號"
                disabled={!!employee} // 編輯時禁用員工編號修改
              />
              {!employee && (
                <p className="mt-1 text-xs text-gray-500">
                  格式：年月+4位序號（例：202501001）
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">姓名 *</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                placeholder="請輸入姓名"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">生日 *</label>
              <input
                type="date"
                required
                value={formData.birthday}
                onChange={(e) => setFormData({...formData, birthday: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">電話</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                placeholder="請輸入電話號碼"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                placeholder="請輸入 Email（用於系統通知）"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">地址</label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => setFormData({...formData, address: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                placeholder="請輸入地址"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">緊急聯絡人</label>
              <input
                type="text"
                value={formData.emergencyContact}
                onChange={(e) => setFormData({...formData, emergencyContact: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                placeholder="請輸入緊急聯絡人"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">緊急聯絡電話</label>
              <input
                type="tel"
                value={formData.emergencyPhone}
                onChange={(e) => setFormData({...formData, emergencyPhone: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                placeholder="請輸入緊急聯絡電話"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">到職日期 *</label>
              <input
                type="date"
                required
                value={formData.hireDate}
                onChange={(e) => setFormData({...formData, hireDate: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">底薪 *</label>
              <input
                type="number"
                required
                min="0"
                step="1"
                value={formData.baseSalary}
                onChange={(e) => handleBaseSalaryChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                placeholder="請輸入底薪"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">
                  時薪 {!autoCalculateHourlyRate && '*'}
                </label>
                <label className="flex items-center text-xs text-gray-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoCalculateHourlyRate}
                    onChange={(e) => {
                      setAutoCalculateHourlyRate(e.target.checked);
                      if (e.target.checked && formData.baseSalary) {
                        setFormData(prev => ({
                          ...prev,
                          hourlyRate: calculateHourlyRate(prev.baseSalary)
                        }));
                      }
                    }}
                    className="mr-1"
                  />
                  自動計算（底薪÷240）
                </label>
              </div>
              <input
                type="number"
                required={!autoCalculateHourlyRate}
                min="0"
                step="1"
                value={formData.hourlyRate}
                onChange={(e) => setFormData({...formData, hourlyRate: e.target.value})}
                className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black ${autoCalculateHourlyRate ? 'bg-gray-100' : ''}`}
                placeholder={autoCalculateHourlyRate ? '依底薪自動計算' : '請輸入時薪'}
                readOnly={autoCalculateHourlyRate}
              />
              {autoCalculateHourlyRate && formData.baseSalary && (
                <p className="mt-1 text-xs text-green-600">
                  ✓ 自動計算：{formData.baseSalary} ÷ 240 = {formData.hourlyRate} 元/小時
                </p>
              )}
            </div>

            {/* 員工類型 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">員工類型 *</label>
              <select
                value={formData.employeeType}
                onChange={(e) => setFormData({...formData, employeeType: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black bg-white"
                required
              >
                <option value="MONTHLY">月薪人員</option>
                <option value="HOURLY">計時人員</option>
              </select>
              {formData.employeeType === 'HOURLY' && (
                <p className="mt-1 text-xs text-orange-600">
                  ⚠ 計時人員薪資將以「時薪 × 實際工時」計算
                </p>
              )}
            </div>

            {/* 勞保設定 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">勞健保設定</label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.laborInsuranceActive}
                    onChange={(e) => setFormData({...formData, laborInsuranceActive: e.target.checked})}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">參加勞保</span>
                </label>
                {!formData.laborInsuranceActive && (
                  <p className="text-xs text-orange-600 ml-6">
                    ⚠ 不參加勞保：薪資計算時將不扣勞保費
                  </p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">部門</label>
              <select
                value={formData.department}
                onChange={(e) => handleDepartmentChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black bg-white"
                required
              >
                <option value="">請選擇部門</option>
                {DEPARTMENT_OPTIONS.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">職位</label>
              <select
                value={formData.position}
                onChange={(e) => setFormData({...formData, position: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black bg-white"
                required
                disabled={!formData.department}
              >
                <option value="">
                  {formData.department ? '請選擇職位' : '請先選擇部門'}
                </option>
                {availablePositions.map((position) => (
                  <option key={position} value={position}>
                    {position}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 帳號管理區域 */}
          <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <h4 className="text-lg font-medium text-blue-900 mb-4 flex items-center">
              <Users className="w-5 h-5 mr-2" />
              帳號管理
            </h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="flex items-center mb-2">
                  <input
                    type="checkbox"
                    checked={formData.createAccount}
                    onChange={(e) => setFormData({...formData, createAccount: e.target.checked})}
                    className="mr-2"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    {employee ? '更新帳號資訊' : '建立登入帳號'}
                  </span>
                </label>
              </div>
              
              {formData.createAccount && (
                <>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      登入帳號 {!employee && '*'}
                    </label>
                    <input
                      type="text"
                      value={formData.username}
                      onChange={(e) => setFormData({...formData, username: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                      placeholder="預設為員工編號"
                      required={!employee && formData.createAccount}
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      預設使用員工編號作為登入帳號
                    </p>
                  </div>
                  
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      預設密碼 {!employee && '*'}
                    </label>
                    <input
                      type="text"
                      value={formData.password}
                      onChange={(e) => setFormData({...formData, password: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                      placeholder="預設密碼"
                      required={!employee && formData.createAccount}
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      預設密碼格式：員工編號 + &ldquo;123&rdquo;（例：202501001123）
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 角色選擇區域 - 僅編輯時顯示 */}
          {employee && (
            <div className="mt-6 p-4 bg-purple-50 rounded-lg border border-purple-200">
              <h4 className="text-lg font-medium text-purple-900 mb-4 flex items-center">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                權限管理
              </h4>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  角色身份
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({...formData, role: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-black bg-white"
                >
                  <option value="EMPLOYEE">員工 (EMPLOYEE)</option>
                  <option value="HR">人資 (HR)</option>
                  <option value="ADMIN">管理員 (ADMIN)</option>
                </select>
                <p className="mt-2 text-xs text-purple-700">
                  ⚠️ 變更角色將影響該員工的系統權限
                </p>
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '儲存中...' : (employee ? '更新' : '新增')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// 批量匯入模態框組件
interface ImportResult {
  success: boolean;
  employeeId: string;
  name: string;
  error?: string;
}

interface ParsedEmployee {
  employeeId: string;
  name: string;
  birthday: string;
  phone: string;
  address: string;
  emergencyContact: string;
  emergencyPhone: string;
  hireDate: string;
  baseSalary: number;
  hourlyRate: number;
  department: string;
  position: string;
  employeeType: string; // MONTHLY | HOURLY
  laborInsuranceActive: boolean;
}

function BatchImportModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [step, setStep] = useState<'upload' | 'preview' | 'result'>('upload');
  const [parsedData, setParsedData] = useState<ParsedEmployee[]>([]);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDownloadTemplate = async () => {
    try {
      const response = await fetch('/api/employees/batch/template', {
        credentials: 'include'
      });
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'employee_import_template.csv';
        a.click();
        window.URL.revokeObjectURL(url);
      } else {
        alert('下載範本失敗');
      }
    } catch (err) {
      console.error('下載範本失敗:', err);
      alert('下載範本失敗');
    }
  };

  const parseCSV = (text: string): ParsedEmployee[] => {
    const lines = text.split('\n').filter(line => line.trim() && !line.trim().startsWith('#'));
    if (lines.length < 2) {
      throw new Error('CSV 檔案格式錯誤：至少需要標題行和一行資料');
    }

    const headers = lines[0].split(',').map(h => h.trim());
    const expectedHeaders = ['員工編號', '姓名', '生日', '電話', '地址', '緊急聯絡人', '緊急聯絡電話', '到職日期', '底薪', '時薪', '部門', '職位'];
    
    // 驗證標題（基本欄位必須存在，新欄位可選）
    const missingHeaders = expectedHeaders.filter((h, i) => headers[i] !== h);
    if (missingHeaders.length > 0) {
      throw new Error(`CSV 標題格式錯誤，缺少：${missingHeaders.join(', ')}`);
    }

    // 檢查是否有新欄位
    const hasEmployeeType = headers.includes('員工類型');
    const hasLaborInsurance = headers.includes('參加勞保');

    const employees: ParsedEmployee[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      // 允許員工編號為空（API 會自動生成），但必須有姓名
      if (values.length >= 12 && values[1]) {
        // 解析員工類型
        let employeeType = 'MONTHLY';
        if (hasEmployeeType && values[12]) {
          employeeType = values[12].toUpperCase() === 'HOURLY' ? 'HOURLY' : 'MONTHLY';
        }
        
        // 解析勞保參加狀態
        let laborInsuranceActive = true;
        if (hasLaborInsurance && values[13]) {
          laborInsuranceActive = values[13] !== '否' && values[13].toLowerCase() !== 'no' && values[13] !== '0';
        }

        employees.push({
          employeeId: values[0] || '', // 允許空值，API 會自動生成
          name: values[1],
          birthday: values[2],
          phone: values[3],
          address: values[4],
          emergencyContact: values[5],
          emergencyPhone: values[6],
          hireDate: values[7],
          baseSalary: parseInt(values[8]) || 0,
          hourlyRate: parseInt(values[9]) || 0,
          department: values[10],
          position: values[11],
          employeeType,
          laborInsuranceActive
        });
      }
    }

    return employees;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.csv')) {
      setError('請上傳 CSV 格式的檔案');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const employees = parseCSV(text);
        
        if (employees.length === 0) {
          setError('CSV 檔案中沒有有效的員工資料');
          return;
        }

        setParsedData(employees);
        setStep('preview');
        setError('');
      } catch (err) {
        setError(err instanceof Error ? err.message : '解析 CSV 失敗');
      }
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const response = await fetch('/api/employees/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ employees: parsedData })
      });

      const data = await response.json();
      
      if (response.ok) {
        setResults(data.results);
        setStep('result');
        if (data.summary.success > 0) {
          onSuccess();
        }
      } else {
        setError(data.error || '匯入失敗');
      }
    } catch (err) {
      console.error('匯入失敗:', err);
      setError('匯入失敗，請稍後再試');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-gray-900">
              {step === 'upload' && '批量匯入員工'}
              {step === 'preview' && '預覽匯入資料'}
              {step === 'result' && '匯入結果'}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="p-6">
          {/* 上傳步驟 */}
          {step === 'upload' && (
            <div className="space-y-6">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-medium text-blue-800 mb-2">使用說明</h3>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>• 請先下載 CSV 範本，按照格式填寫員工資料</li>
                  <li>• 員工編號可留空（系統自動生成），或填入現有編號</li>
                  <li>• 姓名、生日、到職日期、底薪、時薪、部門、職位為必填欄位</li>
                  <li>• 日期格式：YYYY-MM-DD（例：2025-01-01）</li>
                  <li>• <strong>員工類型</strong>：MONTHLY（月薪人員）或 HOURLY（計時人員），留空預設為月薪</li>
                  <li>• <strong>參加勞保</strong>：填「是」或「否」，計時人員可填「否」表示不參加勞保</li>
                  <li>• 計時人員底薪可填 0，系統將以「時薪 × 實際工時」計算薪資</li>
                  <li>• 系統將自動為每位員工創建登入帳號（帳號：員工編號，密碼：員工編號+123）</li>
                </ul>
              </div>

              <div className="flex justify-center">
                <button
                  onClick={handleDownloadTemplate}
                  className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  <Download className="w-4 h-4 mr-2" />
                  下載 CSV 範本
                </button>
              </div>

              <div 
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 mb-2">點擊或拖放 CSV 檔案到此處</p>
                <p className="text-sm text-gray-500">支援 .csv 格式</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* 預覽步驟 */}
          {step === 'preview' && (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-green-800">
                  已解析 <strong>{parsedData.length}</strong> 位員工資料，請確認後點擊匯入
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">員工編號</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">姓名</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">部門</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">職位</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">到職日期</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">底薪</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {parsedData.slice(0, 10).map((emp, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2 text-gray-900">{emp.employeeId}</td>
                        <td className="px-3 py-2 text-gray-900">{emp.name}</td>
                        <td className="px-3 py-2 text-gray-900">{emp.department}</td>
                        <td className="px-3 py-2 text-gray-900">{emp.position}</td>
                        <td className="px-3 py-2 text-gray-900">{emp.hireDate}</td>
                        <td className="px-3 py-2 text-gray-900">${emp.baseSalary.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedData.length > 10 && (
                  <p className="text-sm text-gray-500 mt-2 text-center">
                    ...還有 {parsedData.length - 10} 位員工未顯示
                  </p>
                )}
              </div>

              <div className="flex justify-between pt-4">
                <button
                  onClick={() => { setStep('upload'); setParsedData([]); }}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  返回
                </button>
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {importing ? '匯入中...' : `確認匯入 ${parsedData.length} 位員工`}
                </button>
              </div>
            </div>
          )}

          {/* 結果步驟 */}
          {step === 'result' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gray-50 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-gray-900">{results.length}</p>
                  <p className="text-sm text-gray-600">總數</p>
                </div>
                <div className="bg-green-50 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-green-600">{results.filter(r => r.success).length}</p>
                  <p className="text-sm text-green-600">成功</p>
                </div>
                <div className="bg-red-50 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-red-600">{results.filter(r => !r.success).length}</p>
                  <p className="text-sm text-red-600">失敗</p>
                </div>
              </div>

              <div className="max-h-60 overflow-y-auto">
                {results.map((result, idx) => (
                  <div 
                    key={idx}
                    className={`flex items-center justify-between p-3 rounded-lg mb-2 ${
                      result.success ? 'bg-green-50' : 'bg-red-50'
                    }`}
                  >
                    <div className="flex items-center">
                      {result.success ? (
                        <CheckCircle className="w-5 h-5 text-green-600 mr-2" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-600 mr-2" />
                      )}
                      <span className="font-medium">{result.employeeId}</span>
                      <span className="mx-2 text-gray-500">-</span>
                      <span>{result.name}</span>
                    </div>
                    {result.error && (
                      <span className="text-sm text-red-600">{result.error}</span>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-4">
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  完成
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
