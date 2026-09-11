'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { 
  FileText, 
  Download, 
  Calculator, 
  TrendingUp,
  Users,
  DollarSign,
  Calendar,
  Search
} from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import EmployeeListSelect from '@/components/EmployeeListSelect';
import ConfirmDialog from '@/components/ConfirmDialog';
import { LOGO_BASE64 } from '@/lib/logoBase64';
import { escapeCsvValue } from '@/lib/csv';
import { escapeHtml } from '@/lib/html';

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

interface InsuranceReportRecord {
  employeeId: string;
  name: string;
  department: string | null;
  baseSalary: number;
  insuredBase: number;
  laborInsuredAmount: number;
  laborEmployee: number;
  laborEmployer: number;
  laborTotal: number;
  healthInsuredAmount: number;
  dependents: number;
  totalPersons: number;
  healthEmployee: number;
  healthEmployer: number;
  healthTotal: number;
  totalEmployee: number;
  totalEmployer: number;
  isHealthActive: boolean;
}

interface TaxReportRecord {
  employeeId: string;
  name: string;
  department: string;
  hireDate: string;
  totalBasePay: number;
  totalOvertimePay: number;
  totalGrossPay: number;
  totalLaborInsurance: number;
  totalHealthInsurance: number;
  totalLaborPensionSelf: number;
  totalIncomeTax: number;
  totalNetPay: number;
  months: number;
  taxExempt: number;
  taxableIncome: number;
}

interface TransferReportRecord {
  employeeId: string;
  transferDate: string;
  idNumber: string;
  bankAccount: string;
  amount: number | null;
  name: string;
  department: string;
}

interface TransferValidationError {
  employeeId: string;
  name: string;
  department: string;
  reasons: string[];
}

type ReportType = 'salary' | 'labor_insurance' | 'health_insurance' | 'income_tax' | 'salary_transfer' | 'year_end_transfer';

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

// 法規設定介面（勞保 + 健保分開來源）
interface LaborLawConfig {
  // 勞保（來自 labor-law-config）
  basicWage: number;
  laborInsuranceRate: number;
  employmentInsuranceRate: number;
  laborInsuranceMax: number;
  laborEmployeeRate: number;
  // 健保（來自 health-insurance-formula）
  healthInsuranceRate: number;
  healthEmployeeRate: number;
  maxDependents: number;
}

// 預設法規設定
const DEFAULT_CONFIG: LaborLawConfig = {
  basicWage: 29500,
  laborInsuranceRate: 0.115,
  employmentInsuranceRate: 0.01,
  laborInsuranceMax: 45800,
  laborEmployeeRate: 0.2,
  healthInsuranceRate: 0.0517,
  healthEmployeeRate: 0.3,
  maxDependents: 3
};

export default function ReportsPage() {
  const [payrollRecords, setPayrollRecords] = useState<PayrollRecord[]>([]);
  const [insuranceRecords, setInsuranceRecords] = useState<InsuranceReportRecord[]>([]);
  const [taxRecords, setTaxRecords] = useState<TaxReportRecord[]>([]);
  const [transferRecords, setTransferRecords] = useState<TransferReportRecord[]>([]);
  const [transferValidationErrors, setTransferValidationErrors] = useState<TransferValidationError[]>([]);
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [payslipLoading, setPayslipLoading] = useState(false);
  const [pendingPayslipPrint, setPendingPayslipPrint] = useState<{ message: string; htmlContent: string } | null>(null);
  
  // Toast 狀態
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // 排序狀態
  const [sortConfig, setSortConfig] = useState<{ field: 'employee' | 'period' | 'grossPay' | 'netPay'; direction: 'asc' | 'desc' }>({ field: 'employee', direction: 'asc' });
  
  // 批量選擇狀態
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  
  // 報表類型
  const [reportType, setReportType] = useState<ReportType>('salary');

  // 法規設定
  const [laborLawConfig, setLaborLawConfig] = useState<LaborLawConfig>(DEFAULT_CONFIG);
  const effectiveMonth = selectedMonth ?? (new Date().getMonth() + 1);
  const isTransferReport = reportType === 'salary_transfer' || reportType === 'year_end_transfer';
  const transferApiType = reportType === 'year_end_transfer' ? 'bonus' : 'salary';

  // Toast 顯示函數
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  // 載入法規設定（從兩個 API 分別讀取勞保和健保）
  const fetchLaborLawConfig = useCallback(async () => {
    try {
      // 讀取勞保設定
      const laborResponse = await fetch('/api/system-settings/labor-law-config', {
        credentials: 'include'
      });
      
      // 讀取健保設定
      const healthResponse = await fetch('/api/system-settings/health-insurance-formula', {
        credentials: 'include'
      });
      
      const newConfig = { ...DEFAULT_CONFIG };
      
      if (laborResponse.ok) {
        const laborData = await laborResponse.json();
        if (laborData.config) {
          newConfig.basicWage = laborData.config.basicWage || DEFAULT_CONFIG.basicWage;
          newConfig.laborInsuranceRate = laborData.config.laborInsuranceRate || DEFAULT_CONFIG.laborInsuranceRate;
          newConfig.employmentInsuranceRate = laborData.config.employmentInsuranceRate || DEFAULT_CONFIG.employmentInsuranceRate;
          newConfig.laborInsuranceMax = laborData.config.laborInsuranceMax || DEFAULT_CONFIG.laborInsuranceMax;
          newConfig.laborEmployeeRate = laborData.config.laborEmployeeRate || DEFAULT_CONFIG.laborEmployeeRate;
        }
      }
      
      if (healthResponse.ok) {
        const healthData = await healthResponse.json();
        if (healthData.config) {
          newConfig.healthInsuranceRate = healthData.config.premiumRate || DEFAULT_CONFIG.healthInsuranceRate;
          newConfig.healthEmployeeRate = healthData.config.employeeContributionRatio || DEFAULT_CONFIG.healthEmployeeRate;
          newConfig.maxDependents = healthData.config.maxDependents || DEFAULT_CONFIG.maxDependents;
        }
      }
      
      setLaborLawConfig(newConfig);
    } catch (error) {
      console.error('載入法規設定失敗:', error);
    }
  }, []);

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

  const fetchReportData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedYear) params.append('year', selectedYear.toString());
      if (isTransferReport) {
        params.append('month', effectiveMonth.toString());
        params.append('format', 'json');
        params.append('type', transferApiType);
      } else if (selectedMonth && reportType !== 'income_tax') {
        params.append('month', selectedMonth.toString());
      }

      const endpoint = reportType === 'salary'
        ? `/api/payroll?${params}`
        : reportType === 'income_tax'
          ? `/api/reports/tax-declaration?${params}`
          : isTransferReport
            ? `/api/reports/yuanta-transfer?${params}`
          : `/api/reports/insurance-payment?${params}`;

      const response = await fetch(endpoint, {
        credentials: 'include',
      });

      if (!response.ok) {
        if (isTransferReport) {
          const errorData = await response.json().catch(() => null);
          setTransferRecords([]);
          setTransferValidationErrors(errorData?.details || []);
          if (errorData?.error) {
            showToast('error', errorData.error);
          }
        } else {
          setTransferValidationErrors([]);
        }
        setPayrollRecords([]);
        setInsuranceRecords([]);
        setTaxRecords([]);
        setTransferRecords([]);
        setStats({
          totalEmployees: 0,
          totalGrossPay: 0,
          totalNetPay: 0,
          totalOvertimeHours: 0,
          avgSalary: 0,
        });
        return;
      }

      const data = await response.json();

      if (reportType === 'salary') {
        const records = data.payrollRecords || [];
        setPayrollRecords(records);
        setInsuranceRecords([]);
        setTaxRecords([]);
        setTransferRecords([]);
        setTransferValidationErrors([]);

        const totalEmployees = records.length;
        const totalGrossPay = records.reduce((sum: number, record: PayrollRecord) => sum + record.grossPay, 0);
        const totalNetPay = records.reduce((sum: number, record: PayrollRecord) => sum + record.netPay, 0);
        const totalOvertimeHours = records.reduce((sum: number, record: PayrollRecord) => sum + record.overtimeHours, 0);
        const avgSalary = totalEmployees > 0 ? totalGrossPay / totalEmployees : 0;

        setStats({
          totalEmployees,
          totalGrossPay,
          totalNetPay,
          totalOvertimeHours,
          avgSalary
        });
      } else if (reportType === 'income_tax') {
        const records = data.records || [];
        setPayrollRecords([]);
        setInsuranceRecords([]);
        setTaxRecords(records);
        setTransferRecords([]);
        setTransferValidationErrors([]);
        setStats({
          totalEmployees: records.length,
          totalGrossPay: data.summary?.totalGrossPay || 0,
          totalNetPay: 0,
          totalOvertimeHours: 0,
          avgSalary: records.length > 0 ? (data.summary?.totalGrossPay || 0) / records.length : 0,
        });
      } else if (isTransferReport) {
        const records = data.records || [];
        setPayrollRecords([]);
        setInsuranceRecords([]);
        setTaxRecords([]);
        setTransferRecords(records);
        setTransferValidationErrors(data.warnings || []);
        setStats({
          totalEmployees: records.length,
          totalGrossPay: 0,
          totalNetPay: data.summary?.totalAmount || 0,
          totalOvertimeHours: 0,
          avgSalary: records.length > 0 ? (data.summary?.totalAmount || 0) / records.length : 0,
        });
      } else {
        const records = data.records || [];
        setPayrollRecords([]);
        setInsuranceRecords(records);
        setTaxRecords([]);
        setTransferRecords([]);
        setTransferValidationErrors([]);
        setStats({
          totalEmployees: records.length,
          totalGrossPay: 0,
          totalNetPay: 0,
          totalOvertimeHours: 0,
          avgSalary: 0,
        });
      }
    } catch (error) {
      console.error('獲取報表數據失敗:', error);
      setPayrollRecords([]);
      setInsuranceRecords([]);
      setTaxRecords([]);
      setTransferRecords([]);
      setTransferValidationErrors([]);
      setStats({
        totalEmployees: 0,
        totalGrossPay: 0,
        totalNetPay: 0,
        totalOvertimeHours: 0,
        avgSalary: 0,
      });
    }
    setLoading(false);
  }, [effectiveMonth, isTransferReport, reportType, selectedMonth, selectedYear, transferApiType]);

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
        showToast('success', '薪資條下載成功');
      } else {
        showToast('error', '薪資條生成失敗');
      }
    } catch (error) {
      console.error('生成薪資條失敗:', error);
      showToast('error', '薪資條生成失敗');
    }
    setPayslipLoading(false);
  };

  const printPayslipHtml = (htmlContent: string) => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      
      // 等待內容載入完成後觸發列印
      printWindow.onload = () => {
        printWindow.print();
        printWindow.close();
      };
    }
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
          const message = `此薪資條有密碼保護：\n\n${data.security.hint}\n\n是否繼續列印？`;
          setPendingPayslipPrint({ message, htmlContent: data.htmlContent });
          setPayslipLoading(false);
          return;
        }
        
        printPayslipHtml(data.htmlContent);
      }
    } catch (error) {
      console.error('生成PDF薪資條失敗:', error);
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
        /* 浮水印 */
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
        /* 標題區 */
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
        /* 員工資訊區 */
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
        /* 薪資明細區 */
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
        .total-row td {
          font-weight: 600 !important;
          background: #f9fafb;
        }
        /* 實領薪資區 */
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
        /* 頁尾 */
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
        /* 列印樣式 */
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
        <!-- 浮水印 -->
        <div class="watermark">內部機密 僅限本人查閱</div>
        
        <div class="content">
          <!-- 標題區 -->
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

          <!-- 員工資訊區 -->
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

          <!-- 薪資明細區 -->
          <div class="salary-section">
            <!-- 收入項目 -->
            <div class="section-header income">💰 收入項目</div>
            <table class="salary-table">
              ${earningsRows}
              <tr class="total-row">
                <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">應發合計</td>
                <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #059669; font-size: 16px;">NT$ ${payslip.summary?.totalEarnings?.toLocaleString() || '0'}</td>
              </tr>
            </table>

            <!-- 扣除項目 -->
            <div class="section-header deduction" style="margin-top: 16px;">📉 扣除項目</div>
            <table class="salary-table">
              ${deductionsRows}
              <tr class="total-row">
                <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">扣除合計</td>
                <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #dc2626; font-size: 16px;">NT$ ${payslip.summary?.totalDeductions?.toLocaleString() || '0'}</td>
              </tr>
            </table>
          </div>

          <!-- 實領薪資區 -->
          <div class="net-pay-section">
            <span class="net-pay-label">實領薪資</span>
            <span class="net-pay-amount">NT$ ${payslip.summary?.netPay?.toLocaleString() || '0'}</span>
          </div>

          <!-- 頁尾 -->
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

  const exportToPDF = async () => {
    if (reportType !== 'salary') {
      showToast('error', '目前僅支援薪資報表 PDF 匯出');
      return;
    }

    try {
      const params = new URLSearchParams();
      
      if (selectedYear) params.append('year', selectedYear.toString());
      if (selectedMonth) params.append('month', selectedMonth.toString());
      if (selectedDepartment) params.append('department', selectedDepartment);

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

  const downloadCsvFile = (content: string, filename: string, successMessage: string) => {
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('success', successMessage);
  };

  const getReportCsvConfig = () => {
    const monthStr = selectedMonth ? `${selectedMonth}月` : '全年';

    if (reportType === 'salary') {
      const headers = [
        '員工編號', '姓名', '部門', '職位', '年度', '月份',
        '正常工時', '加班工時', '基本薪資', '加班費', '總薪資', '實領薪資'
      ];

      const rows = sortedRecords.map(record => [
        escapeCsvValue(record.employee.employeeId),
        escapeCsvValue(record.employee.name),
        escapeCsvValue(record.employee.department || ''),
        escapeCsvValue(record.employee.position || ''),
        escapeCsvValue(record.payYear),
        escapeCsvValue(record.payMonth),
        escapeCsvValue(record.regularHours),
        escapeCsvValue(record.overtimeHours),
        escapeCsvValue(record.basePay),
        escapeCsvValue(record.overtimePay),
        escapeCsvValue(record.grossPay),
        escapeCsvValue(record.netPay)
      ].join(','));

      return {
        filename: `薪資報表_${selectedYear}年${monthStr}.csv`,
        rows: [headers.map(escapeCsvValue).join(','), ...rows],
      };
    }

    if (reportType === 'income_tax') {
      const headers = [
        '員工編號', '姓名', '部門', '到職日', '總薪資', '加班費', '免稅所得',
        '勞保自付', '健保自付', '勞退自提', '應稅所得', '扣繳稅額', '實領薪資'
      ];

      const rows = filteredTaxRecords.map(record => [
        escapeCsvValue(record.employeeId),
        escapeCsvValue(record.name),
        escapeCsvValue(record.department || ''),
        escapeCsvValue(record.hireDate),
        escapeCsvValue(record.totalGrossPay),
        escapeCsvValue(record.totalOvertimePay),
        escapeCsvValue(record.taxExempt),
        escapeCsvValue(record.totalLaborInsurance),
        escapeCsvValue(record.totalHealthInsurance),
        escapeCsvValue(record.totalLaborPensionSelf),
        escapeCsvValue(record.taxableIncome),
        escapeCsvValue(record.totalIncomeTax),
        escapeCsvValue(record.totalNetPay),
      ].join(','));

      return {
        filename: `所得稅報表_${selectedYear}年.csv`,
        rows: [headers.map(escapeCsvValue).join(','), ...rows],
      };
    }

    if (isTransferReport) {
      const headers = [
        '轉帳日期(yyyymmdd)', '員工編號', '姓名', '部門', '受款人身分證字號', '受款人帳號', '實領薪資'
      ];

      const rows = filteredTransferRecords.map(record => [
        escapeCsvValue(record.transferDate),
        escapeCsvValue(record.employeeId),
        escapeCsvValue(record.name),
        escapeCsvValue(record.department),
        escapeCsvValue(record.idNumber),
        escapeCsvValue(record.bankAccount),
        escapeCsvValue(record.amount ?? ''),
      ].join(','));

      return {
        filename: `${reportType === 'year_end_transfer' ? '年終薪轉報表' : '元大薪轉報表'}_${selectedYear}年${effectiveMonth}月.csv`,
        rows: [headers.map(escapeCsvValue).join(','), ...rows],
      };
    }

    const headers = reportType === 'labor_insurance'
      ? ['員工編號', '姓名', '部門', '底薪', '投保薪資', '員工負擔', '公司負擔', '勞保總額']
      : ['員工編號', '姓名', '部門', '投保薪資', '眷屬數', '納保人數', '員工負擔', '公司負擔', '健保總額', '是否加保'];

    const rows = filteredInsuranceRecords.map(record => (
      reportType === 'labor_insurance'
        ? [
            escapeCsvValue(record.employeeId),
            escapeCsvValue(record.name),
            escapeCsvValue(record.department || ''),
            escapeCsvValue(record.baseSalary),
            escapeCsvValue(record.laborInsuredAmount),
            escapeCsvValue(record.laborEmployee),
            escapeCsvValue(record.laborEmployer),
            escapeCsvValue(record.laborTotal),
          ]
        : [
            escapeCsvValue(record.employeeId),
            escapeCsvValue(record.name),
            escapeCsvValue(record.department || ''),
            escapeCsvValue(record.healthInsuredAmount),
            escapeCsvValue(record.dependents),
            escapeCsvValue(record.totalPersons),
            escapeCsvValue(record.healthEmployee),
            escapeCsvValue(record.healthEmployer),
            escapeCsvValue(record.healthTotal),
            escapeCsvValue(record.isHealthActive ? '是' : '否'),
          ]
    ).join(','));

    return {
      filename: `${reportType === 'labor_insurance' ? '勞保' : '健保'}報表_${selectedYear}年${monthStr}.csv`,
      rows: [headers.map(escapeCsvValue).join(','), ...rows],
    };
  };

  const exportToCSV = () => {
    const { filename, rows } = getReportCsvConfig();
    downloadCsvFile(rows.join('\n'), filename, 'CSV 報表匯出成功');
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

        // 載入法規設定
        fetchLaborLawConfig();
      } catch (error) {
        console.error('獲取用戶信息失敗:', error);
      }
    };

    fetchUserAndData();
  }, [fetchLaborLawConfig]);

  useEffect(() => {
    if (!user) return;
    setSelectedIds(new Set());
    fetchReportData();
  }, [fetchReportData, reportType, user]);

  // 部門名稱列表
  const departmentNames = departments.map(d => d.name);

  // 過濾薪資記錄（含部門篩選）
  const filteredRecords = payrollRecords.filter(record => {
    if (selectedDepartment && record.employee.department !== selectedDepartment) {
      return false;
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        record.employee.name.toLowerCase().includes(query) ||
        record.employee.employeeId.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const filteredInsuranceRecords = insuranceRecords.filter(record => {
    if (selectedDepartment && record.department !== selectedDepartment) {
      return false;
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        record.name.toLowerCase().includes(query) ||
        record.employeeId.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const filteredTaxRecords = taxRecords.filter(record => {
    if (selectedDepartment && record.department !== selectedDepartment) {
      return false;
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        record.name.toLowerCase().includes(query) ||
        record.employeeId.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const filteredTransferRecords = transferRecords.filter(record => {
    if (selectedDepartment && record.department !== selectedDepartment) {
      return false;
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        record.name.toLowerCase().includes(query) ||
        record.employeeId.toLowerCase().includes(query)
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

  const displayStats = useMemo(() => {
    if (reportType === 'salary') {
      const totalEmployees = filteredRecords.length;
      const totalGrossPay = filteredRecords.reduce((sum, record) => sum + record.grossPay, 0);
      const totalNetPay = filteredRecords.reduce((sum, record) => sum + record.netPay, 0);
      const totalOvertimeHours = filteredRecords.reduce((sum, record) => sum + record.overtimeHours, 0);

      return {
        totalEmployees,
        totalGrossPay,
        totalNetPay,
        totalOvertimeHours,
        avgSalary: totalEmployees > 0 ? totalGrossPay / totalEmployees : 0,
      };
    }

    if (reportType === 'income_tax') {
      const totalEmployees = filteredTaxRecords.length;
      const totalGrossPay = filteredTaxRecords.reduce((sum, record) => sum + record.totalGrossPay, 0);
      const totalNetPay = filteredTaxRecords.reduce((sum, record) => sum + record.totalNetPay, 0);

      return {
        totalEmployees,
        totalGrossPay,
        totalNetPay,
        totalOvertimeHours: 0,
        avgSalary: totalEmployees > 0 ? totalGrossPay / totalEmployees : 0,
      };
    }

    if (isTransferReport) {
      const totalEmployees = filteredTransferRecords.length;
      const totalNetPay = filteredTransferRecords.reduce((sum, record) => sum + (record.amount ?? 0), 0);

      return {
        totalEmployees,
        totalGrossPay: 0,
        totalNetPay,
        totalOvertimeHours: 0,
        avgSalary: totalEmployees > 0 ? totalNetPay / totalEmployees : 0,
      };
    }

    return {
      totalEmployees: filteredInsuranceRecords.length,
      totalGrossPay: 0,
      totalNetPay: 0,
      totalOvertimeHours: 0,
      avgSalary: 0,
    };
  }, [filteredInsuranceRecords, filteredRecords, filteredTaxRecords, filteredTransferRecords, isTransferReport, reportType]);

  // 批量匯出薪資條
  const batchExportPayslips = async () => {
    if (selectedIds.size === 0) return;
    
    setPayslipLoading(true);
    try {
      const selectedRecords = sortedRecords.filter(r => selectedIds.has(r.id));
      let successCount = 0;
      const failedIds: number[] = [];
      
      for (const record of selectedRecords) {
        const response = await fetch(`/api/payroll/payslip?payrollId=${record.id}`, {
          credentials: 'include',
        });
        
        if (response.ok) {
          const data = await response.json();
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
          // 使用延遲釋放，確保每個檔案都下載完成
          await new Promise(resolve => setTimeout(resolve, 500));
          URL.revokeObjectURL(url);
          successCount++;
        } else {
          failedIds.push(record.id);
        }
      }

      if (successCount === 0) {
        showToast('error', '批量匯出失敗，請稍後再試');
        return;
      }

      showToast('success', `已成功匯出 ${successCount} 份薪資條`);
      if (failedIds.length > 0) {
        showToast('error', `另有 ${failedIds.length} 份薪資條匯出失敗`);
      }
      setSelectedIds(new Set(failedIds));
    } catch (error) {
      console.error('批量匯出失敗:', error);
      showToast('error', '批量匯出失敗');
    }
    setPayslipLoading(false);
  };

  // 匯出 Excel 格式 (使用 CSV 格式，Excel 可正常開啟)
  const exportToExcel = async () => {
    if (isTransferReport) {
      try {
        const params = new URLSearchParams({
          year: selectedYear.toString(),
          month: effectiveMonth.toString(),
          type: transferApiType,
        });
        const response = await fetch(`/api/reports/yuanta-transfer?${params.toString()}`, {
          credentials: 'include',
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          setTransferValidationErrors(errorData?.details || []);
          showToast('error', errorData?.error || '薪轉報表匯出失敗');
          return;
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${reportType === 'year_end_transfer' ? '元大薪轉_年終獎金' : '元大薪轉_薪水'}_${selectedYear}${effectiveMonth.toString().padStart(2, '0')}.xls`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('success', `${reportType === 'year_end_transfer' ? '年終薪轉' : '元大薪轉'}報表匯出成功`);
        return;
      } catch (error) {
        console.error('匯出薪轉報表失敗:', error);
        showToast('error', `${reportType === 'year_end_transfer' ? '年終薪轉' : '薪轉'}報表匯出失敗`);
        return;
      }
    }

    const { filename, rows } = getReportCsvConfig();
    downloadCsvFile(rows.join('\n'), filename, 'Excel 報表匯出成功');
  };

  const currentRecordCount = reportType === 'salary'
    ? sortedRecords.length
    : reportType === 'income_tax'
      ? filteredTaxRecords.length
      : isTransferReport
        ? filteredTransferRecords.length
        : filteredInsuranceRecords.length;

  const laborInsuranceSummary = {
    employee: filteredInsuranceRecords.reduce((sum, record) => sum + record.laborEmployee, 0),
    employer: filteredInsuranceRecords.reduce((sum, record) => sum + record.laborEmployer, 0),
    total: filteredInsuranceRecords.reduce((sum, record) => sum + record.laborTotal, 0),
  };

  const healthInsuranceSummary = {
    employee: filteredInsuranceRecords.reduce((sum, record) => sum + record.healthEmployee, 0),
    employer: filteredInsuranceRecords.reduce((sum, record) => sum + record.healthEmployer, 0),
    total: filteredInsuranceRecords.reduce((sum, record) => sum + record.healthTotal, 0),
    activeEmployees: filteredInsuranceRecords.filter(record => record.isHealthActive).length,
  };

  const incomeTaxSummary = {
    withholding: filteredTaxRecords.reduce((sum, record) => sum + record.totalIncomeTax, 0),
    taxableIncome: filteredTaxRecords.reduce((sum, record) => sum + record.taxableIncome, 0),
    netPay: filteredTaxRecords.reduce((sum, record) => sum + record.totalNetPay, 0),
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
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
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
                value={selectedMonth ?? ''}
                onChange={(e) => setSelectedMonth(e.target.value ? parseInt(e.target.value) : null)}
                disabled={reportType === 'income_tax'}
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
                onChange={(e) => setReportType(e.target.value as ReportType)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
              >
                <option value="salary">薪資報表</option>
                <option value="salary_transfer">薪轉報表</option>
                <option value="year_end_transfer">年終薪轉報表</option>
                <option value="labor_insurance">勞保報表</option>
                <option value="health_insurance">健保報表</option>
                <option value="income_tax">所得稅報表</option>
              </select>
            </div>

            <div>
              <EmployeeListSelect
                label="員工"
                value={searchQuery}
                onChange={(value) => setSearchQuery(value)}
                emptyLabel="全部員工"
                selectClassName="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900 disabled:bg-gray-100"
              />
            </div>

            <div className="md:col-span-2 xl:col-span-1">
              <div className="flex flex-wrap items-end gap-2">
                <button
                  onClick={fetchReportData}
                  disabled={loading}
                  className="flex-1 min-w-[88px] bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2 text-sm font-medium"
                >
                  <Search className="h-4 w-4" />
                  {loading ? '查詢中...' : '查詢'}
                </button>
                <button
                  onClick={exportToPDF}
                  disabled={loading || reportType !== 'salary' || currentRecordCount === 0}
                  className="flex-1 min-w-[72px] bg-blue-600 text-white px-3 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1 text-sm"
                >
                  <Download className="h-4 w-4" />
                  PDF
                </button>
                <button
                  onClick={exportToCSV}
                  disabled={loading || currentRecordCount === 0}
                  className="flex-1 min-w-[72px] bg-gray-600 text-white px-3 py-2 rounded-md hover:bg-gray-700 disabled:opacity-50 flex items-center justify-center gap-1 text-sm"
                >
                  CSV
                </button>
                <button
                  onClick={exportToExcel}
                  disabled={loading || currentRecordCount === 0}
                  className="flex-1 min-w-[72px] bg-emerald-600 text-white px-3 py-2 rounded-md hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-1 text-sm"
                >
                  Excel
                </button>
              </div>
            </div>
          </div>
        </div>

        {isTransferReport && (
          <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            <div className="font-semibold">{reportType === 'year_end_transfer' ? '年終薪轉報表說明' : '薪轉報表說明'}</div>
            <p className="mt-1">
              會依「銀行帳戶管理」匯入範本欄位生成元大薪資轉帳報表，帶入
              <span className="font-medium">
                {' '}
                員工身分證字號、薪轉元大銀行帳號、{reportType === 'year_end_transfer' ? '年終獎金實發金額' : '薪資實領金額'}
              </span>。
            </p>
          </div>
        )}

        {isTransferReport && transferValidationErrors.length > 0 && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="font-semibold text-amber-900">{reportType === 'year_end_transfer' ? '年終薪轉' : '薪轉'}報表資料有缺漏，仍可匯出；以下欄位會留白</div>
            <div className="mt-3 overflow-x-auto">
            <table className="min-w-full divide-y divide-amber-200 text-sm">
                <thead>
                <tr className="text-left text-amber-800">
                    <th className="px-3 py-2">員編</th>
                    <th className="px-3 py-2">姓名</th>
                    <th className="px-3 py-2">部門</th>
                    <th className="px-3 py-2">問題</th>
                  </tr>
                </thead>
              <tbody className="divide-y divide-amber-100">
                  {transferValidationErrors.map((item) => (
                    <tr key={`${item.employeeId}-${item.name}`}>
                    <td className="px-3 py-2 text-amber-950">{item.employeeId}</td>
                    <td className="px-3 py-2 text-amber-950">{item.name}</td>
                    <td className="px-3 py-2 text-amber-950">{item.department}</td>
                    <td className="px-3 py-2 text-amber-800">{item.reasons.join('、')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 排序和批量操作欄 */}
        {reportType === 'salary' && (
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
        )}

        {/* 統計卡片 */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-8">
            <div className="bg-white p-6 rounded-lg shadow-sm">
              <div className="flex items-center">
                <Users className="h-8 w-8 text-blue-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">員工數</p>
                  <p className="text-2xl font-bold text-gray-900">{displayStats.totalEmployees}</p>
                </div>
              </div>
            </div>

            {reportType === 'salary' && (
              <>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <DollarSign className="h-8 w-8 text-green-600" />
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600">總薪資</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {displayStats.totalGrossPay.toLocaleString()}
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
                        {displayStats.totalNetPay.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <Calendar className="h-8 w-8 text-orange-600" />
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600">總加班時數</p>
                      <p className="text-2xl font-bold text-gray-900">{displayStats.totalOvertimeHours}</p>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <TrendingUp className="h-8 w-8 text-red-600" />
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600">平均薪資</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {Math.round(displayStats.avgSalary).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}

            {reportType === 'labor_insurance' && (
              <>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <DollarSign className="h-8 w-8 text-green-600" />
                    <div className="ml-4">
                        <p className="text-sm font-medium text-gray-600">員工自付總額</p>
                        <p className="text-2xl font-bold text-gray-900">
                          {laborInsuranceSummary.employee.toLocaleString()}
                        </p>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <Calculator className="h-8 w-8 text-purple-600" />
                    <div className="ml-4">
                        <p className="text-sm font-medium text-gray-600">公司負擔總額</p>
                        <p className="text-2xl font-bold text-gray-900">
                          {laborInsuranceSummary.employer.toLocaleString()}
                        </p>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <TrendingUp className="h-8 w-8 text-red-600" />
                    <div className="ml-4">
                        <p className="text-sm font-medium text-gray-600">勞保總額</p>
                        <p className="text-2xl font-bold text-gray-900">
                          {laborInsuranceSummary.total.toLocaleString()}
                        </p>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <Calendar className="h-8 w-8 text-orange-600" />
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600">費率</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {((laborLawConfig.laborInsuranceRate + laborLawConfig.employmentInsuranceRate) * 100).toFixed(1)}%
                      </p>
                      <p className="text-xs text-gray-500">
                        普通事故 {(laborLawConfig.laborInsuranceRate * 100).toFixed(1)}% + 就保 {(laborLawConfig.employmentInsuranceRate * 100).toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}

            {reportType === 'health_insurance' && (
              <>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <DollarSign className="h-8 w-8 text-green-600" />
                    <div className="ml-4">
                        <p className="text-sm font-medium text-gray-600">員工自付總額</p>
                        <p className="text-2xl font-bold text-gray-900">
                          {healthInsuranceSummary.employee.toLocaleString()}
                        </p>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <Calculator className="h-8 w-8 text-purple-600" />
                    <div className="ml-4">
                        <p className="text-sm font-medium text-gray-600">公司負擔總額</p>
                        <p className="text-2xl font-bold text-gray-900">
                          {healthInsuranceSummary.employer.toLocaleString()}
                        </p>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <TrendingUp className="h-8 w-8 text-red-600" />
                    <div className="ml-4">
                        <p className="text-sm font-medium text-gray-600">健保總額</p>
                        <p className="text-2xl font-bold text-gray-900">
                          {healthInsuranceSummary.total.toLocaleString()}
                        </p>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <Calendar className="h-8 w-8 text-orange-600" />
                    <div className="ml-4">
                        <p className="text-sm font-medium text-gray-600">加保人數</p>
                        <p className="text-2xl font-bold text-gray-900">{healthInsuranceSummary.activeEmployees}</p>
                      </div>
                  </div>
                </div>
              </>
            )}

            {reportType === 'income_tax' && (
              <>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <DollarSign className="h-8 w-8 text-green-600" />
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600">總薪資</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {displayStats.totalGrossPay.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <Calculator className="h-8 w-8 text-purple-600" />
                    <div className="ml-4">
                        <p className="text-sm font-medium text-gray-600">扣繳稅額總計</p>
                        <p className="text-2xl font-bold text-gray-900">
                          {incomeTaxSummary.withholding.toLocaleString()}
                        </p>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <TrendingUp className="h-8 w-8 text-red-600" />
                    <div className="ml-4">
                        <p className="text-sm font-medium text-gray-600">應稅所得總計</p>
                        <p className="text-2xl font-bold text-gray-900">
                          {incomeTaxSummary.taxableIncome.toLocaleString()}
                        </p>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <Calendar className="h-8 w-8 text-orange-600" />
                    <div className="ml-4">
                        <p className="text-sm font-medium text-gray-600">稅後實領</p>
                        <p className="text-2xl font-bold text-gray-900">{incomeTaxSummary.netPay.toLocaleString()}</p>
                      </div>
                  </div>
                </div>
              </>
            )}

            {isTransferReport && (
              <>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <Calculator className="h-8 w-8 text-purple-600" />
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600">{reportType === 'year_end_transfer' ? '年終轉帳總額' : '薪轉總額'}</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {displayStats.totalNetPay.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <DollarSign className="h-8 w-8 text-green-600" />
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600">{reportType === 'year_end_transfer' ? '平均年終金額' : '平均轉帳金額'}</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {Math.round(displayStats.avgSalary).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <Calendar className="h-8 w-8 text-orange-600" />
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600">{reportType === 'year_end_transfer' ? '獎金月份' : '薪資月份'}</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {selectedYear} / {effectiveMonth.toString().padStart(2, '0')}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <TrendingUp className="h-8 w-8 text-red-600" />
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600">資料完整率</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {stats?.totalEmployees ? Math.round((currentRecordCount / stats.totalEmployees) * 100) : 0}%
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* 記錄表格 */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">
              {reportType === 'salary' && `薪資記錄 (${currentRecordCount})`}
              {reportType === 'salary_transfer' && `薪轉報表 (${currentRecordCount})`}
              {reportType === 'year_end_transfer' && `年終薪轉報表 (${currentRecordCount})`}
              {reportType === 'labor_insurance' && `勞保報表 (${currentRecordCount})`}
              {reportType === 'health_insurance' && `健保報表 (${currentRecordCount})`}
              {reportType === 'income_tax' && `所得稅報表 (${currentRecordCount})`}
            </h2>
          </div>
          
          <div className="overflow-x-auto">
            {reportType === 'salary' && (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-12">選擇</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">員工資訊</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">期間</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">工時</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">薪資</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 text-center text-gray-500">載入中...</td>
                    </tr>
                  ) : sortedRecords.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 text-center text-gray-500">沒有找到記錄</td>
                    </tr>
                  ) : (
                    sortedRecords.map((record) => (
                      <tr key={record.id} className={`hover:bg-gray-50 ${selectedIds.has(record.id) ? 'bg-blue-50' : ''}`}>
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
                            <div className="text-sm font-medium text-gray-900">{record.employee.name}</div>
                            <div className="text-sm text-gray-500">{record.employee.employeeId} • {record.employee.department}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{record.payYear}年{record.payMonth}月</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <div>正常: {record.regularHours}h</div>
                          <div>加班: {record.overtimeHours}h</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">總薪資: NT$ {record.grossPay.toLocaleString()}</div>
                          <div className="text-sm text-gray-500">實領: NT$ {record.netPay.toLocaleString()}</div>
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
            )}

            {isTransferReport && (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">轉帳日期</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">員工資訊</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">部門</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">身分證字號</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">元大薪轉帳號</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">{reportType === 'year_end_transfer' ? '年終金額' : '實領薪資'}</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 text-center text-gray-500">載入中...</td>
                    </tr>
                  ) : filteredTransferRecords.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 text-center text-gray-500">沒有找到記錄</td>
                    </tr>
                  ) : (
                    filteredTransferRecords.map((record) => (
                      <tr key={`${record.employeeId}-${record.transferDate}`} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{record.transferDate}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>
                            <div className="text-sm font-medium text-gray-900">{record.name}</div>
                            <div className="text-sm text-gray-500">{record.employeeId}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{record.department}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{record.idNumber}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{record.bankAccount}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-semibold text-green-700">
                          {record.amount === null ? '-' : `NT$ ${record.amount.toLocaleString()}`}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {reportType !== 'salary' && !isTransferReport && (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">員工資訊</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {reportType === 'income_tax' ? '年度' : '期間'}
                    </th>
                    {reportType === 'labor_insurance' && (
                      <>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">投保薪資</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">勞保費</th>
                      </>
                    )}
                    {reportType === 'health_insurance' && (
                      <>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">納保資訊</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">健保費</th>
                      </>
                    )}
                    {reportType === 'income_tax' && (
                      <>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">應稅所得</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">扣繳稅額</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-4 text-center text-gray-500">載入中...</td>
                    </tr>
                  ) : currentRecordCount === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-4 text-center text-gray-500">沒有找到記錄</td>
                    </tr>
                  ) : reportType === 'income_tax' ? (
                    filteredTaxRecords.map((record) => (
                      <tr key={record.employeeId} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>
                            <div className="text-sm font-medium text-gray-900">{record.name}</div>
                            <div className="text-sm text-gray-500">{record.employeeId} • {record.department}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{selectedYear}年</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <div>應稅: NT$ {record.taxableIncome.toLocaleString()}</div>
                          <div className="text-gray-500">免稅: NT$ {record.taxExempt.toLocaleString()}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <div className="text-red-600">扣繳: NT$ {record.totalIncomeTax.toLocaleString()}</div>
                          <div className="text-green-600">實領: NT$ {record.totalNetPay.toLocaleString()}</div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    filteredInsuranceRecords.map((record) => (
                      <tr key={`${reportType}-${record.employeeId}`} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>
                            <div className="text-sm font-medium text-gray-900">{record.name}</div>
                            <div className="text-sm text-gray-500">{record.employeeId} • {record.department}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {selectedYear}年{selectedMonth ? `${selectedMonth}月` : ''}
                        </td>
                        {reportType === 'labor_insurance' ? (
                          <>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              <div>底薪: NT$ {record.baseSalary.toLocaleString()}</div>
                              <div className="text-gray-500">投保: NT$ {record.laborInsuredAmount.toLocaleString()}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              <div className="text-red-600">員工: NT$ {record.laborEmployee.toLocaleString()}</div>
                              <div className="text-green-600">公司: NT$ {record.laborEmployer.toLocaleString()}</div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              <div>{record.isHealthActive ? '已加保' : '未加保'}</div>
                              <div className="text-gray-500">眷屬: {record.dependents} / 人數: {record.totalPersons}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              <div className="text-red-600">員工: NT$ {record.healthEmployee.toLocaleString()}</div>
                              <div className="text-green-600">公司: NT$ {record.healthEmployer.toLocaleString()}</div>
                            </td>
                          </>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
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
      <ConfirmDialog
        open={!!pendingPayslipPrint}
        title="列印受密碼保護的薪資條"
        message={pendingPayslipPrint?.message || ''}
        confirmLabel="繼續列印"
        cancelLabel="取消"
        onConfirm={() => {
          if (!pendingPayslipPrint) return;
          printPayslipHtml(pendingPayslipPrint.htmlContent);
          setPendingPayslipPrint(null);
        }}
        onCancel={() => setPendingPayslipPrint(null)}
      />
    </AuthenticatedLayout>
  );
}
