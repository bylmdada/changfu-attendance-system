'use client';

import { useState } from 'react';
import { Copy, Loader2, Calendar } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';

interface QuickCopyScheduleProps {
  onSuccess: () => void;
}

export default function QuickCopySchedule({ onSuccess }: QuickCopyScheduleProps) {
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    sourceType: 'week' as 'week' | 'month',
    sourceDate: '',
    targetDate: '',
    overwrite: false
  });

  const handleSubmit = async () => {
    if (!form.sourceDate || !form.targetDate) {
      alert('請選擇來源日期和目標日期');
      return;
    }

    setLoading(true);
    try {
      const response = await fetchJSONWithCSRF('/api/schedules/copy', {
        method: 'POST',
        body: form
      });

      if (response.ok) {
        const data = await response.json();
        alert(`${data.message}\n\n${data.details.sourceRange} → ${data.details.targetRange}\n複製：${data.details.created} 筆\n跳過：${data.details.skipped} 筆`);
        setShowModal(false);
        setForm({ sourceType: 'week', sourceDate: '', targetDate: '', overwrite: false });
        onSuccess();
      } else {
        const error = await response.json();
        alert(error.error || '複製失敗');
      }
    } catch (error) {
      console.error('複製班表失敗:', error);
      alert('操作失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  // 快速選擇：複製上週到本週
  const copyLastWeekToThisWeek = () => {
    const today = new Date();
    const lastWeek = new Date(today);
    lastWeek.setDate(today.getDate() - 7);
    
    setForm({
      sourceType: 'week',
      sourceDate: lastWeek.toISOString().split('T')[0],
      targetDate: today.toISOString().split('T')[0],
      overwrite: false
    });
  };

  // 快速選擇：複製上月到本月
  const copyLastMonthToThisMonth = () => {
    const today = new Date();
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
    setForm({
      sourceType: 'month',
      sourceDate: lastMonth.toISOString().split('T')[0],
      targetDate: thisMonth.toISOString().split('T')[0],
      overwrite: false
    });
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
      >
        <Copy className="w-4 h-4" />
        快速複製班表
      </button>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Calendar className="w-6 h-6 text-purple-600" />
              快速複製班表
            </h2>

            {/* 快速選項 */}
            <div className="mb-6 space-y-2">
              <p className="text-sm font-semibold text-gray-800 mb-2">快速選擇</p>
              <button
                onClick={copyLastWeekToThisWeek}
                className="w-full text-left px-4 py-3 border rounded-lg hover:bg-gray-50"
              >
                <div className="font-medium text-gray-900">複製上週班表到本週</div>
                <div className="text-sm text-gray-700">快速建立本週班表</div>
              </button>
              <button
                onClick={copyLastMonthToThisMonth}
                className="w-full text-left px-4 py-3 border rounded-lg hover:bg-gray-50"
              >
                <div className="font-medium text-gray-900">複製上月班表到本月</div>
                <div className="text-sm text-gray-700">快速建立本月班表</div>
              </button>
            </div>

            <hr className="my-4" />

            {/* 自訂選項 */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1">複製類型</label>
                <select
                  value={form.sourceType}
                  onChange={(e) => setForm({ ...form, sourceType: e.target.value as 'week' | 'month' })}
                  className="w-full px-3 py-2 border rounded-lg text-gray-900 font-medium"
                >
                  <option value="week">按週複製</option>
                  <option value="month">按月複製</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-1">來源日期</label>
                  <input
                    type="date"
                    value={form.sourceDate}
                    onChange={(e) => setForm({ ...form, sourceDate: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-1">目標日期</label>
                  <input
                    type="date"
                    value={form.targetDate}
                    onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-gray-900"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
                <input
                  type="checkbox"
                  checked={form.overwrite}
                  onChange={(e) => setForm({ ...form, overwrite: e.target.checked })}
                  className="rounded"
                />
                覆蓋已存在的班表
              </label>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || !form.sourceDate || !form.targetDate}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                開始複製
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
