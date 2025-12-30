'use client';

import { useState, useEffect } from 'react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';

interface AttendanceFreeze {
  id: number;
  freezeDate: string;
  targetMonth: number;
  targetYear: number;
  description?: string;
  isActive: boolean;
  createdAt: string;
  creator: {
    id: number;
    employeeId: string;
    name: string;
  };
}

interface User {
  userId: number;
  employeeId: number;
  username: string;
  role: string;
}

export default function AttendanceFreezePage() {
  const [freezes, setFreezes] = useState<AttendanceFreeze[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // 表單狀態
  const [formData, setFormData] = useState({
    freezeDate: '',
    targetMonth: '',
    targetYear: '',
    description: '',
    autoCalculatePayroll: false
  });

  const initializeData = async () => {
    try {
      // 獲取用戶信息
      const authResponse = await fetch('/api/auth/me', {
        credentials: 'include'
      });

      if (authResponse.ok) {
        const authData = await authResponse.json();
        setUser(authData.user);

        // 檢查權限
        if (authData.user.role !== 'ADMIN' && authData.user.role !== 'HR') {
          setError('您沒有權限訪問此頁面');
          setLoading(false);
          return;
        }
      }

      // 獲取凍結設定列表
      await fetchFreezes();
    } catch (error) {
      console.error('載入數據失敗:', error);
      setError('載入數據失敗');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    initializeData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchFreezes = async () => {
    try {
      const response = await fetch('/api/attendance-freeze', {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setFreezes(data.freezes);
      }
    } catch (error) {
      console.error('獲取凍結設定失敗:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetchJSONWithCSRF('/api/attendance-freeze', {
        method: 'POST',
        body: {
          freezeDate: new Date(formData.freezeDate).toISOString(),
          targetMonth: parseInt(formData.targetMonth),
          targetYear: parseInt(formData.targetYear),
          description: formData.description,
          autoCalculatePayroll: formData.autoCalculatePayroll
        }
      });

      const data = await response.json();

      if (response.ok) {
        // 顯示凍結成功訊息和薪資狀態提示
        const message = data.message || '凍結設定已成功創建';
        setSuccess(message);
        setFormData({
          freezeDate: '',
          targetMonth: '',
          targetYear: '',
          description: '',
          autoCalculatePayroll: false
        });
        await fetchFreezes();
      } else {
        setError(data.error || '創建失敗');
      }
    } catch (error) {
      console.error('創建凍結設定失敗:', error);
      setError('創建失敗');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('zh-TW');
  };

  const getMonthName = (month: number) => {
    const months = ['一月', '二月', '三月', '四月', '五月', '六月',
                   '七月', '八月', '九月', '十月', '十一月', '十二月'];
    return months[month - 1];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">載入中...</div>
      </div>
    );
  }

  if (error && !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600 text-center">
          <div className="text-xl font-bold mb-2">權限錯誤</div>
          <div>{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">考勤凍結管理</h1>
        <p className="text-gray-600">設定考勤凍結日期，凍結後員工無法申請請假、加班、調班</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-6">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* 創建凍結設定 */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">創建凍結設定</h2>
          <p className="text-gray-600 mb-6">設定考勤凍結日期和鎖定的月份</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                凍結日期時間 *
              </label>
              <input
                type="datetime-local"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={formData.freezeDate}
                onChange={(e) => setFormData({ ...formData, freezeDate: e.target.value })}
                required
              />
              <p className="text-sm text-gray-500 mt-1">
                設定凍結生效的日期和時間
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  鎖定月份 *
                </label>
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={formData.targetMonth}
                  onChange={(e) => setFormData({ ...formData, targetMonth: e.target.value })}
                  required
                >
                  <option value="">選擇月份</option>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                    <option key={month} value={month}>{getMonthName(month)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  鎖定年份 *
                </label>
                <input
                  type="number"
                  placeholder="2025"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={formData.targetYear}
                  onChange={(e) => setFormData({ ...formData, targetYear: e.target.value })}
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                說明
              </label>
              <input
                type="text"
                placeholder="凍結原因說明（選填）"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            {/* 自動計算薪資選項 */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.autoCalculatePayroll}
                  onChange={(e) => setFormData({ ...formData, autoCalculatePayroll: e.target.checked })}
                  className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <div>
                  <span className="font-medium text-blue-900">凍結後自動計算薪資</span>
                  <p className="text-sm text-blue-700 mt-1">
                    勾選後，系統將自動為尚未產生薪資的員工計算當月薪資。
                    若不勾選，需手動前往薪資管理頁面執行。
                  </p>
                </div>
              </label>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {submitting ? '處理中...' : formData.autoCalculatePayroll ? '凍結並計算薪資' : '創建凍結設定'}
            </button>
          </form>
        </div>

        {/* 凍結設定列表 */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">凍結設定列表</h2>
          <p className="text-gray-600 mb-6">當前所有的考勤凍結設定</p>

          {freezes.length === 0 ? (
            <p className="text-gray-500 text-center py-8">目前沒有凍結設定</p>
          ) : (
            <div className="space-y-4">
              {freezes.map((freeze) => (
                <div key={freeze.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 text-xs rounded ${
                        freeze.isActive
                          ? 'bg-red-100 text-red-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {freeze.isActive ? '生效中' : '已停用'}
                      </span>
                      <span className="font-medium">
                        {freeze.targetYear}年{getMonthName(freeze.targetMonth)}
                      </span>
                    </div>
                    <div className="text-sm text-gray-500">
                      操作者：{freeze.creator.name}
                    </div>
                  </div>

                  <div className="text-sm text-gray-600 mb-2">
                    凍結時間：{formatDateTime(freeze.freezeDate)}
                  </div>

                  {freeze.description && (
                    <div className="text-sm text-gray-600">
                      說明：{freeze.description}
                    </div>
                  )}

                  <div className="text-xs text-gray-400 mt-2">
                    創建時間：{formatDateTime(freeze.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 使用說明 */}
      <div className="bg-white shadow rounded-lg p-6 mt-8">
        <h2 className="text-xl font-semibold mb-4">使用說明</h2>

        <div className="space-y-6">
          <div>
            <h3 className="font-medium mb-3">凍結機制說明：</h3>
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-600 ml-4">
              <li>設定凍結日期時間後，當前時間超過凍結時間時，鎖定的月份將無法申請請假、加班、調班</li>
              <li>例如：設定2025年10月5日上午10:00凍結9月份，則10月5日10:00後無法提交9月份的申請</li>
              <li>凍結設定一旦生效，無法修改或刪除，只能建立新的凍結設定</li>
              <li>管理員和HR可以查看所有凍結設定，但只有管理員可以創建新的凍結設定</li>
            </ul>
          </div>

          <div>
            <h3 className="font-medium mb-3">影響範圍：</h3>
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-600 ml-4">
              <li>請假申請：無法為凍結月份提交請假申請</li>
              <li>加班申請：無法為凍結月份提交加班申請</li>
              <li>調班申請：無法為凍結月份提交調班申請</li>
              <li>個人班表：凍結月份的班表修改將被限制</li>
            </ul>
          </div>

          <div>
            <h3 className="font-medium mb-3">使用場景：</h3>
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-600 ml-4">
              <li>月結期間：防止員工在薪資計算期間修改考勤記錄</li>
              <li>年度結算：年底結算期間凍結所有考勤修改</li>
              <li>系統維護：系統升級或維護期間暫停申請</li>
              <li>政策調整：薪資或考勤政策調整期間的過渡期</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
