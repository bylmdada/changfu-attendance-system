'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, BellOff, Smartphone, CheckCircle, AlertCircle, RefreshCw, Send } from 'lucide-react';
import SystemNavbar from '@/components/SystemNavbar';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';

interface User {
  id: number;
  username: string;
  role: string;
  employee?: {
    id: number;
    employeeId: string;
    name: string;
  };
}

export default function PushNotificationsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [vapidPublicKey, setVapidPublicKey] = useState('');
  const [pushSupported, setPushSupported] = useState(false);
  const [permissionState, setPermissionState] = useState<NotificationPermission>('default');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isDevelopment, setIsDevelopment] = useState(false);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    document.title = '推播通知設定 - 長福會考勤系統';
    
    // 檢測是否為開發環境
    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname;
      setIsDevelopment(hostname === 'localhost' || hostname === '127.0.0.1');
    }
    
    checkPushSupport();
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkPushSupport = () => {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setPushSupported(supported);
    if (supported) {
      setPermissionState(Notification.permission);
    }
  };

  const loadData = async () => {
    try {
      // 驗證登入
      const authRes = await fetch('/api/auth/me', { credentials: 'include' });
      if (!authRes.ok) {
        router.push('/login');
        return;
      }
      const authData = await authRes.json();
      setUser(authData.user);

      // 取得 VAPID 公鑰和訂閱狀態
      const pushRes = await fetch('/api/push-subscription', { credentials: 'include' });
      if (pushRes.ok) {
        const data = await pushRes.json();
        setVapidPublicKey(data.vapidPublicKey);
        setIsSubscribed(data.isSubscribed);
      }
    } catch (error) {
      console.error('載入資料失敗:', error);
      showToast('error', '載入資料失敗');
    } finally {
      setLoading(false);
    }
  };

  const urlBase64ToUint8Array = (base64String: string) => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  };

  const handleSubscribe = async () => {
    if (!pushSupported) {
      showToast('error', '您的瀏覽器不支援推播通知');
      return;
    }

    setSubscribing(true);
    try {
      // 請求通知權限
      const permission = await Notification.requestPermission();
      setPermissionState(permission);
      
      if (permission !== 'granted') {
        showToast('error', '需要允許通知權限才能啟用推播');
        return;
      }

      // 註冊 Service Worker
      const registration = await navigator.serviceWorker.ready;

      // 訂閱推播
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      });

      // 發送訂閱到伺服器
      const response = await fetchJSONWithCSRF('/api/push-subscription', {
        method: 'POST',
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          sendTest: true
        })
      }) as { success?: boolean; error?: string };

      if (response.success) {
        setIsSubscribed(true);
        showToast('success', '推播通知已啟用！您應該會收到一則測試通知');
      } else {
        throw new Error(response.error || '訂閱失敗');
      }
    } catch (error) {
      console.error('訂閱推播失敗:', error);
      showToast('error', '訂閱推播失敗：' + (error instanceof Error ? error.message : '未知錯誤'));
    } finally {
      setSubscribing(false);
    }
  };

  const handleUnsubscribe = async () => {
    setSubscribing(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        await subscription.unsubscribe();
      }

      // 通知伺服器取消訂閱
      await fetchJSONWithCSRF('/api/push-subscription', {
        method: 'DELETE'
      });

      setIsSubscribed(false);
      showToast('success', '已取消推播通知');
    } catch (error) {
      console.error('取消訂閱失敗:', error);
      showToast('error', '取消訂閱失敗');
    } finally {
      setSubscribing(false);
    }
  };

  const handleSendTestNotification = async () => {
    try {
      const response = await fetchJSONWithCSRF('/api/push-subscription', {
        method: 'POST',
        body: JSON.stringify({
          subscription: null, // 不需要重新訂閱
          sendTest: true
        })
      }) as { success?: boolean };
      
      if (response.success) {
        showToast('success', '測試通知已發送');
      }
    } catch {
      showToast('error', '發送測試通知失敗');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <SystemNavbar user={user} />
        <div className="flex justify-center items-center h-64">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SystemNavbar user={user} />
      
      {/* Toast 通知 */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg ${
          toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
        } text-white`}>
          {toast.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          {toast.message}
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Bell className="w-7 h-7 text-blue-600" />
            推播通知設定
          </h1>
          <p className="text-gray-600 mt-2">
            啟用推播通知後，您可以即時收到打卡提醒、請假核准等重要通知
          </p>
        </div>

        {/* 開發環境提示 */}
        {isDevelopment && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 text-blue-800">
              <AlertCircle className="w-5 h-5" />
              <span className="font-medium text-gray-900">開發環境提示</span>
            </div>
            <p className="text-blue-700 text-sm mt-1">
              推播通知需要正式 SSL 憑證才能運作。部署到正式環境後會自動啟用此功能。
            </p>
          </div>
        )}

        {/* 瀏覽器支援檢查 */}
        {!pushSupported && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 text-yellow-800">
              <AlertCircle className="w-5 h-5" />
              <span className="font-medium">您的瀏覽器不支援推播通知</span>
            </div>
            <p className="text-yellow-700 text-sm mt-1">
              請使用 Chrome、Firefox、Edge 或 Safari 瀏覽器，並確保已安裝 PWA 應用
            </p>
          </div>
        )}

        {/* 主要設定卡片 */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center ${
                isSubscribed ? 'bg-green-100' : 'bg-gray-100'
              }`}>
                {isSubscribed ? (
                  <Bell className="w-7 h-7 text-green-600" />
                ) : (
                  <BellOff className="w-7 h-7 text-gray-400" />
                )}
              </div>
              <div>
                <h3 className="font-semibold text-lg text-gray-900">
                  {isSubscribed ? '推播通知已啟用' : '推播通知未啟用'}
                </h3>
                <p className="text-gray-500 text-sm">
                  {isSubscribed 
                    ? '您將收到打卡提醒、請假核准等即時通知'
                    : '點擊下方按鈕啟用推播通知'}
                </p>
              </div>
            </div>

            <button
              onClick={isSubscribed ? handleUnsubscribe : handleSubscribe}
              disabled={subscribing || !pushSupported}
              className={`px-6 py-3 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                isSubscribed
                  ? 'bg-red-100 text-red-700 hover:bg-red-200'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {subscribing ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  處理中...
                </>
              ) : isSubscribed ? (
                <>
                  <BellOff className="w-5 h-5" />
                  停用推播
                </>
              ) : (
                <>
                  <Bell className="w-5 h-5" />
                  啟用推播
                </>
              )}
            </button>
          </div>

          {/* 權限狀態 */}
          {pushSupported && (
            <div className="mt-6 pt-6 border-t">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-500">通知權限狀態：</span>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  permissionState === 'granted' 
                    ? 'bg-green-100 text-green-700'
                    : permissionState === 'denied'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-gray-100 text-gray-700'
                }`}>
                  {permissionState === 'granted' ? '已允許' : permissionState === 'denied' ? '已拒絕' : '未設定'}
                </span>
              </div>
              
              {permissionState === 'denied' && (
                <p className="text-sm text-red-600 mt-2">
                  您已拒絕通知權限，請在瀏覽器設定中重新允許此網站的通知權限
                </p>
              )}
            </div>
          )}

          {/* 測試通知按鈕 */}
          {isSubscribed && (
            <div className="mt-6 pt-6 border-t">
              <button
                onClick={handleSendTestNotification}
                className="flex items-center gap-2 text-blue-600 hover:text-blue-700"
              >
                <Send className="w-4 h-4" />
                發送測試通知
              </button>
            </div>
          )}
        </div>

        {/* 通知類型說明 */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mt-6">
          <h3 className="font-semibold text-lg text-gray-900 mb-4 flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-blue-600" />
            支援的通知類型
          </h3>
          
          <div className="grid gap-4">
            {[
              { title: '打卡提醒', desc: '上班時間到時提醒您打卡', icon: '⏰' },
              { title: '漏打卡提醒', desc: '偵測到漏打卡時通知您', icon: '⚠️' },
              { title: '加班超限警示', desc: '當月加班超過 40/46 小時時通知', icon: '📊' },
              { title: '請假/加班核准', desc: '申請被核准或拒絕時通知', icon: '✅' },
              { title: '系統公告', desc: '重要系統公告推播', icon: '📢' },
            ].map((item) => (
              <div key={item.title} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <span className="text-2xl">{item.icon}</span>
                <div>
                  <div className="font-medium text-gray-900">{item.title}</div>
                  <div className="text-sm text-gray-600">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
