'use client';

import { useEffect, useState } from 'react';
import { Mail, Save, Send, History, CheckCircle, XCircle, Settings, ExternalLink } from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';

interface PayslipEmailSettings {
  enabled: boolean;
  subjectTemplate: string | null;
  bodyTemplate: string | null;
}

interface SendHistory {
  id: number;
  employeeName: string;
  employeeEmail: string;
  year: number;
  month: number;
  sentAt: string;
  status: string;
  errorMessage: string | null;
  sentBy: string | null;
}

export default function PayslipEmailSettingsPage() {
  const [settings, setSettings] = useState<PayslipEmailSettings>({
    enabled: false,
    subjectTemplate: '[%YEAR%年%MONTH%月] 薪資條通知',
    bodyTemplate: ''
  });
  const [history, setHistory] = useState<SendHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [activeTab, setActiveTab] = useState<'settings' | 'history'>('settings');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const loadSettings = async () => {
    try {
      // 載入薪資條發送設定
      const response = await fetch('/api/system-settings/payslip-email', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        if (data.settings) {
          setSettings({
            enabled: data.settings.enabled || false,
            subjectTemplate: data.settings.subjectTemplate || '[%YEAR%年%MONTH%月] 薪資條通知',
            bodyTemplate: data.settings.bodyTemplate || ''
          });
        }
      }

      // 檢查 SMTP 是否已設定
      const smtpResponse = await fetch('/api/system-settings/smtp', { credentials: 'include' });
      if (smtpResponse.ok) {
        const smtpData = await smtpResponse.json();
        if (smtpData.settings?.smtpHost) {
          setSmtpConfigured(true);
        }
      }
    } catch (error) {
      console.error('載入設定失敗:', error);
      showToast('error', '載入設定失敗');
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      const response = await fetch('/api/payroll/send-email', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setHistory(data.history || []);
      }
    } catch (error) {
      console.error('載入歷史失敗:', error);
    }
  };

  useEffect(() => {
    loadSettings();
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/payslip-email', {
        method: 'PUT',
        body: settings
      });

      if (response.ok) {
        showToast('success', '設定已儲存');
      } else {
        const error = await response.json();
        showToast('error', error.error || '儲存失敗');
      }
    } catch (error) {
      console.error('儲存失敗:', error);
      showToast('error', '儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AuthenticatedLayout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-gray-600">載入中...</div>
        </div>
      </AuthenticatedLayout>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="max-w-4xl mx-auto p-6">
        {/* 標題 */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <Mail className="w-8 h-8 text-blue-600 mr-3" />
            薪資條發送設定
          </h1>
          <p className="text-gray-600 mt-1">配置薪資條 Email 發送的郵件內容</p>
        </div>

        {/* 頁籤 */}
        <div className="flex border-b border-gray-200 mb-6">
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'settings'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Settings className="inline-block w-4 h-4 mr-2" />
            發送設定
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'history'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <History className="inline-block w-4 h-4 mr-2" />
            發送歷史
          </button>
        </div>

        {/* 設定表單 */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            {/* SMTP 設定提示 */}
            <div className={`p-4 rounded-lg border ${
              smtpConfigured 
                ? 'bg-green-50 border-green-200' 
                : 'bg-yellow-50 border-yellow-200'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Settings className={`w-5 h-5 ${smtpConfigured ? 'text-green-600' : 'text-yellow-600'}`} />
                  <span className={smtpConfigured ? 'text-green-800' : 'text-yellow-800'}>
                    {smtpConfigured 
                      ? '郵件伺服器已設定，可正常發送' 
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

            {/* 啟用開關 */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">啟用 Email 發送</h3>
                  <p className="text-sm text-gray-500">開啟後可在薪資管理頁面發送薪資條給員工</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.enabled}
                    onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                    disabled={!smtpConfigured}
                    className="sr-only peer"
                  />
                  <div className={`w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 ${!smtpConfigured ? 'opacity-50' : ''}`}></div>
                </label>
              </div>
            </div>

            {/* 郵件內容設定 */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="font-medium text-gray-900 mb-4">郵件內容設定</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">郵件主旨</label>
                  <input
                    type="text"
                    value={settings.subjectTemplate || ''}
                    onChange={(e) => setSettings({ ...settings, subjectTemplate: e.target.value })}
                    placeholder="[%YEAR%年%MONTH%月] 薪資條通知"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                  />
                  <p className="text-xs text-gray-500 mt-1">可用變數：%YEAR%（年份）、%MONTH%（月份）</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">郵件內容</label>
                  <textarea
                    value={settings.bodyTemplate || ''}
                    onChange={(e) => setSettings({ ...settings, bodyTemplate: e.target.value })}
                    rows={6}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                    placeholder="親愛的 %NAME% 您好，&#10;&#10;您的 %YEAR%年%MONTH%月 薪資條已產生..."
                  />
                  <p className="text-xs text-gray-500 mt-1">可用變數：%NAME%（員工姓名）、%EMPLOYEE_ID%（員工編號）、%YEAR%、%MONTH%</p>
                </div>
              </div>
            </div>

            {/* 儲存按鈕 */}
            <div className="flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? '儲存中...' : '儲存設定'}
              </button>
            </div>
          </div>
        )}

        {/* 發送歷史 */}
        {activeTab === 'history' && (
          <div className="bg-white rounded-lg border border-gray-200">
            {history.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Send className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <p>尚無發送記錄</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">員工</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">年/月</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">發送時間</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">狀態</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {history.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{item.employeeName}</div>
                        <div className="text-sm text-gray-500">{item.employeeEmail}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-900">{item.year}/{item.month}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {new Date(item.sentAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        {item.status === 'SUCCESS' ? (
                          <span className="inline-flex items-center gap-1 text-green-600">
                            <CheckCircle className="h-4 w-4" />
                            成功
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-600" title={item.errorMessage || ''}>
                            <XCircle className="h-4 w-4" />
                            失敗
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div className={`fixed bottom-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'} text-white`}>
            {toast.message}
          </div>
        )}
      </div>
    </AuthenticatedLayout>
  );
}
