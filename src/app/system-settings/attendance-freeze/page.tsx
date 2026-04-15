'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save, AlertTriangle, Lock } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import {
  buildAttendanceFreezeRequest,
  buildAuthMeRequest,
} from '@/lib/attendance-freeze-client';
import SystemNavbar from '@/components/SystemNavbar';

interface AttendanceFreezeSettings {
  id?: number;
  freezeDay: number; // 每月凍結日期 (1-31)
  freezeTime: string; // 凍結時間 (HH:MM)
  isEnabled: boolean;
  description: string;
  createdAt?: string;
  updatedAt?: string;
}

export default function AttendanceFreezePage() {
  const router = useRouter();
  const [user, setUser] = useState<{
    id: number;
    username: string;
    role: string;
    employee: {
      id: number;
      employeeId: string;
      name: string;
      department: string;
      position: string;
    };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<AttendanceFreezeSettings>({
    freezeDay: 5,
    freezeTime: '18:00',
    isEnabled: true,
    description: '每月5日下午6點後，前一個月的考勤記錄將被凍結，無法修改。'
  });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const origin = window.location.origin;
        const authMeRequest = buildAuthMeRequest(origin);
        const response = await fetch(authMeRequest.url, authMeRequest.options);
        
        if (response.ok) {
          const userData = await response.json();
          const currentUser = userData.user || userData;
          
          if (currentUser.role !== 'ADMIN') {
            router.push('/dashboard');
            return;
          }
          setUser(currentUser);
          await loadSettings();
        } else if (response.status === 401 || response.status === 403) {
          console.warn('Authentication failed, redirecting to login');
          router.push('/login');
        } else {
          router.push('/login');
        }
      } catch (error) {
        console.error('驗證失敗:', error);
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, [router]);

  const loadSettings = async () => {
    try {
      const origin = window.location.origin;
      const settingsRequest = buildAttendanceFreezeRequest(origin);
      const response = await fetch(settingsRequest.url, settingsRequest.options);
      
      if (response.ok) {
        const data = await response.json();
        if (data.settings) {
          setSettings(data.settings);
        }
      }
    } catch (error) {
      console.error('載入設定失敗:', error);
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/attendance-freeze', {
        method: 'POST',
        body: settings
      });

      if (response.ok) {
        const data = await response.json();
        setSettings(data.settings);
        setMessage({ type: 'success', text: '設定已儲存成功！' });
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.error || '儲存失敗' });
      }
    } catch (error) {
      console.error('儲存設定失敗:', error);
      setMessage({ type: 'error', text: '儲存失敗，請稍後再試' });
    } finally {
      setSaving(false);
    }
  };

  const getCurrentStatus = () => {
    const now = new Date();
    const currentDay = now.getDate();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const [freezeHour, freezeMinute] = settings.freezeTime.split(':').map(Number);
    
    const isAfterFreezeTime = currentHour > freezeHour || 
      (currentHour === freezeHour && currentMinute >= freezeMinute);
    
    if (!settings.isEnabled) {
      return { status: 'disabled', message: '考勤凍結功能已停用' };
    }
    
    if (currentDay >= settings.freezeDay && isAfterFreezeTime) {
      return { 
        status: 'frozen', 
        message: `本月考勤已於 ${settings.freezeDay} 日 ${settings.freezeTime} 凍結` 
      };
    } else {
      const nextFreezeDate = new Date(now.getFullYear(), now.getMonth(), settings.freezeDay);
      if (currentDay >= settings.freezeDay) {
        nextFreezeDate.setMonth(nextFreezeDate.getMonth() + 1);
      }
      
      return { 
        status: 'active', 
        message: `下次凍結時間：${nextFreezeDate.getFullYear()}/${(nextFreezeDate.getMonth() + 1).toString().padStart(2, '0')}/${settings.freezeDay.toString().padStart(2, '0')} ${settings.freezeTime}` 
      };
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  const status = getCurrentStatus();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 頂部導航 */}
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />

      {/* 主要內容 */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 標題區 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <Lock className="w-8 h-8 text-blue-600 mr-3" />
            考勤凍結管理
          </h1>
          <p className="text-gray-600 mt-2">設定考勤資料凍結與解凍</p>
        </div>

        {message && (
          <div className={`mb-6 p-4 rounded-lg ${
            message.type === 'success' 
              ? 'bg-green-50 border border-green-200 text-green-800' 
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}>
            {message.text}
          </div>
        )}

        {/* 當前狀態 */}
        <div className="mb-8 bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">當前狀態</h2>
          </div>
          <div className="p-6">
            <div className={`flex items-center space-x-3 p-4 rounded-lg ${
              status.status === 'frozen' 
                ? 'bg-red-50 border border-red-200' 
                : status.status === 'disabled'
                ? 'bg-gray-50 border border-gray-200'
                : 'bg-green-50 border border-green-200'
            }`}>
              <div className={`h-3 w-3 rounded-full ${
                status.status === 'frozen' 
                  ? 'bg-red-500' 
                  : status.status === 'disabled'
                  ? 'bg-gray-500'
                  : 'bg-green-500'
              }`}></div>
              <span className={`font-medium ${
                status.status === 'frozen' 
                  ? 'text-red-800' 
                  : status.status === 'disabled'
                  ? 'text-gray-800'
                  : 'text-green-800'
              }`}>
                {status.message}
              </span>
            </div>
          </div>
        </div>

        {/* 設定表單 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">凍結規則設定</h2>
          </div>
          
          <div className="p-6 space-y-6">
            {/* 啟用開關 */}
            <div>
              <label className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  checked={settings.isEnabled}
                  onChange={(e) => setSettings({ ...settings, isEnabled: e.target.checked })}
                  className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                />
                <span className="text-sm font-medium text-gray-900">啟用考勤凍結功能</span>
              </label>
              <p className="mt-1 text-sm text-gray-900">關閉此功能將允許隨時修改考勤記錄</p>
            </div>

            {/* 凍結日期 */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                每月凍結日期
              </label>
              <select
                value={settings.freezeDay}
                onChange={(e) => setSettings({ ...settings, freezeDay: parseInt(e.target.value) })}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                disabled={!settings.isEnabled}
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                  <option key={day} value={day} className="text-gray-900">
                    每月 {day} 日
                  </option>
                ))}
              </select>
              <p className="mt-1 text-sm text-gray-900">
                選擇每月的凍結日期，到達此日期後前一個月的考勤記錄將被凍結
              </p>
            </div>

            {/* 凍結時間 */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                凍結時間
              </label>
              <input
                type="time"
                value={settings.freezeTime}
                onChange={(e) => setSettings({ ...settings, freezeTime: e.target.value })}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                disabled={!settings.isEnabled}
              />
              <p className="mt-1 text-sm text-gray-900">
                設定每日的凍結時間，過了此時間後當日的考勤凍結規則生效
              </p>
            </div>

            {/* 說明描述 */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                規則說明
              </label>
              <textarea
                value={settings.description}
                onChange={(e) => setSettings({ ...settings, description: e.target.value })}
                rows={3}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                disabled={!settings.isEnabled}
                placeholder="請輸入考勤凍結規則的詳細說明..."
              />
              <p className="mt-1 text-sm text-gray-900">
                此說明將顯示給員工，讓他們了解考勤凍結的規則
              </p>
            </div>

            {/* 警告說明 */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-medium text-yellow-800">重要提醒</h4>
                  <ul className="text-sm text-yellow-700 mt-1 space-y-1">
                    <li>• 考勤凍結後，員工和HR將無法修改被凍結期間的考勤記錄</li>
                    <li>• 建議在薪資計算前設定合適的凍結時間</li>
                    <li>• 修改凍結規則將立即生效，請謹慎操作</li>
                    <li>• 系統管理員始終可以解除凍結狀態</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* 操作按鈕 */}
            <div className="flex justify-end space-x-4 pt-4 border-t border-gray-200">
              <button
                onClick={() => router.push('/system-settings')}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                取消
              </button>
              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                {saving ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    <span>儲存中...</span>
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    <span>儲存設定</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
