
'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  Calendar, 
  CalendarDays, 
  ChevronLeft, 
  ChevronRight, 
  Download,
  Plus, 
  Printer,
  Copy, 
  X,
  Trash2
} from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import {
  assignShiftToDate,
  assignShiftToDates,
  buildShiftDateGroups,
  listAssignedDates,
  replaceAssignedDates,
  toggleAssignedDate,
  type DateShiftAssignments,
} from '@/lib/schedule-batch-assignments';
import { downloadWorkbookAsXlsx, formatExportDate, getWeekdayLabel, sanitizeFileNameSegment } from '@/lib/schedule-xlsx';
import QuickCopySchedule from '@/components/QuickCopySchedule';
import { useLocalToast, SimpleToast } from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import {
  buildDefaultShiftDTOs,
  formatScheduleTimeLabel,
  formatShiftHourSummary,
  getShiftColorClass,
  getShiftTemplate,
  resolveScheduleHourFields,
  type ShiftDefinitionDTO,
} from '@/lib/shift-definition-utils';
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
  specialLeaveHours?: number;
  compLeaveHours?: number;
  overtimeHours?: number;
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

interface ScheduleResponse {
  id: number;
  employeeId: number | string;
  employeeCode?: string;
  employeeName?: string;
  department?: string;
  workDate?: string;
  date?: string;
  shiftType: string;
  startTime: string;
  endTime: string;
  breakTime?: number;
  workHours?: number;
  specialLeaveHours?: number;
  compLeaveHours?: number;
  overtimeHours?: number;
  createdAt?: string;
  updatedAt?: string;
  employee?: {
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
  isActive?: boolean;
  managedLocation?: string;  // 據點排班員負責的據點
}

interface EmployeeFilterValues {
  department: string;
  position: string;
  keyword: string;
}

interface DepartmentOption {
  id: number;
  name: string;
  sortOrder: number;
}

interface CalendarPeriod {
  year: number;
  month: number;
  value: string;
  label: string;
}

interface Holiday {
  id: number;
  name: string;
  date: string;
}

interface BatchDateRangeState {
  startDate: string;
  endDate: string;
  weekdays: number[];
}

type CreateEmployeeScope = 'single' | 'checked' | 'filtered-active';

type CreateDateSelectionMode = 'range' | 'calendar';

type ScheduleModalMode = 'create' | 'delete';

interface DaySchedule {
  shiftType: string;
  startTime: string;
  endTime: string;
  breakTime: number;
  workHours: number;
  specialLeaveHours: number;
  compLeaveHours: number;
  overtimeHours: number;
}

interface WeeklyTemplate {
  id?: number;
  name: string;
  description: string;
  monday: DaySchedule;
  tuesday: DaySchedule;
  wednesday: DaySchedule;
  thursday: DaySchedule;
  friday: DaySchedule;
  saturday: DaySchedule;
  sunday: DaySchedule;
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
    managedLocation?: string;
  };
}

interface ScheduleConfirmationRow {
  id: number;
  employeeId: string;
  name: string;
  department: string;
  position: string;
  yearMonth: string;
  status: ScheduleConfirmStatus;
  scheduleCount: number;
  hasSchedules: boolean;
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

interface ScheduleCreatePayload {
  shiftType: string;
  employeeId?: string;
  employeeIds?: number[];
  workDate?: string;
  workDates?: string[];
  entries?: Array<{ workDate: string; shiftType: string }>;
  dryRun?: boolean;
}

interface ScheduleConflictPreview {
  createdCount: number;
  updatedCount: number;
  appliedCount: number;
  employeeCount: number;
  conflicts: Array<{
    employeeId: number;
    employeeCode: string;
    employeeName: string;
    workDate: string;
    oldShiftType: string;
    newShiftType: string;
  }>;
}

const SHIFT_TEMPLATES = {
  A: { startTime: '07:30', endTime: '16:30', breakTime: 60, workHours: 8, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0 },
  B: { startTime: '08:00', endTime: '17:00', breakTime: 60, workHours: 8, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0 },
  C: { startTime: '08:30', endTime: '17:30', breakTime: 60, workHours: 8, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0 },
  NH: { startTime: '', endTime: '', breakTime: 0, workHours: 0, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0 },
  RD: { startTime: '', endTime: '', breakTime: 0, workHours: 0, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0 },
  rd: { startTime: '', endTime: '', breakTime: 0, workHours: 0, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0 },
  FDL: { startTime: '', endTime: '', breakTime: 0, workHours: 0, specialLeaveHours: 8, compLeaveHours: 0, overtimeHours: 0 },
  OFF: { startTime: '', endTime: '', breakTime: 0, workHours: 0, specialLeaveHours: 0, compLeaveHours: 8, overtimeHours: 0 },
  TD: { startTime: '', endTime: '', breakTime: 0, workHours: 0, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0 }
};

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const WEEKDAY_LABELS = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];

// 部門列表
const LOCATIONS = [
  '經營管理部',
  '資訊部',
  '溪北輔具中心',
  '礁溪失智據點',
  '羅東失智據點',
  '三星失智據點',
  '冬瓜山失智據點',
  '八寶日照中心',
  '蘇西日照中心'
];

const WEEKDAY_OPTIONS = [
  { value: 0, label: '日' },
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
];

const ALL_WEEKDAYS = WEEKDAY_OPTIONS.map((weekday) => weekday.value);

function formatEmployeeOption(employee: Employee) {
  return [
    `${employee.name}（${employee.employeeId}）`,
    employee.department,
    employee.position,
  ].filter(Boolean).join('｜');
}

function getCurrentYearMonth() {
  return new Date().toISOString().slice(0, 7);
}

function formatYearMonthLabel(yearMonth: string) {
  const [year, month] = yearMonth.split('-');
  if (!year || !month) {
    return yearMonth;
  }

  return `${year}年${month}月`;
}

function matchesEmployeeFilters(employee: Employee, filters: EmployeeFilterValues) {
  if (filters.department && employee.department !== filters.department) return false;
  if (filters.position && employee.position !== filters.position) return false;
  if (!filters.keyword.trim()) return true;

  const keyword = filters.keyword.trim().toLowerCase();
  return [
    employee.employeeId,
    employee.name,
    employee.department,
    employee.position,
  ].some((value) => value.toLowerCase().includes(keyword));
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseCalendarPeriod(yearMonth: string): CalendarPeriod | null {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  return {
    year,
    month,
    value: yearMonth,
    label: `${year}年${String(month).padStart(2, '0')}月`,
  };
}

function parseDateString(dateString: string) {
  const parts = dateString.split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
    return null;
  }

  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatYearMonthValue(date: Date) {
  return formatDateString(new Date(date.getFullYear(), date.getMonth(), 1)).slice(0, 7);
}

function getWeekdayFromDate(dateString: string) {
  const date = parseDateString(dateString);
  return date ? date.getDay() : null;
}

function getDatesInRange(startDate: string, endDate: string, weekdays: number[]) {
  if (!startDate || !endDate || weekdays.length === 0) {
    return [];
  }

  const start = parseDateString(startDate);
  const end = parseDateString(endDate);
  if (!start || !end || start > end) {
    return [];
  }

  const weekdaySet = new Set(weekdays);
  const dates: string[] = [];
  const current = new Date(start);

  while (current <= end) {
    if (weekdaySet.has(current.getDay())) {
      dates.push(formatDateString(current));
    }
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

function toggleWeekday(weekdays: number[], target: number) {
  return weekdays.includes(target)
    ? weekdays.filter((weekday) => weekday !== target)
    : [...weekdays, target].sort((a, b) => a - b);
}

function buildMonthDays(baseDate: Date) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const firstDayOfWeek = firstDay.getDay();
  const daysInMonth = lastDay.getDate();
  const days: Array<number | null> = [];

  for (let i = 0; i < firstDayOfWeek; i += 1) {
    days.push(null);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    days.push(day);
  }

  return days;
}

function formatMonthDate(baseDate: Date, day: number | null) {
  if (!day) return '';
  const date = new Date(baseDate.getFullYear(), baseDate.getMonth(), day);
  return formatDateString(date);
}

function shiftMonth(baseDate: Date, offset: number) {
  return new Date(baseDate.getFullYear(), baseDate.getMonth() + offset, 1);
}

export default function ScheduleManagementPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<DepartmentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [schedulePermissions, setSchedulePermissions] = useState<string[]>([]);  // 班表管理權限（可管理的部門列表）
  
  // 日曆相關狀態
  const [calendarSchedules, setCalendarSchedules] = useState<{[key: string]: Schedule[]}>({});
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const [showCalendarDayModal, setShowCalendarDayModal] = useState(false);
  const [calendarDayDepartmentFilter, setCalendarDayDepartmentFilter] = useState('');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleModalMode, setScheduleModalMode] = useState<ScheduleModalMode>('create');
  const [newSchedule, setNewSchedule] = useState({
    employeeId: '',
    workDate: '',
    shiftType: 'A',
    startTime: '07:30',
    endTime: '16:30',
    breakTime: 60,
    workHours: 8,
    specialLeaveHours: 0,
    compLeaveHours: 0,
    overtimeHours: 0
  });
  const [createBatchMode, setCreateBatchMode] = useState(false);
  const [createBatchRange, setCreateBatchRange] = useState<BatchDateRangeState>({
    startDate: '',
    endDate: '',
    weekdays: ALL_WEEKDAYS,
  });
  const [createEmployeeScope, setCreateEmployeeScope] = useState<CreateEmployeeScope>('single');
  const [createCheckedEmployeeIds, setCreateCheckedEmployeeIds] = useState<number[]>([]);
  const [createDateSelectionMode, setCreateDateSelectionMode] = useState<CreateDateSelectionMode>('range');
  const [createCalendarMonth, setCreateCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [createCalendarHolidays, setCreateCalendarHolidays] = useState<Holiday[]>([]);
  const [createCalendarAssignments, setCreateCalendarAssignments] = useState<DateShiftAssignments>({});
  const [createCalendarExistingSchedules, setCreateCalendarExistingSchedules] = useState<Record<string, Schedule[]>>({});
  const [createCalendarExistingLoading, setCreateCalendarExistingLoading] = useState(false);
  const [createEmployeeFilters, setCreateEmployeeFilters] = useState<EmployeeFilterValues>({
    department: '',
    position: '',
    keyword: '',
  });
  
  // 週模版相關狀態
  const [weeklyTemplates, setWeeklyTemplates] = useState<WeeklyTemplate[]>([]);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<WeeklyTemplate | null>(null);
  const [showApplyTemplateModal, setShowApplyTemplateModal] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [applyToMonth, setApplyToMonth] = useState('');
  const [selectedEmployees, setSelectedEmployees] = useState<number[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [templateDepartmentFilter, setTemplateDepartmentFilter] = useState(''); // 模版部門篩選
  
  // 編輯排程相關狀態
  const [showEditScheduleModal, setShowEditScheduleModal] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [editScheduleForm, setEditScheduleForm] = useState({
    shiftType: 'A' as string,
    startTime: '07:30',
    endTime: '16:30',
    breakTime: 60,
    workHours: 8,
    specialLeaveHours: 0,
    compLeaveHours: 0,
    overtimeHours: 0
  });
  const [editBatchMode, setEditBatchMode] = useState(false);
  const [editDateSelectionMode, setEditDateSelectionMode] = useState<CreateDateSelectionMode>('range');
  const [editBatchRange, setEditBatchRange] = useState<BatchDateRangeState>({
    startDate: '',
    endDate: '',
    weekdays: [],
  });
  const [editCalendarMonth, setEditCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [editCalendarHolidays, setEditCalendarHolidays] = useState<Holiday[]>([]);
  const [editCalendarAssignments, setEditCalendarAssignments] = useState<DateShiftAssignments>({});
  
  // Toast 通知
  const { toast, clearToast, showToast } = useLocalToast();
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [scheduleDeleteConfirmOpen, setScheduleDeleteConfirmOpen] = useState(false);
  const [deletingSchedules, setDeletingSchedules] = useState(false);
  const [creatingSchedules, setCreatingSchedules] = useState(false);
  const [scheduleConflictPreview, setScheduleConflictPreview] = useState<ScheduleConflictPreview | null>(null);
  const [pendingScheduleCreatePayload, setPendingScheduleCreatePayload] = useState<ScheduleCreatePayload | null>(null);
  // 搜尋相關狀態
  const [searchFilters, setSearchFilters] = useState({
    yearMonth: '',
    employeeId: '',
    employeeName: '',
    department: '',
    position: '',
    location: ''  // 據點篩選
  });

  const [searchResults, setSearchResults] = useState<Schedule[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [locationFilter, setLocationFilter] = useState('');  // 日曆據點篩選
  const [confirmationFilters, setConfirmationFilters] = useState({
    yearMonth: getCurrentYearMonth(),
    employeeId: '',
    department: '',
    status: '',
  });
  const [confirmationResults, setConfirmationResults] = useState<ScheduleConfirmationRow[]>([]);
  const [confirmationLoading, setConfirmationLoading] = useState(false);
  const [confirmationHasSearched, setConfirmationHasSearched] = useState(false);
  
  // 國定假日狀態
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const holidayCacheRef = useRef<Record<number, Holiday[]>>({});
  const [shiftDefinitions, setShiftDefinitions] = useState<ShiftDefinitionDTO[]>([]);
  const [shiftDefinitionsLoaded, setShiftDefinitionsLoaded] = useState(false);

  const shiftDisplayDefinitions = useMemo(
    () => shiftDefinitionsLoaded ? shiftDefinitions : buildDefaultShiftDTOs(),
    [shiftDefinitions, shiftDefinitionsLoaded]
  );
  const shiftOptions = useMemo(
    () => shiftDisplayDefinitions.filter((shift) => shift.isActive),
    [shiftDisplayDefinitions]
  );
  const getShiftDefinitionByCode = useCallback(
    (code: string) => shiftDisplayDefinitions.find((shift) => shift.code === code),
    [shiftDisplayDefinitions]
  );
  const getShiftColor = useCallback(
    (code: string) => getShiftColorClass(code, shiftDisplayDefinitions),
    [shiftDisplayDefinitions]
  );
  const getScheduleTimeText = useCallback((schedule: Pick<Schedule, 'shiftType' | 'startTime' | 'endTime'>) => (
    formatScheduleTimeLabel({
      shiftType: schedule.shiftType,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      shiftDefinition: getShiftDefinitionByCode(schedule.shiftType) ?? null,
    })
  ), [getShiftDefinitionByCode]);
  const getScheduleHourSummary = useCallback((schedule: Pick<Schedule, 'workHours' | 'specialLeaveHours' | 'compLeaveHours' | 'overtimeHours'>) => (
    formatShiftHourSummary({
      workHours: schedule.workHours ?? 0,
      specialLeaveHours: schedule.specialLeaveHours ?? 0,
      compLeaveHours: schedule.compLeaveHours ?? 0,
      overtimeHours: schedule.overtimeHours ?? 0,
    })
  ), []);
  const getCalendarScheduleLabel = useCallback((schedule: Pick<Schedule, 'shiftType' | 'startTime' | 'endTime'>) => {
    const shift = getShiftDefinitionByCode(schedule.shiftType);
    const timeText = getScheduleTimeText(schedule);

    if (shift?.requiresTime) {
      return `${shift.name} ${timeText}`;
    }

    return shift?.name ?? timeText;
  }, [getScheduleTimeText, getShiftDefinitionByCode]);
  const summarizeSchedulesByShift = useCallback((schedules: Schedule[]) => {
    if (schedules.length === 0) {
      return '';
    }

    const shiftCounts = schedules.reduce<Map<string, number>>((result, schedule) => {
      result.set(schedule.shiftType, (result.get(schedule.shiftType) ?? 0) + 1);
      return result;
    }, new Map());

    return Array.from(shiftCounts.entries())
      .sort(([left], [right]) => left.localeCompare(right, 'zh-Hant'))
      .map(([shiftType, count]) => {
        const label = getShiftDefinitionByCode(shiftType)?.label ?? shiftType;
        return count > 1 ? `${label}×${count}` : label;
      })
      .join('｜');
  }, [getShiftDefinitionByCode]);
  const isShiftRequiresTime = useCallback((code: string) => {
    const shift = getShiftDefinitionByCode(code);
    if (shift) {
      return shift.requiresTime;
    }

    return !['NH', 'RD', 'rd', 'OFF', 'FDL', 'TD'].includes(code);
  }, [getShiftDefinitionByCode]);
  const getShiftTemplateForCode = useCallback((code: string) => {
    const shift = getShiftDefinitionByCode(code);
    if (shift) {
      return getShiftTemplate(code, shiftDisplayDefinitions);
    }

    const legacyTemplate = SHIFT_TEMPLATES[code as keyof typeof SHIFT_TEMPLATES];
    return legacyTemplate
      ? { ...legacyTemplate, requiresTime: isShiftRequiresTime(code) }
      : { startTime: '', endTime: '', breakTime: 0, workHours: 0, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0, requiresTime: true };
  }, [getShiftDefinitionByCode, isShiftRequiresTime, shiftDisplayDefinitions]);

  const sortedEmployees = useMemo(
    () => [...employees].sort((a, b) => {
      const departmentCompare = (a.department || '').localeCompare(b.department || '', 'zh-Hant');
      if (departmentCompare !== 0) return departmentCompare;
      const nameCompare = a.name.localeCompare(b.name, 'zh-Hant');
      if (nameCompare !== 0) return nameCompare;
      return a.employeeId.localeCompare(b.employeeId, 'zh-Hant');
    }),
    [employees]
  );

  const activeEmployees = useMemo(
    () => sortedEmployees.filter((employee) => employee.isActive !== false),
    [sortedEmployees]
  );

  const positionOptions = useMemo(
    () => [...new Set(activeEmployees.map((employee) => employee.position).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant')),
    [activeEmployees]
  );

  const scheduleDepartmentOptions = useMemo(() => {
    if (departmentOptions.length > 0) {
      return departmentOptions.map((department) => department.name);
    }

    const dynamicDepartments = [...new Set(activeEmployees.map((employee) => employee.department).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'zh-Hant'));

    return dynamicDepartments.length > 0 ? dynamicDepartments : LOCATIONS;
  }, [activeEmployees, departmentOptions]);

  const isFullAdmin = user && (user.role === 'ADMIN' || user.role === 'HR');
  const isDepartmentManager = user?.isDepartmentManager || user?.isDeputyManager;
  const userDepartment = user?.employee?.department;
  const hasSchedulePermission = schedulePermissions.length > 0;
  const canManage = isFullAdmin || hasSchedulePermission || isDepartmentManager;
  const allowedLocations = useMemo(() => {
    if (isFullAdmin) {
      return LOCATIONS;
    }

    if (hasSchedulePermission) {
      return schedulePermissions;
    }

    if (isDepartmentManager && userDepartment) {
      return [userDepartment];
    }

    return [];
  }, [hasSchedulePermission, isDepartmentManager, isFullAdmin, schedulePermissions, userDepartment]);

  const manageableScheduleEmployees = useMemo(
    () => isFullAdmin
      ? activeEmployees
      : activeEmployees.filter((employee) => (
          Boolean(employee.department) && allowedLocations.includes(employee.department)
        )),
    [activeEmployees, allowedLocations, isFullAdmin]
  );

  const createDepartmentOptions = useMemo(
    () => isFullAdmin
      ? scheduleDepartmentOptions
      : allowedLocations.filter((department) => scheduleDepartmentOptions.includes(department) || department.trim()),
    [allowedLocations, isFullAdmin, scheduleDepartmentOptions]
  );

  const searchEmployeeOptions = useMemo(
    () => activeEmployees.filter((employee) => {
      if (searchFilters.department && employee.department !== searchFilters.department) return false;
      if (searchFilters.position && employee.position !== searchFilters.position) return false;
      return true;
    }),
    [activeEmployees, searchFilters.department, searchFilters.position]
  );

  const searchCalendarPeriod = useMemo(() => {
    if (searchFilters.yearMonth) {
      return parseCalendarPeriod(searchFilters.yearMonth);
    }

    const uniqueMonths = [...new Set(searchResults.map((schedule) => schedule.workDate.slice(0, 7)).filter(Boolean))];
    return uniqueMonths.length === 1 ? parseCalendarPeriod(uniqueMonths[0]) : null;
  }, [searchFilters.yearMonth, searchResults]);

  const searchResultScopeLabel = useMemo(() => {
    if (searchFilters.employeeId) {
      const employee = employees.find((item) => item.employeeId === searchFilters.employeeId) ?? searchResults[0]?.employee;
      return employee ? `${employee.name}（${employee.employeeId}）` : searchFilters.employeeId;
    }

    if (searchFilters.department) {
      return `${searchFilters.department}`;
    }

    return '全部員工';
  }, [employees, searchFilters.department, searchFilters.employeeId, searchResults]);

  const searchResultGroups = useMemo(() => {
    const groups = new Map<number, { employee: Schedule['employee']; schedules: Schedule[] }>();

    searchResults.forEach((schedule) => {
      const existing = groups.get(schedule.employee.id);
      if (existing) {
        existing.schedules.push(schedule);
        return;
      }

      groups.set(schedule.employee.id, {
        employee: schedule.employee,
        schedules: [schedule],
      });
    });

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        schedules: [...group.schedules].sort((a, b) => a.workDate.localeCompare(b.workDate)),
      }))
      .sort((a, b) => {
        const departmentCompare = (a.employee.department || '').localeCompare(b.employee.department || '', 'zh-Hant');
        if (departmentCompare !== 0) return departmentCompare;
        const employeeIdCompare = a.employee.employeeId.localeCompare(b.employee.employeeId, 'zh-Hant');
        if (employeeIdCompare !== 0) return employeeIdCompare;
        return a.employee.name.localeCompare(b.employee.name, 'zh-Hant');
      });
  }, [searchResults]);

  const confirmationEmployeeOptions = useMemo(
    () => activeEmployees.filter((employee) => (
      !confirmationFilters.department || employee.department === confirmationFilters.department
    )),
    [activeEmployees, confirmationFilters.department]
  );

  const createEmployeeOptions = useMemo(
    () => manageableScheduleEmployees.filter((employee) => matchesEmployeeFilters(employee, createEmployeeFilters)),
    [createEmployeeFilters, manageableScheduleEmployees]
  );

  const createCheckedEmployeeIdSet = useMemo(
    () => new Set(createCheckedEmployeeIds),
    [createCheckedEmployeeIds]
  );

  const allCreateEmployeeOptionsSelected = createEmployeeOptions.length > 0
    && createEmployeeOptions.every((employee) => createCheckedEmployeeIdSet.has(employee.id));
  const hasCreateEmployeeOptionSelection = createEmployeeOptions.some((employee) => createCheckedEmployeeIdSet.has(employee.id));

  const createSelectedEmployeeIds = useMemo(
    () => createEmployeeScope === 'filtered-active'
      ? createEmployeeOptions.map((employee) => employee.id)
      : createEmployeeScope === 'checked'
        ? createCheckedEmployeeIds
      : newSchedule.employeeId
        ? [Number(newSchedule.employeeId)]
        : [],
    [createCheckedEmployeeIds, createEmployeeOptions, createEmployeeScope, newSchedule.employeeId]
  );

  const createCalendarDays = useMemo(
    () => buildMonthDays(createCalendarMonth),
    [createCalendarMonth]
  );

  const createCalendarSelectedDates = useMemo(
    () => listAssignedDates(createCalendarAssignments),
    [createCalendarAssignments]
  );

  const createTargetDates = useMemo(
    () => createBatchMode
      ? createDateSelectionMode === 'calendar'
        ? createCalendarSelectedDates
        : getDatesInRange(createBatchRange.startDate, createBatchRange.endDate, createBatchRange.weekdays)
      : newSchedule.workDate
        ? [newSchedule.workDate]
        : [],
    [
      createBatchMode,
      createBatchRange.endDate,
      createBatchRange.startDate,
      createBatchRange.weekdays,
      createCalendarSelectedDates,
      createDateSelectionMode,
      newSchedule.workDate,
    ]
  );

  const createCalendarShiftGroups = useMemo(
    () => buildShiftDateGroups(createCalendarAssignments),
    [createCalendarAssignments]
  );

  const isDeleteScheduleMode = scheduleModalMode === 'delete';

  const hasSearchContext = useMemo(
    () => (
      searchResults.length > 0 ||
      Boolean(
        searchFilters.yearMonth ||
        searchFilters.employeeId ||
        searchFilters.employeeName ||
        searchFilters.department ||
        searchFilters.position
      )
    ),
    [
      searchFilters.department,
      searchFilters.employeeId,
      searchFilters.employeeName,
      searchFilters.position,
      searchFilters.yearMonth,
      searchResults.length,
    ]
  );

  const editTargetDates = useMemo(
    () => editBatchMode
      ? editDateSelectionMode === 'calendar'
        ? listAssignedDates(editCalendarAssignments)
        : getDatesInRange(editBatchRange.startDate, editBatchRange.endDate, editBatchRange.weekdays)
      : editingSchedule?.workDate
        ? [editingSchedule.workDate]
        : [],
    [editBatchMode, editBatchRange.endDate, editBatchRange.startDate, editBatchRange.weekdays, editCalendarAssignments, editDateSelectionMode, editingSchedule]
  );

  const editCalendarDays = useMemo(
    () => buildMonthDays(editCalendarMonth),
    [editCalendarMonth]
  );

  const editCalendarSelectedDates = useMemo(
    () => listAssignedDates(editCalendarAssignments),
    [editCalendarAssignments]
  );

  const editCalendarShiftGroups = useMemo(
    () => buildShiftDateGroups(editCalendarAssignments),
    [editCalendarAssignments]
  );

  const selectedCalendarDaySchedules = useMemo(() => {
    if (!selectedCalendarDate) {
      return [];
    }

    const daySchedules = calendarSchedules[selectedCalendarDate] || [];
    const effectiveDepartmentFilter = calendarDayDepartmentFilter || locationFilter;
    const filteredSchedules = effectiveDepartmentFilter
      ? daySchedules.filter((schedule) => schedule.employee.department === effectiveDepartmentFilter)
      : daySchedules;

    return [...filteredSchedules].sort((a, b) => {
      const departmentCompare = (a.employee.department || '').localeCompare(b.employee.department || '', 'zh-Hant');
      if (departmentCompare !== 0) return departmentCompare;
      const employeeIdCompare = a.employee.employeeId.localeCompare(b.employee.employeeId, 'zh-Hant');
      if (employeeIdCompare !== 0) return employeeIdCompare;
      return a.employee.name.localeCompare(b.employee.name, 'zh-Hant');
    });
  }, [calendarDayDepartmentFilter, calendarSchedules, locationFilter, selectedCalendarDate]);

  const selectedCalendarDayDepartmentOptions = useMemo(() => {
    if (!selectedCalendarDate) {
      return [];
    }

    return [...new Set(
      (calendarSchedules[selectedCalendarDate] || [])
        .map((schedule) => schedule.employee.department)
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  }, [calendarSchedules, selectedCalendarDate]);

  const handleSearchEmployeeSelect = useCallback((employeeCode: string) => {
    const employee = activeEmployees.find((item) => item.employeeId === employeeCode);
    setSearchFilters((prev) => ({
      ...prev,
      employeeId: employee?.employeeId || '',
      employeeName: employee?.name || '',
    }));
  }, [activeEmployees]);

  const updateCreateEmployeeFilters = useCallback((patch: Partial<EmployeeFilterValues>) => {
    const nextFilters = { ...createEmployeeFilters, ...patch };
    setCreateEmployeeFilters(nextFilters);
    setNewSchedule((prev) => {
      const selectedEmployee = activeEmployees.find((employee) => String(employee.id) === prev.employeeId);
      if (selectedEmployee && !matchesEmployeeFilters(selectedEmployee, nextFilters)) {
        return { ...prev, employeeId: '' };
      }

      return prev;
    });
  }, [activeEmployees, createEmployeeFilters]);

  const resetCreateEmployeeFilters = useCallback(() => {
    setCreateEmployeeFilters({ department: '', position: '', keyword: '' });
  }, []);

  const openCalendarDayModal = useCallback((date: string) => {
    if (!date) return;
    setSelectedCalendarDate(date);
    setCalendarDayDepartmentFilter(locationFilter);
    setShowCalendarDayModal(true);
  }, [locationFilter]);

  const closeCalendarDayModal = useCallback(() => {
    setShowCalendarDayModal(false);
    setSelectedCalendarDate(null);
    setCalendarDayDepartmentFilter('');
  }, []);

  const toggleCreateCalendarDate = useCallback((date: string) => {
    if (!date) return;
    setCreateCalendarAssignments((prev) => toggleAssignedDate(prev, date, newSchedule.shiftType));
  }, [newSchedule.shiftType]);

  const updateCreateCalendarDateShift = useCallback((date: string, shiftType: string) => {
    setCreateCalendarAssignments((prev) => assignShiftToDate(prev, date, shiftType));
  }, []);

  const selectAllCreateCalendarDays = useCallback(() => {
    const selectableDates = isDeleteScheduleMode
      ? Object.keys(createCalendarExistingSchedules).sort()
      : createCalendarDays
        .map((day) => formatMonthDate(createCalendarMonth, day))
        .filter(Boolean);
    setCreateCalendarAssignments(replaceAssignedDates(selectableDates, newSchedule.shiftType));
  }, [createCalendarDays, createCalendarExistingSchedules, createCalendarMonth, isDeleteScheduleMode, newSchedule.shiftType]);

  const clearCreateCalendarDates = useCallback(() => {
    setCreateCalendarAssignments({});
  }, []);

  const applyCreateShiftToSelectedDates = useCallback(() => {
    if (createCalendarSelectedDates.length === 0) {
      return;
    }
    setCreateCalendarAssignments((prev) => assignShiftToDates(prev, createCalendarSelectedDates, newSchedule.shiftType));
  }, [createCalendarSelectedDates, newSchedule.shiftType]);

  const goToPreviousCreateMonth = useCallback(() => {
    setCreateCalendarMonth((prev) => shiftMonth(prev, -1));
  }, []);

  const goToNextCreateMonth = useCallback(() => {
    setCreateCalendarMonth((prev) => shiftMonth(prev, 1));
  }, []);

  const toggleEditCalendarDate = useCallback((date: string) => {
    if (!date) return;
    setEditCalendarAssignments((prev) => toggleAssignedDate(prev, date, editScheduleForm.shiftType));
  }, [editScheduleForm.shiftType]);

  const updateEditCalendarDateShift = useCallback((date: string, shiftType: string) => {
    setEditCalendarAssignments((prev) => assignShiftToDate(prev, date, shiftType));
  }, []);

  const selectAllEditCalendarDays = useCallback(() => {
    const selectableDates = editCalendarDays
      .map((day) => formatMonthDate(editCalendarMonth, day))
      .filter(Boolean);
    setEditCalendarAssignments(replaceAssignedDates(selectableDates, editScheduleForm.shiftType));
  }, [editCalendarDays, editCalendarMonth, editScheduleForm.shiftType]);

  const clearEditCalendarDates = useCallback(() => {
    setEditCalendarAssignments({});
  }, []);

  const applyEditShiftToSelectedDates = useCallback(() => {
    if (editCalendarSelectedDates.length === 0) {
      return;
    }
    setEditCalendarAssignments((prev) => assignShiftToDates(prev, editCalendarSelectedDates, editScheduleForm.shiftType));
  }, [editCalendarSelectedDates, editScheduleForm.shiftType]);

  const goToPreviousEditMonth = useCallback(() => {
    setEditCalendarMonth((prev) => shiftMonth(prev, -1));
  }, []);

  const goToNextEditMonth = useCallback(() => {
    setEditCalendarMonth((prev) => shiftMonth(prev, 1));
  }, []);

  const getSelectableShiftOptions = useCallback((currentCode?: string) => {
    if (!currentCode || shiftOptions.some((shift) => shift.code === currentCode)) {
      return shiftOptions;
    }

    const currentShift = getShiftDefinitionByCode(currentCode);
    if (currentShift) {
      return [...shiftOptions, currentShift];
    }

    return [
      ...shiftOptions,
      {
        id: -999999,
        code: currentCode,
        name: currentCode,
        startTime: '',
        endTime: '',
        breakTime: 0,
        workHours: 0,
        specialLeaveHours: 0,
        compLeaveHours: 0,
        overtimeHours: 0,
        requiresTime: isShiftRequiresTime(currentCode),
        isActive: false,
        sortOrder: 999999,
        description: null,
        label: currentCode,
      },
    ];
  }, [getShiftDefinitionByCode, isShiftRequiresTime, shiftOptions]);

  const normalizeSchedule = useCallback((schedule: ScheduleResponse): Schedule | null => {
    const workDate = typeof schedule.workDate === 'string'
      ? schedule.workDate
      : typeof schedule.date === 'string'
        ? schedule.date
        : '';
    const employee = schedule.employee;
    const employeeId = typeof schedule.employeeId === 'number'
      ? schedule.employeeId
      : employee?.id;

    if (!workDate || !employee || typeof employeeId !== 'number') {
      return null;
    }

    const resolvedSchedule = resolveScheduleHourFields({
      shiftType: schedule.shiftType,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      breakTime: schedule.breakTime,
      workHours: schedule.workHours,
      specialLeaveHours: schedule.specialLeaveHours,
      compLeaveHours: schedule.compLeaveHours,
      overtimeHours: schedule.overtimeHours,
    }, shiftDisplayDefinitions);

    return {
      id: schedule.id,
      employeeId,
      workDate,
      shiftType: resolvedSchedule.shiftType,
      startTime: resolvedSchedule.startTime,
      endTime: resolvedSchedule.endTime,
      breakTime: resolvedSchedule.breakTime,
      workHours: resolvedSchedule.workHours,
      specialLeaveHours: resolvedSchedule.specialLeaveHours,
      compLeaveHours: resolvedSchedule.compLeaveHours,
      overtimeHours: resolvedSchedule.overtimeHours,
      createdAt: schedule.createdAt ?? '',
      updatedAt: schedule.updatedAt ?? '',
      employee,
    };
  }, [shiftDisplayDefinitions]);

  
  const [newTemplate, setNewTemplate] = useState<WeeklyTemplate>({
    name: '',
    description: '',
    monday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60, workHours: 8, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0 },
    tuesday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60, workHours: 8, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0 },
    wednesday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60, workHours: 8, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0 },
    thursday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60, workHours: 8, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0 },
    friday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60, workHours: 8, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0 },
    saturday: { shiftType: 'RD', startTime: '', endTime: '', breakTime: 0, workHours: 0, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0 },
    sunday: { shiftType: 'RD', startTime: '', endTime: '', breakTime: 0, workHours: 0, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0 }
  });

  const fetchMonthlySchedulesForDate = useCallback(async (targetDate: Date) => {
    try {
      const year = targetDate.getFullYear();
      const month = targetDate.getMonth() + 1;
      const response = await fetch(`/api/schedules?year=${year}&month=${month}`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        const normalizedSchedules: Schedule[] = (data.schedules || [])
          .map((schedule: ScheduleResponse) => normalizeSchedule(schedule))
          .filter((schedule: Schedule | null): schedule is Schedule => schedule !== null);
        const schedulesByDate: {[key: string]: Schedule[]} = {};
        normalizedSchedules.forEach((schedule: Schedule) => {
          const date = schedule.workDate;
          if (!schedulesByDate[date]) {
            schedulesByDate[date] = [];
          }
          schedulesByDate[date].push(schedule);
        });
        setCalendarSchedules(schedulesByDate);
      }
    } catch {
      console.error('獲取月份班表失敗');
    }
  }, [normalizeSchedule]);

  const fetchMonthlySchedules = useCallback(() => fetchMonthlySchedulesForDate(currentDate), [currentDate, fetchMonthlySchedulesForDate]);

  const fetchHolidayList = useCallback(async (year: number) => {
    const cachedHolidays = holidayCacheRef.current[year];
    if (cachedHolidays) {
      return cachedHolidays;
    }

    try {
      const response = await fetch(`/api/system-settings/holidays?year=${year}`, {
        credentials: 'include'
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      const yearHolidays: Holiday[] = data.holidays || [];
      holidayCacheRef.current[year] = yearHolidays;
      return yearHolidays;
    } catch (error) {
      console.error('獲取國定假日失敗:', error);
      return [];
    }
  }, []);

  useEffect(() => {
    fetchUser();
    fetchEmployees();
    fetchDepartments();
    fetchShiftDefinitions();
    fetchSchedules();
    fetchWeeklyTemplates();
  }, []);

  useEffect(() => {
    if (currentDate) {
      fetchMonthlySchedules();
      fetchHolidayList(currentDate.getFullYear()).then(setHolidays);
    }
  }, [currentDate, fetchHolidayList, fetchMonthlySchedules]);

  useEffect(() => {
    fetchHolidayList(createCalendarMonth.getFullYear()).then(setCreateCalendarHolidays);
  }, [createCalendarMonth, fetchHolidayList]);

  useEffect(() => {
    if (!showScheduleModal || !isDeleteScheduleMode || createDateSelectionMode !== 'calendar' || createSelectedEmployeeIds.length === 0) {
      setCreateCalendarExistingSchedules({});
      setCreateCalendarExistingLoading(false);
      return;
    }

    let cancelled = false;

    const loadCreateCalendarExistingSchedules = async () => {
      try {
        setCreateCalendarExistingLoading(true);
        const year = createCalendarMonth.getFullYear();
        const month = createCalendarMonth.getMonth() + 1;
        const response = await fetch(`/api/schedules?year=${year}&month=${month}`, {
          credentials: 'include'
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const selectedEmployeeIds = new Set(createSelectedEmployeeIds);
        const nextSchedules: Record<string, Schedule[]> = {};

        (data.schedules || [])
          .map((schedule: ScheduleResponse) => normalizeSchedule(schedule))
          .filter((schedule: Schedule | null): schedule is Schedule => schedule !== null)
          .forEach((schedule: Schedule) => {
            if (!selectedEmployeeIds.has(schedule.employee.id)) {
              return;
            }

            if (!nextSchedules[schedule.workDate]) {
              nextSchedules[schedule.workDate] = [];
            }
            nextSchedules[schedule.workDate].push(schedule);
          });

        if (!cancelled) {
          setCreateCalendarExistingSchedules(nextSchedules);
        }
      } catch (error) {
        console.error('載入刪除班表月曆既有班表失敗:', error);
        if (!cancelled) {
          setCreateCalendarExistingSchedules({});
        }
      } finally {
        if (!cancelled) {
          setCreateCalendarExistingLoading(false);
        }
      }
    };

    void loadCreateCalendarExistingSchedules();

    return () => {
      cancelled = true;
    };
  }, [
    createCalendarMonth,
    createDateSelectionMode,
    createSelectedEmployeeIds,
    isDeleteScheduleMode,
    normalizeSchedule,
    showScheduleModal,
  ]);

  useEffect(() => {
    fetchHolidayList(editCalendarMonth.getFullYear()).then(setEditCalendarHolidays);
  }, [editCalendarMonth, fetchHolidayList]);

  useEffect(() => {
    if (!showScheduleModal) return;

    const template = getShiftTemplateForCode(newSchedule.shiftType);
    setNewSchedule((prev) => {
      if (
        prev.startTime === template.startTime &&
        prev.endTime === template.endTime &&
        prev.breakTime === template.breakTime &&
        prev.workHours === template.workHours &&
        prev.specialLeaveHours === template.specialLeaveHours &&
        prev.compLeaveHours === template.compLeaveHours &&
        prev.overtimeHours === template.overtimeHours
      ) {
        return prev;
      }

      return {
        ...prev,
        startTime: template.startTime,
        endTime: template.endTime,
        breakTime: template.breakTime,
        workHours: template.workHours,
        specialLeaveHours: template.specialLeaveHours,
        compLeaveHours: template.compLeaveHours,
        overtimeHours: template.overtimeHours,
      };
    });
  }, [getShiftTemplateForCode, newSchedule.shiftType, showScheduleModal]);

  useEffect(() => {
    setSchedulePermissions(user?.attendancePermissions?.scheduleManagement || []);
  }, [user]);

  const fetchUser = async () => {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setUser(data.user || data);
      }
    } catch (error) {
      console.error('獲取用戶失敗:', error);
    }
  };

  const fetchEmployees = async () => {
    try {
      // 獲取所有員工（排班需要完整員工列表，不使用分頁）
      const response = await fetch('/api/employees?limit=1000', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setEmployees(data.employees || []);
      }
    } catch (error) {
      console.error('獲取員工列表失敗:', error);
    }
  };

  const fetchDepartments = async () => {
    try {
      const response = await fetch('/api/departments', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setDepartmentOptions(data.departments || []);
      }
    } catch (error) {
      console.error('獲取部門列表失敗:', error);
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
    } finally {
      setShiftDefinitionsLoaded(true);
    }
  };

  const fetchSchedules = async () => {
    try {
      const response = await fetch('/api/schedules', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        // 處理班表資料但不需要保存到狀態
        console.log('班表載入成功:', data.schedules?.length || 0);
      }
    } catch {
      console.error('獲取班表失敗');
    } finally {
      setLoading(false);
    }
  };

  const fetchWeeklyTemplates = async () => {
    try {
      const response = await fetch('/api/schedules/templates', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setWeeklyTemplates(data.templates || []);
      }
    } catch (error) {
      console.error('獲取週模版失敗:', error);
    }
  };

  const handleSearchSchedules = async () => {
    try {
      setSearchLoading(true);
      const queryParams = new URLSearchParams();
      if (searchFilters.yearMonth) {
        queryParams.set('yearMonth', searchFilters.yearMonth);
      }
      if (searchFilters.employeeId) {
        queryParams.set('employeeId', searchFilters.employeeId);
      }
      if (searchFilters.employeeName) {
        queryParams.set('employeeName', searchFilters.employeeName);
      }
      if (searchFilters.department) {
        queryParams.set('department', searchFilters.department);
      }
      if (searchFilters.position) {
        queryParams.set('position', searchFilters.position);
      }

      const response = await fetch(`/api/schedules/search?${queryParams.toString()}`, {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        const normalizedSchedules: Schedule[] = (data.schedules || [])
          .map((schedule: ScheduleResponse) => normalizeSchedule(schedule))
          .filter((schedule: Schedule | null): schedule is Schedule => schedule !== null);
        setSearchResults(normalizedSchedules);
        
        // 更新日曆顯示
        const schedulesByDate: {[key: string]: Schedule[]} = {};
        normalizedSchedules.forEach((schedule: Schedule) => {
          const date = schedule.workDate;
          if (!schedulesByDate[date]) {
            schedulesByDate[date] = [];
          }
          schedulesByDate[date].push(schedule);
        });
        setCalendarSchedules(schedulesByDate);
        
      } else {
        let errorMessage = '未知錯誤';
        try {
          const errorData = await response.json();
          console.error('搜尋錯誤:', errorData);
          errorMessage = errorData.error || `HTTP ${response.status} 錯誤`;
        } catch (jsonError) {
          console.error('無法解析錯誤回應:', jsonError);
          console.error('HTTP 狀態:', response.status, response.statusText);
          errorMessage = `HTTP ${response.status} 錯誤`;
        }
        showToast('error', `搜尋失敗: ${errorMessage}`);
        setSearchResults([]);
        setCalendarSchedules({});
      }
    } catch (error) {
      console.error('搜尋班表失敗:', error);
      showToast('error', '搜尋失敗，請稍後再試');
      setSearchResults([]);
      setCalendarSchedules({});
    } finally {
      setSearchLoading(false);
    }
  };

  const fetchScheduleConfirmations = useCallback(async (filters = confirmationFilters) => {
    if (!filters.yearMonth) {
      showToast('error', '請先選擇查詢月份');
      return;
    }

    try {
      setConfirmationLoading(true);
      setConfirmationHasSearched(true);

      const queryParams = new URLSearchParams({
        type: 'admin-status-list',
        yearMonth: filters.yearMonth,
      });

      if (filters.employeeId) {
        queryParams.set('employeeId', filters.employeeId);
      }
      if (filters.department) {
        queryParams.set('department', filters.department);
      }
      if (filters.status) {
        queryParams.set('status', filters.status);
      }

      const response = await fetch(`/api/schedule-confirmation?${queryParams.toString()}`, {
        credentials: 'include'
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        showToast('error', errorData?.error || '班表確認查詢失敗');
        setConfirmationResults([]);
        return;
      }

      const data = await response.json();
      setConfirmationResults(data.employees || []);
    } catch (error) {
      console.error('查詢班表確認狀態失敗:', error);
      showToast('error', '班表確認查詢失敗，請稍後再試');
      setConfirmationResults([]);
    } finally {
      setConfirmationLoading(false);
    }
  }, [confirmationFilters, showToast]);

  const syncScheduleViews = async (targetDate?: Date | null) => {
    const resolvedTargetDate = targetDate
      ? new Date(targetDate.getFullYear(), targetDate.getMonth(), 1)
      : new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const targetYearMonth = formatYearMonthValue(resolvedTargetDate);

    if (
      currentDate.getFullYear() !== resolvedTargetDate.getFullYear()
      || currentDate.getMonth() !== resolvedTargetDate.getMonth()
    ) {
      setCurrentDate(resolvedTargetDate);
    }

    await fetchSchedules();
    await fetchMonthlySchedulesForDate(resolvedTargetDate);

    if (hasSearchContext) {
      await handleSearchSchedules();
    }

    if (confirmationHasSearched && confirmationFilters.yearMonth === targetYearMonth) {
      await fetchScheduleConfirmations({
        ...confirmationFilters,
        yearMonth: targetYearMonth,
      });
    }
  };

  const submitCreateSchedulePayload = async (payload: ScheduleCreatePayload) => {
    const response = await fetchJSONWithCSRF('/api/schedules', {
      method: 'POST',
      body: payload
    });

    if (response.ok) {
      const data = await response.json();
      const firstTargetDate = createTargetDates[0];
      const firstTarget = firstTargetDate ? parseDateString(firstTargetDate) : null;
      showToast('success', data.message || '班表建立成功');
      setShowScheduleModal(false);
      resetScheduleForm();
      await syncScheduleViews(firstTarget);
      return true;
    }

    const error = await response.json();
    showToast('error', error.error || '建立班表失敗');
    return false;
  };

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (createSelectedEmployeeIds.length === 0) {
      showToast('error', createEmployeeScope === 'filtered-active' ? '目前沒有可排班的活躍員工，請先調整篩選條件' : '請選擇員工');
      return;
    }
    if (createTargetDates.length === 0) {
      if (!createBatchMode) {
        showToast('error', '請選擇工作日期');
      } else {
        showToast('error', createDateSelectionMode === 'calendar' ? '請先在月曆中勾選至少一天' : '請選擇有效的日期區間與星期');
      }
      return;
    }

    try {
      const calendarEntries = createBatchMode && createDateSelectionMode === 'calendar'
        ? createCalendarSelectedDates.map((date) => ({
            workDate: date,
            shiftType: createCalendarAssignments[date] || newSchedule.shiftType,
          }))
        : [];
      const payload: ScheduleCreatePayload = {
        shiftType: newSchedule.shiftType,
        employeeId: createEmployeeScope === 'single' ? newSchedule.employeeId : undefined,
        employeeIds: createEmployeeScope !== 'single' ? createSelectedEmployeeIds : undefined,
        workDate: createTargetDates[0] || newSchedule.workDate,
          workDates: createBatchMode ? createTargetDates : undefined,
          entries: calendarEntries.length > 0 ? calendarEntries : undefined,
      };

      const needsConflictPreview = createSelectedEmployeeIds.length > 1 || createTargetDates.length > 1;
      setCreatingSchedules(true);

      if (needsConflictPreview) {
        const previewResponse = await fetchJSONWithCSRF('/api/schedules', {
          method: 'POST',
          body: { ...payload, dryRun: true }
        });

        if (!previewResponse.ok) {
          const error = await previewResponse.json();
          showToast('error', error.error || '建立班表失敗');
          return;
        }

        const preview = await previewResponse.json();
        if ((preview.updatedCount ?? 0) > 0) {
          setPendingScheduleCreatePayload(payload);
          setScheduleConflictPreview({
            createdCount: preview.createdCount ?? 0,
            updatedCount: preview.updatedCount ?? 0,
            appliedCount: preview.appliedCount ?? 0,
            employeeCount: preview.employeeCount ?? createSelectedEmployeeIds.length,
            conflicts: preview.conflicts ?? [],
          });
          return;
        }
      }

      await submitCreateSchedulePayload(payload);
    } catch {
      showToast('error', '建立班表失敗，請稍後再試');
    } finally {
      setCreatingSchedules(false);
    }
  };

  const confirmScheduleConflictOverwrite = async () => {
    if (!pendingScheduleCreatePayload) return;

    try {
      setCreatingSchedules(true);
      const success = await submitCreateSchedulePayload(pendingScheduleCreatePayload);
      if (success) {
        setPendingScheduleCreatePayload(null);
        setScheduleConflictPreview(null);
      }
    } catch {
      showToast('error', '建立班表失敗，請稍後再試');
    } finally {
      setCreatingSchedules(false);
    }
  };

  const cancelScheduleConflictOverwrite = () => {
    if (creatingSchedules) return;
    setPendingScheduleCreatePayload(null);
    setScheduleConflictPreview(null);
  };

  const scheduleConflictMessage = scheduleConflictPreview
    ? [
        `本次將新增 ${scheduleConflictPreview.createdCount} 筆、覆蓋 ${scheduleConflictPreview.updatedCount} 筆班表。`,
        '確認後會以新班別取代下列既有班表：',
        ...scheduleConflictPreview.conflicts.slice(0, 8).map((conflict) => {
          const oldShift = getShiftDefinitionByCode(conflict.oldShiftType)?.label ?? conflict.oldShiftType;
          const newShift = getShiftDefinitionByCode(conflict.newShiftType)?.label ?? conflict.newShiftType;
          return `${conflict.workDate} ${conflict.employeeName}（${conflict.employeeCode}）：${oldShift} → ${newShift}`;
        }),
        scheduleConflictPreview.conflicts.length > 8 ? `另有 ${scheduleConflictPreview.conflicts.length - 8} 筆未列出。` : '',
      ].filter(Boolean).join('\n')
    : '';

  const handleBulkDeleteSchedules = async (e: React.FormEvent) => {
    e.preventDefault();
    if (createSelectedEmployeeIds.length === 0) {
      showToast('error', createEmployeeScope === 'filtered-active' ? '目前沒有可刪除班表的活躍員工，請先調整篩選條件' : '請選擇員工');
      return;
    }
    if (createTargetDates.length === 0) {
      if (!createBatchMode) {
        showToast('error', '請選擇刪除日期');
      } else {
        showToast('error', createDateSelectionMode === 'calendar' ? '請先在月曆中勾選至少一天' : '請選擇有效的日期區間與星期');
      }
      return;
    }

    setBulkDeleteConfirmOpen(true);
  };

  const performBulkDeleteSchedules = async () => {
    try {
      setDeletingSchedules(true);
      const response = await fetchJSONWithCSRF('/api/schedules', {
        method: 'DELETE',
        body: {
          employeeIds: createSelectedEmployeeIds,
          workDate: createTargetDates[0] || newSchedule.workDate,
          workDates: createBatchMode ? createTargetDates : undefined,
        }
      });

      if (response.ok) {
        const data = await response.json();
        const firstTargetDate = createTargetDates[0];
        const firstTarget = firstTargetDate ? parseDateString(firstTargetDate) : null;
        showToast('success', data.message || '班表刪除成功');
        setBulkDeleteConfirmOpen(false);
        closeScheduleModal();
        await syncScheduleViews(firstTarget);
      } else {
        const error = await response.json();
        showToast('error', error.error || '刪除班表失敗');
      }
    } catch {
      showToast('error', '刪除班表失敗，請稍後再試');
    } finally {
      setDeletingSchedules(false);
    }
  };

  // 點擊排程開啟編輯模態框
  const handleScheduleClick = (schedule: Schedule) => {
    const scheduleWeekday = getWeekdayFromDate(schedule.workDate);
    setEditingSchedule(schedule);
    setEditScheduleForm({
      shiftType: schedule.shiftType,
      startTime: schedule.startTime || '07:30',
      endTime: schedule.endTime || '16:30',
      breakTime: schedule.breakTime ?? 0,
      workHours: schedule.workHours ?? 0,
      specialLeaveHours: schedule.specialLeaveHours ?? 0,
      compLeaveHours: schedule.compLeaveHours ?? 0,
      overtimeHours: schedule.overtimeHours ?? 0
    });
    setEditBatchMode(false);
    setEditDateSelectionMode('range');
    setEditBatchRange({
      startDate: schedule.workDate,
      endDate: schedule.workDate,
      weekdays: scheduleWeekday === null ? [] : [scheduleWeekday],
    });
    const scheduleDate = parseDateString(schedule.workDate);
    setEditCalendarMonth(scheduleDate ? new Date(scheduleDate.getFullYear(), scheduleDate.getMonth(), 1) : new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
    setEditCalendarAssignments({ [schedule.workDate]: schedule.shiftType });
    setShowEditScheduleModal(true);
  };

  // 更新排程
  const handleUpdateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSchedule) return;
    if (editTargetDates.length === 0) {
      showToast('error', editBatchMode
        ? editDateSelectionMode === 'calendar'
          ? '請先在月曆中勾選至少一天'
          : '請選擇有效的日期區間與星期'
        : '請選擇要更新的班表');
      return;
    }

    try {
      const requiresTime = isShiftRequiresTime(editScheduleForm.shiftType);
      const updatePayload = {
        shiftType: editScheduleForm.shiftType,
        startTime: requiresTime ? editScheduleForm.startTime : '',
        endTime: requiresTime ? editScheduleForm.endTime : '',
        breakTime: requiresTime ? editScheduleForm.breakTime : 0,
        workHours: editScheduleForm.workHours,
        specialLeaveHours: editScheduleForm.specialLeaveHours,
        compLeaveHours: editScheduleForm.compLeaveHours,
        overtimeHours: editScheduleForm.overtimeHours
      };
      const calendarEntries = editBatchMode && editDateSelectionMode === 'calendar'
        ? editCalendarSelectedDates.map((date) => ({
            workDate: date,
            shiftType: editCalendarAssignments[date] || editScheduleForm.shiftType,
          }))
        : [];
      const response = await fetchJSONWithCSRF(
        editBatchMode ? '/api/schedules' : `/api/schedules/${editingSchedule.id}`,
        {
          method: 'PUT',
          body: editBatchMode
            ? {
                ...updatePayload,
                employeeId: editingSchedule.employee.id,
                workDates: editTargetDates,
                entries: calendarEntries.length > 0 ? calendarEntries : undefined,
              }
            : updatePayload
        }
      );

      if (response.ok) {
        const data = await response.json();
        const firstTargetDate = editTargetDates[0] ?? editingSchedule.workDate;
        const firstTarget = firstTargetDate ? parseDateString(firstTargetDate) : null;
        showToast('success', data.message || '班表更新成功');
        setShowEditScheduleModal(false);
        setEditingSchedule(null);
        setEditBatchMode(false);
        setEditDateSelectionMode('range');
        setEditCalendarAssignments({});
        await syncScheduleViews(firstTarget);
      } else {
        const error = await response.json();
        showToast('error', error.error || '更新失敗');
      }
    } catch {
      showToast('error', '更新失敗，請稍後再試');
    }
  };

  // 刪除排程
  const handleDeleteSchedule = async () => {
    if (!editingSchedule) return;
    setScheduleDeleteConfirmOpen(true);
  };

  const performDeleteSchedule = async () => {
    if (!editingSchedule) return;
    try {
      setDeletingSchedules(true);
      const targetDate = parseDateString(editingSchedule.workDate);
      const response = await fetchJSONWithCSRF(`/api/schedules/${editingSchedule.id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        showToast('success', '班表刪除成功');
        setScheduleDeleteConfirmOpen(false);
        setShowEditScheduleModal(false);
        setEditingSchedule(null);
        setEditBatchMode(false);
        setEditDateSelectionMode('range');
        setEditCalendarAssignments({});
        await syncScheduleViews(targetDate);
      } else {
        const error = await response.json();
        showToast('error', error.error || '刪除失敗');
      }
    } catch {
      showToast('error', '刪除失敗，請稍後再試');
    } finally {
      setDeletingSchedules(false);
    }
  };

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetchJSONWithCSRF('/api/schedules/templates', {
        method: 'POST',
        body: newTemplate
      });

      if (response.ok) {
        showToast('success', '週模版建立成功');
        setShowTemplateModal(false);
        resetTemplateForm();
        fetchWeeklyTemplates();
      } else {
        const error = await response.json();
        showToast('error', error.error || '建立週模版失敗');
      }
    } catch {
      showToast('error', '建立週模版失敗，請稍後再試');
    }
  };

  const handleUpdateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTemplate || !editingTemplate.id) return;

    try {
      const response = await fetchJSONWithCSRF(`/api/schedules/templates/${editingTemplate.id}`, {
        method: 'PUT',
        body: newTemplate
      });

      if (response.ok) {
        showToast('success', '週模版更新成功');
        setShowTemplateModal(false);
        setEditingTemplate(null);
        resetTemplateForm();
        fetchWeeklyTemplates();
      } else {
        const error = await response.json();
        showToast('error', error.error || '更新週模版失敗');
      }
    } catch {
      showToast('error', '更新週模版失敗，請稍後再試');
    }
  };

  const handleApplyTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplateId || !applyToMonth) return;

    if (selectedEmployees.length === 0) {
      showToast('error', '請至少選擇一位員工');
      return;
    }

    try {
      const [year, month] = applyToMonth.split('-').map(Number);
      const targetMonthDate = new Date(year, month - 1, 1);
      const response = await fetchJSONWithCSRF('/api/schedules/apply-template', {
        method: 'POST',
        body: {
          templateId: selectedTemplateId,
          year,
          month,
          employeeIds: selectedEmployees,
          overwriteExisting: true
        }
      });

      if (response.ok) {
        const data = await response.json();
        showToast('success', data.message || '週模版套用成功');
        setShowApplyTemplateModal(false);
        setSelectedTemplateId(null);
        setApplyToMonth('');
        setSelectedEmployees([]);
        setEmployeeSearch('');
        await syncScheduleViews(targetMonthDate);
      } else {
        const error = await response.json();
        showToast('error', error.error || '套用週模版失敗');
      }
    } catch {
      showToast('error', '套用週模版失敗，請稍後再試');
    }
  };

  // 篩選員工（用於套用模版）
  const filteredEmployees = manageableScheduleEmployees.filter(employee => {
    // 先套用部門篩選
    if (templateDepartmentFilter && employee.department !== templateDepartmentFilter) {
      return false;
    }
    // 再套用搜尋篩選
    if (!employeeSearch) return true;
    const searchLower = employeeSearch.toLowerCase();
    return (
      employee.employeeId.toLowerCase().includes(searchLower) ||
      employee.name.toLowerCase().includes(searchLower) ||
      employee.department.toLowerCase().includes(searchLower)
    );
  });

  // 取得部門列表（用於模版部門篩選）
  const templateDepartments = isFullAdmin && departmentOptions.length > 0
    ? departmentOptions.map((department) => department.name)
    : [...new Set(manageableScheduleEmployees.map((employee) => employee.department).filter(Boolean))].sort();

  const canViewScheduleConfirmations = user?.role === 'ADMIN' || user?.role === 'HR';
  const confirmationStats = useMemo(() => ({
    total: confirmationResults.length,
    confirmed: confirmationResults.filter((item) => item.status === 'CONFIRMED').length,
    pending: confirmationResults.filter((item) => item.status === 'PENDING').length,
    needReconfirm: confirmationResults.filter((item) => item.status === 'NEED_RECONFIRM').length,
    expired: confirmationResults.filter((item) => item.status === 'EXPIRED').length,
    notReleased: confirmationResults.filter((item) => item.status === 'NOT_RELEASED').length,
  }), [confirmationResults]);
  const hasConfirmationReleaseData = useMemo(
    () => confirmationResults.some((item) => Boolean(item.release)),
    [confirmationResults]
  );

  useEffect(() => {
    const activeEmployeeCodes = new Set(activeEmployees.map((employee) => employee.employeeId));
    const manageableEmployeeIds = new Set(manageableScheduleEmployees.map((employee) => employee.id));

    setSelectedEmployees((prev) => prev.filter((employeeId) => manageableEmployeeIds.has(employeeId)));
    setCreateCheckedEmployeeIds((prev) => prev.filter((employeeId) => manageableEmployeeIds.has(employeeId)));
    setNewSchedule((prev) => (
      !prev.employeeId || manageableEmployeeIds.has(Number(prev.employeeId))
        ? prev
        : { ...prev, employeeId: '' }
    ));
    setSearchFilters((prev) => (
      !prev.employeeId || activeEmployeeCodes.has(prev.employeeId)
        ? prev
        : { ...prev, employeeId: '', employeeName: '' }
    ));
    setConfirmationFilters((prev) => (
      !prev.employeeId || activeEmployeeCodes.has(prev.employeeId)
        ? prev
        : { ...prev, employeeId: '' }
    ));
  }, [activeEmployees, manageableScheduleEmployees]);

  // 处理员工选择
  const handleEmployeeToggle = (employeeId: number) => {
    setSelectedEmployees(prev => 
      prev.includes(employeeId) 
        ? prev.filter(id => id !== employeeId)
        : [...prev, employeeId]
    );
  };

  // 全选/取消全选员工
  const handleSelectAllEmployees = () => {
    if (selectedEmployees.length === filteredEmployees.length) {
      setSelectedEmployees([]);
    } else {
      setSelectedEmployees(filteredEmployees.map(emp => emp.id));
    }
  };

  const handleCreateEmployeeToggle = (employeeId: number) => {
    setCreateCheckedEmployeeIds((prev) => (
      prev.includes(employeeId)
        ? prev.filter((id) => id !== employeeId)
        : [...prev, employeeId]
    ));
  };

  const handleSelectAllCreateEmployees = () => {
    const optionIds = createEmployeeOptions.map((employee) => employee.id);
    if (optionIds.length === 0) return;

    setCreateCheckedEmployeeIds((prev) => {
      const optionIdSet = new Set(optionIds);
      const alreadySelectedAll = optionIds.every((employeeId) => prev.includes(employeeId));
      if (alreadySelectedAll) {
        return prev.filter((employeeId) => !optionIdSet.has(employeeId));
      }

      return Array.from(new Set([...prev, ...optionIds]));
    });
  };

  const clearCreateCheckedEmployees = () => {
    setCreateCheckedEmployeeIds([]);
  };

  const resetScheduleForm = () => {
    const defaultShiftCode = shiftOptions[0]?.code || 'A';
    const defaultShiftTemplate = getShiftTemplateForCode(defaultShiftCode);
    setNewSchedule({
      employeeId: '',
      workDate: '',
      shiftType: defaultShiftCode,
      startTime: defaultShiftTemplate.startTime,
      endTime: defaultShiftTemplate.endTime,
      breakTime: defaultShiftTemplate.breakTime,
      workHours: defaultShiftTemplate.workHours,
      specialLeaveHours: defaultShiftTemplate.specialLeaveHours,
      compLeaveHours: defaultShiftTemplate.compLeaveHours,
      overtimeHours: defaultShiftTemplate.overtimeHours
    });
    setCreateBatchMode(false);
    setCreateEmployeeScope('single');
    setCreateCheckedEmployeeIds([]);
    setCreateDateSelectionMode('range');
    setCreateBatchRange({
      startDate: '',
      endDate: '',
      weekdays: ALL_WEEKDAYS,
    });
    setCreateCalendarMonth(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
    setCreateCalendarAssignments({});
    setCreateCalendarExistingSchedules({});
    setCreateCalendarExistingLoading(false);
    resetCreateEmployeeFilters();
  };

  const closeScheduleModal = () => {
    setShowScheduleModal(false);
    setScheduleModalMode('create');
    resetScheduleForm();
  };

  const openCreateScheduleModal = (workDate?: string) => {
    if (shiftOptions.length === 0) {
      showToast('error', '目前沒有啟用中的班別，請先至系統設定啟用或新增班別');
      return;
    }

    resetScheduleForm();
    setScheduleModalMode('create');
    if (workDate) {
      setNewSchedule((prev) => ({ ...prev, workDate }));
      const parsedDate = parseDateString(workDate);
      if (parsedDate) {
        setCreateCalendarMonth(new Date(parsedDate.getFullYear(), parsedDate.getMonth(), 1));
      }
    }
    setShowScheduleModal(true);
  };

  const openDeleteScheduleModal = () => {
    resetScheduleForm();
    setScheduleModalMode('delete');
    setCreateBatchMode(true);
    setCreateEmployeeScope('checked');
    setShowScheduleModal(true);
  };

  const resetTemplateForm = () => {
    const defaultShiftCode = shiftOptions[0]?.code || 'A';
    const defaultShiftTemplate = getShiftTemplateForCode(defaultShiftCode);
    const restDayCode = shiftOptions.find((shift) => !shift.requiresTime)?.code || 'RD';
    const restDayTemplate = getShiftTemplateForCode(restDayCode);
    setNewTemplate({
      name: '',
      description: '',
      monday: { shiftType: defaultShiftCode, startTime: defaultShiftTemplate.startTime, endTime: defaultShiftTemplate.endTime, breakTime: defaultShiftTemplate.breakTime, workHours: defaultShiftTemplate.workHours, specialLeaveHours: defaultShiftTemplate.specialLeaveHours, compLeaveHours: defaultShiftTemplate.compLeaveHours, overtimeHours: defaultShiftTemplate.overtimeHours },
      tuesday: { shiftType: defaultShiftCode, startTime: defaultShiftTemplate.startTime, endTime: defaultShiftTemplate.endTime, breakTime: defaultShiftTemplate.breakTime, workHours: defaultShiftTemplate.workHours, specialLeaveHours: defaultShiftTemplate.specialLeaveHours, compLeaveHours: defaultShiftTemplate.compLeaveHours, overtimeHours: defaultShiftTemplate.overtimeHours },
      wednesday: { shiftType: defaultShiftCode, startTime: defaultShiftTemplate.startTime, endTime: defaultShiftTemplate.endTime, breakTime: defaultShiftTemplate.breakTime, workHours: defaultShiftTemplate.workHours, specialLeaveHours: defaultShiftTemplate.specialLeaveHours, compLeaveHours: defaultShiftTemplate.compLeaveHours, overtimeHours: defaultShiftTemplate.overtimeHours },
      thursday: { shiftType: defaultShiftCode, startTime: defaultShiftTemplate.startTime, endTime: defaultShiftTemplate.endTime, breakTime: defaultShiftTemplate.breakTime, workHours: defaultShiftTemplate.workHours, specialLeaveHours: defaultShiftTemplate.specialLeaveHours, compLeaveHours: defaultShiftTemplate.compLeaveHours, overtimeHours: defaultShiftTemplate.overtimeHours },
      friday: { shiftType: defaultShiftCode, startTime: defaultShiftTemplate.startTime, endTime: defaultShiftTemplate.endTime, breakTime: defaultShiftTemplate.breakTime, workHours: defaultShiftTemplate.workHours, specialLeaveHours: defaultShiftTemplate.specialLeaveHours, compLeaveHours: defaultShiftTemplate.compLeaveHours, overtimeHours: defaultShiftTemplate.overtimeHours },
      saturday: { shiftType: restDayCode, startTime: restDayTemplate.startTime, endTime: restDayTemplate.endTime, breakTime: restDayTemplate.breakTime, workHours: restDayTemplate.workHours, specialLeaveHours: restDayTemplate.specialLeaveHours, compLeaveHours: restDayTemplate.compLeaveHours, overtimeHours: restDayTemplate.overtimeHours },
      sunday: { shiftType: restDayCode, startTime: restDayTemplate.startTime, endTime: restDayTemplate.endTime, breakTime: restDayTemplate.breakTime, workHours: restDayTemplate.workHours, specialLeaveHours: restDayTemplate.specialLeaveHours, compLeaveHours: restDayTemplate.compLeaveHours, overtimeHours: restDayTemplate.overtimeHours }
    });
    setEditingTemplate(null);
  };

  const generateCalendarDays = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const firstDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    
    const days = [];
    
    // 填充上個月的空白日期
    for (let i = 0; i < firstDayOfWeek; i++) {
      days.push(null);
    }
    
    // 填充當月的日期
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(day);
    }
    
    return days;
  };

  const formatDate = (day: number | null) => {
    if (!day) return '';
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    // 使用本地時區格式化日期，避免 UTC 轉換導致日期偏移
    const d = new Date(year, month, day);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const goToPreviousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  // 取得該日期的國定假日資訊
  const getHolidayForDate = useCallback((dateStr: string, holidayList: Holiday[] = holidays) => {
    return holidayList.find(h => {
      // 處理時區問題：將 ISO 日期轉為本地日期格式比對
      const holidayDate = new Date(h.date);
      const yyyy = holidayDate.getFullYear();
      const mm = String(holidayDate.getMonth() + 1).padStart(2, '0');
      const dd = String(holidayDate.getDate()).padStart(2, '0');
      const formattedHolidayDate = `${yyyy}-${mm}-${dd}`;
      return formattedHolidayDate === dateStr;
    });
  }, [holidays]);

  const buildSearchCalendarDocument = useCallback(async () => {
    if (!searchCalendarPeriod || searchResultGroups.length === 0) {
      return null;
    }

    const holidayList = await fetchHolidayList(searchCalendarPeriod.year);
    const firstDayOfWeek = new Date(searchCalendarPeriod.year, searchCalendarPeriod.month - 1, 1).getDay();
    const daysInMonth = new Date(searchCalendarPeriod.year, searchCalendarPeriod.month, 0).getDate();
    const filterSummary = [
      `查詢月份：${searchCalendarPeriod.label}`,
      `範圍：${searchResultScopeLabel}`,
      searchFilters.department ? `部門：${searchFilters.department}` : null,
      searchFilters.position ? `職位：${searchFilters.position}` : null,
    ].filter(Boolean);

    const employeeSections = searchResultGroups.map((group) => {
      const schedulesByDate = new Map<string, Schedule[]>();
      group.schedules.forEach((schedule) => {
        const existing = schedulesByDate.get(schedule.workDate) ?? [];
        existing.push(schedule);
        schedulesByDate.set(schedule.workDate, existing);
      });

      let cells = '';
      for (let i = 0; i < firstDayOfWeek; i += 1) {
        cells += '<div class="calendar-cell empty"></div>';
      }

      for (let day = 1; day <= daysInMonth; day += 1) {
        const date = `${searchCalendarPeriod.value}-${String(day).padStart(2, '0')}`;
        const daySchedules = schedulesByDate.get(date) ?? [];
        const holiday = getHolidayForDate(date, holidayList);

        cells += `
          <div class="calendar-cell ${holiday ? 'holiday' : ''}">
            <div class="calendar-day-row">
              <div class="calendar-day">${day}</div>
              ${holiday ? `<span class="holiday-mark" title="${escapeHtml(holiday.name)}">🎌</span>` : ''}
            </div>
            ${holiday ? `<div class="holiday-name">${escapeHtml(holiday.name)}</div>` : ''}
            <div class="schedule-list">
              ${daySchedules.slice(0, 2).map((schedule) => `
                <div class="schedule-card">
                  <div class="schedule-shift">${escapeHtml(getCalendarScheduleLabel(schedule))}</div>
                  <div class="schedule-hours">${escapeHtml(getScheduleHourSummary(schedule))}</div>
                </div>
              `).join('')}
              ${daySchedules.length > 2 ? `<div class="schedule-more">+${daySchedules.length - 2} 筆</div>` : ''}
            </div>
          </div>
        `;
      }

      return `
        <section class="employee-section">
          <div class="employee-header">
            <h2>${escapeHtml(group.employee.name)}（${escapeHtml(group.employee.employeeId)}）</h2>
            <div class="employee-meta">${escapeHtml(group.employee.department)}｜${escapeHtml(group.employee.position)}</div>
          </div>
          <div class="calendar-grid">
            ${['日', '一', '二', '三', '四', '五', '六'].map((weekday) => `<div class="calendar-weekday">${weekday}</div>`).join('')}
            ${cells}
          </div>
        </section>
      `;
    }).join('');

    return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(searchCalendarPeriod.label)}班表匯出</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Microsoft JhengHei', sans-serif; margin: 0; padding: 16px; color: #111827; }
    .toolbar { position: fixed; top: 16px; right: 16px; z-index: 10; }
    .toolbar button { border: none; border-radius: 6px; padding: 10px 16px; background: #2563eb; color: #fff; cursor: pointer; font-size: 13px; }
    .page-header { margin-bottom: 20px; }
    .page-header h1 { margin: 0 0 8px; font-size: 24px; color: #1d4ed8; }
    .page-header .meta { color: #4b5563; font-size: 13px; line-height: 1.6; }
    .employee-section { page-break-after: always; margin-bottom: 24px; }
    .employee-section:last-of-type { page-break-after: auto; }
    .employee-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
    .employee-header h2 { margin: 0; font-size: 18px; }
    .employee-meta { color: #6b7280; font-size: 12px; }
    .calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
    .calendar-weekday { padding: 8px; text-align: center; background: #eff6ff; color: #1d4ed8; border-radius: 6px; font-weight: 600; font-size: 12px; }
    .calendar-cell { min-height: 112px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 6px; background: #fff; }
    .calendar-cell.empty { background: #f9fafb; border-style: dashed; }
    .calendar-cell.holiday { background: #fef2f2; border-color: #fca5a5; }
    .calendar-day-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .calendar-day { font-size: 12px; font-weight: 700; }
    .holiday-mark, .holiday-name { color: #dc2626; }
    .holiday-name { font-size: 10px; margin-bottom: 4px; }
    .schedule-list { display: flex; flex-direction: column; gap: 4px; }
    .schedule-card { border: 1px solid #dbeafe; background: #eff6ff; border-radius: 6px; padding: 4px 6px; }
    .schedule-shift { font-size: 11px; font-weight: 600; color: #1f2937; }
    .schedule-hours { margin-top: 2px; font-size: 10px; color: #4b5563; }
    .schedule-more { font-size: 10px; color: #6b7280; padding-left: 4px; }
    @media print { .toolbar { display: none; } body { padding: 0; } }
  </style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">列印 / 存為 PDF</button></div>
  <header class="page-header">
    <h1>${escapeHtml(searchCalendarPeriod.label)} 班表月曆</h1>
    <div class="meta">${filterSummary.map((item) => escapeHtml(item)).join('｜')}</div>
  </header>
  ${employeeSections}
</body>
</html>`;
  }, [fetchHolidayList, getCalendarScheduleLabel, getHolidayForDate, getScheduleHourSummary, searchCalendarPeriod, searchFilters.department, searchFilters.position, searchResultGroups, searchResultScopeLabel]);

  const handlePrintSearchCalendar = useCallback(async () => {
    const html = await buildSearchCalendarDocument();
    if (!html) {
      showToast('error', '請先指定單一年月份並完成搜尋後，再列印月曆。');
      return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showToast('error', '無法開啟列印視窗，請確認瀏覽器未封鎖彈出視窗。');
      return;
    }

    printWindow.document.write(html);
    printWindow.document.close();
  }, [buildSearchCalendarDocument, showToast]);

  const handleExportSearchCalendar = useCallback(async () => {
    const html = await buildSearchCalendarDocument();
    if (!html || !searchCalendarPeriod) {
      showToast('error', '請先指定單一年月份並完成搜尋後，再匯出班表。');
      return;
    }

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `班表月曆_${searchCalendarPeriod.value}_${searchResultScopeLabel}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }, [buildSearchCalendarDocument, searchCalendarPeriod, searchResultScopeLabel, showToast]);

  const handleExportSearchResultsXlsx = useCallback(async () => {
    if (searchResults.length === 0) {
      showToast('error', '請先完成搜尋後，再匯出班表.xlsx');
      return;
    }

    try {
      const exportTime = new Date().toLocaleString('zh-TW', { hour12: false });
      const monthLabel = searchCalendarPeriod?.label ?? (searchFilters.yearMonth || '未指定月份');
      const summaryRows: (string | number)[][] = [
        ['項目', '內容'],
        ['查詢月份', monthLabel],
        ['查詢範圍', searchResultScopeLabel],
        ['部門篩選', searchFilters.department || '全部'],
        ['職位篩選', searchFilters.position || '全部'],
        ['員工篩選', searchFilters.employeeName ? `${searchFilters.employeeName}（${searchFilters.employeeId}）` : (searchFilters.employeeId || '全部員工')],
        ['記錄筆數', searchResults.length],
        ['員工人數', searchResultGroups.length],
        ['匯出時間', exportTime],
      ];

      const employeeSummaryRows: (string | number)[][] = [
        ['員編', '姓名', '部門', '職位', '排班筆數', '班別分布'],
        ...searchResultGroups.map((group) => {
          const shiftDistribution = Array.from(
            group.schedules.reduce((acc, schedule) => {
              acc.set(schedule.shiftType, (acc.get(schedule.shiftType) ?? 0) + 1);
              return acc;
            }, new Map<string, number>())
          )
            .map(([shiftType, count]) => `${shiftType} ${count}筆`)
            .join('、');

          return [
            group.employee.employeeId,
            group.employee.name,
            group.employee.department || '-',
            group.employee.position || '-',
            group.schedules.length,
            shiftDistribution || '-',
          ];
        }),
      ];

      const detailRows: (string | number)[][] = [
        ['日期', '星期', '員編', '姓名', '部門', '職位', '班別代碼', '班別顯示', '時間', '工時摘要', '工時', '特休時數', '補休時數', '加班時數'],
        ...[...searchResults]
          .sort((a, b) => a.workDate.localeCompare(b.workDate) || a.employee.employeeId.localeCompare(b.employee.employeeId))
          .map((schedule) => [
            formatExportDate(schedule.workDate),
            getWeekdayLabel(schedule.workDate),
            schedule.employee.employeeId,
            schedule.employee.name,
            schedule.employee.department || '-',
            schedule.employee.position || '-',
            schedule.shiftType,
            getCalendarScheduleLabel(schedule),
            getScheduleTimeText(schedule),
            getScheduleHourSummary(schedule),
            schedule.workHours ?? 0,
            schedule.specialLeaveHours ?? 0,
            schedule.compLeaveHours ?? 0,
            schedule.overtimeHours ?? 0,
          ]),
      ];

      await downloadWorkbookAsXlsx({
        fileName: `班表搜尋結果_${searchFilters.yearMonth || '全部月份'}_${sanitizeFileNameSegment(searchResultScopeLabel)}.xlsx`,
        sheets: [
          {
            name: '查詢摘要',
            rows: summaryRows,
            columnWidths: [18, 40],
          },
          {
            name: '員工彙總',
            rows: employeeSummaryRows,
            columnWidths: [12, 14, 16, 14, 10, 32],
          },
          {
            name: '班表明細',
            rows: detailRows,
            columnWidths: [14, 8, 12, 14, 16, 14, 10, 24, 20, 18, 10, 10, 10, 10],
          },
        ],
      });

      showToast('success', '搜尋結果班表.xlsx 匯出成功');
    } catch (error) {
      console.error('匯出搜尋結果班表 xlsx 失敗:', error);
      showToast('error', '匯出班表.xlsx 失敗，請稍後再試');
    }
  }, [
    getCalendarScheduleLabel,
    getScheduleHourSummary,
    getScheduleTimeText,
    searchCalendarPeriod,
    searchFilters.department,
    searchFilters.employeeId,
    searchFilters.employeeName,
    searchFilters.position,
    searchFilters.yearMonth,
    searchResultGroups,
    searchResultScopeLabel,
    searchResults,
    showToast,
  ]);

  // 部門主管自動選擇自己的部門
  useEffect(() => {
    if (isDepartmentManager && userDepartment && !isFullAdmin && !hasSchedulePermission && !locationFilter) {
      setLocationFilter(userDepartment);
    } else if (hasSchedulePermission && !isFullAdmin && schedulePermissions.length === 1 && !locationFilter) {
      setLocationFilter(schedulePermissions[0]);
    }
  }, [isDepartmentManager, userDepartment, hasSchedulePermission, isFullAdmin, schedulePermissions, locationFilter]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <CalendarDays className="w-12 h-12 text-blue-600 mx-auto mb-4 animate-pulse" />
          <p className="text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <AuthenticatedLayout>
      {/* Toast 通知 */}
      <SimpleToast toast={toast} onClose={clearToast} />
      
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 標題區 */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center">
                <CalendarDays className="w-8 h-8 text-blue-600 mr-3" />
                班表管理
              </h1>
              <p className="text-gray-600 mt-2">管理員工班表，支援日曆檢視及週模版功能</p>
            </div>
            {canManage && (
              <div className="flex space-x-3 flex-wrap gap-2">
                <QuickCopySchedule onSuccess={fetchMonthlySchedules} />
                <button
                  onClick={() => window.location.href = '/schedule-management/weekly-templates'}
                  className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors flex items-center"
                >
                  <Calendar className="w-5 h-5 mr-2" />
                  週班模版
                </button>
                <button
                  onClick={() => shiftOptions.length > 0 ? setShowApplyTemplateModal(true) : showToast('error', '目前沒有啟用中的班別，請先至系統設定啟用或新增班別')}
                  disabled={shiftDefinitionsLoaded && shiftOptions.length === 0}
                  className="bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors flex items-center disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  <Calendar className="w-5 h-5 mr-2" />
                  套用模版
                </button>
                <button
                  onClick={() => {
                    if (shiftOptions.length === 0) {
                      showToast('error', '目前沒有啟用中的班別，請先至系統設定啟用或新增班別');
                      return;
                    }
                    resetTemplateForm();
                    setShowTemplateModal(true);
                  }}
                  disabled={shiftDefinitionsLoaded && shiftOptions.length === 0}
                  className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors flex items-center disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  <Copy className="w-5 h-5 mr-2" />
                  建立週模版
                </button>
                <button
                  onClick={() => openCreateScheduleModal()}
                  disabled={shiftDefinitionsLoaded && shiftOptions.length === 0}
                  className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors flex items-center disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  <Plus className="w-5 h-5 mr-2" />
                  建立班表
                </button>
                <button
                  onClick={openDeleteScheduleModal}
                  className="bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 transition-colors flex items-center"
                >
                  <Trash2 className="w-5 h-5 mr-2" />
                  刪除班表
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 據點篩選區 */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">據點篩選</h2>
              <div className="flex items-center gap-4">
                <select
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                  className="min-w-55 rounded-lg border border-gray-300 px-4 py-2.5 text-base font-semibold text-gray-900 focus:ring-2 focus:ring-blue-500"
                  disabled={!!(hasSchedulePermission && !isFullAdmin && allowedLocations.length === 1)}
                >
                  {isFullAdmin ? (
                    <>
                      <option value="">全部據點</option>
                      {LOCATIONS.map((loc) => (
                        <option key={loc} value={loc}>{loc}</option>
                      ))}
                    </>
                  ) : hasSchedulePermission ? (
                    <>
                      {allowedLocations.length > 1 && <option value="">選擇據點</option>}
                      {allowedLocations.map((loc) => (
                        <option key={loc} value={loc}>{loc}</option>
                      ))}
                    </>
                  ) : (
                    <>
                      <option value="">全部據點</option>
                      {LOCATIONS.map((loc) => (
                        <option key={loc} value={loc}>{loc}</option>
                      ))}
                    </>
                  )}
                </select>
                {locationFilter && isFullAdmin && (
                  <button
                    onClick={() => setLocationFilter('')}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    清除篩選
                  </button>
                )}
              </div>
            </div>
            
            {/* 據點統計 */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
              {(isFullAdmin ? LOCATIONS : (hasSchedulePermission ? allowedLocations : LOCATIONS)).map((loc) => {
                const locEmployees = employees.filter(e => e.department === loc);
                const locScheduleCount = Object.values(calendarSchedules).flat().filter(
                  s => locEmployees.some(e => e.id === s.employeeId)
                ).length;
                const canClickLocation = isFullAdmin || allowedLocations.includes(loc);
                return (
                  <button
                    key={loc}
                    onClick={() => canClickLocation && setLocationFilter(locationFilter === loc ? '' : loc)}
                    disabled={!canClickLocation}
                    className={`p-3 rounded-lg text-left transition-colors ${
                      locationFilter === loc
                        ? 'bg-blue-100 border-2 border-blue-500'
                        : canClickLocation
                          ? 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
                          : 'bg-gray-100 border border-gray-200 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <div className="text-base font-semibold text-gray-900" title={loc}>
                      {loc}
                    </div>
                    <div className="text-sm font-medium text-gray-700 mt-1">
                      {locEmployees.length} 人 / {locScheduleCount} 班
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 搜尋面板 */}
        <div className="bg-white rounded-lg shadow mb-8">
          <div className="p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">查詢員工班表</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">年月份</label>
                <input
                  type="month"
                  value={searchFilters.yearMonth}
                  onChange={(e) => setSearchFilters({ ...searchFilters, yearMonth: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  placeholder="選擇年月"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">員編</label>
                <input
                  type="text"
                  value={searchFilters.employeeId}
                  onChange={(e) => setSearchFilters({ ...searchFilters, employeeId: e.target.value, employeeName: '' })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  placeholder="可手動輸入或由姓名帶入"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">姓名（員工清單）</label>
                <select
                  value={searchFilters.employeeName ? searchFilters.employeeId : ''}
                  onChange={(e) => handleSearchEmployeeSelect(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                >
                  <option value="">全部員工</option>
                  {searchEmployeeOptions.map((employee) => (
                    <option key={employee.id} value={employee.employeeId}>
                      {formatEmployeeOption(employee)}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">選擇員工後會自動帶入員編，避免姓名輸入錯字。</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">部門</label>
                <select
                  value={searchFilters.department}
                  onChange={(e) => {
                    const nextDepartment = e.target.value;
                    const selectedEmployee = employees.find((employee) => employee.employeeId === searchFilters.employeeId);
                    setSearchFilters({
                      ...searchFilters,
                      department: nextDepartment,
                      employeeId: selectedEmployee && nextDepartment && selectedEmployee.department !== nextDepartment ? '' : searchFilters.employeeId,
                      employeeName: selectedEmployee && nextDepartment && selectedEmployee.department !== nextDepartment ? '' : searchFilters.employeeName,
                    });
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                >
                  <option value="">全部</option>
                  {scheduleDepartmentOptions.map((loc) => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">職位</label>
                <select
                  value={searchFilters.position}
                  onChange={(e) => {
                    const nextPosition = e.target.value;
                    const selectedEmployee = employees.find((employee) => employee.employeeId === searchFilters.employeeId);
                    setSearchFilters({
                      ...searchFilters,
                      position: nextPosition,
                      employeeId: selectedEmployee && nextPosition && selectedEmployee.position !== nextPosition ? '' : searchFilters.employeeId,
                      employeeName: selectedEmployee && nextPosition && selectedEmployee.position !== nextPosition ? '' : searchFilters.employeeName,
                    });
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                >
                  <option value="">全部</option>
                  {positionOptions.map((pos) => (
                    <option key={pos} value={pos}>{pos}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end space-x-2">
                <button
                  onClick={handleSearchSchedules}
                  disabled={searchLoading}
                  className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {searchLoading ? '搜尋中...' : '搜尋班表'}
                </button>
                <button
                  onClick={() => {
                    setSearchFilters({ yearMonth: '', employeeId: '', employeeName: '', department: '', position: '', location: '' });
                    setSearchResults([]);
                    fetchMonthlySchedules();
                  }}
                  className="bg-gray-500 text-white px-4 py-2 rounded-md hover:bg-gray-600 transition-colors"
                >
                  重置
                </button>
              </div>
            </div>
          </div>
        </div>

        {canViewScheduleConfirmations && (
          <div className="bg-white rounded-lg shadow mb-8">
            <div className="p-6">
              <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">班表確認查詢</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    查詢活躍員工在指定月份的班表與確認狀態，可依員工、部門與確認狀態交叉篩選；已有排班者會列入待確認。
                  </p>
                  {hasConfirmationReleaseData && (
                    <p className="mt-1 text-xs text-gray-400">
                      發布者、發布日期與確認截止僅在有正式發布紀錄時顯示。
                    </p>
                  )}
                </div>
                {confirmationHasSearched && (
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-700">
                    共 {confirmationStats.total} 筆
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-1">月份</label>
                  <input
                    type="month"
                    value={confirmationFilters.yearMonth}
                    onChange={(e) => setConfirmationFilters((prev) => ({
                      ...prev,
                      yearMonth: e.target.value,
                    }))}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-1">部門</label>
                  <select
                    value={confirmationFilters.department}
                    onChange={(e) => {
                      const nextDepartment = e.target.value;
                      const selectedEmployee = activeEmployees.find((employee) => employee.employeeId === confirmationFilters.employeeId);
                      setConfirmationFilters((prev) => ({
                        ...prev,
                        department: nextDepartment,
                        employeeId: selectedEmployee && nextDepartment && selectedEmployee.department !== nextDepartment
                          ? ''
                          : prev.employeeId,
                      }));
                    }}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">全部部門</option>
                    {scheduleDepartmentOptions.map((department) => (
                      <option key={department} value={department}>{department}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-1">員工</label>
                  <select
                    value={confirmationFilters.employeeId}
                    onChange={(e) => setConfirmationFilters((prev) => ({
                      ...prev,
                      employeeId: e.target.value,
                    }))}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">全部活躍員工</option>
                    {confirmationEmployeeOptions.map((employee) => (
                      <option key={employee.id} value={employee.employeeId}>
                        {formatEmployeeOption(employee)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-1">班表確認狀態</label>
                  <select
                    value={confirmationFilters.status}
                    onChange={(e) => setConfirmationFilters((prev) => ({
                      ...prev,
                      status: e.target.value,
                    }))}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">全部狀態</option>
                    {SCHEDULE_CONFIRM_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={() => fetchScheduleConfirmations(confirmationFilters)}
                    disabled={confirmationLoading}
                    className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {confirmationLoading ? '查詢中...' : '查詢確認狀態'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const resetFilters = {
                        yearMonth: getCurrentYearMonth(),
                        employeeId: '',
                        department: '',
                        status: '',
                      };
                      setConfirmationFilters(resetFilters);
                      setConfirmationResults([]);
                      setConfirmationHasSearched(false);
                    }}
                    className="rounded-md bg-gray-500 px-4 py-2 text-white transition-colors hover:bg-gray-600"
                  >
                    重置
                  </button>
                </div>
              </div>

              {confirmationHasSearched && (
                <>
                  <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-sm font-medium text-slate-600">總人數</div>
                      <div className="mt-1 text-2xl font-bold text-slate-900">{confirmationStats.total}</div>
                    </div>
                    <div className="rounded-lg bg-green-50 p-3">
                      <div className="text-sm font-medium text-green-700">已確認</div>
                      <div className="mt-1 text-2xl font-bold text-green-900">{confirmationStats.confirmed}</div>
                    </div>
                    <div className="rounded-lg bg-amber-50 p-3">
                      <div className="text-sm font-medium text-amber-700">待確認</div>
                      <div className="mt-1 text-2xl font-bold text-amber-900">{confirmationStats.pending}</div>
                    </div>
                    <div className="rounded-lg bg-orange-50 p-3">
                      <div className="text-sm font-medium text-orange-700">需重確認</div>
                      <div className="mt-1 text-2xl font-bold text-orange-900">{confirmationStats.needReconfirm}</div>
                    </div>
                    <div className="rounded-lg bg-red-50 p-3">
                      <div className="text-sm font-medium text-red-700">已逾期</div>
                      <div className="mt-1 text-2xl font-bold text-red-900">{confirmationStats.expired}</div>
                    </div>
                    <div className="rounded-lg bg-slate-100 p-3">
                      <div className="text-sm font-medium text-slate-700">未發布</div>
                      <div className="mt-1 text-2xl font-bold text-slate-900">{confirmationStats.notReleased}</div>
                    </div>
                  </div>

                  <div className="mt-6 overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">月份</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">員編</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">姓名</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">部門</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">班表確認狀態</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">已排筆數</th>
                          {hasConfirmationReleaseData && (
                            <>
                              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">發布者</th>
                              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">發布日期</th>
                              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">確認截止</th>
                            </>
                          )}
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">確認時間</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 bg-white">
                        {confirmationResults.length > 0 ? confirmationResults.map((item) => (
                          <tr key={`${item.id}-${item.yearMonth}`}>
                            <td className="whitespace-nowrap px-4 py-4 text-sm font-medium text-gray-900">
                              {formatYearMonthLabel(item.yearMonth)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-900">{item.employeeId}</td>
                            <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-900">{item.name}</td>
                            <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">{item.department}</td>
                            <td className="px-4 py-4 text-sm">
                              <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getScheduleConfirmStatusBadgeClass(item.status)}`}>
                                {getScheduleConfirmStatusLabel(item.status)}
                              </span>
                              <div className="mt-1 text-xs text-gray-500">
                                {item.hasSchedules
                                  ? item.release
                                    ? '班表已建立，可追蹤發布與確認狀態'
                                    : '班表已建立'
                                  : '本月份尚未排班'}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">{item.scheduleCount} 筆</td>
                            {hasConfirmationReleaseData && (
                              <>
                                <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">{item.release?.publisherName ?? '-'}</td>
                                <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">
                                  {item.release?.publishedAt ? new Date(item.release.publishedAt).toLocaleString('zh-TW') : '-'}
                                </td>
                                <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">
                                  {item.release?.deadline ? new Date(item.release.deadline).toLocaleDateString('zh-TW') : '-'}
                                </td>
                              </>
                            )}
                            <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-700">
                              {item.confirmation?.confirmedAt ? new Date(item.confirmation.confirmedAt).toLocaleString('zh-TW') : '-'}
                            </td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan={hasConfirmationReleaseData ? 10 : 7} className="px-4 py-8 text-center text-sm text-gray-500">
                              目前沒有符合篩選條件的班表確認資料。
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* 日曆檢視 */}
        <div className="bg-white rounded-lg shadow mb-8">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <button
                onClick={goToPreviousMonth}
                className="flex items-center px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ChevronLeft className="w-5 h-5 mr-1" />
                上個月
              </button>
              
              <h2 className="text-xl font-semibold text-gray-900">
                {currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月
              </h2>
              
              <button
                onClick={goToNextMonth}
                className="flex items-center px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                下個月
                <ChevronRight className="w-5 h-5 ml-1" />
              </button>
            </div>
          </div>
          
          <div className="p-6">
            {/* 星期標題 */}
            <div className="grid grid-cols-7 gap-1 mb-4">
              {['日', '一', '二', '三', '四', '五', '六'].map((day) => (
                <div key={day} className="p-3 text-center font-medium text-gray-500 bg-gray-50 rounded">
                  {day}
                </div>
              ))}
            </div>
            
            {/* 日曆格子 */}
            <div className="grid grid-cols-7 gap-1">
              {generateCalendarDays().map((day, index) => {
                const dateStr = formatDate(day);
                const allDaySchedules = calendarSchedules[dateStr] || [];
                // 根據據點篩選
                const daySchedules = locationFilter
                  ? allDaySchedules.filter(s => s.employee.department === locationFilter)
                  : allDaySchedules;
                // 國定假日資訊
                const holiday = day ? getHolidayForDate(dateStr) : null;
                
                return (
                  <div 
                    key={index} 
                    className={`min-h-30 border rounded p-2 ${
                      holiday ? 'border-red-300 bg-red-50' : 'border-gray-200'
                    }`}
                  >
                    {day && (
                      <>
                        <div className="flex items-center justify-between mb-1">
                          <div className="font-medium text-sm text-gray-900">{day}</div>
                          {holiday && (
                            <span className="text-xs text-red-600 font-medium" title={holiday.name}>
                              🎌
                            </span>
                          )}
                        </div>
                        {/* 國定假日名稱 */}
                        {holiday && (
                          <div className="text-xs text-red-600 font-medium mb-1 truncate" title={holiday.name}>
                            {holiday.name}
                          </div>
                        )}
                        <div className="space-y-1">
                          {daySchedules.slice(0, 2).map((schedule) => (
                            <div
                              key={schedule.id}
                              onClick={() => handleScheduleClick(schedule)}
                              className={`text-xs px-2 py-1 rounded border cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all ${getShiftColor(schedule.shiftType)}`}
                            >
                              <div className="font-medium">{schedule.employee.name}</div>
                              <div className="truncate" title={getCalendarScheduleLabel(schedule)}>{getCalendarScheduleLabel(schedule)}</div>
                              <div className="mt-0.5 text-[11px] truncate" title={getScheduleHourSummary(schedule)}>
                                {getScheduleHourSummary(schedule)}
                              </div>
                            </div>
                          ))}
                          {daySchedules.length > 2 && (
                            <button
                              type="button"
                              onClick={() => openCalendarDayModal(dateStr)}
                              className="px-2 text-left text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
                            >
                              +{daySchedules.length - 2} 更多
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {searchResults.length > 0 && (
          <div className="bg-white rounded-lg shadow mb-8">
            <div className="p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-md font-medium text-gray-900">搜尋結果</h3>
                <div className="flex items-center gap-2">
                  {searchCalendarPeriod ? (
                    <>
                      <button
                        onClick={handlePrintSearchCalendar}
                        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                      >
                        <Printer className="h-4 w-4" />
                        列印月曆
                      </button>
                      <button
                        onClick={handleExportSearchCalendar}
                        className="inline-flex items-center gap-2 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
                      >
                        <Download className="h-4 w-4" />
                        匯出月曆
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-md">
                      列印與匯出月曆需先鎖定單一年月份
                    </span>
                  )}
                  <button
                    onClick={handleExportSearchResultsXlsx}
                    className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
                  >
                    <Download className="h-4 w-4" />
                    匯出班表.xlsx
                  </button>
                  <span className="text-sm text-gray-600 bg-blue-50 px-3 py-1 rounded-full">
                    找到 {searchResults.length} 筆記錄
                  </span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">日期</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">員編</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">姓名</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">部門</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">班別</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">時間</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {searchResults.map((schedule) => (
                      <tr key={`${schedule.id}-${schedule.workDate}`}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {new Date(schedule.workDate).toLocaleDateString('zh-TW')}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {schedule.employee.employeeId}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {schedule.employee.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {schedule.employee.department}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getShiftColor(schedule.shiftType)}`}>
                            {schedule.shiftType}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {getScheduleTimeText(schedule)}
                          <div className="text-xs text-gray-500 mt-1">
                            {getScheduleHourSummary(schedule)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {showCalendarDayModal && selectedCalendarDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white shadow-xl">
            <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-black">{selectedCalendarDate} 班表明細</h2>
                  <p className="mt-1 text-sm text-gray-600">
                    共 {selectedCalendarDaySchedules.length} 位人員
                    {(() => {
                      const holiday = getHolidayForDate(selectedCalendarDate);
                      return holiday ? ` ・ ${holiday.name}` : '';
                    })()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      closeCalendarDayModal();
                      openCreateScheduleModal(selectedCalendarDate);
                    }}
                    className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    排班此日期
                  </button>
                  <button
                    type="button"
                    onClick={closeCalendarDayModal}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-6 w-6" />
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="w-full sm:max-w-xs">
                  <label className="mb-1 block text-sm font-medium text-gray-700">部門篩選</label>
                  <select
                    value={calendarDayDepartmentFilter}
                    onChange={(event) => setCalendarDayDepartmentFilter(event.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">全部部門</option>
                    {selectedCalendarDayDepartmentOptions.map((department) => (
                      <option key={department} value={department}>{department}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-600">
                  <span>顯示 {selectedCalendarDaySchedules.length} 位人員</span>
                  {calendarDayDepartmentFilter && (
                    <button
                      type="button"
                      onClick={() => setCalendarDayDepartmentFilter('')}
                      className="font-medium text-blue-600 hover:text-blue-700"
                    >
                      清除篩選
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-3 p-6">
              {selectedCalendarDaySchedules.length > 0 ? (
                selectedCalendarDaySchedules.map((schedule) => (
                  <button
                    key={schedule.id}
                    type="button"
                    onClick={() => {
                      closeCalendarDayModal();
                      handleScheduleClick(schedule);
                    }}
                    className={`w-full rounded-lg border p-4 text-left transition-all hover:ring-2 hover:ring-blue-400 ${getShiftColor(schedule.shiftType)}`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-semibold text-gray-900">{schedule.employee.name}</span>
                          <span className="text-sm text-gray-600">{schedule.employee.employeeId}</span>
                          <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs text-gray-700">
                            {schedule.employee.department}
                          </span>
                        </div>
                        <div className="mt-2 text-sm text-gray-700">
                          {getCalendarScheduleLabel(schedule)}
                        </div>
                        <div className="mt-1 text-xs text-gray-600">
                          {getScheduleHourSummary(schedule)}
                        </div>
                      </div>
                      <div className="text-sm font-medium text-blue-700">
                        點選可編輯
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
                  目前此日期{calendarDayDepartmentFilter ? `在「${calendarDayDepartmentFilter}」篩選下` : ''}沒有符合條件的班表，可直接點選上方按鈕新增排班。
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 建立 / 刪除班表彈窗 */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black bg-opacity-50 p-4">
          <div className="flex min-h-full items-start justify-center py-4 md:items-center">
            <div className="w-full max-w-5xl overflow-hidden rounded-lg bg-white shadow-xl max-h-[calc(100vh-2rem)]">
              <div className="flex max-h-[calc(100vh-2rem)] flex-col">
                <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                <h2 className="text-xl font-bold text-black">{isDeleteScheduleMode ? '刪除班表' : '建立班表'}</h2>
                <button
                  onClick={closeScheduleModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
                </div>

                <div className="overflow-y-auto px-6 py-4">
                  <form onSubmit={isDeleteScheduleMode ? handleBulkDeleteSchedules : handleCreateSchedule} className="space-y-4">
                <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <label className="block text-sm font-semibold text-black">{isDeleteScheduleMode ? '刪除對象' : '員工'}</label>
                      <p className="text-xs text-gray-600 mt-1">
                        {isDeleteScheduleMode
                          ? '先圈出要刪除班表的員工，支援全選目前篩選、多選或直接套用目前篩選的全部活躍員工。'
                          : '選項來自員工管理中的活躍員工清單，可先用部門、職位或姓名/員編縮小範圍。'}
                      </p>
                    </div>
                    {(createEmployeeFilters.department || createEmployeeFilters.position || createEmployeeFilters.keyword) && (
                      <button
                        type="button"
                        onClick={resetCreateEmployeeFilters}
                        className="shrink-0 rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
                      >
                        清除篩選
                      </button>
                    )}
                  </div>

	                  <div className="flex flex-wrap gap-2">
	                    <button
	                      type="button"
                      onClick={() => setCreateEmployeeScope('single')}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                        createEmployeeScope === 'single'
                          ? 'bg-blue-600 text-white'
                          : 'border border-blue-200 bg-white text-blue-700 hover:bg-blue-50'
                      }`}
	                    >
	                      單一員工
	                    </button>
	                    <button
	                      type="button"
	                      onClick={() => setCreateEmployeeScope('checked')}
	                      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
	                        createEmployeeScope === 'checked'
	                          ? 'bg-blue-600 text-white'
	                          : 'border border-blue-200 bg-white text-blue-700 hover:bg-blue-50'
	                      }`}
	                    >
	                      勾選多位員工
	                    </button>
	                    <button
	                      type="button"
	                      onClick={() => setCreateEmployeeScope('filtered-active')}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                        createEmployeeScope === 'filtered-active'
                          ? 'bg-blue-600 text-white'
                          : 'border border-blue-200 bg-white text-blue-700 hover:bg-blue-50'
                      }`}
                    >
                      目前篩選的全部活躍員工
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">部門</label>
                      <select
                        value={createEmployeeFilters.department}
                        onChange={(e) => updateCreateEmployeeFilters({ department: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black bg-white"
                      >
                        <option value="">全部部門</option>
                        {createDepartmentOptions.map((department) => (
                          <option key={department} value={department}>{department}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">職位</label>
                      <select
                        value={createEmployeeFilters.position}
                        onChange={(e) => updateCreateEmployeeFilters({ position: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black bg-white"
                      >
                        <option value="">全部職位</option>
                        {positionOptions.map((position) => (
                          <option key={position} value={position}>{position}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">搜尋</label>
                      <input
                        type="search"
                        value={createEmployeeFilters.keyword}
                        onChange={(e) => updateCreateEmployeeFilters({ keyword: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black bg-white"
                        placeholder="姓名、員編、部門"
                      />
                    </div>
                  </div>

	                  {createEmployeeScope === 'single' && (
	                    <select
	                      value={newSchedule.employeeId}
	                      onChange={(e) => setNewSchedule({ ...newSchedule, employeeId: e.target.value })}
	                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black bg-white"
	                      required={createEmployeeScope === 'single'}
	                    >
	                      <option value="">
	                        {createEmployeeOptions.length === 0 ? '無符合篩選的員工' : `請選擇員工（${createEmployeeOptions.length} 人）`}
	                      </option>
	                      {createEmployeeOptions.map((employee) => (
	                        <option key={employee.id} value={employee.id}>
	                          {formatEmployeeOption(employee)}
	                        </option>
	                      ))}
	                    </select>
	                  )}

	                  {createEmployeeScope === 'checked' && (
	                    <div className="rounded-lg border border-blue-200 bg-white">
	                      <div className="flex flex-col gap-3 border-b border-blue-100 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
	                        <div>
	                          <div className="text-sm font-semibold text-gray-900">
	                            已勾選 {createCheckedEmployeeIds.length} 位
	                          </div>
	                          <div className="mt-1 text-xs text-gray-500">
	                            目前篩選 {createEmployeeOptions.length} 位
	                          </div>
	                        </div>
	                        <div className="flex flex-wrap gap-2">
	                          <button
	                            type="button"
	                            onClick={handleSelectAllCreateEmployees}
	                            disabled={createEmployeeOptions.length === 0}
	                            className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
	                          >
	                            {allCreateEmployeeOptionsSelected ? '取消目前篩選' : '全選目前篩選'}
	                          </button>
	                          <button
	                            type="button"
	                            onClick={clearCreateCheckedEmployees}
	                            disabled={createCheckedEmployeeIds.length === 0}
	                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
	                          >
	                            清除已選
	                          </button>
	                        </div>
	                      </div>
	                      <div className="max-h-64 overflow-y-auto">
	                        {createEmployeeOptions.length > 0 ? (
                            <>
                              <label className="sticky top-0 z-10 flex cursor-pointer items-center gap-3 border-b border-blue-100 bg-blue-50 px-3 py-2.5 hover:bg-blue-100">
                                <input
                                  type="checkbox"
                                  checked={allCreateEmployeeOptionsSelected}
                                  onChange={handleSelectAllCreateEmployees}
                                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-semibold text-blue-900">
                                    全選目前篩選
                                  </span>
                                  <span className="mt-0.5 block text-xs text-blue-700">
                                    {allCreateEmployeeOptionsSelected ? '取消勾選目前篩選的員工' : `一次勾選目前篩選的 ${createEmployeeOptions.length} 位員工`}
                                  </span>
                                </span>
                              </label>
	                            {createEmployeeOptions.map((employee) => {
	                              const checked = createCheckedEmployeeIdSet.has(employee.id);
	                              return (
	                                <label
	                                  key={employee.id}
	                                  className={`flex cursor-pointer items-start gap-3 border-b border-gray-100 px-3 py-2.5 last:border-b-0 hover:bg-blue-50 ${checked ? 'bg-blue-50' : 'bg-white'}`}
	                                >
	                                  <input
	                                    type="checkbox"
	                                    checked={checked}
	                                    onChange={() => handleCreateEmployeeToggle(employee.id)}
	                                    className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
	                                  />
	                                  <span className="min-w-0 flex-1">
	                                    <span className="block text-sm font-medium text-gray-900">
	                                      {employee.name}（{employee.employeeId}）
	                                    </span>
	                                    <span className="mt-0.5 block text-xs text-gray-500">
	                                      {employee.department || '未設定部門'}｜{employee.position || '未設定職位'}
	                                    </span>
	                                  </span>
	                                </label>
	                              );
	                            })}
                            </>
	                        ) : (
	                          <div className="px-3 py-4 text-sm text-red-600">目前篩選條件下沒有可操作的活躍員工</div>
	                        )}
	                      </div>
	                      {createCheckedEmployeeIds.length > 0 && !hasCreateEmployeeOptionSelection && (
	                        <div className="border-t border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
	                          已選員工不在目前篩選結果中，送出時仍會一併處理。
	                        </div>
	                      )}
	                    </div>
	                  )}

	                  {createEmployeeScope === 'filtered-active' && (
	                    <div className="rounded-lg border border-dashed border-blue-300 bg-white p-3">
	                      <div className="flex items-center justify-between gap-3">
	                        <div>
	                          <div className="text-sm font-semibold text-gray-900">
	                            {isDeleteScheduleMode ? '將刪除以下活躍員工的班表' : '將套用到以下活躍員工'}
                              {' '}{createEmployeeOptions.length} 位
	                          </div>
	                          <div className="mt-1 text-xs text-gray-500">
	                            {isDeleteScheduleMode ? '未設定篩選時，會直接以目前可見的全部活躍員工為刪除對象。' : '未設定篩選時，會直接對目前可見的全部活躍員工排班。'}
	                          </div>
	                        </div>
	                        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
	                          {isDeleteScheduleMode ? '全部刪除' : '全部套用'}
	                        </span>
	                      </div>
	                      <div className="mt-3 flex flex-wrap gap-2">
	                        {createEmployeeOptions.slice(0, 8).map((employee) => (
	                          <span
	                            key={employee.id}
	                            className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700"
	                          >
	                            {employee.name}（{employee.employeeId}）
	                          </span>
	                        ))}
	                        {createEmployeeOptions.length > 8 && (
	                          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700">
	                            另有 {createEmployeeOptions.length - 8} 人
	                          </span>
	                        )}
	                        {createEmployeeOptions.length === 0 && (
	                          <span className="text-sm text-red-600">目前篩選條件下沒有可操作的活躍員工</span>
	                        )}
	                      </div>
	                    </div>
	                  )}
                </div>

                <div className="space-y-3 rounded-lg border border-gray-200 p-4">
                  <label className="flex items-center gap-2 text-sm font-medium text-black">
                    <input
                      type="checkbox"
                      checked={createBatchMode}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        setCreateBatchMode(enabled);
                        if (enabled) {
                          const fallbackDate = newSchedule.workDate;
                          setCreateBatchRange((prev) => ({
                            startDate: prev.startDate || fallbackDate,
                            endDate: prev.endDate || fallbackDate,
                            weekdays: prev.weekdays.length > 0 ? prev.weekdays : ALL_WEEKDAYS,
                          }));
                        }
                      }}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    {isDeleteScheduleMode ? '一次刪除多天班表' : '一次排定多天班別'}
                  </label>
                  <p className="text-xs text-gray-500">
                    {isDeleteScheduleMode ? '可指定日期區間與星期，或改用月曆直接勾選要刪除的多天班表。' : '可指定日期區間與星期，或改用月曆直接勾選多天班表。'}
                  </p>

                  {createBatchMode ? (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setCreateDateSelectionMode('range')}
                          className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                            createDateSelectionMode === 'range'
                              ? 'bg-gray-900 text-white'
                              : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          日期區間
                        </button>
                        <button
                          type="button"
                          onClick={() => setCreateDateSelectionMode('calendar')}
                          className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                            createDateSelectionMode === 'calendar'
                              ? 'bg-gray-900 text-white'
                              : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          月曆模式
                        </button>
                      </div>

                      {createDateSelectionMode === 'range' ? (
                        <>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-black mb-1">開始日期</label>
                              <input
                                type="date"
                                value={createBatchRange.startDate}
                                onChange={(e) => setCreateBatchRange((prev) => ({ ...prev, startDate: e.target.value }))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                                required={createBatchMode && createDateSelectionMode === 'range'}
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-black mb-1">結束日期</label>
                              <input
                                type="date"
                                value={createBatchRange.endDate}
                                onChange={(e) => setCreateBatchRange((prev) => ({ ...prev, endDate: e.target.value }))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                                required={createBatchMode && createDateSelectionMode === 'range'}
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-black mb-2">套用星期</label>
                            <div className="flex flex-wrap gap-2">
                              {WEEKDAY_OPTIONS.map((weekday) => {
                                const active = createBatchRange.weekdays.includes(weekday.value);
                                return (
                                  <button
                                    key={weekday.value}
                                    type="button"
                                    onClick={() => setCreateBatchRange((prev) => ({ ...prev, weekdays: toggleWeekday(prev.weekdays, weekday.value) }))}
                                    className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                                      active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                                  >
                                    星期{weekday.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <button
                              type="button"
                              onClick={goToPreviousCreateMonth}
                              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                            >
                              <ChevronLeft className="h-4 w-4" />
                              上個月
                            </button>
                            <div className="text-center">
                              <div className="text-sm font-semibold text-gray-900">
                                {createCalendarMonth.getFullYear()}年 {createCalendarMonth.getMonth() + 1}月
                              </div>
                              <div className="text-xs text-gray-500">
                                {isDeleteScheduleMode
                                  ? createCalendarExistingLoading
                                    ? '正在載入本月既有班表'
                                    : '有班表的日期會顯示班別摘要，點選後即可批量刪除'
                                  : '點選日期後，可在下方逐日調整班別再一次儲存'}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={goToNextCreateMonth}
                              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                            >
                              下個月
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={selectAllCreateCalendarDays}
                              className="rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
                            >
                              {isDeleteScheduleMode ? '全選本月有班表日期' : '全選本月日期'}
                            </button>
                            {!isDeleteScheduleMode && (
                              <button
                                type="button"
                                onClick={applyCreateShiftToSelectedDates}
                                disabled={createCalendarSelectedDates.length === 0}
                                className="rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                全部已選日期改為目前班別
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={clearCreateCalendarDates}
                              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                            >
                              清除已選日期
                            </button>
                          </div>

                          <div className="mt-3 grid grid-cols-7 gap-1">
                            {['日', '一', '二', '三', '四', '五', '六'].map((day) => (
                              <div key={day} className="rounded bg-white px-2 py-1 text-center text-xs font-medium text-gray-500">
                                {day}
                              </div>
                            ))}
                          </div>
                          <div className="mt-1 grid grid-cols-7 gap-1">
                            {createCalendarDays.map((day, index) => {
                              const date = formatMonthDate(createCalendarMonth, day);
                              const holiday = day ? getHolidayForDate(date, createCalendarHolidays) : null;
                              const selected = day ? Boolean(createCalendarAssignments[date]) : false;
                              const selectedShiftCode = day ? createCalendarAssignments[date] : '';
                              const existingDaySchedules = day ? (createCalendarExistingSchedules[date] ?? []) : [];
                              const hasExistingSchedules = existingDaySchedules.length > 0;
                              const existingShiftSummary = hasExistingSchedules ? summarizeSchedulesByShift(existingDaySchedules) : '';
                              const selectedShiftLabel = selectedShiftCode
                                ? isDeleteScheduleMode
                                  ? '已選'
                                  : getShiftDefinitionByCode(selectedShiftCode)?.label ?? selectedShiftCode
                                : '';
                              const selectedShiftColor = selected && !isDeleteScheduleMode
                                ? getShiftColor(selectedShiftCode)
                                : '';

                              return (
                                <button
                                  key={`${date || 'blank'}-${index}`}
                                  type="button"
                                  onClick={() => day && toggleCreateCalendarDate(date)}
                                  disabled={!day}
                                  className={`min-h-20 rounded-md border p-2 text-left transition-colors ${
                                    !day
                                      ? 'cursor-default border-transparent bg-transparent'
                                      : selected
                                        ? isDeleteScheduleMode
                                          ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                                          : `${selectedShiftColor} ring-2 ring-current`
                                        : isDeleteScheduleMode && hasExistingSchedules
                                          ? 'border-amber-300 bg-amber-50 hover:border-amber-400 hover:bg-amber-100'
                                        : holiday
                                          ? 'border-red-200 bg-red-50 hover:border-red-300'
                                          : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50'
                                  }`}
                                >
                                  {day && (
                                    <>
                                      <div className="flex items-center justify-between">
                                        <span className="text-sm font-semibold text-gray-900">{day}</span>
                                        {selected ? (
                                          <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                                            isDeleteScheduleMode ? 'border-blue-600 bg-blue-600 text-white' : selectedShiftColor
                                          }`}>
                                            {selectedShiftLabel}
                                          </span>
                                        ) : isDeleteScheduleMode && hasExistingSchedules ? (
                                          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                                            {existingDaySchedules.length} 筆
                                          </span>
                                        ) : null}
                                      </div>
                                      {holiday ? (
                                        <div className="mt-1 text-[11px] font-medium text-red-600 leading-4">
                                          {holiday.name}
                                        </div>
                                      ) : (
                                        <div className="mt-1 text-[11px] text-gray-400 leading-4">
                                          {date}
                                        </div>
                                      )}
                                      {isDeleteScheduleMode && hasExistingSchedules && (
                                        <div className="mt-1 text-[11px] font-medium text-amber-700 leading-4">
                                          {existingShiftSummary}
                                        </div>
                                      )}
                                    </>
                                  )}
                                </button>
                              );
                            })}
                          </div>

                          {createCalendarSelectedDates.length > 0 && (
                             <div className="mt-4 rounded-lg border border-blue-100 bg-white p-3">
                               <div className="flex flex-wrap items-center justify-between gap-2">
                                 <div>
                                   <div className="text-sm font-medium text-gray-900">{isDeleteScheduleMode ? '已選刪除日期' : '已選日期班別'}</div>
                                   <div className="text-xs text-gray-500">
                                     {isDeleteScheduleMode ? '送出後會刪除這些日期的既有班表。' : '每一天可單獨指定班別，儲存時會依各自班別同步時間與工時。'}
                                   </div>
                                 </div>
                                 {!isDeleteScheduleMode && (
                                   <div className="text-xs text-blue-700">
                                     {createCalendarShiftGroups.map((group) => {
                                       const shift = getShiftDefinitionByCode(group.shiftType);
                                       return `${shift?.label ?? group.shiftType} ${group.workDates.length} 天`;
                                     }).join('｜')}
                                   </div>
                                 )}
                               </div>
                               <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                                 {createCalendarSelectedDates.map((date) => {
                                   const assignedShiftType = createCalendarAssignments[date] || newSchedule.shiftType;
                                   const holiday = getHolidayForDate(date, createCalendarHolidays);
                                   return (
                                     <div key={date} className="flex flex-col gap-2 rounded-md border border-gray-200 px-3 py-2 md:flex-row md:items-center md:justify-between">
                                       <div>
                                         <div className="text-sm font-medium text-gray-900">{date}</div>
                                         <div className={`text-xs ${holiday ? 'text-red-600' : 'text-gray-500'}`}>
                                           {holiday ? holiday.name : '一般工作日'}
                                         </div>
                                         {isDeleteScheduleMode && (
                                           <div className="mt-1 text-xs text-gray-500">
                                             {(createCalendarExistingSchedules[date] ?? []).length > 0
                                               ? `目前已排 ${(createCalendarExistingSchedules[date] ?? []).length} 筆：${summarizeSchedulesByShift(createCalendarExistingSchedules[date] ?? [])}`
                                               : '目前查無既有班表，送出時會自動略過'}
                                           </div>
                                         )}
                                       </div>
                                       {isDeleteScheduleMode ? (
                                         <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                                           刪除{(createCalendarExistingSchedules[date] ?? []).length > 0 ? ` ${(createCalendarExistingSchedules[date] ?? []).length} 筆` : ''}班表
                                         </span>
                                       ) : (
                                         <select
                                           value={assignedShiftType}
                                           onChange={(e) => updateCreateCalendarDateShift(date, e.target.value)}
                                           className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 md:w-56"
                                         >
                                           {shiftOptions.map((shift) => (
                                             <option key={shift.code} value={shift.code}>
                                               {shift.label}
                                             </option>
                                           ))}
                                         </select>
                                       )}
                                     </div>
                                   );
                                 })}
                               </div>
                             </div>
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800 md:col-span-2">
                          {createTargetDates.length > 0 ? (
                            <>
                              <div className="font-medium">
                                {isDeleteScheduleMode
                                  ? `將刪除 ${createSelectedEmployeeIds.length} 位活躍員工 ${createTargetDates.length} 天內的既有班表`
                                  : `將為 ${createSelectedEmployeeIds.length} 位活躍員工建立 ${createTargetDates.length} 天班表，共 ${createSelectedEmployeeIds.length * createTargetDates.length} 筆`}
                              </div>
                              <div className="mt-1">
                                日期：{createTargetDates.slice(0, 6).join('、')}{createTargetDates.length > 6 ? '…' : ''}
                              </div>
                              {!isDeleteScheduleMode && createDateSelectionMode === 'calendar' && createCalendarShiftGroups.length > 0 && (
                                <div className="mt-1 text-xs text-blue-700">
                                  班別：{createCalendarShiftGroups.map((group) => {
                                    const shift = getShiftDefinitionByCode(group.shiftType);
                                    return `${shift?.label ?? group.shiftType} ${group.workDates.length} 天`;
                                  }).join('｜')}
                                </div>
                              )}
                              <div className="mt-1 text-xs text-blue-700">
                                {isDeleteScheduleMode ? '只會刪除符合條件的既有班表；沒有班表的日期會自動略過。' : '已存在的班表也會同步套用成目前選擇的新班別。'}
                              </div>
                              {createDateSelectionMode === 'calendar' && (
                                <div className="mt-1 text-xs text-blue-700">
                                  其中國定假日 {createTargetDates.filter((date) => Boolean(getHolidayForDate(date, createCalendarHolidays))).length} 天
                                </div>
                              )}
                            </>
                          ) : (
                            createDateSelectionMode === 'calendar'
                              ? isDeleteScheduleMode ? '請在月曆中點選要刪除班表的日期，可直接看到國定假日。' : '請在月曆中點選要排班的日期，可直接看到國定假日。'
                              : '請選擇有效的日期區間與星期。'
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-black mb-1">{isDeleteScheduleMode ? '刪除日期' : '工作日期'}</label>
                      <input
                        type="date"
                        value={newSchedule.workDate}
                        onChange={(e) => setNewSchedule({ ...newSchedule, workDate: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                        required={!createBatchMode}
                      />
                    </div>
                  )}
                </div>

                {!isDeleteScheduleMode && (
                <>
                <div>
                  <label className="block text-sm font-medium text-black mb-1">班別</label>
                  <select
                    value={newSchedule.shiftType}
                    onChange={(e) => {
                      const shiftType = e.target.value;
                      const template = getShiftTemplateForCode(shiftType);
                      setNewSchedule({
                        ...newSchedule,
                        shiftType,
                        startTime: template.startTime,
                        endTime: template.endTime,
                        breakTime: template.breakTime,
                        workHours: template.workHours,
                        specialLeaveHours: template.specialLeaveHours,
                        compLeaveHours: template.compLeaveHours,
                        overtimeHours: template.overtimeHours
                      });
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                  >
                    {shiftOptions.map((shift) => (
                      <option key={shift.code} value={shift.code}>{shift.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                     {createBatchMode && createDateSelectionMode === 'calendar'
                       ? '此處作為新增日期的預設班別，也可一鍵套用到全部已選日期；每一天仍可在月曆下方個別調整。'
                       : '班別時間與工時會依目前班別設定自動同步，建立時以最新班別設定為準。'}
                  </p>
                </div>

                {isShiftRequiresTime(newSchedule.shiftType) && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-black mb-1">開始時間</label>
                        <input
                          type="time"
                          value={newSchedule.startTime}
                          readOnly
                          className="w-full cursor-not-allowed rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-black focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-black mb-1">結束時間</label>
                        <input
                          type="time"
                          value={newSchedule.endTime}
                          readOnly
                          className="w-full cursor-not-allowed rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-black focus:outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-black mb-1">休息時間（分鐘）</label>
                      <input
                        type="number"
                        value={newSchedule.breakTime}
                        readOnly
                        className="w-full cursor-not-allowed rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-black focus:outline-none"
                      />
                    </div>
                  </>
                )}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-black mb-1">工時（小時）</label>
                    <input
                      type="number"
                      min="0"
                      max="24"
                      step="0.25"
                      value={newSchedule.workHours}
                      readOnly
                      className="w-full cursor-not-allowed rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-black focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-black mb-1">特休（小時）</label>
                    <input
                      type="number"
                      min="0"
                      max="24"
                      step="0.25"
                      value={newSchedule.specialLeaveHours}
                      readOnly
                      className="w-full cursor-not-allowed rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-black focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-black mb-1">off／補休（小時）</label>
                    <input
                      type="number"
                      min="0"
                      max="24"
                      step="0.25"
                      value={newSchedule.compLeaveHours}
                      readOnly
                      className="w-full cursor-not-allowed rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-black focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-black mb-1">加班（小時）</label>
                    <input
                      type="number"
                      min="0"
                      max="24"
                      step="0.25"
                      value={newSchedule.overtimeHours}
                      readOnly
                      className="w-full cursor-not-allowed rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-black focus:outline-none"
                    />
                  </div>
                </div>

                {newSchedule.shiftType === 'FDL' && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <h4 className="font-medium text-black mb-2">全日請假說明</h4>
                    <div className="text-sm text-black space-y-1">
                      <p><strong>可申請假別：</strong>事假、病假、生理假、產假、陪產假、公假、喪假</p>
                      <p><strong>勞基法規範天數：</strong></p>
                      <ul className="list-disc list-inside ml-4 space-y-1">
                        <li>病假：一年內不得超過30日，住院不在此限</li>
                        <li>生理假：每月1日，不併入病假計算</li>
                        <li>產假：產前產後合計8週（56日）</li>
                        <li>陪產假：配偶分娩時，給予陪產假5日</li>
                        <li>喪假：父母、配偶死亡8日；繼父母、配偶父母、子女死亡6日；祖父母、兄弟姊妹死亡3日</li>
                      </ul>
                    </div>
                  </div>
                )}

                {newSchedule.shiftType === 'OFF' && (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                    <h4 className="font-medium text-black mb-2">休假說明</h4>
                    <p className="text-sm text-black">用於補休（加班時數抵換之休假）</p>
                  </div>
                )}
                </>
                )}

                {isDeleteScheduleMode && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                    這會刪除符合條件的既有班表資料；找不到班表的日期會自動略過，不會新增或改動其他日期。
                  </div>
                )}

                    <div className="sticky bottom-0 -mx-6 border-t border-gray-200 bg-white px-6 py-4">
                      <div className="flex space-x-3">
                        <button
                          type="button"
                          onClick={closeScheduleModal}
                          className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                        >
                          取消
                        </button>
                        <button
                          type="submit"
                          disabled={creatingSchedules}
                          className={`flex-1 px-4 py-2 text-white rounded-md ${isDeleteScheduleMode ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                        >
                          {creatingSchedules ? '檢查中...' : isDeleteScheduleMode ? '刪除班表' : '建立班表'}
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 建立週模版彈窗 */}
      {showTemplateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-black">
                  {editingTemplate ? '編輯週模版' : '建立週模版'}
                </h2>
                <button
                  onClick={() => {
                    setShowTemplateModal(false);
                    setEditingTemplate(null);
                    resetTemplateForm();
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={editingTemplate ? handleUpdateTemplate : handleCreateTemplate} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-black mb-1">模版名稱</label>
                    <input
                      type="text"
                      value={newTemplate.name}
                      onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                      placeholder="例如：標準週班表"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-black mb-1">描述</label>
                    <input
                      type="text"
                      value={newTemplate.description}
                      onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                      placeholder="週班表描述"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-black">週班表設定</h3>
                  {WEEKDAYS.map((day, index) => {
                    const daySchedule = newTemplate[day as keyof typeof newTemplate] as DaySchedule;
                    return (
                      <div key={day} className="border border-gray-200 rounded-lg p-4">
                        <h4 className="font-medium mb-3 text-black">{WEEKDAY_LABELS[index]}</h4>
                        <div className="grid grid-cols-4 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-black mb-1">班別</label>
                            <select
                              value={daySchedule.shiftType}
                              onChange={(e) => {
                                const shiftType = e.target.value;
                                const template = getShiftTemplateForCode(shiftType);
                                setNewTemplate({
                                  ...newTemplate,
                                  [day]: {
                                    shiftType,
                                    startTime: template.startTime,
                                    endTime: template.endTime,
                                    breakTime: template.breakTime,
                                    workHours: template.workHours,
                                    specialLeaveHours: template.specialLeaveHours,
                                    compLeaveHours: template.compLeaveHours,
                                    overtimeHours: template.overtimeHours
                                  }
                                });
                              }}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                            >
                              {shiftOptions.map((shift) => (
                                <option key={shift.code} value={shift.code} className="text-gray-900 bg-white">{shift.label}</option>
                              ))}
                            </select>
                          </div>

                          {isShiftRequiresTime(daySchedule.shiftType) && (
                            <>
                              <div>
                                <label className="block text-sm font-medium text-black mb-1">開始時間</label>
                                <input
                                  type="time"
                                  value={daySchedule.startTime}
                                  onChange={(e) => setNewTemplate({
                                    ...newTemplate,
                                    [day]: { ...daySchedule, startTime: e.target.value }
                                  })}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                                />
                              </div>

                              <div>
                                <label className="block text-sm font-medium text-black mb-1">結束時間</label>
                                <input
                                  type="time"
                                  value={daySchedule.endTime}
                                  onChange={(e) => setNewTemplate({
                                    ...newTemplate,
                                    [day]: { ...daySchedule, endTime: e.target.value }
                                  })}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                                />
                              </div>

                              <div>
                                <label className="block text-sm font-medium text-black mb-1">休息時間（分鐘）</label>
                                <input
                                  type="number"
                                  value={daySchedule.breakTime}
                                  onChange={(e) => setNewTemplate({
                                    ...newTemplate,
                                    [day]: { ...daySchedule, breakTime: parseInt(e.target.value) || 0 }
                                  })}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                                  min="0"
                                />
                              </div>
                            </>
                          )}
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                          <div>
                            <label className="block text-sm font-medium text-black mb-1">工時（小時）</label>
                            <input
                              type="number"
                              min="0"
                              max="24"
                              step="0.25"
                              value={daySchedule.workHours}
                              onChange={(e) => setNewTemplate({
                                ...newTemplate,
                                [day]: { ...daySchedule, workHours: Number(e.target.value) || 0 }
                              })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-black mb-1">特休（小時）</label>
                            <input
                              type="number"
                              min="0"
                              max="24"
                              step="0.25"
                              value={daySchedule.specialLeaveHours}
                              onChange={(e) => setNewTemplate({
                                ...newTemplate,
                                [day]: { ...daySchedule, specialLeaveHours: Number(e.target.value) || 0 }
                              })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-black mb-1">off／補休（小時）</label>
                            <input
                              type="number"
                              min="0"
                              max="24"
                              step="0.25"
                              value={daySchedule.compLeaveHours}
                              onChange={(e) => setNewTemplate({
                                ...newTemplate,
                                [day]: { ...daySchedule, compLeaveHours: Number(e.target.value) || 0 }
                              })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-black mb-1">加班（小時）</label>
                            <input
                              type="number"
                              min="0"
                              max="24"
                              step="0.25"
                              value={daySchedule.overtimeHours}
                              onChange={(e) => setNewTemplate({
                                ...newTemplate,
                                [day]: { ...daySchedule, overtimeHours: Number(e.target.value) || 0 }
                              })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowTemplateModal(false);
                      resetTemplateForm();
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                  >
                    {editingTemplate ? '更新週模版' : '建立週模版'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 套用模版彈窗 */}
      {showApplyTemplateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-black">套用週模版</h2>
                <button
                  onClick={() => {
                    setShowApplyTemplateModal(false);
                    setSelectedTemplateId(null);
                    setApplyToMonth('');
                    setSelectedEmployees([]);
                    setEmployeeSearch('');
                    setTemplateDepartmentFilter('');
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleApplyTemplate} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-black mb-1">選擇模版</label>
                    <select
                      value={selectedTemplateId || ''}
                      onChange={(e) => setSelectedTemplateId(Number(e.target.value) || null)}
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    >
                      <option value="">請選擇週模版</option>
                      {weeklyTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-black mb-1">套用月份</label>
                    <input
                      type="month"
                      value={applyToMonth}
                      onChange={(e) => setApplyToMonth(e.target.value)}
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    />
                  </div>
                </div>

                {/* 員工選擇區域 */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="block text-sm font-medium text-black">選擇員工</label>
                    <span className="text-xs text-gray-500">
                      已選擇 {selectedEmployees.length} / {filteredEmployees.length} 位員工
                    </span>
                  </div>
                  
                  {/* 部門篩選 + 搜尋框 */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <select
                      value={templateDepartmentFilter}
                      onChange={(e) => {
                        setTemplateDepartmentFilter(e.target.value);
                        setSelectedEmployees([]); // 切換部門時清空選擇
                      }}
                      className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black text-sm"
                    >
                      <option value="">全部部門</option>
                      {templateDepartments.map(dept => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={employeeSearch}
                      onChange={(e) => setEmployeeSearch(e.target.value)}
                      placeholder="搜尋員工..."
                      className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black text-sm"
                    />
                  </div>

                  {/* 全選按鈕 */}
                  <div className="mb-3">
                    <button
                      type="button"
                      onClick={handleSelectAllEmployees}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      {selectedEmployees.length === filteredEmployees.length && filteredEmployees.length > 0 ? '取消全選' : '全選'}
                    </button>
                  </div>

                  {/* 員工列表 */}
                  <div className="border border-gray-300 rounded-md max-h-60 overflow-y-auto">
                    {filteredEmployees.map((employee) => (
                      <div
                        key={employee.id}
                        className="flex items-center p-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                      >
                        <input
                          type="checkbox"
                          checked={selectedEmployees.includes(employee.id)}
                          onChange={() => handleEmployeeToggle(employee.id)}
                          className="mr-3 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <div className="flex-1">
                          <div className="flex items-center space-x-4">
                            <span className="font-medium text-gray-900 text-sm">
                              {employee.employeeId}
                            </span>
                            <span className="text-gray-700 text-sm">
                              {employee.name}
                            </span>
                            <span className="text-gray-500 text-xs bg-gray-100 px-2 py-1 rounded">
                              {employee.department}
                            </span>
                            <span className="text-gray-500 text-xs">
                              {employee.position}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                    {filteredEmployees.length === 0 && (
                      <div className="p-4 text-center text-gray-500 text-sm">
                        沒有找到符合條件的員工
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-sm text-gray-600 bg-yellow-50 border border-yellow-200 rounded-md p-3">
                  <p className="font-medium text-yellow-800 mb-1">⚠️ 注意事項：</p>
                  <ul className="list-disc list-inside space-y-1 text-yellow-700">
                    <li>套用模版將會覆蓋所選員工該月份的現有班表</li>
                    <li>請確認所選模版、月份和員工無誤</li>
                    <li>建議先備份重要的班表資料</li>
                  </ul>
                </div>

                <div className="flex space-x-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowApplyTemplateModal(false);
                      setSelectedTemplateId(null);
                      setApplyToMonth('');
                      setSelectedEmployees([]);
                      setEmployeeSearch('');
                        setTemplateDepartmentFilter('');
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={selectedEmployees.length === 0}
                    className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    套用模版
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 編輯班表彈窗 */}
      {showEditScheduleModal && editingSchedule && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black bg-opacity-50 p-4">
          <div className="flex min-h-full items-start justify-center py-4 md:items-center">
            <div className="w-full max-w-5xl overflow-hidden rounded-lg bg-white shadow-xl max-h-[calc(100vh-2rem)]">
              <div className="flex max-h-[calc(100vh-2rem)] flex-col">
                <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                <h2 className="text-xl font-bold text-gray-900">編輯班表</h2>
                <button
                  onClick={() => {
                    setShowEditScheduleModal(false);
                    setEditingSchedule(null);
                    setEditBatchMode(false);
                    setEditDateSelectionMode('range');
                    setEditCalendarAssignments({});
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
                </div>

                <div className="overflow-y-auto px-6 py-4">
                  {/* 員工與日期資訊 */}
                  <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                <div className="text-sm text-gray-600">員工</div>
                <div className="font-medium text-gray-900">{editingSchedule.employee.name}</div>
                <div className="text-sm text-gray-600 mt-2">日期</div>
                <div className="font-medium text-gray-900">{editingSchedule.workDate}</div>
                  </div>

                  <form onSubmit={handleUpdateSchedule} className="space-y-4">
                <div className="space-y-3 rounded-lg border border-blue-100 bg-blue-50 p-4">
                  <label className="flex items-center gap-2 text-sm font-medium text-blue-900">
                    <input
                      type="checkbox"
                      checked={editBatchMode}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        setEditBatchMode(enabled);
                        if (enabled) {
                          const fallbackDate = editingSchedule.workDate;
                          const fallbackWeekday = getWeekdayFromDate(fallbackDate);
                          setEditBatchRange((prev) => ({
                            startDate: prev.startDate || fallbackDate,
                            endDate: prev.endDate || fallbackDate,
                            weekdays: prev.weekdays.length > 0 ? prev.weekdays : (fallbackWeekday === null ? [] : [fallbackWeekday]),
                          }));
                        }
                      }}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    一次調整多天班別
                  </label>
                  <p className="text-xs text-blue-800">會套用到同一位員工在指定日期內的既有班表；沒有既有班表的日期會自動略過。</p>

                  {editBatchMode && (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setEditDateSelectionMode('range')}
                          className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                            editDateSelectionMode === 'range'
                              ? 'bg-gray-900 text-white'
                              : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          日期區間
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditDateSelectionMode('calendar')}
                          className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                            editDateSelectionMode === 'calendar'
                              ? 'bg-gray-900 text-white'
                              : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          月曆模式
                        </button>
                      </div>

                      {editDateSelectionMode === 'range' ? (
                        <>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">開始日期</label>
                              <input
                                type="date"
                                value={editBatchRange.startDate}
                                onChange={(e) => setEditBatchRange((prev) => ({ ...prev, startDate: e.target.value }))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                                required={editBatchMode && editDateSelectionMode === 'range'}
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">結束日期</label>
                              <input
                                type="date"
                                value={editBatchRange.endDate}
                                onChange={(e) => setEditBatchRange((prev) => ({ ...prev, endDate: e.target.value }))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                                required={editBatchMode && editDateSelectionMode === 'range'}
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">套用星期</label>
                            <div className="flex flex-wrap gap-2">
                              {WEEKDAY_OPTIONS.map((weekday) => {
                                const active = editBatchRange.weekdays.includes(weekday.value);
                                return (
                                  <button
                                    key={weekday.value}
                                    type="button"
                                    onClick={() => setEditBatchRange((prev) => ({ ...prev, weekdays: toggleWeekday(prev.weekdays, weekday.value) }))}
                                    className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                                      active ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'
                                    }`}
                                  >
                                    星期{weekday.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="rounded-lg border border-gray-200 bg-white p-3">
                          <div className="flex items-center justify-between gap-3">
                            <button
                              type="button"
                              onClick={goToPreviousEditMonth}
                              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                            >
                              <ChevronLeft className="h-4 w-4" />
                              上個月
                            </button>
                            <div className="text-center">
                              <div className="text-sm font-semibold text-gray-900">
                                {editCalendarMonth.getFullYear()}年 {editCalendarMonth.getMonth() + 1}月
                              </div>
                              <div className="text-xs text-gray-500">先勾選日期，再逐日指定班別並一次儲存</div>
                            </div>
                            <button
                              type="button"
                              onClick={goToNextEditMonth}
                              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                            >
                              下個月
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={selectAllEditCalendarDays}
                              className="rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
                            >
                              全選本月日期
                            </button>
                            <button
                              type="button"
                              onClick={applyEditShiftToSelectedDates}
                              disabled={editCalendarSelectedDates.length === 0}
                              className="rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              全部已選日期改為目前班別
                            </button>
                            <button
                              type="button"
                              onClick={clearEditCalendarDates}
                              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                            >
                              清除已選日期
                            </button>
                          </div>

                          <div className="mt-3 grid grid-cols-7 gap-1">
                            {['日', '一', '二', '三', '四', '五', '六'].map((day) => (
                              <div key={day} className="rounded bg-gray-50 px-2 py-1 text-center text-xs font-medium text-gray-500">
                                {day}
                              </div>
                            ))}
                          </div>
                          <div className="mt-1 grid grid-cols-7 gap-1">
                            {editCalendarDays.map((day, index) => {
                              const date = formatMonthDate(editCalendarMonth, day);
                              const holiday = day ? getHolidayForDate(date, editCalendarHolidays) : null;
                              const selected = day ? Boolean(editCalendarAssignments[date]) : false;
                              const selectedShiftCode = day ? editCalendarAssignments[date] : '';
                              const selectedShiftLabel = selectedShiftCode
                                ? getShiftDefinitionByCode(selectedShiftCode)?.label ?? selectedShiftCode
                                : '';
                              const selectedShiftColor = selected ? getShiftColor(selectedShiftCode) : '';

                              return (
                                <button
                                  key={`${date || 'blank'}-${index}`}
                                  type="button"
                                  onClick={() => day && toggleEditCalendarDate(date)}
                                  disabled={!day}
                                  className={`min-h-20 rounded-md border p-2 text-left transition-colors ${
                                    !day
                                      ? 'cursor-default border-transparent bg-transparent'
                                      : selected
                                        ? `${selectedShiftColor} ring-2 ring-current`
                                        : holiday
                                          ? 'border-red-200 bg-red-50 hover:border-red-300'
                                          : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50'
                                  }`}
                                >
                                  {day && (
                                    <>
                                      <div className="flex items-center justify-between">
                                        <span className="text-sm font-semibold text-gray-900">{day}</span>
                                        {selected && (
                                          <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${selectedShiftColor}`}>
                                            {selectedShiftLabel}
                                          </span>
                                        )}
                                      </div>
                                      {holiday ? (
                                        <div className="mt-1 text-[11px] font-medium text-red-600 leading-4">
                                          {holiday.name}
                                        </div>
                                      ) : (
                                        <div className="mt-1 text-[11px] text-gray-400 leading-4">
                                          {date}
                                        </div>
                                      )}
                                    </>
                                  )}
                                </button>
                              );
                            })}
                          </div>

                          {editCalendarSelectedDates.length > 0 && (
                            <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <div className="text-sm font-medium text-gray-900">已選日期班別</div>
                                  <div className="text-xs text-gray-500">儲存時會依每一天的班別同步最新時間與工時設定。</div>
                                </div>
                                <div className="text-xs text-blue-700">
                                  {editCalendarShiftGroups.map((group) => {
                                    const shift = getShiftDefinitionByCode(group.shiftType);
                                    return `${shift?.label ?? group.shiftType} ${group.workDates.length} 天`;
                                  }).join('｜')}
                                </div>
                              </div>
                              <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                                {editCalendarSelectedDates.map((date) => {
                                  const assignedShiftType = editCalendarAssignments[date] || editScheduleForm.shiftType;
                                  const holiday = getHolidayForDate(date, editCalendarHolidays);
                                  return (
                                    <div key={date} className="flex flex-col gap-2 rounded-md border border-blue-100 bg-white px-3 py-2 md:flex-row md:items-center md:justify-between">
                                      <div>
                                        <div className="text-sm font-medium text-gray-900">{date}</div>
                                        <div className={`text-xs ${holiday ? 'text-red-600' : 'text-gray-500'}`}>
                                          {holiday ? holiday.name : '一般工作日'}
                                        </div>
                                      </div>
                                      <select
                                        value={assignedShiftType}
                                        onChange={(e) => updateEditCalendarDateShift(date, e.target.value)}
                                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 md:w-56"
                                      >
                                        {getSelectableShiftOptions(assignedShiftType).map((shift) => (
                                          <option key={shift.code} value={shift.code} className="text-gray-900 bg-white">
                                            {shift.isActive ? shift.label : `${shift.label}（已停用）`}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="rounded-md bg-white px-3 py-2 text-sm text-blue-900">
                        {editTargetDates.length > 0
                          ? `將嘗試更新 ${editTargetDates.length} 天：${editTargetDates.slice(0, 5).join('、')}${editTargetDates.length > 5 ? '…' : ''}`
                          : editDateSelectionMode === 'calendar'
                            ? '請先在月曆中點選要調整的日期。'
                            : '請選擇有效的日期區間與星期。'}
                        {editDateSelectionMode === 'calendar' && editCalendarShiftGroups.length > 0 && (
                          <div className="mt-1 text-xs text-blue-700">
                            班別：{editCalendarShiftGroups.map((group) => {
                              const shift = getShiftDefinitionByCode(group.shiftType);
                              return `${shift?.label ?? group.shiftType} ${group.workDates.length} 天`;
                            }).join('｜')}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* 班別選擇 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {editBatchMode && editDateSelectionMode === 'calendar' ? '預設班別' : '班別'}
                  </label>
                  <select
                    value={editScheduleForm.shiftType}
                    onChange={(e) => {
                      const shiftType = e.target.value;
                      const template = getShiftTemplateForCode(shiftType);
                      setEditScheduleForm({
                        ...editScheduleForm,
                        shiftType,
                        startTime: template.startTime || editScheduleForm.startTime,
                        endTime: template.endTime || editScheduleForm.endTime,
                        breakTime: template.breakTime,
                        workHours: template.workHours,
                        specialLeaveHours: template.specialLeaveHours,
                        compLeaveHours: template.compLeaveHours,
                        overtimeHours: template.overtimeHours,
                      });
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                  >
                    {getSelectableShiftOptions(editScheduleForm.shiftType).map((shift) => (
                      <option key={shift.code} value={shift.code} className="text-gray-900 bg-white">
                        {shift.isActive ? shift.label : `${shift.label}（已停用）`}
                      </option>
                    ))}
                  </select>
                  {editBatchMode && editDateSelectionMode === 'calendar' && (
                    <p className="mt-1 text-xs text-gray-500">
                      這裡會作為新增日期的預設班別，也可一鍵套用到全部已選日期；每一天仍可在月曆下方個別調整。
                    </p>
                  )}
                </div>

                {/* 時間欄位（只在需要時顯示） */}
                {!(editBatchMode && editDateSelectionMode === 'calendar') && isShiftRequiresTime(editScheduleForm.shiftType) && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">開始時間</label>
                        <input
                          type="time"
                          value={editScheduleForm.startTime}
                          onChange={(e) => setEditScheduleForm({ ...editScheduleForm, startTime: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">結束時間</label>
                        <input
                          type="time"
                          value={editScheduleForm.endTime}
                          onChange={(e) => setEditScheduleForm({ ...editScheduleForm, endTime: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">休息時間（分鐘）</label>
                      <input
                        type="number"
                        min="0"
                        value={editScheduleForm.breakTime}
                        onChange={(e) => setEditScheduleForm({ ...editScheduleForm, breakTime: parseInt(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                      />
                    </div>
                  </>
                )}

                {editBatchMode && editDateSelectionMode === 'calendar' ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    月曆模式會依每一天選擇的班別，自動同步最新的開始時間、結束時間、休息時間與工時資料，避免多日排班後班別與工時不同步。
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">工時</label>
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="0.25"
                        value={editScheduleForm.workHours}
                        onChange={(e) => setEditScheduleForm({ ...editScheduleForm, workHours: Number(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">特休</label>
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="0.25"
                        value={editScheduleForm.specialLeaveHours}
                        onChange={(e) => setEditScheduleForm({ ...editScheduleForm, specialLeaveHours: Number(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">補休</label>
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="0.25"
                        value={editScheduleForm.compLeaveHours}
                        onChange={(e) => setEditScheduleForm({ ...editScheduleForm, compLeaveHours: Number(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">加班</label>
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="0.25"
                        value={editScheduleForm.overtimeHours}
                        onChange={(e) => setEditScheduleForm({ ...editScheduleForm, overtimeHours: Number(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                      />
                    </div>
                  </div>
                )}

                    {/* 按鈕區 */}
                    <div className="sticky bottom-0 -mx-6 border-t border-gray-200 bg-white px-6 py-4">
                      <div className="flex space-x-3">
                        <button
                          type="button"
                          onClick={handleDeleteSchedule}
                          className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 flex items-center"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          刪除
                        </button>
                        <div className="flex-1"></div>
                        <button
                          type="button"
                          onClick={() => {
                            setShowEditScheduleModal(false);
                            setEditingSchedule(null);
                            setEditBatchMode(false);
                            setEditDateSelectionMode('range');
                            setEditCalendarAssignments({});
                          }}
                          className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                        >
                          取消
                        </button>
                        <button
                          type="submit"
                          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                        >
                          儲存
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(scheduleConflictPreview)}
        title="確認覆蓋既有班表"
        message={scheduleConflictMessage}
        confirmLabel="覆蓋並建立"
        loading={creatingSchedules}
        onCancel={cancelScheduleConflictOverwrite}
        onConfirm={confirmScheduleConflictOverwrite}
      />

      <ConfirmDialog
        open={bulkDeleteConfirmOpen}
        title="確認批量刪除班表"
        message={`確定要刪除 ${createSelectedEmployeeIds.length} 位員工、共 ${createTargetDates.length} 天的班表嗎？\n\n此操作無法復原，只會刪除符合條件的既有班表。`}
        tone="danger"
        confirmLabel="批量刪除"
        loading={deletingSchedules}
        onCancel={() => {
          if (!deletingSchedules) setBulkDeleteConfirmOpen(false);
        }}
        onConfirm={performBulkDeleteSchedules}
      />

      <ConfirmDialog
        open={scheduleDeleteConfirmOpen}
        title="確認刪除班表"
        message={editingSchedule ? `確定要刪除 ${editingSchedule.employee.name} 在 ${editingSchedule.workDate} 的班表嗎？此操作無法復原。` : ''}
        tone="danger"
        confirmLabel="刪除班表"
        loading={deletingSchedules}
        onCancel={() => {
          if (!deletingSchedules) setScheduleDeleteConfirmOpen(false);
        }}
        onConfirm={performDeleteSchedule}
      />

    </AuthenticatedLayout>
  );
}
