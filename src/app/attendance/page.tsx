'use client';

import { useState, useEffect } from 'react';
import { Clock, Calendar, BarChart3, History, Timer, CheckCircle, XCircle, User, Lock, Eye, EyeOff, MapPin, Wifi, WifiOff, AlertCircle } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';

interface AttendanceRecord {
  id: number;
  workDate: string;
  clockInTime: string | null;
  clockOutTime: string | null;
  regularHours: number | null;
  overtimeHours: number | null;
  status: string;
}

interface TodayAttendance {
  hasClockIn: boolean;
  hasClockOut: boolean;
  today: AttendanceRecord | null;
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

interface LocationData {
  latitude: number;
  longitude: number;
  accuracy: number;
  address?: string;
}

interface AllowedLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  isActive: boolean;
  // WiFi SSID 輔助驗證欄位
  wifiSsidList?: string;
  wifiEnabled?: boolean;
  wifiOnly?: boolean;
}

type LocationStatus = 'checking' | 'valid' | 'invalid' | 'error' | 'disabled';

export default function AttendancePage() {
  const [todayStatus, setTodayStatus] = useState<TodayAttendance | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [clockLoading, setClockLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [pendingClockType, setPendingClockType] = useState<'in' | 'out' | null>(null);
  const [verificationData, setVerificationData] = useState({
    username: '',
    password: ''
  });
  const [showPassword, setShowPassword] = useState(false);

  // GPS 相關狀態
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('checking');
  const [currentLocation, setCurrentLocation] = useState<LocationData | null>(null);
  const [allowedLocations, setAllowedLocations] = useState<AllowedLocation[]>([]);
  const [isLocationRequired, setIsLocationRequired] = useState(true);
  const [locationError, setLocationError] = useState<string>('');

  // WiFi SSID 驗證狀態
  const [showWifiSelector, setShowWifiSelector] = useState(false);
  const [availableWifiSsids, setAvailableWifiSsids] = useState<string[]>([]);
  const [selectedWifiSsid, setSelectedWifiSsid] = useState<string>('');
  const [wifiVerificationRequired, setWifiVerificationRequired] = useState(false);
  const [wifiOnlyMode, setWifiOnlyMode] = useState(false);

  // Toast 通知狀態
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);

  const showToast = (type: 'success' | 'error' | 'warning', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 5000);
  };

  useEffect(() => {
    // 設定頁面標題
    document.title = '打卡系統 - 長福會考勤系統';
    
    loadTodayStatus();
    loadAllowedLocations();
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // GPS 相關函數
  const getCurrentPosition = (): Promise<LocationData> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('瀏覽器不支援GPS定位功能'));
        return;
      }

      // 檢查權限狀態 (如果瀏覽器支援)
      if ('permissions' in navigator) {
        navigator.permissions.query({ name: 'geolocation' }).then((result) => {
          if (result.state === 'denied') {
            reject(new Error('GPS定位權限被拒絕。請在瀏覽器設定中允許此網站使用位置資訊，然後重新整理頁面。'));
            return;
          }
        }).catch(() => {
          // 忽略權限查詢錯誤，繼續嘗試定位
        });
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy
          });
        },
        (error) => {
          let errorMessage = 'GPS定位失敗';
          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = 'GPS定位權限被拒絕。請允許瀏覽器存取您的位置資訊：\n1. 點擊瀏覽器網址列旁的位置圖示\n2. 選擇「允許」或「Always allow」\n3. 重新整理頁面後再試';
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = 'GPS位置信息不可用。請確認：\n1. 設備的GPS功能已開啟\n2. 在室外或靠近窗戶的位置\n3. 網路連線正常';
              break;
            case error.TIMEOUT:
              errorMessage = 'GPS定位超時。請稍後再試或：\n1. 移動到訊號較好的位置\n2. 重新整理頁面\n3. 確認GPS功能正常運作';
              break;
          }
          reject(new Error(errorMessage));
        },
        {
          enableHighAccuracy: true,
          timeout: 15000, // 延長超時時間到15秒
          maximumAge: 30000 // 縮短快取時間到30秒
        }
      );
    });
  };

  const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371000; // 地球半徑（米）
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const isWithinAllowedRange = (lat: number, lng: number): { isValid: boolean; nearestLocation?: AllowedLocation; distance?: number } => {
    if (!allowedLocations.length) {
      return { isValid: true }; // 如果沒有設定允許位置，則允許所有位置
    }

    let nearestLocation: AllowedLocation | undefined;
    let minDistance = Infinity;

    for (const location of allowedLocations) {
      if (!location.isActive) continue;
      
      const distance = calculateDistance(lat, lng, location.latitude, location.longitude);
      
      if (distance <= location.radius) {
        return { isValid: true, nearestLocation: location, distance };
      }
      
      if (distance < minDistance) {
        minDistance = distance;
        nearestLocation = location;
      }
    }

    return { isValid: false, nearestLocation, distance: minDistance };
  };

  const loadAllowedLocations = async () => {
    try {
      const response = await fetch('/api/attendance/allowed-locations', {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        const locations = data.locations || [];
        setAllowedLocations(locations);
        setIsLocationRequired(data.isRequired || false);

        // 解析 WiFi 設定
        const allSsids: string[] = [];
        let hasWifiEnabled = false;
        let hasWifiOnly = false;

        for (const location of locations) {
          if (location.wifiEnabled && location.wifiSsidList) {
            hasWifiEnabled = true;
            if (location.wifiOnly) {
              hasWifiOnly = true;
            }
            // 解析 SSID 列表（每行一個）
            const ssids = location.wifiSsidList
              .split('\n')
              .map((s: string) => s.trim())
              .filter((s: string) => s.length > 0);
            allSsids.push(...ssids);
          }
        }

        // 去除重複的 SSID
        const uniqueSsids = [...new Set(allSsids)];
        setAvailableWifiSsids(uniqueSsids);
        setWifiVerificationRequired(hasWifiEnabled);
        setWifiOnlyMode(hasWifiOnly);
      }
    } catch (error) {
      console.error('載入允許位置失敗:', error);
    }
  };

  const checkLocation = async (): Promise<boolean> => {
    try {
      // 獲取GPS設定
      const gpsSettingsResponse = await fetch('/api/system-settings/gps-attendance');
      let gpsSettings = {
        enabled: true,
        requiredAccuracy: 50,
        allowOfflineMode: false,
        requireAddressInfo: true
      };
      
      if (gpsSettingsResponse.ok) {
        const data = await gpsSettingsResponse.json();
        gpsSettings = data.settings;
      }

      if (!gpsSettings.enabled) {
        setLocationStatus('disabled');
        setIsLocationRequired(false);
        return true;
      }

      setIsLocationRequired(true);
      setLocationStatus('checking');
      setLocationError('');
      
      const position = await getCurrentPosition();
      
      // 檢查GPS精確度
      if (position.accuracy > gpsSettings.requiredAccuracy) {
        setLocationStatus('invalid');
        setLocationError(`GPS精確度不足（${Math.round(position.accuracy)}m > ${gpsSettings.requiredAccuracy}m），請移動到GPS訊號較好的位置`);
        return false;
      }

      // 檢查地址資訊
      if (gpsSettings.requireAddressInfo && !position.address) {
        setLocationStatus('invalid');
        setLocationError('無法取得位置地址資訊，請稍後再試');
        return false;
      }

      setCurrentLocation(position);
      
      const locationCheck = isWithinAllowedRange(position.latitude, position.longitude);
      
      if (locationCheck.isValid) {
        setLocationStatus('valid');
        return true;
      } else {
        setLocationStatus('invalid');
        const distance = locationCheck.distance ? Math.round(locationCheck.distance) : 0;
        const nearestName = locationCheck.nearestLocation?.name || '允許地點';
        setLocationError(`您不在允許的打卡範圍內。距離最近的${nearestName}約${distance}米`);
        return false;
      }
    } catch (error) {
      setLocationStatus('error');
      setLocationError(error instanceof Error ? error.message : 'GPS定位失敗');
      return false;
    }
  };

  const loadTodayStatus = async () => {
    try {
      console.log('🔄 載入打卡狀態...');
      
      // 首先檢查登入狀態
      const authResponse = await fetch('/api/auth/me', {
        credentials: 'include'
      });
      
      if (!authResponse.ok) {
        console.log('❌ 用戶未登入，重導向到登入頁');
        window.location.href = '/login';
        return;
      }
      
      const userData = await authResponse.json();
      console.log('✅ 用戶已登入:', userData.user?.username);
      setUser(userData.user);

      const response = await fetch('/api/attendance/clock', {
        credentials: 'include', // 確保包含 cookies
      });
      
      console.log('📡 打卡 API 回應狀態:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ 打卡狀態載入成功:', data);
        setTodayStatus(data);
      } else {
        console.error('❌ 載入打卡狀態失敗:', response.status);
        if (response.status === 401) {
          // 如果是 401，重導向到登入頁
          console.log('🔄 重導向到登入頁');
          window.location.href = '/login';
        }
      }
    } catch (error) {
      console.error('💥 載入打卡狀態失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleClock = async (type: 'in' | 'out') => {
    // 檢查是否需要 WiFi 驗證
    if (wifiVerificationRequired && availableWifiSsids.length > 0) {
      // 如果是「僅 WiFi」模式，跳過 GPS 驗證
      if (wifiOnlyMode) {
        // 顯示 WiFi 選擇器
        setShowWifiSelector(true);
        setPendingClockType(type);
        return;
      }
      
      // 如果是「GPS + WiFi」模式，先檢查 GPS
      if (isLocationRequired) {
        const locationValid = await checkLocation();
        if (!locationValid) {
          showToast('error', `打卡失敗：${locationError}`);
          return;
        }
      }
      
      // GPS 通過後，顯示 WiFi 選擇器
      setShowWifiSelector(true);
      setPendingClockType(type);
      return;
    }

    // 沒有 WiFi 驗證需求，僅做 GPS 驗證
    if (isLocationRequired) {
      const locationValid = await checkLocation();
      if (!locationValid) {
        showToast('error', `打卡失敗：${locationError}`);
        return;
      }
    }

    // 顯示驗證對話框
    setPendingClockType(type);
    setShowVerificationModal(true);
  };

  // WiFi 選擇後的處理
  const handleWifiSelected = () => {
    if (!selectedWifiSsid) {
      showToast('warning', '請選擇您目前連接的 WiFi 網路');
      return;
    }

    // 驗證選擇的 WiFi 是否在允許列表中
    if (!availableWifiSsids.includes(selectedWifiSsid)) {
      showToast('error', '您選擇的 WiFi 不在允許的範圍內，請確認您已連接到公司 WiFi');
      return;
    }

    // WiFi 驗證通過，顯示打卡確認
    setShowWifiSelector(false);
    setShowVerificationModal(true);
  };

  const handleWifiCancel = () => {
    setShowWifiSelector(false);
    setPendingClockType(null);
    setSelectedWifiSsid('');
  };

  const handleVerificationSubmit = async () => {
    if (!pendingClockType) return;
    
    setClockLoading(true);
    setShowVerificationModal(false);
    
    try {
      // 準備打卡數據，包含GPS位置信息
      const clockData: {
        username: string;
        password: string;
        clockType: 'in' | 'out';
        location?: LocationData;
      } = {
        username: verificationData.username,
        password: verificationData.password,
        clockType: pendingClockType
      };

      // 如果有GPS位置數據，加入到請求中
      if (currentLocation) {
        clockData.location = {
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude,
          accuracy: currentLocation.accuracy,
          address: currentLocation.address
        };
      }

      // 使用專用的打卡驗證 API
      const response = await fetchJSONWithCSRF('/api/attendance/verify-clock', {
        method: 'POST',
        body: clockData
      });

      const data = await response.json();
      
      if (response.ok) {
        showToast('success', data.message);
        loadTodayStatus();
      } else {
        showToast('error', data.error || '打卡失敗');
      }
    } catch (error) {
      console.error('打卡系統錯誤:', error);
      showToast('error', '系統錯誤，請稍後再試');
    } finally {
      setClockLoading(false);
      setPendingClockType(null);
      setVerificationData({ username: '', password: '' });
    }
  };

  const handleVerificationCancel = () => {
    setShowVerificationModal(false);
    setPendingClockType(null);
    setVerificationData({ username: '', password: '' });
  };

  const formatTime = (time: Date) => {
    return time.toLocaleTimeString('zh-TW', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('zh-TW', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* 頁面標題 */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 flex items-center">
              <Clock className="mr-3 h-8 w-8" />
              打卡管理
            </h1>
            <p className="mt-2 text-gray-600">管理您的上下班打卡和考勤記錄</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* 打卡區域 */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-2xl shadow-lg p-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center">
                  <Timer className="mr-2 h-6 w-6" />
                  今日打卡
                </h2>

                {/* 當前時間顯示 */}
                <div className="text-center mb-8">
                  <div className="text-6xl font-mono font-bold text-blue-600 mb-2">
                    {formatTime(currentTime)}
                  </div>
                  <div className="text-xl text-gray-600">
                    {currentTime.toLocaleDateString('zh-TW', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      weekday: 'long'
                    })}
                  </div>
                </div>

                {/* GPS 位置狀態 */}
                {isLocationRequired && (
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">位置驗證</span>
                      <button
                        onClick={checkLocation}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        重新檢查
                      </button>
                    </div>
                    
                    <div className={`p-3 rounded-lg border-2 ${
                      locationStatus === 'checking' ? 'bg-blue-50 border-blue-200' :
                      locationStatus === 'valid' ? 'bg-green-50 border-green-200' :
                      locationStatus === 'invalid' ? 'bg-red-50 border-red-200' :
                      locationStatus === 'error' ? 'bg-yellow-50 border-yellow-200' :
                      'bg-gray-50 border-gray-200'
                    }`}>
                      <div className="flex items-center space-x-2">
                        {locationStatus === 'checking' && (
                          <>
                            <Wifi className="w-4 h-4 text-blue-600 animate-pulse" />
                            <span className="text-sm text-blue-700">正在獲取位置信息...</span>
                          </>
                        )}
                        {locationStatus === 'valid' && (
                          <>
                            <MapPin className="w-4 h-4 text-green-600" />
                            <span className="text-sm text-green-700">位置驗證通過，可以打卡</span>
                          </>
                        )}
                        {locationStatus === 'invalid' && (
                          <>
                            <AlertCircle className="w-4 h-4 text-red-600" />
                            <span className="text-sm text-red-700">不在允許的打卡範圍內</span>
                          </>
                        )}
                        {locationStatus === 'error' && (
                          <>
                            <WifiOff className="w-4 h-4 text-yellow-600" />
                            <span className="text-sm text-yellow-700">GPS定位失敗</span>
                          </>
                        )}
                        {locationStatus === 'disabled' && (
                          <>
                            <MapPin className="w-4 h-4 text-gray-600" />
                            <span className="text-sm text-gray-700">位置驗證已關閉</span>
                          </>
                        )}
                      </div>
                      
                      {locationError && (
                        <div className="text-xs text-gray-600 mt-1">
                          {locationError}
                        </div>
                      )}
                      
                      {currentLocation && locationStatus === 'valid' && (
                        <div className="text-xs text-gray-600 mt-1">
                          精度: ±{Math.round(currentLocation.accuracy)}米
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 打卡按鈕 */}
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="space-y-2">
                    <button
                      onClick={() => handleClock('in')}
                      disabled={clockLoading}
                      className={`w-full py-4 px-6 rounded-xl text-lg font-medium transition-all ${
                        todayStatus?.hasClockIn
                          ? 'bg-green-600 text-white shadow-lg border-2 border-green-200'
                          : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-xl transform hover:-translate-y-1'
                      }`}
                    >
                      {todayStatus?.hasClockIn ? (
                        <>
                          <CheckCircle className="w-6 h-6 mx-auto mb-2" />
                          已上班打卡
                        </>
                      ) : (
                        <>
                          <Clock className="w-6 h-6 mx-auto mb-2" />
                          上班打卡
                        </>
                      )}
                    </button>
                    {todayStatus?.today?.clockInTime && (
                      <div className="text-center text-sm text-black bg-green-50 py-2 px-3 rounded-lg">
                        打卡時間: {formatDateTime(todayStatus.today.clockInTime)}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <button
                      onClick={() => handleClock('out')}
                      disabled={clockLoading}
                      className={`w-full py-4 px-6 rounded-xl text-lg font-medium transition-all ${
                        todayStatus?.hasClockOut
                          ? 'bg-red-600 text-white shadow-lg border-2 border-red-200'
                          : 'bg-red-600 hover:bg-red-700 text-white shadow-lg hover:shadow-xl transform hover:-translate-y-1'
                      }`}
                    >
                      {todayStatus?.hasClockOut ? (
                        <>
                          <CheckCircle className="w-6 h-6 mx-auto mb-2" />
                          已下班打卡
                        </>
                      ) : (
                        <>
                          <XCircle className="w-6 h-6 mx-auto mb-2" />
                          下班打卡
                        </>
                      )}
                    </button>
                    {todayStatus?.today?.clockOutTime && (
                      <div className="text-center text-sm text-black bg-gray-50 py-2 px-3 rounded-lg">
                        打卡時間: {formatDateTime(todayStatus.today.clockOutTime)}
                      </div>
                    )}
                  </div>
                </div>

                {/* 今日打卡記錄 */}
                {todayStatus?.today && (
                  <div className="bg-gray-50 rounded-xl p-4">
                    <h3 className="font-medium text-gray-900 mb-3">今日記錄</h3>
                    <div className="grid grid-cols-2 gap-4 text-base">
                      <div>
                        <span className="text-gray-600">上班時間：</span>
                        <span className="font-medium text-black">
                          {todayStatus.today.clockInTime 
                            ? formatDateTime(todayStatus.today.clockInTime)
                            : '未打卡'
                          }
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">下班時間：</span>
                        <span className="font-medium text-black">
                          {todayStatus.today.clockOutTime 
                            ? formatDateTime(todayStatus.today.clockOutTime)
                            : '未打卡'
                          }
                        </span>
                      </div>
                      {todayStatus.today.regularHours !== null && (
                        <>
                          <div>
                            <span className="text-gray-600">正常工時：</span>
                            <span className="font-medium text-blue-600 text-lg">
                              {todayStatus.today.regularHours} 小時
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-600">加班工時：</span>
                            <span className="font-medium text-orange-600 text-lg">
                              {todayStatus.today.overtimeHours} 小時
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 快速操作區域 */}
            <div className="space-y-6">
              {/* 功能按鈕 */}
              <div className="bg-white rounded-2xl shadow-lg p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">快速操作</h3>
                <div className="space-y-3">
                  <a
                    href="/attendance/records"
                    className="flex items-center p-3 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <History className="w-5 h-5 text-blue-600 mr-3" />
                    <span className="font-medium text-gray-900">考勤記錄</span>
                  </a>
                  <a
                    href="/missed-clock"
                    className="flex items-center p-3 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <AlertCircle className="w-5 h-5 text-orange-600 mr-3" />
                    <span className="font-medium text-gray-900">忘打卡申請</span>
                  </a>
                  <a
                    href="/attendance/stats"
                    className="flex items-center p-3 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <BarChart3 className="w-5 h-5 text-green-600 mr-3" />
                    <span className="font-medium text-gray-900">統計報表</span>
                  </a>
                  <a
                    href="/dashboard"
                    className="flex items-center p-3 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <Calendar className="w-5 h-5 text-purple-600 mr-3" />
                    <span className="font-medium text-gray-900">返回儀表板</span>
                  </a>
                </div>
              </div>

              {/* 考勤提醒 */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-200">
                <h3 className="text-lg font-bold text-blue-900 mb-3">考勤提醒</h3>
                <div className="space-y-2 text-sm text-blue-800">
                  <p>• 系統支援靈活打卡，可隨時上下班打卡</p>
                  <p>• 忘記打卡可透過「忘打卡申請」補登</p>
                  <p>• 系統會根據時間智能建議打卡類型</p>
                  <p>• 考勤記錄可隨時查詢和統計</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* WiFi 選擇器對話框 */}
      {showWifiSelector && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex items-center justify-center mb-4">
              <Wifi className="w-8 h-8 text-blue-500" />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-4 text-center">
              WiFi 驗證
            </h3>
            
            <p className="text-gray-600 mb-6 text-center">
              請選擇您目前連接的 WiFi 網路名稱
            </p>

            <div className="space-y-3 mb-6">
              {availableWifiSsids.map((ssid, index) => (
                <label
                  key={index}
                  className={`flex items-center p-3 rounded-lg border-2 cursor-pointer transition-all ${
                    selectedWifiSsid === ssid
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="wifiSsid"
                    value={ssid}
                    checked={selectedWifiSsid === ssid}
                    onChange={(e) => setSelectedWifiSsid(e.target.value)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                  />
                  <Wifi className="w-4 h-4 text-gray-500 mx-3" />
                  <span className="text-gray-900 font-medium">{ssid}</span>
                </label>
              ))}
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-6">
              <p className="text-sm text-yellow-800">
                <AlertCircle className="w-4 h-4 inline mr-1" />
                請確認您的裝置已連接到上述 WiFi 網路後再選擇
              </p>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={handleWifiCancel}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 px-4 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleWifiSelected}
                disabled={!selectedWifiSsid}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg transition-colors"
              >
                確認
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 打卡驗證對話框 */}
      {showVerificationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
            <h3 className="text-2xl font-bold text-gray-900 mb-6 text-center">
              {pendingClockType === 'in' ? '上班打卡' : '下班打卡'}確認
            </h3>
            
            <p className="text-gray-600 mb-6 text-center">
              為確保打卡安全性，請輸入您的帳號密碼進行驗證
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">帳號</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="text"
                    value={verificationData.username}
                    onChange={(e) => setVerificationData({
                      ...verificationData,
                      username: e.target.value
                    })}
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                    placeholder="請輸入您的帳號"
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">密碼</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={verificationData.password}
                    onChange={(e) => setVerificationData({
                      ...verificationData,
                      password: e.target.value
                    })}
                    className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                    placeholder="請輸入您的密碼"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        handleVerificationSubmit();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2"
                  >
                    {showPassword ? 
                      <EyeOff className="w-5 h-5 text-gray-400" /> : 
                      <Eye className="w-5 h-5 text-gray-400" />
                    }
                  </button>
                </div>
              </div>
            </div>

            <div className="flex space-x-3 mt-6">
              <button
                onClick={handleVerificationCancel}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 px-4 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleVerificationSubmit}
                disabled={!verificationData.username || !verificationData.password || clockLoading}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg transition-colors"
              >
                {clockLoading ? '打卡中...' : '確認打卡'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast 通知 */}
      {toast && (
        <div className={`fixed bottom-4 right-4 px-6 py-4 rounded-lg shadow-lg z-50 max-w-md animate-in slide-in-from-right ${
          toast.type === 'success' ? 'bg-green-600' : 
          toast.type === 'warning' ? 'bg-yellow-500' : 
          'bg-red-600'
        } text-white`}>
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <p className="font-medium">{toast.message}</p>
            </div>
            <button 
              onClick={() => setToast(null)}
              className="text-white/80 hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </AuthenticatedLayout>
  );
}
