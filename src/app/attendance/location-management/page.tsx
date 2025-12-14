'use client';

import { useState, useEffect } from 'react';
import { MapPin, Plus, Edit2, Trash2, Save, X, CheckCircle, XCircle } from 'lucide-react';

interface AllowedLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface LocationFormData {
  name: string;
  latitude: string;
  longitude: string;
  radius: string;
  isActive: boolean;
}

export default function LocationManagement() {
  const [locations, setLocations] = useState<AllowedLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingLocation, setEditingLocation] = useState<AllowedLocation | null>(null);
  const [formData, setFormData] = useState<LocationFormData>({
    name: '',
    latitude: '',
    longitude: '',
    radius: '100',
    isActive: true
  });


  // 載入允許的位置列表
  useEffect(() => {
    fetchLocations();
  }, []);

  const fetchLocations = async () => {
    try {
      const response = await fetch('/api/attendance/allowed-locations');
      if (response.ok) {
        const data = await response.json();
        setLocations(data.locations || []);
      }
    } catch (error) {
      console.error('載入位置列表失敗:', error);
    }
    setLoading(false);
  };

  // 獲取當前GPS位置
  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setFormData(prev => ({
            ...prev,
            latitude: latitude.toFixed(6),
            longitude: longitude.toFixed(6)
          }));
        },
        (error) => {
          console.error('獲取位置失敗:', error);
          alert('無法獲取當前位置，請手動輸入座標');
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 300000
        }
      );
    } else {
      alert('瀏覽器不支援GPS定位功能');
    }
  };

  // 添加新位置
  const handleAddLocation = async () => {
    const newLocation = {
      name: formData.name,
      latitude: parseFloat(formData.latitude),
      longitude: parseFloat(formData.longitude),
      radius: parseFloat(formData.radius),
      isActive: formData.isActive
    };

    try {
      const response = await fetch('/api/attendance/allowed-locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newLocation)
      });

      if (response.ok) {
        const result = await response.json();
        setLocations([...locations, result.location]);
        setShowAddForm(false);
        resetForm();
        alert('位置添加成功');
      } else {
        const error = await response.json();
        alert(`添加失敗: ${error.message}`);
      }
    } catch (error) {
      console.error('添加位置失敗:', error);
      alert('添加位置時發生錯誤');
    }
  };

  // 更新位置
  const handleUpdateLocation = async () => {
    if (!editingLocation) return;

    const updatedLocation = {
      id: editingLocation.id,
      name: formData.name,
      latitude: parseFloat(formData.latitude),
      longitude: parseFloat(formData.longitude),
      radius: parseFloat(formData.radius),
      isActive: formData.isActive
    };

    try {
      const response = await fetch('/api/attendance/allowed-locations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedLocation)
      });

      if (response.ok) {
        const result = await response.json();
        setLocations(locations.map(loc => 
          loc.id === editingLocation.id ? result.location : loc
        ));
        setEditingLocation(null);
        resetForm();
        alert('位置更新成功');
      } else {
        const error = await response.json();
        alert(`更新失敗: ${error.message}`);
      }
    } catch (error) {
      console.error('更新位置失敗:', error);
      alert('更新位置時發生錯誤');
    }
  };

  // 刪除位置
  const handleDeleteLocation = async (locationId: number) => {
    if (!confirm('確定要刪除這個位置嗎？')) return;

    try {
      const response = await fetch('/api/attendance/allowed-locations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: locationId })
      });

      if (response.ok) {
        setLocations(locations.filter(loc => loc.id !== locationId));
        alert('位置刪除成功');
      } else {
        const error = await response.json();
        alert(`刪除失敗: ${error.message}`);
      }
    } catch (error) {
      console.error('刪除位置失敗:', error);
      alert('刪除位置時發生錯誤');
    }
  };

  // 開始編輯位置
  const startEditing = (location: AllowedLocation) => {
    setEditingLocation(location);
    setFormData({
      name: location.name,
      latitude: location.latitude.toString(),
      longitude: location.longitude.toString(),
      radius: location.radius.toString(),
      isActive: location.isActive
    });
  };

  // 重置表單
  const resetForm = () => {
    setFormData({
      name: '',
      latitude: '',
      longitude: '',
      radius: '100',
      isActive: true
    });
    setEditingLocation(null);
    setShowAddForm(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="flex justify-center items-center h-64">
          <div className="text-gray-500">載入中...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* 標題和添加按鈕 */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">GPS打卡位置管理</h1>
          <button
            onClick={() => setShowAddForm(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            添加新位置
          </button>
        </div>

        {/* 位置列表 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">允許的打卡位置</h2>
            
            {locations.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <MapPin className="h-12 w-12 mx-auto mb-2 opacity-30" />
                <p>尚未設定任何允許的打卡位置</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-gray-200">
                    <tr>
                      <th className="text-left py-3 px-4 font-medium text-gray-900">位置名稱</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-900">座標</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-900">允許範圍</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-900">狀態</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-900">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locations.map((location) => (
                      <tr key={location.id} className="border-b border-gray-100">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-blue-500" />
                            {location.name}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-sm">
                          {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                        </td>
                        <td className="py-3 px-4">
                          {location.radius}公尺
                        </td>
                        <td className="py-3 px-4">
                          {location.isActive ? (
                            <span className="flex items-center gap-1 text-green-600">
                              <CheckCircle className="h-4 w-4" />
                              啟用
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-red-600">
                              <XCircle className="h-4 w-4" />
                              停用
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => startEditing(location)}
                              className="text-blue-600 hover:text-blue-700 p-1"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteLocation(location.id)}
                              className="text-red-600 hover:text-red-700 p-1"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* 添加/編輯表單 */}
        {(showAddForm || editingLocation) && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg max-w-md w-full mx-4">
              <div className="p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  {editingLocation ? '編輯位置' : '添加新位置'}
                </h3>

                <div className="space-y-4">
                  {/* 位置名稱 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      位置名稱
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="例如：總公司、分店A"
                    />
                  </div>

                  {/* GPS座標 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        緯度
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={formData.latitude}
                        onChange={(e) => setFormData(prev => ({ ...prev, latitude: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        經度
                      </label>
                      <input
                        type="number"
                        step="any"
                        value={formData.longitude}
                        onChange={(e) => setFormData(prev => ({ ...prev, longitude: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {/* 獲取當前位置按鈕 */}
                  <button
                    onClick={getCurrentLocation}
                    type="button"
                    className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
                  >
                    <MapPin className="h-4 w-4" />
                    使用當前位置
                  </button>

                  {/* 允許範圍 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      允許範圍 (公尺)
                    </label>
                    <input
                      type="number"
                      value={formData.radius}
                      onChange={(e) => setFormData(prev => ({ ...prev, radius: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      min="10"
                      max="1000"
                    />
                  </div>

                  {/* 啟用狀態 */}
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      id="isActive"
                      checked={formData.isActive}
                      onChange={(e) => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="isActive" className="ml-2 text-sm text-gray-700">
                      啟用此位置
                    </label>
                  </div>
                </div>

                {/* 按鈕 */}
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={resetForm}
                    className="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-400 transition-colors flex items-center justify-center gap-2"
                  >
                    <X className="h-4 w-4" />
                    取消
                  </button>
                  <button
                    onClick={editingLocation ? handleUpdateLocation : handleAddLocation}
                    className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                  >
                    <Save className="h-4 w-4" />
                    {editingLocation ? '更新' : '添加'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
