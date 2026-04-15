'use client';

import { useState, useEffect } from 'react';
import { Save, Gift, Calendar, Clock, AlertTriangle, Calculator } from 'lucide-react';
import { buildAuthMeRequest, buildCookieSessionRequest } from '@/lib/admin-session-client';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import SystemNavbar from '@/components/SystemNavbar';

interface BonusConfig {
  id: number;
  bonusType: string;
  bonusTypeName: string;
  description: string | null;
  isActive: boolean;
  defaultAmount: number | null;
  calculationFormula: string | null;
  eligibilityRules: {
    minimumServiceMonths?: number;
    baseMultiplier?: number;
    festivalMultipliers?: {
      spring_festival?: number;
      dragon_boat?: number;
      mid_autumn?: number;
    };
  };
  paymentSchedule: {
    yearEndMonth?: number;
    springMonth?: number;
    dragonBoatMonth?: number;
    midAutumnMonth?: number;
  };
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

export default function BonusConfigPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [configs, setConfigs] = useState<BonusConfig[]>([]);

  // 計算設定（整合自 prorated-bonus）
  const [calculationSettings, setCalculationSettings] = useState({
    isEnabled: true,
    calculationMethod: 'MONTHLY' as 'MONTHLY' | 'DAILY',
    cutoffDay: 15,
    prorateForNewHires: true,
    prorateForTerminated: true
  });

  // 年終獎金設定
  const [yearEndConfig, setYearEndConfig] = useState({
    baseMultiplier: 1.5,
    minimumServiceMonths: 3,
    paymentMonth: 2,
    enabled: true
  });

  // 三節獎金設定
  const [festivalConfig, setFestivalConfig] = useState({
    springMultiplier: 0.5,
    dragonBoatMultiplier: 0.3,
    midAutumnMultiplier: 0.3,
    minimumServiceMonths: 1,
    springMonth: 2,
    dragonBoatMonth: 6,
    midAutumnMonth: 9,
    enabled: true
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 驗證用戶
        const authMeRequest = buildAuthMeRequest(window.location.origin);
        const userResponse = await fetch(authMeRequest.url, authMeRequest.options);

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

        // 載入現有獎金配置
        const configRequest = buildCookieSessionRequest(window.location.origin, '/api/system-settings/bonus-config');
        const configResponse = await fetch(configRequest.url, configRequest.options);

        if (configResponse.ok) {
          const data = await configResponse.json();
          setConfigs(data.configs || []);

          // 解析年終獎金設定
          const yearEnd = data.configs?.find((c: BonusConfig) => c.bonusType === 'YEAR_END');
          if (yearEnd?.eligibilityRules) {
            setYearEndConfig({
              baseMultiplier: yearEnd.eligibilityRules.baseMultiplier || 1.5,
              minimumServiceMonths: yearEnd.eligibilityRules.minimumServiceMonths || 3,
              paymentMonth: yearEnd.paymentSchedule?.yearEndMonth || 2,
              enabled: yearEnd.isActive !== false
            });
          }

          // 解析三節獎金設定
          const festival = data.configs?.find((c: BonusConfig) => c.bonusType === 'FESTIVAL');
          if (festival?.eligibilityRules) {
            setFestivalConfig({
              springMultiplier: festival.eligibilityRules.festivalMultipliers?.spring_festival || 0.5,
              dragonBoatMultiplier: festival.eligibilityRules.festivalMultipliers?.dragon_boat || 0.3,
              midAutumnMultiplier: festival.eligibilityRules.festivalMultipliers?.mid_autumn || 0.3,
              minimumServiceMonths: festival.eligibilityRules.minimumServiceMonths || 1,
              springMonth: festival.paymentSchedule?.springMonth || 2,
              dragonBoatMonth: festival.paymentSchedule?.dragonBoatMonth || 6,
              midAutumnMonth: festival.paymentSchedule?.midAutumnMonth || 9,
              enabled: festival.isActive !== false
            });
          }
        }

        // 載入按比例計算設定
        const prorateRequest = buildCookieSessionRequest(window.location.origin, '/api/system-settings/prorated-bonus');
        const prorateResponse = await fetch(prorateRequest.url, prorateRequest.options);

        if (prorateResponse.ok) {
          const data = await prorateResponse.json();
          if (data.settings) {
            setCalculationSettings({
              isEnabled: data.settings.isEnabled ?? true,
              calculationMethod: data.settings.calculationMethod || 'MONTHLY',
              cutoffDay: data.settings.cutoffDay || 15,
              prorateForNewHires: data.settings.prorateForNewHires ?? true,
              prorateForTerminated: data.settings.prorateForTerminated ?? true
            });
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
      // 儲存獎金配置
      const configResponse = await fetchJSONWithCSRF('/api/system-settings/bonus-config', {
        method: 'POST',
        body: {
          yearEndConfig: {
            bonusType: 'YEAR_END',
            bonusTypeName: '年終獎金',
            isActive: yearEndConfig.enabled,
            eligibilityRules: {
              baseMultiplier: yearEndConfig.baseMultiplier,
              minimumServiceMonths: yearEndConfig.minimumServiceMonths
            },
            paymentSchedule: {
              yearEndMonth: yearEndConfig.paymentMonth
            }
          },
          festivalConfig: {
            bonusType: 'FESTIVAL',
            bonusTypeName: '三節獎金',
            isActive: festivalConfig.enabled,
            eligibilityRules: {
              minimumServiceMonths: festivalConfig.minimumServiceMonths,
              festivalMultipliers: {
                spring_festival: festivalConfig.springMultiplier,
                dragon_boat: festivalConfig.dragonBoatMultiplier,
                mid_autumn: festivalConfig.midAutumnMultiplier
              }
            },
            paymentSchedule: {
              springMonth: festivalConfig.springMonth,
              dragonBoatMonth: festivalConfig.dragonBoatMonth,
              midAutumnMonth: festivalConfig.midAutumnMonth
            }
          }
        }
      });

      // 儲存按比例計算設定
      const prorateResponse = await fetchJSONWithCSRF('/api/system-settings/prorated-bonus', {
        method: 'POST',
        body: {
          isEnabled: calculationSettings.isEnabled,
          calculationMethod: calculationSettings.calculationMethod,
          cutoffDay: calculationSettings.cutoffDay,
          prorateForNewHires: calculationSettings.prorateForNewHires,
          prorateForTerminated: calculationSettings.prorateForTerminated,
          minimumServiceDays: yearEndConfig.minimumServiceMonths * 30,
          yearEndBonusProration: yearEndConfig.enabled,
          festivalBonusProration: festivalConfig.enabled
        }
      });

      if (configResponse.ok && prorateResponse.ok) {
        setMessage({ type: 'success', text: '設定已儲存' });
      } else {
        setMessage({ type: 'error', text: '部分設定儲存失敗' });
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
        <div className="text-gray-600">載入中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 標題 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <Gift className="w-8 h-8 text-purple-600 mr-3" />
            獎金配置設定
          </h1>
          <p className="text-gray-600 mt-2">整合設定年終獎金、三節獎金及按比例計算規則</p>
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

        {/* 計算設定區塊 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
            <h2 className="text-lg font-medium text-gray-900 flex items-center">
              <Calculator className="w-5 h-5 mr-2 text-gray-600" />
              計算設定
            </h2>
          </div>
          <div className="p-6 space-y-4">
            {/* 啟用開關 */}
            <label className="flex items-center space-x-3">
              <input
                type="checkbox"
                checked={calculationSettings.isEnabled}
                onChange={(e) => setCalculationSettings({
                  ...calculationSettings,
                  isEnabled: e.target.checked
                })}
                className="rounded border-gray-300 text-purple-600 shadow-sm focus:border-purple-300 focus:ring focus:ring-purple-200 focus:ring-opacity-50"
              />
              <span className="text-sm font-medium text-gray-900">啟用按比例獎金計算</span>
            </label>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  計算基準
                </label>
                <select
                  value={calculationSettings.calculationMethod}
                  onChange={(e) => setCalculationSettings({
                    ...calculationSettings,
                    calculationMethod: e.target.value as 'MONTHLY' | 'DAILY'
                  })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                  disabled={!calculationSettings.isEnabled}
                >
                  <option value="MONTHLY">按月計算</option>
                  <option value="DAILY">按日計算</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  月份計算截止日
                </label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={calculationSettings.cutoffDay}
                  onChange={(e) => setCalculationSettings({
                    ...calculationSettings,
                    cutoffDay: parseInt(e.target.value) || 15
                  })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                  disabled={!calculationSettings.isEnabled}
                />
                <p className="text-xs text-gray-500 mt-1">此日前到職當月全算</p>
              </div>

              <div className="flex flex-col justify-center space-y-2">
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={calculationSettings.prorateForNewHires}
                    onChange={(e) => setCalculationSettings({
                      ...calculationSettings,
                      prorateForNewHires: e.target.checked
                    })}
                    className="rounded border-gray-300 text-purple-600"
                    disabled={!calculationSettings.isEnabled}
                  />
                  <span className="text-sm text-gray-900">新進員工按比例</span>
                </label>
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={calculationSettings.prorateForTerminated}
                    onChange={(e) => setCalculationSettings({
                      ...calculationSettings,
                      prorateForTerminated: e.target.checked
                    })}
                    className="rounded border-gray-300 text-purple-600"
                    disabled={!calculationSettings.isEnabled}
                  />
                  <span className="text-sm text-gray-900">離職員工按比例</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* 年終獎金設定 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
          <div className="px-6 py-4 border-b border-gray-200 bg-blue-50 flex justify-between items-center">
            <h2 className="text-lg font-medium text-blue-900 flex items-center">
              <Calendar className="w-5 h-5 mr-2" />
              年終獎金設定
            </h2>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={yearEndConfig.enabled}
                onChange={(e) => setYearEndConfig({
                  ...yearEndConfig,
                  enabled: e.target.checked
                })}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="text-sm text-blue-800">啟用</span>
            </label>
          </div>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  基數倍數（月薪 × N 倍）
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={yearEndConfig.baseMultiplier}
                  onChange={(e) => setYearEndConfig({
                    ...yearEndConfig,
                    baseMultiplier: parseFloat(e.target.value) || 0
                  })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                  disabled={!yearEndConfig.enabled}
                />
                <p className="text-xs text-gray-500 mt-1">例：1.5 表示發放 1.5 個月薪水</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  最低服務月數
                </label>
                <input
                  type="number"
                  min="0"
                  value={yearEndConfig.minimumServiceMonths}
                  onChange={(e) => setYearEndConfig({
                    ...yearEndConfig,
                    minimumServiceMonths: parseInt(e.target.value) || 0
                  })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                  disabled={!yearEndConfig.enabled}
                />
                <p className="text-xs text-gray-500 mt-1">未滿此月數不發放</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  發放月份
                </label>
                <select
                  value={yearEndConfig.paymentMonth}
                  onChange={(e) => setYearEndConfig({
                    ...yearEndConfig,
                    paymentMonth: parseInt(e.target.value)
                  })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                  disabled={!yearEndConfig.enabled}
                >
                  {[1, 2, 3, 12].map(m => (
                    <option key={m} value={m}>{m} 月</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* 三節獎金設定 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
          <div className="px-6 py-4 border-b border-gray-200 bg-green-50 flex justify-between items-center">
            <h2 className="text-lg font-medium text-green-900 flex items-center">
              <Gift className="w-5 h-5 mr-2" />
              三節獎金設定
            </h2>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={festivalConfig.enabled}
                onChange={(e) => setFestivalConfig({
                  ...festivalConfig,
                  enabled: e.target.checked
                })}
                className="rounded border-gray-300 text-green-600"
              />
              <span className="text-sm text-green-800">啟用</span>
            </label>
          </div>
          <div className="p-6 space-y-6">
            {/* 最低服務月數 */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                <Clock className="inline-block w-4 h-4 mr-1" />
                最低服務月數（適用所有三節）
              </label>
              <input
                type="number"
                min="0"
                value={festivalConfig.minimumServiceMonths}
                onChange={(e) => setFestivalConfig({
                  ...festivalConfig,
                  minimumServiceMonths: parseInt(e.target.value) || 0
                })}
                className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                disabled={!festivalConfig.enabled}
              />
            </div>

            {/* 各節日設定 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* 春節 */}
              <div className="border border-red-200 rounded-lg p-4 bg-red-50">
                <h3 className="font-medium text-red-800 mb-3">🧧 春節獎金</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-700 mb-1">基數倍數</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={festivalConfig.springMultiplier}
                      onChange={(e) => setFestivalConfig({
                        ...festivalConfig,
                        springMultiplier: parseFloat(e.target.value) || 0
                      })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                      disabled={!festivalConfig.enabled}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-700 mb-1">發放月份</label>
                    <select
                      value={festivalConfig.springMonth}
                      onChange={(e) => setFestivalConfig({
                        ...festivalConfig,
                        springMonth: parseInt(e.target.value)
                      })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                      disabled={!festivalConfig.enabled}
                    >
                      {[1, 2].map(m => (
                        <option key={m} value={m}>{m} 月</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* 端午 */}
              <div className="border border-green-200 rounded-lg p-4 bg-green-50">
                <h3 className="font-medium text-green-800 mb-3">🐉 端午獎金</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-700 mb-1">基數倍數</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={festivalConfig.dragonBoatMultiplier}
                      onChange={(e) => setFestivalConfig({
                        ...festivalConfig,
                        dragonBoatMultiplier: parseFloat(e.target.value) || 0
                      })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                      disabled={!festivalConfig.enabled}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-700 mb-1">發放月份</label>
                    <select
                      value={festivalConfig.dragonBoatMonth}
                      onChange={(e) => setFestivalConfig({
                        ...festivalConfig,
                        dragonBoatMonth: parseInt(e.target.value)
                      })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                      disabled={!festivalConfig.enabled}
                    >
                      {[5, 6].map(m => (
                        <option key={m} value={m}>{m} 月</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* 中秋 */}
              <div className="border border-yellow-200 rounded-lg p-4 bg-yellow-50">
                <h3 className="font-medium text-yellow-800 mb-3">🥮 中秋獎金</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-700 mb-1">基數倍數</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={festivalConfig.midAutumnMultiplier}
                      onChange={(e) => setFestivalConfig({
                        ...festivalConfig,
                        midAutumnMultiplier: parseFloat(e.target.value) || 0
                      })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                      disabled={!festivalConfig.enabled}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-700 mb-1">發放月份</label>
                    <select
                      value={festivalConfig.midAutumnMonth}
                      onChange={(e) => setFestivalConfig({
                        ...festivalConfig,
                        midAutumnMonth: parseInt(e.target.value)
                      })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
                      disabled={!festivalConfig.enabled}
                    >
                      {[8, 9, 10].map(m => (
                        <option key={m} value={m}>{m} 月</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 注意事項 */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <div className="flex items-start space-x-3">
            <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
            <div>
              <h4 className="text-sm font-medium text-yellow-800">重要提醒</h4>
              <ul className="text-sm text-yellow-700 mt-1 space-y-1">
                <li>• 按比例計算將影響所有符合條件的員工獎金發放</li>
                <li>• 建議在獎金發放前確認所有參數設定</li>
                <li>• 修改設定將影響後續的獎金計算，請謹慎操作</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 儲存按鈕 */}
        <div className="flex justify-end gap-4">
          <a
            href="/pro-rated-bonus"
            className="inline-flex items-center px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            <Calculator className="w-4 h-4 mr-2" />
            前往計算頁面
          </a>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? '儲存中...' : '儲存設定'}
          </button>
        </div>
      </main>
    </div>
  );
}
