'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Save, Plus, Edit2, Trash2, Search, AlertTriangle, Download, Upload, X, FileText, BarChart3, History, CheckCircle, Clock } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';


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

function readLinkedApplicationId() {
  if (typeof window === 'undefined') {
    return null;
  }

  const rawId = new URLSearchParams(window.location.search).get('id');
  if (!rawId) {
    return null;
  }

  const parsedId = Number(rawId);
  return Number.isInteger(parsedId) && parsedId > 0 ? parsedId : null;
}

export default function HealthInsuranceDependentsPage() {
  const router = useRouter();
  const [, setUser] = useState<{
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
  const [departmentFilter, setDepartmentFilter] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [showBatchForm, setShowBatchForm] = useState(false);
  const [editingDependent, setEditingDependent] = useState<EmployeeDependent | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name: string } | null>(null);
  const [linkedApplicationId, setLinkedApplicationId] = useState<number | null>(null);
  
  // 頁籤狀態
  const [activeTab, setActiveTab] = useState<'dependents' | 'enrollment' | 'statistics' | 'history' | 'applications'>('dependents');
  
  // 加退保記錄
  const [enrollmentLogs, setEnrollmentLogs] = useState<Array<{
    id: number;
    dependentName: string;
    employeeName: string;
    type: string;
    effectiveDate: string;
    reportStatus: string;
    reportDate: string | null;
    createdBy: string;
    createdAt: string;
  }>>([]);
  
  // 統計資料
  const [statistics, setStatistics] = useState<{
    summary: { totalDependents: number; totalEmployeesWithDependents: number; averageDependentsPerEmployee: number };
    monthlyStats: Array<{ month: number; dependentCount: number; estimatedPremium: number }>;
    departmentStats: Array<{ department: string; count: number }>;
    relationshipStats: Array<{ relationship: string; count: number }>;
  } | null>(null);
  
  // 異動歷史
  const [historyLogs, setHistoryLogs] = useState<Array<{
    id: number;
    dependentName: string;
    employeeName: string;
    action: string;
    fieldName: string | null;
    oldValue: string | null;
    newValue: string | null;
    changedBy: string;
    changedAt: string;
  }>>([]);

  // 待審核申請
  const [pendingApplications, setPendingApplications] = useState<Array<{
    id: number;
    employeeId: number;
    employeeName: string;
    applicationType: string;
    status: string;
    dependentName: string;
    relationship: string;
    idNumber: string;
    birthDate: string;
    effectiveDate: string;
    remarks: string | null;
    createdAt: string;
    attachments: Array<{
      id: number;
      fileType: string;
      fileTypeName: string;
      fileName: string;
      filePath: string;
      fileSize: number;
      mimeType: string;
    }>;
  }>>([]);
  const [applicationStats, setApplicationStats] = useState({ pending: 0, approved: 0, rejected: 0 });

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include'
        });
        
        if (response.ok) {
          const userData = await response.json();
          const currentUser = userData.user || userData;
          
          if (currentUser.role !== 'ADMIN' && currentUser.role !== 'HR') {
            router.push('/dashboard');
            return;
          }
          setUser(currentUser);

          const requestId = readLinkedApplicationId();
          if (requestId) {
            setLinkedApplicationId(requestId);
            setActiveTab('applications');
            await Promise.all([loadDependents(), loadApplications()]);
          } else {
            await loadDependents();
          }
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

  // 載入加退保記錄
  const loadEnrollmentLogs = async () => {
    try {
      const response = await fetch('/api/system-settings/dependent-enrollment', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setEnrollmentLogs(data.logs || []);
      }
    } catch (error) {
      console.error('載入加退保記錄失敗:', error);
    }
  };

  // 載入統計資料
  const loadStatistics = async () => {
    try {
      const response = await fetch('/api/system-settings/dependent-statistics', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setStatistics(data);
      }
    } catch (error) {
      console.error('載入統計資料失敗:', error);
    }
  };

  // 載入異動歷史
  const loadHistoryLogs = async () => {
    try {
      const response = await fetch('/api/system-settings/dependent-history', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setHistoryLogs(data.logs || []);
      }
    } catch (error) {
      console.error('載入異動歷史失敗:', error);
    }
  };

  // 載入待審核申請
  const loadApplications = async () => {
    try {
      const response = await fetch('/api/dependent-applications', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setPendingApplications(data.applications || []);
        setApplicationStats(data.stats || { pending: 0, approved: 0, rejected: 0 });
      }
    } catch (error) {
      console.error('載入待審核申請失敗:', error);
    }
  };

  // 審核申請
  const handleReviewApplication = async (id: number, action: 'APPROVE' | 'REJECT', reviewNote?: string) => {
    try {
      const response = await fetchJSONWithCSRF('/api/dependent-applications', {
        method: 'PUT',
        body: { id, action, reviewNote }
      });

      if (response.ok) {
        setMessage({ type: 'success', text: action === 'APPROVE' ? '申請已通過' : '申請已退回' });
        await loadApplications();
        await loadDependents();
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || '操作失敗' });
      }
    } catch (error) {
      console.error('審核失敗:', error);
      setMessage({ type: 'error', text: '操作失敗' });
    }
  };

  // 頁籤切換時載入對應資料
  const handleTabChange = (tab: typeof activeTab) => {
    setActiveTab(tab);
    if (tab === 'enrollment') loadEnrollmentLogs();
    if (tab === 'statistics') loadStatistics();
    if (tab === 'history') loadHistoryLogs();
    if (tab === 'applications') loadApplications();
  };

  const saveDependentRecord = async (dependent: EmployeeDependent) => {
    const response = await fetchJSONWithCSRF('/api/system-settings/health-insurance-dependents', {
      method: 'POST',
      body: dependent
    });

    if (response.ok) {
      return { ok: true as const };
    }

    const errorData = await response.json();
    return {
      ok: false as const,
      error: typeof errorData?.error === 'string' ? errorData.error : '儲存失敗'
    };
  };

  const handleSaveDependent = async (dependent: EmployeeDependent) => {
    setSaving(true);
    setMessage(null);

    try {
      const result = await saveDependentRecord(dependent);

      if (result.ok) {
        await loadDependents();
        setShowForm(false);
        setEditingDependent(null);
        setMessage({ type: 'success', text: '眷屬資料已儲存成功！' });
      } else {
        setMessage({ type: 'error', text: result.error });
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

  // 取得所有部門（用於篩選器）
  const allDepartments = [...new Set(dependentSummaries.map(s => s.department).filter(Boolean))].sort();

  // 過濾搜尋結果（加入部門篩選）
  const filteredSummaries = dependentSummaries.filter(summary => {
    // 部門篩選
    if (departmentFilter && summary.department !== departmentFilter) {
      return false;
    }
    // 文字搜尋
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return (
        summary.employeeName.toLowerCase().includes(term) ||
        summary.department.toLowerCase().includes(term) ||
        summary.dependents.some(dep => 
          dep.dependentName.toLowerCase().includes(term)
        )
      );
    }
    return true;
  });

  // 統計資料
  const totalEmployeesWithDependents = dependentSummaries.filter(s => s.dependentCount > 0).length;
  const totalDependents = dependentSummaries.reduce((sum, s) => sum + s.dependentCount, 0);
  const averageDependents = totalEmployeesWithDependents > 0 
    ? (totalDependents / totalEmployeesWithDependents).toFixed(1) 
    : '0';

  if (loading) {
    return (
      <AuthenticatedLayout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-gray-600">載入中...</div>
        </div>
      </AuthenticatedLayout>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto p-6">
        {/* 標題區 */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <Users className="w-8 h-8 text-blue-600 mr-3" />
            健保眷屬管理
          </h1>
          <p className="text-gray-600 mt-1">管理員工健保投保眷屬資料</p>
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

        {/* 頁籤切換 */}
        <div className="mb-6 flex border-b border-gray-200">
          <button
            onClick={() => handleTabChange('dependents')}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'dependents'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Users className="inline-block w-4 h-4 mr-2" />
            眷屬管理
          </button>
          <button
            onClick={() => handleTabChange('enrollment')}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'enrollment'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <FileText className="inline-block w-4 h-4 mr-2" />
            加退保記錄
          </button>
          <button
            onClick={() => handleTabChange('statistics')}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'statistics'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <BarChart3 className="inline-block w-4 h-4 mr-2" />
            統計報表
          </button>
          <button
            onClick={() => handleTabChange('history')}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'history'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <History className="inline-block w-4 h-4 mr-2" />
            異動歷史
          </button>
          <button
            onClick={() => handleTabChange('applications')}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'applications'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Clock className="inline-block w-4 h-4 mr-2" />
            待審核
            {applicationStats.pending > 0 && (
              <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold bg-red-500 text-white rounded-full">
                {applicationStats.pending}
              </span>
            )}
          </button>
        </div>

        {/* 加退保記錄頁籤 */}
        {activeTab === 'enrollment' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">加退保記錄</h2>
            </div>
            {enrollmentLogs.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <FileText className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <p>尚無加退保記錄</p>
              </div>
            ) : (
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">眷屬</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">員工</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">類型</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">生效日</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">申報狀態</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {enrollmentLogs.map(log => (
                    <tr key={log.id}>
                      <td className="px-4 py-3 text-gray-900">{log.dependentName}</td>
                      <td className="px-4 py-3 text-gray-600">{log.employeeName}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          log.type === 'ENROLL' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {log.type === 'ENROLL' ? '加保' : '退保'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{new Date(log.effectiveDate).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-full ${
                          log.reportStatus === 'COMPLETED' ? 'bg-green-100 text-green-800' :
                          log.reportStatus === 'REPORTED' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {log.reportStatus === 'COMPLETED' && <CheckCircle className="h-3 w-3" />}
                          {log.reportStatus === 'REPORTED' && <Clock className="h-3 w-3" />}
                          {log.reportStatus === 'PENDING' && <Clock className="h-3 w-3" />}
                          {log.reportStatus === 'COMPLETED' ? '已完成' : log.reportStatus === 'REPORTED' ? '已申報' : '待申報'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* 統計報表頁籤 */}
        {activeTab === 'statistics' && statistics && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">部門眷屬統計</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {statistics.departmentStats.map(dept => (
                  <div key={dept.department} className="bg-gray-50 rounded-lg p-4">
                    <div className="text-2xl font-bold text-blue-600">{dept.count}</div>
                    <div className="text-sm text-gray-600">{dept.department}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">眷屬關係統計</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {statistics.relationshipStats.map(rel => (
                  <div key={rel.relationship} className="bg-purple-50 rounded-lg p-4">
                    <div className="text-2xl font-bold text-purple-600">{rel.count}</div>
                    <div className="text-sm text-gray-600">{rel.relationship}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 異動歷史頁籤 */}
        {activeTab === 'history' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">異動歷史</h2>
            </div>
            {historyLogs.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <History className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <p>尚無異動記錄</p>
              </div>
            ) : (
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">時間</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">眷屬</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">變更</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作人</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {historyLogs.map(log => (
                    <tr key={log.id}>
                      <td className="px-4 py-3 text-gray-600 text-sm">{new Date(log.changedAt).toLocaleString()}</td>
                      <td className="px-4 py-3 text-gray-900">{log.dependentName}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          log.action === 'CREATE' ? 'bg-green-100 text-green-800' :
                          log.action === 'UPDATE' ? 'bg-blue-100 text-blue-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {log.action === 'CREATE' ? '新增' : log.action === 'UPDATE' ? '更新' : '刪除'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {log.fieldName && (
                          <span>
                            {log.fieldName}: <span className="line-through text-red-500">{log.oldValue}</span> → <span className="text-green-600">{log.newValue}</span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{log.changedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* 待審核頁籤 */}
        {activeTab === 'applications' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-lg font-medium text-gray-900">待審核申請</h2>
              <div className="flex gap-4 text-sm">
                <span className="text-yellow-600">待審核: {applicationStats.pending}</span>
                <span className="text-green-600">已通過: {applicationStats.approved}</span>
                <span className="text-red-600">已退回: {applicationStats.rejected}</span>
              </div>
            </div>
            {pendingApplications.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Clock className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <p>沒有申請記錄</p>
              </div>
            ) : (
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">申請時間</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">員工</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">類型</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">眷屬</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">關係</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">生效日</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">附件</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">狀態</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {pendingApplications.map(app => (
                    <tr key={app.id} className={linkedApplicationId === app.id ? 'bg-yellow-50' : undefined}>
                      <td className="px-4 py-3 text-gray-600 text-sm">{new Date(app.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-3 text-gray-900 font-medium">{app.employeeName}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          app.applicationType === 'ADD' ? 'bg-green-100 text-green-800' :
                          app.applicationType === 'REMOVE' ? 'bg-red-100 text-red-800' :
                          'bg-blue-100 text-blue-800'
                        }`}>
                          {app.applicationType === 'ADD' ? '加保' : app.applicationType === 'REMOVE' ? '退保' : '變更'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-900">{app.dependentName}</td>
                      <td className="px-4 py-3 text-gray-600">{app.relationship}</td>
                      <td className="px-4 py-3 text-gray-600">{app.effectiveDate}</td>
                      <td className="px-4 py-3">
                        {app.attachments && app.attachments.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {app.attachments.map(att => (
                              <a
                                key={att.id}
                                href={att.filePath}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                                title={`${att.fileName} (${(att.fileSize / 1024).toFixed(1)} KB)`}
                              >
                                <FileText className="h-3 w-3" />
                                {att.fileTypeName}
                              </a>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-400 text-xs">無附件</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          app.status === 'PENDING' ? 'bg-yellow-100 text-yellow-800' :
                          app.status === 'APPROVED' ? 'bg-green-100 text-green-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {app.status === 'PENDING' ? '待審核' : app.status === 'APPROVED' ? '已通過' : '已退回'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {app.status === 'PENDING' && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleReviewApplication(app.id, 'APPROVE')}
                              className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                            >
                              通過
                            </button>
                            <button
                              onClick={() => handleReviewApplication(app.id, 'REJECT')}
                              className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                            >
                              退回
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* 眷屬管理頁籤（原有內容） */}
        {activeTab === 'dependents' && (
          <>
        {/* 搜尋列和操作按鈕 */}
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
            {/* 部門篩選器 */}
            <div className="w-full sm:w-48">
              <select
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white"
              >
                <option value="">所有部門</option>
                {allDepartments.map(dept => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>
            
            {/* 搜尋框 */}
            <div className="flex-1 relative">
              <Search className="h-5 w-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
              <input
                type="text"
                placeholder="搜尋員工姓名或眷屬姓名..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-gray-900"
              />
            </div>
            
            {/* 匯出按鈕 */}
            <button
              onClick={handleExportCSV}
              disabled={totalDependents === 0}
              className="inline-flex items-center justify-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <Download className="w-4 h-4 mr-2" />
              匯出 CSV
            </button>
          </div>
          
          {/* 篩選結果提示 */}
          {(departmentFilter || searchTerm) && (
            <div className="mt-3 flex items-center gap-2 text-sm text-gray-600">
              <span>篩選結果：{filteredSummaries.length} 位員工</span>
              {(departmentFilter || searchTerm) && (
                <button
                  onClick={() => { setDepartmentFilter(''); setSearchTerm(''); }}
                  className="text-blue-600 hover:text-blue-800 underline"
                >
                  清除篩選
                </button>
              )}
            </div>
          )}
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
              setSaving(true);
              setMessage(null);

              let successCount = 0;
              let firstError: string | null = null;

              try {
                for (const dep of dependents) {
                  const result = await saveDependentRecord(dep);
                  if (result.ok) {
                    successCount += 1;
                  } else {
                    firstError = result.error;
                    break;
                  }
                }

                if (successCount > 0) {
                  await loadDependents();
                }

                setMessage(
                  firstError
                    ? {
                        type: 'error',
                        text: successCount > 0
                          ? `已成功儲存 ${successCount} 筆，但後續失敗：${firstError}`
                          : firstError
                      }
                    : { type: 'success', text: `已批量儲存 ${successCount} 筆眷屬資料` }
                );
              } catch (error) {
                console.error('批量儲存眷屬資料失敗:', error);
                setMessage({ type: 'error', text: '批量儲存失敗，請稍後再試' });
              } finally {
                setSaving(false);
              }

              setShowBatchForm(false);
              setEditingDependent(null);
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
        </>
        )}
      </div>
    </AuthenticatedLayout>
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
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900">
            {dependent.id ? '編輯眷屬資料' : '新增眷屬資料'}
          </h3>
          <button
            onClick={onCancel}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
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
        if (!dep.dependentName.trim() || !dep.relationship || !dep.idNumber.trim() || !dep.birthDate.trim()) {
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
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-6 h-6" />
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
                    required
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
