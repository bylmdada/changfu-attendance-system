'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { Shield, Smartphone, Key, Copy, Check, X, RefreshCw, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import SystemNavbar from '@/components/SystemNavbar';

interface User {
  id: number;
  username: string;
  role: string;
  employee?: { id: number; name: string };
}

interface TwoFAStatus {
  enabled: boolean;
  required: boolean;
  role: string;
}

export default function TwoFASettingsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<TwoFAStatus | null>(null);
  
  // 設定流程狀態
  const [setupMode, setSetupMode] = useState(false);
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verifyCode, setVerifyCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  
  // 停用流程
  const [showDisable, setShowDisable] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const showToast = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const userRes = await fetch('/api/auth/me', { credentials: 'include' });
        if (userRes.ok) {
          const userData = await userRes.json();
          const currentUser = userData.user || userData;
          if (currentUser.role !== 'ADMIN' && currentUser.role !== 'HR') {
            window.location.href = '/dashboard';
            return;
          }
          setUser(currentUser);
          
          // 取得 2FA 狀態
          const statusRes = await fetch('/api/auth/2fa/status', { credentials: 'include' });
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            setStatus(statusData);
          }
        } else {
          window.location.href = '/login';
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // 開始設定 2FA
  const startSetup = async () => {
    setSaving(true);
    try {
      const res = await fetchJSONWithCSRF('/api/auth/2fa/setup', {
        method: 'POST',
      });
      
      if (res.ok) {
        const data = await res.json();
        setQrCode(data.qrCode);
        setSecret(data.secret);
        setBackupCodes(data.backupCodes);
        setSetupMode(true);
      } else {
        const error = await res.json();
        showToast('error', error.error || '設定失敗');
      }
    } catch {
      showToast('error', '設定失敗');
    } finally {
      setSaving(false);
    }
  };

  // 驗證並啟用 2FA
  const verifyAndEnable = async () => {
    if (verifyCode.length !== 6) {
      showToast('error', '請輸入 6 位數驗證碼');
      return;
    }
    
    setSaving(true);
    try {
      const res = await fetchJSONWithCSRF('/api/auth/2fa/verify', {
        method: 'POST',
        body: { code: verifyCode }
      });
      
      if (res.ok) {
        showToast('success', '雙因素驗證已成功啟用！');
        setStatus({ ...status!, enabled: true });
        setSetupMode(false);
        setQrCode('');
        setSecret('');
        setVerifyCode('');
      } else {
        const error = await res.json();
        showToast('error', error.error || '驗證失敗');
      }
    } catch {
      showToast('error', '驗證失敗');
    } finally {
      setSaving(false);
    }
  };

  // 停用 2FA
  const disable2FA = async () => {
    if (!disablePassword) {
      showToast('error', '請輸入密碼');
      return;
    }
    
    setSaving(true);
    try {
      const res = await fetchJSONWithCSRF('/api/auth/2fa/disable', {
        method: 'POST',
        body: { password: disablePassword }
      });
      
      if (res.ok) {
        showToast('success', '雙因素驗證已停用');
        setStatus({ ...status!, enabled: false });
        setShowDisable(false);
        setDisablePassword('');
      } else {
        const error = await res.json();
        showToast('error', error.error || '停用失敗');
      }
    } catch {
      showToast('error', '停用失敗');
    } finally {
      setSaving(false);
    }
  };

  // 複製備用碼
  const copyBackupCodes = () => {
    navigator.clipboard.writeText(backupCodes.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />

      {/* Toast */}
      {message && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg ${
          message.type === 'success' ? 'bg-green-500' : 'bg-red-500'
        } text-white`}>
          {message.type === 'success' ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
          {message.text}
        </div>
      )}

      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* 標題 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <Shield className="w-8 h-8 text-blue-600 mr-3" />
            雙因素驗證 (2FA)
          </h1>
          <p className="text-gray-600 mt-2">使用手機驗證器 APP 增加登入安全性</p>
        </div>

        {/* 狀態卡片 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-full ${status?.enabled ? 'bg-green-100' : 'bg-gray-100'}`}>
                <Shield className={`w-6 h-6 ${status?.enabled ? 'text-green-600' : 'text-gray-400'}`} />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">
                  {status?.enabled ? '2FA 已啟用' : '2FA 未啟用'}
                </h3>
                <p className="text-sm text-gray-500">
                  {status?.enabled 
                    ? '您的帳號受到雙因素驗證保護'
                    : '建議啟用以提升帳號安全性'}
                </p>
              </div>
            </div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              status?.enabled 
                ? 'bg-green-100 text-green-700'
                : 'bg-yellow-100 text-yellow-700'
            }`}>
              {status?.enabled ? '已保護' : '未保護'}
            </span>
          </div>
        </div>

        {/* 未設定時的設定按鈕 */}
        {!status?.enabled && !setupMode && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="text-center">
              <Smartphone className="w-16 h-16 text-blue-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">設定雙因素驗證</h3>
              <p className="text-gray-600 mb-6">
                使用 Google Authenticator 或 Microsoft Authenticator 等驗證器 APP，
                每次登入時提供額外的安全驗證碼。
              </p>
              <button
                onClick={startSetup}
                disabled={saving}
                className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? <RefreshCw className="w-5 h-5 mr-2 animate-spin" /> : <Key className="w-5 h-5 mr-2" />}
                開始設定
              </button>
            </div>
          </div>
        )}

        {/* 設定流程 */}
        {setupMode && (
          <div className="space-y-6">
            {/* 步驟 1: 掃描 QR Code */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center">
                <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm mr-2">1</span>
                掃描 QR Code
              </h3>
              <div className="flex flex-col items-center">
                {qrCode && (
                  <Image
                    src={qrCode}
                    alt="2FA QR Code"
                    width={192}
                    height={192}
                    className="mb-4 h-48 w-48"
                    unoptimized
                  />
                )}
                <p className="text-sm text-gray-600 text-center mb-2">
                  使用 Google Authenticator、Microsoft Authenticator 或其他驗證器 APP 掃描上方 QR Code
                </p>
                <div className="bg-gray-100 rounded-lg px-4 py-2 font-mono text-sm text-gray-900 font-semibold">
                  {secret}
                </div>
                <p className="text-xs text-gray-600 mt-1">無法掃描時可手動輸入此密鑰</p>
              </div>
            </div>

            {/* 步驟 2: 備份碼 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center">
                <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm mr-2">2</span>
                儲存備用碼
              </h3>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600" />
                  <p className="text-sm text-yellow-800">
                    請妥善保存這些備用碼！如果手機遺失，可使用備用碼登入。每個備用碼只能使用一次。
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {backupCodes.map((code, i) => (
                  <div key={i} className="bg-gray-100 rounded px-3 py-2 font-mono text-center text-gray-900 font-semibold">
                    {code}
                  </div>
                ))}
              </div>
              <button
                onClick={copyBackupCodes}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                {copied ? '已複製' : '複製備用碼'}
              </button>
            </div>

            {/* 步驟 3: 驗證 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center">
                <span className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm mr-2">3</span>
                輸入驗證碼完成設定
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                輸入驗證器 APP 顯示的 6 位數驗證碼以完成設定
              </p>
              <div className="flex gap-4">
                <input
                  type="text"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  className="flex-1 text-center text-2xl font-mono tracking-widest border border-gray-300 rounded-lg px-4 py-3 text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={verifyAndEnable}
                  disabled={saving || verifyCode.length !== 6}
                  className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {saving ? <RefreshCw className="w-5 h-5 animate-spin" /> : '啟用'}
                </button>
              </div>
              <button
                onClick={() => { setSetupMode(false); setQrCode(''); setSecret(''); setBackupCodes([]); }}
                className="w-full mt-4 text-gray-500 hover:text-gray-700"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 已啟用時的停用選項 */}
        {status?.enabled && !showDisable && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-900 mb-2">停用雙因素驗證</h3>
            <p className="text-sm text-gray-600 mb-4">
              停用後，登入時將不需要輸入驗證碼。這會降低帳號安全性。
            </p>
            <button
              onClick={() => setShowDisable(true)}
              className="px-4 py-2 border-2 border-red-500 text-red-600 font-medium rounded-lg hover:bg-red-50 hover:text-red-700 transition-colors"
            >
              停用 2FA
            </button>
          </div>
        )}

        {/* 停用確認 */}
        {showDisable && (
          <div className="bg-white rounded-xl shadow-sm border border-red-200 p-6">
            <h3 className="font-semibold text-red-600 mb-4">確認停用雙因素驗證</h3>
            <p className="text-sm text-gray-700 mb-4">
              為確保帳戶安全，請輸入您的<span className="font-semibold text-gray-900">登入密碼</span>來確認停用：
            </p>
            <div className="relative mb-4">
              <input
                type={showPassword ? 'text' : 'password'}
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                placeholder="請輸入您的登入密碼"
                className="w-full border border-gray-300 rounded-lg px-4 py-2 pr-12 text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                title={showPassword ? '隱藏密碼' : '顯示密碼'}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <div className="flex gap-3">
              <button
                onClick={disable2FA}
                disabled={saving}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : '確認停用'}
              </button>
              <button
                onClick={() => { setShowDisable(false); setDisablePassword(''); }}
                className="px-4 py-2 border border-gray-400 rounded-lg text-gray-700 hover:bg-gray-100 hover:text-gray-900"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
