'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Mail, Calendar, Clock, Save, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import SystemNavbar from '@/components/SystemNavbar';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';

interface NotificationSettings {
  emailEnabled: boolean;
  inAppEnabled: boolean;
  leaveApprovalNotify: boolean;
  overtimeApprovalNotify: boolean;
  shiftApprovalNotify: boolean;
  annualLeaveExpiryNotify: boolean;
  annualLeaveExpiryDays: number;
}

interface User {
  id: number;
  username: string;
  role: string;
  employee?: {
    id: number;
    employeeId: string;
    name: string;
  };
}

export default function NotificationConfigPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<NotificationSettings>({
    emailEnabled: false,
    inAppEnabled: true,
    leaveApprovalNotify: true,
    overtimeApprovalNotify: true,
    shiftApprovalNotify: true,
    annualLeaveExpiryNotify: true,
    annualLeaveExpiryDays: 30,
  });
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    document.title = '系統通知設定 - 長福會考勤系統';
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = async () => {
    try {
      // 驗證登入
      const authRes = await fetch('/api/auth/me', { credentials: 'include' });
      if (!authRes.ok) {
        router.push('/login');
        return;
      }
      const authData = await authRes.json();
      if (authData.user.role !== 'ADMIN') {
        router.push('/dashboard');
        return;
      }
      setUser(authData.user);

      // 載入設定
      const settingsRes = await fetch('/api/system-settings/notification-settings', {
        credentials: 'include',
      });
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        if (data.settings) {
          setSettings(data.settings);
        }
      }
    } catch (error) {
      console.error('載入失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/notification-settings', {
        method: 'POST',
        body: settings,
      });

      const data = await response.json();
      if (response.ok) {
        showToast('success', '設定已儲存');
      } else {
        showToast('error', data.error || '儲存失敗');
      }
    } catch (error) {
      console.error('儲存失敗:', error);
      showToast('error', '系統錯誤');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />

      <div className="max-w-4xl mx-auto py-8 px-4">
        {/* Toast 通知 */}
        {toast && (
          <div className={`fixed top-20 right-4 z-50 p-4 rounded-lg shadow-lg flex items-center space-x-2 ${
            toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
          }`}>
            {toast.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            <span>{toast.message}</span>
          </div>
        )}

        {/* 頁面標題 */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            <Bell className="mr-3 h-7 w-7 text-orange-500" />
            系統通知設定
          </h1>
          <p className="text-gray-600 mt-2">
            設定審核結果通知、年假到期提醒等系統通知功能
          </p>
        </div>

        {/* 通知渠道設定 */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Mail className="w-5 h-5 mr-2 text-blue-500" />
            通知渠道
          </h2>

          <div className="space-y-4">
            <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <div className="font-medium text-gray-900">系統內通知</div>
                <div className="text-sm text-gray-500">在系統內顯示通知（登入後可在右上角查看）</div>
              </div>
              <input
                type="checkbox"
                checked={settings.inAppEnabled}
                onChange={(e) => setSettings({ ...settings, inAppEnabled: e.target.checked })}
                className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
              />
            </label>

            <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <div className="font-medium text-gray-900">郵件通知</div>
                <div className="text-sm text-gray-500">發送 Email 通知（需先設定 SMTP 郵件伺服器）</div>
              </div>
              <input
                type="checkbox"
                checked={settings.emailEnabled}
                onChange={(e) => setSettings({ ...settings, emailEnabled: e.target.checked })}
                className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
              />
            </label>
          </div>

          {settings.emailEnabled && (
            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700">
              <AlertCircle className="w-4 h-4 inline mr-1" />
              請確認已在「郵件伺服器設定」中完成 SMTP 設定，否則郵件將無法發送
            </div>
          )}
        </div>

        {/* 審核通知設定 */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Clock className="w-5 h-5 mr-2 text-green-500" />
            審核結果通知
          </h2>

          <div className="space-y-4">
            <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <div className="font-medium text-gray-900">請假審核通知</div>
                <div className="text-sm text-gray-500">請假申請核准/拒絕時通知申請人</div>
              </div>
              <input
                type="checkbox"
                checked={settings.leaveApprovalNotify}
                onChange={(e) => setSettings({ ...settings, leaveApprovalNotify: e.target.checked })}
                className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
              />
            </label>

            <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <div className="font-medium text-gray-900">加班審核通知</div>
                <div className="text-sm text-gray-500">加班申請核准/拒絕時通知申請人</div>
              </div>
              <input
                type="checkbox"
                checked={settings.overtimeApprovalNotify}
                onChange={(e) => setSettings({ ...settings, overtimeApprovalNotify: e.target.checked })}
                className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
              />
            </label>

            <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <div className="font-medium text-gray-900">換班審核通知</div>
                <div className="text-sm text-gray-500">換班申請核准/拒絕時通知申請人</div>
              </div>
              <input
                type="checkbox"
                checked={settings.shiftApprovalNotify}
                onChange={(e) => setSettings({ ...settings, shiftApprovalNotify: e.target.checked })}
                className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
              />
            </label>
          </div>
        </div>

        {/* 年假到期提醒 */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Calendar className="w-5 h-5 mr-2 text-purple-500" />
            年假到期提醒
          </h2>

          <div className="space-y-4">
            <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <div className="font-medium text-gray-900">啟用年假到期提醒</div>
                <div className="text-sm text-gray-500">在年假即將到期前發送提醒通知</div>
              </div>
              <input
                type="checkbox"
                checked={settings.annualLeaveExpiryNotify}
                onChange={(e) => setSettings({ ...settings, annualLeaveExpiryNotify: e.target.checked })}
                className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
              />
            </label>

            {settings.annualLeaveExpiryNotify && (
              <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                <h3 className="font-medium text-gray-900 mb-3">📅 分階段提醒頻率</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-600">
                        <th className="py-2 px-3">階段</th>
                        <th className="py-2 px-3">距離到期</th>
                        <th className="py-2 px-3">提醒頻率</th>
                      </tr>
                    </thead>
                    <tbody className="text-gray-900">
                      <tr className="border-t border-purple-200">
                        <td className="py-2 px-3 font-medium">提前規劃</td>
                        <td className="py-2 px-3">90-60 天</td>
                        <td className="py-2 px-3">每月 1 次</td>
                      </tr>
                      <tr className="border-t border-purple-200">
                        <td className="py-2 px-3 font-medium">督促安排</td>
                        <td className="py-2 px-3">60-30 天</td>
                        <td className="py-2 px-3">每 2 週 1 次</td>
                      </tr>
                      <tr className="border-t border-purple-200">
                        <td className="py-2 px-3 font-medium">加緊提醒</td>
                        <td className="py-2 px-3">30-7 天</td>
                        <td className="py-2 px-3">每週 1 次</td>
                      </tr>
                      <tr className="border-t border-purple-200 bg-red-50">
                        <td className="py-2 px-3 font-medium text-red-700">⚠️ 緊急提醒</td>
                        <td className="py-2 px-3 text-red-700">7-0 天</td>
                        <td className="py-2 px-3 text-red-700">每天 1 次</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-sm text-purple-700 mt-3">
                  💡 系統會自動記錄發送歷史，避免在同一頻率週期內重複發送
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 儲存按鈕 */}
        <div className="flex justify-end space-x-3">
          <button
            onClick={loadData}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            重新載入
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center disabled:opacity-50"
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? '儲存中...' : '儲存設定'}
          </button>
        </div>

        {/* 說明區塊 */}
        <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="font-medium text-blue-900 mb-2">💡 使用說明</h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• <strong>系統內通知</strong>：用戶登入後可在系統內查看通知</li>
            <li>• <strong>郵件通知</strong>：需先在「郵件伺服器設定」完成 SMTP 設定</li>
            <li>• <strong>審核通知</strong>：當請假/加班/換班申請被審核時，自動通知申請人</li>
            <li>• <strong>年假到期提醒</strong>：可手動或設定定時任務觸發</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
