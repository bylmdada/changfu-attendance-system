'use client';

import { useState, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Download, Clock, User, RefreshCw } from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';

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

const SHIFT_LABELS: Record<string, string> = {
  'A': 'A班 (07:30-16:30)',
  'B': 'B班 (08:00-17:00)', 
  'C': 'C班 (08:30-17:30)',
  'NH': 'NH (國定假日)',
  'RD': 'RD (例假)',
  'rd': 'rd (休息日)',
  'FDL': 'FDL (全日請假)',
  'OFF': 'OFF (休假)'
};

const SHIFT_COLORS: Record<string, string> = {
  'A': 'bg-blue-100 text-blue-800',
  'B': 'bg-green-100 text-green-800',
  'C': 'bg-purple-100 text-purple-800',
  'NH': 'bg-indigo-100 text-indigo-800',
  'RD': 'bg-gray-100 text-gray-800',
  'rd': 'bg-gray-100 text-gray-800',
  'FDL': 'bg-yellow-100 text-yellow-800',
  'OFF': 'bg-red-100 text-red-800'
};

export default function MySchedulePage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Toast 顯示函數
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    // 設定頁面標題
    document.title = '我的班表 - 長福會考勤系統';
    fetchUser();
  }, []);

  useEffect(() => {
    if (user) {
      fetchSchedules();
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

  const exportToPDF = async () => {
    try {
      const response = await fetch('/api/my-schedules/export-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          year: selectedYear,
          month: selectedMonth,
          schedules: schedules,
          user: {
            employeeId: user?.employee?.employeeId || '未知',
            name: user?.employee?.name || '未知員工',
            department: user?.employee?.department || '未知部門'
          }
        })
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

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month, 0).getDate();
  };

  const getScheduleForDate = (date: string) => {
    return schedules.find(schedule => schedule.workDate === date);
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
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
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
                onClick={exportToPDF}
                className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors flex items-center"
              >
                <Download className="w-5 h-5 mr-2" />
                匯出班表
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

          {/* 統計資訊 */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="text-blue-600 text-sm font-medium">總工作天數</div>
              <div className="text-2xl font-bold text-blue-900">
                {schedules.filter(s => !['RD', 'rd', 'OFF', 'FDL'].includes(s.shiftType)).length}
              </div>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <div className="text-green-600 text-sm font-medium">A班次數</div>
              <div className="text-2xl font-bold text-green-900">
                {schedules.filter(s => s.shiftType === 'A').length}
              </div>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg">
              <div className="text-purple-600 text-sm font-medium">B班次數</div>
              <div className="text-2xl font-bold text-purple-900">
                {schedules.filter(s => s.shiftType === 'B').length}
              </div>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="text-gray-600 text-sm font-medium">休息天數</div>
              <div className="text-2xl font-bold text-gray-900">
                {schedules.filter(s => ['RD', 'rd', 'OFF'].includes(s.shiftType)).length}
              </div>
            </div>
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
                return <div key={`empty-${index}`} className="p-3 h-24"></div>;
              }
              
              const dateStr = formatDate(day);
              const schedule = getScheduleForDate(dateStr);
              const isToday = dateStr === new Date().toISOString().split('T')[0];
              
              return (
                <div
                  key={dateStr}
                  className={`p-3 h-24 border rounded-lg ${
                    isToday ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'
                  } hover:shadow-md transition-shadow`}
                >
                  <div className={`text-sm font-medium ${isToday ? 'text-blue-600' : 'text-gray-900'}`}>
                    {day}
                  </div>
                  {schedule && (
                    <div className="mt-1">
                      <div className={`text-xs px-2 py-1 rounded-full ${SHIFT_COLORS[schedule.shiftType] || 'bg-gray-100 text-gray-800'}`}>
                        {SHIFT_LABELS[schedule.shiftType] || `${schedule.shiftType}班`}
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
                    開始時間
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    結束時間
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    休息時間
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {schedules.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                      本月暫無班表記錄
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
                            {SHIFT_LABELS[schedule.shiftType] || `${schedule.shiftType}班`}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {schedule.startTime || '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {schedule.endTime || '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {schedule.breakTime ? `${schedule.breakTime}分鐘` : '-'}
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
            {/* 應班工時計算 */}
            <div className="bg-blue-50 rounded-lg p-4">
              <h4 className="font-medium text-blue-900 mb-3">應班工時</h4>
              <div className="text-sm text-blue-800 space-y-1">
                <div className="flex justify-between">
                  <span>本月總時數：</span>
                  <span className="font-medium">{(() => {
                    const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);
                    const standardDailyHours = 8;
                    return daysInMonth * standardDailyHours;
                  })()} 小時</span>
                </div>
                <div className="flex justify-between">
                  <span>法定假日：</span>
                  <span className="font-medium text-red-600">-{(() => {
                    const nhDays = schedules.filter(s => s.shiftType === 'NH').length;
                    return nhDays * 8;
                  })()} 小時</span>
                </div>
                <div className="flex justify-between">
                  <span>例假休息：</span>
                  <span className="font-medium text-red-600">-{(() => {
                    const rdDays = schedules.filter(s => ['RD', 'rd'].includes(s.shiftType)).length;
                    return rdDays * 8;
                  })()} 小時</span>
                </div>
                <div className="border-t border-blue-200 pt-2 mt-2">
                  <div className="flex justify-between font-bold">
                    <span>應班工時：</span>
                    <span>{(() => {
                      const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);
                      const nhDays = schedules.filter(s => s.shiftType === 'NH').length;
                      const rdDays = schedules.filter(s => ['RD', 'rd'].includes(s.shiftType)).length;
                      const shouldWorkHours = (daysInMonth - nhDays - rdDays) * 8;
                      return shouldWorkHours;
                    })()} 小時</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 實班工時計算 */}
            <div className="bg-green-50 rounded-lg p-4">
              <h4 className="font-medium text-green-900 mb-3">實班工時</h4>
              <div className="text-sm text-green-800 space-y-1">
                <div className="flex justify-between">
                  <span>A班工時：</span>
                  <span className="font-medium">{(() => {
                    const aDays = schedules.filter(s => s.shiftType === 'A').length;
                    return aDays * 8; // A班8小時
                  })()} 小時 ({schedules.filter(s => s.shiftType === 'A').length}天)</span>
                </div>
                <div className="flex justify-between">
                  <span>B班工時：</span>
                  <span className="font-medium">{(() => {
                    const bDays = schedules.filter(s => s.shiftType === 'B').length;
                    return bDays * 8; // B班8小時
                  })()} 小時 ({schedules.filter(s => s.shiftType === 'B').length}天)</span>
                </div>
                <div className="flex justify-between">
                  <span>C班工時：</span>
                  <span className="font-medium">{(() => {
                    const cDays = schedules.filter(s => s.shiftType === 'C').length;
                    return cDays * 8; // C班8小時
                  })()} 小時 ({schedules.filter(s => s.shiftType === 'C').length}天)</span>
                </div>
                <div className="flex justify-between">
                  <span>夜班工時：</span>
                  <span className="font-medium">{(() => {
                    const nhWorkDays = schedules.filter(s => s.shiftType === 'NH' && s.startTime && s.endTime).length;
                    return nhWorkDays * 8; // 夜班工作時8小時
                  })()} 小時 ({schedules.filter(s => s.shiftType === 'NH' && s.startTime && s.endTime).length}天)</span>
                </div>
                <div className="flex justify-between">
                  <span>請假扣時：</span>
                  <span className="font-medium text-red-600">-{(() => {
                    const leaveDays = schedules.filter(s => s.shiftType === 'FDL').length;
                    return leaveDays * 8;
                  })()} 小時 ({schedules.filter(s => s.shiftType === 'FDL').length}天)</span>
                </div>
                <div className="border-t border-green-200 pt-2 mt-2">
                  <div className="flex justify-between font-bold">
                    <span>實班工時：</span>
                    <span>{(() => {
                      const aDays = schedules.filter(s => s.shiftType === 'A').length;
                      const bDays = schedules.filter(s => s.shiftType === 'B').length;
                      const cDays = schedules.filter(s => s.shiftType === 'C').length;
                      const nhWorkDays = schedules.filter(s => s.shiftType === 'NH' && s.startTime && s.endTime).length;
                      const leaveDays = schedules.filter(s => s.shiftType === 'FDL').length;
                      const actualWorkHours = (aDays + bDays + cDays + nhWorkDays) * 8 - (leaveDays * 8);
                      return actualWorkHours;
                    })()} 小時</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 積假計算 */}
            <div className="bg-yellow-50 rounded-lg p-4">
              <h4 className="font-medium text-yellow-900 mb-3">積假計算</h4>
              <div className="text-sm text-yellow-800 space-y-1">
                <div className="flex justify-between">
                  <span>上月積假：</span>
                  <span className="font-medium">0 小時</span>
                </div>
                <div className="flex justify-between">
                  <span>本月應班：</span>
                  <span className="font-medium text-blue-600">+{(() => {
                    const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);
                    const nhDays = schedules.filter(s => s.shiftType === 'NH').length;
                    const rdDays = schedules.filter(s => ['RD', 'rd'].includes(s.shiftType)).length;
                    const shouldWorkHours = (daysInMonth - nhDays - rdDays) * 8;
                    return shouldWorkHours;
                  })()} 小時</span>
                </div>
                <div className="flex justify-between">
                  <span>實際出勤：</span>
                  <span className="font-medium text-red-600">-{(() => {
                    const aDays = schedules.filter(s => s.shiftType === 'A').length;
                    const bDays = schedules.filter(s => s.shiftType === 'B').length;
                    const cDays = schedules.filter(s => s.shiftType === 'C').length;
                    const nhWorkDays = schedules.filter(s => s.shiftType === 'NH' && s.startTime && s.endTime).length;
                    const actualWorkHours = (aDays + bDays + cDays + nhWorkDays) * 8;
                    return actualWorkHours;
                  })()} 小時</span>
                </div>
                <div className="flex justify-between">
                  <span>請假時數：</span>
                  <span className="font-medium text-red-600">-{(() => {
                    const leaveDays = schedules.filter(s => s.shiftType === 'FDL').length;
                    return leaveDays * 8;
                  })()} 小時</span>
                </div>
                <div className="flex justify-between">
                  <span>休假時數：</span>
                  <span className="font-medium">{(() => {
                    const offDays = schedules.filter(s => s.shiftType === 'OFF').length;
                    return offDays * 8;
                  })()} 小時 ({schedules.filter(s => s.shiftType === 'OFF').length}天)</span>
                </div>
                <div className="flex justify-between">
                  <span>補休使用：</span>
                  <span className="font-medium">0 小時</span>
                </div>
                <div className="flex justify-between">
                  <span>加班時數：</span>
                  <span className="font-medium text-green-600">+{(() => {
                    const workDays = schedules.filter(s => ['A', 'B', 'C'].includes(s.shiftType)).length;
                    const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);
                    const nhDays = schedules.filter(s => s.shiftType === 'NH').length;
                    const rdDays = schedules.filter(s => ['RD', 'rd'].includes(s.shiftType)).length;
                    const shouldWorkDays = daysInMonth - nhDays - rdDays;
                    const overtimeHours = Math.max(0, (workDays - shouldWorkDays) * 8);
                    return overtimeHours;
                  })()} 小時</span>
                </div>
                <div className="border-t border-yellow-200 pt-2 mt-2">
                  <div className="flex justify-between font-bold">
                    <span>本月積假餘額：</span>
                    <span>{(() => {
                      const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);
                      const nhDays = schedules.filter(s => s.shiftType === 'NH').length;
                      const rdDays = schedules.filter(s => ['RD', 'rd'].includes(s.shiftType)).length;
                      const shouldWorkHours = (daysInMonth - nhDays - rdDays) * 8;
                      
                      const aDays = schedules.filter(s => s.shiftType === 'A').length;
                      const bDays = schedules.filter(s => s.shiftType === 'B').length;
                      const cDays = schedules.filter(s => s.shiftType === 'C').length;
                      const nhWorkDays = schedules.filter(s => s.shiftType === 'NH' && s.startTime && s.endTime).length;
                      const actualWorkHours = (aDays + bDays + cDays + nhWorkDays) * 8;
                      
                      const leaveDays = schedules.filter(s => s.shiftType === 'FDL').length;
                      const leaveHours = leaveDays * 8;
                      
                      const balance = shouldWorkHours - actualWorkHours - leaveHours;
                      return balance > 0 ? `+${balance}` : balance;
                    })()} 小時</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 統計說明 */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="font-medium text-gray-900 mb-2">說明</h4>
              <div className="text-xs text-gray-600 space-y-1">
                <p>• 應班工時 = 本月總時數 - 法定假日 - 例假休息日</p>
                <p>• 實班工時 = 實際出勤班次工時總計（扣除請假）</p>
                <p>• 積假計算基於應班與實班工時差額進行統計</p>
                <p>• A班/B班/C班均以8小時計算，夜班依實際工時計算</p>
                <p>• 數據僅供參考，實際薪資計算以人事部門為準</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Toast 通知 */}
      {toast && (
        <div className={`fixed bottom-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'} text-white`}>
          {toast.message}
        </div>
      )}
    </AuthenticatedLayout>
  );
}
