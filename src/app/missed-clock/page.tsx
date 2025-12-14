'use client';

import { useState, useEffect, useCallback } from 'react';
import { Clock, Plus, Search, Filter, CheckCircle, XCircle, Trash2, Calendar, User, AlertTriangle } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import BatchApproveBar from '@/components/BatchApproveBar';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';

interface MissedClockRequest {
  id: number;
  employeeId: number;
  workDate: string;
  clockType: 'CLOCK_IN' | 'CLOCK_OUT';
  requestedTime: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
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
}

interface CurrentUser {
  id: number;
  username: string;
  role: string;
  employeeId: number;
}

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

const STATUS_LABELS = {
  PENDING: '待審核',
  APPROVED: '已批准',
  REJECTED: '已拒絕'
};

const STATUS_COLORS = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-green-100 text-green-800', 
  REJECTED: 'bg-red-100 text-red-800'
};

const CLOCK_TYPE_LABELS = {
  CLOCK_IN: '上班打卡',
  CLOCK_OUT: '下班打卡'
};

const REASON_OPTIONS = [
  '新進',
  '忘記密碼',
  '請假(公假/公出)',
  '網路連線異常',
  '簽到系統異常',
  '到班即執行業務',
  '電腦維修中',
  '上(下)班卡打到下(上)班卡',
  '留停復職',
  '未確認班表',
  '班表未展出',
  '提早簽退',
  '其它'
];

export default function MissedClockPage() {
  const [missedClockRequests, setMissedClockRequests] = useState<MissedClockRequest[]>([]);
  const [filteredRequests, setFilteredRequests] = useState<MissedClockRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showNewRequestForm, setShowNewRequestForm] = useState(false);

  // 部門列表
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  
  // Toast 狀態
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // 確認框狀態
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name: string } | null>(null);
  const [rejectModal, setRejectModal] = useState<{ id: number; name: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  
  // 排序狀態
  const [sortConfig, setSortConfig] = useState<{ field: 'employee' | 'date' | 'status'; direction: 'asc' | 'desc' }>({ field: 'date', direction: 'desc' });
  
  // 分頁狀態
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  // 新申請表單狀態
  const [newRequest, setNewRequest] = useState({
    workDate: '',
    clockType: 'CLOCK_IN' as 'CLOCK_IN' | 'CLOCK_OUT',
    requestedTime: '',
    reason: '',
    reasonDescription: ''
  });

  // 篩選狀態
  const [filters, setFilters] = useState({
    status: '',
    clockType: '',
    startDate: '',
    endDate: '',
    department: '' // 新增部門篩選
  });

  const [searchTerm, setSearchTerm] = useState('');

  // Toast 顯示函數
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  // 排序函數
  const handleSort = (field: 'employee' | 'date' | 'status') => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  // 匯出 CSV
  const exportToCSV = () => {
    const headers = ['員工編號', '姓名', '部門', '工作日期', '打卡類型', '申請時間', '狀態', '申請原因'];
    const csvData = [
      headers.join(','),
      ...sortedRequests.map(r => [
        r.employee.employeeId,
        r.employee.name,
        r.employee.department,
        r.workDate,
        CLOCK_TYPE_LABELS[r.clockType],
        r.requestedTime,
        STATUS_LABELS[r.status],
        r.reason
      ].join(','))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvData], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `忘打卡申請_${new Date().toISOString().substring(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('success', 'CSV 匯出成功');
  };

  // 匯出 Excel
  const exportToExcel = () => {
    const headers = ['員工編號', '姓名', '部門', '工作日期', '打卡類型', '申請時間', '狀態', '申請原因'];
    const excelData = [
      headers.join('\t'),
      ...sortedRequests.map(r => [
        r.employee.employeeId,
        r.employee.name,
        r.employee.department,
        r.workDate,
        CLOCK_TYPE_LABELS[r.clockType],
        r.requestedTime,
        STATUS_LABELS[r.status],
        r.reason
      ].join('\t'))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + excelData], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `忘打卡申請_${new Date().toISOString().substring(0, 10)}.xls`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('success', 'Excel 匯出成功');
  };

  useEffect(() => {
    fetchCurrentUser();
    fetchMissedClockRequests();
    fetchDepartments();
  }, []);

  // 獲取部門列表
  const fetchDepartments = async () => {
    try {
      const response = await fetch('/api/departments', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setDepartments(data.departments || []);
      }
    } catch (error) {
      console.error('獲取部門列表失敗:', error);
    }
  };

  const filterRequests = useCallback(() => {
    let filtered = missedClockRequests;

    if (filters.status) {
      filtered = filtered.filter(req => req.status === filters.status);
    }

    if (filters.clockType) {
      filtered = filtered.filter(req => req.clockType === filters.clockType);
    }

    // 部門篩選
    if (filters.department) {
      filtered = filtered.filter(req => req.employee.department === filters.department);
    }

    if (searchTerm) {
      filtered = filtered.filter(req =>
        req.employee.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        req.employee.employeeId.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (filters.startDate) {
      filtered = filtered.filter(req => req.workDate >= filters.startDate);
    }

    if (filters.endDate) {
      filtered = filtered.filter(req => req.workDate <= filters.endDate);
    }

    setFilteredRequests(filtered);
  }, [missedClockRequests, filters, searchTerm]);

  // 排序後的記錄

  const sortedRequests = [...filteredRequests].sort((a, b) => {
    const direction = sortConfig.direction === 'asc' ? 1 : -1;
    switch (sortConfig.field) {
      case 'employee':
        return a.employee.name.localeCompare(b.employee.name) * direction;
      case 'date':
        return (new Date(a.workDate).getTime() - new Date(b.workDate).getTime()) * direction;
      case 'status': {
        const statusOrder = { PENDING: 0, APPROVED: 1, REJECTED: 2 };
        return ((statusOrder[a.status] || 0) - (statusOrder[b.status] || 0)) * direction;
      }
      default:
        return 0;
    }
  });

  // 分頁
  const totalPages = Math.ceil(sortedRequests.length / itemsPerPage);
  const paginatedRequests = sortedRequests.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

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

  const fetchMissedClockRequests = async () => {
    try {
      const response = await fetch('/api/missed-clock-requests', {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setMissedClockRequests(data.requests || []);
      }
    } catch (error) {
      console.error('獲取忘記打卡申請失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!currentUser?.employeeId) {
      showToast('error', '用戶信息錯誤，請重新登入');
      return;
    }
    
    try {
      // 合併原因和原因說明
      const combinedReason = newRequest.reasonDescription 
        ? `${newRequest.reason}${newRequest.reason !== '其它' ? ' - ' : ': '}${newRequest.reasonDescription}`
        : newRequest.reason;

      const response = await fetchJSONWithCSRF('/api/missed-clock-requests', {
        method: 'POST',
        body: {
          workDate: newRequest.workDate,
          clockType: newRequest.clockType,
          requestedTime: newRequest.requestedTime,
          reason: combinedReason,
          employeeId: currentUser.employeeId
        }
      });

      if (response.ok) {
        setShowNewRequestForm(false);
        setNewRequest({
          workDate: '',
          clockType: 'CLOCK_IN',
          requestedTime: '',
          reason: '',
          reasonDescription: ''
        });
        fetchMissedClockRequests();
        showToast('success', '補打卡申請提交成功');
      } else {
        const error = await response.json();
        showToast('error', `提交失敗: ${error.error || '請稍後再試'}`);
      }
    } catch (error) {
      console.error('提交申請失敗:', error);
      showToast('error', '提交失敗，請稍後再試');
    }
  };

  const handleApprove = async (id: number) => {
    if (!currentUser) {
      showToast('error', '用戶信息錯誤，請重新登入');
      return;
    }

    try {
      const response = await fetchJSONWithCSRF('/api/missed-clock-requests', {
        method: 'PUT',
        body: {
          id,
          status: 'APPROVED',
          approvedBy: currentUser.id
        }
      });

      if (response.ok) {
        fetchMissedClockRequests();
        showToast('success', '審核通過');
      } else {
        const error = await response.json();
        showToast('error', `操作失敗: ${error.error || '請稍後再試'}`);
      }
    } catch (error) {
      console.error('審核失敗:', error);
      showToast('error', '操作失敗，請稍後再試');
    }
  };

  // 開啟拒絕 Modal
  const openRejectModal = (request: MissedClockRequest) => {
    setRejectModal({ id: request.id, name: request.employee.name });
    setRejectReason('');
  };

  // 確認拒絕
  const confirmReject = async () => {
    if (!rejectModal || !currentUser) return;

    try {
      const response = await fetchJSONWithCSRF('/api/missed-clock-requests', {
        method: 'PUT',
        body: {
          id: rejectModal.id,
          status: 'REJECTED',
          approvedBy: currentUser.id,
          rejectReason: rejectReason
        }
      });

      if (response.ok) {
        fetchMissedClockRequests();
        showToast('success', '已拒絕申請');
      } else {
        const error = await response.json();
        showToast('error', `操作失敗: ${error.error || '請稍後再試'}`);
      }
    } catch (error) {
      console.error('拒絕申請失敗:', error);
      showToast('error', '操作失敗，請稍後再試');
    }
    setRejectModal(null);
    setRejectReason('');
  };

  // 開啟刪除確認框
  const showDeleteConfirm = (request: MissedClockRequest) => {
    setDeleteConfirm({ id: request.id, name: request.employee.name });
  };

  // 確認刪除
  const confirmDelete = async () => {
    if (!deleteConfirm) return;

    try {
      const response = await fetchJSONWithCSRF('/api/missed-clock-requests', {
        method: 'DELETE',
        body: { id: deleteConfirm.id }
      });

      if (response.ok) {
        fetchMissedClockRequests();
        showToast('success', '刪除成功');
      } else {
        const error = await response.json();
        showToast('error', `刪除失敗: ${error.error || '請稍後再試'}`);
      }
    } catch (error) {
      console.error('刪除失敗:', error);
      showToast('error', '刪除失敗，請稍後再試');
    }
    setDeleteConfirm(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Clock className="w-12 h-12 text-blue-600 mx-auto mb-4 animate-spin" />
          <p className="text-gray-800">載入中...</p>
        </div>
      </div>
    );
  }

  const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.role === 'HR';

  return (
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 標題區 */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-orange-600" />
              <h1 className="text-3xl font-bold text-gray-900">忘打卡管理</h1>
            </div>
            
            {/* 所有員工都可以申請補打卡 */}
            <button
              onClick={() => setShowNewRequestForm(true)}
              className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white px-6 py-3 rounded-lg transition-colors"
            >
              <Plus className="w-5 h-5" />
              申請補打卡
            </button>
          </div>
          <p className="mt-2 text-gray-700">員工忘打卡申請</p>
        </div>

        {/* 搜索和篩選區 */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-600 w-4 h-4" />
              <input
                type="text"
                placeholder="搜索員工姓名、工號或原因"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent text-gray-900 placeholder-gray-700"
              />
            </div>

            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent text-gray-900"
            >
              <option value="">全部狀態</option>
              <option value="PENDING">待審核</option>
              <option value="APPROVED">已批准</option>
              <option value="REJECTED">已拒絕</option>
            </select>

            <select
              value={filters.clockType}
              onChange={(e) => setFilters({ ...filters, clockType: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent text-gray-900"
            >
              <option value="">全部類型</option>
              <option value="CLOCK_IN">上班打卡</option>
              <option value="CLOCK_OUT">下班打卡</option>
            </select>

            {/* 部門篩選 */}
            <select
              value={filters.department}
              onChange={(e) => { setFilters({ ...filters, department: e.target.value }); setCurrentPage(1); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent text-gray-900"
            >
              <option value="">全部部門</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.name}>{dept.name}</option>
              ))}
            </select>

            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent text-gray-900 placeholder-gray-700"
              placeholder="開始日期"
            />

            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent text-gray-900 placeholder-gray-700"
              placeholder="結束日期"
            />

            <button
              onClick={() => {
                setFilters({ status: '', clockType: '', startDate: '', endDate: '', department: '' });
                setSearchTerm('');
              }}
              className="flex items-center justify-center gap-2 px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              <Filter className="w-4 h-4" />
              清除篩選
            </button>
          </div>

          {/* 排序與匯出按鈕 */}
          <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-gray-200">
            <span className="text-sm text-gray-700">排序：</span>
            <button
              onClick={() => handleSort('employee')}
              className={`px-3 py-1 rounded-full text-sm ${sortConfig.field === 'employee' ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-700'}`}
            >
              員工名稱 {sortConfig.field === 'employee' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
            </button>
            <button
              onClick={() => handleSort('date')}
              className={`px-3 py-1 rounded-full text-sm ${sortConfig.field === 'date' ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-700'}`}
            >
              工作日期 {sortConfig.field === 'date' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
            </button>
            <button
              onClick={() => handleSort('status')}
              className={`px-3 py-1 rounded-full text-sm ${sortConfig.field === 'status' ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-700'}`}
            >
              狀態 {sortConfig.field === 'status' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
            </button>

            <div className="flex-1" />

            <button
              onClick={exportToCSV}
              className="px-4 py-2 text-sm bg-green-50 text-green-700 rounded-lg hover:bg-green-100"
            >
              匯出 CSV
            </button>
            <button
              onClick={exportToExcel}
              className="px-4 py-2 text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100"
            >
              匯出 Excel
            </button>
          </div>
        </div>

        {/* 申請列表 */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden mb-20">
          {paginatedRequests.length > 0 ? (
            <>
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">補打卡申請記錄 ({sortedRequests.length})</h2>
                {isAdmin && sortedRequests.filter(r => r.status === 'PENDING').length > 0 && (
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={selectedIds.length === filteredRequests.filter(r => r.status === 'PENDING').length && selectedIds.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(filteredRequests.filter(r => r.status === 'PENDING').map(r => r.id));
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
                    {isAdmin && (
                      <th className="px-3 py-3 text-center text-xs font-medium text-gray-700 uppercase tracking-wider w-12">選擇</th>
                    )}
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      員工資訊
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      工作日期
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      打卡類型
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      申請時間
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      申請原因
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      狀態
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {paginatedRequests.map((request) => (
                    <tr key={request.id} className={`hover:bg-gray-50 ${selectedIds.includes(request.id) ? 'bg-blue-50' : ''}`}>
                      {isAdmin && (
                        <td className="px-3 py-4 text-center">
                          {request.status === 'PENDING' && (
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
                          <User className="w-8 h-8 text-gray-600 mr-3" />
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {request.employee.name}
                            </div>
                            <div className="text-sm text-gray-800">
                              工號: {request.employee.employeeId}
                            </div>
                            <div className="text-sm text-gray-700">
                              {request.employee.department} · {request.employee.position}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <Calendar className="w-4 h-4 text-gray-600 mr-2" />
                          <span className="text-sm text-gray-900">
                            {new Date(request.workDate).toLocaleDateString('zh-TW')}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          request.clockType === 'CLOCK_IN' 
                            ? 'bg-blue-100 text-blue-800' 
                            : 'bg-purple-100 text-purple-800'
                        }`}>
                          {CLOCK_TYPE_LABELS[request.clockType]}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <Clock className="w-4 h-4 text-gray-600 mr-2" />
                          <span className="text-sm text-gray-900">
                            {request.requestedTime}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900 max-w-xs truncate" title={request.reason}>
                          {request.reason}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${STATUS_COLORS[request.status]}`}>
                          {STATUS_LABELS[request.status]}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex items-center space-x-2">
                          {isAdmin && request.status === 'PENDING' && (
                            <>
                              <button
                                onClick={() => handleApprove(request.id)}
                                className="inline-flex items-center px-3 py-1 bg-green-100 text-green-800 rounded-full hover:bg-green-200 transition-colors"
                              >
                                <CheckCircle className="w-4 h-4 mr-1" />
                                批准
                              </button>
                              <button
                                onClick={() => openRejectModal(request)}
                                className="inline-flex items-center px-3 py-1 bg-red-100 text-red-800 rounded-full hover:bg-red-200 transition-colors"
                              >
                                <XCircle className="w-4 h-4 mr-1" />
                                拒絕
                              </button>
                            </>
                          )}
                          
                          {(isAdmin || request.employeeId === currentUser?.employeeId) && (
                            <button
                              onClick={() => showDeleteConfirm(request)}
                              className="inline-flex items-center px-3 py-1 bg-red-100 text-red-800 rounded-full hover:bg-red-200 transition-colors"
                            >
                              <Trash2 className="w-4 h-4 mr-1" />
                              刪除
                            </button>
                          )}
                        </div>
                      </td>

                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          ) : (
            <div className="text-center py-12">
              <AlertTriangle className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-700">尚無補打卡申請記錄</p>
            </div>
          )}
        </div>
      </div>

      {/* 新申請表單彈窗 */}
      {showNewRequestForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">申請補打卡</h2>
                <button
                  onClick={() => setShowNewRequestForm(false)}
                  className="text-gray-600 hover:text-gray-800"
                >
                  ×
                </button>
              </div>

              <form onSubmit={handleSubmitRequest} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    工作日期 *
                  </label>
                  <input
                    type="date"
                    required
                    value={newRequest.workDate}
                    onChange={(e) => setNewRequest({ ...newRequest, workDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-orange-500 focus:border-transparent text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    打卡類型 *
                  </label>
                  <select
                    required
                    value={newRequest.clockType}
                    onChange={(e) => setNewRequest({ ...newRequest, clockType: e.target.value as 'CLOCK_IN' | 'CLOCK_OUT' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-orange-500 focus:border-transparent text-gray-900"
                  >
                    <option value="CLOCK_IN">上班打卡</option>
                    <option value="CLOCK_OUT">下班打卡</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    申請時間 *
                  </label>
                  <input
                    type="time"
                    required
                    value={newRequest.requestedTime}
                    onChange={(e) => setNewRequest({ ...newRequest, requestedTime: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-orange-500 focus:border-transparent text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    申請原因 *
                  </label>
                  <select
                    required
                    value={newRequest.reason}
                    onChange={(e) => setNewRequest({ ...newRequest, reason: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-orange-500 focus:border-transparent text-gray-900"
                  >
                    <option value="">請選擇申請原因</option>
                    {REASON_OPTIONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {reason}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    原因說明 {newRequest.reason === '其它' ? '*' : '(選填)'}
                  </label>
                  <textarea
                    required={newRequest.reason === '其它'}
                    rows={3}
                    value={newRequest.reasonDescription}
                    onChange={(e) => setNewRequest({ ...newRequest, reasonDescription: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-orange-500 focus:border-transparent text-gray-900 placeholder-gray-700"
                    placeholder={newRequest.reason === '其它' ? '請詳細說明原因' : '可補充詳細說明 (選填)'}
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowNewRequestForm(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700"
                  >
                    提交申請
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 批次審核工具列 */}
      {isAdmin && (
        <BatchApproveBar
          selectedIds={selectedIds}
          apiEndpoint="/api/missed-clock-requests/batch-approve"
          onSuccess={fetchMissedClockRequests}
          onClear={() => setSelectedIds([])}
          itemName="忽打卡申請"
        />
      )}

      {/* 分頁導航 */}
      {totalPages > 1 && (
        <div className="fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-white rounded-lg shadow-lg px-6 py-3 flex items-center gap-4 z-40">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-3 py-1 rounded bg-gray-100 text-gray-700 disabled:opacity-50"
          >
            上一頁
          </button>
          <span className="text-sm text-gray-900">
            第 {currentPage} / {totalPages} 頁（共 {sortedRequests.length} 筆）
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-3 py-1 rounded bg-gray-100 text-gray-700 disabled:opacity-50"
          >
            下一頁
          </button>
        </div>
      )}

      {/* 刪除確認框 */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">確認刪除</h3>
            <p className="text-gray-700 mb-6">確定要刪除 <strong>{deleteConfirm.name}</strong> 的這筆申請嗎？</p>
            <div className="flex gap-3">
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
                確認刪除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 拒絕確認框 */}
      {rejectModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">拒絕申請</h3>
            <p className="text-gray-700 mb-4">確定要拒絕 <strong>{rejectModal.name}</strong> 的這筆申請嗎？</p>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">拒絕原因（選填）</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 placeholder-gray-700"
                placeholder="請輸入拒絕原因..."
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setRejectModal(null); setRejectReason(''); }}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={confirmReject}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                確認拒絕
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
