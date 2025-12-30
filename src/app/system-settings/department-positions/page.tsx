'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  Users, Plus, Edit, Trash2, Save, Search, 
  ChevronUp, ChevronDown, X, Check, AlertTriangle,
  Building2, Loader2
} from 'lucide-react';
import SystemNavbar from '@/components/SystemNavbar';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';

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

interface Position {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

interface Department {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
  positions: Position[];
}

interface Toast {
  id: number;
  type: 'success' | 'error' | 'warning';
  message: string;
}

// API 回應類型
interface ApiResponse {
  success?: boolean;
  error?: string;
  department?: Department;
  position?: Position;
  message?: string;
}

export default function DepartmentPositionManagementPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  
  // Modal 狀態
  const [showAddDeptModal, setShowAddDeptModal] = useState(false);
  const [showEditDeptModal, setShowEditDeptModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{type: 'department' | 'position' | 'positions', id: number, ids?: number[], name: string} | null>(null);
  const [showEditPositionModal, setShowEditPositionModal] = useState(false);
  
  // 編輯狀態
  const [selectedDepartment, setSelectedDepartment] = useState<Department | null>(null);
  const [editingPositions, setEditingPositions] = useState<Position[]>([]);
  const [selectedPositionIds, setSelectedPositionIds] = useState<number[]>([]);
  const [newDeptName, setNewDeptName] = useState('');
  const [newPositionName, setNewPositionName] = useState('');
  const [editingDeptName, setEditingDeptName] = useState('');
  const [saving, setSaving] = useState(false);

  // Toast 訊息
  const addToast = useCallback((type: 'success' | 'error' | 'warning', message: string) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  // 載入數據
  const fetchData = useCallback(async () => {
    try {
      const userRes = await fetch('/api/auth/me', { credentials: 'include' });
      if (userRes.ok) {
        const userData = await userRes.json();
        const currentUser = userData.user || userData;
        
        if (currentUser.role !== 'ADMIN') {
          addToast('error', '您沒有權限訪問此頁面');
          window.location.href = '/dashboard';
          return;
        }
        setUser(currentUser);
      } else {
        window.location.href = '/login';
        return;
      }

      const deptRes = await fetch('/api/system-settings/department-positions');
      if (deptRes.ok) {
        const deptData = await deptRes.json();
        setDepartments(deptData.departments || []);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
      addToast('error', '載入資料失敗');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 過濾部門
  const filteredDepartments = departments.filter(dept =>
    dept.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // 新增部門
  const handleAddDepartment = async () => {
    if (!newDeptName.trim()) {
      addToast('warning', '請輸入部門名稱');
      return;
    }

    setSaving(true);
    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/department-positions', {
        method: 'POST',
        body: { action: 'addDepartment', name: newDeptName.trim() }
      });
      const result: ApiResponse = await response.json();

      if (result.success) {
        addToast('success', '部門新增成功');
        setShowAddDeptModal(false);
        setNewDeptName('');
        fetchData();
      } else {
        addToast('error', result.error || '新增失敗');
      }
    } catch (error) {
      console.error('Failed to add department:', error);
      addToast('error', '新增部門失敗');
    } finally {
      setSaving(false);
    }
  };

  // 更新部門名稱
  const handleUpdateDepartmentName = async () => {
    if (!selectedDepartment || !editingDeptName.trim()) return;

    setSaving(true);
    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/department-positions', {
        method: 'PUT',
        body: { action: 'updateDepartment', id: selectedDepartment.id, name: editingDeptName.trim() }
      });
      const result: ApiResponse = await response.json();

      if (result.success) {
        addToast('success', '部門名稱更新成功');
        setShowEditDeptModal(false);
        fetchData();
      } else {
        addToast('error', result.error || '更新失敗');
      }
    } catch (error) {
      console.error('Failed to update department:', error);
      addToast('error', '更新失敗');
    } finally {
      setSaving(false);
    }
  };

  // 刪除部門
  const handleDeleteDepartment = async (id: number) => {
    setSaving(true);
    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/department-positions', {
        method: 'DELETE',
        body: { action: 'deleteDepartment', id }
      });
      const result: ApiResponse = await response.json();

      if (result.success) {
        addToast('success', '部門刪除成功');
        setShowDeleteConfirm(null);
        fetchData();
      } else {
        addToast('error', result.error || '刪除失敗');
      }
    } catch (error) {
      console.error('Failed to delete department:', error);
      addToast('error', '刪除失敗');
    } finally {
      setSaving(false);
    }
  };

  // 新增職位
  const handleAddPosition = async () => {
    if (!selectedDepartment || !newPositionName.trim()) {
      addToast('warning', '請輸入職位名稱');
      return;
    }

    setSaving(true);
    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/department-positions', {
        method: 'POST',
        body: { 
          action: 'addPosition', 
          departmentId: selectedDepartment.id, 
          name: newPositionName.trim() 
        }
      });
      const result: ApiResponse = await response.json();

      if (result.success) {
        addToast('success', '職位新增成功');
        setNewPositionName('');
        fetchData();
        // 更新編輯中的部門
        const updatedDept = departments.find(d => d.id === selectedDepartment.id);
        if (updatedDept && result.position) {
          setEditingPositions([...updatedDept.positions, result.position]);
        }
      } else {
        addToast('error', result.error || '新增失敗');
      }
    } catch (error) {
      console.error('Failed to add position:', error);
      addToast('error', '新增職位失敗');
    } finally {
      setSaving(false);
    }
  };

  // 刪除職位
  const handleDeletePosition = async (id: number) => {
    setSaving(true);
    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/department-positions', {
        method: 'DELETE',
        body: { action: 'deletePosition', id }
      });
      const result: ApiResponse = await response.json();

      if (result.success) {
        addToast('success', '職位刪除成功');
        setShowDeleteConfirm(null);
        setEditingPositions(prev => prev.filter(p => p.id !== id));
        fetchData();
      } else {
        addToast('error', result.error || '刪除失敗');
      }
    } catch (error) {
      console.error('Failed to delete position:', error);
      addToast('error', '刪除失敗');
    } finally {
      setSaving(false);
    }
  };

  // 批量刪除職位
  const handleBatchDeletePositions = async () => {
    if (selectedPositionIds.length === 0) return;

    setSaving(true);
    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/department-positions', {
        method: 'DELETE',
        body: { action: 'deletePositions', ids: selectedPositionIds }
      });
      const result: ApiResponse = await response.json();

      if (result.success) {
        addToast('success', `已刪除 ${selectedPositionIds.length} 個職位`);
        setShowDeleteConfirm(null);
        setSelectedPositionIds([]);
        setEditingPositions(prev => prev.filter(p => !selectedPositionIds.includes(p.id)));
        fetchData();
      } else {
        addToast('error', result.error || '批量刪除失敗');
      }
    } catch (error) {
      console.error('Failed to batch delete positions:', error);
      addToast('error', '批量刪除失敗');
    } finally {
      setSaving(false);
    }
  };

  // 移動職位順序
  const movePosition = async (index: number, direction: 'up' | 'down') => {
    const newPositions = [...editingPositions];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    
    if (targetIndex < 0 || targetIndex >= newPositions.length) return;
    
    // 交換順序
    [newPositions[index], newPositions[targetIndex]] = [newPositions[targetIndex], newPositions[index]];
    
    // 更新本地狀態
    setEditingPositions(newPositions);
    
    // 更新到伺服器
    try {
      await fetchJSONWithCSRF('/api/system-settings/department-positions', {
        method: 'PUT',
        body: {
          action: 'reorderPositions',
          positions: newPositions.map((p, i) => ({ id: p.id, sortOrder: i }))
        }
      });
    } catch (error) {
      console.error('Failed to reorder positions:', error);
      addToast('error', '排序更新失敗');
    }
  };

  // 開始編輯部門職位
  const startEditingPositions = (dept: Department) => {
    setSelectedDepartment(dept);
    setEditingPositions([...dept.positions]);
    setSelectedPositionIds([]);
    setShowEditPositionModal(true);
  };

  // 切換職位選擇
  const togglePositionSelection = (id: number) => {
    setSelectedPositionIds(prev =>
      prev.includes(id)
        ? prev.filter(pid => pid !== id)
        : [...prev, id]
    );
  };

  // 全選/取消全選
  const toggleSelectAll = () => {
    if (selectedPositionIds.length === editingPositions.length) {
      setSelectedPositionIds([]);
    } else {
      setSelectedPositionIds(editingPositions.map(p => p.id));
    }
  };

  // 骨架屏
  const Skeleton = () => (
    <div className="animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-1/3 mb-4"></div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[1, 2, 3, 4, 5, 6].map(i => (
          <div key={i} className="bg-white rounded-lg shadow-sm border p-6">
            <div className="h-6 bg-gray-200 rounded w-1/2 mb-4"></div>
            <div className="space-y-2">
              {[1, 2, 3].map(j => (
                <div key={j} className="h-8 bg-gray-100 rounded"></div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // 空狀態
  const EmptyState = () => (
    <div className="text-center py-16">
      <Building2 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
      <h3 className="text-xl font-medium text-gray-600 mb-2">尚無部門資料</h3>
      <p className="text-gray-500 mb-6">點擊下方按鈕開始新增您的第一個部門</p>
      <button
        onClick={() => setShowAddDeptModal(true)}
        className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        <Plus className="w-5 h-5 mr-2" />
        新增部門
      </button>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="animate-pulse bg-white h-16 border-b"></div>
        <div className="max-w-7xl mx-auto px-4 py-8">
          <Skeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 導航列 */}
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />

      {/* Toast 訊息 */}
      <div className="fixed top-20 right-4 z-50 space-y-2">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`flex items-center px-4 py-3 rounded-lg shadow-lg transform transition-all duration-300 ${
              toast.type === 'success' ? 'bg-green-500 text-white' :
              toast.type === 'error' ? 'bg-red-500 text-white' :
              'bg-yellow-500 text-white'
            }`}
          >
            {toast.type === 'success' && <Check className="w-5 h-5 mr-2" />}
            {toast.type === 'error' && <X className="w-5 h-5 mr-2" />}
            {toast.type === 'warning' && <AlertTriangle className="w-5 h-5 mr-2" />}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 標題區 */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center">
              <Users className="w-8 h-8 text-blue-600 mr-3" />
              部門職位管理
            </h1>
            <p className="text-gray-600 mt-2">管理各部門及對應的職位設定</p>
          </div>
          <button
            onClick={() => setShowAddDeptModal(true)}
            className="mt-4 md:mt-0 inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Plus className="w-5 h-5 mr-2" />
            新增部門
          </button>
        </div>

        {/* 搜尋列 */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜尋部門..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white"
            />
          </div>
        </div>

        {/* 部門列表 */}
        {departments.length === 0 ? (
          <EmptyState />
        ) : filteredDepartments.length === 0 ? (
          <div className="text-center py-12">
            <Search className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">找不到符合「{searchQuery}」的部門</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredDepartments.map((department) => (
              <div key={department.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                {/* 部門標題 */}
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">{department.name}</h3>
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => {
                          setSelectedDepartment(department);
                          setEditingDeptName(department.name);
                          setShowEditDeptModal(true);
                        }}
                        className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-100 rounded transition-colors"
                        title="編輯部門名稱"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setShowDeleteConfirm({ type: 'department', id: department.id, name: department.name })}
                        className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-100 rounded transition-colors"
                        title="刪除部門"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    {department.positions.length} 個職位
                  </div>
                </div>
                
                {/* 職位列表 */}
                <div className="p-4">
                  {department.positions.length === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-4">尚無職位</p>
                  ) : (
                    <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                      {department.positions.map((position) => (
                        <span
                          key={position.id}
                          className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium bg-blue-100 text-blue-800"
                        >
                          {position.name}
                        </span>
                      ))}
                    </div>
                  )}
                  
                  <button
                    onClick={() => startEditingPositions(department)}
                    className="mt-4 w-full py-2 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors flex items-center justify-center"
                  >
                    <Edit className="w-4 h-4 mr-1" />
                    編輯職位
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 新增部門 Modal */}
      {showAddDeptModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-gray-900">新增部門</h3>
              <button
                onClick={() => { setShowAddDeptModal(false); setNewDeptName(''); }}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <input
              type="text"
              value={newDeptName}
              onChange={(e) => setNewDeptName(e.target.value)}
              placeholder="請輸入部門名稱"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white"
              onKeyPress={(e) => e.key === 'Enter' && handleAddDepartment()}
              autoFocus
            />
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => { setShowAddDeptModal(false); setNewDeptName(''); }}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleAddDepartment}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center"
              >
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                新增
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 編輯部門名稱 Modal */}
      {showEditDeptModal && selectedDepartment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-gray-900">編輯部門名稱</h3>
              <button
                onClick={() => setShowEditDeptModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <input
              type="text"
              value={editingDeptName}
              onChange={(e) => setEditingDeptName(e.target.value)}
              placeholder="請輸入部門名稱"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white"
              onKeyPress={(e) => e.key === 'Enter' && handleUpdateDepartmentName()}
              autoFocus
            />
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setShowEditDeptModal(false)}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleUpdateDepartmentName}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center"
              >
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                <Save className="w-4 h-4 mr-1" />
                儲存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 編輯職位 Modal */}
      {showEditPositionModal && selectedDepartment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50">
              <h3 className="text-xl font-semibold text-gray-900">
                編輯職位：{selectedDepartment.name}
              </h3>
              <button
                onClick={() => { setShowEditPositionModal(false); fetchData(); }}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* 新增職位 */}
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={newPositionName}
                  onChange={(e) => setNewPositionName(e.target.value)}
                  placeholder="輸入新職位名稱"
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white"
                  onKeyPress={(e) => e.key === 'Enter' && handleAddPosition()}
                />
                <button
                  onClick={handleAddPosition}
                  disabled={saving || !newPositionName.trim()}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  新增
                </button>
              </div>
            </div>

            {/* 批量操作 */}
            {selectedPositionIds.length > 0 && (
              <div className="px-6 py-3 bg-red-50 border-b border-red-200 flex items-center justify-between">
                <span className="text-sm text-red-700">
                  已選擇 {selectedPositionIds.length} 個職位
                </span>
                <button
                  onClick={() => setShowDeleteConfirm({ 
                    type: 'positions', 
                    id: 0, 
                    ids: selectedPositionIds,
                    name: `${selectedPositionIds.length} 個職位` 
                  })}
                  className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors flex items-center"
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  批量刪除
                </button>
              </div>
            )}

            {/* 職位列表 */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {editingPositions.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  尚無職位，請在上方新增
                </div>
              ) : (
                <>
                  {/* 全選 */}
                  <div className="mb-3 flex items-center">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedPositionIds.length === editingPositions.length && editingPositions.length > 0}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm text-gray-600">全選</span>
                    </label>
                  </div>

                  <div className="space-y-2">
                    {editingPositions.map((position, index) => (
                      <div
                        key={position.id}
                        className={`flex items-center justify-between p-3 rounded-lg border ${
                          selectedPositionIds.includes(position.id)
                            ? 'bg-blue-50 border-blue-300'
                            : 'bg-gray-50 border-gray-200'
                        } transition-colors`}
                      >
                        <div className="flex items-center space-x-3">
                          <input
                            type="checkbox"
                            checked={selectedPositionIds.includes(position.id)}
                            onChange={() => togglePositionSelection(position.id)}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-gray-900 font-medium">{position.name}</span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <button
                            onClick={() => movePosition(index, 'up')}
                            disabled={index === 0}
                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-100 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title="上移"
                          >
                            <ChevronUp className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => movePosition(index, 'down')}
                            disabled={index === editingPositions.length - 1}
                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-100 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            title="下移"
                          >
                            <ChevronDown className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setShowDeleteConfirm({ type: 'position', id: position.id, name: position.name })}
                            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-100 rounded transition-colors"
                            title="刪除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
              <button
                onClick={() => { setShowEditPositionModal(false); fetchData(); }}
                className="w-full py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 刪除確認 Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center text-red-600 mb-4">
              <AlertTriangle className="w-8 h-8 mr-3" />
              <h3 className="text-xl font-semibold">確認刪除</h3>
            </div>
            <p className="text-gray-600 mb-6">
              {showDeleteConfirm.type === 'department' 
                ? `確定要刪除部門「${showDeleteConfirm.name}」嗎？這將同時刪除該部門下的所有職位。`
                : showDeleteConfirm.type === 'positions'
                ? `確定要刪除所選的 ${showDeleteConfirm.ids?.length} 個職位嗎？`
                : `確定要刪除職位「${showDeleteConfirm.name}」嗎？`
              }
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (showDeleteConfirm.type === 'department') {
                    handleDeleteDepartment(showDeleteConfirm.id);
                  } else if (showDeleteConfirm.type === 'positions') {
                    handleBatchDeletePositions();
                  } else {
                    handleDeletePosition(showDeleteConfirm.id);
                  }
                }}
                disabled={saving}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center"
              >
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                <Trash2 className="w-4 h-4 mr-1" />
                確認刪除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
