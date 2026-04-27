'use client';

import { useState, useEffect } from 'react';
import { 
  History, Calendar, Clock, Download, 
  ChevronLeft, ChevronRight, Filter, BarChart3, MapPin
} from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
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
}

export default function AttendanceRecordsPage() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
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
    startDate: '',
    endDate: '',
    search: '',
    overtimeHours: '',
    status: '',
    department: ''  // 新增：部門篩選
  });
  
  // 部門列表（管理員/HR 用）
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);

  // 排序狀態
  const [sortConfig, setSortConfig] = useState<{ field: 'date' | 'clockIn' | 'clockOut' | 'regular' | 'overtime' | 'status'; direction: 'asc' | 'desc' }>({ field: 'date', direction: 'desc' });
  const canViewClockReasons = user?.role === 'ADMIN' || user?.role === 'HR';

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
        
        if (filters.startDate) params.append('startDate', filters.startDate);
        if (filters.endDate) params.append('endDate', filters.endDate);
        if (filters.search) params.append('search', filters.search);
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
  }, [user, pagination.current, filters.startDate, filters.endDate, filters.search, filters.overtimeHours, filters.status, filters.department]);

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

  const handlePageChange = (newPage: number) => {
    console.log('📄 分頁變更:', { from: pagination.current, to: newPage });
    setPagination(prev => ({ ...prev, current: newPage }));
  };

  const handleDateFilter = () => {
    setPagination(prev => ({ ...prev, current: 1 }));
    // 移除直接調用fetchRecords()，讓useEffect處理
  };

  const exportToCSV = () => {
    const isAdmin = user && (user.role === 'ADMIN' || user.role === 'HR');
    
    const csvData = records.map(record => {
      // 基本資料
      const baseData: Record<string, string | number> = {
        '員工姓名': record.employee?.name || '-',
        '員工編號': record.employee?.employeeId || '-',
        '部門': record.employee?.department || '-',
        '職位': record.employee?.position || '-',
        '日期': formatDate(record.workDate),
        '星期': formatWeekday(record.workDate).replace(/[()]/g, ''),
        '班次': getRecordShiftDisplay(record),
        '上班時間': formatTime(record.clockInTime),
        '下班時間': formatTime(record.clockOutTime),
        '正常工時': record.regularHours,
        '加班工時': record.overtimeHours,
        '狀態': record.status
      };
      
      // 管理員/HR 可匯出 GPS 資訊
      if (isAdmin) {
        baseData['提早上班打卡原因'] = record.clockInReason || '-';
        baseData['延後下班打卡原因'] = record.clockOutReason || '-';
        baseData['上班打卡緯度'] = record.clockInLatitude || '-';
        baseData['上班打卡經度'] = record.clockInLongitude || '-';
        baseData['上班打卡精確度(m)'] = record.clockInAccuracy || '-';
        baseData['上班打卡地址'] = record.clockInAddress || '-';
        baseData['下班打卡緯度'] = record.clockOutLatitude || '-';
        baseData['下班打卡經度'] = record.clockOutLongitude || '-';
        baseData['下班打卡精確度(m)'] = record.clockOutAccuracy || '-';
        baseData['下班打卡地址'] = record.clockOutAddress || '-';
      }
      
      return baseData;
    });

    if (csvData.length === 0) {
      alert('沒有資料可匯出');
      return;
    }

    const csvContent = [
      Object.keys(csvData[0]).join(','),
      ...csvData.map(row => Object.values(row).map(escapeCsvValue).join(','))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `考勤記錄_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <AuthenticatedLayout backUrl="/attendance" backLabel="返回打卡">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* 頁面標題 */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 flex items-center">
              <History className="mr-3 h-8 w-8" />
              考勤記錄
            </h1>
            <p className="mt-2 text-gray-600">查看您的打卡歷史記錄和工時統計</p>
          </div>

          {/* 統計卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <div className="flex items-center">
                <Calendar className="h-8 w-8 text-blue-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">總記錄數</p>
                  <p className="text-2xl font-bold text-gray-900">{summary.totalRecords}</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <div className="flex items-center">
                <Clock className="h-8 w-8 text-green-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">總正常工時</p>
                  <p className="text-2xl font-bold text-gray-900">{summary.totalRegularHours.toFixed(1)}h</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <div className="flex items-center">
                <BarChart3 className="h-8 w-8 text-orange-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">總加班工時</p>
                  <p className="text-2xl font-bold text-gray-900">{summary.totalOvertimeHours.toFixed(1)}h</p>
                </div>
              </div>
            </div>
          </div>

          {/* 篩選和操作區域 */}
          <div className="bg-white rounded-2xl shadow-lg p-6 mb-8">
            <div className="flex flex-col space-y-4">
              <div className="flex items-center space-x-2 mb-4">
                <Filter className="w-5 h-5 text-gray-400" />
                <span className="text-sm font-medium text-gray-700">篩選條件：</span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">開始日期</label>
                  <input
                    type="date"
                    value={filters.startDate}
                    onChange={(e) => setFilters({...filters, startDate: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">結束日期</label>
                  <input
                    type="date"
                    value={filters.endDate}
                    onChange={(e) => setFilters({...filters, endDate: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">搜尋</label>
                  <input
                    type="text"
                    placeholder="員工編號或姓名"
                    value={filters.search}
                    onChange={(e) => setFilters({...filters, search: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">加班工時</label>
                  <select
                    value={filters.overtimeHours}
                    onChange={(e) => setFilters({...filters, overtimeHours: e.target.value})}
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
                    onChange={(e) => setFilters({...filters, status: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">全部</option>
                    <option value="正常">正常</option>
                    <option value="異常">異常</option>
                    <option value="遲到">遲到</option>
                    <option value="早退">早退</option>
                    <option value="缺勤">缺勤</option>
                  </select>
                </div>

                {/* 部門篩選（僅管理員/HR 可見）*/}
                {user && (user.role === 'ADMIN' || user.role === 'HR') && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">部門</label>
                    <select
                      value={filters.department}
                      onChange={(e) => setFilters({...filters, department: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-black focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">全部部門</option>
                      {departments.map(dept => (
                        <option key={dept.id} value={dept.name}>{dept.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex items-end space-x-2">
                  <button
                    onClick={handleDateFilter}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                  >
                    搜尋
                  </button>
                  <button
                    onClick={exportToCSV}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 考勤記錄表格 */}
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
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
                        {canViewClockReasons && (
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            打卡原因
                          </th>
                        )}
                        {/* GPS 欄位（管理員/HR 可見）*/}
                        {user && (user.role === 'ADMIN' || user.role === 'HR') && (
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            <MapPin className="w-4 h-4 inline mr-1" />打卡位置
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {sortedRecords.map((record) => (
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
                          {user && (user.role === 'ADMIN' || user.role === 'HR') && (
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
