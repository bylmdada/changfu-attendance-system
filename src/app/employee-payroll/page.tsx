'use client';

import { useEffect, useMemo, useState } from 'react';
import { DollarSign, Search, FileText, Download, Calendar, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import { escapeHtml } from '@/lib/html';
import { LOGO_BASE64 } from '@/lib/logoBase64';

interface PayrollRecord {
  id: number;
  payYear: number;
  payMonth: number;
  basePay: number;
  overtimePay: number;
  overtimeHours?: number;
  regularHours?: number;
  grossPay: number;
  laborInsurance?: number;
  healthInsurance?: number;
  supplementaryInsurance?: number;
  incomeTax?: number;
  totalDeductions?: number;
  netPay: number;
}

// 新增：用於顯示導覽列歡迎字樣的使用者型別
interface AuthUser {
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

export default function EmployeePayrollPage() {
  const [records, setRecords] = useState<PayrollRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payslipLoading, setPayslipLoading] = useState(false);
  const [filters, setFilters] = useState({
    year: '',
    month: '',
    search: '',
  });
  // 新增：目前登入者
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [user, setUser] = useState<AuthUser | null>(null);

  // Toast 狀態
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // 排序狀態
  const [sortConfig, setSortConfig] = useState<{ field: 'year' | 'month' | 'netPay'; direction: 'asc' | 'desc' }>({ field: 'year', direction: 'desc' });

  // 展開加班明細狀態
  const [expandedRecords, setExpandedRecords] = useState<Set<number>>(new Set());

  // 選擇查詢年度（支援多年度）
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());

  // 可用年度列表（從記錄中推算）
  const availableYears = useMemo(() => {
    const years = [...new Set(records.map(r => r.payYear))].sort((a, b) => b - a);
    if (years.length === 0) {
      const currentYear = new Date().getFullYear();
      return [currentYear, currentYear - 1, currentYear - 2];
    }
    return years;
  }, [records]);

  // 年度統計
  const yearlyStats = useMemo(() => {
    const yearRecords = records.filter(r => r.payYear === selectedYear);
    if (yearRecords.length === 0) return null;

    const totalBasePay = yearRecords.reduce((sum, r) => sum + r.basePay, 0);
    const totalOvertimePay = yearRecords.reduce((sum, r) => sum + r.overtimePay, 0);
    const totalGrossPay = yearRecords.reduce((sum, r) => sum + r.grossPay, 0);
    const totalDeductions = yearRecords.reduce((sum, r) => sum + (r.totalDeductions || 0), 0);
    const totalNetPay = yearRecords.reduce((sum, r) => sum + r.netPay, 0);
    const avgMonthlyPay = totalNetPay / yearRecords.length;

    return {
      months: yearRecords.length,
      totalBasePay,
      totalOvertimePay,
      totalGrossPay,
      totalDeductions,
      totalNetPay,
      avgMonthlyPay
    };
  }, [records, selectedYear]);

  // 切換加班明細展開
  const toggleExpand = (id: number) => {
    setExpandedRecords(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // 匯出 Excel（CSV 格式）
  const exportToExcel = () => {
    const yearRecords = records.filter(r => r.payYear === selectedYear);
    if (yearRecords.length === 0) {
      showToast('error', '無資料可匯出');
      return;
    }

    const headers = ['年份', '月份', '本薪', '加班費', '應發合計', '勞保', '健保', '補充保費', '所得稅', '扣款合計', '實發薪資'];
    const rows: (string | number)[][] = yearRecords.map(r => [
      r.payYear,
      r.payMonth,
      r.basePay,
      r.overtimePay,
      r.grossPay,
      r.laborInsurance || 0,
      r.healthInsurance || 0,
      r.supplementaryInsurance || 0,
      r.incomeTax || 0,
      r.totalDeductions || 0,
      r.netPay
    ]);

    // 加入年度合計
    if (yearlyStats) {
      rows.push([
        selectedYear.toString(),
        '合計',
        yearlyStats.totalBasePay.toString(),
        yearlyStats.totalOvertimePay.toString(),
        yearlyStats.totalGrossPay.toString(),
        '-', '-', '-', '-',
        yearlyStats.totalDeductions.toString(),
        yearlyStats.totalNetPay.toString()
      ]);
    }

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `薪資明細_${selectedYear}年.csv`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('success', `已匯出 ${selectedYear} 年薪資明細`);
  };

  // Toast 顯示函數
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  // 排序函數
  const handleSort = (field: 'year' | 'month' | 'netPay') => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 取得登入者資訊（用於顯示歡迎字樣）
        const userRes = await fetch('/api/auth/me', { credentials: 'include' });
        if (userRes.ok) {
          const userData = await userRes.json();
          setUser(userData.user || userData);
        }

        // 取得薪資記錄
        const now = new Date();
        const year = now.getFullYear();
        const payrollRes = await fetch(`/api/payroll?year=${year}`, { credentials: 'include' });
        if (!payrollRes.ok) {
          throw new Error(`${payrollRes.status}`);
        }
        const payrollData = await payrollRes.json();
        setRecords(payrollData.payrollRecords || []);
      } catch (e) {
        setError(`載入失敗: ${e instanceof Error ? e.message : '未知錯誤'}`);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const filtered = useMemo(() => {
    let list = [...records];

    if (filters.year) list = list.filter(r => String(r.payYear) === filters.year);
    if (filters.month) list = list.filter(r => String(r.payMonth).padStart(2, '0') === filters.month.padStart(2, '0'));
    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(r => `${r.payYear}/${String(r.payMonth).padStart(2, '0')}`.includes(q));
    }

    // 依排序設定排序
    list.sort((a, b) => {
      const direction = sortConfig.direction === 'asc' ? 1 : -1;
      switch (sortConfig.field) {
        case 'year':
          return direction * (a.payYear !== b.payYear ? a.payYear - b.payYear : a.payMonth - b.payMonth);
        case 'month':
          return direction * (a.payMonth !== b.payMonth ? a.payMonth - b.payMonth : a.payYear - b.payYear);
        case 'netPay':
          return direction * (a.netPay - b.netPay);
        default:
          return 0;
      }
    });
    return list;
  }, [records, filters, sortConfig]);

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
        showToast('error', '生成薪資條失敗');
      }
    } catch (error) {
      console.error('生成薪資條失敗:', error);
      showToast('error', '生成薪資條失敗');
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
        
        // 檢查是否有密碼保護
        if (data.security?.hasPassword) {
          showToast('success', `${data.security.hint}`);
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
          showToast('success', '已開啟列印預覽');
        }
      } else {
        showToast('error', '生成PDF薪資條失敗');
      }
    } catch (error) {
      console.error('生成PDF薪資條失敗:', error);
      showToast('error', '生成PDF薪資條失敗');
    }
    setPayslipLoading(false);
  };

  const generatePayslipHTML = (payslip: Payslip) => {
    const safeCompanyName = escapeHtml(payslip.companyInfo?.name || '社團法人宜蘭縣長期照護及社會福祉推廣協會');
    const safeFooterCompanyName = escapeHtml(payslip.companyInfo?.name || '長福會');
    const safeEmployeeId = escapeHtml(payslip.employee.employeeId);
    const safeEmployeeName = escapeHtml(payslip.employee.name);
    const safeEmployeeDepartment = escapeHtml(payslip.employee.department || 'N/A');
    const safeEmployeePosition = escapeHtml(payslip.employee.position || 'N/A');
    const safeMonthName = escapeHtml(payslip.period.monthName);
    const safeGeneratedAt = escapeHtml(new Date(payslip.generatedAt).toLocaleString('zh-TW'));

    // 生成收入項目表格行
    const earningsRows = payslip.earnings?.map((item: PayslipItem) => {
      const safeItemName = escapeHtml(item.name);
      const quantityLabel = (item.quantity ?? 0) > 1 ? ` (${escapeHtml(item.quantity)})` : '';

      return `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${safeItemName}${quantityLabel}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #059669; font-weight: 500;">NT$ ${item.amount.toLocaleString()}</td>
      </tr>
    `;
    }).join('') || '';

    // 生成扣除項目表格行
    const deductionsRows = payslip.deductions?.map((item: PayslipItem) => {
      const safeItemName = escapeHtml(item.name);
      const quantityLabel = (item.quantity ?? 0) > 1 ? ` (${escapeHtml(item.quantity)})` : '';

      return `
      <tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">${safeItemName}${quantityLabel}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #dc2626;">NT$ ${item.amount.toLocaleString()}</td>
      </tr>
    `;
    }).join('') || '';

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>薪資條 - ${safeEmployeeName} - ${safeMonthName}</title>
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
                <p>${safeCompanyName}</p>
              </div>
            </div>
            <div class="period-badge">${safeMonthName}</div>
          </div>
          <div class="employee-info">
            <div class="info-card">
              <h3>👤 員工資訊</h3>
              <div class="info-item"><span class="info-label">員工編號</span><span class="info-value">${safeEmployeeId}</span></div>
              <div class="info-item"><span class="info-label">姓名</span><span class="info-value">${safeEmployeeName}</span></div>
              <div class="info-item"><span class="info-label">部門</span><span class="info-value">${safeEmployeeDepartment}</span></div>
              <div class="info-item"><span class="info-label">職位</span><span class="info-value">${safeEmployeePosition}</span></div>
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
              🔒 本薪資條專供 ${safeEmployeeName} (${safeEmployeeId}) 查閱，請妥善保管
            </div>
            <p>生成時間：${safeGeneratedAt}</p>
            <p style="margin-top: 4px;">${safeFooterCompanyName} | 如有疑問請洽人事部門</p>
          </div>
        </div>
      </div>
    </body>
    </html>
    `;
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-600">載入中...</div>;
  if (error) return <div className="min-h-screen flex items-center justify-center text-red-600">{error}</div>;

  return (
    <AuthenticatedLayout>
      <div className="max-w-6xl mx-auto p-6">
        {/* 標題區 */}
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <DollarSign className="w-8 h-8 text-emerald-600 mr-3" />
            薪資查詢
          </h1>
          <div className="flex items-center gap-3">
            {/* 年度選擇 */}
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-gray-500" />
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2 text-gray-900 bg-white focus:ring-2 focus:ring-emerald-500"
              >
                {availableYears.map(year => (
                  <option key={year} value={year}>{year} 年</option>
                ))}
              </select>
            </div>
            {/* 匯出按鈕 */}
            <button
              onClick={exportToExcel}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
            >
              <Download className="h-4 w-4" />
              匯出 Excel
            </button>
          </div>
        </div>

        {/* 年度統計摘要 */}
        {yearlyStats && (
          <div className="bg-gradient-to-r from-emerald-50 to-blue-50 border border-emerald-200 rounded-xl p-6 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="h-5 w-5 text-emerald-600" />
              <h2 className="text-lg font-bold text-gray-900">{selectedYear} 年度統計</h2>
              <span className="text-sm text-gray-500">（共 {yearlyStats.months} 筆記錄）</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <div className="bg-white rounded-lg p-4 shadow-sm">
                <p className="text-sm text-gray-500">年度總本薪</p>
                <p className="text-xl font-bold text-gray-900">{yearlyStats.totalBasePay.toLocaleString()}</p>
              </div>
              <div className="bg-white rounded-lg p-4 shadow-sm">
                <p className="text-sm text-gray-500">年度加班費</p>
                <p className="text-xl font-bold text-orange-600">{yearlyStats.totalOvertimePay.toLocaleString()}</p>
              </div>
              <div className="bg-white rounded-lg p-4 shadow-sm">
                <p className="text-sm text-gray-500">年度應發合計</p>
                <p className="text-xl font-bold text-blue-600">{yearlyStats.totalGrossPay.toLocaleString()}</p>
              </div>
              <div className="bg-white rounded-lg p-4 shadow-sm">
                <p className="text-sm text-gray-500">年度總扣款</p>
                <p className="text-xl font-bold text-red-600">-{yearlyStats.totalDeductions.toLocaleString()}</p>
              </div>
              <div className="bg-white rounded-lg p-4 shadow-sm border-2 border-emerald-300">
                <p className="text-sm text-gray-500">年度實發合計</p>
                <p className="text-xl font-bold text-emerald-700">{yearlyStats.totalNetPay.toLocaleString()}</p>
              </div>
              <div className="bg-white rounded-lg p-4 shadow-sm">
                <p className="text-sm text-gray-500">月平均實發</p>
                <p className="text-xl font-bold text-gray-700">{Math.round(yearlyStats.avgMonthlyPay).toLocaleString()}</p>
              </div>
            </div>
          </div>
        )}
        {/* 篩選列 */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              placeholder="年份，例如 2025"
              className="border border-gray-300 rounded px-3 py-2 text-gray-900"
              value={filters.year}
              onChange={(e)=>setFilters(prev=>({...prev, year: e.target.value }))}
            />
            <input
              placeholder="月份，01~12"
              className="border border-gray-300 rounded px-3 py-2 text-gray-900"
              value={filters.month}
              onChange={(e)=>setFilters(prev=>({...prev, month: e.target.value }))}
            />
            <div className="col-span-2 flex items-center gap-2">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <input
                  placeholder="搜尋 年/月 例如 2025/08"
                  className="w-full border border-gray-300 rounded pl-9 pr-3 py-2 text-gray-900"
                  value={filters.search}
                  onChange={(e)=>setFilters(prev=>({...prev, search: e.target.value }))}
                />
              </div>
              <button
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2 transition-colors"
                onClick={() => {
                  // 觸發重新過濾，實際上篩選是即時的，這個按鈕主要用於用戶體驗
                  console.log('搜尋條件:', filters);
                }}
              >
                <Search className="w-4 h-4" />
                搜尋
              </button>
              <button
                className="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 transition-colors"
                onClick={()=>setFilters({ year:'', month:'', search:'' })}
              >清除</button>
            </div>
          </div>
          {/* 排序按鈕 */}
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-200">
            <span className="text-sm text-gray-600">排序：</span>
            <button
              className={`px-3 py-1 text-sm rounded ${sortConfig.field === 'year' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              onClick={() => handleSort('year')}
            >
              年度 {sortConfig.field === 'year' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
            </button>
            <button
              className={`px-3 py-1 text-sm rounded ${sortConfig.field === 'month' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              onClick={() => handleSort('month')}
            >
              月份 {sortConfig.field === 'month' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
            </button>
            <button
              className={`px-3 py-1 text-sm rounded ${sortConfig.field === 'netPay' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              onClick={() => handleSort('netPay')}
            >
              實領 {sortConfig.field === 'netPay' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center text-gray-500">尚無薪資記錄</div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filtered.map((r) => (
              <div key={r.id} className="bg-white border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-semibold text-gray-900">{r.payYear} 年 {String(r.payMonth).padStart(2,'0')} 月</div>
                  <div className="text-green-700 font-bold">實領：{r.netPay.toLocaleString()} 元</div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm text-gray-700 mb-3">
                  <div>本薪：{r.basePay.toLocaleString()}</div>
                  {/* 加班費（可展開） */}
                  <div className="flex items-center gap-1">
                    <span>加班費：{r.overtimePay.toLocaleString()}</span>
                    {r.overtimePay > 0 && (
                      <button
                        onClick={() => toggleExpand(r.id)}
                        className="p-0.5 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600"
                        title={expandedRecords.has(r.id) ? '收合明細' : '展開明細'}
                      >
                        {expandedRecords.has(r.id) ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>
                  <div>應發：{r.grossPay.toLocaleString()}</div>
                  {typeof r.laborInsurance === 'number' && <div>勞保：{r.laborInsurance.toLocaleString()}</div>}
                  {typeof r.healthInsurance === 'number' && <div>健保：{r.healthInsurance.toLocaleString()}</div>}
                  {typeof r.supplementaryInsurance === 'number' && <div>補充保費：{r.supplementaryInsurance.toLocaleString()}</div>}
                  {typeof r.incomeTax === 'number' && <div>所得稅：{r.incomeTax.toLocaleString()}</div>}
                  {typeof r.totalDeductions === 'number' && <div>扣款合計：{r.totalDeductions.toLocaleString()}</div>}
                </div>
                
                {/* 加班費明細展開區 */}
                {expandedRecords.has(r.id) && r.overtimePay > 0 && (
                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-3 text-sm">
                    <div className="font-medium text-orange-800 mb-2 flex items-center gap-1">
                      <TrendingUp className="h-4 w-4" />
                      加班費明細
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-gray-700">
                      {r.overtimeHours !== undefined && (
                        <div>加班時數：<span className="font-semibold">{r.overtimeHours} 小時</span></div>
                      )}
                      {r.regularHours !== undefined && (
                        <div>正常工時：<span className="font-semibold">{r.regularHours} 小時</span></div>
                      )}
                      {r.overtimeHours !== undefined && r.overtimePay > 0 && (
                        <div>時薪計算：<span className="font-semibold">{Math.round(r.overtimePay / (r.overtimeHours || 1)).toLocaleString()} 元/時</span></div>
                      )}
                      {!r.overtimeHours && (
                        <div className="col-span-2 text-gray-500 italic">加班時數資料暫無提供</div>
                      )}
                    </div>
                  </div>
                )}
                
                <div className="flex gap-2 pt-2 border-t border-gray-100">
                  <button
                    onClick={() => generatePayslip(r.id)}
                    disabled={payslipLoading}
                    className="flex items-center gap-1 px-3 py-1 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
                  >
                    <FileText className="h-4 w-4" />
                    HTML薪資條
                  </button>
                  <button
                    onClick={() => generatePayslipPDF(r.id)}
                    disabled={payslipLoading}
                    className="flex items-center gap-1 px-3 py-1 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
                  >
                    <Download className="h-4 w-4" />
                    列印薪資條
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
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
