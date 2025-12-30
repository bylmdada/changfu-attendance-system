'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Lock, User, Clock, MapPin, AlertCircle } from 'lucide-react';
import Image from 'next/image';

// GPS位置狀態類型
type LocationStatus = 'checking' | 'valid' | 'invalid' | 'error' | 'disabled';

// 員工打卡狀態介面
interface AttendanceRecord {
  id: number;
  employeeId: number;
  workDate: Date;
  clockInTime: string | null;
  clockOutTime: string | null;
  status: string;
  regularHours: number;
  overtimeHours: number;
}

interface EmployeeAttendanceStatus {
  employee: {
    id: number;
    employeeId: string;
    name: string;
    department: string;
    position: string;
  };
  hasClockIn: boolean;
  hasClockOut: boolean;
  clockInTime: string | null;
  clockOutTime: string | null;
  workHours: number;
  regularHours: number;
  overtimeHours: number;
  attendance: AttendanceRecord | null;
  // 新增：今日排班
  todaySchedule?: {
    date: string;
    shiftCode: string;
    shiftTime: string;
  } | null;
  // 新增：當月異常記錄
  anomalyRecords?: {
    date: string;
    shiftCode: string;
    shiftTime: string;
    scheduledClockIn: string;
    actualClockIn: string;
    scheduledClockOut: string;
    actualClockOut: string;
    status: string;
  }[];
}

// 快速打卡狀態回調類型
interface QuickClockStatus {
  attendanceStatus: EmployeeAttendanceStatus | null;
  locationStatus: LocationStatus;
  locationError: string;
  gpsEnabled: boolean;
  accuracy: number | null;
}

// 快速打卡組件
function QuickClockForm({ 
  onError, 
  onStatusChange 
}: { 
  onError: (error: string) => void;
  onStatusChange?: (status: QuickClockStatus) => void;
}) {
  const [clockData, setClockData] = useState({
    username: '',
    password: ''
  });
  const [rememberUsername, setRememberUsername] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [clockLoading, setClockLoading] = useState(false);
  const [checkingEmployee, setCheckingEmployee] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [attendanceStatus, setAttendanceStatus] = useState<EmployeeAttendanceStatus | null>(null);
  
  // 超時下班原因選擇狀態
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [pendingAttendanceId, setPendingAttendanceId] = useState<number | null>(null);
  const [scheduleEndTime, setScheduleEndTime] = useState<string | null>(null);
  const [pendingCredentials, setPendingCredentials] = useState<{ username: string; password: string } | null>(null);
  const [actualClockOutTime, setActualClockOutTime] = useState<string | null>(null);
  
  // 加班申請表單狀態（選擇公務後可選填）
  const [showOvertimeForm, setShowOvertimeForm] = useState(false);
  const [overtimeReason, setOvertimeReason] = useState('');
  
  // GPS相關狀態
  const [currentLocation, setCurrentLocation] = useState<GeolocationPosition | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('checking');
  const [locationError, setLocationError] = useState('');
  const [gpsSettings, setGpsSettings] = useState({
    enabled: true,
    requiredAccuracy: 50,
    allowOfflineMode: false
  });
  // 允許的打卡位置列表
  const [allowedLocations, setAllowedLocations] = useState<{
    id: number;
    name: string;
    latitude: number;
    longitude: number;
    radius: number;
    isActive: boolean;
  }[]>([]);

  // Face ID / 指紋相關狀態
  const [hasFaceId, setHasFaceId] = useState(false);
  const [faceIdLoading, setFaceIdLoading] = useState(false);
  const [showFaceIdSetup, setShowFaceIdSetup] = useState(false);
  const [biometricSupported, setBiometricSupported] = useState(false);

  // 計算兩點之間距離（公尺）
  const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // 載入已儲存的員編（自動填入）
  useEffect(() => {
    const savedUsername = localStorage.getItem('quickclock_remembered_username');
    if (savedUsername) {
      setClockData(prev => ({ ...prev, username: savedUsername }));
      setRememberUsername(true);
    }
  }, []);

  // 載入GPS設定和允許位置
  useEffect(() => {
    const loadGPSSettings = async () => {
      try {
        const response = await fetch('/api/system-settings/gps-attendance');
        if (response.ok) {
          const data = await response.json();
          if (data.settings) {
            setGpsSettings(data.settings);
          }
        }
      } catch (error) {
        console.error('載入GPS設定失敗:', error);
      }
    };

    const loadAllowedLocations = async () => {
      try {
        const response = await fetch('/api/attendance/allowed-locations');
        if (response.ok) {
          const data = await response.json();
          if (data.locations) {
            setAllowedLocations(data.locations);
          }
        }
      } catch (error) {
        console.error('載入允許位置失敗:', error);
      }
    };

    loadGPSSettings();
    loadAllowedLocations();
  }, []);

  // GPS位置檢查
  useEffect(() => {
    if (!gpsSettings.enabled) {
      setLocationStatus('disabled');
      return;
    }

    const checkLocation = () => {
      if (!navigator.geolocation) {
        setLocationStatus('error');
        setLocationError('瀏覽器不支援GPS定位');
        return;
      }

      setLocationStatus('checking');
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCurrentLocation(position);
          
          // 檢查 1: GPS 精確度
          if (position.coords.accuracy > gpsSettings.requiredAccuracy) {
            setLocationStatus('invalid');
            setLocationError(`GPS精確度不足 (±${Math.round(position.coords.accuracy)}公尺)`);
            return;
          }
          
          // 檢查 2: 是否在允許的打卡位置範圍內
          if (allowedLocations.length === 0) {
            // 如果沒有設定允許位置，則僅檢查精確度
            setLocationStatus('valid');
            setLocationError('');
            return;
          }
          
          const { latitude, longitude } = position.coords;
          let isWithinRange = false;
          let nearestLocation = '';
          let minDistance = Infinity;
          
          for (const loc of allowedLocations) {
            if (!loc.isActive) continue;
            const distance = calculateDistance(latitude, longitude, loc.latitude, loc.longitude);
            if (distance <= loc.radius) {
              isWithinRange = true;
              break;
            }
            if (distance < minDistance) {
              minDistance = distance;
              nearestLocation = loc.name;
            }
          }
          
          if (isWithinRange) {
            setLocationStatus('valid');
            setLocationError('');
          } else {
            setLocationStatus('invalid');
            setLocationError(`不在允許的打卡範圍內。距離${nearestLocation}約${Math.round(minDistance)}公尺`);
          }
        },
        (error) => {
          setLocationStatus('error');
          switch (error.code) {
            case error.PERMISSION_DENIED:
              setLocationError('GPS權限被拒絕');
              break;
            case error.POSITION_UNAVAILABLE:
              setLocationError('無法取得位置資訊');
              break;
            case error.TIMEOUT:
              setLocationError('GPS定位超時');
              break;
            default:
              setLocationError('GPS定位失敗');
              break;
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000
        }
      );
    };

    checkLocation();
  }, [gpsSettings, allowedLocations]);

  // 檢查員工今日打卡狀態
  const checkEmployeeStatus = async (username: string) => {
    if (!username) {
      setAttendanceStatus(null);
      return;
    }

    setCheckingEmployee(true);
    try {
      const response = await fetch('/api/attendance/check-today', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });

      if (response.ok) {
        const statusData = await response.json();
        setAttendanceStatus(statusData);
      } else {
        setAttendanceStatus(null);
      }
    } catch (error) {
      console.error('檢查員工狀態失敗:', error);
      setAttendanceStatus(null);
    } finally {
      setCheckingEmployee(false);
    }
  };

  // 當用戶名改變時檢查狀態
  useEffect(() => {
    // 清除成功消息和之前的狀態
    setSuccessMessage('');
    if (onError) onError('');
    
    const timeoutId = setTimeout(() => {
      if (clockData.username.length >= 3) { // 至少3個字符才開始檢查
        checkEmployeeStatus(clockData.username);
      } else {
        setAttendanceStatus(null);
      }
    }, 500); // 延遲500ms避免頻繁請求

    return () => clearTimeout(timeoutId);
  }, [clockData.username, onError]);

  // 狀態變化時通知父組件
  useEffect(() => {
    if (onStatusChange) {
      onStatusChange({
        attendanceStatus,
        locationStatus,
        locationError,
        gpsEnabled: gpsSettings.enabled,
        accuracy: currentLocation ? currentLocation.coords.accuracy : null
      });
    }
  }, [attendanceStatus, locationStatus, locationError, gpsSettings.enabled, currentLocation, onStatusChange]);

  // 檢查 Face ID 支援和已設定狀態
  useEffect(() => {
    // 檢查裝置是否支援 WebAuthn
    const checkBiometricSupport = async () => {
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
    checkBiometricSupport();
  }, []);

  // 當用戶名改變時檢查是否已設定 Face ID
  useEffect(() => {
    const checkFaceId = async () => {
      if (clockData.username.length >= 3) {
        try {
          const response = await fetch('/api/webauthn/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: clockData.username })
          });
          if (response.ok) {
            const data = await response.json();
            setHasFaceId(data.hasCredentials);
          }
        } catch {
          setHasFaceId(false);
        }
      } else {
        setHasFaceId(false);
      }
    };
    checkFaceId();
  }, [clockData.username]);

  // Face ID 打卡
  const handleFaceIdClock = async (type: 'in' | 'out') => {
    if (!biometricSupported) {
      onError('此裝置不支援 Face ID / 指紋');
      return;
    }

    setFaceIdLoading(true);
    onError('');

    try {
      // 1. 獲取驗證選項
      const optionsRes = await fetch('/api/webauthn/auth-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: clockData.username })
      });

      if (!optionsRes.ok) {
        const error = await optionsRes.json();
        throw new Error(error.error || '獲取驗證選項失敗');
      }

      const { options } = await optionsRes.json();

      // 2. 調用 WebAuthn API
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: Uint8Array.from(atob(options.challenge.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
          rpId: options.rpId,
          timeout: options.timeout,
          userVerification: options.userVerification as UserVerificationRequirement,
          allowCredentials: options.allowCredentials.map((c: { id: string; type: string; transports?: string[] }) => ({
            id: Uint8Array.from(atob(c.id.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0)),
            type: c.type,
            transports: c.transports
          }))
        }
      }) as PublicKeyCredential;

      if (!credential) {
        throw new Error('Face ID 驗證被取消');
      }

      // 3. 發送驗證結果
      const response = credential.response as AuthenticatorAssertionResponse;
      const verifyRes = await fetch('/api/webauthn/auth-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: {
            id: credential.id,
            rawId: btoa(String.fromCharCode(...new Uint8Array(credential.rawId))),
            response: {
              clientDataJSON: btoa(String.fromCharCode(...new Uint8Array(response.clientDataJSON))),
              authenticatorData: btoa(String.fromCharCode(...new Uint8Array(response.authenticatorData))),
              signature: btoa(String.fromCharCode(...new Uint8Array(response.signature)))
            },
            type: credential.type
          },
          clockType: type
        })
      });

      const result = await verifyRes.json();

      if (verifyRes.ok) {
        setSuccessMessage(`${result.employee || '員工'} ${type === 'in' ? '上班' : '下班'}打卡成功！`);
        // 重新檢查狀態
        await checkEmployeeStatus(clockData.username);
      } else {
        throw new Error(result.error || '打卡失敗');
      }
    } catch (error) {
      console.error('Face ID 打卡錯誤:', error);
      onError(error instanceof Error ? error.message : 'Face ID 驗證失敗');
    } finally {
      setFaceIdLoading(false);
    }
  };

  // 設定 Face ID
  const handleSetupFaceId = async () => {
    if (!biometricSupported) {
      onError('此裝置不支援 Face ID / 指紋');
      return;
    }

    if (!clockData.password) {
      onError('請先輸入密碼以驗證身份');
      return;
    }

    setFaceIdLoading(true);
    onError('');

    try {
      // 1. 獲取註冊選項
      const optionsRes = await fetch('/api/webauthn/register-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username: clockData.username, 
          password: clockData.password 
        })
      });

      if (!optionsRes.ok) {
        const error = await optionsRes.json();
        throw new Error(error.error || '驗證失敗');
      }

      const { options } = await optionsRes.json();

      // 2. 調用 WebAuthn API 註冊
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: Uint8Array.from(atob(options.challenge.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
          rp: options.rp,
          user: {
            id: Uint8Array.from(atob(options.user.id.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
            name: options.user.name,
            displayName: options.user.displayName
          },
          pubKeyCredParams: options.pubKeyCredParams,
          timeout: options.timeout,
          attestation: options.attestation as AttestationConveyancePreference,
          authenticatorSelection: options.authenticatorSelection
        }
      }) as PublicKeyCredential;

      if (!credential) {
        throw new Error('Face ID 設定被取消');
      }

      // 3. 發送註冊結果
      const response = credential.response as AuthenticatorAttestationResponse;
      const verifyRes = await fetch('/api/webauthn/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: {
            id: credential.id,
            rawId: btoa(String.fromCharCode(...new Uint8Array(credential.rawId))),
            response: {
              clientDataJSON: btoa(String.fromCharCode(...new Uint8Array(response.clientDataJSON))),
              attestationObject: btoa(String.fromCharCode(...new Uint8Array(response.attestationObject))),
              transports: response.getTransports?.() || ['internal']
            },
            type: credential.type
          },
          deviceName: navigator.userAgent.includes('iPhone') ? 'iPhone' : 
                      navigator.userAgent.includes('iPad') ? 'iPad' : 
                      navigator.userAgent.includes('Android') ? 'Android 裝置' : '裝置'
        })
      });

      const result = await verifyRes.json();

      if (verifyRes.ok) {
        setSuccessMessage('Face ID / 指紋設定成功！下次可直接使用生物識別打卡');
        setHasFaceId(true);
        setShowFaceIdSetup(false);
      } else {
        throw new Error(result.error || '設定失敗');
      }
    } catch (error) {
      console.error('Face ID 設定錯誤:', error);
      onError(error instanceof Error ? error.message : 'Face ID 設定失敗');
    } finally {
      setFaceIdLoading(false);
    }
  };

  const handleQuickClock = async (type: 'in' | 'out') => {
    // 快速打卡模式：只有在GPS明確無效且不允許離線時才阻止
    const shouldBlockForGPS = gpsSettings.enabled && 
                              !gpsSettings.allowOfflineMode && 
                              locationStatus === 'invalid';
    
    if (shouldBlockForGPS) {
      onError('GPS位置驗證失敗，無法打卡。請移動到GPS訊號較好的位置。');
      return;
    }

    setClockLoading(true);
    setSuccessMessage('');
    onError('');

    try {
      const requestData: {
        username: string;
        password: string;
        type: string;
        location?: {
          latitude: number;
          longitude: number;
          accuracy: number;
        };
      } = {
        username: clockData.username,
        password: clockData.password,
        type
      };

      // 如果GPS啟用且有有效位置，添加位置資訊
      if (gpsSettings.enabled && currentLocation) {
        requestData.location = {
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
          accuracy: currentLocation.coords.accuracy
        };
      }

      const response = await fetch('/api/attendance/verify-clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData)
      });

      if (response.ok) {
        const result = await response.json();
        const employeeName = result.employee || '員工';
        const clockTime = type === 'in' ? result.clockInTime : result.clockOutTime;
        const timeStr = clockTime ? new Date(clockTime).toLocaleTimeString('zh-TW', { 
          hour: '2-digit', 
          minute: '2-digit',
          second: '2-digit'
        }) : '';
        
        let successMsg = `${employeeName} ${type === 'in' ? '上班' : '下班'}打卡成功！時間：${timeStr}`;
        
        // 如果是下班打卡且有工作時間，顯示工作時間
        if (type === 'out' && result.workHours > 0) {
          successMsg += `\n工作時間：${result.workHours}小時`;
          if (result.overtimeHours > 0) {
            successMsg += ` (加班：${result.overtimeHours}小時)`;
          }
        }
        
        setSuccessMessage(successMsg);
        
        // 重新檢查員工狀態以更新打卡記錄顯示
        await checkEmployeeStatus(clockData.username);
        
        // 如果是下班打卡且超過班表時間，顯示原因選擇對話框
        if (type === 'out' && result.isLateClockOut && result.attendance?.id) {
          setPendingAttendanceId(result.attendance.id);
          setScheduleEndTime(result.scheduleEndTime);
          setActualClockOutTime(result.clockOutTime); // 保存實際打卡時間
          // 保存帳密用於原因更新 (密碼會在下一行被清除，所以先保存)
          setPendingCredentials({ username: clockData.username, password: clockData.password });
          setShowReasonModal(true);
        }
        
        // 打卡成功，自動保存員編（如果有勾選）
        if (rememberUsername && clockData.username) {
          localStorage.setItem('quickclock_remembered_username', clockData.username);
        }
        
        // 清除密碼但保留用戶名，方便再次打卡
        setClockData(prev => ({ ...prev, password: '' }));
      } else {
        const errorData = await response.json();
        onError(errorData.error || '打卡失敗');
      }
    } catch (error) {
      console.error('打卡失敗:', error);
      onError('系統錯誤，請稍後再試');
    } finally {
      setClockLoading(false);
    }
  };

  // 處理超時原因選擇
  const handleReasonSelect = async (reason: 'PERSONAL' | 'WORK') => {
    if (!pendingAttendanceId) return;
    
    try {
      const response = await fetch('/api/attendance/update-reason', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attendanceId: pendingAttendanceId,
          lateClockOutReason: reason,
          // 快速打卡模式需要帳密認證
          username: pendingCredentials?.username,
          password: pendingCredentials?.password
        })
      });
      
      if (response.ok) {
        setSuccessMessage(prev => prev + `\n超時原因已記錄：${reason === 'PERSONAL' ? '非公務因素' : '公務'}`);
      } else {
        const errorData = await response.json();
        console.error('記錄超時原因失敗:', errorData.error);
      }
    } catch (error) {
      console.error('記錄超時原因失敗:', error);
    } finally {
      setShowReasonModal(false);
      setShowOvertimeForm(false); // 重置加班表單狀態
      setOvertimeReason(''); // 清除加班事由
      setPendingAttendanceId(null);
      setScheduleEndTime(null);
      setActualClockOutTime(null);
      setPendingCredentials(null); // 清除帳密
    }
  };

  // 提交加班申請
  const submitOvertimeRequest = async () => {
    if (!scheduleEndTime || !actualClockOutTime || !pendingCredentials) return;
    
    try {
      const today = new Date().toISOString().slice(0, 10);
      
      const response = await fetch('/api/overtime-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workDate: today,
          overtimeType: 'WEEKDAY', // 平日加班
          startTime: scheduleEndTime,
          endTime: new Date(actualClockOutTime).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }),
          reason: overtimeReason,
          // 快速打卡模式需要帳密認證
          username: pendingCredentials.username,
          password: pendingCredentials.password
        })
      });
      
      if (response.ok) {
        setSuccessMessage(prev => prev + '\n加班申請已提交，待主管審核');
      } else {
        const errorData = await response.json();
        console.error('提交加班申請失敗:', errorData.error);
        setSuccessMessage(prev => prev + '\n加班申請提交失敗：' + (errorData.error || '請稍後再試'));
      }
    } catch (error) {
      console.error('提交加班申請失敗:', error);
    }
  };

  return (
    <>
      {/* 超時下班原因選擇對話框 */}
      {showReasonModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            {!showOvertimeForm ? (
              // 步驟1: 選擇原因
              <>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  超時下班原因
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  您的下班打卡時間已超過班表時間
                  {scheduleEndTime && ` (${scheduleEndTime})`}，
                  請選擇延遲下班的原因：
                </p>
                <div className="space-y-3">
                  <button
                    onClick={() => {
                      // 選公務時，顯示加班申請表單
                      setShowOvertimeForm(true);
                    }}
                    className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <Clock className="w-5 h-5" />
                    公務因素
                  </button>
                  <button
                    onClick={() => handleReasonSelect('PERSONAL')}
                    className="w-full py-3 px-4 bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <User className="w-5 h-5" />
                    非公務因素
                  </button>
                </div>
              </>
            ) : (
              // 步驟2: 公務原因 - 可選填加班申請
              <>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  加班申請（選填）
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  如需申請加班費，請填寫加班事由：
                </p>
                
                <div className="space-y-4 mb-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-gray-500">加班開始</div>
                      <div className="font-medium">{scheduleEndTime || '--:--'}</div>
                    </div>
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-gray-500">加班結束</div>
                      <div className="font-medium">
                        {actualClockOutTime 
                          ? new Date(actualClockOutTime).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
                          : '--:--'}
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      加班事由
                    </label>
                    <textarea
                      value={overtimeReason}
                      onChange={(e) => setOvertimeReason(e.target.value)}
                      placeholder="請輸入加班事由..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                      rows={3}
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <button
                    onClick={async () => {
                      // 記錄原因 + 提交加班申請
                      await handleReasonSelect('WORK');
                      if (overtimeReason.trim()) {
                        await submitOvertimeRequest();
                      }
                    }}
                    disabled={!overtimeReason.trim()}
                    className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    提交加班申請
                  </button>
                  <button
                    onClick={() => handleReasonSelect('WORK')}
                    className="w-full py-2 px-4 text-gray-600 hover:text-gray-800 text-sm transition-colors"
                  >
                    跳過，稍後申請
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      
      {successMessage && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm whitespace-pre-line mb-4">
          {successMessage}
        </div>
      )}

      {/* 打卡表單 - 只有員編密碼 */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">員編</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              required
              value={clockData.username}
              onChange={(e) => setClockData({...clockData, username: e.target.value})}
              className="w-full pl-10 pr-10 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-black bg-gray-50"
              placeholder="請輸入員編"
            />
            {checkingEmployee && (
              <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">密碼</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type={showPassword ? 'text' : 'password'}
              required
              value={clockData.password}
              onChange={(e) => setClockData({...clockData, password: e.target.value})}
              className="w-full pl-10 pr-10 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-black bg-gray-50"
              placeholder="請輸入密碼"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* 記住員編 */}
        <label className="flex items-center gap-2 cursor-pointer mt-2">
          <input
            type="checkbox"
            checked={rememberUsername}
            onChange={(e) => {
              setRememberUsername(e.target.checked);
              if (e.target.checked && clockData.username) {
                localStorage.setItem('quickclock_remembered_username', clockData.username);
              } else {
                localStorage.removeItem('quickclock_remembered_username');
              }
            }}
            className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
          />
          <span className="text-sm text-gray-600">記住員編（下次自動填入）</span>
        </label>
      </div>

      {/* 打卡按鈕 */}
      <div className="grid grid-cols-2 gap-3 mt-4">
        <button
          onClick={() => handleQuickClock('in')}
          disabled={clockLoading || (!clockData.username || !clockData.password) || (attendanceStatus?.hasClockIn)}
          className={`py-2.5 px-3 text-sm font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
            attendanceStatus?.hasClockIn 
              ? 'bg-green-100 text-green-700 border border-green-300' 
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          <Clock className="w-4 h-4" />
          {attendanceStatus?.hasClockIn 
            ? '已上班' 
            : (clockLoading ? '處理中...' : '上班打卡')
          }
        </button>
        
        <button
          onClick={() => handleQuickClock('out')}
          disabled={clockLoading || (!clockData.username || !clockData.password) || (attendanceStatus?.hasClockOut)}
          className={`py-2.5 px-3 text-sm font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
            attendanceStatus?.hasClockOut 
              ? 'bg-orange-100 text-orange-700 border border-orange-300' 
              : 'bg-orange-500 hover:bg-orange-600 text-white'
          }`}
        >
          <Clock className="w-4 h-4" />
          {attendanceStatus?.hasClockOut 
            ? '已下班' 
            : (clockLoading ? '處理中...' : '下班打卡')
          }
        </button>
      </div>

      {/* Face ID 區塊 */}
      {biometricSupported && clockData.username.length >= 3 && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          {hasFaceId ? (
            // 已設定 Face ID - 顯示快速打卡按鈕
            <div className="space-y-2">
              <div className="text-xs text-gray-500 text-center mb-2">使用 Face ID / 指紋快速打卡</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleFaceIdClock('in')}
                  disabled={faceIdLoading || attendanceStatus?.hasClockIn}
                  className={`py-3 px-3 text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2 ${
                    attendanceStatus?.hasClockIn
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white shadow-lg'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  {faceIdLoading ? '驗證中...' : 'Face ID 上班'}
                </button>
                <button
                  onClick={() => handleFaceIdClock('out')}
                  disabled={faceIdLoading || attendanceStatus?.hasClockOut}
                  className={`py-3 px-3 text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2 ${
                    attendanceStatus?.hasClockOut
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-gradient-to-r from-orange-400 to-pink-500 hover:from-orange-500 hover:to-pink-600 text-white shadow-lg'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  {faceIdLoading ? '驗證中...' : 'Face ID 下班'}
                </button>
              </div>
            </div>
          ) : (
            // 尚未設定 Face ID - 顯示設定按鈕
            !showFaceIdSetup ? (
              <button
                onClick={() => setShowFaceIdSetup(true)}
                className="w-full py-2 text-sm text-blue-600 hover:text-blue-800 flex items-center justify-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                設定 Face ID / 指紋登錄
              </button>
            ) : (
              <div className="bg-blue-50 rounded-xl p-4">
                <div className="text-sm text-blue-800 mb-3">
                  請先輸入密碼驗證身份，然後點擊「確認設定」
                </div>
                <button
                  onClick={handleSetupFaceId}
                  disabled={faceIdLoading || !clockData.password}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {faceIdLoading ? '設定中...' : '確認設定 Face ID'}
                </button>
                <button
                  onClick={() => setShowFaceIdSetup(false)}
                  className="w-full mt-2 py-2 text-sm text-gray-500 hover:text-gray-700"
                >
                  取消
                </button>
              </div>
            )
          )}
        </div>
      )}
    </>
  );
}

function LoginPageContent() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<'login' | 'quickClock'>('login');
  const [formData, setFormData] = useState({
    username: '',
    password: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [quickClockStatus, setQuickClockStatus] = useState<QuickClockStatus | null>(null);
  const router = useRouter();
  
  // 2FA 狀態
  const [requires2FA, setRequires2FA] = useState(false);
  const [totpCode, setTotpCode] = useState('');

  // 檢查 URL 參數，自動切換到快速打卡
  useEffect(() => {
    const mode = searchParams.get('mode');
    if (mode === 'quickclock') {
      setActiveTab('quickClock');
    }
  }, [searchParams]);

  // 動態更新時間
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // 設定頁面標題
    document.title = '登入 - 長福會考勤系統';
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          totpCode: requires2FA ? totpCode : undefined
        }),
      });

      const data = await response.json();
      
      if (response.ok) {
        // 檢查是否需要 2FA
        if (data.requires2FA) {
          setRequires2FA(true);
          setTotpCode('');
          return;
        }
        
        // 登入成功
        if (data.token) {
          localStorage.setItem('token', data.token);
        }
        router.push('/dashboard');
      } else {
        setError(data.error || '登入失敗');
        // 如果 2FA 驗證失敗，清除驗證碼
        if (requires2FA) {
          setTotpCode('');
        }
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('系統錯誤，請稍後再試');
    } finally {
      setLoading(false);
    }
  };
  
  // 返回登入步驟（從 2FA 返回）
  const handleBack2FA = () => {
    setRequires2FA(false);
    setTotpCode('');
    setError('');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* 頂部裝飾條 */}
      <div className="h-1.5 bg-gradient-to-r from-blue-500 via-cyan-500 to-blue-600" />
      
      {/* 主要內容區 */}
      <div className="flex-1 flex flex-col lg:flex-row">
        
        {/* 左側 1/3 */}
        <div className="w-full lg:w-1/3 bg-white border-r border-gray-200 flex flex-col">
          {/* 左上方：Tab 切換（水平置中） */}
          <div className="p-4 border-b border-gray-100">
            <div className="flex justify-center">
              <div className="flex bg-gray-100 rounded-xl p-1">
                <button
                  onClick={() => {
                    setActiveTab('login');
                    setError('');
                  }}
                  className={`py-2 px-4 text-sm font-medium rounded-lg transition-all ${
                    activeTab === 'login'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <User className="w-4 h-4 inline mr-1" />
                  系統登入
                </button>
                <button
                  onClick={() => {
                    setActiveTab('quickClock');
                    setError('');
                  }}
                  className={`py-2 px-4 text-sm font-medium rounded-lg transition-all ${
                    activeTab === 'quickClock'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Clock className="w-4 h-4 inline mr-1" />
                  快速打卡
                </button>
              </div>
            </div>
          </div>

          {/* 左側表單區 */}
          <div className="flex-1 flex flex-col justify-center p-6">
            <div className="max-w-xs mx-auto w-full">
              {/* Logo */}
              <div className="text-center mb-6">
                <Image
                  src="/logo.png"
                  alt="長福會"
                  width={70}
                  height={70}
                  className="mx-auto mb-3"
                  priority
                />
                <h1 className="text-lg font-bold text-gray-800">長福會考勤系統</h1>
                <p className="text-sm text-gray-500 mt-1">
                  {activeTab === 'login' ? '員工登入' : '快速打卡'}
                </p>
              </div>

              {/* 錯誤訊息 */}
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              {/* 系統登入表單 */}
              {activeTab === 'login' && (
                <form onSubmit={handleSubmit} className="space-y-4">
                  {!requires2FA ? (
                    <>
                      {/* 帳號密碼輸入 */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">員編</label>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                          <input
                            type="text"
                            required
                            value={formData.username}
                            onChange={(e) => setFormData({...formData, username: e.target.value})}
                            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-black bg-gray-50"
                            placeholder="請輸入員編"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">密碼</label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                          <input
                            type={showPassword ? 'text' : 'password'}
                            required
                            value={formData.password}
                            onChange={(e) => setFormData({...formData, password: e.target.value})}
                            className="w-full pl-10 pr-10 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-black bg-gray-50"
                            placeholder="請輸入密碼"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                          >
                            {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                          </button>
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-xl transition-colors disabled:opacity-50 shadow-sm"
                      >
                        {loading ? '登入中...' : '登入系統'}
                      </button>
                    </>
                  ) : (
                    <>
                      {/* 2FA 驗證碼輸入 */}
                      <div className="text-center mb-4">
                        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                          <Lock className="w-8 h-8 text-blue-600" />
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900">雙因素驗證</h3>
                        <p className="text-sm text-gray-500 mt-1">請輸入驗證器 APP 顯示的驗證碼</p>
                      </div>

                      <div>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={6}
                          required
                          value={totpCode}
                          onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          className="w-full text-center text-2xl font-mono tracking-widest py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-black bg-gray-50"
                          placeholder="000000"
                          autoFocus
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={loading || totpCode.length !== 6}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-xl transition-colors disabled:opacity-50 shadow-sm"
                      >
                        {loading ? '驗證中...' : '驗證並登入'}
                      </button>

                      <button
                        type="button"
                        onClick={handleBack2FA}
                        className="w-full text-gray-500 hover:text-gray-700 text-sm py-2"
                      >
                        ← 返回輸入帳號密碼
                      </button>
                    </>
                  )}
                </form>
              )}

              {/* 快速打卡：員編密碼 */}
              {activeTab === 'quickClock' && (
                <>
                  {/* 手機版時鐘 - 只在手機上顯示 */}
                  <div className="lg:hidden text-center bg-gradient-to-br from-blue-50 to-cyan-50 rounded-xl p-4 border border-blue-100 mb-4">
                    <div className="text-3xl font-mono font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
                      {currentTime.toLocaleTimeString('zh-TW', { 
                        hour: '2-digit', 
                        minute: '2-digit', 
                        second: '2-digit',
                        hour12: false 
                      })}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      {currentTime.toLocaleDateString('zh-TW', {
                        month: 'numeric',
                        day: 'numeric',
                        weekday: 'short'
                      })}
                    </div>
                  </div>
                  <QuickClockForm onError={setError} onStatusChange={setQuickClockStatus} />
                </>
              )}

              {/* 忘記密碼連結 */}
              {activeTab === 'login' && (
                <div className="mt-4 text-center">
                  <a 
                    href="/forgot-password"
                    className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
                  >
                    忘記密碼？
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* 版權 */}
          <div className="p-3 text-center text-xs text-gray-400 border-t border-gray-100">
            © {new Date().getFullYear()} 長福會
          </div>
        </div>

        {/* 右側 2/3 */}
        <div className="hidden lg:flex lg:w-2/3 flex-col bg-gray-50">
          {/* 系統登入：顯示宗旨（垂直居中） */}
          {activeTab === 'login' && (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="bg-gradient-to-br from-blue-50 via-cyan-50 to-blue-100 rounded-3xl p-10 border border-blue-200 max-w-xl w-full">
                <div className="text-center mb-8">
                  <h2 className="text-3xl font-bold text-blue-800 mb-3">長福會宗旨</h2>
                  <div className="w-20 h-1 bg-gradient-to-r from-blue-400 to-cyan-400 mx-auto rounded-full" />
                </div>
                <div className="space-y-5">
                  <div className="flex items-start gap-4 bg-white/70 rounded-xl p-5 shadow-sm">
                    <span className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white text-lg font-bold flex-shrink-0">1</span>
                    <p className="text-gray-700 text-lg font-medium pt-1">確保長期照顧機構之服務品質</p>
                  </div>
                  <div className="flex items-start gap-4 bg-white/70 rounded-xl p-5 shadow-sm">
                    <span className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white text-lg font-bold flex-shrink-0">2</span>
                    <p className="text-gray-700 text-lg font-medium pt-1">保障長期照顧工作人員之權益</p>
                  </div>
                  <div className="flex items-start gap-4 bg-white/70 rounded-xl p-5 shadow-sm">
                    <span className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white text-lg font-bold flex-shrink-0">3</span>
                    <p className="text-gray-700 text-lg font-medium pt-1">健全健康照護與長期照顧服務之資源整合</p>
                  </div>
                  <div className="flex items-start gap-4 bg-white/70 rounded-xl p-5 shadow-sm">
                    <span className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white text-lg font-bold flex-shrink-0">4</span>
                    <p className="text-gray-700 text-lg font-medium pt-1">促進長期照顧專業之發展</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 快速打卡：根據員工狀態動態顯示 */}
          {activeTab === 'quickClock' && (
            <div className="flex-1 p-8 overflow-y-auto">
              <div className="max-w-md mx-auto space-y-6">
                {/* 系統時間卡片 */}
                <div className="text-center bg-gradient-to-br from-blue-50 to-cyan-50 rounded-2xl p-6 border border-blue-100">
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 rounded-full text-blue-700 text-xs font-medium mb-3">
                    <Clock className="h-3 w-3" />
                    系統時間
                  </div>
                  <div className="text-5xl font-mono font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent mb-2">
                    {currentTime.toLocaleTimeString('zh-TW', { 
                      hour: '2-digit', 
                      minute: '2-digit', 
                      second: '2-digit',
                      hour12: false 
                    })}
                  </div>
                  <div className="text-sm text-gray-600">
                    {currentTime.toLocaleDateString('zh-TW', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      weekday: 'long'
                    })}
                  </div>
                </div>

                {/* 員工資訊卡片 - 輸入員編後顯示 */}
                {quickClockStatus?.attendanceStatus && (
                  <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-full flex items-center justify-center text-white text-xl font-bold">
                        {quickClockStatus.attendanceStatus.employee.name.charAt(0)}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{quickClockStatus.attendanceStatus.employee.name}</h3>
                        <p className="text-xs text-gray-500">
                          {quickClockStatus.attendanceStatus.employee.employeeId} • {quickClockStatus.attendanceStatus.employee.department}
                        </p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className={`rounded-xl p-3 ${quickClockStatus.attendanceStatus.hasClockIn ? 'bg-green-50 border border-green-100' : 'bg-gray-50 border border-gray-100'}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <div className={`w-2 h-2 rounded-full ${quickClockStatus.attendanceStatus.hasClockIn ? 'bg-green-500' : 'bg-gray-300'}`} />
                          <span className={`text-xs font-medium ${quickClockStatus.attendanceStatus.hasClockIn ? 'text-green-700' : 'text-gray-500'}`}>上班打卡</span>
                        </div>
                        <div className={`text-lg font-semibold ${quickClockStatus.attendanceStatus.hasClockIn ? 'text-green-700' : 'text-gray-400'}`}>
                          {quickClockStatus.attendanceStatus.hasClockIn && quickClockStatus.attendanceStatus.clockInTime
                            ? new Date(quickClockStatus.attendanceStatus.clockInTime).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: true })
                            : '--:--'}
                        </div>
                      </div>
                      <div className={`rounded-xl p-3 ${quickClockStatus.attendanceStatus.hasClockOut ? 'bg-orange-50 border border-orange-100' : 'bg-gray-50 border border-gray-100'}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <div className={`w-2 h-2 rounded-full ${quickClockStatus.attendanceStatus.hasClockOut ? 'bg-orange-500' : 'bg-gray-300'}`} />
                          <span className={`text-xs font-medium ${quickClockStatus.attendanceStatus.hasClockOut ? 'text-orange-700' : 'text-gray-500'}`}>下班打卡</span>
                        </div>
                        <div className={`text-lg font-semibold ${quickClockStatus.attendanceStatus.hasClockOut ? 'text-orange-700' : 'text-gray-400'}`}>
                          {quickClockStatus.attendanceStatus.hasClockOut && quickClockStatus.attendanceStatus.clockOutTime
                            ? new Date(quickClockStatus.attendanceStatus.clockOutTime).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: true })
                            : '--:--'}
                        </div>
                      </div>
                    </div>
                    
                    {/* 工時統計 */}
                    <div className="flex items-center justify-center gap-8 py-3 border-t border-gray-100">
                      <div className="text-center">
                        <div className="text-xs text-gray-500">工時</div>
                        <div className="text-lg font-bold text-gray-900">{(quickClockStatus.attendanceStatus.workHours ?? 0).toFixed(1)}h</div>
                      </div>
                      <div className="w-px h-8 bg-gray-200" />
                      <div className="text-center">
                        <div className="text-xs text-gray-500">正常</div>
                        <div className="text-lg font-bold text-blue-600">{(quickClockStatus.attendanceStatus.regularHours ?? 0).toFixed(1)}h</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* GPS 狀態 - 員工資訊存在時顯示 */}
                {quickClockStatus?.attendanceStatus && quickClockStatus.gpsEnabled && (
                  <div className={`rounded-xl p-4 border ${
                    quickClockStatus.locationStatus === 'valid' 
                      ? 'bg-green-50 border-green-100' 
                      : quickClockStatus.locationStatus === 'error' || quickClockStatus.locationStatus === 'invalid'
                        ? 'bg-red-50 border-red-100'
                        : 'bg-gray-50 border-gray-100'
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <MapPin className={`w-4 h-4 ${
                        quickClockStatus.locationStatus === 'valid' ? 'text-green-600' 
                        : quickClockStatus.locationStatus === 'error' || quickClockStatus.locationStatus === 'invalid' ? 'text-red-600' 
                        : 'text-gray-600'
                      }`} />
                      <span className={`text-sm font-medium ${
                        quickClockStatus.locationStatus === 'valid' ? 'text-green-700' 
                        : quickClockStatus.locationStatus === 'error' || quickClockStatus.locationStatus === 'invalid' ? 'text-red-700' 
                        : 'text-gray-700'
                      }`}>
                        {quickClockStatus.locationStatus === 'valid' && '位置驗證通過，可以打卡'}
                        {quickClockStatus.locationStatus === 'checking' && '正在檢查GPS位置...'}
                        {quickClockStatus.locationStatus === 'invalid' && '不在允許的打卡範圍內'}
                        {quickClockStatus.locationStatus === 'error' && 'GPS定位失敗'}
                        {quickClockStatus.locationStatus === 'disabled' && 'GPS已停用'}
                      </span>
                    </div>
                    {quickClockStatus.accuracy && quickClockStatus.locationStatus === 'valid' && (
                      <div className="text-xs text-gray-600 ml-6">
                        精度: ±{Math.round(quickClockStatus.accuracy)}米
                      </div>
                    )}
                    {quickClockStatus.locationError && (
                      <div className="text-xs text-red-600 ml-6">
                        {quickClockStatus.locationError}
                      </div>
                    )}
                  </div>
                )}

                {/* 今日排班資訊 - 員工資訊存在時顯示 */}
                {quickClockStatus?.attendanceStatus?.todaySchedule && (
                  <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="w-4 h-4 text-blue-600" />
                      <span className="text-sm font-semibold text-gray-700">今日排班</span>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-3">
                      <div className="text-sm text-gray-900">
                        <span className="font-medium">{quickClockStatus.attendanceStatus.todaySchedule.date}</span>
                        <span className="mx-2">|</span>
                        <span className="font-semibold text-blue-700">{quickClockStatus.attendanceStatus.todaySchedule.shiftCode}</span>
                        <span className="mx-2">|</span>
                        <span>{quickClockStatus.attendanceStatus.todaySchedule.shiftTime}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* 當月異常記錄 - 有異常記錄時顯示 */}
                {quickClockStatus?.attendanceStatus?.anomalyRecords && quickClockStatus.attendanceStatus.anomalyRecords.length > 0 && (
                  <div className="bg-white rounded-2xl p-4 border border-orange-100 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertCircle className="w-4 h-4 text-orange-600" />
                      <span className="text-sm font-semibold text-gray-700">當月異常記錄 ({quickClockStatus.attendanceStatus.anomalyRecords.length}筆)</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-2 py-1.5 text-left font-medium text-gray-600">日期</th>
                            <th className="px-2 py-1.5 text-left font-medium text-gray-600">班別</th>
                            <th className="px-2 py-1.5 text-left font-medium text-gray-600">班別時間</th>
                            <th className="px-2 py-1.5 text-left font-medium text-gray-600">上班時間</th>
                            <th className="px-2 py-1.5 text-left font-medium text-gray-600">上班打卡</th>
                            <th className="px-2 py-1.5 text-left font-medium text-gray-600">下班時間</th>
                            <th className="px-2 py-1.5 text-left font-medium text-gray-600">下班打卡</th>
                            <th className="px-2 py-1.5 text-left font-medium text-gray-600">狀態</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {quickClockStatus.attendanceStatus.anomalyRecords.slice(0, 5).map((record, index) => (
                            <tr key={index} className="hover:bg-gray-50">
                              <td className="px-2 py-1.5 text-gray-900">{record.date}</td>
                              <td className="px-2 py-1.5 text-gray-900 font-medium">{record.shiftCode}</td>
                              <td className="px-2 py-1.5 text-gray-600">{record.shiftTime}</td>
                              <td className="px-2 py-1.5 text-gray-600">{record.scheduledClockIn}</td>
                              <td className={`px-2 py-1.5 ${record.actualClockIn === '--' ? 'text-red-500' : 'text-gray-900'}`}>{record.actualClockIn}</td>
                              <td className="px-2 py-1.5 text-gray-600">{record.scheduledClockOut}</td>
                              <td className={`px-2 py-1.5 ${record.actualClockOut === '--' ? 'text-red-500' : 'text-gray-900'}`}>{record.actualClockOut}</td>
                              <td className="px-2 py-1.5">
                                <span className={`px-1.5 py-0.5 rounded text-xs ${
                                  record.status.includes('缺') ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                                }`}>
                                  {record.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {quickClockStatus.attendanceStatus.anomalyRecords.length > 5 && (
                      <div className="text-xs text-gray-500 mt-2 text-center">
                        顯示最近5筆，共{quickClockStatus.attendanceStatus.anomalyRecords.length}筆異常記錄
                      </div>
                    )}
                  </div>
                )}

                {/* 快速打卡說明 */}
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <h4 className="text-sm font-medium text-blue-800 mb-2">快速打卡說明</h4>
                  <ul className="text-xs text-blue-700 space-y-1">
                    <li>• 輸入您的員編和密碼即可直接打卡</li>
                    <li>• 無需登入系統，適合僅需打卡的場景</li>
                    {quickClockStatus?.gpsEnabled && <li>• 需要允許GPS定位以驗證打卡位置</li>}
                    <li>• 如需查看打卡記錄，請使用系統登入</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 包裝元件，提供 Suspense boundary 以符合 Next.js 15 要求
export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
        <div className="text-white text-lg">載入中...</div>
      </div>
    }>
      <LoginPageContent />
    </Suspense>
  );
}
