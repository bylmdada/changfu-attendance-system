'use client';

import { useEffect, useMemo, useState } from 'react';
import { 
  History, Calendar, Download,
  ChevronLeft, ChevronRight, Filter, MapPin
} from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import EmployeeListSelect from '@/components/EmployeeListSelect';
import { escapeCsvValue } from '@/lib/csv';
import { formatShiftDisplay } from '@/lib/shift-display';

interface AttendanceRecord {
  id: number;
  employeeId: number;
  workDate: string;
  clockInTime: string;
  clockOutTime: string;
  regularHours: number;
  overtimeHours: number;
  status: string;
  createdAt: string;
  updatedAt?: string;
  clockInReason?: string | null;
  clockOutReason?: string | null;
  clockInHasFever?: boolean | null;
  clockInTemperature?: number | null;
  clockInHasAcuteCough?: boolean | null;
  clockOutHasFever?: boolean | null;
  clockOutTemperature?: number | null;
  clockOutHasAcuteCough?: boolean | null;
  shiftType?: string | null;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  employee?: {
    id: number;
    employeeId: string;
    name: string;
    department: string;
    position: string;
  };
  // GPS 資訊（僅管理員/HR 可見）
  clockInLatitude?: number;
  clockInLongitude?: number;
  clockInAccuracy?: number;
  clockInAddress?: string;
  clockOutLatitude?: number;
  clockOutLongitude?: number;
  clockOutAccuracy?: number;
  clockOutAddress?: string;
}

interface User {
  id: number;
  username: string;
  role: string;
  isDepartmentManager?: boolean;
  employee?: {
    id: number;
    employeeId: string;
    name: string;
    department: string;
    position: string;
  };
}

interface PaginationInfo {
  current: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface Summary {
  totalRecords: number;
  totalRegularHours: number;
  totalOvertimeHours: number;
  statusBreakdown?: Record<string, number>;
}

type ExportFormat = 'pdf' | 'csv' | 'excel';

const ATTENDANCE_STATUS_OPTIONS = [
  { value: '', label: '全部狀態' },
  { value: '正常', label: '正常' },
  { value: '遲到', label: '遲到' },
  { value: '早退', label: '早退' },
  { value: '遲到+早退', label: '遲到+早退' },
  { value: '異常', label: '異常' },
  { value: '缺勤', label: '缺勤' },
] as const;

const STATUS_CARD_CONFIG = [
  { key: '正常', label: '正常', accent: 'text-green-700 bg-green-50 border-green-200', dotAccent: 'bg-green-400', barAccent: 'from-green-400 via-emerald-300 to-lime-300' },
  { key: '遲到', label: '遲到', accent: 'text-amber-700 bg-amber-50 border-amber-200', dotAccent: 'bg-amber-400', barAccent: 'from-amber-400 via-yellow-300 to-orange-300' },
  { key: '早退', label: '早退', accent: 'text-orange-700 bg-orange-50 border-orange-200', dotAccent: 'bg-orange-400', barAccent: 'from-orange-400 via-amber-300 to-yellow-300' },
  { key: '遲到+早退', label: '遲到+早退', accent: 'text-red-700 bg-red-50 border-red-200', dotAccent: 'bg-red-400', barAccent: 'from-red-400 via-rose-300 to-orange-300' },
  { key: '異常', label: '異常', accent: 'text-rose-700 bg-rose-50 border-rose-200', dotAccent: 'bg-rose-400', barAccent: 'from-rose-400 via-pink-300 to-red-300' },
  { key: '缺勤', label: '缺勤', accent: 'text-slate-700 bg-slate-50 border-slate-200', dotAccent: 'bg-slate-400', barAccent: 'from-slate-400 via-slate-300 to-zinc-200' },
] as const;

export default function AttendanceRecordsPage() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | ''>('');
  const [exportFeedback, setExportFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [pagination, setPagination] = useState<PaginationInfo>({
    current: 1,
    pageSize: 10,
    total: 0,
    totalPages: 0
  });
  const [summary, setSummary] = useState<Summary>({
    totalRecords: 0,
    totalRegularHours: 0,
    totalOvertimeHours: 0
  });
  
  // 篩選狀態
  const [filters, setFilters] = useState({
    year: '',
    yearMonth: '',
    startDate: '',
    endDate: '',
    employeeId: '',
    overtimeHours: '',
    status: '',
    department: ''  // 新增：部門篩選
  });
  
  // 部門列表（管理員/HR 用）
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);

  // 排序狀態
  const [sortConfig, setSortConfig] = useState<{ field: 'date' | 'clockIn' | 'clockOut' | 'regular' | 'overtime' | 'status'; direction: 'asc' | 'desc' }>({ field: 'date', direction: 'desc' });
  const canManageAttendanceRecords = user?.role === 'ADMIN' || user?.role === 'HR';
  const canViewDepartmentRecords = canManageAttendanceRecords || user?.isDepartmentManager === true;
  const canViewClockReasons = canManageAttendanceRecords;
  const recordTableColumnCount = 9 + (canViewClockReasons ? 1 : 0) + (canManageAttendanceRecords ? 1 : 0);

  // 排序函數
  const handleSort = (field: 'date' | 'clockIn' | 'clockOut' | 'regular' | 'overtime' | 'status') => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  // 排序後的記錄
  const sortedRecords = [...records].sort((a, b) => {
    const direction = sortConfig.direction === 'asc' ? 1 : -1;
    switch (sortConfig.field) {
      case 'date':
        return direction * a.workDate.localeCompare(b.workDate);
      case 'clockIn':
        return direction * (a.clockInTime || '').localeCompare(b.clockInTime || '');
      case 'clockOut':
        return direction * (a.clockOutTime || '').localeCompare(b.clockOutTime || '');
      case 'regular':
        return direction * (a.regularHours - b.regularHours);
      case 'overtime':
        return direction * (a.overtimeHours - b.overtimeHours);
      case 'status':
        return direction * a.status.localeCompare(b.status);
      default:
        return 0;
    }
  });

  // 只在組件首次載入時獲取用戶信息
  useEffect(() => {
    const fetchUserAndRecords = async () => {
      try {
        // 首先獲取用戶信息
        const authResponse = await fetch('/api/auth/me', {
          credentials: 'include'
        });
        
        if (!authResponse.ok) {
          window.location.href = '/login';
          return;
        }
        
        const userData = await authResponse.json();
        setUser(userData.user);
        
        // 如果是管理員/HR，獲取部門列表
        if (userData.user.role === 'ADMIN' || userData.user.role === 'HR') {
          try {
            const deptResponse = await fetch('/api/departments', {
              credentials: 'include'
            });
            if (deptResponse.ok) {
              const deptData = await deptResponse.json();
              setDepartments(deptData.departments || []);
            }
          } catch (err) {
            console.error('獲取部門列表失敗:', err);
          }
        }
      } catch (error) {
        console.error('獲取用戶信息失敗:', error);
        setLoading(false);
      }
    };

    fetchUserAndRecords();
  }, []);

  // 統一的數據獲取effect，監聽所有需要的依賴
  useEffect(() => {
    const fetchRecords = async () => {
      if (!user) return; // 確保用戶已載入
      
      try {
        setLoading(true);
        console.log('📋 準備請求數據，當前狀態:', { 
          page: pagination.current,
          pageSize: pagination.pageSize,
          filters 
        });
        
        const params = new URLSearchParams({
          page: pagination.current.toString(),
          pageSize: pagination.pageSize.toString()
        });
        
        if (filters.year) params.append('year', filters.year);
        if (filters.yearMonth) params.append('yearMonth', filters.yearMonth);
        if (filters.startDate) params.append('startDate', filters.startDate);
        if (filters.endDate) params.append('endDate', filters.endDate);
        if (filters.employeeId) params.append('employeeId', filters.employeeId);
        if (filters.overtimeHours) params.append('overtimeHours', filters.overtimeHours);
        if (filters.status) params.append('status', filters.status);
        if (filters.department) params.append('department', filters.department);
        
        console.log('🌐 發送請求到:', `/api/attendance/records?${params.toString()}`);
        console.log('📝 請求參數詳情:', Object.fromEntries(params));
        
        const response = await fetch(`/api/attendance/records?${params.toString()}`, {
          credentials: 'include'
        });

        if (response.ok) {
          const data = await response.json();
          console.log('✅ 收到API回應:', { 
            recordsCount: data.records?.length, 
            pagination: data.pagination, 
            hasRecords: !!data.records?.length 
          });
          
          setRecords(data.records);
          // 只更新總數和總頁數，保持當前頁碼
          setPagination(prev => ({
            ...prev,
            total: data.pagination.total,
            totalPages: data.pagination.totalPages,
            pageSize: data.pagination.pageSize
          }));
          setSummary(data.summary);
          if (!canManageAttendanceRecords && data.scope?.canViewDepartmentRecords) {
            setDepartments(
              (data.scope.managedDepartments || []).map((name: string, index: number) => ({
                id: -(index + 1),
                name,
              }))
            );
          }
        } else {
          console.error('載入考勤記錄失敗');
          if (response.status === 401) {
            window.location.href = '/login';
          }
        }
      } catch (error) {
        console.error('獲取考勤記錄失敗:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, pagination.current, filters.year, filters.yearMonth, filters.startDate, filters.endDate, filters.employeeId, filters.overtimeHours, filters.status, filters.department]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  };

  const formatTime = (dateString: string | null | undefined) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleTimeString('zh-TW', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatWeekday = (dateString: string) => {
    const date = new Date(dateString);
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    return `(${weekdays[date.getDay()]})`;
  };

  const getRecordShiftDisplay = (record: AttendanceRecord) => (
    formatShiftDisplay({
      shiftType: record.shiftType,
      startTime: record.scheduledStart,
      endTime: record.scheduledEnd,
    })
  );

  const formatYesNo = (value: boolean | null | undefined) => {
    if (value === true) return '有';
    if (value === false) return '無';
    return '未記錄';
  };

  const formatTemperature = (value: number | null | undefined) => (
    value === null || value === undefined ? '-' : `${value.toFixed(1)}°C`
  );

  const handlePageChange = (newPage: number) => {
    console.log('📄 分頁變更:', { from: pagination.current, to: newPage });
    setPagination(prev => ({ ...prev, current: newPage }));
  };

  const handleDateFilter = () => {
    setPagination(prev => ({ ...prev, current: 1 }));
    // 移除直接調用fetchRecords()，讓useEffect處理
  };

  const statusBreakdown = useMemo(() => {
    const baseCounts = Object.fromEntries(
      STATUS_CARD_CONFIG.map((config) => [config.key, summary.statusBreakdown?.[config.key] || 0])
    ) as Record<(typeof STATUS_CARD_CONFIG)[number]['key'], number>;

    return baseCounts;
  }, [summary.statusBreakdown]);

  const currentEmployeeCount = useMemo(
    () => new Set(records.map((record) => record.employee?.employeeId).filter(Boolean)).size,
    [records]
  );

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 8 }, (_, index) => String(currentYear - index));
  }, []);

  const activeSummaryEyebrow = useMemo(() => {
    if (filters.yearMonth) return 'MONTHLY ATTENDANCE';
    if (filters.year) return 'YEARLY ATTENDANCE';
    if (filters.startDate || filters.endDate) return 'RANGE ATTENDANCE';
    return 'ATTENDANCE SUMMARY';
  }, [filters.endDate, filters.startDate, filters.year, filters.yearMonth]);

  const activeSummaryLabel = useMemo(() => {
    if (filters.yearMonth) {
      const [year, month] = filters.yearMonth.split('-');
      return `${year} 年 ${Number(month)} 月`;
    }

    if (filters.year) {
      return `${filters.year} 年年度彙總`;
    }

    if (filters.startDate || filters.endDate) {
      return '自訂區間彙總';
    }

    const now = new Date();
    return `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`;
  }, [filters.year, filters.yearMonth, filters.startDate, filters.endDate]);

  const activeScopeLabel = useMemo(() => {
    if (filters.year && !filters.startDate && !filters.endDate && !filters.yearMonth) {
      return '依年份篩選';
    }

    if (filters.startDate && filters.endDate) {
      return `${filters.startDate} 至 ${filters.endDate}`;
    }

    if (filters.startDate) {
      return `${filters.startDate} 起`;
    }

    if (filters.endDate) {
      return `截至 ${filters.endDate}`;
    }

    if (filters.yearMonth) {
      return '依月份篩選';
    }

    return '目前為全部日期資料';
  }, [filters.endDate, filters.startDate, filters.year, filters.yearMonth]);

  const statusDistributionTitle = useMemo(() => {
    if (filters.yearMonth) return '本月考勤狀態分布';
    if (filters.year) return '本年考勤狀態分布';
    if (filters.startDate || filters.endDate) return '區間考勤狀態分布';
    return '目前考勤狀態分布';
  }, [filters.endDate, filters.startDate, filters.year, filters.yearMonth]);

  const summaryHighlightItems = useMemo(
    () => [
      {
        label: '考勤筆數',
        value: String(summary.totalRecords),
        tone: 'border-white/60 bg-white/75 text-slate-900',
      },
      {
        label: '正常工時',
        value: `${summary.totalRegularHours.toFixed(1)}h`,
        tone: 'border-emerald-200/80 bg-emerald-50/90 text-emerald-900',
      },
      {
        label: '加班工時',
        value: `${summary.totalOvertimeHours.toFixed(1)}h`,
        tone: 'border-amber-200/80 bg-amber-50/90 text-amber-900',
      },
      {
        label: '頁面員工數',
        value: String(currentEmployeeCount),
        tone: 'border-sky-200/80 bg-sky-50/90 text-sky-900',
      },
    ],
    [currentEmployeeCount, summary.totalOvertimeHours, summary.totalRecords, summary.totalRegularHours]
  );

  const statusBreakdownItems = useMemo(() => {
    const totalStatuses = Math.max(summary.totalRecords, 1);
    const maxCount = Math.max(...Object.values(statusBreakdown), 1);

    return STATUS_CARD_CONFIG.map((config) => ({
      ...config,
      count: statusBreakdown[config.key],
      percentage: summary.totalRecords ? Math.round((statusBreakdown[config.key] / totalStatuses) * 100) : 0,
      width: `${Math.max((statusBreakdown[config.key] / maxCount) * 100, statusBreakdown[config.key] > 0 ? 18 : 0)}%`,
    }));
  }, [statusBreakdown, summary.totalRecords]);

  const buildAttendanceExportQueryParams = (page: number, pageSize: number) => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });

    if (filters.year) params.append('year', filters.year);
    if (filters.yearMonth) params.append('yearMonth', filters.yearMonth);
    if (filters.startDate) params.append('startDate', filters.startDate);
    if (filters.endDate) params.append('endDate', filters.endDate);
    if (filters.employeeId) params.append('employeeId', filters.employeeId);
    if (filters.overtimeHours) params.append('overtimeHours', filters.overtimeHours);
    if (filters.status) params.append('status', filters.status);
    if (filters.department) params.append('department', filters.department);

    return params;
  };

  const formatDateTimeForExport = (date: Date) =>
    date.toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

  const sanitizeFileNameSegment = (value: string) =>
    value.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '').trim();

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const buildFilterSummaryText = () => {
    const summaryParts = [
      filters.year ? `年份：${filters.year} 年` : '',
      filters.yearMonth ? `月份：${filters.yearMonth}` : '',
      filters.startDate ? `開始日期：${filters.startDate}` : '',
      filters.endDate ? `結束日期：${filters.endDate}` : '',
      filters.department ? `部門：${filters.department}` : '',
      filters.employeeId ? `員工：${filters.employeeId}` : '',
      filters.overtimeHours ? `加班工時：${filters.overtimeHours}` : '',
      filters.status ? `狀態：${filters.status}` : '',
    ].filter(Boolean);

    return summaryParts.length > 0 ? summaryParts.join(' / ') : '全部考勤記錄';
  };

  const buildExportBaseFileName = () => {
    const today = new Date().toISOString().split('T')[0];
    const scope = sanitizeFileNameSegment(activeSummaryLabel || '全部資料');
    return `考勤記錄_${scope}_${today}`;
  };

  const buildAttendanceExportRows = (sourceRecords: AttendanceRecord[]) =>
    sourceRecords.map((record) => {
      const baseData: Record<string, string | number> = {
        員工姓名: record.employee?.name || '-',
        員工編號: record.employee?.employeeId || '-',
        部門: record.employee?.department || '-',
        職位: record.employee?.position || '-',
        日期: formatDate(record.workDate),
        星期: formatWeekday(record.workDate).replace(/[()]/g, ''),
        班次: getRecordShiftDisplay(record),
        上班時間: formatTime(record.clockInTime),
        下班時間: formatTime(record.clockOutTime),
        上班發燒: formatYesNo(record.clockInHasFever),
        上班體溫: formatTemperature(record.clockInTemperature),
        上班急性咳嗽: formatYesNo(record.clockInHasAcuteCough),
        下班發燒: formatYesNo(record.clockOutHasFever),
        下班體溫: formatTemperature(record.clockOutTemperature),
        下班急性咳嗽: formatYesNo(record.clockOutHasAcuteCough),
        正常工時: record.regularHours,
        加班工時: record.overtimeHours,
        狀態: record.status,
      };

      if (canManageAttendanceRecords) {
        baseData.提早上班打卡原因 = record.clockInReason || '-';
        baseData.延後下班打卡原因 = record.clockOutReason || '-';
        baseData.上班打卡定位 = record.clockInLatitude && record.clockInLongitude
          ? `${record.clockInLatitude}, ${record.clockInLongitude}`
          : '-';
        baseData.上班打卡精確度 = record.clockInAccuracy ? `${Math.round(record.clockInAccuracy)}m` : '-';
        baseData.上班打卡地址 = record.clockInAddress || '-';
        baseData.下班打卡定位 = record.clockOutLatitude && record.clockOutLongitude
          ? `${record.clockOutLatitude}, ${record.clockOutLongitude}`
          : '-';
        baseData.下班打卡精確度 = record.clockOutAccuracy ? `${Math.round(record.clockOutAccuracy)}m` : '-';
        baseData.下班打卡地址 = record.clockOutAddress || '-';
      }

      return baseData;
    });

  const fetchAllRecordsForExport = async () => {
    const pageSize = 100;
    let page = 1;
    let totalPages = 1;
    const allRecords: AttendanceRecord[] = [];
    let exportSummary = summary;

    while (page <= totalPages) {
      const params = buildAttendanceExportQueryParams(page, pageSize);
      const response = await fetch(`/api/attendance/records?${params.toString()}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('載入匯出資料失敗');
      }

      const data = await response.json();
      const nextRecords = Array.isArray(data.records) ? data.records : [];

      allRecords.push(...nextRecords);
      exportSummary = data.summary || exportSummary;
      totalPages = data.pagination?.totalPages || 0;

      if (totalPages === 0) {
        break;
      }

      page += 1;
    }

    return { allRecords, exportSummary };
  };

  const downloadBlob = (blob: Blob, fileName: string) => {
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleExport = async (format: ExportFormat) => {
    if (exportingFormat) return;

    try {
      setExportFeedback(null);
      setExportingFormat(format);

      const { allRecords, exportSummary } = await fetchAllRecordsForExport();

      if (allRecords.length === 0) {
        setExportFeedback({ type: 'error', message: '目前篩選條件下沒有可匯出的考勤記錄。' });
        return;
      }

      const exportRows = buildAttendanceExportRows(allRecords);
      const baseFileName = buildExportBaseFileName();
      const filterSummaryText = buildFilterSummaryText();
      const exportedAt = formatDateTimeForExport(new Date());
      const exportEmployeeCount = new Set(
        allRecords.map((record) => record.employee?.employeeId).filter(Boolean)
      ).size;

      if (format === 'csv') {
        const csvContent = [
          Object.keys(exportRows[0]).join(','),
          ...exportRows.map((row) => Object.values(row).map(escapeCsvValue).join(',')),
        ].join('\n');

        downloadBlob(
          new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' }),
          `${baseFileName}.csv`
        );
        setExportFeedback({ type: 'success', message: `CSV 匯出完成，共 ${allRecords.length} 筆。` });
        return;
      }

      if (format === 'excel') {
        const XLSX = await import('xlsx');
        const workbook = XLSX.utils.book_new();
        const detailSheet = XLSX.utils.json_to_sheet(exportRows);
        const summarySheet = XLSX.utils.aoa_to_sheet([
          ['匯出時間', exportedAt],
          ['彙總區間', activeSummaryLabel],
          ['篩選條件', filterSummaryText],
          ['考勤筆數', exportSummary.totalRecords],
          ['正常工時', exportSummary.totalRegularHours],
          ['加班工時', exportSummary.totalOvertimeHours],
          ['員工數', exportEmployeeCount],
        ]);

        detailSheet['!cols'] = Object.keys(exportRows[0]).map((key) => ({
          wch: Math.min(Math.max(key.length * 2, 14), 28),
        }));
        summarySheet['!cols'] = [{ wch: 16 }, { wch: 48 }];

        XLSX.utils.book_append_sheet(workbook, summarySheet, '考勤彙總');
        XLSX.utils.book_append_sheet(workbook, detailSheet, '考勤明細');
        XLSX.writeFile(workbook, `${baseFileName}.xlsx`);
        setExportFeedback({ type: 'success', message: `Excel 匯出完成，共 ${allRecords.length} 筆。` });
        return;
      }

      const headerColumns = Object.keys(exportRows[0]);
      const tableHeaderHtml = headerColumns
        .map((column) => `<th>${escapeHtml(column)}</th>`)
        .join('');
      const tableBodyHtml = exportRows
        .map(
          (row) =>
            `<tr>${headerColumns
              .map((column) => `<td>${escapeHtml(String(row[column] ?? '-'))}</td>`)
              .join('')}</tr>`
        )
        .join('');

      const printWindow = window.open('', '_blank', 'width=1280,height=900');
      if (!printWindow) {
        throw new Error('瀏覽器阻擋了 PDF 匯出視窗，請允許彈出視窗後再試一次。');
      }

      printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="zh-Hant">
          <head>
            <meta charset="UTF-8" />
            <title>${escapeHtml(baseFileName)}</title>
            <style>
              body {
                margin: 0;
                padding: 32px;
                font-family: "PingFang TC", "Microsoft JhengHei", sans-serif;
                color: #0f172a;
                background: #f8fafc;
              }
              .sheet {
                background: #ffffff;
                border-radius: 24px;
                padding: 28px;
                box-shadow: 0 24px 80px -32px rgba(15, 23, 42, 0.28);
              }
              .title {
                font-size: 28px;
                font-weight: 800;
                margin-bottom: 8px;
              }
              .subtitle {
                font-size: 13px;
                color: #475569;
                margin-bottom: 18px;
              }
              .summary-grid {
                display: grid;
                grid-template-columns: repeat(4, minmax(0, 1fr));
                gap: 12px;
                margin-bottom: 18px;
              }
              .summary-card {
                border: 1px solid #dbeafe;
                border-radius: 18px;
                padding: 14px 16px;
                background: linear-gradient(135deg, #eff6ff 0%, #ffffff 100%);
              }
              .summary-label {
                font-size: 12px;
                color: #475569;
                margin-bottom: 8px;
              }
              .summary-value {
                font-size: 24px;
                font-weight: 800;
              }
              table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 12px;
                font-size: 12px;
                table-layout: fixed;
                word-break: break-word;
              }
              th, td {
                border: 1px solid #cbd5e1;
                padding: 8px 10px;
                vertical-align: top;
                text-align: left;
              }
              th {
                background: #e2e8f0;
                font-weight: 700;
              }
              tr:nth-child(even) td {
                background: #f8fafc;
              }
              @media print {
                body {
                  padding: 0;
                  background: #ffffff;
                }
                .sheet {
                  box-shadow: none;
                  border-radius: 0;
                  padding: 16px;
                }
              }
            </style>
          </head>
          <body>
            <div class="sheet">
              <div class="title">考勤記錄匯出</div>
              <div class="subtitle">
                依據 ${escapeHtml(activeSummaryLabel)} 匯出 | 篩選條件：${escapeHtml(filterSummaryText)} | 匯出時間：${escapeHtml(exportedAt)}
              </div>
              <div class="summary-grid">
                <div class="summary-card">
                  <div class="summary-label">考勤筆數</div>
                  <div class="summary-value">${exportSummary.totalRecords}</div>
                </div>
                <div class="summary-card">
                  <div class="summary-label">正常工時</div>
                  <div class="summary-value">${exportSummary.totalRegularHours.toFixed(1)}h</div>
                </div>
                <div class="summary-card">
                  <div class="summary-label">加班工時</div>
                  <div class="summary-value">${exportSummary.totalOvertimeHours.toFixed(1)}h</div>
                </div>
                <div class="summary-card">
                  <div class="summary-label">員工數</div>
                  <div class="summary-value">${exportEmployeeCount}</div>
                </div>
              </div>
              <table>
                <thead>
                  <tr>${tableHeaderHtml}</tr>
                </thead>
                <tbody>
                  ${tableBodyHtml}
                </tbody>
              </table>
            </div>
            <script>
              window.onload = function() {
                setTimeout(function() { window.print(); }, 300);
              };
              window.onafterprint = function() {
                window.close();
              };
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
      setExportFeedback({ type: 'success', message: `PDF 匯出視窗已開啟，共 ${allRecords.length} 筆。` });
    } catch (error) {
      console.error('匯出考勤記錄失敗:', error);
      setExportFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : '匯出失敗，請稍後再試。',
      });
    } finally {
      setExportingFormat('');
    }
  };

  return (
    <AuthenticatedLayout backUrl="/attendance" backLabel="返回打卡">
      <div className="w-full max-w-none py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* 頁面標題 */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 flex items-center">
              <History className="mr-3 h-8 w-8" />
              考勤記錄
            </h1>
            <p className="mt-2 text-gray-600">
              {canViewDepartmentRecords ? '查看可管理員工的考勤記錄、篩選條件與考勤狀態統計' : '查看您的打卡歷史記錄和工時統計'}
            </p>
          </div>

          <div className="mb-8 overflow-hidden rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(191,219,254,0.85),_rgba(255,255,255,0.96)_38%,_rgba(240,249,255,1)_100%)] shadow-[0_24px_80px_-28px_rgba(15,23,42,0.25)]">
            <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="inline-flex items-center rounded-full border border-blue-200 bg-white/80 px-3 py-1 text-xs font-semibold tracking-[0.24em] text-blue-700">
                      {activeSummaryEyebrow}
                    </div>
                    <h2 className="mt-4 text-3xl font-black tracking-tight text-slate-900">
                      {activeSummaryLabel}
                    </h2>
                    <p className="mt-2 text-sm text-slate-600">
                      {activeScopeLabel}
                    </p>
                  </div>
                  <div className="rounded-3xl border border-slate-200 bg-white/80 px-4 py-3 text-right shadow-sm backdrop-blur">
                    <div className="text-xs font-semibold tracking-[0.2em] text-slate-500">統計焦點</div>
                    <div className="mt-2 flex items-center justify-end gap-2 text-slate-900">
                      <Calendar className="h-4 w-4 text-blue-600" />
                      <span className="text-sm font-semibold">
                        {filters.year ? '依年份彙總視圖' : filters.yearMonth ? '依月份彙總視圖' : '依條件彙總視圖'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                  {summaryHighlightItems.map((item) => (
                    <div
                      key={item.label}
                      className={`rounded-3xl border px-4 py-4 shadow-sm backdrop-blur ${item.tone}`}
                    >
                      <div className="text-xs font-semibold tracking-[0.18em] opacity-70">
                        {item.label}
                      </div>
                      <div className="mt-3 text-3xl font-black tracking-tight">
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[24px] border border-slate-200 bg-slate-950 px-5 py-5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold tracking-[0.24em] text-slate-400">STATUS MIX</p>
                    <h3 className="mt-2 text-xl font-bold">{statusDistributionTitle}</h3>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-right">
                    <div className="text-xs text-slate-400">總記錄</div>
                    <div className="text-2xl font-black">{summary.totalRecords}</div>
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  {statusBreakdownItems.map((item) => (
                    <div key={item.key} className="rounded-2xl border border-white/8 bg-white/5 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className={`h-3 w-3 rounded-full ${item.dotAccent}`} />
                          <span className="text-sm font-semibold text-white">{item.label}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-black text-white">{item.count}</div>
                          <div className="text-xs text-slate-400">{item.percentage}%</div>
                        </div>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={`h-full rounded-full bg-gradient-to-r transition-all ${item.barAccent}`}
                          style={{ width: item.width }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 篩選和操作區域 */}
          <div className="bg-white rounded-2xl shadow-lg p-6 mb-8">
            <div className="flex flex-col space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center space-x-2">
                  <Filter className="w-5 h-5 text-gray-400" />
                  <span className="text-sm font-medium text-gray-700">篩選條件</span>
                </div>
                <p className="text-xs text-gray-500">
                  可依年份、月份、日期區間、部門、員工與狀態快速統計考勤資料
                </p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">年份</label>
                  <select
                    value={filters.year}
                    onChange={(e) => {
                      const nextYear = e.target.value;
                      setFilters(prev => ({
                        ...prev,
                        year: nextYear,
                        yearMonth:
                          nextYear && prev.yearMonth && !prev.yearMonth.startsWith(`${nextYear}-`)
                            ? ''
                            : prev.yearMonth,
                      }));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">全部年份</option>
                    {yearOptions.map((yearOption) => (
                      <option key={yearOption} value={yearOption}>
                        {yearOption} 年
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">月份</label>
                  <input
                    type="month"
                    value={filters.yearMonth}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      setFilters(prev => ({
                        ...prev,
                        yearMonth: nextValue,
                        year: nextValue ? nextValue.slice(0, 4) : prev.year,
                      }));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">開始日期</label>
                  <input
                    type="date"
                    value={filters.startDate}
                    onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">結束日期</label>
                  <input
                    type="date"
                    value={filters.endDate}
                    onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {canViewDepartmentRecords && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">部門</label>
                    <select
                      value={filters.department}
                      onChange={(e) => setFilters(prev => ({
                        ...prev,
                        department: e.target.value,
                        employeeId: '',
                      }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">全部部門</option>
                      {departments.map((dept) => (
                        <option key={dept.id} value={dept.name}>{dept.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {canViewDepartmentRecords && (
                  <EmployeeListSelect
                    label="員工"
                    value={filters.employeeId}
                    onChange={(value) => setFilters(prev => ({ ...prev, employeeId: value }))}
                    emptyLabel="全部員工"
                    departmentFilter={filters.department}
                  />
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">加班工時</label>
                  <select
                    value={filters.overtimeHours}
                    onChange={(e) => setFilters(prev => ({ ...prev, overtimeHours: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">全部</option>
                    <option value="0">無加班</option>
                    <option value=">0">有加班</option>
                    <option value=">2">超過2小時</option>
                    <option value=">4">超過4小時</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">狀態</label>
                  <select
                    value={filters.status}
                    onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black focus:ring-2 focus:ring-blue-500"
                  >
                    {ATTENDANCE_STATUS_OPTIONS.map((option) => (
                      <option key={option.value || 'all'} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-end gap-2 md:col-span-2 xl:col-span-4">
                  <button
                    onClick={handleDateFilter}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                  >
                    搜尋
                  </button>
                  <button
                    onClick={() => {
                      setFilters({
                        year: '',
                        yearMonth: '',
                        startDate: '',
                        endDate: '',
                        employeeId: '',
                        overtimeHours: '',
                        status: '',
                        department: '',
                      });
                      setPagination(prev => ({ ...prev, current: 1 }));
                    }}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
                  >
                    清除篩選
                  </button>
                  <button
                    onClick={() => handleExport('pdf')}
                    disabled={Boolean(exportingFormat)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 transition-colors text-sm"
                  >
                    <Download className="w-4 h-4" />
                    {exportingFormat === 'pdf' ? 'PDF 匯出中...' : '匯出 PDF'}
                  </button>
                  <button
                    onClick={() => handleExport('csv')}
                    disabled={Boolean(exportingFormat)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 transition-colors text-sm"
                  >
                    <Download className="w-4 h-4" />
                    {exportingFormat === 'csv' ? 'CSV 匯出中...' : '匯出 CSV'}
                  </button>
                  <button
                    onClick={() => handleExport('excel')}
                    disabled={Boolean(exportingFormat)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 transition-colors text-sm"
                  >
                    <Download className="w-4 h-4" />
                    {exportingFormat === 'excel' ? 'Excel 匯出中...' : '匯出 Excel'}
                  </button>
                  <span className="text-xs text-gray-500">
                    匯出內容包含目前篩選條件下的全部考勤資料
                  </span>
                </div>
                {exportFeedback && (
                  <div
                    className={`rounded-xl border px-4 py-3 text-sm ${
                      exportFeedback.type === 'success'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-red-200 bg-red-50 text-red-700'
                    }`}
                  >
                    {exportFeedback.message}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 考勤記錄表格 */}
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            {loading ? (
              <div className="p-6" aria-busy="true">
                <span className="sr-only">考勤記錄載入中</span>
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="h-5 w-32 animate-pulse rounded bg-gray-200" />
                  <div className="h-9 w-full max-w-xs animate-pulse rounded-lg bg-gray-100" />
                </div>
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <div className="grid min-w-[960px] grid-cols-9 gap-4 bg-gray-50 px-6 py-3">
                    {Array.from({ length: 9 }).map((_, index) => (
                      <div key={index} className="h-3 animate-pulse rounded bg-gray-200" />
                    ))}
                  </div>
                  <div className="divide-y divide-gray-100">
                    {Array.from({ length: 6 }).map((_, rowIndex) => (
                      <div key={rowIndex} className="grid min-w-[960px] grid-cols-9 gap-4 px-6 py-4">
                        {Array.from({ length: 9 }).map((__, columnIndex) => (
                          <div
                            key={columnIndex}
                            className={`h-4 animate-pulse rounded bg-gray-100 ${
                              columnIndex === 0 ? 'w-28' : columnIndex === 8 ? 'w-20' : 'w-16'
                            }`}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          員工
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => handleSort('date')}>
                          日期 {sortConfig.field === 'date' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          班次
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => handleSort('clockIn')}>
                          上班時間 {sortConfig.field === 'clockIn' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => handleSort('clockOut')}>
                          下班時間 {sortConfig.field === 'clockOut' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => handleSort('regular')}>
                          正常工時 {sortConfig.field === 'regular' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => handleSort('overtime')}>
                          加班工時 {sortConfig.field === 'overtime' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => handleSort('status')}>
                          狀態 {sortConfig.field === 'status' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          感染管控
                        </th>
                        {canViewClockReasons && (
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            打卡原因
                          </th>
                        )}
                        {/* GPS 欄位（管理員/HR 可見）*/}
                        {canManageAttendanceRecords && (
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            <MapPin className="w-4 h-4 inline mr-1" />打卡位置
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {sortedRecords.length === 0 ? (
                        <tr>
                          <td colSpan={recordTableColumnCount} className="px-6 py-16 text-center">
                            <div className="mx-auto flex max-w-md flex-col items-center">
                              <Calendar className="h-10 w-10 text-gray-300" aria-hidden="true" />
                              <h3 className="mt-4 text-base font-semibold text-gray-900">沒有符合條件的考勤記錄</h3>
                              <p className="mt-2 text-sm text-gray-500">
                                可調整年份、月份、部門、員工或狀態篩選後重新搜尋。
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  setFilters({
                                    year: '',
                                    yearMonth: '',
                                    startDate: '',
                                    endDate: '',
                                    employeeId: '',
                                    overtimeHours: '',
                                    status: '',
                                    department: '',
                                  });
                                  setPagination(prev => ({ ...prev, current: 1 }));
                                }}
                                className="mt-5 min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                              >
                                清除篩選
                              </button>
                            </div>
                          </td>
                        </tr>
                      ) : sortedRecords.map((record) => (
                        <tr key={record.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">
                              {record.employee?.name || '-'}
                            </div>
                            <div className="text-sm text-gray-500">
                              {record.employee?.employeeId || '-'}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">
                              {formatDate(record.workDate)}
                            </div>
                            <div className="text-sm text-gray-500">
                              {formatWeekday(record.workDate)}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm font-medium text-gray-900">
                              {getRecordShiftDisplay(record)}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-black">
                            {formatTime(record.clockInTime)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-black">
                            {formatTime(record.clockOutTime)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className="text-sm font-medium text-blue-600">
                              {record.regularHours} 小時
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`text-sm font-medium ${
                              record.overtimeHours > 0 ? 'text-orange-600' : 'text-gray-400'
                            }`}>
                              {record.overtimeHours} 小時
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              record.status === '正常' 
                                ? 'bg-green-100 text-green-800' 
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {record.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-xs text-gray-700">
                            <div className="space-y-1 min-w-48">
                              <div>
                                <span className="font-medium text-blue-700">上班：</span>
                                <span>發燒 {formatYesNo(record.clockInHasFever)}</span>
                                <span className="mx-1">/</span>
                                <span>體溫 {formatTemperature(record.clockInTemperature)}</span>
                                <span className="mx-1">/</span>
                                <span>咳嗽 {formatYesNo(record.clockInHasAcuteCough)}</span>
                              </div>
                              <div>
                                <span className="font-medium text-orange-700">下班：</span>
                                <span>發燒 {formatYesNo(record.clockOutHasFever)}</span>
                                <span className="mx-1">/</span>
                                <span>體溫 {formatTemperature(record.clockOutTemperature)}</span>
                                <span className="mx-1">/</span>
                                <span>咳嗽 {formatYesNo(record.clockOutHasAcuteCough)}</span>
                              </div>
                            </div>
                          </td>
                          {canViewClockReasons && (
                            <td className="px-6 py-4 text-xs text-gray-700">
                              <div className="space-y-1 min-w-44">
                                <div>
                                  <span className="font-medium text-green-700">提早上班：</span>
                                  <span>{record.clockInReason || '-'}</span>
                                </div>
                                <div>
                                  <span className="font-medium text-orange-700">延後下班：</span>
                                  <span>{record.clockOutReason || '-'}</span>
                                </div>
                              </div>
                            </td>
                          )}
                          {/* GPS 資訊（管理員/HR 可見）*/}
                          {canManageAttendanceRecords && (
                            <td className="px-6 py-4 text-xs">
                              {/* 上班打卡位置 */}
                              {record.clockInLatitude && record.clockInLongitude ? (
                                <div className="mb-1">
                                  <span className="text-green-600 font-medium">上班：</span>
                                  <a
                                    href={`https://www.google.com/maps?q=${record.clockInLatitude},${record.clockInLongitude}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ml-1 text-blue-600 hover:underline"
                                  >
                                    📍 查看地圖
                                  </a>
                                  {record.clockInAccuracy && (
                                    <span className="ml-1 text-gray-400">
                                      (±{Math.round(record.clockInAccuracy)}m)
                                    </span>
                                  )}
                                  {record.clockInAddress && (
                                    <div className="text-gray-500 truncate max-w-50" title={record.clockInAddress}>
                                      {record.clockInAddress}
                                    </div>
                                  )}
                                </div>
                              ) : record.clockInTime ? (
                                <div className="text-gray-400 mb-1">上班：無GPS</div>
                              ) : null}
                              
                              {/* 下班打卡位置 */}
                              {record.clockOutLatitude && record.clockOutLongitude ? (
                                <div>
                                  <span className="text-orange-600 font-medium">下班：</span>
                                  <a
                                    href={`https://www.google.com/maps?q=${record.clockOutLatitude},${record.clockOutLongitude}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ml-1 text-blue-600 hover:underline"
                                  >
                                    📍 查看地圖
                                  </a>
                                  {record.clockOutAccuracy && (
                                    <span className="ml-1 text-gray-400">
                                      (±{Math.round(record.clockOutAccuracy)}m)
                                    </span>
                                  )}
                                  {record.clockOutAddress && (
                                    <div className="text-gray-500 truncate max-w-50" title={record.clockOutAddress}>
                                      {record.clockOutAddress}
                                    </div>
                                  )}
                                </div>
                              ) : record.clockOutTime ? (
                                <div className="text-gray-400">下班：無GPS</div>
                              ) : null}
                              
                              {/* 完全無打卡記錄 */}
                              {!record.clockInTime && !record.clockOutTime && (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 分頁控制 */}
                {pagination.totalPages > 1 && (
                  <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200">
                    <div className="flex-1 flex justify-between sm:hidden">
                      <button
                        onClick={() => handlePageChange(pagination.current - 1)}
                        disabled={pagination.current === 1}
                        className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                      >
                        上一頁
                      </button>
                      <button
                        onClick={() => handlePageChange(pagination.current + 1)}
                        disabled={pagination.current === pagination.totalPages}
                        className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                      >
                        下一頁
                      </button>
                    </div>
                    <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm text-gray-700">
                          顯示 <span className="font-medium">{(pagination.current - 1) * pagination.pageSize + 1}</span> 到{' '}
                          <span className="font-medium">
                            {Math.min(pagination.current * pagination.pageSize, pagination.total)}
                          </span>{' '}
                          共 <span className="font-medium">{pagination.total}</span> 筆記錄
                        </p>
                      </div>
                      <div>
                        <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                          <button
                            onClick={() => handlePageChange(pagination.current - 1)}
                            disabled={pagination.current === 1}
                            className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                          >
                            <ChevronLeft className="h-5 w-5" />
                          </button>
                          {[...Array(pagination.totalPages)].map((_, i) => (
                            <button
                              key={i + 1}
                              onClick={() => handlePageChange(i + 1)}
                              className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                                pagination.current === i + 1
                                  ? 'z-10 bg-blue-50 border-blue-500 text-blue-600'
                                  : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                              }`}
                            >
                              {i + 1}
                            </button>
                          ))}
                          <button
                            onClick={() => handlePageChange(pagination.current + 1)}
                            disabled={pagination.current === pagination.totalPages}
                            className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                          >
                            <ChevronRight className="h-5 w-5" />
                          </button>
                        </nav>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </AuthenticatedLayout>
  );
}
