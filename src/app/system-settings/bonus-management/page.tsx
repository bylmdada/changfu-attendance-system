'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Gift, Save, Edit2, Trash2 } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import SystemNavbar from '@/components/SystemNavbar';

interface BonusType {
  id?: number;
  bonusType: string;
  bonusTypeName: string;
  description?: string;
  isActive: boolean;
  defaultAmount?: number;
  calculationFormula?: string;
  eligibilityRules?: {
    minimumServiceMonths?: number;
    requireActiveStatus?: boolean;
    excludeProbation?: boolean;
  };
  paymentSchedule?: {
    paymentMonth?: number;
    paymentDay?: number;
    isYearEnd?: boolean;
  };
}

export default function BonusManagementPage() {
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
  const [bonusTypes, setBonusTypes] = useState<BonusType[]>([]);
  const [editingBonus, setEditingBonus] = useState<BonusType | null>(null);
  const [showForm, setShowForm] = useState(false);
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
          await loadBonusTypes();
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

  const loadBonusTypes = async () => {
    try {
      const response = await fetch('/api/system-settings/bonus-management', {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setBonusTypes(data.bonusTypes || []);
      }
    } catch (error) {
      console.error('載入獎金類型失敗:', error);
    }
  };

  const handleSaveBonus = async (bonus: BonusType) => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/bonus-management', {
        method: 'POST',
        body: bonus
      });

      if (response.ok) {
        await loadBonusTypes();
        setShowForm(false);
        setEditingBonus(null);
        setMessage({ type: 'success', text: '獎金類型已儲存成功！' });
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.error || '儲存失敗' });
      }
    } catch (error) {
      console.error('儲存獎金類型失敗:', error);
      setMessage({ type: 'error', text: '儲存失敗，請稍後再試' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteBonus = async (id: number) => {
    if (!confirm('確定要刪除此獎金類型嗎？此操作無法復原。')) {
      return;
    }

    try {
      const response = await fetchJSONWithCSRF(`/api/system-settings/bonus-management?id=${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await loadBonusTypes();
        setMessage({ type: 'success', text: '獎金類型已刪除' });
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.error || '刪除失敗' });
      }
    } catch (error) {
      console.error('刪除獎金類型失敗:', error);
      setMessage({ type: 'error', text: '刪除失敗，請稍後再試' });
    }
  };

  const startEdit = (bonus: BonusType) => {
    setEditingBonus(bonus);
    setShowForm(true);
  };

  const startCreate = () => {
    setEditingBonus({
      bonusType: '',
      bonusTypeName: '',
      description: '',
      isActive: true,
      defaultAmount: 0,
      calculationFormula: '',
      eligibilityRules: {
        minimumServiceMonths: 3,
        requireActiveStatus: true,
        excludeProbation: true
      },
      paymentSchedule: {
        paymentMonth: 12,
        paymentDay: 25,
        isYearEnd: false
      }
    });
    setShowForm(true);
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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 標題區 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <Gift className="w-8 h-8 text-blue-600 mr-3" />
            獎金類型管理
          </h1>
          <p className="text-gray-600 mt-2">設定各類獎金項目與計算規則</p>
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

        {/* 獎金類型列表 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">獎金類型設定</h2>
          </div>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    獎金類型
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    預設金額
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    發放時間
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    狀態
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {bonusTypes.map((bonus) => (
                  <tr key={bonus.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">
                          {bonus.bonusTypeName}
                        </div>
                        <div className="text-sm text-gray-900">
                          {bonus.description}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-gray-900">
                        {bonus.defaultAmount ? `NT$ ${bonus.defaultAmount.toLocaleString()}` : '依計算公式'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-gray-900">
                        {bonus.paymentSchedule?.paymentMonth}月{bonus.paymentSchedule?.paymentDay}日
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        bonus.isActive 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {bonus.isActive ? '啟用' : '停用'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                      <button
                        onClick={() => startEdit(bonus)}
                        className="text-blue-600 hover:text-blue-900 p-1"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => bonus.id && handleDeleteBonus(bonus.id)}
                        className="text-red-600 hover:text-red-900 p-1"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            {bonusTypes.length === 0 && (
              <div className="text-center py-12">
                <Gift className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-900">尚未設定任何獎金類型</p>
                <button
                  onClick={startCreate}
                  className="mt-4 text-purple-600 hover:text-purple-800"
                >
                  立即新增第一個獎金類型
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 獎金類型表單 */}
        {showForm && editingBonus && (
          <BonusForm
            bonus={editingBonus}
            onSave={handleSaveBonus}
            onCancel={() => {
              setShowForm(false);
              setEditingBonus(null);
            }}
            saving={saving}
          />
        )}
      </main>
    </div>
  );
}

// 獎金表單組件
function BonusForm({ 
  bonus, 
  onSave, 
  onCancel, 
  saving 
}: { 
  bonus: BonusType;
  onSave: (bonus: BonusType) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [formData, setFormData] = useState<BonusType>(bonus);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  const updateEligibilityRules = (field: string, value: boolean | number) => {
    setFormData({
      ...formData,
      eligibilityRules: {
        ...formData.eligibilityRules,
        [field]: value
      }
    });
  };

  const updatePaymentSchedule = (field: string, value: boolean | number) => {
    setFormData({
      ...formData,
      paymentSchedule: {
        ...formData.paymentSchedule,
        [field]: value
      }
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">
            {bonus.id ? '編輯獎金類型' : '新增獎金類型'}
          </h3>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* 基本資訊 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                獎金代碼 *
              </label>
              <input
                type="text"
                required
                value={formData.bonusType}
                onChange={(e) => setFormData({ ...formData, bonusType: e.target.value })}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                placeholder="例：YEAR_END"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                獎金名稱 *
              </label>
              <input
                type="text"
                required
                value={formData.bonusTypeName}
                onChange={(e) => setFormData({ ...formData, bonusTypeName: e.target.value })}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                placeholder="例：年終獎金"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">
              說明
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
              placeholder="請輸入獎金說明..."
            />
          </div>

          {/* 計算設定 */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="text-sm font-medium text-blue-900 mb-3">計算設定</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  預設金額
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.defaultAmount || ''}
                  onChange={(e) => setFormData({ ...formData, defaultAmount: parseFloat(e.target.value) || 0 })}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                  placeholder="固定金額（可選）"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  計算公式
                </label>
                <input
                  type="text"
                  value={formData.calculationFormula}
                  onChange={(e) => setFormData({ ...formData, calculationFormula: e.target.value })}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                  placeholder="例：baseSalary * 1.5"
                />
              </div>
            </div>
          </div>

          {/* 資格規則 */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <h4 className="text-sm font-medium text-green-900 mb-3">發放資格</h4>
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    最低服務月數
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formData.eligibilityRules?.minimumServiceMonths || ''}
                    onChange={(e) => updateEligibilityRules('minimumServiceMonths', parseInt(e.target.value) || 0)}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.eligibilityRules?.requireActiveStatus || false}
                    onChange={(e) => updateEligibilityRules('requireActiveStatus', e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                  />
                  <span className="text-sm text-gray-900">需為在職狀態</span>
                </label>
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.eligibilityRules?.excludeProbation || false}
                    onChange={(e) => updateEligibilityRules('excludeProbation', e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                  />
                  <span className="text-sm text-gray-900">排除試用期員工</span>
                </label>
              </div>
            </div>
          </div>

          {/* 發放時程 */}
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <h4 className="text-sm font-medium text-purple-900 mb-3">發放時程</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  發放月份
                </label>
                <select
                  value={formData.paymentSchedule?.paymentMonth || ''}
                  onChange={(e) => updatePaymentSchedule('paymentMonth', parseInt(e.target.value))}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                    <option key={month} value={month}>{month}月</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  發放日期
                </label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={formData.paymentSchedule?.paymentDay || ''}
                  onChange={(e) => updatePaymentSchedule('paymentDay', parseInt(e.target.value))}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-gray-900"
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.paymentSchedule?.isYearEnd || false}
                    onChange={(e) => updatePaymentSchedule('isYearEnd', e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                  />
                  <span className="text-sm text-gray-900">年終獎金</span>
                </label>
              </div>
            </div>
          </div>

          {/* 啟用狀態 */}
          <div>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
              />
              <span className="text-sm font-medium text-gray-900">啟用此獎金類型</span>
            </label>
          </div>

          {/* 操作按鈕 */}
          <div className="flex justify-end space-x-4 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-purple-600 border border-transparent rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  <span>儲存中...</span>
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  <span>儲存</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
