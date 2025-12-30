'use client';

import { useState, useEffect } from 'react';
import { DollarSign, Plus, Search, Users, Calculator, TrendingUp, BarChart3, Download, FileText, Eye, Loader2, X } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import { LOGO_BASE64 } from '@/lib/logoBase64';

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
    selectedEmployees: [] as string[],
    department: '' // 新增部門篩選
  });

  // 進度條狀態
  const [progress, setProgress] = useState({
    isProcessing: false,
    isPreviewing: false,
    current: 0,
    total: 0,
    status: ''
  });

  // 預覽結果
  const [previewData, setPreviewData] = useState<{
    summary: { totalEmployees: number; previewCount: number; existingCount: number; totalGrossPay: number; totalNetPay: number; totalBonus: number };
    previews: { employeeId: string; employeeName: string; department: string; grossPay: number; netPay: number; festivalBonus: number; yearEndBonus: number; totalBonus: number; isValid: boolean }[];
    existingRecords: { employeeId: string; employeeName: string; department: string }[];
  } | null>(null);

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
        
        let currentUser = null;
        if (authResponse.ok) {
          const userData = await authResponse.json();
          currentUser = userData.user;
          setUser(currentUser);
        }

        // 獲取薪資記錄
        const payrollUrl = new URL('/api/payroll', window.location.origin);
        if (filters.year) payrollUrl.searchParams.set('year', filters.year);
        if (filters.month) payrollUrl.searchParams.set('month', filters.month);
        
        const payrollResponse = await fetch(payrollUrl.toString(), {
          credentials: 'include'
        });

        if (payrollResponse.ok) {
          const payrollData = await payrollResponse.json();
          console.log('✅ 薪資數據載入成功:', payrollData.payrollRecords?.length || 0, '筆記錄');
          setPayrollRecords(payrollData.payrollRecords || []);
        } else {
          console.error('❌ 薪資數據載入失敗:', payrollResponse.status, payrollResponse.statusText);
        }

        // 只有 ADMIN/HR 才載入員工列表和部門列表（用於批量生成薪資）
        if (currentUser && (currentUser.role === 'ADMIN' || currentUser.role === 'HR')) {
          try {
            const employeesResponse = await fetch('/api/employees', {
              credentials: 'include'
            });
            if (employeesResponse.ok) {
              const employeesData = await employeesResponse.json();
              console.log('✅ 員工數據載入成功:', employeesData.employees?.length || 0, '名員工');
              setEmployees(employeesData.employees || []);
            }
          } catch (empError) {
            console.error('獲取員工列表失敗:', empError);
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

  // 預覽薪資計算
  const handlePreviewPayroll = async () => {
    setProgress({ ...progress, isPreviewing: true, status: '正在預覽計算...' });
    try {
      const response = await fetch('/api/payroll/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          payYear: parseInt(generateForm.payYear),
          payMonth: generateForm.payMonth,
          employeeIds: generateForm.selectedEmployees.length > 0 ? generateForm.selectedEmployees : undefined,
          department: generateForm.department || undefined
        })
      });

      if (response.ok) {
        const data = await response.json();
        setPreviewData(data);
      } else {
        const error = await response.json();
        showToast('error', error.error || '預覽失敗');
      }
    } catch {
      showToast('error', '預覽失敗，請稍後再試');
    } finally {
      setProgress({ ...progress, isPreviewing: false, status: '' });
    }
  };

  const handleGeneratePayroll = async (e: React.FormEvent) => {
    e.preventDefault();
    setProgress({ isProcessing: true, isPreviewing: false, current: 0, total: previewData?.summary.previewCount || 0, status: '正在生成薪資記錄...' });
    
    try {
      const response = await fetchJSONWithCSRF('/api/payroll/generate', {
        method: 'POST',
        body: {
          payYear: parseInt(generateForm.payYear),
          payMonth: generateForm.payMonth,
          employeeIds: generateForm.selectedEmployees.length > 0 ? generateForm.selectedEmployees : undefined,
          department: generateForm.department || undefined
        }
      });

      if (response.ok) {
        const data = await response.json();
        setProgress({ ...progress, current: data.results?.length || 0, status: '完成！' });
        showToast('success', data.message);
        if (data.errors && data.errors.length > 0) {
          showToast('error', `部分記錄生成失敗：${data.errors.length} 筆`);
        }
        setShowGenerateForm(false);
        setPreviewData(null);
        setGenerateForm({
          payYear: new Date().getFullYear().toString(),
          payMonth: new Date().getMonth() + 1,
          selectedEmployees: [],
          department: ''
        });
        fetchPayrollRecords();
      } else {
        const error = await response.json();
        showToast('error', error.error);
      }
    } catch {
      showToast('error', '批量生成失敗，請稍後再試');
    } finally {
      setProgress({ isProcessing: false, isPreviewing: false, current: 0, total: 0, status: '' });
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
        
        // 檢查是否有密碼保護
        if (data.security?.hasPassword) {
          // 顯示密碼提示
          const confirmMsg = `此薪資條有密碼保護：\n\n📌 ${data.security.hint}\n\n${data.security.password ? `密碼：${data.security.password}` : ''}\n\n是否繼續列印？`;
          if (!confirm(confirmMsg)) {
            setPayslipLoading(false);
            return;
          }
        }
        
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

  // 下載加密 PDF
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const downloadEncryptedPDF = async (payrollId: number) => {
    setPayslipLoading(true);
    try {
      const response = await fetch(`/api/payroll/payslip-download?payrollId=${payrollId}`, {
        credentials: 'include',
      });

      if (response.ok) {
        const blob = await response.blob();
        const contentDisposition = response.headers.get('Content-Disposition');
        let fileName = '薪資條.pdf';
        
        if (contentDisposition) {
          const match = contentDisposition.match(/filename="(.+)"/);
          if (match) {
            fileName = decodeURIComponent(match[1]);
          }
        }
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        showToast('success', '薪資條已下載（已加密）');
      } else {
        const errorData = await response.json();
        showToast('error', '下載薪資條失敗: ' + (errorData.error || '未知錯誤'));
      }
    } catch (error) {
      console.error('下載薪資條失敗:', error);
      showToast('error', '下載薪資條失敗');
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
        const blob = new Blob([payslipContent], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `薪資條_${data.payslip.employee.name}_${data.payslip.period.monthName}.html`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('success', '薪資條已下載');
      } else {
        const errorData = await response.json();
        showToast('error', '生成薪資條失敗: ' + (errorData.error || '未知錯誤'));
      }
    } catch (error) {
      console.error('生成薪資條失敗:', error);
      showToast('error', '生成薪資條失敗: ' + (error instanceof Error ? error.message : '未知錯誤'));
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
    // 生成收入項目表格行
    const earningsRows = payslip.earnings?.map((item: PayslipItem) => `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${item.name}${(item.quantity ?? 0) > 1 ? ` (${item.quantity})` : ''}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #059669; font-weight: 500;">NT$ ${item.amount.toLocaleString()}</td>
      </tr>
    `).join('') || '';

    // 生成扣除項目表格行
    const deductionsRows = payslip.deductions?.map((item: PayslipItem) => `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${item.name}${(item.quantity ?? 0) > 1 ? ` (${item.quantity})` : ''}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #dc2626;">NT$ ${item.amount.toLocaleString()}</td>
      </tr>
    `).join('') || '';

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>薪資條 - ${payslip.employee.name} - ${payslip.period.monthName}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          background: #f8fafc;
          padding: 20px;
          min-height: 100vh;
        }
        .payslip-container {
          max-width: 800px;
          margin: 0 auto;
          background: white;
          border-radius: 12px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
          overflow: hidden;
          position: relative;
        }
        .watermark {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(-45deg);
          font-size: 60px;
          color: rgba(100, 116, 139, 0.12);
          font-weight: bold;
          white-space: nowrap;
          pointer-events: none;
          z-index: 10;
          user-select: none;
          text-shadow: 0 0 2px rgba(255,255,255,0.5);
        }
        .content { position: relative; z-index: 1; }
        .header {
          background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
          color: white;
          padding: 24px 32px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .header-left { display: flex; align-items: center; gap: 16px; }
        .logo {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          object-fit: cover;
          background: white;
          padding: 4px;
        }
        .logo-text {
          width: 56px;
          height: 56px;
          background: white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          color: #1e40af;
          font-size: 11px;
        }
        .header-title h1 { font-size: 24px; margin-bottom: 4px; }
        .header-title p { font-size: 14px; opacity: 0.9; }
        .period-badge {
          background: rgba(255,255,255,0.2);
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 16px;
          font-weight: 500;
        }
        .employee-info {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
          padding: 24px 32px;
          background: #f8fafc;
          border-bottom: 1px solid #e5e7eb;
        }
        .info-card {
          background: white;
          padding: 16px;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
        }
        .info-card h3 {
          font-size: 14px;
          color: #6b7280;
          margin-bottom: 12px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .info-item {
          display: flex;
          justify-content: space-between;
          padding: 6px 0;
          font-size: 14px;
        }
        .info-label { color: #6b7280; }
        .info-value { font-weight: 500; color: #111827; }
        .salary-section { padding: 24px 32px; }
        .section-header {
          padding: 12px 16px;
          border-radius: 8px 8px 0 0;
          font-weight: 600;
          font-size: 14px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .section-header.income { background: #dcfce7; color: #166534; }
        .section-header.deduction { background: #fee2e2; color: #991b1b; }
        .salary-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 14px;
          border: 1px solid #e5e7eb;
          border-top: none;
        }
        .salary-table td { color: #374151; }
        .total-row td { font-weight: 600 !important; background: #f9fafb; }
        .net-pay-section {
          margin: 0 32px 24px;
          background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
          border-radius: 12px;
          padding: 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          color: white;
        }
        .net-pay-label { font-size: 18px; }
        .net-pay-amount { font-size: 32px; font-weight: bold; }
        .footer {
          padding: 16px 32px;
          background: #f8fafc;
          border-top: 1px solid #e5e7eb;
          font-size: 12px;
          color: #6b7280;
          text-align: center;
        }
        .confidential-notice {
          background: #fef3c7;
          color: #92400e;
          padding: 8px 16px;
          border-radius: 4px;
          margin-bottom: 12px;
          font-weight: 500;
        }
        /* 列印按鈕 */
        .print-actions {
          position: fixed;
          top: 20px;
          right: 20px;
          display: flex;
          gap: 8px;
          z-index: 2000;
        }
        .print-btn {
          padding: 10px 16px;
          border: none;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          background: #1e40af;
          color: white;
        }
        .print-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
        @media print {
          body { background: white; padding: 0; }
          .payslip-container { box-shadow: none; }
          .watermark { color: rgba(156, 163, 175, 0.1); }
          .print-actions { display: none !important; }
        }
      </style>
    </head>
    <body>
      <!-- 列印按鈕 -->
      <div class="print-actions">
        <button class="print-btn" onclick="window.print()">🖨️ 列印 / 存為 PDF</button>
      </div>

      <div class="payslip-container">
        <div class="watermark">內部機密 僅限本人查閱</div>
        <div class="content">
          <div class="header">
            <div class="header-left">
              <img src="${LOGO_BASE64}" alt="長福會" class="logo" /><div class="logo-text" style="display:none;">長福會</div>
              <div class="header-title">
                <h1>薪資條</h1>
                <p>${payslip.companyInfo?.name || '社團法人宜蘭縣長期照護及社會福祉推廣協會'}</p>
              </div>
            </div>
            <div class="period-badge">${payslip.period.monthName}</div>
          </div>
          <div class="employee-info">
            <div class="info-card">
              <h3>👤 員工資訊</h3>
              <div class="info-item"><span class="info-label">員工編號</span><span class="info-value">${payslip.employee.employeeId}</span></div>
              <div class="info-item"><span class="info-label">姓名</span><span class="info-value">${payslip.employee.name}</span></div>
              <div class="info-item"><span class="info-label">部門</span><span class="info-value">${payslip.employee.department || 'N/A'}</span></div>
              <div class="info-item"><span class="info-label">職位</span><span class="info-value">${payslip.employee.position || 'N/A'}</span></div>
            </div>
            <div class="info-card">
              <h3>⏰ 工時統計</h3>
              <div class="info-item"><span class="info-label">正常工時</span><span class="info-value">${payslip.workHours.regular} 小時</span></div>
              <div class="info-item"><span class="info-label">加班工時</span><span class="info-value">${payslip.workHours.overtime} 小時</span></div>
              <div class="info-item"><span class="info-label">總工時</span><span class="info-value">${payslip.workHours.total} 小時</span></div>
            </div>
          </div>
          <div class="salary-section">
            <div class="section-header income">💰 收入項目</div>
            <table class="salary-table">
              ${earningsRows}
              <tr class="total-row">
                <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">應發合計</td>
                <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #059669; font-size: 16px;">NT$ ${payslip.summary?.totalEarnings?.toLocaleString() || '0'}</td>
              </tr>
            </table>
            <div class="section-header deduction" style="margin-top: 16px;">📉 扣除項目</div>
            <table class="salary-table">
              ${deductionsRows}
              <tr class="total-row">
                <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">扣除合計</td>
                <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #dc2626; font-size: 16px;">NT$ ${payslip.summary?.totalDeductions?.toLocaleString() || '0'}</td>
              </tr>
            </table>
          </div>
          <div class="net-pay-section">
            <span class="net-pay-label">實領薪資</span>
            <span class="net-pay-amount">NT$ ${payslip.summary?.netPay?.toLocaleString() || '0'}</span>
          </div>
          <div class="footer">
            <div class="confidential-notice">
              🔒 本薪資條專供 ${payslip.employee.name} (${payslip.employee.employeeId}) 查閱，請妥善保管
            </div>
            <p>生成時間：${new Date(payslip.generatedAt).toLocaleString('zh-TW')}</p>
            <p style="margin-top: 4px;">${payslip.companyInfo?.name || '長福會'} | 如有疑問請洽人事部門</p>
          </div>
        </div>
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
          <div className="bg-white rounded-lg max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">批量生成薪資記錄</h3>
              <button
                onClick={() => {
                  setShowGenerateForm(false);
                  setPreviewData(null);
                  setGenerateForm({
                    payYear: new Date().getFullYear().toString(),
                    payMonth: new Date().getMonth() + 1,
                    selectedEmployees: [],
                    department: ''
                  });
                }}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
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
                  部門篩選
                </label>
                <select
                  value={generateForm.department}
                  onChange={(e) => {
                    setGenerateForm({ 
                      ...generateForm, 
                      department: e.target.value,
                      selectedEmployees: [] // 清空已選員工
                    });
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                >
                  <option value="">所有部門</option>
                  {departments.map((dept) => (
                    <option key={dept.id} value={dept.name}>{dept.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  選擇員工（留空則為{generateForm.department ? `「${generateForm.department}」部門` : '所有'}員工生成）
                </label>
                <div className="max-h-40 overflow-y-auto border border-gray-300 rounded-lg p-2">
                  {employees
                    .filter(emp => !generateForm.department || emp.department === generateForm.department)
                    .map((employee) => (
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
                        className="rounded text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-900">{employee.name} ({employee.employeeId})</span>
                      <span className="text-xs text-gray-500">- {employee.department}</span>
                    </label>
                  ))}
                  {employees.filter(emp => !generateForm.department || emp.department === generateForm.department).length === 0 && (
                    <div className="text-sm text-gray-500 text-center py-2">無符合條件的員工</div>
                  )}
                </div>
                {generateForm.department && (
                  <div className="mt-2 text-xs text-blue-600">
                    已篩選「{generateForm.department}」部門，共 {employees.filter(emp => emp.department === generateForm.department).length} 人
                  </div>
                )}
              </div>

              {/* 進度條 */}
              {(progress.isProcessing || progress.isPreviewing) && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-600">{progress.status}</span>
                    {progress.total > 0 && (
                      <span className="text-sm text-gray-600">{progress.current} / {progress.total}</span>
                    )}
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full transition-all ${progress.isProcessing ? 'bg-blue-600' : 'bg-yellow-500'}`}
                      style={{ width: progress.total > 0 ? `${(progress.current / progress.total) * 100}%` : '100%' }}
                    ></div>
                  </div>
                </div>
              )}

              {/* 預覽結果 */}
              {previewData && (
                <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <h4 className="font-semibold text-gray-900 mb-3">預覽結果</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="text-gray-700">可生成人數：<span className="font-semibold text-gray-900">{previewData.summary.previewCount}</span></div>
                    <div className="text-gray-700">已存在記錄：<span className="font-semibold text-yellow-600">{previewData.summary.existingCount}</span></div>
                    <div className="text-gray-700">總薪資：<span className="font-semibold text-gray-900">NT$ {previewData.summary.totalGrossPay.toLocaleString()}</span></div>
                    <div className="text-gray-700">含獎金：<span className="font-semibold text-green-600">NT$ {previewData.summary.totalBonus.toLocaleString()}</span></div>
                  </div>
                  {previewData.existingRecords.length > 0 && (
                    <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-700">
                      ⚠️ 已存在記錄（將略過）：{previewData.existingRecords.map(r => r.employeeName).join('、')}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowGenerateForm(false);
                    setPreviewData(null);
                    setGenerateForm({
                      payYear: new Date().getFullYear().toString(),
                      payMonth: new Date().getMonth() + 1,
                      selectedEmployees: [],
                      department: ''
                    });
                  }}
                  className="flex-1 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handlePreviewPayroll}
                  disabled={progress.isPreviewing}
                  className="flex-1 bg-yellow-500 text-white px-4 py-2 rounded-lg hover:bg-yellow-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {progress.isPreviewing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      預覽中...
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4" />
                      預覽
                    </>
                  )}
                </button>
                <button
                  type="submit"
                  disabled={progress.isProcessing}
                  className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {progress.isProcessing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      生成中...
                    </>
                  ) : '生成薪資記錄'}
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
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">創建薪資記錄</h3>
              <button
                onClick={() => {
                  setShowCreateForm(false);
                  setCreateForm({
                    employeeId: '',
                    payYear: new Date().getFullYear().toString(),
                    payMonth: new Date().getMonth() + 1
                  });
                }}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
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
