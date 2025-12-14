'use client';

import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Home, LogOut, ArrowLeft } from 'lucide-react';

interface User {
  id: number;
  username: string;
  role: string;
  employee?: {
    id: number;
    employeeId: string;
    name: string;
    department?: string;
    position?: string;
  };
}

interface SystemNavbarProps {
  user: User | null;
  backUrl?: string;  // 可選的返回 URL
  backLabel?: string; // 可選的返回按鈕文字
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: '管理員',
  HR: '人資',
  MANAGER: '主管',
  EMPLOYEE: '員工'
};

export default function SystemNavbar({ user, backUrl, backLabel }: SystemNavbarProps) {
  const router = useRouter();

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

  return (
    <nav className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* 左側：Logo 和系統名稱 */}
          <div className="flex items-center">
            <a href="/dashboard" className="flex items-center">
              <Image
                src="/logo.png"
                alt="長福會考勤系統 Logo"
                width={32}
                height={32}
                className="object-contain"
                priority
              />
              <span className="ml-3 font-bold text-xl text-gray-900">長福會考勤系統</span>
            </a>
          </div>
          
          {/* 右側：歡迎資訊和操作按鈕 */}
          <div className="flex items-center space-x-4">
            {user?.employee && (
              <div className="text-gray-700 font-medium text-base">
                歡迎，{user.employee.employeeId} {user.employee.name}
                {roleLabel && (
                  <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                    {roleLabel}
                  </span>
                )}
              </div>
            )}
            {/* 返回上一頁按鈕（可選） */}
            {backUrl && (
              <a
                href={backUrl}
                className="flex items-center space-x-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{backLabel || '返回'}</span>
              </a>
            )}
            <a
              href="/dashboard"
              className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
            >
              <Home className="w-4 h-4" />
              <span>回到首頁</span>
            </a>
            <button
              onClick={handleLogout}
              className="flex items-center space-x-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>登出</span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}

