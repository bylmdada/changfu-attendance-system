'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, Plus, Search, CheckCircle, XCircle, AlertCircle, Pencil, Trash2, X, ChevronDown, ChevronUp, Eye } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import BatchApproveBar from '@/components/BatchApproveBar';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import ApprovalProgress, { ApprovalReviewRecord } from '@/components/ApprovalProgress';
import { getLeaveTypeLabel, normalizeLeaveTypeCode } from '@/lib/leave-types';

interface Employee {
  id: number;
  employeeId: string;
  name: string;
  department: string;
  position: string;
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

interface LeaveRequest {
  id: number;
  employeeId: number;
  leaveType: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string | null;
  status: string;
  approvedBy: number | null;
  approvedAt: string | null;
  createdAt: string;
  employee: Employee;
  approver?: {
    id: number;
    employeeId: string;
    name: string;
    department: string;
    position: string;
  } | null;
}

const LEAVE_TYPES = {
  BEREAVEMENT: '喪假',
  PRENATAL_CHECKUP: '產檢假',
  ANNUAL: '特休假',
  COMPENSATORY: '補休',
  SICK: '病假',
  PERSONAL: '事假',
  MARRIAGE: '婚假',
  UNPAID_LEAVE: '留職停薪',
  OCCUPATIONAL_INJURY: '公傷假',
  MATERNITY: '產假',
  BREASTFEEDING: '哺乳假',
  PATERNITY_CHECKUP: '陪產檢及陪產假',
  MISCARRIAGE: '流產假',
  OFFICIAL: '公假',
  MILITARY_SERVICE: '公假(教召)'
};

// 勞基法規範說明
const LABOR_LAW_REGULATIONS = {
  BEREAVEMENT: {
    description: '勞工之祖父母、父母、配偶死亡者',
    days: '8日',
    salary: '有薪',
    requirements: '需檢附相關證明文件'
  },
  PRENATAL_CHECKUP: {
    description: '懷孕期間產檢假',
    days: '5日',
    salary: '有薪',
    requirements: '需檢附產檢證明'
  },
  ANNUAL: {
    description: '特別休假',
    days: '依年資而定',
    salary: '有薪',
    requirements: '依公司規定'
  },
  COMPENSATORY: {
    description: '補休假',
    days: '依加班時數而定',
    salary: '無薪（以加班時數抵扣）',
    requirements: '依公司規定'
  },
  SICK: {
    description: '普通傷病假',
    days: '1年內30日',
    salary: '前30日減半給薪',
    requirements: '需檢附醫生證明'
  },
  PERSONAL: {
    description: '事假',
    days: '無限制',
    salary: '無薪',
    requirements: '依公司規定'
  },
  MARRIAGE: {
    description: '結婚假',
    days: '8日',
    salary: '有薪',
    requirements: '需檢附結婚證書'
  },
  UNPAID_LEAVE: {
    description: '留職停薪',
    days: '依申請而定',
    salary: '無薪',
    requirements: '需主管核准'
  },
  OCCUPATIONAL_INJURY: {
    description: '職業災害醫療期間',
    days: '依醫師診斷而定',
    salary: '有薪',
    requirements: '需檢附職災證明'
  },
  MATERNITY: {
    description: '分娩前後',
    days: '8星期',
    salary: '有薪',
    requirements: '需檢附醫生證明'
  },
  BREASTFEEDING: {
    description: '哺乳時間',
    days: '每日2次各30分鐘',
    salary: '有薪',
    requirements: '需檢附相關證明'
  },
  PATERNITY_CHECKUP: {
    description: '陪產檢及陪產假',
    days: '陪產檢7日、陪產假7日',
    salary: '有薪',
    requirements: '需檢附相關證明'
  },
  MISCARRIAGE: {
    description: '流產假',
    days: '依懷孕週數而定',
    salary: '有薪',
    requirements: '需檢附醫生證明'
  },
  OFFICIAL: {
    description: '公假',
    days: '依事由而定',
    salary: '有薪',
    requirements: '需檢附相關證明'
  },
  MILITARY_SERVICE: {
    description: '教育召集',
    days: '依召集令而定',
    salary: '有薪',
    requirements: '需檢附召集令'
  }
};

const STATUS_COLORS = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  PENDING_ADMIN: 'bg-blue-100 text-blue-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  CANCELLED: 'bg-gray-100 text-gray-700',
  VOIDED: 'bg-gray-100 text-gray-700'
};

const STATUS_ICONS = {
  PENDING: AlertCircle,
  PENDING_ADMIN: AlertCircle,
  APPROVED: CheckCircle,
  REJECTED: XCircle,
  CANCELLED: XCircle,
  VOIDED: XCircle
};

function getStatusLabel(status: string) {
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

function isReviewableStatus(status: string) {
  return status === 'PENDING' || status === 'PENDING_ADMIN';
}

export default function LeaveManagementPage() {
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [filteredRequests, setFilteredRequests] = useState<LeaveRequest[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showNewRequestForm, setShowNewRequestForm] = useState(false);
  
  // 部門列表
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  
  // Toast 狀態
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // 確認框狀態
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name: string } | null>(null);
  
  // 排序狀態
  const [sortConfig, setSortConfig] = useState<{ field: 'employee' | 'date' | 'status' | 'type'; direction: 'asc' | 'desc' }>({ field: 'date', direction: 'desc' });
  
  // 分頁狀態
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;
  
  // 展開審核進度的列 ID
  const [expandedId, setExpandedId] = useState<number | null>(null);
  
  // 審核歷程資料
  const [approvalData, setApprovalData] = useState<{
    currentLevel: number;
    maxLevel: number;
    status: string;
    reviews: ApprovalReviewRecord[];
    labels?: Record<number, { name: string; role: string }>;
  } | null>(null);
  
  const [filters, setFilters] = useState({
    status: '',
    leaveType: '',
    startDate: '',
    endDate: '',
    search: '',
    department: '' // 新增部門篩選
  });

  // Toast 顯示函數
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  // 排序函數
  const handleSort = (field: 'employee' | 'date' | 'status' | 'type') => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  // 匯出 CSV
  const exportToCSV = () => {
    const headers = ['員工編號', '姓名', '部門', '請假類型', '開始日期', '結束日期', '天數', '狀態', '申請原因'];
    const csvData = [
      headers.join(','),
      ...sortedRequests.map(r => [
        r.employee.employeeId,
        r.employee.name,
        r.employee.department,
        getLeaveTypeLabel(r.leaveType),
        r.startDate.substring(0, 10),
        r.endDate.substring(0, 10),
        r.totalDays,
        getStatusLabel(r.status),
        r.reason || ''
      ].join(','))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvData], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `請假記錄_${new Date().toISOString().substring(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('success', 'CSV 匯出成功');
  };

  // 匯出 Excel
  const exportToExcel = () => {
    const headers = ['員工編號', '姓名', '部門', '請假類型', '開始日期', '結束日期', '天數', '狀態', '申請原因'];
    const excelData = [
      headers.join('\t'),
      ...sortedRequests.map(r => [
        r.employee.employeeId,
        r.employee.name,
        r.employee.department,
        getLeaveTypeLabel(r.leaveType),
        r.startDate.substring(0, 10),
        r.endDate.substring(0, 10),
        r.totalDays,
        getStatusLabel(r.status),
        r.reason || ''
      ].join('\t'))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + excelData], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `請假記錄_${new Date().toISOString().substring(0, 10)}.xls`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('success', 'Excel 匯出成功');
  };

  // 申請原因選項
  const leaveReasonOptions = [
    { value: '休假', label: '休假' },
    { value: '公假/公出', label: '公假/公出' },
    { value: '家有急事', label: '家有急事' },
    { value: '身體不適', label: '身體不適' },
    { value: '有事待辦', label: '有事待辦' },
    { value: '小孩生病', label: '小孩生病' },
    { value: '配合人力運作', label: '配合人力運作' },
    { value: '交通工具拋錨', label: '交通工具拋錨' },
    { value: '生病', label: '生病' },
    { value: '出國', label: '出國' }
  ];

  // 新申請表單狀態
  const [newRequest, setNewRequest] = useState({
    leaveType: '',
    startDate: '',
    endDate: '',
    startHour: '',
    startMinute: '',
    endHour: '',
    endMinute: '',
    leaveReason: '', // 申請原因選單
    reason: '', // 請假說明
    attachments: [] as File[] // 附件檔案
  });  // 編輯請假申請表單
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingRequest, setEditingRequest] = useState<LeaveRequest | null>(null);
  const [editForm, setEditForm] = useState({
    leaveType: '',
    startDate: '',
    endDate: '',
    startHour: '',
    startMinute: '',
    endHour: '',
    endMinute: '',
    leaveReason: '', // 申請原因選單
    reason: '' // 請假說明
  });

  // 添加状态來存储排班信息
  const [scheduleInfo, setScheduleInfo] = useState<{[key: string]: string}>({});

  // 獲取指定日期的班次資訊
  const fetchScheduleForDate = async (date: string) => {
    if (!user?.employee?.id || !date) return;
    
    try {
      const response = await fetch(`/api/schedules?employeeId=${user.employee.id}&date=${date}`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.schedules && data.schedules.length > 0) {
          const schedule = data.schedules[0];
          const shiftInfo = `${schedule.shiftType}班(${schedule.startTime}-${schedule.endTime})`;
          setScheduleInfo(prev => ({ ...prev, [date]: shiftInfo }));
        } else {
          setScheduleInfo(prev => ({ ...prev, [date]: '無排班' }));
        }
      }
    } catch (error) {
      console.error('獲取班別資訊失敗:', error);
      setScheduleInfo(prev => ({ ...prev, [date]: '獲取失敗' }));
    }
  };

  // 當選擇開始日期時，獲取班次資訊
  const handleStartDateChange = (date: string) => {
    setNewRequest({ ...newRequest, startDate: date });
    if (date) {
      fetchScheduleForDate(date);
    }
  };

  // 當選擇結束日期時，獲取班次資訊
  const handleEndDateChange = (date: string) => {
    setNewRequest({ ...newRequest, endDate: date });
    if (date) {
      fetchScheduleForDate(date);
    }
  };

  // 計算請假時數
  const calculateLeaveHours = () => {
    if (!newRequest.startDate || !newRequest.endDate || !newRequest.startHour || !newRequest.startMinute || !newRequest.endHour || !newRequest.endMinute) {
      return 0;
    }

    const startTime = `${newRequest.startHour.padStart(2, '0')}:${newRequest.startMinute.padStart(2, '0')}`;
    const endTime = `${newRequest.endHour.padStart(2, '0')}:${newRequest.endMinute.padStart(2, '0')}`;
    
    const startDateTime = new Date(`${newRequest.startDate}T${startTime}`);
    const endDateTime = new Date(`${newRequest.endDate}T${endTime}`);
    
    if (endDateTime <= startDateTime) {
      return 0;
    }

    const diffInMs = endDateTime.getTime() - startDateTime.getTime();
    const diffInMin = diffInMs / (1000 * 60);

    // 不做四捨五入，直接轉小時；提交時會強制 30 分鐘倍數
    return diffInMin / 60;
  };

  const filterRequests = useCallback(() => {
    let filtered = leaveRequests;

    if (filters.status) {
      filtered = filtered.filter(req => req.status === filters.status);
    }

    if (filters.leaveType) {
      filtered = filtered.filter(req => normalizeLeaveTypeCode(req.leaveType) === filters.leaveType);
    }

    // 部門篩選
    if (filters.department) {
      filtered = filtered.filter(req => req.employee.department === filters.department);
    }

    if (filters.startDate) {
      filtered = filtered.filter(req => req.startDate >= filters.startDate);
    }

    if (filters.endDate) {
      filtered = filtered.filter(req => req.endDate <= filters.endDate);
    }

    if (filters.search) {
      filtered = filtered.filter(req => 
        req.employee.name.toLowerCase().includes(filters.search.toLowerCase()) ||
        req.employee.employeeId.toLowerCase().includes(filters.search.toLowerCase())
      );
    }

    setFilteredRequests(filtered);
  }, [leaveRequests, filters.status, filters.leaveType, filters.department, filters.startDate, filters.endDate, filters.search]);

  // 部門名稱列表
  const departmentNames = departments.map(d => d.name);

  // 排序後的記錄
  const sortedRequests = [...filteredRequests].sort((a, b) => {
    const direction = sortConfig.direction === 'asc' ? 1 : -1;
    switch (sortConfig.field) {
      case 'employee':
        return a.employee.name.localeCompare(b.employee.name) * direction;
      case 'date':
        return (new Date(a.startDate).getTime() - new Date(b.startDate).getTime()) * direction;
      case 'status': {
        const statusOrder = { PENDING: 0, APPROVED: 1, REJECTED: 2 };
        return ((statusOrder[a.status as keyof typeof statusOrder] || 0) - (statusOrder[b.status as keyof typeof statusOrder] || 0)) * direction;
      }
      case 'type':
        return getLeaveTypeLabel(a.leaveType).localeCompare(getLeaveTypeLabel(b.leaveType)) * direction;
      default:
        return 0;
    }
  });

  // 分頁計算
  const totalPages = Math.ceil(sortedRequests.length / itemsPerPage);
  const paginatedRequests = sortedRequests.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  useEffect(() => {
    // 設定頁面標題
    document.title = '請假管理 - 長福會考勤系統';
    
    const initializeData = async () => {
      try {
        // 檢查用戶登入狀態
        const authResponse = await fetch('/api/auth/me', {
          credentials: 'include'
        });
        
        if (authResponse.ok) {
          const userData = await authResponse.json();
          setUser(userData.user);
        }

        // 獲取部門列表
        try {
          const deptResponse = await fetch('/api/departments', { credentials: 'include' });
          if (deptResponse.ok) {
            const deptData = await deptResponse.json();
            setDepartments(deptData.departments || []);
          }
        } catch (deptError) {
          console.error('獲取部門列表失敗:', deptError);
        }

        // 載入請假記錄
        await fetchLeaveRequests();
      } catch (error) {
        console.error('載入用戶信息失敗:', error);
      }
    };

    initializeData();
  }, []);

  useEffect(() => {
    filterRequests();
  }, [filterRequests]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters.status, filters.leaveType, filters.department, filters.startDate, filters.endDate, filters.search]);

  useEffect(() => {
    setCurrentPage((prev) => Math.min(prev, Math.max(totalPages, 1)));
  }, [totalPages]);

  const fetchLeaveRequests = async () => {
    try {
      const response = await fetch('/api/leave-requests', {
        credentials: 'include' // 自動包含 cookies
      });

      if (response.ok) {
        const data = await response.json();
        setLeaveRequests(data.leaveRequests);
      }
    } catch (error) {
      console.error('獲取請假記錄失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();

    // 強制驗證：分鐘 0..59；總時數 > 0 且以 0.5 小時為增量
    const sm = Number(newRequest.startMinute);
    const em = Number(newRequest.endMinute);
    const sh = Number(newRequest.startHour);
    const eh = Number(newRequest.endHour);

    if ([sm, em, sh, eh].some(n => Number.isNaN(n))) {
      showToast('error', '請輸入有效的起訖時間');
      return;
    }
    if (sm < 0 || sm > 59 || em < 0 || em > 59) {
      showToast('error', '分鐘僅允許 0 ~ 59');
      return;
    }

    const start = new Date(`${newRequest.startDate}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00`);
    const end = new Date(`${newRequest.endDate}T${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}:00`);
    const diffMin = Math.round((end.getTime() - start.getTime()) / 60000);

    if (diffMin <= 0) {
      showToast('error', '請假時數必須為正數');
      return;
    }
    if (diffMin % 30 !== 0) {
      showToast('error', '請假時數需以 0.5 小時為增量');
      return;
    }

    try {
      // 合併申請原因和請假說明
      const combinedReason = newRequest.leaveReason && newRequest.reason 
        ? `${newRequest.leaveReason}：${newRequest.reason}`
        : newRequest.leaveReason || newRequest.reason || '';

      const response = await fetchJSONWithCSRF('/api/leave-requests', {
        method: 'POST',
        body: {
          ...newRequest,
          reason: combinedReason
        }
      });

      if (response.ok) {
        const data = await response.json();
        showToast('success', data.message);
        setShowNewRequestForm(false);
        resetForm();
        fetchLeaveRequests();
      } else {
        const error = await response.json();
        showToast('error', error.error);
      }
    } catch {
      console.error('用戶驗證失敗');
    }
  };

  const handleApproveReject = async (id: number, status: 'APPROVED' | 'REJECTED') => {
    if (!user) {
      showToast('error', '尚未取得使用者資訊');
      return;
    }

    try {
      const canSubmitManagerOpinion = user.role === 'MANAGER'
        || user.isDepartmentManager
        || user.isDeputyManager
        || Boolean(user.attendancePermissions?.leaveRequests?.length);

      const response = await fetchJSONWithCSRF(`/api/leave-requests/${id}`, {
        method: 'PATCH',
        body: canSubmitManagerOpinion
          ? { opinion: status === 'APPROVED' ? 'AGREE' : 'DISAGREE' }
          : { status }
      });

      if (response.ok) {
        const data = await response.json();
        showToast('success', data.message);
        fetchLeaveRequests();
      } else {
        const error = await response.json();
        showToast('error', error.error);
      }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_error) {
      showToast('error', '操作失敗，請稍後再試');
    }
  };

  // 顯示刪除確認框
  const showDeleteConfirm = (request: LeaveRequest) => {
    setDeleteConfirm({ id: request.id, name: request.employee.name });
  };

  // 確認刪除
  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    try {
      const res = await fetchJSONWithCSRF(`/api/leave-requests/${deleteConfirm.id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!res.ok) {
        showToast('error', data.error || '刪除失敗');
      } else {
        showToast('success', data.message || '已刪除');
        fetchLeaveRequests();
      }
    } catch {
      showToast('error', '刪除失敗，請稍後再試');
    }
    setDeleteConfirm(null);
  };

  const openEditModal = (r: LeaveRequest) => {
    setEditingRequest(r);
    const s = new Date(r.startDate);
    const e = new Date(r.endDate);
    
    // 解析原因和說明
    let leaveReason = '';
    let reason = r.reason || '';
    
    // 如果原因包含在選項中，則分離申請原因和說明
    for (const option of leaveReasonOptions) {
      if (reason.startsWith(option.value + '：')) {
        leaveReason = option.value;
        reason = reason.substring(option.value.length + 1);
        break;
      } else if (reason === option.value) {
        leaveReason = option.value;
        reason = '';
        break;
      }
    }
    
    setEditForm({
      leaveType: normalizeLeaveTypeCode(r.leaveType),
      startDate: r.startDate.substring(0, 10),
      endDate: r.endDate.substring(0, 10),
      startHour: String(s.getHours()).padStart(2, '0'),
      startMinute: String(s.getMinutes()).padStart(2, '0'),
      endHour: String(e.getHours()).padStart(2, '0'),
      endMinute: String(e.getMinutes()).padStart(2, '0'),
      leaveReason: leaveReason,
      reason: reason
    });
    setShowEditModal(true);
  };

  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRequest) return;

    // 與新增一致的驗證（分鐘 0..59，30 分增量）
    const sm = Number(editForm.startMinute);
    const em = Number(editForm.endMinute);
    const sh = Number(editForm.startHour);
    const eh = Number(editForm.endHour);

    if ([sm, em, sh, eh].some(n => Number.isNaN(n))) {
      showToast('error', '請輸入有效的起訖時間');
      return;
    }
    if (sm < 0 || sm > 59 || em < 0 || em > 59) {
      showToast('error', '分鐘僅允許 0 ~ 59');
      return;
    }
    const start = new Date(`${editForm.startDate}T${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00`);
    const end = new Date(`${editForm.endDate}T${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}:00`);
    const diffMin = Math.round((end.getTime() - start.getTime()) / 60000);
    if (diffMin <= 0) {
      showToast('error', '請假時數必須為正數');
      return;
    }
    if (diffMin % 30 !== 0) {
      showToast('error', '請假時數需以 0.5 小時為增量');
      return;
    }

    try {
      // 合併申請原因和請假說明
      const combinedReason = editForm.leaveReason && editForm.reason 
        ? `${editForm.leaveReason}：${editForm.reason}`
        : editForm.leaveReason || editForm.reason || '';

      const res = await fetchJSONWithCSRF(`/api/leave-requests/${editingRequest.id}`, {
        method: 'PATCH',
        body: {
          leaveType: editForm.leaveType,
          startDate: editForm.startDate,
          endDate: editForm.endDate,
          startHour: editForm.startHour,
          startMinute: editForm.startMinute,
          endHour: editForm.endHour,
          endMinute: editForm.endMinute,
          reason: combinedReason
        }
      });
      const data = await res.json();
      if (!res.ok) {
        showToast('error', data.error || '更新失敗');
        return;
      }
      showToast('success', data.message || '更新成功');
      setShowEditModal(false);
      setEditingRequest(null);
      fetchLeaveRequests();
    } catch {
      showToast('error', '更新失敗，請稍後再試');
    }
  };

  // 員工申請撤銷
  const handleCancelRequest = async (id: number, reason: string) => {
    try {
      const res = await fetchJSONWithCSRF(`/api/leave-requests/${id}/cancel`, {
        method: 'POST',
        body: { reason }
      });
      const data = await res.json();
      if (!res.ok) {
        showToast('error', data.error || '撤銷申請失敗');
        return;
      }
      showToast('success', data.message || '撤銷申請已送出');
      fetchLeaveRequests();
    } catch {
      showToast('error', '撤銷申請失敗，請稍後再試');
    }
  };

  // 管理員作廢
  const handleVoidRequest = async (id: number, reason: string) => {
    try {
      const res = await fetchJSONWithCSRF(`/api/leave-requests/${id}/void`, {
        method: 'POST',
        body: { reason }
      });
      const data = await res.json();
      if (!res.ok) {
        showToast('error', data.error || '作廢失敗');
        return;
      }
      showToast('success', data.message || '已作廢');
      fetchLeaveRequests();
    } catch {
      showToast('error', '作廢失敗，請稍後再試');
    }
  };

  const resetForm = () => {
    setNewRequest({ leaveType: '', startDate: '', endDate: '', startHour: '', startMinute: '', endHour: '', endMinute: '', leaveReason: '', reason: '', attachments: [] });
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
        fetch(`/api/approval-reviews?requestType=LEAVE&requestId=${requestId}`, {
          credentials: 'include'
        }),
        fetch(`/api/approval-workflow-config?type=LEAVE`, {
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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('zh-TW');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const canFinalApprove = user?.role === 'ADMIN' || user?.role === 'HR';
  const canBatchApprove = canFinalApprove;
  const canManagerReview = user?.role === 'MANAGER'
    || user?.isDepartmentManager
    || user?.isDeputyManager
    || Boolean(user?.attendancePermissions?.leaveRequests?.length);
  const canPrivilegedEdit = user?.role === 'ADMIN' || user?.role === 'HR';
  const reviewableRequests = filteredRequests.filter((request) => isReviewableStatus(request.status));

  return (
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto p-6">
        {/* 頁面標題 */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Calendar className="h-8 w-8 text-blue-600" />
              <h1 className="text-3xl font-bold text-gray-900">請假管理</h1>
            </div>
            <button
              onClick={() => setShowNewRequestForm(true)}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-5 w-5" />
              申請請假
            </button>
          </div>
        </div>

          {/* 篩選區域 */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">搜尋</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="員工姓名/工號"
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                  className="pl-10 w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                />
              </div>
            </div>

            {/* 部門篩選 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">部門</label>
              <select
                value={filters.department}
                onChange={(e) => setFilters({ ...filters, department: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
              >
                <option value="">全部部門</option>
                {departmentNames.map((dept) => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">狀態</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
              >
                <option value="">全部狀態</option>
                <option value="PENDING">待審核</option>
                <option value="APPROVED">已批准</option>
                <option value="REJECTED">已拒絕</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">請假類型</label>
              <select
                value={filters.leaveType}
                onChange={(e) => setFilters({ ...filters, leaveType: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
              >
                <option value="">全部類型</option>
                {Object.entries(LEAVE_TYPES).map(([key, value]) => (
                  <option key={key} value={key}>{value}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">開始日期</label>
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">結束日期</label>
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
              />
            </div>
          </div>

          {/* 排序和匯出欄 */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-gray-200">
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
                onClick={() => handleSort('type')}
                className={`px-3 py-1.5 text-sm rounded ${sortConfig.field === 'type' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                類型 {sortConfig.field === 'type' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={exportToCSV}
                disabled={sortedRequests.length === 0}
                className="px-3 py-1.5 text-sm bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50"
              >
                匯出 CSV
              </button>
              <button
                onClick={exportToExcel}
                disabled={sortedRequests.length === 0}
                className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
              >
                匯出 Excel
              </button>
            </div>
          </div>
        </div>

        {/* 請假記錄列表 */}
        <div className="bg-white rounded-lg shadow-sm mb-20">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              請假記錄 ({filteredRequests.length})
            </h2>
            {canBatchApprove && reviewableRequests.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={selectedIds.length === reviewableRequests.length && selectedIds.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedIds(reviewableRequests.map((request) => request.id));
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
                  {canBatchApprove && (
                    <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                      選擇
                    </th>
                  )}
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    員工資訊
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    請假類型
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    請假期間
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    天數
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    狀態
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    申請時間
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    批准者
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {paginatedRequests.map((request) => {
                  const StatusIcon = STATUS_ICONS[request.status as keyof typeof STATUS_ICONS];
                  const isOwner = user?.employee?.id && request.employee.id === user.employee.id;
                  const canReviewThisRequest =
                    (canManagerReview && request.status === 'PENDING') ||
                    (canFinalApprove && isReviewableStatus(request.status));
                  return (
                    <React.Fragment key={request.id}>
                    <tr className={`hover:bg-gray-50 ${selectedIds.includes(request.id) ? 'bg-blue-50' : ''}`}>
                      {canBatchApprove && (
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
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {request.employee.name}
                          </div>
                          <div className="text-sm text-gray-500">
                            {request.employee.employeeId} • {request.employee.department}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-900">
                          {getLeaveTypeLabel(request.leaveType)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {formatDate(request.startDate)} - {formatDate(request.endDate)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-900">{request.totalDays} 天</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[request.status as keyof typeof STATUS_COLORS]}`}>
                          <StatusIcon className="h-3 w-3" />
                          {getStatusLabel(request.status)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(request.createdAt)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
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
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {canReviewThisRequest && (
                          <div className="flex flex-wrap gap-3 items-center">
                            <button
                              onClick={() => handleApproveReject(request.id, 'APPROVED')}
                              className="text-green-600 hover:text-green-800 font-medium"
                            >
                              批准
                            </button>
                            <button
                              onClick={() => handleApproveReject(request.id, 'REJECTED')}
                              className="text-red-600 hover:text-red-800 font-medium"
                            >
                              {canManagerReview && request.status === 'PENDING' ? '退回' : '拒絕'}
                            </button>
                          </div>
                        )}
                        {canPrivilegedEdit && request.status === 'PENDING' && (
                          <div className="mt-2 flex flex-wrap gap-3 items-center">
                            <button
                              onClick={() => openEditModal(request)}
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
                        )}
                        {/* 員工編輯/刪除（僅自己且 PENDING） */}
                          {!canPrivilegedEdit && isOwner && (
                          request.status === 'PENDING' ? (
                            <div className="flex gap-3">
                              <button
                                onClick={() => openEditModal(request)}
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
                          ) : request.status === 'APPROVED' ? (
                            <button
                              onClick={() => {
                                const reason = prompt('請輸入撤銷原因：');
                                if (reason && reason.trim()) {
                                  handleCancelRequest(request.id, reason.trim());
                                }
                              }}
                              className="inline-flex items-center gap-1 text-orange-600 hover:text-orange-800"
                            >
                              <X className="w-4 h-4" /> 申請撤銷
                            </button>
                          ) : (
                            <span className="text-gray-400">僅可檢視</span>
                          )
                        )}
                        {/* 管理員作廢已核准申請 */}
                        {canPrivilegedEdit && request.status === 'APPROVED' && (
                          <button
                            onClick={() => {
                              const reason = prompt('請輸入作廢原因：');
                              if (reason && reason.trim()) {
                                handleVoidRequest(request.id, reason.trim());
                              }
                            }}
                            className="inline-flex items-center gap-1 text-red-600 hover:text-red-800 ml-2"
                          >
                            <X className="w-4 h-4" /> 作廢
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
                      </td>
                    </tr>
                    {/* 展開的審核進度區域 */}
                    {expandedId === request.id && (
                      <tr>
                        <td colSpan={canBatchApprove ? 9 : 8} className="px-6 py-4 bg-gray-50">
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
                  );
                })}
              </tbody>
            </table>

            {filteredRequests.length === 0 && (
              <div className="text-center py-12">
                <Calendar className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <p className="text-gray-500">暫無請假記錄</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 新增請假申請表單 */}
      {showNewRequestForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">申請請假</h3>
              <button
                onClick={() => {
                  setShowNewRequestForm(false);
                  resetForm();
                }}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <form onSubmit={handleSubmitRequest} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  請假類型 *
                </label>
                <select
                  value={newRequest.leaveType}
                  onChange={(e) => setNewRequest({ ...newRequest, leaveType: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                  required
                >
                  <option value="">請選擇請假類型</option>
                  {Object.entries(LEAVE_TYPES).map(([key, value]) => (
                    <option key={key} value={key} className="text-black">{value}</option>
                  ))}
                </select>
                
                {/* 勞基法規範說明 */}
                {newRequest.leaveType && LABOR_LAW_REGULATIONS[newRequest.leaveType as keyof typeof LABOR_LAW_REGULATIONS] && (
                  <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-start">
                      <AlertCircle className="h-4 w-4 text-blue-600 mt-0.5 mr-2" />
                      <div className="text-sm text-blue-800">
                        <p className="font-medium">勞基法規範：</p>
                        <div className="mt-1 space-y-1 text-xs">
                          <p><strong>說明：</strong>{LABOR_LAW_REGULATIONS[newRequest.leaveType as keyof typeof LABOR_LAW_REGULATIONS].description}</p>
                          <p><strong>天數：</strong>{LABOR_LAW_REGULATIONS[newRequest.leaveType as keyof typeof LABOR_LAW_REGULATIONS].days}</p>
                          <p><strong>薪資：</strong>{LABOR_LAW_REGULATIONS[newRequest.leaveType as keyof typeof LABOR_LAW_REGULATIONS].salary}</p>
                          <p><strong>要求：</strong>{LABOR_LAW_REGULATIONS[newRequest.leaveType as keyof typeof LABOR_LAW_REGULATIONS].requirements}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    開始日期 *
                  </label>
                  <input
                    type="date"
                    value={newRequest.startDate}
                    onChange={(e) => handleStartDateChange(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                    required
                  />
                  {newRequest.startDate && scheduleInfo[newRequest.startDate] && (
                    <p className="text-xs text-blue-600 mt-1">
                      排班：{scheduleInfo[newRequest.startDate]}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    開始時間 *
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <select
                        value={newRequest.startHour}
                        onChange={(e) => setNewRequest({ ...newRequest, startHour: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                        required
                      >
                        <option value="">時</option>
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={i} value={i.toString().padStart(2, '0')}>
                            {i.toString().padStart(2, '0')}時
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <input
                        type="number"
                        min={0}
                        max={59}
                        step={1}
                        value={newRequest.startMinute}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^0-9]/g, '');
                          const num = Math.max(0, Math.min(59, Number(v || '0')));
                          setNewRequest({ ...newRequest, startMinute: String(num).padStart(2,'0') });
                        }}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                        required
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    結束日期 *
                  </label>
                  <input
                    type="date"
                    value={newRequest.endDate}
                    onChange={(e) => handleEndDateChange(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                    required
                  />
                  {newRequest.endDate && scheduleInfo[newRequest.endDate] && (
                    <p className="text-xs text-blue-600 mt-1">
                      排班：{scheduleInfo[newRequest.endDate]}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    結束時間 *
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <select
                        value={newRequest.endHour}
                        onChange={(e) => setNewRequest({ ...newRequest, endHour: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                        required
                      >
                        <option value="">時</option>
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={i} value={i.toString().padStart(2, '0')}>
                            {i.toString().padStart(2, '0')}時
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <input
                        type="number"
                        min={0}
                        max={59}
                        step={1}
                        value={newRequest.endMinute}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^0-9]/g, '');
                          const num = Math.max(0, Math.min(59, Number(v || '0')));
                          setNewRequest({ ...newRequest, endMinute: String(num).padStart(2,'0') });
                        }}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                        required
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* 顯示計算的請假時數 */}
              {newRequest.startDate && newRequest.endDate && newRequest.startHour && newRequest.startMinute && newRequest.endHour && newRequest.endMinute && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-sm text-blue-800">
                    請假時數：{calculateLeaveHours()} 小時
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  申請原因
                </label>
                <select
                  value={newRequest.leaveReason}
                  onChange={(e) => setNewRequest({ ...newRequest, leaveReason: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                >
                  <option value="">請選擇申請原因</option>
                  {leaveReasonOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  請假說明
                </label>
                <textarea
                  value={newRequest.reason}
                  onChange={(e) => setNewRequest({ ...newRequest, reason: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                  rows={3}
                  placeholder="請填寫詳細說明（選填）"
                />
              </div>

              {/* 檔案上傳 */}
              {newRequest.leaveType && ['SICK', 'BEREAVEMENT', 'PRENATAL_CHECKUP', 'MARRIAGE', 'OCCUPATIONAL_INJURY', 'MATERNITY', 'BREASTFEEDING', 'PATERNITY_CHECKUP', 'MISCARRIAGE', 'OFFICIAL', 'MILITARY_SERVICE'].includes(newRequest.leaveType) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    佐證文件 {['SICK', 'BEREAVEMENT', 'OCCUPATIONAL_INJURY', 'MATERNITY', 'MISCARRIAGE'].includes(newRequest.leaveType) ? '*' : ''}
                  </label>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      setNewRequest({ ...newRequest, attachments: files });
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                    required={['SICK', 'BEREAVEMENT', 'OCCUPATIONAL_INJURY', 'MATERNITY', 'MISCARRIAGE'].includes(newRequest.leaveType)}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    支援格式：PDF, JPG, PNG, DOC, DOCX（最多5個檔案）
                  </p>
                  {newRequest.attachments.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {newRequest.attachments.map((file, index) => (
                        <div key={index} className="flex items-center justify-between bg-gray-50 px-2 py-1 rounded text-xs">
                          <span className="text-gray-700">{file.name}</span>
                          <button
                            type="button"
                            onClick={() => {
                              const newFiles = newRequest.attachments.filter((_, i) => i !== index);
                              setNewRequest({ ...newRequest, attachments: newFiles });
                            }}
                            className="text-red-500 hover:text-red-700"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowNewRequestForm(false);
                    resetForm();
                  }}
                  className="flex-1 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  提交申請
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 編輯請假申請表單 */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">編輯請假申請</h3>
              <button
                onClick={() => { setShowEditModal(false); setEditingRequest(null); }}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <form onSubmit={handleSubmitEdit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">請假類型 *</label>
                <select
                  value={editForm.leaveType}
                  onChange={(e) => setEditForm({ ...editForm, leaveType: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                  required
                >
                  {Object.entries(LEAVE_TYPES).map(([key, value]) => (
                    <option key={key} value={key} className="text-black">{value}</option>
                  ))}
                </select>
                {editForm.leaveType === 'FAMILY_CARE' && (
                  <div className="mt-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                    <div className="flex items-start">
                      <AlertCircle className="h-4 w-4 text-orange-600 mt-0.5 mr-2" />
                      <div className="text-sm text-orange-800">
                        <p className="font-medium">家庭照顧假規則提醒：</p>
                        <ul className="mt-1 space-y-1 text-xs">
                          <li>• 年度上限：7天</li>
                          <li>• 薪資給付：不給薪（將從月薪中扣除）</li>
                          <li>• 適用範圍：照顧家庭成員（配偶、子女、父母等）</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">開始日期 *</label>
                  <input
                    type="date"
                    value={editForm.startDate}
                    onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">開始時間 *</label>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={editForm.startHour}
                      onChange={(e) => setEditForm({ ...editForm, startHour: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                      required
                    >
                      <option value="">時</option>
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i.toString().padStart(2, '0')}>{i.toString().padStart(2, '0')}時</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      step={1}
                      value={editForm.startMinute}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9]/g, '');
                        const num = Math.max(0, Math.min(59, Number(v || '0')));
                        setEditForm({ ...editForm, startMinute: String(num).padStart(2,'0') });
                      }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">結束日期 *</label>
                  <input
                    type="date"
                    value={editForm.endDate}
                    onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">結束時間 *</label>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={editForm.endHour}
                      onChange={(e) => setEditForm({ ...editForm, endHour: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                      required
                    >
                      <option value="">時</option>
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i.toString().padStart(2, '0')}>{i.toString().padStart(2, '0')}時</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      step={1}
                      value={editForm.endMinute}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9]/g, '');
                        const num = Math.max(0, Math.min(59, Number(v || '0')));
                        setEditForm({ ...editForm, endMinute: String(num).padStart(2,'0') });
                      }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                      required
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">申請原因</label>
                <select
                  value={editForm.leaveReason}
                  onChange={(e) => setEditForm({ ...editForm, leaveReason: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                >
                  <option value="">請選擇申請原因</option>
                  {leaveReasonOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">請假說明</label>
                <textarea
                  value={editForm.reason}
                  onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                  rows={3}
                  placeholder="請填寫詳細說明（選填）"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowEditModal(false); setEditingRequest(null); }}
                  className="flex-1 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  儲存變更
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 批次審核工具列 */}
      {canBatchApprove && (
        <BatchApproveBar
          selectedIds={selectedIds}
          apiEndpoint="/api/leave-requests/batch"
          onSuccess={fetchLeaveRequests}
          onClear={() => setSelectedIds([])}
          onSelectionChange={setSelectedIds}
          itemName="請假申請"
        />
      )}

      {/* 分頁導航 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 my-4">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-4 py-2 bg-gray-100 rounded-lg disabled:opacity-50 text-gray-700"
          >
            上一頁
          </button>
          <span className="text-sm text-gray-600">
            第 {currentPage} / {totalPages} 頁
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-4 py-2 bg-gray-100 rounded-lg disabled:opacity-50 text-gray-700"
          >
            下一頁
          </button>
        </div>
      )}

      {/* 刪除確認框 */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">確認刪除</h3>
            <p className="text-gray-600 mb-6">
              確定要刪除 <span className="font-medium">{deleteConfirm.name}</span> 的請假申請嗎？
              <br />
              <span className="text-xs text-red-600">僅能刪除待審核的申請</span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                確認刪除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast 訊息 */}
      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 ${
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.type === 'success' ? (
            <CheckCircle className="w-5 h-5" />
          ) : (
            <XCircle className="w-5 h-5" />
          )}
          {toast.message}
        </div>
      )}
    </AuthenticatedLayout>
  );

}
