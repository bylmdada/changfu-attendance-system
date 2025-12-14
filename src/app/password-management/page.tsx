'use client';

import { useState, useEffect } from 'react';
import { Key, Eye, EyeOff, Shield, Users, Lock } from 'lucide-react';
import { fetchJSONWithCSRF } from '@/lib/fetchWithCSRF';
import AuthenticatedLayout from '@/components/AuthenticatedLayout';

interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  allowedSpecialChars?: string;
  expirationMonths: number;
  preventPasswordReuse: boolean;
  passwordHistoryCount: number;
  preventSequentialChars: boolean;
  preventBirthdate: boolean;
  preventCommonPasswords: boolean;
  customBlockedPasswords: string[];
  enableStrengthMeter: boolean;
  minimumStrengthScore: number;
  allowAdminExceptions: boolean;
  requireExceptionReason: boolean;
  enablePasswordHints: boolean;
  lockoutAfterFailedAttempts: boolean;
  maxFailedAttempts: number;
  lockoutDurationMinutes: number;
  enableTwoFactorAuth: boolean;
  notifyPasswordExpiration: boolean;
  notificationDaysBefore: number;
}

interface PasswordStrengthResult {
  isValid: boolean;
  score: number;
  feedback: string[];
  violations: string[];
  suggestions: string[];
  strengthLabel: string;
  strengthColor: string;
  passesPolicy: boolean;
}

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

export default function PasswordManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  
  // 部門列表
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  
  // 搜尋和篩選狀態
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  
  // Toast 狀態
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // 排序狀態
  const [sortConfig, setSortConfig] = useState<{ field: 'name' | 'department' | 'status'; direction: 'asc' | 'desc' }>({ field: 'name', direction: 'asc' });
  
  // 批量選擇狀態
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  
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

  // 重置密碼的狀態
  const [resetPasswordForm, setResetPasswordForm] = useState({
    userId: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  
  // 批量重置狀態
  const [showBatchResetModal, setShowBatchResetModal] = useState(false);
  const [batchResetPassword, setBatchResetPassword] = useState('');
  const [batchResetLoading, setBatchResetLoading] = useState(false);

  // Toast 顯示函數
  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  // 密碼產生器
  const generateSecurePassword = () => {
    const length = passwordPolicy?.minLength || 12;
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const special = passwordPolicy?.allowedSpecialChars || '!@#$%^&*()_+-=[]{}|;:,.<>?';
    
    let chars = '';
    let password = '';
    
    if (passwordPolicy?.requireUppercase) { chars += uppercase; password += uppercase[Math.floor(Math.random() * uppercase.length)]; }
    if (passwordPolicy?.requireLowercase) { chars += lowercase; password += lowercase[Math.floor(Math.random() * lowercase.length)]; }
    if (passwordPolicy?.requireNumbers) { chars += numbers; password += numbers[Math.floor(Math.random() * numbers.length)]; }
    if (passwordPolicy?.requireSpecialChars) { chars += special; password += special[Math.floor(Math.random() * special.length)]; }
    
    if (!chars) chars = uppercase + lowercase + numbers + special;
    
    while (password.length < length) {
      password += chars[Math.floor(Math.random() * chars.length)];
    }
    
    // 打亂密碼順序
    return password.split('').sort(() => Math.random() - 0.5).join('');
  };

  // 排序函數
  const handleSort = (field: 'name' | 'department' | 'status') => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  // 選擇記錄
  const toggleSelectRecord = (id: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  // 全選/取消全選（當前頁）
  const toggleSelectAll = () => {
    const currentPageUsers = paginatedUsers;
    if (currentPageUsers.every(u => selectedIds.has(u.id))) {
      const newSelected = new Set(selectedIds);
      currentPageUsers.forEach(u => newSelected.delete(u.id));
      setSelectedIds(newSelected);
    } else {
      const newSelected = new Set(selectedIds);
      currentPageUsers.forEach(u => newSelected.add(u.id));
      setSelectedIds(newSelected);
    }
  };

  // 批量重置密碼
  const handleBatchReset = async () => {
    if (!batchResetPassword || batchResetPassword.length < 8) {
      showToast('error', '密碼長度至少 8 位');
      return;
    }
    
    setBatchResetLoading(true);
    let successCount = 0;
    
    try {
      for (const userId of selectedIds) {
        const response = await fetchJSONWithCSRF('/api/password', {
          method: 'POST',
          body: { userId: userId.toString(), newPassword: batchResetPassword }
        });
        if (response.ok) successCount++;
      }
      
      showToast('success', `已成功重置 ${successCount} 個用戶的密碼`);
      setSelectedIds(new Set());
      setShowBatchResetModal(false);
      setBatchResetPassword('');
    } catch (error) {
      console.error('批量重置失敗:', error);
      showToast('error', '部分重置失敗');
    } finally {
      setBatchResetLoading(false);
    }
  };

  useEffect(() => {
    fetchCurrentUser();
    fetchUsers();
    fetchPasswordPolicy();
    fetchDepartments();
  }, []);

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

  const checkPasswordStrength = async (password: string) => {
    if (!password || !passwordPolicy) return;

    try {
      const response = await fetchJSONWithCSRF('/api/auth/test-password-strength', {
        method: 'POST',
        body: { password, policy: passwordPolicy }
      });

      if (response.ok) {
        const results = await response.json();
        setPasswordStrength(results);
      }
    } catch (error) {
      console.error('密碼強度檢查失敗:', error);
    }
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
    }
  };

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/employees', {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        // 轉換數據結構：從 employees 轉換為 users
        const usersData = data.employees
          .filter((emp: EmployeeApiResponse) => emp.user) // 只獲取有用戶帳號的員工
          .map((emp: EmployeeApiResponse) => ({
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
      }
    } catch (err) {
      console.error('獲取用戶列表失敗:', err);
    } finally {
      setLoading(false);
    }
  };

  // 部門名稱列表
  const departmentNames = departments.map(d => d.name);

  // 篩選用戶
  const filteredUsers = users.filter(user => {
    // 部門篩選
    if (selectedDepartment && user.employee.department !== selectedDepartment) {
      return false;
    }
    // 搜尋篩選
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        user.employee.name.toLowerCase().includes(query) ||
        user.employee.employeeId.toLowerCase().includes(query) ||
        user.username.toLowerCase().includes(query)
      );
    }
    return true;
  });

  // 排序用戶
  const sortedUsers = [...filteredUsers].sort((a, b) => {
    const direction = sortConfig.direction === 'asc' ? 1 : -1;
    switch (sortConfig.field) {
      case 'name':
        return a.employee.name.localeCompare(b.employee.name) * direction;
      case 'department':
        return (a.employee.department || '').localeCompare(b.employee.department || '') * direction;
      case 'status':
        return (a.isActive === b.isActive ? 0 : a.isActive ? -1 : 1) * direction;
      default:
        return 0;
    }
  });

  // 分頁
  const totalPages = Math.ceil(sortedUsers.length / itemsPerPage);
  const paginatedUsers = sortedUsers.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

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

      // 檢查密碼強度
      if (passwordStrength && !passwordStrength.passesPolicy) {
        const violations = passwordStrength.violations.join('、');
        showToast('error', `密碼不符合安全政策：${violations}`);
        return;
      }
    } else {
      if (changePasswordForm.newPassword.length < 8) {
        showToast('error', '新密碼長度至少8位');
        return;
      }
    }

    setChangePasswordLoading(true);

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
        showToast('success', '密碼修改成功！');
        setChangePasswordForm({
          currentPassword: '',
          newPassword: '',
          confirmPassword: ''
        });
        setPasswordStrength(null);
      } else {
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

    // 密碼長度驗證
    if (resetPasswordForm.newPassword.length < 8) {
      showToast('error', '新密碼長度至少8位');
      return;
    }

    setResetPasswordLoading(true);

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
        showToast('success', '密碼重置成功！');
        setResetPasswordForm({
          userId: '',
          newPassword: '',
          confirmPassword: ''
        });
        setShowResetModal(false);
      } else {
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
    setResetPasswordForm({
      userId: userId.toString(),
      newPassword: '',
      confirmPassword: ''
    });
    setShowResetModal(true);
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
                  <h2 className="text-xl font-semibold text-gray-900">重置員工密碼 ({sortedUsers.length})</h2>
                </div>
              </div>

              {/* 搜尋和篩選區域 */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <input
                    type="text"
                    placeholder="搜尋姓名/員編/帳號"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  />
                </div>
                <div>
                  <select
                    value={selectedDepartment}
                    onChange={(e) => setSelectedDepartment(e.target.value)}
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
                {selectedIds.size > 0 && (
                  <button
                    onClick={() => setShowBatchResetModal(true)}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                  >
                    批量重置 ({selectedIds.size})
                  </button>
                )}
              </div>

              {/* 全選 */}
              <div className="mb-3 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={paginatedUsers.length > 0 && paginatedUsers.every(u => selectedIds.has(u.id))}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600"
                />
                <span className="text-sm text-gray-600">全選本頁</span>
              </div>

              <div className="space-y-3">
                {paginatedUsers.map(user => (
                  <div key={user.id} className={`flex items-center justify-between p-4 border rounded-lg ${selectedIds.has(user.id) ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}>
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(user.id)}
                        onChange={() => toggleSelectRecord(user.id)}
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
                    <button
                      onClick={() => openResetModal(user.id)}
                      disabled={!user.isActive}
                      className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      重置密碼
                    </button>
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
              <h3 className="text-lg font-semibold text-gray-900 mb-4">重置用戶密碼</h3>
              
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
                      onChange={(e) => setResetPasswordForm({
                        ...resetPasswordForm,
                        newPassword: e.target.value
                      })}
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

        {/* 批量重置密碼彈窗 */}
        {showBatchResetModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">批量重置密碼 ({selectedIds.size} 人)</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    新密碼 *
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={batchResetPassword}
                      onChange={(e) => setBatchResetPassword(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-black"
                      placeholder="請輸入新密碼（至少8位）"
                    />
                    <button
                      type="button"
                      onClick={() => setBatchResetPassword(generateSecurePassword())}
                      className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                      產生
                    </button>
                  </div>
                </div>

                <div className="text-sm text-gray-500">
                  將為以下 {selectedIds.size} 位用戶統一設置新密碼
                </div>

                <div className="flex space-x-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowBatchResetModal(false);
                      setBatchResetPassword('');
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleBatchReset}
                    disabled={batchResetLoading || !batchResetPassword}
                    className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    {batchResetLoading ? '重置中...' : '確認批量重置'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
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
    </AuthenticatedLayout>
  );
}
