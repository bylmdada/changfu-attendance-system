'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Save, Bell, Lock, AlertTriangle, Loader2 } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import SystemNavbar from '@/components/SystemNavbar';

interface User {
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
}

interface ScheduleConfirmSettings {
  enabled: boolean;
  blockClock: boolean;
  enableReminder: boolean;
}

export default function ScheduleConfirmSettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  const [settings, setSettings] = useState<ScheduleConfirmSettings>({
    enabled: false,
    blockClock: false,
    enableReminder: false
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 驗證用戶身份
        const userRes = await fetch('/api/auth/me', { credentials: 'include' });
        if (!userRes.ok) {
          router.push('/login');
          return;
        }
        
        const userData = await userRes.json();
        const currentUser = userData.user || userData;
        
        if (currentUser.role !== 'ADMIN') {
          router.push('/dashboard');
          return;
        }
        setUser(currentUser);

        // 載入設定
        const settingsRes = await fetch('/api/system-settings/schedule-confirm', {
          credentials: 'include'
        });
        
        if (settingsRes.ok) {
          const data = await settingsRes.json();
          if (data.settings) {
            setSettings(data.settings);
          }
        }
      } catch (error) {
        console.error('載入失敗:', error);
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [router]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    
    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/schedule-confirm', {
        method: 'POST',
        body: settings
      });

      if (response.ok) {
        setMessage({ type: 'success', text: '班表確認機制設定已儲存！' });
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || '儲存失敗' });
      }
    } catch (error) {
      console.error('儲存失敗:', error);
      setMessage({ type: 'error', text: '儲存失敗，請稍後再試' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-900">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 標題 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center">
              <Calendar className="w-8 h-8 text-blue-600 mr-3" />
              班表確認機制設定
            </h1>
            <p className="text-gray-600 mt-2">管理班表確認與打卡阻止功能</p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            {saving ? '儲存中...' : '儲存設定'}
          </button>
        </div>

        {/* 訊息提示 */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg ${
            message.type === 'success' 
              ? 'bg-green-50 border border-green-200 text-green-800' 
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}>
            {message.text}
          </div>
        )}

        {/* 設定卡片 */}
        <div className="space-y-6">
          
          {/* 主開關 */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900 flex items-center">
                <Calendar className="h-5 w-5 text-blue-600 mr-2" />
                班表確認機制
              </h2>
            </div>
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-gray-900">啟用班表確認機制</span>
                  <p className="text-sm text-gray-500 mt-1">
                    開啟後，員工需在每月班表發布後確認才算完成
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSettings({ ...settings, enabled: !settings.enabled })}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                    settings.enabled ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      settings.enabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* 阻止打卡設定 */}
          <div className={`bg-white rounded-lg shadow-sm border ${settings.blockClock ? 'border-red-200' : 'border-gray-200'}`}>
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900 flex items-center">
                <Lock className={`h-5 w-5 mr-2 ${settings.blockClock ? 'text-red-600' : 'text-orange-600'}`} />
                打卡限制設定
              </h2>
            </div>
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-gray-900">未確認班表阻止打卡</span>
                  <p className="text-sm text-gray-500 mt-1">
                    開啟後，員工若未確認當月班表將無法打卡
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => settings.enabled && setSettings({ ...settings, blockClock: !settings.blockClock })}
                  disabled={!settings.enabled}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 ${
                    !settings.enabled ? 'bg-gray-200 cursor-not-allowed' :
                    settings.blockClock ? 'bg-red-600 cursor-pointer' : 'bg-gray-300 cursor-pointer'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      settings.blockClock ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {settings.blockClock && settings.enabled && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start">
                  <AlertTriangle className="h-5 w-5 text-red-600 mr-3 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-red-800">
                    <p className="font-medium">注意：此功能已啟用</p>
                    <p className="mt-1">員工若未確認當月班表將無法打卡。請確保已為所有員工安排並發布班表。</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 提醒設定 */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900 flex items-center">
                <Bell className="h-5 w-5 text-yellow-600 mr-2" />
                提醒設定
              </h2>
            </div>
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-gray-900">啟用確認提醒</span>
                  <p className="text-sm text-gray-500 mt-1">
                    在儀表板顯示班表待確認提醒訊息
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => settings.enabled && setSettings({ ...settings, enableReminder: !settings.enableReminder })}
                  disabled={!settings.enabled}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                    !settings.enabled ? 'bg-gray-200 cursor-not-allowed' :
                    settings.enableReminder ? 'bg-blue-600 cursor-pointer' : 'bg-gray-300 cursor-pointer'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      settings.enableReminder ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* 說明區塊 */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h3 className="text-lg font-medium text-blue-900 mb-4">功能說明</h3>
            <ul className="space-y-2 text-sm text-blue-800">
              <li className="flex items-start">
                <span className="w-2 h-2 bg-blue-500 rounded-full mr-3 mt-1.5"></span>
                <span><strong>班表確認機制</strong>：開啟後，排班管理員發布班表時會通知員工確認</span>
              </li>
              <li className="flex items-start">
                <span className="w-2 h-2 bg-red-500 rounded-full mr-3 mt-1.5"></span>
                <span><strong>阻止打卡</strong>：強制員工在打卡前必須先確認班表（建議在班表確實已發布後再開啟）</span>
              </li>
              <li className="flex items-start">
                <span className="w-2 h-2 bg-yellow-500 rounded-full mr-3 mt-1.5"></span>
                <span><strong>確認提醒</strong>：在員工儀表板顯示「班表待確認」提示訊息</span>
              </li>
            </ul>
          </div>

        </div>
      </main>
    </div>
  );
}
