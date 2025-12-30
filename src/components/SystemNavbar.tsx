'use client';

import { useRouter, usePathname } from 'next/navigation';
import Image from 'next/image';
import { Home, LogOut, ArrowLeft, Settings } from 'lucide-react';

interface User {
  id: number;
  username: string;
  role: string;
  employee?: {
    id: number;
    employeeId?: string;
    name: string;
    department?: string;
    position?: string;
  };
}

interface SystemNavbarProps {
  user: User | null;
  backUrl?: string;
  backLabel?: string;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: '管理員',
  HR: '人資',
  MANAGER: '主管',
  EMPLOYEE: '員工'
};

export default function SystemNavbar({ user, backUrl, backLabel }: SystemNavbarProps) {
  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
      }
      
      router.push('/login');
    } catch (error) {
      console.error('登出失敗:', error);
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
      }
      router.push('/login');
    }
  };

  const roleLabel = user?.role ? ROLE_LABELS[user.role] || user.role : '';
  
  // 檢測是否在系統設定子頁面（但不是系統設定主頁）
  const isSystemSettingSubPage = pathname?.startsWith('/system-settings/') && pathname !== '/system-settings';

  return (
    <nav className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-30">
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* 左側：Logo 和系統名稱 - 手機版留空間給漢堡按鈕 */}
          <div className="flex items-center">
            {/* 手機版留空間給側邊欄的漢堡按鈕 */}
            <div className="w-10 lg:hidden"></div>
            
            <a href="/dashboard" className="flex items-center">
              <Image
                src="/logo.png"
                alt="長福會考勤系統 Logo"
                width={32}
                height={32}
                className="object-contain"
                priority
              />
              <span className="ml-3 font-bold text-xl text-gray-900 hidden sm:block">長福會考勤系統</span>
              <span className="ml-2 font-bold text-lg text-gray-900 sm:hidden">考勤系統</span>
            </a>
          </div>
          
          {/* 右側：歡迎資訊和操作按鈕 */}
          <div className="flex items-center space-x-2 sm:space-x-4">
            {/* 用戶資訊 - 手機版隱藏部分 */}
            {user?.employee && (
              <div className="hidden md:flex text-gray-700 font-medium text-base items-center">
                <span>歡迎，{user.employee.name}</span>
                {roleLabel && (
                  <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                    {roleLabel}
                  </span>
                )}
              </div>
            )}
            
            {/* 回到系統設定按鈕 - 在系統設定子頁面顯示（當沒有傳 backUrl 時才自動顯示） */}
            {isSystemSettingSubPage && !backUrl && (
              <a
                href="/system-settings"
                className="flex items-center space-x-1 bg-orange-100 hover:bg-orange-200 text-orange-700 px-3 py-2 rounded-lg transition-colors"
              >
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline">系統設定</span>
              </a>
            )}
            
            {/* 返回上一頁按鈕（可選） */}
            {backUrl && (
              <a
                href={backUrl}
                className={`flex items-center space-x-1 px-3 py-2 rounded-lg transition-colors ${
                  backUrl === '/system-settings' || isSystemSettingSubPage
                    ? 'bg-orange-100 hover:bg-orange-200 text-orange-700' 
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">{backLabel || '返回'}</span>
              </a>
            )}
            
            {/* 回首頁按鈕 */}
            <a
              href="/dashboard"
              className="flex items-center space-x-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg transition-colors"
            >
              <Home className="w-4 h-4" />
              <span className="hidden sm:inline">首頁</span>
            </a>
            
            {/* 登出按鈕 */}
            <button
              onClick={handleLogout}
              className="flex items-center space-x-1 bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">登出</span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
