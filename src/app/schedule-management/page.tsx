
'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  Calendar, 
  CalendarDays, 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Copy, 
  X
} from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import QuickCopySchedule from '@/components/QuickCopySchedule';

interface Schedule {
  id: number;
  employeeId: number;
  workDate: string;
  shiftType: 'A' | 'B' | 'C' | 'NH' | 'RD' | 'rd' | 'FDL' | 'OFF';
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

interface Employee {
  id: number;
  employeeId: string;
  name: string;
  department: string;
  position: string;
  managedLocation?: string;  // 據點排班員負責的據點
}

interface DaySchedule {
  shiftType: string;
  startTime: string;
  endTime: string;
  breakTime: number;
}

interface WeeklyTemplate {
  id?: number;
  name: string;
  description: string;
  monday: { shiftType: string; startTime: string; endTime: string; breakTime: number; };
  tuesday: { shiftType: string; startTime: string; endTime: string; breakTime: number; };
  wednesday: { shiftType: string; startTime: string; endTime: string; breakTime: number; };
  thursday: { shiftType: string; startTime: string; endTime: string; breakTime: number; };
  friday: { shiftType: string; startTime: string; endTime: string; breakTime: number; };
  saturday: { shiftType: string; startTime: string; endTime: string; breakTime: number; };
  sunday: { shiftType: string; startTime: string; endTime: string; breakTime: number; };
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
    managedLocation?: string;
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
  OFF: 'OFF (休假)'
};

const SHIFT_TYPE_COLORS = {
  A: 'bg-blue-100 text-blue-800 border-blue-200',
  B: 'bg-green-100 text-green-800 border-green-200',
  C: 'bg-purple-100 text-purple-800 border-purple-200',
  NH: 'bg-red-100 text-red-800 border-red-200',
  RD: 'bg-gray-100 text-gray-800 border-gray-200',
  rd: 'bg-gray-50 text-gray-600 border-gray-100',
  FDL: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  OFF: 'bg-orange-100 text-orange-800 border-orange-200'
};

const SHIFT_TEMPLATES = {
  A: { startTime: '07:30', endTime: '16:30', breakTime: 60 },
  B: { startTime: '08:00', endTime: '17:00', breakTime: 60 },
  C: { startTime: '08:30', endTime: '17:30', breakTime: 60 },
  NH: { startTime: '', endTime: '', breakTime: 0 },
  RD: { startTime: '', endTime: '', breakTime: 0 },
  rd: { startTime: '', endTime: '', breakTime: 0 },
  FDL: { startTime: '', endTime: '', breakTime: 0 },
  OFF: { startTime: '', endTime: '', breakTime: 0 }
};

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const WEEKDAY_LABELS = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];

// 據點列表
const LOCATIONS = [
  '溪北輔具中心',
  '礁溪失智據點',
  '羅東失智據點',
  '三星失智據點',
  '冬山失智據點',
  '八寶日照中心',
  '蘇西日照中心'
];

export default function ScheduleManagementPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [schedulePermissions, setSchedulePermissions] = useState<string[]>([]);  // 班表管理權限（可管理的部門列表）
  
  // 日曆相關狀態
  const [calendarSchedules, setCalendarSchedules] = useState<{[key: string]: Schedule[]}>({});
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [newSchedule, setNewSchedule] = useState({
    employeeId: '',
    workDate: '',
    shiftType: 'A' as 'A' | 'B' | 'C' | 'NH' | 'RD' | 'rd' | 'FDL' | 'OFF',
    startTime: '07:30',
    endTime: '16:30',
    breakTime: 60
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
  
  // 搜尋相關狀態
  const [searchFilters, setSearchFilters] = useState({
    yearMonth: '',
    employeeId: '',
    employeeName: '',
    department: '',
    position: '',
    location: ''  // 據點篩選
  });

  // 取得職位選項（從員工資料動態取得）
  const positionOptions = [...new Set(employees.map(e => e.position).filter(Boolean))].sort();
  const [searchResults, setSearchResults] = useState<Schedule[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [locationFilter, setLocationFilter] = useState('');  // 日曆據點篩選
  
  const [newTemplate, setNewTemplate] = useState<WeeklyTemplate>({
    name: '',
    description: '',
    monday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
    tuesday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
    wednesday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
    thursday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
    friday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
    saturday: { shiftType: 'RD', startTime: '', endTime: '', breakTime: 0 },
    sunday: { shiftType: 'RD', startTime: '', endTime: '', breakTime: 0 }
  });

  const fetchMonthlySchedules = useCallback(async () => {
    try {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;
      const response = await fetch(`/api/schedules?year=${year}&month=${month}`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        const schedulesByDate: {[key: string]: Schedule[]} = {};
        (data.schedules || []).forEach((schedule: Schedule) => {
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
  }, [currentDate]);

  useEffect(() => {
    fetchUser();
    fetchEmployees();
    fetchSchedules();
    fetchWeeklyTemplates();
  }, []);

  useEffect(() => {
    if (currentDate) {
      fetchMonthlySchedules();
    }
  }, [currentDate, fetchMonthlySchedules]);

  // 獲取用戶的班表管理權限
  const fetchSchedulePermissions = async (employeeId: number) => {
    try {
      const response = await fetch(`/api/attendance-permissions/${employeeId}`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        if (data.permission?.scheduleManagement) {
          setSchedulePermissions(data.permission.scheduleManagement);
        }
      }
    } catch (error) {
      console.error('獲取班表權限失敗:', error);
    }
  };

  // 當用戶資料載入後，獲取其班表權限
  useEffect(() => {
    if (user?.employee?.id) {
      fetchSchedulePermissions(user.employee.id);
    }
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
      const response = await fetch('/api/employees', {
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

      console.log('搜尋參數:', queryParams.toString()); // 調試用

      const response = await fetch(`/api/schedules/search?${queryParams.toString()}`, {
        credentials: 'include'
      });
      
      console.log('API 回應狀態:', response.status, response.statusText); // 調試用
      
      if (response.ok) {
        const data = await response.json();
        console.log('搜尋結果:', data); // 調試用
        setSearchResults(data.schedules || []);
        
        // 更新日曆顯示
        const schedulesByDate: {[key: string]: Schedule[]} = {};
        (data.schedules || []).forEach((schedule: Schedule) => {
          const date = schedule.workDate;
          if (!schedulesByDate[date]) {
            schedulesByDate[date] = [];
          }
          schedulesByDate[date].push(schedule);
        });
        setCalendarSchedules(schedulesByDate);
        
        if ((data.schedules || []).length === 0) {
          console.log('搜尋結果：沒有找到符合條件的班表資料');
        } else {
          console.log(`搜尋結果：找到 ${data.schedules.length} 筆班表記錄`);
        }
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
        alert(`搜尋失敗: ${errorMessage}`);
        setSearchResults([]);
        setCalendarSchedules({});
      }
    } catch (error) {
      console.error('搜尋班表失敗:', error);
      alert('搜尋失敗，請稍後再試');
      setSearchResults([]);
      setCalendarSchedules({});
    } finally {
      setSearchLoading(false);
    }
  };

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetchJSONWithCSRF('/api/schedules', {
        method: 'POST',
        body: newSchedule
      });

      if (response.ok) {
        alert('班表建立成功');
        setShowScheduleModal(false);
        resetScheduleForm();
        fetchSchedules();
        fetchMonthlySchedules();
      } else {
        const error = await response.json();
        alert(error.error || '建立班表失敗');
      }
    } catch {
      alert('建立班表失敗，請稍後再試');
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
        alert('週模版建立成功');
        setShowTemplateModal(false);
        resetTemplateForm();
        fetchWeeklyTemplates();
      } else {
        const error = await response.json();
        alert(error.error || '建立週模版失敗');
      }
    } catch {
      alert('建立週模版失敗，請稍後再試');
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
        alert('週模版更新成功');
        setShowTemplateModal(false);
        setEditingTemplate(null);
        resetTemplateForm();
        fetchWeeklyTemplates();
      } else {
        const error = await response.json();
        alert(error.error || '更新週模版失敗');
      }
    } catch {
      alert('更新週模版失敗，請稍後再試');
    }
  };

  const handleApplyTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplateId || !applyToMonth) return;

    if (selectedEmployees.length === 0) {
      alert('請至少選擇一位員工');
      return;
    }

    try {
      const [year, month] = applyToMonth.split('-').map(Number);
      const response = await fetchJSONWithCSRF('/api/schedules/apply-template', {
        method: 'POST',
        body: {
          templateId: selectedTemplateId,
          year,
          month,
          employeeIds: selectedEmployees
        }
      });

      if (response.ok) {
        alert('週模版套用成功');
        setShowApplyTemplateModal(false);
        setSelectedTemplateId(null);
        setApplyToMonth('');
        setSelectedEmployees([]);
        setEmployeeSearch('');
        fetchMonthlySchedules();
      } else {
        const error = await response.json();
        alert(error.error || '套用週模版失敗');
      }
    } catch {
      alert('套用週模版失敗，請稍後再試');
    }
  };

  // 筛选员工
  const filteredEmployees = employees.filter(employee => {
    if (!employeeSearch) return true;
    const searchLower = employeeSearch.toLowerCase();
    return (
      employee.employeeId.toLowerCase().includes(searchLower) ||
      employee.name.toLowerCase().includes(searchLower) ||
      employee.department.toLowerCase().includes(searchLower)
    );
  });

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

  const resetScheduleForm = () => {
    setNewSchedule({
      employeeId: '',
      workDate: '',
      shiftType: 'A',
      startTime: '07:30',
      endTime: '16:30',
      breakTime: 60
    });
  };

  const resetTemplateForm = () => {
    setNewTemplate({
      name: '',
      description: '',
      monday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
      tuesday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
      wednesday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
      thursday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
      friday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
      saturday: { shiftType: 'RD', startTime: '', endTime: '', breakTime: 0 },
      sunday: { shiftType: 'RD', startTime: '', endTime: '', breakTime: 0 }
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
    return new Date(year, month, day).toISOString().split('T')[0];
  };

  const goToPreviousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  // 權限判斷
  const isFullAdmin = user && (user.role === 'ADMIN' || user.role === 'HR');
  // 有班表管理權限的人員（透過考勤權限設定）
  const hasSchedulePermission = schedulePermissions.length > 0;
  const canManage = isFullAdmin || hasSchedulePermission;
  // 可管理的據點列表（管理員可管理全部，其他人員只能管理被授權的據點）
  const allowedLocations = isFullAdmin ? LOCATIONS : schedulePermissions;

  // 有權限的人員，如果沒有選擇據點，自動選擇第一個可管理的據點
  useEffect(() => {
    if (hasSchedulePermission && !isFullAdmin && schedulePermissions.length === 1 && !locationFilter) {
      setLocationFilter(schedulePermissions[0]);
    }
  }, [hasSchedulePermission, isFullAdmin, schedulePermissions, locationFilter]);

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
              <div className="flex space-x-3">
                <QuickCopySchedule onSuccess={fetchMonthlySchedules} />
                <button
                  onClick={() => window.location.href = '/schedule-management/weekly-templates'}
                  className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors flex items-center"
                >
                  <Calendar className="w-5 h-5 mr-2" />
                  週班模版
                </button>
                <button
                  onClick={() => setShowApplyTemplateModal(true)}
                  className="bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors flex items-center"
                >
                  <Calendar className="w-5 h-5 mr-2" />
                  套用模版
                </button>
                <button
                  onClick={() => setShowTemplateModal(true)}
                  className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors flex items-center"
                >
                  <Copy className="w-5 h-5 mr-2" />
                  建立週模版
                </button>
                <button
                  onClick={() => setShowScheduleModal(true)}
                  className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors flex items-center"
                >
                  <Plus className="w-5 h-5 mr-2" />
                  建立班表
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
                  className="px-4 py-2.5 text-base font-semibold text-gray-900 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-w-[220px]"
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
                  onChange={(e) => setSearchFilters({ ...searchFilters, employeeId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  placeholder="輸入員編"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">姓名</label>
                <input
                  type="text"
                  value={searchFilters.employeeName}
                  onChange={(e) => setSearchFilters({ ...searchFilters, employeeName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  placeholder="輸入姓名"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">部門（據點）</label>
                <select
                  value={searchFilters.department}
                  onChange={(e) => setSearchFilters({ ...searchFilters, department: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                >
                  <option value="">全部</option>
                  {LOCATIONS.map((loc) => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">職位</label>
                <select
                  value={searchFilters.position}
                  onChange={(e) => setSearchFilters({ ...searchFilters, position: e.target.value })}
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
            
            {/* 搜尋結果 */}
            {searchResults.length > 0 && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-md font-medium text-gray-900">搜尋結果</h3>
                  <span className="text-sm text-gray-600 bg-blue-50 px-3 py-1 rounded-full">
                    找到 {searchResults.length} 筆記錄
                  </span>
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
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${SHIFT_TYPE_COLORS[schedule.shiftType]}`}>
                              {schedule.shiftType}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {schedule.startTime && schedule.endTime 
                              ? `${schedule.startTime}-${schedule.endTime}` 
                              : '休息'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

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
                
                return (
                  <div key={index} className="min-h-[120px] border border-gray-200 rounded p-2">
                    {day && (
                      <>
                        <div className="font-medium text-sm text-gray-900 mb-2">{day}</div>
                        <div className="space-y-1">
                          {daySchedules.slice(0, 3).map((schedule) => (
                            <div
                              key={schedule.id}
                              className={`text-xs px-2 py-1 rounded border ${SHIFT_TYPE_COLORS[schedule.shiftType]}`}
                            >
                              <div className="font-medium">{schedule.employee.name}</div>
                              <div>{SHIFT_TYPE_LABELS[schedule.shiftType]}</div>
                            </div>
                          ))}
                          {daySchedules.length > 3 && (
                            <div className="text-xs text-gray-500 px-2">
                              +{daySchedules.length - 3} 更多
                            </div>
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
      </div>

      {/* 建立班表彈窗 */}
      {showScheduleModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-black">建立班表</h2>
                <button
                  onClick={() => {
                    setShowScheduleModal(false);
                    resetScheduleForm();
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleCreateSchedule} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-black mb-1">員工</label>
                  <select
                    value={newSchedule.employeeId}
                    onChange={(e) => setNewSchedule({ ...newSchedule, employeeId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    required
                  >
                    <option value="">請選擇員工</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.employeeId} - {employee.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-black mb-1">工作日期</label>
                  <input
                    type="date"
                    value={newSchedule.workDate}
                    onChange={(e) => setNewSchedule({ ...newSchedule, workDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-black mb-1">班別</label>
                  <select
                    value={newSchedule.shiftType}
                    onChange={(e) => {
                      const shiftType = e.target.value as 'A' | 'B' | 'C' | 'NH' | 'RD' | 'rd' | 'FDL' | 'OFF';
                      const template = SHIFT_TEMPLATES[shiftType];
                      setNewSchedule({
                        ...newSchedule,
                        shiftType,
                        startTime: template.startTime,
                        endTime: template.endTime,
                        breakTime: template.breakTime
                      });
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                  >
                    {Object.entries(SHIFT_TYPE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>

                {(newSchedule.shiftType === 'A' || newSchedule.shiftType === 'B' || newSchedule.shiftType === 'C') && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-black mb-1">開始時間</label>
                        <input
                          type="time"
                          value={newSchedule.startTime}
                          onChange={(e) => setNewSchedule({ ...newSchedule, startTime: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-black mb-1">結束時間</label>
                        <input
                          type="time"
                          value={newSchedule.endTime}
                          onChange={(e) => setNewSchedule({ ...newSchedule, endTime: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-black mb-1">休息時間（分鐘）</label>
                      <input
                        type="number"
                        value={newSchedule.breakTime}
                        onChange={(e) => setNewSchedule({ ...newSchedule, breakTime: parseInt(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                        min="0"
                      />
                    </div>
                  </>
                )}

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

                <div className="flex space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowScheduleModal(false);
                      resetScheduleForm();
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    建立班表
                  </button>
                </div>
              </form>
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
                                const template = SHIFT_TEMPLATES[shiftType as keyof typeof SHIFT_TEMPLATES];
                                setNewTemplate({
                                  ...newTemplate,
                                  [day]: {
                                    shiftType,
                                    startTime: template.startTime,
                                    endTime: template.endTime,
                                    breakTime: template.breakTime
                                  }
                                });
                              }}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                            >
                              {Object.entries(SHIFT_TYPE_LABELS).map(([key, label]) => (
                                <option key={key} value={key}>{label}</option>
                              ))}
                            </select>
                          </div>

                          {(daySchedule.shiftType === 'A' || daySchedule.shiftType === 'B' || daySchedule.shiftType === 'C') && (
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
                                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
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
                                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
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
                                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                                  min="0"
                                />
                              </div>
                            </>
                          )}
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
                  
                  {/* 搜索框 */}
                  <div className="mb-4">
                    <input
                      type="text"
                      value={employeeSearch}
                      onChange={(e) => setEmployeeSearch(e.target.value)}
                      placeholder="搜索員工 (員編、姓名、部門)"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black text-sm"
                    />
                  </div>

                  {/* 全選按鈕 */}
                  <div className="mb-3">
                    <button
                      type="button"
                      onClick={handleSelectAllEmployees}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      {selectedEmployees.length === filteredEmployees.length ? '取消全選' : '全選'}
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
    </AuthenticatedLayout>
  );
}
