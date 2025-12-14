'use client';

import { useEffect, useState } from 'react';
import { 
  FileText, 
  Download, 
  Calculator, 
  TrendingUp,
  Users,
  DollarSign,
  Calendar
} from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';

interface PayrollRecord {
  id: number;
  payYear: number;
  payMonth: number;
  regularHours: number;
  overtimeHours: number;
  basePay: number;
  overtimePay: number;
  grossPay: number;
  netPay: number;
  employee: {
    id: number;
    employeeId: string;
    name: string;
    department: string;
    position: string;
  };
}

interface ReportStats {
  totalEmployees: number;
  totalGrossPay: number;
  totalNetPay: number;
  totalOvertimeHours: number;
  avgSalary: number;
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

interface PayslipItem {
  code: string;
  name: string;
  amount: number;
  quantity?: number;
}

interface Payslip {
  employee: {
    employeeId: string;
    name: string;
    department?: string;
    position?: string;
  };
  period: {
    monthName: string;
  };
  companyInfo?: {
    name: string;
  };
  workHours: {
    regular: number;
    overtime: number;
    total: number;
  };
  earnings?: PayslipItem[];
  deductions?: PayslipItem[];
  summary?: {
    totalEarnings?: number;
    totalDeductions?: number;
    netPay?: number;
  };
  generatedAt: string;
}

export default function ReportsPage() {
  const [payrollRecords, setPayrollRecords] = useState<PayrollRecord[]>([]);
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedDepartment, setSelectedDepartment] = useState(''); // 部門篩選
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [payslipLoading, setPayslipLoading] = useState(false);
  
  // Toast 狀態
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // 排序狀態
  const [sortConfig, setSortConfig] = useState<{ field: 'employee' | 'period' | 'grossPay' | 'netPay'; direction: 'asc' | 'desc' }>({ field: 'employee', direction: 'asc' });
  
  // 批量選擇狀態
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  
  // 報表類型
  const [reportType, setReportType] = useState<'salary' | 'labor_insurance' | 'health_insurance' | 'income_tax'>('salary');

  // Toast 顯示函數
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  // 排序函數
  const handleSort = (field: 'employee' | 'period' | 'grossPay' | 'netPay') => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  // 選擇記錄
  const toggleSelectRecord = (id: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  // 全選/取消全選
  const toggleSelectAll = () => {
    if (selectedIds.size === sortedRecords.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedRecords.map(r => r.id)));
    }
  };

  const fetchPayrollData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      
      if (selectedYear) params.append('year', selectedYear.toString());
      if (selectedMonth) params.append('month', selectedMonth.toString());

      const response = await fetch(`/api/payroll?${params}`, {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        setPayrollRecords(data.payrollRecords);
        
        // 計算統計數據
        const totalEmployees = data.payrollRecords.length;
        const totalGrossPay = data.payrollRecords.reduce((sum: number, record: PayrollRecord) => sum + record.grossPay, 0);
        const totalNetPay = data.payrollRecords.reduce((sum: number, record: PayrollRecord) => sum + record.netPay, 0);
        const totalOvertimeHours = data.payrollRecords.reduce((sum: number, record: PayrollRecord) => sum + record.overtimeHours, 0);
        const avgSalary = totalEmployees > 0 ? totalGrossPay / totalEmployees : 0;

        setStats({
          totalEmployees,
          totalGrossPay,
          totalNetPay,
          totalOvertimeHours,
          avgSalary
        });
      }
    } catch (error) {
      console.error('獲取薪資數據失敗:', error);
    }
    setLoading(false);
  };

  const generatePayslip = async (payrollId: number) => {
    setPayslipLoading(true);
    try {
      const response = await fetch(`/api/payroll/payslip?payrollId=${payrollId}`, {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        
        // 創建並下載薪資條
        const payslipContent = generatePayslipHTML(data.payslip);
        const blob = new Blob([payslipContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `薪資條_${data.payslip.employee.name}_${data.payslip.period.monthName}.html`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('生成薪資條失敗:', error);
    }
    setPayslipLoading(false);
  };

  const generatePayslipPDF = async (payrollId: number) => {
    setPayslipLoading(true);
    try {
      const response = await fetch(`/api/payroll/payslip-pdf?payrollId=${payrollId}`, {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        
        // 創建新視窗並顯示薪資條HTML
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(data.htmlContent);
          printWindow.document.close();
          
          // 等待內容載入完成後觸發列印
          printWindow.onload = () => {
            printWindow.print();
            printWindow.close();
          };
        }
      }
    } catch (error) {
      console.error('生成PDF薪資條失敗:', error);
    }
    setPayslipLoading(false);
  };

  const generatePayslipHTML = (payslip: Payslip) => {
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>薪資條 - ${payslip.employee.name}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; }
        .info-section { margin: 20px 0; }
        .info-row { display: flex; justify-content: space-between; margin: 5px 0; }
        .amount { font-weight: bold; color: #2563eb; }
        .total { border-top: 2px solid #333; padding-top: 10px; font-size: 18px; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${payslip.companyInfo?.name || '長福會'}</h1>
        <h2>薪資條</h2>
        <p>${payslip.period.monthName}</p>
      </div>

      <div class="info-section">
        <h3>員工資訊</h3>
        <div class="info-row"><span>員工編號:</span><span>${payslip.employee.employeeId}</span></div>
        <div class="info-row"><span>姓名:</span><span>${payslip.employee.name}</span></div>
        <div class="info-row"><span>部門:</span><span>${payslip.employee.department || 'N/A'}</span></div>
        <div class="info-row"><span>職位:</span><span>${payslip.employee.position || 'N/A'}</span></div>
      </div>

      <div class="info-section">
        <h3>工時統計</h3>
        <div class="info-row"><span>正常工時:</span><span>${payslip.workHours.regular} 小時</span></div>
        <div class="info-row"><span>加班工時:</span><span>${payslip.workHours.overtime} 小時</span></div>
        <div class="info-row"><span>總工時:</span><span>${payslip.workHours.total} 小時</span></div>
      </div>

      <div class="info-section">
        <h3>薪資明細</h3>
        <div class="info-row"><span>基本薪資:</span><span class="amount">NT$ ${payslip.earnings?.find((e: PayslipItem) => e.code === 'BASE_SALARY')?.amount?.toLocaleString() || '0'}</span></div>
        <div class="info-row"><span>加班費:</span><span class="amount">NT$ ${payslip.earnings?.find((e: PayslipItem) => e.code === 'OVERTIME_PAY')?.amount?.toLocaleString() || '0'}</span></div>
        <div class="info-row"><span>總薪資:</span><span class="amount">NT$ ${payslip.summary?.totalEarnings?.toLocaleString() || '0'}</span></div>
      </div>

      <div class="info-section">
        <h3>扣除項目</h3>
        <div class="info-row"><span>勞工保險:</span><span>NT$ ${payslip.deductions?.find((d: PayslipItem) => d.code === 'LABOR_INSURANCE')?.amount?.toLocaleString() || '0'}</span></div>
        <div class="info-row"><span>健康保險:</span><span>NT$ ${payslip.deductions?.find((d: PayslipItem) => d.code === 'HEALTH_INSURANCE')?.amount?.toLocaleString() || '0'}</span></div>
        <div class="info-row"><span>補充保費:</span><span>NT$ ${payslip.deductions?.find((d: PayslipItem) => d.code === 'SUPPLEMENTARY_INSURANCE')?.amount?.toLocaleString() || '0'}</span></div>
        <div class="info-row"><span>所得稅:</span><span>NT$ ${payslip.deductions?.find((d: PayslipItem) => d.code === 'INCOME_TAX')?.amount?.toLocaleString() || '0'}</span></div>
        <div class="info-row"><span>總扣除額:</span><span>NT$ ${payslip.summary?.totalDeductions?.toLocaleString() || '0'}</span></div>
      </div>

      <div class="info-section total">
        <div class="info-row"><span>實領薪資:</span><span class="amount">NT$ ${payslip.summary?.netPay?.toLocaleString() || '0'}</span></div>
      </div>

      <div style="margin-top: 30px; text-align: center; font-size: 12px; color: #666;">
        <p>生成時間: ${new Date(payslip.generatedAt).toLocaleString()}</p>
        <p>${payslip.companyInfo?.name || '長福會'}</p>
      </div>
    </body>
    </html>
    `;
  };

  const exportToPDF = async () => {
    try {
      const params = new URLSearchParams();
      
      if (selectedYear) params.append('year', selectedYear.toString());
      if (selectedMonth) params.append('month', selectedMonth.toString());

      const response = await fetch(`/api/reports/export?${params}`, {
        credentials: 'include',
      });

      if (response.ok) {
        const htmlContent = await response.text();
        
        // 在新視窗中打開HTML內容以便列印為PDF
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(htmlContent);
          printWindow.document.close();
          
          // 等待內容載入完成後觸發列印
          printWindow.onload = () => {
            setTimeout(() => {
              printWindow.print();
            }, 500);
          };
        }
      }
    } catch (error) {
      console.error('匯出 PDF 失敗:', error);
    }
  };

  const exportToCSV = () => {
    const headers = [
      '員工編號', '姓名', '部門', '職位', '年度', '月份',
      '正常工時', '加班工時', '基本薪資', '加班費', '總薪資', '實領薪資'
    ];
    
    const csvData = [
      headers.join(','),
      ...filteredRecords.map(record => [
        record.employee.employeeId,
        record.employee.name,
        record.employee.department || '',
        record.employee.position || '',
        record.payYear,
        record.payMonth,
        record.regularHours,
        record.overtimeHours,
        record.basePay,
        record.overtimePay,
        record.grossPay,
        record.netPay
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `薪資報表_${selectedYear}年${selectedMonth}月.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    // 設定頁面標題
    document.title = '報表管理 - 長福會考勤系統';
    
    const fetchUserAndData = async () => {
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

        // 然後獲取報表數據
        fetchPayrollData();
      } catch (error) {
        console.error('獲取用戶信息失敗:', error);
      }
    };

    fetchUserAndData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear, selectedMonth]);

  // 部門名稱列表
  const departmentNames = departments.map(d => d.name);

  // 過濾薪資記錄（含部門篩選）
  const filteredRecords = payrollRecords.filter(record => {
    // 部門篩選
    if (selectedDepartment && record.employee.department !== selectedDepartment) {
      return false;
    }
    // 搜尋篩選
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        record.employee.name.toLowerCase().includes(query) ||
        record.employee.employeeId.toLowerCase().includes(query) ||
        (record.employee.department && record.employee.department.toLowerCase().includes(query))
      );
    }
    return true;
  });

  // 排序後的記錄
  const sortedRecords = [...filteredRecords].sort((a, b) => {
    const direction = sortConfig.direction === 'asc' ? 1 : -1;
    
    switch (sortConfig.field) {
      case 'employee':
        return a.employee.name.localeCompare(b.employee.name) * direction;
      case 'period': {
        const periodA = a.payYear * 100 + a.payMonth;
        const periodB = b.payYear * 100 + b.payMonth;
        return (periodA - periodB) * direction;
      }
      case 'grossPay':
        return (a.grossPay - b.grossPay) * direction;
      case 'netPay':
        return (a.netPay - b.netPay) * direction;
      default:
        return 0;
    }
  });

  // 批量匯出薪資條
  const batchExportPayslips = async () => {
    if (selectedIds.size === 0) return;
    
    setPayslipLoading(true);
    try {
      const selectedRecords = sortedRecords.filter(r => selectedIds.has(r.id));
      let successCount = 0;
      
      for (const record of selectedRecords) {
        const response = await fetch(`/api/payroll/payslip?payrollId=${record.id}`, {
          credentials: 'include',
        });
        
        if (response.ok) {
          const data = await response.json();
          const payslipContent = generatePayslipHTML(data.payslip);
          const blob = new Blob([payslipContent], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `薪資條_${data.payslip.employee.name}_${data.payslip.period.monthName}.html`;
          a.click();
          URL.revokeObjectURL(url);
          successCount++;
        }
      }
      
      showToast('success', `已成功匯出 ${successCount} 份薪資條`);
      setSelectedIds(new Set());
    } catch (error) {
      console.error('批量匯出失敗:', error);
      showToast('error', '批量匯出失敗');
    }
    setPayslipLoading(false);
  };

  // 匯出 Excel 格式
  const exportToExcel = () => {
    const headers = [
      '員工編號', '姓名', '部門', '職位', '年度', '月份',
      '正常工時', '加班工時', '基本薪資', '加班費', '總薪資', '實領薪資'
    ];
    
    // 使用 Tab 分隔的格式（Excel 可直接開啟）
    const excelData = [
      headers.join('\t'),
      ...sortedRecords.map(record => [
        record.employee.employeeId,
        record.employee.name,
        record.employee.department || '',
        record.employee.position || '',
        record.payYear,
        record.payMonth,
        record.regularHours,
        record.overtimeHours,
        record.basePay,
        record.overtimePay,
        record.grossPay,
        record.netPay
      ].join('\t'))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + excelData], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `薪資報表_${selectedYear}年${selectedMonth}月.xls`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('success', 'Excel 報表匯出成功');
  };

  return (
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2 flex items-center">
              <FileText className="mr-3 h-8 w-8" />
              報表管理
            </h1>
            <p className="text-gray-600">薪資條生成、稅金計算與報表匯出</p>
          </div>

          {/* 篩選區域 */}
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">年度</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
              >
                {[...Array(5)].map((_, i) => {
                  const year = new Date().getFullYear() - i;
                  return (
                    <option key={year} value={year}>{year}年</option>
                  );
                })}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">月份</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
              >
                <option value="">全部月份</option>
                {[...Array(12)].map((_, i) => (
                  <option key={i + 1} value={i + 1}>{i + 1}月</option>
                ))}
              </select>
            </div>

            {/* 部門篩選 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">部門</label>
              <select
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
              >
                <option value="">全部部門</option>
                {departmentNames.map((dept) => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>

            {/* 報表類型 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">報表類型</label>
              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value as 'salary' | 'labor_insurance' | 'health_insurance' | 'income_tax')}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
              >
                <option value="salary">薪資報表</option>
                <option value="labor_insurance">勞保報表</option>
                <option value="health_insurance">健保報表</option>
                <option value="income_tax">所得稅報表</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">搜尋</label>
              <input
                type="text"
                placeholder="員工姓名、員編"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
              />
            </div>

            <div className="flex items-end gap-2">
              <button
                onClick={exportToPDF}
                disabled={loading || sortedRecords.length === 0}
                className="flex-1 bg-blue-600 text-white px-3 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1 text-sm"
              >
                <Download className="h-4 w-4" />
                PDF
              </button>
              <button
                onClick={exportToCSV}
                disabled={loading || sortedRecords.length === 0}
                className="flex-1 bg-gray-600 text-white px-3 py-2 rounded-md hover:bg-gray-700 disabled:opacity-50 flex items-center justify-center gap-1 text-sm"
              >
                CSV
              </button>
              <button
                onClick={exportToExcel}
                disabled={loading || sortedRecords.length === 0}
                className="flex-1 bg-emerald-600 text-white px-3 py-2 rounded-md hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-1 text-sm"
              >
                Excel
              </button>
            </div>
          </div>
        </div>

        {/* 排序和批量操作欄 */}
        <div className="bg-white p-4 rounded-lg shadow-sm mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {/* 全選 */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={sortedRecords.length > 0 && selectedIds.size === sortedRecords.length}
                onChange={toggleSelectAll}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">全選</span>
            </label>
            
            {/* 排序選項 */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">排序：</span>
              <button
                onClick={() => handleSort('employee')}
                className={`px-3 py-1.5 text-sm rounded ${sortConfig.field === 'employee' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                員工 {sortConfig.field === 'employee' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
              </button>
              <button
                onClick={() => handleSort('period')}
                className={`px-3 py-1.5 text-sm rounded ${sortConfig.field === 'period' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                期間 {sortConfig.field === 'period' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
              </button>
              <button
                onClick={() => handleSort('netPay')}
                className={`px-3 py-1.5 text-sm rounded ${sortConfig.field === 'netPay' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                薪資 {sortConfig.field === 'netPay' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
              </button>
            </div>
          </div>

          {/* 批量操作按鈕 */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">已選 {selectedIds.size} 項：</span>
              <button
                onClick={batchExportPayslips}
                disabled={payslipLoading}
                className="px-3 py-1.5 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors disabled:opacity-50"
              >
                {payslipLoading ? '匯出中...' : '批量匯出薪資條'}
              </button>
            </div>
          )}
        </div>

        {/* 統計卡片 */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-8">
            <div className="bg-white p-6 rounded-lg shadow-sm">
              <div className="flex items-center">
                <Users className="h-8 w-8 text-blue-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">員工數</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.totalEmployees}</p>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-sm">
              <div className="flex items-center">
                <DollarSign className="h-8 w-8 text-green-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">總薪資</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {stats.totalGrossPay.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-sm">
              <div className="flex items-center">
                <Calculator className="h-8 w-8 text-purple-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">實領總額</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {stats.totalNetPay.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-sm">
              <div className="flex items-center">
                <Calendar className="h-8 w-8 text-orange-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">總加班時數</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.totalOvertimeHours}</p>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-sm">
              <div className="flex items-center">
                <TrendingUp className="h-8 w-8 text-red-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">平均薪資</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {Math.round(stats.avgSalary).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 薪資記錄表格 */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">薪資記錄 ({sortedRecords.length})</h2>
          </div>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-12">
                    選擇
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    員工資訊
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    期間
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    工時
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    薪資
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                      載入中...
                    </td>
                  </tr>
                ) : sortedRecords.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-center text-gray-500">
                      沒有找到薪資記錄
                    </td>
                  </tr>
                ) : (
                  sortedRecords.map((record) => (
                    <tr key={record.id} className={`hover:bg-gray-50 ${selectedIds.has(record.id) ? 'bg-blue-50' : ''}`}>
                      {/* 勾選框 */}
                      <td className="px-4 py-4 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(record.id)}
                          onChange={() => toggleSelectRecord(record.id)}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {record.employee.name}
                          </div>
                          <div className="text-sm text-gray-500">
                            {record.employee.employeeId} • {record.employee.department}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {record.payYear}年{record.payMonth}月
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div>正常: {record.regularHours}h</div>
                        <div>加班: {record.overtimeHours}h</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          總薪資: NT$ {record.grossPay.toLocaleString()}
                        </div>
                        <div className="text-sm text-gray-500">
                          實領: NT$ {record.netPay.toLocaleString()}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex gap-2">
                          <button
                            onClick={() => generatePayslip(record.id)}
                            disabled={payslipLoading}
                            className="text-blue-600 hover:text-blue-900 disabled:opacity-50 flex items-center gap-1"
                          >
                            <FileText className="h-4 w-4" />
                            HTML薪資條
                          </button>
                          <button
                            onClick={() => generatePayslipPDF(record.id)}
                            disabled={payslipLoading}
                            className="text-red-600 hover:text-red-900 disabled:opacity-50 flex items-center gap-1"
                          >
                            <Download className="h-4 w-4" />
                            列印薪資條
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        </div>
      </div>

      {/* Toast 訊息 */}
      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 ${
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.type === 'success' ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          {toast.message}
        </div>
      )}
    </AuthenticatedLayout>
  );
}
