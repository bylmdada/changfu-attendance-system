'use client';

import { useState, useEffect } from 'react';
import { Save, Mail, Server, CheckCircle, XCircle, Send } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import SystemNavbar from '@/components/SystemNavbar';

interface SmtpSettings {
  id: number;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string;
  fromEmail: string;
  fromName: string;
}

interface User {
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
}

export default function SmtpSettingsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [testEmail, setTestEmail] = useState('');

  const [settings, setSettings] = useState<SmtpSettings>({
    id: 0,
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: true,
    smtpUser: '',
    smtpPassword: '',
    fromEmail: '',
    fromName: '長福考勤系統'
  });

  const getAuthHeaders = (): HeadersInit => {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 驗證用戶
        const userResponse = await fetch('/api/auth/me', {
          credentials: 'include',
          headers: getAuthHeaders()
        });

        if (userResponse.ok) {
          const userData = await userResponse.json();
          const currentUser = userData.user || userData;
          if (currentUser.role !== 'ADMIN') {
            window.location.href = '/dashboard';
            return;
          }
          setUser(currentUser);
        } else {
          window.location.href = '/login';
          return;
        }

        // 載入 SMTP 設定
        const response = await fetch('/api/system-settings/smtp', {
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
        console.error('載入失敗:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/smtp', {
        method: 'POST',
        body: settings
      });

      if (response.ok) {
        setMessage({ type: 'success', text: '設定已儲存' });
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || '儲存失敗' });
      }
    } catch (error) {
      console.error('儲存失敗:', error);
      setMessage({ type: 'error', text: '儲存失敗' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    if (!testEmail) {
      setMessage({ type: 'error', text: '請輸入測試郵件地址' });
      return;
    }

    setTesting(true);
    setMessage(null);

    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/smtp/test', {
        method: 'POST',
        body: { email: testEmail }
      });

      if (response.ok) {
        setMessage({ type: 'success', text: '測試郵件已發送' });
      } else {
        const error = await response.json();
        setMessage({ type: 'error', text: error.error || '發送失敗' });
      }
    } catch (error) {
      console.error('測試失敗:', error);
      setMessage({ type: 'error', text: '測試失敗' });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">載入中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 標題 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <Server className="w-8 h-8 text-blue-600 mr-3" />
            郵件伺服器設定
          </h1>
          <p className="text-gray-600 mt-2">設定系統共用的 SMTP 郵件伺服器</p>
        </div>

        {message && (
          <div className={`mb-6 p-4 rounded-lg flex items-center ${
            message.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}>
            {message.type === 'success' ? (
              <CheckCircle className="w-5 h-5 mr-2" />
            ) : (
              <XCircle className="w-5 h-5 mr-2" />
            )}
            {message.text}
          </div>
        )}

        {/* SMTP 設定 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
          <div className="px-6 py-4 border-b border-gray-200 bg-blue-50">
            <h2 className="text-lg font-medium text-blue-900 flex items-center">
              <Mail className="w-5 h-5 mr-2" />
              SMTP 伺服器設定
            </h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  SMTP 主機
                </label>
                <input
                  type="text"
                  value={settings.smtpHost}
                  onChange={(e) => setSettings({ ...settings, smtpHost: e.target.value })}
                  placeholder="smtp.gmail.com"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  SMTP 埠號
                </label>
                <input
                  type="number"
                  value={settings.smtpPort}
                  onChange={(e) => setSettings({ ...settings, smtpPort: parseInt(e.target.value) || 587 })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  SMTP 帳號
                </label>
                <input
                  type="text"
                  value={settings.smtpUser}
                  onChange={(e) => setSettings({ ...settings, smtpUser: e.target.value })}
                  placeholder="your-email@gmail.com"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  SMTP 密碼
                </label>
                <input
                  type="password"
                  value={settings.smtpPassword}
                  onChange={(e) => setSettings({ ...settings, smtpPassword: e.target.value })}
                  placeholder="應用程式密碼"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                />
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={settings.smtpSecure}
                onChange={(e) => setSettings({ ...settings, smtpSecure: e.target.checked })}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="text-sm text-gray-900">使用 SSL/TLS 加密連線</span>
            </div>
          </div>
        </div>

        {/* 寄件人設定 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
          <div className="px-6 py-4 border-b border-gray-200 bg-green-50">
            <h2 className="text-lg font-medium text-green-900">寄件人資訊</h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  寄件人名稱
                </label>
                <input
                  type="text"
                  value={settings.fromName}
                  onChange={(e) => setSettings({ ...settings, fromName: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  寄件人 Email
                </label>
                <input
                  type="email"
                  value={settings.fromEmail}
                  onChange={(e) => setSettings({ ...settings, fromEmail: e.target.value })}
                  placeholder="noreply@company.com"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 測試發送 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
          <div className="px-6 py-4 border-b border-gray-200 bg-yellow-50">
            <h2 className="text-lg font-medium text-yellow-900">測試連線</h2>
          </div>
          <div className="p-6">
            <div className="flex items-center gap-4">
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="輸入測試郵件地址"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
              />
              <button
                onClick={handleTestEmail}
                disabled={testing}
                className="inline-flex items-center px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50"
              >
                <Send className="w-4 h-4 mr-2" />
                {testing ? '發送中...' : '發送測試信'}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">請先儲存設定後再進行測試</p>
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
