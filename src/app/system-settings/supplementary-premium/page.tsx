'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Calculator, Save, AlertTriangle } from 'lucide-react';
import { buildAuthMeRequest } from '@/lib/admin-session-client';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import SystemNavbar from '@/components/SystemNavbar';

interface SupplementaryPremiumSettings {
  id?: number;
  isEnabled: boolean;
  premiumRate: number; // 補充保費費率 (預設2.11%)
  exemptThresholdMultiplier: number; // 免扣除門檻倍數 (預設4倍)
  minimumThreshold: number; // 最低扣費門檻
  maxMonthlyPremium: number; // 每月最高補充保費
  exemptionThreshold: number; // 免扣繳門檻（單次給付）
  annualMaxDeduction: number; // 年度累計扣繳上限
  salaryThreshold: number; // 單月薪資扣繳門檻
  dividendThreshold: number; // 股利所得門檻
  salaryIncludeItems: {
    overtime: boolean; // 加班費
    bonus: boolean; // 獎金
    allowance: boolean; // 津貼
    commission: boolean; // 佣金
  };
  calculationMethod: 'CUMULATIVE' | 'MONTHLY'; // 累計制或單次制
  resetPeriod: 'YEARLY' | 'MONTHLY'; // 重置週期
  applyToAllEmployees: boolean;
  description: string;
  createdAt?: string;
  updatedAt?: string;
}

export default function SupplementaryPremiumPage() {
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
  const [settings, setSettings] = useState<SupplementaryPremiumSettings>({
    isEnabled: true,
    premiumRate: 2.11,
    exemptThresholdMultiplier: 4,
    minimumThreshold: 5000,
    maxMonthlyPremium: 1000000,
    exemptionThreshold: 20000,
    annualMaxDeduction: 1000000,
    salaryThreshold: 183200,
    dividendThreshold: 20000,
    salaryIncludeItems: {
      overtime: false,
      bonus: true,
      allowance: true,
      commission: true
    },
    calculationMethod: 'CUMULATIVE',
    resetPeriod: 'YEARLY',
    applyToAllEmployees: true,
    description: '依據全民健康保險法規定之補充保費計算設定'
  });
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
      const response = await fetch('/api/system-settings/supplementary-premium', {
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
      const response = await fetchJSONWithCSRF('/api/system-settings/supplementary-premium', {
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

  const updateSalaryIncludeItems = (field: keyof typeof settings.salaryIncludeItems, value: boolean) => {
    setSettings({
      ...settings,
      salaryIncludeItems: {
        ...settings.salaryIncludeItems,
        [field]: value
      }
    });
  };

  // 計算範例
  const calculateExample = () => {
    const insuredAmount = 45800; // 假設投保金額
    const exemptThreshold = insuredAmount * settings.exemptThresholdMultiplier;
    const bonusAmount = 80000; // 假設獎金
    const taxableAmount = Math.max(0, bonusAmount - exemptThreshold);
    const supplementaryPremium = Math.round(taxableAmount * (settings.premiumRate / 100));
    
    return {
      insuredAmount,
      exemptThreshold,
      bonusAmount,
      taxableAmount,
      supplementaryPremium,
      shouldCalculate: bonusAmount >= settings.minimumThreshold && taxableAmount > 0
    };
  };

  const example = calculateExample();

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
            <Calculator className="w-8 h-8 text-blue-600 mr-3" />
            補充保費設定
          </h1>
          <p className="text-gray-600 mt-2">設定二代健保補充保費計算規則</p>
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

        {/* 計算範例 */}
        <div className="mb-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h2 className="text-lg font-medium text-blue-900 mb-4 flex items-center">
            <Calculator className="h-5 w-5 mr-2" />
            補充保費計算範例
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-medium text-blue-800 mb-2">計算過程</h3>
              <div className="text-sm text-blue-700 space-y-1">
                <p>投保金額：NT$ {example.insuredAmount.toLocaleString()}</p>
                <p>免扣門檻：NT$ {example.exemptThreshold.toLocaleString()} ({settings.exemptThresholdMultiplier}倍)</p>
                <p>獎金金額：NT$ {example.bonusAmount.toLocaleString()}</p>
                <p>應計費金額：NT$ {example.taxableAmount.toLocaleString()}</p>
                <p className="font-medium">補充保費：NT$ {example.supplementaryPremium.toLocaleString()} ({settings.premiumRate}%)</p>
              </div>
            </div>
            <div>
              <h3 className="font-medium text-blue-800 mb-2">計算說明</h3>
              <div className="text-sm text-blue-700 space-y-1">
                <p>• 獎金超過投保金額{settings.exemptThresholdMultiplier}倍才計算</p>
                <p>• 計算基數 = 獎金 - 免扣門檻</p>
                <p>• 補充保費 = 計算基數 × {settings.premiumRate}%</p>
                <p>• 最低扣費門檻：NT$ {settings.minimumThreshold.toLocaleString()}</p>
                <p className={example.shouldCalculate ? 'text-green-700 font-medium' : 'text-red-700 font-medium'}>
                  {example.shouldCalculate ? '✓ 需要計算補充保費' : '✗ 不需計算補充保費'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 設定表單 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">補充保費計算設定</h2>
          </div>
          
          <div className="p-6 space-y-6">
            {/* 基本設定 */}
            <div>
              <label className="flex items-center space-x-3 mb-4">
                <input
                  type="checkbox"
                  checked={settings.isEnabled}
                  onChange={(e) => setSettings({ ...settings, isEnabled: e.target.checked })}
                  className="rounded border-gray-300 text-green-600 shadow-sm focus:border-green-300 focus:ring focus:ring-green-200 focus:ring-opacity-50"
                />
                <span className="text-sm font-medium text-gray-900">啟用補充保費計算</span>
              </label>
            </div>

            {/* 費率設定 */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h3 className="text-lg font-medium text-gray-900 mb-4">費率與門檻設定</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    補充保費費率 (%)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="10"
                    value={settings.premiumRate}
                    onChange={(e) => setSettings({ ...settings, premiumRate: parseFloat(e.target.value) || 0 })}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                    disabled={!settings.isEnabled}
                  />
                  <p className="mt-1 text-sm text-gray-900">2024年為2.11%</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    免扣繳門檻 (單次給付)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={settings.exemptionThreshold}
                    onChange={(e) => setSettings({ ...settings, exemptionThreshold: parseInt(e.target.value) || 0 })}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                    disabled={!settings.isEnabled}
                  />
                  <p className="mt-1 text-sm text-gray-900">低於此金額免收補充保費</p>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    年度累計扣繳上限
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={settings.annualMaxDeduction}
                    onChange={(e) => setSettings({ ...settings, annualMaxDeduction: parseInt(e.target.value) || 0 })}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                    disabled={!settings.isEnabled}
                  />
                  <p className="mt-1 text-sm text-gray-900">2024年為1,000,000元</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    單月薪資扣繳門檻
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={settings.salaryThreshold}
                    onChange={(e) => setSettings({ ...settings, salaryThreshold: parseInt(e.target.value) || 0 })}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                    disabled={!settings.isEnabled}
                  />
                  <p className="mt-1 text-sm text-gray-900">超過此金額才收補充保費</p>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    股利所得門檻
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={settings.dividendThreshold}
                    onChange={(e) => setSettings({ ...settings, dividendThreshold: parseInt(e.target.value) || 0 })}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    最低扣費門檻 (元)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={settings.minimumThreshold}
                    onChange={(e) => setSettings({ ...settings, minimumThreshold: parseInt(e.target.value) || 0 })}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
                    disabled={!settings.isEnabled}
                  />
                  <p className="mt-1 text-sm text-gray-900">低於此金額不計算補充保費</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    每月最高保費 (元)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={settings.maxMonthlyPremium}
                    onChange={(e) => setSettings({ ...settings, maxMonthlyPremium: parseInt(e.target.value) || 0 })}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
                    disabled={!settings.isEnabled}
                  />
                  <p className="mt-1 text-sm text-gray-900">單月補充保費上限</p>
                </div>
              </div>
            </div>

            {/* 計算項目 */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <h3 className="text-lg font-medium text-green-900 mb-4">納入計算項目</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={settings.salaryIncludeItems.overtime}
                    onChange={(e) => updateSalaryIncludeItems('overtime', e.target.checked)}
                    className="rounded border-gray-300 text-green-600 shadow-sm focus:border-green-300 focus:ring focus:ring-green-200 focus:ring-opacity-50"
                    disabled={!settings.isEnabled}
                  />
                  <span className="text-sm text-gray-700">加班費</span>
                </label>
                
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={settings.salaryIncludeItems.bonus}
                    onChange={(e) => updateSalaryIncludeItems('bonus', e.target.checked)}
                    className="rounded border-gray-300 text-green-600 shadow-sm focus:border-green-300 focus:ring focus:ring-green-200 focus:ring-opacity-50"
                    disabled={!settings.isEnabled}
                  />
                  <span className="text-sm text-gray-700">獎金</span>
                </label>
                
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={settings.salaryIncludeItems.allowance}
                    onChange={(e) => updateSalaryIncludeItems('allowance', e.target.checked)}
                    className="rounded border-gray-300 text-green-600 shadow-sm focus:border-green-300 focus:ring focus:ring-green-200 focus:ring-opacity-50"
                    disabled={!settings.isEnabled}
                  />
                  <span className="text-sm text-gray-700">津貼</span>
                </label>
                
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={settings.salaryIncludeItems.commission}
                    onChange={(e) => updateSalaryIncludeItems('commission', e.target.checked)}
                    className="rounded border-gray-300 text-green-600 shadow-sm focus:border-green-300 focus:ring focus:ring-green-200 focus:ring-opacity-50"
                    disabled={!settings.isEnabled}
                  />
                  <span className="text-sm text-gray-700">佣金</span>
                </label>
              </div>
            </div>

            {/* 計算方式 */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="text-lg font-medium text-blue-900 mb-4">計算方式</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    計算方法
                  </label>
                  <select
                    value={settings.calculationMethod}
                    onChange={(e) => setSettings({ ...settings, calculationMethod: e.target.value as 'CUMULATIVE' | 'MONTHLY' })}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
                    disabled={!settings.isEnabled}
                  >
                    <option value="CUMULATIVE">累計制（全年累計計算）</option>
                    <option value="MONTHLY">單次制（每次發放獨立計算）</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    重置週期
                  </label>
                  <select
                    value={settings.resetPeriod}
                    onChange={(e) => setSettings({ ...settings, resetPeriod: e.target.value as 'YEARLY' | 'MONTHLY' })}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
                    disabled={!settings.isEnabled}
                  >
                    <option value="YEARLY">每年重置</option>
                    <option value="MONTHLY">每月重置</option>
                  </select>
                </div>
                
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={settings.applyToAllEmployees}
                    onChange={(e) => setSettings({ ...settings, applyToAllEmployees: e.target.checked })}
                    className="rounded border-gray-300 text-green-600 shadow-sm focus:border-green-300 focus:ring focus:ring-green-200 focus:ring-opacity-50"
                    disabled={!settings.isEnabled}
                  />
                  <span className="text-sm text-gray-700">適用於所有員工</span>
                </label>
              </div>
            </div>

            {/* 說明描述 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                規則說明
              </label>
              <textarea
                value={settings.description}
                onChange={(e) => setSettings({ ...settings, description: e.target.value })}
                rows={3}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500"
                disabled={!settings.isEnabled}
                placeholder="請輸入補充保費計算的詳細說明..."
              />
            </div>

            {/* 法規說明 */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-medium text-yellow-800">全民健康保險法規定</h4>
                  <ul className="text-sm text-yellow-700 mt-1 space-y-1">
                    <li>• 補充保費費率：2.11%（民國113年起）</li>
                    <li>• 免扣除門檻：投保金額4倍</li>
                    <li>• 年度累計補充保費上限：1,000萬元</li>
                    <li>• 獎金、津貼、兼職所得等須計算補充保費</li>
                    <li>• 請確保設定符合最新法規要求</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* 操作按鈕 */}
            <div className="flex justify-end space-x-4 pt-4 border-t border-gray-200">
              <button
                onClick={() => router.push('/system-settings')}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              >
                取消
              </button>
              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
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
