'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Save, AlertTriangle, Calculator } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import SystemNavbar from '@/components/SystemNavbar';

interface OvertimeCalculationSettings {
  id?: number;
  weekdayFirstTwoHoursRate: number; // 平日前2小時倍率
  weekdayAfterTwoHoursRate: number; // 平日2小時後倍率
  restDayFirstEightHoursRate: number; // 休息日前8小時倍率
  restDayAfterEightHoursRate: number; // 休息日8小時後倍率
  holidayRate: number; // 國定假日倍率
  mandatoryRestRate: number; // 例假日倍率
  weekdayMaxHours: number; // 平日最大加班時數
  restDayMaxHours: number; // 休息日最大加班時數
  holidayMaxHours: number; // 國定假日最大加班時數
  mandatoryRestMaxHours: number; // 例假日最大加班時數
  monthlyBasicHours: number; // 每月基本工時
  restDayMinimumPayHours: number; // 休息日最低計費時數
  overtimeMinUnit: number; // 加班最小單位（分鐘）
  compensationMode: 'COMP_LEAVE_ONLY' | 'OVERTIME_PAY_ONLY' | 'EMPLOYEE_CHOICE'; // 加班補償模式
  settleOnResignation: boolean; // 離職時結算補休為金錢
  isEnabled: boolean;
  description: string;
  createdAt?: string;
  updatedAt?: string;
}

export default function OvertimeCalculationPage() {
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
  const [settings, setSettings] = useState<OvertimeCalculationSettings>({
    weekdayFirstTwoHoursRate: 1.34,
    weekdayAfterTwoHoursRate: 1.67,
    restDayFirstEightHoursRate: 1.34,
    restDayAfterEightHoursRate: 1.67,
    holidayRate: 2.0,
    mandatoryRestRate: 2.0,
    weekdayMaxHours: 4,
    restDayMaxHours: 12,
    holidayMaxHours: 8,
    mandatoryRestMaxHours: 8,
    monthlyBasicHours: 240,
    restDayMinimumPayHours: 4,
    overtimeMinUnit: 30,
    compensationMode: 'COMP_LEAVE_ONLY',
    settleOnResignation: true,
    isEnabled: true,
    description: '依據勞動基準法設定之加班費計算倍率'
  });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Helper function to get auth headers
  const getAuthHeaders = (): HeadersInit => {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

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
      const response = await fetch('/api/system-settings/overtime-calculation', {
        credentials: 'include'
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
  };

  const handleSaveSettings = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/overtime-calculation', {
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

  const handleRateChange = (field: keyof OvertimeCalculationSettings, value: string) => {
    const numValue = parseFloat(value);
    if (!isNaN(numValue)) {
      setSettings({ ...settings, [field]: numValue });
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
      {/* 頂部導航 */}
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />

      {/* 主要內容 */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 標題區 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <Clock className="w-8 h-8 text-blue-600 mr-3" />
            加班費計算設定
          </h1>
          <p className="text-gray-600 mt-2">設定加班費計算倍率與規則</p>
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

        {/* 設定表單 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">加班費計算參數設定</h2>
          </div>
          
          <div className="p-6 space-y-8">
            {/* 啟用開關 */}
            <div>
              <label className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  checked={settings.isEnabled}
                  onChange={(e) => setSettings({ ...settings, isEnabled: e.target.checked })}
                  className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                />
                <span className="text-sm font-medium text-gray-900">啟用加班費計算系統</span>
              </label>
              <p className="mt-1 text-sm text-gray-900">關閉此功能將使用預設的簡單計算方式</p>
            </div>

            {/* 加班補償方式設定 */}
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                <Clock className="h-5 w-5 mr-2" />
                加班補償方式設定
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-3">
                    加班補償模式
                  </label>
                  <div className="space-y-2">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="compensationMode"
                        value="COMP_LEAVE_ONLY"
                        checked={settings.compensationMode === 'COMP_LEAVE_ONLY'}
                        onChange={() => setSettings({ ...settings, compensationMode: 'COMP_LEAVE_ONLY' })}
                        className="text-blue-600 focus:ring-blue-500"
                        disabled={!settings.isEnabled}
                      />
                      <span className="ml-2 text-sm text-gray-900">僅給予補休時數（預設）</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="compensationMode"
                        value="OVERTIME_PAY_ONLY"
                        checked={settings.compensationMode === 'OVERTIME_PAY_ONLY'}
                        onChange={() => setSettings({ ...settings, compensationMode: 'OVERTIME_PAY_ONLY' })}
                        className="text-blue-600 focus:ring-blue-500"
                        disabled={!settings.isEnabled}
                      />
                      <span className="ml-2 text-sm text-gray-900">僅給予加班費</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="compensationMode"
                        value="EMPLOYEE_CHOICE"
                        checked={settings.compensationMode === 'EMPLOYEE_CHOICE'}
                        onChange={() => setSettings({ ...settings, compensationMode: 'EMPLOYEE_CHOICE' })}
                        className="text-blue-600 focus:ring-blue-500"
                        disabled={!settings.isEnabled}
                      />
                      <span className="ml-2 text-sm text-gray-900">員工自選（申請時選擇）</span>
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-gray-600">
                    「員工自選」模式下，員工可在加班申請時選擇補休或加班費
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-3">
                    離職結算規則
                  </label>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={settings.settleOnResignation}
                      onChange={(e) => setSettings({ ...settings, settleOnResignation: e.target.checked })}
                      className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                      disabled={!settings.isEnabled || settings.compensationMode === 'OVERTIME_PAY_ONLY'}
                    />
                    <span className="ml-2 text-sm text-gray-900">離職時將剩餘補休時數結算為金錢</span>
                  </label>
                  <p className="mt-2 text-xs text-gray-600">
                    {settings.compensationMode === 'OVERTIME_PAY_ONLY' 
                      ? '此選項僅在含有補休模式時有效'
                      : '當員工離職時，未使用的補休時數將依加班費率結算為現金'}
                  </p>
                </div>
              </div>
            </div>

            {/* 平日加班設定 */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                <Calculator className="h-5 w-5 mr-2" />
                平日加班設定
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    前2小時倍率
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    max="3"
                    value={settings.weekdayFirstTwoHoursRate}
                    onChange={(e) => handleRateChange('weekdayFirstTwoHoursRate', e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                    disabled={!settings.isEnabled}
                  />
                  <p className="mt-1 text-xs text-gray-900">法定：4/3 ≈ 1.34倍</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    2小時後倍率
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    max="3"
                    value={settings.weekdayAfterTwoHoursRate}
                    onChange={(e) => handleRateChange('weekdayAfterTwoHoursRate', e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                    disabled={!settings.isEnabled}
                  />
                  <p className="mt-1 text-xs text-gray-900">法定：5/3 ≈ 1.67倍</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    最大加班時數
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="12"
                    value={settings.weekdayMaxHours}
                    onChange={(e) => handleRateChange('weekdayMaxHours', e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                    disabled={!settings.isEnabled}
                  />
                  <p className="mt-1 text-xs text-gray-900">法定限制：4小時</p>
                </div>
              </div>
            </div>

            {/* 休息日加班設定 */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                <Calculator className="h-5 w-5 mr-2" />
                休息日加班設定
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    前8小時倍率
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    max="3"
                    value={settings.restDayFirstEightHoursRate}
                    onChange={(e) => handleRateChange('restDayFirstEightHoursRate', e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                    disabled={!settings.isEnabled}
                  />
                  <p className="mt-1 text-xs text-gray-900">法定：4/3 ≈ 1.34倍</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    8小時後倍率
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    max="3"
                    value={settings.restDayAfterEightHoursRate}
                    onChange={(e) => handleRateChange('restDayAfterEightHoursRate', e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                    disabled={!settings.isEnabled}
                  />
                  <p className="mt-1 text-xs text-gray-900">法定：5/3 ≈ 1.67倍</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    最低計費時數
                  </label>
                  <input
                    type="number"
                    min="2"
                    max="8"
                    value={settings.restDayMinimumPayHours}
                    onChange={(e) => handleRateChange('restDayMinimumPayHours', e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                    disabled={!settings.isEnabled}
                  />
                  <p className="mt-1 text-xs text-gray-900">法定：工作2小時以4小時計</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    最大加班時數
                  </label>
                  <input
                    type="number"
                    min="8"
                    max="16"
                    value={settings.restDayMaxHours}
                    onChange={(e) => handleRateChange('restDayMaxHours', e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                    disabled={!settings.isEnabled}
                  />
                  <p className="mt-1 text-xs text-gray-900">法定限制：12小時</p>
                </div>
              </div>
            </div>

            {/* 假日加班設定 */}
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                <Calculator className="h-5 w-5 mr-2" />
                假日加班設定
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    國定假日倍率
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    max="3"
                    value={settings.holidayRate}
                    onChange={(e) => handleRateChange('holidayRate', e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                    disabled={!settings.isEnabled}
                  />
                  <p className="mt-1 text-xs text-gray-900">法定：2倍</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    例假日倍率
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    max="3"
                    value={settings.mandatoryRestRate}
                    onChange={(e) => handleRateChange('mandatoryRestRate', e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                    disabled={!settings.isEnabled}
                  />
                  <p className="mt-1 text-xs text-gray-900">法定：2倍 + 補假</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    國定假日最大時數
                  </label>
                  <input
                    type="number"
                    min="4"
                    max="12"
                    value={settings.holidayMaxHours}
                    onChange={(e) => handleRateChange('holidayMaxHours', e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                    disabled={!settings.isEnabled}
                  />
                  <p className="mt-1 text-xs text-gray-900">建議：8小時</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    例假日最大時數
                  </label>
                  <input
                    type="number"
                    min="4"
                    max="12"
                    value={settings.mandatoryRestMaxHours}
                    onChange={(e) => handleRateChange('mandatoryRestMaxHours', e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                    disabled={!settings.isEnabled}
                  />
                  <p className="mt-1 text-xs text-gray-900">特殊情況限制</p>
                </div>
              </div>
            </div>

            {/* 基本參數設定 */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
                <Calculator className="h-5 w-5 mr-2" />
                基本參數設定
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    每月基本工時
                  </label>
                  <input
                    type="number"
                    min="160"
                    max="280"
                    value={settings.monthlyBasicHours}
                    onChange={(e) => handleRateChange('monthlyBasicHours', e.target.value)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                    disabled={!settings.isEnabled}
                  />
                  <p className="mt-1 text-xs text-gray-900">用於計算平日每小時工資額</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    加班最小單位
                  </label>
                  <select
                    value={settings.overtimeMinUnit}
                    onChange={(e) => setSettings({ ...settings, overtimeMinUnit: parseInt(e.target.value) })}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                    disabled={!settings.isEnabled}
                  >
                    <option value={1}>1 分鐘</option>
                    <option value={5}>5 分鐘</option>
                    <option value={15}>15 分鐘</option>
                    <option value={30}>30 分鐘</option>
                    <option value={60}>60 分鐘（1小時）</option>
                  </select>
                  <p className="mt-1 text-xs text-gray-900">加班時數依此單位進位/捨去</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    規則說明
                  </label>
                  <input
                    type="text"
                    value={settings.description}
                    onChange={(e) => setSettings({ ...settings, description: e.target.value })}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                    disabled={!settings.isEnabled}
                    placeholder="請輸入加班費計算規則說明..."
                  />
                  <p className="mt-1 text-xs text-gray-900">顯示給用戶的說明文字</p>
                </div>
              </div>
            </div>

            {/* 法規說明 */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-medium text-yellow-800">勞動基準法規定</h4>
                  <ul className="text-sm text-yellow-700 mt-1 space-y-1">
                    <li>• 平日加班：前2小時 × 4/3，2小時後 × 5/3，每日最多4小時</li>
                    <li>• 休息日加班：前8小時 × 4/3，8小時後 × 5/3，特殊計費規則</li>
                    <li>• 國定假日加班：全日 × 2倍</li>
                    <li>• 例假日加班：僅特殊情況，全日 × 2倍 + 補假</li>
                    <li>• 修改參數前請確認符合法規要求</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* 操作按鈕 */}
            <div className="flex justify-end space-x-4 pt-4 border-t border-gray-200">
              <button
                onClick={() => router.push('/system-settings')}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 text-gray-900"
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
