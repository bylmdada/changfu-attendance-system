'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeftRight, ArrowLeft, Plus, Check, X, 
  User, Loader2, AlertTriangle 
} from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';

interface Employee {
  id: number;
  employeeId: string;
  name: string;
  department: string | null;
  position: string | null;
}

interface ShiftSwapRequest {
  id: number;
  requesterId: number;
  targetEmployeeId: number;
  originalWorkDate: string;
  targetWorkDate: string;
  requestReason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  adminRemarks: string | null;
  approvedAt: string | null;
  createdAt: string;
  requester: Employee;
  targetEmployee: Employee;
  approver?: Employee;
}

interface UserInfo {
  userId: number;
  employeeId: number;
  role: string;
}

export default function ShiftSwapPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<ShiftSwapRequest[]>([]);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 表單狀態
  const [formData, setFormData] = useState({
    targetEmployeeId: '',
    originalWorkDate: '',
    targetWorkDate: '',
    requestReason: ''
  });
  const [submitting, setSubmitting] = useState(false);

  const loadUser = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      } else {
        router.push('/login');
      }
    } catch (error) {
      console.error('載入用戶資訊失敗:', error);
    }
  }, [router]);

  const loadRequests = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filter) params.append('status', filter);
      
      const response = await fetch(`/api/shift-swap-requests?${params}`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setRequests(data.requests);
      }
    } catch (error) {
      console.error('載入調班申請失敗:', error);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const loadEmployees = useCallback(async () => {
    try {
      const response = await fetch('/api/employees?limit=100', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setEmployees(data.employees || []);
      }
    } catch (error) {
      console.error('載入員工列表失敗:', error);
    }
  }, []);

  useEffect(() => {
    loadUser();
    loadRequests();
    loadEmployees();
  }, [loadUser, loadRequests, loadEmployees]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetchJSONWithCSRF('/api/shift-swap-requests', {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        setMessage({ type: 'success', text: '調班申請已提交' });
        setShowNewForm(false);
        setFormData({ targetEmployeeId: '', originalWorkDate: '', targetWorkDate: '', requestReason: '' });
        loadRequests();
      } else {
        const data = await response.json();
        setMessage({ type: 'error', text: data.error || '申請失敗' });
      }
    } catch (error) {
      console.error('提交失敗:', error);
      setMessage({ type: 'error', text: '系統錯誤' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (id: number, status: 'APPROVED' | 'REJECTED', adminRemarks?: string) => {
    try {
      const response = await fetchJSONWithCSRF('/api/shift-swap-requests', {
        method: 'PUT',
        body: { id, status, adminRemarks }
      });

      if (response.ok) {
        setMessage({ type: 'success', text: status === 'APPROVED' ? '已批准' : '已拒絕' });
        loadRequests();
      } else {
        const data = await response.json();
        setMessage({ type: 'error', text: data.error || '操作失敗' });
      }
    } catch (error) {
      console.error('審核失敗:', error);
      setMessage({ type: 'error', text: '系統錯誤' });
    }
  };

  const handleCancel = async (id: number) => {
    if (!confirm('確定要取消此調班申請嗎？')) return;

    try {
      const response = await fetchJSONWithCSRF('/api/shift-swap-requests', {
        method: 'DELETE',
        body: { id }
      });

      if (response.ok) {
        setMessage({ type: 'success', text: '已取消申請' });
        loadRequests();
      } else {
        const data = await response.json();
        setMessage({ type: 'error', text: data.error || '取消失敗' });
      }
    } catch (error) {
      console.error('取消失敗:', error);
      setMessage({ type: 'error', text: '系統錯誤' });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800">待審核</span>;
      case 'APPROVED':
        return <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">已批准</span>;
      case 'REJECTED':
        return <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">已拒絕</span>;
      default:
        return null;
    }
  };

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'HR';

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 頂部導航 */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.push('/dashboard')}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <ArrowLeftRight className="w-6 h-6 text-blue-600" />
                調班管理
              </h1>
              <p className="text-sm text-gray-500">申請調班及查看審核狀態</p>
            </div>
          </div>

          {!isAdmin && (
            <button
              onClick={() => setShowNewForm(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus className="w-4 h-4" />
              新增調班申請
            </button>
          )}
        </div>
      </header>

      {/* 主內容 */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* 訊息提示 */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg flex items-center gap-2 ${
            message.type === 'success' 
              ? 'bg-green-50 text-green-700 border border-green-200' 
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {message.type === 'success' ? <Check className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            {message.text}
          </div>
        )}

        {/* 篩選 */}
        <div className="mb-6 flex gap-2">
          <button
            onClick={() => setFilter('')}
            className={`px-4 py-2 rounded-lg ${!filter ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border'}`}
          >
            全部
          </button>
          <button
            onClick={() => setFilter('PENDING')}
            className={`px-4 py-2 rounded-lg ${filter === 'PENDING' ? 'bg-yellow-500 text-white' : 'bg-white text-gray-700 border'}`}
          >
            待審核
          </button>
          <button
            onClick={() => setFilter('APPROVED')}
            className={`px-4 py-2 rounded-lg ${filter === 'APPROVED' ? 'bg-green-500 text-white' : 'bg-white text-gray-700 border'}`}
          >
            已批准
          </button>
          <button
            onClick={() => setFilter('REJECTED')}
            className={`px-4 py-2 rounded-lg ${filter === 'REJECTED' ? 'bg-red-500 text-white' : 'bg-white text-gray-700 border'}`}
          >
            已拒絕
          </button>
        </div>

        {/* 新增調班申請表單 */}
        {showNewForm && (
          <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">新增調班申請</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    與誰調班 *
                  </label>
                  <select
                    value={formData.targetEmployeeId}
                    onChange={(e) => setFormData({...formData, targetEmployeeId: e.target.value})}
                    required
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">選擇員工</option>
                    {employees
                      .filter(emp => emp.id !== user?.employeeId)
                      .map(emp => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name} - {emp.department || '無部門'}
                        </option>
                      ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    我的原班日期 *
                  </label>
                  <input
                    type="date"
                    value={formData.originalWorkDate}
                    onChange={(e) => setFormData({...formData, originalWorkDate: e.target.value})}
                    required
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    對方的班日期 *
                  </label>
                  <input
                    type="date"
                    value={formData.targetWorkDate}
                    onChange={(e) => setFormData({...formData, targetWorkDate: e.target.value})}
                    required
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    申請原因 *
                  </label>
                  <textarea
                    value={formData.requestReason}
                    onChange={(e) => setFormData({...formData, requestReason: e.target.value})}
                    required
                    rows={3}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="請說明調班原因..."
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowNewForm(false)}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : '提交申請'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* 申請列表 */}
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="p-4 border-b">
            <h2 className="text-lg font-semibold text-gray-900">
              調班申請記錄 ({requests.length})
            </h2>
          </div>

          {requests.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <ArrowLeftRight className="w-12 h-12 mx-auto mb-3 text-gray-400" />
              <p>目前沒有調班申請記錄</p>
            </div>
          ) : (
            <div className="divide-y">
              {requests.map((req) => (
                <div key={req.id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        {getStatusBadge(req.status)}
                        <span className="text-sm text-gray-500">
                          {new Date(req.createdAt).toLocaleDateString('zh-TW')}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-900">
                            <strong>{req.requester.name}</strong> 的班 ({req.originalWorkDate})
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <ArrowLeftRight className="w-4 h-4 text-blue-500" />
                          <span className="text-sm text-gray-900">
                            ↔ <strong>{req.targetEmployee.name}</strong> 的班 ({req.targetWorkDate})
                          </span>
                        </div>
                      </div>

                      <p className="mt-2 text-sm text-gray-600">
                        <strong>原因：</strong>{req.requestReason}
                      </p>

                      {req.adminRemarks && (
                        <p className="mt-1 text-sm text-gray-500">
                          <strong>主管備註：</strong>{req.adminRemarks}
                        </p>
                      )}

                      {req.approver && (
                        <p className="mt-1 text-xs text-gray-400">
                          審核者：{req.approver.name} | {new Date(req.approvedAt!).toLocaleString('zh-TW')}
                        </p>
                      )}
                    </div>

                    {/* 操作按鈕 */}
                    <div className="flex gap-2 ml-4">
                      {req.status === 'PENDING' && (
                        <>
                          {isAdmin ? (
                            <>
                              <button
                                onClick={() => handleApprove(req.id, 'APPROVED')}
                                className="p-2 text-green-600 hover:bg-green-50 rounded-lg"
                                title="批准"
                              >
                                <Check className="w-5 h-5" />
                              </button>
                              <button
                                onClick={() => handleApprove(req.id, 'REJECTED')}
                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                                title="拒絕"
                              >
                                <X className="w-5 h-5" />
                              </button>
                            </>
                          ) : req.requesterId === user?.employeeId && (
                            <button
                              onClick={() => handleCancel(req.id)}
                              className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                              title="取消申請"
                            >
                              <X className="w-5 h-5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
