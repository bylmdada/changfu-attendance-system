'use client';

import { useState, useEffect, useMemo } from 'react';
import { 
  Calendar, 
  CalendarDays, 
  Plus, 
  Copy, 
  X,
  Edit2,
  Trash2,
  Clock,
  User,
  Save,
  ArrowLeft
} from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import Link from 'next/link';
import {
  buildDefaultShiftDTOs,
  getShiftColorClass,
  getShiftTemplate,
  type ShiftDefinitionDTO,
} from '@/lib/shift-definition-utils';

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
  id: number;
  name: string;
  description: string;
  department: string | null;    // null = 通用（全機構）
  createdById: number | null;
  createdByName: string | null;
  monday: DaySchedule;
  tuesday: DaySchedule;
  wednesday: DaySchedule;
  thursday: DaySchedule;
  friday: DaySchedule;
  saturday: DaySchedule;
  sunday: DaySchedule;
  createdAt: string;
  updatedAt: string;
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

// 顯示用的短標籤（在週模版列表中使用）
const SHIFT_TYPE_SHORT_LABELS: Record<string, string> = {
  A: 'A',
  B: 'B',
  C: 'C',
  NH: '國定假日',
  RD: '例假',
  rd: '休息日',
  FDL: '全日請假',
  OFF: '休假',
  TD: '天災假'
};

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const WEEKDAY_LABELS = {
  monday: '週一',
  tuesday: '週二',
  wednesday: '週三',
  thursday: '週四',
  friday: '週五',
  saturday: '週六',
  sunday: '週日'
};

export default function WeeklyTemplatesPage() {
  const [user, setUser] = useState<User | null>(null);
  const [templates, setTemplates] = useState<WeeklyTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<WeeklyTemplate | null>(null);
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
  const getShiftDefinitionByCode = (code: string) => shiftDisplayDefinitions.find((shift) => shift.code === code);
  const isShiftRequiresTime = (code: string) => getShiftDefinitionByCode(code)?.requiresTime ?? !['RD', 'rd', 'FDL', 'OFF', 'NH', 'TD'].includes(code);
  const getShiftShortLabel = (code: string) => getShiftDefinitionByCode(code)?.code ?? SHIFT_TYPE_SHORT_LABELS[code] ?? code;
  const getShiftColor = (code: string) => getShiftColorClass(code, shiftDisplayDefinitions);
  const getSelectableShiftOptions = (currentCode?: string) => {
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
  };
  const getShiftTemplateForCode = (code: string) => {
    const shift = getShiftDefinitionByCode(code);
    if (shift) {
      return getShiftTemplate(code, shiftOptions);
    }

    const legacyTemplate = SHIFT_TYPE_LABELS[code as keyof typeof SHIFT_TYPE_LABELS]
      ? { startTime: code === 'A' ? '07:30' : code === 'B' ? '08:00' : code === 'C' ? '08:30' : '', endTime: code === 'A' ? '16:30' : code === 'B' ? '17:00' : code === 'C' ? '17:30' : '', breakTime: ['A', 'B', 'C'].includes(code) ? 60 : 0, workHours: ['A', 'B', 'C'].includes(code) ? 8 : 0, specialLeaveHours: code === 'FDL' ? 8 : 0, compLeaveHours: 0, overtimeHours: 0 }
      : { startTime: '', endTime: '', breakTime: 0, workHours: 0, specialLeaveHours: 0, compLeaveHours: 0, overtimeHours: 0 };

    return { ...legacyTemplate, requiresTime: isShiftRequiresTime(code) };
  };

  // 新模版表單狀態
  const [newTemplate, setNewTemplate] = useState({
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

  useEffect(() => {
    fetchUser();
    fetchShiftDefinitions();
    fetchTemplates();
  }, []);

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

  const fetchTemplates = async () => {
    try {
      const response = await fetch('/api/schedules/templates', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setTemplates(data.templates || []);
      }
    } catch (error) {
      console.error('獲取週班模版失敗:', error);
    } finally {
      setLoading(false);
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

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetchJSONWithCSRF('/api/schedules/templates', {
        method: 'POST',
        body: newTemplate,
      });

      if (response.ok) {
        alert('週班模版建立成功');
        setShowCreateModal(false);
        resetForm();
        fetchTemplates();
      } else {
        const error = await response.json();
        alert(error.error || '建立失敗');
      }
    } catch {
      alert('建立失敗，請稍後再試');
    }
  };

  const handleUpdateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTemplate) return;

    try {
      const response = await fetchJSONWithCSRF(`/api/schedules/templates/${editingTemplate.id}`, {
        method: 'PUT',
        body: editingTemplate,
      });

      if (response.ok) {
        alert('週班模版更新成功');
        setShowEditModal(false);
        setEditingTemplate(null);
        fetchTemplates();
      } else {
        const error = await response.json();
        alert(error.error || '更新失敗');
      }
    } catch {
      alert('更新失敗，請稍後再試');
    }
  };

  const handleDeleteTemplate = async (id: number) => {
    if (!confirm('確認刪除此週班模版？此操作無法撤銷。')) return;

    try {
      const response = await fetchJSONWithCSRF(`/api/schedules/templates/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        alert('週班模版刪除成功');
        fetchTemplates();
      } else {
        const error = await response.json();
        alert(error.error || '刪除失敗');
      }
    } catch {
      alert('刪除失敗，請稍後再試');
    }
  };

  const handleDuplicateTemplate = (template: WeeklyTemplate) => {
    if (shiftOptions.length === 0) {
      alert('目前沒有啟用中的班別，請先至系統設定啟用或新增班別');
      return;
    }
    const defaultShiftCode = shiftOptions[0].code;
    const defaultShiftTemplate = getShiftTemplateForCode(defaultShiftCode);
    const normalizeDayScheduleForCreate = (daySchedule: DaySchedule) => (
      shiftOptions.some((shift) => shift.code === daySchedule.shiftType)
        ? { ...daySchedule }
        : {
            shiftType: defaultShiftCode,
            startTime: defaultShiftTemplate.startTime,
            endTime: defaultShiftTemplate.endTime,
            breakTime: defaultShiftTemplate.breakTime,
            workHours: defaultShiftTemplate.workHours,
            specialLeaveHours: defaultShiftTemplate.specialLeaveHours,
            compLeaveHours: defaultShiftTemplate.compLeaveHours,
            overtimeHours: defaultShiftTemplate.overtimeHours,
          }
    );

    setNewTemplate({
      name: `${template.name} (複製)`,
      description: template.description,
      monday: normalizeDayScheduleForCreate(template.monday),
      tuesday: normalizeDayScheduleForCreate(template.tuesday),
      wednesday: normalizeDayScheduleForCreate(template.wednesday),
      thursday: normalizeDayScheduleForCreate(template.thursday),
      friday: normalizeDayScheduleForCreate(template.friday),
      saturday: normalizeDayScheduleForCreate(template.saturday),
      sunday: normalizeDayScheduleForCreate(template.sunday)
    });
    setShowCreateModal(true);
  };

  const resetForm = () => {
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
  };

  const updateDaySchedule = (day: string, field: string, value: string | number, isEditing: boolean = false) => {
    const shiftTemplate = field === 'shiftType' && typeof value === 'string'
      ? getShiftTemplateForCode(value)
      : null;

    if (isEditing && editingTemplate) {
      const currentDay = editingTemplate[day as keyof WeeklyTemplate] as DaySchedule;
      setEditingTemplate({
        ...editingTemplate,
        [day]: {
          ...currentDay,
          [field]: value,
          ...(shiftTemplate && {
            startTime: shiftTemplate.startTime,
            endTime: shiftTemplate.endTime,
            breakTime: shiftTemplate.breakTime,
            workHours: shiftTemplate.workHours,
            specialLeaveHours: shiftTemplate.specialLeaveHours,
            compLeaveHours: shiftTemplate.compLeaveHours,
            overtimeHours: shiftTemplate.overtimeHours,
          })
        }
      });
    } else {
      const currentDay = newTemplate[day as keyof typeof newTemplate] as DaySchedule;
      setNewTemplate({
        ...newTemplate,
        [day]: {
          ...currentDay,
          [field]: value,
          ...(shiftTemplate && {
            startTime: shiftTemplate.startTime,
            endTime: shiftTemplate.endTime,
            breakTime: shiftTemplate.breakTime,
            workHours: shiftTemplate.workHours,
            specialLeaveHours: shiftTemplate.specialLeaveHours,
            compLeaveHours: shiftTemplate.compLeaveHours,
            overtimeHours: shiftTemplate.overtimeHours,
          })
        }
      });
    }
  };

  const canManage = user && user.role && (user.role === 'ADMIN' || user.role === 'HR');

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">權限不足</h1>
          <p className="text-gray-600 mb-6">您沒有權限訪問此頁面</p>
          <a
            href="/dashboard"
            className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
          >
            返回首頁
          </a>
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
            <div className="flex items-center space-x-6">
              <Link
                href="/schedule-management"
                className="border border-indigo-600 text-indigo-600 hover:bg-indigo-50 rounded-lg px-4 py-2 flex items-center transition-colors"
              >
                <ArrowLeft className="w-5 h-5 mr-2" />
                返回班表管理
              </Link>
              <div>
                <h1 className="text-3xl font-bold text-gray-900 flex items-center">
                  <CalendarDays className="w-8 h-8 text-indigo-600 mr-3" />
                  週班模版管理
                </h1>
                <p className="text-gray-600 mt-1">管理週班模版，可套用至員工班表</p>
              </div>
            </div>
            <button
              onClick={() => {
                if (shiftOptions.length === 0) {
                  alert('目前沒有啟用中的班別，請先至系統設定啟用或新增班別');
                  return;
                }
                resetForm();
                setShowCreateModal(true);
              }}
              disabled={shiftDefinitionsLoaded && shiftOptions.length === 0}
              className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors flex items-center disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              <Plus className="w-5 h-5 mr-2" />
              建立新模版
            </button>
          </div>
        </div>

        {/* 統計卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <Calendar className="w-8 h-8 text-indigo-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">總模版數</p>
                <p className="text-2xl font-bold text-gray-900">
                  {templates.length}
                </p>
              </div>
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <Clock className="w-8 h-8 text-green-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">本週新增</p>
                <p className="text-2xl font-bold text-gray-900">
                  {templates.filter(template => {
                    const created = new Date(template.createdAt);
                    const now = new Date();
                    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    return created >= weekAgo;
                  }).length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <User className="w-8 h-8 text-blue-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">本月更新</p>
                <p className="text-2xl font-bold text-gray-900">
                  {templates.filter(template => {
                    const updated = new Date(template.updatedAt);
                    const now = new Date();
                    return updated.getMonth() === now.getMonth() && 
                           updated.getFullYear() === now.getFullYear();
                  }).length}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 模版列表 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {templates.map((template) => (
            <div key={template.id} className="bg-white rounded-lg shadow-md">
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-bold text-gray-900">{template.name}</h3>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        template.department === null 
                          ? 'bg-purple-100 text-purple-700' 
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {template.department === null ? '全機構' : template.department}
                      </span>
                    </div>
                    <p className="text-gray-600 mt-1">{template.description}</p>
                    <p className="text-sm text-gray-500 mt-2">
                      建立：{template.createdByName || '系統'} · {new Date(template.createdAt).toLocaleDateString('zh-TW')}
                    </p>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleDuplicateTemplate(template)}
                      className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors"
                      title="複製"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        setEditingTemplate(template);
                        setShowEditModal(true);
                      }}
                      className="p-2 text-green-600 hover:text-green-800 hover:bg-green-50 rounded-lg transition-colors"
                      title="編輯"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteTemplate(template.id)}
                      className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition-colors"
                      title="刪除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* 週班表預覽 */}
                <div className="space-y-2">
                  {WEEKDAYS.map((day) => {
                    const daySchedule = template[day as keyof WeeklyTemplate] as DaySchedule;
                    return (
                      <div key={day} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0">
                        <span className="text-sm font-medium text-gray-700 w-12">
                          {WEEKDAY_LABELS[day as keyof typeof WEEKDAY_LABELS]}
                        </span>
                        <div className="flex-1 ml-4">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getShiftColor(daySchedule.shiftType)}`}>
                            {getShiftShortLabel(daySchedule.shiftType)}
                          </span>
                          {daySchedule.startTime && daySchedule.endTime && (
                            <span className="ml-2 text-sm text-gray-600">
                              {daySchedule.startTime} - {daySchedule.endTime}
                              {daySchedule.breakTime > 0 && (
                                <span className="text-gray-500 ml-1">
                                  (休息 {daySchedule.breakTime}分)
                                </span>
                              )}
                            </span>
                          )}
                          <div className="mt-1 text-xs text-gray-500">
                            工時 {daySchedule.workHours || 0}h
                            {daySchedule.specialLeaveHours > 0 && ` / 特休 ${daySchedule.specialLeaveHours}h`}
                            {daySchedule.compLeaveHours > 0 && ` / 補休 ${daySchedule.compLeaveHours}h`}
                            {daySchedule.overtimeHours > 0 && ` / 加班 ${daySchedule.overtimeHours}h`}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}

          {templates.length === 0 && (
            <div className="col-span-full text-center py-12">
              <CalendarDays className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">尚無週班模版</p>
              <button
                onClick={() => {
                  if (shiftOptions.length === 0) {
                    alert('目前沒有啟用中的班別，請先至系統設定啟用或新增班別');
                    return;
                  }
                  resetForm();
                  setShowCreateModal(true);
                }}
                disabled={shiftDefinitionsLoaded && shiftOptions.length === 0}
                className="mt-4 bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                建立第一個模版
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 建立模版表單彈窗 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">建立新週班模版</h2>
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    resetForm();
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleCreateTemplate} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">模版名稱</label>
                    <input
                      type="text"
                      value={newTemplate.name}
                      onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-black"
                      placeholder="例如：標準工作週"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                    <input
                      type="text"
                      value={newTemplate.description}
                      onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-black"
                      placeholder="模版說明"
                    />
                  </div>
                </div>

                {/* 週班表設定 */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-900">週班表設定</h3>
                  {WEEKDAYS.map((day) => {
                    const dayData = newTemplate[day as keyof typeof newTemplate] as DaySchedule;
                    return (
                      <div key={day} className="grid grid-cols-5 gap-3 items-center p-4 bg-gray-50 rounded-lg">
                        <div className="font-medium text-gray-700">
                          {WEEKDAY_LABELS[day as keyof typeof WEEKDAY_LABELS]}
                        </div>
                        <div>
                          <select
                            value={dayData.shiftType}
                            onChange={(e) => updateDaySchedule(day, 'shiftType', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 bg-white"
                          >
                            {shiftOptions.map((shift) => (
                              <option key={shift.code} value={shift.code} className="text-gray-900 bg-white">{shift.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <input
                            type="time"
                            value={dayData.startTime}
                            onChange={(e) => updateDaySchedule(day, 'startTime', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 bg-white disabled:text-gray-500 disabled:bg-gray-100"
                            disabled={!isShiftRequiresTime(dayData.shiftType)}
                          />
                        </div>
                        <div>
                          <input
                            type="time"
                            value={dayData.endTime}
                            onChange={(e) => updateDaySchedule(day, 'endTime', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 bg-white disabled:text-gray-500 disabled:bg-gray-100"
                            disabled={!isShiftRequiresTime(dayData.shiftType)}
                          />
                        </div>
                        <div>
                          <input
                            type="number"
                            value={dayData.breakTime}
                            onChange={(e) => updateDaySchedule(day, 'breakTime', parseInt(e.target.value) || 0)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 bg-white disabled:text-gray-500 disabled:bg-gray-100"
                            min="0"
                            max="480"
                            placeholder="分鐘"
                            disabled={!isShiftRequiresTime(dayData.shiftType)}
                          />
                        </div>
                        <div className="text-xs text-gray-500">
                          休息時間(分)
                        </div>
                        <div className="col-span-5 grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">工時</label>
                            <input
                              type="number"
                              value={dayData.workHours}
                              onChange={(e) => updateDaySchedule(day, 'workHours', Number(e.target.value) || 0)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 bg-white"
                              min="0"
                              max="24"
                              step="0.25"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">特休</label>
                            <input
                              type="number"
                              value={dayData.specialLeaveHours}
                              onChange={(e) => updateDaySchedule(day, 'specialLeaveHours', Number(e.target.value) || 0)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 bg-white"
                              min="0"
                              max="24"
                              step="0.25"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">補休</label>
                            <input
                              type="number"
                              value={dayData.compLeaveHours}
                              onChange={(e) => updateDaySchedule(day, 'compLeaveHours', Number(e.target.value) || 0)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 bg-white"
                              min="0"
                              max="24"
                              step="0.25"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">加班</label>
                            <input
                              type="number"
                              value={dayData.overtimeHours}
                              onChange={(e) => updateDaySchedule(day, 'overtimeHours', Number(e.target.value) || 0)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 bg-white"
                              min="0"
                              max="24"
                              step="0.25"
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
                      setShowCreateModal(false);
                      resetForm();
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 flex items-center justify-center"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    建立模版
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 編輯模版表單彈窗 */}
      {showEditModal && editingTemplate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">編輯週班模版</h2>
                <button
                  onClick={() => {
                    setShowEditModal(false);
                    setEditingTemplate(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleUpdateTemplate} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">模版名稱</label>
                    <input
                      type="text"
                      value={editingTemplate.name}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-black"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                    <input
                      type="text"
                      value={editingTemplate.description}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-black"
                    />
                  </div>
                </div>

                {/* 週班表設定 */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-900">週班表設定</h3>
                  {WEEKDAYS.map((day) => {
                    const dayData = editingTemplate[day as keyof WeeklyTemplate] as DaySchedule;
                    return (
                      <div key={day} className="grid grid-cols-5 gap-3 items-center p-4 bg-gray-50 rounded-lg">
                        <div className="font-medium text-gray-700">
                          {WEEKDAY_LABELS[day as keyof typeof WEEKDAY_LABELS]}
                        </div>
                        <div>
                          <select
                            value={dayData.shiftType}
                            onChange={(e) => updateDaySchedule(day, 'shiftType', e.target.value, true)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 bg-white"
                          >
                            {getSelectableShiftOptions(dayData.shiftType).map((shift) => (
                              <option key={shift.code} value={shift.code} className="text-gray-900 bg-white">
                                {shift.isActive ? shift.label : `${shift.label}（已停用）`}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <input
                            type="time"
                            value={dayData.startTime}
                            onChange={(e) => updateDaySchedule(day, 'startTime', e.target.value, true)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 bg-white disabled:text-gray-500 disabled:bg-gray-100"
                            disabled={!isShiftRequiresTime(dayData.shiftType)}
                          />
                        </div>
                        <div>
                          <input
                            type="time"
                            value={dayData.endTime}
                            onChange={(e) => updateDaySchedule(day, 'endTime', e.target.value, true)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 bg-white disabled:text-gray-500 disabled:bg-gray-100"
                            disabled={!isShiftRequiresTime(dayData.shiftType)}
                          />
                        </div>
                        <div>
                          <input
                            type="number"
                            value={dayData.breakTime}
                            onChange={(e) => updateDaySchedule(day, 'breakTime', parseInt(e.target.value) || 0, true)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 bg-white disabled:text-gray-500 disabled:bg-gray-100"
                            min="0"
                            max="480"
                            disabled={!isShiftRequiresTime(dayData.shiftType)}
                          />
                        </div>
                        <div className="text-xs text-gray-500">
                          休息時間(分)
                        </div>
                        <div className="col-span-5 grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">工時</label>
                            <input
                              type="number"
                              value={dayData.workHours}
                              onChange={(e) => updateDaySchedule(day, 'workHours', Number(e.target.value) || 0, true)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 bg-white"
                              min="0"
                              max="24"
                              step="0.25"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">特休</label>
                            <input
                              type="number"
                              value={dayData.specialLeaveHours}
                              onChange={(e) => updateDaySchedule(day, 'specialLeaveHours', Number(e.target.value) || 0, true)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 bg-white"
                              min="0"
                              max="24"
                              step="0.25"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">補休</label>
                            <input
                              type="number"
                              value={dayData.compLeaveHours}
                              onChange={(e) => updateDaySchedule(day, 'compLeaveHours', Number(e.target.value) || 0, true)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 bg-white"
                              min="0"
                              max="24"
                              step="0.25"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">加班</label>
                            <input
                              type="number"
                              value={dayData.overtimeHours}
                              onChange={(e) => updateDaySchedule(day, 'overtimeHours', Number(e.target.value) || 0, true)}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 bg-white"
                              min="0"
                              max="24"
                              step="0.25"
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
                      setShowEditModal(false);
                      setEditingTemplate(null);
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 flex items-center justify-center"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    更新模版
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </AuthenticatedLayout>
  );
}
