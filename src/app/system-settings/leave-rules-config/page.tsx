'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Save, Info, Baby, Heart, Thermometer, Calendar, History, Loader2 } from 'lucide-react';
import SystemNavbar from '@/components/SystemNavbar';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import {
  DEFAULT_LEAVE_RULES_SETTINGS,
  type LeaveRulesSettingsValues,
} from '@/lib/leave-rules-config-defaults';

interface User {
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
}

interface LeaveRulesConfig extends LeaveRulesSettingsValues {
  id: number | null;
  effectiveDate: string;
  isActive: boolean;
  description: string;
}

export default function LeaveRulesConfigPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDefault, setIsDefault] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  const [config, setConfig] = useState<LeaveRulesConfig>({
    id: null,
    ...DEFAULT_LEAVE_RULES_SETTINGS,
    effectiveDate: new Date().toISOString().split('T')[0],
    isActive: true,
    description: ''
  });

  const loadConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/system-settings/leave-rules-config', {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setConfig(data.config);
        setIsDefault(data.isDefault);
      }
    } catch (error) {
      console.error('載入設定失敗:', error);
      setMessage({ type: 'error', text: '載入設定失敗' });
    }
  }, []);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await fetch('/api/auth/me', { credentials: 'include' });
        if (response.ok) {
          const userData = await response.json();
          const currentUser = userData.user || userData;
          if (currentUser.role !== 'ADMIN') {
            router.push('/dashboard');
            return;
          }
          setUser(currentUser);
          await loadConfig();
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
  }, [router, loadConfig]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/leave-rules-config', {
        method: 'POST',
        body: config
      });

      const data = await response.json();
      
      if (data.success) {
        setMessage({ type: 'success', text: '假別規則設定已儲存成功！' });
        setIsDefault(false);
        loadConfig();
      } else {
        setMessage({ type: 'error', text: data.error || '儲存失敗' });
      }
    } catch (error) {
      console.error('儲存失敗:', error);
      setMessage({ type: 'error', text: '儲存失敗，請稍後再試' });
    } finally {
      setSaving(false);
    }
  };

  const handleInputChange = (field: keyof LeaveRulesConfig, value: string | number | boolean) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-900">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 頂部導航 */}
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />

      {/* 主要內容 */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 標題區 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center">
              <Calendar className="w-8 h-8 text-purple-600 mr-3" />
              假別規則設定
            </h1>
            <p className="text-gray-600 mt-2">設定育嬰留停、家庭照顧假、病假等假別規則</p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            {saving ? '儲存中...' : '儲存設定'}
          </button>
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

        {/* 狀態提示 */}
        {isDefault && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-3">
            <Info className="h-5 w-5 text-yellow-600 mt-0.5" />
            <div>
              <p className="text-yellow-800 font-medium">目前使用系統預設值</p>
              <p className="text-yellow-700 text-sm">您尚未儲存任何自訂設定，顯示的是程式內建預設值。</p>
            </div>
          </div>
        )}

        {/* 設定表單 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* 育嬰留停設定 */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Baby className="h-5 w-5 text-pink-600" />
                <h2 className="text-lg font-medium text-gray-900">育嬰留停設定</h2>
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">2026新規</span>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="parentalLeaveFlexible"
                  checked={config.parentalLeaveFlexible}
                  onChange={(e) => handleInputChange('parentalLeaveFlexible', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="parentalLeaveFlexible" className="text-sm text-gray-900">
                  可單日申請
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  個人上限 (天)
                </label>
                <input
                  type="number"
                  min="1"
                  value={config.parentalLeaveMaxDays}
                  onChange={(e) => handleInputChange('parentalLeaveMaxDays', parseInt(e.target.value) || 0)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                />
                <p className="mt-1 text-sm text-gray-600">2026年起可單日申請，上限 30 天</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  雙親合計上限 (天)
                </label>
                <input
                  type="number"
                  min="1"
                  value={config.parentalLeaveCombinedMax}
                  onChange={(e) => handleInputChange('parentalLeaveCombinedMax', parseInt(e.target.value) || 0)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                />
                <p className="mt-1 text-sm text-gray-600">雙親合計最多 60 天</p>
              </div>
            </div>
          </div>

          {/* 家庭照顧假設定 */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Heart className="h-5 w-5 text-red-600" />
                <h2 className="text-lg font-medium text-gray-900">家庭照顧假設定</h2>
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">2026新規</span>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  全日假上限 (天)
                </label>
                <input
                  type="number"
                  min="0"
                  value={config.familyCareLeaveMaxDays}
                  onChange={(e) => handleInputChange('familyCareLeaveMaxDays', parseInt(e.target.value) || 0)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  事假補充時數上限 (小時/年)
                </label>
                <input
                  type="number"
                  min="0"
                  value={config.familyCareHourlyMaxHours}
                  onChange={(e) => handleInputChange('familyCareHourlyMaxHours', parseInt(e.target.value) || 0)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                />
                <p className="mt-1 text-sm text-gray-600">家庭照顧假用罄後可用事假補充，最多 56 小時</p>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="familyCareHourlyEnabled"
                  checked={config.familyCareHourlyEnabled}
                  onChange={(e) => handleInputChange('familyCareHourlyEnabled', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="familyCareHourlyEnabled" className="text-sm text-gray-900">
                  啟用事假小時制補充
                </label>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="familyCareNoDeductAttendance"
                  checked={config.familyCareNoDeductAttendance}
                  onChange={(e) => handleInputChange('familyCareNoDeductAttendance', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="familyCareNoDeductAttendance" className="text-sm text-gray-900">
                  不扣全勤獎金
                </label>
              </div>
            </div>
          </div>

          {/* 病假設定 */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Thermometer className="h-5 w-5 text-orange-600" />
                <h2 className="text-lg font-medium text-gray-900">病假設定</h2>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  年度病假上限 (天)
                </label>
                <input
                  type="number"
                  min="1"
                  value={config.sickLeaveAnnualMax}
                  onChange={(e) => handleInputChange('sickLeaveAnnualMax', parseInt(e.target.value) || 0)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  免扣全勤天數 (天)
                </label>
                <input
                  type="number"
                  min="0"
                  value={config.sickLeaveNoDeductDays}
                  onChange={(e) => handleInputChange('sickLeaveNoDeductDays', parseInt(e.target.value) || 0)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                />
                <p className="mt-1 text-sm text-gray-600">2026年起為 10 天</p>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="sickLeaveHalfPay"
                  checked={config.sickLeaveHalfPay}
                  onChange={(e) => handleInputChange('sickLeaveHalfPay', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="sickLeaveHalfPay" className="text-sm text-gray-900">
                  病假期間半薪
                </label>
              </div>
            </div>
          </div>

          {/* 特休假與補休設定 */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-green-600" />
                <h2 className="text-lg font-medium text-gray-900">特休假與補休設定</h2>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="annualLeaveRollover"
                  checked={config.annualLeaveRollover}
                  onChange={(e) => handleInputChange('annualLeaveRollover', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="annualLeaveRollover" className="text-sm text-gray-900">
                  允許特休假遞延
                </label>
              </div>
              {config.annualLeaveRollover && (
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    特休遞延上限 (天)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={config.annualLeaveRolloverMax}
                    onChange={(e) => handleInputChange('annualLeaveRolloverMax', parseInt(e.target.value) || 0)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                  />
                  <p className="mt-1 text-sm text-gray-600">0 = 不限制</p>
                </div>
              )}
              <div className="pt-4 border-t border-gray-200">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="compLeaveRollover"
                    checked={config.compLeaveRollover}
                    onChange={(e) => handleInputChange('compLeaveRollover', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="compLeaveRollover" className="text-sm text-gray-900">
                    允許補休遞延
                  </label>
                </div>
              </div>
              {config.compLeaveRollover && (
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    補休遞延上限 (天)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={config.compLeaveRolloverMax}
                    onChange={(e) => handleInputChange('compLeaveRolloverMax', parseInt(e.target.value) || 0)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                  />
                  <p className="mt-1 text-sm text-gray-600">0 = 不限制</p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  補休有效期 (月)
                </label>
                <input
                  type="number"
                  value={config.compLeaveExpiryMonths}
                  onChange={(e) => handleInputChange('compLeaveExpiryMonths', parseInt(e.target.value) || 6)}
                  min="1"
                  max="24"
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                />
                <p className="mt-1 text-sm text-gray-600">預設 6 個月</p>
              </div>
            </div>
          </div>
        </div>

        {/* 生效設定 */}
        <div className="mt-8 bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">生效設定</h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  生效日期
                </label>
                <input
                  type="date"
                  value={config.effectiveDate}
                  onChange={(e) => handleInputChange('effectiveDate', e.target.value)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  說明備註
                </label>
                <input
                  type="text"
                  value={config.description || ''}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  placeholder="例如：2026年法規調整"
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900 placeholder-gray-400"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 歷史記錄提示 */}
        {!isDefault && (
          <div className="mt-6 bg-gray-50 rounded-lg p-4 flex items-center gap-3">
            <History className="h-5 w-5 text-gray-500" />
            <p className="text-sm text-gray-600">
              儲存新設定後，舊設定將被保留作為歷史記錄。
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
