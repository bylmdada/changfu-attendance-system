'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Key, Eye, EyeOff, Shield, Users, Lock, X } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';
import ConfirmDialog from '@/components/ConfirmDialog';
import {
  type PasswordPolicy,
  type PasswordStrengthResult,
  evaluatePasswordStrength,
  getDefaultPasswordPolicy,
  generatePasswordForPolicy,
} from '@/lib/password-policy';
import {
  type BatchResetItem,
  getPasswordErrorReasons,
  getRetryItems,
  runBatchReset,
  summarizeBatchReset,
} from '@/lib/password-reset-results';

interface User {
  id: number;
  username: string;
  role: string;
  isActive: boolean;
  employee: {
    id: number;
    employeeId: string;
    name: string;
    department: string;
    position: string;
  };
}

interface CurrentUser {
  id: number;
  username: string;
  role: string;
  employeeId: number;
}

interface AuthUser {
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

// API 返回的員工類型
interface EmployeeApiResponse {
  id: number;
  employeeId: string;
  name: string;
  department: string;
  position: string;
  user?: {
    id: number;
    username: string;
    role: string;
    isActive: boolean;
  };
}

// 伺服器拒絕新密碼時的具體原因（例如近期已使用過），顯示在新密碼欄位旁
function PasswordReasons({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <div role="alert" className="mt-2 text-xs text-red-600">
      <span className="font-medium">伺服器拒絕這組密碼的原因：</span>
      <ul className="list-disc list-inside ml-2">
        {reasons.map((reason, index) => (
          <li key={index}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}

const BATCH_STATUS_LABEL: Record<BatchResetItem['status'], { text: string; className: string }> = {
  pending: { text: '尚未送出', className: 'bg-gray-100 text-gray-700' },
  sending: { text: '處理中', className: 'bg-blue-100 text-blue-700' },
  done: { text: '已完成', className: 'bg-green-100 text-green-800' },
  failed: { text: '失敗', className: 'bg-red-100 text-red-800' },
  unknown: { text: '待確認', className: 'bg-yellow-100 text-yellow-800' },
};

export default function PasswordManagement() {
  const [users, setUsers] = useState<User[]>([]); // 目前這一頁（伺服器分頁）
  const [totalUsers, setTotalUsers] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [loading, setLoading] = useState(true);
  const listRequestId = useRef(0);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  
  // 部門列表
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  
  // 搜尋和篩選狀態
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  
  // Toast 狀態
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [accountStatusTarget, setAccountStatusTarget] = useState<{ userId: number; currentStatus: boolean; name: string } | null>(null);
  
  // 排序狀態
  const [sortConfig, setSortConfig] = useState<{ field: 'name' | 'department' | 'status'; direction: 'asc' | 'desc' }>({ field: 'name', direction: 'asc' });
  
  // 批量選擇狀態（跨頁保留，所以存整個帳號資料）
  const [selectedUsers, setSelectedUsers] = useState<Map<number, User>>(new Map());
  
  // 分頁狀態
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  // 密碼政策狀態
  const [passwordPolicy, setPasswordPolicy] = useState<PasswordPolicy | null>(null);
  const [passwordStrength, setPasswordStrength] = useState<PasswordStrengthResult | null>(null);
  
  // 修改自己密碼的狀態
  const [changePasswordForm, setChangePasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);
  const [changePasswordReasons, setChangePasswordReasons] = useState<string[]>([]);

  // 重置密碼的狀態
  const [resetPasswordForm, setResetPasswordForm] = useState({
    userId: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);
  const [resetPasswordReasons, setResetPasswordReasons] = useState<string[]>([]);
  const [showResetModal, setShowResetModal] = useState(false);
  
  // 批量重置狀態
  const [showBatchResetModal, setShowBatchResetModal] = useState(false);
  const [batchItems, setBatchItems] = useState<BatchResetItem[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);

  // Toast 顯示函數
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  // 密碼產生器
  const generateSecurePassword = () => {
    try {
      return generatePasswordForPolicy(passwordPolicy ?? getDefaultPasswordPolicy());
    } catch {
      return generatePasswordForPolicy(getDefaultPasswordPolicy());
    }
  };

  const validatePasswordInput = (password: string) => {
    if (!passwordPolicy) {
      return password.length >= 8 ? null : '新密碼長度至少8位';
    }

    const evaluation = evaluatePasswordStrength(password, passwordPolicy);
    return evaluation.passesPolicy ? null : `密碼不符合安全政策：${evaluation.violations.join('、')}`;
  };

  // 排序函數
  const handleSort = (field: 'name' | 'department' | 'status') => {
    setCurrentPage(1);
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  // 選擇記錄
  const toggleSelectRecord = (user: User) => {
    const next = new Map(selectedUsers);
    if (next.has(user.id)) {
      next.delete(user.id);
    } else {
      next.set(user.id, user);
    }
    setSelectedUsers(next);
  };

  // 全選/取消全選（當前頁）
  const toggleSelectAll = () => {
    const next = new Map(selectedUsers);
    if (users.every(u => next.has(u.id))) {
      users.forEach(u => next.delete(u.id));
    } else {
      users.forEach(u => next.set(u.id, u));
    }
    setSelectedUsers(next);
  };

  // 批量重置密碼：每個帳號各產生一組新密碼，逐筆保留結果
  const runBatch = async (items: BatchResetItem[]) => {
    setBatchRunning(true);
    try {
      const finalItems = await runBatchReset(items, {
        generatePassword: generateSecurePassword,
        onChange: setBatchItems,
        send: async (userId, password) => {
          const response = await fetchJSONWithCSRF('/api/password', {
            method: 'POST',
            body: { userId: userId.toString(), newPassword: password }
          });
          const data = await response.json().catch(() => null);
          return {
            ok: response.ok,
            status: response.status,
            error: data?.error,
            reasons: getPasswordErrorReasons(data),
          };
        },
      });
      const summary = summarizeBatchReset(finalItems);
      if (summary.done === finalItems.length) {
        showToast('success', `已重置 ${summary.done} 個帳號的密碼，請立即複製新密碼`);
      } else {
        showToast('error', `完成 ${summary.done}、待確認 ${summary.unknown}、失敗 ${summary.failed}、未送出 ${summary.pending}`);
      }
    } catch (error) {
      console.error('批量重置失敗:', error);
      showToast('error', '批量重置中斷，請查看每個帳號的結果');
    } finally {
      setBatchRunning(false);
    }
  };

  const openBatchReset = () => {
    const items: BatchResetItem[] = [...selectedUsers.values()].map(user => ({
      userId: user.id,
      name: user.employee.name,
      employeeId: user.employee.employeeId,
      username: user.username,
      status: 'pending',
    }));
    setBatchItems(items);
    setShowBatchResetModal(true);
  };

  const closeBatchReset = () => {
    // 已完成的帳號不用再選；沒完成的留著選取，方便稍後重試
    const unfinished = new Set(getRetryItems(batchItems).map(item => item.userId));
    setSelectedUsers(prev => new Map([...prev].filter(([id]) => unfinished.has(id))));
    setShowBatchResetModal(false);
    setBatchItems([]);
  };

  const copyBatchResults = async () => {
    const lines = batchItems
      .filter(item => item.status === 'done')
      .map(item => `${item.name}\t${item.employeeId}\t${item.username}\t${item.password}`);
    try {
      await navigator.clipboard.writeText(['姓名\t員編\t帳號\t新密碼', ...lines].join('\n'));
      showToast('success', `已複製 ${lines.length} 個帳號的新密碼`);
    } catch {
      showToast('error', '無法複製，請直接從清單抄寫');
    }
  };

  useEffect(() => {
    fetchCurrentUser();
    fetchPasswordPolicy();
    fetchDepartments();
  }, []);

  // 搜尋打字停一下才送出查詢，並回到第 1 頁
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setCurrentPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // 獲取部門列表
  const fetchDepartments = async () => {
    try {
      const response = await fetch('/api/departments', { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setDepartments(data.departments || []);
      }
    } catch (error) {
      console.error('獲取部門列表失敗:', error);
    }
  };

  const fetchPasswordPolicy = async () => {
    try {
      const response = await fetch('/api/system-settings/password-policy', {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        setPasswordPolicy(data.policy);
      }
    } catch (error) {
      console.error('獲取密碼政策失敗:', error);
    }
  };

  const checkPasswordStrength = (password: string) => {
    if (!password || !passwordPolicy) return;
    setPasswordStrength(evaluatePasswordStrength(password, passwordPolicy));
  };

  const fetchCurrentUser = async () => {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include' // 自動包含 cookies
      });

      if (response.ok) {
        const data = await response.json();
        setCurrentUser(data.user);
        setAuthUser(data.user);
      }
    } catch (error) {
      console.error('獲取當前用戶失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  const canManageUsers = currentUser?.role === 'ADMIN' || currentUser?.role === 'HR';

  // 員工清單由伺服器搜尋、排序、分頁，不再先抓前 1,000 人到瀏覽器篩選
  const fetchUsers = useCallback(async () => {
    const requestId = ++listRequestId.current;
    setListLoading(true);
    setListError('');

    try {
      const params = new URLSearchParams({
        hasAccount: 'true',
        page: String(currentPage),
        limit: String(itemsPerPage),
        sortBy: sortConfig.field,
        // 「狀態」排序是啟用的排前面，和資料庫的 false→true 相反
        sortOrder: sortConfig.field === 'status'
          ? (sortConfig.direction === 'asc' ? 'desc' : 'asc')
          : sortConfig.direction,
      });
      if (searchQuery) params.set('search', searchQuery);
      if (selectedDepartment) params.set('department', selectedDepartment);

      const response = await fetch(`/api/employees?${params}`, { credentials: 'include' });
      if (requestId !== listRequestId.current) return;
      if (!response.ok) {
        setListError('員工清單載入失敗，請稍後再試');
        return;
      }

      const data = await response.json();
      if (requestId !== listRequestId.current) return;

      const usersData: User[] = (data.employees as EmployeeApiResponse[])
        .filter(emp => emp.user)
        .map(emp => ({
          id: emp.user!.id,
          username: emp.user!.username,
          role: emp.user!.role,
          isActive: emp.user!.isActive,
          employee: {
            id: emp.id,
            employeeId: emp.employeeId,
            name: emp.name,
            department: emp.department,
            position: emp.position
          }
        }));
      setUsers(usersData);
      setTotalUsers(data.pagination?.total ?? usersData.length);
      setTotalPages(Math.max(1, data.pagination?.pages ?? 1));
    } catch (err) {
      console.error('獲取用戶列表失敗:', err);
      if (requestId === listRequestId.current) setListError('員工清單載入失敗，請稍後再試');
    } finally {
      if (requestId === listRequestId.current) setListLoading(false);
    }
  }, [currentPage, searchQuery, selectedDepartment, sortConfig]);

  useEffect(() => {
    if (canManageUsers) void fetchUsers();
  }, [canManageUsers, fetchUsers]);

  // 部門名稱列表
  const departmentNames = departments.map(d => d.name);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (changePasswordForm.newPassword !== changePasswordForm.confirmPassword) {
      showToast('error', '新密碼和確認密碼不一致');
      return;
    }

    // 使用密碼政策驗證
    if (passwordPolicy) {
      if (changePasswordForm.newPassword.length < passwordPolicy.minLength) {
        showToast('error', `新密碼長度至少需要${passwordPolicy.minLength}位`);
        return;
      }

      const evaluation = evaluatePasswordStrength(changePasswordForm.newPassword, passwordPolicy);
      setPasswordStrength(evaluation);
      if (!evaluation.passesPolicy) {
        showToast('error', `密碼不符合安全政策：${evaluation.violations.join('、')}`);
        return;
      }
    } else if (changePasswordForm.newPassword.length < 8) {
      showToast('error', '新密碼長度至少8位');
      return;
    }

    setChangePasswordLoading(true);
    setChangePasswordReasons([]);

    try {
      const response = await fetchJSONWithCSRF('/api/password', {
        method: 'PUT',
        body: {
          currentPassword: changePasswordForm.currentPassword,
          newPassword: changePasswordForm.newPassword
        }
      });

      const data = await response.json();

      if (response.ok) {
        showToast('success', data.message || '密碼修改成功！');
        setChangePasswordForm({
          currentPassword: '',
          newPassword: '',
          confirmPassword: ''
        });
        setPasswordStrength(null);
        if (data.requireRelogin) {
          window.setTimeout(() => {
            window.location.href = '/login';
          }, 1000);
        }
      } else {
        setChangePasswordReasons(getPasswordErrorReasons(data));
        showToast('error', data.error || '密碼修改失敗');
      }
    } catch (err) {
      console.error('修改密碼錯誤:', err);
      showToast('error', '系統錯誤，請稍後再試');
    } finally {
      setChangePasswordLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (resetPasswordForm.newPassword !== resetPasswordForm.confirmPassword) {
      showToast('error', '新密碼和確認密碼不一致');
      return;
    }

    const resetPasswordError = validatePasswordInput(resetPasswordForm.newPassword);
    if (resetPasswordError) {
      showToast('error', resetPasswordError);
      return;
    }

    setResetPasswordLoading(true);
    setResetPasswordReasons([]);

    try {
      const response = await fetchJSONWithCSRF('/api/password', {
        method: 'POST',
        body: {
          userId: resetPasswordForm.userId,
          newPassword: resetPasswordForm.newPassword
        }
      });

      const data = await response.json();

      if (response.ok) {
        showToast('success', data.message || '密碼重置成功！');
        setResetPasswordForm({
          userId: '',
          newPassword: '',
          confirmPassword: ''
        });
        setShowResetModal(false);
      } else {
        setResetPasswordReasons(getPasswordErrorReasons(data));
        showToast('error', data.error || '密碼重置失敗');
      }
    } catch (err) {
      console.error('重置密碼錯誤:', err);
      showToast('error', '系統錯誤，請稍後再試');
    } finally {
      setResetPasswordLoading(false);
    }
  };

  const openResetModal = (userId: number) => {
    setResetPasswordReasons([]);
    setResetPasswordForm({
      userId: userId.toString(),
      newPassword: '',
      confirmPassword: ''
    });
    setShowResetModal(true);
  };

  // 切換帳號狀態（啟用/停用）
  const toggleAccountStatus = async (userId: number, currentStatus: boolean) => {
    const newStatus = !currentStatus;
    const action = newStatus ? '啟用' : '停用';

    try {
      const response = await fetchJSONWithCSRF('/api/users/status', {
        method: 'PATCH',
        body: { userId, isActive: newStatus }
      });

      if (response.ok) {
        const data = await response.json();
        showToast('success', data.message);
        // 更新本地狀態
        setUsers(users.map(u => 
          u.id === userId ? { ...u, isActive: newStatus } : u
        ));
        setAccountStatusTarget(null);
      } else {
        const data = await response.json();
        showToast('error', data.error || `${action}失敗`);
      }
    } catch (error) {
      console.error('切換帳號狀態失敗:', error);
      showToast('error', '系統錯誤');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 標題 */}
        <div className="mb-8">
          <div className="flex items-center mb-4">
            <Key className="w-8 h-8 text-blue-600 mr-3" />
            <h1 className="text-3xl font-bold text-gray-900">密碼管理</h1>
          </div>
          <p className="text-gray-600">管理員工帳號密碼，確保系統安全</p>
        </div>

        {/* 密碼設定政策說明 */}
        <div className="mb-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <div className="flex items-center mb-4">
            <Shield className="w-6 h-6 text-blue-600 mr-2" />
            <h2 className="text-lg font-semibold text-blue-900">密碼設定政策</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="space-y-2">
              <h3 className="font-medium text-blue-800">基本要求</h3>
              <ul className="space-y-1 text-blue-700">
                <li className="flex items-center">
                  <span className="w-2 h-2 bg-blue-500 rounded-full mr-2"></span>
                  最少 {passwordPolicy?.minLength || 8} 個字元
                </li>
                {passwordPolicy?.requireUppercase && (
                  <li className="flex items-center">
                    <span className="w-2 h-2 bg-blue-500 rounded-full mr-2"></span>
                    至少包含 1 個大寫字母 (A-Z)
                  </li>
                )}
                {passwordPolicy?.requireLowercase && (
                  <li className="flex items-center">
                    <span className="w-2 h-2 bg-blue-500 rounded-full mr-2"></span>
                    至少包含 1 個小寫字母 (a-z)
                  </li>
                )}
                {passwordPolicy?.requireNumbers && (
                  <li className="flex items-center">
                    <span className="w-2 h-2 bg-blue-500 rounded-full mr-2"></span>
                    至少包含 1 個數字 (0-9)
                  </li>
                )}
                {passwordPolicy?.requireSpecialChars && (
                  <li className="flex items-center">
                    <span className="w-2 h-2 bg-blue-500 rounded-full mr-2"></span>
                    至少包含 1 個特殊符號 ({passwordPolicy?.allowedSpecialChars || '!@#$%^&*'})
                  </li>
                )}
              </ul>
            </div>
            <div className="space-y-2">
              <h3 className="font-medium text-blue-800">安全規定</h3>
              <ul className="space-y-1 text-blue-700">
                {passwordPolicy?.preventSequentialChars && (
                  <li className="flex items-center">
                    <span className="w-2 h-2 bg-orange-500 rounded-full mr-2"></span>
                    禁止使用連續字元 (如: 123, abc)
                  </li>
                )}
                {passwordPolicy?.preventBirthdate && (
                  <li className="flex items-center">
                    <span className="w-2 h-2 bg-orange-500 rounded-full mr-2"></span>
                    禁止使用生日相關數字
                  </li>
                )}
                {passwordPolicy?.preventCommonPasswords && (
                  <li className="flex items-center">
                    <span className="w-2 h-2 bg-orange-500 rounded-full mr-2"></span>
                    禁止使用常見密碼
                  </li>
                )}
                {passwordPolicy?.preventPasswordReuse && (
                  <li className="flex items-center">
                    <span className="w-2 h-2 bg-orange-500 rounded-full mr-2"></span>
                    不可重複使用最近 {passwordPolicy?.passwordHistoryCount || 3} 次密碼
                  </li>
                )}
                {passwordPolicy?.expirationMonths !== undefined && passwordPolicy.expirationMonths > 0 && (
                  <li className="flex items-center">
                    <span className="w-2 h-2 bg-purple-500 rounded-full mr-2"></span>
                    密碼有效期限：{passwordPolicy.expirationMonths} 個月
                  </li>
                )}
                {passwordPolicy?.lockoutAfterFailedAttempts && (
                  <li className="flex items-center">
                    <span className="w-2 h-2 bg-red-500 rounded-full mr-2"></span>
                    連續 {passwordPolicy?.maxFailedAttempts || 5} 次錯誤將鎖定 {passwordPolicy?.lockoutDurationMinutes || 30} 分鐘
                  </li>
                )}
              </ul>
            </div>
          </div>
          {/* 預設政策（當 policy 未載入時顯示） */}
          {!passwordPolicy && (
            <div className="mt-4 text-sm text-blue-600">
              <p>預設政策：最少 8 字元，包含大小寫字母、數字</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* 修改自己的密碼 */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center mb-6">
              <Shield className="w-6 h-6 text-green-600 mr-2" />
              <h2 className="text-xl font-semibold text-gray-900">修改密碼</h2>
            </div>

            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  當前密碼 *
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type={showCurrentPassword ? 'text' : 'password'}
                    required
                    value={changePasswordForm.currentPassword}
                    onChange={(e) => setChangePasswordForm({
                      ...changePasswordForm,
                      currentPassword: e.target.value
                    })}
                    className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                    placeholder="請輸入當前密碼"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2"
                  >
                    {showCurrentPassword ? 
                      <EyeOff className="w-5 h-5 text-gray-400" /> : 
                      <Eye className="w-5 h-5 text-gray-400" />
                    }
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  新密碼 *
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    value={changePasswordForm.newPassword}
                    onChange={(e) => {
                      const newPassword = e.target.value;
                      setChangePasswordReasons([]);
                      setChangePasswordForm({
                        ...changePasswordForm,
                        newPassword
                      });
                      // 實時檢查密碼強度
                      if (newPassword.length > 0) {
                        checkPasswordStrength(newPassword);
                      } else {
                        setPasswordStrength(null);
                      }
                    }}
                    className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                    placeholder={passwordPolicy ? `請輸入新密碼（至少${passwordPolicy.minLength}位）` : "請輸入新密碼（至少8位）"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2"
                  >
                    {showNewPassword ? 
                      <EyeOff className="w-5 h-5 text-gray-400" /> : 
                      <Eye className="w-5 h-5 text-gray-400" />
                    }
                  </button>
                </div>
                
                <PasswordReasons reasons={changePasswordReasons} />

                {/* 密碼強度指示器 */}
                {passwordStrength && changePasswordForm.newPassword && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-gray-600">密碼強度：</span>
                      <span className={`text-xs font-medium ${
                        passwordStrength.strengthColor === 'red' ? 'text-red-600' :
                        passwordStrength.strengthColor === 'orange' ? 'text-orange-600' :
                        passwordStrength.strengthColor === 'yellow' ? 'text-yellow-600' :
                        passwordStrength.strengthColor === 'blue' ? 'text-blue-600' :
                        'text-green-600'
                      }`}>
                        {passwordStrength.strengthLabel} ({passwordStrength.score}/5)
                      </span>
                    </div>
                    
                    <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                      <div 
                        className={`h-2 rounded-full transition-all duration-300 ${
                          passwordStrength.score <= 2 ? 'bg-red-500' :
                          passwordStrength.score <= 3 ? 'bg-yellow-500' :
                          passwordStrength.score <= 4 ? 'bg-blue-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${(passwordStrength.score / 5) * 100}%` }}
                      />
                    </div>

                    {passwordStrength.violations.length > 0 && (
                      <div className="text-xs text-red-600 mb-1">
                        <span className="font-medium">政策違規：</span>
                        <ul className="list-disc list-inside ml-2">
                          {passwordStrength.violations.map((violation, index) => (
                            <li key={index}>{violation}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {passwordStrength.suggestions.length > 0 && (
                      <div className="text-xs text-gray-600">
                        <span className="font-medium">改善建議：</span>
                        <ul className="list-disc list-inside ml-2">
                          {passwordStrength.suggestions.map((suggestion, index) => (
                            <li key={index}>{suggestion}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  確認新密碼 *
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    value={changePasswordForm.confirmPassword}
                    onChange={(e) => setChangePasswordForm({
                      ...changePasswordForm,
                      confirmPassword: e.target.value
                    })}
                    className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                    placeholder="請再次輸入新密碼"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2"
                  >
                    {showConfirmPassword ? 
                      <EyeOff className="w-5 h-5 text-gray-400" /> : 
                      <Eye className="w-5 h-5 text-gray-400" />
                    }
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={changePasswordLoading}
                className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
              >
                {changePasswordLoading ? '修改中...' : '修改密碼'}
              </button>
            </form>
          </div>

          {/* 管理員功能：重置其他用戶密碼 */}
          {currentUser && (currentUser.role === 'ADMIN' || currentUser.role === 'HR') && (
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center">
                  <Users className="w-6 h-6 text-red-600 mr-2" />
                  <h2 className="text-xl font-semibold text-gray-900">重置員工密碼 ({totalUsers})</h2>
                </div>
              </div>

              {/* 搜尋和篩選區域 */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <input
                    type="search"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="搜尋姓名或員編"
                    aria-label="搜尋姓名或員編"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
                <div>
                  <select
                    value={selectedDepartment}
                    onChange={(e) => {
                      setSelectedDepartment(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  >
                    <option value="">全部部門</option>
                    {departmentNames.map((dept) => (
                      <option key={dept} value={dept}>{dept}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSort('name')}
                    className={`px-3 py-2 text-sm rounded-lg ${sortConfig.field === 'name' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    姓名 {sortConfig.field === 'name' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
                  </button>
                  <button
                    onClick={() => handleSort('department')}
                    className={`px-3 py-2 text-sm rounded-lg ${sortConfig.field === 'department' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    部門 {sortConfig.field === 'department' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
                  </button>
                  <button
                    onClick={() => handleSort('status')}
                    className={`px-3 py-2 text-sm rounded-lg ${sortConfig.field === 'status' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    狀態 {sortConfig.field === 'status' && (sortConfig.direction === 'desc' ? '↓' : '↑')}
                  </button>
                </div>
                {selectedUsers.size > 0 && (
                  <button
                    onClick={openBatchReset}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                  >
                    批量重置 ({selectedUsers.size})
                  </button>
                )}
              </div>

              {/* 全選 */}
              <div className="mb-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={users.length > 0 && users.every(u => selectedUsers.has(u.id))}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600"
                />
                <span className="text-sm text-gray-600">全選本頁</span>
              </div>

              {listError && (
                <div role="alert" className="mb-3 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200 flex items-center justify-between gap-3">
                  <span>{listError}</span>
                  <button onClick={() => void fetchUsers()} className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700">重試</button>
                </div>
              )}
              {listLoading && users.length === 0 && !listError && (
                <p className="text-sm text-gray-500 py-4 text-center">載入員工清單中...</p>
              )}
              {!listLoading && !listError && users.length === 0 && (
                <p className="text-sm text-gray-500 py-4 text-center">找不到符合條件、已有登入帳號的員工</p>
              )}

              <div className={`space-y-3 ${listLoading && users.length > 0 ? 'opacity-60' : ''}`}>
                {users.map(user => (
                  <div key={user.id} className={`flex items-center justify-between p-4 border rounded-lg ${selectedUsers.has(user.id) ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}>
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={selectedUsers.has(user.id)}
                        onChange={() => toggleSelectRecord(user)}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600"
                      />
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">{user.employee.name}</div>
                        <div className="text-sm text-gray-500">
                          {user.employee.employeeId} • {user.employee.department} • {user.username}
                        </div>
                        <div className="text-sm mt-1">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${
                            user.role === 'ADMIN' ? 'bg-red-100 text-red-800' :
                            user.role === 'HR' ? 'bg-blue-100 text-blue-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {user.role === 'ADMIN' ? '管理員' : user.role === 'HR' ? 'HR' : '員工'}
                          </span>
                          <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                            user.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {user.isActive ? '啟用' : '停用'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setAccountStatusTarget({ userId: user.id, currentStatus: user.isActive, name: user.employee.name })}
                        className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                          user.isActive 
                            ? 'bg-orange-100 text-orange-700 hover:bg-orange-200' 
                            : 'bg-green-100 text-green-700 hover:bg-green-200'
                        }`}
                      >
                        {user.isActive ? '停用帳號' : '啟用帳號'}
                      </button>
                      <button
                        onClick={() => openResetModal(user.id)}
                        disabled={!user.isActive}
                        className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        重置密碼
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* 分頁 */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-4">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 bg-gray-100 rounded disabled:opacity-50"
                  >
                    上一頁
                  </button>
                  <span className="text-sm text-gray-600">
                    第 {currentPage} / {totalPages} 頁
                  </span>
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 bg-gray-100 rounded disabled:opacity-50"
                  >
                    下一頁
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 重置密碼彈窗 */}
        {showResetModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">重置用戶密碼</h3>
                <button
                  onClick={() => setShowResetModal(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    新密碼 *
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                      type={showResetPassword ? 'text' : 'password'}
                      required
                      value={resetPasswordForm.newPassword}
                      onChange={(e) => {
                        setResetPasswordReasons([]);
                        setResetPasswordForm({
                          ...resetPasswordForm,
                          newPassword: e.target.value
                        });
                      }}
                      className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                      placeholder="請輸入新密碼（至少8位）"
                    />
                    <button
                      type="button"
                      onClick={() => setShowResetPassword(!showResetPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2"
                    >
                      {showResetPassword ? 
                        <EyeOff className="w-5 h-5 text-gray-400" /> : 
                        <Eye className="w-5 h-5 text-gray-400" />
                      }
                    </button>
                  </div>
                  <PasswordReasons reasons={resetPasswordReasons} />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    確認新密碼 *
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                      type={showResetPassword ? 'text' : 'password'}
                      required
                      value={resetPasswordForm.confirmPassword}
                      onChange={(e) => setResetPasswordForm({
                        ...resetPasswordForm,
                        confirmPassword: e.target.value
                      })}
                      className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                      placeholder="請再次輸入新密碼"
                    />
                  </div>
                </div>

                <div className="flex space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowResetModal(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const pwd = generateSecurePassword();
                      setResetPasswordForm({
                        ...resetPasswordForm,
                        newPassword: pwd,
                        confirmPassword: pwd
                      });
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                  >
                    產生密碼
                  </button>
                  <button
                    type="submit"
                    disabled={resetPasswordLoading}
                    className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    {resetPasswordLoading ? '重置中...' : '確認重置'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 批量重置密碼彈窗：每個帳號各一組新密碼，逐筆顯示結果 */}
        {showBatchResetModal && (() => {
          const summary = summarizeBatchReset(batchItems);
          const started = batchItems.some(item => item.status !== 'pending');
          const retryCount = getRetryItems(batchItems).length;
          return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full p-6 max-h-[90vh] flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">批量重置密碼 ({batchItems.length} 人)</h3>
                  <button
                    onClick={closeBatchReset}
                    disabled={batchRunning}
                    aria-label="關閉"
                    className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <p className="text-sm text-gray-600 mb-3">
                  系統會為每個帳號各產生一組不同的新密碼，重置成功後只會在這裡顯示一次，請立即複製並交給本人。
                </p>

                {started && (
                  <div className="mb-3 flex flex-wrap gap-2 text-sm" data-testid="batch-summary">
                    <span className="px-2 py-1 rounded bg-green-100 text-green-800">完成 {summary.done}</span>
                    <span className="px-2 py-1 rounded bg-yellow-100 text-yellow-800">待確認 {summary.unknown}</span>
                    <span className="px-2 py-1 rounded bg-red-100 text-red-800">失敗 {summary.failed}</span>
                    <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">未送出 {summary.pending}</span>
                  </div>
                )}

                <div className="overflow-y-auto space-y-2 mb-4 flex-1">
                  {batchItems.map(item => (
                    <div key={item.userId} className="p-3 border border-gray-200 rounded-lg text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-gray-900">
                          <span className="font-medium">{item.name}</span>
                          <span className="text-gray-500 ml-2">{item.employeeId} • {item.username}</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${BATCH_STATUS_LABEL[item.status].className}`}>
                          {BATCH_STATUS_LABEL[item.status].text}
                        </span>
                      </div>
                      {item.status === 'done' && item.password && (
                        <div className="mt-2 font-mono text-gray-900 bg-gray-50 rounded px-2 py-1 select-all">{item.password}</div>
                      )}
                      {item.message && (item.status === 'failed' || item.status === 'unknown') && (
                        <div className={`mt-2 text-xs ${item.status === 'failed' ? 'text-red-600' : 'text-yellow-700'}`}>{item.message}</div>
                      )}
                    </div>
                  ))}
                </div>

                {summary.unknown > 0 && (
                  <p className="mb-3 text-xs text-yellow-700">
                    「待確認」是連線中斷或伺服器沒有正常回應，不確定是否已重置。重試時會為該帳號產生新密碼並覆蓋，請以重試後顯示的密碼為準。
                  </p>
                )}

                <div className="flex space-x-3">
                  {summary.done > 0 && (
                    <button
                      type="button"
                      onClick={() => void copyBatchResults()}
                      className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      複製已完成的新密碼
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={closeBatchReset}
                    disabled={batchRunning}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    {started ? '關閉' : '取消'}
                  </button>
                  {retryCount > 0 && (
                    <button
                      onClick={() => void runBatch(batchItems)}
                      disabled={batchRunning}
                      className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                      {batchRunning ? '重置中...' : started ? `重試未完成的 ${retryCount} 個帳號` : '確認批量重置'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Toast 訊息 */}
      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg flex items-center gap-2 ${
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.type === 'success' ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          {toast.message}
        </div>
      )}
      <ConfirmDialog
        open={!!accountStatusTarget}
        title={accountStatusTarget?.currentStatus ? '停用帳號' : '啟用帳號'}
        message={
          accountStatusTarget
            ? `確定要${accountStatusTarget.currentStatus ? '停用' : '啟用'}「${accountStatusTarget.name}」的帳號嗎？`
            : ''
        }
        confirmLabel={accountStatusTarget?.currentStatus ? '停用' : '啟用'}
        cancelLabel="取消"
        tone={accountStatusTarget?.currentStatus ? 'danger' : 'default'}
        onConfirm={() => {
          if (!accountStatusTarget) return;
          void toggleAccountStatus(accountStatusTarget.userId, accountStatusTarget.currentStatus);
        }}
        onCancel={() => setAccountStatusTarget(null)}
      />
    </AuthenticatedLayout>
  );
}
