'use client';

import { useState, useEffect } from 'react';
import { Shield, Plus, Pencil, Trash2, User, Calendar, Clock, RefreshCw, XCircle } from 'lucide-react';
import { DEPARTMENT_OPTIONS } from '@/constants/departments';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import SystemNavbar from '@/components/SystemNavbar';

interface Employee {
  id: number;
  employeeId: string;
  name: string;
  department: string;
  position: string;
}

interface AttendancePermission {
  id: number;
  employeeId: number;
  employee: Employee;
  permissions: {
    leaveRequests: string[]; // 可審核的部門列表
    overtimeRequests: string[];
    shiftExchanges: string[];
    scheduleManagement: string[];
  };
  createdAt: string;
  updatedAt: string;
}

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

// 權限類型標籤
const PERMISSION_LABELS = {
  leaveRequests: '請假申請審核',
  overtimeRequests: '加班申請審核',
  shiftExchanges: '調班申請審核',
  scheduleManagement: '班表管理權限'
};

// 權限描述
const PERMISSION_DESCRIPTIONS = {
  leaveRequests: '可以審核指定部門的員工請假申請',
  overtimeRequests: '可以審核指定部門的員工加班申請',
  shiftExchanges: '可以審核指定部門的員工調班申請',
  scheduleManagement: '可以管理指定部門的員工班表'
};

// 使用常數檔案中的部門選項
const DEPARTMENTS = DEPARTMENT_OPTIONS;

export default function AttendancePermissionsPage() {
  const [permissions, setPermissions] = useState<AttendancePermission[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingPermission, setEditingPermission] = useState<AttendancePermission | null>(null);

  // 新增權限表單狀態
  const [newPermission, setNewPermission] = useState({
    employeeId: '',
    leaveRequests: [] as string[],
    overtimeRequests: [] as string[],
    shiftExchanges: [] as string[],
    scheduleManagement: [] as string[]
  });

  // 編輯權限表單狀態
  const [editForm, setEditForm] = useState({
    employeeId: '',
    leaveRequests: [] as string[],
    overtimeRequests: [] as string[],
    shiftExchanges: [] as string[],
    scheduleManagement: [] as string[]
  });

  // Helper function to get auth headers
  const getAuthHeaders = (): HeadersInit => {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  // 載入數據
  useEffect(() => {
    const fetchData = async () => {
      try {
        // 檢查用戶權限
        const userRes = await fetch('/api/auth/me', { 
          credentials: 'include',
          headers: getAuthHeaders()
        });
        if (userRes.ok) {
          const userData = await userRes.json();
          const currentUser = userData.user || userData;
          
          if (currentUser.role !== 'ADMIN') {
            window.location.href = '/dashboard';
            return;
          }
          setUser(currentUser);
        } else if (userRes.status === 401 || userRes.status === 403) {
          console.warn('Authentication failed, redirecting to login');
          window.location.href = '/login';
          return;
        } else {
          window.location.href = '/login';
          return;
        }

        // 載入員工列表
        const employeesRes = await fetch('/api/employees', { credentials: 'include' });
        if (employeesRes.ok) {
          const employeesData = await employeesRes.json();
          const employeeList = Array.isArray(employeesData) ? employeesData : employeesData.employees || [];
          setEmployees(employeeList);
        }

        // 載入考勤權限設定
        const permissionsRes = await fetch('/api/attendance-permissions', { credentials: 'include' });
        if (permissionsRes.ok) {
          const permissionsData = await permissionsRes.json();
          setPermissions(permissionsData);
        }
      } catch (error) {
        console.error('載入數據失敗:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // 處理部門選擇變更
  const handleDepartmentChange = (
    type: keyof typeof newPermission,
    department: string,
    checked: boolean,
    isEdit = false
  ) => {
    if (isEdit) {
      setEditForm(prev => ({
        ...prev,
        [type]: checked
          ? [...(prev[type] as string[]), department]
          : (prev[type] as string[]).filter((d: string) => d !== department)
      }));
    } else {
      setNewPermission(prev => ({
        ...prev,
        [type]: checked
          ? [...(prev[type] as string[]), department]
          : (prev[type] as string[]).filter((d: string) => d !== department)
      }));
    }
  };

  // 提交新增權限
  const handleCreatePermission = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newPermission.employeeId) {
      alert('請選擇員工');
      return;
    }

    // 檢查是否有至少一個權限
    const hasPermissions = Object.values(newPermission).some(perm => 
      Array.isArray(perm) && perm.length > 0
    );
    
    if (!hasPermissions) {
      alert('請至少選擇一個權限');
      return;
    }

    try {
      const response = await fetchJSONWithCSRF('/api/attendance-permissions', {
        method: 'POST',
        body: {
          employeeId: Number(newPermission.employeeId),
          permissions: {
            leaveRequests: newPermission.leaveRequests,
            overtimeRequests: newPermission.overtimeRequests,
            shiftExchanges: newPermission.shiftExchanges,
            scheduleManagement: newPermission.scheduleManagement
          }
        }
      });

      if (response.ok) {
        const createdPermission = await response.json();
        setPermissions(prev => [...prev, createdPermission]);
        setShowCreateForm(false);
        setNewPermission({
          employeeId: '',
          leaveRequests: [],
          overtimeRequests: [],
          shiftExchanges: [],
          scheduleManagement: []
        });
        alert('權限設定已新增！');
      } else {
        const error = await response.json();
        alert(error.error || '新增失敗，請重試');
      }
    } catch (error) {
      console.error('新增失敗:', error);
      alert('新增失敗，請重試');
    }
  };

  // 開始編輯權限
  const startEdit = (permission: AttendancePermission) => {
    setEditingPermission(permission);
    setEditForm({
      employeeId: String(permission.employeeId),
      leaveRequests: permission.permissions.leaveRequests || [],
      overtimeRequests: permission.permissions.overtimeRequests || [],
      shiftExchanges: permission.permissions.shiftExchanges || [],
      scheduleManagement: permission.permissions.scheduleManagement || []
    });
    setShowEditForm(true);
  };

  // 提交編輯權限
  const handleEditPermission = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!editingPermission) return;

    // 檢查是否有至少一個權限
    const hasPermissions = Object.values(editForm).some(perm => 
      Array.isArray(perm) && perm.length > 0
    );
    
    if (!hasPermissions) {
      alert('請至少選擇一個權限');
      return;
    }

    try {
      const response = await fetchJSONWithCSRF(`/api/attendance-permissions/${editingPermission.id}`, {
        method: 'PATCH',
        body: {
          permissions: {
            leaveRequests: editForm.leaveRequests,
            overtimeRequests: editForm.overtimeRequests,
            shiftExchanges: editForm.shiftExchanges,
            scheduleManagement: editForm.scheduleManagement
          }
        }
      });

      if (response.ok) {
        const updatedPermission = await response.json();
        setPermissions(prev => prev.map(p => 
          p.id === editingPermission.id ? updatedPermission : p
        ));
        setShowEditForm(false);
        setEditingPermission(null);
        alert('權限設定已更新！');
      } else {
        const error = await response.json();
        alert(error.error || '更新失敗，請重試');
      }
    } catch (error) {
      console.error('更新失敗:', error);
      alert('更新失敗，請重試');
    }
  };

  // 刪除權限
  const handleDeletePermission = async (id: number) => {
    if (!confirm('確定要刪除此權限設定嗎？')) return;

    try {
      const response = await fetchJSONWithCSRF(`/api/attendance-permissions/${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setPermissions(prev => prev.filter(p => p.id !== id));
        alert('權限設定已刪除！');
      } else {
        const error = await response.json();
        alert(error.error || '刪除失敗，請重試');
      }
    } catch (error) {
      console.error('刪除失敗:', error);
      alert('刪除失敗，請重試');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 導航列 */}
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 標題區 */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center">
                <Shield className="w-8 h-8 text-blue-600 mr-3" />
                考勤權限管理
              </h1>
              <p className="text-gray-600 mt-2">
                設定員工的考勤審核權限，包括請假、加班、調班申請審核與班表管理權限
              </p>
            </div>
            <button
              onClick={() => setShowCreateForm(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center space-x-2"
            >
              <Plus className="w-4 h-4" />
              <span>新增權限設定</span>
            </button>
          </div>
        </div>

        {/* 統計卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center w-8 h-8 bg-blue-100 rounded-md">
                  <Shield className="w-5 h-5 text-blue-600" />
                </div>
              </div>
              <div className="ml-4">
                <div className="text-sm font-medium text-gray-500">總權限設定</div>
                <div className="text-2xl font-bold text-gray-900">{permissions.length}</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center w-8 h-8 bg-green-100 rounded-md">
                  <Calendar className="w-5 h-5 text-green-600" />
                </div>
              </div>
              <div className="ml-4">
                <div className="text-sm font-medium text-gray-500">請假審核員</div>
                <div className="text-2xl font-bold text-gray-900">
                  {permissions.filter(p => p.permissions.leaveRequests?.length > 0).length}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center w-8 h-8 bg-yellow-100 rounded-md">
                  <Clock className="w-5 h-5 text-yellow-600" />
                </div>
              </div>
              <div className="ml-4">
                <div className="text-sm font-medium text-gray-500">加班審核員</div>
                <div className="text-2xl font-bold text-gray-900">
                  {permissions.filter(p => p.permissions.overtimeRequests?.length > 0).length}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center w-8 h-8 bg-purple-100 rounded-md">
                  <RefreshCw className="w-5 h-5 text-purple-600" />
                </div>
              </div>
              <div className="ml-4">
                <div className="text-sm font-medium text-gray-500">調班審核員</div>
                <div className="text-2xl font-bold text-gray-900">
                  {permissions.filter(p => p.permissions.shiftExchanges?.length > 0).length}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center w-8 h-8 bg-orange-100 rounded-md">
                  <Calendar className="w-5 h-5 text-orange-600" />
                </div>
              </div>
              <div className="ml-4">
                <div className="text-sm font-medium text-gray-500">班表管理員</div>
                <div className="text-2xl font-bold text-gray-900">
                  {permissions.filter(p => p.permissions.scheduleManagement?.length > 0).length}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 權限設定列表 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">權限設定列表</h2>
          </div>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    員工資訊
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    請假審核權限
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    加班審核權限
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    調班審核權限
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    班表管理權限
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {permissions.map((permission) => (
                  <tr key={permission.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0">
                          <div className="flex items-center justify-center w-8 h-8 bg-gray-100 rounded-full">
                            <User className="w-4 h-4 text-gray-600" />
                          </div>
                        </div>
                        <div className="ml-3">
                          <div className="text-sm font-medium text-gray-900">
                            {permission.employee.name}
                          </div>
                          <div className="text-sm text-gray-500">
                            {permission.employee.employeeId} • {permission.employee.department} • {permission.employee.position}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {permission.permissions.leaveRequests?.length > 0 ? (
                          permission.permissions.leaveRequests.map((dept, index) => (
                            <span key={index} className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                              {dept}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-gray-400">無權限</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {permission.permissions.overtimeRequests?.length > 0 ? (
                          permission.permissions.overtimeRequests.map((dept, index) => (
                            <span key={index} className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">
                              {dept}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-gray-400">無權限</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {permission.permissions.shiftExchanges?.length > 0 ? (
                          permission.permissions.shiftExchanges.map((dept, index) => (
                            <span key={index} className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                              {dept}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-gray-400">無權限</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {permission.permissions.scheduleManagement?.length > 0 ? (
                          permission.permissions.scheduleManagement.map((dept, index) => (
                            <span key={index} className="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-800 rounded-full">
                              {dept}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-gray-400">無權限</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex space-x-2">
                        <button
                          onClick={() => startEdit(permission)}
                          className="text-blue-600 hover:text-blue-800"
                          title="編輯權限"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeletePermission(permission.id)}
                          className="text-red-600 hover:text-red-800"
                          title="刪除權限"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            {permissions.length === 0 && (
              <div className="text-center py-12">
                <Shield className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">沒有權限設定</h3>
                <p className="mt-1 text-sm text-gray-500">
                  還沒有設定任何考勤權限，點擊上方按鈕新增權限設定
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 新增權限模態框 */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-full max-w-4xl bg-white rounded-lg shadow-lg">
            <div className="flex items-center justify-between border-b border-gray-200 pb-4 mb-6">
              <h3 className="text-lg font-medium text-gray-900">新增權限設定</h3>
              <button
                onClick={() => setShowCreateForm(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleCreatePermission} className="space-y-6">
              {/* 選擇員工 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">選擇員工</label>
                <select
                  value={newPermission.employeeId}
                  onChange={(e) => setNewPermission({ ...newPermission, employeeId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                  required
                >
                  <option value="">請選擇員工</option>
                  {employees
                    .filter(emp => !permissions.some(p => p.employeeId === emp.id))
                    .map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.employeeId} - {employee.name} ({employee.department} • {employee.position})
                      </option>
                    ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">只顯示尚未設定權限的員工</p>
              </div>

              {/* 權限設定 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {(Object.keys(PERMISSION_LABELS) as Array<keyof typeof PERMISSION_LABELS>).map((permissionType) => (
                  <div key={permissionType} className="border border-gray-200 rounded-lg p-4">
                    <div className="mb-3">
                      <h4 className="text-sm font-medium text-gray-900">
                        {PERMISSION_LABELS[permissionType]}
                      </h4>
                      <p className="text-xs text-gray-500 mt-1">
                        {PERMISSION_DESCRIPTIONS[permissionType]}
                      </p>
                    </div>
                    
                    <div className="space-y-2">
                      {DEPARTMENTS.map((department) => (
                        <label key={department} className="flex items-center">
                          <input
                            type="checkbox"
                            checked={newPermission[permissionType].includes(department)}
                            onChange={(e) => handleDepartmentChange(
                              permissionType,
                              department,
                              e.target.checked
                            )}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          />
                          <span className="ml-2 text-sm text-gray-700">{department}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 mb-2">權限說明</h4>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>• 員工可以審核所選部門的相應申請</li>
                  <li>• 請假審核權限：可批准或拒絕指定部門員工的請假申請</li>
                  <li>• 加班審核權限：可批准或拒絕指定部門員工的加班申請</li>
                  <li>• 調班審核權限：可批准或拒絕指定部門員工的調班申請</li>
                  <li>• 班表管理權限：可編輯和管理指定部門員工的班表</li>
                  <li>• 至少需要選擇一個權限類型和部門</li>
                </ul>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium"
                >
                  新增權限設定
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors font-medium"
                >
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 編輯權限模態框 */}
      {showEditForm && editingPermission && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-full max-w-4xl bg-white rounded-lg shadow-lg">
            <div className="flex items-center justify-between border-b border-gray-200 pb-4 mb-6">
              <h3 className="text-lg font-medium text-gray-900">編輯權限設定</h3>
              <button
                onClick={() => setShowEditForm(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleEditPermission} className="space-y-6">
              {/* 員工資訊 (唯讀) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">員工資訊</label>
                <div className="px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-700">
                  {editingPermission.employee.employeeId} - {editingPermission.employee.name} 
                  ({editingPermission.employee.department} • {editingPermission.employee.position})
                </div>
              </div>

              {/* 權限設定 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {(Object.keys(PERMISSION_LABELS) as Array<keyof typeof PERMISSION_LABELS>).map((permissionType) => (
                  <div key={permissionType} className="border border-gray-200 rounded-lg p-4">
                    <div className="mb-3">
                      <h4 className="text-sm font-medium text-gray-900">
                        {PERMISSION_LABELS[permissionType]}
                      </h4>
                      <p className="text-xs text-gray-500 mt-1">
                        {PERMISSION_DESCRIPTIONS[permissionType]}
                      </p>
                    </div>
                    
                    <div className="space-y-2">
                      {DEPARTMENTS.map((department) => (
                        <label key={department} className="flex items-center">
                          <input
                            type="checkbox"
                            checked={editForm[permissionType].includes(department)}
                            onChange={(e) => handleDepartmentChange(
                              permissionType,
                              department,
                              e.target.checked,
                              true // 標記為編輯模式
                            )}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          />
                          <span className="ml-2 text-sm text-gray-700">{department}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium"
                >
                  儲存變更
                </button>
                <button
                  type="button"
                  onClick={() => setShowEditForm(false)}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors font-medium"
                >
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
