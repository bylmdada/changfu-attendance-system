'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Calculator, Info, Save, Loader2 } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import {
  buildAuthMeRequest,
  buildHealthInsuranceFormulaRequest,
} from '@/lib/health-insurance-formula-client';
import SystemNavbar from '@/components/SystemNavbar';

interface HealthInsuranceConfig {
  id: number;
  premiumRate: number;
  employeeContributionRatio: number;
  maxDependents: number;
  supplementaryRate: number;
  supplementaryThreshold: number;
  effectiveDate: string;
  isActive: boolean;
}

interface SalaryLevel {
  id?: number;
  level: number;
  minSalary: number;
  maxSalary: number;
  insuredAmount: number;
}

export default function HealthInsuranceFormulaPage() {
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
  const [config, setConfig] = useState<HealthInsuranceConfig | null>(null);
  const [salaryLevels, setSalaryLevels] = useState<SalaryLevel[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const { url, options } = buildAuthMeRequest(window.location.origin);
        const response = await fetch(url, options);
        
        if (response.ok) {
          const userData = await response.json();
          const currentUser = userData.user || userData;
          
          if (currentUser.role !== 'ADMIN') {
            router.push('/dashboard');
            return;
          }
          setUser(currentUser);
          await loadConfig();
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

  const loadConfig = async () => {
    try {
      const { url, options } = buildHealthInsuranceFormulaRequest(window.location.origin);
      const response = await fetch(url, options);
      
      if (response.ok) {
        const data = await response.json();
        setConfig(data.config);
        setSalaryLevels(data.salaryLevels || []);
      }
    } catch (error) {
      console.error('載入配置失敗:', error);
    }
  };

  // 儲存設定
  const handleSaveConfig = async () => {
    if (!config) return;

    setSaving(true);
    setMessage(null);

    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/health-insurance-formula', {
        method: 'POST',
        body: { config, salaryLevels }
      });

      if (response.ok) {
        await loadConfig();
        setMessage({ type: 'success', text: '健保費率設定已儲存成功！' });
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.error || '儲存失敗' });
      }
    } catch (error) {
      console.error('儲存配置失敗:', error);
      setMessage({ type: 'error', text: '儲存失敗，請稍後再試' });
    } finally {
      setSaving(false);
    }
  };

  const addSalaryLevel = () => {
    const lastLevel = salaryLevels[salaryLevels.length - 1];
    const newLevel: SalaryLevel = {
      level: salaryLevels.length + 1,
      minSalary: lastLevel ? lastLevel.maxSalary + 1 : 0,
      maxSalary: lastLevel ? lastLevel.maxSalary + 1000 : 1000,
      insuredAmount: lastLevel ? lastLevel.insuredAmount + 100 : 100
    };
    setSalaryLevels([...salaryLevels, newLevel]);
  };

  const updateSalaryLevel = (index: number, field: keyof SalaryLevel, value: number) => {
    const updated = [...salaryLevels];
    updated[index] = { ...updated[index], [field]: value };
    setSalaryLevels(updated);
  };

  const removeSalaryLevel = (index: number) => {
    const updated = salaryLevels.filter((_, i) => i !== index);
    // 重新排序 level
    updated.forEach((level, i) => {
      level.level = i + 1;
    });
    setSalaryLevels(updated);
  };

  // 計算示例
  const calculateExample = (salary: number, dependents: number) => {
    if (!config) return null;

    // 找到對應的投保金額
    const salaryLevel = salaryLevels.find(level => 
      salary >= level.minSalary && salary <= level.maxSalary
    );
    
    if (!salaryLevel) return null;

    const insuredAmount = salaryLevel.insuredAmount;
    const dependentCount = Math.min(dependents, config.maxDependents);
    
    // 計算健保費
    const totalInsuredAmount = insuredAmount * (1 + dependentCount);
    const totalPremium = totalInsuredAmount * config.premiumRate;
    const employeePremium = totalPremium * config.employeeContributionRatio;
    const companyPremium = totalPremium * (1 - config.employeeContributionRatio);

    return {
      insuredAmount,
      dependentCount,
      totalInsuredAmount,
      totalPremium,
      employeePremium,
      companyPremium
    };
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center">
              <Calculator className="w-8 h-8 text-blue-600 mr-3" />
              健保費率設定
            </h1>
            <p className="text-gray-600 mt-2">設定健保費率與投保金額級距</p>
          </div>
          <button
            onClick={handleSaveConfig}
            disabled={saving || !config}
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* 基本設定 */}
          <div className="lg:col-span-2 space-y-8">
            {/* 健保費率設定 */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-lg font-medium text-gray-900">健保費率設定</h2>
                <p className="text-sm text-gray-900">設定健保費計算基本參數</p>
              </div>
              
              {config && (
                <div className="p-6 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-2">
                        健保費率 (%)
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        max="0.1"
                        value={config.premiumRate}
                        onChange={(e) => setConfig({
                          ...config,
                          premiumRate: parseFloat(e.target.value) || 0
                        })}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-gray-900"
                      />
                      <p className="mt-1 text-xs text-gray-900">
                        目前費率：5.17%
                      </p>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-2">
                        員工負擔比例 (%)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="1"
                        value={config.employeeContributionRatio}
                        onChange={(e) => setConfig({
                          ...config,
                          employeeContributionRatio: parseFloat(e.target.value) || 0
                        })}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-gray-900"
                      />
                      <p className="mt-1 text-xs text-gray-900">
                        員工負擔 30%，公司負擔 70%
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-2">
                        最大眷屬人數
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={config.maxDependents}
                        onChange={(e) => setConfig({
                          ...config,
                          maxDependents: parseInt(e.target.value) || 0
                        })}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-gray-900"
                      />
                      <p className="mt-1 text-xs text-gray-900">
                        超過此數量的眷屬不另收費
                      </p>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-2">
                        生效日期
                      </label>
                      <input
                        type="date"
                        value={config.effectiveDate}
                        onChange={(e) => setConfig({
                          ...config,
                          effectiveDate: e.target.value
                        })}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-gray-900"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-2">
                        補充保費費率 (%)
                      </label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        max="0.1"
                        value={config.supplementaryRate}
                        onChange={(e) => setConfig({
                          ...config,
                          supplementaryRate: parseFloat(e.target.value) || 0
                        })}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-gray-900"
                      />
                      <p className="mt-1 text-xs text-gray-900">
                        目前費率：2.11%
                      </p>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-2">
                        補充保費免扣門檻倍數
                      </label>
                        <input
                          type="number"
                          min="1"
                          max="10"
                          value={config.supplementaryThreshold}
                          onChange={(e) => setConfig({
                            ...config,
                            supplementaryThreshold: parseFloat(e.target.value) || 1
                          })}
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-gray-900"
                        />
                        <p className="mt-1 text-xs text-gray-900">
                          目前設定為投保金額的 {config.supplementaryThreshold} 倍
                        </p>
                      </div>
                    </div>
                </div>
              )}
            </div>

            {/* 投保金額級距設定 */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-medium text-gray-900">投保金額級距設定</h2>
                  <p className="text-sm text-gray-900">設定薪資與投保金額對應表</p>
                </div>
                <button
                  onClick={addSalaryLevel}
                  className="px-4 py-2 text-sm bg-red-100 text-red-700 rounded-md hover:bg-red-200"
                >
                  新增級距
                </button>
              </div>
              
              <div className="p-6">
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-900 uppercase">級距</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-900 uppercase">薪資下限</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-900 uppercase">薪資上限</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-900 uppercase">投保金額</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-900 uppercase">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {salaryLevels.map((level, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-4 py-2 text-sm text-gray-900">{level.level}</td>
                          <td className="px-4 py-2">
                            <input
                              type="number"
                              value={level.minSalary}
                              onChange={(e) => updateSalaryLevel(index, 'minSalary', parseInt(e.target.value) || 0)}
                              className="w-full text-sm border-gray-300 rounded focus:border-red-500 focus:ring-red-500 text-gray-900"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <input
                              type="number"
                              value={level.maxSalary}
                              onChange={(e) => updateSalaryLevel(index, 'maxSalary', parseInt(e.target.value) || 0)}
                              className="w-full text-sm border-gray-300 rounded focus:border-red-500 focus:ring-red-500 text-gray-900"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <input
                              type="number"
                              value={level.insuredAmount}
                              onChange={(e) => updateSalaryLevel(index, 'insuredAmount', parseInt(e.target.value) || 0)}
                              className="w-full text-sm border-gray-300 rounded focus:border-red-500 focus:ring-red-500 text-gray-900"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <button
                              onClick={() => removeSalaryLevel(index)}
                              className="text-red-600 hover:text-red-900 text-sm"
                            >
                              刪除
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                {salaryLevels.length === 0 && (
                  <div className="text-center py-8 text-gray-900">
                    <Calculator className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p>尚未設定投保金額級距</p>
                    <button
                      onClick={addSalaryLevel}
                      className="mt-2 text-red-600 hover:text-red-700"
                    >
                      點擊新增第一個級距
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 計算示例 */}
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-medium text-gray-900">計算示例</h3>
                <p className="text-sm text-gray-900">驗證設定的正確性</p>
              </div>
              
              <div className="p-6 space-y-4">
                <CalculationExample 
                  salary={50000} 
                  dependents={2} 
                  calculate={calculateExample}
                  title="示例1：薪資50,000，眷屬2人"
                />
                <CalculationExample 
                  salary={30000} 
                  dependents={1} 
                  calculate={calculateExample}
                  title="示例2：薪資30,000，眷屬1人"
                />
                <CalculationExample 
                  salary={80000} 
                  dependents={0} 
                  calculate={calculateExample}
                  title="示例3：薪資80,000，無眷屬"
                />
              </div>
            </div>

            {/* 法規說明 */}
            <div className="bg-blue-50 rounded-lg border border-blue-200">
              <div className="px-6 py-4 border-b border-blue-200">
                <div className="flex items-center space-x-2">
                  <Info className="h-5 w-5 text-blue-600" />
                  <h3 className="text-lg font-medium text-blue-900">法規說明</h3>
                </div>
              </div>
              
              <div className="p-6 space-y-4 text-sm text-blue-800">
                <div>
                  <h4 className="font-medium mb-2">健保費計算規則：</h4>
                  <ul className="space-y-1 text-xs">
                    <li>• 健保費率：5.17%</li>
                    <li>• 員工負擔：30%</li>
                    <li>• 公司負擔：70%</li>
                    <li>• 眷屬人數上限：3人</li>
                  </ul>
                </div>
                
                <div>
                  <h4 className="font-medium mb-2">補充保費規則：</h4>
                  <ul className="space-y-1 text-xs">
                    <li>• 補充保費費率：2.11%</li>
                    <li>• 免扣門檻：投保金額×4倍</li>
                    <li>• 單次給付上限：1,000萬元</li>
                    <li>• 年度累計上限：投保金額×10倍</li>
                  </ul>
                </div>
                
                <div>
                  <h4 className="font-medium mb-2">注意事項：</h4>
                  <ul className="space-y-1 text-xs">
                    <li>• 投保金額級距需連續且不重複</li>
                    <li>• 設定變更需經主管機關核准</li>
                    <li>• 建議定期檢視法規更新</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// 計算示例組件
function CalculationExample({
  salary,
  dependents,
  calculate,
  title
}: {
  salary: number;
  dependents: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  calculate: (salary: number, dependents: number) => any;
  title: string;
}) {
  const result = calculate(salary, dependents);

  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <h4 className="font-medium text-gray-900 mb-3">{title}</h4>
      
      {result ? (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-900">投保金額：</span>
            <span className="font-medium text-gray-900">NT$ {result.insuredAmount.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-900">眷屬人數：</span>
            <span className="font-medium text-gray-900">{result.dependentCount} 人</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-900">總投保金額：</span>
            <span className="font-medium text-gray-900">NT$ {result.totalInsuredAmount.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-900">總健保費：</span>
            <span className="font-medium text-gray-900">NT$ {result.totalPremium.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-900">員工負擔：</span>
            <span className="font-bold text-red-700">NT$ {result.employeePremium.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-900">公司負擔：</span>
            <span className="font-bold text-green-700">NT$ {result.companyPremium.toLocaleString()}</span>
          </div>
        </div>
      ) : (
        <div className="text-sm text-gray-900">
          找不到對應的投保金額級距
        </div>
      )}
    </div>
  );
}
