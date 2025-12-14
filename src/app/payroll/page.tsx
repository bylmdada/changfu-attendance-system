'use client';

import { useState, useEffect } from 'react';
import { DollarSign, Plus, Search, Users, Calculator, TrendingUp, BarChart3, Download, FileText } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';

interface Employee {
  id: number;
  employeeId: string;
  name: string;
  department: string;
  position: string;
  baseSalary: number;
  hourlyRate: number;
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

interface PayrollRecord {
  id: number;
  employeeId: number;
  payYear: number;
  payMonth: number;
  regularHours: number;
  overtimeHours: number;
  basePay: number;
  overtimePay: number;
  grossPay: number;
  netPay: number;
  createdAt: string;
  employee: Employee;
}

interface PayslipItem {
  code: string;
  name: string;
  amount: number;
  quantity?: number;
}

const MONTHS = [
  { value: 1, label: '1月' },
  { value: 2, label: '2月' },
  { value: 3, label: '3月' },
  { value: 4, label: '4月' },
  { value: 5, label: '5月' },
  { value: 6, label: '6月' },
  { value: 7, label: '7月' },
  { value: 8, label: '8月' },
  { value: 9, label: '9月' },
  { value: 10, label: '10月' },
  { value: 11, label: '11月' },
  { value: 12, label: '12月' }
];

export default function PayrollManagementPage() {
  const [payrollRecords, setPayrollRecords] = useState<PayrollRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [payslipLoading, setPayslipLoading] = useState(false);
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [filters, setFilters] = useState({
    year: new Date().getFullYear().toString(),
    month: '',
    search: '',
    department: '' // 新增部門篩選
  });

  // Toast 訊息狀態
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // 刪除確認對話框狀態
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; employeeName: string; period: string } | null>(null);

  // 批量選擇狀態
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // 排序狀態
  const [sortConfig, setSortConfig] = useState<{
    field: 'employee' | 'period' | 'grossPay' | 'netPay';
    direction: 'asc' | 'desc';
  }>({ field: 'period', direction: 'desc' });

  // 批量生成表單
  const [generateForm, setGenerateForm] = useState({
    payYear: new Date().getFullYear().toString(),
    payMonth: new Date().getMonth() + 1,
    selectedEmployees: [] as string[]
  });

  // 單一創建表單
  const [createForm, setCreateForm] = useState({
    employeeId: '',
    payYear: new Date().getFullYear().toString(),
    payMonth: new Date().getMonth() + 1
  });

  useEffect(() => {
    // 設定頁面標題
    document.title = '薪資管理 - 長福會考勤系統';
    
    const fetchData = async () => {
      try {
        // 檢查用戶登入狀態
        const authResponse = await fetch('/api/auth/me', {
          credentials: 'include'
        });
        
        if (authResponse.ok) {
          const userData = await authResponse.json();
          setUser(userData.user);
        }

        // 獲取薪資記錄
        const payrollUrl = new URL('/api/payroll', window.location.origin);
        if (filters.year) payrollUrl.searchParams.set('year', filters.year);
        if (filters.month) payrollUrl.searchParams.set('month', filters.month);
        
        const [payrollResponse, employeesResponse] = await Promise.all([
          fetch(payrollUrl.toString(), {
            credentials: 'include'
          }),
          fetch('/api/employees', {
            credentials: 'include'
          })
        ]);

        if (payrollResponse.ok) {
          const payrollData = await payrollResponse.json();
          console.log('✅ 薪資數據載入成功:', payrollData.payrollRecords?.length || 0, '筆記錄');
          setPayrollRecords(payrollData.payrollRecords || []);
        } else {
          console.error('❌ 薪資數據載入失敗:', payrollResponse.status, payrollResponse.statusText);
        }

        if (employeesResponse.ok) {
          const employeesData = await employeesResponse.json();
          console.log('✅ 員工數據載入成功:', employeesData.employees?.length || 0, '名員工');
          setEmployees(employeesData.employees || []);
        } else {
          console.error('❌ 員工數據載入失敗:', employeesResponse.status, employeesResponse.statusText);
        }

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
      } catch (error) {
        console.error('獲取數據失敗:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [filters.year, filters.month]);

  const fetchPayrollRecords = async () => {
    try {
      const url = new URL('/api/payroll', window.location.origin);
      if (filters.year) url.searchParams.set('year', filters.year);
      if (filters.month) url.searchParams.set('month', filters.month);
      
      const response = await fetch(url.toString(), {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setPayrollRecords(data.payrollRecords);
      }
    } catch (error) {
      console.error('獲取薪資記錄失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGeneratePayroll = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetchJSONWithCSRF('/api/payroll/generate', {
        method: 'POST',
        body: {
          payYear: parseInt(generateForm.payYear),
          payMonth: generateForm.payMonth,
          employeeIds: generateForm.selectedEmployees.length > 0 ? generateForm.selectedEmployees : undefined
        }
      });

      if (response.ok) {
        const data = await response.json();
        alert(data.message);
        if (data.errors && data.errors.length > 0) {
          alert('部分記錄生成失敗：\n' + data.errors.join('\n'));
        }
        setShowGenerateForm(false);
        setGenerateForm({
          payYear: new Date().getFullYear().toString(),
          payMonth: new Date().getMonth() + 1,
          selectedEmployees: []
        });
        fetchPayrollRecords();
      } else {
        const error = await response.json();
        alert(error.error);
      }
    } catch {
      alert('批量生成失敗，請稍後再試');
    }
  };

  const handleCreatePayroll = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('🔄 開始創建薪資記錄...');
    try {
      const requestData = {
        employeeId: parseInt(createForm.employeeId),
        payYear: parseInt(createForm.payYear),
        payMonth: createForm.payMonth
      };
      console.log('📝 請求數據:', requestData);

      const response = await fetchJSONWithCSRF('/api/payroll', {
        method: 'POST',
        body: requestData
      });

      console.log('📡 回應狀態:', response.status, response.statusText);

      if (response.ok) {
        const data = await response.json();
        console.log('✅ 創建成功:', data);
        alert(data.message);
        setShowCreateForm(false);
        setCreateForm({
          employeeId: '',
          payYear: new Date().getFullYear().toString(),
          payMonth: new Date().getMonth() + 1
        });
        fetchPayrollRecords();
      } else {
        const error = await response.json();
        console.error('❌ 創建失敗:', error);
        alert(error.error);
      }
    } catch (err) {
      console.error('💥 創建薪資記錄異常:', err);
      alert('創建失敗，請稍後再試');
    }
  };

  // 篩選記錄（含部門篩選）
  const filteredRecords = payrollRecords.filter(record => {
    // 部門篩選
    if (filters.department && record.employee.department !== filters.department) {
      return false;
    }
    // 搜尋篩選
    if (filters.search) {
      return (
        record.employee.name.toLowerCase().includes(filters.search.toLowerCase()) ||
        record.employee.employeeId.toLowerCase().includes(filters.search.toLowerCase()) ||
        record.employee.department.toLowerCase().includes(filters.search.toLowerCase())
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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('zh-TW', {
      style: 'currency',
      currency: 'TWD',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const handleExportReport = async () => {
    try {
      // 建立查詢參數
      const params = new URLSearchParams();
      if (filters.year) params.append('year', filters.year);
      if (filters.month) params.append('month', filters.month);

      const response = await fetch(`/api/reports/export?${params.toString()}`, {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '匯出失敗');
      }

      // 獲取HTML內容並在新窗口中開啟
      const htmlContent = await response.text();
      const newWindow = window.open('', '_blank');
      if (newWindow) {
        newWindow.document.write(htmlContent);
        newWindow.document.close();
      } else {
        // 如果無法開啟新窗口，則下載HTML文件
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `薪資報表_${filters.year || '全部'}年${filters.month ? `${filters.month}月` : ''}_${new Date().toISOString().split('T')[0]}.html`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }

      console.log('報表匯出成功');
    } catch (error) {
      console.error('匯出報表失敗:', error);
      alert('匯出報表失敗: ' + (error instanceof Error ? error.message : '未知錯誤'));
    }
  };

  const generatePayslipPDF = async (payrollId: number) => {
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
      } else {
        const errorData = await response.json();
        alert('生成薪資條失敗: ' + (errorData.error || '未知錯誤'));
      }
    } catch (error) {
      console.error('生成薪資條失敗:', error);
      alert('生成薪資條失敗: ' + (error instanceof Error ? error.message : '未知錯誤'));
    }
    setPayslipLoading(false);
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
      } else {
        const errorData = await response.json();
        alert('生成薪資條失敗: ' + (errorData.error || '未知錯誤'));
      }
    } catch (error) {
      console.error('生成薪資條失敗:', error);
      alert('生成薪資條失敗: ' + (error instanceof Error ? error.message : '未知錯誤'));
    }
    setPayslipLoading(false);
  };

  // 顯示 Toast 訊息
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  // 顯示刪除確認對話框
  const showDeleteConfirm = (record: PayrollRecord) => {
    setDeleteConfirm({
      id: record.id,
      employeeName: record.employee.name,
      period: `${record.payYear}年${record.payMonth}月`
    });
  };

  // 執行刪除
  const handleDeletePayroll = async () => {
    if (!deleteConfirm) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/payroll/${deleteConfirm.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        setPayrollRecords(prev => prev.filter(r => r.id !== deleteConfirm.id));
        setSelectedIds(ids => {
          const newIds = new Set(ids);
          newIds.delete(deleteConfirm.id);
          return newIds;
        });
        showToast('success', '薪資記錄已成功刪除');
      } else {
        const error = await response.text();
        showToast('error', '刪除失敗: ' + error);
      }
    } catch (error) {
      console.error('刪除薪資記錄時發生錯誤:', error);
      showToast('error', '刪除時發生錯誤，請稍後再試');
    } finally {
      setDeleteConfirm(null);
    }
  };

  // 切換選擇
  const toggleSelectRecord = (id: number) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // 全選/取消全選
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredRecords.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredRecords.map(r => r.id)));
    }
  };

  // 批量刪除
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) {
      showToast('error', '請先選擇記錄');
      return;
    }

    if (!window.confirm(`確定要刪除 ${selectedIds.size} 筆薪資記錄嗎？此操作無法復原。`)) return;

    try {
      const token = localStorage.getItem('token');
      const promises = Array.from(selectedIds).map(id =>
        fetch(`/api/payroll/${id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        })
      );

      const results = await Promise.all(promises);
      const successCount = results.filter(r => r.ok).length;

      setPayrollRecords(prev => prev.filter(r => !selectedIds.has(r.id)));
      setSelectedIds(new Set());
      showToast('success', `已刪除 ${successCount} 筆記錄`);
    } catch {
      showToast('error', '批量刪除失敗');
    }
  };

  // 排序函數
  const handleSort = (field: 'employee' | 'period' | 'grossPay' | 'netPay') => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  // 部門名稱列表（從 API 獲取）
  const departmentNames = departments.map(d => d.name);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const generatePayslipHTML = (payslip: any) => {
    // 生成收入項目HTML
    const earningsHTML = payslip.earnings?.map((item: PayslipItem) => `
      <div class="info-row">
        <span>${item.name}${(item.quantity ?? 0) > 1 ? ` (${item.quantity})` : ''}:</span>
        <span class="amount">NT$ ${item.amount.toLocaleString()}</span>
      </div>
    `).join('') || '';

    // 生成扣除項目HTML
    const deductionsHTML = payslip.deductions?.map((item: PayslipItem) => `
      <div class="info-row">
        <span>${item.name}${(item.quantity ?? 0) > 1 ? ` (${item.quantity})` : ''}:</span>
        <span>NT$ ${item.amount.toLocaleString()}</span>
      </div>
    `).join('') || '';

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
        .deduction { color: #dc2626; }
        .total { border-top: 2px solid #333; padding-top: 10px; font-size: 18px; font-weight: bold; }
        .section-title { font-weight: bold; margin-bottom: 10px; color: #374151; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${payslip.companyInfo.name}</h1>
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

      ${earningsHTML ? `
      <div class="info-section">
        <div class="section-title">收入項目</div>
        ${earningsHTML}
        <div class="info-row total">
          <span>總收入:</span>
          <span class="amount">NT$ ${payslip.summary.totalEarnings.toLocaleString()}</span>
        </div>
      </div>
      ` : ''}

      ${deductionsHTML ? `
      <div class="info-section">
        <div class="section-title">扣除項目</div>
        ${deductionsHTML}
        <div class="info-row">
          <span>總扣除:</span>
          <span class="deduction">NT$ ${payslip.summary.totalDeductions.toLocaleString()}</span>
        </div>
      </div>
      ` : ''}

      <div class="info-section total">
        <div class="info-row">
          <span>實領薪資:</span>
          <span class="amount">NT$ ${payslip.summary.netPay.toLocaleString()}</span>
        </div>
      </div>

      <div style="margin-top: 30px; text-align: center; font-size: 12px; color: #666;">
        <p>生成時間: ${new Date(payslip.generatedAt).toLocaleString()}</p>
        <p>${payslip.companyInfo.name}</p>
      </div>
    </body>
    </html>
    `;
  };

  const totalGrossPay = filteredRecords.reduce((sum, record) => sum + record.grossPay, 0);
  const totalNetPay = filteredRecords.reduce((sum, record) => sum + record.netPay, 0);
  const avgGrossPay = filteredRecords.length > 0 ? totalGrossPay / filteredRecords.length : 0;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto p-6">
        {/* 頁面標題 */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <DollarSign className="h-8 w-8 text-blue-600" />
              <h1 className="text-3xl font-bold text-gray-900">
                {user?.role === 'ADMIN' || user?.role === 'HR' ? '薪資管理' : '薪資查詢'}
              </h1>
            </div>
            <div className="flex gap-3">
              {(user?.role === 'ADMIN' || user?.role === 'HR') && (
                <>
                  <button
                    onClick={() => setShowCreateForm(true)}
                    className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <Plus className="h-5 w-5" />
                    單一創建
                  </button>
                  <button
                    onClick={() => setShowGenerateForm(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <Calculator className="h-5 w-5" />
                    批量生成
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 統計卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Users className="h-8 w-8 text-blue-600" />
              </div>
              <div className="ml-4">
                <div className="text-sm font-medium text-gray-500">薪資記錄數</div>
                <div className="text-2xl font-bold text-gray-900">
                  {filteredRecords.length}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <DollarSign className="h-8 w-8 text-green-600" />
              </div>
              <div className="ml-4">
                <div className="text-sm font-medium text-gray-500">總薪資支出</div>
                <div className="text-2xl font-bold text-gray-900">
                  {formatCurrency(totalGrossPay)}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <TrendingUp className="h-8 w-8 text-yellow-600" />
              </div>
              <div className="ml-4">
                <div className="text-sm font-medium text-gray-500">平均薪資</div>
                <div className="text-2xl font-bold text-gray-900">
                  {formatCurrency(avgGrossPay)}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <BarChart3 className="h-8 w-8 text-purple-600" />
              </div>
              <div className="ml-4">
                <div className="text-sm font-medium text-gray-500">實發薪資</div>
                <div className="text-2xl font-bold text-gray-900">
                  {formatCurrency(totalNetPay)}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 篩選區域 */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className={`grid grid-cols-1 gap-4 ${(user?.role === 'ADMIN' || user?.role === 'HR') ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">年份</label>
              <select
                value={filters.year}
                onChange={(e) => setFilters({ ...filters, year: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
              >
                {Array.from({ length: 5 }, (_, i) => {
                  const year = new Date().getFullYear() - 2 + i;
                  return (
                    <option key={year} value={year}>{year}年</option>
                  );
                })}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">月份</label>
              <select
                value={filters.month}
                onChange={(e) => setFilters({ ...filters, month: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
              >
                <option value="">全部月份</option>
                {MONTHS.map((month) => (
                  <option key={month.value} value={month.value}>{month.label}</option>
                ))}
              </select>
            </div>

            {/* 部門篩選 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">部門</label>
              <select
                value={filters.department}
                onChange={(e) => setFilters({ ...filters, department: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
              >
                <option value="">全部部門</option>
                {departmentNames.map((dept) => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>

            {(user?.role === 'ADMIN' || user?.role === 'HR') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">搜尋</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="員工姓名、員編"
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    className="pl-10 w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
              </div>
            )}

            <div className="flex items-end">
              <button 
                onClick={handleExportReport}
                className="flex items-center gap-2 bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
              >
                <Download className="h-4 w-4" />
                匯出報表
              </button>
            </div>
          </div>
        </div>

        {/* 排序和批量操作欄 */}
        {(user?.role === 'ADMIN' || user?.role === 'HR') && (
          <div className="bg-white p-4 rounded-lg shadow-sm mb-6 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              {/* 全選 */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filteredRecords.length > 0 && selectedIds.size === filteredRecords.length}
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
            {selectedIds.size > 0 && user?.role === 'ADMIN' && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">已選 {selectedIds.size} 項：</span>
                <button
                  onClick={handleBatchDelete}
                  className="px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                >
                  批量刪除
                </button>
              </div>
            )}
          </div>
        )}

        {/* 薪資記錄列表 */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">
              薪資記錄 ({sortedRecords.length})
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {(user?.role === 'ADMIN' || user?.role === 'HR') && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                      選擇
                    </th>
                  )}
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    員工資訊
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    薪資期間
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    工時統計
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    基本薪資
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    加班費
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    應發薪資
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    實發薪資
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortedRecords.map((record) => (
                  <tr key={record.id} className={`hover:bg-gray-50 ${selectedIds.has(record.id) ? 'bg-blue-50' : ''}`}>
                    {/* 勾選框 */}
                    {(user?.role === 'ADMIN' || user?.role === 'HR') && (
                      <td className="px-4 py-4 whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(record.id)}
                          onChange={() => toggleSelectRecord(record.id)}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                    )}
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
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        正常: {record.regularHours}h
                      </div>
                      <div className="text-sm text-gray-500">
                        加班: {record.overtimeHours}h
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatCurrency(record.basePay)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatCurrency(record.overtimePay)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {formatCurrency(record.grossPay)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-green-600">
                      {formatCurrency(record.netPay)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex flex-col sm:flex-row gap-1 sm:gap-2">
                        <button
                          onClick={() => generatePayslip(record.id)}
                          disabled={payslipLoading}
                          className="text-blue-600 hover:text-blue-900 disabled:opacity-50 flex items-center gap-1 text-xs sm:text-sm"
                          title="HTML薪資條"
                        >
                          <FileText className="h-4 w-4" />
                          <span className="hidden sm:inline">HTML薪資條</span>
                          <span className="sm:hidden">HTML</span>
                        </button>
                        <button
                          onClick={() => generatePayslipPDF(record.id)}
                          disabled={payslipLoading}
                          className="text-red-600 hover:text-red-900 disabled:opacity-50 flex items-center gap-1 text-xs sm:text-sm"
                          title="列印薪資條"
                        >
                          <Download className="h-4 w-4" />
                          <span className="hidden sm:inline">列印薪資條</span>
                          <span className="sm:hidden">列印</span>
                        </button>
                        {user?.role === 'ADMIN' && (
                          <button
                            onClick={() => showDeleteConfirm(record)}
                            className="text-red-600 hover:text-red-900 flex items-center gap-1 text-xs sm:text-sm"
                            title="刪除記錄"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            <span className="hidden sm:inline">刪除</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filteredRecords.length === 0 && (
              <div className="text-center py-12">
                <DollarSign className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <p className="text-gray-500">暫無薪資記錄</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 批量生成表單 */}
      {showGenerateForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6 max-h-96 overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">批量生成薪資記錄</h3>
            
            <form onSubmit={handleGeneratePayroll} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  年份 *
                </label>
                <select
                  value={generateForm.payYear}
                  onChange={(e) => setGenerateForm({ ...generateForm, payYear: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  required
                >
                  {Array.from({ length: 5 }, (_, i) => {
                    const year = new Date().getFullYear() - 2 + i;
                    return (
                      <option key={year} value={year}>{year}年</option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  月份 *
                </label>
                <select
                  value={generateForm.payMonth}
                  onChange={(e) => setGenerateForm({ ...generateForm, payMonth: parseInt(e.target.value) })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  required
                >
                  {MONTHS.map((month) => (
                    <option key={month.value} value={month.value}>{month.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  選擇員工（留空則為所有員工生成）
                </label>
                <div className="max-h-32 overflow-y-auto border border-gray-300 rounded-lg p-2">
                  {employees.map((employee) => (
                    <label key={employee.id} className="flex items-center space-x-2 py-1">
                      <input
                        type="checkbox"
                        value={employee.id}
                        checked={generateForm.selectedEmployees.includes(employee.id.toString())}
                        onChange={(e) => {
                          const employeeId = e.target.value;
                          if (e.target.checked) {
                            setGenerateForm({
                              ...generateForm,
                              selectedEmployees: [...generateForm.selectedEmployees, employeeId]
                            });
                          } else {
                            setGenerateForm({
                              ...generateForm,
                              selectedEmployees: generateForm.selectedEmployees.filter(id => id !== employeeId)
                            });
                          }
                        }}
                        className="rounded"
                      />
                      <span className="text-sm">{employee.name} ({employee.employeeId})</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowGenerateForm(false);
                    setGenerateForm({
                      payYear: new Date().getFullYear().toString(),
                      payMonth: new Date().getMonth() + 1,
                      selectedEmployees: []
                    });
                  }}
                  className="flex-1 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  生成薪資記錄
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 單一創建表單 */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">創建薪資記錄</h3>
            
            <form onSubmit={handleCreatePayroll} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  員工 *
                </label>
                <select
                  value={createForm.employeeId}
                  onChange={(e) => setCreateForm({ ...createForm, employeeId: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  required
                  disabled={loading || employees.length === 0}
                >
                  <option value="">
                    {loading ? '載入員工資料中...' : employees.length === 0 ? '無可用員工資料' : '請選擇員工'}
                  </option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name} ({employee.employeeId}) - {employee.department}
                    </option>
                  ))}
                </select>
                {employees.length === 0 && !loading && (
                  <p className="mt-1 text-sm text-red-600">
                    找不到員工資料，請檢查您的權限或聯繫管理員
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  年份 *
                </label>
                <select
                  value={createForm.payYear}
                  onChange={(e) => setCreateForm({ ...createForm, payYear: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  required
                >
                  {Array.from({ length: 5 }, (_, i) => {
                    const year = new Date().getFullYear() - 2 + i;
                    return (
                      <option key={year} value={year}>{year}年</option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  月份 *
                </label>
                <select
                  value={createForm.payMonth}
                  onChange={(e) => setCreateForm({ ...createForm, payMonth: parseInt(e.target.value) })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  required
                >
                  {MONTHS.map((month) => (
                    <option key={month.value} value={month.value}>{month.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateForm(false);
                    setCreateForm({
                      employeeId: '',
                      payYear: new Date().getFullYear().toString(),
                      payMonth: new Date().getMonth() + 1
                    });
                  }}
                  className="flex-1 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                >
                  創建記錄
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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

      {/* 刪除確認對話框 */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center text-red-600 mb-4">
              <svg className="w-8 h-8 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <h3 className="text-xl font-semibold">確認刪除</h3>
            </div>
            <p className="text-gray-600 mb-6">
              確定要刪除 {deleteConfirm.employeeName} 的 {deleteConfirm.period} 薪資記錄嗎？此操作無法復原。
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleDeletePayroll}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center"
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                確認刪除
              </button>
            </div>
          </div>
        </div>
      )}
    </AuthenticatedLayout>
  );
}
