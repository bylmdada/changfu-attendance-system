'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Download, Clock, User, RefreshCw, Gift, Printer } from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import PageSkeleton from '@/components/PageSkeleton';
import EmptyState from '@/components/EmptyState';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import { downloadWorkbookAsXlsx, formatExportDate, getWeekdayLabel } from '@/lib/schedule-xlsx';
import { formatShiftDisplay, getShiftLabel } from '@/lib/shift-display';
import { formatHourLabel, formatScheduleTimeLabel, formatShiftHourSummary, type ShiftDefinitionDTO } from '@/lib/shift-definition-utils';
import {
  getScheduleConfirmStatusBadgeClass,
  getScheduleConfirmStatusLabel,
  SCHEDULE_CONFIRM_STATUS_OPTIONS,
  type ScheduleConfirmStatus,
} from '@/lib/schedule-confirmation-status';

interface Schedule {
  id: number;
  employeeId: number;
  workDate: string;
  shiftType: string;
  startTime: string;
  endTime: string;
  breakTime?: number;
  workHours?: number;
  expectedWorkHours?: number;
  specialLeaveHours?: number;
  compLeaveHours?: number;
  overtimeHours?: number;
  isNationalHoliday?: boolean;
  nationalHolidayName?: string | null;
  nationalHolidayHours?: number;
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

interface Holiday {
  id: number;
  name: string;
  date: string;
}

interface HolidayStats {
  total: number;
  taken: number;
  notRequired: number;
  pending: number;
  progress: number;
}

interface HolidayCompensation {
  id: number;
  holidayName: string;
  holidayDate: string;
  status: string;
  compensationDate: string | null;
}

interface ShiftCountSummary {
  shiftType: string;
  count: number;
}

// 班表確認資料
interface ScheduleConfirmData {
  status: ScheduleConfirmStatus;
  release: {
    id: number;
    yearMonth: string;
    publishedAt: string;
    deadline: string | null;
    version: number;
    lastModified: string;
    publisherName: string;
  } | null;
  confirmation: {
    id: number;
    confirmedAt: string;
    version: number;
    comment: string | null;
  } | null;
  scheduleSummary: {
    total: number;
    workDays: number;
    restDays: number;
    shiftA: number;
    shiftB: number;
    shiftC: number;
    shiftCounts?: ShiftCountSummary[];
  } | null;
}

interface ScheduleConfirmHistoryItem {
  yearMonth: string;
  status: ScheduleConfirmStatus;
  release: {
    id: number;
    yearMonth: string;
    department: string | null;
    publishedAt: string;
    deadline: string | null;
    version: number;
    lastModified: string;
    publisherName: string;
  } | null;
  confirmation: {
    id: number;
    confirmedAt: string;
    version: number;
    comment: string | null;
    isValid: boolean;
  } | null;
}

const SHIFT_COLORS: Record<string, string> = {
  'A': 'bg-blue-100 text-blue-800',
  'B': 'bg-green-100 text-green-800',
  'C': 'bg-purple-100 text-purple-800',
  'NH': 'bg-red-100 text-red-800',
  'RD': 'bg-gray-100 text-gray-800',
  'rd': 'bg-gray-100 text-gray-800',
  'FDL': 'bg-yellow-100 text-yellow-800',
  'OFF': 'bg-orange-100 text-orange-800',
  'TD': 'bg-cyan-100 text-cyan-800'
};

const REST_SHIFT_TYPES = ['RD', 'rd', 'OFF'];

const SHIFT_SUMMARY_STYLES = [
  { card: 'border-blue-200 bg-blue-50', label: 'text-blue-700', value: 'text-blue-950', badge: 'bg-blue-100 text-blue-800' },
  { card: 'border-emerald-200 bg-emerald-50', label: 'text-emerald-700', value: 'text-emerald-950', badge: 'bg-emerald-100 text-emerald-800' },
  { card: 'border-purple-200 bg-purple-50', label: 'text-purple-700', value: 'text-purple-950', badge: 'bg-purple-100 text-purple-800' },
  { card: 'border-amber-200 bg-amber-50', label: 'text-amber-700', value: 'text-amber-950', badge: 'bg-amber-100 text-amber-800' },
  { card: 'border-rose-200 bg-rose-50', label: 'text-rose-700', value: 'text-rose-950', badge: 'bg-rose-100 text-rose-800' },
  { card: 'border-cyan-200 bg-cyan-50', label: 'text-cyan-700', value: 'text-cyan-950', badge: 'bg-cyan-100 text-cyan-800' },
  { card: 'border-indigo-200 bg-indigo-50', label: 'text-indigo-700', value: 'text-indigo-950', badge: 'bg-indigo-100 text-indigo-800' },
  { card: 'border-slate-200 bg-slate-50', label: 'text-slate-700', value: 'text-slate-950', badge: 'bg-slate-100 text-slate-800' },
];

function roundHours(hours: number) {
  return Math.round(hours * 100) / 100;
}

function formatHours(hours: number) {
  return formatHourLabel(hours) || '0小時';
}

function formatYearMonthLabel(yearMonth: string) {
  const [year, month] = yearMonth.split('-');
  if (!year || !month) {
    return yearMonth;
  }
  return `${year}年${month}月`;
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getExpectedWorkHours(schedule: Schedule) {
  return schedule.expectedWorkHours ?? roundHours(
    (schedule.workHours ?? 0) +
    (schedule.specialLeaveHours ?? 0) +
    (schedule.compLeaveHours ?? 0)
  );
}

function getNationalHolidayHours(schedule: Schedule) {
  return schedule.nationalHolidayHours ?? (schedule.isNationalHoliday ? roundHours(schedule.workHours ?? 0) : 0);
}

export default function MySchedulePage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [shiftDefinitions, setShiftDefinitions] = useState<ShiftDefinitionDTO[]>([]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // 國定假日相關狀態
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidayStats, setHolidayStats] = useState<HolidayStats | null>(null);
  const [holidayCompensations, setHolidayCompensations] = useState<HolidayCompensation[]>([]);
  
  // 班表確認狀態
  const [confirmData, setConfirmData] = useState<ScheduleConfirmData | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmComment, setConfirmComment] = useState('');
  const [confirmPassword, setConfirmPassword] = useState(''); // 確認時輸入密碼
  const [confirming, setConfirming] = useState(false);
  const [confirmHistoryFilters, setConfirmHistoryFilters] = useState({
    yearMonth: '',
    status: '',
  });
  const [confirmHistory, setConfirmHistory] = useState<ScheduleConfirmHistoryItem[]>([]);
  const [confirmHistoryLoading, setConfirmHistoryLoading] = useState(false);

  // 加班工時狀態
  const [overtimeHours, setOvertimeHours] = useState(0);

  const scheduleHourTotals = useMemo(() => {
    const totals = schedules.reduce((acc, schedule) => {
      acc.workHours += schedule.workHours ?? 0;
      acc.expectedWorkHours += getExpectedWorkHours(schedule);
      acc.specialLeaveHours += schedule.specialLeaveHours ?? 0;
      acc.compLeaveHours += schedule.compLeaveHours ?? 0;
      acc.overtimeHours += schedule.overtimeHours ?? 0;
      acc.nationalHolidayHours += getNationalHolidayHours(schedule);
      return acc;
    }, {
      workHours: 0,
      expectedWorkHours: 0,
      specialLeaveHours: 0,
      compLeaveHours: 0,
      overtimeHours: 0,
      nationalHolidayHours: 0,
    });

    return {
      workHours: roundHours(totals.workHours),
      expectedWorkHours: roundHours(totals.expectedWorkHours),
      specialLeaveHours: roundHours(totals.specialLeaveHours),
      compLeaveHours: roundHours(totals.compLeaveHours),
      overtimeHours: roundHours(totals.overtimeHours),
      nationalHolidayHours: roundHours(totals.nationalHolidayHours),
      accountedHours: roundHours(totals.workHours + totals.specialLeaveHours + totals.compLeaveHours + totals.overtimeHours),
    };
  }, [schedules]);

  const shiftDefinitionMap = useMemo(() => {
    return new Map(shiftDefinitions.map((definition) => [definition.code, definition]));
  }, [shiftDefinitions]);

  const getShiftDisplayName = useCallback((shiftType: string) => {
    const definition = shiftDefinitionMap.get(shiftType);
    return definition
      ? `${definition.code}（${definition.name}）`
      : getShiftLabel(shiftType);
  }, [shiftDefinitionMap]);

  const getScheduleTimeText = useCallback((schedule: Schedule) => {
    const shiftDefinition = shiftDefinitionMap.get(schedule.shiftType) ?? null;
    const timeText = formatScheduleTimeLabel({
      shiftType: schedule.shiftType,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      shiftDefinition,
    });

    if (!shiftDefinition && !schedule.startTime && !schedule.endTime) {
      return getShiftLabel(schedule.shiftType);
    }

    return timeText;
  }, [shiftDefinitionMap]);

  const getCalendarScheduleLabel = useCallback((schedule: Pick<Schedule, 'shiftType' | 'startTime' | 'endTime'>) => {
    const definition = shiftDefinitionMap.get(schedule.shiftType) ?? null;
    const timeText = formatScheduleTimeLabel({
      shiftType: schedule.shiftType,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      shiftDefinition: definition,
    });

    if (!definition) {
      return formatShiftDisplay({
        shiftType: schedule.shiftType,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
      });
    }

    if (definition.requiresTime) {
      return `${definition.name} ${timeText}`;
    }

    return definition.name;
  }, [shiftDefinitionMap]);

  const getCalendarScheduleHourSummary = useCallback((schedule: Pick<Schedule, 'workHours' | 'specialLeaveHours' | 'compLeaveHours' | 'overtimeHours'>) => {
    return formatShiftHourSummary({
      workHours: schedule.workHours ?? 0,
      specialLeaveHours: schedule.specialLeaveHours ?? 0,
      compLeaveHours: schedule.compLeaveHours ?? 0,
      overtimeHours: schedule.overtimeHours ?? 0,
    });
  }, []);

  const scheduleDayStats = useMemo(() => {
    const actualWorkDays = schedules.filter((schedule) => (schedule.workHours ?? 0) > 0).length;
    const nonWorkDays = schedules.filter((schedule) => (schedule.workHours ?? 0) <= 0).length;

    return {
      scheduledDays: schedules.length,
      actualWorkDays,
      nonWorkDays,
      restDays: schedules.filter((schedule) => REST_SHIFT_TYPES.includes(schedule.shiftType)).length,
    };
  }, [schedules]);

  const shiftDistributionStats = useMemo(() => {
    const stats = new Map<string, {
      shiftType: string;
      count: number;
      workHours: number;
      expectedWorkHours: number;
      specialLeaveHours: number;
      compLeaveHours: number;
      overtimeHours: number;
      nationalHolidayHours: number;
      firstSeenIndex: number;
      timeLabels: Set<string>;
    }>();

    schedules.forEach((schedule, index) => {
      const shiftType = schedule.shiftType || '未設定';
      const current = stats.get(shiftType) ?? {
        shiftType,
        count: 0,
        workHours: 0,
        expectedWorkHours: 0,
        specialLeaveHours: 0,
        compLeaveHours: 0,
        overtimeHours: 0,
        nationalHolidayHours: 0,
        firstSeenIndex: index,
        timeLabels: new Set<string>(),
      };

      current.count += 1;
      current.workHours += schedule.workHours ?? 0;
      current.expectedWorkHours += getExpectedWorkHours(schedule);
      current.specialLeaveHours += schedule.specialLeaveHours ?? 0;
      current.compLeaveHours += schedule.compLeaveHours ?? 0;
      current.overtimeHours += schedule.overtimeHours ?? 0;
      current.nationalHolidayHours += getNationalHolidayHours(schedule);
      current.timeLabels.add(
        schedule.startTime && schedule.endTime
          ? `${schedule.startTime}-${schedule.endTime}`
          : '無固定時間'
      );
      stats.set(shiftType, current);
    });

    return Array.from(stats.values())
      .map((stat) => {
        const definition = shiftDefinitionMap.get(stat.shiftType);
        const label = getShiftDisplayName(stat.shiftType);
        const timeLabel = stat.timeLabels.size === 1
          ? Array.from(stat.timeLabels)[0]
          : '多時段';

        return {
          ...stat,
          label,
          timeLabel,
          sortOrder: definition?.sortOrder ?? 9999,
          workHours: roundHours(stat.workHours),
          expectedWorkHours: roundHours(stat.expectedWorkHours),
          specialLeaveHours: roundHours(stat.specialLeaveHours),
          compLeaveHours: roundHours(stat.compLeaveHours),
          overtimeHours: roundHours(stat.overtimeHours),
          nationalHolidayHours: roundHours(stat.nationalHolidayHours),
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.firstSeenIndex - b.firstSeenIndex || a.shiftType.localeCompare(b.shiftType));
  }, [getShiftDisplayName, schedules, shiftDefinitionMap]);

  const shiftDistributionText = useMemo(() => {
    if (shiftDistributionStats.length === 0) {
      return '本月無排班';
    }

    return shiftDistributionStats
      .map((stat) => `${stat.label}${stat.count}天`)
      .join('、');
  }, [shiftDistributionStats]);

  // Toast 顯示函數
  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    // 設定頁面標題
    document.title = '我的班表 - 長福會考勤系統';
    fetchUser();
  }, []);

  useEffect(() => {
    if (user) {
      fetchSchedules();
      fetchHolidayStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedYear, selectedMonth]);

  useEffect(() => {
    if (user) {
      fetchShiftDefinitions();
    }
  }, [user]);

  // 獲取國定假日統計 - 使用年度查詢
  useEffect(() => {
    if (user) {
      fetchHolidayStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedYear]);

  // 獲取班表確認狀態
  useEffect(() => {
    if (user) {
      fetchConfirmStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedYear, selectedMonth]);

  useEffect(() => {
    if (user) {
      fetchConfirmHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // 獲取加班工時
  useEffect(() => {
    if (user) {
      fetchOvertimeHours();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedYear, selectedMonth]);

  const fetchUser = async () => {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user || data);
      } else {
        console.error('Failed to fetch user');
      }
    } catch (error) {
      console.error('獲取用戶資訊失敗:', error);
    }
  };

  const fetchSchedules = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/my-schedules?year=${selectedYear}&month=${selectedMonth}`, {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setSchedules(data.schedules || []);
      } else {
        console.error('獲取班表失敗:', response.status);
        setSchedules([]);
      }
    } catch (error) {
      console.error('獲取班表失敗:', error);
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchHolidayStats = async () => {
    try {
      const response = await fetch(`/api/holiday-compensations/stats?year=${selectedYear}`, {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setHolidays(data.holidays || []);
        setHolidayStats(data.stats || null);
        setHolidayCompensations(data.compensations || []);
      }
    } catch (error) {
      console.error('獲取國定假日統計失敗:', error);
    }
  };

  const fetchShiftDefinitions = async () => {
    try {
      const response = await fetch('/api/shift-definitions?includeInactive=true', {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setShiftDefinitions(data.shifts || []);
      }
    } catch (error) {
      console.error('獲取班別設定失敗:', error);
    }
  };

  // 取得班表確認狀態
  const fetchConfirmStatus = async () => {
    try {
      const yearMonth = `${selectedYear}-${selectedMonth.toString().padStart(2, '0')}`;
      const response = await fetch(`/api/schedule-confirmation?type=my-status&yearMonth=${yearMonth}`, {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setConfirmData(data);
      }
    } catch (error) {
      console.error('獲取班表確認狀態失敗:', error);
    }
  };

  const fetchConfirmHistory = async (filters = confirmHistoryFilters) => {
    try {
      setConfirmHistoryLoading(true);

      const queryParams = new URLSearchParams({ type: 'my-history' });
      if (filters.yearMonth) {
        queryParams.set('yearMonth', filters.yearMonth);
      }
      if (filters.status) {
        queryParams.set('status', filters.status);
      }

      const response = await fetch(`/api/schedule-confirmation?${queryParams.toString()}`, {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setConfirmHistory(data.items || []);
      } else {
        setConfirmHistory([]);
      }
    } catch (error) {
      console.error('獲取班表確認歷史失敗:', error);
      setConfirmHistory([]);
    } finally {
      setConfirmHistoryLoading(false);
    }
  };

  // 取得加班工時
  const fetchOvertimeHours = async () => {
    try {
      const startDate = `${selectedYear}-${selectedMonth.toString().padStart(2, '0')}-01`;
      const lastDay = new Date(selectedYear, selectedMonth, 0).getDate();
      const endDate = `${selectedYear}-${selectedMonth.toString().padStart(2, '0')}-${lastDay}`;
      
      const response = await fetch(
        `/api/overtime-requests?startDate=${startDate}&endDate=${endDate}&status=APPROVED`,
        { credentials: 'include' }
      );

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.overtimeRequests) {
          setOvertimeHours(data.summary?.approvedEffectiveHours ?? 0);
        }
      }
    } catch (error) {
      console.error('獲取加班工時失敗:', error);
    }
  };

  // 確認班表
  const handleConfirm = async () => {
    try {
      setConfirming(true);
      const yearMonth = `${selectedYear}-${selectedMonth.toString().padStart(2, '0')}`;
      
      const response = await fetchJSONWithCSRF('/api/schedule-confirmation', {
        method: 'POST',
        body: {
          action: 'confirm',
          yearMonth,
          comment: confirmComment,
          password: confirmPassword // 新增密碼驗證
        }
      });

      const data = await response.json();

      if (data.success) {
        showToast('success', '班表確認成功');
        setShowConfirmModal(false);
        setConfirmComment('');
        setConfirmPassword('');
        fetchConfirmStatus();
        fetchConfirmHistory();
      } else {
        showToast('error', data.error || '確認失敗');
      }
    } catch (error) {
      console.error('確認班表失敗:', error);
      showToast('error', '確認失敗，請稍後再試');
    } finally {
      setConfirming(false);
    }
  };

  const exportToPDF = async () => {
    try {
      const response = await fetchJSONWithCSRF('/api/my-schedules/export-pdf', {
        method: 'POST',
        body: {
          year: selectedYear,
          month: selectedMonth,
          schedules: schedules,
          user: {
            employeeId: user?.employee?.employeeId || '未知',
            name: user?.employee?.name || '未知員工',
            department: user?.employee?.department || '未知部門'
          }
        }
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `個人班表_${selectedYear}年${selectedMonth.toString().padStart(2, '0')}月.html`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        showToast('error', '匯出失敗');
      }
    } catch (error) {
      console.error('匯出失敗:', error);
      showToast('error', '匯出失敗，請稍後再試');
    }
  };

  const exportToXlsx = useCallback(async () => {
    if (!user?.employee) {
      showToast('error', '無法取得員工資料，請重新整理後再試');
      return;
    }

    try {
      const monthLabel = `${selectedYear}年${selectedMonth.toString().padStart(2, '0')}月`;
      const exportTime = new Date().toLocaleString('zh-TW', { hour12: false });
      const summaryRows: (string | number)[][] = [
        ['項目', '內容'],
        ['查詢月份', monthLabel],
        ['員工編號', user.employee.employeeId],
        ['姓名', user.employee.name],
        ['部門', user.employee.department || '-'],
        ['職位', user.employee.position || '-'],
        ['已排班天數', scheduleDayStats.scheduledDays],
        ['實際上班天數', scheduleDayStats.actualWorkDays],
        ['非上班天數', scheduleDayStats.nonWorkDays],
        ['應計工時', formatHours(scheduleHourTotals.expectedWorkHours)],
        ['實際工時', formatHours(scheduleHourTotals.workHours)],
        ['特休時數', formatHours(scheduleHourTotals.specialLeaveHours)],
        ['補休時數', formatHours(scheduleHourTotals.compLeaveHours)],
        ['班表內加班時數', formatHours(scheduleHourTotals.overtimeHours)],
        ['已核准加班申請時數', formatHours(overtimeHours)],
        ['國假工時', formatHours(scheduleHourTotals.nationalHolidayHours)],
        ['工時計入總和', formatHours(scheduleHourTotals.accountedHours)],
        ['班別分布', shiftDistributionText],
        ['匯出時間', exportTime],
      ];

      const detailRows: (string | number)[][] = [
        ['日期', '星期', '班別代碼', '班別顯示', '時間', '工時摘要', '工時', '應計工時', '特休時數', '補休時數', '加班時數', '國假工時'],
        ...(
          schedules.length > 0
            ? [...schedules]
              .sort((a, b) => a.workDate.localeCompare(b.workDate))
              .map((schedule) => [
                formatExportDate(schedule.workDate),
                getWeekdayLabel(schedule.workDate),
                schedule.shiftType,
                getCalendarScheduleLabel(schedule),
                getScheduleTimeText(schedule),
                getCalendarScheduleHourSummary(schedule),
                schedule.workHours ?? 0,
                getExpectedWorkHours(schedule),
                schedule.specialLeaveHours ?? 0,
                schedule.compLeaveHours ?? 0,
                schedule.overtimeHours ?? 0,
                getNationalHolidayHours(schedule),
              ])
            : [['-', '-', '-', '本月尚無班表資料', '-', '-', 0, 0, 0, 0, 0, 0]]
        ),
      ];

      await downloadWorkbookAsXlsx({
        fileName: `個人班表_${selectedYear}年${selectedMonth.toString().padStart(2, '0')}月_${user.employee.employeeId}.xlsx`,
        sheets: [
          {
            name: '班表摘要',
            rows: summaryRows,
            columnWidths: [18, 36],
          },
          {
            name: '班表明細',
            rows: detailRows,
            columnWidths: [14, 8, 12, 24, 20, 20, 10, 12, 10, 10, 10, 10],
          },
        ],
      });

      showToast('success', '班表.xlsx 匯出成功');
    } catch (error) {
      console.error('匯出班表 xlsx 失敗:', error);
      showToast('error', '匯出班表.xlsx 失敗，請稍後再試');
    }
  }, [
    getCalendarScheduleHourSummary,
    getCalendarScheduleLabel,
    getScheduleTimeText,
    overtimeHours,
    scheduleDayStats.actualWorkDays,
    scheduleDayStats.nonWorkDays,
    scheduleDayStats.scheduledDays,
    scheduleHourTotals.accountedHours,
    scheduleHourTotals.compLeaveHours,
    scheduleHourTotals.expectedWorkHours,
    scheduleHourTotals.nationalHolidayHours,
    scheduleHourTotals.overtimeHours,
    scheduleHourTotals.specialLeaveHours,
    scheduleHourTotals.workHours,
    schedules,
    selectedMonth,
    selectedYear,
    showToast,
    shiftDistributionText,
    user,
  ]);

  // 列印月曆班表
  const printCalendar = () => {
    const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);
    const firstDay = new Date(selectedYear, selectedMonth - 1, 1);
    const startDay = firstDay.getDay();
    const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
    
    // 統計資料
    const workDays = scheduleDayStats.actualWorkDays;
    const restDays = scheduleDayStats.nonWorkDays;
    const printTotals = {
      workHours: schedules.reduce((sum, schedule) => sum + (schedule.workHours ?? 0), 0),
      expectedWorkHours: schedules.reduce((sum, schedule) => sum + getExpectedWorkHours(schedule), 0),
      specialLeaveHours: schedules.reduce((sum, schedule) => sum + (schedule.specialLeaveHours ?? 0), 0),
      compLeaveHours: schedules.reduce((sum, schedule) => sum + (schedule.compLeaveHours ?? 0), 0),
      overtimeHours: schedules.reduce((sum, schedule) => sum + (schedule.overtimeHours ?? 0), 0),
      nationalHolidayHours: schedules.reduce((sum, schedule) => sum + getNationalHolidayHours(schedule), 0),
    };

    // 生成日曆 HTML
    let calendarCells = '';
    for (let i = 0; i < startDay; i++) {
      calendarCells += '<div class="cell empty"></div>';
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${selectedYear}-${selectedMonth.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      const schedule = schedules.find(s => s.workDate === dateStr);
      const shiftType = schedule?.shiftType || '';
      const shiftLabel = schedule
        ? getCalendarScheduleLabel(schedule)
        : getShiftLabel(shiftType);
      const hourSummary = schedule
        ? getCalendarScheduleHourSummary(schedule)
        : '';
      const isRest = schedule ? (schedule.workHours ?? 0) <= 0 : false;
      calendarCells += `
        <div class="cell ${isRest ? 'rest' : 'work'}">
          <div class="day">${day}</div>
          ${shiftType ? `<div class="shift ${escapeHtml(shiftType.toLowerCase())}">${escapeHtml(shiftLabel.split(' ')[0])}</div>` : ''}
          ${schedule ? `<div class="hours">${escapeHtml(hourSummary)}</div>` : ''}
        </div>
      `;
    }

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <title>${selectedYear}年${selectedMonth}月班表 - ${escapeHtml(user?.employee?.name || '員工')}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Microsoft JhengHei', sans-serif; padding: 15px; }
    .header { text-align: center; margin-bottom: 15px; }
    .header h1 { font-size: 20px; color: #1e40af; }
    .header p { font-size: 12px; color: #666; margin-top: 4px; }
    .info { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 11px; }
    .stats { display: flex; gap: 15px; background: #f1f5f9; padding: 8px 12px; border-radius: 6px; }
    .stat { text-align: center; }
    .stat-value { font-size: 16px; font-weight: bold; color: #1e40af; }
    .stat-label { font-size: 10px; color: #666; }
    .calendar { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; border: 1px solid #e5e7eb; padding: 5px; border-radius: 8px; }
    .weekday { background: #1e40af; color: white; padding: 8px; text-align: center; font-weight: bold; font-size: 12px; border-radius: 4px; }
    .cell { border: 1px solid #e5e7eb; padding: 6px; min-height: 55px; border-radius: 4px; }
    .cell.empty { background: #f9fafb; }
    .cell.rest { background: #fef3c7; }
    .cell.work { background: #f0fdf4; }
    .day { font-weight: bold; font-size: 12px; margin-bottom: 3px; }
    .shift { font-size: 10px; padding: 2px 5px; border-radius: 3px; text-align: center; font-weight: 500; }
    .hours { margin-top: 3px; font-size: 9px; color: #475569; text-align: center; }
    .shift.a { background: #dbeafe; color: #1e40af; }
    .shift.b { background: #dcfce7; color: #166534; }
    .shift.c { background: #f3e8ff; color: #7c3aed; }
    .shift.nh { background: #fee2e2; color: #991b1b; }
    .shift.rd, .shift.off { background: #f3f4f6; color: #374151; }
    .legend { margin-top: 12px; padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; }
    .legend-title { font-weight: 600; font-size: 11px; color: #475569; margin-bottom: 6px; }
    .legend-items { display: flex; flex-wrap: wrap; gap: 12px; font-size: 10px; color: #64748b; }
    .legend-item { display: flex; align-items: center; gap: 4px; }
    .legend-badge { padding: 2px 6px; border-radius: 3px; font-weight: 500; font-size: 9px; }
    .legend-badge.a { background: #dbeafe; color: #1e40af; }
    .legend-badge.b { background: #dcfce7; color: #166534; }
    .legend-badge.c { background: #f3e8ff; color: #7c3aed; }
    .legend-badge.nh { background: #fee2e2; color: #991b1b; }
    .legend-badge.rd { background: #f3f4f6; color: #374151; }
    .legend-badge.off { background: #fef3c7; color: #92400e; }
    .legend-badge.fdl { background: #fef08a; color: #854d0e; }
    .footer { text-align: center; margin-top: 10px; font-size: 10px; color: #9ca3af; }
    .print-btn { position: fixed; top: 15px; right: 15px; padding: 10px 20px; background: #1e40af; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; }
    .print-btn:hover { background: #1e3a8a; }
    @media print { .print-btn { display: none; } }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">🖨️ 列印 / 存為 PDF</button>
  <div class="header">
    <h1>📅 ${selectedYear}年${selectedMonth}月 個人班表</h1>
    <p>${escapeHtml(user?.employee?.name || '員工')} | ${escapeHtml(user?.employee?.department || '部門')} | 員工編號: ${escapeHtml(user?.employee?.employeeId || '-')}</p>
  </div>
  <div class="info">
    <div>製表日期：${new Date().toLocaleDateString('zh-TW')}</div>
    <div class="stats">
      <div class="stat"><div class="stat-value">${workDays}</div><div class="stat-label">出勤天</div></div>
      <div class="stat"><div class="stat-value">${restDays}</div><div class="stat-label">非出勤</div></div>
      ${shiftDistributionStats.map((stat) => `
        <div class="stat"><div class="stat-value">${stat.count}</div><div class="stat-label">${escapeHtml(stat.label)}</div></div>
      `).join('')}
      <div class="stat"><div class="stat-value">${formatHours(roundHours(printTotals.expectedWorkHours))}</div><div class="stat-label">應上工時</div></div>
      <div class="stat"><div class="stat-value">${formatHours(printTotals.workHours)}</div><div class="stat-label">工時</div></div>
      <div class="stat"><div class="stat-value">${formatHours(printTotals.specialLeaveHours)}</div><div class="stat-label">特休</div></div>
      <div class="stat"><div class="stat-value">${formatHours(printTotals.compLeaveHours)}</div><div class="stat-label">補休</div></div>
      <div class="stat"><div class="stat-value">${formatHours(printTotals.overtimeHours)}</div><div class="stat-label">加班</div></div>
      <div class="stat"><div class="stat-value">${formatHours(printTotals.nationalHolidayHours)}</div><div class="stat-label">國定假日</div></div>
    </div>
  </div>
  <div class="calendar">
    ${weekdayNames.map(d => `<div class="weekday">${d}</div>`).join('')}
    ${calendarCells}
  </div>
  <div class="legend">
    <div class="legend-title">📋 班別說明</div>
    <div class="legend-items">
      ${shiftDistributionStats.map((stat) => {
       const timeLabel = stat.timeLabel === '無固定時間' ? '' : ` ${stat.timeLabel}`;
       return `<div class="legend-item"><span class="legend-badge ${escapeHtml(stat.shiftType.toLowerCase())}">${escapeHtml(stat.shiftType)}</span> ${escapeHtml(stat.label)}${escapeHtml(timeLabel)}</div>`;
      }).join('') || '<div class="legend-item">本月無排班資料</div>'}
    </div>
  </div>
  <div class="footer">長福會考勤管理系統</div>
</body>
</html>
      `);
      printWindow.document.close();
    }
  };

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month, 0).getDate();
  };

  const getScheduleForDate = (date: string) => {
    return schedules.find(schedule => schedule.workDate === date);
  };

  // 將日期轉為本地日期格式
  const formatDateLocal = (dateStr: string | null | undefined) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  // 取得該日期的國定假日資訊
  const getHolidayForDate = (date: string) => {
    return holidays.find(h => formatDateLocal(h.date) === date);
  };

  // 取得該日期的補休資訊
  const getCompensationForDate = (date: string) => {
    return holidayCompensations.find(c => formatDateLocal(c.compensationDate) === date);
  };


  const generateCalendar = () => {
    const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);
    const firstDay = new Date(selectedYear, selectedMonth - 1, 1);
    const startDay = firstDay.getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    const calendar = [];
    
    // 添加空白天數（月初之前的空白）
    for (let i = 0; i < startDay; i++) {
      calendar.push(null);
    }
    
    // 添加該月的所有天數
    for (let day = 1; day <= daysInMonth; day++) {
      calendar.push(day);
    }
    
    return calendar;
  };

  const handlePrevMonth = () => {
    if (selectedMonth === 1) {
      setSelectedMonth(12);
      setSelectedYear(selectedYear - 1);
    } else {
      setSelectedMonth(selectedMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedMonth(1);
      setSelectedYear(selectedYear + 1);
    } else {
      setSelectedMonth(selectedMonth + 1);
    }
  };

  const formatDate = (day: number) => {
    return `${selectedYear}-${selectedMonth.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  };

  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const calendar = generateCalendar();

  if (loading) {
    return <PageSkeleton title="個人班表載入中" />;
  }

  return (
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 標題區 */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center">
                <Calendar className="w-8 h-8 text-blue-600 mr-3" />
                個人班表查詢
              </h1>
              <p className="text-gray-600 mt-2">查看您的工作班表安排</p>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="/shift-exchange"
                className="bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors flex items-center"
              >
                <RefreshCw className="w-5 h-5 mr-2" />
                申請調班
              </a>
              <button
                onClick={printCalendar}
                className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors flex items-center"
              >
                <Printer className="w-5 h-5 mr-2" />
                列印月曆
              </button>
              <button
                onClick={exportToPDF}
                className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors flex items-center"
              >
                <Download className="w-5 h-5 mr-2" />
                匯出月曆
              </button>
              <button
                onClick={exportToXlsx}
                className="bg-emerald-600 text-white px-6 py-3 rounded-lg hover:bg-emerald-700 transition-colors flex items-center"
              >
                <Download className="w-5 h-5 mr-2" />
                匯出班表.xlsx
              </button>
            </div>
          </div>
        </div>

        {/* 月份導航 */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={handlePrevMonth}
              className="flex items-center px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ChevronLeft className="w-5 h-5 mr-1" />
              上個月
            </button>
            
            <h2 className="text-2xl font-bold text-gray-900">
              {selectedYear}年{selectedMonth.toString().padStart(2, '0')}月
            </h2>
            
            <button
              onClick={handleNextMonth}
              className="flex items-center px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              下個月
              <ChevronRight className="w-5 h-5 ml-1" />
            </button>
          </div>

          {/* 班表確認卡片 - 當有排班時顯示 */}
          {confirmData && schedules.length > 0 && (
            <div className={`mb-6 p-4 rounded-lg border ${
              confirmData.status === 'CONFIRMED' 
                ? 'bg-green-50 border-green-200'
                : confirmData.status === 'NEED_RECONFIRM'
                ? 'bg-orange-50 border-orange-300'
                : confirmData.status === 'EXPIRED'
                ? 'bg-red-50 border-red-300'
                : 'bg-yellow-50 border-yellow-300'
            }`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {confirmData.status === 'CONFIRMED' ? (
                    <>
                      <span className="text-green-600 text-xl">✅</span>
                      <h3 className="font-semibold text-gray-900">
                        {selectedYear}年{selectedMonth.toString().padStart(2, '0')}月班表已確認
                      </h3>
                    </>
                  ) : confirmData.status === 'NEED_RECONFIRM' ? (
                    <>
                      <span className="text-orange-600 text-xl">🔄</span>
                      <h3 className="font-semibold text-gray-900">
                        班表已更新，請重新確認
                      </h3>
                    </>
                  ) : confirmData.status === 'EXPIRED' ? (
                    <>
                      <span className="text-red-600 text-xl">⚠️</span>
                      <h3 className="font-semibold text-gray-900">
                        確認已逾期
                      </h3>
                    </>
                  ) : (
                    <>
                      <span className="text-yellow-600 text-xl">📋</span>
                      <h3 className="font-semibold text-gray-900">
                        {selectedYear}年{selectedMonth.toString().padStart(2, '0')}月班表待確認
                      </h3>
                    </>
                  )}
                </div>
                {confirmData.status !== 'CONFIRMED' && (
                  <button
                    onClick={() => setShowConfirmModal(true)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                  >
                    ✓ {confirmData.status === 'NEED_RECONFIRM' ? '重新確認' : '確認班表'}
                  </button>
                )}
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">發布日期：</span>
                  <span className="text-gray-900 font-medium ml-1">
                    {confirmData.release?.publishedAt ? new Date(confirmData.release.publishedAt).toLocaleDateString() : '-'}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">確認截止：</span>
                  <span className="text-gray-900 font-medium ml-1">
                    {confirmData.release?.deadline ? new Date(confirmData.release.deadline).toLocaleDateString() : '本月底'}
                  </span>
                </div>
                {confirmData.confirmation && (
                  <div>
                    <span className="text-gray-500">確認時間：</span>
                    <span className="text-gray-900 font-medium ml-1">
                      {new Date(confirmData.confirmation.confirmedAt).toLocaleString()}
                    </span>
                  </div>
                )}
                {confirmData.scheduleSummary && (
                  <div>
                    <span className="text-gray-500">班表摘要：</span>
                    <span className="text-gray-900 font-medium ml-1">
                      工作{confirmData.scheduleSummary.workDays}天 / 休息{confirmData.scheduleSummary.restDays}天
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">班表確認查詢</h3>
                <p className="text-sm text-gray-500">可查詢個人過往月份的班表確認狀態與確認時間。</p>
              </div>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-700">
                共 {confirmHistory.length} 筆
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">月份</label>
                <input
                  type="month"
                  value={confirmHistoryFilters.yearMonth}
                  onChange={(event) => setConfirmHistoryFilters((prev) => ({
                    ...prev,
                    yearMonth: event.target.value,
                  }))}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-black focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">班表確認狀態</label>
                <select
                  value={confirmHistoryFilters.status}
                  onChange={(event) => setConfirmHistoryFilters((prev) => ({
                    ...prev,
                    status: event.target.value,
                  }))}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-black focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">全部狀態</option>
                  {SCHEDULE_CONFIRM_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end gap-2 md:col-span-2">
                <button
                  type="button"
                  onClick={() => fetchConfirmHistory(confirmHistoryFilters)}
                  disabled={confirmHistoryLoading}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {confirmHistoryLoading ? '查詢中...' : '查詢確認狀態'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const resetFilters = { yearMonth: '', status: '' };
                    setConfirmHistoryFilters(resetFilters);
                    fetchConfirmHistory(resetFilters);
                  }}
                  className="rounded-lg bg-gray-100 px-4 py-2 text-gray-700 transition-colors hover:bg-gray-200"
                >
                  重置
                </button>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">月份</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">狀態</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">發布者</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">發布日期</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">確認截止</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">確認時間</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">備註</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {confirmHistory.length > 0 ? confirmHistory.map((item) => (
                    <tr key={`${item.yearMonth}-${item.release?.id ?? 'none'}`}>
                      <td className="whitespace-nowrap px-4 py-4 text-sm font-medium text-gray-900">
                        {formatYearMonthLabel(item.yearMonth)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-sm">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getScheduleConfirmStatusBadgeClass(item.status)}`}>
                          {getScheduleConfirmStatusLabel(item.status)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">
                        {item.release?.publisherName ?? '-'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">
                        {item.release?.publishedAt ? new Date(item.release.publishedAt).toLocaleString('zh-TW') : '-'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">
                        {item.release?.deadline ? new Date(item.release.deadline).toLocaleDateString('zh-TW') : '-'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">
                        {item.confirmation?.confirmedAt ? new Date(item.confirmation.confirmedAt).toLocaleString('zh-TW') : '-'}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-700">
                        {item.confirmation?.comment || '-'}
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                        {confirmHistoryLoading ? '班表確認紀錄載入中...' : '目前沒有符合篩選條件的班表確認紀錄。'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 國定假日年度統計 */}
          {holidayStats && (
            <div className="mb-6 rounded-lg border border-red-200 bg-linear-to-r from-red-50 to-orange-50 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Gift className="w-5 h-5 text-red-600" />
                  <h3 className="font-semibold text-gray-900">{selectedYear}年 國定假日休假統計</h3>
                </div>
                <div className="text-sm text-gray-600">
                  進度：{holidayStats.progress}%
                </div>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-900">{holidayStats.total}</div>
                  <div className="text-xs text-gray-600">應休天數</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{holidayStats.taken}</div>
                  <div className="text-xs text-gray-600">已補休</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{holidayStats.notRequired}</div>
                  <div className="text-xs text-gray-600">當天休</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">{holidayStats.pending}</div>
                  <div className="text-xs text-gray-600">待補休</div>
                </div>
              </div>
              {/* 進度條 */}
              <div className="mt-3">
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="h-2 rounded-full bg-linear-to-r from-green-500 to-blue-500 transition-all duration-300"
                    style={{ width: `${holidayStats.progress}%` }}
                  ></div>
                </div>
              </div>
            </div>
          )}

          {/* 統計資訊 */}
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="text-blue-600 text-sm font-medium">排班天數</div>
              <div className="text-2xl font-bold text-blue-900">
                {scheduleDayStats.scheduledDays}
              </div>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <div className="text-green-600 text-sm font-medium">實際出勤天數</div>
              <div className="text-2xl font-bold text-green-900">
                {scheduleDayStats.actualWorkDays}
              </div>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="text-gray-600 text-sm font-medium">非出勤天數</div>
              <div className="text-2xl font-bold text-gray-900">
                {scheduleDayStats.nonWorkDays}
              </div>
            </div>
            <div className="bg-indigo-50 p-4 rounded-lg">
              <div className="text-indigo-600 text-sm font-medium">應上工時</div>
              <div className="text-2xl font-bold text-indigo-900">
                {formatHours(scheduleHourTotals.expectedWorkHours)}
              </div>
            </div>
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="text-blue-600 text-sm font-medium">實際工時</div>
              <div className="text-2xl font-bold text-blue-900">
                {formatHours(scheduleHourTotals.workHours)}
              </div>
            </div>
            <div className="bg-yellow-50 p-4 rounded-lg">
              <div className="text-yellow-700 text-sm font-medium">特休時數</div>
              <div className="text-2xl font-bold text-yellow-900">
                {formatHours(scheduleHourTotals.specialLeaveHours)}
              </div>
            </div>
            <div className="bg-orange-50 p-4 rounded-lg">
              <div className="text-orange-600 text-sm font-medium">補休時數</div>
              <div className="text-2xl font-bold text-orange-900">
                {formatHours(scheduleHourTotals.compLeaveHours)}
              </div>
            </div>
            <div className="bg-red-50 p-4 rounded-lg">
              <div className="text-red-600 text-sm font-medium">排班加班</div>
              <div className="text-2xl font-bold text-red-900">
                {formatHours(scheduleHourTotals.overtimeHours)}
              </div>
            </div>
            <div className="bg-rose-50 p-4 rounded-lg">
              <div className="text-rose-600 text-sm font-medium">國定假日時數</div>
              <div className="text-2xl font-bold text-rose-900">
                {formatHours(scheduleHourTotals.nationalHolidayHours)}
              </div>
            </div>
            <div className="bg-slate-50 p-4 rounded-lg">
              <div className="text-slate-600 text-sm font-medium">時數合計</div>
              <div className="text-2xl font-bold text-slate-900">
                {formatHours(scheduleHourTotals.accountedHours)}
              </div>
            </div>
          </div>

          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">班別分布</h3>
                <p className="text-sm text-gray-500">
                  依班別設定與本月班表動態統計，不再固定只顯示 A / B 班。
                </p>
              </div>
              <div className="text-xs text-gray-500">
                已設定班別 {shiftDefinitions.length} 種 / 本月使用 {shiftDistributionStats.length} 種
              </div>
            </div>

            {shiftDistributionStats.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {shiftDistributionStats.map((stat, index) => {
                  const style = SHIFT_SUMMARY_STYLES[index % SHIFT_SUMMARY_STYLES.length];

                  return (
                    <div key={stat.shiftType} className={`rounded-lg border p-3 ${style.card}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className={`truncate text-sm font-semibold ${style.label}`} title={stat.label}>
                            {stat.label}
                          </div>
                          <div className="mt-1 text-xs text-gray-500">{stat.timeLabel}</div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${style.badge}`}>
                          {stat.shiftType}
                        </span>
                      </div>
                      <div className={`mt-3 text-2xl font-bold ${style.value}`}>{stat.count}天</div>
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-600">
                        <span>應 {formatHours(stat.expectedWorkHours)}</span>
                        <span>工 {formatHours(stat.workHours)}</span>
                        {stat.specialLeaveHours > 0 && <span>特 {formatHours(stat.specialLeaveHours)}</span>}
                        {stat.compLeaveHours > 0 && <span>補 {formatHours(stat.compLeaveHours)}</span>}
                        {stat.overtimeHours > 0 && <span>加 {formatHours(stat.overtimeHours)}</span>}
                        {stat.nationalHolidayHours > 0 && <span>國 {formatHours(stat.nationalHolidayHours)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
                本月尚無排班資料；有排班後會依班別設定自動顯示各班別次數。
              </div>
            )}
          </div>

          {/* 日曆顯示 */}
          <div className="grid grid-cols-7 gap-1">
            {/* 星期標題 */}
            {weekdays.map((day) => (
              <div key={day} className="p-3 text-center font-medium text-gray-700 bg-gray-100 rounded">
                {day}
              </div>
            ))}
            
            {/* 日期格子 */}
            {calendar.map((day, index) => {
              if (day === null) {
                return <div key={`empty-${index}`} className="p-3 h-28"></div>;
              }
              
              const dateStr = formatDate(day);
              const schedule = getScheduleForDate(dateStr);
              const isToday = dateStr === new Date().toISOString().split('T')[0];
              const holiday = getHolidayForDate(dateStr);
              const compensation = getCompensationForDate(dateStr);
              
              return (
                <div
                  key={dateStr}
                  className={`p-2 h-28 border rounded-lg ${
                    holiday ? 'border-red-300 bg-red-50' : 
                    compensation ? 'border-orange-300 bg-orange-50' :
                    isToday ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'
                  } hover:shadow-md transition-shadow`}
                >
                  <div className={`text-sm font-medium ${isToday ? 'text-blue-600' : 'text-gray-900'}`}>
                    {day}
                  </div>
                  {/* 國定假日名稱 */}
                  {holiday && (
                    <div className="text-xs text-red-600 font-medium truncate" title={holiday.name}>
                      🎌 {holiday.name}
                    </div>
                  )}
                  {/* 補休標記 */}
                  {compensation && (
                    <div className="text-xs text-orange-600 font-medium truncate" title={`${compensation.holidayName}補休`}>
                      🔄 {compensation.holidayName}補休
                    </div>
                  )}
                  {schedule && (
                    <div className="mt-1">
                      <div className={`text-xs px-2 py-1 rounded border ${SHIFT_COLORS[schedule.shiftType] || 'bg-gray-100 text-gray-800'}`}>
                        <div className="font-medium">
                          {formatShiftDisplay({
                            shiftType: schedule.shiftType,
                            startTime: schedule.startTime,
                            endTime: schedule.endTime,
                          })}
                        </div>
                        <div className="mt-1 text-[11px] leading-4">
                          {getCalendarScheduleHourSummary(schedule)}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 班表列表 */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center">
              <Clock className="w-5 h-5 mr-2" />
              班表明細
            </h3>
          </div>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    日期
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    星期
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    班次
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    時間
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    時數
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {schedules.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8">
                      <EmptyState
                        icon={<Calendar className="h-12 w-12" />}
                        title="本月暫無班表記錄"
                        description="班表發布後會顯示在這裡。"
                      />
                    </td>
                  </tr>
                ) : (
                  schedules.map((schedule) => {
                    const date = new Date(schedule.workDate);
                    const weekday = weekdays[date.getDay()];
                    return (
                      <tr key={schedule.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {schedule.workDate}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          星期{weekday}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${SHIFT_COLORS[schedule.shiftType] || 'bg-gray-100 text-gray-800'}`}>
                            {formatShiftDisplay({
                              shiftType: schedule.shiftType,
                              startTime: schedule.startTime,
                              endTime: schedule.endTime,
                            })}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {getScheduleTimeText(schedule)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <div>應上工時 {formatHours(getExpectedWorkHours(schedule))}</div>
                          <div>工時 {formatHours(schedule.workHours ?? 0)}</div>
                          {(schedule.specialLeaveHours ?? 0) > 0 && <div className="text-yellow-700">特休 {formatHours(schedule.specialLeaveHours ?? 0)}</div>}
                          {(schedule.compLeaveHours ?? 0) > 0 && <div className="text-orange-600">補休 {formatHours(schedule.compLeaveHours ?? 0)}</div>}
                          {(schedule.overtimeHours ?? 0) > 0 && <div className="text-red-600">加班 {formatHours(schedule.overtimeHours ?? 0)}</div>}
                          {getNationalHolidayHours(schedule) > 0 && (
                            <div className="text-rose-600">
                              國定假日 {formatHours(getNationalHolidayHours(schedule))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 月份總結 */}
        <div className="mt-8 bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">
              {selectedYear}年{selectedMonth}月 工時總結
            </h3>
          </div>
          <div className="p-6 space-y-6">
            {/* 排班時數計算 */}
            <div className="bg-blue-50 rounded-lg p-4">
              <h4 className="font-medium text-blue-900 mb-3">排班時數</h4>
              <div className="text-sm text-blue-800 space-y-1">
                <div className="flex justify-between">
                  <span>應上工時：</span>
                  <span className="font-medium">{formatHours(scheduleHourTotals.expectedWorkHours)}</span>
                </div>
                <div className="flex justify-between">
                  <span>實際工時：</span>
                  <span className="font-medium">{formatHours(scheduleHourTotals.workHours)}</span>
                </div>
                <div className="flex justify-between">
                  <span>特休時數：</span>
                  <span className="font-medium text-yellow-700">{formatHours(scheduleHourTotals.specialLeaveHours)}</span>
                </div>
                <div className="flex justify-between">
                  <span>補休時數：</span>
                  <span className="font-medium text-orange-600">{formatHours(scheduleHourTotals.compLeaveHours)}</span>
                </div>
                <div className="flex justify-between">
                  <span>排班加班：</span>
                  <span className="font-medium text-red-600">{formatHours(scheduleHourTotals.overtimeHours)}</span>
                </div>
                <div className="flex justify-between">
                  <span>國定假日時數：</span>
                  <span className="font-medium text-rose-600">{formatHours(scheduleHourTotals.nationalHolidayHours)}</span>
                </div>
                <div className="border-t border-blue-200 pt-2 mt-2">
                  <div className="flex justify-between font-bold">
                    <span>排班時數合計：</span>
                    <span>{formatHours(scheduleHourTotals.accountedHours)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 班別時數明細 */}
            <div className="bg-green-50 rounded-lg p-4">
              <h4 className="font-medium text-green-900 mb-3">班別時數明細</h4>
              <div className="text-sm text-green-800 space-y-1">
                {Array.from(new Set(schedules.map((schedule) => schedule.shiftType))).sort().map((shiftType) => {
                  const shiftSchedules = schedules.filter((schedule) => schedule.shiftType === shiftType);
                  const workHours = roundHours(shiftSchedules.reduce((sum, schedule) => sum + (schedule.workHours ?? 0), 0));
                  const expectedWorkHours = roundHours(shiftSchedules.reduce((sum, schedule) => sum + getExpectedWorkHours(schedule), 0));
                  const specialLeaveHours = roundHours(shiftSchedules.reduce((sum, schedule) => sum + (schedule.specialLeaveHours ?? 0), 0));
                  const compLeaveHours = roundHours(shiftSchedules.reduce((sum, schedule) => sum + (schedule.compLeaveHours ?? 0), 0));
                  const shiftOvertimeHours = roundHours(shiftSchedules.reduce((sum, schedule) => sum + (schedule.overtimeHours ?? 0), 0));
                  const nationalHolidayHours = roundHours(shiftSchedules.reduce((sum, schedule) => sum + getNationalHolidayHours(schedule), 0));

                  return (
                    <div key={shiftType} className="flex justify-between gap-4">
                      <span>{getShiftDisplayName(shiftType)}：</span>
                      <span className="font-medium text-right">
                        應 {formatHours(expectedWorkHours)} / 工 {formatHours(workHours)}
                        {specialLeaveHours > 0 && ` / 特 ${formatHours(specialLeaveHours)}`}
                        {compLeaveHours > 0 && ` / 補 ${formatHours(compLeaveHours)}`}
                        {shiftOvertimeHours > 0 && ` / 加 ${formatHours(shiftOvertimeHours)}`}
                        {nationalHolidayHours > 0 && ` / 國 ${formatHours(nationalHolidayHours)}`}
                        <span className="text-green-700">（{shiftSchedules.length}天）</span>
                      </span>
                    </div>
                  );
                })}
                <div className="border-t border-green-200 pt-2 mt-2">
                  <div className="flex justify-between font-bold">
                    <span>實際工時：</span>
                    <span>{formatHours(scheduleHourTotals.workHours)}</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>應上工時：</span>
                    <span>{formatHours(scheduleHourTotals.expectedWorkHours)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 補休與加班 */}
            <div className="bg-yellow-50 rounded-lg p-4">
              <h4 className="font-medium text-yellow-900 mb-3">補休與加班</h4>
              <div className="text-sm text-yellow-800 space-y-1">
                <div className="flex justify-between">
                  <span>排班補休使用：</span>
                  <span className="font-medium text-orange-600">-{formatHours(scheduleHourTotals.compLeaveHours)}</span>
                </div>
                <div className="flex justify-between">
                  <span>排班加班：</span>
                  <span className="font-medium text-red-600">+{formatHours(scheduleHourTotals.overtimeHours)}</span>
                </div>
                <div className="flex justify-between">
                  <span>已核准加班申請：</span>
                  <span className="font-medium text-blue-600">+{formatHours(overtimeHours)}</span>
                </div>
                <div className="border-t border-yellow-200 pt-2 mt-2">
                  <div className="flex justify-between font-bold">
                    <span>本月補休差額：</span>
                    <span>{formatHours(roundHours(scheduleHourTotals.overtimeHours + overtimeHours - scheduleHourTotals.compLeaveHours))}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 統計說明 */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="font-medium text-gray-900 mb-3">說明</h4>
              <div className="text-xs text-gray-700 space-y-2">
                <div>
                  <p className="font-medium text-gray-800 mb-1">【班別說明】</p>
                  <p>• 例假日(RD)：每週1天，除天災/緊急事故外禁止加班</p>
                  <p>• 休息日(rd)：每週1天，可加班須給付加班費</p>
                  <p>• 國定假日(NH)：內政部公告節慶，出勤加發工資</p>
                  <p>• 請假(FDL)：特休、事假、病假等</p>
                  <p>• 補休(OFF)：使用累積補休時數</p>
                </div>
                <div className="border-t border-gray-200 pt-2">
                  <p className="font-medium text-gray-800 mb-1">【計算公式】</p>
                  <p>• 應上工時 = 有排定班別的工時 + 特休時數 + 補休時數，不包含排班加班</p>
                  <p>• 實際工時、特休、補休、排班加班皆依班別設定與班表資料加總</p>
                  <p>• 國定假日時數 = 排班日期落在啟用國定假日時的實際工時，屬於實際工時分類，不重複加計到排班時數合計</p>
                  <p>• 已核准加班申請另列，避免與班別中的排班加班混淆</p>
                  <p>• 排班時數合計 = 實際工時 + 特休 + 補休 + 排班加班</p>
                </div>
                <div className="border-t border-gray-200 pt-2">
                  <p className="text-yellow-700 flex items-center gap-1">
                    ⚠️ 數據僅供參考，實際薪資以人事部門計算為準
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 班表確認對話框 */}
      {showConfirmModal && confirmData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                ✓ 確認 {selectedYear}年{selectedMonth.toString().padStart(2, '0')}月 班表
              </h3>
            </div>
            
            <div className="px-6 py-4 space-y-4">
              <p className="text-gray-600">您即將確認以下班表安排：</p>
              
              {confirmData.scheduleSummary && (
                <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">月份：</span>
                    <span className="font-medium">{selectedYear}年{selectedMonth}月</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">工作天數：</span>
                    <span className="font-medium">{scheduleDayStats.actualWorkDays}天</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">非出勤天數：</span>
                    <span className="font-medium">{scheduleDayStats.nonWorkDays}天</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-500">班次分布：</span>
                    <span className="text-right font-medium">
                      {shiftDistributionText}
                    </span>
                  </div>
                  <div className="border-t border-gray-200 pt-2 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-gray-500">應上工時：</span>
                      <span className="font-medium">{formatHours(scheduleHourTotals.expectedWorkHours)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">實際工時：</span>
                      <span className="font-medium">{formatHours(scheduleHourTotals.workHours)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">特休 / 補休 / 加班：</span>
                      <span className="font-medium">
                        {formatHours(scheduleHourTotals.specialLeaveHours)} / {formatHours(scheduleHourTotals.compLeaveHours)} / {formatHours(scheduleHourTotals.overtimeHours)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">國定假日時數：</span>
                      <span className="font-medium text-rose-600">{formatHours(scheduleHourTotals.nationalHolidayHours)}</span>
                    </div>
                  </div>
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  💬 備註（選填）
                </label>
                <input
                  type="text"
                  value={confirmComment}
                  onChange={(e) => setConfirmComment(e.target.value)}
                  placeholder="如有問題可在此備註..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder:text-gray-400 bg-white"
                />
              </div>
              
              {/* 密碼驗證欄位 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  🔐 登入密碼 <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="請輸入您的登入密碼以確認身份"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder:text-gray-400 bg-white"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">為確保是本人操作，請輸入登入密碼</p>
              </div>
              
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                ⚠️ 確認後，若班表有異動將需重新確認
              </div>
            </div>
            
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200">
              <button
                onClick={() => {
                  setShowConfirmModal(false);
                  setConfirmComment('');
                  setConfirmPassword('');
                }}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirm}
                disabled={confirming || !confirmPassword}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 transition-colors"
              >
                {confirming ? (
                  <>
                    <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></span>
                    確認中...
                  </>
                ) : (
                  <>✓ 確認班表</>
                )}
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
