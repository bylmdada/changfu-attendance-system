'use client';

import { useState, useEffect, useCallback } from 'react';
import { Calendar, Plus, Trash2, Save, Download, CloudDownload, X, Check, Edit2, RefreshCw } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import SystemNavbar from '@/components/SystemNavbar';

interface Holiday {
  id: number;
  year: number;
  date: string;
  name: string;
  description: string | null;
}

interface GovHoliday {
  date: string;
  week: string;
  isHoliday: boolean;
  description: string;
  selected?: boolean;
  editedName?: string;
}

interface User {
  id: number;
  username: string;
  role: string;
  employee?: {
    id: number;
    employeeId?: string;
    name: string;
  };
}

export default function HolidaysPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [showAddForm, setShowAddForm] = useState(false);
  const [newHoliday, setNewHoliday] = useState({ date: '', name: '', description: '' });
  
  // 政府行事曆匯入相關狀態
  const [showImportModal, setShowImportModal] = useState(false);
  const [govHolidays, setGovHolidays] = useState<GovHoliday[]>([]);
  const [loadingGov, setLoadingGov] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const showToast = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const userResponse = await fetch('/api/auth/me', { credentials: 'include' });
        if (userResponse.ok) {
          const userData = await userResponse.json();
          const currentUser = userData.user || userData;
          if (currentUser.role !== 'ADMIN' && currentUser.role !== 'HR') {
            window.location.href = '/dashboard';
            return;
          }
          setUser(currentUser);
        } else {
          window.location.href = '/login';
          return;
        }
      } catch (error) {
        console.error('載入失敗:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const loadHolidays = useCallback(async () => {
    try {
      const response = await fetch(`/api/system-settings/holidays?year=${selectedYear}`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setHolidays(data.holidays || []);
      }
    } catch (error) {
      console.error('載入假日失敗:', error);
    }
  }, [selectedYear]);

  useEffect(() => {
    if (user) {
      loadHolidays();
    }
  }, [selectedYear, user, loadHolidays]);

  const handleAddHoliday = async () => {
    if (!newHoliday.date || !newHoliday.name) {
      showToast('error', '請填寫日期和名稱');
      return;
    }

    setSaving(true);
    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/holidays', {
        method: 'POST',
        body: { year: selectedYear, date: newHoliday.date, name: newHoliday.name, description: newHoliday.description }
      });

      if (response.ok) {
        showToast('success', '假日已新增');
        setShowAddForm(false);
        setNewHoliday({ date: '', name: '', description: '' });
        await loadHolidays();
      } else {
        const error = await response.json();
        showToast('error', error.error || '新增失敗');
      }
    } catch (error) {
      console.error('新增失敗:', error);
      showToast('error', '新增失敗');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteHoliday = async (id: number) => {
    if (!confirm('確定要刪除此假日？')) return;

    try {
      const response = await fetchJSONWithCSRF(`/api/system-settings/holidays?id=${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        showToast('success', '假日已刪除');
        await loadHolidays();
      } else {
        showToast('error', '刪除失敗');
      }
    } catch (error) {
      console.error('刪除失敗:', error);
      showToast('error', '刪除失敗');
    }
  };

  // 從政府行事曆 API 取得假日
  const fetchGovHolidays = async () => {
    setLoadingGov(true);
    try {
      // 使用 ruyut/TaiwanCalendar API
      const response = await fetch(`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${selectedYear}.json`);
      
      if (!response.ok) {
        throw new Error('無法取得政府行事曆資料');
      }
      
      const data: GovHoliday[] = await response.json();
      
      // 篩選出假日，並標記為選中
      const holidaysOnly = data
        .filter(d => d.isHoliday && d.description && d.description.trim() !== '')
        .map(d => ({
          ...d,
          selected: true,
          editedName: d.description
        }));
      
      setGovHolidays(holidaysOnly);
      setShowImportModal(true);
    } catch (error) {
      console.error('取得政府行事曆失敗:', error);
      showToast('error', '無法取得政府行事曆資料，請稍後再試');
    } finally {
      setLoadingGov(false);
    }
  };

  // 切換假日選擇
  const toggleHolidaySelection = (index: number) => {
    setGovHolidays(prev => prev.map((h, i) => 
      i === index ? { ...h, selected: !h.selected } : h
    ));
  };

  // 全選/取消全選
  const toggleSelectAll = () => {
    const allSelected = govHolidays.every(h => h.selected);
    setGovHolidays(prev => prev.map(h => ({ ...h, selected: !allSelected })));
  };

  // 編輯假日名稱
  const updateHolidayName = (index: number, name: string) => {
    setGovHolidays(prev => prev.map((h, i) => 
      i === index ? { ...h, editedName: name } : h
    ));
  };

  // 確認匯入選擇的假日
  const confirmImport = async () => {
    const selectedHolidays = govHolidays.filter(h => h.selected);
    
    if (selectedHolidays.length === 0) {
      showToast('error', '請至少選擇一個假日');
      return;
    }

    setSaving(true);
    try {
      const holidaysToImport = selectedHolidays.map(h => ({
        date: h.date,
        name: h.editedName || h.description,
        description: '政府行事曆匯入'
      }));

      const response = await fetchJSONWithCSRF('/api/system-settings/holidays', {
        method: 'PUT',
        body: { year: selectedYear, holidays: holidaysToImport }
      });

      if (response.ok) {
        const data = await response.json();
        showToast('success', data.message || `已匯入 ${selectedHolidays.length} 個假日`);
        setShowImportModal(false);
        setGovHolidays([]);
        await loadHolidays();
      } else {
        showToast('error', '匯入失敗');
      }
    } catch (error) {
      console.error('匯入失敗:', error);
      showToast('error', '匯入失敗');
    } finally {
      setSaving(false);
    }
  };

  // 匯出假日為 Excel
  const handleExport = async () => {
    if (holidays.length === 0) {
      showToast('error', '沒有假日資料可匯出');
      return;
    }

    try {
      const XLSX = await import('xlsx');
      
      // 日期格式化函數
      const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}/${month}/${day}`;
      };
      
      const data = holidays.map(h => ({
        '日期': formatDate(h.date),
        '星期': new Date(h.date).toLocaleDateString('zh-TW', { weekday: 'short' }),
        '假日名稱': h.name,
        '說明': h.description || ''
      }));

      const worksheet = XLSX.utils.json_to_sheet(data);
      worksheet['!cols'] = [{ wch: 12 }, { wch: 8 }, { wch: 20 }, { wch: 30 }];
      
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, `${selectedYear}年國定假日`);
      
      const excelBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
      const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `國定假日_${selectedYear}年.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      
      showToast('success', '匯出成功');
    } catch (error) {
      console.error('匯出失敗:', error);
      showToast('error', '匯出失敗');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />

      {/* Toast 訊息 */}
      {message && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg ${
          message.type === 'success' ? 'bg-green-500' : 'bg-red-500'
        } text-white`}>
          {message.type === 'success' ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
          {message.text}
        </div>
      )}

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 標題 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <Calendar className="w-8 h-8 text-red-600 mr-3" />
            國定假日管理
          </h1>
          <p className="text-gray-600 mt-2">管理年度國定假日，用於薪資計算時判斷假日加班</p>
        </div>

        {/* 年份選擇和操作 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium text-gray-900">選擇年份</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
              >
                {[...Array(5)].map((_, i) => {
                  const year = new Date().getFullYear() + i - 1;
                  return <option key={year} value={year}>{year}</option>;
                })}
              </select>
              <span className="text-sm text-gray-500">（共 {holidays.length} 天）</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {/* 從政府行事曆匯入 */}
              <button
                onClick={fetchGovHolidays}
                disabled={loadingGov}
                className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                {loadingGov ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <CloudDownload className="w-4 h-4 mr-2" />
                )}
                從政府行事曆匯入
              </button>
              
              {/* 匯出 */}
              <button
                onClick={handleExport}
                disabled={holidays.length === 0}
                className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                <Download className="w-4 h-4 mr-2" />
                匯出 Excel
              </button>
              
              {/* 新增假日 */}
              <button
                onClick={() => setShowAddForm(true)}
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                新增假日
              </button>
            </div>
          </div>
        </div>

        {/* 新增表單 */}
        {showAddForm && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <h3 className="font-medium text-gray-900 mb-4">新增假日</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">日期</label>
                <input
                  type="date"
                  value={newHoliday.date}
                  onChange={(e) => setNewHoliday({ ...newHoliday, date: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">名稱</label>
                <input
                  type="text"
                  value={newHoliday.name}
                  onChange={(e) => setNewHoliday({ ...newHoliday, name: e.target.value })}
                  placeholder="例：春節"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">說明（選填）</label>
                <input
                  type="text"
                  value={newHoliday.description}
                  onChange={(e) => setNewHoliday({ ...newHoliday, description: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleAddHoliday}
                disabled={saving}
                className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                <Save className="w-4 h-4 mr-2" />
                {saving ? '儲存中...' : '儲存'}
              </button>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setNewHoliday({ date: '', name: '', description: '' });
                }}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 假日列表 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="font-medium text-gray-900">{selectedYear} 年國定假日</h3>
          </div>
          {holidays.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Calendar className="h-12 w-12 mx-auto mb-4 text-gray-400" />
              <p>尚無假日資料</p>
              <p className="text-sm mt-1">點擊「從政府行事曆匯入」或「新增假日」</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">日期</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">名稱</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">說明</th>
                  <th className="px-6 py-3 text-right text-sm font-medium text-gray-700">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {holidays.map((holiday) => (
                  <tr key={holiday.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-gray-900">
                      {new Date(holiday.date).toLocaleDateString('zh-TW', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        weekday: 'short'
                      })}
                    </td>
                    <td className="px-6 py-4 font-medium text-gray-900">{holiday.name}</td>
                    <td className="px-6 py-4 text-gray-600">{holiday.description || '-'}</td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleDeleteHoliday(holiday.id)}
                        className="text-red-600 hover:text-red-800"
                        title="刪除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>

      {/* 政府行事曆匯入對話框 */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">從政府行事曆匯入 - {selectedYear}年</h3>
                <p className="text-sm text-gray-500">勾選要匯入的假日，可編輯名稱</p>
              </div>
              <button
                onClick={() => { setShowImportModal(false); setGovHolidays([]); }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="px-6 py-3 bg-gray-50 border-b flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={govHolidays.length > 0 && govHolidays.every(h => h.selected)}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded text-blue-600"
                />
                <span className="text-gray-700">全選/取消全選</span>
              </label>
              <span className="text-sm text-gray-600">
                已選擇 {govHolidays.filter(h => h.selected).length} / {govHolidays.length} 個假日
              </span>
            </div>

            <div className="overflow-y-auto max-h-[50vh]">
              <table className="w-full">
                <thead className="bg-gray-100 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 w-12">選擇</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 w-32">日期</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 w-16">星期</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">假日名稱</th>
                    <th className="px-4 py-2 text-center text-sm font-medium text-gray-700 w-20">編輯</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {govHolidays.map((holiday, index) => (
                    <tr key={holiday.date} className={`${holiday.selected ? 'bg-blue-50' : 'bg-white'} hover:bg-blue-100`}>
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          checked={holiday.selected}
                          onChange={() => toggleHolidaySelection(index)}
                          className="w-4 h-4 rounded text-blue-600"
                        />
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-900">{holiday.date}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{holiday.week}</td>
                      <td className="px-4 py-2">
                        {editingIndex === index ? (
                          <input
                            type="text"
                            value={holiday.editedName}
                            onChange={(e) => updateHolidayName(index, e.target.value)}
                            onBlur={() => setEditingIndex(null)}
                            onKeyDown={(e) => e.key === 'Enter' && setEditingIndex(null)}
                            autoFocus
                            className="w-full px-2 py-1 border rounded text-sm text-gray-900"
                          />
                        ) : (
                          <span className={`text-sm ${holiday.editedName !== holiday.description ? 'text-blue-600 font-medium' : 'text-gray-900'}`}>
                            {holiday.editedName || holiday.description}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <button
                          onClick={() => setEditingIndex(index)}
                          className="text-blue-600 hover:text-blue-800"
                          title="編輯名稱"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => { setShowImportModal(false); setGovHolidays([]); }}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={confirmImport}
                disabled={saving || govHolidays.filter(h => h.selected).length === 0}
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Check className="w-4 h-4 mr-2" />
                )}
                確認匯入 ({govHolidays.filter(h => h.selected).length} 個)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
