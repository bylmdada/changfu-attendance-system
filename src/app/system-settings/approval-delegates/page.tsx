'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { UserCheck, Plus, Trash2, Calendar, Users, Clock, AlertCircle, X } from 'lucide-react';
import SystemNavbar from '@/components/SystemNavbar';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';

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

interface Employee {
  id: number;
  employeeId: string;
  name: string;
  department: string;
  position: string;
}

interface Delegate {
  id: number;
  delegator: Employee;
  delegate: Employee;
  startDate: string;
  endDate: string;
  resourceTypes: string[] | null;
  isActive: boolean;
  isExpired?: boolean;
  createdAt: string;
}

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  LEAVE: '請假審核',
  OVERTIME: '加班審核',
  SHIFT: '調班/補卡審核'
};

export default function ApprovalDelegatesPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [delegates, setDelegates] = useState<Delegate[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  // 新增表單
  const [form, setForm] = useState({
    delegatorId: '',
    delegateId: '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    resourceTypes: [] as string[]
  });

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchDelegates = useCallback(async () => {
    try {
      const response = await fetch('/api/approval-delegates?active=false', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setDelegates(data.delegates || []);
      }
    } catch (error) {
      console.error('載入代理設定失敗:', error);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        // 驗證用戶
        const userRes = await fetch('/api/auth/me', { credentials: 'include' });
        if (userRes.ok) {
          const userData = await userRes.json();
          const currentUser = userData.user || userData;
          if (currentUser.role !== 'ADMIN' && currentUser.role !== 'HR') {
            router.push('/dashboard');
            return;
          }
          setUser(currentUser);
        } else {
          router.push('/login');
          return;
        }

        // 載入員工列表
        const empRes = await fetch('/api/employees', { credentials: 'include' });
        if (empRes.ok) {
          const empData = await empRes.json();
          setEmployees(empData.employees || []);
        }

        // 載入代理設定
        await fetchDelegates();
      } catch (error) {
        console.error('初始化失敗:', error);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [router, fetchDelegates]);

  const handleResourceTypeChange = (type: string, checked: boolean) => {
    if (checked) {
      setForm({ ...form, resourceTypes: [...form.resourceTypes, type] });
    } else {
      setForm({ ...form, resourceTypes: form.resourceTypes.filter(t => t !== type) });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.delegatorId || !form.delegateId) {
      showToast('error', '請選擇委託人和代理人');
      return;
    }

    if (form.delegatorId === form.delegateId) {
      showToast('error', '委託人和代理人不能是同一人');
      return;
    }

    try {
      const response = await fetchJSONWithCSRF('/api/approval-delegates', {
        method: 'POST',
        body: {
          delegatorId: parseInt(form.delegatorId),
          delegateId: parseInt(form.delegateId),
          startDate: form.startDate,
          endDate: form.endDate,
          resourceTypes: form.resourceTypes.length > 0 ? form.resourceTypes : null
        }
      });

      if (response.ok) {
        showToast('success', '代理設定已建立');
        setShowAddForm(false);
        setForm({
          delegatorId: '',
          delegateId: '',
          startDate: new Date().toISOString().split('T')[0],
          endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          resourceTypes: []
        });
        fetchDelegates();
      } else {
        const data = await response.json();
        showToast('error', data.error || '建立失敗');
      }
    } catch (error) {
      console.error('建立代理設定失敗:', error);
      showToast('error', '系統錯誤');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('確定要取消此代理設定嗎？')) return;

    try {
      const response = await fetchJSONWithCSRF(`/api/approval-delegates?id=${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        showToast('success', '代理設定已取消');
        fetchDelegates();
      } else {
        const data = await response.json();
        showToast('error', data.error || '取消失敗');
      }
    } catch (error) {
      console.error('取消代理設定失敗:', error);
      showToast('error', '系統錯誤');
    }
  };

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
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Toast */}
        {toast && (
          <div className={`fixed top-4 right-4 px-4 py-3 rounded-lg shadow-lg z-50 ${
            toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
          }`}>
            {toast.message}
          </div>
        )}

        {/* 標題 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center">
              <UserCheck className="w-8 h-8 text-blue-600 mr-3" />
              審核代理人管理
            </h1>
            <p className="text-gray-600 mt-2">設定審核權限代理，主管請假時由代理人審核</p>
          </div>
          <button
            onClick={() => setShowAddForm(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            新增代理設定
          </button>
        </div>

        {/* 統計卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">總設定數</p>
                <p className="text-2xl font-bold text-gray-900">{delegates.length}</p>
              </div>
              <Users className="w-8 h-8 text-blue-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">生效中</p>
                <p className="text-2xl font-bold text-green-600">
                  {delegates.filter(d => d.isActive && !d.isExpired).length}
                </p>
              </div>
              <Clock className="w-8 h-8 text-green-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">已過期/停用</p>
                <p className="text-2xl font-bold text-gray-600">
                  {delegates.filter(d => !d.isActive || d.isExpired).length}
                </p>
              </div>
              <AlertCircle className="w-8 h-8 text-gray-400" />
            </div>
          </div>
        </div>

        {/* 代理設定列表 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">代理設定列表</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">委託人</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">代理人</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">代理期間</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">代理項目</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">狀態</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {delegates.map((d) => {
                  const isExpired = new Date(d.endDate) < new Date();
                  const isActive = d.isActive && !isExpired;
                  
                  return (
                    <tr key={d.id} className={`hover:bg-gray-50 ${!isActive ? 'opacity-60' : ''}`}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{d.delegator.name}</div>
                        <div className="text-sm text-gray-500">{d.delegator.department}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{d.delegate.name}</div>
                        <div className="text-sm text-gray-500">{d.delegate.department}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2 text-sm text-gray-900">
                          <Calendar className="w-4 h-4 text-gray-400" />
                          {new Date(d.startDate).toLocaleDateString('zh-TW')} ~ {new Date(d.endDate).toLocaleDateString('zh-TW')}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {d.resourceTypes ? (
                            d.resourceTypes.map((type) => (
                              <span key={type} className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full">
                                {RESOURCE_TYPE_LABELS[type] || type}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-gray-500">全部</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isActive ? (
                          <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full">生效中</span>
                        ) : isExpired ? (
                          <span className="px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded-full">已過期</span>
                        ) : (
                          <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded-full">已停用</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {d.isActive && (
                          <button
                            onClick={() => handleDelete(d.id)}
                            className="text-red-600 hover:text-red-800"
                            title="取消代理"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {delegates.length === 0 && (
              <div className="text-center py-12">
                <UserCheck className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">尚無代理設定</h3>
                <p className="mt-1 text-sm text-gray-500">點擊上方按鈕新增代理人設定</p>
              </div>
            )}
          </div>
        </div>

        {/* 新增表單 Modal */}
        {showAddForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">新增代理設定</h3>
                <button
                  onClick={() => setShowAddForm(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">委託人 *</label>
                  <select
                    value={form.delegatorId}
                    onChange={(e) => setForm({ ...form, delegatorId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900"
                    required
                  >
                    <option value="">請選擇委託人</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} ({emp.department})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">主管請假時，由代理人代為審核</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">代理人 *</label>
                  <select
                    value={form.delegateId}
                    onChange={(e) => setForm({ ...form, delegateId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900"
                    required
                  >
                    <option value="">請選擇代理人</option>
                    {employees
                      .filter((emp) => emp.id.toString() !== form.delegatorId)
                      .map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name} ({emp.department})
                        </option>
                      ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">開始日期 *</label>
                    <input
                      type="date"
                      value={form.startDate}
                      onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">結束日期 *</label>
                    <input
                      type="date"
                      value={form.endDate}
                      onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">代理項目</label>
                  <div className="space-y-2">
                    {Object.entries(RESOURCE_TYPE_LABELS).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={form.resourceTypes.includes(key)}
                          onChange={(e) => handleResourceTypeChange(key, e.target.checked)}
                          className="rounded text-blue-600"
                        />
                        <span className="text-sm text-gray-700">{label}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">不選擇則代理全部項目</p>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    建立
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
                  >
                    取消
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
