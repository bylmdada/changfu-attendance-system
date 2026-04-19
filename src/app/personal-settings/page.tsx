'use client';

import { useState, useEffect } from 'react';
import { User, Fingerprint, Smartphone, Trash2, Plus, Shield, Clock, Eye, EyeOff } from 'lucide-react';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import { base64UrlToArrayBuffer, serializeRegistrationCredential } from '@/lib/webauthn-browser';

interface WebAuthnCredential {
  id: number;
  deviceName: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface UserInfo {
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

export default function PersonalSettingsPage() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [credentials, setCredentials] = useState<WebAuthnCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [registerData, setRegisterData] = useState({ password: '', deviceName: '' });
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    checkBiometricSupport();
    loadUserData();
    loadCredentials();
  }, []);

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

  const loadUserData = async () => {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      }
    } catch (error) {
      console.error('載入用戶資料失敗:', error);
    }
  };

  const loadCredentials = async () => {
    try {
      const response = await fetch('/api/user/webauthn-credentials', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setCredentials(data.credentials || []);
      }
    } catch (error) {
      console.error('載入憑證失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteCredential = async (credentialId: number) => {
    if (!confirm('確定要刪除此 Face ID / 指紋設備嗎？刪除後需要重新設定才能使用。')) {
      return;
    }

    setActionLoading(true);
    try {
      const response = await fetchJSONWithCSRF('/api/user/webauthn-credentials', {
        method: 'DELETE',
        body: { credentialId }
      });

      const data = await response.json();
      if (response.ok) {
        setMessage({ type: 'success', text: data.message });
        loadCredentials();
      } else {
        setMessage({ type: 'error', text: data.error || '刪除失敗' });
      }
    } catch (error) {
      console.error('刪除憑證失敗:', error);
      setMessage({ type: 'error', text: '系統錯誤' });
    } finally {
      setActionLoading(false);
    }
  };

  const registerNewDevice = async () => {
    if (!registerData.password) {
      setMessage({ type: 'error', text: '請輸入密碼以驗證身份' });
      return;
    }

    if (!user) return;

      setActionLoading(true);
      try {
        // 1. 獲取註冊選項
        let optionsResponse: Response;
        try {
          optionsResponse = await fetch('/api/webauthn/register-options', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              username: user.username,
              password: registerData.password
            }),
            credentials: 'include'
          });
        } finally {
          setRegisterData((previous) => ({ ...previous, password: '' }));
        }

        if (!optionsResponse.ok) {
          const error = await optionsResponse.json();
          throw new Error(error.error || '驗證失敗');
        }

        const { options } = await optionsResponse.json();

        // 2. 調用 WebAuthn API
        const publicKeyOptions: PublicKeyCredentialCreationOptions = {
          challenge: base64UrlToArrayBuffer(options.challenge),
          rp: options.rp,
          user: {
            id: base64UrlToArrayBuffer(options.user.id),
            name: options.user.name,
            displayName: options.user.displayName
          },
          pubKeyCredParams: options.pubKeyCredParams,
          timeout: options.timeout,
          authenticatorSelection: options.authenticatorSelection,
          attestation: options.attestation,
          excludeCredentials: Array.isArray(options.excludeCredentials)
            ? options.excludeCredentials.map((credential: { id: string; transports?: AuthenticatorTransport[] }) => ({
                ...credential,
                id: base64UrlToArrayBuffer(credential.id),
              }))
            : undefined,
        };

      const credential = await navigator.credentials.create({
        publicKey: publicKeyOptions
      }) as PublicKeyCredential;

      if (!credential) {
        throw new Error('Face ID / 指紋設定被取消');
      }

      // 3. 發送憑證到伺服器驗證
        const verifyResponse = await fetchJSONWithCSRF('/api/webauthn/register-verify', {
          method: 'POST',
          body: {
            credential: serializeRegistrationCredential({
              id: credential.id,
              response: credential.response as AuthenticatorAttestationResponse,
            }),
            deviceName: registerData.deviceName || getDeviceName()
          }
        });

      const verifyData = await verifyResponse.json();
      if (verifyResponse.ok) {
        setMessage({ type: 'success', text: 'Face ID / 指紋設定成功！' });
        setShowRegisterForm(false);
        setRegisterData({ password: '', deviceName: '' });
        loadCredentials();
      } else {
        throw new Error(verifyData.error || '設定失敗');
      }
    } catch (error) {
      console.error('註冊失敗:', error);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '設定失敗' });
    } finally {
      setActionLoading(false);
    }
  };

  const getDeviceName = () => {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android 裝置';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows PC';
    return '未知裝置';
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getRoleName = (role: string) => {
    switch (role) {
      case 'ADMIN': return '管理員';
      case 'HR': return 'HR';
      case 'EMPLOYEE': return '員工';
      default: return role;
    }
  };

  if (loading) {
    return (
      <AuthenticatedLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </AuthenticatedLayout>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {/* 頁面標題 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <User className="mr-3 h-8 w-8" />
            個人設定
          </h1>
          <p className="mt-2 text-gray-600">管理您的帳號資訊和安全設定</p>
        </div>

        {/* 訊息提示 */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg ${
            message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 
            'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {message.text}
            <button 
              onClick={() => setMessage(null)} 
              className="float-right text-lg leading-none"
            >×</button>
          </div>
        )}

        {/* 個人資訊卡片 */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
            <Shield className="mr-2 h-5 w-5 text-blue-600" />
            帳號資訊
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm text-gray-500">帳號</div>
              <div className="text-lg font-medium text-gray-900">{user?.username}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm text-gray-500">權限</div>
              <div className="text-lg font-medium text-gray-900">{getRoleName(user?.role || '')}</div>
            </div>
            {user?.employee && (
              <>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="text-sm text-gray-500">姓名</div>
                  <div className="text-lg font-medium text-gray-900">{user.employee.name}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="text-sm text-gray-500">員工編號</div>
                  <div className="text-lg font-medium text-gray-900">{user.employee.employeeId}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="text-sm text-gray-500">部門</div>
                  <div className="text-lg font-medium text-gray-900">{user.employee.department}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <div className="text-sm text-gray-500">職位</div>
                  <div className="text-lg font-medium text-gray-900">{user.employee.position}</div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Face ID / 指紋設定 */}
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900 flex items-center">
              <Fingerprint className="mr-2 h-5 w-5 text-purple-600" />
              Face ID / 指紋登入
            </h2>
            {biometricSupported && (
              <button
                onClick={() => setShowRegisterForm(!showRegisterForm)}
                className="flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                disabled={actionLoading}
              >
                <Plus className="w-4 h-4 mr-1" />
                新增設備
              </button>
            )}
          </div>

          {!biometricSupported && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
              <p className="text-yellow-700">
                此裝置或瀏覽器不支援 Face ID / 指紋功能。請使用 iPhone、Android 手機或配備 Touch ID 的 Mac 來設定。
              </p>
            </div>
          )}

          {/* 新增設備表單 */}
          {showRegisterForm && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-4">
              <h3 className="font-medium text-gray-900 mb-3">新增 Face ID / 指紋設備</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    密碼驗證 <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={registerData.password}
                      onChange={(e) => setRegisterData({ ...registerData, password: e.target.value })}
                      placeholder="請輸入您的密碼"
                      className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-purple-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    設備名稱（選填）
                  </label>
                  <input
                    type="text"
                    value={registerData.deviceName}
                    onChange={(e) => setRegisterData({ ...registerData, deviceName: e.target.value })}
                    placeholder={`例如：我的 ${getDeviceName()}`}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={registerNewDevice}
                    disabled={actionLoading}
                    className="flex-1 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                  >
                    {actionLoading ? '設定中...' : '開始設定'}
                  </button>
                  <button
                    onClick={() => {
                      setShowRegisterForm(false);
                      setRegisterData({ password: '', deviceName: '' });
                    }}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                  >
                    取消
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 已註冊的設備列表 */}
          {credentials.length > 0 ? (
            <div className="space-y-3">
              {credentials.map((credential) => (
                <div 
                  key={credential.id} 
                  className="flex items-center justify-between bg-gray-50 rounded-lg p-4"
                >
                  <div className="flex items-center">
                    <Smartphone className="w-8 h-8 text-gray-400 mr-3" />
                    <div>
                      <div className="font-medium text-gray-900">{credential.deviceName}</div>
                      <div className="text-sm text-gray-500 flex items-center gap-4">
                        <span className="flex items-center">
                          <Clock className="w-3 h-3 mr-1" />
                          註冊時間：{formatDate(credential.createdAt)}
                        </span>
                        {credential.lastUsedAt && (
                          <span>最後使用：{formatDate(credential.lastUsedAt)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => deleteCredential(credential.id)}
                    disabled={actionLoading}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="刪除此設備"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Fingerprint className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>尚未設定任何 Face ID / 指紋設備</p>
              {biometricSupported && (
                <p className="text-sm mt-1">點擊「新增設備」開始設定</p>
              )}
            </div>
          )}

          <div className="mt-4 text-sm text-gray-500 bg-gray-50 rounded-lg p-3">
            <p><strong>提示：</strong>設定 Face ID / 指紋後，您可以在快速打卡頁面直接使用生物識別進行上下班打卡，無需輸入密碼。</p>
          </div>
        </div>
      </div>
    </AuthenticatedLayout>
  );
}
