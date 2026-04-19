'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { 
  CreditCard, RefreshCw, CheckCircle, AlertCircle, Upload, 
  Search, Eye, EyeOff, Edit2, Save, X, Download
} from 'lucide-react';
import SystemNavbar from '@/components/SystemNavbar';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';

interface BankAccountRecord {
  id: number;
  employeeId: string;
  name: string;
  department: string;
  idNumber: string;
  bankCode: string;
  bankAccount: string;
  hasIdNumber: boolean;
  hasBankAccount: boolean;
}

interface User {
  id: number;
  username: string;
  role: string;
}

export default function BankAccountsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<BankAccountRecord[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showFull, setShowFull] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ idNumber: '', bankAccount: '' });
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [summary, setSummary] = useState({ totalEmployees: 0, withBankAccount: 0, missingBankAccount: 0 });

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const loadData = useCallback(async (showFullData = false) => {
    try {
      const params = new URLSearchParams();
      if (selectedDepartment) params.append('department', selectedDepartment);
      if (showFullData) params.append('showFull', 'true');

      const response = await fetch(`/api/employees/bank-accounts?${params}`, {
        credentials: 'include'
      });
      
      if (!response.ok) {
        if (response.status === 403) {
          router.push('/dashboard');
          return;
        }
        throw new Error('載入失敗');
      }

      const data = await response.json();
      setRecords(data.records);
      setDepartments(data.departments);
      setSummary(data.summary);
    } catch (error) {
      console.error('載入資料失敗:', error);
      showToast('error', '載入資料失敗');
    } finally {
      setLoading(false);
    }
  }, [selectedDepartment, router]);

  useEffect(() => {
    document.title = '銀行帳戶管理 - 長福會考勤系統';
    
    const checkAuth = async () => {
      const authRes = await fetch('/api/auth/me', { credentials: 'include' });
      if (!authRes.ok) {
        router.push('/login');
        return;
      }
      const authData = await authRes.json();
      if (authData.user.role !== 'ADMIN' && authData.user.role !== 'HR') {
        router.push('/dashboard');
        return;
      }
      setUser(authData.user);
      loadData();
    };
    checkAuth();
  }, [router, loadData]);

  useEffect(() => {
    if (user) loadData(showFull);
  }, [selectedDepartment, showFull, user, loadData]);

  const handleEdit = (record: BankAccountRecord) => {
    setEditingId(record.id);
    setEditForm({
      idNumber: record.hasIdNumber ? '' : '',  // 不顯示舊值，因為已遮蔽
      bankAccount: record.hasBankAccount ? '' : ''
    });
  };

  const handleSave = async () => {
    if (!editingId) {
      console.log('❌ handleSave: editingId is null/undefined');
      return;
    }

    console.log('📥 handleSave 開始:', { editingId, idNumber: editForm.idNumber, bankAccount: editForm.bankAccount });

    // 前端驗證：至少要輸入一個欄位
    const trimmedIdNumber = editForm.idNumber?.trim() || '';
    const trimmedBankAccount = editForm.bankAccount?.replace(/\D/g, '') || '';

    if (!trimmedIdNumber && !trimmedBankAccount) {
      showToast('error', '請輸入身分證字號或銀行帳號');
      return;
    }

    const requestBody = {
      employeeId: editingId,
      idNumber: trimmedIdNumber || undefined,
      bankAccount: trimmedBankAccount || undefined
    };
    
    console.log('📤 發送請求:', JSON.stringify(requestBody));

    try {
      const res = await fetchJSONWithCSRF('/api/employees/bank-accounts', {
        method: 'PUT',
        body: requestBody
      });

      console.log('📥 API 回應 status:', res.status, res.ok);

      const data = await res.json() as { success?: boolean; message?: string; error?: string };
      console.log('📥 解析後:', data);

      if (res.ok && data.success) {
        showToast('success', data.message || '更新成功');
        setEditingId(null);
        setEditForm({ idNumber: '', bankAccount: '' });
        loadData(showFull);
      } else {
        showToast('error', data.error || '更新失敗');
      }
    } catch (err) {
      console.error('❌ API 錯誤:', err);
      showToast('error', '更新失敗');
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      // 讀取 Excel 檔案
      const XLSX = await import('xlsx');
      const reader = new FileReader();
      
      reader.onload = async (e) => {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as (string | number)[][];

        // 解析元大格式：從第3行開始（跳過標題）
        const importRecords: Array<{ idNumber: string; bankAccount: string; name: string }> = [];
        for (let i = 2; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || row.length < 4) continue;
          
          const idNumber = String(row[1] || '').trim();
          const bankAccount = String(row[2] || '').replace(/[,\s]/g, '');
          const name = String(row[4] || '').trim();
          
          if (idNumber || bankAccount) {
            importRecords.push({ idNumber, bankAccount, name });
          }
        }

        if (importRecords.length === 0) {
          showToast('error', '沒有可匯入的資料');
          return;
        }

        // 發送匯入請求
        const response = await fetchJSONWithCSRF('/api/employees/bank-accounts', {
          method: 'POST',
          body: { records: importRecords }
        });

        const payload = await response.json() as { success?: boolean; message?: string; error?: string };

        if (response.ok && payload.success) {
          showToast('success', payload.message || '匯入成功');
          loadData(showFull);
        } else {
          showToast('error', payload.error || '匯入失敗');
        }
      };

      reader.readAsBinaryString(file);
    } catch (error) {
      console.error('匯入失敗:', error);
      showToast('error', '匯入失敗');
    }

    // 清空 input
    event.target.value = '';
  };

  const handleExportTemplate = () => {
    const headers = ['轉帳日期(yyyymmdd)', '受款人身分證字號', '受款人帳號', '金額', '姓名'];
    const example = ['20251225', 'A123456789', '20592000081113', '30000', '王小明'];
    
    const csvContent = '\uFEFF' + [headers.join(','), example.join(',')].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '銀行帳戶匯入範本.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredRecords = records.filter(r => 
    r.name.includes(searchTerm) || r.employeeId.includes(searchTerm)
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SystemNavbar user={user} />
        <div className="flex justify-center items-center h-64">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SystemNavbar user={user} />
      
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg ${
          toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
        } text-white`}>
          {toast.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          {toast.message}
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 頁面標題 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <CreditCard className="w-7 h-7 text-blue-600" />
            銀行帳戶管理
          </h1>
          <p className="text-gray-600 mt-1">管理員工薪轉銀行帳戶資訊（僅限管理員）</p>
        </div>

        {/* 統計卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm border p-4">
            <div className="text-sm text-gray-500">員工總數</div>
            <div className="text-2xl font-bold text-gray-900">{summary.totalEmployees}</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border p-4">
            <div className="text-sm text-gray-500">已設定帳戶</div>
            <div className="text-2xl font-bold text-green-600">{summary.withBankAccount}</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border p-4">
            <div className="text-sm text-gray-500">尚未設定</div>
            <div className="text-2xl font-bold text-red-600">{summary.missingBankAccount}</div>
          </div>
        </div>

        {/* 工具列 */}
        <div className="bg-white rounded-lg shadow-sm border p-4 mb-6">
          <div className="flex flex-wrap items-center gap-4">
            {/* 搜尋 */}
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="輸入員工編號或姓名搜尋..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                />
              </div>
            </div>

            {/* 部門篩選 */}
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-900"
            >
              <option value="">所有部門</option>
              {departments.map(dept => (
                <option key={dept} value={dept}>{dept}</option>
              ))}
            </select>

            {/* 顯示/隱藏完整資料 */}
            <button
              onClick={() => setShowFull(!showFull)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                showFull ? 'bg-blue-100 text-blue-700 border-blue-300' : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
              title={showFull ? '隱藏身分證字號與帳號完整資料' : '顯示身分證字號與帳號完整資料'}
            >
              {showFull ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {showFull ? '隱藏敏感資料' : '顯示完整資料'}
            </button>

            {/* 匯入按鈕 */}
            <label className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 cursor-pointer" title="從元大銀行 Excel 匯入帳號資料">
              <Upload className="w-4 h-4" />
              匯入帳號
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleImport}
                className="hidden"
              />
            </label>

            {/* 下載範本 */}
            <button
              onClick={handleExportTemplate}
              className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50 text-gray-700"
              title="下載匯入用的 Excel 範本檔案"
            >
              <Download className="w-4 h-4" />
              下載範本
            </button>
          </div>
        </div>

        {/* 資料表格 */}
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-800">員工編號</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-800">姓名</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-800">部門</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-800">身分證字號</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-800">銀行帳號（元大）</th>
                <th className="px-4 py-3 text-center text-sm font-semibold text-gray-800">編輯</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredRecords.map(record => (
                <tr key={record.id} className="hover:bg-blue-50">
                  <td className="px-4 py-3 text-sm font-semibold text-gray-900">{record.employeeId}</td>
                  <td className="px-4 py-3 text-sm font-bold text-gray-900">{record.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{record.department}</td>
                  <td className="px-4 py-3 text-sm">
                    {editingId === record.id ? (
                      <input
                        type="text"
                        value={editForm.idNumber}
                        onChange={(e) => setEditForm({ ...editForm, idNumber: e.target.value.toUpperCase() })}
                        placeholder="例如：A123456789"
                        className="w-36 px-2 py-1 border rounded text-sm text-gray-900"
                        maxLength={10}
                      />
                    ) : (
                      <span className={record.hasIdNumber ? 'text-gray-900 font-mono' : 'text-orange-600 font-medium'}>
                        {record.idNumber || '⚠ 未設定'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {editingId === record.id ? (
                      <input
                        type="text"
                        value={editForm.bankAccount}
                        onChange={(e) => setEditForm({ ...editForm, bankAccount: e.target.value.replace(/\D/g, '') })}
                        placeholder="例如：20592000081113"
                        className="w-44 px-2 py-1 border rounded text-sm text-gray-900"
                        maxLength={16}
                      />
                    ) : (
                      <span className={record.hasBankAccount ? 'text-gray-900 font-mono' : 'text-orange-600 font-medium'}>
                        {record.bankAccount || '⚠ 未設定'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {editingId === record.id ? (
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={handleSave}
                          className="p-1.5 text-green-600 hover:bg-green-100 rounded"
                          title="儲存變更"
                        >
                          <Save className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1.5 text-red-600 hover:bg-red-100 rounded"
                          title="取消編輯"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleEdit(record)}
                        className="p-1.5 text-blue-600 hover:bg-blue-100 rounded"
                        title="編輯此員工的銀行帳號"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredRecords.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              沒有符合條件的員工資料
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
