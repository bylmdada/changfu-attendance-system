'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Power, PowerOff, 
  Bell, Save, CheckCircle, XCircle, Mail, Settings, ExternalLink
} from 'lucide-react';
import SystemNavbar from '@/components/SystemNavbar';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import {
  buildAuthMeRequest,
  buildEmailNotificationRequest,
  buildSmtpSettingsRequest,
} from '@/lib/email-notification-client';

interface NotificationSettings {
  enabled: boolean;
  notifyLeaveApproval: boolean;
  notifyOvertimeApproval: boolean;
  notifyScheduleChange: boolean;
  notifyPasswordReset: boolean;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: false,
  notifyLeaveApproval: true,
  notifyOvertimeApproval: true,
  notifyScheduleChange: true,
  notifyPasswordReset: true
};

export default function EmailNotificationPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [user, setUser] = useState<{
    id: number;
    username: string;
    role: string;
    employee?: {
      id: number;
      employeeId?: string;
      name: string;
      department?: string;
      position?: string;
    };
  } | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const origin = window.location.origin;
      const authMeRequest = buildAuthMeRequest(origin);
      const emailNotificationRequest = buildEmailNotificationRequest(origin);
      const smtpSettingsRequest = buildSmtpSettingsRequest(origin);

      // 驗證用戶
      const userResponse = await fetch(authMeRequest.url, authMeRequest.options);

      if (userResponse.ok) {
        const userData = await userResponse.json();
        const currentUser = userData.user || userData;
        setUser(currentUser);
      }

      // 載入通知設定
      const response = await fetch(emailNotificationRequest.url, emailNotificationRequest.options);

      if (response.ok) {
        const data = await response.json();
        if (data.settings) {
          setSettings({
            enabled: data.settings.enabled || false,
            notifyLeaveApproval: data.settings.notifyLeaveApproval ?? true,
            notifyOvertimeApproval: data.settings.notifyOvertimeApproval ?? true,
            notifyScheduleChange: data.settings.notifyScheduleChange ?? true,
            notifyPasswordReset: data.settings.notifyPasswordReset ?? true
          });
        }
      } else if (response.status === 401 || response.status === 403) {
        router.push('/login');
      }

      // 檢查 SMTP 是否已設定
      const smtpResponse = await fetch(smtpSettingsRequest.url, smtpSettingsRequest.options);

      if (smtpResponse.ok) {
        const smtpData = await smtpResponse.json();
        if (smtpData.settings?.smtpHost) {
          setSmtpConfigured(true);
        }
      }
    } catch (error) {
      console.error('載入設定失敗:', error);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/email-notification', {
        method: 'POST',
        body: settings
      });

      if (response.ok) {
        setMessage({ type: 'success', text: '設定已儲存' });
      } else {
        setMessage({ type: 'error', text: '儲存失敗' });
      }
    } catch (error) {
      console.error('儲存失敗:', error);
      setMessage({ type: 'error', text: '儲存失敗' });
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

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* 標題區 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <Bell className="w-8 h-8 text-blue-600 mr-3" />
            郵件通知設定
          </h1>
          <p className="text-gray-600 mt-2">設定考勤相關事件的 Email 通知開關</p>
        </div>

        {/* 訊息提示 */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg flex items-center gap-2 ${
            message.type === 'success' 
              ? 'bg-green-50 text-green-700 border border-green-200' 
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
            {message.text}
          </div>
        )}

        {/* SMTP 設定提示 */}
        <div className={`mb-6 p-4 rounded-lg border ${
          smtpConfigured 
            ? 'bg-green-50 border-green-200' 
            : 'bg-yellow-50 border-yellow-200'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings className={`w-5 h-5 ${smtpConfigured ? 'text-green-600' : 'text-yellow-600'}`} />
              <span className={smtpConfigured ? 'text-green-800' : 'text-yellow-800'}>
                {smtpConfigured 
                  ? '郵件伺服器已設定' 
                  : '尚未設定郵件伺服器，請先完成 SMTP 設定'}
              </span>
            </div>
            <a
              href="/system-settings/smtp"
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
            >
              前往設定
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>

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
                  Email 通知功能
                </h2>
                <p className="text-sm text-gray-500">
                  {settings.enabled ? '已啟用 - 系統會發送 Email 通知給員工' : '已停用 - 不會發送任何 Email'}
                </p>
              </div>
            </div>
            <button
              onClick={() => setSettings({ ...settings, enabled: !settings.enabled })}
              disabled={!smtpConfigured}
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                settings.enabled ? 'bg-green-600' : 'bg-gray-300'
              } ${!smtpConfigured ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span
                className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform shadow-md ${
                  settings.enabled ? 'translate-x-7' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* 通知類型設定 */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Mail className="w-5 h-5 text-blue-600" />
            通知類型設定
          </h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <p className="font-medium text-gray-900">請假審核結果</p>
                <p className="text-sm text-gray-500">請假申請核准/駁回時通知員工</p>
              </div>
              <button
                onClick={() => setSettings({ ...settings, notifyLeaveApproval: !settings.notifyLeaveApproval })}
                disabled={!settings.enabled}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.notifyLeaveApproval ? 'bg-blue-600' : 'bg-gray-300'
                } ${!settings.enabled ? 'opacity-50' : ''}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.notifyLeaveApproval ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <p className="font-medium text-gray-900">加班審核結果</p>
                <p className="text-sm text-gray-500">加班申請核准/駁回時通知員工</p>
              </div>
              <button
                onClick={() => setSettings({ ...settings, notifyOvertimeApproval: !settings.notifyOvertimeApproval })}
                disabled={!settings.enabled}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.notifyOvertimeApproval ? 'bg-blue-600' : 'bg-gray-300'
                } ${!settings.enabled ? 'opacity-50' : ''}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.notifyOvertimeApproval ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <p className="font-medium text-gray-900">班表異動通知</p>
                <p className="text-sm text-gray-500">班表調整時通知相關員工</p>
              </div>
              <button
                onClick={() => setSettings({ ...settings, notifyScheduleChange: !settings.notifyScheduleChange })}
                disabled={!settings.enabled}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.notifyScheduleChange ? 'bg-blue-600' : 'bg-gray-300'
                } ${!settings.enabled ? 'opacity-50' : ''}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.notifyScheduleChange ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <p className="font-medium text-gray-900">密碼重設通知</p>
                <p className="text-sm text-gray-500">密碼重設時發送連結給員工</p>
              </div>
              <button
                onClick={() => setSettings({ ...settings, notifyPasswordReset: !settings.notifyPasswordReset })}
                disabled={!settings.enabled}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.notifyPasswordReset ? 'bg-blue-600' : 'bg-gray-300'
                } ${!settings.enabled ? 'opacity-50' : ''}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.notifyPasswordReset ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>
          </div>
        </div>

        {/* 儲存按鈕 */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? '儲存中...' : '儲存設定'}
          </button>
        </div>
      </main>
    </div>
  );
}
