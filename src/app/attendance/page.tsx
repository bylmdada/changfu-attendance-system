'use client';

import { useState, useEffect, useCallback } from 'react';
import { Clock, Calendar, BarChart3, History, Timer, CheckCircle, XCircle, User, Lock, Eye, EyeOff, MapPin, Wifi, WifiOff, AlertCircle, Fingerprint } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import { isMobileClockingDevice, MOBILE_CLOCKING_REQUIRED_MESSAGE } from '@/lib/device-detection';

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

interface GPSSettings {
  enabled: boolean;
  requiredAccuracy: number;
  allowOfflineMode: boolean;
  maxDistanceVariance: number;
  verificationTimeout: number;
  requireAddressInfo: boolean;
}

type LocationStatus = 'checking' | 'valid' | 'invalid' | 'error' | 'disabled';

interface LocationCheckResult {
  isValid: boolean;
  error?: string;
  location?: LocationData;
}

export default function AttendancePage() {
  const [todayStatus, setTodayStatus] = useState<TodayAttendance | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [clockLoading, setClockLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState<Date | null>(null); // 避免 hydration 錯誤
  const [mounted, setMounted] = useState(false); // 追蹤是否已掛載
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
  const [gpsSettings, setGpsSettings] = useState<GPSSettings>({
    enabled: true,
    requiredAccuracy: 50,
    allowOfflineMode: false,
    maxDistanceVariance: 20,
    verificationTimeout: 30,
    requireAddressInfo: true,
  });

  // WiFi SSID 驗證狀態
  const [showWifiSelector, setShowWifiSelector] = useState(false);
  const [availableWifiSsids, setAvailableWifiSsids] = useState<string[]>([]);
  const [selectedWifiSsid, setSelectedWifiSsid] = useState<string>('');
  const [wifiVerificationRequired, setWifiVerificationRequired] = useState(false);
  const [, setWifiOnlyMode] = useState(false);

  // Toast 通知狀態
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null);

  // 手機版優化狀態
  const [gpsProgress, setGpsProgress] = useState(0);
  const [isGpsChecking, setIsGpsChecking] = useState(false);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [savedUsername, setSavedUsername] = useState('');

  // WebAuthn / Face ID 狀態
  const [hasWebAuthnCredential, setHasWebAuthnCredential] = useState(false);

  // 提早/延後打卡原因彈窗狀態
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [reasonPromptData, setReasonPromptData] = useState<{
    type: 'EARLY_IN' | 'LATE_OUT';
    minutesDiff: number;
    scheduledTime: string;
    recordId: number;
  } | null>(null);
  const [showOvertimeForm, setShowOvertimeForm] = useState(false);
  const [quickOvertimeReason, setQuickOvertimeReason] = useState('');
  const [submittingReason, setSubmittingReason] = useState(false);
  const [webauthnLoading, setWebauthnLoading] = useState(false);
  const [loggedInUsername, setLoggedInUsername] = useState('');
  const [isMobileClocking, setIsMobileClocking] = useState<boolean | null>(null);

  const showToast = (type: 'success' | 'error' | 'warning', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 5000);
  };

  // 客戶端掛載後設定時間
  useEffect(() => {
    setMounted(true);
    setCurrentTime(new Date());
  }, []);

  // 檢查生物識別支援和記住裝置
  useEffect(() => {
    // 檢查 WebAuthn 生物識別支援
    const checkBiometric = async () => {
      if (window.PublicKeyCredential && 
          typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
        try {
          const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
          setBiometricSupported(available);
        } catch {
          setBiometricSupported(false);
        }
      }
    };
    checkBiometric();

    // 載入已儲存的帳號
    const saved = localStorage.getItem('attendance_remembered_username');
    if (saved) {
      setSavedUsername(saved);
      setRememberDevice(true);
    }
  }, []);

  useEffect(() => {
    if (!verificationData.username && !savedUsername && loggedInUsername) {
      setVerificationData((prev) => ({
        ...prev,
        username: loggedInUsername
      }));
    }
  }, [loggedInUsername, savedUsername, verificationData.username]);

  // 檢查使用者是否已註冊 WebAuthn 憑證
  const checkWebAuthnCredential = useCallback(async (username: string) => {
    if (!biometricSupported || !username) {
      setHasWebAuthnCredential(false);
      return;
    }
    try {
      const response = await fetch('/api/webauthn/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setHasWebAuthnCredential(data.hasCredentials || false);
      } else {
        setHasWebAuthnCredential(false);
      }
    } catch (error) {
      console.error('檢查 WebAuthn 憑證失敗:', error);
      setHasWebAuthnCredential(false);
    }
  }, [biometricSupported]);

  // Face ID / 指紋打卡處理
  const handleBiometricClock = async (clockType: 'in' | 'out') => {
    if (isMobileClocking !== true) {
      showToast('warning', MOBILE_CLOCKING_REQUIRED_MESSAGE);
      return;
    }

    const username = verificationData.username || savedUsername || loggedInUsername;
    if (!username) {
      showToast('error', '請先輸入帳號');
      return;
    }

    setWebauthnLoading(true);
    try {
      let verifiedLocation = currentLocation ?? undefined;

      // 0. 先進行 GPS 位置驗證（如需要）
      if (isLocationRequired) {
        const locationCheck = await checkLocation();
        if (!locationCheck.isValid) {
          showToast('error', `打卡失敗：${locationCheck.error || 'GPS定位失敗'}`);
          return;
        }

        verifiedLocation = locationCheck.location ?? verifiedLocation;
      }

      // 0.1 檢查 WiFi 驗證（如需要）
      if (wifiVerificationRequired && availableWifiSsids.length > 0 && !selectedWifiSsid) {
        // 需要先選擇 WiFi
        showToast('warning', '請先確認您已連接到公司 WiFi');
        setWebauthnLoading(false);
        return;
      }

      // 1. 取得驗證選項
      const optionsRes = await fetch('/api/webauthn/auth-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
        credentials: 'include'
      });

      if (!optionsRes.ok) {
        const errorData = await optionsRes.json();
        throw new Error(errorData.error || '取得驗證選項失敗');
      }

      const data = await optionsRes.json();
      const options = data.options;

      // 2. 呼叫 WebAuthn API 進行生物識別驗證
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: Uint8Array.from(atob(options.challenge.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
          allowCredentials: options.allowCredentials.map((cred: { id: string; type: string; transports?: string[] }) => ({
            id: Uint8Array.from(atob(cred.id.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
            type: cred.type,
            transports: cred.transports
          })),
          timeout: options.timeout,
          userVerification: options.userVerification,
          rpId: options.rpId
        }
      }) as PublicKeyCredential;

      if (!credential) {
        throw new Error('生物識別驗證被取消');
      }

      const response = credential.response as AuthenticatorAssertionResponse;

      // 3. 驗證並打卡
      const verifyRes = await fetch('/api/webauthn/auth-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: {
            id: credential.id,
            rawId: btoa(String.fromCharCode(...new Uint8Array(credential.rawId))),
            type: credential.type,
            response: {
              clientDataJSON: btoa(String.fromCharCode(...new Uint8Array(response.clientDataJSON))),
              authenticatorData: btoa(String.fromCharCode(...new Uint8Array(response.authenticatorData))),
              signature: btoa(String.fromCharCode(...new Uint8Array(response.signature))),
              userHandle: response.userHandle ? btoa(String.fromCharCode(...new Uint8Array(response.userHandle))) : null
            }
          },
          clockType: clockType,
          location: verifiedLocation
        }),
        credentials: 'include'
      });

      const result = await verifyRes.json();

      if (verifyRes.ok && result.success) {
        showToast('success', result.message || `${clockType === 'in' ? '上班' : '下班'}打卡成功！`);
        setShowVerificationModal(false);
        setPendingClockType(null);
        loadTodayStatus();
      } else {
        throw new Error(result.error || '打卡失敗');
      }
    } catch (error) {
      console.error('Face ID 打卡失敗:', error);
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          showToast('warning', '生物識別驗證被取消，請使用密碼打卡');
        } else {
          showToast('error', error.message);
        }
      } else {
        showToast('error', 'Face ID 驗證失敗，請使用密碼打卡');
      }
    } finally {
      setWebauthnLoading(false);
    }
  };

  // 當 biometricSupported 和 loggedInUsername 都準備好時重新檢查憑證
  useEffect(() => {
    if (biometricSupported && loggedInUsername) {
      console.log('🔑 重新檢查 WebAuthn 憑證:', loggedInUsername);
      checkWebAuthnCredential(loggedInUsername);
    }
  }, [biometricSupported, checkWebAuthnCredential, loggedInUsername]);

  useEffect(() => {
    // 設定頁面標題
    document.title = '打卡系統 - 長福會考勤系統';
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setIsMobileClocking(isMobileClockingDevice(navigator.userAgent));
  }, []);

  const loadGPSSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/system-settings/gps-attendance');
      if (!response.ok) {
        return;
      }

      const data = await response.json();
      if (data.settings) {
        setGpsSettings(data.settings);
      }
    } catch (error) {
      console.error('載入GPS設定失敗:', error);
    }
  }, []);

  // GPS 相關函數 - 帶進度追蹤
  const getCurrentPosition = (): Promise<LocationData> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('瀏覽器不支援GPS定位功能'));
        return;
      }

      // 開始進度追蹤
      setIsGpsChecking(true);
      setGpsProgress(0);
      const startTime = Date.now();
      const timeout = Math.max(gpsSettings.verificationTimeout, 5) * 1000;
      
      // 進度更新計時器
      const progressInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min((elapsed / timeout) * 100, 95);
        setGpsProgress(progress);
      }, 100);

      // 檢查權限狀態 (如果瀏覽器支援)
      if ('permissions' in navigator) {
        navigator.permissions.query({ name: 'geolocation' }).then((result) => {
          if (result.state === 'denied') {
            clearInterval(progressInterval);
            setIsGpsChecking(false);
            setGpsProgress(0);
            reject(new Error('GPS定位權限被拒絕。請在瀏覽器設定中允許此網站使用位置資訊，然後重新整理頁面。'));
            return;
          }
        }).catch(() => {
          // 忽略權限查詢錯誤，繼續嘗試定位
        });
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          clearInterval(progressInterval);
          setGpsProgress(100);
          setIsGpsChecking(false);
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy
          });
        },
        (error) => {
          clearInterval(progressInterval);
          setIsGpsChecking(false);
          setGpsProgress(0);
          
          let errorMessage = 'GPS定位失敗';
          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = 'GPS定位權限被拒絕。請允許瀏覽器存取您的位置資訊';
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = 'GPS位置不可用。請確認GPS已開啟';
              break;
            case error.TIMEOUT:
              errorMessage = 'GPS定位超時。請移到訊號較好的位置';
              break;
          }
          reject(new Error(errorMessage));
        },
        {
          enableHighAccuracy: true,
          timeout: timeout,
          maximumAge: 0
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
      const effectiveRadius = location.radius + Math.max(gpsSettings.maxDistanceVariance, 0);
      
      if (distance <= effectiveRadius) {
        return { isValid: true, nearestLocation: location, distance };
      }
      
      if (distance < minDistance) {
        minDistance = distance;
        nearestLocation = location;
      }
    }

    return { isValid: false, nearestLocation, distance: minDistance };
  };

  const validateLocationWithServer = useCallback(async (location: LocationData): Promise<{
    status: LocationStatus;
    error: string;
  }> => {
    const response = await fetch('/api/attendance/location-validation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location }),
      credentials: 'include',
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        status: (data?.status as LocationStatus | undefined) || 'error',
        error: data?.error || 'GPS驗證服務異常，請稍後再試',
      };
    }

    return {
      status: (data?.status as LocationStatus | undefined) || 'error',
      error: data?.error || '',
    };
  }, []);

  const loadAllowedLocations = useCallback(async () => {
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
  }, []);

  const checkLocation = async (): Promise<LocationCheckResult> => {
    try {
      if (!gpsSettings.enabled) {
        setLocationStatus('disabled');
        setIsLocationRequired(false);
        return { isValid: true, location: currentLocation ?? undefined };
      }

      setIsLocationRequired(true);
      setLocationStatus('checking');
      setLocationError('');
      
      const position = await getCurrentPosition();
      setCurrentLocation(position);

      const validation = await validateLocationWithServer(position);
      setLocationStatus(validation.status);
      setLocationError(validation.error);

      if (validation.status === 'valid' || validation.status === 'disabled') {
        return { isValid: true, location: position };
      }

      return { isValid: false, error: validation.error, location: position };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'GPS定位失敗';
      setLocationStatus('error');
      setLocationError(message);
      return { isValid: false, error: message };
    }
  };

  const loadTodayStatus = useCallback(async () => {
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
      
      // 保存登入的使用者名稱並檢查 WebAuthn 憑證
      if (userData.user?.username) {
        setLoggedInUsername(userData.user.username);
        checkWebAuthnCredential(userData.user.username);
      }

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
  }, [checkWebAuthnCredential]);

  useEffect(() => {
    void loadTodayStatus();
    void loadGPSSettings();
    void loadAllowedLocations();
  }, [loadAllowedLocations, loadGPSSettings, loadTodayStatus]);

  const handleClock = async (type: 'in' | 'out') => {
    if (isMobileClocking !== true) {
      showToast('warning', MOBILE_CLOCKING_REQUIRED_MESSAGE);
      return;
    }

    let verifiedLocation = currentLocation ?? undefined;

    // 先進行 GPS 驗證（如果需要）
    if (isLocationRequired) {
      const locationCheck = await checkLocation();
      if (!locationCheck.isValid) {
        showToast('error', `打卡失敗：${locationCheck.error || 'GPS定位失敗'}`);
        return;
      }

      verifiedLocation = locationCheck.location ?? verifiedLocation;
    }

    // 檢查員工所在位置是否需要 WiFi 驗證
    // 只有當該位置啟用 WiFi 驗證時才要求
    let requireWifiForThisLocation = false;
    let locationWifiSsids: string[] = [];
    let locationWifiOnly = false;

    if (verifiedLocation && allowedLocations.length > 0) {
      // 找到員工所在的允許位置
      const locationCheck = isWithinAllowedRange(verifiedLocation.latitude, verifiedLocation.longitude);
      if (locationCheck.isValid && locationCheck.nearestLocation) {
        const matchedLocation = locationCheck.nearestLocation;
        // 檢查該位置是否啟用 WiFi 驗證
        if (matchedLocation.wifiEnabled && matchedLocation.wifiSsidList) {
          requireWifiForThisLocation = true;
          locationWifiOnly = matchedLocation.wifiOnly || false;
          // 解析該位置的 WiFi SSID 列表
          locationWifiSsids = matchedLocation.wifiSsidList
            .split('\n')
            .map((s: string) => s.trim())
            .filter((s: string) => s.length > 0);
        }
      }
    }

    // 如果該位置需要 WiFi 驗證
    if (requireWifiForThisLocation && locationWifiSsids.length > 0) {
      // 更新可用的 WiFi SSID（只顯示該位置的 SSID）
      setAvailableWifiSsids(locationWifiSsids);
      setWifiOnlyMode(locationWifiOnly);
      
      // 顯示 WiFi 選擇器
      setShowWifiSelector(true);
      setPendingClockType(type);
      return;
    }

    // 不需要 WiFi 驗證，直接顯示驗證對話框
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
      let verifiedLocation = currentLocation ?? undefined;

      if (isLocationRequired && !verifiedLocation) {
        const locationCheck = await checkLocation();
        if (!locationCheck.isValid) {
          showToast('error', locationCheck.error || 'GPS定位失敗');
          return;
        }

        verifiedLocation = locationCheck.location;
      }

      // 準備打卡數據，包含GPS位置信息
      const effectiveUsername = verificationData.username || savedUsername || loggedInUsername;
      if (!effectiveUsername) {
        showToast('error', '請先輸入帳號');
        return;
      }

      const clockData: {
        username: string;
        password: string;
        clockType: 'in' | 'out';
        location?: LocationData;
      } = {
        username: effectiveUsername,
        password: verificationData.password,
        clockType: pendingClockType
      };

      // 如果有GPS位置數據，加入到請求中
      if (verifiedLocation) {
        clockData.location = {
          latitude: verifiedLocation.latitude,
          longitude: verifiedLocation.longitude,
          accuracy: verifiedLocation.accuracy,
          address: verifiedLocation.address
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
        
        // 檢查是否需要填寫提早/延後打卡原因
        if (data.requiresReason && data.reasonPrompt) {
          setReasonPromptData(data.reasonPrompt);
          setShowReasonModal(true);
        }
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

  // 處理提早/延後打卡原因選擇
  const handleReasonSubmit = async (reason: 'PERSONAL' | 'BUSINESS', createOvertime = false) => {
    if (!reasonPromptData) return;
    
    setSubmittingReason(true);
    try {
      const requestData: {
        recordId: number;
        clockType: 'in' | 'out';
        reason: string;
        newOvertimeRequest?: {
          startTime: string;
          endTime: string;
          hours: number;
          overtimeReason: string;
        };
      } = {
        recordId: reasonPromptData.recordId,
        clockType: reasonPromptData.type === 'EARLY_IN' ? 'in' : 'out',
        reason
      };

      // 如果選擇公務且要快速申請加班
      if (reason === 'BUSINESS' && createOvertime && quickOvertimeReason.trim()) {
        const now = new Date();
        requestData.newOvertimeRequest = {
          startTime: reasonPromptData.type === 'EARLY_IN' 
            ? now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
            : reasonPromptData.scheduledTime,
          endTime: reasonPromptData.type === 'EARLY_IN'
            ? reasonPromptData.scheduledTime
            : now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }),
          hours: reasonPromptData.minutesDiff / 60,
          overtimeReason: quickOvertimeReason
        };
      }

      const response = await fetchJSONWithCSRF('/api/attendance/clock-reason', {
        method: 'POST',
        body: requestData
      });

      const data = await response.json();
      if (response.ok) {
        showToast('success', data.message);
        if (data.overtimeId) {
          showToast('success', '加班申請已提交，待主管審核');
        }
      } else {
        showToast('error', data.error || '記錄原因失敗');
      }
    } catch (error) {
      console.error('提交打卡原因失敗:', error);
      showToast('error', '系統錯誤');
    } finally {
      setSubmittingReason(false);
      setShowReasonModal(false);
      setShowOvertimeForm(false);
      setQuickOvertimeReason('');
      setReasonPromptData(null);
    }
  };

  const handleReasonCancel = () => {
    // 用戶跳過原因選擇，預設記錄為非公務
    handleReasonSubmit('PERSONAL');
  };

  const formatTime = (time: Date | null) => {
    if (!time) return '--:--:--';
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
      <div className="max-w-7xl mx-auto py-4 md:py-6 px-4 sm:px-6 lg:px-8">
        <div className="sm:px-0">
          {/* 頁面標題 - 手機版隱藏 */}
          <div className="mb-4 md:mb-8 hidden md:block">
            <h1 className="text-3xl font-bold text-gray-900 flex items-center">
              <Clock className="mr-3 h-8 w-8" />
              打卡管理
            </h1>
            <p className="mt-2 text-gray-600">管理您的上下班打卡和考勤記錄</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
            {/* 打卡區域 */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-2xl shadow-lg p-4 md:p-8">
                <h2 className="text-lg md:text-2xl font-bold text-gray-900 mb-4 md:mb-6 flex items-center">
                  <Timer className="mr-2 h-5 w-5 md:h-6 md:w-6" />
                  今日打卡
                </h2>

                {isMobileClocking === false && (
                  <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    {MOBILE_CLOCKING_REQUIRED_MESSAGE}
                  </div>
                )}

                {/* 當前時間顯示 - 響應式縮小 */}
                <div className="text-center mb-4 md:mb-8">
                  <div className="text-4xl md:text-6xl font-mono font-bold text-blue-600 mb-1 md:mb-2">
                    {mounted && currentTime ? formatTime(currentTime) : '--:--:--'}
                  </div>
                  {/* 手機版日期 - 簡短格式 */}
                  <div className="text-sm text-gray-600 md:hidden">
                    {mounted && currentTime ? currentTime.toLocaleDateString('zh-TW', {
                      month: 'numeric',
                      day: 'numeric',
                      weekday: 'short'
                    }) : '載入中...'}
                  </div>
                  {/* 桌面版日期 - 完整格式 */}
                  <div className="hidden md:block text-xl text-gray-600">
                    {mounted && currentTime ? currentTime.toLocaleDateString('zh-TW', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      weekday: 'long'
                    }) : '載入中...'}
                  </div>
                </div>

                {/* GPS 位置狀態 */}
                {isLocationRequired && (
                  <div className="mb-4 md:mb-6">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">位置驗證</span>
                      <button
                        onClick={checkLocation}
                        disabled={isGpsChecking}
                        className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
                      >
                        {isGpsChecking ? '定位中...' : '重新檢查'}
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
                            <span className="text-sm text-blue-700">正在獲取位置...</span>
                          </>
                        )}
                        {locationStatus === 'valid' && (
                          <>
                            <MapPin className="w-4 h-4 text-green-600" />
                            <span className="text-sm text-green-700">✓ 位置驗證通過</span>
                          </>
                        )}
                        {locationStatus === 'invalid' && (
                          <>
                            <AlertCircle className="w-4 h-4 text-red-600" />
                            <span className="text-sm text-red-700">不在打卡範圍內</span>
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
                      
                      {/* GPS 進度條 */}
                      {isGpsChecking && (
                        <div className="mt-2">
                          <div className="flex items-center justify-between text-xs text-blue-600 mb-1">
                            <span>GPS 定位中</span>
                            <span>{Math.round(gpsProgress)}%</span>
                          </div>
                          <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
                            <div 
                              className="bg-blue-600 h-2 rounded-full transition-all duration-100"
                              style={{ width: `${gpsProgress}%` }}
                            />
                          </div>
                        </div>
                      )}
                      
                      {locationError && !isGpsChecking && (
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

                {/* 打卡按鈕 - 純 CSS 響應式 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 mb-4 md:mb-6">
                  <div className="space-y-2">
                    <button
                      onClick={() => handleClock('in')}
                      disabled={clockLoading || isMobileClocking !== true}
                      className={`w-full py-5 md:py-4 px-6 rounded-xl text-base md:text-lg font-medium transition-all ${
                        todayStatus?.hasClockIn
                          ? 'bg-green-600 text-white shadow-lg border-2 border-green-200'
                          : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-lg hover:shadow-xl transform hover:-translate-y-1 active:translate-y-0'
                      }`}
                    >
                      <div className="flex items-center justify-center gap-2">
                        {todayStatus?.hasClockIn ? (
                          <>
                            <CheckCircle className="w-5 h-5 md:w-6 md:h-6" />
                            <span>已上班打卡</span>
                          </>
                        ) : (
                          <>
                            <Clock className="w-5 h-5 md:w-6 md:h-6" />
                            <span>上班打卡</span>
                          </>
                        )}
                      </div>
                      {todayStatus?.today?.clockInTime && (
                        <div className="text-xs opacity-80 mt-1">
                          {formatDateTime(todayStatus.today.clockInTime)}
                        </div>
                      )}
                    </button>
                  </div>

                  <div className="space-y-2">
                    <button
                      onClick={() => handleClock('out')}
                      disabled={clockLoading || isMobileClocking !== true}
                      className={`w-full py-5 md:py-4 px-6 rounded-xl text-base md:text-lg font-medium transition-all ${
                        todayStatus?.hasClockOut
                          ? 'bg-orange-600 text-white shadow-lg border-2 border-orange-200'
                          : 'bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white shadow-lg hover:shadow-xl transform hover:-translate-y-1 active:translate-y-0'
                      }`}
                    >
                      <div className="flex items-center justify-center gap-2">
                        {todayStatus?.hasClockOut ? (
                          <>
                            <CheckCircle className="w-5 h-5 md:w-6 md:h-6" />
                            <span>已下班打卡</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-5 h-5 md:w-6 md:h-6" />
                            <span>下班打卡</span>
                          </>
                        )}
                      </div>
                      {todayStatus?.today?.clockOutTime && (
                        <div className="text-xs opacity-80 mt-1">
                          {formatDateTime(todayStatus.today.clockOutTime)}
                        </div>
                      )}
                    </button>
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
              <div className="bg-linear-to-r from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-200">
                <h3 className="text-lg font-bold text-blue-900 mb-3">考勤提醒</h3>
                <div className="space-y-2 text-sm text-blue-800">
                  <p>• 系統支援靈活打卡，可隨時上下班打卡</p>
                  <p>• 忘記打卡可透過「忘打卡申請」補登</p>
                  <p>• 上班前請先點擊「上班打卡」按鈕</p>
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 md:p-8 max-w-md w-full shadow-2xl">
            <h3 className="text-xl md:text-2xl font-bold text-gray-900 mb-4 md:mb-6 text-center">
              {pendingClockType === 'in' ? '上班打卡' : '下班打卡'}確認
            </h3>
            
            {/* 生物識別提示與按鈕 */}
            {isMobileClocking === true && biometricSupported && hasWebAuthnCredential && (
              <div className="mb-4">
                <button
                  onClick={() => pendingClockType && handleBiometricClock(pendingClockType)}
                  disabled={webauthnLoading || clockLoading}
                  className="w-full bg-linear-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-4 px-4 rounded-xl transition-all flex items-center justify-center gap-3 shadow-lg"
                >
                  <Fingerprint className="w-6 h-6" />
                  <span className="text-lg">{webauthnLoading ? '驗證中...' : 'Face ID / 指紋打卡'}</span>
                </button>
                <div className="text-center text-sm text-gray-500 mt-2">
                  或使用帳號密碼
                </div>
              </div>
            )}
            
            {/* 尚未設定生物識別的提示 */}
            {isMobileClocking === true && biometricSupported && !hasWebAuthnCredential && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                <div className="flex items-center gap-2">
                  <Fingerprint className="w-5 h-5 text-yellow-600" />
                  <span className="text-sm text-yellow-700">此裝置支援 Face ID / 指紋</span>
                </div>
                <a 
                  href="/personal-settings" 
                  className="text-sm text-blue-600 hover:text-blue-800 underline mt-1 block"
                >
                  前往設定生物識別，下次快速打卡 →
                </a>
              </div>
            )}
            
            <p className="text-gray-600 mb-4 md:mb-6 text-center text-sm md:text-base">
              {hasWebAuthnCredential ? '或輸入帳號密碼打卡' : '請輸入您的帳號密碼'}
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">帳號</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="text"
                    value={verificationData.username || savedUsername}
                    onChange={(e) => setVerificationData({
                      ...verificationData,
                      username: e.target.value
                    })}
                    className="w-full pl-10 pr-3 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black text-base"
                    placeholder="請輸入您的帳號"
                    autoFocus={!(verificationData.username || savedUsername)}
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
                    className="w-full pl-10 pr-10 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black text-base"
                    placeholder="請輸入您的密碼"
                    autoFocus={!!(verificationData.username || savedUsername)}
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

              {/* 記住帳號選項 */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={(e) => {
                    setRememberDevice(e.target.checked);
                    if (!e.target.checked) {
                      localStorage.removeItem('attendance_remembered_username');
                      setSavedUsername('');
                    }
                  }}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-600">記住我的帳號</span>
              </label>
            </div>

            <div className="flex space-x-3 mt-6">
              <button
                onClick={handleVerificationCancel}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-3 px-4 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  const effectiveUsername = verificationData.username || savedUsername || loggedInUsername;
                  // 記住帳號
                  if (rememberDevice && effectiveUsername) {
                    localStorage.setItem('attendance_remembered_username', effectiveUsername);
                  }
                  handleVerificationSubmit();
                }}
                disabled={!(verificationData.username || savedUsername || loggedInUsername) || !verificationData.password || clockLoading}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-lg transition-colors"
              >
                {clockLoading ? '打卡中...' : '確認打卡'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 提早/延後打卡原因選擇彈窗 */}
      {showReasonModal && reasonPromptData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl">
            {!showOvertimeForm ? (
              // 步驟1: 選擇原因
              <>
                <h3 className="text-lg font-semibold text-gray-900 mb-2 flex items-center">
                  <Clock className="w-5 h-5 mr-2 text-blue-600" />
                  {reasonPromptData.type === 'EARLY_IN' ? '提早上班' : '延後下班'}提示
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  您的打卡時間比班表時間
                  {reasonPromptData.type === 'EARLY_IN' ? '提早' : '延後'}了 
                  <span className="font-semibold text-blue-600 mx-1">{reasonPromptData.minutesDiff}</span>
                  分鐘
                  {reasonPromptData.scheduledTime && ` (班表時間：${reasonPromptData.scheduledTime})`}
                  ，請選擇原因：
                </p>
                <div className="space-y-3">
                  <button
                    onClick={() => handleReasonSubmit('PERSONAL')}
                    disabled={submittingReason}
                    className="w-full py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <User className="w-5 h-5" />
                    非公務（預設）
                  </button>
                  <button
                    onClick={() => setShowOvertimeForm(true)}
                    disabled={submittingReason}
                    className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Clock className="w-5 h-5" />
                    公務
                  </button>
                </div>
                <div className="mt-4 text-center">
                  <button
                    onClick={handleReasonCancel}
                    disabled={submittingReason}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    {submittingReason ? '處理中...' : '跳過'}
                  </button>
                </div>
              </>
            ) : (
              // 步驟2: 公務 - 可選填加班申請
              <>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  加班申請（選填）
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  如需申請加班費或補休，請填寫加班事由：
                </p>
                
                <div className="space-y-4 mb-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-gray-500">
                        {reasonPromptData.type === 'EARLY_IN' ? '提早開始' : '加班開始'}
                      </div>
                      <div className="font-medium text-gray-900">
                        {reasonPromptData.type === 'EARLY_IN' 
                          ? new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
                          : reasonPromptData.scheduledTime}
                      </div>
                    </div>
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-gray-500">
                        {reasonPromptData.type === 'EARLY_IN' ? '班表上班' : '實際下班'}
                      </div>
                      <div className="font-medium text-gray-900">
                        {reasonPromptData.type === 'EARLY_IN'
                          ? reasonPromptData.scheduledTime
                          : new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      加班事由
                    </label>
                    <textarea
                      value={quickOvertimeReason}
                      onChange={(e) => setQuickOvertimeReason(e.target.value)}
                      placeholder="請輸入加班事由..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                      rows={3}
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <button
                    onClick={() => handleReasonSubmit('BUSINESS', true)}
                    disabled={submittingReason || !quickOvertimeReason.trim()}
                    className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submittingReason ? '提交中...' : '提交加班申請'}
                  </button>
                  <button
                    onClick={() => handleReasonSubmit('BUSINESS', false)}
                    disabled={submittingReason}
                    className="w-full py-2 px-4 text-gray-600 hover:text-gray-800 text-sm transition-colors"
                  >
                    僅記錄公務，稍後申請加班
                  </button>
                  <button
                    onClick={() => setShowOvertimeForm(false)}
                    disabled={submittingReason}
                    className="w-full py-2 px-4 text-gray-400 hover:text-gray-600 text-sm transition-colors"
                  >
                    返回
                  </button>
                </div>
              </>
            )}
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
