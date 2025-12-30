'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Users, Clock, Calendar, DollarSign, LogOut, Timer, BarChart3, UserPlus, FileText, Key, Megaphone, X, AlertTriangle, ShoppingCart, Heart, Cloud, Wallet } from 'lucide-react';
import ResponsiveSidebar from '@/components/ResponsiveSidebar';

interface Announcement {
  id: number;
  title: string;
  content: string;
  priority: 'HIGH' | 'NORMAL' | 'LOW';
  category?: 'PERSONNEL' | 'POLICY' | 'EVENT' | 'SYSTEM' | 'BENEFITS' | 'URGENT' | 'GENERAL';
  isPublished: boolean;
  publishedAt?: string;
  expiryDate?: string;
  publisher?: {
    name: string;
    department: string;
  };
}

export default function DashboardPage() {
  const [user, setUser] = useState<{
    id: number;
    username: string;
    role: string;
    employee: {
      id: number;
      employeeId: string;
      name: string;
      department: string;
      position: string;
    };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [todayStatus, setTodayStatus] = useState<{
    hasClockIn: boolean;
    hasClockOut: boolean;
    today?: {
      clockInTime: string;
      clockOutTime: string;
    };
  } | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissedAnnouncements, setDismissedAnnouncements] = useState<number[]>([]);
  const [dashboardStats, setDashboardStats] = useState<{
    pendingLeaveRequests: number;
    pendingOvertimeRequests: number;
    pendingShiftExchanges: number;
    pendingMissedClock: number;
    totalEmployees?: number;
    todayAttendance?: number;
    todayLate?: number;
    todayAbsent?: number;
  }>({
    pendingLeaveRequests: 0,
    pendingOvertimeRequests: 0,
    pendingShiftExchanges: 0,
    pendingMissedClock: 0
  });

  // 補休餘額狀態
  const [compLeaveBalance, setCompLeaveBalance] = useState<{
    availableBalance: number;
    pendingEarn: number;
    pendingUse: number;
  } | null>(null);

  // 年假餘額狀態（天數）
  const [annualLeaveBalance, setAnnualLeaveBalance] = useState<number | null>(null);

  // 班表管理權限狀態（員工被授權管理的據點）
  const [hasSchedulePermission, setHasSchedulePermission] = useState(false);

  // 班表確認狀態（待確認提醒）
  const [scheduleConfirmStatus, setScheduleConfirmStatus] = useState<{
    needsConfirmation: boolean;
    yearMonth: string;
    status: string;
  } | null>(null);

  useEffect(() => {
    // 設定頁面標題
    document.title = '儀表板 - 長福會考勤系統';
    
    checkAuth();
    loadTodayStatus();
    loadAnnouncements();
    
    // 從 localStorage 讀取已關閉的公告
    const dismissed = localStorage.getItem('dismissedAnnouncements');
    if (dismissed) {
      setDismissedAnnouncements(JSON.parse(dismissed));
    }
  }, []);

  // 當用戶數據載入後，載入統計數據
  useEffect(() => {
    if (user) {
      loadDashboardStats();
      loadCompLeaveBalance();
      loadAnnualLeaveBalance();
      loadScheduleConfirmStatus(); // 載入班表確認狀態
      // 員工可能有班表管理權限
      if (user.role !== 'ADMIN' && user.role !== 'HR' && user.employee?.id) {
        loadSchedulePermission(user.employee.id);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const checkAuth = async () => {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include'
      });
      if (response.ok) {
        const userData = await response.json();
        // 確保正確設置用戶數據
        if (userData && userData.user) {
          setUser(userData.user);
        } else if (userData && userData.id) {
          // 如果 API 返回的是直接的用戶對象（向後兼容）
          setUser(userData);
        }
      } else {
        console.error('Auth check failed:', response.status);
        window.location.href = '/login';
      }
    } catch (error) {
      console.error('Auth check error:', error);
      window.location.href = '/login';
    } finally {
      setLoading(false);
    }
  };

  const loadTodayStatus = async () => {
    try {
      const response = await fetch('/api/attendance/clock', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setTodayStatus(data);
      } else if (response.status === 401 || response.status === 403) {
        // 如果是身份驗證錯誤，不要顯示錯誤，因為用戶可能還沒登入
        console.warn('Authentication required for attendance clock API');
      }
    } catch (error) {
      console.error('載入打卡狀態失敗:', error);
    }
  };

  const loadDashboardStats = async () => {
    try {
      // 載入待審核請假申請數量
      const leaveResponse = await fetch('/api/leave-requests?status=PENDING', {
        credentials: 'include'
      });
      
      // 載入待審核加班申請數量
      const overtimeResponse = await fetch('/api/overtime-requests?status=PENDING', {
        credentials: 'include'
      });

      // 載入待審核調班申請數量
      const shiftExchangeResponse = await fetch('/api/shift-exchanges?status=PENDING', {
        credentials: 'include'
      });

      // 載入待審核忘打卡申請數量
      const missedClockResponse = await fetch('/api/missed-clock-requests?status=PENDING', {
        credentials: 'include'
      });

      let pendingLeave = 0;
      let pendingOvertime = 0;
      let pendingShiftExchange = 0;
      let pendingMissedClock = 0;
      let totalEmp = undefined;
      let todayAtt = undefined;
      let todayLate = undefined;
      let todayAbsent = undefined;

      if (leaveResponse.ok) {
        const leaveData = await leaveResponse.json();
        pendingLeave = leaveData.leaveRequests?.length || 0;
      }

      if (overtimeResponse.ok) {
        const overtimeData = await overtimeResponse.json();
        pendingOvertime = overtimeData.overtimeRequests?.length || 0;
      }

      if (shiftExchangeResponse.ok) {
        const shiftExchangeData = await shiftExchangeResponse.json();
        pendingShiftExchange = Array.isArray(shiftExchangeData) ? 
          shiftExchangeData.filter(req => req.status === 'PENDING').length : 0;
      }

      if (missedClockResponse.ok) {
        const missedClockData = await missedClockResponse.json();
        pendingMissedClock = missedClockData.requests?.filter((req: { status: string }) => req.status === 'PENDING').length || 0;
      }

      // 管理員可以看到更多統計
      if (user?.role === 'ADMIN' || user?.role === 'HR') {
        // 載入總員工數
        const employeeResponse = await fetch('/api/employees', {
          credentials: 'include'
        });
        if (employeeResponse.ok) {
          const employeeData = await employeeResponse.json();
          totalEmp = employeeData.employees?.length || 0;
        }

        // 載入今日出勤數據
        const attendanceResponse = await fetch('/api/attendance/today-summary', {
          credentials: 'include'
        });
        if (attendanceResponse.ok) {
          const attendanceData = await attendanceResponse.json();
          todayAtt = attendanceData.attendanceCount || 0;
          todayLate = attendanceData.lateCount || 0;
          todayAbsent = attendanceData.absentCount || 0;
        }
      }

      setDashboardStats({
        pendingLeaveRequests: pendingLeave,
        pendingOvertimeRequests: pendingOvertime,
        pendingShiftExchanges: pendingShiftExchange,
        pendingMissedClock: pendingMissedClock,
        totalEmployees: totalEmp,
        todayAttendance: todayAtt,
        todayLate: todayLate,
        todayAbsent: todayAbsent
      });
    } catch (error) {
      console.error('載入儀表板統計失敗:', error);
    }
  };

  // 載入補休餘額
  const loadCompLeaveBalance = async () => {
    try {
      const response = await fetch('/api/comp-leave/balance', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.balance) {
          setCompLeaveBalance({
            availableBalance: data.balance.availableBalance || 0,
            pendingEarn: data.balance.pendingEarn || 0,
            pendingUse: data.balance.pendingUse || 0
          });
        }
      }
    } catch (error) {
      console.error('載入補休餘額失敗:', error);
    }
  };

  // 載入年假餘額
  const loadAnnualLeaveBalance = async () => {
    try {
      const currentYear = new Date().getFullYear();
      const response = await fetch(`/api/annual-leaves?year=${currentYear}`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        if (data.annualLeaves && data.annualLeaves.length > 0) {
          // 取第一筆（應該是當前員工的）
          const leave = data.annualLeaves[0];
          // remainingDays 是天數
          setAnnualLeaveBalance(leave.remainingDays);
        } else {
          setAnnualLeaveBalance(0);
        }
      }
    } catch (error) {
      console.error('載入年假餘額失敗:', error);
    }
  };

  // 載入班表管理權限
  const loadSchedulePermission = async (employeeId: number) => {
    try {
      const response = await fetch(`/api/attendance-permissions/${employeeId}`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        if (data.permission?.scheduleManagement && data.permission.scheduleManagement.length > 0) {
          setHasSchedulePermission(true);
        }
      }
    } catch (error) {
      console.error('載入班表權限失敗:', error);
    }
  };

  // 載入班表確認狀態
  const loadScheduleConfirmStatus = async () => {
    try {
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
      const response = await fetch(`/api/schedule-confirmation?type=my-status&yearMonth=${yearMonth}`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        // 如果狀態是 PENDING、NEED_RECONFIRM 或 EXPIRED，則需要提醒
        const needsConfirm = ['PENDING', 'NEED_RECONFIRM', 'EXPIRED'].includes(data.status);
        setScheduleConfirmStatus({
          needsConfirmation: needsConfirm,
          yearMonth,
          status: data.status
        });
      }
    } catch (error) {
      console.error('載入班表確認狀態失敗:', error);
    }
  };

  const loadAnnouncements = async () => {

    try {
      console.log('🔄 載入公告推播...');
      const response = await fetch('/api/announcements', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        console.log('📋 收到公告數據:', data.announcements?.length || 0, '筆');
        
        if (data.announcements && data.announcements.length > 0) {
          // 顯示已發布且未過期的高優先級或緊急通知公告
          const importantAnnouncements = data.announcements.filter((ann: Announcement) => {
            const now = new Date();
            const isNotExpired = !ann.expiryDate || new Date(ann.expiryDate) > now;
            const isPublished = ann.isPublished;
            const isHighPriority = ann.priority === 'HIGH';
            const isUrgent = ann.category === 'URGENT';
            
            console.log('📢 公告篩選:', {
              title: ann.title,
              priority: ann.priority,
              category: ann.category,
              isPublished,
              isNotExpired,
              isHighPriority,
              isUrgent,
              shouldShow: isPublished && isNotExpired && (isHighPriority || isUrgent)
            });
            
            return isPublished && isNotExpired && (isHighPriority || isUrgent);
          });
          
          // 緊急通知排在最前面
          importantAnnouncements.sort((a: Announcement, b: Announcement) => {
            if (a.category === 'URGENT' && b.category !== 'URGENT') return -1;
            if (a.category !== 'URGENT' && b.category === 'URGENT') return 1;
            return 0;
          });
          
          console.log('✅ 符合推播條件的公告:', importantAnnouncements.length, '筆');
          setAnnouncements(importantAnnouncements);
        } else {
          console.log('📭 沒有收到公告數據');
          setAnnouncements([]);
        }
      } else {
        console.error('❌ 載入公告失敗:', response.status);
      }
    } catch (error) {
      console.error('💥 載入公告失敗:', error);
    }
  };

  const dismissAnnouncement = (announcementId: number) => {
    const newDismissed = [...dismissedAnnouncements, announcementId];
    setDismissedAnnouncements(newDismissed);
    localStorage.setItem('dismissedAnnouncements', JSON.stringify(newDismissed));
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    } catch (error) {
      console.error('登出失敗:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 響應式側邊欄 */}
      {user && <ResponsiveSidebar user={user} />}
      
      <nav className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              {/* 手機版留空間給側邊欄的漢堡按鈕 */}
              <div className="w-10 lg:hidden"></div>
              <Image
                src="/logo.png"
                alt="長福會考勤系統 Logo"
                width={32}
                height={32}
                className="object-contain"
                priority
              />
              <span className="ml-3 font-bold text-xl text-gray-900 hidden sm:block">長福會考勤系統</span>
              <span className="ml-2 font-bold text-lg text-gray-900 sm:hidden">考勤系統</span>
            </div>
            <div className="flex items-center space-x-2 sm:space-x-4">
              <div className="hidden md:block text-gray-700 font-medium text-base">
                歡迎，{user?.employee?.employeeId} {user?.employee?.name}
                <span className="ml-2 px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">
                  {user?.role === 'ADMIN' ? '管理員' : user?.role === 'HR' ? 'HR' : '員工'}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center space-x-1 bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg text-sm transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">登出</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* 主內容區 - 桌面版有側邊欄時需偏移 */}
      <div className="lg:pl-64 max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">儀表板</h1>
            <p className="mt-2 text-gray-600">歡迎使用長福會考勤管理系統</p>
          </div>
          
          {/* 今日打卡狀態 */}
          <div className="mb-8">
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-6 text-white">
              <h2 className="text-xl font-bold mb-4">今日打卡狀態</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white bg-opacity-30 rounded-lg p-4 border border-white border-opacity-20">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-blue-900 font-medium">上班打卡</p>
                      <p className={`text-2xl font-bold ${
                        todayStatus?.hasClockIn 
                          ? 'text-green-300 font-extrabold' 
                          : 'text-red-300'
                      }`}>
                        {todayStatus?.hasClockIn ? '✓ 已打卡' : '✗ 未打卡'}
                      </p>
                      {todayStatus?.today?.clockInTime && (
                        <p className="text-lg text-white font-bold">
                          {new Date(todayStatus.today.clockInTime).toLocaleTimeString('zh-TW', {
                            hour12: false,
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </p>
                      )}
                    </div>
                    <Clock className="w-8 h-8 text-blue-200" />
                  </div>
                </div>
                <div className="bg-white bg-opacity-30 rounded-lg p-4 border border-white border-opacity-20">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-blue-900 font-medium">下班打卡</p>
                      <p className={`text-2xl font-bold ${
                        todayStatus?.hasClockOut 
                          ? 'text-green-300 font-extrabold' 
                          : 'text-red-300'
                      }`}>
                        {todayStatus?.hasClockOut ? '✓ 已打卡' : '✗ 未打卡'}
                      </p>
                      {todayStatus?.today?.clockOutTime && (
                        <p className="text-lg text-white font-bold">
                          {new Date(todayStatus.today.clockOutTime).toLocaleTimeString('zh-TW', {
                            hour12: false,
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </p>
                      )}
                    </div>
                    <Timer className="w-8 h-8 text-blue-200" />
                  </div>
                </div>
              </div>
              <div className="mt-4">
                <a
                  href="/attendance"
                  className="inline-flex items-center bg-white text-blue-600 px-4 py-2 rounded-lg font-medium hover:bg-blue-50 transition-colors"
                >
                  <Clock className="w-4 h-4 mr-2" />
                  前往打卡
                </a>
              </div>
            </div>
          </div>

          {/* 重要公告推播 */}
          {announcements.filter(ann => !dismissedAnnouncements.includes(ann.id)).map((announcement) => (
            <div key={announcement.id} className="mb-6">
              <div className={`${announcement.category === 'URGENT' ? 'bg-red-100' : 'bg-red-50'} border-l-4 border-red-400 rounded-r-lg shadow-sm`}>
                <div className="flex items-start justify-between p-4">
                  <div className="flex items-start">
                    <div className="flex-shrink-0">
                      <AlertTriangle className="w-6 h-6 text-red-400" />
                    </div>
                    <div className="ml-3 flex-1">
                      <div className="flex items-center mb-2">
                        <h3 className="text-lg font-semibold text-red-800">
                          {announcement.title}
                        </h3>
                        <span className={`ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          announcement.category === 'URGENT' 
                            ? 'bg-red-200 text-red-900' 
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {announcement.category === 'URGENT' ? '🚨 緊急通知' : '重要公告'}
                        </span>
                      </div>
                      <p className="text-red-700 leading-relaxed mb-3">
                        {announcement.content}
                      </p>
                      <div className="flex items-center text-sm text-red-600">
                        <span>發布者：{announcement.publisher?.name ? `${announcement.publisher.name} - ${announcement.publisher.department}` : '未知發布者'}</span>
                        <span className="mx-2">•</span>
                        <span>
                          {announcement.publishedAt 
                            ? new Date(announcement.publishedAt).toLocaleDateString('zh-TW')
                            : new Date().toLocaleDateString('zh-TW')
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => dismissAnnouncement(announcement.id)}
                    className="flex-shrink-0 ml-4 text-red-400 hover:text-red-600 transition-colors"
                    title="關閉公告"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
          
          {/* 班表確認提醒 */}
          {scheduleConfirmStatus?.needsConfirmation && (
            <div className="mb-6">
              <div className="bg-orange-50 border-l-4 border-orange-400 rounded-r-lg shadow-sm">
                <div className="flex items-start justify-between p-4">
                  <div className="flex items-start">
                    <div className="flex-shrink-0">
                      <Calendar className="w-6 h-6 text-orange-400" />
                    </div>
                    <div className="ml-3 flex-1">
                      <div className="flex items-center mb-2">
                        <h3 className="text-lg font-semibold text-orange-800">
                          📋 班表待確認
                        </h3>
                        <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-200 text-orange-900">
                          {scheduleConfirmStatus.status === 'NEED_RECONFIRM' ? '🔄 需重新確認' : 
                           scheduleConfirmStatus.status === 'EXPIRED' ? '⚠️ 已逾期' : '⏳ 待確認'}
                        </span>
                      </div>
                      <p className="text-orange-700 leading-relaxed mb-3">
                        您尚未確認 {scheduleConfirmStatus.yearMonth.replace('-', '年')}月 的班表安排，請前往「我的班表」頁面完成確認，否則將無法打卡。
                      </p>
                      <a
                        href="/my-schedule"
                        className="inline-flex items-center bg-orange-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-orange-700 transition-colors text-sm"
                      >
                        <Calendar className="w-4 h-4 mr-2" />
                        前往確認班表
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {/* 員工權限顯示不同的統計卡片 */}
            {user?.role === 'ADMIN' || user?.role === 'HR' ? (
              <>
                {/* 管理員統計：整合式卡片 */}
                {/* 卡片1: 總員工數 | 今日出勤 */}
                <a href="/employees" className="bg-white overflow-hidden shadow rounded-lg hover:shadow-md transition-shadow cursor-pointer">
                  <div className="p-5">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 bg-blue-100 rounded-lg p-3">
                        <Users className="h-6 w-6 text-blue-600" />
                      </div>
                      <div className="ml-4 flex-1">
                        <dt className="text-sm font-medium text-gray-500">總員工數｜今日出勤</dt>
                        <dd className="text-lg font-bold text-gray-900">
                          {dashboardStats.totalEmployees ?? '--'} ｜ {dashboardStats.todayAttendance ?? '--'}
                        </dd>
                      </div>
                    </div>
                  </div>
                </a>

                {/* 卡片2: 今日遲到 | 缺勤 */}
                <a href="/attendance/records" className="bg-white overflow-hidden shadow rounded-lg hover:shadow-md transition-shadow cursor-pointer">
                  <div className="p-5">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 bg-red-100 rounded-lg p-3">
                        <AlertTriangle className="h-6 w-6 text-red-600" />
                      </div>
                      <div className="ml-4 flex-1">
                        <dt className="text-sm font-medium text-gray-500">今日遲到｜缺勤</dt>
                        <dd className="text-lg font-bold text-gray-900">
                          {dashboardStats.todayLate ?? '--'} ｜ {dashboardStats.todayAbsent ?? '--'}
                        </dd>
                      </div>
                    </div>
                  </div>
                </a>

                {/* 卡片3: 待審請假 | 調班 - 可分別點擊 */}
                <div className="bg-white overflow-hidden shadow rounded-lg">
                  <div className="p-5">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 bg-yellow-100 rounded-lg p-3">
                        <Calendar className="h-6 w-6 text-yellow-600" />
                      </div>
                      <div className="ml-4 flex-1">
                        <dt className="text-sm font-medium text-gray-500">待審請假｜調班</dt>
                        <dd className="text-lg font-bold text-gray-900 flex gap-1">
                          <a 
                            href="/leave-management" 
                            className="hover:text-yellow-600 hover:underline transition-colors"
                            title="點擊查看請假申請"
                          >
                            {dashboardStats.pendingLeaveRequests}
                          </a>
                          <span>｜</span>
                          <a 
                            href="/shift-exchange" 
                            className="hover:text-yellow-600 hover:underline transition-colors"
                            title="點擊查看調班申請"
                          >
                            {dashboardStats.pendingShiftExchanges}
                          </a>
                        </dd>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 卡片4: 待審加班 | 忘打卡 - 可分別點擊 */}
                <div className="bg-white overflow-hidden shadow rounded-lg">
                  <div className="p-5">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 bg-purple-100 rounded-lg p-3">
                        <Timer className="h-6 w-6 text-purple-600" />
                      </div>
                      <div className="ml-4 flex-1">
                        <dt className="text-sm font-medium text-gray-500">待審加班｜忘打卡</dt>
                        <dd className="text-lg font-bold text-gray-900 flex gap-1">
                          <a 
                            href="/overtime-management" 
                            className="hover:text-purple-600 hover:underline transition-colors"
                            title="點擊查看加班申請"
                          >
                            {dashboardStats.pendingOvertimeRequests}
                          </a>
                          <span>｜</span>
                          <a 
                            href="/missed-clock" 
                            className="hover:text-purple-600 hover:underline transition-colors"
                            title="點擊查看忘打卡申請"
                          >
                            {dashboardStats.pendingMissedClock}
                          </a>
                        </dd>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* 員工統計卡片 - 今日遲到 | 缺勤 */}
                <a href="/attendance/records" className="bg-white overflow-hidden shadow rounded-lg hover:shadow-md transition-shadow cursor-pointer">
                  <div className="p-5">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 bg-red-100 rounded-lg p-3">
                        <AlertTriangle className="h-6 w-6 text-red-600" />
                      </div>
                      <div className="ml-4 flex-1">
                        <dt className="text-sm font-medium text-gray-500">今日遲到｜缺勤</dt>
                        <dd className="text-lg font-bold text-gray-900">
                          {dashboardStats.todayLate ?? '--'} ｜ {dashboardStats.todayAbsent ?? '--'}
                        </dd>
                      </div>
                    </div>
                  </div>
                </a>

                {/* 員工統計卡片 - 待審請假 | 調班 */}
                <div className="bg-white overflow-hidden shadow rounded-lg">
                  <div className="p-5">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 bg-yellow-100 rounded-lg p-3">
                        <Calendar className="h-6 w-6 text-yellow-600" />
                      </div>
                      <div className="ml-4 flex-1">
                        <dt className="text-sm font-medium text-gray-500">待審請假｜調班</dt>
                        <dd className="text-lg font-bold text-gray-900 flex gap-1">
                          <a 
                            href="/leave-management" 
                            className="hover:text-yellow-600 hover:underline transition-colors"
                            title="點擊查看請假申請"
                          >
                            {dashboardStats.pendingLeaveRequests}
                          </a>
                          <span>｜</span>
                          <a 
                            href="/shift-exchange" 
                            className="hover:text-yellow-600 hover:underline transition-colors"
                            title="點擊查看調班申請"
                          >
                            {dashboardStats.pendingShiftExchanges}
                          </a>
                        </dd>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 員工統計卡片 - 待審加班 | 忘打卡 */}
                <div className="bg-white overflow-hidden shadow rounded-lg">
                  <div className="p-5">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 bg-purple-100 rounded-lg p-3">
                        <Timer className="h-6 w-6 text-purple-600" />
                      </div>
                      <div className="ml-4 flex-1">
                        <dt className="text-sm font-medium text-gray-500">待審加班｜忘打卡</dt>
                        <dd className="text-lg font-bold text-gray-900 flex gap-1">
                          <a 
                            href="/overtime-management" 
                            className="hover:text-purple-600 hover:underline transition-colors"
                            title="點擊查看加班申請"
                          >
                            {dashboardStats.pendingOvertimeRequests}
                          </a>
                          <span>｜</span>
                          <a 
                            href="/missed-clock" 
                            className="hover:text-purple-600 hover:underline transition-colors"
                            title="點擊查看忘打卡申請"
                          >
                            {dashboardStats.pendingMissedClock}
                          </a>
                        </dd>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 剩餘假期卡片（特休 + 補休） */}
                <div className="bg-white overflow-hidden shadow rounded-lg">
                  <div className="p-5">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 bg-green-100 rounded-lg p-3">
                        <Calendar className="h-6 w-6 text-green-600" />
                      </div>
                      <div className="ml-4 flex-1">
                        <dt className="text-sm font-medium text-gray-500">
                          剩餘特休｜補休
                        </dt>
                        <dd className="text-lg font-bold text-gray-900 flex gap-1">
                          <a 
                            href="/annual-leaves" 
                            className="hover:text-green-600 hover:underline transition-colors"
                            title="點擊查看特休"
                          >
                            {annualLeaveBalance !== null ? `${annualLeaveBalance}天 (${annualLeaveBalance * 8}h)` : '--'}
                          </a>
                          <span>｜</span>
                          <a 
                            href="/leave-management" 
                            className="hover:text-green-600 hover:underline transition-colors"
                            title="點擊查看補休"
                          >
                            {compLeaveBalance?.availableBalance !== undefined ? `${Math.floor(compLeaveBalance.availableBalance / 8)}天 (${compLeaveBalance.availableBalance}h)` : '--'}
                          </a>
                        </dd>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>



          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">系統功能</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              
              {/* ======== 1. 考勤相關 ======== */}
              <a href="/attendance" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                <Clock className="h-8 w-8 text-blue-600 mb-2 group-hover:scale-110 transition-transform" />
                <h3 className="font-medium text-gray-900">打卡管理</h3>
                <p className="text-sm text-gray-500">上下班打卡、考勤記錄</p>
              </a>
              
              <a href="/attendance/records" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                <BarChart3 className="h-8 w-8 text-green-600 mb-2 group-hover:scale-110 transition-transform" />
                <h3 className="font-medium text-gray-900">考勤記錄</h3>
                <p className="text-sm text-gray-500">查看歷史考勤記錄</p>
              </a>

              <a href="/missed-clock" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                <Clock className="h-8 w-8 text-red-600 mb-2 group-hover:scale-110 transition-transform" />
                <h3 className="font-medium text-gray-900">忘打卡管理</h3>
                <p className="text-sm text-gray-500">申請忘打卡、補登記錄</p>
              </a>

              {/* ======== 2. 班表相關 ======== */}
              <a href="/my-schedule" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                <Calendar className="h-8 w-8 text-indigo-600 mb-2 group-hover:scale-110 transition-transform" />
                <h3 className="font-medium text-gray-900">個人班表查詢</h3>
                <p className="text-sm text-gray-500">查看個人班表安排</p>
              </a>

              {(user?.role === 'ADMIN' || user?.role === 'HR' || hasSchedulePermission) && (
                <a href="/schedule-management" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                  <Calendar className="h-8 w-8 text-blue-600 mb-2 group-hover:scale-110 transition-transform" />
                  <h3 className="font-medium text-gray-900">班表管理</h3>
                  <p className="text-sm text-gray-500">{hasSchedulePermission && user?.role !== 'ADMIN' && user?.role !== 'HR' ? '管理授權據點班表' : '員工班表、班別安排'}</p>
                </a>
              )}

              <a href="/shift-exchange" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                <Calendar className="h-8 w-8 text-purple-600 mb-2 group-hover:scale-110 transition-transform" />
                <h3 className="font-medium text-gray-900">調班管理</h3>
                <p className="text-sm text-gray-500">{user?.role === 'ADMIN' || user?.role === 'HR' ? '調班申請審核與管理' : '申請調班及查看審核狀態'}</p>
              </a>

              {/* ======== 3. 請假/加班相關 ======== */}
              <a href="/leave-management" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                <Calendar className="h-8 w-8 text-yellow-600 mb-2 group-hover:scale-110 transition-transform" />
                <h3 className="font-medium text-gray-900">請假管理</h3>
                <p className="text-sm text-gray-500">申請請假、查看記錄</p>
              </a>

              <a href="/overtime-management" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                <Timer className="h-8 w-8 text-blue-600 mb-2 group-hover:scale-110 transition-transform" />
                <h3 className="font-medium text-gray-900">加班管理</h3>
                <p className="text-sm text-gray-500">申請加班、時數管理</p>
              </a>

              {user?.role === 'ADMIN' && (
                <a href="/annual-leaves" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                  <Calendar className="h-8 w-8 text-orange-600 mb-2 group-hover:scale-110 transition-transform" />
                  <h3 className="font-medium text-gray-900">特休假管理</h3>
                  <p className="text-sm text-gray-500">設定員工特休假額度</p>
                </a>
              )}

              <a href="/my-annual-leave" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                <Calendar className="h-8 w-8 text-teal-600 mb-2 group-hover:scale-110 transition-transform" />
                <h3 className="font-medium text-gray-900">特休假查詢</h3>
                <p className="text-sm text-gray-500">
                  {(user?.role === 'ADMIN' || user?.role === 'HR') ? '查看全部員工特休狀況' : '查看個人特休假餘額'}
                </p>
              </a>

              <a href="/pension-contribution" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                <Wallet className="h-8 w-8 text-indigo-600 mb-2 group-hover:scale-110 transition-transform" />
                <h3 className="font-medium text-gray-900">勞退自提管理</h3>
                <p className="text-sm text-gray-500">
                  {(user?.role === 'ADMIN' || user?.role === 'HR') ? '審核員工自提申請' : '申請變更自提比例'}
                </p>
              </a>

              {/* ======== 4. 薪資相關 ======== */}
              {(user?.role !== 'ADMIN' && user?.role !== 'HR') && (
                <a href="/employee-payroll" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                  <DollarSign className="h-8 w-8 text-green-600 mb-2 group-hover:scale-110 transition-transform" />
                  <h3 className="font-medium text-gray-900">薪資查詢</h3>
                  <p className="text-sm text-gray-500">查看個人薪資紀錄</p>
                </a>
              )}

              {(user?.role === 'ADMIN' || user?.role === 'HR') && (
                <a href="/payroll" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                  <DollarSign className="h-8 w-8 text-green-600 mb-2 group-hover:scale-110 transition-transform" />
                  <h3 className="font-medium text-gray-900">薪資管理</h3>
                  <p className="text-sm text-gray-500">生成薪資記錄、查看明細</p>
                </a>
              )}

              {/* 薪資異議 */}
              <a href="/payroll-disputes" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                <AlertTriangle className="h-8 w-8 text-orange-600 mb-2 group-hover:scale-110 transition-transform" />
                <h3 className="font-medium text-gray-900">
                  {(user?.role === 'ADMIN' || user?.role === 'HR') ? '薪資異議管理' : '薪資異議申請'}
                </h3>
                <p className="text-sm text-gray-500">
                  {(user?.role === 'ADMIN' || user?.role === 'HR') ? '審核員工薪資異議申請' : '對薪資有疑問時可提出異議'}
                </p>
              </a>

              {(user?.role === 'ADMIN' || user?.role === 'HR') && (
                <a href="/payroll-statistics" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                  <BarChart3 className="h-8 w-8 text-purple-600 mb-2 group-hover:scale-110 transition-transform" />
                  <h3 className="font-medium text-gray-900">薪資統計</h3>
                  <p className="text-sm text-gray-500">薪資分析與趨勢統計</p>
                </a>
              )}

              {(user?.role === 'ADMIN' || user?.role === 'HR') && (
                <a href="/reports" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                  <FileText className="h-8 w-8 text-indigo-600 mb-2 group-hover:scale-110 transition-transform" />
                  <h3 className="font-medium text-gray-900">報表管理</h3>
                  <p className="text-sm text-gray-500">薪資條、稅金計算與匯出</p>
                </a>
              )}

              {/* ======== 5. 人員/眷屬管理 ======== */}
              {user?.role === 'ADMIN' && (
                <a href="/employees" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                  <UserPlus className="h-8 w-8 text-purple-600 mb-2 group-hover:scale-110 transition-transform" />
                  <h3 className="font-medium text-gray-900">員工管理</h3>
                  <p className="text-sm text-gray-500">管理員工資料</p>
                </a>
              )}

              <a href="/my-dependents" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                <Heart className="h-8 w-8 text-red-500 mb-2 group-hover:scale-110 transition-transform" />
                <h3 className="font-medium text-gray-900">我的眷屬</h3>
                <p className="text-sm text-gray-500">健保眷屬申請與管理</p>
              </a>

              {(user?.role === 'ADMIN' || user?.role === 'HR') && (
                <a href="/system-settings/health-insurance-dependents" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                  <Users className="h-8 w-8 text-pink-600 mb-2 group-hover:scale-110 transition-transform" />
                  <h3 className="font-medium text-gray-900">健保眷屬管理</h3>
                  <p className="text-sm text-gray-500">員工眷屬與申請審核</p>
                </a>
              )}

              {/* ======== 6. 其他管理功能 ======== */}
              <a href="/purchase-requests" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                <ShoppingCart className="h-8 w-8 text-purple-600 mb-2 group-hover:scale-110 transition-transform" />
                <h3 className="font-medium text-gray-900">請購管理</h3>
                <p className="text-sm text-gray-500">申請採購、查看審核狀態</p>
              </a>

              {/* 天災假管理 - 管理員 */}
              {(user?.role === 'ADMIN' || user?.role === 'HR') && (
                <a href="/disaster-day-off" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                  <Cloud className="h-8 w-8 text-cyan-600 mb-2 group-hover:scale-110 transition-transform" />
                  <h3 className="font-medium text-gray-900">天災假管理</h3>
                  <p className="text-sm text-gray-500">批量設定颱風、地震等停班</p>
                </a>
              )}

              {/* ======== 7. 公告/通知 ======== */}
              {(user?.role === 'ADMIN' || user?.role === 'HR') && (
                <a href="/announcements" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                  <Megaphone className="h-8 w-8 text-blue-600 mb-2 group-hover:scale-110 transition-transform" />
                  <h3 className="font-medium text-gray-900">公告管理</h3>
                  <p className="text-sm text-gray-500">發布系統公告、管理附件</p>
                </a>
              )}

              {(user?.role !== 'ADMIN' && user?.role !== 'HR') && (
                <a href="/announcements/view" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                  <Megaphone className="h-8 w-8 text-blue-600 mb-2 group-hover:scale-110 transition-transform" />
                  <h3 className="font-medium text-gray-900">公告訊息</h3>
                  <p className="text-sm text-gray-500">查看公司公告、重要通知</p>
                </a>
              )}

              {/* ======== 7. 帳號/離職管理 ======== */}
              <a href="/password-management" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                <Key className="h-8 w-8 text-red-600 mb-2 group-hover:scale-110 transition-transform" />
                <h3 className="font-medium text-gray-900">密碼管理</h3>
                <p className="text-sm text-gray-500">修改密碼、重置員工密碼</p>
              </a>

              {(user?.role === 'ADMIN' || user?.role === 'HR') && (
                <a href="/resignation-management" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                  <Users className="h-8 w-8 text-gray-600 mb-2 group-hover:scale-110 transition-transform" />
                  <h3 className="font-medium text-gray-900">離職管理</h3>
                  <p className="text-sm text-gray-500">審核離職申請、交接管理</p>
                </a>
              )}

              {user?.role !== 'ADMIN' && user?.role !== 'HR' && (
                <a href="/employee-resignation" className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors group">
                  <Users className="h-8 w-8 text-gray-600 mb-2 group-hover:scale-110 transition-transform" />
                  <h3 className="font-medium text-gray-900">離職申請</h3>
                  <p className="text-sm text-gray-500">提交離職申請、查看進度</p>
                </a>
              )}

              {/* ======== 8. 系統設定 (僅管理員) ======== */}
              {user?.role === 'ADMIN' && (
                <a href="/system-settings" className="border border-orange-200 bg-orange-50 rounded-lg p-4 hover:bg-orange-100 cursor-pointer transition-colors group">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-8 w-8 bg-orange-600 rounded-full flex items-center justify-center">
                      <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <span className="text-sm font-medium text-orange-800 bg-orange-200 px-2 py-1 rounded-full">系統管理</span>
                  </div>
                  <h3 className="font-bold text-orange-900 mb-1">系統設定</h3>
                  <p className="text-sm text-orange-700">進階系統參數設定與管理</p>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
