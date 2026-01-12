'use client';

import { useState, useEffect } from 'react';
import { Clock, Save, AlertCircle, CheckCircle } from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';

interface Settings {
  enabled: boolean;
  earlyClockInThreshold: number;
  lateClockOutThreshold: number;
  excludeHolidays: boolean;
  excludeApprovedOvertime: boolean;
}

export default function ClockReasonPromptSettingsPage() {
  const [settings, setSettings] = useState<Settings>({
    enabled: false,
    earlyClockInThreshold: 5,
    lateClockOutThreshold: 5,
    excludeHolidays: true,
    excludeApprovedOvertime: true
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/system-settings/clock-reason-prompt', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setSettings(data.settings);
      }
    } catch (error) {
      console.error('載入設定失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/system-settings/clock-reason-prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
        credentials: 'include'
      });

      const data = await response.json();
      if (response.ok) {
        setMessage({ type: 'success', text: data.message || '設定已儲存' });
      } else {
        setMessage({ type: 'error', text: data.error || '儲存失敗' });
      }
    } catch (error) {
      console.error('儲存設定失敗:', error);
      setMessage({ type: 'error', text: '系統錯誤' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AuthenticatedLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </AuthenticatedLayout>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* 頁面標題 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <Clock className="mr-3 h-8 w-8 text-blue-600" />
            提早/延後打卡提示設定
          </h1>
          <p className="mt-2 text-gray-600">
            設定打卡時間異常時的原因提示功能
          </p>
        </div>

        {/* 訊息提示 */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg flex items-center ${
            message.type === 'success' 
              ? 'bg-green-50 text-green-700 border border-green-200' 
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {message.type === 'success' ? (
              <CheckCircle className="h-5 w-5 mr-2" />
            ) : (
              <AlertCircle className="h-5 w-5 mr-2" />
            )}
            {message.text}
          </div>
        )}

        {/* 設定卡片 */}
        <div className="bg-white rounded-2xl shadow-lg p-6">
          {/* 啟用開關 */}
          <div className="flex items-center justify-between mb-8 pb-6 border-b">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">啟用提示功能</h3>
              <p className="text-sm text-gray-500 mt-1">
                開啟後，員工提早上班或延後下班打卡時會彈出原因選擇
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-14 h-7 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {/* 閾值設定 */}
          <div className={`space-y-6 ${!settings.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <h3 className="text-lg font-semibold text-gray-900">觸發閾值</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  提早上班打卡閾值（分鐘）
                </label>
                <div className="flex items-center">
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={settings.earlyClockInThreshold}
                    onChange={(e) => setSettings({ 
                      ...settings, 
                      earlyClockInThreshold: parseInt(e.target.value) || 5 
                    })}
                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="ml-3 text-gray-500">
                    比班表上班時間提早 {settings.earlyClockInThreshold} 分鐘以上會觸發
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  延後下班打卡閾值（分鐘）
                </label>
                <div className="flex items-center">
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={settings.lateClockOutThreshold}
                    onChange={(e) => setSettings({ 
                      ...settings, 
                      lateClockOutThreshold: parseInt(e.target.value) || 5 
                    })}
                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="ml-3 text-gray-500">
                    比班表下班時間延後 {settings.lateClockOutThreshold} 分鐘以上會觸發
                  </span>
                </div>
              </div>
            </div>

            {/* 排除選項 */}
            <div className="mt-8 pt-6 border-t">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">排除條件</h3>
              
              <div className="space-y-4">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.excludeHolidays}
                    onChange={(e) => setSettings({ ...settings, excludeHolidays: e.target.checked })}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="ml-3 text-gray-700">排除例假日和休息日</span>
                </label>

                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.excludeApprovedOvertime}
                    onChange={(e) => setSettings({ ...settings, excludeApprovedOvertime: e.target.checked })}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="ml-3 text-gray-700">排除已核准加班的日期</span>
                </label>
              </div>
            </div>
          </div>

          {/* 儲存按鈕 */}
          <div className="mt-8 pt-6 border-t flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              <Save className="w-4 h-4 mr-2" />
              {saving ? '儲存中...' : '儲存設定'}
            </button>
          </div>

          {/* 說明區塊 */}
          <div className="mt-6 p-4 bg-blue-50 rounded-lg">
            <h4 className="font-medium text-blue-900 mb-2">功能說明</h4>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>• 員工打卡完成後，系統會比對班表時間</li>
              <li>• 若提早上班或延後下班超過設定閾值，會彈出提示</li>
              <li>• 員工可選擇「非公務」（預設）或「公務」</li>
              <li>• 選擇「公務」時可關聯已申請的加班單或快速申請加班</li>
              <li>• 所有選擇會記錄在考勤記錄中，方便管理員查詢</li>
            </ul>
          </div>
        </div>
      </div>
    </AuthenticatedLayout>
  );
}
