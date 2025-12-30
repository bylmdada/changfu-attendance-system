'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Save, Info, History, DollarSign, Percent, Loader2, Shield } from 'lucide-react';
import SystemNavbar from '@/components/SystemNavbar';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';

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

interface LaborLawConfig {
  id: number | null;
  basicWage: number;
  laborInsuranceRate: number;
  laborInsuranceMax: number;
  laborEmployeeRate: number;
  effectiveDate: string;
  isActive: boolean;
  description: string;
}

export default function LaborLawConfigPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDefault, setIsDefault] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  const [config, setConfig] = useState<LaborLawConfig>({
    id: null,
    basicWage: 29500,
    laborInsuranceRate: 0.115,
    laborInsuranceMax: 45800,
    laborEmployeeRate: 0.2,
    effectiveDate: new Date().toISOString().split('T')[0],
    isActive: true,
    description: ''
  });

  const loadConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/system-settings/labor-law-config', {
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
      const response = await fetchJSONWithCSRF('/api/system-settings/labor-law-config', {
        method: 'POST',
        body: config
      });

      const data = await response.json();
      
      if (data.success) {
        setMessage({ type: 'success', text: '法規參數設定已儲存成功！' });
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

  const handleInputChange = (field: keyof LaborLawConfig, value: string | number) => {
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
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 標題區 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center">
              <Shield className="w-8 h-8 text-blue-600 mr-3" />
              法規參數設定
            </h1>
            <p className="text-gray-600 mt-2">設定勞保費率與基本工資（健保設定請至「健保費率設定」）</p>
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

        {/* 提示：健保設定在其他地方 */}
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-3">
          <Info className="h-5 w-5 text-blue-600 mt-0.5" />
          <div>
            <p className="text-blue-800 font-medium">健保費率設定</p>
            <p className="text-blue-700 text-sm">
              健保費率及投保金額級距表請至 
              <a href="/system-settings/health-insurance-formula" className="underline font-medium ml-1">
                健保費率設定
              </a> 頁面管理。
            </p>
          </div>
        </div>

        {/* 設定表單 */}
        <div className="space-y-8">
          
          {/* 基本工資 */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-green-600" />
                <h2 className="text-lg font-medium text-gray-900">基本工資</h2>
              </div>
            </div>
            <div className="p-6">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  月薪基本工資 (元)
                </label>
                <input
                  type="number"
                  value={config.basicWage}
                  onChange={(e) => handleInputChange('basicWage', parseInt(e.target.value) || 0)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                />
                <p className="mt-1 text-sm text-gray-600">2025年起為 29,500 元</p>
              </div>
            </div>
          </div>

          {/* 勞保設定 */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Percent className="h-5 w-5 text-blue-600" />
                <h2 className="text-lg font-medium text-gray-900">勞保設定</h2>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    勞保費率 (小數)
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    value={config.laborInsuranceRate}
                    onChange={(e) => handleInputChange('laborInsuranceRate', parseFloat(e.target.value) || 0)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                  />
                  <p className="mt-1 text-sm text-gray-600">目前 11.5% = 0.115</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    投保薪資上限 (元)
                  </label>
                  <input
                    type="number"
                    value={config.laborInsuranceMax}
                    onChange={(e) => handleInputChange('laborInsuranceMax', parseInt(e.target.value) || 0)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                  />
                  <p className="mt-1 text-sm text-gray-600">目前上限 45,800 元</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    員工負擔比例 (小數)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={config.laborEmployeeRate}
                    onChange={(e) => handleInputChange('laborEmployeeRate', parseFloat(e.target.value) || 0)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                  />
                  <p className="mt-1 text-sm text-gray-600">員工 20% = 0.2</p>
                </div>
              </div>
            </div>
          </div>

          {/* 生效設定 */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
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
                    placeholder="例如：2025年法規調整"
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900 placeholder-gray-400"
                  />
                </div>
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
