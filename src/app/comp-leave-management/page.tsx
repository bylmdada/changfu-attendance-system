'use client';

import { useState, useEffect, useCallback } from 'react';
import { Clock, Upload, Download, Search, Users, RefreshCw, X, Plus, Minus, AlertCircle, CheckCircle } from 'lucide-react';
import { buildAuthMeRequest, buildCookieSessionRequest } from '@/lib/admin-session-client';
import fetchWithCSRF, { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';

interface User {
  id: number;
  username: string;
  role: string;
  employee?: {
    id: number;
    employeeId: string;
    name: string;
    department: string;
  };
}

interface CompLeaveBalance {
  id: number;
  employeeId: number;
  totalEarned: number;
  totalUsed: number;
  balance: number;
  pendingEarn: number;
  pendingUse: number;
  updatedAt: string;
  employee: {
    id: number;
    employeeId: string;
    name: string;
    department: string;
  };
}

interface ImportResult {
  success: number;
  failed: number;
  errors: string[];
}

export default function CompLeaveManagementPage() {
  const [user, setUser] = useState<User | null>(null);
  const [balances, setBalances] = useState<CompLeaveBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [departments, setDepartments] = useState<string[]>([]);
  
  // 匯入相關
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  
  // 調整相關
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<CompLeaveBalance | null>(null);
  const [adjustType, setAdjustType] = useState<'add' | 'subtract'>('add');
  const [adjustHours, setAdjustHours] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'HR';
  const buildSessionRequest = (path: string) => buildCookieSessionRequest(window.location.origin, path);

  // 獲取資料
  const fetchData = useCallback(async () => {
    try {
      const authRequest = buildAuthMeRequest(window.location.origin);
      const authResponse = await fetch(authRequest.url, authRequest.options);
      if (!authResponse.ok) {
        window.location.href = '/login';
        return;
      }
      const userData = await authResponse.json();
      setUser(userData.user);
      const listRequest = buildSessionRequest('/api/comp-leave/list');
      
      // 獲取所有員工的補休餘額
      const response = await fetch(listRequest.url, listRequest.options);

      if (response.ok) {
        const data = await response.json();
        setBalances(data.balances || []);
        
        // 提取部門列表
        const depts = [...new Set(data.balances.map((b: CompLeaveBalance) => b.employee.department))] as string[];
        setDepartments(depts.sort());
      }
    } catch (error) {
      console.error('獲取資料失敗:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 篩選資料
  const filteredBalances = balances.filter(b => {
    if (departmentFilter && b.employee.department !== departmentFilter) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return (
        b.employee.name.toLowerCase().includes(term) ||
        b.employee.employeeId.toLowerCase().includes(term)
      );
    }
    return true;
  });

  // 下載範本
  const handleDownloadTemplate = async () => {
    try {
      const request = buildSessionRequest('/api/comp-leave/import');
      const response = await fetch(request.url, request.options);

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'comp_leave_import_template.xlsx';
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('下載範本失敗:', error);
      alert('下載範本失敗');
    }
  };

  // 處理匯入
  const handleImport = async () => {
    if (!importFile) {
      alert('請選擇檔案');
      return;
    }

    setImporting(true);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append('file', importFile);

      const request = buildSessionRequest('/api/comp-leave/import');
      const response = await fetchWithCSRF(request.url, {
        ...request.options,
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (response.ok) {
        setImportResult(data.results);
        if (data.results.success > 0) {
          fetchData(); // 重新載入資料
        }
      } else {
        alert(data.error || '匯入失敗');
      }
    } catch (error) {
      console.error('匯入失敗:', error);
      alert('匯入失敗');
    } finally {
      setImporting(false);
    }
  };

  // 處理調整
  const handleAdjust = async () => {
    if (!selectedEmployee || !adjustHours || !adjustReason) {
      alert('請填寫完整資料');
      return;
    }

    const hours = parseFloat(adjustHours);
    if (isNaN(hours) || hours <= 0) {
      alert('請輸入有效的時數');
      return;
    }

    setAdjusting(true);

    try {
      const response = await fetchJSONWithCSRF('/api/comp-leave/adjust', {
        method: 'POST',
        body: {
          employeeId: selectedEmployee.employeeId,
          type: adjustType,
          hours,
          reason: adjustReason
        }
      });

      if (response.ok) {
        alert('調整成功');
        setShowAdjustModal(false);
        setSelectedEmployee(null);
        setAdjustHours('');
        setAdjustReason('');
        fetchData();
      } else {
        const data = await response.json();
        alert(data.error || '調整失敗');
      }
    } catch (error) {
      console.error('調整失敗:', error);
      alert('調整失敗');
    } finally {
      setAdjusting(false);
    }
  };

  // 統計
  const stats = {
    totalEmployees: filteredBalances.length,
    totalBalance: filteredBalances.reduce((sum, b) => sum + b.balance, 0),
    totalPending: filteredBalances.reduce((sum, b) => sum + (b.pendingEarn - b.pendingUse), 0)
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* 頁面標題 */}
          <div className="mb-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Clock className="h-8 w-8 text-blue-600" />
                <h1 className="text-3xl font-bold text-gray-900">補休管理</h1>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleDownloadTemplate}
                    className="flex items-center gap-2 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    <Download className="h-5 w-5" />
                    下載範本
                  </button>
                  <button
                    onClick={() => {
                      setShowImportModal(true);
                      setImportFile(null);
                      setImportResult(null);
                    }}
                    className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <Upload className="h-5 w-5" />
                    匯入餘額
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 統計卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center">
                <Users className="h-8 w-8 text-blue-600" />
                <div className="ml-4">
                  <div className="text-sm font-medium text-gray-500">員工數</div>
                  <div className="text-2xl font-bold text-gray-900">{stats.totalEmployees}</div>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center">
                <Clock className="h-8 w-8 text-green-600" />
                <div className="ml-4">
                  <div className="text-sm font-medium text-gray-500">總餘額（小時）</div>
                  <div className="text-2xl font-bold text-gray-900">{stats.totalBalance.toFixed(1)}</div>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center">
                <RefreshCw className="h-8 w-8 text-yellow-600" />
                <div className="ml-4">
                  <div className="text-sm font-medium text-gray-500">待確認（小時）</div>
                  <div className="text-2xl font-bold text-gray-900">{stats.totalPending.toFixed(1)}</div>
                </div>
              </div>
            </div>
          </div>

          {/* 篩選區域 */}
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">搜尋</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="員工姓名或編號"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">部門</label>
                <select
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                >
                  <option value="">全部部門</option>
                  {departments.map(dept => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  onClick={fetchData}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
                >
                  <RefreshCw className="h-4 w-4" />
                  重新載入
                </button>
              </div>
            </div>
          </div>

          {/* 餘額列表 */}
          <div className="bg-white rounded-lg shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">補休餘額列表</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      員工
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      部門
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      累計獲得（小時）
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      已使用（小時）
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      可用餘額（小時）
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      待確認（小時）
                    </th>
                    {isAdmin && (
                      <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        操作
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredBalances.map((balance) => (
                    <tr key={balance.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{balance.employee.name}</div>
                        <div className="text-sm text-gray-500">{balance.employee.employeeId}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {balance.employee.department}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                        {balance.totalEarned.toFixed(1)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                        {balance.totalUsed.toFixed(1)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className={`text-sm font-medium ${
                          balance.balance > 8 ? 'text-green-600' :
                          balance.balance > 0 ? 'text-yellow-600' : 'text-gray-500'
                        }`}>
                          {balance.balance.toFixed(1)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-500">
                        {(balance.pendingEarn - balance.pendingUse).toFixed(1)}
                      </td>
                      {isAdmin && (
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <button
                            onClick={() => {
                              setSelectedEmployee(balance);
                              setShowAdjustModal(true);
                              setAdjustType('add');
                              setAdjustHours('');
                              setAdjustReason('');
                            }}
                            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                          >
                            調整
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>

              {filteredBalances.length === 0 && (
                <div className="text-center py-12">
                  <Clock className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                  <p className="text-gray-500">暫無補休餘額記錄</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 匯入模態框 */}
        {showImportModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg max-w-lg w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">匯入補休餘額</h3>
                <button
                  onClick={() => setShowImportModal(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {!importResult ? (
                <>
                  <div className="mb-4">
                    <p className="text-sm text-gray-600 mb-4">
                      請上傳 Excel (.xlsx) 或 CSV 格式的檔案。
                      <button
                        onClick={handleDownloadTemplate}
                        className="text-blue-600 hover:underline ml-1"
                      >
                        下載範本
                      </button>
                    </p>
                    
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                      <input
                        type="file"
                        accept=".xlsx,.csv"
                        onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                        className="hidden"
                        id="file-upload"
                      />
                      <label
                        htmlFor="file-upload"
                        className="cursor-pointer"
                      >
                        <Upload className="mx-auto h-12 w-12 text-gray-400 mb-2" />
                        <p className="text-sm text-gray-600">
                          {importFile ? importFile.name : '點擊或拖放檔案到此處'}
                        </p>
                      </label>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowImportModal(false)}
                      className="flex-1 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleImport}
                      disabled={!importFile || importing}
                      className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {importing ? '匯入中...' : '開始匯入'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-4">
                      {importResult.failed === 0 ? (
                        <CheckCircle className="h-6 w-6 text-green-600" />
                      ) : (
                        <AlertCircle className="h-6 w-6 text-yellow-600" />
                      )}
                      <span className="font-medium text-gray-900">
                        匯入完成：成功 {importResult.success} 筆，失敗 {importResult.failed} 筆
                      </span>
                    </div>

                    {importResult.errors.length > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-h-60 overflow-y-auto">
                        <h4 className="text-sm font-medium text-red-800 mb-2">錯誤訊息：</h4>
                        <ul className="text-sm text-red-700 space-y-1">
                          {importResult.errors.map((error, index) => (
                            <li key={index}>• {error}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => setShowImportModal(false)}
                    className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                  >
                    關閉
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* 調整模態框 */}
        {showAdjustModal && selectedEmployee && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg max-w-md w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">調整補休餘額</h3>
                <button
                  onClick={() => setShowAdjustModal(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="mb-4 p-4 bg-gray-50 rounded-lg">
                <div className="text-sm text-gray-600">員工：{selectedEmployee.employee.name}</div>
                <div className="text-sm text-gray-600">目前餘額：{selectedEmployee.balance.toFixed(1)} 小時</div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">調整類型</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={adjustType === 'add'}
                        onChange={() => setAdjustType('add')}
                        className="text-blue-600"
                      />
                      <Plus className="h-4 w-4 text-green-600" />
                      <span className="text-gray-900">增加</span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={adjustType === 'subtract'}
                        onChange={() => setAdjustType('subtract')}
                        className="text-blue-600"
                      />
                      <Minus className="h-4 w-4 text-red-600" />
                      <span className="text-gray-900">扣除</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">時數</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={adjustHours}
                    onChange={(e) => setAdjustHours(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                    placeholder="請輸入時數"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">原因</label>
                  <textarea
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                    rows={3}
                    placeholder="請輸入調整原因"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowAdjustModal(false)}
                  className="flex-1 border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={handleAdjust}
                  disabled={adjusting || !adjustHours || !adjustReason}
                  className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {adjusting ? '處理中...' : '確認調整'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthenticatedLayout>
  );
}
