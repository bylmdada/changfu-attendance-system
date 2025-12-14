'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Save, Plus, Edit2, Trash2, Search, AlertTriangle, Download, Upload, X } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import SystemNavbar from '@/components/SystemNavbar';

interface EmployeeDependent {
  id?: number;
  employeeId: number;
  employeeName?: string;
  dependentName: string;
  relationship: string;
  idNumber: string;
  birthDate: string;
  isActive: boolean;
  startDate: string;
  endDate?: string;
  remarks?: string;
}

interface DependentSummary {
  employeeId: number;
  employeeName: string;
  department: string;
  dependentCount: number;
  dependents: EmployeeDependent[];
}

export default function HealthInsuranceDependentsPage() {
  const router = useRouter();
  const [user, setUser] = useState<{
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
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dependentSummaries, setDependentSummaries] = useState<DependentSummary[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showBatchForm, setShowBatchForm] = useState(false);
  const [editingDependent, setEditingDependent] = useState<EmployeeDependent | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name: string } | null>(null);

  // Helper function to get auth headers
  const getAuthHeaders = (): HeadersInit => {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include',
          headers: getAuthHeaders()
        });
        
        if (response.ok) {
          const userData = await response.json();
          const currentUser = userData.user || userData;
          
          if (currentUser.role !== 'ADMIN') {
            router.push('/dashboard');
            return;
          }
          setUser(currentUser);
          await loadDependents();
        } else if (response.status === 401 || response.status === 403) {
          console.warn('Authentication failed, redirecting to login');
          router.push('/login');
        } else {
          router.push('/login');
        }
      } catch (error) {
        console.error('驗證失敗:', error);
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, [router]);

  const loadDependents = async () => {
    try {
      const response = await fetch('/api/system-settings/health-insurance-dependents', {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setDependentSummaries(data.dependentSummaries || []);
      }
    } catch (error) {
      console.error('載入眷屬資料失敗:', error);
    }
  };

  const handleSaveDependent = async (dependent: EmployeeDependent) => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/health-insurance-dependents', {
        method: 'POST',
        body: dependent
      });

      if (response.ok) {
        await loadDependents();
        setShowForm(false);
        setEditingDependent(null);
        setMessage({ type: 'success', text: '眷屬資料已儲存成功！' });
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.error || '儲存失敗' });
      }
    } catch (error) {
      console.error('儲存眷屬資料失敗:', error);
      setMessage({ type: 'error', text: '儲存失敗，請稍後再試' });
    } finally {
      setSaving(false);
    }
  };

  // 顯示刪除確認對話框
  const showDeleteConfirmDialog = (dependent: EmployeeDependent) => {
    if (dependent.id) {
      setDeleteConfirm({ id: dependent.id, name: dependent.dependentName });
    }
  };

  // 執行刪除
  const handleDeleteDependent = async () => {
    if (!deleteConfirm) return;

    try {
      const response = await fetchJSONWithCSRF(`/api/system-settings/health-insurance-dependents?id=${deleteConfirm.id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await loadDependents();
        setMessage({ type: 'success', text: '眷屬資料已刪除' });
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.error || '刪除失敗' });
      }
    } catch (error) {
      console.error('刪除眷屬資料失敗:', error);
      setMessage({ type: 'error', text: '刪除失敗，請稍後再試' });
    } finally {
      setDeleteConfirm(null);
    }
  };

  // 匯出 CSV
  const handleExportCSV = () => {
    const headers = ['員工姓名', '部門', '眷屬姓名', '關係', '身分證號', '生日', '狀態', '開始日期', '備註'];
    const rows: string[][] = [];
    
    dependentSummaries.forEach(summary => {
      summary.dependents.forEach(dep => {
        rows.push([
          summary.employeeName,
          summary.department,
          dep.dependentName,
          dep.relationship,
          dep.idNumber,
          dep.birthDate,
          dep.isActive ? '投保中' : '已停保',
          dep.startDate,
          dep.remarks || ''
        ]);
      });
    });

    // 建立 CSV 內容 (加入 BOM 以支援中文)
    const BOM = '\uFEFF';
    const csvContent = BOM + [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    // 下載 CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `健保眷屬資料_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    
    setMessage({ type: 'success', text: '匯出成功！' });
  };

  const startEdit = (dependent: EmployeeDependent) => {
    setEditingDependent(dependent);
    setShowForm(true);
  };

  const startCreate = (employeeId?: number) => {
    setEditingDependent({
      employeeId: employeeId || 0,
      dependentName: '',
      relationship: '',
      idNumber: '',
      birthDate: '',
      isActive: true,
      startDate: new Date().toISOString().split('T')[0],
      remarks: ''
    });
    setShowForm(true);
  };

  // 開始批量新增
  const startBatchCreate = (employeeId: number) => {
    setEditingDependent({
      employeeId: employeeId,
      dependentName: '',
      relationship: '',
      idNumber: '',
      birthDate: '',
      isActive: true,
      startDate: new Date().toISOString().split('T')[0],
      remarks: ''
    });
    setShowBatchForm(true);
  };

  // 過濾搜尋結果
  const filteredSummaries = dependentSummaries.filter(summary =>
    summary.employeeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    summary.department.toLowerCase().includes(searchTerm.toLowerCase()) ||
    summary.dependents.some(dep => 
      dep.dependentName.toLowerCase().includes(searchTerm.toLowerCase())
    )
  );

  // 統計資料
  const totalEmployeesWithDependents = dependentSummaries.filter(s => s.dependentCount > 0).length;
  const totalDependents = dependentSummaries.reduce((sum, s) => sum + s.dependentCount, 0);
  const averageDependents = totalEmployeesWithDependents > 0 
    ? (totalDependents / totalEmployeesWithDependents).toFixed(1) 
    : '0';

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-900">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 頂部導航 */}
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />

      {/* 主要內容 */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 標題區 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <Users className="w-8 h-8 text-blue-600 mr-3" />
            健保眷屬管理
          </h1>
          <p className="text-gray-600 mt-2">管理員工健保投保眷屬資料</p>
        </div>

        {message && (
          <div className={`mb-6 p-4 rounded-lg ${
            message.type === 'success' 
              ? 'bg-green-50 border border-green-200 text-green-800' 
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}>
            {message.text}
          </div>
        )}

        {/* 統計資訊 */}
        <div className="mb-8 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{dependentSummaries.length}</div>
              <div className="text-sm text-gray-900">總員工數</div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{totalEmployeesWithDependents}</div>
              <div className="text-sm text-gray-900">有眷屬員工</div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">{totalDependents}</div>
              <div className="text-sm text-gray-900">總眷屬數</div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">{averageDependents}</div>
              <div className="text-sm text-gray-900">平均眷屬數</div>
            </div>
          </div>
        </div>

        {/* 搜尋列和操作按鈕 */}
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex items-center justify-between space-x-4">
            <div className="flex-1 relative">
              <Search className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
              <input
                type="text"
                placeholder="搜尋員工姓名、部門或眷屬姓名..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-red-500 focus:border-red-500 text-gray-900"
              />
            </div>
            <button
              onClick={handleExportCSV}
              disabled={totalDependents === 0}
              className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4 mr-2" />
              匯出 CSV
            </button>
          </div>
        </div>

        {/* 眷屬列表 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">員工眷屬資料</h2>
          </div>
          
          <div className="divide-y divide-gray-200">
            {filteredSummaries.map((summary) => (
              <div key={summary.employeeId} className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900">{summary.employeeName}</h3>
                    <p className="text-sm text-gray-900">{summary.department} • 眷屬數：{summary.dependentCount}</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => startBatchCreate(summary.employeeId)}
                      className="flex items-center space-x-2 px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200"
                    >
                      <Upload className="h-4 w-4" />
                      <span>批量新增</span>
                    </button>
                    <button
                      onClick={() => startCreate(summary.employeeId)}
                      className="flex items-center space-x-2 px-3 py-1 text-sm bg-red-100 text-red-700 rounded-md hover:bg-red-200"
                    >
                      <Plus className="h-4 w-4" />
                      <span>新增眷屬</span>
                    </button>
                  </div>
                </div>
                
                {summary.dependents.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-900 uppercase">姓名</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-900 uppercase">關係</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-900 uppercase">身分證號</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-900 uppercase">生日</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-900 uppercase">狀態</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-900 uppercase">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {summary.dependents.map((dependent) => (
                          <tr key={dependent.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-sm text-gray-900">{dependent.dependentName}</td>
                            <td className="px-4 py-2 text-sm text-gray-900">{dependent.relationship}</td>
                            <td className="px-4 py-2 text-sm text-gray-900">{dependent.idNumber}</td>
                            <td className="px-4 py-2 text-sm text-gray-900">{dependent.birthDate}</td>
                            <td className="px-4 py-2">
                              <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                dependent.isActive 
                                  ? 'bg-green-100 text-green-800' 
                                  : 'bg-red-100 text-red-800'
                              }`}>
                                {dependent.isActive ? '投保中' : '已停保'}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-sm font-medium space-x-2">
                              <button
                                onClick={() => startEdit(dependent)}
                                className="text-blue-600 hover:text-blue-900 p-1"
                                title="編輯"
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => showDeleteConfirmDialog(dependent)}
                                className="text-red-600 hover:text-red-900 p-1"
                                title="刪除"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-900">
                    尚無眷屬資料
                  </div>
                )}
              </div>
            ))}
          </div>
          
          {filteredSummaries.length === 0 && (
            <div className="text-center py-12">
              <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-900">
                {searchTerm ? '沒有找到符合條件的資料' : '尚未載入員工資料'}
              </p>
            </div>
          )}
        </div>

        {/* 眷屬表單 */}
        {showForm && editingDependent && (
          <DependentForm
            dependent={editingDependent}
            employees={dependentSummaries}
            onSave={handleSaveDependent}
            onCancel={() => {
              setShowForm(false);
              setEditingDependent(null);
            }}
            saving={saving}
          />
        )}

        {/* 批量新增表單 */}
        {showBatchForm && editingDependent && (
          <BatchDependentForm
            employeeId={editingDependent.employeeId}
            employees={dependentSummaries}
            onSave={async (dependents) => {
              for (const dep of dependents) {
                await handleSaveDependent(dep);
              }
              setShowBatchForm(false);
            }}
            onCancel={() => {
              setShowBatchForm(false);
              setEditingDependent(null);
            }}
            saving={saving}
          />
        )}

        {/* 刪除確認對話框 */}
        {deleteConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
              <div className="flex items-center text-red-600 mb-4">
                <AlertTriangle className="w-8 h-8 mr-3" />
                <h3 className="text-xl font-semibold">確認刪除</h3>
              </div>
              <p className="text-gray-600 mb-6">
                確定要刪除眷屬「{deleteConfirm.name}」嗎？此操作無法復原。
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleDeleteDependent}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center"
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  確認刪除
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// 眷屬表單組件
function DependentForm({ 
  dependent, 
  employees,
  onSave, 
  onCancel, 
  saving 
}: { 
  dependent: EmployeeDependent;
  employees: DependentSummary[];
  onSave: (dependent: EmployeeDependent) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [formData, setFormData] = useState<EmployeeDependent>(dependent);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  const relationshipOptions = [
    '配偶', '子女', '父親', '母親', '祖父', '祖母', '外祖父', '外祖母', '其他'
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">
            {dependent.id ? '編輯眷屬資料' : '新增眷屬資料'}
          </h3>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* 員工選擇 */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">
              員工 *
            </label>
            <select
              required
              value={formData.employeeId}
              onChange={(e) => setFormData({ ...formData, employeeId: parseInt(e.target.value) })}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-gray-900"
            >
              <option value={0}>請選擇員工</option>
              {employees.map((employee) => (
                <option key={employee.employeeId} value={employee.employeeId}>
                  {employee.employeeName} - {employee.department}
                </option>
              ))}
            </select>
          </div>

          {/* 眷屬基本資料 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                眷屬姓名 *
              </label>
              <input
                type="text"
                required
                value={formData.dependentName}
                onChange={(e) => setFormData({ ...formData, dependentName: e.target.value })}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-gray-900"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                關係 *
              </label>
              <select
                required
                value={formData.relationship}
                onChange={(e) => setFormData({ ...formData, relationship: e.target.value })}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-gray-900"
              >
                <option value="">請選擇關係</option>
                {relationshipOptions.map((rel) => (
                  <option key={rel} value={rel}>{rel}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                身分證號 *
              </label>
              <input
                type="text"
                required
                pattern="[A-Z][0-9]{9}"
                value={formData.idNumber}
                onChange={(e) => setFormData({ ...formData, idNumber: e.target.value.toUpperCase() })}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-gray-900"
                placeholder="例：A123456789"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                生日 *
              </label>
              <input
                type="date"
                required
                value={formData.birthDate}
                onChange={(e) => setFormData({ ...formData, birthDate: e.target.value })}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-gray-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                投保開始日 *
              </label>
              <input
                type="date"
                required
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-gray-900"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                投保結束日
              </label>
              <input
                type="date"
                value={formData.endDate || ''}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-gray-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">
              備註
            </label>
            <textarea
              value={formData.remarks || ''}
              onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
              rows={3}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-gray-900"
              placeholder="請輸入備註..."
            />
          </div>

          <div>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                className="rounded border-gray-300 text-red-600 shadow-sm focus:border-red-300 focus:ring focus:ring-red-200 focus:ring-opacity-50"
              />
              <span className="text-sm text-gray-900">目前投保中</span>
            </label>
          </div>

          {/* 操作按鈕 */}
          <div className="flex justify-end space-x-4 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>儲存中...</span>
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  <span>儲存</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// 台灣身分證驗證函數
function validateTaiwanId(id: string): { valid: boolean; error?: string } {
  if (!id) return { valid: false, error: '請輸入身分證號' };
  
  // 檢查長度
  if (id.length !== 10) {
    return { valid: false, error: '身分證號應為10個字元' };
  }
  
  // 檢查格式：首字母 + 9位數字
  if (!/^[A-Z][12]\d{8}$/i.test(id)) {
    return { valid: false, error: '身分證格式錯誤（首字母+性別碼+8位數字）' };
  }
  
  // 驗證碼計算
  const letterMap: Record<string, number> = {
    A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34, 
    J: 18, K: 19, L: 20, M: 21, N: 22, O: 35, P: 23, Q: 24, R: 25, 
    S: 26, T: 27, U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33
  };
  
  const firstLetter = id[0].toUpperCase();
  const letterNum = letterMap[firstLetter];
  
  if (!letterNum) {
    return { valid: false, error: '身分證首字母錯誤' };
  }
  
  // 計算加權總和
  const n1 = Math.floor(letterNum / 10);
  const n2 = letterNum % 10;
  
  let sum = n1 + n2 * 9;
  const weights = [8, 7, 6, 5, 4, 3, 2, 1, 1];
  
  for (let i = 1; i < 10; i++) {
    sum += parseInt(id[i]) * weights[i - 1];
  }
  
  if (sum % 10 !== 0) {
    return { valid: false, error: '身分證號碼驗證碼錯誤' };
  }
  
  return { valid: true };
}

// 批量新增眷屬表單組件
function BatchDependentForm({ 
  employeeId,
  employees,
  onSave, 
  onCancel, 
  saving 
}: { 
  employeeId: number;
  employees: DependentSummary[];
  onSave: (dependents: EmployeeDependent[]) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [dependents, setDependents] = useState<EmployeeDependent[]>([
    {
      employeeId: employeeId,
      dependentName: '',
      relationship: '',
      idNumber: '',
      birthDate: '',
      isActive: true,
      startDate: new Date().toISOString().split('T')[0],
      remarks: ''
    }
  ]);
  const [errors, setErrors] = useState<string[]>([]);

  const relationshipOptions = [
    '配偶', '子女', '父親', '母親', '祖父', '祖母', '外祖父', '外祖母', '其他'
  ];

  const addRow = () => {
    setDependents([...dependents, {
      employeeId: employeeId,
      dependentName: '',
      relationship: '',
      idNumber: '',
      birthDate: '',
      isActive: true,
      startDate: new Date().toISOString().split('T')[0],
      remarks: ''
    }]);
    setErrors([...errors, '']);
  };

  const removeRow = (index: number) => {
    if (dependents.length > 1) {
      setDependents(dependents.filter((_, i) => i !== index));
      setErrors(errors.filter((_, i) => i !== index));
    }
  };

  const updateDependent = (index: number, field: keyof EmployeeDependent, value: string | boolean) => {
    const updated = [...dependents];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (updated[index] as any)[field] = value;
    setDependents(updated);

    // 身分證即時驗證
    if (field === 'idNumber' && typeof value === 'string') {
      const newErrors = [...errors];
      if (value.length === 10) {
        const result = validateTaiwanId(value);
        newErrors[index] = result.valid ? '' : (result.error || '');
      } else {
        newErrors[index] = '';
      }
      setErrors(newErrors);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // 驗證所有身分證
    const newErrors: string[] = [];
    let hasError = false;
    
    dependents.forEach((dep, index) => {
      if (!dep.dependentName.trim() || !dep.relationship || !dep.idNumber.trim()) {
        newErrors[index] = '請填寫完整資料';
        hasError = true;
      } else {
        const result = validateTaiwanId(dep.idNumber);
        if (!result.valid) {
          newErrors[index] = result.error || '身分證格式錯誤';
          hasError = true;
        } else {
          newErrors[index] = '';
        }
      }
    });
    
    setErrors(newErrors);
    
    if (!hasError) {
      onSave(dependents);
    }
  };

  const employee = employees.find(e => e.employeeId === employeeId);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-gray-900">
              批量新增眷屬
            </h3>
            {employee && (
              <p className="text-sm text-gray-600">員工：{employee.employeeName} - {employee.department}</p>
            )}
          </div>
          <button
            onClick={onCancel}
            className="p-2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-4">
            {dependents.map((dep, index) => (
              <div key={index} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-gray-700">眷屬 {index + 1}</span>
                  {dependents.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(index)}
                      className="text-red-500 hover:text-red-700 text-sm"
                    >
                      移除
                    </button>
                  )}
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <input
                    type="text"
                    placeholder="眷屬姓名 *"
                    value={dep.dependentName}
                    onChange={(e) => updateDependent(index, 'dependentName', e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:ring-red-500 focus:border-red-500 text-gray-900"
                    required
                  />
                  <select
                    value={dep.relationship}
                    onChange={(e) => updateDependent(index, 'relationship', e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:ring-red-500 focus:border-red-500 text-gray-900"
                    required
                  >
                    <option value="">選擇關係 *</option>
                    {relationshipOptions.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="身分證號 *"
                    value={dep.idNumber}
                    onChange={(e) => updateDependent(index, 'idNumber', e.target.value.toUpperCase())}
                    className={`px-3 py-2 border rounded-md focus:ring-red-500 focus:border-red-500 text-gray-900 ${
                      errors[index] ? 'border-red-500' : 'border-gray-300'
                    }`}
                    maxLength={10}
                    required
                  />
                  <input
                    type="date"
                    placeholder="生日"
                    value={dep.birthDate}
                    onChange={(e) => updateDependent(index, 'birthDate', e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md focus:ring-red-500 focus:border-red-500 text-gray-900"
                  />
                </div>
                {errors[index] && (
                  <p className="mt-2 text-sm text-red-600">{errors[index]}</p>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addRow}
            className="mt-4 w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-gray-400 hover:text-gray-700 flex items-center justify-center"
          >
            <Plus className="w-4 h-4 mr-2" />
            新增一筆
          </button>

          <div className="flex justify-end space-x-3 mt-6 pt-4 border-t">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center"
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  儲存中...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  批量儲存 ({dependents.length} 筆)
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
