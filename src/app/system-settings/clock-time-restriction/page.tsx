'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Power, PowerOff, Clock } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import SystemNavbar from '@/components/SystemNavbar';

interface ClockTimeRestrictionSettings {
  enabled: boolean;
  restrictedStartHour: number;
  restrictedEndHour: number;
  message: string;
}

export default function ClockTimeRestrictionPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<ClockTimeRestrictionSettings>({
    enabled: true,
    restrictedStartHour: 23,
    restrictedEndHour: 5,
    message: '夜間時段暫停打卡服務'
  });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [user, setUser] = useState<{
    id: number;
    username: string;
    role: string;
    employee?: {
      id: number;
      employeeId: string;
      name: string;
    };
  } | null>(null);

  const getAuthHeaders = (): HeadersInit => {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const loadSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/system-settings/clock-time-restriction', {
        credentials: 'include',
        headers: getAuthHeaders()
      });

      if (response.ok) {
        const data = await response.json();
        if (data.settings) {
          setSettings(data.settings);
        }
      }
    } catch (error) {
      console.error('載入設定失敗:', error);
    }
  }, []);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include',
          headers: getAuthHeaders()
        });
        
        if (response.ok) {
          const userData = await response.json();
          const currentUser = userData.user || userData;
          setUser(currentUser);
          
          if (currentUser.role !== 'ADMIN') {
            router.push('/dashboard');
            return;
          }
          await loadSettings();
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
  }, [router, loadSettings]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/clock-time-restriction', {
        method: 'POST',
        body: settings
      });

      if (response.ok) {
        setMessage({ type: 'success', text: '設定已儲存' });
      } else {
        const data = await response.json();
        setMessage({ type: 'error', text: data.error || '儲存失敗' });
      }
    } catch (error) {
      console.error('儲存失敗:', error);
      setMessage({ type: 'error', text: '儲存失敗' });
    } finally {
      setSaving(false);
    }
  };

  const formatTime = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 頂部導航 */}
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />

      {/* 主內容 */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* 標題區 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <Clock className="w-8 h-8 text-blue-600 mr-3" />
            打卡時間限制
          </h1>
          <p className="text-gray-600 mt-2">設定可打卡的時段限制</p>
        </div>

        {/* 訊息提示 */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg ${
            message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {message.text}
          </div>
        )}

        {/* 啟用/停用開關 */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {settings.enabled ? (
                <Power className="w-8 h-8 text-green-600" />
              ) : (
                <PowerOff className="w-8 h-8 text-gray-400" />
              )}
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  時間限制功能
                </h2>
                <p className="text-sm text-gray-500">
                  {settings.enabled ? '已啟用 - 在限制時段內無法打卡' : '已停用 - 24小時皆可打卡'}
                </p>
              </div>
            </div>
            <button
              onClick={() => setSettings({ ...settings, enabled: !settings.enabled })}
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                settings.enabled ? 'bg-green-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform shadow-md ${
                  settings.enabled ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* 時間設定 */}
        {settings.enabled && (
          <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              限制時段設定
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 開始時間 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  限制開始時間
                </label>
                <select
                  value={settings.restrictedStartHour}
                  onChange={(e) => setSettings({ ...settings, restrictedStartHour: parseInt(e.target.value) })}
                  className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white"
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{formatTime(i)}</option>
                  ))}
                </select>
              </div>

              {/* 結束時間 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  限制結束時間
                </label>
                <select
                  value={settings.restrictedEndHour}
                  onChange={(e) => setSettings({ ...settings, restrictedEndHour: parseInt(e.target.value) })}
                  className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white"
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{formatTime(i)}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* 時段預覽 */}
            <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
              <p className="text-blue-800 font-medium">
                ⏰ 限制時段：{formatTime(settings.restrictedStartHour)} ~ {formatTime(settings.restrictedEndHour)}
              </p>
              <p className="text-blue-600 text-sm mt-1">
                {settings.restrictedStartHour > settings.restrictedEndHour 
                  ? `在此時段內（跨夜）員工無法進行快速打卡`
                  : `在此時段內員工無法進行快速打卡`}
              </p>
            </div>
          </div>
        )}

        {/* 錯誤訊息設定 */}
        {settings.enabled && (
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              提示訊息設定
            </h2>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                限制時段提示訊息
              </label>
              <input
                type="text"
                value={settings.message}
                onChange={(e) => setSettings({ ...settings, message: e.target.value })}
                className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white placeholder-gray-400"
                placeholder="請輸入提示訊息"
              />
              <p className="text-gray-500 text-sm mt-2">
                此訊息會顯示給在限制時段嘗試打卡的員工
              </p>
            </div>

            {/* 預覽 */}
            <div className="mt-4 p-4 bg-red-50 rounded-lg border border-red-200">
              <p className="text-red-800 font-medium">
                預覽：{settings.message}（{formatTime(settings.restrictedStartHour)}-{formatTime(settings.restrictedEndHour)}）
              </p>
            </div>

            {/* 儲存按鈕 */}
            <div className="mt-6 flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? '儲存中...' : '儲存設定'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
