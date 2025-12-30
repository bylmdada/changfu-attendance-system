'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  Cloud, 
  Calendar, 
  Plus, 
  Trash2, 
  X,
  AlertTriangle,
  Users,
  Clock,
  CheckCircle,
  Edit2
} from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';

interface DisasterDayOff {
  id: number;
  disasterDate: string;
  disasterType: string;
  stopWorkType: string;
  affectedScope: string;
  affectedDepartments?: string;   // JSON string
  affectedEmployeeIds?: string;   // JSON string
  description?: string;
  affectedCount: number;
  createdAt: string;
  creator: {
    id: number;
    name: string;
    department?: string;
  };
}

interface User {
  id: number;
  role: string;
  employeeId: number;
}

const DISASTER_TYPES = {
  TYPHOON: '颱風',
  EARTHQUAKE: '地震',
  RAIN: '雨災',
  WIND: '風災',
  OTHER: '其他'
};

const DISASTER_ICONS: Record<string, string> = {
  TYPHOON: '🌀',
  EARTHQUAKE: '🌍',
  RAIN: '🌧️',
  WIND: '💨',
  OTHER: '⚠️'
};

const STOP_WORK_TYPES = {
  FULL: '全日停班',
  AM: '上午停班',
  PM: '下午停班'
};

const AFFECTED_SCOPES = {
  ALL: '全部員工',
  DEPARTMENTS: '指定部門（複選）',
  EMPLOYEES: '指定員工（複選）'
};

export default function DisasterDayOffPage() {
  const [records, setRecords] = useState<DisasterDayOff[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // 新增表單
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    disasterDate: '',
    numberOfDays: 1, // 天數（連續天災用）
    disasterType: 'TYPHOON',
    stopWorkType: 'FULL',
    affectedScope: 'ALL',
    affectedDepartments: [] as string[],  // 複選部門
    affectedEmployeeIds: [] as number[],  // 複選員工
    description: ''
  });

  // 篩選
  const [filterYear, setFilterYear] = useState(new Date().getFullYear().toString());

  // 編輯表單
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState<DisasterDayOff | null>(null);
  const [editFormData, setEditFormData] = useState({
    disasterType: 'TYPHOON',
    stopWorkType: 'FULL',
    description: ''
  });

  // 部門列表（for 下拉選單）
  const [departments, setDepartments] = useState<string[]>([]);
  // 員工列表
  const [employees, setEmployees] = useState<{ id: number; name: string; employeeId: string; department: string }[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState('');

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchCurrentUser = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setCurrentUser(data.user);
      }
    } catch (error) {
      console.error('取得用戶資料失敗:', error);
    }
  }, []);

  const fetchRecords = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterYear) params.set('year', filterYear);
      
      const response = await fetch(`/api/disaster-day-off?${params}`, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setRecords(data.records || []);
      }
    } catch (error) {
      console.error('載入天災假記錄失敗:', error);
    } finally {
      setLoading(false);
    }
  }, [filterYear]);

  const fetchDepartmentsAndEmployees = useCallback(async () => {
    try {
      const response = await fetch('/api/employees?minimal=true', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        const employeeList = (data.employees || []).map((e: { id: number; name: string; employeeId: string; department?: string }) => ({
          id: e.id,
          name: e.name,
          employeeId: e.employeeId,
          department: e.department || ''
        }));
        setEmployees(employeeList);
        const depts = [...new Set(employeeList.map((e: { department: string }) => e.department).filter(Boolean))];
        setDepartments(depts as string[]);
      }
    } catch (error) {
      console.error('載入部門和員工失敗:', error);
    }
  }, []);

  useEffect(() => {
    fetchCurrentUser();
    fetchDepartmentsAndEmployees();
  }, [fetchCurrentUser, fetchDepartmentsAndEmployees]);

  useEffect(() => {
    if (currentUser) {
      fetchRecords();
    }
  }, [currentUser, fetchRecords]);

  // 提交新增
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.disasterDate) {
      showToast('error', '請選擇停班日期');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetchJSONWithCSRF('/api/disaster-day-off', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (response.ok) {
        showToast('success', data.message);
        setShowModal(false);
        setFormData({
          disasterDate: '',
          numberOfDays: 1,
          disasterType: 'TYPHOON',
          stopWorkType: 'FULL',
          affectedScope: 'ALL',
          affectedDepartments: [],
          affectedEmployeeIds: [],
          description: ''
        });
        fetchRecords();
      } else {
        showToast('error', data.error || '設定失敗');
      }
    } catch (error) {
      console.error('設定天災假失敗:', error);
      showToast('error', '操作失敗');
    } finally {
      setSubmitting(false);
    }
  };

  // 刪除記錄
  const handleDelete = async (id: number, date: string) => {
    if (!confirm(`確定要刪除 ${date} 的天災假記錄嗎？\n\n系統將自動恢復員工原本的班別。`)) {
      return;
    }

    try {
      const response = await fetchJSONWithCSRF(`/api/disaster-day-off?id=${id}`, {
        method: 'DELETE'
      });

      const data = await response.json();
      if (response.ok) {
        showToast('success', data.message);
        fetchRecords();
      } else {
        showToast('error', data.error || '刪除失敗');
      }
    } catch (error) {
      console.error('刪除失敗:', error);
      showToast('error', '操作失敗');
    }
  };

  // 開啟編輯彈窗
  const handleEdit = (record: DisasterDayOff) => {
    setEditingRecord(record);
    setEditFormData({
      disasterType: record.disasterType,
      stopWorkType: record.stopWorkType,
      description: record.description || ''
    });
    setShowEditModal(true);
  };

  // 提交編輯
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRecord) return;

    setSubmitting(true);
    try {
      const response = await fetchJSONWithCSRF('/api/disaster-day-off', {
        method: 'PUT',
        body: {
          id: editingRecord.id,
          ...editFormData
        }
      });

      const data = await response.json();
      if (response.ok) {
        showToast('success', data.message);
        setShowEditModal(false);
        setEditingRecord(null);
        fetchRecords();
      } else {
        showToast('error', data.error || '更新失敗');
      }
    } catch (error) {
      console.error('更新失敗:', error);
      showToast('error', '操作失敗');
    } finally {
      setSubmitting(false);
    }
  };

  const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role === 'HR';

  if (loading) {
    return (
      <AuthenticatedLayout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-gray-600">載入中...</div>
        </div>
      </AuthenticatedLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AuthenticatedLayout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-red-600">您沒有權限訪問此頁面</div>
        </div>
      </AuthenticatedLayout>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto p-6">
        {/* 標題 */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <Cloud className="w-8 h-8 text-blue-600 mr-3" />
            天災假管理
          </h1>
          <p className="text-gray-600 mt-1">
            批量設定颱風、地震等天災停班，自動更新員工班表
          </p>
        </div>

        {/* 統計卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-blue-600" />
              <span className="text-sm text-gray-600">{filterYear}年記錄</span>
            </div>
            <p className="text-2xl font-bold text-blue-600 mt-2">{records.length}</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <div className="flex items-center gap-2">
              <span className="text-lg">🌀</span>
              <span className="text-sm text-gray-600">颱風假</span>
            </div>
            <p className="text-2xl font-bold text-gray-800 mt-2">
              {records.filter(r => r.disasterType === 'TYPHOON').length}
            </p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <div className="flex items-center gap-2">
              <span className="text-lg">🌍</span>
              <span className="text-sm text-gray-600">地震假</span>
            </div>
            <p className="text-2xl font-bold text-gray-800 mt-2">
              {records.filter(r => r.disasterType === 'EARTHQUAKE').length}
            </p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <div className="flex items-center gap-2">
              <span className="text-lg">🌧️</span>
              <span className="text-sm text-gray-600">雨災假</span>
            </div>
            <p className="text-2xl font-bold text-gray-800 mt-2">
              {records.filter(r => r.disasterType === 'RAIN').length}
            </p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <div className="flex items-center gap-2">
              <span className="text-lg">💨</span>
              <span className="text-sm text-gray-600">風災假</span>
            </div>
            <p className="text-2xl font-bold text-gray-800 mt-2">
              {records.filter(r => r.disasterType === 'WIND').length}
            </p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-green-600" />
              <span className="text-sm text-gray-600">影響人次</span>
            </div>
            <p className="text-2xl font-bold text-green-600 mt-2">
              {records.reduce((sum, r) => sum + r.affectedCount, 0)}
            </p>
          </div>
        </div>

        {/* 篩選和操作 */}
        <div className="bg-white rounded-lg p-4 border border-gray-200 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <select
                value={filterYear}
                onChange={(e) => setFilterYear(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
              >
                {[new Date().getFullYear(), new Date().getFullYear() - 1, new Date().getFullYear() - 2].map(year => (
                  <option key={year} value={year}>{year}年</option>
                ))}
              </select>
            </div>
            
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4 mr-2" />
              設定天災假
            </button>
          </div>
        </div>

        {/* 記錄列表 */}
        {records.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Cloud className="h-12 w-12 mx-auto mb-4 text-gray-400" />
            <p>{filterYear}年暫無天災假記錄</p>
          </div>
        ) : (
          <div className="space-y-4">
            {records.map(record => (
              <div key={record.id} className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="text-2xl">{DISASTER_ICONS[record.disasterType] || '⚠️'}</span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-lg text-gray-900">
                          {record.disasterDate}
                        </span>
                        <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded text-sm">
                          {DISASTER_TYPES[record.disasterType as keyof typeof DISASTER_TYPES]}
                        </span>
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-sm">
                          {STOP_WORK_TYPES[record.stopWorkType as keyof typeof STOP_WORK_TYPES]}
                        </span>
                      </div>
                      <div className="text-sm text-gray-500 mt-1">
                        <span className="mr-4">
                          適用：{AFFECTED_SCOPES[record.affectedScope as keyof typeof AFFECTED_SCOPES] || record.affectedScope}
                          {record.affectedDepartments && (
                            <span className="text-blue-600 ml-1">
                              ({JSON.parse(record.affectedDepartments).join(', ')})
                            </span>
                          )}
                        </span>
                        <span className="mr-4">
                          影響人數：{record.affectedCount} 人
                        </span>
                        <span>
                          設定者：{record.creator.name}
                        </span>
                      </div>
                      {record.description && (
                        <div className="text-sm text-gray-600 mt-1">
                          備註：{record.description}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {isAdmin && (
                      <button
                        onClick={() => handleEdit(record)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                        title="編輯"
                      >
                        <Edit2 className="h-5 w-5" />
                      </button>
                    )}
                    {currentUser?.role === 'ADMIN' && (
                      <button
                        onClick={() => handleDelete(record.id, record.disasterDate)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                        title="刪除"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 新增彈窗 */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
              {/* 統一格式標題列 */}
              <div className="sticky top-0 bg-white px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">設定天災假</h3>
                    <p className="text-sm text-gray-500">批量設定天災停班日期</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowModal(false)} 
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
              
              <form onSubmit={handleSubmit} className="p-6 space-y-5">
                {/* 日期區間 */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <label className="block text-sm font-semibold text-blue-800 mb-3">
                    停班日期區間 <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-blue-700 mb-1">開始日期</label>
                      <input
                        type="date"
                        value={formData.disasterDate}
                        onChange={(e) => setFormData({ ...formData, disasterDate: e.target.value })}
                        className="w-full px-3 py-2 border border-blue-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-blue-700 mb-1">連續天數</label>
                      <select
                        value={formData.numberOfDays}
                        onChange={(e) => setFormData({ ...formData, numberOfDays: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 border border-blue-300 rounded-lg text-gray-900 bg-white focus:ring-2 focus:ring-blue-500"
                      >
                        {[1, 2, 3, 4, 5, 6, 7].map(n => (
                          <option key={n} value={n}>{n} 天</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {formData.disasterDate && formData.numberOfDays > 1 && (
                    <div className="mt-3 text-sm text-blue-700">
                      📅 將設定：{formData.disasterDate} 至 {
                        (() => {
                          const start = new Date(formData.disasterDate);
                          const end = new Date(start);
                          end.setDate(end.getDate() + formData.numberOfDays - 1);
                          return end.toISOString().split('T')[0];
                        })()
                      }（共 {formData.numberOfDays} 天）
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">災害類型 *</label>
                    <select
                      value={formData.disasterType}
                      onChange={(e) => setFormData({ ...formData, disasterType: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                    >
                      {Object.entries(DISASTER_TYPES).map(([key, label]) => (
                        <option key={key} value={key}>{DISASTER_ICONS[key]} {label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">停班類型 *</label>
                    <select
                      value={formData.stopWorkType}
                      onChange={(e) => setFormData({ ...formData, stopWorkType: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                    >
                      {Object.entries(STOP_WORK_TYPES).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">適用範圍</label>
                  <div className="space-y-2">
                    {Object.entries(AFFECTED_SCOPES).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="affectedScope"
                          value={key}
                          checked={formData.affectedScope === key}
                          onChange={(e) => setFormData({ 
                            ...formData, 
                            affectedScope: e.target.value,
                            affectedDepartments: [],
                            affectedEmployeeIds: []
                          })}
                          className="w-4 h-4 text-blue-600"
                        />
                        <span className="text-gray-700">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 複選部門 */}
                {formData.affectedScope === 'DEPARTMENTS' && (
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      選擇部門（已選 {formData.affectedDepartments.length} 個）
                    </label>
                    <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                      {departments.map(dept => (
                        <label key={dept} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-gray-100 rounded">
                          <input
                            type="checkbox"
                            checked={formData.affectedDepartments.includes(dept)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFormData({ 
                                  ...formData, 
                                  affectedDepartments: [...formData.affectedDepartments, dept] 
                                });
                              } else {
                                setFormData({ 
                                  ...formData, 
                                  affectedDepartments: formData.affectedDepartments.filter(d => d !== dept) 
                                });
                              }
                            }}
                            className="w-4 h-4 rounded text-blue-600"
                          />
                          <span className="text-sm text-gray-700">{dept}</span>
                        </label>
                      ))}
                    </div>
                    {formData.affectedDepartments.length > 0 && (
                      <div className="mt-2 text-xs text-blue-600">
                        預估影響：{employees.filter(e => formData.affectedDepartments.includes(e.department)).length} 人
                      </div>
                    )}
                  </div>
                )}

                {/* 複選員工 */}
                {formData.affectedScope === 'EMPLOYEES' && (
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      選擇員工（已選 {formData.affectedEmployeeIds.length} 人）
                    </label>
                    <input
                      type="text"
                      value={employeeSearch}
                      onChange={(e) => setEmployeeSearch(e.target.value)}
                      placeholder="🔍 搜尋姓名或工號..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 text-sm mb-2"
                    />
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {employees
                        .filter(e => 
                          !employeeSearch || 
                          e.name.includes(employeeSearch) || 
                          e.employeeId.includes(employeeSearch)
                        )
                        .map(emp => (
                          <label key={emp.id} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-gray-100 rounded">
                            <input
                              type="checkbox"
                              checked={formData.affectedEmployeeIds.includes(emp.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setFormData({ 
                                    ...formData, 
                                    affectedEmployeeIds: [...formData.affectedEmployeeIds, emp.id] 
                                  });
                                } else {
                                  setFormData({ 
                                    ...formData, 
                                    affectedEmployeeIds: formData.affectedEmployeeIds.filter(id => id !== emp.id) 
                                  });
                                }
                              }}
                              className="w-4 h-4 rounded text-blue-600"
                            />
                            <span className="text-sm text-gray-700">
                              {emp.employeeId} {emp.name}
                              <span className="text-gray-400 ml-1">({emp.department})</span>
                            </span>
                          </label>
                        ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">備註說明</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 h-20 resize-none"
                    placeholder="例如：依中央氣象署發布停班公告..."
                  />
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <Clock className="w-4 h-4 text-yellow-600 mt-0.5" />
                    <div className="text-sm text-yellow-800">
                      <p className="font-medium">設定後將自動執行：</p>
                      <ul className="list-disc list-inside mt-1">
                        <li>將受影響員工當日班別改為 TD（天災假）</li>
                        <li>薪資計算時照給薪資</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium flex items-center transition-colors"
                  >
                    {submitting ? (
                      <>處理中...</>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4 mr-2" />
                        確認設定 {formData.numberOfDays > 1 ? `(${formData.numberOfDays}天)` : ''}
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 編輯彈窗 */}
        {showEditModal && editingRecord && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
              {/* 標題列 */}
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <Edit2 className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">編輯天災假</h3>
                    <p className="text-sm text-gray-500">{editingRecord.disasterDate}</p>
                  </div>
                </div>
                <button 
                  onClick={() => { setShowEditModal(false); setEditingRecord(null); }} 
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
              
              <form onSubmit={handleEditSubmit} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">災害類型</label>
                    <select
                      value={editFormData.disasterType}
                      onChange={(e) => setEditFormData({ ...editFormData, disasterType: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                    >
                      {Object.entries(DISASTER_TYPES).map(([key, label]) => (
                        <option key={key} value={key}>{DISASTER_ICONS[key]} {label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">停班類型</label>
                    <select
                      value={editFormData.stopWorkType}
                      onChange={(e) => setEditFormData({ ...editFormData, stopWorkType: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
                    >
                      {Object.entries(STOP_WORK_TYPES).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">備註說明</label>
                  <textarea
                    value={editFormData.description}
                    onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 h-20 resize-none"
                    placeholder="備註說明..."
                  />
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                  <p><strong>日期：</strong>{editingRecord.disasterDate}</p>
                  <p><strong>影響人數：</strong>{editingRecord.affectedCount} 人</p>
                  <p><strong>範圍：</strong>{AFFECTED_SCOPES[editingRecord.affectedScope as keyof typeof AFFECTED_SCOPES]}</p>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => { setShowEditModal(false); setEditingRecord(null); }}
                    className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium flex items-center transition-colors"
                  >
                    {submitting ? (
                      <>處理中...</>
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4 mr-2" />
                        儲存變更
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div className={`fixed bottom-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'} text-white`}>
            {toast.message}
          </div>
        )}
      </div>
    </AuthenticatedLayout>
  );
}
