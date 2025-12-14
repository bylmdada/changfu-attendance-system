'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Save, Edit2, Trash2, Eye, Download, Plus, AlertTriangle, Power, PowerOff } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import SystemNavbar from '@/components/SystemNavbar';

interface PayslipTemplate {
  id?: number;
  name: string;
  description: string;
  isDefault: boolean;
  isActive: boolean;
  headerConfig: {
    companyName: string;
    companyAddress: string;
    showLogo: boolean;
    logoPosition: 'left' | 'center' | 'right';
  };
  employeeSection: {
    showEmployeeId: boolean;
    showDepartment: boolean;
    showPosition: boolean;
    showHireDate: boolean;
    showBankAccount: boolean;
  };
  earningsSection: {
    items: PayslipItem[];
    showSubtotal: boolean;
  };
  deductionsSection: {
    items: PayslipItem[];
    showSubtotal: boolean;
  };
  summarySection: {
    showGrossPay: boolean;
    showTotalDeductions: boolean;
    showNetPay: boolean;
    showYtdTotals: boolean;
  };
  footerConfig: {
    showGeneratedDate: boolean;
    showSignature: boolean;
    customText?: string;
  };
  formatting: {
    fontSize: number;
    fontFamily: string;
    pageSize: 'A4' | 'Letter';
    orientation: 'portrait' | 'landscape';
    margins: {
      top: number;
      bottom: number;
      left: number;
      right: number;
    };
  };
}

interface PayslipItem {
  id: string;
  label: string;
  code: string;
  type: 'earning' | 'deduction';
  isVisible: boolean;
  showAmount: boolean;
  showQuantity: boolean;
  showRate: boolean;
  sortOrder: number;
}

interface PayslipSettings {
  autoGeneration: {
    enabled: boolean;
    scheduleDay: number; // 每月第幾天
    scheduleTime: string; // HH:MM
  };
  distribution: {
    method: 'email' | 'print' | 'both';
    emailSubject: string;
    emailTemplate: string;
  };
  retention: {
    keepMonths: number;
    archiveAfterMonths: number;
  };
  security: {
    passwordProtected: boolean;
    requireEmployeeConsent: boolean;
  };
}

export default function PayslipManagementPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ id: number; username: string; role: string; employee?: { id: number; employeeId: string; name: string; } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<PayslipTemplate[]>([]);
  const [settings, setSettings] = useState<PayslipSettings | null>(null);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PayslipTemplate | null>(null);
  const [activeTab, setActiveTab] = useState<'templates' | 'settings' | 'preview'>('templates');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name: string } | null>(null);

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
          await loadData();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const loadData = async () => {
    try {
      const response = await fetch('/api/system-settings/payslip-management', {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setTemplates(data.templates || []);
        setSettings(data.settings || getDefaultSettings());
      }
    } catch (error) {
      console.error('載入薪資條設定失敗:', error);
    }
  };

  const getDefaultSettings = (): PayslipSettings => ({
    autoGeneration: {
      enabled: false,
      scheduleDay: 25,
      scheduleTime: '17:00'
    },
    distribution: {
      method: 'email',
      emailSubject: '薪資條 - {{month}}月份',
      emailTemplate: '親愛的 {{employeeName}}，\n\n請查收您的 {{month}} 月份薪資條。\n\n謝謝！'
    },
    retention: {
      keepMonths: 36,
      archiveAfterMonths: 12
    },
    security: {
      passwordProtected: true,
      requireEmployeeConsent: false
    }
  });

  const getDefaultTemplate = (): PayslipTemplate => ({
    name: '標準薪資條範本',
    description: '標準格式薪資條',
    isDefault: true,
    isActive: true,
    headerConfig: {
      companyName: '長富股份有限公司',
      companyAddress: '台北市信義區信義路五段7號',
      showLogo: true,
      logoPosition: 'left'
    },
    employeeSection: {
      showEmployeeId: true,
      showDepartment: true,
      showPosition: true,
      showHireDate: true,
      showBankAccount: false
    },
    earningsSection: {
      items: [
        { id: 'base_salary', label: '基本薪資', code: 'BASE_SALARY', type: 'earning', isVisible: true, showAmount: true, showQuantity: false, showRate: false, sortOrder: 1 },
        { id: 'overtime_pay', label: '加班費', code: 'OVERTIME_PAY', type: 'earning', isVisible: true, showAmount: true, showQuantity: true, showRate: true, sortOrder: 2 },
        { id: 'bonus', label: '獎金', code: 'BONUS', type: 'earning', isVisible: true, showAmount: true, showQuantity: false, showRate: false, sortOrder: 3 }
      ],
      showSubtotal: true
    },
    deductionsSection: {
      items: [
        { id: 'labor_insurance', label: '勞工保險', code: 'LABOR_INSURANCE', type: 'deduction', isVisible: true, showAmount: true, showQuantity: false, showRate: false, sortOrder: 1 },
        { id: 'health_insurance', label: '健康保險', code: 'HEALTH_INSURANCE', type: 'deduction', isVisible: true, showAmount: true, showQuantity: false, showRate: false, sortOrder: 2 },
        { id: 'income_tax', label: '所得稅', code: 'INCOME_TAX', type: 'deduction', isVisible: true, showAmount: true, showQuantity: false, showRate: false, sortOrder: 3 }
      ],
      showSubtotal: true
    },
    summarySection: {
      showGrossPay: true,
      showTotalDeductions: true,
      showNetPay: true,
      showYtdTotals: false
    },
    footerConfig: {
      showGeneratedDate: true,
      showSignature: false,
      customText: '此薪資條僅供參考，如有疑問請洽人事部門。'
    },
    formatting: {
      fontSize: 12,
      fontFamily: 'Arial',
      pageSize: 'A4',
      orientation: 'portrait',
      margins: {
        top: 20,
        bottom: 20,
        left: 20,
        right: 20
      }
    }
  });

  const handleSaveTemplate = async (template: PayslipTemplate) => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/payslip-management', {
        method: 'POST',
        body: { type: 'template', data: template }
      });

      if (response.ok) {
        await loadData();
        setShowTemplateForm(false);
        setEditingTemplate(null);
        setMessage({ type: 'success', text: '薪資條範本已儲存成功！' });
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.error || '儲存失敗' });
      }
    } catch (error) {
      console.error('儲存範本失敗:', error);
      setMessage({ type: 'error', text: '儲存失敗，請稍後再試' });
    } finally {
      setSaving(false);
    }
  };

  // 顯示刪除確認對話框
  const showDeleteConfirmDialog = (template: PayslipTemplate) => {
    if (template.id) {
      setDeleteConfirm({ id: template.id, name: template.name });
    }
  };

  // 執行刪除
  const handleDeleteTemplate = async () => {
    if (!deleteConfirm) return;

    try {
      const response = await fetchJSONWithCSRF(`/api/system-settings/payslip-management?id=${deleteConfirm.id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await loadData();
        setMessage({ type: 'success', text: '薪資條範本已刪除' });
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.error || '刪除失敗' });
      }
    } catch (error) {
      console.error('刪除範本失敗:', error);
      setMessage({ type: 'error', text: '刪除失敗，請稍後再試' });
    } finally {
      setDeleteConfirm(null);
    }
  };

  // 切換範本啟用狀態
  const handleToggleActive = async (template: PayslipTemplate) => {
    if (!template.id) return;

    try {
      const updatedTemplate = { ...template, isActive: !template.isActive };
      const response = await fetchJSONWithCSRF('/api/system-settings/payslip-management', {
        method: 'PUT',
        body: { template: updatedTemplate }
      });

      if (response.ok) {
        await loadData();
        setMessage({ 
          type: 'success', 
          text: `範本「${template.name}」已${updatedTemplate.isActive ? '啟用' : '停用'}` 
        });
      } else {
        const errorData = await response.json();
        setMessage({ type: 'error', text: errorData.error || '更新失敗' });
      }
    } catch (error) {
      console.error('更新範本狀態失敗:', error);
      setMessage({ type: 'error', text: '更新失敗，請稍後再試' });
    }
  };

  const startEdit = (template: PayslipTemplate) => {
    setEditingTemplate(template);
    setShowTemplateForm(true);
  };

  const startCreate = () => {
    setEditingTemplate(getDefaultTemplate());
    setShowTemplateForm(true);
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

      {/* 標籤導航 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('templates')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'templates'
                  ? 'border-green-500 text-green-600'
                  : 'border-transparent text-gray-900 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              範本管理
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'settings'
                  ? 'border-green-500 text-green-600'
                  : 'border-transparent text-gray-900 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              系統設定
            </button>
            <button
              onClick={() => setActiveTab('preview')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'preview'
                  ? 'border-green-500 text-green-600'
                  : 'border-transparent text-gray-900 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              預覽範本
            </button>
          </nav>
        </div>
      </div>

      {/* 主要內容 */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 標題區 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <FileText className="w-8 h-8 text-blue-600 mr-3" />
            薪資條管理
          </h1>
          <p className="text-gray-600 mt-2">管理薪資條範本與系統設定</p>
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

        {activeTab === 'templates' && (
          <TemplatesTab 
            templates={templates}
            onEdit={startEdit}
            onCreate={startCreate}
            onDelete={showDeleteConfirmDialog}
            onToggleActive={handleToggleActive}
          />
        )}

        {activeTab === 'settings' && settings && (
          <SettingsTab 
            settings={settings}
            onUpdate={setSettings}
          />
        )}

        {activeTab === 'preview' && (
          <PreviewTab 
            templates={templates}
          />
        )}

        {/* 範本表單 */}
        {showTemplateForm && editingTemplate && (
          <TemplateForm
            template={editingTemplate}
            onSave={handleSaveTemplate}
            onCancel={() => {
              setShowTemplateForm(false);
              setEditingTemplate(null);
            }}
            saving={saving}
          />
        )}

        {/* 刪除確認對話框 */}
        {deleteConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
              <div className="flex items-center text-red-600 mb-4">
                <AlertTriangle className="w-8 h-8 mr-3" />
                <h3 className="text-xl font-semibold">確認刪除</h3>
              </div>
              <p className="text-gray-600 mb-6">
                確定要刪除範本「{deleteConfirm.name}」嗎？此操作無法復原。
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleDeleteTemplate}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center"
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  確認刪除
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// 範本管理標籤
function TemplatesTab({ 
  templates, 
  onEdit,
  onCreate,
  onDelete,
  onToggleActive
}: { 
  templates: PayslipTemplate[];
  onEdit: (template: PayslipTemplate) => void;
  onCreate: () => void;
  onDelete: (template: PayslipTemplate) => void;
  onToggleActive: (template: PayslipTemplate) => void;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-gray-900">薪資條範本</h2>
          <p className="text-sm text-gray-600">管理薪資條格式範本</p>
        </div>
        <button
          onClick={onCreate}
          className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4 mr-2" />
          新增範本
        </button>
      </div>
      
      <div className="divide-y divide-gray-200">
        {templates.map((template) => (
          <div key={template.id} className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-3">
                  <h3 className="text-lg font-medium text-gray-900">{template.name}</h3>
                  {template.isDefault && (
                    <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                      預設範本
                    </span>
                  )}
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    template.isActive 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {template.isActive ? '啟用中' : '已停用'}
                  </span>
                </div>
                <p className="text-sm text-gray-600 mt-1">{template.description}</p>
                
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">收入項目：</span>
                    <span className="font-medium text-gray-900">{template.earningsSection.items.filter(item => item.isVisible).length} 項</span>
                  </div>
                  <div>
                    <span className="text-gray-600">扣除項目：</span>
                    <span className="font-medium text-gray-900">{template.deductionsSection.items.filter(item => item.isVisible).length} 項</span>
                  </div>
                  <div>
                    <span className="text-gray-600">頁面大小：</span>
                    <span className="font-medium text-gray-900">{template.formatting.pageSize}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">字體大小：</span>
                    <span className="font-medium text-gray-900">{template.formatting.fontSize}pt</span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                {/* 啟用/停用按鈕 */}
                <button
                  onClick={() => onToggleActive(template)}
                  className={`p-2 rounded-md transition-colors ${
                    template.isActive 
                      ? 'text-green-600 hover:text-green-900 hover:bg-green-50' 
                      : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                  }`}
                  title={template.isActive ? '點擊停用' : '點擊啟用'}
                >
                  {template.isActive ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => onEdit(template)}
                  className="p-2 text-blue-600 hover:text-blue-900 hover:bg-blue-50 rounded-md"
                  title="編輯"
                >
                  <Edit2 className="h-4 w-4" />
                </button>
                <button
                  className="p-2 text-green-600 hover:text-green-900 hover:bg-green-50 rounded-md"
                  title="預覽"
                >
                  <Eye className="h-4 w-4" />
                </button>
                {!template.isDefault && (
                  <button
                    onClick={() => onDelete(template)}
                    className="p-2 text-red-600 hover:text-red-900 hover:bg-red-50 rounded-md"
                    title="刪除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      
      {templates.length === 0 && (
        <div className="text-center py-12">
          <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">尚未建立任何薪資條範本</p>
          <button
            onClick={onCreate}
            className="mt-4 inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Plus className="w-4 h-4 mr-2" />
            建立第一個範本
          </button>
        </div>
      )}
    </div>
  );
}

// 系統設定標籤
function SettingsTab({ 
  settings, 
  onUpdate 
}: { 
  settings: PayslipSettings;
  onUpdate: (settings: PayslipSettings) => void;
}) {
  return (
    <div className="space-y-8">
      {/* 自動產生設定 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">自動產生設定</h2>
          <p className="text-sm text-gray-900">設定薪資條自動產生排程</p>
        </div>
        
        <div className="p-6 space-y-4">
          <div>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={settings.autoGeneration.enabled}
                onChange={(e) => onUpdate({
                  ...settings,
                  autoGeneration: {
                    ...settings.autoGeneration,
                    enabled: e.target.checked
                  }
                })}
                className="rounded border-gray-300 text-green-600 shadow-sm focus:border-green-300 focus:ring focus:ring-green-200 focus:ring-opacity-50"
              />
              <span className="text-sm text-gray-900">啟用自動產生薪資條</span>
            </label>
          </div>
          
          {settings.autoGeneration.enabled && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  每月產生日期
                </label>
                <select
                  value={settings.autoGeneration.scheduleDay}
                  onChange={(e) => onUpdate({
                    ...settings,
                    autoGeneration: {
                      ...settings.autoGeneration,
                      scheduleDay: parseInt(e.target.value)
                    }
                  })}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 text-gray-900"
                >
                  {Array.from({ length: 28 }, (_, i) => i + 1).map(day => (
                    <option key={day} value={day}>每月 {day} 日</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  產生時間
                </label>
                <input
                  type="time"
                  value={settings.autoGeneration.scheduleTime}
                  onChange={(e) => onUpdate({
                    ...settings,
                    autoGeneration: {
                      ...settings.autoGeneration,
                      scheduleTime: e.target.value
                    }
                  })}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 text-gray-900"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 發送設定 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">發送設定</h2>
          <p className="text-sm text-gray-900">設定薪資條發送方式與內容</p>
        </div>
        
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">
              發送方式
            </label>
            <select
              value={settings.distribution.method}
              onChange={(e) => onUpdate({
                ...settings,
                distribution: {
                  ...settings.distribution,
                  method: e.target.value as 'email' | 'print' | 'both'
                }
              })}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 text-gray-900"
            >
              <option value="email">僅電子郵件</option>
              <option value="print">僅列印</option>
              <option value="both">電子郵件 + 列印</option>
            </select>
          </div>
          
          {(settings.distribution.method === 'email' || settings.distribution.method === 'both') && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  郵件主旨
                </label>
                <input
                  type="text"
                  value={settings.distribution.emailSubject}
                  onChange={(e) => onUpdate({
                    ...settings,
                    distribution: {
                      ...settings.distribution,
                      emailSubject: e.target.value
                    }
                  })}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 text-gray-900"
                  placeholder="可使用 {{month}} 等變數"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  郵件內容
                </label>
                <textarea
                  value={settings.distribution.emailTemplate}
                  onChange={(e) => onUpdate({
                    ...settings,
                    distribution: {
                      ...settings.distribution,
                      emailTemplate: e.target.value
                    }
                  })}
                  rows={4}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 text-gray-900"
                  placeholder="可使用 {{employeeName}}, {{month}} 等變數"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* 保存設定 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">保存設定</h2>
          <p className="text-sm text-gray-900">設定薪資條保存與歸檔規則</p>
        </div>
        
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                保存期限 (月)
              </label>
              <input
                type="number"
                min="12"
                max="120"
                value={settings.retention.keepMonths}
                onChange={(e) => onUpdate({
                  ...settings,
                  retention: {
                    ...settings.retention,
                    keepMonths: parseInt(e.target.value) || 36
                  }
                })}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 text-gray-900"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                歸檔期限 (月)
              </label>
              <input
                type="number"
                min="6"
                max="60"
                value={settings.retention.archiveAfterMonths}
                onChange={(e) => onUpdate({
                  ...settings,
                  retention: {
                    ...settings.retention,
                    archiveAfterMonths: parseInt(e.target.value) || 12
                  }
                })}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 text-gray-900"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 安全設定 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">安全設定</h2>
          <p className="text-sm text-gray-900">設定薪資條安全與隱私相關選項</p>
        </div>
        
        <div className="p-6 space-y-4">
          <div>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={settings.security.passwordProtected}
                onChange={(e) => onUpdate({
                  ...settings,
                  security: {
                    ...settings.security,
                    passwordProtected: e.target.checked
                  }
                })}
                className="rounded border-gray-300 text-green-600 shadow-sm focus:border-green-300 focus:ring focus:ring-green-200 focus:ring-opacity-50"
              />
              <span className="text-sm text-gray-900">PDF 密碼保護</span>
            </label>
          </div>
          
          <div>
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={settings.security.requireEmployeeConsent}
                onChange={(e) => onUpdate({
                  ...settings,
                  security: {
                    ...settings.security,
                    requireEmployeeConsent: e.target.checked
                  }
                })}
                className="rounded border-gray-300 text-green-600 shadow-sm focus:border-green-300 focus:ring focus:ring-green-200 focus:ring-opacity-50"
              />
              <span className="text-sm text-gray-900">需要員工同意接收電子薪資條</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

// 預覽標籤
function PreviewTab({ 
  templates 
}: { 
  templates: PayslipTemplate[];
}) {
  const [selectedTemplate, setSelectedTemplate] = useState<PayslipTemplate | null>(
    templates.find(t => t.isDefault) || templates[0] || null
  );

  if (!selectedTemplate) {
    return (
      <div className="text-center py-12">
        <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
        <p className="text-gray-900">請先建立薪資條範本</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 範本選擇 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-gray-900">選擇預覽範本</h2>
            <p className="text-sm text-gray-900">選擇要預覽的薪資條範本</p>
          </div>
          <div className="flex items-center space-x-4">
            <select
              value={selectedTemplate.id || ''}
              onChange={(e) => {
                const template = templates.find(t => t.id === parseInt(e.target.value));
                if (template) setSelectedTemplate(template);
              }}
              className="rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 text-gray-900"
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <button className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700">
              <Download className="h-4 w-4" />
              <span>下載 PDF</span>
            </button>
          </div>
        </div>
      </div>

      {/* 薪資條預覽 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <PayslipPreview template={selectedTemplate} />
      </div>
    </div>
  );
}

// 薪資條預覽組件
function PayslipPreview({ template }: { template: PayslipTemplate }) {
  // 模擬資料
  const mockData = {
    employee: {
      id: 'EMP001',
      name: '王小明',
      department: '資訊部',
      position: '軟體工程師',
      hireDate: '2023-01-15',
      bankAccount: '1234-567-890123'
    },
    payroll: {
      year: 2024,
      month: 9,
      baseSalary: 45000,
      overtimePay: 3500,
      bonus: 5000,
      laborInsurance: 850,
      healthInsurance: 649,
      incomeTax: 2100,
      grossPay: 53500,
      totalDeductions: 3599,
      netPay: 49901
    }
  };

  return (
    <div className="p-8 bg-white" style={{ fontFamily: template.formatting.fontFamily, fontSize: `${template.formatting.fontSize}px` }}>
      {/* 標題區塊 */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold mb-2">{template.headerConfig.companyName}</h1>
        <p className="text-sm text-gray-600 mb-2">{template.headerConfig.companyAddress}</p>
        <h2 className="text-xl font-semibold">薪資條</h2>
        <p className="text-sm text-gray-600">{mockData.payroll.year} 年 {mockData.payroll.month} 月份</p>
      </div>

      {/* 員工資訊 */}
      <div className="mb-6 border border-gray-300 rounded">
        <div className="bg-gray-50 px-4 py-2 border-b border-gray-300">
          <h3 className="font-semibold">員工資訊</h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-4">
          {template.employeeSection.showEmployeeId && (
            <div>
              <span className="text-gray-600">員工編號：</span>
              <span>{mockData.employee.id}</span>
            </div>
          )}
          <div>
            <span className="text-gray-600">姓名：</span>
            <span>{mockData.employee.name}</span>
          </div>
          {template.employeeSection.showDepartment && (
            <div>
              <span className="text-gray-600">部門：</span>
              <span>{mockData.employee.department}</span>
            </div>
          )}
          {template.employeeSection.showPosition && (
            <div>
              <span className="text-gray-600">職位：</span>
              <span>{mockData.employee.position}</span>
            </div>
          )}
          {template.employeeSection.showHireDate && (
            <div>
              <span className="text-gray-600">到職日：</span>
              <span>{mockData.employee.hireDate}</span>
            </div>
          )}
          {template.employeeSection.showBankAccount && (
            <div>
              <span className="text-gray-600">銀行帳號：</span>
              <span>{mockData.employee.bankAccount}</span>
            </div>
          )}
        </div>
      </div>

      {/* 薪資明細 */}
      <div className="mb-6">
        <div className="grid grid-cols-2 gap-6">
          {/* 收入項目 */}
          <div className="border border-gray-300 rounded">
            <div className="bg-green-50 px-4 py-2 border-b border-gray-300">
              <h3 className="font-semibold text-green-800">收入項目</h3>
            </div>
            <div className="p-4">
              {template.earningsSection.items.filter(item => item.isVisible).map(item => (
                <div key={item.id} className="flex justify-between py-1">
                  <span>{item.label}：</span>
                  <span>NT$ {getItemAmount(item.code, mockData).toLocaleString()}</span>
                </div>
              ))}
              {template.earningsSection.showSubtotal && (
                <div className="border-t border-gray-300 mt-2 pt-2 flex justify-between font-semibold">
                  <span>收入小計：</span>
                  <span>NT$ {mockData.payroll.grossPay.toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>

          {/* 扣除項目 */}
          <div className="border border-gray-300 rounded">
            <div className="bg-red-50 px-4 py-2 border-b border-gray-300">
              <h3 className="font-semibold text-red-800">扣除項目</h3>
            </div>
            <div className="p-4">
              {template.deductionsSection.items.filter(item => item.isVisible).map(item => (
                <div key={item.id} className="flex justify-between py-1">
                  <span>{item.label}：</span>
                  <span>NT$ {getItemAmount(item.code, mockData).toLocaleString()}</span>
                </div>
              ))}
              {template.deductionsSection.showSubtotal && (
                <div className="border-t border-gray-300 mt-2 pt-2 flex justify-between font-semibold">
                  <span>扣除小計：</span>
                  <span>NT$ {mockData.payroll.totalDeductions.toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 薪資總計 */}
      {template.summarySection.showNetPay && (
        <div className="mb-6 border border-gray-300 rounded">
          <div className="bg-blue-50 px-4 py-2 border-b border-gray-300">
            <h3 className="font-semibold text-blue-800">薪資總計</h3>
          </div>
          <div className="p-4">
            {template.summarySection.showGrossPay && (
              <div className="flex justify-between py-1">
                <span>總收入：</span>
                <span>NT$ {mockData.payroll.grossPay.toLocaleString()}</span>
              </div>
            )}
            {template.summarySection.showTotalDeductions && (
              <div className="flex justify-between py-1">
                <span>總扣除：</span>
                <span>NT$ {mockData.payroll.totalDeductions.toLocaleString()}</span>
              </div>
            )}
            <div className="border-t border-gray-300 mt-2 pt-2 flex justify-between font-bold text-lg">
              <span>實發薪資：</span>
              <span>NT$ {mockData.payroll.netPay.toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* 頁尾 */}
      <div className="mt-8 text-center text-sm text-gray-600">
        {template.footerConfig.showGeneratedDate && (
          <p>產生日期：{new Date().toLocaleDateString()}</p>
        )}
        {template.footerConfig.customText && (
          <p className="mt-2">{template.footerConfig.customText}</p>
        )}
      </div>
    </div>
  );
}

// 取得項目金額的輔助函數
function getItemAmount(code: string, mockData: { payroll: { baseSalary: number; overtimePay: number; bonus: number; laborInsurance: number; healthInsurance: number; incomeTax: number } }): number {
  const amountMap: { [key: string]: number } = {
    'BASE_SALARY': mockData.payroll.baseSalary,
    'OVERTIME_PAY': mockData.payroll.overtimePay,
    'BONUS': mockData.payroll.bonus,
    'LABOR_INSURANCE': mockData.payroll.laborInsurance,
    'HEALTH_INSURANCE': mockData.payroll.healthInsurance,
    'INCOME_TAX': mockData.payroll.incomeTax
  };
  return amountMap[code] || 0;
}

// 範本表單組件
function TemplateForm({ 
  template, 
  onSave, 
  onCancel, 
  saving 
}: { 
  template: PayslipTemplate;
  onSave: (template: PayslipTemplate) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [formData, setFormData] = useState<PayslipTemplate>(template);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">
            {template.id ? '編輯薪資條範本' : '新增薪資條範本'}
          </h3>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* 基本資訊 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                範本名稱 *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 text-gray-900"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                描述
              </label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 text-gray-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.isDefault}
                  onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                  className="rounded border-gray-300 text-green-600 shadow-sm focus:border-green-300 focus:ring focus:ring-green-200 focus:ring-opacity-50"
                />
                <span className="text-sm text-gray-900">設為預設範本</span>
              </label>
            </div>
            
            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="rounded border-gray-300 text-green-600 shadow-sm focus:border-green-300 focus:ring focus:ring-green-200 focus:ring-opacity-50"
                />
                <span className="text-sm text-gray-900">啟用此範本</span>
              </label>
            </div>
          </div>

          {/* 公司資訊設定 */}
          <div className="border border-gray-200 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-4">公司資訊設定</h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  公司名稱
                </label>
                <input
                  type="text"
                  value={formData.headerConfig.companyName}
                  onChange={(e) => setFormData({
                    ...formData,
                    headerConfig: {
                      ...formData.headerConfig,
                      companyName: e.target.value
                    }
                  })}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 text-gray-900"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  公司地址
                </label>
                <input
                  type="text"
                  value={formData.headerConfig.companyAddress}
                  onChange={(e) => setFormData({
                    ...formData,
                    headerConfig: {
                      ...formData.headerConfig,
                      companyAddress: e.target.value
                    }
                  })}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-green-500 focus:ring-green-500 text-gray-900"
                />
              </div>
            </div>
          </div>

          {/* 操作按鈕 */}
          <div className="flex justify-end space-x-4 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
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
