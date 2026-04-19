'use client';

import { useState, useEffect, useCallback } from 'react';
import { Clock, Plus, Search, Filter, CheckCircle, XCircle, Trash2, Calendar, User, Timer, Pencil, X, ChevronDown, ChevronUp, Eye } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import BatchApproveBar from '@/components/BatchApproveBar';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import ApprovalProgress, { ApprovalReviewRecord } from '@/components/ApprovalProgress';
import React from 'react';

interface OvertimeRequest {
  id: number;
  employeeId: number;
  overtimeDate: string;
  startTime: string;
  endTime: string;
  totalHours: number;
  reason: string;
  workContent: string;
  compensationType: 'COMP_LEAVE' | 'OVERTIME_PAY'; // 補償方式
  status: 'PENDING' | 'PENDING_ADMIN' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'VOIDED';
  approvedBy?: number;
  approvedAt?: string;
  createdAt: string;
  employee: {
    id: number;
    employeeId: string;
    name: string;
    department: string;
    position: string;
  };
  approver?: {
    id: number;
    employeeId: string;
    name: string;
    department: string;
    position: string;
  } | null;
  // 新增：API 可選帶回加班當日班別
  scheduleShiftType?: string | null;
  scheduleStartTime?: string | null;
  scheduleEndTime?: string | null;
  scheduleShiftLabel?: string | null;
}

const STATUS_STYLES: Record<OvertimeRequest['status'], string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  PENDING_ADMIN: 'bg-blue-100 text-blue-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-700',
  VOIDED: 'bg-gray-100 text-gray-700',
};

function getStatusLabel(status: OvertimeRequest['status']) {
  switch (status) {
    case 'PENDING':
      return '待審核';
    case 'PENDING_ADMIN':
      return '待管理員決核';
    case 'APPROVED':
      return '已批准';
    case 'REJECTED':
      return '已拒絕';
    case 'CANCELLED':
      return '已撤銷';
    case 'VOIDED':
      return '已作廢';
    default:
      return status;
  }
}

function isReviewableStatus(status: OvertimeRequest['status']) {
  return status === 'PENDING' || status === 'PENDING_ADMIN';
}

interface CurrentUser {
  id: number;
  username: string;
  role: string;
  employeeId: number;
  isDepartmentManager?: boolean;
  isDeputyManager?: boolean;
  attendancePermissions?: {
    leaveRequests?: string[];
    overtimeRequests?: string[];
    shiftExchanges?: string[];
    scheduleManagement?: string[];
  };
}

interface User {
  id: number;
  username: string;
  role: string;
  isDepartmentManager?: boolean;
  isDeputyManager?: boolean;
  attendancePermissions?: {
    leaveRequests?: string[];
    overtimeRequests?: string[];
    shiftExchanges?: string[];
    scheduleManagement?: string[];
  };
  employee?: {
    id: number;
    employeeId: string;
    name: string;
    department: string;
    position: string;
  };
}

export default function OvertimeManagementPage() {
  const [overtimeRequests, setOvertimeRequests] = useState<OvertimeRequest[]>([]);
  const [filteredRequests, setFilteredRequests] = useState<OvertimeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [user, setUser] = useState<User | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showNewRequestForm, setShowNewRequestForm] = useState(false);

  // 新申請表單狀態
  const [newRequest, setNewRequest] = useState({
    overtimeDate: '',
    startTime: '18:00',
    endTime: '20:00',
    reason: '',
    workContent: '',
    compensationType: 'COMP_LEAVE' as const  // 預設補休（目前鎖定）
  });

  // 編輯狀態
  const [editing, setEditing] = useState<null | Omit<OvertimeRequest, 'employee' | 'totalHours'>>(null);
  const [editForm, setEditForm] = useState<{ overtimeDate: string; startTime: string; endTime: string; reason: string; workContent: string; compensationType: 'COMP_LEAVE' | 'OVERTIME_PAY' }>({ overtimeDate: '', startTime: '', endTime: '', reason: '', workContent: '', compensationType: 'COMP_LEAVE' });

  // 篩選狀態
  const [filters, setFilters] = useState({
    status: '',
    employeeId: '',
    startDate: '',
    endDate: ''
  });

  const [searchTerm, setSearchTerm] = useState('');

  // Toast 狀態
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // 删除確認框狀態
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name: string } | null>(null);
  
  // 排序狀態
  const [sortConfig, setSortConfig] = useState<{ field: 'employee' | 'date' | 'status' | 'hours'; direction: 'asc' | 'desc' }>({ field: 'date', direction: 'desc' });

  // 展開審核進度
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [approvalData, setApprovalData] = useState<{
    currentLevel: number;
    maxLevel: number;
    status: string;
    reviews: ApprovalReviewRecord[];
    labels?: Record<number, { name: string; role: string }>;
  } | null>(null);


  // Toast 顯示函數
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  // 排序函數
  const handleSort = (field: 'employee' | 'date' | 'status' | 'hours') => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  // 匹出 CSV
  const exportToCSV = () => {
    const headers = ['員工編號', '姓名', '部門', '加班日期', '開始時間', '結束時間', '總時數', '狀態', '申請原因'];
    const rows = sortedRequests.map(r => [
      r.employee.employeeId,
      r.employee.name,
      r.employee.department,
      r.overtimeDate,
      r.startTime,
      r.endTime,
      r.totalHours,
      getStatusLabel(r.status),
      r.reason
    ]);
    const csvContent = '\uFEFF' + [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `加班申請_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 匹出 Excel
  const exportToExcel = () => {
    const headers = ['員工編號', '姓名', '部門', '加班日期', '開始時間', '結束時間', '總時數', '狀態', '申請原因'];
    const rows = sortedRequests.map(r => [
      r.employee.employeeId,
      r.employee.name,
      r.employee.department,
      r.overtimeDate,
      r.startTime,
      r.endTime,
      r.totalHours,
      getStatusLabel(r.status),
      r.reason
    ]);
    const xlsContent = [headers, ...rows].map(row => row.join('\t')).join('\n');
    const blob = new Blob([xlsContent], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `加班申請_${new Date().toISOString().slice(0,10)}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 排序後的記錄
  const sortedRequests = [...filteredRequests].sort((a, b) => {
    const direction = sortConfig.direction === 'asc' ? 1 : -1;
    switch (sortConfig.field) {
      case 'employee':
        return direction * a.employee.name.localeCompare(b.employee.name, 'zh-TW');
      case 'date':
        return direction * a.overtimeDate.localeCompare(b.overtimeDate);
      case 'status':
        return direction * a.status.localeCompare(b.status);
      case 'hours':
        return direction * (a.totalHours - b.totalHours);
      default:
        return 0;
    }
  });

  // 申請原因選項
  const reasonOptions = [
    { value: '業務需要', label: '業務需要' },
    { value: '主管指派工作', label: '主管指派工作' },
    { value: '支援活動', label: '支援活動' },
    { value: '業務量增加', label: '業務量增加' },
    { value: '其它', label: '其它' }
  ];

  useEffect(() => {
    // 設定頁面標題
    document.title = '加班管理 - 長福會考勤系統';
    
    fetchCurrentUser();
    fetchOvertimeRequests();
  }, []);

  const filterRequests = useCallback(() => {
    let filtered = overtimeRequests;

    if (filters.status) {
      filtered = filtered.filter(req => req.status === filters.status);
    }

    if (searchTerm) {
      filtered = filtered.filter(req =>
        req.employee.name.includes(searchTerm) ||
        req.employee.employeeId.includes(searchTerm) ||
        req.reason.includes(searchTerm)
      );
    }

    if (filters.startDate && filters.endDate) {
      filtered = filtered.filter(req => {
        const reqDate = new Date(req.overtimeDate);
        return reqDate >= new Date(filters.startDate) && reqDate <= new Date(filters.endDate);
      });
    }

    setFilteredRequests(filtered);
  }, [overtimeRequests, filters, searchTerm]);

  useEffect(() => {
    filterRequests();
  }, [filterRequests]);

  const fetchCurrentUser = async () => {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setCurrentUser(data.user);
        setUser(data.user);
      }
    } catch (error) {
      console.error('獲取當前用戶失敗:', error);
    }
  };

  const fetchOvertimeRequests = async () => {
    try {
      const response = await fetch('/api/overtime-requests', {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setOvertimeRequests(data.overtimeRequests);
      }
    } catch (error) {
      console.error('獲取加班申請失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();

    // 驗證時間
    const startHour = parseInt(newRequest.startTime.split(':')[0]);
    if (startHour < 17) {
      showToast('error', '加班開始時間必須在17:00之後（正常工作8小時後）');
      return;
    }

    // 驗證：如果選擇"其它"，工作內容不能為空
    if (newRequest.reason === '其它' && !newRequest.workContent.trim()) {
      showToast('error', '選擇「其它」原因時，工作內容為必填欄位');
      return;
    }

    try {
      const response = await fetchJSONWithCSRF('/api/overtime-requests', {
        method: 'POST',
        body: newRequest
      });

      if (response.ok) {
        showToast('success', '加班申請提交成功');
        setShowNewRequestForm(false);
        setNewRequest({
          overtimeDate: '',
          startTime: '18:00',
          endTime: '20:00',
          reason: '',
          workContent: '',
          compensationType: 'COMP_LEAVE'
        });
        fetchOvertimeRequests();
      } else {
        const error = await response.json();
        showToast('error', error.error || '提交失敗');
      }
    } catch {
      showToast('error', '提交失敗，請稍後再試');
    }
  };

  // 編輯提交
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;

    // 驗證：如果選擇"其它"，工作內容不能為空
    if (editForm.reason === '其它' && !editForm.workContent.trim()) {
      showToast('error', '選擇「其它」原因時，工作內容為必填欄位');
      return;
    }

    try {
      const res = await fetchJSONWithCSRF(`/api/overtime-requests/${editing.id}`, {
        method: 'PATCH',
        body: editForm
      });
      const data = await res.json();
      if (res.ok) {
        showToast('success', '加班申請已更新');
        setEditing(null);
        fetchOvertimeRequests();
      } else {
        showToast('error', data.error || '更新失敗');
      }
    } catch {
      showToast('error', '更新失敗，請稍後再試');
    }
  };

  const handleApproveReject = async (id: number, status: 'APPROVED' | 'REJECTED') => {
    try {
      const canSubmitManagerOpinion = currentUser?.role === 'MANAGER'
        || currentUser?.isDepartmentManager
        || currentUser?.isDeputyManager
        || Boolean(currentUser?.attendancePermissions?.overtimeRequests?.length);

      const body = canSubmitManagerOpinion
        ? { opinion: status === 'APPROVED' ? 'AGREE' : 'DISAGREE' }
        : { status };

      const response = await fetchJSONWithCSRF(`/api/overtime-requests/${id}`, {
        method: 'PATCH',
        body
      });

      if (response.ok) {
        showToast('success', '操作成功');
        fetchOvertimeRequests();
      } else {
        const error = await response.json();
        showToast('error', error.error || '操作失敗');
      }
    } catch {
      showToast('error', '操作失敗，請稍後再試');
    }
  };

  // 開啟删除確認框
  const openDeleteConfirm = (request: OvertimeRequest) => {
    setDeleteConfirm({ id: request.id, name: request.employee.name });
  };

  // 確認删除
  const confirmDelete = async () => {
    if (!deleteConfirm) return;

    try {
      const response = await fetchJSONWithCSRF(`/api/overtime-requests/${deleteConfirm.id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        showToast('success', '加班申請已删除');
        fetchOvertimeRequests();
      } else {
        const error = await response.json();
        showToast('error', error.error || '删除失敗');
      }
    } catch {
      showToast('error', '删除失敗，請稍後再試');
    }
    setDeleteConfirm(null);
  };

  // 員工申請撤銷
  const handleCancelRequest = async (id: number, reason: string) => {
    try {
      const res = await fetchJSONWithCSRF(`/api/overtime-requests/${id}/cancel`, {
        method: 'POST',
        body: { reason }
      });
      const data = await res.json();
      if (!res.ok) {
        showToast('error', data.error || '撤銷申請失敗');
        return;
      }
      showToast('success', data.message || '撤銷申請已送出');
      fetchOvertimeRequests();
    } catch {
      showToast('error', '撤銷申請失敗，請稍後再試');
    }
  };

  // 管理員作廢
  const handleVoidRequest = async (id: number, reason: string) => {
    try {
      const res = await fetchJSONWithCSRF(`/api/overtime-requests/${id}/void`, {
        method: 'POST',
        body: { reason }
      });
      const data = await res.json();
      if (!res.ok) {
        showToast('error', data.error || '作廢失敗');
        return;
      }
      showToast('success', data.message || '已作廢');
      fetchOvertimeRequests();
    } catch {
      showToast('error', '作廢失敗，請稍後再試');
    }
  };

  // 展開/收合審核進度並取得真實資料
  const handleToggleApproval = async (requestId: number) => {
    if (expandedId === requestId) {
      setExpandedId(null);
      setApprovalData(null);
      return;
    }
    
    setExpandedId(requestId);
    setApprovalData(null);
    
    try {
      // 同時獲取審核歷程和工作流程設定
      const [reviewsRes, workflowRes] = await Promise.all([
        fetch(`/api/approval-reviews?requestType=OVERTIME&requestId=${requestId}`, {
          credentials: 'include'
        }),
        fetch(`/api/approval-workflow-config?type=OVERTIME`, {
          credentials: 'include'
        })
      ]);
      
      let labels: Record<number, { name: string; role: string }> | undefined;
      if (workflowRes.ok) {
        const workflowData = await workflowRes.json();
        labels = workflowData.labels;
      }
      
      if (reviewsRes.ok) {
        const data = await reviewsRes.json();
        setApprovalData({
          currentLevel: data.currentLevel,
          maxLevel: labels ? Object.keys(labels).length : data.maxLevel,
          status: data.status,
          reviews: data.reviews,
          labels
        });
      }
    } catch (error) {
      console.error('取得審核歷程失敗:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Clock className="w-12 h-12 text-blue-600 mx-auto mb-4 animate-spin" />
          <p className="text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  const isFinalReviewer = currentUser?.role === 'ADMIN' || currentUser?.role === 'HR';
  const isManager = currentUser?.role === 'MANAGER'
    || currentUser?.isDepartmentManager
    || currentUser?.isDeputyManager
    || Boolean(currentUser?.attendancePermissions?.overtimeRequests?.length);
  const selectableRequests = filteredRequests.filter(request => isReviewableStatus(request.status));

  return (
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 標題區 */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Clock className="w-8 h-8 text-blue-600" />
              <h1 className="text-3xl font-bold text-gray-900">加班管理</h1>
            </div>
            <button
              onClick={() => setShowNewRequestForm(true)}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-5 h-5" />
              申請加班
            </button>
          </div>
          <p className="text-gray-600 mt-2">管理員工加班申請，最少0.5小時，最多4小時</p>
        </div>

        {/* 統計卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <Timer className="w-8 h-8 text-yellow-600" />
              <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">待審核</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {overtimeRequests.filter(req => isReviewableStatus(req.status)).length}
                  </p>
                </div>
              </div>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <CheckCircle className="w-8 h-8 text-green-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">已批准</p>
                <p className="text-2xl font-bold text-gray-900">
                  {overtimeRequests.filter(req => req.status === 'APPROVED').length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <XCircle className="w-8 h-8 text-red-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">已拒絕</p>
                <p className="text-2xl font-bold text-gray-900">
                  {overtimeRequests.filter(req => req.status === 'REJECTED').length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <Clock className="w-8 h-8 text-blue-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">總時數</p>
                <p className="text-2xl font-bold text-gray-900">
                  {overtimeRequests
                    .filter(req => req.status === 'APPROVED')
                    .reduce((sum, req) => sum + req.totalHours, 0)}h
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 篩選和搜索 */}
        <div className="bg-white p-6 rounded-lg shadow mb-6">
          <div className="flex items-center mb-4">
            <Filter className="w-5 h-5 text-gray-400 mr-2" />
            <h2 className="text-lg font-semibold text-gray-900">篩選條件</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">搜索</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                  placeholder="搜索員工姓名或原因"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">狀態</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
              >
                <option value="">全部狀態</option>
                <option value="PENDING">待審核</option>
                <option value="PENDING_ADMIN">待管理員決核</option>
                <option value="APPROVED">已批准</option>
                <option value="REJECTED">已拒絕</option>
                <option value="CANCELLED">已撤銷</option>
                <option value="VOIDED">已作廢</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">開始日期</label>
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">結束日期</label>
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
              />
            </div>
          </div>

          {/* 排序和匯出欄 */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-4 mt-4 border-t border-gray-200">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">排序：</span>
              <button
                onClick={() => handleSort('employee')}
                className={`px-3 py-1.5 text-sm rounded ${sortConfig.field === 'employee' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                員工 {sortConfig.field === 'employee' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
              </button>
              <button
                onClick={() => handleSort('date')}
                className={`px-3 py-1.5 text-sm rounded ${sortConfig.field === 'date' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                日期 {sortConfig.field === 'date' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
              </button>
              <button
                onClick={() => handleSort('status')}
                className={`px-3 py-1.5 text-sm rounded ${sortConfig.field === 'status' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                狀態 {sortConfig.field === 'status' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
              </button>
              <button
                onClick={() => handleSort('hours')}
                className={`px-3 py-1.5 text-sm rounded ${sortConfig.field === 'hours' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                時數 {sortConfig.field === 'hours' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={exportToCSV}
                disabled={sortedRequests.length === 0}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium shadow-sm"
              >
                匯出 CSV
              </button>
              <button
                onClick={exportToExcel}
                disabled={sortedRequests.length === 0}
                className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 font-medium shadow-sm"
              >
                匯出 Excel
              </button>
            </div>
          </div>
        </div>

        {/* 加班申請列表 */}
        <div className="bg-white rounded-lg shadow overflow-hidden mb-20">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">加班申請記錄</h2>
            {isFinalReviewer && selectableRequests.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={selectedIds.length === selectableRequests.length && selectedIds.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedIds(selectableRequests.map(r => r.id));
                    } else {
                      setSelectedIds([]);
                    }
                  }}
                  className="rounded"
                />
                全選待審核
              </label>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {isFinalReviewer && (
                    <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-12">選擇</th>
                  )}
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => handleSort('employee')}>員工資訊 {sortConfig.field === 'employee' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => handleSort('date')}>加班日期 {sortConfig.field === 'date' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">時間</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => handleSort('hours')}>時數 {sortConfig.field === 'hours' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">申請原因</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => handleSort('status')}>狀態 {sortConfig.field === 'status' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">批准者</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortedRequests.map((request) => (
                  <React.Fragment key={request.id}>
                  <tr className={`hover:bg-gray-50 ${selectedIds.includes(request.id) ? 'bg-blue-50' : ''}`}>
                    {isFinalReviewer && (
                      <td className="px-3 py-4 text-center">
                        {isReviewableStatus(request.status) && (
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(request.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedIds([...selectedIds, request.id]);
                              } else {
                                setSelectedIds(selectedIds.filter(id => id !== request.id));
                              }
                            }}
                            className="rounded"
                          />
                        )}
                      </td>
                    )}
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <User className="w-5 h-5 text-gray-400 mr-2" />
                        <div>
                          <div className="text-sm font-medium text-gray-900">{request.employee.name}</div>
                          <div className="text-sm text-gray-500">{request.employee.employeeId} - {request.employee.department}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <Calendar className="w-4 h-4 text-gray-400 mr-1" />
                        <div className="text-sm text-gray-900">
                          {new Date(request.overtimeDate).toLocaleDateString('zh-TW')}
                        </div>
                      </div>
                      {request.scheduleShiftLabel && (
                        <div className="text-xs text-gray-500 mt-1">當日班別：{request.scheduleShiftLabel}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {request.startTime} - {request.endTime}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <Timer className="w-4 h-4 text-blue-500 mr-1" />
                        <span className="text-sm font-medium text-blue-600">{request.totalHours}小時</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900 max-w-xs truncate" title={request.reason}>
                        {request.reason}
                      </div>
                      {request.workContent && (
                        <div className="text-xs text-gray-500 max-w-xs truncate" title={request.workContent}>
                          {request.workContent}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${STATUS_STYLES[request.status]}`}>
                        {getStatusLabel(request.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {request.approver ? (
                        <div className="flex items-center gap-2">
                          <div className="text-gray-900 font-medium">
                            {request.approver.name}
                          </div>
                          <div className="text-xs text-gray-500">
                            {request.approver.employeeId} • {request.approver.position || 'N/A'}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-400">尚未批准</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex space-x-2">
                        {((isManager && request.status === 'PENDING') || (isFinalReviewer && isReviewableStatus(request.status))) && (
                          <>
                            <button
                              onClick={() => handleApproveReject(request.id, 'APPROVED')}
                              className="text-green-600 hover:text-green-900 flex items-center"
                              title="批准"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleApproveReject(request.id, 'REJECTED')}
                              className="text-red-600 hover:text-red-900 flex items-center"
                              title="拒絕"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {/* 允許待審核時編輯 */}
                        {request.status === 'PENDING' && (isFinalReviewer || currentUser?.employeeId === request.employeeId) && (
                          <button
                            onClick={() => {
                              setEditing(request);
                              setEditForm({
                                overtimeDate: request.overtimeDate.slice(0, 10),
                                startTime: request.startTime,
                                endTime: request.endTime,
                                reason: request.reason,
                                workContent: request.workContent || '',
                                compensationType: request.compensationType || 'COMP_LEAVE'
                              });
                            }}
                            className="inline-flex items-center px-3 py-1 bg-blue-100 text-blue-800 rounded-full hover:bg-blue-200 transition-colors"
                          >
                            <Pencil className="w-4 h-4 mr-1" /> 編輯
                          </button>
                        )}
                        {/* 已批准不可刪除：隱藏或禁用刪除按鈕 */}
                        <button
                          onClick={() => openDeleteConfirm(request)}
                          disabled={request.status !== 'PENDING'}
                          className={`inline-flex items-center px-3 py-1 rounded-full transition-colors ${request.status === 'PENDING' ? 'bg-red-100 text-red-800 hover:bg-red-200' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                          title={request.status === 'PENDING' ? '刪除' : '已批准/已拒絕不可刪除'}
                        >
                          <Trash2 className="w-4 h-4 mr-1" /> 刪除
                        </button>
                        {/* 員工申請撤銷 */}
                        {request.status === 'APPROVED' && currentUser?.employeeId === request.employeeId && (
                          <button
                            onClick={() => {
                              const reason = prompt('請輸入撤銷原因：');
                              if (reason && reason.trim()) {
                                handleCancelRequest(request.id, reason.trim());
                              }
                            }}
                            className="inline-flex items-center px-3 py-1 bg-orange-100 text-orange-800 rounded-full hover:bg-orange-200 transition-colors"
                          >
                            <X className="w-4 h-4 mr-1" /> 申請撤銷
                          </button>
                        )}
                        {/* 管理員作廢 */}
                        {request.status === 'APPROVED' && isFinalReviewer && (
                          <button
                            onClick={() => {
                              const reason = prompt('請輸入作廢原因：');
                              if (reason && reason.trim()) {
                                handleVoidRequest(request.id, reason.trim());
                              }
                            }}
                            className="inline-flex items-center px-3 py-1 bg-red-100 text-red-800 rounded-full hover:bg-red-200 transition-colors"
                          >
                            <X className="w-4 h-4 mr-1" /> 作廢
                          </button>
                        )}
                        {/* 查看審核進度按鈕 */}
                        <button
                          onClick={() => handleToggleApproval(request.id)}
                          className="ml-2 inline-flex items-center gap-1 text-gray-600 hover:text-blue-600"
                          title="查看審核進度"
                        >
                          <Eye className="w-4 h-4" />
                          {expandedId === request.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {/* 展開的審核進度區域 */}
                  {expandedId === request.id && (
                    <tr>
                      <td colSpan={isFinalReviewer ? 9 : 8} className="px-6 py-4 bg-gray-50">
                        {approvalData ? (
                          <ApprovalProgress
                            currentLevel={approvalData.currentLevel}
                            maxLevel={approvalData.maxLevel}
                            status={approvalData.status}
                            reviews={approvalData.reviews}
                            customLabels={approvalData.labels}
                          />
                        ) : (
                          <div className="text-center py-4 text-gray-500">
                            載入中...
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
                ))}
              </tbody>
            </table>

            {filteredRequests.length === 0 && (
              <div className="text-center py-12">
                <Clock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">尚無加班申請記錄</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 新申請表單彈窗 */}
      {showNewRequestForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">申請加班</h2>
                <button
                  onClick={() => setShowNewRequestForm(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleSubmitRequest} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">加班日期</label>
                  <input
                    type="date"
                    value={newRequest.overtimeDate}
                    onChange={(e) => setNewRequest({ ...newRequest, overtimeDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">開始時間</label>
                    <input
                      type="time"
                      value={newRequest.startTime}
                      onChange={(e) => setNewRequest({ ...newRequest, startTime: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">須在17:00後</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">結束時間</label>
                    <input
                      type="time"
                      value={newRequest.endTime}
                      onChange={(e) => setNewRequest({ ...newRequest, endTime: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">申請原因</label>
                  <select
                    value={newRequest.reason}
                    onChange={(e) => setNewRequest({ ...newRequest, reason: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    required
                  >
                    <option value="">請選擇申請原因</option>
                    {reasonOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    工作內容
                    {newRequest.reason === '其它' && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <textarea
                    value={newRequest.workContent}
                    onChange={(e) => setNewRequest({ ...newRequest, workContent: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    rows={3}
                    placeholder={newRequest.reason === '其它' ? '請描述加班期間的具體工作內容（必填）' : '請描述加班期間的具體工作內容（選填）'}
                    required={newRequest.reason === '其它'}
                  />
                  {newRequest.reason === '其它' && (
                    <p className="text-sm text-red-600 mt-1">選擇「其它」時，工作內容為必填欄位</p>
                  )}
                </div>

                <div className="bg-blue-50 p-4 rounded-md">
                  <h4 className="font-medium text-blue-900 mb-2">加班規則</h4>
                  <ul className="text-sm text-blue-800 space-y-1">
                    <li>• 最少加班時間：0.5小時</li>
                    <li>• 最多加班時間：4小時</li>
                    <li>• 工時超過8小時才算加班</li>
                    <li>• 一天總工作時間不能超過12小時</li>
                  </ul>
                </div>

                <div className="flex space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowNewRequestForm(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    提交申請
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 編輯彈窗 */}
      {editing && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">編輯加班申請</h2>
                <button onClick={() => setEditing(null)} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"><X className="w-6 h-6" /></button>
              </div>
              <form onSubmit={handleEditSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">加班日期</label>
                  <input
                    type="date"
                    value={editForm.overtimeDate}
                    onChange={(e) => setEditForm({ ...editForm, overtimeDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">開始時間</label>
                    <input
                      type="time"
                      value={editForm.startTime}
                      onChange={(e) => setEditForm({ ...editForm, startTime: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">結束時間</label>
                    <input
                      type="time"
                      value={editForm.endTime}
                      onChange={(e) => setEditForm({ ...editForm, endTime: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">申請原因</label>
                  <select
                    value={editForm.reason}
                    onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    required
                  >
                    <option value="">請選擇申請原因</option>
                    {reasonOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    工作內容
                    {editForm.reason === '其它' && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <textarea
                    value={editForm.workContent}
                    onChange={(e) => setEditForm({ ...editForm, workContent: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    rows={3}
                    placeholder={editForm.reason === '其它' ? '請描述加班期間的具體工作內容（必填）' : '請描述加班期間的具體工作內容（選填）'}
                    required={editForm.reason === '其它'}
                  />
                  {editForm.reason === '其它' && (
                    <p className="text-sm text-red-600 mt-1">選擇「其它」時，工作內容為必填欄位</p>
                  )}
                </div>
                <div className="flex space-x-3 pt-2">
                  <button type="button" onClick={() => setEditing(null)} className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50">取消</button>
                  <button type="submit" className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">保存</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 批次審核工具列 */}
      {isFinalReviewer && (
        <BatchApproveBar
          selectedIds={selectedIds}
          apiEndpoint="/api/overtime-requests/batch"
          onSuccess={fetchOvertimeRequests}
          onClear={() => setSelectedIds([])}
          onSelectionChange={setSelectedIds}
          itemName="加班申請"
          requireRejectReason={false}
        />
      )}

      {/* 删除確認框 */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">確認删除</h3>
            <p className="text-gray-600 mb-6">確定要删除 {deleteConfirm.name} 的加班申請嗎？此操作無法恢復。</p>
            <div className="flex space-x-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                確認删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast 通知 */}
      {toast && (
        <div className={`fixed bottom-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'} text-white`}>
          {toast.message}
        </div>
      )}
    </AuthenticatedLayout>
  );
}
