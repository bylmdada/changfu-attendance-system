'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, Settings, Save, Plus, Trash2, AlertTriangle, Lock, Key, Eye, EyeOff } from 'lucide-react';
import { buildAuthMeRequest, buildCookieSessionRequest } from '@/lib/admin-session-client';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import SystemNavbar from '@/components/SystemNavbar';

interface PasswordPolicy {
  // 密碼長度
  minLength: 4 | 6 | 8 | 10 | 12;
  
  // 密碼複雜性
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  allowedSpecialChars?: string;
  
  // 密碼更換頻率
  expirationMonths: 0 | 3 | 6 | 9 | 12; // 0表示不強制更新
  preventPasswordReuse: boolean;
  passwordHistoryCount: number; // 記住多少個舊密碼
  
  // 弱密碼檢查
  preventSequentialChars: boolean; // 防止連號
  preventBirthdate: boolean; // 防止生日
  preventCommonPasswords: boolean; // 防止常見弱密碼
  customBlockedPasswords: string[]; // 自訂封鎖密碼清單
  
  // 密碼強度
  enableStrengthMeter: boolean;
  minimumStrengthScore: 1 | 2 | 3 | 4 | 5; // 1=很弱 5=很強
  
  // 管理員例外
  allowAdminExceptions: boolean;
  requireExceptionReason: boolean;
  
  // 其他設定
  enablePasswordHints: boolean; // 允許密碼提示
  lockoutAfterFailedAttempts: boolean;
  maxFailedAttempts: number;
  lockoutDurationMinutes: number;
  enableTwoFactorAuth: boolean; // 雙因子驗證
  notifyPasswordExpiration: boolean; // 密碼到期通知
  notificationDaysBefore: number; // 提前幾天通知
}

interface PasswordException {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  exceptionType: 'length' | 'complexity' | 'expiration' | 'reuse' | 'weakness';
  reason: string;
  createdBy: number;
  createdAt: string;
  expiresAt?: string;
  isActive: boolean;
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const COMMON_WEAK_PASSWORDS = [
  '123456', '123456789', 'qwerty', 'password', '12345678', '111111', 
  'abc123', '1234567', 'password1', '12345', '1234567890', '123123',
  '000000', 'iloveyou', '1234', '1q2w3e4r', 'qwertyuiop', '123',
  'monkey', 'dragon', '654321', '666666', '123321', '1', 'admin'
];

interface TestResults {
  score: number;
  feedback: string[];
}

export default function PasswordPolicySettings() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'policy' | 'exceptions' | 'test'>('policy');

  // 密碼政策狀態
  const [passwordPolicy, setPasswordPolicy] = useState<PasswordPolicy>({
    minLength: 6,
    requireUppercase: false,
    requireLowercase: false,
    requireNumbers: false,
    requireSpecialChars: false,
    allowedSpecialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?',
    expirationMonths: 0,
    preventPasswordReuse: false,
    passwordHistoryCount: 5,
    preventSequentialChars: true,
    preventBirthdate: true,
    preventCommonPasswords: true,
    customBlockedPasswords: [],
    enableStrengthMeter: true,
    minimumStrengthScore: 2,
    allowAdminExceptions: true,
    requireExceptionReason: true,
    enablePasswordHints: false,
    lockoutAfterFailedAttempts: true,
    maxFailedAttempts: 5,
    lockoutDurationMinutes: 30,
    enableTwoFactorAuth: false,
    notifyPasswordExpiration: true,
    notificationDaysBefore: 7
  });

  // 例外狀態
  const [passwordExceptions, setPasswordExceptions] = useState<PasswordException[]>([]);
  const [showExceptionForm, setShowExceptionForm] = useState(false);
  const [employees, setEmployees] = useState<{ id: string; name: string; code: string }[]>([]);
  const [exceptionForm, setExceptionForm] = useState({
    employeeId: '',
    employeeName: '',
    employeeCode: '',
    exceptionType: 'length' as 'length' | 'complexity' | 'expiration' | 'reuse' | 'weakness',
    reason: '',
    expiresAt: ''
  });

  // 測試密碼狀態
  const [testPassword, setTestPassword] = useState('');
  const [showTestPassword, setShowTestPassword] = useState(false);
  const [testResults, setTestResults] = useState<TestResults | null>(null);

  // 載入用戶資訊和設定
  useEffect(() => {
    const fetchUserAndSettings = async () => {
      try {
        // 驗證用戶身份
        const authMeRequest = buildAuthMeRequest(window.location.origin);
        const userResponse = await fetch(authMeRequest.url, authMeRequest.options);
        
        if (userResponse.ok) {
          const userData = await userResponse.json();
          const currentUser = userData.user || userData;
          
          if (currentUser.role !== 'ADMIN') {
            router.push('/dashboard');
            return;
          }
          setUser(currentUser);
        } else {
          router.push('/login');
          return;
        }

        // 載入密碼政策設定
        const policyRequest = buildCookieSessionRequest(window.location.origin, '/api/system-settings/password-policy');
        const policyResponse = await fetch(policyRequest.url, policyRequest.options);
        if (policyResponse.ok) {
          const policyData = await policyResponse.json();
          if (policyData.policy) {
            setPasswordPolicy(policyData.policy);
          }
        }

        // 載入員工列表
        const employeesRequest = buildCookieSessionRequest(window.location.origin, '/api/employees');
        const employeesResponse = await fetch(employeesRequest.url, employeesRequest.options);
        if (employeesResponse.ok) {
          const employeesData = await employeesResponse.json();
          setEmployees(employeesData.employees || []);
        }

        // 載入密碼例外
        const exceptionsRequest = buildCookieSessionRequest(window.location.origin, '/api/system-settings/password-exceptions');
        const exceptionsResponse = await fetch(exceptionsRequest.url, exceptionsRequest.options);
        if (exceptionsResponse.ok) {
          const exceptionsData = await exceptionsResponse.json();
          setPasswordExceptions(exceptionsData.exceptions || []);
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

  // 儲存密碼政策
  const handleSavePolicy = async () => {
    setSaving(true);
    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/password-policy', {
        method: 'POST',
        body: { policy: passwordPolicy }
      });

      if (response.ok) {
        alert('密碼政策已儲存！');
      } else {
        const error = await response.json();
        alert(`儲存失敗: ${error.message || '未知錯誤'}`);
      }
    } catch (error) {
      console.error('儲存政策失敗:', error);
      alert('儲存失敗，請重試');
    } finally {
      setSaving(false);
    }
  };

  // 添加例外
  const handleSaveException = async () => {
    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/password-exceptions', {
        method: 'POST',
        body: exceptionForm
      });

      if (response.ok) {
        const result = await response.json();
        setPasswordExceptions(prev => [...prev, result.exception]);
        setShowExceptionForm(false);
        resetExceptionForm();
        alert('例外新增成功');
      } else {
        const error = await response.json();
        alert(`新增失敗: ${error.error || '未知錯誤'}`);
      }
    } catch (error) {
      console.error('新增例外失敗:', error);
      alert('新增失敗，請重試');
    }
  };

  // 刪除例外
  const handleDeleteException = async (exceptionId: number) => {
    if (!confirm('確定要刪除這個例外嗎？')) return;

    try {
      const response = await fetchJSONWithCSRF('/api/system-settings/password-exceptions', {
        method: 'DELETE',
        body: { id: exceptionId }
      });

      if (response.ok) {
        setPasswordExceptions(prev => prev.filter(exc => exc.id !== exceptionId));
        alert('例外刪除成功');
      } else {
        const error = await response.json();
        alert(`刪除失敗: ${error.error || '未知錯誤'}`);
      }
    } catch (error) {
      console.error('刪除例外失敗:', error);
      alert('刪除失敗，請重試');
    }
  };

  // 重置例外表單
  const resetExceptionForm = () => {
    setExceptionForm({
      employeeId: '',
      employeeName: '',
      employeeCode: '',
      exceptionType: 'length',
      reason: '',
      expiresAt: ''
    });
  };

  // 選擇員工
  const selectEmployee = (employee: { id: string; name: string; code: string }) => {
    setExceptionForm(prev => ({
      ...prev,
      employeeId: employee.id,
      employeeName: employee.name,
      employeeCode: employee.code
    }));
  };

  // 測試密碼強度
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const testPasswordStrength = async () => {
    if (!testPassword) return;

    try {
      const response = await fetchJSONWithCSRF('/api/auth/test-password-strength', {
        method: 'POST',
        body: { password: testPassword, policy: passwordPolicy }
      });

      if (response.ok) {
        const results = await response.json();
        setTestResults(results);
      }
    } catch (error) {
      console.error('測試密碼失敗:', error);
    }
  };

  // 計算密碼強度分數
  const calculatePasswordStrength = (password: string): { score: number; feedback: string[] } => {
    let score = 0;
    const feedback: string[] = [];

    if (password.length >= 8) score += 1;
    else feedback.push('密碼長度至少8位');

    if (/[a-z]/.test(password)) score += 1;
    else if (passwordPolicy.requireLowercase) feedback.push('需要小寫字母');

    if (/[A-Z]/.test(password)) score += 1;
    else if (passwordPolicy.requireUppercase) feedback.push('需要大寫字母');

    if (/[0-9]/.test(password)) score += 1;
    else if (passwordPolicy.requireNumbers) feedback.push('需要數字');

    if (/[^a-zA-Z0-9]/.test(password)) score += 1;
    else if (passwordPolicy.requireSpecialChars) feedback.push('需要特殊字元');

    return { score: Math.min(score, 5), feedback };
  };

  const getStrengthLabel = (score: number): { label: string; color: string } => {
    switch (score) {
      case 1: return { label: '很弱', color: 'text-red-600' };
      case 2: return { label: '弱', color: 'text-orange-600' };
      case 3: return { label: '普通', color: 'text-yellow-600' };
      case 4: return { label: '強', color: 'text-blue-600' };
      case 5: return { label: '很強', color: 'text-green-600' };
      default: return { label: '未知', color: 'text-gray-600' };
    }
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
      {/* 標題列 */}
      <SystemNavbar user={user} backUrl="/system-settings" backLabel="系統設定" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 標題區 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <Key className="w-8 h-8 text-blue-600 mr-3" />
            密碼政策設定
          </h1>
          <p className="text-gray-600 mt-2">管理密碼安全規則與例外名單</p>
        </div>

        {/* 標籤頁導航 */}
        <div className="mb-8">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('policy')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'policy'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                密碼政策
              </button>
              <button
                onClick={() => setActiveTab('exceptions')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'exceptions'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                例外管理
              </button>
              <button
                onClick={() => setActiveTab('test')}
                className={`py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'test'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                密碼測試
              </button>
            </nav>
          </div>
        </div>

        {/* 密碼政策設定 */}
        {activeTab === 'policy' && (
          <div className="space-y-6">
            {/* 基本設定 */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                    <Lock className="h-5 w-5 mr-2" />
                    基本密碼要求
                  </h2>
                  <button
                    onClick={handleSavePolicy}
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                  >
                    <Save className="h-4 w-4" />
                    {saving ? '儲存中...' : '儲存政策'}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* 密碼長度 */}
                  <div className="p-4 border border-gray-200 rounded-lg">
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      最小密碼長度
                    </label>
                    <select
                      value={passwordPolicy.minLength}
                      onChange={(e) => setPasswordPolicy({
                        ...passwordPolicy, 
                        minLength: parseInt(e.target.value) as 4 | 6 | 8 | 10 | 12
                      })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-black"
                    >
                      <option value={4}>4位數(含)以上</option>
                      <option value={6}>6位數(含)以上</option>
                      <option value={8}>8位數(含)以上 (建議)</option>
                      <option value={10}>10位數(含)以上</option>
                      <option value={12}>12位數(含)以上</option>
                    </select>
                  </div>

                  {/* 密碼複雜性 */}
                  <div className="p-4 border border-gray-200 rounded-lg">
                    <h3 className="text-sm font-medium text-gray-900 mb-3">密碼複雜性要求</h3>
                    <div className="space-y-3">
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={passwordPolicy.requireUppercase}
                          onChange={(e) => setPasswordPolicy({
                            ...passwordPolicy, 
                            requireUppercase: e.target.checked
                          })}
                          className="mr-2"
                        />
                        <span className="text-sm text-black">要求大寫字母</span>
                      </label>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={passwordPolicy.requireLowercase}
                          onChange={(e) => setPasswordPolicy({
                            ...passwordPolicy, 
                            requireLowercase: e.target.checked
                          })}
                          className="mr-2"
                        />
                        <span className="text-sm text-black">要求小寫字母</span>
                      </label>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={passwordPolicy.requireNumbers}
                          onChange={(e) => setPasswordPolicy({
                            ...passwordPolicy, 
                            requireNumbers: e.target.checked
                          })}
                          className="mr-2"
                        />
                        <span className="text-sm text-black">要求數字</span>
                      </label>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={passwordPolicy.requireSpecialChars}
                          onChange={(e) => setPasswordPolicy({
                            ...passwordPolicy, 
                            requireSpecialChars: e.target.checked
                          })}
                          className="mr-2"
                        />
                        <span className="text-sm text-black">要求特殊字元</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 密碼更換頻率 */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-6 flex items-center">
                  <Key className="h-5 w-5 mr-2" />
                  密碼更換政策
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* 更換頻率 */}
                  <div className="p-4 border border-gray-200 rounded-lg">
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      密碼更換頻率
                    </label>
                    <select
                      value={passwordPolicy.expirationMonths}
                      onChange={(e) => setPasswordPolicy({
                        ...passwordPolicy, 
                        expirationMonths: parseInt(e.target.value) as 0 | 3 | 6 | 9 | 12
                      })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-black"
                    >
                      <option value={0}>不強制更新</option>
                      <option value={3}>每3個月更新</option>
                      <option value={6}>每6個月更新</option>
                      <option value={9}>每9個月更新</option>
                      <option value={12}>每12個月更新</option>
                    </select>
                  </div>

                  {/* 密碼重複使用 */}
                  <div className="p-4 border border-gray-200 rounded-lg">
                    <h3 className="text-sm font-medium text-gray-900 mb-3">密碼重複使用</h3>
                    <div className="space-y-3">
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={passwordPolicy.preventPasswordReuse}
                          onChange={(e) => setPasswordPolicy({
                            ...passwordPolicy, 
                            preventPasswordReuse: e.target.checked
                          })}
                          className="mr-2"
                        />
                        <span className="text-sm text-black">禁止重複使用舊密碼</span>
                      </label>
                      {passwordPolicy.preventPasswordReuse && (
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">
                            記住密碼歷史數量
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="20"
                            value={passwordPolicy.passwordHistoryCount}
                            onChange={(e) => setPasswordPolicy({
                              ...passwordPolicy, 
                              passwordHistoryCount: parseInt(e.target.value)
                            })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 弱密碼防護 */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-6 flex items-center">
                  <AlertTriangle className="h-5 w-5 mr-2" />
                  弱密碼防護
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={passwordPolicy.preventSequentialChars}
                        onChange={(e) => setPasswordPolicy({
                          ...passwordPolicy, 
                          preventSequentialChars: e.target.checked
                        })}
                        className="mr-2"
                      />
                      <span className="text-sm text-black">禁止連續字元 (如123456、abcdef)</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={passwordPolicy.preventBirthdate}
                        onChange={(e) => setPasswordPolicy({
                          ...passwordPolicy, 
                          preventBirthdate: e.target.checked
                        })}
                        className="mr-2"
                      />
                      <span className="text-sm text-black">禁止使用生日做為密碼</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={passwordPolicy.preventCommonPasswords}
                        onChange={(e) => setPasswordPolicy({
                          ...passwordPolicy, 
                          preventCommonPasswords: e.target.checked
                        })}
                        className="mr-2"
                      />
                      <span className="text-sm text-black">禁止常見弱密碼</span>
                    </label>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      自訂封鎖密碼清單 (一行一個)
                    </label>
                    <textarea
                      value={passwordPolicy.customBlockedPasswords.join('\n')}
                      onChange={(e) => setPasswordPolicy({
                        ...passwordPolicy,
                        customBlockedPasswords: e.target.value.split('\n').filter(p => p.trim())
                      })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                      rows={4}
                      placeholder="company123&#10;admin&#10;password"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 其他安全設定 */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-6 flex items-center">
                  <Settings className="h-5 w-5 mr-2" />
                  進階安全設定
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={passwordPolicy.enableStrengthMeter}
                        onChange={(e) => setPasswordPolicy({
                          ...passwordPolicy, 
                          enableStrengthMeter: e.target.checked
                        })}
                        className="mr-2"
                      />
                      <span className="text-sm text-black">啟用密碼強度計算器</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={passwordPolicy.allowAdminExceptions}
                        onChange={(e) => setPasswordPolicy({
                          ...passwordPolicy, 
                          allowAdminExceptions: e.target.checked
                        })}
                        className="mr-2"
                      />
                      <span className="text-sm text-black">允許管理員例外</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={passwordPolicy.enablePasswordHints}
                        onChange={(e) => setPasswordPolicy({
                          ...passwordPolicy, 
                          enablePasswordHints: e.target.checked
                        })}
                        className="mr-2"
                      />
                      <span className="text-sm text-black">允許密碼提示</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={passwordPolicy.enableTwoFactorAuth}
                        onChange={(e) => setPasswordPolicy({
                          ...passwordPolicy, 
                          enableTwoFactorAuth: e.target.checked
                        })}
                        className="mr-2"
                      />
                      <span className="text-sm text-black">啟用雙因子驗證 (未來功能)</span>
                    </label>
                  </div>

                  <div className="space-y-4">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={passwordPolicy.lockoutAfterFailedAttempts}
                        onChange={(e) => setPasswordPolicy({
                          ...passwordPolicy, 
                          lockoutAfterFailedAttempts: e.target.checked
                        })}
                        className="mr-2"
                      />
                      <span className="text-sm text-black">登入失敗鎖定</span>
                    </label>
                    {passwordPolicy.lockoutAfterFailedAttempts && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-gray-600">失敗次數</label>
                          <input
                            type="number"
                            min="3"
                            max="10"
                            value={passwordPolicy.maxFailedAttempts}
                            onChange={(e) => setPasswordPolicy({
                              ...passwordPolicy, 
                              maxFailedAttempts: parseInt(e.target.value)
                            })}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-black text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600">鎖定時間(分)</label>
                          <input
                            type="number"
                            min="5"
                            max="1440"
                            value={passwordPolicy.lockoutDurationMinutes}
                            onChange={(e) => setPasswordPolicy({
                              ...passwordPolicy, 
                              lockoutDurationMinutes: parseInt(e.target.value)
                            })}
                            className="w-full px-2 py-1 border border-gray-300 rounded text-black text-sm"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 例外管理 */}
        {activeTab === 'exceptions' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-gray-900">密碼政策例外</h2>
                <button
                  onClick={() => setShowExceptionForm(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  新增例外
                </button>
              </div>

              {/* 建議例外說明 */}
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-start">
                  <AlertTriangle className="h-5 w-5 text-blue-600 mt-0.5 mr-3" />
                  <div>
                    <h4 className="font-medium text-blue-900 mb-2">建議的例外情況</h4>
                    <div className="text-sm text-blue-800 space-y-2">
                      <div>
                        <strong>密碼長度例外：</strong>
                        <ul className="list-disc list-inside ml-4 mt-1">
                          <li>高階主管或資深員工使用習慣性短密碼</li>
                          <li>系統管理員帳號需要特殊長度要求</li>
                          <li>臨時帳號或測試帳號</li>
                        </ul>
                      </div>
                      <div>
                        <strong>密碼複雜度例外：</strong>
                        <ul className="list-disc list-inside ml-4 mt-1">
                          <li>年長員工對特殊字元使用困難</li>
                          <li>特定部門使用專業術語密碼</li>
                          <li>臨時工或實習生過渡期間</li>
                        </ul>
                      </div>
                      <div>
                        <strong>密碼到期例外：</strong>
                        <ul className="list-disc list-inside ml-4 mt-1">
                          <li>重要系統維護期間</li>
                          <li>員工長期病假或出差</li>
                          <li>專案關鍵期間避免中斷</li>
                        </ul>
                      </div>
                      <div>
                        <strong>密碼重複使用例外：</strong>
                        <ul className="list-disc list-inside ml-4 mt-1">
                          <li>安全性較低的測試環境</li>
                          <li>特定工作流程需求</li>
                          <li>緊急情況下的臨時措施</li>
                        </ul>
                      </div>
                      <div>
                        <strong>弱密碼檢查例外：</strong>
                        <ul className="list-disc list-inside ml-4 mt-1">
                          <li>行業標準術語或代碼</li>
                          <li>公司特有的縮寫或名稱</li>
                          <li>符合其他安全標準的密碼</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {passwordExceptions.length === 0 ? (
                <div className="text-center py-12 text-gray-900">
                  <Shield className="h-12 w-12 mx-auto mb-2 opacity-30" />
                  <p>尚未設定任何密碼政策例外</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="border-b border-gray-200">
                      <tr>
                        <th className="text-left py-3 px-4 font-medium text-gray-900">員工</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-900">例外類型</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-900">原因</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-900">狀態</th>
                        <th className="text-left py-3 px-4 font-medium text-gray-900">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {passwordExceptions.map((exception) => (
                        <tr key={exception.id} className="border-b border-gray-100">
                          <td className="py-3 px-4 text-gray-900">
                            <div>
                              <div className="font-medium">{exception.employeeName}</div>
                              <div className="text-sm text-gray-500">{exception.employeeCode}</div>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-gray-900">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              exception.exceptionType === 'length' ? 'bg-blue-100 text-blue-800' :
                              exception.exceptionType === 'complexity' ? 'bg-green-100 text-green-800' :
                              exception.exceptionType === 'expiration' ? 'bg-yellow-100 text-yellow-800' :
                              exception.exceptionType === 'reuse' ? 'bg-purple-100 text-purple-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {exception.exceptionType === 'length' ? '密碼長度' :
                               exception.exceptionType === 'complexity' ? '密碼複雜度' :
                               exception.exceptionType === 'expiration' ? '密碼到期' :
                               exception.exceptionType === 'reuse' ? '重複使用' : '弱密碼檢查'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-gray-900 max-w-xs truncate">{exception.reason}</td>
                          <td className="py-3 px-4">
                            {exception.isActive ? (
                              <span className="text-green-600">啟用</span>
                            ) : (
                              <span className="text-red-600">停用</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <button 
                              onClick={() => handleDeleteException(exception.id)}
                              className="text-red-600 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
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

        {/* 密碼測試 */}
        {activeTab === 'test' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-6">密碼強度測試</h2>
              
              <div className="max-w-md">
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  測試密碼
                </label>
                <div className="relative">
                  <input
                    type={showTestPassword ? 'text' : 'password'}
                    value={testPassword}
                    onChange={(e) => {
                      setTestPassword(e.target.value);
                      if (e.target.value) {
                        const strength = calculatePasswordStrength(e.target.value);
                        setTestResults(strength);
                      } else {
                        setTestResults(null);
                      }
                    }}
                    className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    placeholder="輸入要測試的密碼"
                  />
                  <button
                    type="button"
                    onClick={() => setShowTestPassword(!showTestPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400"
                  >
                    {showTestPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                {testResults && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-900">強度評分：</span>
                      <span className={`text-sm font-medium ${getStrengthLabel(testResults.score).color}`}>
                        {getStrengthLabel(testResults.score).label} ({testResults.score}/5)
                      </span>
                    </div>
                    
                    <div className="w-full bg-gray-200 rounded-full h-2 mb-4">
                      <div 
                        className={`h-2 rounded-full transition-all duration-300 ${
                          testResults.score <= 2 ? 'bg-red-500' :
                          testResults.score <= 3 ? 'bg-yellow-500' :
                          testResults.score <= 4 ? 'bg-blue-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${(testResults.score / 5) * 100}%` }}
                      />
                    </div>

                    {testResults.feedback.length > 0 && (
                      <div className="mt-3">
                        <h4 className="text-sm font-medium text-gray-900 mb-2">改善建議：</h4>
                        <ul className="text-sm text-gray-600 space-y-1">
                          {testResults.feedback.map((item: string, index: number) => (
                            <li key={index} className="flex items-center">
                              <span className="w-1 h-1 bg-gray-400 rounded-full mr-2" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 例外表單模態框 */}
      {showExceptionForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                新增密碼政策例外
              </h3>

              <div className="space-y-4">
                {/* 員工選擇 */}
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1">
                    員工
                  </label>
                  <select
                    value={exceptionForm.employeeId}
                    onChange={(e) => {
                      const employee = employees.find(emp => emp.id === e.target.value);
                      if (employee) {
                        selectEmployee(employee);
                      }
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-black"
                    required
                  >
                    <option value="">請選擇員工</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name} ({employee.code})
                      </option>
                    ))}
                  </select>
                </div>

                {/* 例外類型 */}
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1">
                    例外類型
                  </label>
                  <select
                    value={exceptionForm.exceptionType}
                    onChange={(e) => setExceptionForm(prev => ({ 
                      ...prev, 
                      exceptionType: e.target.value as 'length' | 'complexity' | 'expiration' | 'reuse' | 'weakness'
                    }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-black"
                  >
                    <option value="length">密碼長度要求</option>
                    <option value="complexity">密碼複雜度要求</option>
                    <option value="expiration">密碼到期限制</option>
                    <option value="reuse">密碼重複使用限制</option>
                    <option value="weakness">弱密碼檢查</option>
                  </select>
                </div>

                {/* 例外原因 */}
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1">
                    例外原因
                  </label>
                  <textarea
                    value={exceptionForm.reason}
                    onChange={(e) => setExceptionForm(prev => ({ ...prev, reason: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                    rows={3}
                    placeholder="請說明給予例外的原因..."
                    required
                  />
                </div>

                {/* 到期時間 */}
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1">
                    例外到期時間 (選填)
                  </label>
                  <input
                    type="datetime-local"
                    value={exceptionForm.expiresAt}
                    onChange={(e) => setExceptionForm(prev => ({ ...prev, expiresAt: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-black"
                  />
                  <p className="text-xs text-gray-500 mt-1">不設定則例外永久有效</p>
                </div>
              </div>

              {/* 按鈕 */}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => {
                    setShowExceptionForm(false);
                    resetExceptionForm();
                  }}
                  className="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-400 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveException}
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  新增例外
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
