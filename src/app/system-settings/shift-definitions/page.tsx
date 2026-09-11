'use client';

import { useCallback, useEffect, useState } from 'react';
import { Clock, Edit2, Loader2, Plus, Save, X } from 'lucide-react';
import SystemNavbar from '@/components/SystemNavbar';
import ConfirmDialog from '@/components/ConfirmDialog';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import { calculateNetWorkHours, formatShiftHourSummary, type ShiftDefinitionDTO } from '@/lib/shift-definition-utils';

interface User {
  id: number;
  username: string;
  role: string;
  employee?: {
    id: number;
    employeeId: string;
    name: string;
    department: string;
    position: string;
  };
}

interface ShiftForm {
  id?: number;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  breakTime: number;
  workHours: number;
  specialLeaveHours: number;
  compLeaveHours: number;
  overtimeHours: number;
  requiresTime: boolean;
  isActive: boolean;
  sortOrder: number;
  description: string;
}

const EMPTY_FORM: ShiftForm = {
  code: '',
  name: '',
  startTime: '08:00',
  endTime: '17:00',
  breakTime: 60,
  workHours: 8,
  specialLeaveHours: 0,
  compLeaveHours: 0,
  overtimeHours: 0,
  requiresTime: true,
  isActive: true,
  sortOrder: 0,
  description: '',
};

export default function ShiftDefinitionsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [shifts, setShifts] = useState<ShiftDefinitionDTO[]>([]);
  const [showInactive, setShowInactive] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingShift, setEditingShift] = useState<ShiftDefinitionDTO | null>(null);
  const [form, setForm] = useState<ShiftForm>(EMPTY_FORM);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<ShiftDefinitionDTO | null>(null);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const loadShifts = useCallback(async () => {
    try {
      const response = await fetch(`/api/system-settings/shift-definitions?includeInactive=${showInactive}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        showMessage('error', payload?.error || '載入班別失敗');
        return;
      }

      const payload = await response.json();
      setShifts(payload.shifts || []);
    } catch (error) {
      console.error('載入班別失敗:', error);
      showMessage('error', '載入班別失敗');
    }
  }, [showInactive]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api/auth/me', { credentials: 'include' });
        if (!response.ok) {
          window.location.href = '/login';
          return;
        }

        const userData = await response.json();
        const currentUser = userData.user || userData;
        if (currentUser.role !== 'ADMIN') {
          window.location.href = '/dashboard';
          return;
        }

        setUser(currentUser);
        await loadShifts();
      } catch (error) {
        console.error('載入班別設定頁失敗:', error);
        window.location.href = '/login';
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [loadShifts]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingShift(null);
    setShowForm(false);
  };

  const openCreateForm = () => {
    setForm({
      ...EMPTY_FORM,
      sortOrder: shifts.length > 0 ? Math.max(...shifts.map((shift) => shift.sortOrder)) + 10 : 10,
    });
    setEditingShift(null);
    setShowForm(true);
  };

  const openEditForm = (shift: ShiftDefinitionDTO) => {
    setEditingShift(shift);
    setForm({
      id: shift.id,
      code: shift.code,
      name: shift.name,
      startTime: shift.startTime || '08:00',
      endTime: shift.endTime || '17:00',
      breakTime: shift.breakTime,
      workHours: shift.workHours,
      specialLeaveHours: shift.specialLeaveHours,
      compLeaveHours: shift.compLeaveHours,
      overtimeHours: shift.overtimeHours,
      requiresTime: shift.requiresTime,
      isActive: shift.isActive,
      sortOrder: shift.sortOrder,
      description: shift.description || '',
    });
    setShowForm(true);
  };

  const updateTimeField = (changes: Partial<Pick<ShiftForm, 'startTime' | 'endTime' | 'breakTime'>>) => {
    setForm((currentForm) => {
      const nextForm = { ...currentForm, ...changes };
      return {
        ...nextForm,
        workHours: nextForm.requiresTime
          ? calculateNetWorkHours(nextForm.startTime, nextForm.endTime, nextForm.breakTime)
          : 0,
      };
    });
  };

  const submitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        startTime: form.requiresTime ? form.startTime : '',
        endTime: form.requiresTime ? form.endTime : '',
        breakTime: form.requiresTime ? form.breakTime : 0,
      };
      const response = await fetchJSONWithCSRF('/api/system-settings/shift-definitions', {
        method: editingShift ? 'PUT' : 'POST',
        body: payload,
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        showMessage('error', result.error || '儲存班別失敗');
        return;
      }

      showMessage('success', result.message || '班別已儲存');
      resetForm();
      await loadShifts();
    } catch (error) {
      console.error('儲存班別失敗:', error);
      showMessage('error', '儲存班別失敗');
    } finally {
      setSaving(false);
    }
  };

  const deactivateShift = async () => {
    if (!deactivateTarget) return;

    setSaving(true);
    try {
      const response = await fetchJSONWithCSRF(`/api/system-settings/shift-definitions?id=${deactivateTarget.id}`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        showMessage('error', result.error || '停用班別失敗');
        return;
      }

      showMessage('success', '班別已停用');
      setDeactivateTarget(null);
      await loadShifts();
    } catch (error) {
      console.error('停用班別失敗:', error);
      showMessage('error', '停用班別失敗');
    } finally {
      setSaving(false);
    }
  };

  const reactivateShift = async (shift: ShiftDefinitionDTO) => {
    setSaving(true);
    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/shift-definitions', {
        method: 'PUT',
        body: {
          id: shift.id,
          code: shift.code,
          name: shift.name,
          startTime: shift.startTime,
          endTime: shift.endTime,
          breakTime: shift.breakTime,
          workHours: shift.workHours,
          specialLeaveHours: shift.specialLeaveHours,
          compLeaveHours: shift.compLeaveHours,
          overtimeHours: shift.overtimeHours,
          requiresTime: shift.requiresTime,
          isActive: true,
          sortOrder: shift.sortOrder,
          description: shift.description || '',
        },
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        showMessage('error', result.error || '啟用班別失敗');
        return;
      }

      showMessage('success', '班別已啟用');
      await loadShifts();
    } catch (error) {
      console.error('啟用班別失敗:', error);
      showMessage('error', '啟用班別失敗');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-blue-600 mx-auto mb-4 animate-spin" />
          <p className="text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center">
              <Clock className="w-8 h-8 text-blue-600 mr-3" />
              班別設定
            </h1>
            <p className="text-gray-600 mt-2">建立可供班表管理與週模版套用的班別資料。</p>
          </div>
          <button
            type="button"
            onClick={openCreateForm}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            新增班別
          </button>
        </div>

        {message && (
          <div className={`mb-6 p-4 rounded-lg border ${
            message.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}>
            {message.text}
          </div>
        )}

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">班別清單</h2>
              <p className="text-sm text-gray-500 mt-1">停用班別不會刪除既有班表，只會從新增班表選項中移除。</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(event) => setShowInactive(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              顯示停用班別
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">代碼</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">名稱</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">時間</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">工時/特休/補休/加班</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">排序</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">狀態</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {shifts.map((shift) => (
                  <tr key={shift.id} className={!shift.isActive ? 'bg-gray-50' : undefined}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">{shift.code}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      <div className="font-medium">{shift.name}</div>
                      {shift.description && <div className="text-gray-500 mt-1">{shift.description}</div>}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {shift.requiresTime ? `${shift.startTime}-${shift.endTime}` : '無需時間'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      <div>{formatShiftHourSummary(shift)}</div>
                      {shift.requiresTime && <div className="text-xs text-gray-500 mt-1">休息 {shift.breakTime} 分鐘</div>}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{shift.sortOrder}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        shift.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
                      }`}>
                        {shift.isActive ? '啟用' : '停用'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        type="button"
                        onClick={() => openEditForm(shift)}
                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-900 mr-4"
                      >
                        <Edit2 className="w-4 h-4" />
                        編輯
                      </button>
                      {shift.isActive ? (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => setDeactivateTarget(shift)}
                          className="text-red-600 hover:text-red-900 disabled:opacity-50"
                        >
                          停用
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => reactivateShift(shift)}
                          className="text-green-600 hover:text-green-900 disabled:opacity-50"
                        >
                          啟用
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {shifts.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                      尚無班別資料
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {showForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-gray-900">{editingShift ? '編輯班別' : '新增班別'}</h2>
                  <button type="button" onClick={resetForm} className="text-gray-400 hover:text-gray-600">
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <form onSubmit={submitForm} className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">班別代碼</label>
                      <input
                        type="text"
                        value={form.code}
                        onChange={(event) => setForm({ ...form, code: event.target.value })}
                        disabled={!!editingShift}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 disabled:bg-gray-100"
                        placeholder="例如：D"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">班別名稱</label>
                      <input
                        type="text"
                        value={form.name}
                        onChange={(event) => setForm({ ...form, name: event.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                        placeholder="例如：晚班"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="flex items-center pt-7">
                      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                        <input
                          type="checkbox"
                          checked={form.requiresTime}
                          onChange={(event) => {
                            const requiresTime = event.target.checked;
                            setForm({
                              ...form,
                              requiresTime,
                              workHours: requiresTime ? calculateNetWorkHours(form.startTime, form.endTime, form.breakTime) : 0,
                              specialLeaveHours: form.specialLeaveHours,
                              compLeaveHours: requiresTime ? form.compLeaveHours : 0,
                              overtimeHours: requiresTime ? form.overtimeHours : 0,
                            });
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        需要上下班時間
                      </label>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">排序</label>
                      <input
                        type="number"
                        min="0"
                        value={form.sortOrder}
                        onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                      />
                    </div>
                    <div className="flex items-center pt-7">
                      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                        <input
                          type="checkbox"
                          checked={form.isActive}
                          onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        啟用
                      </label>
                    </div>
                  </div>

                  {form.requiresTime && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">開始時間</label>
                        <input
                          type="time"
                          value={form.startTime}
                          onChange={(event) => updateTimeField({ startTime: event.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">結束時間</label>
                        <input
                          type="time"
                          value={form.endTime}
                          onChange={(event) => updateTimeField({ endTime: event.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">休息時間（分鐘）</label>
                        <input
                          type="number"
                          min="0"
                          max="1440"
                          value={form.breakTime}
                          onChange={(event) => updateTimeField({ breakTime: Number(event.target.value) || 0 })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                        />
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">工時（小時）</label>
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="0.25"
                        value={form.workHours}
                        onChange={(event) => setForm({ ...form, workHours: Number(event.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                        placeholder="例如：8、9、7"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">特休（小時）</label>
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="0.25"
                        value={form.specialLeaveHours}
                        onChange={(event) => setForm({ ...form, specialLeaveHours: Number(event.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                        placeholder="例如：2、4、6、8"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">off／補休（小時）</label>
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="0.25"
                        value={form.compLeaveHours}
                        onChange={(event) => setForm({ ...form, compLeaveHours: Number(event.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                        placeholder="例如：1、2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">加班（小時）</label>
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="0.25"
                        value={form.overtimeHours}
                        onChange={(event) => setForm({ ...form, overtimeHours: Number(event.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                        placeholder="例如：1、2"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">說明</label>
                    <textarea
                      value={form.description}
                      onChange={(event) => setForm({ ...form, description: event.target.value })}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                      placeholder="班別用途或注意事項"
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={resetForm}
                      className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                      {saving ? '儲存中...' : '儲存班別'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </main>

      <ConfirmDialog
        open={!!deactivateTarget}
        title="停用班別"
        message={
          deactivateTarget
            ? `確定要停用「${deactivateTarget.label}」？既有班表會保留，但新增班表將無法選用。`
            : ''
        }
        confirmLabel="停用"
        cancelLabel="取消"
        tone="danger"
        onConfirm={deactivateShift}
        onCancel={() => setDeactivateTarget(null)}
      />
    </div>
  );
}
