'use client';

import { useState, useEffect } from 'react';
import { 
  Calendar, 
  CalendarDays, 
  Plus, 
  Copy, 
  X,
  Edit2,
  Trash2,
  ArrowLeft,
  Clock,
  User,
  Save
} from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';

interface DaySchedule {
  shiftType: string;
  startTime: string;
  endTime: string;
  breakTime: number;
}

interface WeeklyTemplate {
  id: number;
  name: string;
  description: string;
  monday: DaySchedule;
  tuesday: DaySchedule;
  wednesday: DaySchedule;
  thursday: DaySchedule;
  friday: DaySchedule;
  saturday: DaySchedule;
  sunday: DaySchedule;
  createdAt: string;
  updatedAt: string;
}

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

const SHIFT_TYPE_LABELS = {
  A: 'A班 (07:30-16:30)',
  B: 'B班 (08:00-17:00)',
  C: 'C班 (08:30-17:30)',
  NH: 'NH (國定假日)',
  RD: 'RD (例假)',
  rd: 'rd (休息日)',
  FDL: 'FDL (全日請假)',
  OFF: 'OFF (休假)'
};

const SHIFT_TYPE_COLORS = {
  A: 'bg-blue-100 text-blue-800 border-blue-200',
  B: 'bg-green-100 text-green-800 border-green-200',
  C: 'bg-purple-100 text-purple-800 border-purple-200',
  NH: 'bg-red-100 text-red-800 border-red-200',
  RD: 'bg-gray-100 text-gray-800 border-gray-200',
  rd: 'bg-gray-50 text-gray-600 border-gray-100',
  FDL: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  OFF: 'bg-orange-100 text-orange-800 border-orange-200'
};

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const WEEKDAY_LABELS = {
  monday: '週一',
  tuesday: '週二',
  wednesday: '週三',
  thursday: '週四',
  friday: '週五',
  saturday: '週六',
  sunday: '週日'
};

export default function WeeklyTemplatesPage() {
  const [user, setUser] = useState<User | null>(null);
  const [templates, setTemplates] = useState<WeeklyTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<WeeklyTemplate | null>(null);

  // 新模版表單狀態
  const [newTemplate, setNewTemplate] = useState({
    name: '',
    description: '',
    monday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
    tuesday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
    wednesday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
    thursday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
    friday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
    saturday: { shiftType: 'RD', startTime: '', endTime: '', breakTime: 0 },
    sunday: { shiftType: 'RD', startTime: '', endTime: '', breakTime: 0 }
  });

  useEffect(() => {
    fetchUser();
    fetchTemplates();
  }, []);

  const fetchUser = async () => {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setUser(data.user || data);
      }
    } catch (error) {
      console.error('獲取用戶失敗:', error);
    }
  };

  const fetchTemplates = async () => {
    try {
      const response = await fetch('/api/schedules/templates', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setTemplates(data.templates || []);
      }
    } catch (error) {
      console.error('獲取週班模版失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/schedules/templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(newTemplate)
      });

      if (response.ok) {
        alert('週班模版建立成功');
        setShowCreateModal(false);
        resetForm();
        fetchTemplates();
      } else {
        const error = await response.json();
        alert(error.error || '建立失敗');
      }
    } catch {
      alert('建立失敗，請稍後再試');
    }
  };

  const handleUpdateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTemplate) return;

    try {
      const response = await fetch(`/api/schedules/templates/${editingTemplate.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(editingTemplate)
      });

      if (response.ok) {
        alert('週班模版更新成功');
        setShowEditModal(false);
        setEditingTemplate(null);
        fetchTemplates();
      } else {
        const error = await response.json();
        alert(error.error || '更新失敗');
      }
    } catch {
      alert('更新失敗，請稍後再試');
    }
  };

  const handleDeleteTemplate = async (id: number) => {
    if (!confirm('確認刪除此週班模版？此操作無法撤銷。')) return;

    try {
      const response = await fetch(`/api/schedules/templates/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.ok) {
        alert('週班模版刪除成功');
        fetchTemplates();
      } else {
        const error = await response.json();
        alert(error.error || '刪除失敗');
      }
    } catch {
      alert('刪除失敗，請稍後再試');
    }
  };

  const handleDuplicateTemplate = (template: WeeklyTemplate) => {
    setNewTemplate({
      name: `${template.name} (複製)`,
      description: template.description,
      monday: { ...template.monday },
      tuesday: { ...template.tuesday },
      wednesday: { ...template.wednesday },
      thursday: { ...template.thursday },
      friday: { ...template.friday },
      saturday: { ...template.saturday },
      sunday: { ...template.sunday }
    });
    setShowCreateModal(true);
  };

  const resetForm = () => {
    setNewTemplate({
      name: '',
      description: '',
      monday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
      tuesday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
      wednesday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
      thursday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
      friday: { shiftType: 'A', startTime: '07:30', endTime: '16:30', breakTime: 60 },
      saturday: { shiftType: 'RD', startTime: '', endTime: '', breakTime: 0 },
      sunday: { shiftType: 'RD', startTime: '', endTime: '', breakTime: 0 }
    });
  };

  const updateDaySchedule = (day: string, field: string, value: string | number, isEditing: boolean = false) => {
    if (isEditing && editingTemplate) {
      const currentDay = editingTemplate[day as keyof WeeklyTemplate] as DaySchedule;
      setEditingTemplate({
        ...editingTemplate,
        [day]: {
          ...currentDay,
          [field]: value
        }
      });
    } else {
      const currentDay = newTemplate[day as keyof typeof newTemplate] as DaySchedule;
      setNewTemplate({
        ...newTemplate,
        [day]: {
          ...currentDay,
          [field]: value
        }
      });
    }
  };

  const canManage = user && user.role && (user.role === 'ADMIN' || user.role === 'HR');

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

  if (!canManage) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">權限不足</h1>
          <p className="text-gray-600 mb-6">您沒有權限訪問此頁面</p>
          <a
            href="/dashboard"
            className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
          >
            返回首頁
          </a>
        </div>
      </div>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 標題區 */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center">
                <CalendarDays className="w-8 h-8 text-indigo-600 mr-3" />
                週班模版管理
              </h1>
              <p className="text-gray-600 mt-2">管理週班模版，可套用至員工班表</p>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors flex items-center"
            >
              <Plus className="w-5 h-5 mr-2" />
              建立新模版
            </button>
          </div>
        </div>

        {/* 統計卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <Calendar className="w-8 h-8 text-indigo-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">總模版數</p>
                <p className="text-2xl font-bold text-gray-900">
                  {templates.length}
                </p>
              </div>
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <Clock className="w-8 h-8 text-green-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">本週新增</p>
                <p className="text-2xl font-bold text-gray-900">
                  {templates.filter(template => {
                    const created = new Date(template.createdAt);
                    const now = new Date();
                    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    return created >= weekAgo;
                  }).length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <User className="w-8 h-8 text-blue-600" />
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">本月更新</p>
                <p className="text-2xl font-bold text-gray-900">
                  {templates.filter(template => {
                    const updated = new Date(template.updatedAt);
                    const now = new Date();
                    return updated.getMonth() === now.getMonth() && 
                           updated.getFullYear() === now.getFullYear();
                  }).length}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 模版列表 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {templates.map((template) => (
            <div key={template.id} className="bg-white rounded-lg shadow-md">
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">{template.name}</h3>
                    <p className="text-gray-600 mt-1">{template.description}</p>
                    <p className="text-sm text-gray-500 mt-2">
                      建立時間：{new Date(template.createdAt).toLocaleDateString('zh-TW')}
                    </p>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleDuplicateTemplate(template)}
                      className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors"
                      title="複製"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        setEditingTemplate(template);
                        setShowEditModal(true);
                      }}
                      className="p-2 text-green-600 hover:text-green-800 hover:bg-green-50 rounded-lg transition-colors"
                      title="編輯"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteTemplate(template.id)}
                      className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition-colors"
                      title="刪除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* 週班表預覽 */}
                <div className="space-y-2">
                  {WEEKDAYS.map((day) => {
                    const daySchedule = template[day as keyof WeeklyTemplate] as DaySchedule;
                    return (
                      <div key={day} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0">
                        <span className="text-sm font-medium text-gray-700 w-12">
                          {WEEKDAY_LABELS[day as keyof typeof WEEKDAY_LABELS]}
                        </span>
                        <div className="flex-1 ml-4">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${SHIFT_TYPE_COLORS[daySchedule.shiftType as keyof typeof SHIFT_TYPE_COLORS]}`}>
                            {daySchedule.shiftType}
                          </span>
                          {daySchedule.startTime && daySchedule.endTime && (
                            <span className="ml-2 text-sm text-gray-600">
                              {daySchedule.startTime} - {daySchedule.endTime}
                              {daySchedule.breakTime > 0 && (
                                <span className="text-gray-500 ml-1">
                                  (休息 {daySchedule.breakTime}分)
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}

          {templates.length === 0 && (
            <div className="col-span-full text-center py-12">
              <CalendarDays className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">尚無週班模版</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="mt-4 bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
              >
                建立第一個模版
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 建立模版表單彈窗 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">建立新週班模版</h2>
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    resetForm();
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleCreateTemplate} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">模版名稱</label>
                    <input
                      type="text"
                      value={newTemplate.name}
                      onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-black"
                      placeholder="例如：標準工作週"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                    <input
                      type="text"
                      value={newTemplate.description}
                      onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-black"
                      placeholder="模版說明"
                    />
                  </div>
                </div>

                {/* 週班表設定 */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-900">週班表設定</h3>
                  {WEEKDAYS.map((day) => {
                    const dayData = newTemplate[day as keyof typeof newTemplate] as DaySchedule;
                    return (
                      <div key={day} className="grid grid-cols-6 gap-4 items-center p-4 bg-gray-50 rounded-lg">
                        <div className="font-medium text-gray-700">
                          {WEEKDAY_LABELS[day as keyof typeof WEEKDAY_LABELS]}
                        </div>
                        <div>
                          <select
                            value={dayData.shiftType}
                            onChange={(e) => updateDaySchedule(day, 'shiftType', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            {Object.entries(SHIFT_TYPE_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <input
                            type="time"
                            value={dayData.startTime}
                            onChange={(e) => updateDaySchedule(day, 'startTime', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            disabled={['RD', 'rd', 'FDL', 'OFF'].includes(dayData.shiftType)}
                          />
                        </div>
                        <div>
                          <input
                            type="time"
                            value={dayData.endTime}
                            onChange={(e) => updateDaySchedule(day, 'endTime', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            disabled={['RD', 'rd', 'FDL', 'OFF'].includes(dayData.shiftType)}
                          />
                        </div>
                        <div>
                          <input
                            type="number"
                            value={dayData.breakTime}
                            onChange={(e) => updateDaySchedule(day, 'breakTime', parseInt(e.target.value) || 0)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            min="0"
                            max="480"
                            placeholder="分鐘"
                            disabled={['RD', 'rd', 'FDL', 'OFF'].includes(dayData.shiftType)}
                          />
                        </div>
                        <div className="text-xs text-gray-500">
                          休息時間(分)
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateModal(false);
                      resetForm();
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 flex items-center justify-center"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    建立模版
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 編輯模版表單彈窗 */}
      {showEditModal && editingTemplate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">編輯週班模版</h2>
                <button
                  onClick={() => {
                    setShowEditModal(false);
                    setEditingTemplate(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleUpdateTemplate} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">模版名稱</label>
                    <input
                      type="text"
                      value={editingTemplate.name}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-black"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                    <input
                      type="text"
                      value={editingTemplate.description}
                      onChange={(e) => setEditingTemplate({ ...editingTemplate, description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-black"
                    />
                  </div>
                </div>

                {/* 週班表設定 */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-gray-900">週班表設定</h3>
                  {WEEKDAYS.map((day) => {
                    const dayData = editingTemplate[day as keyof WeeklyTemplate] as DaySchedule;
                    return (
                      <div key={day} className="grid grid-cols-6 gap-4 items-center p-4 bg-gray-50 rounded-lg">
                        <div className="font-medium text-gray-700">
                          {WEEKDAY_LABELS[day as keyof typeof WEEKDAY_LABELS]}
                        </div>
                        <div>
                          <select
                            value={dayData.shiftType}
                            onChange={(e) => updateDaySchedule(day, 'shiftType', e.target.value, true)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            {Object.entries(SHIFT_TYPE_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <input
                            type="time"
                            value={dayData.startTime}
                            onChange={(e) => updateDaySchedule(day, 'startTime', e.target.value, true)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            disabled={['RD', 'rd', 'FDL', 'OFF'].includes(dayData.shiftType)}
                          />
                        </div>
                        <div>
                          <input
                            type="time"
                            value={dayData.endTime}
                            onChange={(e) => updateDaySchedule(day, 'endTime', e.target.value, true)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            disabled={['RD', 'rd', 'FDL', 'OFF'].includes(dayData.shiftType)}
                          />
                        </div>
                        <div>
                          <input
                            type="number"
                            value={dayData.breakTime}
                            onChange={(e) => updateDaySchedule(day, 'breakTime', parseInt(e.target.value) || 0, true)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            min="0"
                            max="480"
                            disabled={['RD', 'rd', 'FDL', 'OFF'].includes(dayData.shiftType)}
                          />
                        </div>
                        <div className="text-xs text-gray-500">
                          休息時間(分)
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditModal(false);
                      setEditingTemplate(null);
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 flex items-center justify-center"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    更新模版
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </AuthenticatedLayout>
  );
}
