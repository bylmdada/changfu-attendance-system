'use client';

import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, AlertCircle, Clock, CalendarDays, User, Filter, Search, Plus, Pencil, Trash2, X } from 'lucide-react';
import { buildAuthMeRequest, buildCookieSessionRequest } from '@/lib/admin-session-client';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';

interface Employee {
  id: number;
  employeeId: string;
  name: string;
  email: string;
  department: string;
  position: string;
}

interface Schedule {
  id: number;
  employeeId: number;
  workDate: string;
  shiftType: string;
  startTime: string;
  endTime: string;
  breakTime?: number;
  createdAt: string;
  updatedAt: string;
  employee: {
    id: number;
    employeeId: string;
    name: string;
    department: string;
    position: string;
  };
}

interface ShiftExchangeRequest {
  id: number;
  requesterId: number;
  targetEmployeeId?: number;
  shiftDate: string; // 調班日期
  originalShiftType: string; // 原班別
  newShiftType: string; // 新班別
  leaveType?: string; // 請假類型（當FDL時）
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvedBy?: number;
  approvedAt?: string;
  createdAt: string;
  requester: Employee;
  targetEmployee?: Employee;
  approver?: Employee | null;
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

const SHIFT_TYPE_LABELS = {
  A: 'A班 (07:30-16:30)',
  B: 'B班 (08:00-17:00)',
  C: 'C班 (08:30-17:30)',
  NH: 'NH (國定假日)',
  RD: 'RD (例假)',
  rd: 'rd (休息日)',
  FDL: 'FDL (全日請假)',
  OFF: 'OFF (休假)',
  TD: 'TD (天災假)'
};

// 請假類型標籤
const LEAVE_TYPES = {
  ANNUAL: '特休假',
  COMPENSATORY: '補休',
  SICK: '病假',
  PERSONAL: '事假',
  MARRIAGE: '婚假',
  BEREAVEMENT: '喪假',
  MATERNITY: '產假',
  PATERNITY_CHECKUP: '陪產檢及陪產假',
  PRENATAL_CHECKUP: '產檢假',
  OFFICIAL: '公假',
  OCCUPATIONAL_INJURY: '公傷假'
};

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

const STATUS_ICONS = {
  PENDING: AlertCircle,
  APPROVED: CheckCircle,
  REJECTED: XCircle
};

export default function ShiftExchangePage() {
  const [shiftExchanges, setShiftExchanges] = useState<ShiftExchangeRequest[]>([]);
  const [filteredRequests, setFilteredRequests] = useState<ShiftExchangeRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNewRequestForm, setShowNewRequestForm] = useState(false);
  const [userSchedules, setUserSchedules] = useState<Schedule[]>([]); // 儲存用戶班表數據

  // 申請原因選項
  const reasonOptions = [
    { value: '支援活動調班', label: '支援活動調班' },
    { value: '配合人力調班', label: '配合人力調班' },
    { value: '機動調班', label: '機動調班' },
    { value: '業務需要', label: '業務需要' },
    { value: '家中有事', label: '家中有事' },
    { value: '小孩生病', label: '小孩生病' },
    { value: '身體不適', label: '身體不適' },
    { value: '班別輸入錯誤', label: '班別輸入錯誤' },
    { value: '其它', label: '其它' }
  ];

  // 新申請表單狀態
  const [newRequest, setNewRequest] = useState({
    targetEmployeeId: '',
    shiftDate: '', // 調班日期
    originalShiftType: 'A', // 原班別
    newShiftType: 'A', // 新班別
    leaveType: '', // 請假類型（當選擇FDL時必填）
    reason: '',
    reasonDetail: '' // 詳細說明
  });

  // 編輯申請表單狀態
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingRequest, setEditingRequest] = useState<ShiftExchangeRequest | null>(null);
  const [editForm, setEditForm] = useState({
    shiftDate: '',
    originalShiftType: 'A',
    newShiftType: 'A',
    leaveType: '',
    reason: '',
    reasonDetail: ''
  });

  // 篩選器狀態
  const [filters, setFilters] = useState({
    status: '',
    startDate: '',
    endDate: '',
    search: ''
  });

  // 是否為互換模式
  const [isSwapMode, setIsSwapMode] = useState(false);

  // Toast 訊息狀態
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // 刪除確認對話框狀態
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; requesterName: string } | null>(null);

  // 批量選擇狀態
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // 排序狀態
  const [sortConfig, setSortConfig] = useState<{
    field: 'shiftDate' | 'status' | 'requester' | 'createdAt';
    direction: 'asc' | 'desc';
  }>({ field: 'createdAt', direction: 'desc' });

  // 拒絕原因對話框狀態
  const [rejectDialog, setRejectDialog] = useState<{ id: number; requesterName: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const buildSessionRequest = (path: string) => buildCookieSessionRequest(window.location.origin, path);

  // 計算過濾後的申請列表
  useEffect(() => {
    let filtered = shiftExchanges;

    if (filters.status) {
      filtered = filtered.filter(req => req.status === filters.status);
    }

    if (filters.startDate) {
      filtered = filtered.filter(req => req.shiftDate >= filters.startDate);
    }
    
    if (filters.endDate) {
      filtered = filtered.filter(req => req.shiftDate <= filters.endDate);
    }

    if (filters.search) {
      filtered = filtered.filter(req =>
        req.requester.name.toLowerCase().includes(filters.search.toLowerCase()) ||
        req.requester.employeeId.toLowerCase().includes(filters.search.toLowerCase()) ||
        (req.targetEmployee?.name.toLowerCase().includes(filters.search.toLowerCase())) ||
        (req.targetEmployee?.employeeId.toLowerCase().includes(filters.search.toLowerCase())) ||
        req.reason.toLowerCase().includes(filters.search.toLowerCase())
      );
    }

    if (filters.startDate || filters.endDate) {
      filtered = filtered.sort((a, b) => new Date(a.shiftDate).getTime() - new Date(b.shiftDate).getTime());
    }

    setFilteredRequests(filtered);
  }, [shiftExchanges, filters]);

  // 載入數據
  useEffect(() => {
    const fetchData = async () => {
      try {
        // 先取用戶
        const authRequest = buildAuthMeRequest(window.location.origin);
        const userRes = await fetch(authRequest.url, authRequest.options);
        let currentUser: User | null = null;
        if (userRes.ok) {
          const userData = await userRes.json();
          currentUser = userData.user || userData;
          setUser(currentUser);
        } else if (userRes.status === 401 || userRes.status === 403) {
          // 身份驗證失敗，重定向到登入頁面
          console.warn('Authentication failed, redirecting to login');
          window.location.href = '/login';
          return;
        }

        // 取用戶班表
        if (currentUser?.employee?.id) {
          try {
            const schedulesRequest = buildSessionRequest(`/api/schedules?employeeId=${currentUser.employee.id}`);
            const schedulesRes = await fetch(schedulesRequest.url, schedulesRequest.options);
            if (schedulesRes.ok) {
              const schedulesData = await schedulesRes.json();
              setUserSchedules(schedulesData.schedules || []);
            }
          } catch (error) {
            console.error('Failed to fetch user schedules:', error);
          }
        }

        // 取換班清單（所有人皆可）
        const exchangesRequest = buildSessionRequest('/api/shift-exchanges');
        const exchangesRes = await fetch(exchangesRequest.url, exchangesRequest.options);
        if (exchangesRes.ok) {
          const exchangesData = await exchangesRes.json();
          setShiftExchanges(exchangesData);
        } else {
          console.warn('Failed to load shift-exchanges:', exchangesRes.status);
        }

        // 僅 ADMIN/HR 取員工清單
        if (currentUser?.role === 'ADMIN' || currentUser?.role === 'HR') {
          const employeesRequest = buildSessionRequest('/api/employees');
          const employeesRes = await fetch(employeesRequest.url, employeesRequest.options);
          if (employeesRes.ok) {
            const employeesData = await employeesRes.json();
            const list = Array.isArray(employeesData)
              ? employeesData
              : Array.isArray(employeesData?.employees)
                ? employeesData.employees
                : Array.isArray(employeesData?.data)
                  ? employeesData.data
                  : [];
            setEmployees(list as Employee[]);
          }
        }
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // 根據選定日期獲取原班別
  const getOriginalShiftType = (date: string): string => {
    if (!date || !userSchedules.length) return 'A';
    
    const schedule = userSchedules.find(s => s.workDate === date);
    return schedule ? schedule.shiftType : 'A';
  };

  // 處理調班日期變化
  const handleShiftDateChange = (date: string) => {
    const originalShift = getOriginalShiftType(date);
    setNewRequest({
      ...newRequest,
      shiftDate: date,
      originalShiftType: originalShift
    });
  };

  // 提交新申請
  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user?.employee) {
      alert('用戶信息錯誤');
      return;
    }

    // 驗證：如果選擇"其它"，詳細說明不能為空
    if (newRequest.reason === '其它' && !newRequest.reasonDetail.trim()) {
      alert('選擇「其它」原因時，請填寫詳細說明');
      return;
    }

    // 驗證：如果選擇FDL，必須選擇請假類型
    if (newRequest.newShiftType === 'FDL' && !newRequest.leaveType) {
      alert('調班為全日請假時，請選擇請假類型');
      return;
    }

    try {
      // 先探測 GET 以喚起路由
      const ping = await fetch('/api/shift-exchanges', { method: 'GET', credentials: 'include' });
      if (!ping.ok && ping.status !== 401) {
        console.warn('Ping shift-exchanges failed:', ping.status);
      }
      const payload = isSwapMode && newRequest.targetEmployeeId
        ? {
            targetEmployeeId: Number(newRequest.targetEmployeeId),
            originalWorkDate: newRequest.shiftDate,
            targetWorkDate: newRequest.shiftDate,
            requestReason: newRequest.reason === '其它' 
              ? `${newRequest.reason}：${newRequest.reasonDetail}` 
              : newRequest.reason || '調班互換'
          }
        : {
            shiftDate: newRequest.shiftDate,
            originalShiftType: newRequest.originalShiftType,
            newShiftType: newRequest.newShiftType,
            leaveType: newRequest.newShiftType === 'FDL' ? newRequest.leaveType : undefined,
            reason: newRequest.reason === '其它' 
              ? `${newRequest.reason}：${newRequest.reasonDetail}` 
              : newRequest.reason
          };
      const response = await fetchJSONWithCSRF('/api/shift-exchanges', {
        method: 'POST',
        body: payload
      });

      if (response.ok) {
        const newExchange = await response.json();
        // 立即更新列表並放到最前面
        setShiftExchanges(prev => [newExchange, ...prev]);
        setShowNewRequestForm(false);
        setNewRequest({
          targetEmployeeId: '',
          shiftDate: '',
          originalShiftType: 'A',
          newShiftType: 'A',
          leaveType: '',
          reason: '',
          reasonDetail: ''
        });
        
        // 重新拉取最新列表確保同步
        try {
          const listRequest = buildSessionRequest('/api/shift-exchanges');
          const listRes = await fetch(listRequest.url, listRequest.options);
          if (listRes.ok) {
            const latestList = await listRes.json();
            setShiftExchanges(latestList);
          }
        } catch (refreshError) {
          console.warn('Failed to refresh list after submit:', refreshError);
        }
        
        alert('調班申請已提交！');
      } else {
        let msg = '提交失敗，請重試';
        try { const err = await response.json(); if (err?.error) msg = err.error; } catch {}
        alert(msg);
      }
    } catch (error) {
      console.error('Submit failed:', error);
      alert('提交失敗，請重試');
    }
  };

  // 顯示 Toast 訊息
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  // 顯示刪除確認對話框
  const showDeleteConfirm = (request: ShiftExchangeRequest) => {
    if (request.status !== 'PENDING') {
      showToast('error', '只能刪除待審核的申請');
      return;
    }
    setDeleteConfirm({ id: request.id, requesterName: request.requester.name });
  };

  // 執行刪除
  const handleDelete = async () => {
    if (!deleteConfirm) return;

    try {
      const res = await fetchJSONWithCSRF(`/api/shift-exchanges/${deleteConfirm.id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!res.ok) {
        showToast('error', data.error || '刪除失敗');
        return;
      }
      setShiftExchanges(prev => prev.filter(r => r.id !== deleteConfirm.id));
      setSelectedIds(ids => {
        const newIds = new Set(ids);
        newIds.delete(deleteConfirm.id);
        return newIds;
      });
      showToast('success', '調班申請已刪除');
    } catch {
      showToast('error', '刪除失敗，請重試');
    } finally {
      setDeleteConfirm(null);
    }
  };

  // 審核申請（批准）
  const handleApprove = async (requestId: number) => {
    try {
      const response = await fetchJSONWithCSRF(`/api/shift-exchanges/${requestId}`, {
        method: 'PATCH',
        body: {
          status: 'APPROVED',
          approvedBy: user?.employee?.id
        }
      });

      if (response.ok) {
        const updatedExchange = await response.json();
        setShiftExchanges(shiftExchanges.map(exchange => 
          exchange.id === requestId ? updatedExchange : exchange
        ));
        setSelectedIds(ids => {
          const newIds = new Set(ids);
          newIds.delete(requestId);
          return newIds;
        });

        // If approved and current user is affected, refresh schedules
        if (updatedExchange.status === 'APPROVED' && user?.employee?.id) {
          const myId = user.employee.id;
          if (myId === updatedExchange.requesterId || myId === updatedExchange.targetEmployeeId) {
            try {
              const schedulesRequest = buildSessionRequest(`/api/schedules?employeeId=${myId}`);
              const schedulesRes = await fetch(schedulesRequest.url, schedulesRequest.options);
              if (schedulesRes.ok) {
                const schedulesData = await schedulesRes.json();
                setUserSchedules(schedulesData.schedules || []);
              }
            } catch (err) {
              console.error('Failed to refresh schedules after approval:', err);
            }
          }
        }

        showToast('success', '申請已批准');
      } else {
        showToast('error', '操作失敗，請重試');
      }
    } catch (error) {
      console.error('Approve failed:', error);
      showToast('error', '操作失敗，請重試');
    }
  };

  // 顯示拒絕原因對話框
  const showRejectDialog = (request: ShiftExchangeRequest) => {
    setRejectDialog({ id: request.id, requesterName: request.requester.name });
    setRejectReason('');
  };

  // 執行拒絕
  const handleReject = async () => {
    if (!rejectDialog) return;

    try {
      const response = await fetchJSONWithCSRF(`/api/shift-exchanges/${rejectDialog.id}`, {
        method: 'PATCH',
        body: {
          status: 'REJECTED',
          approvedBy: user?.employee?.id,
          rejectReason: rejectReason || undefined
        }
      });

      if (response.ok) {
        const updatedExchange = await response.json();
        setShiftExchanges(shiftExchanges.map(exchange => 
          exchange.id === rejectDialog.id ? updatedExchange : exchange
        ));
        setSelectedIds(ids => {
          const newIds = new Set(ids);
          newIds.delete(rejectDialog.id);
          return newIds;
        });
        showToast('success', '申請已拒絕');
      } else {
        showToast('error', '操作失敗');
      }
    } catch {
      showToast('error', '操作失敗，請重試');
    } finally {
      setRejectDialog(null);
      setRejectReason('');
    }
  };

  // 切換選擇
  const toggleSelectRequest = (id: number) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // 全選/取消全選待審核
  const toggleSelectAllPending = () => {
    const pendingIds = filteredRequests.filter(r => r.status === 'PENDING').map(r => r.id);
    if (pendingIds.every(id => selectedIds.has(id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingIds));
    }
  };

  // 批量批准
  const handleBatchApprove = async () => {
    if (selectedIds.size === 0) {
      showToast('error', '請先選擇申請');
      return;
    }

    const pendingIds = Array.from(selectedIds).filter(id => {
      const req = shiftExchanges.find(r => r.id === id);
      return req?.status === 'PENDING';
    });

    if (pendingIds.length === 0) {
      showToast('error', '沒有可批准的待審核申請');
      return;
    }

    try {
      const promises = pendingIds.map(id =>
        fetchJSONWithCSRF(`/api/shift-exchanges/${id}`, {
          method: 'PATCH',
          body: {
            status: 'APPROVED',
            approvedBy: user?.employee?.id
          }
        })
      );

      const results = await Promise.all(promises);
      const successfulIds = pendingIds.filter((_, index) => results[index]?.ok);
      const failedIds = pendingIds.filter((_, index) => !results[index]?.ok);
      const successCount = successfulIds.length;

      // 重新載入列表
      const listRequest = buildSessionRequest('/api/shift-exchanges');
      const listRes = await fetch(listRequest.url, listRequest.options);
      if (listRes.ok) {
        const latestList = await listRes.json();
        setShiftExchanges(latestList);
      }

      setSelectedIds(new Set(failedIds));

      if (successCount === 0) {
        showToast('error', '批量批准失敗，請重新整理後再試');
        return;
      }

      showToast('success', `已批准 ${successCount} 個申請`);
      if (failedIds.length > 0) {
        showToast('error', `另有 ${failedIds.length} 個申請批准失敗`);
      }
    } catch {
      showToast('error', '批量操作失敗');
    }
  };

  // 批量拒絕
  const handleBatchReject = async () => {
    if (selectedIds.size === 0) {
      showToast('error', '請先選擇申請');
      return;
    }

    const pendingIds = Array.from(selectedIds).filter(id => {
      const req = shiftExchanges.find(r => r.id === id);
      return req?.status === 'PENDING';
    });

    if (pendingIds.length === 0) {
      showToast('error', '沒有可拒絕的待審核申請');
      return;
    }

    try {
      const promises = pendingIds.map(id =>
        fetchJSONWithCSRF(`/api/shift-exchanges/${id}`, {
          method: 'PATCH',
          body: {
            status: 'REJECTED',
            approvedBy: user?.employee?.id
          }
        })
      );

      const results = await Promise.all(promises);
      const successfulIds = pendingIds.filter((_, index) => results[index]?.ok);
      const failedIds = pendingIds.filter((_, index) => !results[index]?.ok);
      const successCount = successfulIds.length;

      // 重新載入列表
      const listRequest = buildSessionRequest('/api/shift-exchanges');
      const listRes = await fetch(listRequest.url, listRequest.options);
      if (listRes.ok) {
        const latestList = await listRes.json();
        setShiftExchanges(latestList);
      }

      setSelectedIds(new Set(failedIds));

      if (successCount === 0) {
        showToast('error', '批量拒絕失敗，請重新整理後再試');
        return;
      }

      showToast('success', `已拒絕 ${successCount} 個申請`);
      if (failedIds.length > 0) {
        showToast('error', `另有 ${failedIds.length} 個申請拒絕失敗`);
      }
    } catch {
      showToast('error', '批量操作失敗');
    }
  };

  // 排序函數
  const handleSort = (field: 'shiftDate' | 'status' | 'requester' | 'createdAt') => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  // 匯出 CSV
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const exportToCSV = () => {
    const headers = ['申請日期', '申請人', '調班日期', '原班別', '新班別', '原因', '狀態', '審核人', '審核時間'];
    const rows = sortedRequests.map(r => [
      new Date(r.createdAt).toLocaleDateString('zh-TW'),
      `${r.requester.name} (${r.requester.employeeId})`,
      r.shiftDate,
      SHIFT_TYPE_LABELS[r.originalShiftType as keyof typeof SHIFT_TYPE_LABELS] || r.originalShiftType,
      SHIFT_TYPE_LABELS[r.newShiftType as keyof typeof SHIFT_TYPE_LABELS] || r.newShiftType,
      r.reason,
      r.status === 'PENDING' ? '待審核' : r.status === 'APPROVED' ? '已批准' : '已拒絕',
      r.approver?.name || '-',
      r.approvedAt ? new Date(r.approvedAt).toLocaleDateString('zh-TW') : '-'
    ]);
    const csvContent = '\uFEFF' + [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `調班申請_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 排序後的申請列表
  const sortedRequests = [...filteredRequests].sort((a, b) => {
    const direction = sortConfig.direction === 'asc' ? 1 : -1;
    
    switch (sortConfig.field) {
      case 'shiftDate':
        return (new Date(a.shiftDate).getTime() - new Date(b.shiftDate).getTime()) * direction;
      case 'status': {
        const statusOrder = { PENDING: 1, APPROVED: 2, REJECTED: 3 };
        return (statusOrder[a.status] - statusOrder[b.status]) * direction;
      }
      case 'requester':
        return a.requester.name.localeCompare(b.requester.name) * direction;
      case 'createdAt':
        return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * direction;
      default:
        return 0;
    }
  });

  // 開啟編輯表單
  const openEdit = (r: ShiftExchangeRequest) => {
    setEditingRequest(r);
    
    // 解析原因和詳細說明
    let reason = r.reason || '';
    let reasonDetail = '';
    
    // 如果原因包含"其它："，則分離原因和詳細說明
    if (reason.startsWith('其它：')) {
      reasonDetail = reason.substring(3);
      reason = '其它';
    }
    
    setEditForm({
      shiftDate: r.shiftDate?.substring(0,10),
      originalShiftType: r.originalShiftType,
      newShiftType: r.newShiftType,
      leaveType: r.leaveType || '',
      reason: reason,
      reasonDetail: reasonDetail
    });
    setShowEditModal(true);
  };

  // 提交編輯
  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRequest) return;

    // 驗證：如果選擇"其它"，詳細說明不能為空
    if (editForm.reason === '其它' && !editForm.reasonDetail.trim()) {
      alert('選擇「其它」原因時，請填寫詳細說明');
      return;
    }

    try {
      const res = await fetchJSONWithCSRF(`/api/shift-exchanges/${editingRequest.id}`, {
        method: 'PATCH',
        body: {
          shiftDate: editForm.shiftDate,
          originalShiftType: editForm.originalShiftType,
          newShiftType: editForm.newShiftType,
          reason: editForm.reason === '其它' 
            ? `${editForm.reason}：${editForm.reasonDetail}` 
            : editForm.reason
        }
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || '更新失敗');
        return;
      }
      setShiftExchanges(prev => prev.map(r => r.id === editingRequest.id ? data : r));
      setShowEditModal(false);
      setEditingRequest(null);
      alert('已更新');
    } catch {
      alert('更新失敗，請重試');
    }
  };

  // 員工申請撤銷
  const handleCancelRequest = async (id: number, reason: string) => {
    try {
      const res = await fetchJSONWithCSRF(`/api/shift-exchange-requests/${id}/cancel`, {
        method: 'POST',
        body: { reason }
      });
      const data = await res.json();
      if (!res.ok) {
        showToast('error', data.error || '撤銷申請失敗');
        return;
      }
      showToast('success', data.message || '撤銷申請已送出');
      // 重新載入列表
      const listRequest = buildSessionRequest('/api/shift-exchanges');
      const listRes = await fetch(listRequest.url, listRequest.options);
      if (listRes.ok) {
        const latestList = await listRes.json();
        setShiftExchanges(latestList);
      }
    } catch {
      showToast('error', '撤銷申請失敗，請稍後再試');
    }
  };

  // 管理員作廢
  const handleVoidRequest = async (id: number, reason: string) => {
    try {
      const res = await fetchJSONWithCSRF(`/api/shift-exchange-requests/${id}/void`, {
        method: 'POST',
        body: { reason }
      });
      const data = await res.json();
      if (!res.ok) {
        showToast('error', data.error || '作廢失敗');
        return;
      }
      showToast('success', data.message || '已作廢');
      // 重新載入列表
      const listRequest = buildSessionRequest('/api/shift-exchanges');
      const listRes = await fetch(listRequest.url, listRequest.options);
      if (listRes.ok) {
        const latestList = await listRes.json();
        setShiftExchanges(latestList);
      }
    } catch {
      showToast('error', '作廢失敗，請稍後再試');
    }
  };

  const canManage = user?.role === 'ADMIN' || user?.role === 'HR';

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
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 標題區 */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center">
                <CalendarDays className="w-8 h-8 text-blue-600 mr-3" />
                調班管理
              </h1>
              <p className="text-gray-600 mt-2">
                {canManage ? '管理員工調班申請與審核' : '申請與查看調班記錄'}
              </p>
            </div>
          </div>
        </div>
        {/* 統計卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center">
              <div className="flex-none">
                <div className="flex items-center justify-center w-8 h-8 bg-blue-100 rounded-md">
                  <CalendarDays className="w-5 h-5 text-blue-600" />
                </div>
              </div>
              <div className="ml-4">
                <div className="text-sm font-medium text-gray-500">總申請數</div>
                <div className="text-2xl font-bold text-gray-900">{shiftExchanges.length}</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center">
              <div className="flex-none">
                <div className="flex items-center justify-center w-8 h-8 bg-yellow-100 rounded-md">
                  <Clock className="w-5 h-5 text-yellow-600" />
                </div>
              </div>
              <div className="ml-4">
                <div className="text-sm font-medium text-gray-500">待審核</div>
                <div className="text-2xl font-bold text-gray-900">
                  {shiftExchanges.filter(req => req.status === 'PENDING').length}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center">
              <div className="flex-none">
                <div className="flex items-center justify-center w-8 h-8 bg-green-100 rounded-md">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                </div>
              </div>
              <div className="ml-4">
                <div className="text-sm font-medium text-gray-500">已批准</div>
                <div className="text-2xl font-bold text-gray-900">
                  {shiftExchanges.filter(req => req.status === 'APPROVED').length}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <div className="flex items-center">
              <div className="flex-none">
                <div className="flex items-center justify-center w-8 h-8 bg-red-100 rounded-md">
                  <XCircle className="w-5 h-5 text-red-600" />
                </div>
              </div>
              <div className="ml-4">
                <div className="text-sm font-medium text-gray-500">已拒絕</div>
                <div className="text-2xl font-bold text-gray-900">
                  {shiftExchanges.filter(req => req.status === 'REJECTED').length}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 篩選器和操作欄 */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex items-center space-x-2">
                <Filter className="w-5 h-5 text-gray-400" />
                <select
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                >
                  <option value="">所有狀態</option>
                  <option value="PENDING">待審核</option>
                  <option value="APPROVED">已批准</option>
                  <option value="REJECTED">已拒絕</option>
                </select>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                  placeholder="開始日期"
                />
                <span className="text-gray-500">至</span>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                  placeholder="結束日期"
                />
              </div>

              <div className="flex items-center space-x-2">
                <Search className="w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                  placeholder="搜尋申請者、原因..."
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                />
              </div>
            </div>

            <button
              onClick={() => setShowNewRequestForm(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center space-x-2"
            >
              <Plus className="w-4 h-4" />
              <span>申請調班</span>
            </button>
          </div>
        </div>

        {/* 排序和批量操作欄 */}
        {canManage && (
          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 mb-6 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              {/* 全選待審核 */}
              {filteredRequests.filter(r => r.status === 'PENDING').length > 0 && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={
                      filteredRequests.filter(r => r.status === 'PENDING').length > 0 &&
                      filteredRequests.filter(r => r.status === 'PENDING').every(r => selectedIds.has(r.id))
                    }
                    onChange={toggleSelectAllPending}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">全選待審核</span>
                </label>
              )}
              
              {/* 排序選項 */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">排序：</span>
                <button
                  onClick={() => handleSort('shiftDate')}
                  className={`px-3 py-1.5 text-sm rounded ${sortConfig.field === 'shiftDate' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  日期 {sortConfig.field === 'shiftDate' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
                </button>
                <button
                  onClick={() => handleSort('status')}
                  className={`px-3 py-1.5 text-sm rounded ${sortConfig.field === 'status' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  狀態 {sortConfig.field === 'status' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
                </button>
                <button
                  onClick={() => handleSort('requester')}
                  className={`px-3 py-1.5 text-sm rounded ${sortConfig.field === 'requester' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  申請者 {sortConfig.field === 'requester' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
                </button>
              </div>
            </div>

            {/* 批量操作按鈕 */}
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">已選 {selectedIds.size} 項：</span>
                <button
                  onClick={handleBatchApprove}
                  className="px-3 py-1.5 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
                >
                  批量批准
                </button>
                <button
                  onClick={handleBatchReject}
                  className="px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                >
                  批量拒絕
                </button>
              </div>
            )}
          </div>
        )}

        {/* 申請列表 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {canManage && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                      選擇
                    </th>
                  )}
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    申請者
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    調班日期
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    原班別
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    新班別
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    申請原因
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    狀態
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    審核資訊
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortedRequests.map((request) => {
                  // local defensive type to avoid `any`
                  type ReqAny = {
                    id: number;
                    requester?: { id?: number; name?: string; employeeId?: string } | null;
                    requesterId?: number;
                    targetEmployeeId?: number;
                    targetEmployee?: { id?: number; name?: string; employeeId?: string } | null;
                    shiftDate?: string;
                    originalWorkDate?: string;
                    targetWorkDate?: string;
                    originalShiftType?: string;
                    newShiftType?: string;
                    leaveType?: string;
                    reason?: string;
                    status?: 'PENDING' | 'APPROVED' | 'REJECTED';
                    approver?: { id?: number; name?: string } | null;
                    approvedAt?: string | null;
                    approvedBy?: number | null;
                    createdAt?: string;
                    updatedAt?: string;
                    [key: string]: unknown;
                  };

                  const r = request as unknown as ReqAny;
                  const StatusIcon = STATUS_ICONS[(r.status || 'PENDING') as keyof typeof STATUS_ICONS];
                  const requesterId = r.requester?.id ?? r.requesterId;
                  const isOwner = !!user?.employee?.id && requesterId === user.employee.id;

                  const requesterName = r.requester?.name ?? '已刪除';
                  const requesterEmployeeId = r.requester?.employeeId ?? String(r.requesterId ?? '');

                  const shiftDateStr = r.shiftDate ?? r.originalWorkDate ?? r.targetWorkDate ?? '';
                  const shiftDateDisplay = shiftDateStr ? new Date(shiftDateStr).toLocaleDateString('zh-TW') : '';
                  
                  // ensure unique and stable key for each row
                  const rowKey = (typeof r.id !== 'undefined' && r.id !== null) ? String(r.id) : `${r.requesterId || ''}-${r.targetEmployeeId || ''}-${r.originalWorkDate || r.shiftDate || r.targetWorkDate || ''}-${r.createdAt || ''}`;

                  return (
                    <tr key={rowKey} className={`hover:bg-gray-50 ${selectedIds.has(r.id) ? 'bg-blue-50' : ''}`}>
                       {/* 勾選框 */}
                       {canManage && (
                         <td className="px-4 py-4 whitespace-nowrap">
                           {r.status === 'PENDING' && (
                             <input
                               type="checkbox"
                               checked={selectedIds.has(r.id)}
                               onChange={() => toggleSelectRequest(r.id)}
                               className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                             />
                           )}
                         </td>
                       )}
                       <td className="px-6 py-4 whitespace-nowrap">
                         <div className="flex items-center">
                           <div className="flex-none">
                             <div className="flex items-center justify-center w-8 h-8 bg-gray-100 rounded-full">
                               <User className="w-4 h-4 text-gray-600" />
                             </div>
                           </div>
                           <div className="ml-3">
                             <div className="text-sm font-medium text-gray-900">
                               {requesterName}
                             </div>
                             <div className="text-sm text-gray-500">
                               {requesterEmployeeId}
                             </div>
                           </div>
                         </div>
                       </td>
                       <td className="px-6 py-4 whitespace-nowrap">
                         <div className="text-sm text-gray-900">
                           {shiftDateDisplay}
                         </div>
                       </td>
                       <td className="px-6 py-4 whitespace-nowrap">
                         <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                           {SHIFT_TYPE_LABELS[(r.originalShiftType || 'A') as keyof typeof SHIFT_TYPE_LABELS]}
                         </span>
                       </td>
                       <td className="px-6 py-4 whitespace-nowrap">
                         <div className="flex flex-col">
                           <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full inline-block w-fit">
                             {SHIFT_TYPE_LABELS[(r.newShiftType || 'A') as keyof typeof SHIFT_TYPE_LABELS]}
                           </span>
                           {r.newShiftType === 'FDL' && r.leaveType && (
                             <span className="mt-1 text-xs text-yellow-700">
                               {(LEAVE_TYPES as Record<string, string>)[r.leaveType] || r.leaveType}
                             </span>
                           )}
                         </div>
                       </td>
                       <td className="px-6 py-4">
                         <div className="text-sm text-gray-900 max-w-xs truncate" title={r.reason}>
                           {r.reason}
                         </div>
                       </td>
                       <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <StatusIcon className="w-4 h-4 mr-2" />
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[(r.status || 'PENDING') as keyof typeof STATUS_COLORS]}`}>
                            {STATUS_LABELS[(r.status || 'PENDING') as keyof typeof STATUS_LABELS]}
                          </span>
                        </div>
                       </td>
                       <td className="px-6 py-4 whitespace-nowrap">
                        {r.status !== 'PENDING' && r.approver && (
                          <div className="text-sm text-gray-900">
                            <div className="font-medium">{r.approver.name}</div>
                            <div className="text-xs text-gray-500">
                              {(r.approver as Employee)?.employeeId || 'N/A'} • {(r.approver as Employee)?.position || 'N/A'}
                            </div>
                            <div className="text-xs text-gray-500">{r.approvedAt ? new Date(r.approvedAt).toLocaleString() : ''}</div>
                          </div>
                        )}
                       </td>
                       <td className="px-6 py-4 whitespace-nowrap">
                        {/* 管理員操作：審核 */}
                        {canManage && r.status === 'PENDING' && (
                          <div className="flex space-x-2">
                            <button
                              onClick={() => handleApprove(r.id)}
                              className="px-3 py-1 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 transition-colors"
                            >批准</button>
                            <button
                              onClick={() => showRejectDialog(request)}
                              className="px-3 py-1 bg-red-600 text-white text-sm rounded-md hover:bg-red-700 transition-colors"
                            >拒絕</button>
                          </div>
                        )}
                        {/* 管理員作廢 */}
                        {canManage && r.status === 'APPROVED' && (
                          <button
                            onClick={() => {
                              const reason = prompt('請輸入作廢原因：');
                              if (reason && reason.trim()) {
                                handleVoidRequest(r.id, reason.trim());
                              }
                            }}
                            className="px-3 py-1 bg-red-600 text-white text-sm rounded-md hover:bg-red-700 transition-colors"
                          >作廢</button>
                        )}
                        {/* 員工操作：編輯/刪除（僅自己且 PENDING），否則僅可檢視 */}
                        {!canManage && (
                          isOwner ? (
                            r.status === 'PENDING' ? (
                              <div className="flex items-center gap-3">
                                <button
                                  onClick={() => openEdit(r as unknown as ShiftExchangeRequest)}
                                  className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800"
                                >
                                  <Pencil className="w-4 h-4" /> 編輯
                                </button>
                                <button
                                  onClick={() => showDeleteConfirm(request)}
                                  className="inline-flex items-center gap-1 text-red-600 hover:text-red-800"
                                >
                                  <Trash2 className="w-4 h-4" /> 刪除
                                </button>
                              </div>
                            ) : r.status === 'APPROVED' ? (
                              <button
                                onClick={() => {
                                  const reason = prompt('請輸入撤銷原因：');
                                  if (reason && reason.trim()) {
                                    handleCancelRequest(r.id, reason.trim());
                                  }
                                }}
                                className="inline-flex items-center gap-1 px-3 py-1 bg-orange-100 text-orange-800 rounded-full hover:bg-orange-200 transition-colors"
                              >
                                <X className="w-4 h-4" /> 申請撤銷
                              </button>
                            ) : (
                              <span className="text-gray-400">僅可檢視</span>
                            )
                          ) : null
                        )}
                       </td>
                     </tr>
                  );
                })}
              </tbody>
            </table>
            
            {filteredRequests.length === 0 && (
              <div className="text-center py-12">
                <CalendarDays className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">沒有調班申請</h3>
                <p className="mt-1 text-sm text-gray-500">
                  還沒有符合條件的調班申請記錄
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 新申請表單模態框 */}
      {showNewRequestForm && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-full max-w-2xl bg-white rounded-lg shadow-lg">
            <div className="flex items-center justify-between border-b border-gray-200 pb-4 mb-6">
              <h3 className="text-lg font-medium text-gray-900">申請調班</h3>
              <button
                onClick={() => setShowNewRequestForm(false)}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSubmitRequest} className="space-y-4">
              {/* 員工權限移除調班對象欄位 - 只有管理員可以看到 */}
              {canManage && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">調班對象</label>
                  <select
                    value={newRequest.targetEmployeeId}
                    onChange={(e) => {
                      const v = e.target.value;
                      setNewRequest({ ...newRequest, targetEmployeeId: v });
                      setIsSwapMode(!!v);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    required={false}
                  >
                    <option value="">請選擇調班對象（不選為自調）</option>
                    {employees
                      .filter(emp => emp.id !== user?.employee?.id)
                      .map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.employeeId} - {employee.name} ({employee.department})
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">調班日期</label>
                  <input
                    type="date"
                    value={newRequest.shiftDate}
                    onChange={(e) => handleShiftDateChange(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">原班別</label>
                    <input
                      type="text"
                      value={SHIFT_TYPE_LABELS[newRequest.originalShiftType as keyof typeof SHIFT_TYPE_LABELS] || ''}
                      readOnly
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-600"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">新班別</label>
                    <select
                      value={newRequest.newShiftType}
                      onChange={(e) => {
                        const value = e.target.value;
                        setNewRequest({ 
                          ...newRequest, 
                          newShiftType: value,
                          leaveType: value === 'FDL' ? newRequest.leaveType : '' // 非FDL時清空leaveType
                        });
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                      required
                    >
                      {Object.entries(SHIFT_TYPE_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 請假類型 - 當選擇FDL時顯示 */}
                {newRequest.newShiftType === 'FDL' && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <label className="block text-sm font-medium text-yellow-800 mb-2">
                      請假類型 <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={newRequest.leaveType}
                      onChange={(e) => setNewRequest({ ...newRequest, leaveType: e.target.value })}
                      className="w-full px-3 py-2 border border-yellow-300 rounded-md focus:outline-none focus:ring-2 focus:ring-yellow-500 text-black bg-white"
                      required
                    >
                      <option value="">請選擇請假類型</option>
                      {Object.entries(LEAVE_TYPES).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                    <p className="text-xs text-yellow-700 mt-2">
                      調班為全日請假時，請選擇對應的請假類型以便正確計算薪資
                    </p>
                  </div>
                )}
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

              {/* 詳細說明欄位 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  詳細說明
                  {newRequest.reason === '其它' && <span className="text-red-500 ml-1">*</span>}
                </label>
                <textarea
                  value={newRequest.reasonDetail}
                  onChange={(e) => setNewRequest({ ...newRequest, reasonDetail: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                  placeholder={newRequest.reason === '其它' ? '請填寫詳細說明（必填）' : '可填寫更詳細的說明（選填）'}
                  required={newRequest.reason === '其它'}
                />
                {newRequest.reason === '其它' && (
                  <p className="text-sm text-red-600 mt-1">選擇「其它」時，詳細說明為必填欄位</p>
                )}
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-900 mb-2">調班說明</h4>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>• 調班申請需要管理員或HR審核批准</li>
                  <li>• 請確保原班別和新班別安排合理</li>
                  <li>• 調班後將自動更新班表</li>
                  <li>• 建議提前申請，避免影響工作安排</li>
                </ul>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium"
                >
                  提交申請
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewRequestForm(false)}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors font-medium"
                >
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 編輯申請表單模態框 */}
      {showEditModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-full max-w-2xl bg-white rounded-lg shadow-lg">
            <div className="flex items-center justify-between border-b border-gray-200 pb-4 mb-6">
              <h3 className="text-lg font-medium text-gray-900">編輯調班申請</h3>
              <button onClick={() => setShowEditModal(false)} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSubmitEdit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">調班日期</label>
                  <input
                    type="date"
                    value={editForm.shiftDate}
                    onChange={(e) => setEditForm({ ...editForm, shiftDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">原班別</label>
                    <input
                      type="text"
                      value={SHIFT_TYPE_LABELS[editForm.originalShiftType as keyof typeof SHIFT_TYPE_LABELS] || ''}
                      readOnly
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-600"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">新班別</label>
                    <select
                      value={editForm.newShiftType}
                      onChange={(e) => setEditForm({ ...editForm, newShiftType: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                      required
                    >
                      {Object.entries(SHIFT_TYPE_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </div>
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

              {/* 詳細說明欄位 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  詳細說明
                  {editForm.reason === '其它' && <span className="text-red-500 ml-1">*</span>}
                </label>
                <textarea
                  value={editForm.reasonDetail}
                  onChange={(e) => setEditForm({ ...editForm, reasonDetail: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                  placeholder={editForm.reason === '其它' ? '請填寫詳細說明（必填）' : '可填寫更詳細的說明（選填）'}
                  required={editForm.reason === '其它'}
                />
                {editForm.reason === '其它' && (
                  <p className="text-sm text-red-600 mt-1">選擇「其它」時，詳細說明為必填欄位</p>
                )}
              </div>

              <div className="flex gap-3 pt-4">
                <button type="submit" className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium">
                  儲存變更
                </button>
                <button type="button" onClick={() => setShowEditModal(false)} className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors font-medium">
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast 訊息 */}
      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 ${
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          {toast.message}
        </div>
      )}

      {/* 刪除確認對話框 */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center text-red-600 mb-4">
              <AlertCircle className="w-8 h-8 mr-3" />
              <h3 className="text-xl font-semibold">確認刪除</h3>
            </div>
            <p className="text-gray-600 mb-6">
              確定要刪除 {deleteConfirm.requesterName} 的調班申請嗎？此操作無法復原。
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                確認刪除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 拒絕原因對話框 */}
      {rejectDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center text-red-600 mb-4">
              <XCircle className="w-8 h-8 mr-3" />
              <h3 className="text-xl font-semibold">拒絕申請</h3>
            </div>
            <p className="text-gray-600 mb-4">
              您將拒絕 {rejectDialog.requesterName} 的調班申請。
            </p>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">拒絕原因（選填）</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 text-black"
                rows={3}
                placeholder="請輸入拒絕原因..."
              />
            </div>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => { setRejectDialog(null); setRejectReason(''); }}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleReject}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                確認拒絕
              </button>
            </div>
          </div>
        </div>
      )}
    </AuthenticatedLayout>
  );
}
