'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Clock, Save } from 'lucide-react';
import { buildAuthMeRequest } from '@/lib/admin-session-client';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import SystemNavbar from '@/components/SystemNavbar';

interface AttendanceSalaryDeductionSettings {
  enabled: boolean;
  description: string;
}

const defaultSettings: AttendanceSalaryDeductionSettings = {
  enabled: false,
  description: '控制新薪資試算與薪資生成是否將當月遲到、早退、遲到+早退、缺勤納入扣薪，並同步顯示於薪資條扣除項目與計算備註',
};

export default function AttendanceSalaryDeductionPage() {
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
  const [settings, setSettings] = useState<AttendanceSalaryDeductionSettings>(defaultSettings);
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
      const response = await fetch('/api/system-settings/attendance-salary-deduction', {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        if (data.settings) {
          setSettings(data.settings);
        }
      }
    } catch (error) {
      console.error('載入出勤扣薪設定失敗:', error);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/attendance-salary-deduction', {
        method: 'POST',
        body: settings,
      });

      if (response.ok) {
        const data = await response.json();
        setSettings(data.settings);
        setMessage({ type: 'success', text: '出勤扣薪控管設定已儲存成功！' });
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.message || '儲存失敗' });
      }
    } catch (error) {
      console.error('儲存出勤扣薪設定失敗:', error);
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
            <Clock className="w-8 h-8 text-blue-600 mr-3" />
            出勤扣薪控管
          </h1>
          <p className="text-gray-600 mt-2">
            控制新薪資試算與薪資生成是否將當月份遲到、早退、遲到+早退、缺勤納入扣薪，並同步顯示於薪資條。
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
            <h2 className="text-lg font-medium text-gray-900 mb-4">扣薪功能開關</h2>
            <label className="flex items-start space-x-3">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(event) =>
                  setSettings(current => ({
                    ...current,
                    enabled: event.target.checked,
                  }))
                }
                className="mt-1 rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
              />
              <div>
                <span className="text-sm font-medium text-gray-900">
                  新薪資計算套用出勤扣薪
                </span>
                <p className="mt-1 text-sm text-gray-600">
                  預設為關閉。開啟後，之後執行的薪資試算與薪資生成會依考勤記錄與班表計算扣薪，並列於薪資條扣除項目。
                </p>
              </div>
            </label>
          </section>

          <section className="rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50 via-white to-slate-50 p-6">
            <h2 className="text-lg font-semibold text-gray-950 mb-3">計算規則</h2>
            <div className="grid gap-3 text-sm text-gray-700 md:grid-cols-2">
              <div className="rounded-xl bg-white p-4 ring-1 ring-blue-100">
                <div className="font-semibold text-gray-900">遲到</div>
                <p className="mt-1">扣晚到分鐘數 ÷ 60 × 平日每小時工資額。</p>
              </div>
              <div className="rounded-xl bg-white p-4 ring-1 ring-blue-100">
                <div className="font-semibold text-gray-900">早退</div>
                <p className="mt-1">扣提早離開分鐘數 ÷ 60 × 平日每小時工資額。</p>
              </div>
              <div className="rounded-xl bg-white p-4 ring-1 ring-blue-100">
                <div className="font-semibold text-gray-900">遲到+早退</div>
                <p className="mt-1">晚到分鐘數與早退分鐘數合併計算。</p>
              </div>
              <div className="rounded-xl bg-white p-4 ring-1 ring-blue-100">
                <div className="font-semibold text-gray-900">缺勤</div>
                <p className="mt-1">扣當日排班應出勤工時，已排特休/補休時數不重複扣薪。</p>
              </div>
            </div>
          </section>

          <section className="bg-amber-50 border border-amber-200 rounded-lg p-6">
            <h2 className="text-lg font-medium text-amber-900 mb-3 flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2" />
              套用說明
            </h2>
            <ul className="space-y-2 text-sm text-amber-900">
              <li>• 這項設定只影響之後的新薪資試算與薪資生成；已產生的舊薪資記錄不會自動改寫。</li>
              <li>• 若要讓既有月份重新套用，請刪除或重建該月份薪資記錄後重新生成。</li>
              <li>• 薪資條會列出每筆遲到、早退、遲到+早退、缺勤的扣薪公式與金額。</li>
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
