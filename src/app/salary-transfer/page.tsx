'use client';

import { useState, useEffect } from 'react';
import { Download, Building2, Calendar, DollarSign, Users, FileSpreadsheet, Loader2, CreditCard } from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';

interface Employee {
  id: number;
  employeeId: string;
  name: string;
  department: string;
  bankAccount: string;
  netPay: number;
}

interface PayrollSummary {
  department: string;
  employeeCount: number;
  totalAmount: number;
}

export default function SalaryTransferPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [summary, setSummary] = useState<PayrollSummary[]>([]);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');

  // 計算下個月5日的轉帳日期
  const getNextMonth5th = (y: number, m: number): string => {
    // 下個月
    let nextYear = y;
    let nextMonth = m + 1;
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear++;
    }
    return `${nextYear}${nextMonth.toString().padStart(2, '0')}05`;
  };

  const [transferDate, setTransferDate] = useState(getNextMonth5th(year, month));

  // 取得薪資資料
  useEffect(() => {
    fetchPayrollData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);

  // 更新轉帳日期（選擇的薪資月份 → 下個月5日）
  useEffect(() => {
    setTransferDate(getNextMonth5th(year, month));
  }, [year, month]);

  const fetchPayrollData = async () => {
    setLoading(true);
    try {
      // 同時取得薪資記錄和銀行帳戶資料（顯示遮罩後帳號保護隱私）
      const [payrollRes, bankRes] = await Promise.all([
        fetch(`/api/payroll?year=${year}&month=${month}`, { credentials: 'include' }),
        fetch(`/api/employees/bank-accounts`, { credentials: 'include' })
      ]);

      // 建立員工銀行帳號對照表（API 回傳 records 欄位）
      const bankMap = new Map<number, string>();
      if (bankRes.ok) {
        const bankData = await bankRes.json();
        const bankList = bankData.records || [];
        for (const emp of bankList) {
          if (emp.bankAccount) {
            bankMap.set(emp.id, emp.bankAccount);
          }
        }
      }

      if (payrollRes.ok) {
        const data = await payrollRes.json();
        const records = data.payrollRecords || [];
        
        // 整理員工資料（從銀行帳戶 API 補充 bankAccount）
        const empData: Employee[] = records.map((r: {
          employee: { id: number; employeeId: string; name: string; department: string };
          netPay: number;
        }) => ({
          id: r.employee.id,
          employeeId: r.employee.employeeId,
          name: r.employee.name,
          department: r.employee.department || '未分類',
          bankAccount: bankMap.get(r.employee.id) || '',
          netPay: Math.round(r.netPay)
        }));
        setEmployees(empData);

        // 計算部門摘要
        const deptMap = new Map<string, { count: number; total: number }>();
        for (const emp of empData) {
          const existing = deptMap.get(emp.department) || { count: 0, total: 0 };
          existing.count++;
          existing.total += emp.netPay;
          deptMap.set(emp.department, existing);
        }
        
        const summaryData: PayrollSummary[] = Array.from(deptMap.entries())
          .map(([dept, data]) => ({
            department: dept,
            employeeCount: data.count,
            totalAmount: data.total
          }))
          .sort((a, b) => a.department.localeCompare(b.department, 'zh-TW'));
        setSummary(summaryData);
      }
    } catch (error) {
      console.error('載入薪資資料失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  // 匯出元大銀行薪轉格式
  const handleExportYuanta = async (type: 'salary' | 'bonus') => {
    setExporting(type);
    try {
      const url = `/api/reports/yuanta-transfer?year=${year}&month=${month}&type=${type}&date=${transferDate}`;
      const response = await fetch(url, { credentials: 'include' });
      
      if (response.ok) {
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `元大薪轉_${type === 'salary' ? '薪水' : '年終'}_${year}${month.toString().padStart(2, '0')}.xls`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(downloadUrl);
        document.body.removeChild(a);
      } else {
        const errorData = await response.json();
        alert(errorData.error || '匯出失敗');
      }
    } catch (error) {
      console.error('匯出失敗:', error);
      alert('匯出失敗，請稍後再試');
    } finally {
      setExporting(null);
    }
  };

  // 過濾員工
  const filteredEmployees = selectedDepartment === 'all' 
    ? employees 
    : employees.filter(emp => emp.department === selectedDepartment);

  // 計算總金額
  const totalAmount = filteredEmployees.reduce((sum, emp) => sum + emp.netPay, 0);
  const overallTotal = employees.reduce((sum, emp) => sum + emp.netPay, 0);

  return (
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 標題區 */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center">
                <CreditCard className="w-8 h-8 text-blue-600 mr-3" />
                薪資轉帳管理
              </h1>
              <p className="text-gray-600 mt-2">匯出銀行薪轉檔案（元大銀行格式）</p>
            </div>
          </div>
        </div>

        {/* 控制面板 */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {/* 年份 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Calendar className="w-4 h-4 inline mr-1" />
                年度
              </label>
              <select
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value))}
                className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900 bg-white"
              >
                {[year - 1, year, year + 1].map(y => (
                  <option key={y} value={y}>{y}年</option>
                ))}
              </select>
            </div>

            {/* 月份 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Calendar className="w-4 h-4 inline mr-1" />
                月份
              </label>
              <select
                value={month}
                onChange={(e) => setMonth(parseInt(e.target.value))}
                className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900 bg-white"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <option key={m} value={m}>{m}月</option>
                ))}
              </select>
            </div>

            {/* 轉帳日期 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <DollarSign className="w-4 h-4 inline mr-1" />
                轉帳日期
              </label>
              <input
                type="text"
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
                placeholder="yyyymmdd"
                className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900 bg-white"
              />
            </div>

            {/* 部門篩選 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Building2 className="w-4 h-4 inline mr-1" />
                部門篩選
              </label>
              <select
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900 bg-white"
              >
                <option value="all">全部部門</option>
                {summary.map(s => (
                  <option key={s.department} value={s.department}>{s.department}</option>
                ))}
              </select>
            </div>

            {/* 重新載入 */}
            <div className="flex items-end">
              <button
                onClick={fetchPayrollData}
                disabled={loading}
                className="w-full bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors flex items-center justify-center"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  '重新載入'
                )}
              </button>
            </div>
          </div>
        </div>

        {/* 統計卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm">總轉帳人數</p>
                <p className="text-3xl font-bold mt-1">{employees.length}</p>
              </div>
              <Users className="w-12 h-12 text-blue-200" />
            </div>
          </div>
          <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-lg p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-sm">總轉帳金額</p>
                <p className="text-3xl font-bold mt-1">NT$ {overallTotal.toLocaleString()}</p>
              </div>
              <DollarSign className="w-12 h-12 text-green-200" />
            </div>
          </div>
          <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-purple-100 text-sm">部門數</p>
                <p className="text-3xl font-bold mt-1">{summary.length}</p>
              </div>
              <Building2 className="w-12 h-12 text-purple-200" />
            </div>
          </div>
          <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg p-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-orange-100 text-sm">平均薪資</p>
                <p className="text-3xl font-bold mt-1">
                  NT$ {employees.length > 0 ? Math.round(overallTotal / employees.length).toLocaleString() : 0}
                </p>
              </div>
              <FileSpreadsheet className="w-12 h-12 text-orange-200" />
            </div>
          </div>
        </div>

        {/* 匯出按鈕區 */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Download className="w-5 h-5 mr-2" />
            匯出銀行薪轉檔案
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => handleExportYuanta('salary')}
              disabled={exporting !== null || employees.length === 0}
              className="bg-blue-600 text-white px-6 py-4 rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exporting === 'salary' ? (
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              ) : (
                <FileSpreadsheet className="w-5 h-5 mr-2" />
              )}
              匯出月薪轉帳 (元大格式)
            </button>
            <button
              onClick={() => handleExportYuanta('bonus')}
              disabled={exporting !== null}
              className="bg-green-600 text-white px-6 py-4 rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exporting === 'bonus' ? (
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              ) : (
                <FileSpreadsheet className="w-5 h-5 mr-2" />
              )}
              匯出年終獎金轉帳 (元大格式)
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-3">
            ⚡ 匯出的 Excel 檔案已依部門分頁，可直接上傳至元大銀行薪轉系統
          </p>
        </div>

        {/* 部門摘要 */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center">
              <Building2 className="w-5 h-5 mr-2" />
              部門轉帳摘要
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">部門</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">人數</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">總金額</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">平均</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {summary.map((s, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{s.department}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-gray-600">{s.employeeCount} 人</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right font-semibold text-blue-600">
                      NT$ {s.totalAmount.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-gray-600">
                      NT$ {Math.round(s.totalAmount / s.employeeCount).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {summary.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                      {loading ? '載入中...' : '無薪資資料'}
                    </td>
                  </tr>
                )}
              </tbody>
              {summary.length > 0 && (
                <tfoot className="bg-gray-50">
                  <tr>
                    <td className="px-6 py-4 font-bold text-gray-900">合計</td>
                    <td className="px-6 py-4 text-right font-bold text-gray-900">{employees.length} 人</td>
                    <td className="px-6 py-4 text-right font-bold text-blue-600">
                      NT$ {overallTotal.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-gray-600">
                      NT$ {employees.length > 0 ? Math.round(overallTotal / employees.length).toLocaleString() : 0}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* 員工明細 */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center">
              <Users className="w-5 h-5 mr-2" />
              轉帳明細 
              {selectedDepartment !== 'all' && (
                <span className="ml-2 text-sm text-gray-500">（{selectedDepartment}）</span>
              )}
              <span className="ml-auto text-sm font-normal text-gray-500">
                {filteredEmployees.length} 人 / NT$ {totalAmount.toLocaleString()}
              </span>
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">員工編號</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">姓名</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">部門</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">銀行帳號</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">轉帳金額</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredEmployees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{emp.employeeId}</td>
                    <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{emp.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{emp.department}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 font-mono">
                      {emp.bankAccount || <span className="text-red-500">未設定</span>}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right font-semibold text-blue-600">
                      NT$ {emp.netPay.toLocaleString()}
                    </td>
                  </tr>
                ))}
                {filteredEmployees.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                      {loading ? '載入中...' : '無員工資料'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AuthenticatedLayout>
  );
}
