'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeft, Shield, ShieldCheck, ShieldOff, 
  QrCode, Copy, CheckCircle, Loader2, Key, AlertTriangle
} from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';

interface TwoFactorStatus {
  enabled: boolean;
  required: boolean;
  role: string;
}

interface SetupData {
  secret: string;
  qrCode: string;
}

export default function TwoFactorPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [setupData, setSetupData] = useState<SetupData | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showDisable, setShowDisable] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/2fa/status', {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setStatus(data);
      } else if (response.status === 401) {
        router.push('/login');
      }
    } catch (error) {
      console.error('載入 2FA 狀態失敗:', error);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleStartSetup = async () => {
    setProcessing(true);
    setMessage(null);

    try {
      const response = await fetchJSONWithCSRF('/api/auth/2fa/setup', {
        method: 'POST'
      });

      if (response.ok) {
        const data = await response.json();
        setSetupData({
          secret: data.secret,
          qrCode: data.qrCode
        });
        setBackupCodes(data.backupCodes ?? []);
        setShowSetup(true);
      } else {
        const data = await response.json();
        setMessage({ type: 'error', text: data.error || '設定失敗' });
      }
    } catch (error) {
      console.error('設定失敗:', error);
      setMessage({ type: 'error', text: '系統錯誤' });
    } finally {
      setProcessing(false);
    }
  };

  const handleEnable = async () => {
    if (!verifyCode || verifyCode.length !== 6) {
      setMessage({ type: 'error', text: '請輸入 6 位數驗證碼' });
      return;
    }

    setProcessing(true);
    setMessage(null);

    try {
      const response = await fetchJSONWithCSRF('/api/auth/2fa/verify', {
        method: 'POST',
        body: { code: verifyCode }
      });

      if (response.ok) {
        setStatus({ ...status!, enabled: true });
        setShowSetup(false);
        setSetupData(null);
        setVerifyCode('');
        setMessage({ type: 'success', text: '2FA 已成功啟用！請妥善保存備用碼' });
      } else {
        const data = await response.json();
        setMessage({ type: 'error', text: data.error || '啟用失敗' });
      }
    } catch (error) {
      console.error('啟用失敗:', error);
      setMessage({ type: 'error', text: '系統錯誤' });
    } finally {
      setProcessing(false);
    }
  };

  const handleDisable = async () => {
    if (!disablePassword) {
      setMessage({ type: 'error', text: '請輸入密碼確認停用 2FA' });
      return;
    }

    setProcessing(true);
    setMessage(null);

    try {
      const response = await fetchJSONWithCSRF('/api/auth/2fa/disable', {
        method: 'POST',
        body: { password: disablePassword }
      });

      if (response.ok) {
        setStatus({ ...status!, enabled: false });
        setShowDisable(false);
        setDisablePassword('');
        setBackupCodes([]);
        setMessage({ type: 'success', text: '2FA 已停用' });
      } else {
        const data = await response.json();
        setMessage({ type: 'error', text: data.error || '停用失敗' });
      }
    } catch (error) {
      console.error('停用失敗:', error);
      setMessage({ type: 'error', text: '系統錯誤' });
    } finally {
      setProcessing(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setMessage({ type: 'success', text: '已複製到剪貼簿' });
    setTimeout(() => setMessage(null), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 頂部導航 */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.push('/dashboard')}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Shield className="w-6 h-6 text-blue-600" />
                雙因素驗證 (2FA)
              </h1>
              <p className="text-sm text-gray-500">使用 Google Authenticator 保護帳號安全</p>
            </div>
          </div>
        </div>
      </header>

      {/* 主內容 */}
      <main className="max-w-3xl mx-auto px-4 py-6">
        {/* 訊息提示 */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg flex items-center gap-2 ${
            message.type === 'success' 
              ? 'bg-green-50 text-green-700 border border-green-200' 
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {message.type === 'success' ? <CheckCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            {message.text}
          </div>
        )}

        {/* 備用碼顯示 */}
        {backupCodes.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 mb-6">
            <h3 className="text-lg font-semibold text-yellow-800 mb-2 flex items-center gap-2">
              <Key className="w-5 h-5" />
              備用驗證碼
            </h3>
            <p className="text-sm text-yellow-700 mb-4">
              請妥善保存以下備用碼，當您無法使用驗證器時可用備用碼登入。每個備用碼只能使用一次。
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
              {backupCodes.map((code, index) => (
                <code key={index} className="bg-white px-3 py-2 rounded text-center font-mono text-sm border">
                  {code}
                </code>
              ))}
            </div>
            <button
              onClick={() => copyToClipboard(backupCodes.join('\n'))}
              className="flex items-center gap-2 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700"
            >
              <Copy className="w-4 h-4" />
              複製所有備用碼
            </button>
          </div>
        )}

        {/* 2FA 狀態卡片 */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {status?.enabled ? (
                <ShieldCheck className="w-12 h-12 text-green-600" />
              ) : (
                <ShieldOff className="w-12 h-12 text-gray-400" />
              )}
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  雙因素驗證
                </h2>
                <p className="text-sm text-gray-500">
                  {status?.enabled 
                    ? '已啟用 - 您的帳號受到額外保護' 
                    : '未啟用 - 建議啟用以增強帳號安全性'}
                </p>
                {status?.required && (
                  <p className="mt-1 text-xs text-blue-600">
                    您的角色目前被列為必須完成 2FA 驗證的帳號。
                  </p>
                )}
              </div>
            </div>
            
            {status?.enabled ? (
              <button
                onClick={() => setShowDisable(true)}
                className="px-4 py-2 text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
              >
                停用 2FA
              </button>
            ) : (
              <button
                onClick={handleStartSetup}
                disabled={processing}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
                啟用 2FA
              </button>
            )}
          </div>
        </div>

        {/* 設定流程 */}
        {showSetup && setupData && (
          <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">設定雙因素驗證</h3>
            
            <div className="space-y-6">
              {/* 步驟 1 */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">
                  1. 下載 Google Authenticator 或 Microsoft Authenticator
                </p>
                <div className="flex gap-2">
                  <a 
                    href="https://apps.apple.com/tw/app/google-authenticator/id388497605" 
                    target="_blank"
                    className="text-blue-600 text-sm hover:underline"
                  >
                    iOS 下載
                  </a>
                  <span className="text-gray-400">|</span>
                  <a 
                    href="https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2" 
                    target="_blank"
                    className="text-blue-600 text-sm hover:underline"
                  >
                    Android 下載
                  </a>
                </div>
              </div>

              {/* 步驟 2 */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">
                  2. 使用 App 掃描以下 QR Code
                </p>
                <div className="flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img 
                    src={setupData.qrCode} 
                    alt="2FA QR Code" 
                    className="w-48 h-48 border rounded-lg"
                  />
                </div>
              </div>

              {/* 或手動輸入 */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">
                  或手動輸入密鑰：
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-gray-100 px-3 py-2 rounded font-mono text-sm">
                    {setupData.secret}
                  </code>
                  <button
                    onClick={() => copyToClipboard(setupData.secret)}
                    className="p-2 text-gray-500 hover:text-gray-700"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* 步驟 3 */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">
                  3. 輸入 App 顯示的 6 位數驗證碼
                </p>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="flex-1 px-4 py-2 border rounded-lg text-center text-2xl font-mono tracking-widest focus:ring-2 focus:ring-blue-500"
                    maxLength={6}
                  />
                  <button
                    onClick={handleEnable}
                    disabled={processing || verifyCode.length !== 6}
                    className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : '確認啟用'}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t">
              <button
                onClick={() => {
                  setShowSetup(false);
                  setSetupData(null);
                  setVerifyCode('');
                  setBackupCodes([]);
                }}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 停用確認 */}
        {showDisable && (
          <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
            <h3 className="text-lg font-semibold text-red-700 mb-4">停用雙因素驗證</h3>
            <p className="text-sm text-gray-600 mb-4">
              停用 2FA 會降低帳號安全性。請輸入目前登入密碼以確認停用。
            </p>
            
            <div className="flex gap-3">
              <input
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                placeholder="輸入密碼"
                className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-red-500"
              />
              <button
                onClick={handleDisable}
                disabled={processing || !disablePassword}
                className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : '確認停用'}
              </button>
            </div>

            <div className="mt-4 pt-4 border-t">
              <button
                onClick={() => {
                  setShowDisable(false);
                  setDisablePassword('');
                }}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 說明 */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-blue-800 mb-2">什麼是雙因素驗證？</h3>
          <p className="text-sm text-blue-700 mb-4">
            雙因素驗證 (2FA) 在密碼之外增加第二層保護。登入時除了密碼，還需輸入手機 App 產生的動態驗證碼。
          </p>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>✓ 即使密碼外洩，帳號仍受保護</li>
            <li>✓ 驗證碼每 30 秒自動更換</li>
            <li>✓ 離線也能產生驗證碼</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
