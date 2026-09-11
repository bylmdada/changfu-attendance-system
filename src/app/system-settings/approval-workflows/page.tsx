'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Settings, Users, Clock, Save, Plus, Trash2, UserCheck, Timer, Play, Edit2, X, Check } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import SystemNavbar from '@/components/SystemNavbar';
import ConfirmDialog from '@/components/ConfirmDialog';

interface Workflow {
  id: number;
  workflowType: string;
  department: string;
  workflowName: string;
  approvalLevel: number;
  requireManager: boolean;
  finalApprover: string;
  deadlineMode: string;
  deadlineHours: number | null;
  enableForward: boolean;  // 轉會給其他審核者
  enableCC: boolean;       // CC 給員工知悉/同意
}

interface FreezeReminder {
  id: number;
  daysBeforeFreeze1: number;
  daysBeforeFreeze2: number;
  freezeDayReminderTime: string;
}

interface Manager {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  department: string;
  isPrimary: boolean;
  isActive: boolean;
  deputies: Array<{
    id: number;
    employeeId: number;
    employeeName: string;
    startDate: string | null;
    endDate: string | null;
    isActive: boolean;
  }>;
}

interface Employee {
  id: number;
  employeeId: string;
  name: string;
  department: string;
}

interface OverdueSettings {
  enabled: boolean;
  autoEscalateEnabled: boolean;
  autoEscalateHours: number;
  autoRejectEnabled: boolean;
  autoRejectDays: number;
  dailyReportEnabled: boolean;
  dailyReportTime: string;
}

interface OverdueStats {
  total: number;
  overdue: number;
  urgent: number;
  todayProcessed: number;
  percentOverdue: number;
}

const DEFAULT_WORKFLOW_DEPARTMENT = '__ALL__';

function getWorkflowDepartmentLabel(department: string) {
  return department === DEFAULT_WORKFLOW_DEPARTMENT ? '全公司預設' : department;
}

function getWorkflowDepartment(workflow: Workflow) {
  return workflow.department || DEFAULT_WORKFLOW_DEPARTMENT;
}

export default function ApprovalWorkflowsPage() {
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'workflows' | 'managers' | 'deputies' | 'overdue'>('workflows');
  
  // 工作流程設定
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [savedWorkflowKey, setSavedWorkflowKey] = useState('');
  const [selectedWorkflowDepartment, setSelectedWorkflowDepartment] = useState(DEFAULT_WORKFLOW_DEPARTMENT);
  const [newWorkflowDepartment, setNewWorkflowDepartment] = useState('');
  const [deletedWorkflowIds, setDeletedWorkflowIds] = useState<number[]>([]);
  const [freezeReminder, setFreezeReminder] = useState<FreezeReminder | null>(null);
  const [freezeSettings, setFreezeSettings] = useState<{ freezeDay: number; freezeTime: string } | null>(null);
  const [overdueSettings, setOverdueSettings] = useState<OverdueSettings | null>(null);
  const [overdueStats, setOverdueStats] = useState<OverdueStats | null>(null);
  const [overdueLoading, setOverdueLoading] = useState(true);
  const [overdueSaving, setOverdueSaving] = useState(false);
  const [overdueRunning, setOverdueRunning] = useState(false);
  
  // 部門主管
  const [managers, setManagers] = useState<Manager[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showAddManager, setShowAddManager] = useState(false);
  const [newManager, setNewManager] = useState({ employeeId: 0, department: '', isPrimary: true });
  
  // 編輯主管
  const [editingManagerId, setEditingManagerId] = useState<number | null>(null);
  const [editManager, setEditManager] = useState({ department: '', isPrimary: true });
  
  // 代理人設定
  const [showAddDeputy, setShowAddDeputy] = useState<number | null>(null); // 顯示哪個主管的新增代理人表單
  const [newDeputy, setNewDeputy] = useState({ employeeId: 0, startDate: '', endDate: '' });
  
  // 編輯代理人
  const [editingDeputyId, setEditingDeputyId] = useState<number | null>(null);
  const [editDeputy, setEditDeputy] = useState({ startDate: '', endDate: '' });
  const [deleteManagerTarget, setDeleteManagerTarget] = useState<Manager | null>(null);
  const [deleteDeputyTarget, setDeleteDeputyTarget] = useState<{ id: number; employeeName: string } | null>(null);
  
  // 訊息
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api/auth/me', { credentials: 'include' });
        if (response.ok) {
          const data = await response.json();
          if (data.user?.role !== 'ADMIN') {
            router.push('/dashboard');
            return;
          }
          setUser(data.user);
          await Promise.all([loadWorkflows(), loadManagers(), loadOverdueSettings()]);
        } else {
          router.push('/login');
        }
      } catch {
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [router]);

  const loadWorkflows = async () => {
    try {
      const response = await fetch('/api/system-settings/approval-workflows', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        const loadedWorkflows = (data.workflows || []).map((workflow: Workflow) => ({
          ...workflow,
          department: getWorkflowDepartment(workflow)
        }));
        setWorkflows(loadedWorkflows);
        setDeletedWorkflowIds([]);
        setFreezeReminder(data.freezeReminder);
        setFreezeSettings(data.freezeSettings);
        setSavedWorkflowKey(JSON.stringify({ workflows: loadedWorkflows, freezeReminder: data.freezeReminder, deletedWorkflowIds: [] }));
      }
    } catch (error) {
      console.error('載入工作流程失敗:', error);
    }
  };

  const loadManagers = async () => {
    try {
      const response = await fetch('/api/system-settings/department-managers', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setManagers(data.managers || []);
        setDepartments(data.departments || []);
        setEmployees(data.employees || []);
      }
    } catch (error) {
      console.error('載入部門主管失敗:', error);
    }
  };

  const loadOverdueSettings = async () => {
    try {
      const response = await fetch('/api/system-settings/approval-overdue', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setOverdueSettings(data.settings || null);
        setOverdueStats(data.stats || null);
      }
    } catch (error) {
      console.error('載入逾期處理設定失敗:', error);
    } finally {
      setOverdueLoading(false);
    }
  };

  const handleSaveWorkflows = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/approval-workflows', {
        method: 'PUT',
        body: { workflows, deletedWorkflowIds, freezeReminder }
      });
      if (response.ok) {
        setSavedWorkflowKey(JSON.stringify({ workflows, freezeReminder, deletedWorkflowIds: [] }));
        setDeletedWorkflowIds([]);
        setMessage({ type: 'success', text: '設定已儲存' });
      } else {
        setMessage({ type: 'error', text: '儲存失敗' });
      }
    } catch {
      setMessage({ type: 'error', text: '儲存失敗' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOverdueSettings = async () => {
    if (!overdueSettings) {
      return;
    }

    setOverdueSaving(true);
    setMessage(null);

    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/approval-overdue', {
        method: 'PUT',
        body: overdueSettings
      });

      if (response.ok) {
        const data = await response.json();
        setOverdueSettings(data.settings || overdueSettings);
        setMessage({ type: 'success', text: '逾期處理設定已儲存' });
        await loadOverdueSettings();
      } else {
        const error = await response.json().catch(() => null);
        setMessage({ type: 'error', text: error?.error || '逾期處理設定儲存失敗' });
      }
    } catch {
      setMessage({ type: 'error', text: '逾期處理設定儲存失敗' });
    } finally {
      setOverdueSaving(false);
    }
  };

  const handleRunOverdueProcess = async () => {
    if (!overdueSettings) {
      return;
    }

    setOverdueRunning(true);
    setMessage(null);

    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/approval-overdue', {
        method: 'POST',
        body: {
          forceRun: !overdueSettings.enabled
        }
      });

      if (response.ok) {
        const data = await response.json();
        const result = data.result || {};
        const reportSuffix = result.reportSent ? '，並已送出報告' : '';
        setMessage({
          type: 'success',
          text: `已執行逾期處理：升級 ${result.escalated ?? 0} 筆、取消 ${result.rejected ?? 0} 筆${reportSuffix}`
        });
        await loadOverdueSettings();
      } else {
        const error = await response.json().catch(() => null);
        setMessage({ type: 'error', text: error?.message || error?.error || '執行逾期處理失敗' });
      }
    } catch {
      setMessage({ type: 'error', text: '執行逾期處理失敗' });
    } finally {
      setOverdueRunning(false);
    }
  };

  const handleAddManager = async () => {
    if (!newManager.employeeId || !newManager.department) {
      setMessage({ type: 'error', text: '請選擇員工和部門' });
      return;
    }
    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/department-managers', {
        method: 'POST',
        body: newManager
      });
      if (response.ok) {
        setMessage({ type: 'success', text: '已新增部門主管' });
        setShowAddManager(false);
        setNewManager({ employeeId: 0, department: '', isPrimary: true });
        await loadManagers();
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || '新增失敗' });
      }
    } catch {
      setMessage({ type: 'error', text: '新增失敗' });
    }
  };

  const handleDeleteManager = async () => {
    if (!deleteManagerTarget) return;

    try {
      const response = await fetchJSONWithCSRF(`/api/system-settings/department-managers?id=${deleteManagerTarget.id}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        setMessage({ type: 'success', text: '已刪除' });
        setDeleteManagerTarget(null);
        await loadManagers();
      }
    } catch {
      setMessage({ type: 'error', text: '刪除失敗' });
    }
  };

  // 新增代理人
  const handleAddDeputy = async (managerId: number) => {
    if (!newDeputy.employeeId) {
      setMessage({ type: 'error', text: '請選擇代理人' });
      return;
    }
    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/manager-deputies', {
        method: 'POST',
        body: { 
          managerId, 
          deputyEmployeeId: newDeputy.employeeId,
          startDate: newDeputy.startDate || null,
          endDate: newDeputy.endDate || null
        }
      });
      if (response.ok) {
        setMessage({ type: 'success', text: '已新增代理人' });
        setShowAddDeputy(null);
        setNewDeputy({ employeeId: 0, startDate: '', endDate: '' });
        await loadManagers();
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || '新增失敗' });
      }
    } catch {
      setMessage({ type: 'error', text: '新增代理人失敗' });
    }
  };

  // 刪除代理人
  const handleDeleteDeputy = async () => {
    if (!deleteDeputyTarget) return;

    try {
      const response = await fetchJSONWithCSRF(`/api/system-settings/manager-deputies?id=${deleteDeputyTarget.id}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        setMessage({ type: 'success', text: '已刪除代理人' });
        setDeleteDeputyTarget(null);
        await loadManagers();
      }
    } catch {
      setMessage({ type: 'error', text: '刪除代理人失敗' });
    }
  };

  // 開始編輯主管
  const startEditManager = (manager: Manager) => {
    setEditingManagerId(manager.id);
    setEditManager({ department: manager.department, isPrimary: manager.isPrimary });
  };

  // 儲存主管編輯
  const handleSaveManager = async (managerId: number) => {
    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/department-managers', {
        method: 'PUT',
        body: { 
          id: managerId, 
          department: editManager.department,
          isPrimary: editManager.isPrimary
        }
      });
      if (response.ok) {
        setMessage({ type: 'success', text: '已更新主管設定' });
        setEditingManagerId(null);
        await loadManagers();
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || '更新失敗' });
      }
    } catch {
      setMessage({ type: 'error', text: '更新主管設定失敗' });
    }
  };

  // 開始編輯代理人
  const startEditDeputy = (deputy: { id: number; startDate: string | null; endDate: string | null }) => {
    setEditingDeputyId(deputy.id);
    setEditDeputy({ 
      startDate: deputy.startDate || '', 
      endDate: deputy.endDate || '' 
    });
  };

  // 儲存代理人編輯
  const handleSaveDeputy = async (deputyId: number) => {
    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/manager-deputies', {
        method: 'PUT',
        body: { 
          id: deputyId, 
          startDate: editDeputy.startDate || null,
          endDate: editDeputy.endDate || null
        }
      });
      if (response.ok) {
        setMessage({ type: 'success', text: '已更新代理人設定' });
        setEditingDeputyId(null);
        await loadManagers();
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || '更新失敗' });
      }
    } catch {
      setMessage({ type: 'error', text: '更新代理人設定失敗' });
    }
  };

  const updateWorkflow = (id: number, field: string, value: unknown) => {
    setWorkflows(prev => prev.map(wf => 
      wf.id === id
        ? {
            ...wf,
            [field]: value,
            ...(field === 'requireManager' && value === false ? { approvalLevel: 1 } : {})
          }
        : wf
    ));
  };

  const workflowDepartmentOptions = [
    DEFAULT_WORKFLOW_DEPARTMENT,
    ...Array.from(new Set(workflows.map(getWorkflowDepartment).filter((department) => department !== DEFAULT_WORKFLOW_DEPARTMENT))).sort()
  ];
  const visibleWorkflows = workflows.filter((workflow) => getWorkflowDepartment(workflow) === selectedWorkflowDepartment);
  const configuredWorkflowDepartments = new Set(workflowDepartmentOptions);
  const availableNewWorkflowDepartments = departments
    .filter((department) => !configuredWorkflowDepartments.has(department))
    .sort();

  const handleAddDepartmentWorkflows = () => {
    if (!newWorkflowDepartment) {
      setMessage({ type: 'error', text: '請選擇要新增流程的部門' });
      return;
    }

    if (configuredWorkflowDepartments.has(newWorkflowDepartment)) {
      setMessage({ type: 'error', text: '此部門已設定審核流程' });
      return;
    }

    const defaultWorkflows = workflows.filter((workflow) => getWorkflowDepartment(workflow) === DEFAULT_WORKFLOW_DEPARTMENT);
    if (defaultWorkflows.length === 0) {
      setMessage({ type: 'error', text: '找不到全公司預設流程，無法新增部門流程' });
      return;
    }

    const now = Date.now();
    const departmentWorkflows = defaultWorkflows.map((workflow, index) => ({
      ...workflow,
      id: -(now + index),
      department: newWorkflowDepartment
    }));

    setWorkflows((prev) => [...prev, ...departmentWorkflows]);
    setSelectedWorkflowDepartment(newWorkflowDepartment);
    setNewWorkflowDepartment('');
    setMessage({ type: 'success', text: '已新增部門流程，請調整後儲存' });
  };

  const handleRemoveDepartmentWorkflows = (department: string) => {
    if (department === DEFAULT_WORKFLOW_DEPARTMENT) return;

    const removingWorkflows = workflows.filter((workflow) => getWorkflowDepartment(workflow) === department);
    setDeletedWorkflowIds((prev) => Array.from(new Set([
      ...prev,
      ...removingWorkflows.filter((workflow) => workflow.id > 0).map((workflow) => workflow.id)
    ])));
    setWorkflows((prev) => prev.filter((workflow) => getWorkflowDepartment(workflow) !== department));
    setSelectedWorkflowDepartment(DEFAULT_WORKFLOW_DEPARTMENT);
    setMessage({ type: 'success', text: '已移除部門流程，儲存後生效' });
  };

  const updateOverdueSetting = <K extends keyof OverdueSettings>(field: K, value: OverdueSettings[K]) => {
    setOverdueSettings(prev => prev ? { ...prev, [field]: value } : prev);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">載入中...</div>
      </div>
    );
  }

  const workflowKey = JSON.stringify({ workflows, freezeReminder, deletedWorkflowIds });
  const hasWorkflowChanges = savedWorkflowKey !== '' && workflowKey !== savedWorkflowKey;

  return (
    <div className="min-h-screen bg-gray-50">
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 標題 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <Settings className="w-8 h-8 text-blue-600 mr-3" />
            審核流程管理
          </h1>
          <p className="text-gray-600 mt-2">設定各類申請的審核層級、時效與部門主管</p>
        </div>

        {message && (
          <div className={`mb-6 p-4 rounded-lg ${
            message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
          }`}>
            {message.text}
          </div>
        )}

        {/* 頁籤 */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab('workflows')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'workflows'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Settings className="inline w-4 h-4 mr-2" />
              流程設定
            </button>
            <button
              onClick={() => setActiveTab('managers')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'managers'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Users className="inline w-4 h-4 mr-2" />
              部門主管
            </button>
            <button
              onClick={() => setActiveTab('deputies')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'deputies'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <UserCheck className="inline w-4 h-4 mr-2" />
              代理人設定
            </button>
            <button
              onClick={() => setActiveTab('overdue')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'overdue'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Timer className="inline w-4 h-4 mr-2" />
              逾期處理
            </button>
          </nav>
        </div>

        {/* 流程設定頁籤 */}
        {activeTab === 'workflows' && (
          <div className="space-y-6">
            {/* 審核流程表格 */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-medium text-gray-900">審核流程設定</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    {saving ? '儲存中...' : hasWorkflowChanges ? '有未儲存變更' : '已儲存'}，
                    目前：{getWorkflowDepartmentLabel(selectedWorkflowDepartment)}
                  </p>
                </div>
                <button
                  onClick={handleSaveWorkflows}
                  disabled={saving || !hasWorkflowChanges}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {saving ? '儲存中...' : '儲存設定'}
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 border-b border-gray-200 bg-gray-50 px-6 py-4 lg:grid-cols-[minmax(220px,320px)_minmax(220px,320px)_auto_auto] lg:items-end">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">編輯範圍</label>
                  <select
                    value={selectedWorkflowDepartment}
                    onChange={(e) => setSelectedWorkflowDepartment(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  >
                    {workflowDepartmentOptions.map((department) => (
                      <option key={department} value={department}>
                        {getWorkflowDepartmentLabel(department)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">新增部門流程</label>
                  <select
                    value={newWorkflowDepartment}
                    onChange={(e) => setNewWorkflowDepartment(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">請選擇部門</option>
                    {availableNewWorkflowDepartments.map((department) => (
                      <option key={department} value={department}>{department}</option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={handleAddDepartmentWorkflows}
                  disabled={!newWorkflowDepartment}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  新增
                </button>

                {selectedWorkflowDepartment !== DEFAULT_WORKFLOW_DEPARTMENT && (
                  <button
                    type="button"
                    onClick={() => handleRemoveDepartmentWorkflows(selectedWorkflowDepartment)}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    移除部門流程
                  </button>
                )}
              </div>
              
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">適用部門</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">申請類型</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">層級</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">需主管</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">時效模式</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">時效(H)</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">轉會</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">CC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {visibleWorkflows.map(wf => (
                      <tr key={wf.id}>
                        <td className="px-4 py-3 text-gray-900">{getWorkflowDepartmentLabel(getWorkflowDepartment(wf))}</td>
                        <td className="px-4 py-3 text-gray-900 font-medium">{wf.workflowName}</td>
                        <td className="px-4 py-3 text-center">
                          <select
                            value={wf.approvalLevel}
                            onChange={(e) => updateWorkflow(wf.id, 'approvalLevel', parseInt(e.target.value))}
                            disabled={!wf.requireManager}
                            className="border rounded px-2 py-1 text-sm text-gray-900"
                          >
                            <option value={1}>一階</option>
                            <option value={2}>二階</option>
                          </select>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={wf.requireManager}
                            onChange={(e) => updateWorkflow(wf.id, 'requireManager', e.target.checked)}
                            className="rounded border-gray-300"
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <select
                            value={wf.deadlineMode}
                            onChange={(e) => updateWorkflow(wf.id, 'deadlineMode', e.target.value)}
                            className="border rounded px-2 py-1 text-sm text-gray-900"
                          >
                            <option value="FIXED">固定時效</option>
                            <option value="FREEZE_BASED">配合凍結</option>
                          </select>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {wf.deadlineMode === 'FIXED' ? (
                            <input
                              type="number"
                              value={wf.deadlineHours || ''}
                              onChange={(e) => updateWorkflow(wf.id, 'deadlineHours', parseInt(e.target.value) || null)}
                              className="w-20 border rounded px-2 py-1 text-sm text-center text-gray-900"
                            />
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={wf.enableForward || false}
                              onChange={(e) => updateWorkflow(wf.id, 'enableForward', e.target.checked)}
                              className="sr-only peer"
                            />
                            <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                          </label>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={wf.enableCC || false}
                              onChange={(e) => updateWorkflow(wf.id, 'enableCC', e.target.checked)}
                              className="sr-only peer"
                            />
                            <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                          </label>
                        </td>
                      </tr>
                    ))}
                    {visibleWorkflows.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                          尚未設定此範圍的審核流程
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="px-6 pb-4 pt-2 text-sm text-gray-500 sm:hidden">
                表格可左右滑動查看全部設定。
              </p>
            </div>

            {/* 凍結提醒設定 */}
            {freezeReminder && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                  <Clock className="w-5 h-5 text-blue-600 mr-2" />
                  配合凍結提醒設定
                </h3>
                {freezeSettings && (
                  <p className="text-sm text-gray-600 mb-4">
                    目前考勤凍結設定：每月 {freezeSettings.freezeDay} 日 {freezeSettings.freezeTime}
                  </p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">第一次提醒（凍結前 N 天）</label>
                    <input
                      type="number"
                      value={freezeReminder.daysBeforeFreeze1}
                      onChange={(e) => setFreezeReminder({...freezeReminder, daysBeforeFreeze1: parseInt(e.target.value)})}
                      className="w-full border rounded px-3 py-2 text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">緊急提醒（凍結前 N 天）</label>
                    <input
                      type="number"
                      value={freezeReminder.daysBeforeFreeze2}
                      onChange={(e) => setFreezeReminder({...freezeReminder, daysBeforeFreeze2: parseInt(e.target.value)})}
                      className="w-full border rounded px-3 py-2 text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">當天提醒時間</label>
                    <input
                      type="time"
                      value={freezeReminder.freezeDayReminderTime}
                      onChange={(e) => setFreezeReminder({...freezeReminder, freezeDayReminderTime: e.target.value})}
                      className="w-full border rounded px-3 py-2 text-gray-900"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 部門主管頁籤 */}
        {activeTab === 'managers' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-lg font-medium text-gray-900">部門主管設定</h2>
              <button
                onClick={() => setShowAddManager(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" />
                新增主管
              </button>
            </div>

            {/* 新增主管表單 */}
            {showAddManager && (
              <div className="p-6 bg-blue-50 border-b border-gray-200">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">選擇員工</label>
                    <select
                      value={newManager.employeeId}
                      onChange={(e) => setNewManager({...newManager, employeeId: parseInt(e.target.value)})}
                      className="w-full border rounded px-3 py-2 text-gray-900"
                    >
                      <option value={0}>請選擇</option>
                      {employees.map(emp => (
                        <option key={emp.id} value={emp.id}>{emp.name} ({emp.department})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">負責部門</label>
                    <select
                      value={newManager.department}
                      onChange={(e) => setNewManager({...newManager, department: e.target.value})}
                      className="w-full border rounded px-3 py-2 text-gray-900"
                    >
                      <option value="">請選擇</option>
                      {departments.map(dept => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">主管類型</label>
                    <select
                      value={newManager.isPrimary ? 'primary' : 'deputy'}
                      onChange={(e) => setNewManager({...newManager, isPrimary: e.target.value === 'primary'})}
                      className="w-full border rounded px-3 py-2 text-gray-900"
                    >
                      <option value="primary">正主管</option>
                      <option value="deputy">副主管</option>
                    </select>
                  </div>
                  <div className="flex items-end gap-2">
                    <button
                      onClick={handleAddManager}
                      className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      確認
                    </button>
                    <button
                      onClick={() => setShowAddManager(false)}
                      className="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                    >
                      取消
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 主管列表 */}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">部門</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">主管</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">類型</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">代理人</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {managers.map(m => (
                    <tr key={m.id}>
                      {/* 部門 - 編輯模式 */}
                      <td className="px-4 py-3 text-gray-900">
                        {editingManagerId === m.id ? (
                          <select
                            value={editManager.department}
                            onChange={(e) => setEditManager({...editManager, department: e.target.value})}
                            className="w-full border rounded px-2 py-1 text-sm text-gray-900"
                          >
                            {departments.map(dept => (
                              <option key={dept} value={dept}>{dept}</option>
                            ))}
                          </select>
                        ) : (
                          m.department
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-900 font-medium">{m.employeeName}</td>
                      {/* 類型 - 編輯模式 */}
                      <td className="px-4 py-3 text-center">
                        {editingManagerId === m.id ? (
                          <select
                            value={editManager.isPrimary ? 'primary' : 'deputy'}
                            onChange={(e) => setEditManager({...editManager, isPrimary: e.target.value === 'primary'})}
                            className="border rounded px-2 py-1 text-sm text-gray-900"
                          >
                            <option value="primary">正主管</option>
                            <option value="deputy">副主管</option>
                          </select>
                        ) : (
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            m.isPrimary ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                          }`}>
                            {m.isPrimary ? '正主管' : '副主管'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-2">
                          {/* 顯示現有代理人 */}
                          {m.deputies.map(d => (
                            <div key={d.id} className="flex items-center justify-between bg-gray-50 rounded px-2 py-1 text-sm">
                              <span className="text-gray-900">{d.employeeName}</span>
                              {editingDeputyId === d.id ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="date"
                                    value={editDeputy.startDate}
                                    onChange={(e) => setEditDeputy({...editDeputy, startDate: e.target.value})}
                                    className="w-24 border rounded px-1 py-0.5 text-xs text-gray-900"
                                  />
                                  <span className="text-gray-400">~</span>
                                  <input
                                    type="date"
                                    value={editDeputy.endDate}
                                    onChange={(e) => setEditDeputy({...editDeputy, endDate: e.target.value})}
                                    className="w-24 border rounded px-1 py-0.5 text-xs text-gray-900"
                                  />
                                  <button
                                    onClick={() => handleSaveDeputy(d.id)}
                                    className="text-green-600 hover:text-green-800"
                                    title="儲存"
                                  >
                                    <Check className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={() => setEditingDeputyId(null)}
                                    className="text-gray-500 hover:text-gray-700"
                                    title="取消"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-500 text-xs">
                                    {d.startDate && d.endDate 
                                      ? `${d.startDate} ~ ${d.endDate}`
                                      : '常態'
                                    }
                                  </span>
                                  <button
                                    onClick={() => startEditDeputy(d)}
                                    className="text-blue-500 hover:text-blue-700"
                                    title="編輯"
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={() => setDeleteDeputyTarget({ id: d.id, employeeName: d.employeeName })}
                                    className="text-red-500 hover:text-red-700"
                                    title="刪除代理人"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                          
                          {/* 新增代理人表單 */}
                          {showAddDeputy === m.id ? (
                            <div className="bg-blue-50 rounded p-2 space-y-2">
                              <select
                                value={newDeputy.employeeId}
                                onChange={(e) => setNewDeputy({...newDeputy, employeeId: parseInt(e.target.value)})}
                                className="w-full border rounded px-2 py-1 text-sm text-gray-900"
                              >
                                <option value={0}>選擇代理人</option>
                                {employees.filter(emp => emp.id !== m.employeeId).map(emp => (
                                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                                ))}
                              </select>
                              <div className="flex gap-2">
                                <input
                                  type="date"
                                  value={newDeputy.startDate}
                                  onChange={(e) => setNewDeputy({...newDeputy, startDate: e.target.value})}
                                  className="flex-1 border rounded px-2 py-1 text-xs text-gray-900"
                                  placeholder="開始日"
                                />
                                <input
                                  type="date"
                                  value={newDeputy.endDate}
                                  onChange={(e) => setNewDeputy({...newDeputy, endDate: e.target.value})}
                                  className="flex-1 border rounded px-2 py-1 text-xs text-gray-900"
                                  placeholder="結束日"
                                />
                              </div>
                              <p className="text-xs text-gray-500">日期留空表示「常態代理」</p>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleAddDeputy(m.id)}
                                  className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700"
                                >
                                  確認
                                </button>
                                <button
                                  onClick={() => {
                                    setShowAddDeputy(null);
                                    setNewDeputy({ employeeId: 0, startDate: '', endDate: '' });
                                  }}
                                  className="px-2 py-1 bg-gray-300 text-gray-700 text-xs rounded hover:bg-gray-400"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => setShowAddDeputy(m.id)}
                              className="text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1"
                            >
                              <Plus className="w-3 h-3" />
                              新增代理人
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {editingManagerId === m.id ? (
                            <>
                              <button
                                onClick={() => handleSaveManager(m.id)}
                                className="text-green-600 hover:text-green-800"
                                title="儲存"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setEditingManagerId(null)}
                                className="text-gray-500 hover:text-gray-700"
                                title="取消"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => startEditManager(m)}
                                className="text-blue-600 hover:text-blue-800"
                                title="編輯"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setDeleteManagerTarget(m)}
                                className="text-red-600 hover:text-red-800"
                                title="刪除"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {managers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                        尚未設定部門主管
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 代理人頁籤 */}
        {activeTab === 'deputies' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">代理人設定</h2>
            <p className="text-gray-600 mb-6">
              當主管無法審核時（如請假、出差），可由代理人代為審核。
              代理人可在「部門主管」頁籤中針對各主管設定。
            </p>
            
            <div className="space-y-4">
              {managers.filter(m => m.deputies.length > 0).map(m => (
                <div key={m.id} className="border rounded-lg p-4">
                  <div className="flex justify-between items-center mb-2">
                    <div>
                      <span className="font-medium text-gray-900">{m.employeeName}</span>
                      <span className="text-gray-500 ml-2">({m.department})</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {m.deputies.map(d => (
                      <div key={d.id} className="flex items-center justify-between bg-gray-50 rounded px-3 py-2">
                        <span className="text-gray-900">{d.employeeName}</span>
                        <span className="text-sm text-gray-500">
                          {d.startDate && d.endDate 
                            ? `${d.startDate} ~ ${d.endDate}`
                            : '常態代理'
                          }
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {managers.filter(m => m.deputies.length > 0).length === 0 && (
                <div className="text-center text-gray-500 py-8">
                  尚未設定任何代理人
                </div>
              )}
            </div>
          </div>
        )}

        {/* 逾期處理設定 */}
        {activeTab === 'overdue' && (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex flex-col gap-4 mb-4 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                <Timer className="inline w-5 h-5 mr-2" />
                逾期自動處理設定
              </h3>
              <button
                onClick={handleSaveOverdueSettings}
                disabled={overdueLoading || overdueSaving || overdueRunning || !overdueSettings}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {overdueSaving ? '儲存中...' : '儲存設定'}
              </button>
            </div>
            
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
              <p className="text-yellow-800 text-sm">
                ⚠️ 此功能會自動處理逾期的審核項目。建議在確認所有審核流程設定完成後再啟用。
              </p>
            </div>

            {overdueLoading || !overdueSettings || !overdueStats ? (
              <div className="py-8 text-center text-gray-500">載入逾期處理設定中...</div>
            ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="text-sm text-gray-500">待審核總數</div>
                  <div className="mt-1 text-2xl font-semibold text-gray-900">{overdueStats.total}</div>
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <div className="text-sm text-red-600">已逾期</div>
                  <div className="mt-1 text-2xl font-semibold text-red-700">{overdueStats.overdue}</div>
                  <div className="mt-1 text-xs text-red-500">佔比 {overdueStats.percentOverdue}%</div>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <div className="text-sm text-amber-700">24 小時內到期</div>
                  <div className="mt-1 text-2xl font-semibold text-amber-800">{overdueStats.urgent}</div>
                </div>
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <div className="text-sm text-blue-600">今日已處理</div>
                  <div className="mt-1 text-2xl font-semibold text-blue-700">{overdueStats.todayProcessed}</div>
                </div>
              </div>

              {/* 主開關 */}
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div>
                  <h4 className="font-medium text-gray-900">啟用自動處理</h4>
                  <p className="text-sm text-gray-500">開啟後，系統會自動處理逾期的審核項目</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={overdueSettings.enabled}
                    onChange={(e) => updateOverdueSetting('enabled', e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {/* 自動升級 */}
              <div className={`p-4 border rounded-lg ${!overdueSettings.enabled ? 'opacity-60' : ''}`}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-medium text-gray-900">自動升級到二階審核</h4>
                    <p className="text-sm text-gray-500">一階審核逾期後自動轉給管理員</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={overdueSettings.autoEscalateEnabled}
                      onChange={(e) => updateOverdueSetting('autoEscalateEnabled', e.target.checked)}
                      disabled={!overdueSettings.enabled}
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span>逾期超過</span>
                  <input 
                    type="number" 
                    className="w-16 px-2 py-1 border rounded" 
                    value={overdueSettings.autoEscalateHours}
                    min={1}
                    max={168}
                    onChange={(e) => updateOverdueSetting('autoEscalateHours', Number(e.target.value) || 1)}
                    disabled={!overdueSettings.enabled || !overdueSettings.autoEscalateEnabled}
                  />
                  <span>小時後自動升級</span>
                </div>
              </div>

              {/* 自動拒絕 */}
              <div className={`p-4 border rounded-lg ${!overdueSettings.enabled ? 'opacity-60' : ''}`}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-medium text-gray-900">自動取消申請</h4>
                    <p className="text-sm text-gray-500">嚴重逾期的申請自動標記為已取消</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={overdueSettings.autoRejectEnabled}
                      onChange={(e) => updateOverdueSetting('autoRejectEnabled', e.target.checked)}
                      disabled={!overdueSettings.enabled}
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-red-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
                  </label>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span>逾期超過</span>
                  <input 
                    type="number" 
                    className="w-16 px-2 py-1 border rounded" 
                    value={overdueSettings.autoRejectDays}
                    min={1}
                    max={30}
                    onChange={(e) => updateOverdueSetting('autoRejectDays', Number(e.target.value) || 1)}
                    disabled={!overdueSettings.enabled || !overdueSettings.autoRejectEnabled}
                  />
                  <span>天後自動標記取消</span>
                </div>
              </div>

              {/* 每日報告 */}
              <div className={`p-4 border rounded-lg ${!overdueSettings.enabled ? 'opacity-60' : ''}`}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h4 className="font-medium text-gray-900">每日統計報告</h4>
                    <p className="text-sm text-gray-500">發送待審核統計給管理員</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={overdueSettings.dailyReportEnabled}
                      onChange={(e) => updateOverdueSetting('dailyReportEnabled', e.target.checked)}
                      disabled={!overdueSettings.enabled}
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span>發送時間</span>
                  <input 
                    type="time" 
                    className="px-2 py-1 border rounded" 
                    value={overdueSettings.dailyReportTime}
                    onChange={(e) => updateOverdueSetting('dailyReportTime', e.target.value)}
                    disabled={!overdueSettings.enabled || !overdueSettings.dailyReportEnabled}
                  />
                </div>
              </div>

              {/* 手動執行 */}
              <div className="pt-4 border-t">
                <button
                  onClick={handleRunOverdueProcess}
                  disabled={overdueRunning || overdueSaving}
                  className="inline-flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
                >
                  <Play className="w-4 h-4 mr-2" />
                  {overdueRunning
                    ? '執行中...'
                    : overdueSettings.enabled
                      ? '手動執行一次處理'
                      : '強制執行一次處理'}
                </button>
                <p className="text-xs text-gray-500 mt-2">
                  {overdueSettings.enabled
                    ? '立即使用目前設定執行一次逾期處理。'
                    : '目前主開關未啟用；此按鈕會以 forceRun 僅執行一次，不會改變排程啟用狀態。'}
                </p>
              </div>
            </div>
            )}
          </div>
        )}
      </main>

      <ConfirmDialog
        open={!!deleteManagerTarget}
        title="刪除部門主管"
        message={
          deleteManagerTarget
            ? `確定要刪除「${deleteManagerTarget.employeeName}」在「${deleteManagerTarget.department}」的主管設定嗎？`
            : ''
        }
        confirmLabel="刪除"
        cancelLabel="取消"
        tone="danger"
        onConfirm={handleDeleteManager}
        onCancel={() => setDeleteManagerTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteDeputyTarget}
        title="刪除代理人"
        message={deleteDeputyTarget ? `確定要刪除「${deleteDeputyTarget.employeeName}」的代理人設定嗎？` : ''}
        confirmLabel="刪除"
        cancelLabel="取消"
        tone="danger"
        onConfirm={handleDeleteDeputy}
        onCancel={() => setDeleteDeputyTarget(null)}
      />
    </div>
  );
}
