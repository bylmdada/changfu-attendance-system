'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Calculator, Save, AlertTriangle } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import SystemNavbar from '@/components/SystemNavbar';

interface ProratedBonusSettings {
  id?: number;
  isEnabled: boolean;
  calculationMethod: 'MONTHLY' | 'DAILY' | 'CUSTOM';
  minimumServiceDays: number;
  prorateForNewHires: boolean;
  prorateForTerminated: boolean;
  cutoffDay: number; // 按比例計算截止日
  yearEndBonusProration: boolean;
  festivalBonusProration: boolean;
  performanceBonusProration: boolean;
  customProrateRules: {
    bonusType: string;
    enabled: boolean;
    minimumDays: number;
  }[];
  description: string;
  createdAt?: string;
  updatedAt?: string;
}

export default function ProratedBonusPage() {
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
  const [settings, setSettings] = useState<ProratedBonusSettings>({
    isEnabled: true,
    calculationMethod: 'MONTHLY',
    minimumServiceDays: 30,
    prorateForNewHires: true,
    prorateForTerminated: true,
    cutoffDay: 15,
    yearEndBonusProration: true,
    festivalBonusProration: false,
    performanceBonusProration: true,
    customProrateRules: [],
    description: '新進員工和離職員工的獎金按比例計算規則'
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
      const response = await fetch('/api/system-settings/prorated-bonus', {
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
      const response = await fetchJSONWithCSRF('/api/system-settings/prorated-bonus', {
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

  const calculateProrateExample = () => {
    const today = new Date();
    const currentYear = today.getFullYear();
    
    // 新進員工範例：10月15日到職
    const hireDate = new Date(currentYear, 9, 15); // 10月15日
    const yearEndDate = new Date(currentYear, 11, 31); // 12月31日
    
    let workingMonths = 0;
    if (settings.calculationMethod === 'MONTHLY') {
      workingMonths = (yearEndDate.getFullYear() - hireDate.getFullYear()) * 12 + 
                     (yearEndDate.getMonth() - hireDate.getMonth()) + 1;
      if (hireDate.getDate() > settings.cutoffDay) {
        workingMonths -= 0.5; // 當月按半月計算
      }
    }
    
    const prorateRatio = workingMonths / 12;
    const fullBonus = 50000; // 假設年終獎金5萬
    const proratedBonus = Math.round(fullBonus * prorateRatio);
    
    return {
      hireDate: '2024年10月15日',
      workingMonths: workingMonths.toFixed(1),
      prorateRatio: (prorateRatio * 100).toFixed(1),
      fullBonus,
      proratedBonus
    };
  };

  const example = calculateProrateExample();

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
            按比例獎金設定
          </h1>
          <p className="text-gray-600 mt-2">設定年終及獎金按服務比例計算規則</p>
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
            計算範例
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-medium text-blue-800 mb-2">新進員工按比例計算</h3>
              <div className="text-sm text-blue-700 space-y-1">
                <p>到職日期：{example.hireDate}</p>
                <p>工作月數：{example.workingMonths} 個月</p>
                <p>按比例：{example.prorateRatio}%</p>
                <p>完整獎金：NT$ {example.fullBonus.toLocaleString()}</p>
                <p className="font-medium">按比例獎金：NT$ {example.proratedBonus.toLocaleString()}</p>
              </div>
            </div>
            <div>
              <h3 className="font-medium text-blue-800 mb-2">計算說明</h3>
              <div className="text-sm text-blue-700 space-y-1">
                <p>• 以月為單位計算服務期間</p>
                <p>• {settings.cutoffDay}日前到職當月全算</p>
                <p>• {settings.cutoffDay}日後到職當月半算</p>
                <p>• 最低服務{settings.minimumServiceDays}天才發放</p>
              </div>
            </div>
          </div>
        </div>

        {/* 設定表單 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">按比例獎金設定</h2>
          </div>
          
          <div className="p-6 space-y-6">
            {/* 基本設定 */}
            <div>
              <label className="flex items-center space-x-3 mb-4">
                <input
                  type="checkbox"
                  checked={settings.isEnabled}
                  onChange={(e) => setSettings({ ...settings, isEnabled: e.target.checked })}
                  className="rounded border-gray-300 text-purple-600 shadow-sm focus:border-purple-300 focus:ring focus:ring-purple-200 focus:ring-opacity-50"
                />
                <span className="text-sm font-medium text-gray-900">啟用按比例獎金計算</span>
              </label>
            </div>

            {/* 計算方式 */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h3 className="text-lg font-medium text-gray-900 mb-4">計算方式</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    計算基準
                  </label>
                  <select
                    value={settings.calculationMethod}
                    onChange={(e) => setSettings({ ...settings, calculationMethod: e.target.value as 'MONTHLY' | 'DAILY' | 'CUSTOM' })}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 text-gray-900"
                    disabled={!settings.isEnabled}
                  >
                    <option value="MONTHLY">按月計算</option>
                    <option value="DAILY">按日計算</option>
                    <option value="CUSTOM">自訂規則</option>
                  </select>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      最低服務天數
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={settings.minimumServiceDays}
                      onChange={(e) => setSettings({ ...settings, minimumServiceDays: parseInt(e.target.value) || 0 })}
                      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 text-gray-900"
                      disabled={!settings.isEnabled}
                    />
                    <p className="mt-1 text-sm text-gray-900">未達此天數不發放獎金</p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      月份計算截止日
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={settings.cutoffDay}
                      onChange={(e) => setSettings({ ...settings, cutoffDay: parseInt(e.target.value) || 15 })}
                      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 text-gray-900"
                      disabled={!settings.isEnabled}
                    />
                    <p className="mt-1 text-sm text-gray-900">此日期前到職當月全算，之後半算</p>
                  </div>
                </div>
              </div>
            </div>

            {/* 適用對象 */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <h3 className="text-lg font-medium text-green-900 mb-4">適用對象</h3>
              <div className="space-y-3">
                <label className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    checked={settings.prorateForNewHires}
                    onChange={(e) => setSettings({ ...settings, prorateForNewHires: e.target.checked })}
                    className="rounded border-gray-300 text-purple-600 shadow-sm focus:border-purple-300 focus:ring focus:ring-purple-200 focus:ring-opacity-50"
                    disabled={!settings.isEnabled}
                  />
                  <span className="text-sm text-gray-900">新進員工（年中到職）</span>
                </label>
                
                <label className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    checked={settings.prorateForTerminated}
                    onChange={(e) => setSettings({ ...settings, prorateForTerminated: e.target.checked })}
                    className="rounded border-gray-300 text-purple-600 shadow-sm focus:border-purple-300 focus:ring focus:ring-purple-200 focus:ring-opacity-50"
                    disabled={!settings.isEnabled}
                  />
                  <span className="text-sm text-gray-900">離職員工（年中離職）</span>
                </label>
              </div>
            </div>

            {/* 獎金類型設定 */}
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <h3 className="text-lg font-medium text-purple-900 mb-4">按獎金類型設定</h3>
              <div className="space-y-3">
                <label className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    checked={settings.yearEndBonusProration}
                    onChange={(e) => setSettings({ ...settings, yearEndBonusProration: e.target.checked })}
                    className="rounded border-gray-300 text-purple-600 shadow-sm focus:border-purple-300 focus:ring focus:ring-purple-200 focus:ring-opacity-50"
                    disabled={!settings.isEnabled}
                  />
                  <span className="text-sm text-gray-900">年終獎金按比例計算</span>
                </label>
                
                <label className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    checked={settings.festivalBonusProration}
                    onChange={(e) => setSettings({ ...settings, festivalBonusProration: e.target.checked })}
                    className="rounded border-gray-300 text-purple-600 shadow-sm focus:border-purple-300 focus:ring focus:ring-purple-200 focus:ring-opacity-50"
                    disabled={!settings.isEnabled}
                  />
                  <span className="text-sm text-gray-900">節慶獎金按比例計算</span>
                </label>
                
                <label className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    checked={settings.performanceBonusProration}
                    onChange={(e) => setSettings({ ...settings, performanceBonusProration: e.target.checked })}
                    className="rounded border-gray-300 text-purple-600 shadow-sm focus:border-purple-300 focus:ring focus:ring-purple-200 focus:ring-opacity-50"
                    disabled={!settings.isEnabled}
                  />
                  <span className="text-sm text-gray-900">績效獎金按比例計算</span>
                </label>
              </div>
            </div>

            {/* 說明描述 */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                規則說明
              </label>
              <textarea
                value={settings.description}
                onChange={(e) => setSettings({ ...settings, description: e.target.value })}
                rows={3}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 text-gray-900"
                disabled={!settings.isEnabled}
                placeholder="請輸入按比例獎金計算的詳細說明..."
              />
            </div>

            {/* 注意事項 */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-sm font-medium text-yellow-800">重要提醒</h4>
                  <ul className="text-sm text-yellow-700 mt-1 space-y-1">
                    <li>• 按比例計算將影響所有符合條件的員工獎金發放</li>
                    <li>• 建議在年終獎金發放前確認所有參數設定</li>
                    <li>• 離職員工的獎金計算將依照實際服務期間</li>
                    <li>• 修改設定將影響後續的獎金計算，請謹慎操作</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* 操作按鈕 */}
            <div className="flex justify-end space-x-4 pt-4 border-t border-gray-200">
              <button
                onClick={() => router.push('/system-settings')}
                className="px-4 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
              >
                取消
              </button>
              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-purple-600 border border-transparent rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
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
