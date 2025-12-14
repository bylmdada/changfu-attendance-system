'use client';

import { useEffect, useMemo, useState } from 'react';
import { DollarSign, Search, FileText, Download } from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';

interface PayrollRecord {
  id: number;
  payYear: number;
  payMonth: number;
  basePay: number;
  overtimePay: number;
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
  const [user, setUser] = useState<AuthUser | null>(null);

  // Toast 狀態
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // 排序狀態
  const [sortConfig, setSortConfig] = useState<{ field: 'year' | 'month' | 'netPay'; direction: 'asc' | 'desc' }>({ field: 'year', direction: 'desc' });

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
    // 取得登入者資訊（用於顯示歡迎字樣）
    fetch('/api/auth/me', { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        setUser(data.user || data);
      })
      .catch(() => {});

    const now = new Date();
    const year = now.getFullYear();
    fetch(`/api/payroll?year=${year}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        setRecords(data.payrollRecords || []);
      })
      .catch((e) => setError(`載入失敗: ${e.message}`))
      .finally(() => setLoading(false));
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
        const blob = new Blob([payslipContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `薪資條_${data.payslip.employee.name}_${data.payslip.period.monthName}.html`;
        a.click();
        URL.revokeObjectURL(url);
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

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-600">載入中...</div>;
  if (error) return <div className="min-h-screen flex items-center justify-center text-red-600">{error}</div>;

  return (
    <AuthenticatedLayout>
      <div className="max-w-6xl mx-auto p-6">
        {/* 標題區（參考調班管理頁面樣式） */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <DollarSign className="w-8 h-8 text-emerald-600 mr-3" />
            薪資查詢
          </h1>
        </div>
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
                  <div>加班費：{r.overtimePay.toLocaleString()}</div>
                  <div>應發：{r.grossPay.toLocaleString()}</div>
                  {typeof r.laborInsurance === 'number' && <div>勞保：{r.laborInsurance.toLocaleString()}</div>}
                  {typeof r.healthInsurance === 'number' && <div>健保：{r.healthInsurance.toLocaleString()}</div>}
                  {typeof r.supplementaryInsurance === 'number' && <div>補充保費：{r.supplementaryInsurance.toLocaleString()}</div>}
                  {typeof r.incomeTax === 'number' && <div>所得稅：{r.incomeTax.toLocaleString()}</div>}
                  {typeof r.totalDeductions === 'number' && <div>扣款合計：{r.totalDeductions.toLocaleString()}</div>}
                </div>
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
