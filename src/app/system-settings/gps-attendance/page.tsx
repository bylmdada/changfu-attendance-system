'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, Settings, Save, Plus, Edit2, Trash2, ToggleLeft, ToggleRight, AlertTriangle, CheckCircle, Wifi } from 'lucide-react';
import { DEPARTMENT_OPTIONS } from '@/constants/departments';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import SystemNavbar from '@/components/SystemNavbar';

interface GPSSettings {
  enabled: boolean;
  requiredAccuracy: number; // GPS精確度要求(米)
  allowOfflineMode: boolean; // 允許離線模式
  offlineGracePeriod: number; // 離線寬限時間(分鐘)
  maxDistanceVariance: number; // 最大距離偏差(米)
  verificationTimeout: number; // 驗證超時時間(秒)
  enableLocationHistory: boolean; // 啟用位置歷史記錄
  requireAddressInfo: boolean; // 需要地址資訊
}

interface AllowedLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  isActive: boolean;
  department?: string;
  workHours?: string;
  // WiFi SSID 輔助驗證欄位
  wifiSsidList?: string;
  wifiEnabled?: boolean;
  wifiOnly?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface GPSPermission {
  id: number;
  employeeId?: number | null;
  department?: string | null;
  isEnabled: boolean;
  priority: number;
  reason?: string;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  employeeName?: string;
  employeeCode?: string;
}

interface PermissionFormData {
  type: 'employee' | 'department';
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  department: string;
  isEnabled: boolean;
  priority: string;
  reason: string;
}

interface LocationFormData {
  name: string;
  latitude: string;
  longitude: string;
  radius: string;
  isActive: boolean;
  department: string;
  workHours: string;
  // WiFi SSID 輔助驗證欄位
  wifiSsidList: string;
  wifiEnabled: boolean;
  wifiOnly: boolean;
}

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

export default function GPSAttendanceSettings() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'basic' | 'locations' | 'permissions'>('basic');
  
  // GPS設定狀態
  const [gpsSettings, setGPSSettings] = useState<GPSSettings>({
    enabled: true,
    requiredAccuracy: 50,
    allowOfflineMode: false,
    offlineGracePeriod: 5,
    maxDistanceVariance: 20,
    verificationTimeout: 30,
    enableLocationHistory: true,
    requireAddressInfo: true
  });

  // 允許位置狀態
  const [allowedLocations, setAllowedLocations] = useState<AllowedLocation[]>([]);
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [editingLocation, setEditingLocation] = useState<AllowedLocation | null>(null);
  const [locationForm, setLocationForm] = useState<LocationFormData>({
    name: '',
    latitude: '',
    longitude: '',
    radius: '100',
    isActive: true,
    department: '',
    workHours: '',
    wifiSsidList: '',
    wifiEnabled: false,
    wifiOnly: false
  });

  // GPS 权限状态
  const [gpsPermissions, setGpsPermissions] = useState<GPSPermission[]>([]);
  const [employees, setEmployees] = useState<{ id: string; name: string; code: string; department?: string }[]>([]);
  const [showPermissionForm, setShowPermissionForm] = useState(false);
  const [editingPermission, setEditingPermission] = useState<GPSPermission | null>(null);
  const [permissionForm, setPermissionForm] = useState<PermissionFormData>({
    type: 'department',
    employeeId: '',
    employeeName: '',
    employeeCode: '',
    department: '',
    isEnabled: true,
    priority: '0',
    reason: ''
  });

  // 員工選擇器狀態
  const [showEmployeeSelector, setShowEmployeeSelector] = useState(false);
  const [employeeSearchTerm, setEmployeeSearchTerm] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('');
  const [expandedDepartments, setExpandedDepartments] = useState<Set<string>>(new Set());

  // Toast 訊息狀態
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // 刪除確認對話框狀態（位置）
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name: string } | null>(null);
  
  // 批量選擇狀態（位置）
  const [selectedLocationIds, setSelectedLocationIds] = useState<Set<number>>(new Set());
  
  // 刪除確認對話框狀態（權限）
  const [deletePermissionConfirm, setDeletePermissionConfirm] = useState<{ id: number; name: string } | null>(null);
  
  // 批量選擇狀態（權限）
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<Set<number>>(new Set());

  // Helper function to get auth headers
  const getAuthHeaders = (): HeadersInit => {
    if (typeof window === 'undefined') return { Authorization: 'Bearer admin-token' };
    const token = localStorage.getItem('token');
    const authHeader = token ? `Bearer ${token}` : 'Bearer admin-token';
    console.log('Sending auth header:', authHeader);
    return { Authorization: authHeader };
  };

  // 載入用戶資訊和設定
  useEffect(() => {
    const fetchUserAndSettings = async () => {
      try {
        // 驗證用戶身份
        const userResponse = await fetch('/api/auth/me', {
          credentials: 'include',
          headers: getAuthHeaders()
        });
        
        if (userResponse.ok) {
          const userData = await userResponse.json();
          const currentUser = userData.user || userData;
          
          if (currentUser.role !== 'ADMIN') {
            router.push('/dashboard');
            return;
          }
          setUser(currentUser);
        } else if (userResponse.status === 401 || userResponse.status === 403) {
          console.warn('Authentication failed, redirecting to login');
          router.push('/login');
          return;
        } else {
          router.push('/login');
          return;
        }

        // 載入GPS設定
        const settingsResponse = await fetch('/api/system-settings/gps-attendance');
        if (settingsResponse.ok) {
          const settingsData = await settingsResponse.json();
          if (settingsData.settings) {
            setGPSSettings(settingsData.settings);
          }
        }

        // 載入允許位置
        const locationsResponse = await fetch('/api/attendance/allowed-locations', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });
        if (locationsResponse.ok) {
          const locationsData = await locationsResponse.json();
          console.log('Locations response:', locationsData);
          setAllowedLocations(locationsData.locations || []);
        } else {
          console.error('Failed to load locations:', locationsResponse.status);
          setAllowedLocations([]);
        }

        // 載入 GPS 权限配置
        const permissionsResponse = await fetch('/api/attendance/gps-permissions', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });
        if (permissionsResponse.ok) {
          const permissionsData = await permissionsResponse.json();
          console.log('GPS permissions response:', permissionsData);
          setGpsPermissions(permissionsData.permissions || []);
        } else {
          console.error('Failed to load GPS permissions:', permissionsResponse.status);
          setGpsPermissions([]);
        }

        // 載入員工列表
        const employeesResponse = await fetch('/api/employees', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });
        if (employeesResponse.ok) {
          const employeesData = await employeesResponse.json();
          console.log('Employees response:', employeesData);
          setEmployees(employeesData.employees || []);
        } else {
          console.error('Failed to load employees:', employeesResponse.status);
          setEmployees([]);
        }

      } catch (error) {
        console.error('載入失敗:', error);
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };

    fetchUserAndSettings();
  }, [router]);

  // 儲存GPS設定
  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/gps-attendance', {
        method: 'POST',
        body: { settings: gpsSettings }
      });

      if (response.ok) {
        alert('GPS設定已儲存！');
      } else {
        let errorMessage = `HTTP ${response.status}`;
        
        // Clone the response to handle both JSON and text parsing attempts
        const responseClone = response.clone();
        
        try {
          const error = await response.json();
          errorMessage = error.message || errorMessage;
        } catch {
          // If JSON parsing fails, try to get text content from the clone
          try {
            const textContent = await responseClone.text();
            errorMessage = textContent || errorMessage;
          } catch {
            // If both fail, keep the HTTP status message
            console.warn('Unable to parse error response, using HTTP status');
          }
        }
        alert(`儲存失敗: ${errorMessage}`);
      }
    } catch (error) {
      console.error('儲存設定失敗:', error);
      alert('儲存失敗，請重試');
    } finally {
      setSaving(false);
    }
  };

  // 獲取當前位置
  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setLocationForm(prev => ({
            ...prev,
            latitude: latitude.toFixed(6),
            longitude: longitude.toFixed(6)
          }));
          alert('已獲取當前位置座標');
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

  // 添加/更新位置
  const handleSaveLocation = async () => {
    console.log('Starting handleSaveLocation...');
    const locationData = {
      ...(editingLocation && { id: editingLocation.id }),
      name: locationForm.name,
      latitude: parseFloat(locationForm.latitude),
      longitude: parseFloat(locationForm.longitude),
      radius: parseFloat(locationForm.radius),
      isActive: locationForm.isActive,
      department: locationForm.department,
      workHours: locationForm.workHours,
      // WiFi SSID 輔助驗證欄位
      wifiSsidList: locationForm.wifiSsidList || null,
      wifiEnabled: locationForm.wifiEnabled,
      wifiOnly: locationForm.wifiOnly
    };

    console.log('Location data to send:', locationData);

    try {
      const method = editingLocation ? 'PUT' : 'POST';
      const headers = { 
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      };
      
      console.log('Request headers:', headers);
      console.log('Request method:', method);
      
      const response = await fetchJSONWithCSRF('/api/attendance/allowed-locations', {
        method,
        body: locationData
      });

      console.log('Response status:', response.status);
      console.log('Response ok:', response.ok);

      if (response.ok) {
        const result = await response.json();
        console.log('Success result:', result);
        
        if (editingLocation) {
          setAllowedLocations(locations => 
            locations.map(loc => loc.id === editingLocation.id ? result.location : loc)
          );
        } else {
          setAllowedLocations(locations => [...locations, result.location]);
        }
        
        setShowLocationForm(false);
        setEditingLocation(null);
        resetLocationForm();
        alert(editingLocation ? '位置更新成功' : '位置添加成功');
      } else {
        let errorMessage = `HTTP ${response.status}`;
        
        // Clone the response to handle both JSON and text parsing attempts
        const responseClone = response.clone();
        
        try {
          const error = await response.json();
          console.log('Error response JSON:', error);
          errorMessage = error.error || error.message || errorMessage;
        } catch {
          // If JSON parsing fails, try to get text content from the clone
          try {
            const textContent = await responseClone.text();
            console.log('Error response text:', textContent);
            errorMessage = textContent || errorMessage;
          } catch {
            // If both fail, keep the HTTP status message
            console.warn('Unable to parse error response, using HTTP status');
          }
        }
        alert(`操作失敗: ${errorMessage}`);
      }
    } catch (error) {
      console.error('儲存位置失敗:', error);
      alert('操作失敗，請重試');
    }
  };

  // 顯示 Toast 訊息
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  // 顯示刪除確認對話框
  const showDeleteLocationConfirm = (location: AllowedLocation) => {
    setDeleteConfirm({ id: location.id, name: location.name });
  };

  // 執行刪除位置
  const handleDeleteLocation = async () => {
    if (!deleteConfirm) return;

    try {
      const response = await fetchJSONWithCSRF('/api/attendance/allowed-locations', {
        method: 'DELETE',
        body: { id: deleteConfirm.id }
      });

      if (response.ok) {
        setAllowedLocations(locations => locations.filter(loc => loc.id !== deleteConfirm.id));
        setSelectedLocationIds(ids => {
          const newIds = new Set(ids);
          newIds.delete(deleteConfirm.id);
          return newIds;
        });
        showToast('success', '位置刪除成功');
      } else {
        let errorMessage = `HTTP ${response.status}`;
        
        const responseClone = response.clone();
        try {
          const error = await response.json();
          errorMessage = error.message || errorMessage;
        } catch {
          try {
            const textContent = await responseClone.text();
            errorMessage = textContent || errorMessage;
          } catch {
            console.warn('Unable to parse error response');
          }
        }
        showToast('error', `刪除失敗: ${errorMessage}`);
      }
    } catch (error) {
      console.error('刪除位置失敗:', error);
      showToast('error', '刪除失敗，請重試');
    } finally {
      setDeleteConfirm(null);
    }
  };

  // 快速切換啟用/停用狀態
  const handleToggleLocationActive = async (location: AllowedLocation) => {
    try {
      const response = await fetchJSONWithCSRF('/api/attendance/allowed-locations', {
        method: 'PUT',
        body: { 
          id: location.id,
          isActive: !location.isActive
        }
      });

      if (response.ok) {
        setAllowedLocations(locations => 
          locations.map(loc => 
            loc.id === location.id ? { ...loc, isActive: !loc.isActive } : loc
          )
        );
        showToast('success', `「${location.name}」已${location.isActive ? '停用' : '啟用'}`);
      } else {
        showToast('error', '更新失敗');
      }
    } catch (error) {
      console.error('切換狀態失敗:', error);
      showToast('error', '操作失敗，請重試');
    }
  };

  // 複製位置
  const handleCopyLocation = (location: AllowedLocation) => {
    setEditingLocation(null);
    setLocationForm({
      name: `${location.name} (複製)`,
      latitude: location.latitude.toString(),
      longitude: location.longitude.toString(),
      radius: location.radius.toString(),
      isActive: location.isActive,
      department: location.department || '',
      workHours: location.workHours || '',
      wifiSsidList: location.wifiSsidList || '',
      wifiEnabled: location.wifiEnabled || false,
      wifiOnly: location.wifiOnly || false
    });
    setShowLocationForm(true);
    showToast('success', '已複製位置設定，請修改後儲存');
  };

  // 切換選擇位置
  const toggleSelectLocation = (id: number) => {
    setSelectedLocationIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // 全選/取消全選
  const toggleSelectAll = () => {
    if (selectedLocationIds.size === allowedLocations.length) {
      setSelectedLocationIds(new Set());
    } else {
      setSelectedLocationIds(new Set(allowedLocations.map(loc => loc.id)));
    }
  };

  // 批量啟用/停用
  const handleBatchToggleActive = async (activate: boolean) => {
    if (selectedLocationIds.size === 0) {
      showToast('error', '請先選擇位置');
      return;
    }

    try {
      const promises = Array.from(selectedLocationIds).map(id =>
        fetchJSONWithCSRF('/api/attendance/allowed-locations', {
          method: 'PUT',
          body: { id, isActive: activate }
        })
      );

      await Promise.all(promises);
      
      setAllowedLocations(locations =>
        locations.map(loc =>
          selectedLocationIds.has(loc.id) ? { ...loc, isActive: activate } : loc
        )
      );
      setSelectedLocationIds(new Set());
      showToast('success', `已${activate ? '啟用' : '停用'} ${selectedLocationIds.size} 個位置`);
    } catch (error) {
      console.error('批量操作失敗:', error);
      showToast('error', '批量操作失敗');
    }
  };

  // 開始編輯位置
  const startEditLocation = (location: AllowedLocation) => {
    setEditingLocation(location);
    setLocationForm({
      name: location.name,
      latitude: location.latitude.toString(),
      longitude: location.longitude.toString(),
      radius: location.radius.toString(),
      isActive: location.isActive,
      department: location.department || '',
      workHours: location.workHours || '',
      wifiSsidList: location.wifiSsidList || '',
      wifiEnabled: location.wifiEnabled || false,
      wifiOnly: location.wifiOnly || false
    });
    setShowLocationForm(true);
  };

  // 重置位置表單
  const resetLocationForm = () => {
    setLocationForm({
      name: '',
      latitude: '',
      longitude: '',
      radius: '100',
      isActive: true,
      department: '',
      workHours: '',
      wifiSsidList: '',
      wifiEnabled: false,
      wifiOnly: false
    });
    setEditingLocation(null);
  };

  // 添加/更新 GPS 权限
  const handleSavePermission = async () => {
    console.log('Starting handleSavePermission...');
    const permissionData = {
      ...(editingPermission && { id: editingPermission.id }),
      employeeId: permissionForm.type === 'employee' ? (
        isNaN(parseInt(permissionForm.employeeId)) ? null : parseInt(permissionForm.employeeId)
      ) : null,
      department: permissionForm.type === 'department' ? permissionForm.department : null,
      isEnabled: permissionForm.isEnabled,
      priority: isNaN(parseInt(permissionForm.priority)) ? 1 : parseInt(permissionForm.priority),
      reason: permissionForm.reason
    };

    console.log('Permission data to send:', permissionData);

    try {
      const method = editingPermission ? 'PUT' : 'POST';
      
      const response = await fetchJSONWithCSRF('/api/attendance/gps-permissions', {
        method,
        body: permissionData
      });

      console.log('Response status:', response.status);

      if (response.ok) {
        const result = await response.json();
        console.log('Success result:', result);
        
        if (editingPermission) {
          setGpsPermissions(permissions => 
            permissions.map(perm => perm.id === editingPermission.id ? result.permission : perm)
          );
        } else {
          setGpsPermissions(permissions => [...permissions, result.permission]);
        }
        
        setShowPermissionForm(false);
        setEditingPermission(null);
        resetPermissionForm();
        alert(editingPermission ? '權限更新成功' : '權限新增成功');
      } else {
        const error = await response.json();
        alert(`操作失敗: ${error.error || '未知錯誤'}`);
      }
    } catch (error) {
      console.error('保存權限失敗:', error);
      alert('操作失敗，請重試');
    }
  };

  // 顯示權限刪除確認對話框
  const showDeletePermissionConfirm = (permission: GPSPermission) => {
    const name = permission.employeeId 
      ? `${permission.employeeName} (${permission.employeeCode})`
      : permission.department || '權限';
    setDeletePermissionConfirm({ id: permission.id, name });
  };

  // 執行刪除權限
  const handleDeletePermission = async () => {
    if (!deletePermissionConfirm) return;

    try {
      const response = await fetchJSONWithCSRF('/api/attendance/gps-permissions', {
        method: 'DELETE',
        body: { id: deletePermissionConfirm.id }
      });

      if (response.ok) {
        setGpsPermissions(permissions => permissions.filter(perm => perm.id !== deletePermissionConfirm.id));
        setSelectedPermissionIds(ids => {
          const newIds = new Set(ids);
          newIds.delete(deletePermissionConfirm.id);
          return newIds;
        });
        showToast('success', '權限刪除成功');
      } else {
        const error = await response.json();
        showToast('error', `刪除失敗: ${error.error || '未知錯誤'}`);
      }
    } catch (error) {
      console.error('刪除權限失敗:', error);
      showToast('error', '刪除失敗，請重試');
    } finally {
      setDeletePermissionConfirm(null);
    }
  };

  // 快速切換權限啟用/停用狀態
  const handleTogglePermissionActive = async (permission: GPSPermission) => {
    try {
      const response = await fetchJSONWithCSRF('/api/attendance/gps-permissions', {
        method: 'PUT',
        body: { 
          id: permission.id,
          isEnabled: !permission.isEnabled
        }
      });

      if (response.ok) {
        setGpsPermissions(permissions => 
          permissions.map(perm => 
            perm.id === permission.id ? { ...perm, isEnabled: !perm.isEnabled } : perm
          )
        );
        const name = permission.employeeId ? permission.employeeName : permission.department;
        showToast('success', `「${name}」已${permission.isEnabled ? '停用' : '啟用'}`);
      } else {
        showToast('error', '更新失敗');
      }
    } catch (error) {
      console.error('切換狀態失敗:', error);
      showToast('error', '操作失敗，請重試');
    }
  };

  // 複製權限
  const handleCopyPermission = (permission: GPSPermission) => {
    setEditingPermission(null);
    setPermissionForm({
      type: permission.employeeId ? 'employee' : 'department',
      employeeId: '',
      employeeName: '',
      employeeCode: '',
      department: permission.department || '',
      isEnabled: permission.isEnabled,
      priority: permission.priority.toString(),
      reason: `${permission.reason || ''} (複製)`
    });
    setShowPermissionForm(true);
    showToast('success', '已複製權限設定，請選擇對象後儲存');
  };

  // 切換選擇權限
  const toggleSelectPermission = (id: number) => {
    setSelectedPermissionIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // 全選/取消全選權限
  const toggleSelectAllPermissions = () => {
    if (selectedPermissionIds.size === gpsPermissions.length) {
      setSelectedPermissionIds(new Set());
    } else {
      setSelectedPermissionIds(new Set(gpsPermissions.map(perm => perm.id)));
    }
  };

  // 批量啟用/停用權限
  const handleBatchTogglePermissionActive = async (activate: boolean) => {
    if (selectedPermissionIds.size === 0) {
      showToast('error', '請先選擇權限');
      return;
    }

    try {
      const promises = Array.from(selectedPermissionIds).map(id =>
        fetchJSONWithCSRF('/api/attendance/gps-permissions', {
          method: 'PUT',
          body: { id, isEnabled: activate }
        })
      );

      await Promise.all(promises);
      
      setGpsPermissions(permissions =>
        permissions.map(perm =>
          selectedPermissionIds.has(perm.id) ? { ...perm, isEnabled: activate } : perm
        )
      );
      setSelectedPermissionIds(new Set());
      showToast('success', `已${activate ? '啟用' : '停用'} ${selectedPermissionIds.size} 個權限`);
    } catch (error) {
      console.error('批量操作失敗:', error);
      showToast('error', '批量操作失敗');
    }
  };

  // 开始编辑权限
  const startEditPermission = (permission: GPSPermission) => {
    setEditingPermission(permission);
    setPermissionForm({
      type: permission.employeeId ? 'employee' : 'department',
      employeeId: permission.employeeId ? permission.employeeId.toString() : '',
      employeeName: permission.employeeName || '',
      employeeCode: permission.employeeCode || '',
      department: permission.department || '',
      isEnabled: permission.isEnabled,
      priority: permission.priority.toString(),
      reason: permission.reason || ''
    });
    setShowPermissionForm(true);
  };

  // 重置权限表單
  const resetPermissionForm = () => {
    setPermissionForm({
      type: 'department',
      employeeId: '',
      employeeName: '',
      employeeCode: '',
      department: '',
      isEnabled: true,
      priority: '0',
      reason: ''
    });
    setEditingPermission(null);
    setEmployeeSearchTerm('');
    setSelectedDepartment('');
  };

  // 員工選擇器相關函數
  const toggleDepartment = (department: string) => {
    const newExpanded = new Set(expandedDepartments);
    if (newExpanded.has(department)) {
      newExpanded.delete(department);
    } else {
      newExpanded.add(department);
    }
    setExpandedDepartments(newExpanded);
  };

  const selectEmployee = (employee: { id: string; name: string; code: string; department?: string }) => {
    setPermissionForm(prev => ({
      ...prev,
      employeeId: employee.id,
      employeeName: employee.name,
      employeeCode: employee.code
    }));
    setShowEmployeeSelector(false);
    setEmployeeSearchTerm('');
  };

  // 過濾和組織員工數據
  const getFilteredEmployees = () => {
    let filtered = employees;

    // 按搜尋詞過濾
    if (employeeSearchTerm) {
      const searchLower = employeeSearchTerm.toLowerCase();
      filtered = filtered.filter(emp => 
        emp.name.toLowerCase().includes(searchLower) ||
        emp.code.toLowerCase().includes(searchLower) ||
        (emp.department && emp.department.toLowerCase().includes(searchLower))
      );
    }

    // 按部門過濾
    if (selectedDepartment) {
      filtered = filtered.filter(emp => emp.department === selectedDepartment);
    }

    return filtered;
  };

  // 按部門組織員工
  const getEmployeesByDepartment = () => {
    const filtered = getFilteredEmployees();
    const byDepartment: { [key: string]: typeof employees } = {};

    filtered.forEach(emp => {
      const dept = emp.department || '未分配部門';
      if (!byDepartment[dept]) {
        byDepartment[dept] = [];
      }
      byDepartment[dept].push(emp);
    });

    // 按員工數量排序部門
    return Object.entries(byDepartment)
      .sort(([,a], [,b]) => b.length - a.length)
      .reduce((acc, [dept, emps]) => {
        acc[dept] = emps.sort((a, b) => a.name.localeCompare(b.name));
        return acc;
      }, {} as { [key: string]: typeof employees });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-black">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 導航列 */}
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 標題區 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <MapPin className="w-8 h-8 text-blue-600 mr-3" />
            GPS 打卡設定
          </h1>
          <p className="text-gray-600 mt-2">管理 GPS 定位打卡與允許打卡地點</p>
        </div>

        {/* 标签页导航 */}
        <div className="mb-8">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('basic')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'basic'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                基本設定
              </button>
              <button
                onClick={() => setActiveTab('locations')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'locations'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                允許位置
              </button>
              <button
                onClick={() => setActiveTab('permissions')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'permissions'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                權限管理
              </button>
            </nav>
          </div>
        </div>

        {/* GPS基本設定 */}
        {activeTab === 'basic' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-8">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <Settings className="h-5 w-5 mr-2" />
                GPS功能設定
              </h2>
              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? '儲存中...' : '儲存設定'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* GPS開關 */}
              <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                <div>
                  <h3 className="font-medium text-gray-900">啟用GPS打卡</h3>
                  <p className="text-sm text-black">員工打卡時需要提供GPS位置資訊</p>
                </div>
                <button
                  onClick={() => setGPSSettings({...gpsSettings, enabled: !gpsSettings.enabled})}
                  className={`p-1 ${gpsSettings.enabled ? 'text-green-600' : 'text-gray-400'}`}
                >
                  {gpsSettings.enabled ? <ToggleRight className="h-8 w-8" /> : <ToggleLeft className="h-8 w-8" />}
                </button>
              </div>

              {/* GPS精確度要求 */}
              <div className="p-4 border border-gray-200 rounded-lg">
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  GPS精確度要求 (公尺)
                </label>
                <input
                  type="number"
                  min="10"
                  max="500"
                  value={gpsSettings.requiredAccuracy || 50}
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    setGPSSettings({...gpsSettings, requiredAccuracy: isNaN(value) ? 50 : value});
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                />
                <p className="text-xs text-black mt-1">GPS精確度低於此數值才允許打卡</p>
              </div>

              {/* 離線模式 */}
              <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                <div>
                  <h3 className="font-medium text-gray-900">允許離線模式</h3>
                  <p className="text-sm text-black">無GPS訊號時允許打卡</p>
                </div>
                <button
                  onClick={() => setGPSSettings({...gpsSettings, allowOfflineMode: !gpsSettings.allowOfflineMode})}
                  className={`p-1 ${gpsSettings.allowOfflineMode ? 'text-green-600' : 'text-gray-400'}`}
                >
                  {gpsSettings.allowOfflineMode ? <ToggleRight className="h-8 w-8" /> : <ToggleLeft className="h-8 w-8" />}
                </button>
              </div>

              {/* 離線寬限時間 */}
              <div className="p-4 border border-gray-200 rounded-lg">
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  離線寬限時間 (分鐘)
                </label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={gpsSettings.offlineGracePeriod || 5}
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    setGPSSettings({...gpsSettings, offlineGracePeriod: isNaN(value) ? 5 : value});
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                  disabled={!gpsSettings.allowOfflineMode}
                />
                <p className="text-xs text-black mt-1">離線模式下的最長等待時間</p>
              </div>

              {/* 最大距離偏差 */}
              <div className="p-4 border border-gray-200 rounded-lg">
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  最大距離偏差 (公尺)
                </label>
                <input
                  type="number"
                  min="5"
                  max="100"
                  value={gpsSettings.maxDistanceVariance || 20}
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    setGPSSettings({...gpsSettings, maxDistanceVariance: isNaN(value) ? 20 : value});
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                />
                <p className="text-xs text-black mt-1">允許的GPS座標偏差範圍</p>
              </div>

              {/* 驗證超時時間 */}
              <div className="p-4 border border-gray-200 rounded-lg">
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  驗證超時時間 (秒)
                </label>
                <input
                  type="number"
                  min="10"
                  max="120"
                  value={gpsSettings.verificationTimeout || 30}
                  onChange={(e) => {
                    const value = parseInt(e.target.value);
                    setGPSSettings({...gpsSettings, verificationTimeout: isNaN(value) ? 30 : value});
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                />
                <p className="text-xs text-black mt-1">GPS位置驗證的最長等待時間</p>
              </div>

              {/* 位置歷史記錄 */}
              <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                <div>
                  <h3 className="font-medium text-gray-900">啟用位置歷史記錄</h3>
                  <p className="text-sm text-black">保存員工打卡位置歷史</p>
                </div>
                <button
                  onClick={() => setGPSSettings({...gpsSettings, enableLocationHistory: !gpsSettings.enableLocationHistory})}
                  className={`p-1 ${gpsSettings.enableLocationHistory ? 'text-green-600' : 'text-gray-400'}`}
                >
                  {gpsSettings.enableLocationHistory ? <ToggleRight className="h-8 w-8" /> : <ToggleLeft className="h-8 w-8" />}
                </button>
              </div>

              {/* 需要地址資訊 */}
              <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                <div>
                  <h3 className="font-medium text-gray-900">需要地址資訊</h3>
                  <p className="text-sm text-black">打卡時須提供詳細地址</p>
                </div>
                <button
                  onClick={() => setGPSSettings({...gpsSettings, requireAddressInfo: !gpsSettings.requireAddressInfo})}
                  className={`p-1 ${gpsSettings.requireAddressInfo ? 'text-green-600' : 'text-gray-400'}`}
                >
                  {gpsSettings.requireAddressInfo ? <ToggleRight className="h-8 w-8" /> : <ToggleLeft className="h-8 w-8" />}
                </button>
              </div>
            </div>

            {/* 設定說明 */}
            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-start">
                <AlertTriangle className="h-5 w-5 text-blue-600 mt-0.5 mr-3" />
                <div>
                  <h4 className="font-medium text-blue-900 mb-2">GPS設定說明</h4>
                  <ul className="text-sm text-blue-800 space-y-1">
                    <li>• GPS精確度數值越小，要求越嚴格</li>
                    <li>• 離線模式適用於GPS訊號不佳的環境</li>
                    <li>• 距離偏差設定過小可能造成打卡困難</li>
                    <li>• 建議定期檢查設定值是否適合實際使用情況</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* 允許位置管理 */}
        {activeTab === 'locations' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <MapPin className="h-5 w-5 mr-2" />
                允許打卡位置
              </h2>
              <button
                onClick={() => {
                  resetLocationForm();
                  setShowLocationForm(true);
                }}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                新增位置
              </button>
              
              {/* 批量操作按鈕 */}
              {selectedLocationIds.size > 0 && (
                <div className="flex items-center gap-2 ml-4 pl-4 border-l border-gray-300">
                  <span className="text-sm text-gray-600">已選 {selectedLocationIds.size} 項：</span>
                  <button
                    onClick={() => handleBatchToggleActive(true)}
                    className="px-3 py-1.5 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
                  >
                    批量啟用
                  </button>
                  <button
                    onClick={() => handleBatchToggleActive(false)}
                    className="px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                  >
                    批量停用
                  </button>
                </div>
              )}
            </div>

            {allowedLocations.length === 0 ? (
              <div className="text-center py-12 text-gray-900">
                <MapPin className="h-12 w-12 mx-auto mb-2 opacity-30" />
                <p>尚未設定任何允許的打卡位置</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-gray-200">
                    <tr>
                      <th className="py-3 px-4 w-10">
                        <input
                          type="checkbox"
                          checked={selectedLocationIds.size === allowedLocations.length && allowedLocations.length > 0}
                          onChange={toggleSelectAll}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </th>
                      <th className="text-left py-3 px-4 font-medium text-gray-900">位置名稱</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-900">座標</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-900">允許範圍</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-900">部門</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-900">工作時間</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-900">狀態</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-900">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allowedLocations.map((location) => (
                      <tr key={location.id} className={`border-b border-gray-100 ${selectedLocationIds.has(location.id) ? 'bg-blue-50' : ''}`}>
                        <td className="py-3 px-4">
                          <input
                            type="checkbox"
                            checked={selectedLocationIds.has(location.id)}
                            onChange={() => toggleSelectLocation(location.id)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2 text-gray-900">
                            <MapPin className="h-4 w-4 text-blue-500" />
                            {location.name}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-sm text-gray-900">
                          {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                        </td>
                        <td className="py-3 px-4 text-gray-900">
                          {location.radius}公尺
                        </td>
                        <td className="py-3 px-4 text-gray-900">
                          {location.department || '-'}
                        </td>
                        <td className="py-3 px-4 text-gray-900">
                          {location.workHours || '-'}
                        </td>
                        <td className="py-3 px-4">
                          <button
                            onClick={() => handleToggleLocationActive(location)}
                            className={`flex items-center gap-1 px-2 py-1 rounded text-sm ${
                              location.isActive 
                                ? 'text-green-700 bg-green-50 hover:bg-green-100' 
                                : 'text-red-700 bg-red-50 hover:bg-red-100'
                            } transition-colors`}
                            title={location.isActive ? '點擊停用' : '點擊啟用'}
                          >
                            {location.isActive ? (
                              <>
                                <ToggleRight className="h-4 w-4" />
                                啟用
                              </>
                            ) : (
                              <>
                                <ToggleLeft className="h-4 w-4" />
                                停用
                              </>
                            )}
                          </button>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => startEditLocation(location)}
                              className="text-blue-600 hover:text-blue-700 p-1"
                              title="編輯"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleCopyLocation(location)}
                              className="text-gray-600 hover:text-gray-700 p-1"
                              title="複製"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => showDeleteLocationConfirm(location)}
                              className="text-red-600 hover:text-red-700 p-1"
                              title="刪除"
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
        )}

        {/* GPS 权限管理 */}
        {activeTab === 'permissions' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <Settings className="h-5 w-5 mr-2" />
                GPS 打卡權限管理
              </h2>
              <div className="flex items-center gap-4">
                {/* 批量操作按鈕 */}
                {selectedPermissionIds.size > 0 && (
                  <div className="flex items-center gap-2 pr-4 border-r border-gray-300">
                    <span className="text-sm text-gray-600">已選 {selectedPermissionIds.size} 項：</span>
                    <button
                      onClick={() => handleBatchTogglePermissionActive(true)}
                      className="px-3 py-1.5 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
                    >
                      批量啟用
                    </button>
                    <button
                      onClick={() => handleBatchTogglePermissionActive(false)}
                      className="px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                    >
                      批量停用
                    </button>
                  </div>
                )}
                <button
                  onClick={() => {
                    resetPermissionForm();
                    setShowPermissionForm(true);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  新增權限配置
                </button>
              </div>
            </div>

            <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-start">
                <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5 mr-3" />
                <div>
                  <h4 className="font-medium text-yellow-900 mb-2">權限配置說明</h4>
                  <ul className="text-sm text-yellow-800 space-y-1">
                    <li>• 員工級別配置優先級高於部門級別配置</li>
                    <li>• 優先級數值越大，配置優先級越高</li>
                    <li>• 未配置的員工/部門預設啟用GPS打卡</li>
                    <li>• 可以為特定員工或整個部門停用GPS打卡功能</li>
                  </ul>
                </div>
              </div>
            </div>

            {gpsPermissions.length === 0 ? (
              <div className="text-center py-12 text-gray-900">
                <Settings className="h-12 w-12 mx-auto mb-2 opacity-30" />
                <p>尚未配置任何GPS權限設定</p>
                <p className="text-sm text-gray-500 mt-1">所有員工預設啟用GPS打卡功能</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-gray-200">
                    <tr>
                      <th className="py-3 px-4 w-10">
                        <input
                          type="checkbox"
                          checked={selectedPermissionIds.size === gpsPermissions.length && gpsPermissions.length > 0}
                          onChange={toggleSelectAllPermissions}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </th>
                      <th className="text-left py-3 px-4 font-medium text-gray-900">配置類型</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-900">目標</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-900">GPS狀態</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-900">優先級</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-900">原因</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-900">建立時間</th>
                      <th className="text-left py-3 px-4 font-medium text-gray-900">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gpsPermissions.map((permission) => (
                      <tr key={permission.id} className={`border-b border-gray-100 ${selectedPermissionIds.has(permission.id) ? 'bg-blue-50' : ''}`}>
                        <td className="py-3 px-4">
                          <input
                            type="checkbox"
                            checked={selectedPermissionIds.has(permission.id)}
                            onChange={() => toggleSelectPermission(permission.id)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            permission.employeeId 
                              ? 'bg-blue-100 text-blue-800' 
                              : 'bg-green-100 text-green-800'
                          }`}>
                            {permission.employeeId ? '員工' : '部門'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-gray-900">
                          {permission.employeeId ? (
                            <div>
                              <div className="font-medium">{permission.employeeName}</div>
                              <div className="text-sm text-gray-500">{permission.employeeCode}</div>
                            </div>
                          ) : (
                            <div className="font-medium">{permission.department}</div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <button
                            onClick={() => handleTogglePermissionActive(permission)}
                            className={`flex items-center gap-1 px-2 py-1 rounded text-sm ${
                              permission.isEnabled 
                                ? 'text-green-700 bg-green-50 hover:bg-green-100' 
                                : 'text-red-700 bg-red-50 hover:bg-red-100'
                            } transition-colors`}
                            title={permission.isEnabled ? '點擊停用' : '點擊啟用'}
                          >
                            {permission.isEnabled ? (
                              <>
                                <ToggleRight className="h-4 w-4" />
                                啟用
                              </>
                            ) : (
                              <>
                                <ToggleLeft className="h-4 w-4" />
                                停用
                              </>
                            )}
                          </button>
                        </td>
                        <td className="py-3 px-4 text-gray-900">
                          {permission.priority}
                        </td>
                        <td className="py-3 px-4 text-gray-900">
                          {permission.reason || '-'}
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-500">
                          {new Date(permission.createdAt).toLocaleDateString('zh-TW')}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => startEditPermission(permission)}
                              className="text-blue-600 hover:text-blue-700 p-1"
                              title="編輯"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleCopyPermission(permission)}
                              className="text-gray-600 hover:text-gray-700 p-1"
                              title="複製"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => showDeletePermissionConfirm(permission)}
                              className="text-red-600 hover:text-red-700 p-1"
                              title="刪除"
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
        )}
      </div>

      {/* 位置表單模態框 */}
      {showLocationForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 overflow-y-auto flex-1">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {editingLocation ? '編輯位置' : '新增位置'}
              </h3>

              <div className="space-y-4">
                {/* 位置名稱 */}
                <div>
                  <label className="block text-sm font-medium text-black mb-1">
                    位置名稱
                  </label>
                  <input
                    type="text"
                    value={locationForm.name}
                    onChange={(e) => setLocationForm(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    placeholder="例如：總公司、分店A"
                    required
                  />
                </div>

                {/* GPS座標 */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-black mb-1">
                      緯度
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={locationForm.latitude}
                      onChange={(e) => setLocationForm(prev => ({ ...prev, latitude: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-black mb-1">
                      經度
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={locationForm.longitude}
                      onChange={(e) => setLocationForm(prev => ({ ...prev, longitude: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                      required
                    />
                  </div>
                </div>

                {/* 獲取當前位置按鈕 */}
                <button
                  onClick={getCurrentLocation}
                  type="button"
                  className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
                >
                  <Wifi className="h-4 w-4" />
                  使用當前位置
                </button>

                {/* 允許範圍 */}
                <div>
                  <label className="block text-sm font-medium text-black mb-1">
                    允許範圍 (公尺)
                  </label>
                  <input
                    type="number"
                    value={locationForm.radius}
                    onChange={(e) => setLocationForm(prev => ({ ...prev, radius: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    min="10"
                    max="1000"
                    required
                  />
                </div>

                {/* 部門限制 */}
                <div>
                  <label className="block text-sm font-medium text-black mb-1">
                    適用部門 (選填)
                  </label>
                  <select
                    value={locationForm.department}
                    onChange={(e) => setLocationForm(prev => ({ ...prev, department: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-black"
                  >
                    <option value="">所有部門</option>
                    {DEPARTMENT_OPTIONS.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 工作時間 */}
                <div>
                  <label className="block text-sm font-medium text-black mb-1">
                    工作時間 (選填)
                  </label>
                  <input
                    type="text"
                    value={locationForm.workHours}
                    onChange={(e) => setLocationForm(prev => ({ ...prev, workHours: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    placeholder="例如：08:00-17:00"
                  />
                </div>

                {/* WiFi SSID 輔助驗證設定 */}
                <div className="border-t border-gray-200 pt-4 mt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Wifi className="h-5 w-5 text-blue-500" />
                    <h4 className="font-medium text-gray-900">WiFi 輔助驗證設定</h4>
                  </div>

                  {/* 啟用 WiFi 驗證 */}
                  <div className="flex items-center mb-3">
                    <input
                      type="checkbox"
                      id="wifiEnabled"
                      checked={locationForm.wifiEnabled}
                      onChange={(e) => setLocationForm(prev => ({ ...prev, wifiEnabled: e.target.checked }))}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="wifiEnabled" className="ml-2 text-sm text-gray-900">
                      啟用 WiFi SSID 輔助驗證
                    </label>
                  </div>

                  {locationForm.wifiEnabled && (
                    <>
                      {/* WiFi SSID 列表 */}
                      <div className="mb-3">
                        <label className="block text-sm font-medium text-black mb-1">
                          允許的 WiFi 名稱 (SSID)
                        </label>
                        <textarea
                          value={locationForm.wifiSsidList}
                          onChange={(e) => setLocationForm(prev => ({ ...prev, wifiSsidList: e.target.value }))}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                          placeholder="輸入 WiFi 名稱，每行一個&#10;例如：&#10;Company-WiFi&#10;Office-5G&#10;Meeting-Room"
                          rows={3}
                        />
                        <p className="text-xs text-gray-500 mt-1">每行輸入一個 WiFi 名稱，員工打卡時需手動確認所連接的 WiFi</p>
                      </div>

                      {/* 僅 WiFi 驗證模式 */}
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          id="wifiOnly"
                          checked={locationForm.wifiOnly}
                          onChange={(e) => setLocationForm(prev => ({ ...prev, wifiOnly: e.target.checked }))}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <label htmlFor="wifiOnly" className="ml-2 text-sm text-gray-900">
                          僅使用 WiFi 驗證（不需 GPS 定位）
                        </label>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 ml-6">適用於 GPS 訊號不佳的室內環境</p>
                    </>
                  )}
                </div>

                {/* 啟用狀態 */}
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={locationForm.isActive}
                    onChange={(e) => setLocationForm(prev => ({ ...prev, isActive: e.target.checked }))}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="isActive" className="ml-2 text-sm text-gray-900">
                    啟用此位置
                  </label>
                </div>
              </div>
            </div>

            {/* 按鈕 - 固定在底部 */}
            <div className="flex gap-3 p-6 pt-0 border-t border-gray-200 bg-white">
              <button
                onClick={() => {
                  setShowLocationForm(false);
                  resetLocationForm();
                }}
                className="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-400 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSaveLocation}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                {editingLocation ? '更新' : '新增'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GPS权限配置表單模態框 */}
      {showPermissionForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {editingPermission ? '編輯GPS權限' : '新增GPS權限配置'}
              </h3>

              <div className="space-y-4">
                {/* 配置类型 */}
                <div>
                  <label className="block text-sm font-medium text-black mb-1">
                    配置類型
                  </label>
                  <div className="flex gap-4">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="permissionType"
                        value="department"
                        checked={permissionForm.type === 'department'}
                        onChange={(e) => setPermissionForm(prev => ({ 
                          ...prev, 
                          type: e.target.value as 'employee' | 'department',
                          employeeId: '',
                          employeeName: '',
                          employeeCode: ''
                        }))}
                        className="mr-2"
                      />
                      <span className="text-black">部門配置</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="permissionType"
                        value="employee"
                        checked={permissionForm.type === 'employee'}
                        onChange={(e) => setPermissionForm(prev => ({ 
                          ...prev, 
                          type: e.target.value as 'employee' | 'department',
                          department: ''
                        }))}
                        className="mr-2"
                      />
                      <span className="text-black">員工配置</span>
                    </label>
                  </div>
                </div>

                {/* 部门选择 */}
                {permissionForm.type === 'department' && (
                  <div>
                    <label className="block text-sm font-medium text-black mb-1">
                      部門
                    </label>
                    <select
                      value={permissionForm.department}
                      onChange={(e) => setPermissionForm(prev => ({ ...prev, department: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-black"
                      required
                    >
                      <option value="">請選擇部門</option>
                      {DEPARTMENT_OPTIONS.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* 员工选择 */}
                {permissionForm.type === 'employee' && (
                  <div>
                    <label className="block text-sm font-medium text-black mb-1">
                      員工
                    </label>
                    <div className="relative">
                      <div 
                        onClick={() => setShowEmployeeSelector(true)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-black cursor-pointer min-h-[42px] flex items-center justify-between"
                      >
                        {permissionForm.employeeId ? (
                          <div>
                            <span className="font-medium">{permissionForm.employeeName}</span>
                            <span className="text-gray-500 ml-2">({permissionForm.employeeCode})</span>
                          </div>
                        ) : (
                          <span className="text-gray-400">點擊選擇員工</span>
                        )}
                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                  </div>
                )}

                {/* GPS状态 */}
                <div>
                  <label className="block text-sm font-medium text-black mb-1">
                    GPS打卡狀態
                  </label>
                  <select
                    value={permissionForm.isEnabled ? 'enabled' : 'disabled'}
                    onChange={(e) => setPermissionForm(prev => ({ ...prev, isEnabled: e.target.value === 'enabled' }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-black"
                  >
                    <option value="enabled">啟用GPS打卡</option>
                    <option value="disabled">停用GPS打卡</option>
                  </select>
                </div>

                {/* 优先级 */}
                <div>
                  <label className="block text-sm font-medium text-black mb-1">
                    優先級
                  </label>
                  <input
                    type="number"
                    value={permissionForm.priority || '1'}
                    onChange={(e) => {
                      const value = parseInt(e.target.value);
                      setPermissionForm(prev => ({ 
                        ...prev, 
                        priority: isNaN(value) ? '1' : value.toString()
                      }));
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    min="0"
                    max="100"
                    placeholder="0-100，數值越大優先級越高"
                  />
                </div>

                {/* 原因说明 */}
                <div>
                  <label className="block text-sm font-medium text-black mb-1">
                    配置原因 (選填)
                  </label>
                  <textarea
                    value={permissionForm.reason}
                    onChange={(e) => setPermissionForm(prev => ({ ...prev, reason: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    rows={3}
                    placeholder="例如：遠距工作、臨時調整等"
                  />
                </div>
              </div>

              {/* 按鈕 */}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowPermissionForm(false);
                    resetPermissionForm();
                  }}
                  className="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-400 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSavePermission}
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {editingPermission ? '更新' : '新增'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 員工選擇器模態框 */}
      {showEmployeeSelector && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">選擇員工</h3>
                <button
                  onClick={() => {
                    setShowEmployeeSelector(false);
                    setEmployeeSearchTerm('');
                    setSelectedDepartment('');
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* 搜尋和篩選 */}
              <div className="flex gap-3 mb-4">
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="搜尋員工姓名、員工編號或部門..."
                    value={employeeSearchTerm}
                    onChange={(e) => setEmployeeSearchTerm(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                  />
                </div>
                <select
                  value={selectedDepartment}
                  onChange={(e) => setSelectedDepartment(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-black"
                >
                  <option value="">所有部門</option>
                  {DEPARTMENT_OPTIONS.map((dept) => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>

              {/* 統計資訊 */}
              <div className="text-sm text-gray-500">
                共找到 {getFilteredEmployees().length} 名員工
                {employeeSearchTerm && ` (搜尋: "${employeeSearchTerm}")`}
                {selectedDepartment && ` (部門: ${selectedDepartment})`}
              </div>
            </div>

            {/* 員工清單 */}
            <div className="flex-1 overflow-y-auto p-6">
              {Object.keys(getEmployeesByDepartment()).length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <svg className="w-12 h-12 mx-auto mb-2 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  沒有找到符合條件的員工
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(getEmployeesByDepartment()).map(([department, departmentEmployees]) => (
                    <div key={department} className="border border-gray-200 rounded-lg">
                      {/* 部門標題 */}
                      <div 
                        className="flex items-center justify-between p-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={() => toggleDepartment(department)}
                      >
                        <div className="flex items-center">
                          <svg 
                            className={`w-4 h-4 mr-2 transition-transform ${expandedDepartments.has(department) ? 'rotate-90' : ''}`} 
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          <span className="font-medium text-gray-900">{department}</span>
                          <span className="ml-2 text-sm text-gray-500">({departmentEmployees.length}人)</span>
                        </div>
                      </div>

                      {/* 員工清單 */}
                      {expandedDepartments.has(department) && (
                        <div className="divide-y divide-gray-100">
                          {departmentEmployees.map((employee) => (
                            <div
                              key={employee.id}
                              onClick={() => selectEmployee(employee)}
                              className="p-3 hover:bg-blue-50 cursor-pointer transition-colors flex items-center justify-between"
                            >
                              <div className="flex items-center">
                                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-3">
                                  <span className="text-blue-600 font-medium text-sm">
                                    {employee.name.charAt(0)}
                                  </span>
                                </div>
                                <div>
                                  <div className="font-medium text-gray-900">{employee.name}</div>
                                  <div className="text-sm text-gray-500">員工編號: {employee.code}</div>
                                </div>
                              </div>
                              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 底部按鈕 */}
            <div className="p-6 border-t border-gray-200">
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowEmployeeSelector(false);
                    setEmployeeSearchTerm('');
                    setSelectedDepartment('');
                  }}
                  className="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-400 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    // 自動展開所有部門以便快速瀏覽
                    const allDepts = new Set(Object.keys(getEmployeesByDepartment()));
                    setExpandedDepartments(allDepts);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  展開所有部門
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Toast 訊息 */}
      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 ${
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.type === 'success' ? <CheckCircle className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
          {toast.message}
        </div>
      )}

      {/* 刪除確認對話框（位置） */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center text-red-600 mb-4">
              <AlertTriangle className="w-8 h-8 mr-3" />
              <h3 className="text-xl font-semibold">確認刪除</h3>
            </div>
            <p className="text-gray-600 mb-6">
              確定要刪除位置「{deleteConfirm.name}」嗎？此操作無法復原。
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleDeleteLocation}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                確認刪除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 刪除確認對話框（權限） */}
      {deletePermissionConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center text-red-600 mb-4">
              <AlertTriangle className="w-8 h-8 mr-3" />
              <h3 className="text-xl font-semibold">確認刪除權限</h3>
            </div>
            <p className="text-gray-600 mb-6">
              確定要刪除「{deletePermissionConfirm.name}」的權限設定嗎？此操作無法復原。
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setDeletePermissionConfirm(null)}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleDeletePermission}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                確認刪除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
