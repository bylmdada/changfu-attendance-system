'use client';

import { useState, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Download, Clock, User, RefreshCw, Gift, Printer } from 'lucide-react';
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

// 班表確認資料
interface ScheduleConfirmData {
  status: 'NOT_RELEASED' | 'PENDING' | 'CONFIRMED' | 'NEED_RECONFIRM' | 'EXPIRED';
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
  } | null;
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
  'NH': 'bg-red-100 text-red-800',
  'RD': 'bg-gray-100 text-gray-800',
  'rd': 'bg-gray-100 text-gray-800',
  'FDL': 'bg-yellow-100 text-yellow-800',
  'OFF': 'bg-orange-100 text-orange-800'
};

export default function MySchedulePage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
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

  // 加班工時狀態
  const [overtimeHours, setOvertimeHours] = useState(0);

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
      fetchHolidayStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedYear, selectedMonth]);

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
          // 計算當月已核准的加班總時數
          const totalHours = data.overtimeRequests.reduce(
            (sum: number, req: { totalHours: number }) => sum + req.totalHours, 
            0
          );
          setOvertimeHours(totalHours);
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
      
      const response = await fetch('/api/schedule-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'confirm',
          yearMonth,
          comment: confirmComment,
          password: confirmPassword // 新增密碼驗證
        })
      });

      const data = await response.json();

      if (data.success) {
        showToast('success', '班表確認成功');
        setShowConfirmModal(false);
        setConfirmComment('');
        setConfirmPassword('');
        fetchConfirmStatus();
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

  // 列印月曆班表
  const printCalendar = () => {
    const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);
    const firstDay = new Date(selectedYear, selectedMonth - 1, 1);
    const startDay = firstDay.getDay();
    const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
    
    // 統計資料
    const workDays = schedules.filter(s => !['NH', 'RD', 'rd', 'OFF', 'FDL', 'TD'].includes(s.shiftType)).length;
    const restDays = schedules.filter(s => ['RD', 'rd', 'OFF'].includes(s.shiftType)).length;
    const shiftA = schedules.filter(s => s.shiftType === 'A').length;
    const shiftB = schedules.filter(s => s.shiftType === 'B').length;
    const shiftC = schedules.filter(s => s.shiftType === 'C').length;

    // 生成日曆 HTML
    let calendarCells = '';
    for (let i = 0; i < startDay; i++) {
      calendarCells += '<div class="cell empty"></div>';
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${selectedYear}-${selectedMonth.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      const schedule = schedules.find(s => s.workDate === dateStr);
      const shiftType = schedule?.shiftType || '';
      const shiftLabel = SHIFT_LABELS[shiftType] || shiftType;
      const isRest = ['RD', 'rd', 'OFF', 'NH'].includes(shiftType);
      calendarCells += `
        <div class="cell ${isRest ? 'rest' : 'work'}">
          <div class="day">${day}</div>
          ${shiftType ? `<div class="shift ${shiftType.toLowerCase()}">${shiftLabel.split(' ')[0]}</div>` : ''}
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
  <title>${selectedYear}年${selectedMonth}月班表 - ${user?.employee?.name || '員工'}</title>
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
    <p>${user?.employee?.name || '員工'} | ${user?.employee?.department || '部門'} | 員工編號: ${user?.employee?.employeeId || '-'}</p>
  </div>
  <div class="info">
    <div>製表日期：${new Date().toLocaleDateString('zh-TW')}</div>
    <div class="stats">
      <div class="stat"><div class="stat-value">${workDays}</div><div class="stat-label">工作日</div></div>
      <div class="stat"><div class="stat-value">${restDays}</div><div class="stat-label">休息日</div></div>
      <div class="stat"><div class="stat-value">${shiftA}</div><div class="stat-label">A班</div></div>
      <div class="stat"><div class="stat-value">${shiftB}</div><div class="stat-label">B班</div></div>
      <div class="stat"><div class="stat-value">${shiftC}</div><div class="stat-label">C班</div></div>
    </div>
  </div>
  <div class="calendar">
    ${weekdayNames.map(d => `<div class="weekday">${d}</div>`).join('')}
    ${calendarCells}
  </div>
  <div class="legend">
    <div class="legend-title">📋 班別說明</div>
    <div class="legend-items">
      <div class="legend-item"><span class="legend-badge a">A班</span> 07:30-16:30</div>
      <div class="legend-item"><span class="legend-badge b">B班</span> 08:00-17:00</div>
      <div class="legend-item"><span class="legend-badge c">C班</span> 08:30-17:30</div>
      <div class="legend-item"><span class="legend-badge nh">NH</span> 國定假日</div>
      <div class="legend-item"><span class="legend-badge rd">RD</span> 例假</div>
      <div class="legend-item"><span class="legend-badge rd">rd</span> 休息日</div>
      <div class="legend-item"><span class="legend-badge off">OFF</span> 休假</div>
      <div class="legend-item"><span class="legend-badge fdl">FDL</span> 全日請假</div>
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

          {/* 國定假日年度統計 */}
          {holidayStats && (
            <div className="mb-6 p-4 bg-gradient-to-r from-red-50 to-orange-50 rounded-lg border border-red-200">
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
                    className="bg-gradient-to-r from-green-500 to-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${holidayStats.progress}%` }}
                  ></div>
                </div>
              </div>
            </div>
          )}

          {/* 統計資訊 */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="text-blue-600 text-sm font-medium">總工作天數</div>
              <div className="text-2xl font-bold text-blue-900">
                {schedules.filter(s => !['NH', 'RD', 'rd', 'OFF', 'FDL', 'TD'].includes(s.shiftType)).length}
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
                        <div className="font-medium">{SHIFT_LABELS[schedule.shiftType] || schedule.shiftType}</div>
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
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {schedules.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                      本月暫無班表記錄
                    </td>
                  </tr>
                ) : (
                  schedules.map((schedule) => {
                    const date = new Date(schedule.workDate);
                    const weekday = weekdays[date.getDay()];
                    const isRestShift = ['NH', 'RD', 'rd', 'OFF', 'FDL', 'TD'].includes(schedule.shiftType);
                    
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
                          {isRestShift 
                            ? '休息' 
                            : (schedule.startTime && schedule.endTime 
                                ? `${schedule.startTime}-${schedule.endTime}` 
                                : '-')}
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
                  <span>國定假日(NH)：</span>
                  <span className="font-medium text-red-600">-{(() => {
                    const nhDays = schedules.filter(s => s.shiftType === 'NH').length;
                    return nhDays * 8;
                  })()} 小時</span>
                </div>
                <div className="flex justify-between">
                  <span>例假日(RD) + 休息日(rd)：</span>
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
                  <span>國定假日出勤：</span>
                  <span className="font-medium">{(() => {
                    // NH 有出勤：必須有實際工作時間（非空字串）
                    const nhWorkDays = schedules.filter(s => 
                      s.shiftType === 'NH' && 
                      s.startTime && s.startTime.trim() !== '' && 
                      s.endTime && s.endTime.trim() !== ''
                    ).length;
                    return nhWorkDays * 8;
                  })()} 小時 ({schedules.filter(s => 
                    s.shiftType === 'NH' && 
                    s.startTime && s.startTime.trim() !== '' && 
                    s.endTime && s.endTime.trim() !== ''
                  ).length}天)</span>
                </div>
                <div className="flex justify-between">
                  <span>加班工時：</span>
                  <span className="font-medium text-blue-600">+{overtimeHours} 小時</span>
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
                      const nhWorkDays = schedules.filter(s => 
                        s.shiftType === 'NH' && 
                        s.startTime && s.startTime.trim() !== '' && 
                        s.endTime && s.endTime.trim() !== ''
                      ).length;
                      const leaveDays = schedules.filter(s => s.shiftType === 'FDL').length;
                      const actualWorkHours = (aDays + bDays + cDays + nhWorkDays) * 8 + overtimeHours - (leaveDays * 8);
                      return actualWorkHours;
                    })()} 小時</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 補休餘額 */}
            <div className="bg-yellow-50 rounded-lg p-4">
              <h4 className="font-medium text-yellow-900 mb-3">補休餘額</h4>
              <div className="text-sm text-yellow-800 space-y-1">
                <div className="flex justify-between">
                  <span>上月餘額：</span>
                  <span className="font-medium">0 小時</span>
                </div>
                <div className="flex justify-between">
                  <span>本月加班轉入：</span>
                  <span className="font-medium text-green-600">+{overtimeHours} 小時</span>
                </div>
                <div className="flex justify-between">
                  <span>本月使用(OFF)：</span>
                  <span className="font-medium text-red-600">-{(() => {
                    const offDays = schedules.filter(s => s.shiftType === 'OFF').length;
                    return offDays * 8;
                  })()} 小時 ({schedules.filter(s => s.shiftType === 'OFF').length}天)</span>
                </div>
                <div className="border-t border-yellow-200 pt-2 mt-2">
                  <div className="flex justify-between font-bold">
                    <span>本月餘額：</span>
                    <span>{(() => {
                      const offDays = schedules.filter(s => s.shiftType === 'OFF').length;
                      const usedHours = offDays * 8;
                      const balance = overtimeHours - usedHours;
                      return balance >= 0 ? balance : balance;
                    })()} 小時</span>
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
                  <p>• 應班工時 = (月曆天數 - RD - rd - NH) × 8</p>
                  <p>• 加班工時 = 已核准加班申請時數</p>
                  <p>• 實際工時 = 排班工時 + 加班 - 請假</p>
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
                    <span className="font-medium">{confirmData.scheduleSummary.workDays}天</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">休息天數：</span>
                    <span className="font-medium">{confirmData.scheduleSummary.restDays}天</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">班次分布：</span>
                    <span className="font-medium">
                      A班{confirmData.scheduleSummary.shiftA}天、
                      B班{confirmData.scheduleSummary.shiftB}天
                      {confirmData.scheduleSummary.shiftC > 0 && `、C班${confirmData.scheduleSummary.shiftC}天`}
                    </span>
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
