'use client';

import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Settings, X } from 'lucide-react';
import { fetchJSONWithCSRF, fetchWithCSRF } from '@/lib/fetchWithCSRF';

interface PayrollItemConfig {
  id: number;
  code: string;
  name: string;
  type: 'EARNING' | 'DEDUCTION';
  category: string;
  isActive: boolean;
  sortOrder: number;
  description?: string;
}

export default function PayrollConfigPage() {
  const [configs, setConfigs] = useState<PayrollItemConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingConfig, setEditingConfig] = useState<PayrollItemConfig | null>(null);
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    type: 'EARNING' as 'EARNING' | 'DEDUCTION',
    category: 'SALARY',
    sortOrder: 0,
    description: ''
  });

  useEffect(() => {
    fetchConfigs();
  }, []);

  const fetchConfigs = async () => {
    try {
      const response = await fetchWithCSRF('/api/payroll/config');
      if (response.ok) {
        const data = await response.json();
        setConfigs(data.configs || data.data?.configs || []);
      }
    } catch (error) {
      console.error('獲取配置失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const url = editingConfig
        ? `/api/payroll/config/${editingConfig.id}`
        : '/api/payroll/config';

      const method = editingConfig ? 'PUT' : 'POST';

      const response = await fetchJSONWithCSRF(url, {
        method,
        body: formData
      });

      if (response.ok) {
        await fetchConfigs();
        setShowForm(false);
        setEditingConfig(null);
        resetForm();
      } else {
        const errorData = await response.json().catch(() => null);
        console.error('保存配置失敗:', errorData?.error || response.statusText);
      }
    } catch (error) {
      console.error('保存配置失敗:', error);
    }
  };

  const handleEdit = (config: PayrollItemConfig) => {
    setEditingConfig(config);
    setFormData({
      code: config.code,
      name: config.name,
      type: config.type,
      category: config.category,
      sortOrder: config.sortOrder,
      description: config.description || ''
    });
    setShowForm(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm('確定要停用此配置嗎？')) return;

    try {
      const response = await fetchJSONWithCSRF(`/api/payroll/config/${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await fetchConfigs();
      } else {
        const errorData = await response.json().catch(() => null);
        console.error('刪除配置失敗:', errorData?.error || response.statusText);
      }
    } catch (error) {
      console.error('刪除配置失敗:', error);
    }
  };

  const resetForm = () => {
    setFormData({
      code: '',
      name: '',
      type: 'EARNING',
      category: 'SALARY',
      sortOrder: 0,
      description: ''
    });
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      'SALARY': 'bg-blue-100 text-blue-800',
      'ALLOWANCE': 'bg-green-100 text-green-800',
      'INSURANCE': 'bg-purple-100 text-purple-800',
      'TAX': 'bg-red-100 text-red-800',
      'PENSION': 'bg-yellow-100 text-yellow-800',
      'DEDUCTION': 'bg-gray-100 text-gray-800'
    };
    return colors[category] || 'bg-gray-100 text-gray-800';
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto p-6">
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Settings className="h-8 w-8 text-blue-600" />
              <h1 className="text-3xl font-bold text-gray-900">薪資項目配置</h1>
            </div>
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              新增項目
            </button>
          </div>
        </div>

        {/* 配置列表 */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  項目代碼
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  項目名稱
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  類型
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  分類
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  排序
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {configs.map((config) => (
                <tr key={config.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {config.code}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {config.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      config.type === 'EARNING'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {config.type === 'EARNING' ? '收入' : '扣除'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getCategoryColor(config.category)}`}>
                      {config.category}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {config.sortOrder}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(config)}
                        className="text-blue-600 hover:text-blue-900"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(config.id)}
                        className="text-red-600 hover:text-red-900"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 新增/編輯表單 */}
        {showForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg max-w-md w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  {editingConfig ? '編輯薪資項目' : '新增薪資項目'}
                </h3>
                <button
                  onClick={() => {
                    setShowForm(false);
                    setEditingConfig(null);
                    resetForm();
                  }}
                  className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    項目代碼 *
                  </label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                    disabled={!!editingConfig}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    項目名稱 *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    類型 *
                  </label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as 'EARNING' | 'DEDUCTION' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="EARNING">收入</option>
                    <option value="DEDUCTION">扣除</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    分類 *
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="SALARY">薪資</option>
                    <option value="ALLOWANCE">津貼</option>
                    <option value="INSURANCE">保險</option>
                    <option value="TAX">稅務</option>
                    <option value="PENSION">退休金</option>
                    <option value="DEDUCTION">其他扣除</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    排序順序
                  </label>
                  <input
                    type="number"
                    value={formData.sortOrder}
                    onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    min="0"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    描述
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={3}
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="submit"
                    className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors"
                  >
                    {editingConfig ? '更新' : '新增'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForm(false);
                      setEditingConfig(null);
                      resetForm();
                    }}
                    className="flex-1 bg-gray-300 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-400 transition-colors"
                  >
                    取消
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
