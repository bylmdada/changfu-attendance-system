'use client';

import { useEffect, useState } from 'react';
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
import { LOGO_BASE64 } from '@/lib/logoBase64';

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

// 法規設定介面（勞保 + 健保分開來源）
interface LaborLawConfig {
  // 勞保（來自 labor-law-config）
  basicWage: number;
  laborInsuranceRate: number;
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
  laborInsuranceMax: 45800,
  laborEmployeeRate: 0.2,
  healthInsuranceRate: 0.0517,
  healthEmployeeRate: 0.3,
  maxDependents: 3
};

// 計算勞保費
const calculateLaborInsurance = (salary: number, config: LaborLawConfig) => {
  const insuredSalary = Math.min(salary, config.laborInsuranceMax);
  const employeePay = Math.round(insuredSalary * config.laborInsuranceRate * config.laborEmployeeRate);
  const companyPay = Math.round(insuredSalary * config.laborInsuranceRate * (1 - config.laborEmployeeRate));
  return { insuredSalary, employeePay, companyPay, total: employeePay + companyPay };
};

// 計算健保費
const calculateHealthInsurance = (salary: number, config: LaborLawConfig, dependents: number = 0) => {
  const insuredSalary = salary;
  const totalPersons = 1 + Math.min(dependents, config.maxDependents);
  const employeePay = Math.round(insuredSalary * config.healthInsuranceRate * config.healthEmployeeRate * totalPersons);
  const companyPay = Math.round(insuredSalary * config.healthInsuranceRate * 0.6 * totalPersons);
  return { insuredSalary, dependents: Math.min(dependents, config.maxDependents), totalPersons, employeePay, companyPay, total: employeePay + companyPay };
};

// 計算所得稅
const calculateIncomeTax = (grossPay: number) => {
  // 簡化計算：(總薪資 - 4000) × 5%
  const taxableIncome = Math.max(0, grossPay - 4000);
  const withholdingTax = Math.round(taxableIncome * 0.05);
  return { grossPay, taxableIncome, withholdingTax };
};

export default function ReportsPage() {
  const [payrollRecords, setPayrollRecords] = useState<PayrollRecord[]>([]);
  const [stats, setStats] = useState<ReportStats | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_user, setUser] = useState<User | null>(null);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [payslipLoading, setPayslipLoading] = useState(false);
  
  // Toast 狀態
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // 排序狀態
  const [sortConfig, setSortConfig] = useState<{ field: 'employee' | 'period' | 'grossPay' | 'netPay'; direction: 'asc' | 'desc' }>({ field: 'employee', direction: 'asc' });
  
  // 批量選擇狀態
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  
  // 報表類型
  const [reportType, setReportType] = useState<'salary' | 'labor_insurance' | 'health_insurance' | 'income_tax'>('salary');

  // 法規設定
  const [laborLawConfig, setLaborLawConfig] = useState<LaborLawConfig>(DEFAULT_CONFIG);

  // Toast 顯示函數
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  // 載入法規設定（從兩個 API 分別讀取勞保和健保）
  const fetchLaborLawConfig = async () => {
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
          const confirmMsg = `此薪資條有密碼保護：\n\n📌 ${data.security.hint}\n\n是否繼續列印？`;
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
      }
    } catch (error) {
      console.error('生成PDF薪資條失敗:', error);
    }
    setPayslipLoading(false);
  };

  const generatePayslipHTML = (payslip: Payslip) => {
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
                <p>${payslip.companyInfo?.name || '社團法人宜蘭縣長期照護及社會福祉推廣協會'}</p>
              </div>
            </div>
            <div class="period-badge">${payslip.period.monthName}</div>
          </div>

          <!-- 員工資訊區 -->
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
    
    // 處理包含逗號或引號的欄位
    const escapeCSV = (value: string | number): string => {
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    
    const csvData = [
      headers.map(escapeCSV).join(','),
      ...sortedRecords.map(record => [
        escapeCSV(record.employee.employeeId),
        escapeCSV(record.employee.name),
        escapeCSV(record.employee.department || ''),
        escapeCSV(record.employee.position || ''),
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

    // 添加 BOM 以確保 Excel 正確識別 UTF-8 編碼
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvData], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const monthStr = selectedMonth ? `${selectedMonth}月` : '全年';
    a.download = `薪資報表_${selectedYear}年${monthStr}.csv`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 延遲釋放 URL，確保下載完成
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('success', 'CSV 報表匯出成功');
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

        // 初始載入報表數據
        fetchPayrollData();
      } catch (error) {
        console.error('獲取用戶信息失敗:', error);
      }
    };

    fetchUserAndData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // 匯出 Excel 格式 (使用 CSV 格式，Excel 可正常開啟)
  const exportToExcel = () => {
    const headers = [
      '員工編號', '姓名', '部門', '職位', '年度', '月份',
      '正常工時', '加班工時', '基本薪資', '加班費', '總薪資', '實領薪資'
    ];
    
    // 處理包含逗號或引號的欄位
    const escapeCSV = (value: string | number): string => {
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    
    // 使用 CSV 格式 (Excel 可正常開啟)
    const excelData = [
      headers.map(escapeCSV).join(','),
      ...sortedRecords.map(record => [
        escapeCSV(record.employee.employeeId),
        escapeCSV(record.employee.name),
        escapeCSV(record.employee.department || ''),
        escapeCSV(record.employee.position || ''),
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

    // 添加 BOM
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + excelData], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const monthStr = selectedMonth ? `${selectedMonth}月` : '全年';
    a.download = `薪資報表_${selectedYear}年${monthStr}.csv`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
                value={selectedMonth ?? ''}
                onChange={(e) => setSelectedMonth(e.target.value ? parseInt(e.target.value) : null)}
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
                onClick={fetchPayrollData}
                disabled={loading}
                className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2 text-sm font-medium"
              >
                <Search className="h-4 w-4" />
                {loading ? '查詢中...' : '查詢'}
              </button>
              <button
                onClick={exportToPDF}
                disabled={loading || sortedRecords.length === 0}
                className="bg-blue-600 text-white px-3 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1 text-sm"
              >
                <Download className="h-4 w-4" />
                PDF
              </button>
              <button
                onClick={exportToCSV}
                disabled={loading || sortedRecords.length === 0}
                className="bg-gray-600 text-white px-3 py-2 rounded-md hover:bg-gray-700 disabled:opacity-50 flex items-center justify-center gap-1 text-sm"
              >
                CSV
              </button>
              <button
                onClick={exportToExcel}
                disabled={loading || sortedRecords.length === 0}
                className="bg-emerald-600 text-white px-3 py-2 rounded-md hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-1 text-sm"
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

            {reportType === 'salary' && (
              <>
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
                        {sortedRecords.reduce((sum, r) => sum + calculateLaborInsurance(r.basePay, laborLawConfig).employeePay, 0).toLocaleString()}
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
                        {sortedRecords.reduce((sum, r) => sum + calculateLaborInsurance(r.basePay, laborLawConfig).companyPay, 0).toLocaleString()}
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
                        {sortedRecords.reduce((sum, r) => sum + calculateLaborInsurance(r.basePay, laborLawConfig).total, 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <Calendar className="h-8 w-8 text-orange-600" />
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600">費率</p>
                      <p className="text-2xl font-bold text-gray-900">{(laborLawConfig.laborInsuranceRate * 100).toFixed(1)}%</p>
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
                        {sortedRecords.reduce((sum, r) => sum + calculateHealthInsurance(r.basePay, laborLawConfig).employeePay, 0).toLocaleString()}
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
                        {sortedRecords.reduce((sum, r) => sum + calculateHealthInsurance(r.basePay, laborLawConfig).companyPay, 0).toLocaleString()}
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
                        {sortedRecords.reduce((sum, r) => sum + calculateHealthInsurance(r.basePay, laborLawConfig).total, 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <Calendar className="h-8 w-8 text-orange-600" />
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600">費率</p>
                      <p className="text-2xl font-bold text-gray-900">{(laborLawConfig.healthInsuranceRate * 100).toFixed(2)}%</p>
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
                        {stats.totalGrossPay.toLocaleString()}
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
                        {sortedRecords.reduce((sum, r) => sum + calculateIncomeTax(r.grossPay).withholdingTax, 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <TrendingUp className="h-8 w-8 text-red-600" />
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600">稅後實領</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {(stats.totalGrossPay - sortedRecords.reduce((sum, r) => sum + calculateIncomeTax(r.grossPay).withholdingTax, 0)).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center">
                    <Calendar className="h-8 w-8 text-orange-600" />
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600">平均稅率</p>
                      <p className="text-2xl font-bold text-gray-900">5%</p>
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
              {reportType === 'salary' && `薪資記錄 (${sortedRecords.length})`}
              {reportType === 'labor_insurance' && `勞保報表 (${sortedRecords.length})`}
              {reportType === 'health_insurance' && `健保報表 (${sortedRecords.length})`}
              {reportType === 'income_tax' && `所得稅報表 (${sortedRecords.length})`}
            </h2>
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
                  {reportType === 'salary' && (
                    <>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        工時
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        薪資
                      </th>
                    </>
                  )}
                  {reportType === 'labor_insurance' && (
                    <>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        投保薪資
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        勞保費
                      </th>
                    </>
                  )}
                  {reportType === 'health_insurance' && (
                    <>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        投保薪資
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        健保費
                      </th>
                    </>
                  )}
                  {reportType === 'income_tax' && (
                    <>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        總薪資
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        扣繳稅額
                      </th>
                    </>
                  )}
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
                      沒有找到記錄
                    </td>
                  </tr>
                ) : (
                  sortedRecords.map((record) => {
                    const laborIns = calculateLaborInsurance(record.basePay, laborLawConfig);
                    const healthIns = calculateHealthInsurance(record.basePay, laborLawConfig);
                    const incomeTax = calculateIncomeTax(record.grossPay);
                    
                    return (
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
                        
                        {/* 薪資報表欄位 */}
                        {reportType === 'salary' && (
                          <>
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
                          </>
                        )}
                        
                        {/* 勞保報表欄位 */}
                        {reportType === 'labor_insurance' && (
                          <>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              <div>底薪: NT$ {record.basePay.toLocaleString()}</div>
                              <div className="text-gray-500">投保: NT$ {laborIns.insuredSalary.toLocaleString()}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-red-600">
                                員工: NT$ {laborIns.employeePay.toLocaleString()}
                              </div>
                              <div className="text-sm text-green-600">
                                公司: NT$ {laborIns.companyPay.toLocaleString()}
                              </div>
                            </td>
                          </>
                        )}
                        
                        {/* 健保報表欄位 */}
                        {reportType === 'health_insurance' && (
                          <>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              <div>底薪: NT$ {record.basePay.toLocaleString()}</div>
                              <div className="text-gray-500">人數: {healthIns.totalPersons}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-red-600">
                                員工: NT$ {healthIns.employeePay.toLocaleString()}
                              </div>
                              <div className="text-sm text-green-600">
                                公司: NT$ {healthIns.companyPay.toLocaleString()}
                              </div>
                            </td>
                          </>
                        )}
                        
                        {/* 所得稅報表欄位 */}
                        {reportType === 'income_tax' && (
                          <>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              <div>總薪: NT$ {record.grossPay.toLocaleString()}</div>
                              <div className="text-gray-500">應稅: NT$ {incomeTax.taxableIncome.toLocaleString()}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-red-600">
                                扣繳: NT$ {incomeTax.withholdingTax.toLocaleString()}
                              </div>
                              <div className="text-sm text-green-600">
                                稅後: NT$ {(record.grossPay - incomeTax.withholdingTax).toLocaleString()}
                              </div>
                            </td>
                          </>
                        )}
                        
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
                    );
                  })
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
