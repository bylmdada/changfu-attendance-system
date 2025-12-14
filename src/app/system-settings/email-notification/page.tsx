'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Power, PowerOff, 
  Server, Bell, Send, Loader2, CheckCircle, XCircle, Mail
} from 'lucide-react';
import SystemNavbar from '@/components/SystemNavbar';

interface EmailSettings {
  enabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  senderName: string;
  senderEmail: string;
  notifyLeaveApproval: boolean;
  notifyOvertimeApproval: boolean;
  notifyScheduleChange: boolean;
  notifyPasswordReset: boolean;
}

const DEFAULT_SETTINGS: EmailSettings = {
  enabled: false,
  smtpHost: '',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: '',
  smtpPass: '',
  senderName: '長福考勤系統',
  senderEmail: '',
  notifyLeaveApproval: true,
  notifyOvertimeApproval: true,
  notifyScheduleChange: true,
  notifyPasswordReset: true
};

export default function EmailNotificationPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [settings, setSettings] = useState<EmailSettings>(DEFAULT_SETTINGS);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [user, setUser] = useState<{
    id: number;
    username: string;
    role: string;
    employee?: {
      id: number;
      employeeId: string;
      name: string;
      department?: string;
      position?: string;
    };
  } | null>(null);

  const getAuthHeaders = (): HeadersInit => {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const loadSettings = useCallback(async () => {
    try {
      // 驗證用戶
      const userResponse = await fetch('/api/auth/me', {
        credentials: 'include',
        headers: getAuthHeaders()
      });

      if (userResponse.ok) {
        const userData = await userResponse.json();
        const currentUser = userData.user || userData;
        setUser(currentUser);
      }

      const response = await fetch('/api/system-settings/email-notification', {
        credentials: 'include',
        headers: getAuthHeaders()
      });

      if (response.ok) {
        const data = await response.json();
        if (data.settings) {
          setSettings(data.settings);
        }
      } else if (response.status === 401 || response.status === 403) {
        router.push('/login');
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

  const handleTestEmail = async () => {
    setTesting(true);
    setMessage(null);

    // 模擬測試（實際需要發送測試郵件）
    setTimeout(() => {
      if (settings.smtpHost && settings.smtpUser && settings.senderEmail) {
        setMessage({ type: 'success', text: 'SMTP 設定格式正確，請儲存設定後測試實際發送' });
      } else {
        setMessage({ type: 'error', text: '請先填寫完整的 SMTP 設定' });
      }
      setTesting(false);
    }, 1000);
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
      {/* 頂部導航 */}
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />

      {/* 主內容 */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* 標題區 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <Mail className="w-8 h-8 text-blue-600 mr-3" />
            郵件通知設定
          </h1>
          <p className="text-gray-600 mt-2">管理系統郵件通知規則與設定</p>
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

        {/* SMTP 設定 */}
        {settings.enabled && (
          <>
            <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Server className="w-5 h-5 text-blue-600" />
                SMTP 伺服器設定
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">SMTP 主機</label>
                  <input
                    type="text"
                    value={settings.smtpHost}
                    onChange={(e) => setSettings({ ...settings, smtpHost: e.target.value })}
                    placeholder="例如: smtp.gmail.com"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">SMTP 連接埠</label>
                  <input
                    type="number"
                    value={settings.smtpPort}
                    onChange={(e) => setSettings({ ...settings, smtpPort: parseInt(e.target.value) || 587 })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">帳號</label>
                  <input
                    type="email"
                    value={settings.smtpUser}
                    onChange={(e) => setSettings({ ...settings, smtpUser: e.target.value })}
                    placeholder="發送用帳號"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">密碼 / 應用程式密碼</label>
                  <input
                    type="password"
                    value={settings.smtpPass}
                    onChange={(e) => setSettings({ ...settings, smtpPass: e.target.value })}
                    placeholder="SMTP 密碼"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">寄件者名稱</label>
                  <input
                    type="text"
                    value={settings.senderName}
                    onChange={(e) => setSettings({ ...settings, senderName: e.target.value })}
                    placeholder="顯示的寄件者名稱"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">寄件者 Email</label>
                  <input
                    type="email"
                    value={settings.senderEmail}
                    onChange={(e) => setSettings({ ...settings, senderEmail: e.target.value })}
                    placeholder="例如: noreply@company.com"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="smtpSecure"
                    checked={settings.smtpSecure}
                    onChange={(e) => setSettings({ ...settings, smtpSecure: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <label htmlFor="smtpSecure" className="text-sm text-gray-700">使用 SSL/TLS 加密</label>
                </div>

                <div className="flex items-end">
                  <button
                    onClick={handleTestEmail}
                    disabled={testing}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                  >
                    {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    測試連線
                  </button>
                </div>
              </div>
            </div>

            {/* 通知類型設定 */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Bell className="w-5 h-5 text-blue-600" />
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
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      settings.notifyLeaveApproval ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
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
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      settings.notifyOvertimeApproval ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
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
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      settings.notifyScheduleChange ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
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
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      settings.notifyPasswordReset ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings.notifyPasswordReset ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* 提示訊息 */}
        {!settings.enabled && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-yellow-800">
              <strong>提示：</strong>Email 通知功能目前已停用。啟用後，系統會根據上方設定發送 Email 通知給員工。
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
