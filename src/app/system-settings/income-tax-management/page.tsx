'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Receipt, Save } from 'lucide-react';
import { buildAuthMeRequest } from '@/lib/admin-session-client';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import SystemNavbar from '@/components/SystemNavbar';

interface IncomeTaxManagementSettings {
  withholdingEnabled: boolean;
  description: string;
}

const defaultSettings: IncomeTaxManagementSettings = {
  withholdingEnabled: true,
  description: '控制新薪資試算與薪資生成是否計入所得稅，並同步決定報表管理與薪資管理中的薪資條是否顯示所得稅扣除項目',
};

export default function IncomeTaxManagementPage() {
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
  const [settings, setSettings] = useState<IncomeTaxManagementSettings>(defaultSettings);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const request = buildAuthMeRequest(window.location.origin);
        const response = await fetch(request.url, request.options);

        if (response.ok) {
          const userData = await response.json();
          const currentUser = userData.user || userData;

          if (currentUser.role !== 'ADMIN') {
            router.push('/dashboard');
            return;
          }

          setUser(currentUser);
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
  }, [router]);

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/system-settings/income-tax-management', {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        if (data.settings) {
          setSettings(data.settings);
        }
      }
    } catch (error) {
      console.error('載入所得稅設定失敗:', error);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/income-tax-management', {
        method: 'POST',
        body: settings,
      });

      if (response.ok) {
        const data = await response.json();
        setSettings(data.settings);
        setMessage({ type: 'success', text: '所得稅管理設定已儲存成功！' });
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.message || '儲存失敗' });
      }
    } catch (error) {
      console.error('儲存所得稅設定失敗:', error);
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
          <p className="mt-4 text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <Receipt className="w-8 h-8 text-blue-600 mr-3" />
            所得稅管理
          </h1>
          <p className="text-gray-600 mt-2">
            設定新薪資試算與薪資生成是否計入所得稅，並同步控制報表管理與薪資管理中的薪資條是否顯示所得稅扣除項目。
          </p>
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

        <div className="space-y-6">
          <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">所得稅扣除設定</h2>
            <label className="flex items-start space-x-3">
              <input
                type="checkbox"
                checked={settings.withholdingEnabled}
                onChange={(event) =>
                  setSettings(current => ({
                    ...current,
                    withholdingEnabled: event.target.checked,
                  }))
                }
                className="mt-1 rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
              />
              <div>
                <span className="text-sm font-medium text-gray-900">新薪資計算與薪資條顯示所得稅扣除</span>
                <p className="mt-1 text-sm text-gray-600">
                  關閉後，之後執行的薪資試算與薪資生成將不再計入所得稅；同時，報表管理與薪資管理中的薪資條也不再顯示所得稅扣除項目。
                </p>
              </div>
            </label>
          </section>

          <section className="bg-amber-50 border border-amber-200 rounded-lg p-6">
            <h2 className="text-lg font-medium text-amber-900 mb-3 flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2" />
              套用說明
            </h2>
            <ul className="space-y-2 text-sm text-amber-900">
              <li>• 這項設定只影響之後的新薪資試算、薪資生成，以及報表管理 / 薪資管理中的薪資條顯示。</li>
              <li>• 已經產生的舊薪資記錄若也要同步取消或恢復所得稅，請重新執行該月份薪資試算或重新生成薪資。</li>
            </ul>
          </section>
        </div>

        <div className="mt-8 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className={`inline-flex items-center px-6 py-3 rounded-lg font-medium transition-colors ${
              saving
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            <Save className="w-5 h-5 mr-2" />
            {saving ? '儲存中...' : '儲存設定'}
          </button>
        </div>
      </main>
    </div>
  );
}
